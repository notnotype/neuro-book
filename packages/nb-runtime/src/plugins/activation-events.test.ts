import {describe, expect, it} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly} from "../services/services";

import {createPluginHost} from "./plugins";
import type {PluginDefinition, PluginDiagnostic, PluginHost} from "./plugins";

interface Fixture {
    readonly root: Scope;
    readonly host: PluginHost;
    readonly diagnostics: PluginDiagnostic[];
    /** 被激活的入口，按激活顺序。 */
    readonly activated: string[];
}

function setup(): Fixture {
    const runtime = createRuntimeInstance({location: "server", instanceId: "server-1"});
    runtime.root.open();
    const diagnostics: PluginDiagnostic[] = [];
    const host = createPluginHost(runtime, createServiceAssembly(runtime, {}), {observer: {diagnosticRecorded: (diagnostic) => diagnostics.push(diagnostic)}});
    return {root: runtime.root, host, diagnostics, activated: []};
}

/** 一个拥有若干前缀、本身也可被事件激活的插件。 */
function plugin(fixture: Fixture, id: string, options: {readonly prefixes?: ReadonlyArray<string>; readonly events?: ReadonlyArray<string>}): PluginDefinition {
    return {
        id,
        activationEventPrefixes: options.prefixes,
        entries: [{
            id: "main",
            location: "server",
            activationEvents: options.events,
            activate: () => {
                fixture.activated.push(id);
                return {};
            },
        }],
    };
}

describe("Spec plugins 输出 21：拥有者定义的激活事件", () => {
    it("拥有者触发前缀事件：只激活声明了这个事件的入口，并返回它们的激活结果", async () => {
        const fixture = setup();
        const {host, root} = fixture;
        host.register(plugin(fixture, "owner", {prefixes: ["onFoo"]}), {scope: root});
        host.register(plugin(fixture, "listener", {events: ["onFoo:x"]}), {scope: root});
        host.register(plugin(fixture, "other", {events: ["onFoo:y"]}), {scope: root});

        const result = await host.triggerActivationEvent("onFoo:x", {requester: "owner"});

        expect(result).toMatchObject({status: "triggered", event: "onFoo:x", results: [{status: "activated", plugin: "listener", entry: "main"}]});
        expect(fixture.activated).toEqual(["listener"]);
    });

    it("非拥有者触发被拒；入口不激活", async () => {
        const fixture = setup();
        const {host, root} = fixture;
        host.register(plugin(fixture, "owner", {prefixes: ["onFoo"]}), {scope: root});
        host.register(plugin(fixture, "listener", {events: ["onFoo:x"]}), {scope: root});

        expect(await host.triggerActivationEvent("onFoo:x", {requester: "listener"})).toEqual({status: "rejected", event: "onFoo:x", reason: "not-prefix-owner"});
        expect(fixture.activated).toEqual([]);
    });

    it("入口声明了无人拥有的前缀：记诊断、插件照常登记与激活；拥有者之后登记时事件生效", async () => {
        const fixture = setup();
        const {host, root, diagnostics} = fixture;
        expect(host.register(plugin(fixture, "listener", {events: ["onBar:y"]}), {scope: root})).toMatchObject({status: "accepted"});

        expect(diagnostics).toContainEqual(expect.objectContaining({stage: "register", reason: "unknown-activation-event", plugin: "listener", capability: "activationEvents", contribution: "onBar:y"}));
        expect(await host.activate({plugin: "listener", entry: "main"})).toMatchObject({status: "activated"});

        const late = setup();
        late.host.register(plugin(late, "listener", {events: ["onBar:y"]}), {scope: late.root});
        late.host.register(plugin(late, "owner", {prefixes: ["onBar"]}), {scope: late.root});
        expect(await late.host.triggerActivationEvent("onBar:y", {requester: "owner"})).toMatchObject({status: "triggered", results: [{status: "activated", plugin: "listener"}]});
    });

    it("两个插件声明同一前缀：两者都不生效，触发得到 prefix-conflict 并记诊断", async () => {
        const fixture = setup();
        const {host, root, diagnostics} = fixture;
        host.register(plugin(fixture, "first", {prefixes: ["onFoo"]}), {scope: root});
        host.register(plugin(fixture, "second", {prefixes: ["onFoo"]}), {scope: root});
        host.register(plugin(fixture, "listener", {events: ["onFoo:x"]}), {scope: root});

        expect(await host.triggerActivationEvent("onFoo:x", {requester: "first"})).toMatchObject({status: "rejected", reason: "prefix-conflict"});
        expect(await host.triggerActivationEvent("onFoo:x", {requester: "second"})).toMatchObject({status: "rejected", reason: "prefix-conflict"});
        expect(fixture.activated).toEqual([]);
        expect(diagnostics.some((diagnostic) => diagnostic.reason === "activation-prefix-conflict")).toBe(true);
    });

    it("内核保留 onRemote：插件声明它使整个插件不登记；任何插件都不能触发 onRemote 事件", async () => {
        const fixture = setup();
        const {host, root} = fixture;
        expect(host.register(plugin(fixture, "thief", {prefixes: ["onRemote"]}), {scope: root})).toMatchObject({
            status: "rejected",
            rejections: [{reason: "reserved-activation-prefix", detail: "onRemote"}],
        });
        host.register(plugin(fixture, "listener", {events: ["onRemote:files/files"]}), {scope: root});

        expect(await host.triggerActivationEvent("onRemote:files/files", {requester: "listener"})).toMatchObject({status: "rejected", reason: "reserved-prefix"});
        expect(fixture.activated).toEqual([]);
    });

    it("前缀与事件的格式：非法前缀使插件不登记；不是 <前缀>:<参数> 的事件触发被拒、入口声明时记诊断", async () => {
        const fixture = setup();
        const {host, root, diagnostics} = fixture;
        expect(host.register(plugin(fixture, "bad", {prefixes: ["on:Foo"]}), {scope: root})).toMatchObject({status: "rejected", rejections: [{reason: "invalid-activation-prefix"}]});
        expect(host.register(plugin(fixture, "startup", {prefixes: ["onStartup"]}), {scope: root})).toMatchObject({status: "rejected", rejections: [{reason: "reserved-activation-prefix"}]});
        host.register(plugin(fixture, "listener", {events: ["onFoo"]}), {scope: root});

        expect(await host.triggerActivationEvent("onFoo", {requester: "listener"})).toMatchObject({status: "rejected", reason: "invalid-event"});
        expect(diagnostics).toContainEqual(expect.objectContaining({reason: "invalid-activation-event", contribution: "onFoo"}));
    });
});
