/**
 * 注册码的管理接口：`GET`、`POST admin/registration-codes`，`PATCH admin/registration-codes/:id`（`site.admin` 输出 7 到 10；w00037
 * t07 计划 3.10）。
 *
 * 发放与改动各是一个写事务：先复核操作者（`operator.ts`），再改表、写审计，审计与操作同时生效（输出 8）。只改备注不写审计；停用
 * 写一条 `registration_code.disable`，已停用的再停用照样成功、照样写（输出 8 的“没有变化的处置照样写”），停用时间保留第一次的。
 * 列表经 `pagination.ts`；“还能用”与注册时的扣码是同一个条件（`codes.ts`）。
 */

import type {SQLQueryBindings} from "bun:sqlite";

import type {Context, Hono} from "hono";

import {
    CreateRegistrationCodeRequest,
    IDENTITY_PATHS,
    IdParams,
    PatchRegistrationCodeRequest,
    RegistrationCodeListQuery,
    type RegistrationCodeFilter,
    type RegistrationCodeItem,
    type RegistrationCodeListResponse,
} from "@notnotype/nb-site-identity-contract";

import {appendAudit} from "../audit";
import {generateCode, usableCodeSql} from "../codes";
import type {IdentityConnection, IdentityTx} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import {IdentityFailure, readBody, readParams, readQuery} from "../errors";
import {requireSession} from "../middleware";
import type {Sessions} from "../session";
import {adminWrite} from "./operator";
import {readPage, sql, type PageSpec, type Sql} from "./pagination";

export interface RegistrationCodeAdminOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
}

interface CodeRow {
    readonly id: number;
    readonly code: string;
    readonly max_uses: number | null;
    readonly used_count: number;
    readonly expires_at: string | null;
    readonly note: string | null;
    readonly disabled_at: string | null;
    readonly created_at: string;
    readonly creator_id: number | null;
    readonly creator_username: string | null;
    readonly usable: number;
}

/** 一条注册码要的列；`usable` 的条件绑定现在的时间。 */
function codeColumns(now: string): Sql {
    return sql(
        `c.id AS id, c.code AS code, c.max_uses AS max_uses, c.used_count AS used_count, c.expires_at AS expires_at, c.note AS note,
         c.disabled_at AS disabled_at, c.created_at AS created_at, u."id" AS creator_id, u."username" AS creator_username, (${usableCodeSql("c")}) AS usable`,
        now,
    );
}

const CODE_FROM = `identity_registration_code c LEFT JOIN "user" u ON u."id" = c.created_by`;

function itemOf(row: CodeRow): RegistrationCodeItem {
    return {
        id: row.id,
        code: row.code,
        maxUses: row.max_uses,
        usedCount: row.used_count,
        // 读成毫秒再写回：不是库的写法时在这里抛错，不把一个不合 `IsoTimestamp` 的值发出去（与 `publicProfileOf` 一样）。
        expiresAt: row.expires_at === null ? null : libDate(libDateMs(row.expires_at)),
        note: row.note,
        disabled: row.disabled_at !== null,
        usable: row.usable === 1,
        createdAt: libDate(libDateMs(row.created_at)),
        createdBy: row.creator_id === null || row.creator_username === null ? null : {id: row.creator_id, username: row.creator_username},
    };
}

function readItem(tx: IdentityTx, id: number, now: string): RegistrationCodeItem | null {
    const columns = codeColumns(now);
    const row = tx.query<CodeRow, SQLQueryBindings[]>(`SELECT ${columns.text} FROM ${CODE_FROM} WHERE c.id = ?`).get(...columns.params, id);
    return row === null ? null : itemOf(row);
}

/**
 * 四个筛选项是一个划分：已停用的只算“已停用”，没停用的按还能不能用分进“可用”或“用完或过期”，所以三项之和等于“全部”。
 * 一个停用了又过期的码不在“用完或过期”里：停用是管理员的处置，比自然失效更值得单独看。
 */
function codeFilters(now: string): Record<RegistrationCodeFilter, Sql> {
    return {
        all: sql("1"),
        usable: sql(usableCodeSql("c"), now),
        exhausted_or_expired: sql(`c.disabled_at IS NULL AND NOT (${usableCodeSql("c")})`, now),
        disabled: sql("c.disabled_at IS NOT NULL"),
    };
}

/** 过期时间：合同包只限写法，这里再判是真实存在的时刻（`2026-02-30T…` 合写法却不是），存成库的写法。 */
function expiresAtOf(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || libDate(ms) !== value) throw new IdentityFailure("validation_failed", ["expiresAt"]);
    return value;
}

export function registerRegistrationCodeRoutes(app: Hono, options: RegistrationCodeAdminOptions): void {
    const {sessions, conn, clock} = options;
    const itemPath = `${IDENTITY_PATHS.adminRegistrationCodes}/:id` as const;

    app.get(IDENTITY_PATHS.adminRegistrationCodes, async (c: Context) => {
        await requireSession(c, sessions, `GET ${IDENTITY_PATHS.adminRegistrationCodes}`, "admin");
        const query = readQuery(c, RegistrationCodeListQuery);
        const response = await conn.read((tx): RegistrationCodeListResponse => {
            const now = libDate(clock.now());
            const spec: PageSpec<RegistrationCodeFilter> = {
                anchorPrefix: "rc",
                table: "identity_registration_code",
                from: CODE_FROM,
                idColumn: "c.id",
                createdColumn: "c.created_at",
                select: codeColumns(now),
                filters: codeFilters(now),
                filter: query.filter ?? "all",
            };
            const page = readPage<CodeRow, RegistrationCodeFilter>(tx, spec, query);
            return {...page, items: page.items.map(itemOf)};
        });
        return c.json(response);
    });

    app.post(IDENTITY_PATHS.adminRegistrationCodes, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${IDENTITY_PATHS.adminRegistrationCodes}`, "admin");
        const body = await readBody(c, CreateRegistrationCodeRequest);
        const expiresAt = expiresAtOf(body.expiresAt);
        const code = generateCode();
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            const now = libDate(nowMs);
            const {id} = tx
                .query<{id: number}, SQLQueryBindings[]>(`INSERT INTO identity_registration_code (code, max_uses, expires_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
                .get(code, body.maxUses, expiresAt, body.note ?? null, session.userId, now)!;
            // 参数只记可用次数与过期时间，不记码与备注（输出 8）：审计给管理员互相看，码本身是凭据。
            appendAudit(tx, {actorId: session.userId, action: "registration_code.create", targetType: "registration_code", targetId: id, params: {maxUses: body.maxUses, expiresAt}, now: nowMs});
            return readItem(tx, id, now)!;
        });
        return c.json(item);
    });

    app.patch(itemPath, async (c: Context) => {
        const session = await requireSession(c, sessions, `PATCH ${itemPath}`, "admin");
        const id = Number(readParams(c, IdParams).id);
        const body = await readBody(c, PatchRegistrationCodeRequest);
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            const now = libDate(nowMs);
            if (tx.query<{id: number}, [number]>(`SELECT id FROM identity_registration_code WHERE id = ?`).get(id) === null) throw new IdentityFailure("not_found");
            if (body.note !== undefined) tx.query(`UPDATE identity_registration_code SET note = ? WHERE id = ?`).run(body.note, id);
            if (body.disabled === true) {
                tx.query(`UPDATE identity_registration_code SET disabled_at = coalesce(disabled_at, ?) WHERE id = ?`).run(now, id);
                appendAudit(tx, {actorId: session.userId, action: "registration_code.disable", targetType: "registration_code", targetId: id, params: {}, now: nowMs});
            }
            return readItem(tx, id, now)!;
        });
        return c.json(item);
    });
}
