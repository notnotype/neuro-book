/**
 * 面板命令与工作台公开状态（docs/specs/ui/workbench-layout.md 输出 35、36、11、13，docs/specs/workbench/commands.md 第二批）：
 * 真实的一棵树的布局 store（Storage 场地），命令实现直接调用。声明的合规由命令系统登记时用的同一份校验检查；经命令注册表的可用性
 * 用真实注册表加工作台公开状态的绑定。面板头的框架按钮点了之后的真实页面行为在 `e2e/workbench-shell.e2e.ts`。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ContextKeySource} from "nbook/plugins/commands/shared/context-keys";
import {commandDeclarationProblems, createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";

import {regionContainers, viewSection} from "../state/containers";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {workbenchState, workbenchStateBindings} from "../state/public-state";
import {openLayoutDoc} from "../testing/layout-doc";
import {
    DOCK_COMMAND,
    FLOAT_COMMAND,
    PANEL_COMMAND_DECLARATIONS,
    panelCommands,
    SET_PANEL_COLLAPSED_COMMAND,
    TOGGLE_PANEL_MAXIMIZED_COMMAND,
} from "./panel-commands";
import {completedCommand} from "../../testing/declarations";
import {failureText, workbenchTestText} from "../../testing/text";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "panel-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function layout(): Promise<LayoutDocStore> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    return (await openLayoutDoc(w, "w", "c")).store;
}

/** 视图所在的分节（面板 id）：区域里能聚焦、收起、最大化的是分节，锚自己不显示。 */
function sectionOf(store: LayoutDocStore, viewId: string): string {
    const section = viewSection(store.actions.document(), viewId);
    if (section === null) throw new Error(`${viewId} 不在区域里`);
    return section.panel;
}

describe("声明", () => {
    it("面板命令的声明通过命令系统的校验；when 只引用工作台声明的公开键", () => {
        const declared = new Set((Object.keys(workbenchState.declarations) as (keyof typeof workbenchState.declarations)[]).map((name) => workbenchState.key(name)));
        expect(Object.keys(PANEL_COMMAND_DECLARATIONS).sort()).toEqual([DOCK_COMMAND, FLOAT_COMMAND, SET_PANEL_COLLAPSED_COMMAND, TOGGLE_PANEL_MAXIMIZED_COMMAND]);
        for (const [id, declaration] of Object.entries(PANEL_COMMAND_DECLARATIONS)) {
            expect(commandDeclarationProblems(id, "nbook.workbench", completedCommand(id, declaration)), id).toEqual([]);
            for (const key of declaration.when.requires) expect(declared.has(key), key).toBe(true);
        }
    });

    it("位置、对齐的公开键与旧的紧凑、可最大化键已删除，不留别名（输出 36）", () => {
        expect(Object.keys(workbenchState.declarations).sort()).toEqual(["activityBarVisible", "auxiliaryBarVisible", "focusedPart", "hasCurrentPanel", "layoutReady", "maximized", "nonPhone", "panelVisible", "sidebarVisible"]);
    });
});

describe("公开状态（输出 36）", () => {
    it("store 未创建时都是未就绪值；就绪后 nonPhone 恒为真，当前面板、最大化与可见性随布局变化", async () => {
        const current = shallowRef<LayoutDocStore | null>(null);
        const keys = workbenchStateBindings(current);
        const snapshot = () => Object.fromEntries(Object.entries(keys).map(([name, binding]) => [name, binding.value]));
        expect(snapshot()).toEqual({layoutReady: false, nonPhone: false, hasCurrentPanel: false, maximized: false, panelVisible: false, sidebarVisible: false, auxiliaryBarVisible: false, activityBarVisible: false, focusedPart: "editor"});

        const store = await layout();
        current.value = store;
        expect(snapshot()).toEqual({layoutReady: true, nonPhone: true, hasCurrentPanel: false, maximized: false, panelVisible: true, sidebarVisible: true, auxiliaryBarVisible: true, activityBarVisible: true, focusedPart: "editor"});

        // 焦点进了区域里的分节：focusedPart 是区域的名字；进了编辑组是 editor。
        store.actions.focusPanel(sectionOf(store, "test.panel"));
        expect(snapshot()).toMatchObject({hasCurrentPanel: true, focusedPart: "panel"});
        store.actions.focusPanel("g0");
        expect(keys.focusedPart.value).toBe("editor");
        // 焦点移到外壳之外时当前面板保持原值。
        store.actions.focusPanel(null);
        expect(snapshot()).toMatchObject({hasCurrentPanel: true, focusedPart: "editor"});

        store.actions.toggleMaximized(sectionOf(store, "test.side"));
        expect(keys.maximized.value).toBe(true);
        // 侧栏里最大化的分节盖住了别的区域：它们都不算可见。
        expect(snapshot()).toMatchObject({sidebarVisible: true, panelVisible: false, auxiliaryBarVisible: false});
        store.actions.toggleMaximized(sectionOf(store, "test.side"));
        expect(snapshot()).toMatchObject({maximized: false, panelVisible: true, auxiliaryBarVisible: true});

        store.actions.setPartHidden("panel", true);
        expect(keys.panelVisible.value).toBe(false);
        store.actions.setPartHidden("activitybar", true);
        expect(keys.activityBarVisible.value).toBe(false);
    });

    it("分节收成标题行的区域算可见，拖到零的不算（输出 11、36）", async () => {
        const store = await layout();
        const keys = workbenchStateBindings(shallowRef<LayoutDocStore | null>(store));
        // 侧栏的分节收成标题行：仍占着地方。区域里要有两个分节才收得成（输出 11）。
        const side = sectionOf(store, "test.side");
        expect(store.actions.moveView("test.panel", {container: "view:test.side"}).ok).toBe(true);
        expect(store.actions.setCollapsed(side, true).ok).toBe(true);
        expect(keys.sidebarVisible.value).toBe(true);
        // 区域拖到零记在锚上：宽度为 0。
        store.actions.setCollapsed("auxiliarybar", true);
        expect(keys.auxiliaryBarVisible.value).toBe(false);
    });
});

describe("命令", () => {
    it("收起省略参数时切换，带参数时设成给定值；缺省作用在当前面板，panelId 优先", async () => {
        const store = await layout();
        const commands = panelCommands(() => store);
        // 侧栏里放两个分节：只显示一个时它收不成标题行（下一条）。
        const side = sectionOf(store, "test.side");
        expect(store.actions.moveView("test.panel", {container: "view:test.side"}).ok).toBe(true);
        const lower = sectionOf(store, "test.panel");
        store.actions.focusPanel(side);
        const collapsed = (panel: string) => store.state.doc.panels[panel]?.collapsed === true;

        expect(await commands[SET_PANEL_COLLAPSED_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(collapsed(side)).toBe(true);
        await commands[SET_PANEL_COLLAPSED_COMMAND].run({collapsed: true});
        expect(collapsed(side)).toBe(true);
        await commands[SET_PANEL_COLLAPSED_COMMAND].run({});
        expect(collapsed(side)).toBe(false);

        await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: lower, collapsed: true});
        expect(collapsed(lower)).toBe(true);
        expect(collapsed(side)).toBe(false);

        // 对区域的锚是整个区域拖到零：省略参数时按锚自己的记录切换。
        expect(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: "auxiliarybar"})).toEqual({ok: true, value: null});
        expect(collapsed("auxiliarybar")).toBe(true);
        expect(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: "auxiliarybar"})).toEqual({ok: true, value: null});
        expect(collapsed("auxiliarybar")).toBe(false);
    });

    it("收不成标题行的分节 unavailable，文档不变：底部面板的分节不折叠；区域此刻唯一显示的分节不能收起，记录里留着的收起切换时不算（输出 11、20、35）", async () => {
        const store = await layout();
        const commands = panelCommands(() => store);
        const [side, lower] = [sectionOf(store, "test.side"), sectionOf(store, "test.panel")];
        const before = store.actions.document();

        for (const args of [{}, {collapsed: true}, {collapsed: false}]) {
            expect(failureText(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: lower, ...args}))).toBe("底部面板里的视图不能收起");
        }
        for (const args of [{}, {collapsed: true}]) {
            const result = await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: side, ...args});
            expect(result).toMatchObject({ok: false, code: "unavailable"});
            expect(failureText(result)).toBe("这里只显示这一个视图，不能收起");
        }
        expect(store.actions.document()).toBe(before);

        // 两个分节时收起一个，再把另一个移走：记录留着，但它此刻没收起，切换仍然是“收起”，不可用；明说展开可以，把记录清掉。
        expect(store.actions.moveView("test.aux", {container: "view:test.side"}).ok).toBe(true);
        expect(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: side, collapsed: true})).toEqual({ok: true, value: null});
        expect(store.actions.moveView("test.aux", {container: "view:test.aux"}).ok).toBe(true);
        expect(store.actions.document().panels[side]?.collapsed).toBe(true);
        expect(failureText(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: side}))).toBe("这里只显示这一个视图，不能收起");
        expect(store.actions.document().panels[side]?.collapsed).toBe(true);
        expect(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: side, collapsed: false})).toEqual({ok: true, value: null});
        expect(store.actions.document().panels[side]?.collapsed).toBeUndefined();
    });

    it("最大化切换，不落盘；隐藏或收起最大化着的面板时退出（输出 13）", async () => {
        const store = await layout();
        const commands = panelCommands(() => store);
        const [side, lower] = [sectionOf(store, "test.side"), sectionOf(store, "test.panel")];
        // 区域唯一显示的分节收不成标题行：收起不可用，最大化不退出。
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({panelId: side});
        expect(await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: side, collapsed: true})).toMatchObject({ok: false, code: "unavailable"});
        expect(store.state.maximized).toBe(side);
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({panelId: side});
        // 侧栏里再放一个分节，下面才收得起来。
        expect(store.actions.moveView("test.aux", {container: "view:test.side"}).ok).toBe(true);
        store.actions.focusPanel(lower);
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({});
        expect(store.state.maximized).toBe(lower);
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({});
        expect(store.state.maximized).toBeNull();

        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({panelId: "g0"});
        expect(store.state.maximized).toBe("g0");
        // 换成另一块：同一时刻只有一块最大化。
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({panelId: side});
        expect(store.state.maximized).toBe(side);
        // 区域的锚自己不显示：区域里最大化的是一个分节，对锚不可用，原来的不变。
        expect(failureText(await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({panelId: "sidebar"}))).toBe("没有可以操作的面板");
        expect(store.state.maximized).toBe(side);
        await commands[SET_PANEL_COLLAPSED_COMMAND].run({panelId: side, collapsed: true});
        expect(store.state.maximized).toBeNull();
    });

    it("浮动与回到停靠；浮动窗不能最大化、不能收起；不能浮动的视图、不是浮动窗时 unavailable（输出 35、39）", async () => {
        const store = await layout();
        const catalog = new Map([
            ["v", {title: "v", icon: "i", location: "panel", layout: "scroll"}],
            ["fixed", {title: "f", icon: "i", location: "panel", layout: "scroll", floatable: false}],
        ] as const) as unknown as Parameters<typeof store.actions.acceptViewCatalog>[0];
        store.actions.acceptViewCatalog(catalog);
        const commands = panelCommands(() => store);
        const run = (id: keyof typeof commands, args: Record<string, unknown>) => commands[id].run(args);
        expect(await run(FLOAT_COMMAND, {tab: "view:fixed"})).toMatchObject({ok: false, code: "unavailable"});
        expect(store.actions.document().floats).toEqual([]);
        expect(await run(DOCK_COMMAND, {panelId: "panel"})).toMatchObject({ok: false, code: "unavailable"});

        expect(await run(FLOAT_COMMAND, {tab: "view:v"})).toEqual({ok: true, value: null});
        const floats = store.actions.document().floats;
        expect(floats).toHaveLength(1);
        const panel = floats[0]?.panel ?? "";
        // 已经独占一个窗。
        expect(await run(FLOAT_COMMAND, {tab: "view:v"})).toMatchObject({ok: false, code: "unavailable"});
        // 焦点在窗里时最大化、收起都不动，工作台不会空白。
        store.actions.focusPanel(panel);
        expect(failureText(await run(TOGGLE_PANEL_MAXIMIZED_COMMAND, {}))).toBe("浮动窗不能最大化");
        expect(store.state.maximized).toBeNull();
        expect(failureText(await run(SET_PANEL_COLLAPSED_COMMAND, {collapsed: true}))).toBe("浮动窗不能收起");
        expect(store.actions.document().panels[panel]?.collapsed).toBeUndefined();

        // 打开窗里的视图：窗在最大化的面板上面，不退出最大化。
        store.actions.toggleMaximized("g0");
        expect(store.actions.revealView("v").ok).toBe(true);
        expect(store.state.maximized).toBe("g0");
        store.actions.toggleMaximized("g0");

        expect(await run(DOCK_COMMAND, {})).toEqual({ok: true, value: null});
        expect(store.actions.document().floats).toEqual([]);
        // 回到它自己的容器，入口还在原来的位置。
        expect(regionContainers(store.actions.document(), "panel").map((container) => [container.id, container.views])).toEqual([["view:fixed", ["fixed"]], ["view:v", ["v"]]]);
        expect(store.actions.document().panels.panel?.activeContainer).toBe("view:v");
    });

    it("没有当前面板、panelId 指向不存在的面板、外壳没挂载时都是 unavailable，布局不变", async () => {
        const store = await layout();
        const commands = panelCommands(() => store);
        const before = JSON.stringify(store.state.doc);
        const noCurrent = await commands[SET_PANEL_COLLAPSED_COMMAND].run({});
        expect(noCurrent).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(noCurrent, "zh-CN")).toBe("没有可以操作的面板");
        expect(failureText(noCurrent, "en-US")).toBe("No panel to act on");
        expect(await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({panelId: "nope"})).toMatchObject({ok: false, code: "unavailable"});
        expect(JSON.stringify(store.state.doc)).toBe(before);
        expect(store.state.maximized).toBeNull();

        const detached = panelCommands(() => null);
        const notOpen = await detached[SET_PANEL_COLLAPSED_COMMAND].run({collapsed: true});
        expect(notOpen).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(notOpen, "zh-CN")).toBe("工作台布局没有打开（这个窗口没有显示外壳）");
        expect(failureText(notOpen, "en-US")).toBe("The workbench layout is not open (this window does not show the shell)");
    });
});

describe("经命令注册表", () => {
    /** 真实的命令注册表：上下文键读工作台公开状态的绑定（产品里由 `nbook.state` 转交，读法相同）。 */
    function registryFor(current: ShallowRef<LayoutDocStore | null>) {
        const bindings = workbenchStateBindings(current) as unknown as Readonly<Record<string, {readonly value: unknown}>>;
        const declarations = workbenchState.declarations as unknown as Readonly<Record<string, {readonly reason?: Parameters<ReturnType<typeof workbenchTestText>["t"]>[0]}>>;
        const text = workbenchTestText("zh-CN");
        const nameOf = (key: string): string | null => (key.startsWith("nbook.workbench/") ? key.slice("nbook.workbench/".length) : null);
        const contextKeys: ContextKeySource = {
            problem: (key) => (nameOf(key) !== null && nameOf(key)! in declarations ? null : `${key} 不是工作台的公开键`),
            evaluate: (key) => (bindings[nameOf(key)!]?.value === true ? {matches: true} : {matches: false, reason: (declarations[nameOf(key)!]?.reason === undefined ? key : text.t(declarations[nameOf(key)!]!.reason!))}),
        };
        const registry = createCommandRegistry({contextKeys, report: (error) => {
            throw error;
        }});
        const implementations = panelCommands(() => current.value);
        for (const [id, declaration] of Object.entries(PANEL_COMMAND_DECLARATIONS)) {
            const registered = registry.register({id, source: "nbook.workbench", declaration: completedCommand(id, declaration), run: implementations[id as keyof typeof implementations].run});
            expect(registered.ok, id).toBe(true);
        }
        return registry;
    }

    it("可用性随布局就绪变化：没有布局时不可用并给出原因，就绪后可用", async () => {
        const current = shallowRef<LayoutDocStore | null>(null);
        const registry = registryFor(current);
        for (const id of Object.keys(PANEL_COMMAND_DECLARATIONS)) expect(registry.isEnabled(id)).toEqual({ok: false, code: "unavailable", reason: "布局还在读取"});
        current.value = await layout();
        for (const id of Object.keys(PANEL_COMMAND_DECLARATIONS)) expect(registry.isEnabled(id)).toEqual({ok: true, value: true});
    });

    it("参数严格：多余字段与非法取值为 invalid-args 且不改布局；位置、对齐、隐藏面板的旧命令不再注册", async () => {
        const store = await layout();
        const lower = sectionOf(store, "test.panel");
        store.actions.focusPanel(lower);
        const registry = registryFor(shallowRef<LayoutDocStore | null>(store));
        const before = JSON.stringify(store.state.doc);
        expect(await registry.execute(SET_PANEL_COLLAPSED_COMMAND, {collapsed: "yes"}, {source: "user"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await registry.execute(TOGGLE_PANEL_MAXIMIZED_COMMAND, {force: true}, {source: "user"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await registry.execute(TOGGLE_PANEL_MAXIMIZED_COMMAND, {panelId: ""}, {source: "user"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(JSON.stringify(store.state.doc)).toBe(before);
        expect(store.state.maximized).toBeNull();
        for (const id of ["nbook.view.set-panel-position", "nbook.view.set-panel-alignment", "nbook.view.set-panel-hidden"]) expect(registry.isEnabled(id).ok, id).toBe(false);

        expect(await registry.execute(TOGGLE_PANEL_MAXIMIZED_COMMAND, {}, {source: "user"})).toEqual({ok: true, value: null});
        expect(store.state.maximized).toBe(lower);
    });
});
