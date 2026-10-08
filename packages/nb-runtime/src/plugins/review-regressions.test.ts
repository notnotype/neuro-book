import {describe, expect, it, vi} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly, defineServiceKey} from "../services/services";
import {createPluginHost, provide} from "./plugins";
import type {ActivationOutput, PluginDefinition} from "./plugins";

const firstKey = defineServiceKey<string>("owner/first");
const lastKey = defineServiceKey<string>("owner/last");
const foreignKey = defineServiceKey<string>("foreign/service");

describe("第一轮审查边界回归", () => {
    it.each(["同入口", "同位置两个入口", "同名不同键"] as const)("%s 重复提供服务 id 时整个插件拒绝且无部分登记", async (scenario) => {
        const runtime = createRuntimeInstance({instanceId: "duplicates", location: "server"});
        const sameName = defineServiceKey("owner/first");
        const assembly = createServiceAssembly(runtime, {});
        const host = createPluginHost(runtime, assembly, {});
        const activate = vi.fn(() => ({}));
        const entries: PluginDefinition["entries"] = scenario === "同位置两个入口" ? [
            {id: "main", location: "server", provides: [firstKey], activate},
            {id: "worker", location: "server", provides: [firstKey], activate},
        ] : [{id: "main", location: "server", provides: [firstKey, scenario === "同名不同键" ? sameName : firstKey], activate}];
        expect(host.register({id: "owner", entries}, {scope: runtime.root})).toEqual({status: "rejected", plugin: "owner", rejections: [{reason: "duplicate-service", entry: scenario === "同位置两个入口" ? "worker" : "main", capability: null, contribution: null, detail: firstKey.name}]});
        expect(host.catalog().plugins).toEqual([]);
        expect(assembly.report().entries).toEqual([]);
        expect(activate).not.toHaveBeenCalled();
        await runtime.root.close();
    });

    it("目录按码元排序并保留入口定义顺序，不受大小写与重音语言排序影响", async () => {
        const runtime = createRuntimeInstance({instanceId: "sorting", location: "server"});
        const assembly = createServiceAssembly(runtime, {});
        const host = createPluginHost(runtime, assembly, {});
        for (const id of ["é", "a", "Z", "A", "_", "z"]) {
            expect(host.register({id, entries: [
                {id: "second", location: "server", activate: () => ({})},
                {id: "first", location: "server", activate: () => ({})},
            ]}, {scope: runtime.root}).status).toBe("accepted");
        }
        expect(host.catalog().plugins.map((plugin) => plugin.id)).toEqual(["A", "Z", "_", "a", "z", "é"]);
        expect(host.catalog().plugins.map((plugin) => plugin.entries.map((entry) => entry.entry))).toEqual(Array.from({length: 6}, () => ["second", "first"]));
        await runtime.root.close();
    });

    // 同一服务 id 第二次产出用另一份同 id 的键、同一个实例：按 id 建产出表时，后一项不能覆盖前一项、也不能让前一项漏掉释放。
    it.each([
        ["未声明的服务", foreignKey],
        ["同一服务 id 第二次产出", defineServiceKey<string>("owner/first")],
    ] as const)("undeclared-service（%s）中途失败后全部实际产出逆序恰好释放一次", async (_scenario, badKey) => {
        const runtime = createRuntimeInstance({instanceId: "invalid-output", location: "server"});
        const assembly = createServiceAssembly(runtime, {});
        const host = createPluginHost(runtime, assembly, {});
        const released: string[] = [];
        host.register({id: "owner", entries: [{id: "main", location: "server", provides: [firstKey, lastKey], activate: () => ({services: [
            provide(firstKey, "shared", () => {released.push("first");}),
            provide(badKey, "shared", () => {released.push("bad");}),
            provide(lastKey, "last", () => {released.push("last");}),
        ]})}]}, {scope: runtime.root});
        expect(await host.activate({plugin: "owner", entry: "main"})).toMatchObject({status: "failed", stage: "output", reason: "undeclared-service", key: badKey.name});
        expect((await runtime.root.close()).status).toBe("closed");
        expect(released).toEqual(["last", "bad", "first"]);
        await runtime.root.recover();
        expect(released).toEqual(["last", "bad", "first"]);
    });

    it("未校验产出释放失败后恢复只重试失败实例，不重复释放已成功实例", async () => {
        const runtime = createRuntimeInstance({instanceId: "invalid-output-recovery", location: "server"});
        const assembly = createServiceAssembly(runtime, {});
        const host = createPluginHost(runtime, assembly, {});
        const released: string[] = [];
        let failing = true;
        host.register({id: "owner", entries: [{id: "main", location: "server", provides: [firstKey, lastKey], activate: () => ({services: [
            provide(firstKey, "first", (value) => {released.push(value);}),
            provide(foreignKey, "foreign", (value) => {
                released.push(value);
                if (failing) {throw new Error("release failed");}
            }),
            provide(lastKey, "last", (value) => {released.push(value);}),
        ]})}]}, {scope: runtime.root});
        expect(await host.activate({plugin: "owner", entry: "main"})).toMatchObject({status: "failed", reason: "undeclared-service"});
        expect((await runtime.root.close()).status).toBe("incomplete");
        expect(released).toEqual(["last", "foreign"]);
        failing = false;
        expect((await runtime.root.recover()).status).toBe("closed");
        expect(released).toEqual(["last", "foreign", "foreign", "first"]);
        await runtime.root.recover();
        expect(released).toEqual(["last", "foreign", "foreign", "first"]);
    });

    it("迟到产出的所有实例逆序恰好释放一次且不发布", async () => {
        const runtime = createRuntimeInstance({instanceId: "late-output", location: "server"});
        const assembly = createServiceAssembly(runtime, {});
        const host = createPluginHost(runtime, assembly, {});
        const started = Promise.withResolvers<void>();
        const output = Promise.withResolvers<ActivationOutput>();
        const released: string[] = [];
        host.register({id: "owner", entries: [{id: "main", location: "server", provides: [firstKey, lastKey], activate: () => {
            started.resolve();
            return output.promise;
        }}]}, {scope: runtime.root});
        const activation = host.activate({plugin: "owner", entry: "main"});
        await started.promise;
        const closing = runtime.root.close();
        output.resolve({services: [provide(firstKey, "first", (value) => {released.push(value);}), provide(lastKey, "last", (value) => {released.push(value);})]});
        expect(await activation).toMatchObject({status: "stopped"});
        expect((await closing).status).toBe("closed");
        expect(released).toEqual(["last", "first"]);
        expect(host.diagnostics().filter((diagnostic) => diagnostic.reason === "published")).toEqual([]);
        await runtime.root.recover();
        expect(released).toEqual(["last", "first"]);
    });

    it("停止开始后尚未提交的服务交付被拒绝，实例由激活产出释放且不创建租约", async () => {
        const runtime = createRuntimeInstance({instanceId: "stopped-delivery", location: "server"});
        const assembly = createServiceAssembly(runtime, {});
        const released: string[] = [];
        let activationScope: Scope | null = null;
        let closing: Promise<unknown> | null = null;
        const host = createPluginHost(runtime, assembly, {observer: {diagnosticRecorded: (diagnostic) => {
            if (diagnostic.reason === "published") {
                closing = activationScope!.close();
            }
        }}});
        host.register({id: "owner", entries: [{id: "main", location: "server", provides: [firstKey], activate: (context) => {
            activationScope = context.scope.parent;
            context.scope.register({kind: "owned", label: "own", value: null, release: () => {released.push("own");}});
            return {services: [provide(firstKey, "instance", () => {released.push("instance");})]};
        }}]}, {scope: runtime.root});
        assembly.declare({id: "consumer", location: "server", scope: runtime.root, dependencies: [{key: firstKey}]});
        const resolved = await assembly.access("consumer").resolve(firstKey);
        expect(resolved).toMatchObject({status: "unavailable", reason: "initialization-failed", error: {name: "PluginStateError"}});
        await closing;
        expect((await runtime.root.close()).status).toBe("closed");
        expect(released.filter((value) => value === "instance")).toEqual(["instance"]);
        expect(released.filter((value) => value === "own")).toEqual(["own"]);
        expect(host.entryState({plugin: "owner", entry: "main"})).toMatchObject({status: "closed"});
    });
});
