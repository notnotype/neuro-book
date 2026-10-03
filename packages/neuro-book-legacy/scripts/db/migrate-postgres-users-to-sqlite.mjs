#!/usr/bin/env bun
import "dotenv/config";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {createClient} from "@libsql/client";
import * as yaml from "yaml";

const DEFAULT_SQLITE_URL = "file:./workspace/.nbook/neuro-book.sqlite";

const postgresUrl = process.env.POSTGRES_DATABASE_URL?.trim()
    || process.env.OLD_DATABASE_URL?.trim()
    || process.argv[2]?.trim();
const sqliteUrl = process.env.SQLITE_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim()
    || readBootDatabaseUrl()
    || DEFAULT_SQLITE_URL;

if (!postgresUrl) {
    throw new Error("请通过 POSTGRES_DATABASE_URL、OLD_DATABASE_URL 或第一个参数传入旧 PostgreSQL DATABASE_URL。");
}
if (!postgresUrl.startsWith("postgres://") && !postgresUrl.startsWith("postgresql://")) {
    throw new Error(`旧数据库必须是 PostgreSQL URL，当前为：${postgresUrl}`);
}
if (!sqliteUrl.startsWith("file:")) {
    throw new Error(`目标 App SQLite 必须是 file: URL，当前为：${sqliteUrl}`);
}

mkdirSync(dirname(resolve(process.cwd(), sqliteUrl.slice("file:".length))), {recursive: true});

const postgres = await importPostgres();
const pg = postgres(postgresUrl, {max: 1});
const sqlite = createClient({url: sqliteUrl});

try {
    const users = await pg`
        SELECT
            "id",
            "username",
            "displayName",
            "passwordHash",
            "role",
            "status",
            "sessionVersion",
            "lastLoginAt",
            "lastSeenAt",
            "createdAt",
            "updatedAt"
        FROM "User"
        ORDER BY "id" ASC
    `;

    await sqlite.batch(users.map((user) => ({
        sql: `
            INSERT INTO "User" (
                "id",
                "username",
                "displayName",
                "passwordHash",
                "role",
                "status",
                "sessionVersion",
                "lastLoginAt",
                "lastSeenAt",
                "createdAt",
                "updatedAt"
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT("username") DO UPDATE SET
                "displayName" = excluded."displayName",
                "passwordHash" = excluded."passwordHash",
                "role" = excluded."role",
                "status" = excluded."status",
                "sessionVersion" = excluded."sessionVersion",
                "lastLoginAt" = excluded."lastLoginAt",
                "lastSeenAt" = excluded."lastSeenAt",
                "createdAt" = excluded."createdAt",
                "updatedAt" = excluded."updatedAt"
        `,
        args: [
            user.id,
            user.username,
            user.displayName ?? "",
            user.passwordHash,
            normalizeRole(user.role),
            normalizeStatus(user.status),
            user.sessionVersion ?? 1,
            toSqliteDate(user.lastLoginAt),
            toSqliteDate(user.lastSeenAt),
            toSqliteDate(user.createdAt) ?? new Date().toISOString(),
            toSqliteDate(user.updatedAt) ?? new Date().toISOString(),
        ],
    })), "write");

    console.log(`migrated users from PostgreSQL to SQLite: ${users.length}`);
} finally {
    await pg.end({timeout: 5});
    sqlite.close();
}

async function importPostgres() {
    try {
        return (await import("postgres")).default;
    } catch {
        throw new Error("缺少 postgres 包。请先运行 bun install，或临时运行 bun add -d postgres。");
    }
}

function readBootDatabaseUrl() {
    const configPath = resolve(process.cwd(), "config.yaml");
    if (!existsSync(configPath)) {
        return "";
    }
    const text = readFileSync(configPath, "utf-8");
    const expanded = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name, fallback) => {
        const value = process.env[name];
        return value !== undefined && value !== "" ? value : fallback ?? "";
    });
    const parsed = yaml.parse(expanded);
    return typeof parsed?.database?.url === "string" ? parsed.database.url.trim() : "";
}

function normalizeRole(value) {
    return value === "admin" ? "admin" : "user";
}

function normalizeStatus(value) {
    return value === "disabled" ? "disabled" : "active";
}

function toSqliteDate(value) {
    if (!value) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return new Date(value).toISOString();
}
