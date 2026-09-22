import {readFile} from "node:fs/promises";
import {describe, expect, it, vi} from "vitest";

vi.mock("nitropack/runtime", () => ({
    defineNitroPlugin: (plugin: unknown) => plugin,
}));

import storageDefinitionsPlugin from "nbook/server/plugins/storage-definitions";
import {
    createStorageActionHost,
    STORAGE_TEST_CLIENT_A,
} from "nbook/server/storage/fixtures/storage-action-host";
import {STORAGE_MAX_VALUE_BYTES} from "nbook/shared/storage/contract";
import type {StorageJsonValue} from "nbook/shared/storage/bounded-json";
import {
    WORKBENCH_MIGRATION_CHUNK_BYTES,
    WORKBENCH_MIGRATION_METADATA_RESERVE_BYTES,
    WORKBENCH_MIGRATION_OWNER,
    WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES,
    WORKBENCH_MIGRATION_PARTITION_BYTES,
    WORKBENCH_MIGRATION_PROGRESS_KEY,
    estimateWorkbenchMigrationRecordBytes,
    type WorkbenchMigrationOriginalRecord,
    type WorkbenchMigrationProgressRecord,
} from "nbook/shared/storage/workbench-migration";
import {serializeStorageRecord} from "nbook/server/storage/record-codec";
import {productStorageDefinitions} from "nbook/server/storage/product-definitions";
import {WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY} from "nbook/shared/storage/workbench-state";
import {closeStorageContext, openStorageUserContext, type StorageHostRequest} from "nbook/app/utils/storage/host-context-client";
import {STORAGE_ACCESS_CONTEXT_HEADER, STORAGE_CLIENT_CREDENTIAL_HEADER} from "nbook/shared/storage/host";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import {createStorageHttpTransport} from "nbook/app/utils/storage/value-transport";
import {
    createStorageMigration,
    type StorageMigrationAdapters,
    type StorageMigrationController,
} from "nbook/app/utils/workbench/storage-migration";
import {measureLegacyOriginal, splitLegacyOriginalChunks, type LegacyBucketStaging} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

/**
 * 生产注册入口与迁移备份边界的真实可达性。
 *
 * 这里跑的是**产品路径**：真实 HTTP 监听 + 真实 H3 路由 + 隔离临时根 + 真实浏览器适配器
 * （`openStorageUserContext` / `openStorageOwnerHandle` / `createStorageHttpTransport`），
 * 定义来自 `server/plugins/storage-definitions.ts` 这个 Nitro 插件本身，而不是测试注入。
 */

const LEGACY_BUCKET = JSON.stringify({leftPanelWidth: 427, agentPanelWidth: 488, projectPickerLayoutMode: "compact"});

/** 生产插件：`defineNitroPlugin` 被替换成恒等函数，注册逻辑与运行时完全相同。 */
function runStorageDefinitionsPlugin(): void {
    (storageDefinitionsPlugin as unknown as () => void)();
}

/** 把浏览器适配器的 Host 请求映射到隔离宿主的真实 HTTP 入口。 */
function hostRequestFor(host: Awaited<ReturnType<typeof createStorageActionHost>>): StorageHostRequest {
    return async (path, options = {}) => {
        const headers = (options.headers ?? {}) as Record<string, string>;
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
}

/**
 * 客户端身份替身：只固定"已持久恢复"这一事实（固定定位凭证），不模拟浏览器隔离语义。
 *
 * 凭证与 fixture 的默认客户端一致，因此可以用 `recordPath` 直接定位该客户端分区里的记录文件。
 */
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
            type FakeRequest = {result: unknown; onsuccess: (() => void) | null};
            type FakeTransaction = {
                error: unknown;
                oncomplete: (() => void) | null;
                onerror: (() => void) | null;
                onabort: (() => void) | null;
                objectStore: (name: string) => {
                    get: () => FakeRequest;
                    put: () => FakeRequest;
                };
            };
            const transaction = {
                error: null as unknown,
                oncomplete: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onabort: null as (() => void) | null,
            } as FakeTransaction;
            let pending = 0;
            let completed = false;
            const settle = (): void => {
                if (pending > 0 || completed) return;
                completed = true;
                queueMicrotask(() => transaction.oncomplete?.());
            };
            const runRequest = (handler: () => void): void => {
                pending += 1;
                queueMicrotask(() => {
                    handler();
                    pending -= 1;
                    settle();
                });
            };
            transaction.objectStore = () => ({
                get(): {result: unknown; onsuccess: (() => void) | null} {
                    const get = {result: clientCredential as unknown, onsuccess: null as (() => void) | null};
                    runRequest(() => get.onsuccess?.());
                    return get;
                },
                put(): {result: unknown; onsuccess: (() => void) | null} {
                    const put = {result: undefined as unknown, onsuccess: null as (() => void) | null};
                    runRequest(() => put.onsuccess?.());
                    return put;
                },
            });
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
    return {
        indexedDB: factory as unknown as IDBFactory,
        crypto: globalThis.crypto,
    };
}

/** 浏览器暂存替身：这里关心的是 data 侧是否可达，浏览器侧暂存行为由专属单测覆盖。 */
function stagingStub(raw: string): LegacyBucketStaging {
    return {
        async ensure() {
            const measured = measureLegacyOriginal(raw);
            return {
                status: "original",
                original: {source: "novel.ide.local", version: 1, capturedAt: "2026-09-16T00:00:00.000Z", byteLength: measured.byteLength, digest: measured.digest, raw},
            };
        },
    };
}

function controllerFor(host: Awaited<ReturnType<typeof createStorageActionHost>>): StorageMigrationController {
    const request = hostRequestFor(host);
    const identity = identityTarget(STORAGE_TEST_CLIENT_A);
    const adapters: StorageMigrationAdapters = {
        openUserContext: () => openStorageUserContext({request, identity}),
        openOwnerHandle: (input) => openStorageOwnerHandle({
            ...input,
            transport: createStorageHttpTransport({session: input.session, request}),
            subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
        }),
        closeContext: (session) => closeStorageContext(session, {request}),
    };
    return createStorageMigration({staging: stagingStub(LEGACY_BUCKET), adapters, now: () => "2026-09-16T00:00:00.000Z"});
}

describe("产品定义注册与迁移边界可达性", () => {
    it("注册前 workbench.migration 不可达，Nitro 插件注册后经真实 HTTP 可读写", async () => {
        const host = await createStorageActionHost();
        try {
            const contextId = await host.issue();
            const before = await host.act(contextId, {kind: "bind", owner: WORKBENCH_MIGRATION_OWNER});
            expect(before.status).toBeGreaterThanOrEqual(400);
            expect(await before.text()).toContain("STORAGE_STATE_UNREGISTERED");

            runStorageDefinitionsPlugin();

            const binding = await host.bind(contextId, WORKBENCH_MIGRATION_OWNER);
            const progress: WorkbenchMigrationProgressRecord = {
                source: "novel.ide.local",
                version: 1,
                updatedAt: "2026-09-16T00:00:00.000Z",
                entries: [],
            };
            const saved = await host.act(contextId, {
                kind: "save",
                owner: WORKBENCH_MIGRATION_OWNER,
                key: WORKBENCH_MIGRATION_PROGRESS_KEY,
                schemaVersion: 1,
                binding,
                expected: {revision: null, partitionGeneration: binding.local},
                value: progress,
            });
            expect(saved.status).toBe(200);

            const read = await host.act(contextId, {
                kind: "read",
                owner: WORKBENCH_MIGRATION_OWNER,
                key: WORKBENCH_MIGRATION_PROGRESS_KEY,
                schemaVersion: 1,
                binding,
            });
            expect(await read.json()).toMatchObject({kind: "read", result: {kind: "value", value: progress}});

            // 记录落在隔离根内的 Storage 分区，不进入普通文件树之外的路径。
            const recordPath = await host.recordPath({owner: WORKBENCH_MIGRATION_OWNER, key: WORKBENCH_MIGRATION_PROGRESS_KEY});
            expect(recordPath.startsWith(host.root)).toBe(true);
            expect(await readFile(recordPath, "utf8")).toContain("novel.ide.local");
        } finally {
            await host.close();
        }
    });

    it("迁移适配器经真实浏览器适配器走完备份与导入（隔离根 + 真实端口）", async () => {
        const host = await createStorageActionHost();
        try {
            // 定义实例在模块级只构造一次：dev HMR 重新执行插件不会产生重复注册冲突。
            runStorageDefinitionsPlugin();
            runStorageDefinitionsPlugin();
            const migration = controllerFor(host);

            await migration.start();

            expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
            expect(migration.snapshot().original?.digest).toBe(measureLegacyOriginal(LEGACY_BUCKET).digest);

            // data 原件：清单 + 分块都在备份边界里，且原样可拼接回原文。
            const manifestPath = await host.recordPath({owner: WORKBENCH_MIGRATION_OWNER, key: "original"});
            const manifestText = await readFile(manifestPath, "utf8");
            expect(manifestText).toContain(measureLegacyOriginal(LEGACY_BUCKET).digest);
            const chunkPath = await host.recordPath({owner: WORKBENCH_MIGRATION_OWNER, key: "original-chunk", resource: "chunk-000"});
            expect(await readFile(chunkPath, "utf8")).toContain("projectPickerLayoutMode");

            // 迁移目标：显式 user 工作面尺寸与书架模式各自成record。
            const idlePath = await host.recordPath({owner: WORKBENCH_LAYOUT_OWNER, key: WORKBENCH_SURFACE_SIZES_KEY, resource: "idle"});
            const idleText = await readFile(idlePath, "utf8");
            expect(idleText).toContain("427");
            expect(idleText).toContain("488");
            const userAssetsPath = await host.recordPath({owner: WORKBENCH_LAYOUT_OWNER, key: WORKBENCH_SURFACE_SIZES_KEY, resource: "user-assets"});
            expect(await readFile(userAssetsPath, "utf8")).toContain("427");
            const shelfPath = await host.recordPath({owner: WORKBENCH_LAYOUT_OWNER, key: "shelf-mode"});
            expect(await readFile(shelfPath, "utf8")).toContain("compact");
            const completionPath = await host.recordPath({owner: WORKBENCH_MIGRATION_OWNER, key: "completion"});
            expect(await readFile(completionPath, "utf8")).toContain("\"completedAt\":\"2026-09-16T00:00:00.000Z\"");
        } finally {
            await host.close();
        }
    });

    it("模块重载后重复注册仍幂等，宿主继续用已登记的定义服务", async () => {
        const host = await createStorageActionHost();
        try {
            const plugin = (await import("nbook/server/plugins/storage-definitions")).default as unknown as () => void;
            plugin();
            const contextId = await host.issue();
            await expect(host.bind(contextId, WORKBENCH_LAYOUT_OWNER)).resolves.toBeDefined();
            const beforeReload = productStorageDefinitions();

            // 模拟 HMR：模块图重新实例化（宿主全局槽保留注册表，这是宿主自己的 HMR 交接设计）。
            vi.resetModules();
            await import("nbook/server/storage/host");
            const reloaded = await import("nbook/server/storage/product-definitions");
            const pluginAfterReload = (await import("nbook/server/plugins/storage-definitions")).default as unknown as () => void;

            expect(() => pluginAfterReload()).not.toThrow();
            // 定义实例跨重载复用：注册是同一实例的幂等重复，而不是另一个实例的冲突。
            expect(reloaded.productStorageDefinitions()).toBe(beforeReload);
            await expect(host.bind(contextId, WORKBENCH_LAYOUT_OWNER)).resolves.toBeDefined();
            await expect(host.bind(contextId, WORKBENCH_MIGRATION_OWNER)).resolves.toBeDefined();
        } finally {
            await host.close();
        }
    });

    it("记录文件字节口径：估算上界覆盖真实封装，常规 8 MiB 原件仍在声明分区内", () => {
        // 估算必须是不小于真实记录文件的**上界**：它决定"被接受的元件一定放得进分区"。
        const samples: StorageJsonValue[] = [
            "",
            "plain ascii",
            "\"".repeat(4096),
            "\\\\".repeat(4096),
            "中文 😀 混排".repeat(2000),
            "quote\"backslash\\newline\n中文".repeat(1000),
            {leftPanelWidth: 427, monacoEditorPreferences: {nested: "\"quoted\"".repeat(200)}},
        ];
        for (const sample of samples) {
            expect(estimateWorkbenchMigrationRecordBytes(sample)).toBeGreaterThanOrEqual(recordFileBytes(sample as StorageJsonValue));
        }

        // 常规 8 MiB 旧桶（JSON 结构、转义比例正常）按记录文件字节计仍落在 9 MiB 声明内。
        const filler = "这是一段普通配置文本 with ascii padding ".repeat(160_000);
        const raw = JSON.stringify({
            leftPanelWidth: 427,
            agentPanelWidth: 488,
            projectPickerLayoutMode: "compact",
            markdownEditorPreferences: {filler},
        });
        const chunks = splitLegacyOriginalChunks(raw);
        const manifest: WorkbenchMigrationOriginalRecord = {
            source: "novel.ide.local",
            version: 1,
            capturedAt: "2026-09-16T00:00:00.000Z",
            byteLength: measureLegacyOriginal(raw).byteLength,
            digest: measureLegacyOriginal(raw).digest,
            chunkCount: chunks.length,
            chunkBytes: WORKBENCH_MIGRATION_CHUNK_BYTES,
        };
        // 接近但不超过声明上限的常规旧桶：8 MiB 级，且分块后仍是多条记录。
        expect(manifest.byteLength).toBeGreaterThan(WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES * 0.9);
        expect(manifest.byteLength).toBeLessThanOrEqual(WORKBENCH_MIGRATION_ORIGINAL_LIMIT_BYTES);
        expect(chunks.length).toBeGreaterThan(4);
        const projected = chunks.reduce((total, chunk) => total + estimateWorkbenchMigrationRecordBytes(chunk), 0)
            + estimateWorkbenchMigrationRecordBytes(manifest)
            + WORKBENCH_MIGRATION_METADATA_RESERVE_BYTES;
        expect(projected).toBeLessThanOrEqual(WORKBENCH_MIGRATION_PARTITION_BYTES);
        // 单块仍满足单条硬上限。
        for (const chunk of chunks) {
            expect(recordFileBytes(chunk)).toBeLessThanOrEqual(STORAGE_MAX_VALUE_BYTES);
        }
    });
});

/** 产品自己的记录编码器算出的记录文件字节数（含封装与结尾换行）。 */
function recordFileBytes(value: StorageJsonValue): number {
    return Buffer.byteLength(serializeStorageRecord({
        kind: "value",
        revision: "0".repeat(36),
        schemaVersion: 1,
        value,
    }), "utf8");
}
