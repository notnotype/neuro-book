/**
 * 登录（`site.accounts` 输出 4、19、20、21，失败表里登录的先后，时序一节的两条并发；w00037 t07 计划 3.7 的“登录”）。
 *
 * 先后，与每一步为什么在那里：
 * 1. 来源头由子应用的中间件先查；取不到来源地址回 `forbidden_origin`（输出 19：不与别的请求合并计数）。
 * 2. 校验请求体。字段不合格的请求不计入限流（失败表的“字段不合格的请求不计入限流”）。
 * 3. 限流：来源、来源加用户名两个键一起判，没超限的键都计入；来源被拒时来源加用户名不判不计（`rateLimits.login`）。
 * 4. 这个用户名这一小时里失败满 20 次时先等 2 秒（成功的登录也等）。等的时候不持队列的锁、不占哈希名额：这一步在取名额与读库
 *    之前，一个被刷失败次数的用户名只让自己的登录变慢，不挡别人（计划“主会话的审定”另加的第 2 点）。
 * 5. 找账号（只读），经哈希限额校验；失败下限从拿到名额的那一刻起算。账号不存在或没有密码时拿启动时生成的假哈希校验一次，结果当假，
 *    三种失败都算一次同样参数的 argon2id。
 * 6. 校验失败：失败计数加 1，等到下限再回 `invalid_credentials`。
 * 7. 发会话，一个库的事务（`withLibTransaction`）：复核封禁与“哈希仍是刚校验的那一份”并读出要回的公开资料，发会话，写最后登录
 *    时间。封禁、哈希与资料都在这里判、这里读，不用第 5 步读出的快照（omp 设计审查第 7 条；资料见 `recheck`）：事务持着队列的锁，
 *    复核到提交之间别人写不进来。哈希变了（并发的登录刚换了格式，或密码被改、被重置）时退出事务，对新哈希再校验一次，对上了重进，
 *    至多再来两轮；对不上回 `invalid_credentials`（时序“改密码或重置密码与登录并发”，验收 7）。
 * 8. 提交以后，旧格式的哈希换成新格式（输出 21）：忙时跳过；写回是条件更新，期间被改、被重置的密码不被覆盖。
 * 9. 请求带了续接令牌时解它，合格时响应带继续地址（`site.oauth-provider` 输出 4；`oauth/continue.ts`）。
 *
 * 封禁在校验之后才判：不知道密码的人试不出谁被封了（失败表）。
 */

import {randomBytes} from "node:crypto";

import type {Context} from "hono";

import {EMAIL, LoginRequest, parseUsernameInput, type LoginResponse} from "@notnotype/nb-site-identity-contract";

import type {IdentityAuth} from "./auth";
import type {IdentityConnection, IdentityTx} from "./db/connection";
import {libDate} from "./db/library-rows";
import {IdentityFailure, readBody} from "./errors";
import {HashOverloadedError, startFailureFloor, type FailureFloor, type FailureFloorTiming, type HashLimiter} from "./hash-limiter";
import type {IdentityLog} from "./index";
import {appendCookies} from "./middleware";
import {publicProfileOf, PROFILE_COLUMNS, type ProfileRow} from "./me";
import type {ContinueResolver} from "./oauth/continue";
import {needsRehash, type PasswordFunctions} from "./password";
import type {IdentityRateLimits} from "./rate-limit";
import type {Sessions} from "./session";

/** 同一个用户名失败多次以后每次登录先等的时长（输出 19）。真实时间，与哈希排队同理，不走模块时钟。 */
export const LOGIN_DELAY_MS = 2_000;

/** 发会话时发现哈希变了、对新哈希再校验的轮数上限（计划 3.7 第 9 步）。 */
const RECHECK_ROUNDS = 2;

const EMAIL_PATTERN = new RegExp(EMAIL.pattern, "u");

/** 库的适配器（`(await auth.$context).adapter`），开库的事务用。 */
export type LibAdapter = Awaited<IdentityAuth["$context"]>["adapter"];

/** 生成假哈希用的随机密码：没有人知道它，任何密码对它校验都是假。 */
export function dummyPasswordHash(passwords: Pick<PasswordFunctions, "hash">): Promise<string> {
    return passwords.hash(randomBytes(32).toString("base64url"));
}

export interface LoginOptions {
    readonly conn: IdentityConnection;
    readonly adapter: LibAdapter;
    /** 发会话；缺省是 `sessions.issue`，包内测试包一层，在事务开着时插入动作。 */
    readonly issueSession: Sessions["issue"];
    readonly hashLimiter: HashLimiter;
    readonly rateLimits: IdentityRateLimits;
    readonly clientAddress: (c: Context) => string | null;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "info" | "warn" | "error">;
    readonly passwords: PasswordFunctions;
    /** 启动时用随机密码生成的新格式哈希（`dummyPasswordHash`）。 */
    readonly dummyHash: string;
    /** 先等 2 秒用的睡眠；缺省 `Bun.sleep`，包内测试注入。 */
    readonly delay: (ms: number) => Promise<void>;
    /** 失败下限的时间来源；缺省真实时间，包内测试注入。 */
    readonly failureFloor: FailureFloorTiming;
    /** 解请求带的续接令牌（`oauth/continue.ts`）。 */
    readonly resolveContinue: ContinueResolver;
}

/**
 * 找到的账号与它的密码登录方式。`accountRowId` 为 null 是没有 `credential` 那一行。不带公开资料：这一读在哈希之前，到发会话时
 * 角色可能已被改掉，回的资料取自发会话的事务（`Recheck` 的 `ok`）。
 */
interface LoginCandidate {
    readonly userId: number;
    readonly banned: boolean;
    readonly accountRowId: number | null;
    readonly password: string | null;
}

/**
 * 按 `identifier` 找账号（输出 4）：含 `@` 的按邮箱找（邮箱待补的账号不算：占位邮箱不能登录），否则按用户名找。两种都先按字段规则
 * 判原始输入、过了再转小写：先转小写会把开尔文符号（U+212A）变成 `k`，让不合规则的输入找到别人的账号（设计审查第 12 条）。
 * 不合规则的就是找不到。
 */
function findCandidate(tx: IdentityTx, identifier: string): LoginCandidate | null {
    let where: string;
    let key: string;
    if (identifier.includes("@")) {
        if (!EMAIL_PATTERN.test(identifier)) return null;
        where = `u."email" = ? AND COALESCE(p.email_pending, 0) = 0`;
        key = identifier.toLowerCase();
    } else {
        const username = parseUsernameInput(identifier);
        if (username === undefined) return null;
        where = `u."username" = ?`;
        key = username;
    }
    const row = tx
        .query<{id: number; banned: number; account_row_id: number | null; password: string | null}, [string]>(
            `SELECT u."id" AS id, u."banned" AS banned, a."id" AS account_row_id, a."password" AS password
             FROM "user" u
             LEFT JOIN identity_profile p ON p.user_id = u."id"
             LEFT JOIN "account" a ON a."userId" = u."id" AND a."providerId" = 'credential'
             WHERE ${where}`,
        )
        .get(key);
    if (row === null) return null;
    return {userId: row.id, banned: row.banned === 1, accountRowId: row.account_row_id, password: row.password};
}

/** 事务里复核的结果。`ok` 带着同一次读出的公开资料，登录回的 `user` 用它。 */
type Recheck = {readonly kind: "ok"; readonly profile: ProfileRow} | {readonly kind: "banned"} | {readonly kind: "changed"; readonly password: string | null};

/**
 * 复核：没被封禁、密码登录方式那一行还在且哈希仍是 `verified`。行没了按“变成没有密码”处理。
 * 公开资料在这里一起读：这是发会话的事务里的第一个写，事务持着队列的锁直到提交，读到的角色就是新会话的角色。改角色会结束这个账号的
 * 全部会话，所以在事务外另读（哈希之前或提交之后）都可能与新会话对不上（`site.accounts` 输出 4，omp 实现审查第 6 到 8 片第 3 条）。
 */
function recheck(tx: IdentityTx, userId: number, accountRowId: number, verified: string): Recheck {
    const row = tx
        .query<ProfileRow & {banned: number; password: string | null}, [number, number]>(
            `SELECT ${PROFILE_COLUMNS}, u."banned" AS banned, a."password" AS password
             FROM "user" u
             LEFT JOIN identity_profile p ON p.user_id = u."id"
             LEFT JOIN "account" a ON a."id" = ? AND a."userId" = u."id"
             WHERE u."id" = ?`,
        )
        .get(accountRowId, userId);
    // 账号在校验之后被删了：本 Task 没有删账号的路径，按“密码不再对得上”处理。
    if (row === null) return {kind: "changed", password: null};
    const {banned, password, ...profile} = row;
    if (banned === 1) return {kind: "banned"};
    if (password !== verified) return {kind: "changed", password};
    return {kind: "ok", profile};
}

/**
 * `admin` 插件在建会话前拒绝被封禁的账号时抛的错误（库 1.7.27 的 `APIError`，`body.code` 为 `BANNED_USER`；升级清单“库内行为”
 * 一行）。复核已经在同一个事务里判过封禁，走到这里只可能是库对封禁的判法与模块不同（例如它认 `banExpires`）。只看错误的码，不看文字。
 */
export function isBannedUserError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("body" in error)) return false;
    const body = (error as {body: unknown}).body;
    return typeof body === "object" && body !== null && (body as {code?: unknown}).code === "BANNED_USER";
}

export function loginRoute(options: LoginOptions): (c: Context) => Promise<Response> {
    const {conn, hashLimiter, rateLimits, passwords, log} = options;

    /** 经哈希限额校验一次；过载换成 `overloaded`。`started` 在拿到名额、开始校验的那一刻调用。 */
    const verify = async (password: string, stored: string, accountId: number | string, started: () => void): Promise<boolean> => {
        try {
            return await hashLimiter.run(() => {
                started();
                return passwords.verify(password, stored, {accountId, log});
            });
        } catch (error) {
            if (error instanceof HashOverloadedError) throw new IdentityFailure("overloaded");
            throw error;
        }
    };

    /** 提交以后的换格式（输出 21）。失败不影响这次登录：会话已经发了，下次登录再换。 */
    const rehash = async (accountRowId: number, password: string, verified: string): Promise<void> => {
        const permit = hashLimiter.tryAcquire();
        if (permit === null) return;
        let fresh: string;
        try {
            fresh = await passwords.hash(password);
        } finally {
            permit.release();
        }
        const changed = await conn.write(
            (tx) => tx.query(`UPDATE "account" SET "password" = ?, "updatedAt" = ? WHERE "id" = ? AND "password" = ?`).run(fresh, libDate(options.clock.now()), accountRowId, verified).changes,
        );
        if (changed === 1) log.info("identity.password_rehashed", "a stored password hash was upgraded to the current format", {accountId: accountRowId});
    };

    return async (c) => {
        const address = options.clientAddress(c);
        if (address === null) throw new IdentityFailure("forbidden_origin");
        const body = await readBody(c, LoginRequest);
        // 限流的“用户名”是规范化后的登录名：转小写，是邮箱时就是那个邮箱（输出 19）。过了请求体校验、却不是合格的用户名或邮箱的
        // 也照样计：它也是一次尝试，只是一定找不到账号。
        const username = body.identifier.toLowerCase();
        const decision = rateLimits.login(address, username);
        if (!decision.ok) throw new IdentityFailure("rate_limited", [], decision.retryAfterSeconds);
        if (rateLimits.loginNeedsDelay(username)) await options.delay(LOGIN_DELAY_MS);

        // 失败下限从第一次拿到哈希名额的那一刻起算（`startFailureFloor` 的注释）：读库与排队的时间不算在里面，排队再长，失败的回应
        // 也是“排队加至少下限”，补齐不因过载失效（实现审查第 4、5 片第 2 条）。复核后再校验的那几轮不重新起算。
        let floor: FailureFloor | undefined;
        const startFloor = (): void => {
            floor ??= startFailureFloor(options.failureFloor);
        };
        const check = (stored: string, accountId: number | string): Promise<boolean> => verify(body.password, stored, accountId, startFloor);
        const reject = async (): Promise<never> => {
            rateLimits.recordLoginFailure(username);
            // 回 `invalid_credentials` 的分支都在至少一次校验之后，走到这里还没有起点是本文件的程序错误。
            if (floor === undefined) throw new Error("a login was rejected before any password check started the failure floor");
            await floor.finish(false);
            throw new IdentityFailure("invalid_credentials");
        };

        const candidate = await conn.read((tx) => findCandidate(tx, body.identifier));
        if (candidate === null || candidate.accountRowId === null || candidate.password === null) {
            await check(options.dummyHash, "dummy");
            return reject();
        }
        const userId = candidate.userId;
        const accountRowId = candidate.accountRowId;
        let verified = candidate.password;
        if (!(await check(verified, userId))) return reject();

        let issued: {readonly cookies: readonly string[]; readonly profile: ProfileRow} | undefined;
        for (let round = 0; issued === undefined; round += 1) {
            const outcome = await issueInTransaction(options, userId, accountRowId, verified, c.req.header("User-Agent") ?? null);
            if (outcome.kind === "issued") {
                issued = outcome;
                break;
            }
            if (outcome.kind === "banned") throw new IdentityFailure("account_banned");
            if (outcome.password === null || round >= RECHECK_ROUNDS) return reject();
            verified = outcome.password;
            if (!(await check(verified, userId))) return reject();
        }

        if (needsRehash(verified)) {
            try {
                await rehash(accountRowId, body.password, verified);
            } catch (error) {
                log.warn("identity.rehash_failed", "upgrading a stored password hash failed; the next login retries", {errorType: error instanceof Error ? error.name : typeof error});
            }
        }

        // 续接令牌在登录成功之后才解：失败的登录不碰它，不合格的令牌也不让登录失败，只是不给继续地址（输出 4；计划 3.7）。
        const continueUrl = body.continue === undefined ? null : await options.resolveContinue(body.continue, "login");
        appendCookies(c, issued.cookies);
        const response: LoginResponse = {user: publicProfileOf(issued.profile), ...(continueUrl === null ? {} : {continueUrl})};
        return c.json(response);
    };
}

type IssueOutcome =
    | {readonly kind: "issued"; readonly cookies: readonly string[]; readonly profile: ProfileRow}
    | {readonly kind: "banned"}
    | {readonly kind: "changed"; readonly password: string | null};

/** 文件头的第 7 步：一个库的事务里复核、发会话、写最后登录时间。复核不成立时事务里什么也没写。成功时带着复核时读的公开资料。 */
async function issueInTransaction(options: LoginOptions, userId: number, accountRowId: number, verified: string, userAgent: string | null): Promise<IssueOutcome> {
    const {conn} = options;
    try {
        return await conn.withLibTransaction(options.adapter, async () => {
            const checked = await conn.write((tx) => recheck(tx, userId, accountRowId, verified));
            if (checked.kind !== "ok") return checked;
            // 原样交出 `User-Agent`：换成概要在建会话的钩子里（`auth.ts`），不在这里。
            const {cookies} = await options.issueSession(userId, userAgent);
            const now = libDate(options.clock.now());
            await conn.write((tx) =>
                tx
                    .query(`INSERT INTO identity_profile (user_id, last_login_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET last_login_at = excluded.last_login_at`)
                    .run(userId, now),
            );
            return {kind: "issued", cookies, profile: checked.profile};
        });
    } catch (error) {
        if (isBannedUserError(error)) return {kind: "banned"};
        throw error;
    }
}
