import {describe, expect, it, vi} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import {createServiceAssembly, defineServiceKey} from "../services/services";
import {createPluginHost, provide} from "./plugins";
import type {ActivationResult, PluginDefinition, PluginEntryDefinition} from "./plugins";

const aKey = defineServiceKey("a/service");
const bKey = defineServiceKey("b/service");
const cKey = defineServiceKey("c/service");
const browserKey = defineServiceKey("browser/service");
const missing = defineServiceKey("missing/service");
const keys = [aKey, bKey, cKey, browserKey, missing];

function setup() {
    const runtime = createRuntimeInstance({instanceId: "entry-contract", location: "server"});
    const assembly = createServiceAssembly(runtime, {keys});
    const host = createPluginHost(runtime, assembly, {});
    return {runtime, assembly, host};
}

function definition(id: string, dependencies: PluginEntryDefinition["dependencies"] = [], provides: PluginEntryDefinition["provides"] = []): PluginDefinition {
    return {id, entries: [{id: "main", location: "server", dependencies, provides, activate: () => ({services: provides.map((key) => provide(key, id))})}]};
}

describe("入口与服务级依赖合同", () => {
    it("验收 1：两端入口只计算本位置依赖，外位置不受阻，插件汇总可用", async () => {
        const {runtime, host} = setup();
        expect(host.register({id: "providers", entries: [
            {id: "server", location: "server", provides: [], activate: () => ({})},
        ]}, {scope: runtime.root}).status).toBe("accepted");
        host.register(definition("a", [], [aKey]), {scope: runtime.root});
        host.register({id: "browser", entries: [{id: "browser", location: "browser", provides: [browserKey], activate: () => ({})}]}, {scope: runtime.root});
        host.register({id: "two", entries: [
            {id: "server", location: "server", dependencies: [{key: aKey}], activate: () => ({})},
            {id: "browser", location: "browser", dependencies: [{key: browserKey}], activate: () => ({})},
        ]}, {scope: runtime.root});
        const plugin = host.catalog().plugins.find((plugin) => plugin.id === "two")!;
        expect(plugin.summary).toBe("available");
        expect(plugin.entries.map((entry) => entry.state)).toMatchObject([
            {status: "registered", blocked: null}, {status: "foreign-location", blocked: null},
        ]);
        await runtime.root.close();
    });

    it("验收 2：已登记键无提供方时受阻，另一入口仍可激活，汇总部分可用", async () => {
        const {runtime, host} = setup();
        host.register({id: "a", entries: [definition("a", [{key: missing}]).entries[0]!, {id: "other", location: "server", activate: () => ({})}]}, {scope: runtime.root});
        expect(host.entryState({plugin: "a", entry: "main"})).toMatchObject({status: "blocked", blocked: {reason: "missing-service", key: missing.name, path: ["a/main"]}});
        expect(await host.activate({plugin: "a", entry: "other"})).toMatchObject({status: "activated"});
        expect(host.catalog().plugins[0]!.summary).toBe("partial");
        await runtime.root.close();
    });

    it("验收 3：本位置全部受阻或失败时汇总受阻，本位置无入口时汇总可用", async () => {
        const {runtime, host} = setup();
        host.register({id: "a", entries: [definition("a", [{key: missing}]).entries[0]!, {id: "fails", location: "server", activate: () => {throw new Error("failed");}}]}, {scope: runtime.root});
        host.register({id: "browser", entries: [{id: "browser", location: "browser", activate: () => ({})}]}, {scope: runtime.root});
        await host.activate({plugin: "a", entry: "fails"});
        expect(host.catalog().plugins.map((plugin) => [plugin.id, plugin.summary])).toEqual([["a", "blocked"], ["browser", "available"]]);
        await runtime.root.close();
    });

    it("验收 4：服务端依赖只在浏览器提供的服务时位置不匹配", async () => {
        const {runtime, host} = setup();
        host.register(definition("a", [{key: browserKey}]), {scope: runtime.root});
        host.register({id: "browser", entries: [{id: "browser", location: "browser", provides: [browserKey], activate: () => ({})}]}, {scope: runtime.root});
        expect(host.entryState({plugin: "a", entry: "main"})!.blocked).toEqual({reason: "location-mismatch", key: browserKey.name, path: ["a/main"]});
        await runtime.root.close();
    });

    it("验收 5：A 到 B 到 C 的传递受阻路径包含全部入口", async () => {
        const {runtime, host} = setup();
        for (const plugin of [definition("a", [{key: bKey}], [aKey]), definition("b", [{key: cKey}], [bKey]), definition("c", [{key: missing}], [cKey])]) {
            host.register(plugin, {scope: runtime.root});
        }
        expect(host.entryState({plugin: "a", entry: "main"})!.blocked).toEqual({reason: "provider-blocked", key: bKey.name, path: ["a/main", "b/main", "c/main"]});
        expect(host.entryState({plugin: "b", entry: "main"})!.blocked).toEqual({reason: "provider-blocked", key: cKey.name, path: ["b/main", "c/main"]});
        await runtime.root.close();
    });

    it("验收 6：提供方失败使依赖方受阻，显式恢复后依赖方可激活", async () => {
        const {runtime, host} = setup();
        let failed = true;
        host.register({id: "b", entries: [{id: "main", location: "server", provides: [bKey], activate: () => {if (failed) {throw new Error("provider failed");} return {services: [provide(bKey, "B")]};}}]}, {scope: runtime.root});
        host.register(definition("a", [{key: bKey}]), {scope: runtime.root});
        await host.activate({plugin: "b", entry: "main"});
        expect(host.entryState({plugin: "a", entry: "main"})!.blocked).toEqual({reason: "provider-failed", key: bKey.name, path: ["a/main", "b/main"]});
        failed = false;
        expect(await host.recover({plugin: "b", entry: "main"})).toMatchObject({status: "reset"});
        expect(host.entryState({plugin: "a", entry: "main"})).toMatchObject({status: "registered", blocked: null});
        expect(await host.activate({plugin: "a", entry: "main"})).toMatchObject({status: "activated", generation: 1});
        await runtime.root.close();
    });

    it("验收 7：环成员报告完整环，环外消费者受阻，无关入口正常", async () => {
        const {runtime, host} = setup();
        for (const plugin of [definition("a", [{key: bKey}], [aKey]), definition("b", [{key: aKey}], [bKey]), definition("c", [{key: aKey}], [cKey]), definition("other")]) {
            host.register(plugin, {scope: runtime.root});
        }
        expect(host.entryState({plugin: "a", entry: "main"})!.blocked).toEqual({reason: "dependency-cycle", key: bKey.name, path: ["a/main", "b/main", "a/main"]});
        expect(host.entryState({plugin: "b", entry: "main"})!.blocked).toEqual({reason: "dependency-cycle", key: aKey.name, path: ["b/main", "a/main", "b/main"]});
        expect(host.entryState({plugin: "c", entry: "main"})!.blocked).toEqual({reason: "provider-blocked", key: aKey.name, path: ["c/main", "a/main", "b/main", "a/main"]});
        expect(await host.activate({plugin: "other", entry: "main"})).toMatchObject({status: "activated"});
        await runtime.root.close();
    });

    it("验收 8：三种登记顺序给出相同目录，后登记提供方解除先登记消费者的受阻", async () => {
        const plugins = [definition("a", [{key: bKey}], [aKey]), definition("b", [{key: cKey}], [bKey]), definition("c", [], [cKey])];
        const catalogs = [];
        for (const order of [plugins, [...plugins].reverse(), [plugins[1]!, plugins[0]!, plugins[2]!]]) {
            const {runtime, host} = setup();
            for (const plugin of order) {
                host.register(plugin, {scope: runtime.root});
            }
            const before = host.diagnostics();
            catalogs.push(host.catalog());
            expect(host.catalog()).toEqual(catalogs.at(-1)!);
            expect(host.diagnostics()).toEqual(before);
            await runtime.root.close();
        }
        expect(catalogs[0]).toEqual(catalogs[1]);
        expect(catalogs[1]).toEqual(catalogs[2]);
        const {runtime, host} = setup();
        host.register(plugins[0]!, {scope: runtime.root});
        expect(host.entryState({plugin: "a", entry: "main"})!.status).toBe("blocked");
        host.register(plugins[1]!, {scope: runtime.root});
        host.register(plugins[2]!, {scope: runtime.root});
        expect(host.entryState({plugin: "a", entry: "main"})).toMatchObject({status: "registered", blocked: null});
        await runtime.root.close();
    });

    it("验收 9：外来、空名称及保留服务名拒绝整个插件，本地能力无需插件前缀", async () => {
        const {runtime, assembly, host} = setup();
        const empty = defineServiceKey("a/");
        const channel = defineServiceKey("a/channel");
        const reservedAssembly = createServiceAssembly(runtime, {keys: [empty, channel, bKey]});
        const reservedHost = createPluginHost(runtime, reservedAssembly, {});
        for (const [key, reason] of [[bKey, "foreign-service-id"], [empty, "foreign-service-id"], [channel, "reserved-service-name"]] as const) {
            expect(reservedHost.register({id: "a", entries: [definition("a").entries[0]!, {id: "browser", location: "browser", provides: [key], activate: () => ({})}]}, {scope: runtime.root})).toMatchObject({status: "rejected", rejections: [{reason, detail: key.name}]});
            expect(reservedHost.catalog().plugins).toEqual([]);
            expect(reservedAssembly.report().entries).toEqual([]);
        }
        expect(assembly.declare({id: "local", key: missing, location: "server", scope: runtime.root, create: () => "local"}).status).toBe("accepted");
        host.register(definition("a", [{key: missing}]), {scope: runtime.root});
        expect(await host.activate({plugin: "a", entry: "main"})).toMatchObject({status: "activated"});
        await runtime.root.close();
    });

    it("验收 10：受阻激活不调用入口、不消耗代次，服务解析也不触发受阻提供方", async () => {
        const {runtime, assembly, host} = setup();
        const activate = vi.fn(() => ({services: [provide(aKey, "A")]}));
        host.register({id: "a", entries: [{...definition("a", [{key: missing}], [aKey]).entries[0]!, activate}]}, {scope: runtime.root});
        const state = host.entryState({plugin: "a", entry: "main"});
        const result: ActivationResult = {status: "rejected", plugin: "a", entry: "main", reason: "blocked", blocked: {reason: "missing-service", key: missing.name, path: ["a/main"]}};
        expect(await host.activate({plugin: "a", entry: "main"})).toEqual(result);
        expect(await host.activate({plugin: "a", entry: "main"})).toEqual(result);
        assembly.declare({id: "consumer", location: "server", scope: runtime.root, dependencies: [{key: aKey}]});
        expect(await assembly.access("consumer").resolve(aKey)).toMatchObject({status: "unavailable"});
        expect(host.entryState({plugin: "a", entry: "main"})).toEqual(state);
        expect(activate).not.toHaveBeenCalled();
        expect(host.diagnostics().filter((diagnostic) => diagnostic.reason === "blocked")).toHaveLength(2);
        assembly.declare({id: "local", key: missing, location: "server", scope: runtime.root, create: () => "local"});
        expect(await host.activate({plugin: "a", entry: "main"})).toMatchObject({status: "activated", generation: 1});
        expect(host.entryState({plugin: "a", entry: "main"})!.scopeId).toBeDefined();
        await runtime.root.close();
    });

    it("本地提供方初始化失败时入口未调用 activate，失败尝试收口仍各记录一次关闭诊断", async () => {
        const {runtime, assembly, host} = setup();
        const activate = vi.fn(() => ({}));
        assembly.declare({id: "local", key: missing, location: "server", scope: runtime.root, create: () => {throw new Error("local failed");}});
        host.register({id: "a", entries: [{...definition("a", [{key: missing}]).entries[0]!, activate}]}, {scope: runtime.root});
        expect(await host.activate({plugin: "a", entry: "main"})).toMatchObject({status: "failed", stage: "dependencies", reason: "dependency-unavailable", generation: 1});
        expect(activate).not.toHaveBeenCalled();
        expect((await runtime.root.close()).status).toBe("closed");
        expect(host.diagnostics().filter((diagnostic) => diagnostic.stage === "close").map((diagnostic) => diagnostic.reason)).toEqual(["close-started", "closed"]);
    });
});
