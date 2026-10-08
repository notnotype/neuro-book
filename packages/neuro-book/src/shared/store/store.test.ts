/**
 * 插件状态 store（docs/specs/state/store.md）：真实内核实例、真实 `nbook.storage` 与 SQLite、进程内链路（帧经 JSON
 * 编解码）。需要的时序只用真实运行时会出现的切口制造：
 *
 * - 另一个写者在 `change` 被调用时先发一次写：它与 store 的保存走同一条路径、先发先到，store 这次保存因此冲突；
 * - 分区拥有者一侧的订阅者在收到这次写入的通知时关掉窗口链路：分区先通知、再返回结果，结果回不到窗口。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {computed, isReadonly, ref, watch} from "@vue/reactivity";
import type {Ref} from "@vue/reactivity";
import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, ContributionDeclaration, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {defineSetting} from "nbook/shared/settings";
import type {SettingsService} from "nbook/shared/settings";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, RecordHandle, StorageService} from "nbook/shared/storage";

import {definePublicState, defineStore, StoreStoppedError} from "./store";
import type {PersistedFieldView, Store, StoreDefinition} from "./store";

const PLUGIN = "test.pair";

interface PairValue {
    readonly left: string;
    readonly right: string;
}

const PairSchema = Type.Object({left: Type.String(), right: Type.String()}, {additionalProperties: false});
const pairRecord: RecordDefinition<PairValue> = defineRecord({key: "pair", scope: "user", locality: "shared", version: 1, schema: PairSchema});
const projectPairRecord: RecordDefinition<PairValue> = defineRecord({key: "pair", scope: "project", locality: "shared", version: 1, schema: PairSchema});
const counterRecord = defineRecord({key: "counter", scope: "user", locality: "shared", version: 1, schema: Type.Object({count: Type.Number()}, {additionalProperties: false})});
const EMPTY: PairValue = {left: "", right: ""};

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-store", "plugin-store");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(hubPlugins: ReadonlyArray<PluginDefinition> = []): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), hubPlugins);
    worlds.push(created);
    return created;
}

/**
 * `change` 每次被调用时拿到的值与钩子。`change` 不只在保存时调用：提交时还要算显示、`adopt` 与 `discard` 时还要
 * 重新投影，所以测试按拿到的值判断，不按调用次数。
 */
interface Changes {
    readonly seen: PairValue[];
    onChange?: (current: PairValue) => void;
}

const changesOf = (): Changes => ({seen: []});

function pairStore(record: RecordDefinition<PairValue>, changes: Changes) {
    return defineStore("pair", ({persist}) => {
        const pair = persist(record, {initial: EMPTY});
        const narrow = (patch: Partial<PairValue>) => pair.commit((current) => {
            changes.seen.push(current);
            changes.onChange?.(current);
            return {...current, ...patch};
        });
        return {
            state: {pair},
            actions: {
                setLeft: (value: string) => narrow({left: value}),
                setRight: (value: string) => narrow({right: value}),
                reset: (value: PairValue) => pair.reset(value),
                retry: () => pair.retry(),
                discard: () => pair.discard(),
                discardAll: () => pair.discardAll(),
                adopt: () => pair.adopt(),
                reopen: () => pair.reopen(),
            },
        };
    });
}

interface Hosted<S extends object, A extends Readonly<Record<string, (...args: never[]) => unknown>>> {
    readonly store: Store<S, A>;
    readonly context: ActivationContext;
    readonly storage: StorageService;
}

/** 在一个位置上创建 store 的测试插件；`get()` 取最近一次激活的 store。 */
function hosted<S extends object, A extends Readonly<Record<string, (...args: never[]) => unknown>>>(
    definition: StoreDefinition<S, A>,
    location: string,
    options: {readonly lazy?: boolean; readonly contributions?: ReadonlyArray<ContributionDeclaration>} = {},
): {readonly plugin: PluginDefinition; get(): Hosted<S, A>} {
    let current: Hosted<S, A> | null = null;
    return {
        plugin: {
            id: PLUGIN,
            entries: [{
                id: location,
                location,
                activationEvents: options.lazy === true ? [] : ["onStartup"],
                dependencies: [{key: diagnosticsKey}, {key: storageKey}],
                contributions: options.contributions,
                activate: (context) => {
                    const storage = context.services.require(storageKey);
                    const store = definition.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
                    current = {store, context, storage};
                    return {contributions: store.contributions};
                },
            }],
        },
        get: () => {
            if (current === null) throw new Error("store 还没创建");
            return current;
        },
    };
}

/** 同一插件命名空间里的另一个写者：只拿 Storage 服务，不建 store。 */
function writer(location: string): {readonly plugin: PluginDefinition; storage(): StorageService} {
    let storage: StorageService | null = null;
    return {
        plugin: {id: PLUGIN, entries: [{id: location, location, activationEvents: ["onStartup"], dependencies: [{key: storageKey}], activate: (context) => {
            storage = context.services.require(storageKey);
            return {};
        }}]},
        storage: () => {
            if (storage === null) throw new Error("写者还没激活");
            return storage;
        },
    };
}

/**
 * 让 store 下一次提交的首发与重放各被另一个写者抢先一次。服务端本地的 Storage 写同步落盘、同步通知订阅者，抢先的写
 * 因此要落在 store 读过 base 之后、发出保存之前：提交时 `change` 先为显示调用一次，再为首发调用一次（拿 base 算要写的
 * 值，在同一个调用栈里发出保存）；冲突后重放时 `change` 拿到的是最新快照，也就是这次抢先写下的值。钩子在首发那次与
 * 拿到抢先值的那次各以当时的 base revision 先写一次，两次保存都冲突。
 */
function contend(changes: Changes, other: RecordHandle<PairValue>, revision: () => string | null): void {
    let calls = 0;
    changes.onChange = (current) => {
        calls += 1;
        if (calls === 2) {
            void other.save({left: "抢一", right: ""}, {expect: revision()});
        } else if (current.left === "抢一") {
            void other.save({left: "抢二", right: ""}, {expect: revision()});
            changes.onChange = undefined;
        }
    };
}

async function opened<T>(storage: StorageService, record: RecordDefinition<T>): Promise<RecordHandle<T>> {
    const result = await storage.open(record);
    if (!result.ok) throw new Error(`打开 ${record.key} 失败：${result.code} ${result.detail}`);
    return result.handle;
}

async function valueOf<T>(storage: StorageService, record: RecordDefinition<T>): Promise<unknown> {
    const snapshot = await (await opened(storage, record)).read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

/** 关闭入口这一代的激活作用域，等同于这个入口停止。 */
function stopEntry(context: ActivationContext): Promise<unknown> {
    const activation = context.scope.parent;
    if (activation === null) throw new Error("入口没有激活作用域");
    return activation.close();
}

describe("Spec state.store 输出 1–3：setup、只读视图与 action", () => {
    it("只读视图解包且不可写、字段视图不带方法，只有 action 能改；setup 里的 computed 与 watch 随释放停止，之后 action 抛错", async () => {
        const outside = ref(0);
        const watched: number[] = [];
        const definition = defineStore("boundary", ({persist}) => {
            const pair = persist(pairRecord, {initial: EMPTY});
            const count = ref(0);
            const doubled = computed(() => count.value * 2);
            const outsideDoubled = computed(() => outside.value * 2);
            watch(outside, (value) => watched.push(value));
            return {state: {count, doubled, outsideDoubled, pair}, actions: {increment: () => {
                count.value += 1;
            }}};
        });
        const probe = hosted(definition, "server");
        await world([probe.plugin]);
        const {store, context} = probe.get();

        expect(isReadonly(store.state)).toBe(true);
        expect(isReadonly(store.state.pair)).toBe(true);
        expect("commit" in store.state.pair).toBe(false);
        store.actions.increment();
        expect([store.state.count, store.state.doubled]).toEqual([1, 2]);
        outside.value = 1;
        expect(watched).toEqual([1]);

        const stopping = stopEntry(context);
        expect(() => store.actions.increment()).toThrow(StoreStoppedError);
        await stopping;
        outside.value = 2;
        expect(watched).toEqual([1]);
        // computed 不归 effectScope 管：释放时第一层的值被固定下来，之后不再跟着变。
        expect(store.state.outsideDoubled).toBe(2);
    });

    it("持久化字段放进嵌套对象：create 时抛错，入口激活失败，原因指出路径", async () => {
        const definition = defineStore("nested", ({persist}) => ({state: {panel: {field: persist(pairRecord, {initial: EMPTY})}}, actions: {}}));
        const probe = hosted(definition, "server", {lazy: true});
        const w = await world([probe.plugin]);
        expect(await w.hub.plugins.activate({plugin: PLUGIN, entry: "server"})).toMatchObject({status: "failed", error: {message: expect.stringContaining("panel.field 是嵌套的")}});
    });
});

/** 编译期合同：不运行，只交给 tsc 检查。 */
export function typeContracts(store: Store<{count: Ref<number>}, {increment(): void}>): void {
    // @ts-expect-error 只读视图不能写
    store.state.count = 1;
    const flags = definePublicState(PLUGIN, {ready: {type: "boolean", unready: false}, label: {type: "string", unready: ""}});
    defineStore("types", ({publish, persist}) => {
        const ready = ref(true);
        const label = ref("x");
        publish(flags, {ready, label});
        // @ts-expect-error 漏绑
        publish(flags, {ready});
        // @ts-expect-error 多绑
        publish(flags, {ready, label, extra: ref(1)});
        // @ts-expect-error 类型不符
        publish(flags, {ready: label, label});
        const pair = persist(pairRecord, {initial: EMPTY});
        return {state: {pair}, actions: {}};
    });
    const view = null as unknown as PersistedFieldView<PairValue>;
    // @ts-expect-error 字段视图不带方法
    void view.commit;
}

describe("Spec state.store 输出 4：公开绑定", () => {
    it("绑定交给 state.public 的实现：读到当前值；声明了没给的交 unbound；多出的不交并记诊断", async () => {
        const flags = definePublicState(PLUGIN, {ready: {type: "boolean", unready: false}, label: {type: "string", unready: ""}});
        const ready = ref(false);
        const definition = defineStore("flags", ({publish}) => {
            // 绕过类型检查的调用方：漏了 label，多了 extra。
            publish(flags, {ready, extra: ref(1)} as never);
            return {state: {}, actions: {}};
        });
        const probe = hosted(definition, "server", {contributions: flags.contributions});
        const w = await world([probe.plugin]);
        const bindings = probe.get().store.contributions["state.public"] ?? {};

        expect(Object.keys(bindings).sort()).toEqual(["test.pair/label", "test.pair/ready"]);
        expect(bindings["test.pair/label"]).toEqual({kind: "unbound"});
        const bound = bindings["test.pair/ready"];
        if (bound?.kind !== "bound") throw new Error("ready 应当已绑定");
        expect(bound.read()).toBe(false);
        ready.value = true;
        expect(bound.read()).toBe(true);
        const records = w.diagnostics("hub").query({plugin: PLUGIN}).records.filter((record) => record.event === "store.publish-undeclared");
        expect(records.map((record) => record.data)).toEqual([{keys: ["test.pair/extra"]}]);
    });
});

describe("Spec state.store 输出 5–8：初值、base 与显示", () => {
    it("记录没有值时显示 initial 且不保存；别处写入只更新 base，显示不变，adopt 后才更新；show 只改显示", async () => {
        const probe = hosted(pairStore(pairRecord, changesOf()), "server");
        await world([probe.plugin]);
        const {store, storage} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        expect(store.state.pair.base).toEqual({status: "missing", revision: null});
        expect(store.state.pair.display).toEqual(EMPTY);
        expect(await valueOf(storage, pairRecord)).toBe("missing");

        const other = await opened(storage, pairRecord);
        expect(await other.save({left: "别处", right: ""}, {expect: null})).toMatchObject({ok: true});
        await waitUntil("base 更新", () => store.state.pair.base?.status === "ok");
        expect(store.state.pair.display).toEqual(EMPTY);
        store.actions.adopt();
        expect(store.state.pair.display).toEqual({left: "别处", right: ""});
    });
});

describe("Spec state.store 输出 8–9：show 与 change 的约束", () => {
    it("show 只改显示，不排队、不保存；change 拿到冻结的值，改参数时 commit 直接抛错、不排队，已确认的值不变", async () => {
        const definition = defineStore("strict", ({persist}) => {
            const pair = persist(pairRecord, {initial: EMPTY});
            return {state: {pair}, actions: {
                show: (value: PairValue) => pair.show(value),
                mutate: () => pair.commit((current) => {
                    (current as {left: string}).left = "就地改";
                    return current as PairValue;
                }),
            }};
        });
        const probe = hosted(definition, "server");
        await world([probe.plugin]);
        const {store, storage} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);

        store.actions.show({left: "拖动中", right: ""});
        expect(store.state.pair.display).toEqual({left: "拖动中", right: ""});
        expect([store.state.pair.queue, store.state.pair.save]).toEqual([0, {state: "idle"}]);
        expect(() => store.actions.mutate()).toThrow(TypeError);
        expect(store.state.pair.queue).toBe(0);
        expect(store.state.pair.base).toEqual({status: "missing", revision: null});
        expect(await valueOf(storage, pairRecord)).toBe("missing");
    });
});

describe("Spec state.store 输出 9–11、场景 1：提交与冲突重放", () => {
    it("同一客户端的两个窗口在同一轮里窄改不同字段：后者冲突一次后在最新值上重放，两个修改都保留；对方的显示 adopt 后才更新", async () => {
        const w = await world();
        const changesA = changesOf();
        const changesB = changesOf();
        const a = hosted(pairStore(pairRecord, changesA), "browser");
        const b = hosted(pairStore(pairRecord, changesB), "browser");
        await w.window("browser-a", "profile-1", [a.plugin]);
        await w.window("browser-b", "profile-1", [b.plugin]);
        const storeA = a.get().store;
        const storeB = b.get().store;
        await waitUntil("两边就绪", () => storeA.state.pair.ready && storeB.state.pair.ready);

        const results = await Promise.all([storeA.actions.setLeft("左"), storeB.actions.setRight("右")]);
        expect(results).toEqual(["saved", "saved"]);
        // 只有重放拿到的值里有对方的修改：恰好冲突一次。
        const replays = changesA.seen.filter((current) => current.right === "右").length + changesB.seen.filter((current) => current.left === "左").length;
        expect(replays).toBe(1);
        expect(await valueOf(a.get().storage, pairRecord)).toEqual({left: "左", right: "右"});

        await waitUntil("两边的 base 都收到最终值", () => [storeA, storeB].every((store) => store.state.pair.base?.status === "ok" && store.state.pair.base.value.left === "左" && store.state.pair.base.value.right === "右"));
        expect(storeA.state.pair.display).toEqual({left: "左", right: ""});
        expect(storeB.state.pair.display).toEqual({left: "", right: "右"});
        storeA.actions.adopt();
        expect(storeA.state.pair.display).toEqual({left: "左", right: "右"});
    });

    it("重放后仍冲突：队首 failed、队列暂停，后面的修改保留在显示里；retry 成功后后面的接着发出", async () => {
        const changes = changesOf();
        const probe = hosted(pairStore(pairRecord, changes), "server");
        await world([probe.plugin]);
        const {store, storage} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        contend(changes, await opened(storage, pairRecord), () => store.state.pair.base?.revision ?? null);

        const first = store.actions.setLeft("我的");
        expect(await first).toBe("failed");
        expect(store.state.pair.save).toEqual({state: "failed", code: "conflict"});
        const second = store.actions.setRight("后面的");
        expect(store.state.pair.queue).toBe(2);
        expect(store.state.pair.display).toEqual({left: "我的", right: "后面的"});
        expect(store.state.pair.save.state).toBe("failed");

        expect(await store.actions.retry()).toBe("saved");
        expect(await second).toBe("saved");
        expect(store.state.pair.queue).toBe(0);
        expect(await valueOf(storage, pairRecord)).toEqual({left: "我的", right: "后面的"});
    });

    it("discard 只移除暂停的队首，显示改为剩余修改作用在 base 上；队首在途时为 busy，没有暂停的队首为 nothing", async () => {
        const changes = changesOf();
        const probe = hosted(pairStore(pairRecord, changes), "server");
        await world([probe.plugin]);
        const {store, storage} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        expect(store.actions.discard()).toBe("nothing");

        const inFlight = store.actions.setLeft("在途");
        expect(store.actions.discard()).toBe("busy");
        expect(await inFlight).toBe("saved");

        await waitUntil("base 收到在途的那次写入", () => store.state.pair.base?.status === "ok");
        contend(changes, await opened(storage, pairRecord), () => store.state.pair.base?.revision ?? null);
        const failing = store.actions.setLeft("要放弃的");
        expect(await failing).toBe("failed");
        const kept = store.actions.setRight("留下的");
        await waitUntil("base 收到另一个写者的值", () => store.state.pair.base?.status === "ok" && store.state.pair.base.value.left === "抢二");

        expect(store.actions.discard()).toBe("discarded");
        expect(store.state.pair.display).toEqual({left: "抢二", right: "留下的"});
        expect(await kept).toBe("saved");
        expect(await valueOf(storage, pairRecord)).toEqual({left: "抢二", right: "留下的"});
    });

    it("discardAll 移除暂停的队首与排在后面的全部修改，显示回到 base，不发出保存；没有暂停的队首为 nothing", async () => {
        const changes = changesOf();
        const probe = hosted(pairStore(pairRecord, changes), "server");
        await world([probe.plugin]);
        const {store, storage} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        expect(store.actions.discardAll()).toBe("nothing");
        contend(changes, await opened(storage, pairRecord), () => store.state.pair.base?.revision ?? null);
        const failing = store.actions.setLeft("要放弃的");
        expect(await failing).toBe("failed");
        const queued = store.actions.setRight("也放弃");
        await waitUntil("base 收到另一个写者的值", () => store.state.pair.base?.status === "ok" && store.state.pair.base.value.left === "抢二");
        expect(store.actions.discardAll()).toBe("discarded");
        expect(await queued).toBe("discarded");
        expect(store.state.pair.queue).toBe(0);
        expect(store.state.pair.display).toEqual({left: "抢二", right: ""});
        expect(await valueOf(storage, pairRecord)).toEqual({left: "抢二", right: ""});
    });
});

describe("Spec state.store 输出 10：change 在最新值上抛错", () => {
    it("显示上算得出、在 base 上抛错：这条以 failed（change-threw）结算并记诊断，队列暂停；discard 后照常，正常停止", async () => {
        const definition = defineStore("guarded", ({persist}) => {
            const pair = persist(pairRecord, {initial: EMPTY});
            return {state: {pair}, actions: {
                edit: () => pair.commit((current) => {
                    if (current.left === "已删除") throw new RangeError("要改的条目已经不在了");
                    return {...current, right: "改过"};
                }),
                discard: () => pair.discard(),
            }};
        });
        const probe = hosted(definition, "server");
        const w = await world([probe.plugin]);
        const {store, storage} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        expect(await (await opened(storage, pairRecord)).save({left: "已删除", right: ""}, {expect: null})).toMatchObject({ok: true});
        await waitUntil("base 收到别处的写入", () => store.state.pair.base?.status === "ok");

        expect(await store.actions.edit()).toBe("failed");
        expect(store.state.pair.save).toEqual({state: "failed", code: "change-threw"});
        expect(store.state.pair.queue).toBe(1);
        expect(w.diagnostics("hub").query({plugin: PLUGIN}).records.map((record) => record.event)).toContain("store.change-threw");
        expect(store.actions.discard()).toBe("discarded");
        expect(store.state.pair.queue).toBe(0);
        expect(await valueOf(storage, pairRecord)).toEqual({left: "已删除", right: ""});
    });
});

describe("Spec state.store 输出 12：无值记录的 revision 与受保护的记录", () => {
    /** 写者与懒激活的 store 放进同一份定义的两个入口（同一插件 id 在一个实例里只登记一次）；先由写者备好记录，再激活 store。 */
    async function prepared(prepare: (handle: RecordHandle<PairValue>, w: StorageWorld) => Promise<void>) {
        const raw = writer("server");
        const probe = hosted(pairStore(pairRecord, changesOf()), "server", {lazy: true});
        const w = await world([{id: PLUGIN, entries: [{...raw.plugin.entries[0]!, id: "writer"}, probe.plugin.entries[0]!]}]);
        await prepare(await opened(raw.storage(), pairRecord), w);
        expect(await w.hub.plugins.activate({plugin: PLUGIN, entry: "server"})).toMatchObject({status: "activated"});
        const {store} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        return {store, storage: raw.storage()};
    }

    function rewrite(w: StorageWorld, value: string, version: number): void {
        const db = new Database(w.userPath);
        db.query("UPDATE records SET value = ?1, version = ?2 WHERE owner = ?3 AND key = 'pair'").run(value, version, PLUGIN);
        db.close();
    }

    it("删除标记：base 为 missing 并带它的 revision，commit 以它为 expect 保存成功", async () => {
        let removed: string | null = null;
        const {store, storage} = await prepared(async (handle) => {
            const saved = await handle.save({left: "旧", right: ""}, {expect: null});
            if (!saved.ok) throw new Error(saved.code);
            const result = await handle.remove({expect: saved.revision});
            if (!result.ok) throw new Error(result.code);
            removed = result.revision;
        });
        expect(store.state.pair.base).toEqual({status: "missing", revision: removed});
        expect(await store.actions.setLeft("删除之后")).toBe("saved");
        expect(await valueOf(storage, pairRecord)).toEqual({left: "删除之后", right: ""});
    });

    for (const [status, value, version] of [["corrupt", "{坏的", 1], ["unsupported-version", JSON.stringify(EMPTY), 2]] as const) {
        it(`${status}：commit 直接 protected、不改显示；reset 以该快照的 revision 覆盖`, async () => {
            const {store, storage} = await prepared(async (handle, w) => {
                expect(await handle.save({left: "原件", right: ""}, {expect: null})).toMatchObject({ok: true});
                rewrite(w, value, version);
            });
            expect(store.state.pair.base?.status).toBe(status);
            expect(store.state.pair.canSave).toBe(false);
            expect(await store.actions.setLeft("普通修改")).toBe("protected");
            expect(store.state.pair.display).toEqual(EMPTY);
            expect(await store.actions.reset({left: "覆盖", right: status})).toBe("saved");
            expect(await valueOf(storage, pairRecord)).toEqual({left: "覆盖", right: status});
        });
    }
});

describe("Spec state.store 输出 13–14、场景 2：结果不确定", () => {
    const counterStore = defineStore("counter", ({persist}) => {
            const counter = persist(counterRecord, {initial: {count: 0}});
            return {
                state: {counter},
                actions: {
                    increment: () => counter.commit((current) => ({count: current.count + 1})),
                    retry: () => counter.retry(),
                    discard: () => counter.discard(),
                },
            };
        });

    /** 服务端一侧的同命名空间订阅者：收到 count 为 `at` 的写入通知时关掉窗口链路。 */
    async function cutOnWrite(hubStorage: StorageService, at: number, cut: () => void): Promise<RecordHandle<{count: number}>> {
        const handle = await opened(hubStorage, counterRecord);
        let armed = true;
        const subscribed = await handle.subscribe((snapshot) => {
            if (armed && snapshot.status === "ok" && snapshot.value.count === at) {
                armed = false;
                cut();
            }
        });
        if (!subscribed.ok) throw new Error(subscribed.code);
        return handle;
    }

    it("写已落盘、结果没回来：队首为 unknown；重连后 base 已是要写的值，retry 视为完成，不再发、不重复应用", async () => {
        const raw = writer("server");
        const w = await world([raw.plugin]);
        const probe = hosted(counterStore, "browser");
        const win = await w.window("browser-1", "profile-1", [probe.plugin]);
        const {store} = probe.get();
        await waitUntil("字段就绪", () => store.state.counter.ready);
        await cutOnWrite(raw.storage(), 1, () => win.disconnect());

        expect(await store.actions.increment()).toBe("unknown");
        expect(store.state.counter.save).toEqual({state: "unknown", code: "unknown-outcome"});
        expect(await win.reconnect()).toEqual({ok: true});
        await waitUntil("订阅重建后 base 收到落盘的值", () => store.state.counter.base?.status === "ok" && store.state.counter.base.value.count === 1);

        // 视为完成：重发的话原 expect 已过期，会得到冲突、结算为 unknown。
        expect(await store.actions.retry()).toBe("saved");
        expect(store.state.counter.queue).toBe(0);
        expect(await valueOf(raw.storage(), counterRecord)).toEqual({count: 1});
    });

    it("断线期间别处又写了：retry 以原值、原 expect 重发，冲突仍为 unknown，不在新值上再加一；discard 后显示回到 base", async () => {
        const raw = writer("server");
        const w = await world([raw.plugin]);
        const probe = hosted(counterStore, "browser");
        const win = await w.window("browser-1", "profile-1", [probe.plugin]);
        const {store} = probe.get();
        await waitUntil("字段就绪", () => store.state.counter.ready);
        const hub = await cutOnWrite(raw.storage(), 1, () => win.disconnect());

        expect(await store.actions.increment()).toBe("unknown");
        const landed = await hub.read();
        if (landed.status !== "ok") throw new Error(landed.status);
        expect(await hub.save({count: 5}, {expect: landed.revision})).toMatchObject({ok: true});
        expect(await win.reconnect()).toEqual({ok: true});
        await waitUntil("base 收到别处的写入", () => store.state.counter.base?.status === "ok" && store.state.counter.base.value.count === 5);

        expect(await store.actions.retry()).toBe("unknown");
        expect(await valueOf(raw.storage(), counterRecord)).toEqual({count: 5});
        expect(store.actions.discard()).toBe("discarded");
        expect(store.state.counter.display).toEqual({count: 5});
    });
});

describe("Spec state.store 输出 16、场景 4：订阅结束与重开", () => {
    it("提供方入口停止而 store 仍活着：canSave 立即为 false，排队的修改暂停；reopen 在提供方回来之前仍失败", async () => {
        const w = await world();
        const project = await w.project(1, []);
        const changes = changesOf();
        const probe = hosted(pairStore(projectPairRecord, changes), "browser");
        await w.window("browser-1", "profile-1", [probe.plugin]);
        const {store} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        expect(store.state.pair.canSave).toBe(true);

        // 项目实例有序停止：它的 Storage 入口先停，窗口里的订阅以 provider-stopped 结束，窗口与链路都还在。
        expect(await project.stop()).toMatchObject({status: "closed"});
        await waitUntil("订阅结束", () => store.state.pair.failure !== null);
        expect(store.state.pair.failure).toBe("provider-stopped");
        expect(store.state.pair.canSave).toBe(false);
        expect(await store.actions.setLeft("排队的")).toBe("failed");
        expect(store.state.pair.queue).toBe(1);
        expect(store.state.pair.display).toEqual({left: "排队的", right: ""});
        // 只为显示调用过一次 change：没有发出保存。
        expect(changes.seen).toHaveLength(1);

        await store.actions.reopen();
        expect(store.state.pair.failure).not.toBeNull();
        expect(await store.actions.retry()).toBe("failed");
        expect(changes.seen).toHaveLength(1);
    });
});

describe("Spec state.store 输出 16：读取错误与 reopen", () => {
    it("首个快照是读取错误：提交以 failed 结算、队列暂停；库恢复后 reopen 拿到基线，retry 落盘", async () => {
        const raw = writer("server");
        const probe = hosted(pairStore(pairRecord, changesOf()), "server", {lazy: true});
        const w = await world([{id: PLUGIN, entries: [{...raw.plugin.entries[0]!, id: "writer"}, probe.plugin.entries[0]!]}]);
        expect(await (await opened(raw.storage(), pairRecord)).save({left: "原来的", right: ""}, {expect: null})).toMatchObject({ok: true});
        const rename = (from: string, to: string): void => {
            const db = new Database(w.userPath);
            db.run(`ALTER TABLE ${from} RENAME TO ${to}`);
            db.close();
        };
        rename("records", "records_away");
        expect(await w.hub.plugins.activate({plugin: PLUGIN, entry: "server"})).toMatchObject({status: "activated"});
        const {store} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        expect(store.state.pair.failure).toBe("io-error");
        expect(store.state.pair.canSave).toBe(false);
        expect(await store.actions.setRight("要写的")).toBe("failed");
        expect(store.state.pair.save).toEqual({state: "failed", code: "io-error"});

        rename("records_away", "records");
        await store.actions.reopen();
        await waitUntil("拿到基线", () => store.state.pair.base?.status === "ok");
        expect(store.state.pair.failure).toBeNull();
        expect(await store.actions.retry()).toBe("saved");
        expect(await valueOf(raw.storage(), pairRecord)).toEqual({left: "原来的", right: "要写的"});
    });
});

describe("Spec state.store 输出 17、场景 3：停止时发出", () => {
    it("窗口里的入口正常停止：已接受的修改经远程服务依次落盘后才释放；停止开始后 action 抛错", async () => {
        const raw = writer("server");
        const w = await world([raw.plugin]);
        const probe = hosted(pairStore(pairRecord, changesOf()), "browser");
        await w.window("browser-1", "profile-1", [probe.plugin]);
        const {store, context} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);

        const first = store.actions.setLeft("一");
        const second = store.actions.setRight("二");
        const stopping = stopEntry(context);
        expect(() => store.actions.setLeft("停止之后")).toThrow(StoreStoppedError);
        await stopping;
        expect([await first, await second]).toEqual(["saved", "saved"]);
        expect(await valueOf(raw.storage(), pairRecord)).toEqual({left: "一", right: "二"});
    });

    it("队首确定失败：其余修改以 cancelled 结算并记诊断", async () => {
        const changes = changesOf();
        const probe = hosted(pairStore(pairRecord, changes), "server");
        const raw = writer("server");
        const plugin: PluginDefinition = {id: PLUGIN, entries: [probe.plugin.entries[0]!, {...raw.plugin.entries[0]!, id: "writer"}]};
        const w = await world([plugin]);
        const {store, context} = probe.get();
        await waitUntil("字段就绪", () => store.state.pair.ready);
        contend(changes, await opened(raw.storage(), pairRecord), () => store.state.pair.base?.revision ?? null);

        const first = store.actions.setLeft("一");
        const second = store.actions.setRight("二");
        await stopEntry(context);
        expect([await first, await second]).toEqual(["failed", "cancelled"]);
        const records = w.diagnostics("hub").query({plugin: PLUGIN}).records.filter((record) => record.event === "store.intents-cancelled");
        expect(records.map((record) => record.data)).toEqual([{cancelled: 1}]);
        expect(await valueOf(raw.storage(), pairRecord)).toEqual({left: "抢二", right: ""});
    });
});

describe("Spec state.store 输出 19：读配置", () => {
    const themeSetting = defineSetting({plugin: PLUGIN, name: "theme", schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]), default: "nbook", title: {"zh-CN": "主题", "en-US": "Theme"}});

    it("setting 是配置的有效值，随本窗口的写入与外部改文件变化，setup 里的 computed 跟着变；没给 settings 时 create 抛错", async () => {
        counter += 1;
        const root = join(tmp, `settings-${String(counter)}`);
        await mkdir(join(root, "state"), {recursive: true});
        await writeFile(join(root, "state", "settings.json"), "{\"test.pair/theme\": \"macos\"}");
        const declared: PluginDefinition = {id: PLUGIN, entries: [], contributions: [themeSetting.contribution]};
        const settingsWorlds = await settingsWorld(root, [declared]);
        try {
            const prefs = defineStore("prefs", ({setting}) => {
                const theme = setting(themeSetting);
                const shout = computed(() => theme.value.toUpperCase());
                return {state: {theme, shout}, actions: {}};
            });
            const seen: {store: Store<{theme: Ref<string>; shout: Ref<string>}, Record<string, never>> | null; settings: SettingsService | null; missing: unknown} = {store: null, settings: null, missing: null};
            const plugin: PluginDefinition = {
                id: PLUGIN,
                contributions: [themeSetting.contribution],
                entries: [defineEntry({
                    id: "browser",
                    location: "browser",
                    activationEvents: ["onStartup"],
                    dependencies: [{key: settingsKey}, {key: diagnosticsKey}],
                    activate: (context) => {
                        const settings = context.services.require(settingsKey);
                        const diagnostics = context.services.require(diagnosticsKey);
                        seen.settings = settings;
                        seen.store = prefs.create(context, {settings, diagnostics}) as never;
                        try {
                            prefs.create(context, {diagnostics});
                        } catch (error) {
                            seen.missing = error;
                        }
                        return {};
                    },
                })],
            };
            await settingsWorlds.window("w", [plugin], {bound: false});
            const store = seen.store!;
            expect(store.state.theme).toBe("macos");
            expect(store.state.shout).toBe("MACOS");
            expect(seen.missing).toBeInstanceOf(TypeError);
            expect(String(seen.missing)).toContain("settings");

            expect(await seen.settings!.update(themeSetting, "nbook")).toEqual({ok: true});
            expect(store.state.shout).toBe("NBOOK");
            await writeFile(join(root, "state", "settings.json"), "{\"test.pair/theme\": \"macos\"}");
            await waitUntil("外部改文件后 store 跟着变", () => {
                settingsWorlds.clock.advance(RELOAD_DELAY_MS);
                return store.state.theme === "macos";
            });
        } finally {
            for (const result of await settingsWorlds.close()) expect(result).toMatchObject({status: "closed"});
        }
    });
});
