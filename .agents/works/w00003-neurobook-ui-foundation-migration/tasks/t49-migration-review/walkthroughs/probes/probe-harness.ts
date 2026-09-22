/**
 * 审查探针的共用夹具（只读探针，不改产品代码、不改产品测试）。
 *
 * 与 t47 的 E2E 用例同一条产品路径：隔离临时根 + 真实 HTTP 监听 + 真实 H3 路由 + 真实浏览器适配器
 * （`openStorageUserContext` / `openStorageOwnerHandle` / `createStorageHttpTransport`）。
 * 差别只在：每个动作按 kind/owner/key/resource 记流水（供"写了几次""有没有再写"的断言），
 * 并可按地址注入一次写入失败来制造中断。
 */
import {readFile, readdir, stat} from "node:fs/promises";
import path from "node:path";
import {
    createStorageActionHost,
    STORAGE_TEST_CLIENT_A,
    type StorageActionHostFixture,
} from "nbook/server/storage/fixtures/storage-action-host";
import {
    closeStorageContext,
    openStorageUserContext,
    type StorageContextOpenOptions,
} from "nbook/app/utils/storage/host-context-client";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import {createStorageHttpTransport} from "nbook/app/utils/storage/value-transport";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";
import type {StorageReadResult} from "nbook/shared/storage/contract";
import {
    createStorageMigration,
    type StorageMigrationAdapters,
    type StorageMigrationController,
} from "nbook/app/utils/workbench/storage-migration";
import {registerProductStorageDefinitions} from "nbook/server/storage/product-definitions";
import {measureLegacyOriginal, type LegacyBucketStaging} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

/** 一次存储动作的流水条目。 */
export type ActionLogEntry = {
    readonly kind: string;
    readonly owner: string;
    readonly key: string;
    readonly resource: string | null;
};

export type SaveFailureInjection = {
    readonly owner: string;
    readonly key: string;
    readonly resource?: string;
    readonly times: number;
};

export type MigrationHarness = {
    readonly host: StorageActionHostFixture;
    readonly actions: readonly ActionLogEntry[];
    /** 某地址上发生过的动作次数。 */
    readonly count: (kind: string, owner: string, key: string, resource?: string) => number;
    /** 从某个流水位置起的写动作（save/repair/remove），用于"这一次运行写了哪些记录"。 */
    readonly writesSince: (mark: number) => readonly ActionLogEntry[];
    readonly mark: () => number;
    /** 每次调用都新建一个迁移控制器：模拟"另一个标签页/重启后再跑一次"。 */
    readonly controller: (raw: string) => StorageMigrationController;
    /** 注入一次写入失败（中断试验）。 */
    readonly failNextSave: (injection: SaveFailureInjection) => void;
    /** 挂起下一次匹配地址的读取；返回释放函数（制造"运行仍在途"的时序）。 */
    readonly holdNextRead: (owner: string, key: string, resource?: string) => () => void;
    /** 隔离根内的记录文件文本；文件不存在时返回 null。 */
    readonly recordText: (owner: string, key: string, resource?: string) => Promise<string | null>;
    readonly recordPath: (owner: string, key: string, resource?: string) => Promise<string>;
    /** 分区里正式记录文件的字节合计（与 `partition-store` 的容量口径一致，忽略临时/隔离文件）。 */
    readonly partitionRecordBytes: (owner: string) => Promise<number>;
    /** 经产品 HTTP 动作直接读写：用来制造"另一个标签页先写""用户重置"等真实状态。 */
    readonly act: (action: {owner: string; key: string; schemaVersion: number; resource?: string} & Record<string, unknown>) => Promise<unknown>;
    readonly read: (owner: string, key: string, resource?: string) => Promise<StorageReadResult<unknown>>;
    readonly close: () => Promise<void>;
};

/** 客户端身份替身：只固定"已持久恢复"这一事实（固定定位凭证），不模拟浏览器隔离语义。 */
function identityTarget(clientCredential: string): {indexedDB: IDBFactory; crypto: {getRandomValues: Crypto["getRandomValues"]}} {
    const factory = {
        open(): IDBOpenDBRequest {
            const request = {
                result: undefined as unknown,
                error: null as unknown,
                onupgradeneeded: null as (() => void) | null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onblocked: null as (() => void) | null,
            };
            let pending = 0;
            let completed = false;
            const transaction = {
                error: null as unknown,
                oncomplete: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onabort: null as (() => void) | null,
                objectStore: () => ({
                    get() {
                        const outcome: {result: unknown; onsuccess: (() => void) | null} = {result: undefined, onsuccess: null};
                        pending += 1;
                        queueMicrotask(() => {
                            outcome.result = clientCredential;
                            outcome.onsuccess?.();
                            pending -= 1;
                            settle();
                        });
                        return outcome;
                    },
                    put() {
                        const outcome: {result: unknown; onsuccess: (() => void) | null} = {result: undefined, onsuccess: null};
                        pending += 1;
                        queueMicrotask(() => {
                            outcome.onsuccess?.();
                            pending -= 1;
                            settle();
                        });
                        return outcome;
                    },
                }),
            };
            const settle = (): void => {
                if (pending > 0 || completed) return;
                completed = true;
                queueMicrotask(() => transaction.oncomplete?.());
            };
            const connection = {
                onversionchange: null as (() => void) | null,
                objectStoreNames: {contains: () => true},
                createObjectStore: () => undefined,
                close: () => undefined,
                transaction: () => transaction,
            };
            request.result = connection;
            queueMicrotask(() => {
                request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request as unknown as IDBOpenDBRequest;
        },
    };
    return {indexedDB: factory as unknown as IDBFactory, crypto: globalThis.crypto};
}

/** 浏览器暂存替身：本夹具关心 data 侧与流水；浏览器侧 IndexedDB 行为由专属探针/产品单测覆盖。 */
export function stagingStub(raw: string): LegacyBucketStaging {
    return {
        async ensure() {
            const measured = measureLegacyOriginal(raw);
            return {
                status: "original",
                original: {
                    source: "novel.ide.local",
                    version: 1,
                    capturedAt: "2026-09-16T00:00:00.000Z",
                    byteLength: measured.byteLength,
                    digest: measured.digest,
                    raw,
                },
            };
        },
    };
}

export async function createMigrationHarness(): Promise<MigrationHarness> {
    const host = await createStorageActionHost();
    // 与生产 Nitro 插件插件体完全相同的登记调用（插件本体由 Q7 探针单独驱动）。
    registerProductStorageDefinitions();
    const actions: ActionLogEntry[] = [];
    let failures: SaveFailureInjection[] = [];
    let readGates: {readonly owner: string; readonly key: string; readonly resource: string | null; readonly promise: Promise<void>}[] = [];
    const credential = STORAGE_TEST_CLIENT_A;
    let contextId: string | undefined;

    const ensureContext = async (): Promise<string> => {
        contextId ??= await host.issue(credential);
        return contextId;
    };

    const record = (body: unknown): void => {
        if (typeof body !== "object" || body === null) return;
        const action = body as {kind?: unknown; owner?: unknown; key?: unknown; resource?: unknown};
        if (typeof action.kind !== "string" || typeof action.owner !== "string") return;
        actions.push({
            kind: action.kind,
            owner: action.owner,
            key: typeof action.key === "string" ? action.key : "",
            resource: typeof action.resource === "string" ? action.resource : null,
        });
    };

    /** 浏览器适配器的 Host 请求映射到隔离宿主的真实 HTTP 入口；顺带记流水与注入失败。 */
    const request = async (path: string, options: {method?: string; body?: unknown; headers?: unknown} = {}): Promise<unknown> => {
        const headers = (options.headers ?? {}) as Record<string, string>;
        record(options.body);
        const gated = (() => {
            const body = options.body as {kind?: unknown; owner?: unknown; key?: unknown; resource?: unknown} | undefined;
            if (typeof body !== "object" || body === null || body.kind !== "read") return null;
            const index = readGates.findIndex((item) => item.owner === body.owner && item.key === body.key
                && item.resource === (typeof body.resource === "string" ? body.resource : null));
            if (index === -1) return null;
            const gate = readGates[index]!;
            readGates = readGates.filter((_, position) => position !== index);
            return gate.promise;
        })();
        if (gated !== null) {
            await gated;
        }
        const injected = (() => {
            const body = options.body as {kind?: unknown; owner?: unknown; key?: unknown; resource?: unknown} | undefined;
            if (typeof body !== "object" || body === null || body.kind !== "save") return false;
            const index = failures.findIndex((item) => item.owner === body.owner && item.key === body.key
                && (item.resource ?? null) === (typeof body.resource === "string" ? body.resource : null));
            if (index === -1) return false;
            const pending = failures[index]!;
            failures = pending.times <= 1
                ? failures.filter((_, position) => position !== index)
                : failures.map((item, position) => (position === index ? {...item, times: item.times - 1} : item));
            return true;
        })();
        if (injected) {
            throw new Error("注入的写入失败");
        }
        const response = await host.request(path, {
            method: typeof options.method === "string" ? options.method : "GET",
            body: options.body,
            credential: headers[STORAGE_CLIENT_CREDENTIAL_HEADER],
            contextId: headers[STORAGE_ACCESS_CONTEXT_HEADER],
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
            throw Object.assign(new Error(`Storage HTTP ${String(response.status)}`), {data: payload, status: response.status});
        }
        return payload;
    };

    const contextOptions: StorageContextOpenOptions = {
        request,
        identity: identityTarget(credential),
    };

    const count = (kind: string, owner: string, key: string, resource?: string): number =>
        actions.filter((item) => item.kind === kind && item.owner === owner && item.key === key
            && (resource === undefined || item.resource === resource)).length;

    const address = (owner: string, key: string, resource?: string): {owner: string; key: string; resource?: string} =>
        resource === undefined ? {owner, key} : {owner, key, resource};

    return {
        host,
        get actions() {
            return actions;
        },
        count,
        mark: () => actions.length,
        writesSince: (mark) => actions.slice(mark).filter((item) => item.kind === "save" || item.kind === "repair" || item.kind === "remove"),
        controller: (raw) => {
            const adapters: StorageMigrationAdapters = {
                openUserContext: () => openStorageUserContext(contextOptions),
                openOwnerHandle: (input) => openStorageOwnerHandle({
                    ...input,
                    transport: createStorageHttpTransport({session: input.session, request}),
                    subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
                }),
                closeContext: (session) => closeStorageContext(session, {request}),
            };
            return createStorageMigration({staging: stagingStub(raw), adapters, now: () => "2026-09-16T00:00:00.000Z"});
        },
        failNextSave(injection) {
            failures = [...failures, injection];
        },
        holdNextRead(owner, key, resource) {
            const {promise, resolve} = Promise.withResolvers<void>();
            readGates = [...readGates, {owner, key, resource: resource ?? null, promise}];
            return resolve;
        },
        async recordText(owner, key, resource) {
            return await readFile(await host.recordPath(address(owner, key, resource)), "utf8").catch(() => null);
        },
        async recordPath(owner, key, resource) {
            return await host.recordPath(address(owner, key, resource));
        },
        async partitionRecordBytes(owner) {
            const paths = await host.partition({owner});
            const names = await readdir(paths.recordsDirectory).catch(() => []);
            let total = 0;
            for (const name of names) {
                const info = await stat(path.join(paths.recordsDirectory, name)).catch(() => null);
                if (info?.isFile()) total += info.size;
            }
            return total;
        },
        async act(action) {
            const current = await ensureContext();
            // 分区代次绑定按 owner 取；两个 owner 的分区不同，动作前按需重取。
            const ownerBinding = await host.bind(current, action.owner, {credential});
            const response = await host.act(current, {...action, binding: ownerBinding}, {credential});
            const payload: unknown = await response.json();
            if (!response.ok) {
                throw Object.assign(new Error(`Storage HTTP ${String(response.status)}`), {data: payload, status: response.status});
            }
            return payload;
        },
        async read(owner, key, resource) {
            const payload = await this.act({
                kind: "read",
                owner,
                key,
                schemaVersion: 1,
                ...(resource === undefined ? {} : {resource}),
            });
            return (payload as {result: StorageReadResult<unknown>}).result;
        },
        async close() {
            await host.close();
        },
    };
}
