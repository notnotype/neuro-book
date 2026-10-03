/**
 * 跨进程 Storage 条件写 fixture。
 *
 * parent 通过 stdin 发送 GO 后本进程才发起条件保存；取得真实分区锁时输出一行证据，
 * 使 parent 能确定自己的竞争请求发生在对方仍持有锁的窗口内。
 */

import {lock as acquireFileLock} from "proper-lockfile";
import {defineStorageState, StorageStateRegistry} from "nbook/shared/storage/definition";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {StorageService} from "nbook/server/storage/storage-service";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";

type RacerState = {
    readonly writer: string;
};

const root = process.env.NBOOK_TEST_STORAGE_ROOT;
const identityDomain = process.env.NBOOK_TEST_STORAGE_IDENTITY_DOMAIN;
const expectedRevision = process.env.NBOOK_TEST_STORAGE_EXPECTED_REVISION;
const writer = process.env.NBOOK_TEST_STORAGE_WRITER;
const holdMs = Number(process.env.NBOOK_TEST_STORAGE_HOLD_MS ?? "0");
if (!root || !identityDomain || !expectedRevision || !writer) {
    throw new Error("跨进程 Storage fixture 缺少环境变量");
}

const definition = defineStorageState<RacerState>({
    owner: "test.racer",
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {writer: "default"},
    validate: (value): value is RacerState => typeof value === "object" && value !== null
        && typeof (value as RacerState).writer === "string",
});
const registry = new StorageStateRegistry();
registry.register(definition);

let lockReported = false;
const lockAdapter: StorageLockAdapter = {
    acquire: async (file, options) => {
        const release = await acquireFileLock(file, options);
        if (!lockReported) {
            lockReported = true;
            process.stdout.write("NBOOK_STORAGE_LOCK_HELD\n");
        }
        // 加宽临界区，让 parent 的竞争请求真的落在锁持有窗口内。
        return async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, holdMs));
            await release();
        };
    },
};

const service = new StorageService({registry, lockAdapter});
const handle = await service.openHandle({
    owner: "test.racer",
    context: {
        scope: "user",
        storageRoot: absoluteFsPath(root),
        identityDomain,
        subject: "user-a",
        clientId: "client-1",
    },
});

process.stdout.write("NBOOK_STORAGE_READY\n");

await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    process.stdin.resume();
});

try {
    const saved = await handle.save(definition, {
        expected: {revision: expectedRevision === "null" ? null : expectedRevision, partitionGeneration: 1},
        value: {writer},
    });
    process.stdout.write(`NBOOK_STORAGE_RESULT ${JSON.stringify({status: "saved", revision: saved.revision})}\n`);
} catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    process.stdout.write(`NBOOK_STORAGE_RESULT ${JSON.stringify({status: "failed", code})}\n`);
}

await handle.release();
process.stdout.write("NBOOK_STORAGE_RELEASED\n");
