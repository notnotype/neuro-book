/**
 * 条目注册表（docs/specs/ui/workbench-shell.md 外壳四输出 33，验收 38）：真实内核的浏览器实例，拥有者插件用产品的贡献点
 * 校验与 `ItemRegistry`。公开状态用一份响应式的读表代替 `nbook.state`：注册表只用它的 `read`，同步、在 computed 里
 * 读会随值变化重算，与产品服务的合同一致。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {computed, shallowReactive} from "@vue/reactivity";

import type {Application} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {Text} from "@notnotype/nb-ui/text";

import {createApplication} from "nbook/application";
import type {PublicStateRead} from "nbook/plugins/state/shared/contracts";
import {resolverFor} from "nbook/shared/localized-text";
import {pluginText} from "nbook/shared/plugin-text";
import {createTextEngine} from "nbook/web/host/text-engine";

import {statusbarItemsPoint, titlebarItemsPoint, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_TITLEBAR_ITEMS_POINT} from "../../shared/items";
import type {ItemDeclaration} from "../../shared/items";
import type {ItemImplementation} from "../contracts";
import {ItemRegistry} from "./registry";
import {workbenchTestText} from "../../testing/text";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

function declaration(name: string, extra: Partial<ItemDeclaration> = {}): ItemDeclaration {
    return {title: {"zh-CN": `标题${name}`, "en-US": `Title ${name}`}, alignment: "right", order: 0, priority: 0, ...extra};
}

interface Owner {
    status: ItemRegistry | null;
    title: ItemRegistry | null;
    reports: string[];
}

const state = shallowReactive(new Map<string, boolean>());
const reader = {read: (key: string): PublicStateRead => (state.has(key) ? {status: "ready", value: state.get(key)!} : {status: "undeclared"})};

function ownerPlugin(owner: Owner): PluginDefinition {
    return {
        id: "test.owner",
        contributionPoints: [
            statusbarItemsPoint,
            titlebarItemsPoint,
        ],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_TITLEBAR_ITEMS_POINT],
            activate: (context) => {
                const report = (message: string) => owner.reports.push(message);
                owner.status = new ItemRegistry(context.declarations.list<ItemDeclaration>(WORKBENCH_STATUSBAR_ITEMS_POINT), reader, report, context.signal);
                owner.title = new ItemRegistry(context.declarations.list<ItemDeclaration>(WORKBENCH_TITLEBAR_ITEMS_POINT), reader, report, context.signal);
                return {receivers: {[WORKBENCH_STATUSBAR_ITEMS_POINT]: owner.status.receiver(), [WORKBENCH_TITLEBAR_ITEMS_POINT]: owner.title.receiver()}};
            },
        }],
    };
}

interface Control {
    context: ActivationContext | null;
    text: () => Text;
}

function contributor(id: string, items: Readonly<Record<string, Partial<ItemDeclaration>>>, control: Control, point: string = WORKBENCH_STATUSBAR_ITEMS_POINT, extra: Partial<ItemImplementation> = {}): PluginDefinition {
    return {
        id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: Object.entries(items).map(([item, declared]) => ({capability: point, id: item, declaration: declared})),
            activate: (context) => {
                control.context = context;
                const implementation: ItemImplementation = {text: () => control.text(), tooltip: () => "提示", state: () => "warning", ...extra};
                return {contributions: {[point]: Object.fromEntries(Object.keys(items).map((item) => [item, implementation]))}};
            },
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; owner: Owner}> {
    const owner: Owner = {status: null, title: null, reports: []};
    const application = createApplication(
        {identity: {location: "browser", instanceId: "items-registry"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [ownerPlugin(owner), ...plugins], requiredPlugins: ["test.owner"], gates: [], observers: {}},
    );
    started.push(application);
    await application.startup;
    return {application, owner};
}

const control = (text: () => Text = () => "文字"): Control => ({context: null, text});

describe("条目注册表", () => {
    it("交付后出现：左侧在前，同侧按 order 再按 id；文字、提示与状态取实现；标题按语言", async () => {
        const {owner} = await start([contributor("test.items", {
            "test.items.b": declaration("B", {order: 2}),
            "test.items.a": declaration("A", {order: 2}),
            "test.items.left": declaration("L", {alignment: "left", order: 9, command: {id: "nbook.editor.save-all"}}),
        }, control())]);
        const shown = owner.status!.shown(workbenchTestText("zh-CN"));
        expect(shown.map((item) => item.id)).toEqual(["test.items.left", "test.items.a", "test.items.b"]);
        expect(shown[0]).toMatchObject({title: "标题L", text: "文字", tooltip: "提示", state: "warning", command: {id: "nbook.editor.save-all", args: {}}});
        expect(owner.status!.shown(workbenchTestText("en-US"))[1]!.title).toBe("Title A");
    });

    it("图标与悬停内容带给外壳；同一个悬停内容只加载一次，失败只记一次诊断（外壳四输出 42、43）", async () => {
        let loads = 0;
        const hover = {load: async () => {
            loads += 1;
            throw new Error("no component");
        }};
        const {owner} = await start([contributor("test.items", {"test.items.a": declaration("A"), "test.items.b": declaration("B", {order: 1})}, control(), WORKBENCH_STATUSBAR_ITEMS_POINT, {icon: () => ({name: "i-lucide-bell", spin: true}), hover})]);
        const [first] = owner.status!.shown(workbenchTestText("zh-CN"));
        expect(first).toMatchObject({icon: {name: "i-lucide-bell", spin: true, muted: false}});
        const [again] = owner.status!.shown(workbenchTestText("zh-CN"));
        expect(again!.hover).toBe(first!.hover);
        await expect(first!.hover!.load()).rejects.toThrow("no component");
        await expect(again!.hover!.load()).rejects.toThrow("no component");
        first!.hover!.failed(new Error("render failed"));
        expect(loads).toBe(1);
        expect(owner.reports.filter((report) => report.includes("hover content"))).toHaveLength(1);
    });

    it("实现返回固定的文字引用、声明省略标题：都按窗口当前语言翻译，切换语言后在 computed 里重算", async () => {
        const engine = createTextEngine({locale: "zh-CN", strict: true, report: () => undefined});
        engine.register("test.items", {"zh-CN": {count: "次数", statusItems: {count: {title: "计数"}}}, "en-US": {count: "Count", statusItems: {count: {title: "Counter"}}}}, "zh-CN");
        // 同一个引用对象每次渲染都交回去：文字变化只能来自语言切换。
        const fixed = pluginText("test.items")("count");
        const {owner} = await start([contributor("test.items", {"test.items.count": {alignment: "right", order: 0, priority: 0}}, control(() => fixed))]);
        const text = resolverFor(() => engine.port.locale.value, engine.port);
        const shown = computed(() => owner.status!.shown(text).map((item) => `${item.title}/${item.text}`));
        expect(shown.value).toEqual(["计数/次数"]);
        engine.setLocale("en-US");
        expect(shown.value).toEqual(["Counter/Count"]);
    });

    it("when 的键都已就绪且为真才显示；值变化后在 computed 里重算", async () => {
        state.clear();
        const {owner} = await start([contributor("test.items", {"test.items.dirty": declaration("D", {when: {requires: ["test.items/dirty"]}})}, control())]);
        const ids = computed(() => owner.status!.shown(workbenchTestText("zh-CN")).map((item) => item.id));
        expect(ids.value).toEqual([]);
        state.set("test.items/dirty", true);
        expect(ids.value).toEqual(["test.items.dirty"]);
        state.set("test.items/dirty", false);
        expect(ids.value).toEqual([]);
    });

    it("同 id 的两条贡献一起被拒；标题栏只接受右侧；id 要在自己的命名空间里", async () => {
        const {application, owner} = await start([
            contributor("test.one", {"test.one.same": declaration("1")}, control()),
            contributor("test.two", {"test.one.same": declaration("2"), "other.item": declaration("3")}, control()),
            contributor("test.three", {"test.three.left": declaration("4", {alignment: "left"})}, control(), WORKBENCH_TITLEBAR_ITEMS_POINT),
        ]);
        expect(owner.status!.shown(workbenchTestText("zh-CN"))).toEqual([]);
        expect(owner.title!.shown(workbenchTestText("zh-CN"))).toEqual([]);
        expect(application.plugins.contribution(WORKBENCH_STATUSBAR_ITEMS_POINT, "test.one.same").map((entry) => entry.validation.status)).toEqual(["rejected", "rejected"]);
        expect(application.plugins.contribution(WORKBENCH_STATUSBAR_ITEMS_POINT, "other.item")[0]?.validation).toMatchObject({status: "rejected", detail: "贡献 id 要以插件 id test.two 加“.”开头：other.item"});
        expect(application.plugins.contribution(WORKBENCH_TITLEBAR_ITEMS_POINT, "test.three.left")[0]?.validation).toMatchObject({status: "rejected", detail: "标题栏的条目只放在右侧：test.three.left"});
    });

    it("贡献方入口开始停止，条目立即不再显示、也不再调用它的实现", async () => {
        let calls = 0;
        const toggle = control(() => {
            calls += 1;
            return "文字";
        });
        const {owner} = await start([contributor("test.items", {"test.items.a": declaration("A")}, toggle)]);
        expect(owner.status!.shown(workbenchTestText("zh-CN")).map((item) => item.id)).toEqual(["test.items.a"]);
        const before = calls;
        const closing = toggle.context!.scope.parent!.close();
        expect(owner.status!.shown(workbenchTestText("zh-CN"))).toEqual([]);
        expect(calls).toBe(before);
        expect((await closing).status).toBe("closed");
        await waitUntil("条目撤回", () => owner.status!.shown(workbenchTestText("zh-CN")).length === 0);
    });

    it("实现抛错的条目原位显示为出错且不可点，别的照常；同一个句柄只记一次诊断", async () => {
        const {owner} = await start([
            contributor("test.bad", {"test.bad.item": declaration("坏", {command: {id: "nbook.editor.save"}})}, control(() => {
                throw new Error("算不出来");
            })),
            contributor("test.good", {"test.good.item": declaration("好", {order: 1})}, control()),
        ]);
        const first = owner.status!.shown(workbenchTestText("zh-CN"));
        owner.status!.shown(workbenchTestText("zh-CN"));
        expect(first.map((item) => [item.id, item.text, item.state, item.command])).toEqual([["test.bad.item", "标题坏", "error", null], ["test.good.item", "文字", "warning", null]]);
        expect(first[0]!.tooltip).toBe("这个条目出错了：算不出来");
        expect(owner.reports).toEqual(["条目 test.bad.item 的实现出错：算不出来"]);
    });
});
