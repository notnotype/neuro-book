/**
 * 自己的资料与补交同意：`GET me`、`POST me/consent`（`site.accounts` 输出 8、10；w00037 t07 计划 3.9）。`PATCH me` 在第 6 片。
 *
 * 两个都在同意门槛的放行表里（`middleware.ts` 的 `CONSENT_EXEMPT_ROUTES`）：缺同意的人要能读到自己缺同意、并补交。
 *
 * 公开资料的读法也在这里，登录与注册回的 `user` 用同一份：列从哪里来见 `publicProfileOf`。
 */

import type {Context, Hono} from "hono";

import {ConsentRequest, IDENTITY_PATHS, type MeResponse, type PublicProfile} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection, IdentityTx} from "./db/connection";
import {libDate, libDateMs} from "./db/library-rows";
import {IdentityFailure, readBody} from "./errors";
import {requireSession} from "./middleware";
import {isSessionLive, type Sessions} from "./session";

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

/** 读 `MeResponse`；账号不在时为 null。`hasPassword` 是有密码登录方式那一行且存着哈希。 */
export function readMe(tx: IdentityTx, userId: number, termsVersion: string): MeResponse | null {
    const row = tx
        .query<ProfileRow & {email: string; email_pending: number | null; has_password: number}, [number]>(
            `SELECT ${PROFILE_COLUMNS}, u."email" AS email, p.email_pending AS email_pending,
                    EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u."id" AND a."providerId" = 'credential' AND a."password" IS NOT NULL) AS has_password
             FROM "user" u LEFT JOIN identity_profile p ON p.user_id = u."id"
             WHERE u."id" = ?`,
        )
        .get(userId);
    if (row === null) return null;
    const consent = tx
        .query<{terms_version: string; overseas_storage: number}, [number]>(`SELECT terms_version, overseas_storage FROM identity_consent WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
        .get(userId);
    const emailPending = row.email_pending === 1;
    return {
        ...publicProfileOf(row),
        // 邮箱待补时存的是占位邮箱，不对外（输出 8）。
        email: emailPending ? null : row.email,
        emailPending,
        hasPassword: row.has_password === 1,
        consentRequired: consent === null || consent.terms_version !== termsVersion || consent.overseas_storage !== 1,
    };
}

export interface MeOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly termsVersion: string;
}

export function registerMeRoutes(app: Hono, options: MeOptions): void {
    const {sessions, conn, termsVersion} = options;

    app.get(IDENTITY_PATHS.me, async (c: Context) => {
        const session = await requireSession(c, sessions, `GET ${IDENTITY_PATHS.me}`);
        const me = await conn.read((tx) => readMe(tx, session.userId, termsVersion));
        if (me === null) throw new IdentityFailure("unauthenticated");
        return c.json(me);
    });

    // 补交同意（输出 10）：只收当前条款版本与对境外存放的同意，否则 `consent_required`。合格时追加一行，不改旧的：同意记录只追加。
    app.post(IDENTITY_PATHS.meConsent, async (c: Context) => {
        const session = await requireSession(c, sessions, `POST ${IDENTITY_PATHS.meConsent}`);
        const body = await readBody(c, ConsentRequest);
        if (body.termsVersion !== termsVersion || !body.overseasStorage) throw new IdentityFailure("consent_required");
        const me = await conn.write((tx) => {
            // 中间件读会话在这个事务之前，排队期间会话可能已被结束（设计审查第 5 条）。
            const now = options.clock.now();
            if (!isSessionLive(tx, session, now)) throw new IdentityFailure("unauthenticated");
            tx.query(`INSERT INTO identity_consent (user_id, terms_version, overseas_storage, created_at) VALUES (?, ?, 1, ?)`).run(session.userId, termsVersion, libDate(now));
            return readMe(tx, session.userId, termsVersion);
        });
        if (me === null) throw new IdentityFailure("unauthenticated");
        return c.json(me);
    });
}
