import {createPinia, defineStore, setActivePinia} from "pinia";
import {createPersistedState} from "pinia-plugin-persistedstate";
import {computed, createApp, nextTick, ref, watch} from "vue";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    LEGACY_BUCKET_KEY,
    installLegacyBucketWriterPolicy,
    type LegacyBucketStorage,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

/**
 * 迁移期写回门禁与真实持久化运行时的核对。
 *
 * 这里用**真实**的 `pinia-plugin-persistedstate` 与**真实**的 `novel-ide` store 定义：
 * 门禁只有在"store 首次实例化之前"安装，才会作用在第一次写回上；这条时序是本 Task 的合同，
 * 因此负向对照（不安装门禁时旧 writer 会改写源字段）与正向结果都要有证据。
 */

type LegacyFields = {
    leftPanelWidth: number;
    agentPanelWidth: number;
    projectPickerLayoutMode: string;
    activeLeftTab: string;
};

type FakeWebStorage = LegacyBucketStorage & {
    readonly writes: readonly string[];
    readonly reads: readonly string[];
    clearWrites(): void;
};

function fakeLocalStorage(): FakeWebStorage {
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

const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
    viewMode: "content",
});

function installStoreGlobals(): void {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    globals.defineStore = defineStore;
    globals.ref = ref;
    globals.computed = computed;
    globals.watch = watch;
    globals.piniaPluginPersistedstate = {sessionStorage: () => ({})};
}

/** 当前用例安装的 localStorage 替身：安装时记录，读取时不依赖 `globalThis` 的断言。 */
let installedStorage: FakeWebStorage | undefined;

function installLocalStorage(storage: FakeWebStorage): void {
    (globalThis as {localStorage?: unknown}).localStorage = storage;
    installedStorage = storage;
}

/**
 * 用真实 persist 插件建立 pinia 并实例化真实 store；水合与写回订阅都发生在这一步。
 *
 * store 模块在求值时就用 Nuxt 注入的 `defineStore`/`ref`/`piniaPluginPersistedstate` 等全局，
 * 因此只能在这里动态加载（这正是被测的加载边界），不能在文件顶部静态 import。
 */
/** 只加载 store 模块：对应"Nuxt 插件运行、应用还没挂载"的时刻，此时不该碰旧桶。 */
async function loadStoreModule(): Promise<() => LegacyFields> {
    const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
    return () => useNovelIdeStore() as unknown as LegacyFields;
}

/** 装好真实持久化插件的 pinia；此时还没有任何 store 被创建。 */
function preparePinia(): void {
    const storage = installedStorage;
    if (storage === undefined) throw new Error("测试未安装 localStorage 替身");
    const pinia = createPinia().use(createPersistedState({storage}));
    // Pinia 在安装进 Vue 应用之前只把插件排队（`use()` 进 `_toBeInstalled`），
    // 不安装就拿不到真实持久化插件——这里用一个空应用完成安装，不挂载任何组件。
    createApp({}).use(pinia);
    setActivePinia(pinia);
}

async function instantiateStore(): Promise<LegacyFields> {
    preparePinia();
    const useStore = await loadStoreModule();
    return useStore();
}

/** 持久化写回由 `$subscribe` 的 watcher 调度；只等 Vue 的调度队列，不引入真实计时器。 */
async function flushPersist(): Promise<void> {
    await nextTick();
    await nextTick();
}

beforeEach(() => {
    installStoreGlobals();
});

afterEach(() => {
    installLegacyBucketWriterPolicy({mode: "inactive"});
    delete (globalThis as {localStorage?: unknown}).localStorage;
    installedStorage = undefined;
});

describe("旧 novel.ide.local writer 的迁移期门禁", () => {
    it("负向对照：未安装门禁时旧 writer 会把运行期尺寸写回源字段", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);

        const store = await instantiateStore();
        // 水合本身不写回：旧 writer 的第一次写回来自后续状态变更。
        expect(storage.writes).toHaveLength(0);

        store.leftPanelWidth = 999;
        await flushPersist();

        expect(JSON.parse(storage.writes.at(-1) ?? "{}")).toMatchObject({leftPanelWidth: 999});
    });

    it("安装门禁后水合与写回都只保留捕获值，未迁字段继续更新", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({
            mode: "pinned",
            fields: {leftPanelWidth: 427, agentPanelWidth: 488, projectPickerLayoutMode: "compact"},
        });

        const store = await instantiateStore();
        expect(store.leftPanelWidth).toBe(427);
        expect(store.projectPickerLayoutMode).toBe("compact");

        store.leftPanelWidth = 999;
        store.agentPanelWidth = 1000;
        store.projectPickerLayoutMode = "editorial";
        store.activeLeftTab = "search";
        await flushPersist();

        // 三个源字段固定为捕获值；未迁字段（此处 activeLeftTab）继续按运行期值保存。
        expect(JSON.parse(storage.writes.at(-1) ?? "{}")).toMatchObject({
            activeLeftTab: "search",
            agentPanelWidth: 488,
            leftPanelWidth: 427,
            projectPickerLayoutMode: "compact",
        });
    });

    it("整桶冻结时不写回旧桶（偏好仅内存生效）", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({mode: "locked", reason: "原件暂存失败"});

        const store = await instantiateStore();
        store.leftPanelWidth = 999;
        store.activeLeftTab = "search";
        await flushPersist();

        expect(storage.writes).toHaveLength(0);
        expect(store.leftPanelWidth).toBe(999);
    });

    it("旧桶的读取与写回都发生在 store 首次实例化时，模块加载不碰旧桶", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);

        // 持久化插件已装、store 还没创建：模块加载（= Nuxt 插件阶段）只建立 persist 配置。
        preparePinia();
        const useStore = await loadStoreModule();
        expect(storage.reads).toHaveLength(0);
        expect(storage.writes).toHaveLength(0);

        // 首次实例化才水合；写回订阅也在这里注册，所以门禁必须在那之前安装。
        const store = useStore();
        expect(storage.reads).toContain(LEGACY_BUCKET_KEY);
        expect(store.leftPanelWidth).toBe(427);
    });

    it("完整旧 JSON 损坏时三字段按缺失写回，其它字段用各自默认", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, "{\"leftPanelWidth\":427,");
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {}});

        const store = await instantiateStore();
        // 水合失败 ⇒ store 保持各自默认，而不是停在坏值上。
        expect(store.leftPanelWidth).toBe(340);

        store.leftPanelWidth = 999;
        store.activeLeftTab = "search";
        await flushPersist();

        const written = JSON.parse(storage.writes.at(-1) ?? "{}") as Record<string, unknown>;
        expect(written).not.toHaveProperty("leftPanelWidth");
        expect(written).not.toHaveProperty("agentPanelWidth");
        expect(written).not.toHaveProperty("projectPickerLayoutMode");
        expect(written).toMatchObject({activeLeftTab: "search"});
    });
});
