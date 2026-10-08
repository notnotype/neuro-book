/**
 * 入口可查已接受的贡献声明，校验函数只看单条声明（runtime.plugins 输出第 23 条、验收 26）：真实插件宿主与服务装配。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly} from "../services/services";

import {createPluginHost} from "./plugins";
import type {ContributionDeclarations, ContributionPointDefinition, PluginDefinition, PluginDiagnostic, PluginHost} from "./plugins";

const roots: Scope[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((scope) => scope.close()));
});

function fixture() {
    const runtime = createRuntimeInstance({location: "server", instanceId: "declarations"});
    runtime.root.open();
    roots.push(runtime.root);
    const diagnostics: PluginDiagnostic[] = [];
    const host = createPluginHost(runtime, createServiceAssembly(runtime), {observer: {diagnosticRecorded: (diagnostic) => diagnostics.push(diagnostic)}});
    const register = (definition: PluginDefinition, scope: Scope = runtime.root): void => {
        const result = host.register(definition, {scope});
        if (result.status !== "accepted") throw new Error(`登记失败：${JSON.stringify(result.rejections)}`);
    };
    return {host, register, diagnostics, root: runtime.root};
}

/** 只有声明的贡献点：声明标了 `ok: false` 就拒绝。 */
interface Ref {
    readonly ok?: boolean;
}

function point(id: string, calls: {count: number} = {count: 0}): ContributionPointDefinition<Ref> {
    return {
        id,
        implementation: "none",
        validate: ({declaration}) => {
            calls.count += 1;
            return declaration.ok === false ? "声明标了不合格" : null;
        },
    };
}

/** 插件至少要有一个入口；这些插件只有声明，入口什么也不做。 */
const IDLE = [{id: "main", location: "server", activate: () => ({})}];

function owner(id: string, points: ReadonlyArray<string>, calls?: {count: number}): PluginDefinition {
    return {id, contributionPoints: points.map((point_) => point(point_, calls)), entries: IDLE};
}

function contributor(id: string, contributions: ReadonlyArray<{readonly capability: string; readonly id: string; readonly declaration: Ref}>): PluginDefinition {
    return {id, contributions, entries: IDLE};
}

/** 入口激活时拿到的查询。 */
function reader(): {readonly plugin: PluginDefinition; get(): ContributionDeclarations} {
    let declarations: ContributionDeclarations | null = null;
    return {
        plugin: {id: "reader", entries: [{id: "main", location: "server", activate: (context) => {
            declarations = context.declarations;
            return {};
        }}]},
        get: () => {
            if (declarations === null) throw new Error("reader 还没激活");
            return declarations;
        },
    };
}

function statusOf(host: PluginHost, capability: string, id: string): string {
    const state = host.contribution(capability, id)[0];
    if (state === undefined) return "none";
    return state.validation.status === "rejected" ? `rejected:${state.validation.detail ?? state.validation.reason}` : state.validation.status;
}

describe("Spec runtime.plugins 输出 23、验收 26：查询已接受的声明", () => {
    it("只列已接受的：被拒与待定的不列；入口激活时拿到同一个查询；查询不记诊断", async () => {
        const {host, register, diagnostics} = fixture();
        const read = reader();
        register(owner("keys", ["keys"]));
        register(contributor("a", [
            {capability: "keys", id: "a.good", declaration: {}},
            {capability: "keys", id: "a.bad", declaration: {ok: false}},
            {capability: "nobody", id: "a.waiting", declaration: {}},
        ]));
        register(read.plugin);
        expect(await host.activate({plugin: "reader", entry: "main"})).toMatchObject({status: "activated"});
        const before = diagnostics.length;

        const declarations = read.get();
        expect(declarations.list("keys")).toEqual([{capability: "keys", id: "a.good", declaration: {}, plugin: "a", entry: null, location: "server"}]);
        expect(declarations.get("keys", "a.bad")).toBeNull();
        expect(declarations.get("nobody", "a.waiting")).toBeNull();
        expect(declarations.get("keys", "a.missing")).toBeNull();
        expect(diagnostics.length).toBe(before);
    });

    it("别的插件登记与撤销：查询随之变化，已有声明的校验结果不变，校验只为被查的那条运行", async () => {
        const {host, register, root} = fixture();
        const read = reader();
        const calls = {count: 0};
        register(owner("points", ["p1", "p2"], calls));
        register(contributor("x", [{capability: "p1", id: "x.a", declaration: {}}]));
        register(read.plugin);
        expect(await host.activate({plugin: "reader", entry: "main"})).toMatchObject({status: "activated"});
        expect(statusOf(host, "p1", "x.a")).toBe("accepted");

        const later = root.createChild("later");
        later.open();
        register(contributor("y", [{capability: "p2", id: "y.b", declaration: {ok: false}}, {capability: "p2", id: "y.c", declaration: {}}]), later);
        expect(read.get().list("p2").map((descriptor) => descriptor.id)).toEqual(["y.c"]);
        expect(statusOf(host, "p1", "x.a")).toBe("accepted");

        calls.count = 0;
        expect(statusOf(host, "p1", "x.a")).toBe("accepted");
        expect(calls.count).toBe(1);
        await later.close();
        expect(read.get().list("p2")).toEqual([]);
        expect(statusOf(host, "p1", "x.a")).toBe("accepted");
    });
});
