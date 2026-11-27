/**
 * 页面标签的内容（docs/specs/workbench/editor.md 输出 33）：页面组件加载期间内容区是带 aria-busy 的“正在加载页面”，加载完换成
 * 页面组件；加载失败写出原因、不再带 aria-busy。页面经真实内核的贡献点交付：拥有者插件用产品的校验与 `EditorPageRegistry`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {computed, defineComponent, h, nextTick, ref, shallowRef} from "vue";
import type {Component} from "vue";

import type {Application} from "@notnotype/nb-runtime/application";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {EDITOR_PAGES_POINT, validateEditorPageContribution} from "../shared/contracts";
import {editorText} from "../shared/text";
import {createEditorArea} from "./area";
import EditorGroup from "./components/EditorGroup.vue";
import EditorGroupHead from "./components/EditorGroupHead.vue";
import {EditorPageRegistry, pageAddress} from "./pages";
import {editorStateValues} from "./state";
import type {EditorPageImplementation} from "./pages";
import {editorCatalogs} from "./text";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";

import {createApplication} from "nbook/application";
import {createMemoryFiles} from "nbook/plugins/explorer/web/lab/memory-files";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

const PAGE_ID = "test.pages.sample";

/** 编辑组注入的窗口端口；断言里的界面文字经它从目录取。 */
const port = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

/** 由测试决定何时完成的页面加载。 */
function deferred(): {readonly load: () => Promise<Component>; resolve(component: Component): void; reject(error: Error): void} {
    const settle: {resolve: (component: Component) => void; reject: (error: Error) => void} = {resolve: () => undefined, reject: () => undefined};
    const promise = new Promise<Component>((resolve, reject) => Object.assign(settle, {resolve, reject}));
    return {load: () => promise, resolve: (component) => settle.resolve(component), reject: (error) => settle.reject(error)};
}

/** `activationEvents` 给空列表时提供方的入口永不激活：声明照样登记，实现一直不交付（刷新后恢复、贡献方还没激活的样子）。 */
async function start(load: () => Promise<Component>, extra: {readonly declaration?: Record<string, unknown>; readonly implementation?: Partial<EditorPageImplementation>; readonly activationEvents?: readonly string[]} = {}): Promise<EditorPageRegistry> {
    const holder: {registry: EditorPageRegistry | null} = {registry: null};
    const owner: PluginDefinition = {
        id: "test.owner",
        contributionPoints: [{id: EDITOR_PAGES_POINT, implementation: "required", validate: validateEditorPageContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [EDITOR_PAGES_POINT],
            activate: (context) => {
                holder.registry = new EditorPageRegistry(context.declarations);
                return {receivers: {[EDITOR_PAGES_POINT]: holder.registry.receiver()}};
            },
        }],
    };
    const provider: PluginDefinition = {
        id: "test.pages",
        entries: [{
            id: "main",
            location: "browser",
            activationEvents: [...(extra.activationEvents ?? ["onStartup"])],
            contributions: [{capability: EDITOR_PAGES_POINT, id: PAGE_ID, declaration: {title: {"zh-CN": "样例", "en-US": "Sample"}, icon: "i-lucide-file", ...extra.declaration}}],
            activate: () => {
                const implementation: EditorPageImplementation = {load, ...extra.implementation};
                return {contributions: {[EDITOR_PAGES_POINT]: {[PAGE_ID]: implementation}}};
            },
        }],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "editor-pages"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, provider], requiredPlugins: ["test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    if (holder.registry === null) throw new Error("拥有者没有激活");
    return holder.registry;
}

const Page = defineComponent({
    name: "TestPage",
    props: {context: {type: Object, required: true}},
    setup: () => () => h("div", {"data-test-page": ""}),
});

/** 像编辑组那样渲染页面标签的内容：组件收到 `context`；加载失败经应用的错误处理报上来。 */
function mountPage(registry: EditorPageRegistry) {
    const errors: unknown[] = [];
    const source = registry.source({recent: []});
    const component = source.component(PAGE_ID);
    if (component === null) throw new Error("页面没有交付");
    const wrapper = mount(defineComponent({setup: () => () => h(component, {context: source.context({id: "tab-1", address: pageAddress(PAGE_ID)})})}), {
        global: {config: {errorHandler: (error) => errors.push(error)}, provide: provideText(port)},
    });
    return {wrapper, errors};
}

describe("页面标签的内容", () => {
    it("加载期间是带 aria-busy 的“正在加载页面”，context 不落成 DOM 属性；加载完换成页面组件，aria-busy 撤掉", async () => {
        const page = deferred();
        const {wrapper} = mountPage(await start(page.load));
        await flushPromises();
        const loading = wrapper.get("[aria-busy=\"true\"]");
        expect(loading.attributes("role")).toBe("status");
        expect(loading.text()).toBe(port.t(editorText("page.loading")));
        expect(loading.attributes("context")).toBeUndefined();

        page.resolve(Page);
        await flushPromises();
        expect(wrapper.find("[aria-busy]").exists()).toBe(false);
        expect(wrapper.find("[data-test-page]").exists()).toBe(true);
    });

    it("加载失败：写出原因（role=alert），不再带 aria-busy；错误交给应用的错误处理", async () => {
        const page = deferred();
        const {wrapper, errors} = mountPage(await start(page.load));
        await flushPromises();
        page.reject(new Error("chunk 404"));
        await flushPromises();
        expect(wrapper.find("[aria-busy]").exists()).toBe(false);
        expect(wrapper.get("[role=\"alert\"]").text()).toBe(port.t(editorText("page.failed", {reason: "chunk 404"})));
        expect(errors).toEqual([new Error("chunk 404")]);
    });
});

describe("Spec workbench.editor 输出 33：带参数与可恢复的页面", () => {
    const tab = (id: string, arg: string, title?: string) => ({id, address: pageAddress(PAGE_ID, arg), ...(title === undefined ? {} : {title})});

    it("图标（输出 53）：页面此刻给的跟着它读的数据变；页面给 null 或不是 lucide 类名时用标签上记着的，再没有用声明的", async () => {
        const kinds = ref<Record<string, string | null>>({a: "i-lucide-user-round", b: null, c: "fa-solid fa-user"});
        const registry = await start(() => Promise.resolve(Page), {declaration: {instances: true, restore: true}, implementation: {icon: (arg) => kinds.value[arg ?? ""] ?? null}});
        const source = registry.source({recent: []});
        const icon = computed(() => source.icon(tab("t1", "a")));
        expect(icon.value).toBe("i-lucide-user-round");
        kinds.value = {...kinds.value, a: "i-lucide-building-2"};
        expect(icon.value).toBe("i-lucide-building-2");
        expect(source.liveIcon(tab("t1", "a"))).toBe("i-lucide-building-2");
        expect(source.liveIcon(tab("t2", "b"))).toBeNull();
        expect(source.icon({...tab("t2", "b"), icon: "i-lucide-map-pin"})).toBe("i-lucide-map-pin");
        expect(source.icon(tab("t2", "b"))).toBe("i-lucide-file");
        // 格式不对的不认：它会随标签记录存盘，存不下会让整条记录写不进去。
        expect(source.liveIcon(tab("t3", "c"))).toBeNull();
        expect(source.icon(tab("t3", "c"))).toBe("i-lucide-file");
    });

    it("标题：页面此刻给的跟着它读的数据变；页面给 null 时用标签上记着的，再没有用声明的；贡献方停了以后回到记着的", async () => {
        const names = ref<Record<string, string | null>>({a: "星瑕", b: null});
        const registry = await start(() => Promise.resolve(Page), {declaration: {instances: true, restore: true}, implementation: {title: (arg) => {
            const name = names.value[arg ?? ""] ?? null;
            return name === null ? null : {"zh-CN": name, "en-US": name};
        }}});
        const source = registry.source({recent: []});
        // 像标签条那样在计算里读：数据变了，标题跟着变。
        const title = computed(() => source.title(tab("t1", "a"), port));
        expect(title.value).toBe("星瑕");
        names.value = {...names.value, a: "星瑕（哥哥）"};
        expect(title.value).toBe("星瑕（哥哥）");
        expect(source.liveTitle(tab("t1", "a"), port)).toBe("星瑕（哥哥）");

        expect(source.liveTitle(tab("t2", "b"), port)).toBeNull();
        expect(source.title(tab("t2", "b", "记着的名字"), port)).toBe("记着的名字");
        expect(source.title(tab("t2", "b"), port)).toBe("样例");

        // 贡献方停了：不再调实现（句柄已撤回），标题退回记着的那个；没记过、声明也不在了就是 null。
        await started.splice(0)[0]!.stop();
        expect(source.title(tab("t1", "a", "星瑕（哥哥）"), port)).toBe("星瑕（哥哥）");
        expect(source.title(tab("t1", "a"), port)).toBeNull();
        expect(source.crumbs(tab("t1", "a"), port)).toEqual([]);
    });

    it("每个标签一份 context：带着自己的参数与 state，同一个标签每次是同一个对象；state 的初值来自 initialState，标签关掉以后丢弃", async () => {
        const registry = await start(() => Promise.resolve(Page), {declaration: {instances: true}, implementation: {initialState: (arg) => ({count: 0, of: arg})}});
        const shared = ref<string[]>(["project://a.md"]);
        const source = registry.source({get recent() { return shared.value; }});
        const a = source.context(tab("t1", "a"));
        const b = source.context(tab("t2", "b"));
        expect([a.arg, b.arg]).toEqual(["a", "b"]);
        expect(a.state).toEqual({count: 0, of: "a"});
        expect(b.state).toEqual({count: 0, of: "b"});
        (a.state as {count: number}).count += 1;
        expect(source.context(tab("t1", "a"))).toBe(a);
        expect((source.context(tab("t1", "a")).state as {count: number}).count).toBe(1);
        expect((b.state as {count: number}).count).toBe(0);
        // state 是响应式的：页面在计算里读它。
        const doubled = computed(() => (a.state as {count: number}).count * 2);
        (a.state as {count: number}).count = 5;
        expect(doubled.value).toBe(10);
        // 共用的“最近打开”变了，每个标签都看得到。
        shared.value = ["project://b.md"];
        expect(a.recent).toEqual(["project://b.md"]);

        source.release("t1");
        expect(source.context(tab("t1", "a")).state).toEqual({count: 0, of: "a"});
        // 不带参数的页面没有 arg；实现不给 initialState 时是空对象。
        const plain = await start(() => Promise.resolve(Page));
        const context = plain.source({recent: []}).context({id: "t9", address: pageAddress(PAGE_ID)});
        expect("arg" in context).toBe(false);
        expect(context.state).toEqual({});
    });

    it("面包屑：各段的文字经界面文字翻译；带命令的段执行那条命令；页面没给时没有", async () => {
        const registry = await start(() => Promise.resolve(Page), {declaration: {instances: true}, implementation: {breadcrumbs: (arg) => (arg === "none" ? null : [
            {label: {"zh-CN": "设定", "en-US": "Canon"}, command: {id: "nbook.view.open", args: {viewId: "nbook.canon.entries"}}},
            {label: {"zh-CN": "人物", "en-US": "People"}},
            {label: {"zh-CN": `条目 ${arg ?? ""}`, "en-US": `Entry ${arg ?? ""}`}},
        ])}});
        const executed: Array<[string, unknown]> = [];
        const source = registry.source({recent: []}, (id, args) => executed.push([id, args]));
        const crumbs = source.crumbs(tab("t1", "a"), port);
        expect(crumbs.map((crumb) => [crumb.label, crumb.run !== undefined])).toEqual([["设定", true], ["人物", false], ["条目 a", false]]);
        crumbs[0]!.run!();
        expect(executed).toEqual([["nbook.view.open", {viewId: "nbook.canon.entries"}]]);
        expect(source.crumbs(tab("t2", "none"), port)).toEqual([]);
    });

    it("声明校验：instances 与 openOnFirstVisit 同写被拒；别的组合照常", () => {
        const descriptor = (declaration: Record<string, unknown>) => ({location: "browser", id: "test.pages.sample", declaration: {title: {"zh-CN": "样例", "en-US": "Sample"}, icon: "i-lucide-file", ...declaration}}) as never;
        expect(validateEditorPageContribution(descriptor({instances: true, openOnFirstVisit: true}))).toContain("instances and openOnFirstVisit");
        expect(validateEditorPageContribution(descriptor({instances: true, restore: true}))).toBeNull();
        expect(validateEditorPageContribution(descriptor({openOnFirstVisit: true, restore: true}))).toBeNull();
        expect(validateEditorPageContribution(descriptor({restore: true}))).toBeNull();
    });
});

describe("Spec workbench.editor 输出 33、场景 44：编辑组里两个同种页面的标签", () => {
    /** 页面组件：一个计数放在 `context.state`，另一个只在组件里；都能点着加一。 */
    const Counter = defineComponent({
        name: "TestCounterPage",
        props: {context: {type: Object, required: true}},
        setup: (props) => {
            const local = ref(0);
            const state = (props.context as {state: {count: number}; arg: string}).state;
            return () => h("button", {"data-counter": (props.context as {arg: string}).arg, "data-state": String(state.count), "data-local": String(local.value), onClick: () => {
                state.count += 1;
                local.value += 1;
            }});
        },
    });

    it("各有各的 context：切到另一个标签再回来，state 里的计数还在、组件里的计数归零；标签条下面是页面给的面包屑，换了设置就没有", async () => {
        const executed: string[] = [];
        const registry = await start(() => Promise.resolve(Counter), {declaration: {instances: true, restore: true}, implementation: {
            initialState: () => ({count: 0}),
            breadcrumbs: (arg) => [{label: {"zh-CN": "样例", "en-US": "Sample"}, command: {id: "test.sample.open"}}, {label: {"zh-CN": `条目 ${arg ?? ""}`, "en-US": `Entry ${arg ?? ""}`}}],
        }});
        const memory = createMemoryFiles({project: [], user: []});
        const source = registry.source({recent: []}, (id) => executed.push(id));
        const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, pageHasBreadcrumbs: (tab) => source.crumbs(tab, port).length > 0, report: (error) => {
            throw error;
        }});
        const a = area.openPage(PAGE_ID, {arg: "a", restore: true});
        const b = area.openPage(PAGE_ID, {arg: "b", restore: true});
        if (!a.ok || !b.ok) throw new Error("打不开页面");
        // 内容层里每个标签一块，各挂一个 EditorGroup。
        const show = (tabId: string, breadcrumbs = true) => mount(EditorGroup, {props: {area, groupId: area.groups.activeGroup.value, tabId, control: () => ({kind: "pending" as const}), pages: source, breadcrumbs}, attachTo: document.body, global: {provide: provideText(port)}});
        const [first, second] = [show(a.tabId), show(b.tabId)];
        const counter = (wrapper: ReturnType<typeof show>) => wrapper.find("[data-counter]");
        try {
            await flushPromises();
            // b 是活动的：只有它那一块渲染页面。
            expect(counter(first).exists()).toBe(false);
            expect(counter(second).attributes()).toMatchObject({"data-counter": "b", "data-state": "0", "data-local": "0"});
            expect(second.findAll("[data-page-crumb]").map((crumb) => crumb.text())).toEqual(["样例", "条目 b"]);

            area.activate(a.tabId);
            await flushPromises();
            await counter(first).trigger("click");
            expect(counter(first).attributes()).toMatchObject({"data-counter": "a", "data-state": "1", "data-local": "1"});
            expect(counter(second).exists()).toBe(false);

            area.activate(b.tabId);
            await flushPromises();
            expect(counter(second).attributes()).toMatchObject({"data-state": "0", "data-local": "0"});
            area.activate(a.tabId);
            await flushPromises();
            // 组件是重新挂上的（组件里的计数归零），state 还是这个标签原来的那一份。
            expect(counter(first).attributes()).toMatchObject({"data-state": "1", "data-local": "0"});

            // 面包屑：点带命令的段执行它；命令 focus-breadcrumbs 对有面包屑的页面可用，Escape 把焦点还回去（段是原生按钮，Enter 等于点击，这里测不了）。
            await first.get("[data-page-crumb=\"0\"]").trigger("click");
            expect(executed).toEqual(["test.sample.open"]);
            // 命令的 `when` 读公开状态 `breadcrumbs`：页面标签不是“活动的编辑器”，有面包屑时照样可用。
            const state = editorStateValues(shallowRef(area));
            expect([state.active.value, state.breadcrumbs.value]).toEqual([false, true]);
            expect(area.focusBreadcrumbs()).toEqual({ok: true});
            await nextTick();
            expect(document.activeElement).toBe(first.get("[data-page-crumb=\"0\"]").element);
            await first.get("[data-page-crumb=\"0\"]").trigger("keydown", {key: "Escape"});
            expect(document.activeElement).toBe(first.get("[data-editor-page]").element);

            // 关了面包屑的设置：这一行没有。
            const plain = show(a.tabId, false);
            await flushPromises();
            expect(plain.find("[data-editor-page-breadcrumbs]").exists()).toBe(false);
            plain.unmount();
        } finally {
            first.unmount();
            second.unmount();
            area.dispose();
            memory.dispose();
            document.body.innerHTML = "";
        }
    });

    it("声明在、实现还没交付（刷新后恢复、贡献方还没激活）：内容区是“正在加载页面”，不是“这个页面已经不在了”；声明也不在时才是后者", async () => {
        const registry = await start(() => Promise.resolve(Counter), {declaration: {instances: true, restore: true}, activationEvents: []});
        const memory = createMemoryFiles({project: [], user: []});
        const source = registry.source({recent: []});
        const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, report: (error) => {
            throw error;
        }});
        const waiting = area.openPage(PAGE_ID, {arg: "a", restore: true});
        const gone = area.openPage("test.pages.gone", {arg: "x", restore: true});
        if (!waiting.ok || !gone.ok) throw new Error("打不开页面");
        const show = (tabId: string) => mount(EditorGroup, {props: {area, groupId: area.groups.activeGroup.value, tabId, control: () => ({kind: "pending" as const}), pages: source, breadcrumbs: true}, attachTo: document.body, global: {provide: provideText(port)}});
        const [pending, missing] = [show(waiting.tabId), show(gone.tabId)];
        try {
            area.activate(waiting.tabId);
            await flushPromises();
            const loading = pending.get("[data-editor-page-pending]");
            expect([loading.attributes("role"), loading.attributes("aria-busy"), loading.text()]).toEqual(["status", "true", port.t(editorText("page.loading"))]);
            expect(pending.find("[data-editor-page-missing]").exists()).toBe(false);

            area.activate(gone.tabId);
            await flushPromises();
            expect(missing.find("[data-editor-page-missing]").exists()).toBe(true);
            expect(missing.find("[data-editor-page-pending]").exists()).toBe(false);
        } finally {
            pending.unmount();
            missing.unmount();
            area.dispose();
            memory.dispose();
            document.body.innerHTML = "";
        }
    });
});

describe("Spec workbench.editor 输出 68：页面的未提交内容", () => {
    const Plain = defineComponent({name: "TestPlainPage", props: {context: {type: Object, required: true}}, setup: () => () => h("div", {"data-test-page": ""})});

    /** 两个同种页面的标签（a、b），页面按参数报告未提交、接提交；`pending` 是页面自己在组件之外持有的状态。 */
    async function twoTabs(implementation: Partial<EditorPageImplementation>) {
        const registry = await start(() => Promise.resolve(Plain), {declaration: {instances: true}, implementation});
        const memory = createMemoryFiles({project: ["notes/a.md"], user: []});
        const source = registry.source({recent: []});
        const reported: unknown[] = [];
        const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, pageUncommitted: (tab) => source.uncommitted(tab), pageCommit: (tab) => source.commit(tab), report: (error) => {
            reported.push(error);
        }});
        const a = area.openPage(PAGE_ID, {arg: "a"});
        const b = area.openPage(PAGE_ID, {arg: "b"});
        if (!a.ok || !b.ok) throw new Error("打不开页面");
        const head = mount(EditorGroupHead, {props: {area, groupId: area.groups.activeGroup.value, pages: source}, attachTo: document.body, global: {provide: provideText(port)}});
        const dirtyTabs = () => head.findAll("[data-editor-tab-dirty]").map((tab) => tab.attributes("data-editor-tab"));
        const dispose = () => {
            head.unmount();
            area.dispose();
            memory.dispose();
            document.body.innerHTML = "";
        };
        return {area, a: a.tabId, b: b.tabId, dirtyTabs, reported, state: editorStateValues(shallowRef(area)), dispose};
    }

    it("页面说有未提交内容的标签带圆点，不在前台的也带；活动的是它时 dirty 为真，保存调用它的 commit 并等它完成", async () => {
        const pending = ref(new Set<string>(["a"]));
        const committed: string[] = [];
        const gate: {release: () => void} = {release: () => undefined};
        const scene = await twoTabs({
            uncommitted: (arg) => arg !== undefined && pending.value.has(arg),
            commit: async (arg) => {
                await new Promise<void>((resolve) => {
                    gate.release = resolve;
                });
                committed.push(arg ?? "");
                pending.value = new Set([...pending.value].filter((item) => item !== arg));
            },
        });
        try {
            await flushPromises();
            // b 是活动的，a 在后台：圆点在 a 上，公开状态看的是活动标签。
            expect(scene.dirtyTabs()).toEqual([scene.a]);
            expect(scene.state.dirty.value).toBe(false);

            scene.area.activate(scene.a);
            await flushPromises();
            expect(scene.state.dirty.value).toBe(true);
            let settled = false;
            const saving = scene.area.save().then((result) => {
                settled = true;
                return result;
            });
            await flushPromises();
            // commit 还没完成：保存在等它。
            expect([settled, committed]).toEqual([false, []]);
            gate.release();
            expect(await saving).toEqual({ok: true});
            expect(committed).toEqual(["a"]);
            await flushPromises();
            expect([scene.dirtyTabs(), scene.state.dirty.value]).toEqual([[], false]);

            // 页面没有文档：不进“未保存的文档”。
            pending.value = new Set(["a", "b"]);
            await flushPromises();
            expect(scene.dirtyTabs().sort()).toEqual([scene.a, scene.b].sort());
            expect(scene.state.hasUnsavedDocuments.value).toBe(false);
        } finally {
            scene.dispose();
        }
    });

    it("commit 失败（reject）时保存报告失败并把错误交给诊断；没给 commit 的页面保存照旧不可用、没有圆点", async () => {
        const failing = await twoTabs({uncommitted: () => true, commit: () => Promise.reject(new Error("boom"))});
        try {
            const result = await failing.area.save();
            expect(result).toEqual({ok: false, reason: editorText("refusal.pageCommitFailed")});
            expect(failing.reported.map((error) => (error as Error).message)).toEqual(["boom"]);
        } finally {
            failing.dispose();
        }
        const plain = await twoTabs({});
        try {
            await flushPromises();
            expect([plain.dirtyTabs(), plain.state.dirty.value]).toEqual([[], false]);
            expect(await plain.area.save()).toEqual({ok: false, reason: editorText("refusal.noActiveDocument")});
        } finally {
            plain.dispose();
        }
    });
});
