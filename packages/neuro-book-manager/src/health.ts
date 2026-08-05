import {copyFile, readFile} from "node:fs/promises";
import {createConnection} from "node:net";
import {dirname, join} from "node:path";

import {Database} from "bun:sqlite";

import {loadStateEnv, resolveStateDatabaseUrl} from "#manager/config";
import {ensureDirectory, pathExists} from "#manager/files";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

/** 更新原生 Product 前确认端口未被运行中的服务占用。 */
export async function assertNativeProductStopped(stateRoot: string): Promise<void> {
    const port = await configuredStatePort(stateRoot);
    // 首次 Desktop 启动还没有 State Root 配置；不能把默认 3000 当成这个安装实例的端口，
    // 否则用户正在运行的其它本地服务会阻断 Manager 选择的动态端口。
    if (port === null) return;
    if (await portOpen(port)) {
        throw new Error(`NeuroBook 仍在监听 127.0.0.1:${port}；请先退出服务后再更新。`);
    }
}
export type ApplicationDatabaseBackup = {
    configuredUrl: string;
    databasePath: string;
    backupPath: string;
    checkpoint: {busy: number; log: number; checkpointed: number};
};

export type ApplicationDatabaseBackupIntent = Omit<ApplicationDatabaseBackup, "checkpoint"> & {
    stateRoot: string;
};

/** checkpoint WAL 后备份 App SQLite；数据库尚未创建时返回 null。 */
export async function backupApplicationDatabase(
    stateRoot: string,
    backupRoot: string,
    onIntent?: (intent: ApplicationDatabaseBackupIntent) => Promise<void>,
): Promise<ApplicationDatabaseBackup | null> {
    const configuredUrl = await resolveStateDatabaseUrl(stateRoot);
    const databasePath = resolveAppSqliteLocation(configuredUrl, stateRoot).hostPath;
    if (!await pathExists(databasePath)) return null;
    const backupPath = join(backupRoot, "database", "app.sqlite");
    await onIntent?.({configuredUrl, databasePath, backupPath, stateRoot});
    try {
        const database = new Database(databasePath, {readwrite: true, create: false});
        let checkpoint: ApplicationDatabaseBackup["checkpoint"];
        try {
            const result = database.query<{busy: number; log: number; checkpointed: number}, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
            if (!result || result.busy !== 0 || result.checkpointed !== result.log) {
                throw new Error(`WAL checkpoint未完成：${JSON.stringify(result)}`);
            }
            checkpoint = result;
        } finally {
            database.close();
        }
        await ensureDirectory(dirname(backupPath));
        await copyFile(databasePath, backupPath);
        return {configuredUrl, databasePath, backupPath, checkpoint};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`App SQLite备份失败：${databasePath}\n${message}`, {cause: error});
    }
}

/** 读取 State Root 端口。 */
export async function statePort(stateRoot: string): Promise<number> {
    const env = await loadStateEnv(stateRoot);
    const port = Number(env.NUXT_PORT ?? env.PORT ?? "3000");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`State Root 端口非法：${env.NUXT_PORT ?? env.PORT}`);
    return port;
}

/** 只读取 State Root 已明确声明的端口；空 State Root 返回 null。 */
async function configuredStatePort(stateRoot: string): Promise<number | null> {
    const env = await loadStateEnv(stateRoot);
    const value = env.NUXT_PORT ?? env.PORT;
    if (value === undefined) {
        const envPath = join(stateRoot, ".env");
        if (!await pathExists(envPath)) return null;
        return 3000;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`State Root 端口非法：${value}`);
    }
    return port;
}

async function portOpen(port: number): Promise<boolean> {
    return new Promise<boolean>((resolvePromise) => {
        const socket = createConnection({host: "127.0.0.1", port});
        const finish = (value: boolean): void => {
            socket.destroy();
            resolvePromise(value);
        };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}
