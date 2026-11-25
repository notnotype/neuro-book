/**
 * 自己的会话：`GET me/sessions`、`DELETE me/sessions/:id`（`site.accounts` 输出 17；w00037 t07 计划 3.9 的“会话列表”）。
 *
 * 读的是库的 `session` 表：建立时间是 `createdAt`，最后使用时间是 `updatedAt`（要会话的接口每小时至多更新一次，所以精确到一小时以内，
 * `Sessions.maintain`），浏览器标识的概要是 `userAgent` 列里的 JSON（建会话前的钩子写的，`user-agent.ts`）。结束会话经
 * `session.ts` 的 `endSession`：删会话只在那一组函数里（架构用例守着），它同时撤掉在那次会话里发出的对外 OAuth 令牌与
 * 授权码（`site.oauth-provider` 输出 8）。
 */

import type {Context, Hono} from "hono";

import {IDENTITY_PATHS, IdParams, type EmptyResponse, type SessionItem, type SessionListResponse} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection} from "./db/connection";
import {libDate, libDateMs} from "./db/library-rows";
import {IdentityFailure, readEmptyBody, readParams} from "./errors";
import type {IdentityLog} from "./index";
import {appendCookies, requireSession} from "./middleware";
import {endSession, isSessionLive, type Sessions} from "./session";
import {readStoredUserAgent} from "./user-agent";

export interface MySessionsOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "warn">;
}

interface SessionRow {
    readonly id: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly userAgent: string | null;
}

export function registerMySessionRoutes(app: Hono, options: MySessionsOptions): void {
    const {sessions, conn, clock, log} = options;
    const itemPath = `${IDENTITY_PATHS.meSessions}/:id` as const;

    app.get(IDENTITY_PATHS.meSessions, async (c: Context) => {
        const session = await requireSession(c, sessions, `GET ${IDENTITY_PATHS.meSessions}`);
        const rows = await conn.read((tx) =>
            tx
                .query<SessionRow, [number, string]>(`SELECT "id" AS id, "createdAt", "updatedAt", "userAgent" FROM "session" WHERE "userId" = ? AND "expiresAt" > ? ORDER BY "createdAt" DESC, "id" DESC`)
                .all(session.userId, libDate(clock.now())),
        );
        let unreadable = 0;
        const items = rows.map((row): SessionItem => {
            const {summary, readable} = readStoredUserAgent(row.userAgent);
            if (!readable) unreadable += 1;
            return {
                id: row.id,
                // 读成毫秒再写回：不是库的写法时在这里抛错，不把一个不合 `IsoTimestamp` 的值发出去（与 `publicProfileOf` 一样）。
                createdAt: libDate(libDateMs(row.createdAt)),
                lastUsedAt: libDate(libDateMs(row.updatedAt)),
                browser: summary.browser,
                os: summary.os,
                current: row.id === session.sessionId,
            };
        });
        // 列里的值不是概要的写法：回答里照样给 null（不把别的写法发出去），记一行诊断查是谁绕过了建会话的钩子。只记条数，不记值。
        if (unreadable > 0) log.warn("identity.session_agent_unreadable", "a session's stored browser summary is not in the expected form", {count: unreadable});
        const response: SessionListResponse = {items};
        return c.json(response);
    });

    // 结束自己的一个会话。不是自己的与不存在的同样回 `not_found`：别人的会话 id 存不存在不对外说。到期了还没被清理的行也算自己的，
    // 照样删（列表里已经不显示它，删掉与清理任务做的是同一件事）。结束的是当前会话时带清除 Cookie 的 `Set-Cookie`，与登出一样。
    app.delete(itemPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `DELETE ${itemPath}`);
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        await conn.write((tx) => {
            // 中间件读会话在这个事务之前，排队期间当前会话可能已被结束（设计审查第 5 条）。
            const now = clock.now();
            if (!isSessionLive(tx, session, now)) throw new IdentityFailure("unauthenticated");
            const owned = tx.query<{id: number}, [number, number]>(`SELECT "id" AS id FROM "session" WHERE "id" = ? AND "userId" = ?`).get(id, session.userId);
            if (owned === null) throw new IdentityFailure("not_found");
            endSession(tx, id, now);
        });
        if (id === session.sessionId) appendCookies(c, await sessions.clearCookie());
        const response: EmptyResponse = {};
        return c.json(response);
    });
}
