import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalDatabaseKind = process.env.DATABASE_KIND;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalTestDatabaseUrl = process.env.NBOOK_TEST_DB_URL;
let root: string | null = null;

afterEach(async () => {
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("DATABASE_KIND", originalDatabaseKind);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("NBOOK_TEST_DB_URL", originalTestDatabaseUrl);
    vi.resetModules();
    if (root) await rm(root, {recursive: true, force: true});
    root = null;
});

describe("Prisma CLI State Root", () => {
    it("将相对 SQLite URL 规范化为 State Root 下的绝对 URL", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-prisma-env-"));
        const stateRoot = join(root, "data");
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/neuro-book.sqlite";

        const {preparePrismaEnv} = await import("./prisma-env.mjs");
        const result = preparePrismaEnv();
        const expectedPath = join(stateRoot, "workspace", ".nbook", "neuro-book.sqlite").replaceAll("\\", "/");

        expect(result.databaseUrl).toBe(`file:${expectedPath}`);
        expect(process.env.DATABASE_URL).toBe(`file:${expectedPath}`);
    });

    it("从显式 application root 读取 boot config 并展开环境变量", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-prisma-boot-"));
        const applicationRoot = join(root, "application");
        const stateRoot = join(root, "state");
        await mkdir(applicationRoot, {recursive: true});
        await mkdir(stateRoot, {recursive: true});
        await writeFile(
            join(stateRoot, "config.yaml"),
            "database:\n  url: ${NBOOK_TEST_DB_URL:-file:./workspace/.nbook/boot.sqlite}\n",
            "utf8",
        );
        process.env.NBOOK_TEST_DB_URL = "file:./workspace/.nbook/expanded.sqlite";
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        delete process.env.DATABASE_KIND;
        delete process.env.DATABASE_URL;

        const {preparePrismaEnv} = await import("./prisma-env.mjs");
        const result = preparePrismaEnv({applicationRoot});
        expect(result.databaseUrl).toContain("expanded.sqlite");
    });
});

function restoreEnv(name: "NEURO_BOOK_STATE_ROOT" | "NEURO_BOOK_APPLICATION_ROOT" | "DATABASE_KIND" | "DATABASE_URL" | "NBOOK_TEST_DB_URL", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
