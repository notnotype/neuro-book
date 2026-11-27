/**
 * 账号的管理接口：`GET admin/users`、`GET admin/users/:id`，`POST admin/users/:id/` 下的封禁、解封、改角色、结束全部会话、重置密码
 * （`site.admin` 输出 1 到 5、8 到 10；`site.accounts` 输出 4、6 的封禁；w00037 t07 计划 3.10）。
 *
 * 每个处置是一个写事务（`operator.ts` 的 `adminWrite`）：复核操作者 → 账号存在（否则 `not_found`）→ 不是自己（封禁与改角色，
 * `self_forbidden`）→ 改字段 → 结束会话（经 `session.ts` 的 `endAllSessions`，它同一个事务里撤掉对外 OAuth 令牌与授权码）→ 写审计。审计与操作同时生效
 * （输出 8）；没有变化的处置（封已封的、改成原来的角色）照样成功、照样写，两个管理员同时封同一个人时各有一条。处置成功回账号列表
 * 的那一条（处置之后的状态），重置密码回新密码。
 *
 * 封禁只看 `user.banned`：库的 `banReason`、`banExpires` 恒为空（迁移的约定），封禁没有到期，只有解封能解除。`banExpires` 必须留空：
 * 库 1.7.27 的 admin 插件在建会话前遇到 `banExpires` 有值且已过去的账号会自己把它解封（`plugins/admin/admin.mjs`），那样封禁会在
 * 模块不知道的时候失效。登录在发会话的事务里另查 `banned`（`login.ts`），不靠库的这一道；库自己建会话的社交回调由 `session`
 * 表的触发器守（`0004_session_ban_guard.sql`）：库的查与插分两次取锁，封禁落在中间时插入被拒，封禁提交之后不留会话。
 */

import {randomBytes} from "node:crypto";

import type {SQLQueryBindings} from "bun:sqlite";

import type {Context, Hono} from "hono";

import {
    IDENTITY_PATHS,
    IdParams,
    RoleRequest,
    SOCIAL_PROVIDERS,
    UserListQuery,
    type AdminUserAction,
    type AdminUserDetail,
    type AdminUserItem,
    type ResetPasswordResponse,
    type Role,
    type SocialProvider,
    type UserFilter,
    type UserListResponse,
} from "@notnotype/nb-site-identity-contract";

import {appendAudit} from "../audit";
import type {IdentityConnection, IdentityTx} from "../db/connection";
import {insertCredentialRow, libDate, libDateMs} from "../db/library-rows";
import {IdentityFailure, readBody, readEmptyBody, readParams, readQuery} from "../errors";
import {HashOverloadedError, type HashLimiter} from "../hash-limiter";
import {appendCookies, requireSession, type RouteKey} from "../middleware";
import type {PasswordFunctions} from "../password";
import {countLiveSessions, endAllSessions, type CurrentSession, type Sessions} from "../session";
import {adminWrite} from "./operator";
import {readPage, sql, type PageSpec, type Sql} from "./pagination";

export interface UserAdminOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly hashLimiter: HashLimiter;
    readonly passwords: PasswordFunctions;
}

// ---- 重置密码的新密码 ----

/**
 * 新密码的字母表：字母与数字去掉易混的 `0`、`O`、`1`、`l`、`I`，共 57 个（计划 3.10）。管理员要把它念给或抄给本人，易混的字符
 * 会让人抄错。
 */
export const RESET_PASSWORD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** 新密码的长度：20 个字符，约 116 位（log2(57) × 20）。 */
export const RESET_PASSWORD_LENGTH = 20;

/**
 * 生成一个新密码。按字节取模会让字母表前面几个字符多出现一点，所以只收小于 57 的最大倍数（228）的字节，其余丢掉再取。
 */
export function generateResetPassword(): string {
    const size = RESET_PASSWORD_ALPHABET.length;
    const limit = Math.floor(256 / size) * size;
    let password = "";
    while (password.length < RESET_PASSWORD_LENGTH) {
        for (const byte of randomBytes(RESET_PASSWORD_LENGTH)) {
            if (byte >= limit) continue;
            password += RESET_PASSWORD_ALPHABET[byte % size];
            if (password.length === RESET_PASSWORD_LENGTH) break;
        }
    }
    return password;
}

// ---- 读 ----

/** 账号的一条要的列。表的别名：`u` 是 `"user"`，`p` 是 `identity_profile`（左连接：命令行或导入建的账号可能还没有那一行）。 */
const USER_COLUMNS = `u."id" AS id, u."username" AS username, u."name" AS name, u."email" AS email, p.email_pending AS email_pending, u."role" AS role,
    u."banned" AS banned, u."createdAt" AS created_at, p.last_login_at AS last_login_at`;

const USER_FROM = `"user" u LEFT JOIN identity_profile p ON p.user_id = u."id"`;

interface UserRow {
    readonly id: number;
    readonly username: string;
    readonly name: string;
    readonly email: string;
    readonly email_pending: number | null;
    readonly role: string;
    readonly banned: number | null;
    readonly created_at: string;
    readonly last_login_at: string | null;
}

function itemOf(row: UserRow): AdminUserItem {
    const emailPending = row.email_pending === 1;
    return {
        id: row.id,
        username: row.username,
        displayName: row.name,
        // 邮箱待补时存的是占位邮箱，不对外（输入与前置条件最后一段）。
        email: emailPending ? null : row.email,
        emailPending,
        // 角色列只会是 user 或 admin（写入它的都是本模块），别的值不当管理员，与读会话时一样。
        role: row.role === "admin" ? "admin" : "user",
        banned: row.banned === 1,
        // 读成毫秒再写回：不是库的写法时在这里抛错（与 `publicProfileOf` 一样）。
        createdAt: libDate(libDateMs(row.created_at)),
        lastLoginAt: row.last_login_at === null ? null : libDate(libDateMs(row.last_login_at)),
    };
}

function readItem(tx: IdentityTx, id: number): AdminUserItem | null {
    const row = tx.query<UserRow, [number]>(`SELECT ${USER_COLUMNS} FROM ${USER_FROM} WHERE u."id" = ?`).get(id);
    return row === null ? null : itemOf(row);
}

const USER_FILTER_CONDITIONS: Readonly<Record<UserFilter, Sql>> = {
    all: sql("1"),
    admin: sql(`u."role" = 'admin'`),
    banned: sql(`u."banned" = 1`),
    email_pending: sql("p.email_pending = 1"),
};

/** `LIKE … ESCAPE '\'` 里按字面匹配：先转义反斜杠本身，再转义两个通配符。 */
function likeLiteral(text: string): string {
    return text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * 搜索 `q`：用户名、显示名、邮箱的前缀（计划 3.10）。SQLite 的 `LIKE` 只对 ASCII 字母不分大小写：用户名与邮箱只有 ASCII、存的是
 * 小写，输入的大小写不影响；显示名里的非 ASCII 字母区分大小写（`site.admin` 输入与前置条件这样写；另存一列转小写的显示名要动库的
 * 表，只为管理搜索里少数显示名，实现审查第 6 到 8 片第 2 条）。邮箱待补的账号不按邮箱匹配：存的是占位邮箱，不是这个人的（`u12@placeholder.invalid` 搜 `u12@` 不该搜到它）。
 */
function searchCondition(q: string | undefined): Sql | undefined {
    if (q === undefined || q === "") return undefined;
    const prefix = `${likeLiteral(q)}%`;
    return sql(
        `u."username" LIKE ? ESCAPE '\\' OR u."name" LIKE ? ESCAPE '\\' OR (coalesce(p.email_pending, 0) = 0 AND u."email" LIKE ? ESCAPE '\\')`,
        prefix,
        prefix,
        prefix,
    );
}

/**
 * 详情另要的几样：头像、网站、签名；有没有密码；关联了哪些上游（`account` 里 `providerId` 不是 `credential` 的行，本 Task 恒为空，
 * t08 写入）；未到期的会话数；注册时用的码与邀请人（`identity_profile` 记的，邀请人是邀请码的主人，注册时写下）。
 */
function readDetail(tx: IdentityTx, id: number, nowMs: number): AdminUserDetail | null {
    const row = tx
        .query<
            UserRow & {
                image: string | null;
                website: string | null;
                bio: string | null;
                has_password: number;
                code_id: number | null;
                code: string | null;
                inviter_id: number | null;
                inviter_username: string | null;
            },
            [number]
        >(
            `SELECT ${USER_COLUMNS}, u."image" AS image, p.website AS website, p.bio AS bio,
                    EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u."id" AND a."providerId" = 'credential' AND a."password" IS NOT NULL) AS has_password,
                    rc.id AS code_id, rc.code AS code, inviter."id" AS inviter_id, inviter."username" AS inviter_username
             FROM ${USER_FROM}
                  LEFT JOIN identity_registration_code rc ON rc.id = p.registration_code_id
                  LEFT JOIN "user" inviter ON inviter."id" = p.inviter_id
             WHERE u."id" = ?`,
        )
        .get(id);
    if (row === null) return null;
    const providerIds = tx.query<{providerId: string}, [number]>(`SELECT DISTINCT "providerId" FROM "account" WHERE "userId" = ? AND "providerId" <> 'credential' ORDER BY "providerId"`).all(id);
    // 只列合同里有的上游：别的写法（库的数据被别处写过）不发出去，合同的枚举容不下它。
    const providers = providerIds.map((entry) => entry.providerId).filter((name): name is SocialProvider => (SOCIAL_PROVIDERS as readonly string[]).includes(name));
    return {
        ...itemOf(row),
        avatarUrl: row.image,
        website: row.website,
        bio: row.bio,
        hasPassword: row.has_password === 1,
        providers,
        sessionCount: countLiveSessions(tx, id, nowMs),
        registrationCode: row.code_id === null || row.code === null ? null : {id: row.code_id, code: row.code},
        inviter: row.inviter_id === null || row.inviter_username === null ? null : {id: row.inviter_id, username: row.inviter_username},
    };
}

// ---- 处置 ----

/** 处置的对象：账号存在，否则 `not_found`；回它现在的角色与封禁。 */
function requireTarget(tx: IdentityTx, id: number): {readonly role: Role; readonly banned: boolean} {
    const row = tx.query<{role: string; banned: number | null}, [number]>(`SELECT "role" AS role, "banned" AS banned FROM "user" WHERE "id" = ?`).get(id);
    if (row === null) throw new IdentityFailure("not_found");
    return {role: row.role === "admin" ? "admin" : "user", banned: row.banned === 1};
}

/** 封禁与改角色不能对自己（输出 5）；结束会话与重置密码可以。 */
function forbidSelf(session: CurrentSession, id: number): void {
    if (session.userId === id) throw new IdentityFailure("self_forbidden");
}

/** 库的 `updatedAt` 跟着改，与库自己改账号时一样（`db/library-rows.ts` 的存法）。 */
function setUserColumn(tx: IdentityTx, id: number, column: '"banned"' | '"role"', value: SQLQueryBindings, nowMs: number): void {
    tx.query(`UPDATE "user" SET ${column} = ?, "updatedAt" = ? WHERE "id" = ?`).run(value, libDate(nowMs), id);
}

export function registerUserAdminRoutes(app: Hono, options: UserAdminOptions): void {
    const {sessions, conn, clock, hashLimiter, passwords} = options;
    const itemPath = `${IDENTITY_PATHS.adminUsers}/:id` as const;
    const actionRoute = (action: AdminUserAction): RouteKey => `POST ${itemPath}/${action}`;

    app.get(IDENTITY_PATHS.adminUsers, async (c: Context) => {
        await requireSession(c, sessions, `GET ${IDENTITY_PATHS.adminUsers}`, "admin");
        const query = readQuery(c, UserListQuery);
        const response = await conn.read((tx): UserListResponse => {
            const where = searchCondition(query.q);
            const spec: PageSpec<UserFilter> = {
                anchorPrefix: "u",
                table: `"user"`,
                from: USER_FROM,
                idColumn: `u."id"`,
                createdColumn: `u."createdAt"`,
                select: sql(USER_COLUMNS),
                ...(where === undefined ? {} : {where}),
                filters: USER_FILTER_CONDITIONS,
                filter: query.filter ?? "all",
            };
            const page = readPage<UserRow, UserFilter>(tx, spec, query);
            return {...page, items: page.items.map(itemOf)};
        });
        return c.json(response);
    });

    app.get(itemPath, async (c: Context) => {
        await requireSession(c, sessions, `GET ${itemPath}`, "admin");
        const id = Number(readParams(c, IdParams).id);
        const detail = await conn.read((tx) => readDetail(tx, id, clock.now()));
        if (detail === null) throw new IdentityFailure("not_found");
        return c.json(detail);
    });

    // 封禁（输出 2）：已有会话全部结束（`site.accounts` 输出 6），之后登录得 `account_banned`（`login.ts` 在发会话的事务里复核）。
    app.post(`${itemPath}/ban`, async (c: Context) => {
        const session = await requireSession(c, sessions, actionRoute("ban"), "admin");
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            requireTarget(tx, id);
            forbidSelf(session, id);
            setUserColumn(tx, id, '"banned"', 1, nowMs);
            endAllSessions(tx, id, nowMs);
            appendAudit(tx, {actorId: session.userId, action: "user.ban", targetType: "user", targetId: id, params: {}, now: nowMs});
            return readItem(tx, id)!;
        });
        return c.json(item);
    });

    // 解封（输出 2）：之后可以重新登录；会话在封禁时已删掉，不恢复。对自己也照收：操作者能走到这里就没被封，结果是没有变化的处置。
    app.post(`${itemPath}/unban`, async (c: Context) => {
        const session = await requireSession(c, sessions, actionRoute("unban"), "admin");
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            requireTarget(tx, id);
            setUserColumn(tx, id, '"banned"', 0, nowMs);
            appendAudit(tx, {actorId: session.userId, action: "user.unban", targetType: "user", targetId: id, params: {}, now: nowMs});
            return readItem(tx, id)!;
        });
        return c.json(item);
    });

    // 改角色（输出 3）：角色真的变了才结束会话；改成原来的角色不碰会话，照样写审计。
    app.post(`${itemPath}/role`, async (c: Context) => {
        const session = await requireSession(c, sessions, actionRoute("role"), "admin");
        const id = Number(readParams(c, IdParams).id);
        const {role} = await readBody(c, RoleRequest);
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            const target = requireTarget(tx, id);
            forbidSelf(session, id);
            if (target.role !== role) {
                setUserColumn(tx, id, '"role"', role, nowMs);
                endAllSessions(tx, id, nowMs);
            }
            appendAudit(tx, {actorId: session.userId, action: "user.role", targetType: "user", targetId: id, params: {from: target.role, to: role}, now: nowMs});
            return readItem(tx, id)!;
        });
        return c.json(item);
    });

    // 结束全部会话：对自己也可以，当前会话一起结束，响应带清除 Cookie（与登出一样）。参数记结束的条数（输出 8）。
    app.post(`${itemPath}/revoke-sessions`, async (c: Context) => {
        const session = await requireSession(c, sessions, actionRoute("revoke-sessions"), "admin");
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        const item = await adminWrite(conn, clock, session, (tx, nowMs) => {
            requireTarget(tx, id);
            // 条数只数没到期的，与详情的 `sessionCount` 同一个口径；到期的行照样删（`countLiveSessions`）。
            const count = countLiveSessions(tx, id, nowMs);
            endAllSessions(tx, id, nowMs);
            appendAudit(tx, {actorId: session.userId, action: "user.revoke_sessions", targetType: "user", targetId: id, params: {count}, now: nowMs});
            return readItem(tx, id)!;
        });
        if (id === session.userId) appendCookies(c, await sessions.clearCookie());
        return c.json(item);
    });

    // 重置密码（输出 4）：新哈希在事务外经哈希限额算（`site.accounts` 输出 20，过载回 `overloaded`）；事务里写密码那一行（没有就插入）、
    // 结束全部会话。新密码只出现在这个响应里：不进审计参数，也不进任何一行日志。对自己也可以，同结束会话。
    app.post(`${itemPath}/reset-password`, async (c: Context) => {
        const session = await requireSession(c, sessions, actionRoute("reset-password"), "admin");
        const id = Number(readParams(c, IdParams).id);
        await readEmptyBody(c);
        const password = generateResetPassword();
        let passwordHash: string;
        try {
            passwordHash = await hashLimiter.run(() => passwords.hash(password));
        } catch (error) {
            if (error instanceof HashOverloadedError) throw new IdentityFailure("overloaded");
            throw error;
        }
        await adminWrite(conn, clock, session, (tx, nowMs) => {
            requireTarget(tx, id);
            const updated = tx.query(`UPDATE "account" SET "password" = ?, "updatedAt" = ? WHERE "userId" = ? AND "providerId" = 'credential'`).run(passwordHash, libDate(nowMs), id);
            if (updated.changes === 0) insertCredentialRow(tx, {userId: id, passwordHash, now: nowMs});
            endAllSessions(tx, id, nowMs);
            appendAudit(tx, {actorId: session.userId, action: "user.reset_password", targetType: "user", targetId: id, params: {}, now: nowMs});
        });
        if (id === session.userId) appendCookies(c, await sessions.clearCookie());
        const response: ResetPasswordResponse = {password};
        return c.json(response);
    });
}
