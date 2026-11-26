/**
 * 已给的授权：`GET me/grants`、`DELETE me/grants/:id`（`site.oauth-provider` 输出 15；w00037 t08 计划 3.9）。
 *
 * 授权是库的 `oauthConsent` 表的一行：库在确认页同意时写（`auth.api.oauth2Consent`，范围变宽时改同一行的 `scopes`），模块只读与删。
 * 存法依赖库（包说明 `AGENTS.md` 升级清单“授权的存法”一行）：`scopes` 是 JSON 数组文本，`createdAt` 是库按系统时间写的 ISO 文本，
 * 取整到秒。系统时间与模块的时钟在测试里不在一条时间线上，所以“给出的时间”不与模块的时钟比较。
 *
 * 免确认的客户端不产生授权（术语“授权”）：客户端登记之后被改成免确认的，它的旧同意记录还在，但不列出、也不能按 id 撤销，与
 * 列表一致；再改回要确认时它重新出现。
 *
 * 撤销不调库的 `delete-consent`：它只删同意记录、不撤令牌。这里在一个写事务里删同意记录，再经 `revoke.ts` 撤掉这个账号在这个
 * 客户端名下的访问令牌与没用掉的授权码（输出 8）。
 */

import type {Context, Hono} from "hono";

import {IDENTITY_PATHS, IdParams, OAUTH_SCOPES, type EmptyResponse, type GrantItem, type GrantListResponse, type OAuthScope} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import {IdentityFailure, readEmptyBody, readParams} from "../errors";
import {requireSession} from "../middleware";
import {isSessionLive, type Sessions} from "../session";
import {revokeOAuthForGrant} from "./revoke";

export interface GrantOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
}

interface GrantRow {
    readonly id: number;
    readonly clientName: string | null;
    readonly scopes: string;
    readonly createdAt: string;
}

/** 列出的与能撤销的是同一组：自己的、客户端不免确认的同意记录（`skipConsent` 是 0、1 或库没写的 NULL）。 */
const LISTED = `FROM "oauthConsent" g JOIN "oauthClient" o ON o."clientId" = g."clientId" WHERE g."userId" = ? AND COALESCE(o."skipConsent", 0) = 0`;

const KNOWN_SCOPES: ReadonlySet<string> = new Set(OAUTH_SCOPES);

/**
 * 库存的范围读成合同的数组。库只在确认时按允许的范围写（`auth.ts` 的 `scopes`），读出别的写法或别的范围是库换了存法或配置走样，
 * 程序错误：不把一个不合 `GrantItem` 的值发出去。
 */
function scopesOf(text: string): OAuthScope[] {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("a stored OAuth consent's scopes are not a JSON array");
    const scopes = new Set<OAuthScope>();
    for (const scope of parsed) {
        if (typeof scope !== "string" || !KNOWN_SCOPES.has(scope)) throw new Error("a stored OAuth consent carries a scope outside the allowed set");
        scopes.add(scope as OAuthScope);
    }
    return [...scopes];
}

function itemOf(row: GrantRow): GrantItem {
    // 登记只经管理接口，名字必填（`admin/oauth-clients.ts`）。
    if (row.clientName === null) throw new Error("an OAuth client registered by the module has no name");
    // 读成毫秒再写回：不是库的写法时在这里抛错（与客户端列表一样）。
    return {id: row.id, clientName: row.clientName, scopes: scopesOf(row.scopes), createdAt: libDate(libDateMs(row.createdAt))};
}

export function registerGrantRoutes(app: Hono, options: GrantOptions): void {
    const {sessions, conn, clock} = options;
    const itemPath = `${IDENTITY_PATHS.meGrants}/:id` as const;

    app.get(IDENTITY_PATHS.meGrants, async (c: Context) => {
        const session = await requireSession(c, sessions, `GET ${IDENTITY_PATHS.meGrants}`);
        const rows = await conn.read((tx) =>
            tx.query<GrantRow, [number]>(`SELECT g."id" AS id, o."name" AS clientName, g."scopes" AS scopes, g."createdAt" AS createdAt ${LISTED} ORDER BY g."id" DESC`).all(session.userId),
        );
        const response: GrantListResponse = {items: rows.map(itemOf)};
        return c.json(response);
    });

    // 不是自己的与不存在的同样回 `not_found`：别人的授权 id 存不存在不对外说（与结束会话一样）。
    app.delete(itemPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `DELETE ${itemPath}`);
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        await conn.write((tx) => {
            // 中间件读会话在这个事务之前，排队期间当前会话可能已被结束（与结束会话同一个理由）。
            const now = clock.now();
            if (!isSessionLive(tx, session, now)) throw new IdentityFailure("unauthenticated");
            const grant = tx.query<{clientId: string}, [number, number]>(`SELECT g."clientId" AS clientId ${LISTED} AND g."id" = ?`).get(session.userId, id);
            if (grant === null) throw new IdentityFailure("not_found");
            // 删这个账号对这个客户端的全部同意记录，不只这一行：库先查后插，两次并发的同意能各插一行，留下的那行会让下一次授权
            // 不再显示确认页（输出 15）。
            tx.query(`DELETE FROM "oauthConsent" WHERE "userId" = ? AND "clientId" = ?`).run(session.userId, grant.clientId);
            revokeOAuthForGrant(tx, session.userId, grant.clientId, now);
        });
        const response: EmptyResponse = {};
        return c.json(response);
    });
}
