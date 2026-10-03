import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {resolveDatabaseConfig} from "nbook/server/database/config";
import {resolveApplicationRoot} from "nbook/server/runtime/installation-paths";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

export type AppSqliteMigrationPlan = {
    databasePath: string;
    migrationsRoot: string;
    pendingMigrationIds: string[];
};

export type AppSqliteMigrationResult = AppSqliteMigrationPlan & {
    appliedMigrationIds: string[];
};

export type AppSqliteCheckpoint = {
    busy: number;
    log: number;
    checkpointed: number;
};

export type AppSqliteMigrationOptions = {
    applicationRoot?: string;
};

/**
 * 只读规划 App SQLite migrations。数据库文件不存在时只报告全部 pending，不创建文件或目录。
 */
export async function planAppSqliteMigrations(
    options: AppSqliteMigrationOptions = {},
): Promise<AppSqliteMigrationPlan> {
    const applicationRoot = resolve(options.applicationRoot ?? resolveApplicationRoot());
    const productMigrationsRoot = resolve(applicationRoot, ".output", "server", "prisma", "migrations", "sqlite");
    const migrationsRoot = existsSync(productMigrationsRoot)
        ? productMigrationsRoot
        : resolve(applicationRoot, "prisma", "migrations", "sqlite");
    const migrationIds = await migrationCatalog(migrationsRoot);
    const databasePath = resolveDatabaseConfig({ensureDirectory: false}).sqliteFilePath;
    if (!existsSync(databasePath)) {
        return {databasePath, migrationsRoot, pendingMigrationIds: migrationIds};
    }

    const database = await openSqlite(databasePath, true);
    try {
        if (!database.hasMigrationTable()) {
            return {databasePath, migrationsRoot, pendingMigrationIds: migrationIds};
        }
        const applied = new Set(database.appliedMigrationIds());
        return {
            databasePath,
            migrationsRoot,
            pendingMigrationIds: migrationIds.filter((id) => !applied.has(id)),
        };
    } finally {
        database.close();
        collectReleasedSqliteHandles({force: true});
    }
}

/** 每个 migration 的 SQL 与完成记录在同一 SQLite transaction 内提交。 */
export async function applyAppSqliteMigrations(
    options: AppSqliteMigrationOptions = {},
): Promise<AppSqliteMigrationResult> {
    const plan = await planAppSqliteMigrations(options);
    if (plan.pendingMigrationIds.length === 0) {
        return {...plan, appliedMigrationIds: []};
    }
    await mkdir(dirname(plan.databasePath), {recursive: true});
    const database = await openSqlite(plan.databasePath, false);
    const appliedMigrationIds: string[] = [];
    try {
        database.exec(`
            CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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
        for (const migrationId of plan.pendingMigrationIds) {
            const sql = await readFile(resolve(plan.migrationsRoot, migrationId, "migration.sql"), "utf8");
            const checksum = createHash("sha256").update(sql).digest("hex");
            database.applyMigration(sql, randomUUID(), checksum, migrationId);
            appliedMigrationIds.push(migrationId);
        }
    } finally {
        database.close();
        collectReleasedSqliteHandles({force: true});
    }
    return {...plan, appliedMigrationIds};
}

/**
 * 在逐字节备份前把 WAL 完整收口进主库；busy 或未完整 checkpoint 时拒绝继续。
 */
export async function checkpointAppSqliteDatabase(databasePath: string): Promise<AppSqliteCheckpoint> {
    const database = await openSqlite(databasePath, false);
    try {
        const checkpoint = database.checkpoint();
        if (checkpoint.busy !== 0 || checkpoint.checkpointed !== checkpoint.log) {
            throw new Error(`App SQLite WAL checkpoint 未完成：${JSON.stringify(checkpoint)}`);
        }
        return checkpoint;
    } finally {
        database.close();
        collectReleasedSqliteHandles({force: true});
    }
}

type SqliteConnection = {
    hasMigrationTable(): boolean;
    appliedMigrationIds(): string[];
    exec(sql: string): void;
    applyMigration(sql: string, id: string, checksum: string, migrationId: string): void;
    checkpoint(): AppSqliteCheckpoint;
    close(): void;
};

type SqliteStatement = {
    get(...parameters: string[]): object | undefined;
    all(...parameters: string[]): object[];
    run(...parameters: string[]): object;
};

type SqliteDatabase = {
    query?(sql: string): SqliteStatement;
    prepare?(sql: string): SqliteStatement;
    exec(sql: string): void;
    close(): void;
};

type SqliteConstructor = new (
    path: string,
    options?: {readonly?: boolean; create?: boolean; readOnly?: boolean},
) => SqliteDatabase;

/**
 * Product 原生运行时适配：Manager/Bun CLI 用 bun:sqlite，Node 24 Nitro 用 node:sqlite。
 * 动态 specifier 避免任一构建器在另一运行时提前解析不存在的内建模块。
 */
async function openSqlite(databasePath: string, readonly: boolean): Promise<SqliteConnection> {
    const bunRuntime = typeof process.versions.bun === "string";
    const specifier = bunRuntime ? "bun:sqlite" : "node:sqlite";
    // 外部运行时模块按已校验的窄构造器接口使用，不把其未知类型传播到业务层。
    const runtimeModule = await import(specifier) as unknown as {Database?: SqliteConstructor; DatabaseSync?: SqliteConstructor};
    const Constructor = bunRuntime ? runtimeModule.Database : runtimeModule.DatabaseSync;
    if (!Constructor) throw new Error(`当前运行时缺少 SQLite API：${specifier}`);
    const database = new Constructor(databasePath, bunRuntime
        ? {readonly, create: !readonly}
        : {readOnly: readonly});
    const prepare = (sql: string): SqliteStatement => {
        const statement = database.query?.(sql) ?? database.prepare?.(sql);
        if (!statement) throw new Error(`当前运行时无法 prepare SQLite statement：${specifier}`);
        return statement;
    };
    return {
        hasMigrationTable: () => Boolean(prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = '_prisma_migrations'
            LIMIT 1
        `).get()),
        appliedMigrationIds: () => prepare(`
            SELECT migration_name FROM _prisma_migrations
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        `).all().map((row) => {
            const migrationId = (row as {migration_name?: unknown}).migration_name;
            if (typeof migrationId !== "string") throw new Error("_prisma_migrations 包含非法 migration_name。");
            return migrationId;
        }),
        exec: (sql) => database.exec(sql),
        applyMigration: (sql, id, checksum, migrationId) => {
            database.exec("BEGIN IMMEDIATE");
            try {
                database.exec(sql);
                prepare(`
                    INSERT INTO "_prisma_migrations" (
                        "id", "checksum", "finished_at", "migration_name", "logs",
                        "rolled_back_at", "started_at", "applied_steps_count"
                    ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, NULL, NULL, CURRENT_TIMESTAMP, 1)
                `).run(id, checksum, migrationId);
                database.exec("COMMIT");
            } catch (error) {
                try {
                    database.exec("ROLLBACK");
                } catch {
                    // 原错误是迁移失败的真相；rollback 错误不能覆盖它。
                }
                throw error;
            }
        },
        checkpoint: () => {
            const result = prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as {
                busy?: unknown;
                log?: unknown;
                checkpointed?: unknown;
            } | undefined;
            if (!result || !Number.isInteger(result.busy) || !Number.isInteger(result.log)
                || !Number.isInteger(result.checkpointed)) {
                throw new Error(`App SQLite WAL checkpoint 返回无效结果：${JSON.stringify(result)}`);
            }
            return {
                busy: result.busy as number,
                log: result.log as number,
                checkpointed: result.checkpointed as number,
            };
        },
        close: () => database.close(),
    };
}

/** migration 目录名排序是 schema 演进顺序；缺 migration.sql 直接拒绝启动。 */
async function migrationCatalog(migrationsRoot: string): Promise<string[]> {
    const entries = await readdir(migrationsRoot, {withFileTypes: true});
    const migrationIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    if (migrationIds.length === 0) {
        throw new Error(`App SQLite migration catalog 为空：${migrationsRoot}`);
    }
    for (const migrationId of migrationIds) {
        if (!existsSync(resolve(migrationsRoot, migrationId, "migration.sql"))) {
            throw new Error(`App SQLite migration 缺少 migration.sql：${migrationId}`);
        }
    }
    return migrationIds;
}
