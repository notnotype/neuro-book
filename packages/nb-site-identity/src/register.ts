/**
 * 注册（`site.accounts` 输出 1 到 3、19、20，失败表里注册的先后，时序“注册成功的响应返回时会话已经可用”；w00037 t07 计划 3.7 的
 * “注册”）。
 *
 * 先后，与每一步为什么在那里：
 * 1. 来源头由子应用的中间件先查；取不到来源地址回 `forbidden_origin`（输出 19：不与别的请求合并计数）。
 * 2. 注册关闭回 `registration_closed`：关着时不看请求的内容。
 * 3. 校验请求体，回 `validation_failed`。邮箱以 `.invalid` 结尾的由合同包的字段规则拒收（占位后缀留给导入）。字段不合格的请求
 *    不计入限流：填错了字段不该占掉每小时 5 次的额度（设计审查第 15 条）。
 * 4. 限流：来源地址每小时 5 次，过了校验的每次都计。
 * 5. 条款版本不是当前版本、或没有同意境外存放：`consent_required`。
 * 6. 预检（只读）：注册码、邀请码、用户名、邮箱，按这个先后。码在占用之前查：没有可用注册码的人试不出哪些用户名与邮箱已被注册
 *    （失败表“注册”一行）。预检只为在算哈希之前就回答，结论以第 8 步为准。
 * 7. 经哈希限额算密码的哈希，在事务之外（`db/connection.ts` 约束 1）。
 * 8. 一个库的事务（`withLibTransaction`）：按第 6 步的先后再判一次。扣码是条件更新，影响 0 行就是这期间被用完、停用或过期了；
 *    占用再查一次（预检之后可能被别人占了），先查后写，不靠唯一约束的报错文字分辨是哪一列（唯一约束仍在，撞到时是 500，说明先查
 *    后写有漏洞）。写账号、密码、补充资料
 *    （注册码、邀请码与邀请人）、同意记录，发会话。任何一步失败整个事务回滚，码不被扣（输出 2）；同一个只剩一次的码被并发使用时，
 *    事务在队列里排成先后，后到的条件更新影响 0 行。
 * 9. 回公开资料与会话的 `Set-Cookie`：事务已提交，响应返回时会话可用。请求带了续接令牌时解它（注册也建立了新会话，按登录算），
 *    合格时响应带继续地址（`site.accounts` 输出 4；`oauth/continue.ts`）。
 *
 * 社交注册（`social/start.ts` 发起、`social/hooks.ts` 回调里的钩子）用同一套预检、扣码与写资料（`precheckRegistration`、
 * `claimRegistration`、`writeRegistrationRecords`），先后与这里相同，只是邮箱在回调时才知道。
 */

import type {Context} from "hono";

import {parseUsernameInput, RegisterRequest, type RegisterResponse} from "@notnotype/nb-site-identity-contract";

import {codeInput, usableCodeSql} from "./codes";
import type {IdentityConnection, IdentityTx} from "./db/connection";
import {insertCredentialRow, insertUserRow, libDate} from "./db/library-rows";
import {IdentityFailure, readBody} from "./errors";
import {HashOverloadedError, type HashLimiter} from "./hash-limiter";
import type {LibAdapter} from "./login";
import {publicProfileOf, PROFILE_COLUMNS, type ProfileRow} from "./me";
import {appendCookies} from "./middleware";
import type {ContinueResolver} from "./oauth/continue";
import type {PasswordFunctions} from "./password";
import type {IdentityRateLimits} from "./rate-limit";
import type {Sessions} from "./session";

export interface RegisterOptions {
    readonly conn: IdentityConnection;
    readonly adapter: LibAdapter;
    /** 发会话；与登录同一个（`LoginOptions.issueSession`）。 */
    readonly issueSession: Sessions["issue"];
    readonly hashLimiter: HashLimiter;
    readonly rateLimits: IdentityRateLimits;
    readonly clientAddress: (c: Context) => string | null;
    readonly clock: {now(): number};
    readonly passwords: Pick<PasswordFunctions, "hash">;
    readonly termsVersion: string;
    readonly registrationOpen: boolean;
    /** 解请求带的续接令牌（`oauth/continue.ts`）；与登录同一个。 */
    readonly resolveContinue: ContinueResolver;
}

/**
 * 注册的内容里与登录方式无关的部分，码已去掉首尾空白、用户名已转小写。密码注册（本文件）与社交注册（`social/hooks.ts`，内容在
 * 发起时存进流程行，所以要能 JSON 往返）共用。
 */
export interface Registrant {
    readonly username: string;
    /** 原样的写法（存进 `displayUsername`）。 */
    readonly rawUsername: string;
    readonly displayName: string;
    readonly registrationCode: string;
    /** 没给邀请码、或去掉空白后是空串时没有这一项。 */
    readonly inviteCode?: string;
}

/** 过了字段校验的密码注册请求，邮箱已转小写。 */
interface Candidate extends Registrant {
    readonly email: string;
}

/** 注册时码与占用的冲突，按失败表的先后。 */
export type RegistrationConflict = "registration_code_invalid" | "invite_code_invalid" | "username_taken" | "email_taken";

/** 扣到的码：写补充资料（注册码、邀请码与邀请人）要的。 */
export interface ClaimedCodes {
    readonly registrationCodeId: number;
    readonly inviteCodeId: number | null;
    readonly inviterId: number | null;
}

/** 从请求的字段得出 `Registrant`：省略显示名时取原样的用户名（输出 1），邀请码留空按没给。 */
export function registrantOf(fields: {readonly username: string; readonly displayName?: string; readonly registrationCode: string; readonly inviteCode?: string}, username: string): Registrant {
    const inviteCode = fields.inviteCode === undefined ? "" : codeInput(fields.inviteCode);
    return {
        username,
        rawUsername: fields.username,
        // 取原样的写法，与命令行建管理员时一样，大小写由用户自己定。
        displayName: fields.displayName ?? fields.username,
        registrationCode: codeInput(fields.registrationCode),
        // 前端的邀请码输入框留空时会发空串：按“没给”处理，不当成一个不存在的码。
        ...(inviteCode === "" ? {} : {inviteCode}),
    };
}

function usernameTaken(tx: IdentityTx, username: string): boolean {
    return tx.query<{id: number}, [string]>(`SELECT "id" FROM "user" WHERE "username" = ?`).get(username) !== null;
}

function emailTaken(tx: IdentityTx, email: string): boolean {
    return tx.query<{id: number}, [string]>(`SELECT "id" FROM "user" WHERE "email" = ?`).get(email) !== null;
}

/**
 * 第 6 步的预检（只读）：按失败表的先后判，第一个不成立的就是回答。第 8 步的写事务按同一个先后再判。`email` 为 undefined 时不查
 * 邮箱：社交注册发起时还不知道邮箱，回调时才判。
 */
export function precheckRegistration(tx: IdentityTx, registrant: Registrant, email: string | undefined, now: string): RegistrationConflict | undefined {
    const registration = tx.query<{id: number}, [string, string]>(`SELECT id FROM identity_registration_code c WHERE c.code = ? AND ${usableCodeSql("c")}`).get(registrant.registrationCode, now);
    if (registration === null) return "registration_code_invalid";
    if (registrant.inviteCode !== undefined) {
        const invite = tx.query<{id: number}, [string, string]>(`SELECT id FROM identity_invite_code c WHERE c.code = ? AND ${usableCodeSql("c")}`).get(registrant.inviteCode, now);
        if (invite === null) return "invite_code_invalid";
    }
    if (usernameTaken(tx, registrant.username)) return "username_taken";
    if (email !== undefined && emailTaken(tx, email)) return "email_taken";
    return undefined;
}

/**
 * 第 8 步写事务的前半：扣码，再查占用。扣码是条件更新：预检与这里之间别人可能用掉了最后一次、停用了它，或它到期了，影响 0 行就回
 * `registration_code_invalid`（邀请码同理）。回冲突时已扣的次数还在这个事务里：调用方必须让整个事务回滚（抛出），不能提交。
 * 同一个只剩一次的码被并发使用时，写事务在队列里排成先后，后到的条件更新影响 0 行。
 */
export function claimRegistration(tx: IdentityTx, registrant: Registrant, email: string, nowMs: number): ClaimedCodes | RegistrationConflict {
    const now = libDate(nowMs);
    const registration = tx
        .query<{id: number}, [string, string]>(`UPDATE identity_registration_code SET used_count = used_count + 1 WHERE code = ? AND ${usableCodeSql("identity_registration_code")} RETURNING id`)
        .get(registrant.registrationCode, now);
    if (registration === null) return "registration_code_invalid";
    let invite: {readonly id: number; readonly owner_id: number | null} | null = null;
    if (registrant.inviteCode !== undefined) {
        invite = tx
            .query<{id: number; owner_id: number | null}, [string, string]>(`UPDATE identity_invite_code SET used_count = used_count + 1 WHERE code = ? AND ${usableCodeSql("identity_invite_code")} RETURNING id, owner_id`)
            .get(registrant.inviteCode, now);
        if (invite === null) return "invite_code_invalid";
    }
    if (usernameTaken(tx, registrant.username)) return "username_taken";
    if (emailTaken(tx, email)) return "email_taken";
    return {registrationCodeId: registration.id, inviteCodeId: invite?.id ?? null, inviterId: invite?.owner_id ?? null};
}

/** 第 8 步写事务的后半里两种注册都有的：补充资料（注册码、邀请码与邀请人）与同意记录。 */
export function writeRegistrationRecords(tx: IdentityTx, userId: number, codes: ClaimedCodes, termsVersion: string, nowMs: number): void {
    tx.query(`INSERT INTO identity_profile (user_id, registration_code_id, invite_code_id, inviter_id) VALUES (?, ?, ?, ?)`).run(userId, codes.registrationCodeId, codes.inviteCodeId, codes.inviterId);
    tx.query(`INSERT INTO identity_consent (user_id, terms_version, overseas_storage, created_at) VALUES (?, ?, 1, ?)`).run(userId, termsVersion, libDate(nowMs));
}

/**
 * 第 8 步的写事务：扣码、查占用，写账号；回新账号的公开资料要的那一行。后面任何一步抛出，整个库的事务回滚，扣掉的次数一起撤销。
 */
function createAccount(tx: IdentityTx, candidate: Candidate, passwordHash: string, termsVersion: string, nowMs: number): ProfileRow {
    const codes = claimRegistration(tx, candidate, candidate.email, nowMs);
    if (typeof codes === "string") throw new IdentityFailure(codes);
    const userId = insertUserRow(tx, {username: candidate.username, displayUsername: candidate.rawUsername, name: candidate.displayName, email: candidate.email, role: "user", now: nowMs});
    insertCredentialRow(tx, {userId, passwordHash, now: nowMs});
    writeRegistrationRecords(tx, userId, codes, termsVersion, nowMs);
    const row = tx.query<ProfileRow, [number]>(`SELECT ${PROFILE_COLUMNS} FROM "user" u LEFT JOIN identity_profile p ON p.user_id = u."id" WHERE u."id" = ?`).get(userId);
    if (row === null) throw new Error("register: the new account is not readable inside its own transaction");
    return row;
}

export function registerRoute(options: RegisterOptions): (c: Context) => Promise<Response> {
    const {conn, hashLimiter, rateLimits, passwords} = options;

    return async (c) => {
        const address = options.clientAddress(c);
        if (address === null) throw new IdentityFailure("forbidden_origin");
        if (!options.registrationOpen) throw new IdentityFailure("registration_closed");
        const body = await readBody(c, RegisterRequest);
        // 合同包的 schema 已按 `inputPattern` 判过原始输入，这里只是转小写；两处是同一条规则，不会不一致。
        const username = parseUsernameInput(body.username);
        if (username === undefined) throw new IdentityFailure("validation_failed", ["username"]);
        const decision = rateLimits.register(address);
        if (!decision.ok) throw new IdentityFailure("rate_limited", [], decision.retryAfterSeconds);
        if (body.termsVersion !== options.termsVersion || !body.overseasStorage) throw new IdentityFailure("consent_required");

        const candidate: Candidate = {...registrantOf(body, username), email: body.email.toLowerCase()};

        const conflict = await conn.read((tx) => precheckRegistration(tx, candidate, candidate.email, libDate(options.clock.now())));
        if (conflict !== undefined) throw new IdentityFailure(conflict);

        let passwordHash: string;
        try {
            passwordHash = await hashLimiter.run(() => passwords.hash(body.password));
        } catch (error) {
            if (error instanceof HashOverloadedError) throw new IdentityFailure("overloaded");
            throw error;
        }

        const {profile, cookies} = await conn.withLibTransaction(options.adapter, async () => {
            const created = await conn.write((tx) => createAccount(tx, candidate, passwordHash, options.termsVersion, options.clock.now()));
            // 原样交出 `User-Agent`：换成概要在建会话的钩子里（`auth.ts`），与登录一样。
            const issued = await options.issueSession(created.id, c.req.header("User-Agent") ?? null);
            return {profile: created, cookies: issued.cookies};
        });

        appendCookies(c, cookies);
        // 注册成功之后才解：失败的注册不碰它。
        const continueUrl = body.continue === undefined ? null : await options.resolveContinue(body.continue, "login");
        const response: RegisterResponse = {user: publicProfileOf(profile), ...(continueUrl === null ? {} : {continueUrl})};
        return c.json(response);
    };
}
