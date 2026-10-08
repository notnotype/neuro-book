/**
 * 视图注册表（docs/specs/workbench/views.md 输出 1–6、8，验收 2、3、5、6）：真实内核的浏览器实例，拥有者插件用产品的
 * 贡献点校验与 `ViewRegistry`，宿主能力用产品的 `createWindowPlugins` 接在插件观察者上。贡献方插件按开关失败、
 * 自己关闭激活作用域、加载时等测试放行，这些都是插件自己的真实代码路径。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {computed} from "@vue/reactivity";
import {defineComponent} from "vue";
import type {Component} from "vue";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createWindowPlugins} from "nbook/web/host/window-plugins";

import {validateViewContribution, WORKBENCH_VIEWS_POINT} from "../../shared/views";
import type {ViewDeclaration} from "../../shared/views";
import type {ViewImplementation} from "../contracts";
import {ViewRegistry} from "./registry";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

function declaration(name: string): ViewDeclaration {
    return {title: {"zh-CN": name, "en-US": name}, icon: "i-lucide-square", location: "sidebar", layout: "scroll"};
}

interface Owner {
    registry: ViewRegistry | null;
}

/** 拥有者：定义贡献点、在激活时建注册表；与产品的工作台入口同一接法。 */
function ownerPlugin(owner: Owner, plugins: () => ReturnType<typeof createWindowPlugins>["capability"]): PluginDefinition {
    return {
        id: "test.owner",
        contributionPoints: [{id: WORKBENCH_VIEWS_POINT, implementation: "required", validate: validateViewContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [WORKBENCH_VIEWS_POINT],
            activate: (context) => {
                owner.registry = new ViewRegistry(context.declarations.list<ViewDeclaration>(WORKBENCH_VIEWS_POINT), plugins(), context.signal);
                return {receivers: {[WORKBENCH_VIEWS_POINT]: owner.registry.receiver()}};
            },
        }],
    };
}

interface ContributorControl {
    fail: boolean;
    context: ActivationContext | null;
    load: () => Promise<Component>;
}

const Sample = defineComponent({name: "SampleView", render: () => null});

function contributor(id: string, views: ReadonlyArray<string>, control: ContributorControl, extra: Partial<PluginDefinition["entries"][number]> = {}): PluginDefinition {
    return {
        id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: views.map((view) => ({capability: WORKBENCH_VIEWS_POINT, id: view, declaration: declaration(view)})),
            activate: (context) => {
                if (control.fail) throw new Error("样例入口按开关激活失败");
                control.context = context;
                const implementation: ViewImplementation = {load: () => control.load()};
                return {contributions: {[WORKBENCH_VIEWS_POINT]: Object.fromEntries(views.map((view) => [view, implementation]))}};
            },
            ...extra,
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; registry: ViewRegistry}> {
    const owner: Owner = {registry: null};
    let application: Application | null = null;
    const feed = createWindowPlugins(() => application?.plugins ?? null, (error) => {
        throw error;
    });
    application = createApplication(
        {identity: {location: "browser", instanceId: "views-registry"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [ownerPlugin(owner, () => feed.capability), ...plugins], requiredPlugins: ["test.owner"], gates: [], observers: {plugins: feed}},
    );
    started.push(application);
    await application.startup;
    if (owner.registry === null) throw new Error("拥有者没有激活");
    return {application, registry: owner.registry};
}

/**
 * 入口关闭自己这一代的激活作用域（`context.scope` 是它下面的入口工作作用域，单关它会等别处借用它的资源）。这是
 * 内核里入口正常停止的真实路径：声明仍在，交付项以 `scope-closed` 撤回。
 */
async function stopEntry(toggle: ContributorControl): Promise<void> {
    expect((await toggle.context?.scope.parent?.close())?.status).toBe("closed");
}

function control(overrides: Partial<ContributorControl> = {}): ContributorControl {
    return {fail: false, context: null, load: async () => Sample, ...overrides};
}

describe("视图注册表", () => {
    it("目录来自已接受的声明：没交付的视图也在目录里；不合规则的声明不进目录", async () => {
        const lazy = contributor("test.lazy", ["test.lazy.one"], control(), {activationEvents: []});
        const wrong = contributor("test.wrong", ["other.view"], control());
        const {application, registry} = await start([lazy, wrong]);
        expect([...registry.catalog.keys()]).toEqual(["test.lazy.one"]);
        expect(registry.delivery("test.lazy.one")).toEqual({kind: "declared"});
        expect(application.plugins.contribution(WORKBENCH_VIEWS_POINT, "other.view")[0]?.validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "插件 test.wrong 的视图 id 必须以 test.wrong. 开头：other.view"});
        expect(await registry.load("test.lazy.one")).toEqual({status: "stale"});
    });

    it("交付后可用，每次加载经句柄取实现", async () => {
        let loads = 0;
        const {registry} = await start([contributor("test.views", ["test.views.a"], control({load: async () => {
            loads += 1;
            return Sample;
        }}))]);
        expect(registry.delivery("test.views.a")).toEqual({kind: "available"});
        expect(await registry.load("test.views.a")).toEqual({status: "loaded", component: Sample});
        expect(await registry.load("test.views.a")).toEqual({status: "loaded", component: Sample});
        expect(loads).toBe(2);
    });

    it("加载失败报 failed，与撤回造成的作废分开", async () => {
        const {registry} = await start([contributor("test.views", ["test.views.a"], control({load: async () => {
            throw new Error("组件模块加载失败");
        }}))]);
        const result = await registry.load("test.views.a");
        expect(result.status).toBe("failed");
        expect(result.status === "failed" && (result.error as Error).message).toBe("组件模块加载失败");
    });

    it("入口激活失败：原位给出原因；消除原因后重试，以新代次交付", async () => {
        const toggle = control({fail: true});
        const {application, registry} = await start([contributor("test.views", ["test.views.a"], toggle, {activationEvents: []})]);
        const delivery = computed(() => registry.delivery("test.views.a"));
        expect(delivery.value).toEqual({kind: "declared"});
        // 入口状态的变化经宿主能力的通知到达：已经求过值的 computed 随之重算。
        expect((await application.plugins.activate({plugin: "test.views", entry: "browser"})).status).toBe("failed");
        expect(delivery.value).toEqual({kind: "entry-failed", reason: "样例入口按开关激活失败"});

        toggle.fail = false;
        expect(await registry.retry("test.views.a")).toEqual({status: "activated"});
        expect(delivery.value).toEqual({kind: "available"});
        expect(application.plugins.entryState({plugin: "test.views", entry: "browser"})?.generation).toBe(2);
        expect(await registry.retry("test.views.a")).toEqual({status: "not-failed"});
        expect(await registry.retry("nope.view")).toEqual({status: "failed", reason: "未登记的视图 nope.view"});
    });

    it("入口受阻：原位给出原因，没有重试", async () => {
        const missing = defineServiceKey<unknown>("test/missing");
        const {registry} = await start([contributor("test.views", ["test.views.a"], control(), {dependencies: [{key: missing}]})]);
        const delivery = registry.delivery("test.views.a");
        expect(delivery.kind).toBe("entry-blocked");
        expect(await registry.retry("test.views.a")).toEqual({status: "not-failed"});
    });

    it("入口停止（scope-closed）：撤回后为 entry-stopped，之后的加载作废", async () => {
        const toggle = control();
        const {registry} = await start([contributor("test.views", ["test.views.a"], toggle)]);
        const delivery = computed(() => registry.delivery("test.views.a"));
        expect(delivery.value.kind).toBe("available");
        await stopEntry(toggle);
        expect(delivery.value).toEqual({kind: "entry-stopped", reason: "scope-closed"});
        expect(await registry.load("test.views.a")).toEqual({status: "stale"});
    });

    it("加载进行中入口停止：结果回来时句柄已撤回，结果作废而不是加载失败", async () => {
        let release: (component: Component) => void = () => undefined;
        let started = false;
        const toggle = control({load: () => new Promise<Component>((resolve) => {
            started = true;
            release = resolve;
        })});
        const {registry} = await start([contributor("test.views", ["test.views.a"], toggle)]);
        const pending = registry.load("test.views.a");
        await waitUntil("加载已经发起", () => started);
        await stopEntry(toggle);
        release(Sample);
        expect(await pending).toEqual({status: "stale"});
    });

    it("拥有者自己停止（receiver-closed）：之后的加载作废", async () => {
        const toggle = control();
        const {application, registry} = await start([contributor("test.views", ["test.views.a"], toggle)]);
        const generation = application.plugins.entryState({plugin: "test.views", entry: "browser"})?.generation;
        await application.stop();
        expect(registry.delivery("test.views.a")).toEqual({kind: "entry-stopped", reason: "receiver-closed"});
        expect(await registry.load("test.views.a")).toEqual({status: "stale"});
        expect(generation).toBe(1);
    });
});
