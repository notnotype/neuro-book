/**
 * 自己的邀请码：`GET`、`POST me/invite-codes`，`PATCH me/invite-codes/:id`（`site.accounts` 输出 18；w00037 t07 计划 3.9）。
 *
 * 码的生成与“还能用”的条件与注册码共用 `codes.ts`。生成在一个写事务里先数自己还能用的码、再插入：数与插入之间没有别的写入
 * 插得进来，并发的两个生成不会一起越过上限（写事务排在模块的单一连接上，`db/connection.ts`）。停用只设停用时间，已停用的再停用
 * 照样成功，停用时间保留第一次的。邀请码的操作不写审计：`site.admin` 输出 8 的动作表里没有它们。
 *
 * 生成的先后：要会话（含同意门槛）→ 请求体只能为空 → 按账号限流（输出 19，字段不合格的不计入）→ 写事务里复核会话、数上限、插入。
 * 限流在上限之前判、每次过了限流的尝试都计入，所以因已有 10 个有效码而回 `invite_code_limit` 的那次也算一次；停用了再生成同样计，
 * 只数“同时有效”挡不住生成、停用的循环（实现审查第 6 到 8 片第 4 条）。
 */

import type {Context, Hono} from "hono";

import {INVITE_CODE_ACTIVE_LIMIT, IDENTITY_PATHS, IdParams, PatchInviteCodeRequest, type InviteCodeItem, type InviteCodeListResponse} from "@notnotype/nb-site-identity-contract";

import {generateCode, usableCodeSql} from "./codes";
import type {IdentityConnection, IdentityTx} from "./db/connection";
import {libDate, libDateMs} from "./db/library-rows";
import {IdentityFailure, readBody, readEmptyBody, readParams} from "./errors";
import {requireSession} from "./middleware";
import type {IdentityRateLimits} from "./rate-limit";
import {isSessionLive, type Sessions} from "./session";

export interface InviteCodeOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly rateLimits: Pick<IdentityRateLimits, "generateInviteCode">;
}

export interface InviteCodeRow {
    readonly id: number;
    readonly code: string;
    readonly created_at: string;
    readonly used_count: number;
    readonly max_uses: number | null;
    readonly expires_at: string | null;
    readonly usable: number;
}

/** 一条邀请码要的列（表的别名是 `c`）；`usable` 的条件里有一个 `?`，绑定现在的时间。管理端的全站列表（`admin/invite-codes.ts`）用同一份。 */
export const INVITE_CODE_COLUMNS = `c.id AS id, c.code AS code, c.created_at AS created_at, c.used_count AS used_count, c.max_uses AS max_uses, c.expires_at AS expires_at, (${usableCodeSql("c")}) AS usable`;

export function inviteCodeItemOf(row: InviteCodeRow): InviteCodeItem {
    return {
        id: row.id,
        code: row.code,
        // 读成毫秒再写回：不是库的写法时在这里抛错，不把一个不合 `IsoTimestamp` 的值发出去（与 `publicProfileOf` 一样）。
        createdAt: libDate(libDateMs(row.created_at)),
        usedCount: row.used_count,
        maxUses: row.max_uses,
        expiresAt: row.expires_at === null ? null : libDate(libDateMs(row.expires_at)),
        usable: row.usable === 1,
    };
}

/** 读自己的一个码；不是自己的或不存在时为 null。 */
function readOwnItem(tx: IdentityTx, userId: number, id: number, now: string): InviteCodeItem | null {
    const row = tx.query<InviteCodeRow, [string, number, number]>(`SELECT ${INVITE_CODE_COLUMNS} FROM identity_invite_code c WHERE c.id = ? AND c.owner_id = ?`).get(now, id, userId);
    return row === null ? null : inviteCodeItemOf(row);
}

export function registerInviteCodeRoutes(app: Hono, options: InviteCodeOptions): void {
    const {sessions, conn, clock, rateLimits} = options;
    const itemPath = `${IDENTITY_PATHS.meInviteCodes}/:id` as const;

    // 列表是自己的全部码，含停用、过期与用完的。输出 18 没有分页：生成按账号每小时至多 10 次（输出 19），一个人的码增长有上限。
    app.get(IDENTITY_PATHS.meInviteCodes, async (c: Context) => {
        const session = await requireSession(c, sessions, `GET ${IDENTITY_PATHS.meInviteCodes}`);
        const items = await conn.read((tx) =>
            tx
                .query<InviteCodeRow, [string, number]>(`SELECT ${INVITE_CODE_COLUMNS} FROM identity_invite_code c WHERE c.owner_id = ? ORDER BY c.created_at DESC, c.id DESC`)
                .all(libDate(clock.now()), session.userId)
                .map(inviteCodeItemOf),
        );
        const response: InviteCodeListResponse = {items};
        return c.json(response);
    });

    app.post(IDENTITY_PATHS.meInviteCodes, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${IDENTITY_PATHS.meInviteCodes}`);
        await readEmptyBody(c);
        const decision = rateLimits.generateInviteCode(session.userId);
        if (!decision.ok) throw new IdentityFailure("rate_limited", [], decision.retryAfterSeconds);
        const code = generateCode();
        const item = await conn.write((tx) => {
            const nowMs = clock.now();
            // 中间件读会话在这个事务之前，排队期间当前会话可能已被结束（设计审查第 5 条）。
            if (!isSessionLive(tx, session, nowMs)) throw new IdentityFailure("unauthenticated");
            const now = libDate(nowMs);
            // 上限数的是还能用的码（输出 18 的“同时有效”）：停用、过期、用完的不占名额。
            const {usable} = tx.query<{usable: number}, [string, number]>(`SELECT count(*) AS usable FROM identity_invite_code c WHERE ${usableCodeSql("c")} AND c.owner_id = ?`).get(now, session.userId)!;
            if (usable >= INVITE_CODE_ACTIVE_LIMIT) throw new IdentityFailure("invite_code_limit");
            // 新码不限次数、不过期（输出 18）：`max_uses`、`expires_at` 留空。
            const {id} = tx.query<{id: number}, [string, number, string]>(`INSERT INTO identity_invite_code (code, owner_id, created_at) VALUES (?, ?, ?) RETURNING id`).get(code, session.userId, now)!;
            return readOwnItem(tx, session.userId, id, now)!;
        });
        return c.json(item);
    });

    // 只能停用（合同只收 `{disabled: true}`）。不是自己的与不存在的同样回 `not_found`：别人的码 id 存不存在不对外说。
    app.patch(itemPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `PATCH ${itemPath}`);
        const id = Number(readParams(c, IdParams).id);
        await readBody(c, PatchInviteCodeRequest);
        const item = await conn.write((tx) => {
            const nowMs = clock.now();
            if (!isSessionLive(tx, session, nowMs)) throw new IdentityFailure("unauthenticated");
            const now = libDate(nowMs);
            const changed = tx.query(`UPDATE identity_invite_code SET disabled_at = coalesce(disabled_at, ?) WHERE id = ? AND owner_id = ?`).run(now, id, session.userId).changes;
            if (changed === 0) throw new IdentityFailure("not_found");
            return readOwnItem(tx, session.userId, id, now)!;
        });
        return c.json(item);
    });
}
