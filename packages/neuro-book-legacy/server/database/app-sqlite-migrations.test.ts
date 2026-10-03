import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {dirname, join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach, describe, expect, it} from "vitest";
import {
    applyAppSqliteMigrations,
    planAppSqliteMigrations,
} from "nbook/server/database/app-sqlite-migrations";
import {
    assertProductMigrationsReady,
    checkProductMigrations,
} from "nbook/server/runtime/product-migration-gate";
import {
    APPLICATION_STATE_MIGRATION_CATALOG_VERSION,
    APPLICATION_STATE_MIGRATION_STEP_IDS,
} from "nbook/server/runtime/application-state-migration/catalog";
import {applicationStateSentinelPath, applicationStateStepRunId} from "nbook/server/runtime/application-state";

const roots: string[] = [];
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;

afterEach(async () => {
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("App SQLite migration gate", () => {
    it("旧 Passport schema 被只读门禁阻止，统一 apply 后 no-op check 零写入", async () => {
        const root = await mkdtemp(testHostPath("nbook-app-sqlite-gate-"));
        roots.push(root);
        const stateRoot = join(root, "state");
        const workspaceRoot = join(stateRoot, "workspace");
        const databasePath = join(stateRoot, "app.sqlite");
        await mkdir(workspaceRoot, {recursive: true});
        await createOldPassportDatabase(databasePath);
        await writeCurrentApplicationSentinel(workspaceRoot, "gate-fixture");
        process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.env.NEURO_BOOK_APPLICATION_ROOT = process.cwd();

        const before = await stat(databasePath);
        const beforeEntries = await readdir(stateRoot);
        const check = await checkProductMigrations();
        const afterCheck = await stat(databasePath);

        expect(check).toMatchObject({
            ready: false,
            pendingMigrationIds: ["20260727210000_fix_official_passport_origin"],
            applicationStateError: null,
        });
        await expect(assertProductMigrationsReady()).rejects.toThrow("20260727210000_fix_official_passport_origin");
        expect({size: afterCheck.size, mtimeMs: afterCheck.mtimeMs}).toEqual({size: before.size, mtimeMs: before.mtimeMs});
        expect(await readdir(stateRoot)).toEqual(beforeEntries);

        const applied = await applyAppSqliteMigrations({applicationRoot: process.cwd()});
        expect(applied.appliedMigrationIds).toEqual(["20260727210000_fix_official_passport_origin"]);
        const database = new DatabaseSync(databasePath, {readOnly: true});
        try {
            const columns = database.prepare(`PRAGMA table_info("PassportCredential")`).all() as Array<{name: string}>;
            const migration = database.prepare(`
                SELECT migration_name FROM _prisma_migrations
                WHERE migration_name = '20260727210000_fix_official_passport_origin' AND finished_at IS NOT NULL
            `).get();
            expect(columns.map((column) => column.name)).not.toContain("siteBaseUrl");
            expect(migration).toBeTruthy();
        } finally {
            database.close();
        }

        await expect(assertProductMigrationsReady()).resolves.toBeUndefined();
        const beforeNoop = await stat(databasePath);
        const noop = await planAppSqliteMigrations({applicationRoot: process.cwd()});
        const afterNoop = await stat(databasePath);
        expect(noop.pendingMigrationIds).toEqual([]);
        expect({size: afterNoop.size, mtimeMs: afterNoop.mtimeMs}).toEqual({size: beforeNoop.size, mtimeMs: beforeNoop.mtimeMs});
    });
});

/** 构造只缺最后一条 origin hard-cut migration 的真实旧库。 */
async function createOldPassportDatabase(databasePath: string): Promise<void> {
    await mkdir(dirname(databasePath), {recursive: true});
    const migrationsRoot = resolve("prisma", "migrations", "sqlite");
    const migrationIds = [
        "20260524120000_init",
        "20260524121000_add_database_locks",
        "20260722020000_add_passport_credential",
    ];
    const database = new DatabaseSync(databasePath);
    try {
        database.exec(`
            CREATE TABLE "_prisma_migrations" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "checksum" TEXT NOT NULL DEFAULT '',
                "finished_at" DATETIME,
                "migration_name" TEXT NOT NULL,
                "logs" TEXT,
                "rolled_back_at" DATETIME,
                "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "applied_steps_count" INTEGER NOT NULL DEFAULT 0
            )
        `);
        for (const migrationId of migrationIds) {
            database.exec(await readFile(resolve(migrationsRoot, migrationId, "migration.sql"), "utf8"));
            database.prepare(`
                INSERT INTO _prisma_migrations (
                    id, checksum, finished_at, migration_name, started_at, applied_steps_count
                ) VALUES (?, '', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, 1)
            `).run(`fixture-${migrationId}`, migrationId);
        }
        database.prepare(`
            INSERT INTO "PassportCredential" (
                "slotId", "siteBaseUrl", "accountId", "accountUsername", "accountDisplayName", "scopesJson", "refreshToken"
            ) VALUES ('default', 'https://nbook.notnotype.com', 7, 'writer', '写作者', '["backup:read"]', 'fixture-token')
        `).run();
    } finally {
        database.close();
    }
}

async function writeCurrentApplicationSentinel(workspaceRoot: string, runId: string): Promise<void> {
    const path = applicationStateSentinelPath(workspaceRoot);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify({
        version: 1,
        catalogVersion: APPLICATION_STATE_MIGRATION_CATALOG_VERSION,
        runId,
        state: "complete",
        steps: APPLICATION_STATE_MIGRATION_STEP_IDS.map((id) => ({
            id,
            runId: applicationStateStepRunId(runId, id),
            status: "applied",
            changedItems: 0,
            reviewItems: 0,
        })),
    }, null, 4)}\n`, "utf8");
}

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
