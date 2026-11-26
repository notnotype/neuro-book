/**
 * 改密码或给没有密码的账号设密码：`POST me/password`（`site.accounts` 输出 6、9、19、20；w00037 t07 计划 3.7 的“改密码”）。
 *
 * 先后：要会话（含同意门槛）→ 校验请求体 → 读这个账号有没有密码（有密码却没带旧密码也是字段不合格）→ 限流（按账号，字段不合格的
 * 不计入）→ 经哈希限额校验旧密码 → 经哈希限额算新哈希 → 一个写事务。
 *
 * 写事务里先复核会话还在（中间件读会话在排队之前，期间它可能被别的会话结束了；设计审查第 5 条、omp 设计审查第 9 条），再按“密码
 * 仍是刚校验的那一份”条件更新：期间被别处改了或重置了，这次回 `invalid_credentials`，不盖掉别人的改动。没有密码时插入那一行，
 * 这时已经有了（别处刚设了密码）同样回 `invalid_credentials`。最后结束这个账号除当前会话以外的全部会话（输出 6），并撤掉这个
 * 账号名下的全部对外 OAuth 令牌与授权码，当前会话里发出的也撤（`site.oauth-provider` 输出 8）。
 */

import type {Context, Hono} from "hono";

import {ChangePasswordRequest, IDENTITY_PATHS, type EmptyResponse} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection, IdentityTx} from "./db/connection";
import {insertCredentialRow, libDate} from "./db/library-rows";
import {IdentityFailure, readBody} from "./errors";
import {HashOverloadedError, type HashLimiter} from "./hash-limiter";
import type {IdentityLog} from "./index";
import {requireSession} from "./middleware";
import type {PasswordFunctions} from "./password";
import type {IdentityRateLimits} from "./rate-limit";
import {endOtherSessionsRevokingAllOAuth, isSessionLive, type Sessions} from "./session";

export interface ChangePasswordOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly hashLimiter: HashLimiter;
    readonly rateLimits: IdentityRateLimits;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "warn">;
    readonly passwords: PasswordFunctions;
}

/** 账号的密码登录方式：`rowId` 为 null 是没有那一行；`password` 为 null 是没有密码。社交关联的发起（`social/start.ts`）也用它。 */
export interface Credential {
    readonly rowId: number | null;
    readonly password: string | null;
}

export function readCredential(tx: IdentityTx, userId: number): Credential {
    const row = tx.query<{id: number; password: string | null}, [number]>(`SELECT "id", "password" FROM "account" WHERE "userId" = ? AND "providerId" = 'credential'`).get(userId);
    return row === null ? {rowId: null, password: null} : {rowId: row.id, password: row.password};
}

export function registerChangePasswordRoute(app: Hono, options: ChangePasswordOptions): void {
    const {sessions, conn, hashLimiter, rateLimits, passwords, log} = options;

    const limited = async <T>(work: () => Promise<T>): Promise<T> => {
        try {
            return await hashLimiter.run(work);
        } catch (error) {
            if (error instanceof HashOverloadedError) throw new IdentityFailure("overloaded");
            throw error;
        }
    };

    app.post(IDENTITY_PATHS.mePassword, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${IDENTITY_PATHS.mePassword}`);
        const body = await readBody(c, ChangePasswordRequest);
        const credential = await conn.read((tx) => readCredential(tx, session.userId));
        if (credential.password !== null && body.currentPassword === undefined) throw new IdentityFailure("validation_failed", ["currentPassword"]);

        const decision = rateLimits.changePassword(session.userId);
        if (!decision.ok) throw new IdentityFailure("rate_limited", [], decision.retryAfterSeconds);

        // 有密码时校验旧密码；没有密码时不看 `currentPassword`（输出 9）。
        const verified = credential.password;
        if (verified !== null) {
            const current = body.currentPassword!;
            if (!(await limited(() => passwords.verify(current, verified, {accountId: session.userId, log})))) throw new IdentityFailure("invalid_credentials");
        }
        const fresh = await limited(() => passwords.hash(body.newPassword));

        await conn.write((tx) => {
            const now = options.clock.now();
            if (!isSessionLive(tx, session, now)) throw new IdentityFailure("unauthenticated");
            if (credential.rowId !== null) {
                // `IS` 让“原来没有哈希”（null）也能按相等比较。
                const changed = tx.query(`UPDATE "account" SET "password" = ?, "updatedAt" = ? WHERE "id" = ? AND "password" IS ?`).run(fresh, libDate(now), credential.rowId, verified).changes;
                if (changed === 0) throw new IdentityFailure("invalid_credentials");
            } else {
                if (readCredential(tx, session.userId).rowId !== null) throw new IdentityFailure("invalid_credentials");
                insertCredentialRow(tx, {userId: session.userId, passwordHash: fresh, now});
            }
            endOtherSessionsRevokingAllOAuth(tx, session.userId, session.sessionId, now);
        });
        const response: EmptyResponse = {};
        return c.json(response);
    });
}
