/**
 * 自己的资料与补交同意：`GET me`、`PATCH me`、`POST me/consent`（`site.accounts` 输出 8、10；w00037 t07 计划 3.9）。
 *
 * `GET me` 与 `POST me/consent` 在同意门槛的放行表里（`middleware.ts` 的 `CONSENT_EXEMPT_ROUTES`）：缺同意的人要能读到自己缺同意、
 * 并补交。`PATCH me` 不在：缺同意时不能改资料，只能补交（输出 10 的放行表只有 `GET me`）。
 *
 * 公开资料的读法也在这里，登录与注册回的 `user` 用同一份：列从哪里来见 `publicProfileOf`。
 */

import type {Context, Hono} from "hono";

import {ConsentRequest, IDENTITY_PATHS, isWebUrl, PatchMeRequest, type ConsentResponse, type MeResponse, type PublicProfile} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection, IdentityTx} from "./db/connection";
import {libDate, libDateMs} from "./db/library-rows";
import {IdentityFailure, readBody} from "./errors";
import {requireSession} from "./middleware";
import type {ContinueResolver} from "./oauth/continue";
import {consentRequiredIn, isSessionLive, type Sessions} from "./session";

/**
 * 公开资料要的列。表的别名约定：`u` 是 `"user"`，`p` 是 `identity_profile`（左连接：命令行或导入建的账号可能还没有那一行）。
 */
export const PROFILE_COLUMNS = `u."id" AS id, u."username" AS username, u."name" AS name, u."image" AS image, u."role" AS role, u."createdAt" AS created_at, p.website AS website, p.bio AS bio`;

export interface ProfileRow {
    readonly id: number;
    readonly username: string;
    readonly name: string;
    readonly image: string | null;
    readonly role: string;
    readonly created_at: string;
    readonly website: string | null;
    readonly bio: string | null;
}

/**
 * 库的列到公开资料（术语“公开资料”）：显示名是库的 `name`，头像是库的 `image`；网站与签名在模块自己的表里。角色列只会是 user 或
 * admin（写入它的都是本模块），别的值不当管理员，与 `session.ts` 读会话时一样。
 */
export function publicProfileOf(row: ProfileRow): PublicProfile {
    return {
        id: row.id,
        username: row.username,
        displayName: row.name,
        avatarUrl: row.image,
        website: row.website,
        bio: row.bio,
        role: row.role === "admin" ? "admin" : "user",
        // 读成毫秒再写回：不是库的写法时在这里抛错，不把一个不合 `IsoTimestamp` 的值发出去。
        createdAt: libDate(libDateMs(row.created_at)),
    };
}

/**
 * 读 `MeResponse`；账号不在时为 null。`hasPassword` 是有密码登录方式那一行且存着哈希。`consentRequired` 由调用方给：`GET me` 用门槛
 * 已经判过的那个值，`POST me/consent` 在自己的写事务里用 `consentRequiredIn` 重判。
 */
export function readMe(tx: IdentityTx, userId: number, consentRequired: boolean): MeResponse | null {
    const row = tx
        .query<ProfileRow & {email: string; email_pending: number | null; has_password: number}, [number]>(
            `SELECT ${PROFILE_COLUMNS}, u."email" AS email, p.email_pending AS email_pending,
                    EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u."id" AND a."providerId" = 'credential' AND a."password" IS NOT NULL) AS has_password
             FROM "user" u LEFT JOIN identity_profile p ON p.user_id = u."id"
             WHERE u."id" = ?`,
        )
        .get(userId);
    if (row === null) return null;
    const emailPending = row.email_pending === 1;
    return {
        ...publicProfileOf(row),
        // 邮箱待补时存的是占位邮箱，不对外（输出 8）。
        email: emailPending ? null : row.email,
        emailPending,
        hasPassword: row.has_password === 1,
        consentRequired,
    };
}

/**
 * `PATCH me` 在写事务里的改动：只改请求里给了的字段。邮箱转小写后查占用：别的账号用着回 `email_taken`，改成自己现在的邮箱照常
 * 成功。占用在同一个写事务里先查后写，不靠 `user.email` 的唯一约束报错（与注册一样：撞到约束是 500，说明先查后写有漏洞）。
 * 给了邮箱就清掉“邮箱待补”：之后能用这个邮箱登录（`login.ts` 按邮箱找时排除待补的账号）。库的 `updatedAt` 跟着改，与库自己
 * 改账号时一样（`db/library-rows.ts` 的存法）。补充资料那一行可能还没有（命令行建的账号），先补一行空的再改。
 */
function updateProfile(tx: IdentityTx, userId: number, body: PatchMeRequest, nowMs: number): void {
    const email = body.email?.toLowerCase();
    if (email !== undefined && tx.query<{id: number}, [string, number]>(`SELECT "id" FROM "user" WHERE "email" = ? AND "id" <> ?`).get(email, userId) !== null) {
        throw new IdentityFailure("email_taken");
    }
    const userColumns: [column: string, value: string | null][] = [];
    if (body.displayName !== undefined) userColumns.push(['"name"', body.displayName]);
    if (body.avatarUrl !== undefined) userColumns.push(['"image"', body.avatarUrl]);
    if (email !== undefined) userColumns.push(['"email"', email]);
    if (userColumns.length > 0) {
        const assignments = userColumns.map(([column]) => `${column} = ?`).join(", ");
        tx.query(`UPDATE "user" SET ${assignments}, "updatedAt" = ? WHERE "id" = ?`).run(...userColumns.map(([, value]) => value), libDate(nowMs), userId);
    }
    const profileColumns: [column: string, value: string | number | null][] = [];
    if (body.website !== undefined) profileColumns.push(["website", body.website]);
    if (body.bio !== undefined) profileColumns.push(["bio", body.bio]);
    if (email !== undefined) profileColumns.push(["email_pending", 0]);
    if (profileColumns.length > 0) {
        tx.query(`INSERT INTO identity_profile (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING`).run(userId);
        const assignments = profileColumns.map(([column]) => `${column} = ?`).join(", ");
        tx.query(`UPDATE identity_profile SET ${assignments} WHERE user_id = ?`).run(...profileColumns.map(([, value]) => value), userId);
    }
}

export interface MeOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly termsVersion: string;
    /** 补交同意时解站点同意页带来的续接令牌（`oauth/continue.ts`）。 */
    readonly resolveContinue: ContinueResolver;
}

export function registerMeRoutes(app: Hono, options: MeOptions): void {
    const {sessions, conn, termsVersion} = options;

    app.get(IDENTITY_PATHS.me, async (c: Context) => {
        const session = await requireSession(c, sessions, `GET ${IDENTITY_PATHS.me}`);
        // 缺不缺同意取门槛读会话时查到的那个值，不再查一遍：同一个请求里两次读之间的差别没有意义，回答与门槛也就不会不一致。
        const me = await conn.read((tx) => readMe(tx, session.userId, session.consentRequired));
        if (me === null) throw new IdentityFailure("unauthenticated");
        return c.json(me);
    });

    // 改资料（输出 8）。显示名、头像在库的 `user` 表（`name`、`image`），网站、签名在 `identity_profile`；邮箱在 `user.email`。
    app.patch(IDENTITY_PATHS.me, async (c: Context) => {
        const session = await requireSession(c, sessions, `PATCH ${IDENTITY_PATHS.me}`);
        const body = await readBody(c, PatchMeRequest);
        // schema 只管长度与协议开头，能不能解析成 http、https 地址另判（合同包 `isWebUrl`）。null 是清空，不判。
        const badUrls = (["avatarUrl", "website"] as const).filter((key) => typeof body[key] === "string" && !isWebUrl(body[key]));
        if (badUrls.length > 0) throw new IdentityFailure("validation_failed", badUrls);
        const me = await conn.write((tx) => {
            const now = options.clock.now();
            // 与补交同意一样：中间件读会话在这个事务之前，排队期间会话可能已被结束（设计审查第 5 条）。
            if (!isSessionLive(tx, session, now)) throw new IdentityFailure("unauthenticated");
            updateProfile(tx, session.userId, body, now);
            // 能走到这里就过了同意门槛：`consentRequired` 是门槛读到的 false。
            return readMe(tx, session.userId, session.consentRequired);
        });
        if (me === null) throw new IdentityFailure("unauthenticated");
        return c.json(me);
    });

    // 补交同意（输出 10）：只收当前条款版本与对境外存放的同意，否则 `consent_required`。合格时追加一行，不改旧的：同意记录只追加。
    // 请求带了续接令牌时在写入之后解，合格时响应带继续地址（`site.oauth-provider` 输出 12）：按 `consent` 解，补交同意不是重新
    // 登录，`prompt=login` 与 `max_age` 留着。
    app.post(IDENTITY_PATHS.meConsent, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${IDENTITY_PATHS.meConsent}`);
        const body = await readBody(c, ConsentRequest);
        if (body.termsVersion !== termsVersion || !body.overseasStorage) throw new IdentityFailure("consent_required");
        const me = await conn.write((tx) => {
            // 中间件读会话在这个事务之前，排队期间会话可能已被结束（设计审查第 5 条）。
            const now = options.clock.now();
            if (!isSessionLive(tx, session, now)) throw new IdentityFailure("unauthenticated");
            tx.query(`INSERT INTO identity_consent (user_id, terms_version, overseas_storage, created_at) VALUES (?, ?, 1, ?)`).run(session.userId, termsVersion, libDate(now));
            return readMe(tx, session.userId, consentRequiredIn(tx, session.userId, termsVersion));
        });
        if (me === null) throw new IdentityFailure("unauthenticated");
        const continueUrl = body.continue === undefined ? null : await options.resolveContinue(body.continue, "consent");
        const response: ConsentResponse = {...me, ...(continueUrl === null ? {} : {continueUrl})};
        return c.json(response);
    });
}
