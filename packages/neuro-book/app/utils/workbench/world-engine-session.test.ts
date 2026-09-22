import {effectScope, ref} from "vue";
import {describe, expect, it} from "vitest";
import type {Ref} from "vue";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageProjectContextTarget} from "nbook/app/utils/storage/host-context-client";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
} from "nbook/app/utils/workbench/storage-context";
import type {WorkbenchLayoutSurface} from "nbook/app/utils/workbench/layout-session";
import {
    useWorldEnginePanelSizes,
    type WorldEnginePanelSizesConsumer,
} from "nbook/app/utils/workbench/world-engine-session";
import {WORKBENCH_LAYOUT_OWNER} from "nbook/shared/storage/workbench-state";
import {
    WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES,
    WORKBENCH_WORLD_ENGINE_SIZES_KEY,
} from "nbook/shared/storage/workbench-world-engine";

/**
 * World Engine 内部尺寸的 project/local 记录行为：单一写者、首读门禁、条件初始化与冲突不静默。
 *
 * 走真实记录会话（读取分类、条件写、订阅都来自产品实现），只把传输与身份换成替身：
 * 断言的是落盘记录路径、落盘 JSON、显示与工作面切换语义，不是 stub 的调用次数。
 */

const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);
const READY_A = {projectRoot: "/workspace/a", publicId: "runtime-a:1", revision: 1} as const;
const READY_B = {projectRoot: "/workspace/b", publicId: "runtime-b:1", revision: 2} as const;
const PROJECT_A: WorkbenchLayoutSurface = {kind: "project", ready: READY_A};
const PROJECT_B: WorkbenchLayoutSurface = {kind: "project", ready: READY_B};

type StoredRecord = {value: unknown; revision: string; schemaVersion: number};

/** 读取闸：首读门禁测试用它把读取停在"未分类"状态。 */
type ReadGate = {readonly reads: Promise<void>; readonly release: () => void};

function readGate(): ReadGate {
    const {promise, resolve} = Promise.withResolvers<void>();
    return {reads: promise, release: resolve};
}

type Harness = {
    readonly records: Map<string, StoredRecord>;
    readonly saves: string[];
    readonly hooks: {beforeSave: ((key: string) => void) | null};
    readonly adapters: WorkbenchStorageAdapters;
    /** 记录地址：`project:<projectRoot>/<owner>/<key>/`。 */
    key(projectRoot: string): string;
    /** 让后续读取全部停在闸上；返回放行函数。 */
    holdReads(): () => void;
    write(projectRoot: string, value: unknown, schemaVersion?: number): void;
};

function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const saves: string[] = [];
    const hooks: Harness["hooks"] = {beforeSave: null};
    const gate: {current: ReadGate} = {current: {reads: Promise.resolve(), release: () => undefined}};
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});
    const key = (projectRoot: string): string => `project:${projectRoot}/${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_WORLD_ENGINE_SIZES_KEY}/`;

    /** 每个 project 会话有自己的传输：记录地址里带 projectRoot，切 Project 必换记录。 */
    const transportFor = (projectRoot: string): StorageValueTransport => ({
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            if (action.owner !== WORKBENCH_LAYOUT_OWNER || action.key !== WORKBENCH_WORLD_ENGINE_SIZES_KEY) {
                throw new Error(`测试未登记的记录：${action.owner}/${action.key}`);
            }
            const address = key(projectRoot);
            if (action.kind === "read") {
                await gate.current.reads;
                const record = records.get(address);
                if (record === undefined) {
                    return {kind: "read", result: {kind: "missing", credential: credential(null)}};
                }
                return {
                    kind: "read",
                    result: {
                        kind: "value",
                        value: record.value,
                        schemaVersion: record.schemaVersion,
                        credential: credential(record.revision),
                    },
                };
            }
            if (action.kind === "save") {
                hooks.beforeSave?.(address);
                const record = records.get(address);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw new StorageAdapterError({
                        code: "STORAGE_REVISION_CONFLICT",
                        status: 409,
                        message: "记录已被其它窗口改写",
                        committed: false,
                    });
                }
                records.set(address, {
                    value: action.value,
                    revision: `revision-${++sequence}`,
                    schemaVersion: action.schemaVersion,
                });
                saves.push(address);
                return {kind: "save", credential: credential(`revision-${sequence}`)};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    });

    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({
            status: "ready",
            session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
        }),
        openProjectContext: async (target: StorageProjectContextTarget) => ({
            status: "ready",
            session: {
                scope: "project",
                contextId: "project".padEnd(64, "p"),
                clientCredential: CLIENT_CREDENTIAL,
                projectRoot: target.projectRoot,
                publicId: target.publicId,
            },
        }),
        openOwnerHandle: async (options) => {
            const session = options.session;
            return await openStorageOwnerHandle({
                ...options,
                transport: transportFor(session.scope === "project" ? session.projectRoot : "user"),
                subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
            });
        },
        closeContext: async () => undefined,
    };

    return {
        records,
        saves,
        hooks,
        adapters,
        key,
        holdReads(): () => void {
            gate.current = readGate();
            return gate.current.release;
        },
        write(projectRoot: string, value: unknown, schemaVersion = 1): void {
            records.set(key(projectRoot), {value, revision: `revision-${++sequence}`, schemaVersion});
        },
    };
}

/** 打开一个尺寸会话；`surface` 用 ref 注入，测试据它模拟工作面切换。 */
function openSession(harness: Harness, surface: Ref<WorkbenchLayoutSurface>): {
    consumer: WorldEnginePanelSizesConsumer;
    stop(): void;
} {
    const scope = effectScope();
    const consumer = scope.run(() => useWorldEnginePanelSizes({
        surface: () => surface.value,
        adapters: harness.adapters,
    }))!;
    return {consumer, stop: () => scope.stop()};
}

/**
 * 只推进微任务直到条件成立：被等待的链路全是 Promise（没有真实定时器参与），
 * 因此不需要真实时间，也不会因为机器负载产生假失败。
 */
async function flushUntil(condition: () => boolean): Promise<void> {
    for (let step = 0; step < 2000 && !condition(); step += 1) {
        await Promise.resolve();
    }
    if (!condition()) {
        throw new Error("等待条件成立失败（微任务已推进到底）");
    }
}

describe("useWorldEnginePanelSizes", () => {
    it("首读门禁：读取未分类前不落盘，读完后按本次拖动写一次（含记录路径与 JSON）", async () => {
        const harness = storageHarness();
        const release = harness.holdReads();
        const surface = ref<WorkbenchLayoutSurface>(PROJECT_A);
        const opened = openSession(harness, surface);

        const committed = opened.consumer.commit({sidebarWidth: 300});
        await flushUntil(() => false).catch(() => undefined);
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.sizes.value).toEqual(WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES);
        expect(opened.consumer.loading.value).toBe(true);

        release();
        await committed;
        expect(harness.saves).toEqual([harness.key(READY_A.projectRoot)]);
        expect(opened.consumer.sizes.value).toEqual({...WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES, sidebarWidth: 300});
        // 只写本次拖过的字段：另外两个面板不因为"没拖过"被写成默认值。
        expect(harness.records.get(harness.key(READY_A.projectRoot))?.value).toEqual({sidebarWidth: 300});
        opened.stop();
    });

    it("记录缺失时不写默认值：首次读取完成也不会产生记录", async () => {
        const harness = storageHarness();
        const opened = openSession(harness, ref<WorkbenchLayoutSurface>(PROJECT_A));

        await flushUntil(() => !opened.consumer.loading.value);
        expect(harness.saves).toEqual([]);
        expect(harness.records.size).toBe(0);
        expect(opened.consumer.sizes.value).toEqual(WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("已确认记录恢复：记录里缺的字段回落产品默认", async () => {
        const harness = storageHarness();
        harness.write(READY_A.projectRoot, {sidebarWidth: 380, inspectorWidth: 480});
        const opened = openSession(harness, ref<WorkbenchLayoutSurface>(PROJECT_A));

        await flushUntil(() => !opened.consumer.loading.value);
        expect(opened.consumer.sizes.value).toEqual({sidebarWidth: 380, inspectorWidth: 480, mutationEditorHeight: 292});
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("相邻面板不被覆盖：原件字段保留，只改本次拖动的那个", async () => {
        const harness = storageHarness();
        harness.write(READY_A.projectRoot, {sidebarWidth: 380, futureField: "keep"});
        const opened = openSession(harness, ref<WorkbenchLayoutSurface>(PROJECT_A));

        await flushUntil(() => !opened.consumer.loading.value);
        await opened.consumer.commit({inspectorWidth: 500});
        expect(harness.records.get(harness.key(READY_A.projectRoot))?.value)
            .toEqual({sidebarWidth: 380, futureField: "keep", inspectorWidth: 500});
        expect(opened.consumer.sizes.value).toEqual({sidebarWidth: 380, inspectorWidth: 500, mutationEditorHeight: 292});
        opened.stop();
    });

    it("冲突不静默：未确认意图保留并显示诊断，重试后写入一次", async () => {
        const harness = storageHarness();
        let conflictSequence = 0;
        harness.hooks.beforeSave = (address) => {
            conflictSequence += 1;
            harness.records.set(address, {
                value: {sidebarWidth: 999},
                revision: `revision-conflict-${conflictSequence}`,
                schemaVersion: 1,
            });
        };
        const opened = openSession(harness, ref<WorkbenchLayoutSurface>(PROJECT_A));

        await flushUntil(() => !opened.consumer.loading.value);
        await opened.consumer.commit({mutationEditorHeight: 400});
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.sizes.value.mutationEditorHeight).toBe(400);
        expect(opened.consumer.notice.value?.retryable).toBe(true);
        expect(opened.consumer.notice.value?.diagnosis).toContain("记录已被其它窗口改写");

        harness.hooks.beforeSave = null;
        await opened.consumer.retry();
        expect(harness.saves).toEqual([harness.key(READY_A.projectRoot)]);
        expect(opened.consumer.notice.value).toBeNull();
        // 重读后只重放本次主动字段：另一写者写下的 sidebarWidth 属于原件，保留。
        expect(harness.records.get(harness.key(READY_A.projectRoot))?.value)
            .toEqual({sidebarWidth: 999, mutationEditorHeight: 400});
        opened.stop();
    });

    it("放弃未确认意图回到已确认值", async () => {
        const harness = storageHarness();
        harness.write(READY_A.projectRoot, {sidebarWidth: 380});
        const opened = openSession(harness, ref<WorkbenchLayoutSurface>(PROJECT_A));

        await flushUntil(() => !opened.consumer.loading.value);
        harness.hooks.beforeSave = () => {
            throw new StorageAdapterError({
                code: "STORAGE_IO",
                status: 500,
                message: "写入结果未确认",
                committed: null,
            });
        };
        await opened.consumer.commit({sidebarWidth: 300});
        expect(opened.consumer.sizes.value.sidebarWidth).toBe(300);

        opened.consumer.abandon();
        expect(opened.consumer.sizes.value.sidebarWidth).toBe(380);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("非 Project 工作面：不恢复记录也不落盘", async () => {
        const harness = storageHarness();
        harness.write(READY_A.projectRoot, {sidebarWidth: 380});
        const surface = ref<WorkbenchLayoutSurface>(PROJECT_A);
        const opened = openSession(harness, surface);

        await flushUntil(() => !opened.consumer.loading.value);
        expect(opened.consumer.sizes.value.sidebarWidth).toBe(380);

        surface.value = {kind: "idle"};
        await flushUntil(() => opened.consumer.sizes.value.sidebarWidth === 320);
        await opened.consumer.commit({sidebarWidth: 300});
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("切 Project 读各自的记录：同一 ready 代次不重复进入，换项目换记录", async () => {
        const harness = storageHarness();
        harness.write(READY_A.projectRoot, {sidebarWidth: 380});
        harness.write(READY_B.projectRoot, {sidebarWidth: 460});
        const surface = ref<WorkbenchLayoutSurface>(PROJECT_A);
        const opened = openSession(harness, surface);

        await flushUntil(() => opened.consumer.sizes.value.sidebarWidth === 380);
        expect(harness.saves).toEqual([]);

        surface.value = PROJECT_B;
        await flushUntil(() => opened.consumer.sizes.value.sidebarWidth === 460);
        expect(harness.saves).toEqual([]);
        opened.stop();
    });
});
