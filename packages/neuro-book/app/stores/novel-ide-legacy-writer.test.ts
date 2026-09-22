import {createPinia, defineStore, setActivePinia} from "pinia";
import {createPersistedState} from "pinia-plugin-persistedstate";
import {computed, createApp, nextTick, ref, watch} from "vue";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
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
 * `activeLeftTab`（旧的活动左侧页签）是**第三种**情形：它既不在三个源字段里，也没有运行期状态——
 * store 不暴露它、`pick` 不写它、没有任何"新记录 → 旧可写 ref"的镜像。序列化器只把原件里的原值
 * 原样合成回桶里（原件没有这个键就不制造），所以它保留的是**原件**，运行时没有任何选择权威。
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

/** 迁移前的旧桶：三个源字段、退役的活动页签与未迁字段混在一起。 */
const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
    // 未迁的已选字段与一个没人认识的键：水合只看 `pick`，未知键不参与。
    agentSessionPanelWidth: 300,
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

/** 触发一次整键写回的运行期改动：挑一个仍在 `pick` 里的字段（不是本迁移的三个源字段）。 */
function touchPickedField(store: StoreSurface): void {
    store.agentSessionPanelOpen = false;
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
    it("store 不再暴露三个已退役字段与旧活动页签，未迁字段照旧水合", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        installLocalStorage(storage);

        const store = await instantiateStore();

        for (const field of RETIRED_FIELDS) {
            expect(Object.hasOwn(store, field)).toBe(false);
        }
        // 旧活动页签既不水合成状态，也没有替代它的可写字段：工具上下文是另一个（非持久的）状态。
        expect(Object.hasOwn(store, "activeLeftTab")).toBe(false);
        expect(store.activeToolView).toBeNull();
        expect(store.agentSessionPanelWidth).toBe(300);
    });

    it("门禁为 pinned 时，未迁字段的写回仍保留三个源字段与退役页签的原值", async () => {
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

        touchPickedField(store);
        await flushPersist();

        // 运行期自己的字段照写，捕获取值照补；退役页签是**原件**里的那一个，不是任何运行期值。
        const written = lastWrittenBucket(storage);
        expect(written.agentSessionPanelOpen).toBe(false);
        expect(written.activeLeftTab).toBe("outline");
        expect(written.leftPanelWidth).toBe(427);
        expect(written.agentPanelWidth).toBe(488);
        expect(written.projectPickerLayoutMode).toBe("compact");
    });

    it("退役页签不再是选择权威：运行期的工具焦点写不进旧桶", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);

        const store = await instantiateStore();
        store.activeToolView = {partId: "left", viewId: "nbook.files"};
        touchPickedField(store);
        await flushPersist();

        const written = lastWrittenBucket(storage);
        expect(written.activeLeftTab).toBe("outline");
        expect(JSON.stringify(written)).not.toContain("nbook.files");
    });

    it("原件里的未知页签值也原样保留，不改成缺省值", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, JSON.stringify({activeLeftTab: "rag", viewMode: "content"}));
        storage.clearWrites();
        installLocalStorage(storage);

        const store = await instantiateStore();
        touchPickedField(store);
        await flushPersist();

        expect(lastWrittenBucket(storage).activeLeftTab).toBe("rag");
    });

    it("原件里没有退役页签时不制造这个键", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, JSON.stringify({leftPanelWidth: 427, viewMode: "content"}));
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});

        const store = await instantiateStore();
        touchPickedField(store);
        await flushPersist();

        const written = lastWrittenBucket(storage);
        expect(Object.hasOwn(written, "activeLeftTab")).toBe(false);
        expect(written.leftPanelWidth).toBe(427);
    });

    it("门禁为 locked（原件暂存失败）时整桶冻结：其它字段也不写回，旧值仍在", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);
        installLegacyBucketWriterPolicy({mode: "locked", reason: "浏览器暂存失败"});

        const store = await instantiateStore();
        touchPickedField(store);
        await flushPersist();

        expect(storage.writes).toHaveLength(0);
        const raw = JSON.parse(storage.raw() ?? "{}") as Record<string, unknown>;
        expect(raw.leftPanelWidth).toBe(427);
        expect(raw.activeLeftTab).toBe("outline");
    });

    it("门禁退役后（原件已安全保留），写回不再含三个已退役字段", async () => {
        const storage = fakeLocalStorage();
        storage.setItem(LEGACY_BUCKET_KEY, BUCKET);
        storage.clearWrites();
        installLocalStorage(storage);

        const store = await instantiateStore();
        retireLegacyBucketWriterPolicy();
        touchPickedField(store);
        await flushPersist();

        const written = lastWrittenBucket(storage);
        expect(written.agentSessionPanelOpen).toBe(false);
        // 退役页签仍按原件保留：它没有决定过处置方式，任何一次整键重写都不许顺手删掉。
        expect(written.activeLeftTab).toBe("outline");
        for (const field of RETIRED_FIELDS) {
            expect(Object.hasOwn(written, field)).toBe(false);
        }
    });

    it("装载 store 模块不退役门禁：退役只由启动接线在原件安全保留后触发", async () => {
        installLocalStorage(fakeLocalStorage());
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});

        const store = await instantiateStore();
        touchPickedField(store);

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
