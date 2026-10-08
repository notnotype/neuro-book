/**
 * 校验函数与入口可查已接受的贡献声明（runtime.plugins 输出第 23 条、验收 26）：真实插件宿主与服务装配。
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
    const register = (definition: PluginDefinition): void => {
        const result = host.register(definition, {scope: runtime.root});
        if (result.status !== "accepted") throw new Error(`登记失败：${JSON.stringify(result.rejections)}`);
    };
    return {host, register, diagnostics};
}

/** 只有声明的贡献点：`refers` 写了就要求它指向的那条声明已被接受。 */
interface Ref {
    readonly ok?: boolean;
    readonly refers?: {readonly capability: string; readonly id: string};
}

function point(id: string): ContributionPointDefinition<Ref> {
    return {
        id,
        implementation: "none",
        validate: ({declaration}, declarations) => {
            if (declaration.ok === false) return "声明标了不合格";
            if (declaration.refers === undefined) return null;
            return declarations.get(declaration.refers.capability, declaration.refers.id) === null ? `引用的 ${declaration.refers.capability}/${declaration.refers.id} 没有被接受` : null;
        },
    };
}

/** 插件至少要有一个入口；这些插件只有声明，入口什么也不做。 */
const IDLE = [{id: "main", location: "server", activate: () => ({})}];

function owner(id: string, points: ReadonlyArray<string>): PluginDefinition {
    return {id, contributionPoints: points.map(point), entries: IDLE};
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

    it("无环的三级查询：A 的校验查 B、B 的校验查 C，三条都被接受；C 不合格时 B、A 依次被拒", () => {
        const {host, register} = fixture();
        register(owner("points", ["p1", "p2", "p3"]));
        register(contributor("x", [
            {capability: "p1", id: "a", declaration: {refers: {capability: "p2", id: "b"}}},
            {capability: "p2", id: "b", declaration: {refers: {capability: "p3", id: "c"}}},
            {capability: "p3", id: "c", declaration: {}},
        ]));
        expect([statusOf(host, "p1", "a"), statusOf(host, "p2", "b"), statusOf(host, "p3", "c")]).toEqual(["accepted", "accepted", "accepted"]);

        const other = fixture();
        other.register(owner("points", ["p1", "p2", "p3"]));
        other.register(contributor("x", [
            {capability: "p1", id: "a", declaration: {refers: {capability: "p2", id: "b"}}},
            {capability: "p2", id: "b", declaration: {refers: {capability: "p3", id: "c"}}},
            {capability: "p3", id: "c", declaration: {ok: false}},
        ]));
        expect(statusOf(other.host, "p1", "a")).toBe("rejected:引用的 p2/b 没有被接受");
        expect(statusOf(other.host, "p2", "b")).toBe("rejected:引用的 p3/c 没有被接受");
    });

    for (const order of [["owner", "x", "y"], ["y", "x", "owner"]] as const) {
        it(`两点互查与自查：环上每条都被拒，与从哪条开始查、登记顺序（${order.join(" → ")}）无关`, () => {
            for (const start of ["x", "y"] as const) {
                const {host, register} = fixture();
                const definitions = {
                    owner: owner("points", ["px", "py", "pz"]),
                    x: contributor("x", [
                        {capability: "px", id: "x1", declaration: {refers: {capability: "py", id: "y1"}}},
                        {capability: "pz", id: "z1", declaration: {refers: {capability: "pz", id: "z1"}}},
                    ]),
                    y: contributor("y", [{capability: "py", id: "y1", declaration: {refers: {capability: "px", id: "x1"}}}]),
                };
                for (const id of order) register(definitions[id]);
                const cycle = "rejected:校验相互引用：这条声明的校验经查询又回到了它自己";
                const first = start === "x" ? statusOf(host, "px", "x1") : statusOf(host, "py", "y1");
                const second = start === "x" ? statusOf(host, "py", "y1") : statusOf(host, "px", "x1");
                expect([first, second]).toEqual([cycle, cycle]);
                expect(statusOf(host, "pz", "z1")).toBe(cycle);
            }
        });
    }
});
