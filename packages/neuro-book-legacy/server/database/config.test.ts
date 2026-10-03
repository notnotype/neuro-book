import {mkdtemp, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {resolveStateRoot} from "nbook/server/runtime/installation-paths";
const originalCwd = process.cwd();
const originalDatabaseKind = process.env.DATABASE_KIND;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
let tempDir: string | null = null;

describe("database config", () => {
    beforeEach(() => {
        process.chdir(originalCwd);
        delete process.env.DATABASE_KIND;
        delete process.env.DATABASE_URL;
        delete process.env.NEURO_BOOK_APPLICATION_ROOT;
        delete process.env.NEURO_BOOK_STATE_ROOT;
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        restoreEnv("DATABASE_KIND", originalDatabaseKind);
        restoreEnv("DATABASE_URL", originalDatabaseUrl);
        restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
        restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
        if (tempDir) {
            await rm(tempDir, {recursive: true, force: true});
            tempDir = null;
        }
    });

    it("无 env 和 config 时默认 SQLite 文件库", async () => {
        const {resolveDatabaseConfig} = await importFreshConfig();

        const result = resolveDatabaseConfig();

        expect(result.kind).toBe("sqlite");
        expect(result.url).toBe(fileUrl(join(resolveStateRoot(originalCwd, {}), "workspace", ".nbook", "neuro-book.sqlite")));
    });

    it("Boot Config 可以选择自定义 SQLite 文件路径", async () => {
        tempDir = await mkdtemp(testHostPath("nbook-db-config-"));
        process.chdir(tempDir);
        process.env.NEURO_BOOK_APPLICATION_ROOT = tempDir;
        process.env.NEURO_BOOK_STATE_ROOT = tempDir;
        delete process.env.DATABASE_URL;
        await writeFile("config.yaml", [
            "database:",
            "  kind: sqlite",
            "  url: file:./workspace/.nbook/custom.sqlite",
            "",
        ].join("\n"), "utf-8");

        const {resolveDatabaseConfig} = await importFreshConfig();
        const result = resolveDatabaseConfig();

        expect(result.kind).toBe("sqlite");
        expect(result.url).toBe(fileUrl(join(tempDir, "workspace", ".nbook", "custom.sqlite")));
        expect(result.sqliteFilePath?.replaceAll("\\", "/")).toContain("/workspace/.nbook/custom.sqlite");
    });

    it("env 覆盖 Boot Config", async () => {
        tempDir = await mkdtemp(testHostPath("nbook-db-config-"));
        process.chdir(tempDir);
        process.env.NEURO_BOOK_APPLICATION_ROOT = tempDir;
        process.env.NEURO_BOOK_STATE_ROOT = tempDir;
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/env.sqlite";
        await writeFile("config.yaml", [
            "database:",
            "  kind: sqlite",
            "  url: file:./workspace/.nbook/config.sqlite",
            "",
        ].join("\n"), "utf-8");

        const {resolveDatabaseConfig} = await importFreshConfig();
        const result = resolveDatabaseConfig();

        expect(result.kind).toBe("sqlite");
        expect(result.url).toBe(fileUrl(join(tempDir, "workspace", ".nbook", "env.sqlite")));
    });

    it("相对 SQLite 路径基于 State Root 解析", async () => {
        tempDir = await mkdtemp(testHostPath("nbook-db-state-root-"));
        const stateRoot = join(tempDir, "data");
        process.env.NEURO_BOOK_APPLICATION_ROOT = tempDir;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/state.sqlite";

        const {resolveDatabaseConfig} = await importFreshConfig();
        const result = resolveDatabaseConfig();

        expect(result.sqliteFilePath).toBe(join(stateRoot, "workspace", ".nbook", "state.sqlite"));
        expect(result.url).toBe(fileUrl(join(stateRoot, "workspace", ".nbook", "state.sqlite")));
    });
});

async function importFreshConfig() {
    vi.resetModules();
    return await import("nbook/server/database/config");
}

function fileUrl(databasePath: string): string {
    return `file:${databasePath.replaceAll("\\", "/")}`;
}

function restoreEnv(
    name: "DATABASE_KIND" | "DATABASE_URL" | "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT",
    value: string | undefined,
): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
