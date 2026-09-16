import {effectScope} from "vue";
import {describe, expect, it} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {
    StorageAdapterError,
    type StorageValueTransport,
} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
} from "nbook/app/utils/workbench/storage-context";
import {
    LEGACY_FILE_TREE_EXPANDED_PATHS_KEY,
    parseLegacyExpandedPaths,
    useWorkbenchFileTreeExpandedPaths,
    type WorkbenchFileTreeExpandedPathsConsumer,
} from "nbook/app/utils/workbench/files-view-session";
import type {
    LegacyValueReading,
    LegacyValueStore,
} from "nbook/app/utils/workbench/legacy-record-migration";
import {
    WORKBENCH_FILES_OWNER,
    WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY,
} from "nbook/shared/storage/workbench-files";

/**
 * `files` 视图展开项记录的行为：单一写者、首读门禁、条件初始化，以及旧裸键
 * （`nbook.workspaceFilePanel.expandedPaths`）的一次性迁移与回读验证。
 *
 * 走真实记录会话（读取分类、条件写、订阅都来自产品实现），只把传输与旧键访问器换成替身：
 * 验证的是产品语义，不是 stub 的调用次数。
 */

const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);
const RECORD_KEY = `${WORKBENCH_FILES_OWNER}/${WORKBENCH_FILE_TREE_EXPANDED_PATHS_KEY}/`;

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
    /** 用户上下文故障开关：置字符串即让 `openUserContext` 返回不可用（诊断就是这段文字）。 */
    readonly userContextFailure: {current: string | null};
    readonly adapters: WorkbenchStorageAdapters;
    /** 让后续读取全部停在闸上；返回放行函数。 */
    holdReads(): () => void;
    write(value: unknown, schemaVersion?: number): void;
    storeKey(): string;
};

function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const fixedReads = new Map<string, StorageReadResult<unknown>>();
    const saves: string[] = [];
    const hooks: Harness["hooks"] = {beforeSave: null, afterSave: null};
    const userContextFailure: Harness["userContextFailure"] = {current: null};
    const gate: {current: ReadGate} = {current: {reads: Promise.resolve(), release: () => undefined}};
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});
    const storeKey = (): string => RECORD_KEY;

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
        openUserContext: async () => userContextFailure.current === null
            ? {
                status: "ready",
                session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
            }
            : {
                status: "unavailable",
                reason: "backend-unreachable",
                diagnosis: userContextFailure.current,
                code: null,
                statusCode: null,
            },
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
        userContextFailure,
        adapters,
        holdReads(): () => void {
            gate.current = readGate();
            return gate.current.release;
        },
        write(value: unknown, schemaVersion = 1): void {
            records.set(storeKey(), {value, revision: `revision-${++sequence}`, schemaVersion});
        },
        storeKey,
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

function openConsumer(harness: Harness, legacy: LegacyValueStore): {
    consumer: WorkbenchFileTreeExpandedPathsConsumer;
    stop(): void;
} {
    const scope = effectScope();
    const consumer = scope.run(() => useWorkbenchFileTreeExpandedPaths({
        adapters: harness.adapters,
        legacy,
    }))!;
    return {
        consumer,
        stop: () => {
            scope.stop();
        },
    };
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

/** 只推进微任务，不等任何条件（用于断言"此刻仍然没有发生"）。 */
async function flushMicrotasks(rounds = 64): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
    }
}

describe("parseLegacyExpandedPaths", () => {
    it("非 JSON 与非数组都被当作不可迁移，不冒充空展开", () => {
        expect(parseLegacyExpandedPaths("{not json")).toEqual({value: null, diagnosis: "旧键内容不是合法 JSON"});
        expect(parseLegacyExpandedPaths("\"manuscript/\"")).toEqual({value: null, diagnosis: "旧键内容不是路径数组"});
    });

    it("数组按旧写法清洗：只留非空字符串并去重", () => {
        expect(parseLegacyExpandedPaths("[\"manuscript/\",\"manuscript/\",\"\",3]"))
            .toEqual({value: ["manuscript/"], diagnosis: null});
    });
});

describe("useWorkbenchFileTreeExpandedPaths", () => {
    it("首读门禁：读取未分类前拒绝提交且不落盘，读完后提交的是已确认值以上的并集", async () => {
        const harness = storageHarness();
        harness.write({paths: ["manuscript/", "manuscript/vol-1"]});
        const release = harness.holdReads();
        const opened = openConsumer(harness, legacyStore(null));

        await flushUntil(() => opened.consumer.loading.value);
        // 读取窗口内界面显示的是产品默认（不展开）；此刻任何提交都基于这份默认值，必须被拒绝。
        expect(opened.consumer.expandedPaths.value).toEqual([]);
        await opened.consumer.commit(["lorebook/"]);
        await flushMicrotasks();
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.expandedPaths.value).toEqual([]);
        expect(opened.consumer.notice.value?.diagnosis).toContain("没完成首次读取");
        expect(opened.consumer.notice.value?.retryable).toBe(false);

        release();
        await flushUntil(() => !opened.consumer.loading.value);
        // 拒绝重放：记录里已确认的两条展开项仍在（这正是读取窗口内提交会造成的静默覆盖）。
        expect(opened.consumer.expandedPaths.value).toEqual(["manuscript/", "manuscript/vol-1"]);
        expect(harness.records.get(harness.storeKey())?.value).toEqual({paths: ["manuscript/", "manuscript/vol-1"]});

        // 读取就绪后，树按整份数组提交（已显示值 + 本次路径），落盘是并集。
        await opened.consumer.commit(["manuscript/", "manuscript/vol-1", "lorebook/"]);
        expect(harness.saves).toEqual([harness.storeKey()]);
        expect(harness.records.get(harness.storeKey())?.value).toEqual({
            paths: ["manuscript/", "manuscript/vol-1", "lorebook/"],
        });
        expect(opened.consumer.expandedPaths.value).toEqual(["manuscript/", "manuscript/vol-1", "lorebook/"]);
        opened.stop();
    });

    it("句柄不可用：commit 不覆盖准确诊断、不落盘，并自己重试连接（后端恢复后同一手势落盘）", async () => {
        const harness = storageHarness();
        harness.userContextFailure.current = "Storage 宿主暂不可达（cold start）";
        const opened = openConsumer(harness, legacyStore(null));

        await flushUntil(() => opened.consumer.notice.value !== null);
        await flushUntil(() => !opened.consumer.loading.value);
        expect(opened.consumer.notice.value?.diagnosis).toBe("Storage 宿主暂不可达（cold start）");
        // 唯一能恢复的入口是 retry()，因此这条诊断必须让界面把「重试」按钮画出来。
        expect(opened.consumer.notice.value?.retryable).toBe(true);

        await opened.consumer.commit(["lorebook/"]);
        await flushMicrotasks();
        expect(harness.saves).toEqual([]);
        // 门禁文案不许顶掉更准确的诊断（那是用户真正需要的信息）。
        expect(opened.consumer.notice.value?.diagnosis).toBe("Storage 宿主暂不可达（cold start）");

        // 后端恢复：提交会重新触发 open()（因此手势也把连接带回来了），但不重放这次基于默认显示的意图。
        harness.userContextFailure.current = null;
        await opened.consumer.commit(["lorebook/"]);
        await flushUntil(() => !opened.consumer.loading.value && opened.consumer.notice.value === null);
        expect(harness.saves).toEqual([]);

        // 会话就绪后，同一手势基于已确认显示重算后照常落盘。
        await opened.consumer.commit(["lorebook/"]);
        expect(harness.saves).toEqual([harness.storeKey()]);
        expect(harness.records.get(harness.storeKey())?.value).toEqual({paths: ["lorebook/"]});
        opened.stop();
    });

    it("旧键不可读（隐私模式/被禁用）：不迁移不删除，诊断经会话显示出来", async () => {
        const harness = storageHarness();
        harness.write({paths: ["world-engine/"]});
        const legacy: LegacyValueStore = {
            read: () => ({kind: "unavailable", diagnosis: "存储被浏览器策略禁用"}),
            remove: () => false,
        };
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => opened.consumer.notice.value !== null);
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.notice.value?.diagnosis).toContain("不可读");
        expect(opened.consumer.notice.value?.diagnosis).toContain("存储被浏览器策略禁用");
        expect(opened.consumer.notice.value?.retryable).toBe(true);
        // 旧键仍在（替身恒返回不可读，且删除从未被请求）。
        expect(opened.consumer.expandedPaths.value).toEqual(["world-engine/"]);
        opened.stop();
    });

    it("记录缺失时不写默认值：首次读取完成也不会产生记录", async () => {
        const harness = storageHarness();
        const opened = openConsumer(harness, legacyStore(null));

        await flushUntil(() => !opened.consumer.loading.value);
        expect(harness.saves).toEqual([]);
        expect(harness.records.size).toBe(0);
        expect(opened.consumer.expandedPaths.value).toEqual([]);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("旧键迁移：条件初始化一次，回读一致后删除旧键", async () => {
        const harness = storageHarness();
        const legacy = legacyStore(JSON.stringify(["manuscript/", "lorebook/", "manuscript/"]));
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        expect(harness.saves).toEqual([harness.storeKey()]);
        expect(harness.records.get(harness.storeKey())?.value).toEqual({paths: ["manuscript/", "lorebook/"]});
        expect(opened.consumer.expandedPaths.value).toEqual(["manuscript/", "lorebook/"]);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("已有记录不被旧键覆盖：只删旧键，不写记录", async () => {
        const harness = storageHarness();
        harness.write({paths: ["world-engine/"]});
        const legacy = legacyStore(JSON.stringify(["manuscript/"]));
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.expandedPaths.value).toEqual(["world-engine/"]);
        opened.stop();
    });

    it("空旧值没有可迁移的信息：删除旧键也不写记录", async () => {
        const harness = storageHarness();
        const legacy = legacyStore("[]");
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => legacy.remaining === null);
        expect(harness.saves).toEqual([]);
        expect(harness.records.size).toBe(0);
        opened.stop();
    });

    it("旧键无法解析：不迁移也不删除，并给出可见诊断", async () => {
        const harness = storageHarness();
        const legacy = legacyStore("{not json");
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => opened.consumer.notice.value !== null);
        expect(harness.saves).toEqual([]);
        expect(legacy.remaining).toBe("{not json");
        expect(opened.consumer.notice.value?.diagnosis).toContain("旧展开记录未迁移");
        expect(opened.consumer.notice.value?.retryable).toBe(false);
        opened.stop();
    });

    it("回读与写入不一致：旧键保留，诊断可重试", async () => {
        const harness = storageHarness();
        const legacy = legacyStore(JSON.stringify(["manuscript/"]));
        // 模拟写入后立刻被另一写者改写：回读拿到的不是本次写入的值。
        harness.hooks.afterSave = (key) => {
            harness.records.set(key, {value: {paths: ["elsewhere/"]}, revision: "revision-99", schemaVersion: 1});
        };
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => opened.consumer.notice.value !== null);
        expect(harness.saves).toEqual([harness.storeKey()]);
        expect(legacy.remaining).toBe(JSON.stringify(["manuscript/"]));
        expect(opened.consumer.notice.value?.diagnosis).toContain("回读与写入不一致");
        expect(opened.consumer.notice.value?.retryable).toBe(true);
        opened.stop();
    });

    it("记录损坏时旧键保留原位（迁移不能在没有可写记录时宣称完成）", async () => {
        const harness = storageHarness();
        harness.fixedReads.set(harness.storeKey(), {
            kind: "corrupt",
            diagnosis: "记录内容不是合法封装",
            repair: {partitionGeneration: 1, contentFingerprint: "seed-fingerprint"},
        });
        const legacy = legacyStore(JSON.stringify(["manuscript/"]));
        const opened = openConsumer(harness, legacy);

        await flushUntil(() => opened.consumer.notice.value !== null);
        expect(legacy.remaining).toBe(JSON.stringify(["manuscript/"]));
        expect(harness.saves).toEqual([]);
        // 记录侧自己的阻断原因就是给用户的诊断（损坏不可普通保存，也没有"重试保存"这条路）。
        expect(opened.consumer.notice.value?.diagnosis.length).toBeGreaterThan(0);
        expect(opened.consumer.notice.value?.retryable).toBe(false);
        opened.stop();
    });

    it("条件冲突不静默：未确认意图保留并显示诊断，重试后写入一次", async () => {
        const harness = storageHarness();
        // 每次保存前都被另一写者改写 → 条件冲突重放后仍冲突，意图进入未确认态。
        let conflictSequence = 0;
        harness.hooks.beforeSave = (key) => {
            conflictSequence += 1;
            harness.records.set(key, {
                value: {paths: ["edited-elsewhere/"]},
                revision: `revision-conflict-${conflictSequence}`,
                schemaVersion: 1,
            });
        };
        const opened = openConsumer(harness, legacyStore(null));

        await flushUntil(() => !opened.consumer.loading.value);
        await opened.consumer.commit(["manuscript/"]);
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.expandedPaths.value).toEqual(["manuscript/"]);
        expect(opened.consumer.notice.value?.retryable).toBe(true);
        expect(opened.consumer.notice.value?.diagnosis).toContain("记录已被其它窗口改写");

        harness.hooks.beforeSave = null;
        await opened.consumer.retry();
        expect(harness.saves).toEqual([harness.storeKey()]);
        expect(opened.consumer.notice.value).toBeNull();
        expect(harness.records.get(harness.storeKey())?.value).toEqual({paths: ["manuscript/"]});
        opened.stop();
    });

    it("放弃未确认意图回到已确认值", async () => {
        const harness = storageHarness();
        harness.write({paths: ["world-engine/"]});
        const opened = openConsumer(harness, legacyStore(null));

        await flushUntil(() => !opened.consumer.loading.value);
        // 写入结果未确认（不是冲突重读）：已确认基线不动，本次意图留在未确认态。
        harness.hooks.beforeSave = () => {
            throw new StorageAdapterError({
                code: "STORAGE_IO",
                status: 500,
                message: "写入结果未确认",
                committed: null,
            });
        };
        await opened.consumer.commit(["manuscript/"]);
        expect(opened.consumer.expandedPaths.value).toEqual(["manuscript/"]);
        expect(opened.consumer.notice.value?.retryable).toBe(true);

        opened.consumer.abandon();
        expect(opened.consumer.expandedPaths.value).toEqual(["world-engine/"]);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("旧键名保持未改名：迁移读的是原键，不是新记录键", () => {
        expect(LEGACY_FILE_TREE_EXPANDED_PATHS_KEY).toBe("nbook.workspaceFilePanel.expandedPaths");
    });
});
