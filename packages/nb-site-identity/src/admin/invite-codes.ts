/**
 * 全站的邀请码：`GET admin/invite-codes`（`site.admin` 接口表，输出 9、10；w00037 t07 计划 3.10）。只读，没有筛选项。
 *
 * 一条的列与读法与用户自己的邀请码列表是同一份（`invite-codes.ts` 的 `INVITE_CODE_COLUMNS`、`inviteCodeItemOf`），这里只多一个主人。
 * 主人为空是旧站导入时找不到主人的码（迁移里 `owner_id` 可空的理由）。
 */

import type {Context, Hono} from "hono";

import {IDENTITY_PATHS, InviteCodeListQuery, type AdminInviteCodeItem, type AdminInviteCodeListResponse} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection} from "../db/connection";
import {libDate} from "../db/library-rows";
import {readQuery} from "../errors";
import {INVITE_CODE_COLUMNS, inviteCodeItemOf, type InviteCodeRow} from "../invite-codes";
import {requireSession} from "../middleware";
import type {Sessions} from "../session";
import {readPage, sql} from "./pagination";

export interface InviteCodeAdminOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
}

interface AdminInviteCodeRow extends InviteCodeRow {
    readonly owner_id: number | null;
    readonly owner_username: string | null;
}

function itemOf(row: AdminInviteCodeRow): AdminInviteCodeItem {
    const {owner_id: ownerId, owner_username: ownerUsername, ...code} = row;
    return {...inviteCodeItemOf(code), owner: ownerId === null || ownerUsername === null ? null : {id: ownerId, username: ownerUsername}};
}

export function registerInviteCodeAdminRoutes(app: Hono, options: InviteCodeAdminOptions): void {
    const {sessions, conn, clock} = options;

    app.get(IDENTITY_PATHS.adminInviteCodes, async (c: Context) => {
        await requireSession(c, sessions, `GET ${IDENTITY_PATHS.adminInviteCodes}`, "admin");
        const query = readQuery(c, InviteCodeListQuery);
        const response = await conn.read((tx): AdminInviteCodeListResponse => {
            const page = readPage<AdminInviteCodeRow, "all">(
                tx,
                {
                    anchorPrefix: "ic",
                    table: "identity_invite_code",
                    from: `identity_invite_code c LEFT JOIN "user" o ON o."id" = c.owner_id`,
                    idColumn: "c.id",
                    createdColumn: "c.created_at",
                    select: sql(`${INVITE_CODE_COLUMNS}, o."id" AS owner_id, o."username" AS owner_username`, libDate(clock.now())),
                    filters: {all: sql("1")},
                    filter: "all",
                },
                query,
            );
            // 没有筛选项的列表不回 `counts`（合同包 `PageResponse`）。
            const {counts: _counts, ...rest} = page;
            return {...rest, items: page.items.map(itemOf)};
        });
        return c.json(response);
    });
}
