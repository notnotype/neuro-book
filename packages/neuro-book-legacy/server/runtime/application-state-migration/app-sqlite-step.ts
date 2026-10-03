import {constants} from "node:fs";
import {copyFile, mkdir, readFile, rm} from "node:fs/promises";
import {dirname, resolve} from "node:path";

import {
    applyAppSqliteMigrations,
    checkpointAppSqliteDatabase,
    planAppSqliteMigrations,
} from "nbook/server/database/app-sqlite-migrations";
import {
    optionalFileHash,
    pathExists,
    renameDurable,
    syncFile,
    writeAtomicDurableJson,
} from "nbook/server/agent/session/migrations/shared/durable-file";

type AppSqliteStepState = "prepared" | "applied" | "rolled_back";

type AppSqliteStepManifest = {
    version: 1;
    runId: string;
    state: AppSqliteStepState;
    databasePath: string;
    sourceExisted: boolean;
    /** sourceExisted=false 时固定为 null。 */
    sourceHash: string | null;
    pendingMigrationIds: string[];
    appliedMigrationIds: string[];
    /** state=applied 时为迁移后主库 hash，其余状态为 null 或恢复后的 source hash。 */
    targetHash: string | null;
};

export type AppSqliteStepResult = {
    appliedMigrationIds: string[];
};

export type AppSqliteStepOptions = {
    rootWorkspace: string;
    runId: string;
    applicationRoot: string;
};

/**
 * Product-owned SQLite step：先持久化源身份与逐字节备份，再执行可幂等 SQL catalog。
 */
export async function applyAppSqliteMigrationStep(options: AppSqliteStepOptions): Promise<AppSqliteStepResult> {
    const rootWorkspace = resolve(options.rootWorkspace);
    const plan = await planAppSqliteMigrations({applicationRoot: options.applicationRoot});
    const path = manifestPath(rootWorkspace, options.runId);
    let manifest = await readManifest(path, options.runId);
    if (manifest) {
        const existingManifest = manifest;
        assertDatabaseIdentity(existingManifest, plan.databasePath);
        if (existingManifest.state === "rolled_back") {
            throw new Error(`App SQLite migration run ${options.runId} 已回滚，不能继续 apply。`);
        }
        if (existingManifest.state === "applied") {
            if (plan.pendingMigrationIds.some((id) => existingManifest.pendingMigrationIds.includes(id))) {
                throw new Error(`App SQLite migration run ${options.runId} 标记完成但 schema 仍有 pending。`);
            }
            return {appliedMigrationIds: existingManifest.appliedMigrationIds};
        }
        await ensureBackup(rootWorkspace, options.runId, existingManifest);
    } else {
        const sourceExisted = await pathExists(plan.databasePath);
        if (sourceExisted) {
            await checkpointAppSqliteDatabase(plan.databasePath);
        }
        const sourceHash = sourceExisted ? await requiredFileHash(plan.databasePath) : null;
        manifest = {
            version: 1,
            runId: options.runId,
            state: "prepared",
            databasePath: resolve(plan.databasePath),
            sourceExisted,
            sourceHash,
            pendingMigrationIds: [...plan.pendingMigrationIds],
            appliedMigrationIds: [],
            targetHash: null,
        };
        await writeAtomicDurableJson(path, manifest);
        await ensureBackup(rootWorkspace, options.runId, manifest);
    }

    const preparedManifest = manifest;
    const result = await applyAppSqliteMigrations({applicationRoot: options.applicationRoot});
    const remaining = await planAppSqliteMigrations({applicationRoot: options.applicationRoot});
    if (remaining.pendingMigrationIds.some((id) => preparedManifest.pendingMigrationIds.includes(id))) {
        throw new Error(`App SQLite migration run ${options.runId} apply 后仍有本轮 pending migration。`);
    }
    const targetHash = await requiredFileHash(preparedManifest.databasePath);
    const appliedManifest: AppSqliteStepManifest = {
        ...preparedManifest,
        state: "applied",
        appliedMigrationIds: [...preparedManifest.pendingMigrationIds],
        targetHash,
    };
    await writeAtomicDurableJson(path, appliedManifest);
    return {
        appliedMigrationIds: appliedManifest.appliedMigrationIds.length > 0
            ? appliedManifest.appliedMigrationIds
            : result.appliedMigrationIds,
    };
}

/**
 * 反序恢复 SQLite：有源库时从 step backup 原子替换，无源库时删除本轮创建的数据库。
 */
export async function rollbackAppSqliteMigrationStep(
    rootWorkspace: string,
    runId: string,
): Promise<"rolled_back" | "not_started"> {
    const resolvedRoot = resolve(rootWorkspace);
    const path = manifestPath(resolvedRoot, runId);
    let manifest = await readManifest(path, runId);
    if (!manifest) return "not_started";
    if (manifest.state === "rolled_back") return "rolled_back";

    const currentPlan = await planAppSqliteMigrations();
    assertDatabaseIdentity(manifest, currentPlan.databasePath);
    await rm(`${manifest.databasePath}-wal`, {force: true});
    await rm(`${manifest.databasePath}-shm`, {force: true});
    if (manifest.sourceExisted) {
        await ensureBackup(resolvedRoot, runId, manifest);
        const backup = backupPath(resolvedRoot, runId);
        const stage = `${manifest.databasePath}.migration-restore-${runId}`;
        await mkdir(dirname(stage), {recursive: true});
        await rm(stage, {force: true});
        try {
            await copyFile(backup, stage, constants.COPYFILE_EXCL);
            await syncFile(stage);
            await renameDurable(stage, manifest.databasePath);
        } finally {
            await rm(stage, {force: true});
        }
        await assertHash(manifest.databasePath, manifest.sourceHash!, "App SQLite rollback 主库 hash 不一致");
    } else {
        await rm(manifest.databasePath, {force: true});
    }
    manifest = {
        ...manifest,
        state: "rolled_back",
        targetHash: manifest.sourceHash,
    };
    await writeAtomicDurableJson(path, manifest);
    return "rolled_back";
}

/** pending Application checkpoint 是否已有 SQLite step durable ownership。 */
export async function hasAppSqliteMigrationArtifacts(rootWorkspace: string, runId: string): Promise<boolean> {
    return pathExists(manifestPath(resolve(rootWorkspace), runId));
}

function runRoot(rootWorkspace: string, runId: string): string {
    return resolve(rootWorkspace, `.nbook/agent/migrations/app-sqlite/${runId}`);
}

function manifestPath(rootWorkspace: string, runId: string): string {
    return resolve(runRoot(rootWorkspace, runId), "manifest.json");
}

function backupPath(rootWorkspace: string, runId: string): string {
    return resolve(runRoot(rootWorkspace, runId), "backup.sqlite");
}

async function ensureBackup(
    rootWorkspace: string,
    runId: string,
    manifest: AppSqliteStepManifest,
): Promise<void> {
    if (!manifest.sourceExisted) return;
    const path = backupPath(rootWorkspace, runId);
    if (await pathExists(path)) {
        await assertHash(path, manifest.sourceHash!, "App SQLite migration backup hash 不一致");
        return;
    }
    await assertHash(manifest.databasePath, manifest.sourceHash!, "App SQLite migration 源库在备份前发生变化");
    await mkdir(dirname(path), {recursive: true});
    await copyFile(manifest.databasePath, path, constants.COPYFILE_EXCL);
    await syncFile(path);
    await assertHash(path, manifest.sourceHash!, "App SQLite migration backup 写入不完整");
}

async function readManifest(path: string, runId: string): Promise<AppSqliteStepManifest | null> {
    if (!await pathExists(path)) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isObject(value) || Object.keys(value).sort().join(",") !== [
        "appliedMigrationIds",
        "databasePath",
        "pendingMigrationIds",
        "runId",
        "sourceExisted",
        "sourceHash",
        "state",
        "targetHash",
        "version",
    ].sort().join(",") || value.version !== 1 || value.runId !== runId
        || (value.state !== "prepared" && value.state !== "applied" && value.state !== "rolled_back")
        || typeof value.databasePath !== "string" || !resolve(value.databasePath)
        || typeof value.sourceExisted !== "boolean"
        || (value.sourceHash !== null && !isHash(value.sourceHash))
        || !stringArray(value.pendingMigrationIds) || !stringArray(value.appliedMigrationIds)
        || (value.targetHash !== null && !isHash(value.targetHash))) {
        throw new Error(`App SQLite migration manifest 无效：${path}`);
    }
    if (value.sourceExisted !== (value.sourceHash !== null)) {
        throw new Error(`App SQLite migration manifest source 身份无效：${path}`);
    }
    return {
        version: 1,
        runId: value.runId,
        state: value.state,
        databasePath: resolve(value.databasePath),
        sourceExisted: value.sourceExisted,
        sourceHash: value.sourceHash,
        pendingMigrationIds: [...value.pendingMigrationIds],
        appliedMigrationIds: [...value.appliedMigrationIds],
        targetHash: value.targetHash,
    };
}

function assertDatabaseIdentity(manifest: AppSqliteStepManifest, databasePath: string): void {
    if (manifest.databasePath !== resolve(databasePath)) {
        throw new Error("App SQLite migration 运行期间 DATABASE_URL 发生变化。");
    }
}

async function requiredFileHash(path: string): Promise<string> {
    const hash = await optionalFileHash(path);
    if (!hash) throw new Error(`App SQLite migration 文件不存在：${path}`);
    return hash;
}

async function assertHash(path: string, expected: string, message: string): Promise<void> {
    const actual = await optionalFileHash(path);
    if (actual !== expected) throw new Error(`${message}：expected=${expected} actual=${actual ?? "missing"}`);
}

function isHash(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function stringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function isObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
