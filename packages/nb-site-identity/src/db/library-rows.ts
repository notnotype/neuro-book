/**
 * 模块用自己的 SQL 写库的表（`user`、`account`、`session`）时的存法。库 1.7.27 经 Kysely 的 SQLite 方言写这几张表：时间是
 * `Date.toISOString()` 的文本（到毫秒、UTC、带 `Z`），布尔是 0 与 1，id 由表的 AUTOINCREMENT 发号。模块写的行要与库自己写的
 * 逐列一样，库读回来才不会出错：`library-rows.test.ts` 的存法契约用例（包说明 `AGENTS.md` 升级清单“存法”一行）把同一份账号
 * 分别经库与经这里写入，逐列比原始行，再经库读回。
 *
 * 这里的函数都在调用方的写事务里执行（`IdentityConnection.write` 的回调），参数 `tx` 就是那个回调拿到的连接。
 */

import type {Database} from "bun:sqlite";

/** 库存时间的写法。 */
export function libDate(ms: number): string {
    return new Date(ms).toISOString();
}

/** 库的时间列读成毫秒；不是库的写法时抛错（数据被别的写法改过，是程序错误）。 */
export function libDateMs(text: string): number {
    const ms = Date.parse(text);
    if (!Number.isFinite(ms) || libDate(ms) !== text) throw new Error("a library date column is not in the library's ISO format");
    return ms;
}

export interface NewUserRow {
    /** 小写的登录名。 */
    readonly username: string;
    /** 原样的写法（只存不对外）。 */
    readonly displayUsername: string;
    /** 显示名。 */
    readonly name: string;
    /** 小写的邮箱，或占位邮箱。 */
    readonly email: string;
    readonly role: "user" | "admin";
    readonly now: number;
}

/**
 * 插入一个账号，回它的 id。库的列照库建账号时写的：`emailVerified` 0、`image` 空、`banned` 0、`banReason` 与 `banExpires` 空
 * （`admin` 插件建账号时把 `banned` 写成 0、`role` 写成 `user`）。
 */
export function insertUserRow(tx: Database, row: NewUserRow): number {
    const at = libDate(row.now);
    const result = tx
        .query(
            `INSERT INTO "user" ("name", "email", "emailVerified", "image", "createdAt", "updatedAt", "username", "displayUsername", "role", "banned", "banReason", "banExpires")
             VALUES (?, ?, 0, NULL, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
        )
        .run(row.name, row.email, at, at, row.username, row.displayUsername, row.role);
    return Number(result.lastInsertRowid);
}

/**
 * 插入账号的密码登录方式：库的写法是 `providerId = 'credential'`、`accountId` 是账号 id 的文字、`password` 是哈希，令牌列都空。
 */
export function insertCredentialRow(tx: Database, row: {readonly userId: number; readonly passwordHash: string; readonly now: number}): number {
    const at = libDate(row.now);
    const result = tx
        .query(
            `INSERT INTO "account" ("accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt")
             VALUES (?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        )
        .run(String(row.userId), row.userId, row.passwordHash, at, at);
    return Number(result.lastInsertRowid);
}
