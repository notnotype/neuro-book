/**
 * 探针 1（Q1）——试图证伪的声明：
 * "暂存早于旧 writer：门禁在写回前生效；暂存成功后三个源字段固定为捕获值；
 *  门禁退役（retireLegacyBucketWriterPolicy）后旧 writer 回到默认行为。"
 *
 * 做法：真实 pinia + 真实 pinia-plugin-persistedstate + 真实 `novel.ide.local` persist 配置
 * （`storage: legacyBucketStorage()` / `serializer: legacyBucketSerializer`，即被审 revision 的实际代码），
 * 门禁由**真实迁移控制器**（真实 HTTP 宿主 + 真实 data 导入）安装，而不是测试手工 install。
 * store 用的是被审 revision 的逐字节副本（`fixtures/novel-ide-8263726e.ts`）：产品文件在审查期间
 * 正被并行任务编辑，直接 import 会随对方的半成品状态漂移（首次运行时已实测到一次语法错误）。
 *
 * 负向对照是关键：先证明探针**能**看见"门禁缺失 ⇒ 运行期值被写回旧桶"，正向结果才有意义。
 */
import {createPinia, defineStore as defineStoreRef, setActivePinia} from "pinia";
import {createPersistedState} from "pinia-plugin-persistedstate";
import {computed, createApp, nextTick, ref, watch} from "vue";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY, WORKBENCH_SURFACE_SIZES_KEY} from "nbook/shared/storage/workbench-state";
import {
    LEGACY_BUCKET_KEY,
    installLegacyBucketWriterPolicy,
    legacyBucketWriterPolicy,
    retireLegacyBucketWriterPolicy,
    type LegacyBucketStorage,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";
import {createMigrationHarness, type MigrationHarness} from "./probe-harness";

const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
    viewMode: "content",
});

type FakeLocalStorage = LegacyBucketStorage & {
    readonly writes: string[];
    readonly reads: string[];
    clearWrites(): void;
};

function fakeLocalStorage(): FakeLocalStorage {
    let stored: string | null = null;
    const writes: string[] = [];
    const reads: string[] = [];
    return {
        get writes() {
            return writes;
        },
        get reads() {
            return reads;
        },
        clearWrites() {
            writes.length = 0;
        },
        getItem: (key) => {
            reads.push(key);
            return stored;
        },
        setItem: (_key, value) => {
            writes.push(value);
            stored = value;
        },
    };
}

/** 真实 store 定义在求值时读 Nuxt 注入的全局，因此探针只补这几个替身。 */
function installStoreGlobals(): void {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    globals.defineStore = defineStoreRef;
    globals.ref = ref;
    globals.computed = computed;
    globals.watch = watch;
    globals.piniaPluginPersistedstate = {sessionStorage: () => ({})};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment

}

// 产品 store 用的是 Nuxt 自动导入的 `defineStore`；这里用 pinia 的原名替身。


let harness: MigrationHarness | undefined;
let storage: FakeLocalStorage | undefined;

async function instantiateStore(): Promise<Record<string, unknown>> {
    const current = storage;
    if (current === undefined) throw new Error("探针未安装 localStorage 替身");
    const pinia = createPinia().use(createPersistedState({storage: current}));
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const {useNovelIdeStore} = await import("./fixtures/novel-ide-8263726e");
    return useNovelIdeStore() as unknown as Record<string, unknown>;
}

async function flushPersist(): Promise<void> {
    await nextTick();
    await nextTick();
}

beforeEach(() => {
    installStoreGlobals();
});

afterEach(async () => {
    retireLegacyBucketWriterPolicy();
    installLegacyBucketWriterPolicy({mode: "inactive"});
    delete (globalThis as {localStorage?: unknown}).localStorage;
    storage = undefined;
    await harness?.close();
    harness = undefined;
});

describe("探针 1：暂存与门禁在旧 writer 之前生效（Q1）", () => {
    it("负向对照：门禁未安装时，运行期尺寸被旧 writer 写回旧桶", async () => {
        storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        (globalThis as {localStorage?: unknown}).localStorage = storage;

        const store = await instantiateStore();
        // 水合本身不写回：第一次写回来自后续状态变更。
        expect(storage.writes).toHaveLength(0);
        store["leftPanelWidth"] = 999;
        await flushPersist();

        expect(JSON.parse(storage.writes.at(-1) ?? "{}")).toMatchObject({leftPanelWidth: 999});
    });

    it("真实迁移安装门禁后：水合与写回都只保留捕获值，未迁字段继续更新", async () => {
        storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        (globalThis as {localStorage?: unknown}).localStorage = storage;

        harness = await createMigrationHarness();
        const migration = harness.controller(BUCKET);
        const started = migration.start();
        // 门禁的安装时机由真实 stagePhase 决定：await staged 之后才允许应用挂载。
        await migration.staged;

        expect(legacyBucketWriterPolicy()).toEqual({
            mode: "pinned",
            fields: {leftPanelWidth: 427, agentPanelWidth: 488, projectPickerLayoutMode: "compact"},
        });

        const store = await instantiateStore();
        expect(storage.reads).toContain(LEGACY_BUCKET_KEY);
        storage.clearWrites();

        store["leftPanelWidth"] = 999;
        store["agentPanelWidth"] = 1000;
        store["projectPickerLayoutMode"] = "editorial";
        store["activeLeftTab"] = "search";
        await flushPersist();

        expect(JSON.parse(storage.writes.at(-1) ?? "{}")).toMatchObject({
            leftPanelWidth: 427,
            agentPanelWidth: 488,
            projectPickerLayoutMode: "compact",
            activeLeftTab: "search",
        });

        await started;
        expect(migration.snapshot()).toMatchObject({phase: "complete", blocked: null, backup: "saved"});
        // 三个源字段按捕获值条件初始化到新 authority。
        expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle")).toContain("427");
        expect(await harness.recordText(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SHELF_MODE_KEY)).toContain("compact");
    });

    it("退役门禁后：serializer 与 storage 都回到直通（t48 第 5–6 步的语义）", async () => {
        storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        (globalThis as {localStorage?: unknown}).localStorage = storage;

        harness = await createMigrationHarness();
        const migration = harness.controller(BUCKET);
        await migration.start();
        expect(migration.snapshot().phase).toBe("complete");

        // t48 退役门禁后，即使 store 仍带着被审 revision 安装的 storage/serializer，也不再固定三字段。
        retireLegacyBucketWriterPolicy();
        expect(legacyBucketWriterPolicy()).toEqual({mode: "inactive"});

        const store = await instantiateStore();
        storage.clearWrites();
        store["leftPanelWidth"] = 999;
        await flushPersist();

        expect(JSON.parse(storage.writes.at(-1) ?? "{}")).toMatchObject({leftPanelWidth: 999});
    });
});
