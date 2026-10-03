import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {dirname, join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach, describe, expect, it} from "vitest";

import {runApplicationStateMigration} from "nbook/server/runtime/application-state-migration/runner";
import {acquireApplicationStateLease} from "nbook/server/runtime/application-state-migration/lease";
import {
    ApplicationStateMigrationRequiredError,
    ApplicationStateSentinelCorruptError,
    applicationStateSentinelPath,
    assertApplicationStateReady,
    readApplicationStateSentinel,
} from "nbook/server/runtime/application-state";
import {readAgentSessionStoreSentinel} from "nbook/server/agent/session/agent-session-store";
import {writeLegacyV2ReviewFixture} from "nbook/server/agent/session/migrations/session-v2-review-repair/test-fixture";

const roots: string[] = [];
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
});

describe("Application State migration runner", () => {
    it("plan 对 fresh State Root 零写入并按 catalog 稳定排序", async () => {
        const root = await stateRoot();

        const report = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "plan",
            runId: "plan-fresh",
        });

        expect(report).toMatchObject({
            action: "plan",
            status: "planned",
            runId: "plan-fresh",
            steps: [
                {id: "app-sqlite", runId: "plan-fresh-app-sqlite", status: "planned"},
                {id: "agent-attachment-v1", runId: "plan-fresh-attachment", status: "planned"},
                {id: "agent-session-v2", runId: "plan-fresh-session", status: "planned"},
                {id: "agent-session-v2-review-repair", runId: "plan-fresh-session-review-repair", status: "skipped"},
            ],
        });
        expect(await readApplicationStateSentinel(root)).toBeNull();
    });

    it("fresh apply 建立 complete sentinel，重复 start 无副作用", async () => {
        const root = await stateRoot();

        const applied = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "fresh-apply",
        });
        const sentinel = await assertApplicationStateReady(root);
        const sessionSentinel = await readAgentSessionStoreSentinel(root);
        const repeated = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "second-start",
        });

        expect(applied.status).toBe("complete");
        expect(sentinel).toMatchObject({state: "complete", runId: "fresh-apply"});
        expect(sessionSentinel).toMatchObject({state: "complete", targetSchemaVersion: 2});
        expect(repeated).toMatchObject({status: "already_current", runId: "second-start"});
        expect((await assertApplicationStateReady(root)).runId).toBe("fresh-apply");
    });

    it("缺少顶层 sentinel 时仍依据 Session v2 自有状态计划 review repair", async () => {
        const root = await stateRoot();
        await writeLegacyV2ReviewFixture(root);

        const planned = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "plan",
            runId: "repair-without-application-sentinel",
        });

        expect(planned.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({id: "agent-session-v2", status: "skipped"}),
            expect.objectContaining({id: "agent-session-v2-review-repair", status: "planned", changedItems: 1}),
        ]));
    });

    it("complete v3 中曾 skipped 的 review repair 可建立同 catalog 新 run 并逐字节回滚", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "v3-before-repair"});
        const fixture = await writeLegacyV2ReviewFixture(root);
        const sentinelBefore = await readFile(applicationStateSentinelPath(root));
        const sessionBefore = await readFile(fixture.sessionPath);

        const planned = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "plan",
            runId: "v3-repair",
        });
        const applied = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "v3-repair",
        });
        const repeated = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "plan",
            runId: "v3-after-repair",
        });

        expect(planned).toMatchObject({catalogVersion: 3, status: "planned", runId: "v3-repair"});
        expect(planned.steps.map((step) => [step.id, step.status])).toEqual([
            ["app-sqlite", "skipped"],
            ["agent-attachment-v1", "skipped"],
            ["agent-session-v2", "skipped"],
            ["agent-session-v2-review-repair", "planned"],
        ]);
        expect(applied.steps.at(-1)).toMatchObject({
            id: "agent-session-v2-review-repair",
            status: "applied",
            changedItems: 1,
        });
        expect(repeated.status).toBe("already_current");

        await runApplicationStateMigration({rootWorkspace: root, action: "rollback", runId: "v3-repair"});
        expect(await readFile(applicationStateSentinelPath(root))).toEqual(sentinelBefore);
        expect(await readFile(fixture.sessionPath)).toEqual(sessionBefore);
    }, 20_000);

    it("子步骤已完成但 Application checkpoint 仍 pending 时 resume 对账完成", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "resume-checkpoint"});
        await regressApplicationCheckpoint(root, "resume-checkpoint", "applying");

        const resumed = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "resume",
            runId: "resume-checkpoint",
        });

        expect(resumed.status).toBe("complete");
        expect(resumed.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({id: "agent-session-v2", status: "applied"}),
        ]));
        await expect(assertApplicationStateReady(root)).resolves.toMatchObject({state: "complete"});
    });

    it("子步骤已完成但 Application checkpoint 仍 pending 时 rollback 仍严格逆序恢复", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "rollback-checkpoint"});
        await regressApplicationCheckpoint(root, "rollback-checkpoint", "rollback_required");

        const rolledBack = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "rollback",
            runId: "rollback-checkpoint",
        });

        expect(rolledBack.status).toBe("rolled_back");
        expect(rolledBack.steps.map((step) => [step.id, step.status])).toEqual([
            ["app-sqlite", "rolled_back"],
            ["agent-attachment-v1", "rolled_back"],
            ["agent-session-v2", "rolled_back"],
            ["agent-session-v2-review-repair", "skipped"],
        ]);
        expect(await readApplicationStateSentinel(root)).toBeNull();
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "complete",
            sourceSchemaVersion: 2,
            targetSchemaVersion: 1,
        });
    });

    it("SQLite step apply 后 rollback 逐字节恢复迁移前数据库", async () => {
        const root = await stateRoot();
        const databasePath = join(root, "app.sqlite");
        await createOldPassportDatabase(databasePath);
        const before = await readFile(databasePath);

        const applied = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "sqlite-byte-rollback",
        });
        expect(applied.steps[0]).toMatchObject({id: "app-sqlite", status: "applied", changedItems: 1});
        expect(await readFile(databasePath)).not.toEqual(before);

        const rolledBack = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "rollback",
            runId: "sqlite-byte-rollback",
        });

        expect(rolledBack.steps[0]).toMatchObject({id: "app-sqlite", status: "rolled_back"});
        expect(await readFile(databasePath)).toEqual(before);
    });

    it("完整 rollback 回到 schema v1 后可使用新 runId 再次 apply", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "first-apply"});
        await runApplicationStateMigration({rootWorkspace: root, action: "rollback", runId: "first-apply"});

        const reapplied = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "second-apply",
        });

        expect(reapplied).toMatchObject({status: "complete", runId: "second-apply"});
        await expect(readAgentSessionStoreSentinel(root)).resolves.toMatchObject({
            state: "complete",
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            runId: "second-apply-session",
        });
    });

    it("readiness 对缺失、损坏和未完成 sentinel 一律 fail closed", async () => {
        const root = await stateRoot();
        await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateMigrationRequiredError);

        const sentinelPath = applicationStateSentinelPath(root);
        await mkdir(dirname(sentinelPath), {recursive: true});
        await writeFile(sentinelPath, "{broken", "utf8");
        await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateSentinelCorruptError);

        await rm(sentinelPath, {force: true});
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "readiness-states"});
        const complete = JSON.parse(await readFile(sentinelPath, "utf8")) as {state: string};
        for (const state of ["applying", "rollback_required"] as const) {
            await writeFile(sentinelPath, `${JSON.stringify({...complete, state}, null, 4)}\n`, "utf8");
            await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateMigrationRequiredError);
        }
        await writeFile(sentinelPath, `${JSON.stringify({...complete, state: "rolled_back"}, null, 4)}\n`, "utf8");
        await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateSentinelCorruptError);
    });

    it("readiness 拒绝 catalog 落后、超前和 step ownership 漂移", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "readiness-catalog"});
        const sentinelPath = applicationStateSentinelPath(root);
        const complete = JSON.parse(await readFile(sentinelPath, "utf8")) as {
            catalogVersion: number;
            steps: Array<{id: string}>;
        };

        await writeFile(sentinelPath, `${JSON.stringify({...complete, catalogVersion: 0}, null, 4)}\n`, "utf8");
        await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateSentinelCorruptError);

        await writeFile(sentinelPath, `${JSON.stringify({...complete, catalogVersion: 4}, null, 4)}\n`, "utf8");
        await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateMigrationRequiredError);

        await writeFile(sentinelPath, `${JSON.stringify({
            ...complete,
            steps: [...complete.steps].reverse(),
        }, null, 4)}\n`, "utf8");
        await expect(assertApplicationStateReady(root)).rejects.toBeInstanceOf(ApplicationStateSentinelCorruptError);
    });

    it("真实 catalog v1 complete 使用新 run 升级到 v3，rollback 逐字节恢复旧 sentinel", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "legacy-v1"});
        const sentinelPath = applicationStateSentinelPath(root);
        const legacyBytes = await writeLegacyV1Application(root, "legacy-v1");

        const planned = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "plan",
            runId: "upgrade-v3",
        });
        const applied = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "upgrade-v3",
        });

        expect(planned).toMatchObject({catalogVersion: 3, runId: "upgrade-v3", status: "planned"});
        expect(planned.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({id: "agent-attachment-v1", status: "skipped"}),
            expect.objectContaining({id: "agent-session-v2", status: "skipped"}),
        ]));
        expect(applied).toMatchObject({catalogVersion: 3, runId: "upgrade-v3", status: "complete"});
        await expect(assertApplicationStateReady(root)).resolves.toMatchObject({runId: "upgrade-v3"});

        await runApplicationStateMigration({rootWorkspace: root, action: "rollback", runId: "upgrade-v3"});
        expect(await readFile(sentinelPath)).toEqual(legacyBytes);
    });

    it("complete 旧 sentinel 不会成为新 apply 的默认 runId", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "old-complete"});
        await writeLegacyV1Application(root, "old-complete");

        const applied = await runApplicationStateMigration({rootWorkspace: root, action: "apply"});

        expect(applied.runId).not.toBe("old-complete");
        expect(applied.catalogVersion).toBe(3);
    });

    it("plan 保持只读且写动作受顶层 lease 串行化", async () => {
        const root = await stateRoot();
        const release = await acquireApplicationStateLease(root);
        try {
            await expect(runApplicationStateMigration({
                rootWorkspace: root,
                action: "plan",
                runId: "lease-plan",
            })).resolves.toMatchObject({status: "planned"});
            await expect(runApplicationStateMigration({
                rootWorkspace: root,
                action: "apply",
                runId: "lease-apply",
            })).rejects.toThrow();
        } finally {
            await release();
        }

        await expect(runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "lease-apply",
        })).resolves.toMatchObject({status: "complete"});
    });

    it("旧 catalog incomplete run 按原 catalog resume，下一次 apply 才创建 v3 run", async () => {
        const root = await stateRoot();
        await runApplicationStateMigration({rootWorkspace: root, action: "apply", runId: "legacy-v2-seed"});
        await writeIncompleteHistoricalApplication(root, 2, "legacy-v2-resume");

        const resumed = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "resume",
            runId: "legacy-v2-resume",
        });
        const upgraded = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "apply",
            runId: "legacy-v2-upgrade",
        });

        expect(resumed).toMatchObject({catalogVersion: 2, status: "complete", runId: "legacy-v2-resume"});
        expect(upgraded).toMatchObject({catalogVersion: 3, status: "complete", runId: "legacy-v2-upgrade"});
    });

    it("旧 catalog incomplete run 按原 journal rollback 并恢复进入 run 前的 sentinel", async () => {
        const root = await stateRoot();
        await writeIncompleteHistoricalApplication(root, 1, "legacy-v1-rollback");

        const rolledBack = await runApplicationStateMigration({
            rootWorkspace: root,
            action: "rollback",
            runId: "legacy-v1-rollback",
        });

        expect(rolledBack).toMatchObject({catalogVersion: 1, status: "rolled_back"});
        expect(await readApplicationStateSentinel(root)).toBeNull();
    });
});

async function stateRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-application-state-"));
    roots.push(root);
    process.env.DATABASE_URL = `file:${join(root, "app.sqlite").replaceAll("\\", "/")}`;
    process.env.NEURO_BOOK_APPLICATION_ROOT = resolve(import.meta.dirname, "../..");
    return root;
}

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

/** 构造只缺最后一条 origin hard-cut migration 的旧 App SQLite。 */
async function createOldPassportDatabase(databasePath: string): Promise<void> {
    await mkdir(dirname(databasePath), {recursive: true});
    const migrationsRoot = resolve(import.meta.dirname, "../../prisma/migrations/sqlite");
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
    } finally {
        database.close();
    }
}

/** 模拟子 migration 已 durable complete、Application journal/sentinel 尚未 checkpoint。 */
async function regressApplicationCheckpoint(
    root: string,
    runId: string,
    state: "applying" | "rollback_required",
): Promise<void> {
    const journalPath = resolve(root, `.nbook/agent/migrations/application-state/${runId}/journal.json`);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        state: string;
        steps: Array<{id: string; status: string}>;
        previousSentinel: null;
        [key: string]: unknown;
    };
    journal.state = state;
    const session = journal.steps.find((step) => step.id === "agent-session-v2");
    if (!session) throw new Error("fixture 缺少 agent-session-v2 step");
    session.status = "pending";
    await writeFile(journalPath, `${JSON.stringify(journal, null, 4)}\n`, "utf8");
    const {previousSentinel: _previous, ...sentinel} = journal;
    await writeFile(applicationStateSentinelPath(root), `${JSON.stringify(sentinel, null, 4)}\n`, "utf8");
}

/** 用真实 v1 字段顺序和顶层 previousSentinel journal 覆盖 current fixture。 */
async function writeLegacyV1Application(root: string, runId: string): Promise<Buffer> {
    const sentinel = {
        version: 1,
        catalogVersion: 1,
        runId,
        state: "complete",
        steps: [
            {
                id: "agent-attachment-v1",
                runId: `${runId}-attachment`,
                status: "applied",
                changedItems: 0,
                reviewItems: 0,
            },
            {
                id: "agent-session-v2",
                runId: `${runId}-session`,
                status: "applied",
                changedItems: 0,
                reviewItems: 0,
            },
        ],
    };
    const bytes = Buffer.from(JSON.stringify(sentinel), "utf8");
    await writeFile(applicationStateSentinelPath(root), bytes);
    const journalPath = resolve(root, `.nbook/agent/migrations/application-state/${runId}/journal.json`);
    await writeFile(journalPath, `${JSON.stringify({...sentinel, previousSentinel: null}, null, 2)}\n`, "utf8");
    return bytes;
}

/** 构造不含子步骤副作用的历史 incomplete run，用于验证 catalog 分派。 */
async function writeIncompleteHistoricalApplication(root: string, catalogVersion: 1 | 2, runId: string): Promise<void> {
    const ids = catalogVersion === 1
        ? ["agent-attachment-v1", "agent-session-v2"]
        : ["app-sqlite", "agent-attachment-v1", "agent-session-v2"];
    const steps = ids.map((id) => ({
        id,
        runId: id === "app-sqlite"
            ? runId + "-app-sqlite"
            : id === "agent-attachment-v1" ? runId + "-attachment" : runId + "-session",
        status: "skipped",
        changedItems: 0,
        reviewItems: 0,
    }));
    const sentinel = {version: 1, catalogVersion, runId, state: "applying", steps};
    const sentinelPath = applicationStateSentinelPath(root);
    await mkdir(dirname(sentinelPath), {recursive: true});
    await writeFile(sentinelPath, JSON.stringify(sentinel, null, 4) + "\n", "utf8");
    const journalPath = resolve(root, ".nbook/agent/migrations/application-state/" + runId + "/journal.json");
    await mkdir(dirname(journalPath), {recursive: true});
    await writeFile(journalPath, JSON.stringify({...sentinel, previousSentinel: null}, null, 4) + "\n", "utf8");
}
