import {createPinia, defineStore, setActivePinia} from "pinia";
import {createPersistedState} from "pinia-plugin-persistedstate";
import {computed, createApp, nextTick, ref, watch} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    LEGACY_BUCKET_KEY,
    installLegacyBucketWriterPolicy,
    legacyBucketWriterPolicy,
    retireLegacyBucketWriterPolicy,
    type LegacyBucketStorage,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

/**
 * 旧 `novel.ide.local` writer 的退役（迁移合同第 5–6 步）。
 *
 * 三个源字段（左右栏尺寸与书架模式）的读写已切到工作台 Storage 会话，`pick` 里不再有它们；
 * 但**保留侧仍在服役**：原件未安全保留（暂存失败、data 备份未落盘）时，序列化器继续替旧 writer
 * 补齐这三个键，否则其它字段的整键重写会把只存在于旧桶里的源值抹掉。退役（解除 serializer 与门禁）
 * 由启动接线在原件已暂存且 data 备份落盘之后触发，不在模块求值时发生。
 *
 * 这里用**真实**的 `pinia-plugin-persistedstate` 与**真实**的 store 定义：水合与写回订阅都发生在
 * store 首次实例化时，时序本身就是要验证的边界。
 */

type RetiredFieldName = "leftPanelWidth" | "agentPanelWidth" | "projectPickerLayoutMode";

type StoreSurface = Record<string, unknown>;

type FakeWebStorage = LegacyBucketStorage & {
    readonly writes: readonly string[];
    readonly reads: readonly string[];
    clearWrites(): void;
    raw(): string | null;
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
        raw: () => stored,
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

/** 迁移前的旧桶：三个源字段与未迁字段混在一起。 */
const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
    viewMode: "content",
});

const RETIRED_FIELDS: readonly RetiredFieldName[] = ["leftPanelWidth", "agentPanelWidth", "projectPickerLayoutMode"];

function installStoreGlobals(): void {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    globals.defineStore = defineStore;
    globals.ref = ref;
    globals.computed = computed;
    globals.watch = watch;
    globals.piniaPluginPersistedstate = {sessionStorage: () => ({})};
}

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
async function instantiateStore(): Promise<StoreSurface> {
    const storage = installedStorage;
    if (storage === undefined) throw new Error("测试未安装 localStorage 替身");
    const pinia = createPinia().use(createPersistedState({storage}));
    // Pinia 在安装进 Vue 应用之前只把插件排队（`use()` 进 `_toBeInstalled`），
    // 不安装就拿不到真实持久化插件——这里用一个空应用完成安装，不挂载任何组件。
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
    return useNovelIdeStore() as unknown as StoreSurface;
}

/** 持久化写回由 `$subscribe` 的 watcher 调度；只等 Vue 的调度队列，不引入真实计时器。 */
async function flushPersist(): Promise<void> {
    await nextTick();
    await nextTick();
}

function lastWrittenBucket(storage: FakeWebStorage): Record<string, unknown> {
    const raw = storage.writes.at(-1);
    if (raw === undefined) throw new Error("旧 writer 没有写回");
    return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
    installStoreGlobals();
});

afterEach(() => {
    installLegacyBucketWriterPolicy({mode: "inactive"});
    delete (globalThis as {localStorage?: unknown}).localStorage;
    installedStorage = undefined;
});

describe("旧 novel.ide.local writer 的退役", () => {
    it("store 不再暴露三个已退役字段，未迁字段照旧水合", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        installLocalStorage(storage);

        const store = await instantiateStore();

        for (const field of RETIRED_FIELDS) {
            expect(Object.hasOwn(store, field)).toBe(false);
        }
        expect(store.activeLeftTab).toBe("outline");
        expect(store.viewMode).toBe("content");
    });

    it("门禁为 pinned（原件已暂存、备份未落盘）时，未迁字段的写回仍保留三个源字段", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({
            mode: "pinned",
            fields: {leftPanelWidth: 427, agentPanelWidth: 488, projectPickerLayoutMode: "compact"},
        });

        const store = await instantiateStore();
        expect(storage.writes).toHaveLength(0);

        store.activeLeftTab = "search";
        store.viewMode = "source";
        await flushPersist();

        // 运行期值不再写旧桶（pick 已移除），但原件里的三个值必须原样保留：此刻它们只存在于这里。
        const written = lastWrittenBucket(storage);
        expect(written.activeLeftTab).toBe("search");
        expect(written.viewMode).toBe("source");
        expect(written.leftPanelWidth).toBe(427);
        expect(written.agentPanelWidth).toBe(488);
        expect(written.projectPickerLayoutMode).toBe("compact");
    });

    it("门禁为 locked（原件暂存失败）时整桶冻结：其它字段也不写回，旧值仍在", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({mode: "locked", reason: "浏览器暂存失败"});

        const store = await instantiateStore();
        store.activeLeftTab = "search";
        await flushPersist();

        expect(storage.writes).toHaveLength(0);
        expect(JSON.parse(storage.raw() ?? "{}").leftPanelWidth).toBe(427);
    });

    it("门禁退役后（原件已安全保留），写回不再含三个已退役字段", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);

        const store = await instantiateStore();
        retireLegacyBucketWriterPolicy();
        store.activeLeftTab = "search";
        store.viewMode = "source";
        await flushPersist();

        const written = lastWrittenBucket(storage);
        expect(written.activeLeftTab).toBe("search");
        for (const field of RETIRED_FIELDS) {
            expect(Object.hasOwn(written, field)).toBe(false);
        }
    });

    it("装载 store 模块不退役门禁：退役只由启动接线在原件安全保留后触发", async () => {
        installLocalStorage(fakeLocalStorage());
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});

        const store = await instantiateStore();
        store.activeLeftTab = "search";

        // 暂停（原件未暂存成功 / 备份未落盘）时门禁保持不变，保留侧继续生效。
        expect(legacyBucketWriterPolicy()).toEqual({mode: "pinned", fields: {leftPanelWidth: 427}});
    });

    it("store 装载前后都不主动写旧桶（源字段只被读一次）", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);

        await instantiateStore();

        expect(storage.writes).toHaveLength(0);
        expect(storage.reads).toContain(LEGACY_BUCKET_KEY);
    });
});
