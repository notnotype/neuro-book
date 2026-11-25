/**
 * 会话：读、到期、延长、最后使用时间、结束与清理（w00037 t07 计划 3.5；`site.accounts` 输出 5 到 7、17，时序与寿命一节）。
 *
 * 库认 Cookie、查会话行；会话还算不算有效由模块按 `clock` 再判一次。库只认系统时间（它没有注入时间的口子，计划 3.14），
 * 合同测试拨的是模块的时钟，模块的时间总不早于系统时间，所以库的到期判断不会先于模块触发。库的延长关着
 * （`disableSessionRefresh`），延长也由模块做。
 *
 * 会话在服务端失效都是删行（ADR 0063，设计审查 A16）：删掉以后库的 `getSession` 查不到令牌，立即无效（库没有会话缓存，
 * 升级清单“库内行为”一行核对这一点）。所有删会话的地方都经本文件的“结束会话”一组函数，在调用方的写事务里删（omp 设计审查第 16 条）。
 *
 * 谁写库：
 * - `whoami`（`peek`）只读：不延长、不更新最后使用时间、遇到到期的行也不删（交给下一次正常请求或清理任务），所以账号库被
 *   进程外占着写时它照常回答（`site.accounts` 输出 7）。它也不查同意记录：同意门槛放行它，回答里用不到这一项（计划 3.5 的
 *   `whoami` 只做第 1 到 3 步）；多查一次就多一次排队、多一个让它失败的地方（实现审查第 4 条）。
 * - 要会话的接口（`use`）：到期的行当场删；没到期时每天至多延长一次、每小时至多更新一次最后使用时间。这两样遇到库不可用时
 *   记一行 warn、照常放行（设计审查第 3 条）：本来只读的请求不因此失败。
 */

import {parseCookies} from "better-auth/cookies";

import type {Role} from "@notnotype/nb-site-identity-contract";

import type {IdentityAuth} from "./auth";
import {isDbUnavailable, type IdentityConnection, type IdentityTx} from "./db/connection";
import {libDate} from "./db/library-rows";
import {failureAsResponse, failureFor} from "./errors";
import type {IdentityLog} from "./index";
import {purgeExpiredOAuthRows, revokeOAuthForExpiredSessions, revokeOAuthForSession, revokeOAuthForUser} from "./oauth/revoke";
import {purgeExpiredFlows} from "./social/flow";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 读出的一个有效会话，不含同意（`peek` 的结果）。id 都是整数（库读成字符串，这里转）。 */
export interface SessionIdentity {
    readonly sessionId: number;
    readonly token: string;
    readonly userId: number;
    readonly username: string;
    readonly role: Role;
    readonly expiresAtMs: number;
    readonly updatedAtMs: number;
    /** 会话建立的时刻（模块的时钟，建会话前的钩子写进库）：授权端点按它判 `max_age`（`oauth/mount.ts`）。 */
    readonly createdAtMs: number;
}

/** 要会话的接口读出的有效会话（`use` 的结果）：另带同意门槛要的一项。 */
export interface CurrentSession extends SessionIdentity {
    /** 同意记录不是当前条款版本，或没有对境外存放的同意（`site.accounts` 输出 10 的门槛）。 */
    readonly consentRequired: boolean;
}

/** 库按 Cookie 查到的会话行，模块还没判到期与封禁。 */
interface FoundSession {
    readonly sessionId: number;
    readonly token: string;
    readonly userId: number;
    readonly username: string;
    readonly role: Role;
    readonly banned: boolean;
    readonly expiresAtMs: number;
    readonly updatedAtMs: number;
    readonly createdAtMs: number;
}

/** 读会话的结果：`cookies` 是要随响应发出的 `Set-Cookie`（延长时的新 Cookie、到期时的清除）。 */
export interface SessionRead<S extends SessionIdentity = CurrentSession> {
    readonly session: S | null;
    readonly cookies: readonly string[];
}

// ---- 结束会话的一组函数 ----
// 删会话的地方（登出、结束单个会话、结束全部、改密码、封禁、改角色、重置、清理任务）都调这里，在调用方的写事务里执行，
// 与那次操作的其余写入一起提交或回滚（架构用例守着“删会话只在本文件”）。每个函数先撤掉对外 OAuth 令牌与没用掉的授权码
// （`oauth/revoke.ts`；`site.oauth-provider` 输出 8），再删会话行，同一个事务：令牌记着发它时的会话，删了会话，外键把令牌的
// 会话字段置空，再按会话就找不到它们了，库也不再因为会话没了而拒绝它们（第七轮探针问 2）。`nowMs` 是撤销记下的时刻。
// 返回删掉的会话行数。

/** 结束一个会话：撤掉在它里面发出的令牌与授权码。 */
export function endSession(tx: IdentityTx, sessionId: number, nowMs: number): number {
    revokeOAuthForSession(tx, sessionId, nowMs);
    return tx.query(`DELETE FROM "session" WHERE "id" = ?`).run(sessionId).changes;
}

/**
 * 结束一个账号除 `keepSessionId` 以外的全部会话（自己改密码时保留当前会话，`site.accounts` 输出 6），并撤掉这个账号名下的
 * 全部令牌与授权码，连当前会话里发出的也撤（开发者 2026-11-25 定 2，`site.oauth-provider` 输出 8）：按账号撤，不按结束的会话。
 */
export function endOtherSessionsRevokingAllOAuth(tx: IdentityTx, userId: number, keepSessionId: number, nowMs: number): number {
    revokeOAuthForUser(tx, userId, nowMs);
    return tx.query(`DELETE FROM "session" WHERE "userId" = ? AND "id" <> ?`).run(userId, keepSessionId).changes;
}

/**
 * 结束一个账号的全部会话（封禁、改角色、管理员重置密码、结束全部会话、`create-admin`），并撤掉它名下的全部令牌与授权码。
 * 已到期、清理任务还没删的行一起删；返回的行数含它们，要“结束了几个会话”的地方另用 `countLiveSessions` 在删之前数。
 */
export function endAllSessions(tx: IdentityTx, userId: number, nowMs: number): number {
    revokeOAuthForUser(tx, userId, nowMs);
    return tx.query(`DELETE FROM "session" WHERE "userId" = ?`).run(userId).changes;
}

/**
 * 一个账号还有效（没到期）的会话数，到期的边界与 `isSessionLive`、`purgeExpiredSessions` 相同。管理详情的 `sessionCount` 与
 * “结束全部会话”审计里的条数（`site.admin` 输出 8）都经它：到期的会话在 `site.accounts` 的状态里已经失效，结束它不算结束了一个
 * 会话，两处要对得上（实现审查第 6 到 8 片第 1 条）。
 */
export function countLiveSessions(tx: IdentityTx, userId: number, nowMs: number): number {
    return tx.query<{n: number}, [number, string]>(`SELECT count(*) AS n FROM "session" WHERE "userId" = ? AND "expiresAt" > ?`).get(userId, libDate(nowMs))!.n;
}

/**
 * 清理到期的会话：`expiresAt` 不晚于 `nowMs`（与 `readSession` 的到期判断同一个边界），先撤掉在它们里面发出的令牌与授权码。
 * 时间列是库的 ISO 文本，长度与写法固定，按文字比较就是按时间比较。
 */
export function purgeExpiredSessions(tx: IdentityTx, nowMs: number): number {
    revokeOAuthForExpiredSessions(tx, nowMs);
    return tx.query(`DELETE FROM "session" WHERE "expiresAt" <= ?`).run(libDate(nowMs)).changes;
}

/**
 * 在写事务里复核一个会话还有效：行还在、令牌对得上、没到期。中间件读会话在写事务之前，排队期间它可能已被别的请求结束；
 * 普通用户的写接口在自己的写事务里先调它，不成立时按 `unauthenticated` 处理（设计审查第 5 条）。
 */
export function isSessionLive(tx: IdentityTx, session: Pick<CurrentSession, "sessionId" | "token">, nowMs: number): boolean {
    const row = tx.query<{expiresAt: string}, [number, string]>(`SELECT "expiresAt" FROM "session" WHERE "id" = ? AND "token" = ?`).get(session.sessionId, session.token);
    return row !== null && row.expiresAt > libDate(nowMs);
}

/**
 * 这个账号缺不缺同意（`site.accounts` 输出 10 的门槛，输出 8 的 `consentRequired` 是同一个条件）：最新一条同意记录不是 `termsVersion`，
 * 或没有对境外存放的同意，或根本没有记录。门槛（`Sessions.read` 的 `use`）与 `me` 的回答都经它，规则只有这一份（实现审查第 4、5 片
 * 第 6 条）。
 */
export function consentRequiredIn(tx: IdentityTx, userId: number, termsVersion: string): boolean {
    const row = tx
        .query<{terms_version: string; overseas_storage: number}, [number]>(`SELECT terms_version, overseas_storage FROM identity_consent WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
        .get(userId);
    return row === null || row.terms_version !== termsVersion || row.overseas_storage !== 1;
}

// ---- 读会话 ----

export interface SessionsOptions {
    readonly auth: IdentityAuth;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly sessionDays: number;
    readonly termsVersion: string;
    readonly log: Pick<IdentityLog, "info" | "warn" | "error">;
}

function toId(value: unknown): number {
    const id = typeof value === "string" ? Number(value) : value;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) throw new Error("the library returned an id that is not a positive integer");
    return id;
}

export class Sessions {
    readonly #auth: IdentityAuth;
    readonly #conn: IdentityConnection;
    readonly #clock: {now(): number};
    readonly #sessionMs: number;
    readonly #termsVersion: string;
    readonly #log: SessionsOptions["log"];

    constructor(options: SessionsOptions) {
        this.#auth = options.auth;
        this.#conn = options.conn;
        this.#clock = options.clock;
        this.#sessionMs = options.sessionDays * DAY_MS;
        this.#termsVersion = options.termsVersion;
        this.#log = options.log;
    }

    /**
     * 库按 Cookie 头查会话行：签名不对、令牌查不到、按系统时间已到期时为 null。只以 GET 的方式调 `getSession`：
     * 配了 `deferSessionRefresh` 时这样调不写库（auth.ts）。只交 Cookie 头，请求的别的头库用不到。
     */
    async #find(cookie: string | null): Promise<FoundSession | null> {
        if (cookie === null || cookie === "") return null;
        const found = await this.#auth.api.getSession({headers: new Headers({cookie})});
        if (found === null) return null;
        const {session, user} = found;
        if (typeof user.username !== "string") throw new Error("the library returned an account without a username");
        return {
            sessionId: toId(session.id),
            token: session.token,
            userId: toId(user.id),
            username: user.username,
            // 角色列只会是 user 或 admin（写入它的都是本模块）；别的值不当管理员。
            role: user.role === "admin" ? "admin" : "user",
            banned: user.banned === true,
            expiresAtMs: session.expiresAt.getTime(),
            updatedAtMs: session.updatedAt.getTime(),
            createdAtMs: session.createdAt.getTime(),
        };
    }

    /**
     * 请求带着会话 Cookie（不论值对不对）。要会话的接口读不出会话时据此清掉它：库按系统时间判到期时 `getSession` 只回 null，
     * 模块到不了下面按自己的时钟删行、清 Cookie 的那一支，不清的话浏览器会一直带着这个没用的 Cookie（omp 实现审查第 5 条）。
     * 行不在这里删：库没告诉是哪一行，留给清理任务。名字取库自己认 Cookie 用的那个，与 `getSession` 读的是同一个。
     */
    async #carriesSessionCookie(cookie: string | null): Promise<boolean> {
        if (cookie === null || cookie === "") return false;
        const {authCookies} = await this.#auth.$context;
        return parseCookies(cookie).has(authCookies.sessionToken.name);
    }

    #consentRequired(userId: number): Promise<boolean> {
        return this.#conn.read((tx) => consentRequiredIn(tx, userId, this.#termsVersion));
    }

    /**
     * 读当前会话（计划 3.5 的四步）。`peek`：`whoami` 用，只做前三步，不写库、不查同意。`use`：要会话的接口用，到期的行当场删、
     * 并带清除 Cookie，另查同意；带着会话 Cookie 却读不出会话时也带清除 Cookie。延长与最后使用时间不在这里，见 `maintain`。
     */
    async read(cookie: string | null, mode: "peek"): Promise<SessionRead<SessionIdentity>>;
    async read(cookie: string | null, mode: "use"): Promise<SessionRead>;
    async read(cookie: string | null, mode: "peek" | "use"): Promise<SessionRead<SessionIdentity>> {
        const found = await this.#find(cookie);
        if (found === null) return {session: null, cookies: mode === "use" && (await this.#carriesSessionCookie(cookie)) ? await this.clearCookie() : []};
        if (found.expiresAtMs <= this.#clock.now()) return {session: null, cookies: mode === "use" ? await this.#expire(found) : []};
        // 封禁时会话已删光（`endAllSessions`），这里是兜底：导入的数据里可能有封禁账号残留的会话。
        if (found.banned) return {session: null, cookies: []};
        const {banned: _banned, ...identity} = found;
        if (mode === "peek") return {session: identity, cookies: []};
        const session: CurrentSession = {...identity, consentRequired: await this.#consentRequired(found.userId)};
        return {session, cookies: []};
    }

    /** 到期的会话：删行（库不可用时留给清理任务），并清 Cookie。 */
    async #expire(found: FoundSession): Promise<string[]> {
        try {
            await this.#conn.write((tx) => endSession(tx, found.sessionId, this.#clock.now()));
        } catch (error) {
            if (!isDbUnavailable(error)) throw error;
            this.#log.warn("identity.session_expire_deferred", "could not delete an expired session; the purge job will", {});
        }
        return this.clearCookie();
    }

    /**
     * 使用中的会话：到期时间离会话时长满了一天以上就延长（每天至多一次，`site.accounts` 输出 5），并重发同一个令牌的 Cookie；
     * 否则最后使用时间早于一小时前就更新它（输出 17 的“精确到一小时以内”；一小时的粒度是为了不让每个请求都写库）。
     * 延长的 `UPDATE` 影响 0 行（会话在读出之后被结束了）时不发 Cookie（omp 设计审查第 10 条）。两个请求同时延长时各发一次
     * 同一个令牌的 Cookie，没有可观察的坏处，不防。库不可用时记 warn、回空，不让请求失败。
     */
    async maintain(session: CurrentSession): Promise<string[]> {
        const now = this.#clock.now();
        if (session.expiresAtMs - this.#sessionMs + DAY_MS <= now) {
            let changed: number;
            try {
                changed = await this.#conn.write(
                    (tx) => tx.query(`UPDATE "session" SET "expiresAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(libDate(now + this.#sessionMs), libDate(now), session.sessionId).changes,
                );
            } catch (error) {
                if (!isDbUnavailable(error)) throw error;
                this.#log.warn("identity.session_extend_skipped", "identity database is not writable; the session was not extended this time", {});
                return [];
            }
            if (changed === 0) return [];
            const {headers} = await this.#auth.api.sessionCookie({body: {token: session.token}, returnHeaders: true});
            return headers.getSetCookie();
        }
        if (session.updatedAtMs <= now - HOUR_MS) {
            try {
                await this.#conn.write((tx) => tx.query(`UPDATE "session" SET "updatedAt" = ? WHERE "id" = ?`).run(libDate(now), session.sessionId));
            } catch (error) {
                if (!isDbUnavailable(error)) throw error;
                this.#log.warn("identity.session_touch_skipped", "identity database is not writable; the session's last use was not recorded this time", {});
            }
        }
        return [];
    }

    /**
     * 问身份（`site.accounts` 输出 7；计划 3.11）：与 `GET whoami` 是同一个函数，只读请求的 Cookie 头。统计模块经入口的适配器
     * 在进程内调它。出错也在这里收口成 `ErrorBody`：作为函数被调用时没有子应用的出错出口。
     */
    async whoami(request: Request): Promise<Response> {
        try {
            const {session} = await this.read(request.headers.get("cookie"), "peek");
            if (session === null) return Response.json({state: "anonymous"});
            return Response.json({state: "authenticated", user: {id: session.userId, username: session.username, role: session.role}});
        } catch (error) {
            return failureAsResponse(failureFor(error, this.#log));
        }
    }

    /**
     * 给一个账号发会话，回会话 id 与要发出的 `Set-Cookie`。`userAgent` 是请求原样的 `User-Agent` 头，没有时为 null：它只作为这次
     * 调用的请求头交给库，建会话前的钩子把它换成概要再落库（`auth.ts`）。
     */
    async issue(userId: number, userAgent: string | null): Promise<{readonly sessionId: number; readonly cookies: string[]}> {
        const headers = new Headers(userAgent === null ? {} : {"user-agent": userAgent});
        const {headers: responseHeaders, response} = await this.#auth.api.issueSession({body: {userId}, headers, returnHeaders: true});
        return {sessionId: response.sessionId, cookies: responseHeaders.getSetCookie()};
    }

    /** 清除会话 Cookie 的 `Set-Cookie`。 */
    async clearCookie(): Promise<string[]> {
        const {headers} = await this.#auth.api.clearSessionCookie({returnHeaders: true});
        return headers.getSetCookie();
    }

    /**
     * 登出（`site.accounts` 输出 5，时序一节）：在写事务里删当前会话的行，再清 Cookie。删不成（账号库不可用）时错误照常抛出，
     * 出口回 503 `unavailable`，不清 Cookie，会话仍然有效。没有会话（没带 Cookie、签名不对、已经结束）时直接清 Cookie、成功。
     * 不经库的 `signOut`：它吞掉删行的失败、照样清 Cookie（设计审查第 1 条）。到期的会话也删：登出之后它不该还留着。
     * 不先复核（`isSessionLive`）：读出之后它若已被别处结束，按 id 删就是删 0 行，结果一样；会话 id 不重用（AUTOINCREMENT），
     * 删不到别的会话。
     */
    async logout(cookie: string | null): Promise<string[]> {
        const found = await this.#find(cookie);
        if (found !== null) await this.#conn.write((tx) => endSession(tx, found.sessionId, this.#clock.now()));
        return this.clearCookie();
    }

    /**
     * 定时任务 `purge`（`site.accounts` 的定时任务一节，计划 3.11）：一个写事务里删到期的会话（连同撤掉在它们里面发出的令牌与
     * 授权码），再删过期的授权码、库的别的一次性凭据（含社交流程的 state 行）与访问令牌，最后删发起超过 10 分钟的社交流程。库不可用时记一行 warn 说明这次没删，再照样抛出：这次运行以失败
     * 结束，经测试控制入口手动跑时回 `job_failed`、不是 `done`（`site.operations` 输出 11；omp 实现审查第 9 条）。调度器照常排
     * 下一次，到时再删。
     */
    async purge(): Promise<void> {
        let removed: {readonly sessions: number; readonly verifications: number; readonly accessTokens: number; readonly socialFlows: number};
        try {
            removed = await this.#conn.write((tx) => {
                const now = this.#clock.now();
                const sessions = purgeExpiredSessions(tx, now);
                return {sessions, ...purgeExpiredOAuthRows(tx, now), socialFlows: purgeExpiredFlows(tx, now)};
            });
        } catch (error) {
            if (isDbUnavailable(error)) this.#log.warn("identity.purge_skipped", "identity database is not writable; expired sessions are left for the next run", {});
            throw error;
        }
        if (removed.sessions > 0) this.#log.info("identity.purged", "expired sessions were deleted", {sessions: removed.sessions});
        if (removed.verifications > 0 || removed.accessTokens > 0) {
            this.#log.info("identity.oauth_purged", "expired authorization codes, one-time values and access tokens were deleted", {verifications: removed.verifications, accessTokens: removed.accessTokens});
        }
        if (removed.socialFlows > 0) this.#log.info("identity.social_flows_purged", "expired social sign-in flows were deleted", {socialFlows: removed.socialFlows});
    }
}
