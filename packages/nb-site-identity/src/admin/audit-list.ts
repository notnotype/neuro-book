/**
 * 审计列表：`GET admin/audit`（`site.admin` 输出 8 到 10；w00037 t07 计划 3.10 的“审计列表的筛选”与“审计谁能读”）。只有管理员能读；
 * 写入在 `audit.ts`，表只追加。
 *
 * 筛选：操作者（数字 id，或 `cli` 表示命令行，即操作者为空）、对象、动作，几项同时给时都要满足。对象由 `targetType` 加 `targetId`
 * 指明；只给 `targetType` 是“这一类对象的记录”，照样收；只给 `targetId` 回 `validation_failed`、`fields: ["targetType"]`：各类对象
 * 的 id 各自编号，单独一个 id 指不出是哪个对象，猜一种类型或把几类都列出来都会让管理员看错。没有 `counts`：这几项不是枚举的筛选项。
 */

import type {Context, Hono} from "hono";

import {AUDIT_CLI_ACTOR, AuditListQuery, IDENTITY_PATHS, type AuditItem, type AuditListResponse} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import {IdentityFailure, readQuery} from "../errors";
import {requireSession} from "../middleware";
import type {Sessions} from "../session";
import {readPage, sql, type Sql} from "./pagination";

export interface AuditListOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
}

interface AuditRow {
    readonly id: number;
    readonly created_at: string;
    readonly actor_id: number | null;
    readonly actor_username: string | null;
    readonly action: AuditItem["action"];
    readonly target_type: AuditItem["target"]["type"];
    readonly target_id: number;
    readonly params: string;
}

function itemOf(row: AuditRow): AuditItem {
    // 操作者引用的是 `"user"`（外键，账号又不能删），有 id 却连不到账号是库被改坏了，不悄悄当成命令行。
    if (row.actor_id !== null && row.actor_username === null) throw new Error("an audit record points at an account that does not exist");
    return {
        id: row.id,
        // 读成毫秒再写回：不是库的写法时在这里抛错（与 `publicProfileOf` 一样）。
        createdAt: libDate(libDateMs(row.created_at)),
        actor: row.actor_id === null ? null : {id: row.actor_id, username: row.actor_username!},
        // 动作与对象种类由写入函数按合同包的枚举写（`audit.ts`），参数列由表的 CHECK 保证是一个 JSON 对象。
        action: row.action,
        target: {type: row.target_type, id: row.target_id},
        params: JSON.parse(row.params) as AuditItem["params"],
    };
}

/** 查询串里的筛选项合成一个条件；都没给时是 `1`。 */
function auditWhere(query: AuditListQuery): Sql {
    if (query.targetId !== undefined && query.targetType === undefined) throw new IdentityFailure("validation_failed", ["targetType"]);
    const parts: Sql[] = [];
    if (query.actorId === AUDIT_CLI_ACTOR) parts.push(sql("a.actor_id IS NULL"));
    else if (query.actorId !== undefined) parts.push(sql("a.actor_id = ?", Number(query.actorId)));
    if (query.targetType !== undefined) parts.push(sql("a.target_type = ?", query.targetType));
    if (query.targetId !== undefined) parts.push(sql("a.target_id = ?", Number(query.targetId)));
    if (query.action !== undefined) parts.push(sql("a.action = ?", query.action));
    if (parts.length === 0) return sql("1");
    return sql(parts.map((part) => `(${part.text})`).join(" AND "), ...parts.flatMap((part) => part.params));
}

export function registerAuditListRoute(app: Hono, options: AuditListOptions): void {
    const {sessions, conn} = options;

    app.get(IDENTITY_PATHS.adminAudit, async (c: Context) => {
        await requireSession(c, sessions, `GET ${IDENTITY_PATHS.adminAudit}`, "admin");
        const query = readQuery(c, AuditListQuery);
        const where = auditWhere(query);
        const response = await conn.read((tx): AuditListResponse => {
            const page = readPage<AuditRow, "all">(
                tx,
                {
                    anchorPrefix: "a",
                    table: "identity_audit",
                    from: `identity_audit a LEFT JOIN "user" u ON u."id" = a.actor_id`,
                    idColumn: "a.id",
                    createdColumn: "a.created_at",
                    select: sql(`a.id AS id, a.created_at AS created_at, a.actor_id AS actor_id, u."username" AS actor_username, a.action AS action, a.target_type AS target_type, a.target_id AS target_id, a.params AS params`),
                    where,
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
