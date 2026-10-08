/**
 * `nbook.state` 经真实内核装配（docs/specs/state/public-state.md）：公开键的登记期校验、描述先于实现、激活时绑定与
 * 停止时撤回、未绑定、读取函数出错、别处声明，以及 `@vue/reactivity` 的 computed 随绑定与值变化。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {computed, ref} from "@vue/reactivity";
import type {Ref} from "@vue/reactivity";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, ContributionDeclaration, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";

import {PUBLIC_STATE_POINT, publicStateKey} from "./shared/contracts";
import type {PublicStateBinding, PublicStateDeclaration, PublicStateService} from "./shared/contracts";
import {statePlugin} from "./shared/plugin";

const apps: Application[] = [];

afterEach(async () => {
    for (const app of apps.splice(0).reverse()) expect(await app.stop()).toMatchObject({status: "closed"});
});

const READY_REASON = {"zh-CN": "还没准备好", "en-US": "Not ready yet"};

function declare(plugin: string, name: string, declaration: unknown): ContributionDeclaration {
    return {capability: PUBLIC_STATE_POINT, id: `${plugin}/${name}`, declaration};
}

interface Instance {
    readonly app: Application;
    readonly store: DiagnosticsStore;
    readonly service: PublicStateService;
}

/** 一个运行实例：诊断、`nbook.state` 与给定插件，再加一个依赖读取服务、把它交给测试的探针。 */
async function instance(location: string, plugins: ReadonlyArray<PluginDefinition>): Promise<Instance> {
    const silent = {error: () => undefined};
    const store = createDiagnosticsStore({identity: {location, instanceId: `${location}-1`}});
    let service: PublicStateService | null = null;
    const probe: PluginDefinition = {id: "test.reader", entries: [{id: "main", location, activationEvents: ["onStartup"], dependencies: [{key: publicStateKey}], activate: (context) => {
        service = context.services.require(publicStateKey);
        return {};
    }}]};
    const app = createApplication(
        {identity: {location, instanceId: `${location}-1`}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [createDiagnosticsPlugin({location, store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}), statePlugin, ...plugins, probe], gates: []},
    );
    apps.push(app);
    expect(await app.startup).toMatchObject({status: "available"});
    if (service === null) throw new Error("探针没有拿到读取服务");
    return {app, store, service};
}

/** 声明并绑定公开键的测试插件：`bindings` 在激活时交出，`onActivate` 拿到这一代的激活上下文。 */
function owner(
    id: string,
    location: string,
    declarations: ReadonlyArray<ContributionDeclaration>,
    bindings: () => Readonly<Record<string, PublicStateBinding>>,
    options: {readonly lazy?: boolean; readonly onActivate?: (context: ActivationContext) => void} = {},
): PluginDefinition {
    const entry: PluginEntryDefinition = {
        id: location,
        location,
        activationEvents: options.lazy === true ? [] : ["onStartup"],
        contributions: declarations,
        activate: (context) => {
            options.onActivate?.(context);
            return {contributions: {[PUBLIC_STATE_POINT]: bindings()}};
        },
    };
    return {id, entries: [entry]};
}

const bound = (value: Ref<boolean | string | number>): PublicStateBinding => ({kind: "bound", read: () => value.value});

function rejection(app: Application, key: string): string | null {
    const validation = app.plugins.contribution(PUBLIC_STATE_POINT, key)[0]?.validation;
    return validation?.status === "rejected" ? (validation.detail ?? validation.reason) : null;
}

describe("Spec state.public 输出 1–2：登记期校验与同名", () => {
    it("前缀、名、类型、unready、reason 与未知字段各自只拒绝这一条，原因可查；合格的照常", async () => {
        const declarations = [
            declare("app.flags", "ok", {type: "boolean", unready: false, reason: READY_REASON}),
            {capability: PUBLIC_STATE_POINT, id: "other.plugin/stolen", declaration: {type: "boolean", unready: false}},
            declare("app.flags", "Bad-Name", {type: "boolean", unready: false}),
            declare("app.flags", "kind", {type: "object", unready: {}}),
            declare("app.flags", "mismatch", {type: "number", unready: "0"}),
            declare("app.flags", "label", {type: "string", unready: "", reason: READY_REASON}),
            declare("app.flags", "extra", {type: "boolean", unready: false, color: "red"}),
        ];
        const bindings = Object.fromEntries(declarations.map((item) => [item.id, {kind: "unbound"} as PublicStateBinding]));
        const {app} = await instance("server", [owner("app.flags", "server", declarations, () => bindings)]);

        expect(rejection(app, "app.flags/ok")).toBeNull();
        expect(rejection(app, "other.plugin/stolen")).toContain("必须写成 app.flags/<名>");
        expect(rejection(app, "app.flags/Bad-Name")).toContain("不合规则");
        expect(rejection(app, "app.flags/kind")).toContain("type 必须是");
        expect(rejection(app, "app.flags/mismatch")).toContain("unready 必须是 number");
        expect(rejection(app, "app.flags/label")).toContain("不能写 reason");
        expect(rejection(app, "app.flags/extra")).toContain("未知字段：color");
    });

    it("两个插件声明同一限定名：两条都拒绝，与登记顺序无关；同一插件两个位置的入口声明同一个键也都拒绝", async () => {
        const decl = declare("app.a", "x", {type: "boolean", unready: false});
        const first = owner("app.a", "server", [decl], () => ({"app.a/x": {kind: "unbound"}}));
        const second = owner("app.b", "server", [decl], () => ({"app.a/x": {kind: "unbound"}}));
        for (const order of [[first, second], [second, first]]) {
            const {app} = await instance("server", order);
            expect(app.plugins.contribution(PUBLIC_STATE_POINT, "app.a/x").map((state) => state.validation)).toEqual([
                {status: "rejected", reason: "duplicate-contribution", detail: null},
                {status: "rejected", reason: "duplicate-contribution", detail: null},
            ]);
        }
        const both: PluginDefinition = {id: "app.c", entries: ["server", "browser"].map((location) => ({
            id: location, location, contributions: [declare("app.c", "y", {type: "boolean", unready: false})], activate: () => ({contributions: {[PUBLIC_STATE_POINT]: {"app.c/y": {kind: "unbound"}}}}),
        }))};
        const {app} = await instance("server", [both]);
        expect(app.plugins.contribution(PUBLIC_STATE_POINT, "app.c/y").map((state) => state.validation.status)).toEqual(["rejected", "rejected"]);
    });
});

describe("Spec state.public 输出 3–6、9、验收 1：描述先于实现、绑定、未绑定、撤回与响应式失效", () => {
    it("懒激活的键：激活前读到 unready；激活后读到当前值，computed 随值变化；入口停止后回到 unready，computed 随之变化", async () => {
        const value = ref(false);
        let context: ActivationContext | null = null;
        const plugin = owner("app.lazy", "server", [declare("app.lazy", "ready", {type: "boolean", unready: false, reason: READY_REASON})], () => ({"app.lazy/ready": bound(value)}), {
            lazy: true,
            onActivate: (activated) => {
                context = activated;
            },
        });
        const {app, service} = await instance("server", [plugin]);
        const watched = computed(() => service.read("app.lazy/ready"));
        expect(watched.value).toEqual({status: "unready", value: false});
        expect(service.declaration("app.lazy/ready")).toEqual({type: "boolean", unready: false, reason: READY_REASON});

        expect(await app.plugins.activate({plugin: "app.lazy", entry: "server"})).toMatchObject({status: "activated"});
        expect(watched.value).toEqual({status: "ready", value: false});
        value.value = true;
        expect(watched.value).toEqual({status: "ready", value: true});

        const activation = (context as ActivationContext | null)?.scope.parent;
        if (activation === null || activation === undefined) throw new Error("入口没有激活作用域");
        await activation.close();
        expect(watched.value).toEqual({status: "unready", value: false});
    });

    it("激活了但交“未绑定”：读到 unready；与读取函数恰好返回 unready 同值的 ready 分得开", async () => {
        const plugin = owner("app.two", "server", [
            declare("app.two", "missing", {type: "string", unready: "?"}),
            declare("app.two", "same", {type: "string", unready: "?"}),
        ], () => ({"app.two/missing": {kind: "unbound"}, "app.two/same": {kind: "bound", read: () => "?"}}));
        const {service} = await instance("server", [plugin]);
        expect(service.read("app.two/missing")).toEqual({status: "unready", value: "?"});
        expect(service.read("app.two/same")).toEqual({status: "ready", value: "?"});
    });
});

describe("Spec state.public 输出 7–8：读取出错与未声明", () => {
    it("读取函数抛错或类型不符：按未就绪，诊断按拥有者插件各记一次", async () => {
        const plugin = owner("app.broken", "server", [
            declare("app.broken", "throws", {type: "number", unready: 0}),
            declare("app.broken", "wrong", {type: "number", unready: 0}),
        ], () => ({
            "app.broken/throws": {kind: "bound", read: () => {
                throw new Error("读不到");
            }},
            "app.broken/wrong": {kind: "bound", read: () => "不是数字" as unknown as number},
        }));
        const {service, store} = await instance("server", [plugin]);
        for (let round = 0; round < 3; round += 1) {
            expect(service.read("app.broken/throws")).toEqual({status: "unready", value: 0});
            expect(service.read("app.broken/wrong")).toEqual({status: "unready", value: 0});
        }
        const events = store.query({plugin: "app.broken"}).records.map((record) => record.event).sort();
        expect(events).toEqual(["state.public.read-mismatch", "state.public.read-threw"]);
    });

    it("没有声明的键为 undeclared；只在浏览器入口声明的键，在服务端实例里也是 undeclared", async () => {
        const plugin: PluginDefinition = {id: "app.split", entries: [
            {id: "server", location: "server", activate: () => ({})},
            {id: "browser", location: "browser", contributions: [declare("app.split", "visible", {type: "boolean", unready: false})], activate: () => ({contributions: {[PUBLIC_STATE_POINT]: {"app.split/visible": {kind: "unbound"}}}})},
        ]};
        const {service} = await instance("server", [plugin]);
        expect(service.read("app.nobody/x")).toEqual({status: "undeclared"});
        expect(service.read("app.split/visible")).toEqual({status: "undeclared"});
        expect(service.declaration("app.split/visible")).toBeNull();
    });
});

describe("Spec state.public 输出 10、验收 2：只在本实例", () => {
    it("两个浏览器实例装着同一个插件：一边改值，另一边读到的仍是自己的", async () => {
        const values: Array<Ref<boolean>> = [];
        const plugin = owner("app.window", "browser", [declare("app.window", "open", {type: "boolean", unready: false})], () => {
            const value = ref(false);
            values.push(value);
            return {"app.window/open": bound(value)};
        });
        const first = await instance("browser", [plugin]);
        const second = await instance("browser", [plugin]);
        values[0]!.value = true;
        expect(first.service.read("app.window/open")).toEqual({status: "ready", value: true});
        expect(second.service.read("app.window/open")).toEqual({status: "ready", value: false});
    });
});

/** 编译期：声明的类型与 unready 一致。 */
export const declarationShape: PublicStateDeclaration = {type: "boolean", unready: false, reason: READY_REASON};
