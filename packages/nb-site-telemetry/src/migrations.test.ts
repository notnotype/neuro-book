/**
 * 迁移清单与 `migrations/` 目录一一对应：新加了 SQL 文件却忘了在 `migrations.ts` 里导入，这条迁移永远不会执行。
 * 它也经公开入口导入本包，同时是模块包的 smoke。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {telemetryMigrations} from "./index";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

describe("统计模块的迁移清单", () => {
    it("按编号列出 migrations/ 下的每个 SQL 文件，内容与文件相同", () => {
        // 目录里还没有迁移时 Git 不保留它。
        const files = existsSync(MIGRATIONS_DIR) ? readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort() : [];
        expect(telemetryMigrations.map((migration) => migration.id)).toEqual(files.map((name) => name.slice(0, -".sql".length)));
        for (const migration of telemetryMigrations) {
            expect(migration.sql).toBe(readFileSync(join(MIGRATIONS_DIR, `${migration.id}.sql`), "utf8"));
        }
    });
});
