/**
 * 自己的上游身份：`GET me/identities`、`DELETE me/identities/:id`（`site.accounts` 输出 16、24；w00037 t08 计划 3.10 的 `identities.ts`）。
 *
 * 一个上游身份是库的 `account` 表里 `providerId` 为上游名的一行，列表项的 id 就是这一行的 id；上游账号的名字与关联时间在自家的
 * `identity_upstream_name`（`upstream-name.ts`），两边按 `(providerId, accountId)` 对上。密码登录方式也是 `account` 表的一行
 * （`providerId` 为 `credential`），它的 id 不算上游身份：按 id 解绑时只认上游名的行，否则回 `not_found`。
 *
 * 解绑在一个写事务里：复核会话、确认这一行是自己的、数剩下的登录方式、删两边的行。“剩下的登录方式”必须在删的同一个事务里数：
 * 写事务排在一条队列上，两个并发的解绑（或解绑与改密码）后一个看得到前一个的结果，没有密码的账号不会被并发的两次解绑删空。
 * 上游名字与 `account` 行一起删：只删 `account` 行时留下的名字行在 1 分钟之内仍算在用，挡住同一个身份马上再关联（`claimUpstreamName`）。
 */

import type {Context, Hono} from "hono";

import {IDENTITY_PATHS, IdParams, SOCIAL_PROVIDERS, type EmptyResponse, type IdentityItem, type IdentityListResponse, type SocialProvider} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection, IdentityTx} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import {IdentityFailure, readEmptyBody, readParams} from "../errors";
import {requireSession} from "../middleware";
import {isSessionLive, type Sessions} from "../session";

export interface IdentityRoutesOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
}

/** SQL 里的上游名列表。取值是合同包的常量，不来自请求。 */
const PROVIDER_LIST = SOCIAL_PROVIDERS.map((provider) => `'${provider}'`).join(", ");

interface IdentityRow {
    readonly id: number;
    readonly provider: SocialProvider;
    readonly accountId: string;
    readonly name: string | null;
    readonly linkedAt: string | null;
}

/** 这个账号的上游身份，按关联的先后（`account` 行的 id）。 */
function readIdentities(tx: IdentityTx, userId: number): IdentityRow[] {
    return tx
        .query<IdentityRow, [number]>(
            `SELECT a."id" AS id, a."providerId" AS provider, a."accountId" AS accountId, n.name AS name, n.linked_at AS linkedAt
             FROM "account" a
                  LEFT JOIN identity_upstream_name n ON n.user_id = a."userId" AND n.provider = a."providerId" AND n.upstream_account_id = a."accountId"
             WHERE a."userId" = ? AND a."providerId" IN (${PROVIDER_LIST})
             ORDER BY a."id"`,
        )
        .all(userId);
}

function itemOf(row: IdentityRow): IdentityItem {
    // 本模块建上游身份的两条路（关联钩子、注册钩子）都先写名字、库才插 `account` 行，名字只与 `account` 行一起删。没有名字的行
    // 是别处写了库表，不把一个不合 `IdentityItem` 的值发出去。旧站导入（`docs/specs/site/legacy-import.md` 的去向表“GitHub 身份”一行）
    // 也是“别处”：它写 `account` 行时要一并写 `identity_upstream_name`，名字取旧站的 GitHub 用户名、关联时间取导入时刻，不然这个
    // 账号的身份列表整个回 500。
    if (row.name === null || row.linkedAt === null) throw new Error("an upstream identity has no recorded upstream name");
    // 读成毫秒再写回：不是模块的时间写法时在这里抛错（与会话列表一样）。
    return {id: row.id, provider: row.provider, accountName: row.name, linkedAt: libDate(libDateMs(row.linkedAt))};
}

/** 这个账号有没有密码登录方式：密码那一行存着哈希（与 `GET me` 的 `hasPassword` 同一个条件）。 */
function hasPassword(tx: IdentityTx, userId: number): boolean {
    return tx.query(`SELECT 1 FROM "account" WHERE "userId" = ? AND "providerId" = 'credential' AND "password" IS NOT NULL`).get(userId) !== null;
}

export function registerIdentityRoutes(app: Hono, options: IdentityRoutesOptions): void {
    const {sessions, conn, clock} = options;
    const itemPath = `${IDENTITY_PATHS.meIdentities}/:id` as const;

    app.get(IDENTITY_PATHS.meIdentities, async (c: Context) => {
        const session = await requireSession(c, sessions, `GET ${IDENTITY_PATHS.meIdentities}`);
        const rows = await conn.read((tx) => readIdentities(tx, session.userId));
        const response: IdentityListResponse = {items: rows.map(itemOf)};
        return c.json(response);
    });

    // 不是自己的与不存在的同样回 `not_found`：别人的身份 id 存不存在不对外说（与结束会话一样）。
    app.delete(itemPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `DELETE ${itemPath}`);
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        await conn.write((tx) => {
            // 中间件读会话在这个事务之前，排队期间当前会话可能已被结束（与结束会话同一个理由）。
            if (!isSessionLive(tx, session, clock.now())) throw new IdentityFailure("unauthenticated");
            const identities = readIdentities(tx, session.userId);
            const target = identities.find((row) => row.id === id);
            if (target === undefined) throw new IdentityFailure("not_found");
            if (identities.length < 2 && !hasPassword(tx, session.userId)) throw new IdentityFailure("last_login_method");
            tx.query(`DELETE FROM "account" WHERE "id" = ?`).run(target.id);
            tx.query(`DELETE FROM identity_upstream_name WHERE user_id = ? AND provider = ? AND upstream_account_id = ?`).run(session.userId, target.provider, target.accountId);
        });
        const response: EmptyResponse = {};
        return c.json(response);
    });
}
