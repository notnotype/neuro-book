import {effectScope} from "vue";
import {describe, expect, it} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import type {LegacyValueReading, LegacyValueStore} from "nbook/app/utils/workbench/legacy-record-migration";
import {
    LEGACY_CREATE_PROJECT_WINDOW_SIZE_KEY,
    LEGACY_SETTINGS_WINDOW_SIZE_KEY,
    parseLegacyWindowSize,
    useCreateProjectWindowSize,
    useSettingsWindowSize,
    type WorkbenchWindowSizeConsumer,
} from "nbook/app/utils/workbench/window-size-session";
import {WORKBENCH_LAYOUT_OWNER} from "nbook/shared/storage/workbench-state";
import {
    WORKBENCH_CREATE_PROJECT_WINDOW_SIZE_KEY,
    WORKBENCH_SETTINGS_WINDOW_MIN_SIZE,
    WORKBENCH_SETTINGS_WINDOW_SIZE_KEY,
} from "nbook/shared/storage/workbench-window-sizes";

/**
 * 两个普通窗口尺寸记录的行为：单一写者、首读门禁、条件初始化，以及旧裸键
 * （`nbook.settingsDialog.size` / `nbook.projectCreateDialog.size.v2`）的一次性迁移与回读验证。
 *
 * 走真实记录会话（读取分类、条件写、订阅都来自产品实现），只把传输与旧键访问器换成替身：
 * 断言的是落盘记录路径、落盘 JSON 与显示语义，不是 stub 的调用次数。
 */

const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);
const SETTINGS_RECORD_KEY = `${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_SETTINGS_WINDOW_SIZE_KEY}/`;
const CREATE_PROJECT_RECORD_KEY = `${WORKBENCH_LAYOUT_OWNER}/${WORKBENCH_CREATE_PROJECT_WINDOW_SIZE_KEY}/`;

type StoredRecord = {value: unknown; revision: string; schemaVersion: number};

/** 读取闸：首读门禁测试用它把读取停在"未分类"状态。 */
type ReadGate = {readonly reads: Promise<void>; readonly release: () => void};

function readGate(): ReadGate {
    const {promise, resolve} = Promise.withResolvers<void>();
    return {reads: promise, release: resolve};
}

type Harness = {
    readonly records: Map<string, StoredRecord>;
    readonly fixedReads: Map<string, StorageReadResult<unknown>>;
    readonly saves: string[];
    readonly hooks: {beforeSave: ((key: string) => void) | null; afterSave: ((key: string) => void) | null};
    readonly adapters: WorkbenchStorageAdapters;
    /** 让后续读取全部停在闸上；返回放行函数。 */
    holdReads(): () => void;
    write(key: string, value: unknown, schemaVersion?: number): void;
};

function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const fixedReads = new Map<string, StorageReadResult<unknown>>();
    const saves: string[] = [];
    const hooks: Harness["hooks"] = {beforeSave: null, afterSave: null};
    const gate: {current: ReadGate} = {current: {reads: Promise.resolve(), release: () => undefined}};
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});

    const transport: StorageValueTransport = {
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            const key = `${action.owner}/${action.key}/${action.resource ?? ""}`;
            if (action.kind === "read") {
                await gate.current.reads;
                const fixed = fixedReads.get(key);
                if (fixed !== undefined) {
                    return {kind: "read", result: fixed};
                }
                const record = records.get(key);
                if (record === undefined) {
                    return {kind: "read", result: {kind: "missing", credential: credential(null)}};
                }
                if (record.schemaVersion < action.schemaVersion) {
                    return {
                        kind: "read",
                        result: {
                            kind: "legacy-value",
                            value: record.value,
                            schemaVersion: record.schemaVersion,
                            credential: credential(record.revision),
                        },
                    };
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
                hooks.beforeSave?.(key);
                const record = records.get(key);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw new StorageAdapterError({
                        code: "STORAGE_REVISION_CONFLICT",
                        status: 409,
                        message: "记录已被其它窗口改写",
                        committed: false,
                    });
                }
                records.set(key, {
                    value: action.value,
                    revision: `revision-${++sequence}`,
                    schemaVersion: action.schemaVersion,
                });
                saves.push(key);
                hooks.afterSave?.(key);
                return {kind: "save", credential: credential(`revision-${sequence}`)};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    };

    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({
            status: "ready",
            session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
        }),
        openProjectContext: async () => ({
            status: "unavailable",
            reason: "target-invalid",
            diagnosis: "本测试不涉及 Project Storage",
            code: null,
            statusCode: null,
        }),
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport,
            subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
        }),
        closeContext: async () => undefined,
    };

    return {
        records,
        fixedReads,
        saves,
        hooks,
        adapters,
        holdReads(): () => void {
            gate.current = readGate();
            return gate.current.release;
        },
        write(key: string, value: unknown, schemaVersion = 1): void {
            records.set(key, {value, revision: `revision-${++sequence}`, schemaVersion});
        },
    };
}

type LegacyFake = LegacyValueStore & {readonly remaining: string | null};

function legacyStore(initial: string | null): LegacyFake {
    let raw = initial;
    return {
        get remaining() {
            return raw;
        },
        read(): LegacyValueReading {
            return raw === null ? {kind: "absent"} : {kind: "value", raw};
        },
        remove(): boolean {
            raw = null;
            return true;
        },
    };
}

/** 打开一个设置窗口尺寸会话；`scope.stop()` 释放它（等价于组件卸载）。 */
function openSettingsWindow(harness: Harness, legacy: LegacyValueStore): {
    consumer: WorkbenchWindowSizeConsumer;
    stop(): void;
} {
    const scope = effectScope();
    const consumer = scope.run(() => useSettingsWindowSize({adapters: harness.adapters, legacy}))!;
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

describe("parseLegacyWindowSize", () => {
    it("非 JSON 与非对象都被当作不可迁移，不冒充「没有旧尺寸」", () => {
        expect(parseLegacyWindowSize("{not json", WORKBENCH_SETTINGS_WINDOW_MIN_SIZE))
            .toEqual({value: null, diagnosis: "旧键内容不是合法 JSON"});
        expect(parseLegacyWindowSize("[1120,640]", WORKBENCH_SETTINGS_WINDOW_MIN_SIZE))
            .toEqual({value: null, diagnosis: "旧键内容不是窗口尺寸对象"});
    });

    it("宽高不是有限数字时不可迁移；合法值取整并按最小尺寸夹紧", () => {
        expect(parseLegacyWindowSize("{\"width\":\"wide\",\"height\":640}", WORKBENCH_SETTINGS_WINDOW_MIN_SIZE))
            .toEqual({value: null, diagnosis: "旧键宽高不是有限数字"});
        expect(parseLegacyWindowSize("{\"width\":980.4,\"height\":640}", WORKBENCH_SETTINGS_WINDOW_MIN_SIZE))
            .toEqual({value: {width: 980, height: 640}, diagnosis: null});
    });
});

describe("窗口尺寸记录会话", () => {
    it("首读门禁：读取未分类前不落盘，读完后按本次调整写一次（含记录路径与 JSON）", async () => {
        const harness = storageHarness();
        const release = harness.holdReads();
        const opened = openSettingsWindow(harness, legacyStore(null));

        const committed = opened.consumer.commit({width: 1000, height: 700});
        await flushUntil(() => false).catch(() => undefined);
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.size.value).toEqual({width: 1120, height: 640});
        expect(opened.consumer.loading.value).toBe(true);

        release();
        await committed;
        expect(harness.saves).toEqual([SETTINGS_RECORD_KEY]);
        expect(opened.consumer.size.value).toEqual({width: 1000, height: 700});
        expect(harness.records.get(SETTINGS_RECORD_KEY)?.value).toEqual({width: 1000, height: 700});
        opened.stop();
    });

    it("记录缺失时不写默认值：首次读取完成也不会产生记录", async () => {
        const harness = storageHarness();
        const opened = openSettingsWindow(harness, legacyStore(null));

        await flushUntil(() => !opened.consumer.loading.value);
        expect(harness.saves).toEqual([]);
        expect(harness.records.size).toBe(0);
        expect(opened.consumer.size.value).toEqual({width: 1120, height: 640});
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("旧键迁移：记录缺失时条件初始化一次，回读一致后删除旧键", async () => {
        const harness = storageHarness();
        const legacy = legacyStore(JSON.stringify({width: 980, height: 700}));
        const opened = openSettingsWindow(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        expect(harness.saves).toEqual([SETTINGS_RECORD_KEY]);
        expect(harness.records.get(SETTINGS_RECORD_KEY)?.value).toEqual({width: 980, height: 700});
        expect(opened.consumer.size.value).toEqual({width: 980, height: 700});
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("已有记录不被旧键覆盖：只删旧键，不写记录", async () => {
        const harness = storageHarness();
        harness.write(SETTINGS_RECORD_KEY, {width: 800, height: 600});
        const legacy = legacyStore(JSON.stringify({width: 980, height: 700}));
        const opened = openSettingsWindow(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.size.value).toEqual({width: 800, height: 600});
        opened.stop();
    });

    it("旧尺寸低于窗口最小尺寸：夹紧后写入，回读一致仍收尾删除旧键", async () => {
        const harness = storageHarness();
        const legacy = legacyStore(JSON.stringify({width: 600, height: 300}));
        const opened = openSettingsWindow(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        expect(harness.records.get(SETTINGS_RECORD_KEY)?.value).toEqual({width: 720, height: 420});
        expect(opened.consumer.size.value).toEqual({width: 720, height: 420});
        opened.stop();
    });

    it("旧键无法解析：不迁移也不删除，并给出可见诊断", async () => {
        const harness = storageHarness();
        const legacy = legacyStore("{not json");
        const opened = openSettingsWindow(harness, legacy);

        await flushUntil(() => opened.consumer.notice.value !== null);
        expect(harness.saves).toEqual([]);
        expect(harness.records.size).toBe(0);
        expect(legacy.remaining).toBe("{not json");
        expect(opened.consumer.notice.value?.diagnosis).toContain("旧设置窗口尺寸记录未迁移");
        expect(opened.consumer.notice.value?.retryable).toBe(false);
        opened.stop();
    });

    it("冲突不静默：未确认意图保留并显示诊断，重试后写入一次", async () => {
        const harness = storageHarness();
        let conflictSequence = 0;
        harness.hooks.beforeSave = (key) => {
            conflictSequence += 1;
            harness.records.set(key, {
                value: {width: 640, height: 480},
                revision: `revision-conflict-${conflictSequence}`,
                schemaVersion: 1,
            });
        };
        const opened = openSettingsWindow(harness, legacyStore(null));

        await flushUntil(() => !opened.consumer.loading.value);
        await opened.consumer.commit({width: 1000, height: 700});
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.size.value).toEqual({width: 1000, height: 700});
        expect(opened.consumer.notice.value?.retryable).toBe(true);
        expect(opened.consumer.notice.value?.diagnosis).toContain("记录已被其它窗口改写");

        harness.hooks.beforeSave = null;
        await opened.consumer.retry();
        expect(harness.saves).toEqual([SETTINGS_RECORD_KEY]);
        expect(opened.consumer.notice.value).toBeNull();
        expect(harness.records.get(SETTINGS_RECORD_KEY)?.value).toEqual({width: 1000, height: 700});
        opened.stop();
    });

    it("新建作品对话框写自己的键，不碰设置窗口记录", async () => {
        const harness = storageHarness();
        const legacy = legacyStore(JSON.stringify({width: 640, height: 400}));
        const scope = effectScope();
        const consumer = scope.run(() => useCreateProjectWindowSize({adapters: harness.adapters, legacy}))!;

        await flushUntil(() => legacy.remaining === null);
        expect(harness.saves).toEqual([CREATE_PROJECT_RECORD_KEY]);
        expect(harness.records.get(CREATE_PROJECT_RECORD_KEY)?.value).toEqual({width: 640, height: 400});
        expect(harness.records.has(SETTINGS_RECORD_KEY)).toBe(false);
        expect(consumer.size.value).toEqual({width: 640, height: 400});
        scope.stop();
    });

    it("旧键名保持未改名：迁移读的是原键，不是新记录键", () => {
        expect(LEGACY_SETTINGS_WINDOW_SIZE_KEY).toBe("nbook.settingsDialog.size");
        expect(LEGACY_CREATE_PROJECT_WINDOW_SIZE_KEY).toBe("nbook.projectCreateDialog.size.v2");
    });
});
