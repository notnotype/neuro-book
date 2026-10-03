import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {describe, expect, it, vi} from "vitest";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {RuntimeInstance, RuntimeLocation, Scope} from "../lifecycle/lifecycle";

import {createServiceAssembly, defineServiceKey} from "./services";
import type {AssemblyDiagnostic, ProviderDeclaration, ResolveResult, ServiceBinding, ServiceCreateContext, ServiceKey} from "./services";

const moduleDir = dirname(fileURLToPath(import.meta.url));

interface Counter {
    readonly name: string;
    count(): number;
}

interface Store {
    readonly name: string;
    readonly counter: Counter;
}

const counterKey = defineServiceKey<Counter>("counter");
const storeKey = defineServiceKey<Store>("store");
const cacheKey = defineServiceKey<{readonly name: string}>("cache");
const unknownKey = defineServiceKey<unknown>("unknown");
const keys = [counterKey, storeKey, cacheKey];

function instance(location: RuntimeLocation = "server", instanceId = `${location}-1`): RuntimeInstance {
    const runtime = createRuntimeInstance({location, instanceId});
    runtime.root.open();
    return runtime;
}

function openedChild(parent: Scope, label: string): Scope {
    const child = parent.createChild(label);
    child.open();
    return child;
}

function makeCounter(name: string): Counter {
    let value = 0;
    return {
        name,
        count: () => {
            value += 1;
            return value;
        },
    };
}

function counterCreate(name: string): (context: ServiceCreateContext) => Counter {
    return () => makeCounter(name);
}

function resolved<T>(result: ResolveResult<T>): {readonly instance: T; readonly binding: ServiceBinding} {
    if (result.status !== "resolved") {
        throw new Error(`期望解析成功，实际 ${result.reason}`);
    }
    return result;
}

/** 让一个宏任务过去，足以冲刷机制内部全部 microtask 链。 */
function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function isSettled(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    const mark = (): void => {
        settled = true;
    };
    void promise.then(mark, mark);
    await tick();
    return settled;
}

/** 根上一个 counter 提供者 + 一个消费者的最小装配。 */
function minimalAssembly(runtime: RuntimeInstance, create: (context: ServiceCreateContext) => Counter | Promise<Counter> = vi.fn(counterCreate("root"))) {
    const assembly = createServiceAssembly(runtime, {keys});
    const location = runtime.identity.location;
    const root = runtime.root;
    assembly.declare({id: "counter", key: counterKey, location, scope: root, create});
    assembly.declare({id: "app", location, scope: root, dependencies: [{key: counterKey}]});
    return {assembly, root, location, create};
}

describe("runtime.services 机制边界", () => {
    it("机制源码只使用同目录相对导入与 ../lifecycle/lifecycle，不 import 框架、驱动或产品领域", async () => {
        const sources = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
        expect(sources).toContain("services.ts");
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const fromSpecifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
            const sideEffectSpecifiers = [...code.matchAll(/^\s*import\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
            for (const specifier of [...fromSpecifiers, ...sideEffectSpecifiers]) {
                expect(specifier, `${name} 导入了 ${specifier}`).toMatch(/^(?:\.\/[^/]+|\.\.\/lifecycle\/lifecycle)$/u);
            }
            expect(code, `${name} 不得使用动态 import`).not.toMatch(/\bimport\s*\(/u);
        }
    });

    it("服务键以身份区分，同名不等价；空名称拒绝", () => {
        expect(() => defineServiceKey(" ")).toThrow(TypeError);
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys: [counterKey]});
        const sameName = defineServiceKey<Counter>("counter");
        expect(
            assembly.declare({id: "p", key: sameName, location: "server", scope: runtime.root, create: counterCreate("p")}),
        ).toEqual({status: "rejected", id: "p", reason: "unknown-key"});
    });

    it("声明校验：重复 id、未登记键、位置不符、跨实例作用域与已停止作用域均拒绝且留诊断", async () => {
        const runtime = instance();
        const other = instance("server", "server-2");
        const assembly = createServiceAssembly(runtime, {keys});
        const declare = (id: string, extra: Partial<{location: RuntimeLocation; scope: Scope; key: ServiceKey<unknown>}> = {}) =>
            assembly.declare({
                id,
                key: extra.key ?? counterKey,
                location: extra.location ?? "server",
                scope: extra.scope ?? runtime.root,
                create: counterCreate(id),
            });
        expect(declare("a")).toEqual({status: "accepted", id: "a"});
        expect(declare("a")).toMatchObject({status: "rejected", reason: "duplicate-id"});
        expect(declare("b", {key: unknownKey})).toMatchObject({status: "rejected", reason: "unknown-key"});
        expect(declare("c", {location: "browser"})).toMatchObject({status: "rejected", reason: "location-mismatch"});
        expect(declare("d", {scope: other.root})).toMatchObject({status: "rejected", reason: "foreign-scope"});
        const closed = openedChild(runtime.root, "closed");
        await closed.close();
        expect(declare("e", {scope: closed})).toMatchObject({status: "rejected", reason: "scope-not-alive"});
        expect(assembly.diagnostics().map((diagnostic) => [diagnostic.stage, diagnostic.entryId, diagnostic.reason])).toEqual([
            ["declare", "a", "duplicate-id"],
            ["declare", "b", "unknown-key"],
            ["declare", "c", "location-mismatch"],
            ["declare", "d", "foreign-scope"],
            ["declare", "e", "scope-not-alive"],
        ]);
        expect(assembly.report().entries.map((entry) => entry.id)).toEqual(["a"]);
    });

    it("访问作用域必须是入口声明作用域的严格后代；提供者必须给出作用域", () => {
        const runtime = instance();
        const {assembly, root} = minimalAssembly(runtime);
        const sibling = openedChild(root, "sibling");
        expect(() => assembly.access("app", root)).toThrow(TypeError);
        expect(() => assembly.access("counter")).toThrow(TypeError);
        expect(() => assembly.access("missing")).toThrow(TypeError);
        expect(assembly.access("app", sibling).scope).toBe(sibling);
        expect(assembly.access("app").scope.parentId).toBe(root.id);
    });
});

describe("Spec 验收 1：并发首次解析与 single-flight", () => {
    it("同一提供者作用域并发首次解析只初始化一次，两者拿到同一实例；报告与状态查询不实例化", async () => {
        const runtime = instance();
        const gate = Promise.withResolvers<void>();
        const create = vi.fn(async (): Promise<Counter> => {
            await gate.promise;
            return makeCounter("shared");
        });
        const {assembly, root, location} = minimalAssembly(runtime, create);
        assembly.declare({id: "other", location, scope: root, dependencies: [{key: counterKey}]});
        expect(assembly.report().entries.map((entry) => entry.verdict)).toEqual(["usable", "usable", "usable"]);
        expect(assembly.providerState("counter")).toBe("unresolved");
        expect(create).not.toHaveBeenCalled();

        const first = assembly.access("app").resolve(counterKey);
        const second = assembly.access("other").resolve(counterKey);
        await tick();
        expect(assembly.providerState("counter")).toBe("initializing");
        expect(create).toHaveBeenCalledTimes(1);
        gate.resolve();
        const [a, b] = await Promise.all([first, second]);
        expect(resolved(a).instance).toBe(resolved(b).instance);
        expect(resolved(a).binding.serviceScopeId).toBe(resolved(b).binding.serviceScopeId);
        expect(resolved(a).binding.stale).toBe(false);
        expect(assembly.providerState("counter")).toBe("available");
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("子作用域消费者解析祖先提供者命中同一实例；另一个提供者作用域与另一个运行实例各得不同实例", async () => {
        const runtime = instance();
        const {assembly, root, location, create} = minimalAssembly(runtime);
        const session = openedChild(root, "session");
        assembly.declare({id: "session-app", location, scope: session, dependencies: [{key: counterKey}]});
        const fromRoot = resolved(await assembly.access("app").resolve(counterKey));
        const fromSession = resolved(await assembly.access("session-app").resolve(counterKey));
        expect(fromSession.instance).toBe(fromRoot.instance);
        expect(create).toHaveBeenCalledTimes(1);

        // 另一个提供者作用域：两个兄弟作用域各自声明同一键，不冲突、不共享实例。
        const left = openedChild(root, "left");
        const right = openedChild(root, "right");
        assembly.declare({id: "cache-left", key: cacheKey, location, scope: left, create: () => ({name: "left"})});
        assembly.declare({id: "cache-right", key: cacheKey, location, scope: right, create: () => ({name: "right"})});
        assembly.declare({id: "left-app", location, scope: left, dependencies: [{key: cacheKey}]});
        assembly.declare({id: "right-app", location, scope: right, dependencies: [{key: cacheKey}]});
        expect(resolved(await assembly.access("left-app").resolve(cacheKey)).instance.name).toBe("left");
        expect(resolved(await assembly.access("right-app").resolve(cacheKey)).instance.name).toBe("right");

        const other = minimalAssembly(instance("server", "server-2"));
        const fromOther = resolved(await other.assembly.access("app").resolve(counterKey));
        expect(fromOther.instance).not.toBe(fromRoot.instance);
        expect(other.create).toHaveBeenCalledTimes(1);
    });

    it("解析等待期间取消其中一个等待方，不取消共享初始化，其他等待者仍拿到同一结果", async () => {
        const runtime = instance();
        const gate = Promise.withResolvers<void>();
        const create = vi.fn(async (): Promise<Counter> => {
            await gate.promise;
            return makeCounter("shared");
        });
        const {assembly, root, location} = minimalAssembly(runtime, create);
        assembly.declare({id: "other", location, scope: root, dependencies: [{key: counterKey}]});
        const controller = new AbortController();
        const cancelled = assembly.access("app").resolve(counterKey, {signal: controller.signal});
        const kept = assembly.access("other").resolve(counterKey);
        await tick();
        controller.abort();
        expect(await cancelled).toMatchObject({status: "unavailable", reason: "cancelled", providerId: "counter"});
        expect(await isSettled(kept)).toBe(false);
        expect(assembly.providerState("counter")).toBe("initializing");
        gate.resolve();
        expect(resolved(await kept).instance.name).toBe("shared");
        expect(create).toHaveBeenCalledTimes(1);
        // 取消方重新解析得到同一实例，不再初始化。
        expect(resolved(await assembly.access("app").resolve(counterKey)).instance).toBe(resolved(await kept).instance);
        expect(create).toHaveBeenCalledTimes(1);
    });
});

describe("Spec 验收 2：缺依赖闭包与可选缺失", () => {
    it("必需依赖缺失拒绝提供者自身与必需消费者闭包，健康上游与无关消费者继续可用，可选缺失只让该能力不可用", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys: [counterKey, storeKey, cacheKey]});
        const root = runtime.root;
        const createCounter = vi.fn(counterCreate("counter"));
        const createStore = vi.fn((context: ServiceCreateContext): Store => ({name: "store", counter: context.services.require(counterKey)}));
        assembly.declare({id: "counter", key: counterKey, location: "server", scope: root, create: createCounter});
        // store 必需 cache，而 cache 没有提供者。
        assembly.declare({
            id: "store",
            key: storeKey,
            location: "server",
            scope: root,
            dependencies: [{key: counterKey}, {key: cacheKey}],
            create: createStore,
        });
        assembly.declare({id: "needs-store", location: "server", scope: root, dependencies: [{key: storeKey}, {key: counterKey}]});
        assembly.declare({id: "needs-counter", location: "server", scope: root, dependencies: [{key: counterKey}]});
        assembly.declare({id: "optional-cache", location: "server", scope: root, dependencies: [{key: counterKey}, {key: cacheKey, required: false}]});

        const report = Object.fromEntries(assembly.report().entries.map((entry) => [entry.id, entry]));
        expect(report["store"]).toMatchObject({verdict: "rejected", problems: [{kind: "missing-required", key: "cache"}]});
        expect(report["needs-store"]).toMatchObject({
            verdict: "rejected",
            problems: [{kind: "rejected-dependency", key: "store", providerId: "store"}],
            dependencies: [
                {status: "provider-rejected", key: "store", providerId: "store"},
                {status: "satisfied", key: "counter", providerId: "counter"},
            ],
        });
        expect(report["counter"]).toMatchObject({verdict: "usable"});
        expect(report["needs-counter"]).toMatchObject({verdict: "usable"});
        expect(report["optional-cache"]).toMatchObject({verdict: "usable", dependencies: [{status: "satisfied"}, {status: "missing", required: false}]});

        // 闭包内入口连健康依赖也拿不到：不产生新的业务副作用。
        expect(await assembly.access("needs-store").resolve(storeKey)).toMatchObject({status: "unavailable", reason: "provider-rejected", providerId: "store"});
        expect(await assembly.access("needs-store").resolve(counterKey)).toMatchObject({status: "unavailable", reason: "entry-rejected", path: ["needs-store"]});
        expect(createStore).not.toHaveBeenCalled();
        expect(createCounter).not.toHaveBeenCalled();

        expect(resolved(await assembly.access("needs-counter").resolve(counterKey)).instance.name).toBe("counter");
        const optional = assembly.access("optional-cache");
        expect(await optional.resolve(cacheKey)).toMatchObject({status: "unavailable", reason: "missing-provider", providerId: null});
        expect(resolved(await optional.resolve(counterKey)).instance.name).toBe("counter");
        expect(await optional.resolve(storeKey)).toMatchObject({status: "unavailable", reason: "undeclared-dependency"});
        expect(createCounter).toHaveBeenCalledTimes(1);
    });

    it("必需依赖初始化失败时，依赖它的提供者不调用 create，消费者得到带路径的同一失败；健康上游继续可用", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const createCache = vi.fn((): never => {
            throw new Error("cache boom");
        });
        const createStore = vi.fn((): Store => ({name: "store", counter: makeCounter("c")}));
        assembly.declare({id: "counter", key: counterKey, location: "server", scope: root, create: counterCreate("counter")});
        assembly.declare({id: "cache", key: cacheKey, location: "server", scope: root, create: createCache});
        assembly.declare({id: "store", key: storeKey, location: "server", scope: root, dependencies: [{key: cacheKey}], create: createStore});
        assembly.declare({id: "app", location: "server", scope: root, dependencies: [{key: storeKey}, {key: cacheKey}, {key: counterKey}]});

        const app = assembly.access("app");
        const store = await app.resolve(storeKey);
        expect(store).toMatchObject({
            status: "unavailable",
            reason: "dependency-unavailable",
            providerId: "store",
            path: ["store", "cache"],
            error: {name: "Error", message: "cache boom"},
        });
        expect(createStore).not.toHaveBeenCalled();
        expect(createCache).toHaveBeenCalledTimes(1);
        expect(await app.resolve(cacheKey)).toMatchObject({status: "unavailable", reason: "initialization-failed", providerId: "cache", path: ["cache"]});
        expect(resolved(await app.resolve(counterKey)).instance.name).toBe("counter");
        expect(assembly.providerState("store")).toBe("failed");
        expect(assembly.providerState("cache")).toBe("failed");
    });
});

describe("Spec 验收 3：重复提供隔离", () => {
    it("同一祖先链上两个提供者声明同一键时全部隔离，消费者得到冲突原因，不按顺序挑选", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const session = openedChild(root, "session");
        const createA = vi.fn(counterCreate("a"));
        const createB = vi.fn(counterCreate("b"));
        assembly.declare({id: "a", key: counterKey, location: "server", scope: root, create: createA});
        assembly.declare({id: "b", key: counterKey, location: "server", scope: session, create: createB});
        assembly.declare({id: "root-app", location: "server", scope: root, dependencies: [{key: counterKey}]});
        assembly.declare({id: "session-app", location: "server", scope: session, dependencies: [{key: counterKey}]});

        const report = Object.fromEntries(assembly.report().entries.map((entry) => [entry.id, entry]));
        expect(report["a"]).toMatchObject({verdict: "rejected", problems: [{kind: "conflict", key: "counter", providerIds: ["a", "b"]}]});
        expect(report["b"]).toMatchObject({verdict: "rejected", problems: [{kind: "conflict", key: "counter", providerIds: ["a", "b"]}]});
        expect(report["session-app"]).toMatchObject({verdict: "rejected", dependencies: [{status: "conflict", providerIds: ["a", "b"]}]});
        expect(await assembly.access("session-app").resolve(counterKey)).toMatchObject({status: "unavailable", reason: "conflict", path: ["a", "b"]});
        expect(await assembly.access("root-app").resolve(counterKey)).toMatchObject({status: "unavailable", reason: "conflict", path: ["a", "b"]});
        expect(createA).not.toHaveBeenCalled();
        expect(createB).not.toHaveBeenCalled();
    });
});

describe("Spec 验收 4：依赖环检查", () => {
    it("静态依赖环（含可选边）在装配阶段拒绝，无入口被激活", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const createCounter = vi.fn(counterCreate("counter"));
        const createStore = vi.fn((): Store => ({name: "store", counter: makeCounter("c")}));
        assembly.declare({id: "counter", key: counterKey, location: "server", scope: root, dependencies: [{key: storeKey, required: false}], create: createCounter});
        assembly.declare({id: "store", key: storeKey, location: "server", scope: root, dependencies: [{key: counterKey}], create: createStore});
        assembly.declare({id: "cache", key: cacheKey, location: "server", scope: root, create: () => ({name: "cache"})});
        assembly.declare({id: "app", location: "server", scope: root, dependencies: [{key: counterKey}, {key: cacheKey}]});

        const report = Object.fromEntries(assembly.report().entries.map((entry) => [entry.id, entry]));
        expect(report["counter"]).toMatchObject({verdict: "rejected", problems: [{kind: "cycle", path: ["counter", "store"]}]});
        expect(report["store"]).toMatchObject({verdict: "rejected", problems: [{kind: "cycle", path: ["counter", "store"]}]});
        expect(report["cache"]).toMatchObject({verdict: "usable"});
        expect(report["app"]).toMatchObject({verdict: "rejected"});
        expect(await assembly.access("app").resolve(counterKey)).toMatchObject({status: "unavailable", reason: "provider-rejected", providerId: "counter"});
        expect(createCounter).not.toHaveBeenCalled();
        expect(createStore).not.toHaveBeenCalled();
    });

    it("运行时等待环在已开始初始化后被发现：阻断受影响解析、不回滚已发生副作用、本次登记资源被收口", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const sideEffects: string[] = [];
        const releaseTemp = vi.fn();
        // 静态图无环：counter 与 store 都不声明彼此。等待边经由两个消费者入口在 create 内形成。
        assembly.declare({id: "via-store", location: "server", scope: root, dependencies: [{key: storeKey}]});
        assembly.declare({id: "via-counter", location: "server", scope: root, dependencies: [{key: counterKey}]});
        assembly.declare({
            id: "counter",
            key: counterKey,
            location: "server",
            scope: root,
            create: async (context) => {
                sideEffects.push("counter-started");
                context.scope.register({kind: "temp", label: "counter-temp", value: 1, release: releaseTemp});
                const store = await assembly.access("via-store", context.scope.createChild("op")).resolve(storeKey);
                if (store.status !== "resolved") {
                    throw new Error(`counter 等不到 store：${store.reason}`);
                }
                return makeCounter("counter");
            },
        });
        assembly.declare({
            id: "store",
            key: storeKey,
            location: "server",
            scope: root,
            create: async (context) => {
                sideEffects.push("store-started");
                const counter = await assembly.access("via-counter", context.scope.createChild("op")).resolve(counterKey);
                if (counter.status !== "resolved") {
                    throw new Error(`store 等不到 counter：${counter.reason}`);
                }
                return {name: "store", counter: counter.instance};
            },
        });
        expect(assembly.report().entries.every((entry) => entry.verdict === "usable")).toBe(true);

        const result = await assembly.access("via-counter").resolve(counterKey);
        expect(result).toMatchObject({status: "unavailable", reason: "initialization-failed", providerId: "counter", error: {message: "counter 等不到 store：initialization-failed"}});
        expect(sideEffects).toEqual(["counter-started", "store-started"]);
        expect(assembly.diagnostics().filter((diagnostic) => diagnostic.reason === "dependency-cycle")).toMatchObject([
            {stage: "resolve", entryId: "store", key: "counter"},
        ]);
        expect(await assembly.access("via-store").resolve(storeKey)).toMatchObject({
            status: "unavailable",
            reason: "initialization-failed",
            providerId: "store",
            error: {message: "store 等不到 counter：dependency-cycle"},
        });
        expect(releaseTemp).toHaveBeenCalledTimes(1);
        expect(assembly.providerState("counter")).toBe("failed");
        expect(assembly.providerState("store")).toBe("failed");
    });
});

describe("Spec 验收 5：初始化失败稳定与显式恢复", () => {
    it("初始化失败收口已登记资源、等待者得到同一失败、不发布半成品；再次解析稳定同一失败；恢复后才重新初始化为新代次", async () => {
        const runtime = instance();
        const releaseTemp = vi.fn();
        let attempts = 0;
        const create = vi.fn((context: ServiceCreateContext): Counter => {
            attempts += 1;
            context.scope.register({kind: "temp", label: "temp", value: attempts, release: releaseTemp});
            if (attempts === 1) {
                throw new Error("first attempt fails");
            }
            return makeCounter(`attempt-${attempts}`);
        });
        const {assembly, root, location} = minimalAssembly(runtime, create);
        assembly.declare({id: "other", location, scope: root, dependencies: [{key: counterKey}]});

        const [a, b] = await Promise.all([assembly.access("app").resolve(counterKey), assembly.access("other").resolve(counterKey)]);
        expect(a).toMatchObject({status: "unavailable", reason: "initialization-failed", error: {message: "first attempt fails"}});
        expect(b).toBe(a);
        expect(releaseTemp).toHaveBeenCalledTimes(1);
        expect(await assembly.access("app").resolve(counterKey)).toBe(a);
        expect(create).toHaveBeenCalledTimes(1);
        expect(assembly.providerState("counter")).toBe("failed");
        expect(root.snapshot().children.length).toBe(2);

        expect(await assembly.recover("counter")).toEqual({status: "reset", providerId: "counter"});
        expect(assembly.providerState("counter")).toBe("unresolved");
        expect(create).toHaveBeenCalledTimes(1);
        const second = resolved(await assembly.access("app").resolve(counterKey));
        expect(second.instance.name).toBe("attempt-2");
        expect(create).toHaveBeenCalledTimes(2);
        expect(await assembly.recover("counter")).toEqual({status: "not-failed", providerId: "counter", state: "available"});
    });

    it("显式恢复不与仍 pending 的收口并发；收口未完成时报告 closeout-incomplete 且不重置，不自动循环", async () => {
        const runtime = instance();
        const gate = Promise.withResolvers<void>();
        let failRelease = true;
        const releaseTemp = vi.fn(async () => {
            await gate.promise;
            if (failRelease) {
                throw new Error("temp release fails");
            }
        });
        const create = vi.fn((context: ServiceCreateContext): Counter => {
            context.scope.register({kind: "temp", label: "temp", value: 1, release: releaseTemp});
            throw new Error("boom");
        });
        const {assembly} = minimalAssembly(runtime, create);
        const failure = await assembly.access("app").resolve(counterKey);
        expect(failure).toMatchObject({status: "unavailable", reason: "initialization-failed"});

        const recovering = assembly.recover("counter");
        expect(await isSettled(recovering)).toBe(false);
        expect(releaseTemp).toHaveBeenCalledTimes(1);
        gate.resolve();
        expect(await recovering).toMatchObject({status: "closeout-incomplete", providerId: "counter"});
        expect(assembly.providerState("counter")).toBe("failed");
        expect(await assembly.access("app").resolve(counterKey)).toBe(failure);

        failRelease = false;
        expect(await assembly.recover("counter")).toEqual({status: "reset", providerId: "counter"});
        expect(releaseTemp).toHaveBeenCalledTimes(2);
        expect(assembly.diagnostics().filter((diagnostic) => diagnostic.stage === "recover").map((diagnostic) => diagnostic.reason)).toEqual([
            "closeout-incomplete",
            "reset",
        ]);
    });

    it("提供者 owner 停止时在途初始化收到信号；迟到成功不发布，等待者得到 provider-stopped", async () => {
        const runtime = instance();
        const release = vi.fn();
        const gate = Promise.withResolvers<void>();
        const create = vi.fn(async (context: ServiceCreateContext): Promise<Counter> => {
            await gate.promise;
            expect(context.signal.aborted).toBe(true);
            return makeCounter("late");
        });
        const assembly = createServiceAssembly(runtime, {keys});
        const session = openedChild(runtime.root, "session");
        assembly.declare({id: "counter", key: counterKey, location: "server", scope: session, create, release});
        assembly.declare({id: "app", location: "server", scope: session, dependencies: [{key: counterKey}]});
        const resolving = assembly.access("app").resolve(counterKey);
        await tick();
        const closing = session.close();
        await tick();
        gate.resolve();
        expect(await resolving).toMatchObject({status: "unavailable", reason: "provider-stopped", providerId: "counter"});
        await expect(closing).resolves.toMatchObject({status: "closed"});
        expect(release).toHaveBeenCalledTimes(1);
        expect(assembly.providerState("counter")).toBe("stopped");
        expect(await assembly.access("app").resolve(counterKey)).toMatchObject({status: "unavailable", reason: "consumer-stopped"});
    });
});

describe("Spec 验收 6：寿命合法性", () => {
    it("长寿命入口不能解析更短寿命作用域上的提供者；操作级作用域可借用长寿命精确代次并随操作结束释放", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const session = openedChild(root, "session");
        const createCache = vi.fn(() => ({name: "session-cache"}));
        assembly.declare({id: "counter", key: counterKey, location: "server", scope: root, create: counterCreate("counter")});
        assembly.declare({id: "cache", key: cacheKey, location: "server", scope: session, create: createCache});
        assembly.declare({id: "root-app", location: "server", scope: root, dependencies: [{key: counterKey}, {key: cacheKey, required: false}]});

        const report = Object.fromEntries(assembly.report().entries.map((entry) => [entry.id, entry]));
        expect(report["root-app"]).toMatchObject({verdict: "usable", dependencies: [{status: "satisfied"}, {status: "unreachable", providerIds: ["cache"]}]});
        expect(await assembly.access("root-app").resolve(cacheKey)).toMatchObject({status: "unavailable", reason: "scope-lifetime", path: ["cache"]});
        expect(createCache).not.toHaveBeenCalled();

        const operation = openedChild(session, "operation");
        const bound = resolved(await assembly.access("root-app", operation).resolve(counterKey));
        expect(bound.binding.stale).toBe(false);
        expect(operation.snapshot().borrows).toHaveLength(1);
        await operation.close();
        expect(operation.snapshot().borrows[0]?.released).toBe(true);
        expect(bound.binding.stale).toBe(false);
        expect(assembly.providerState("counter")).toBe("available");
        expect(await assembly.access("root-app", operation).resolve(counterKey)).toMatchObject({status: "unavailable", reason: "consumer-stopped"});
    });

    it("消费者先于提供者收口：依赖绑定的消费者资源先释放，提供者实例最后释放", async () => {
        const runtime = instance();
        const order: string[] = [];
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        assembly.declare({
            id: "counter",
            key: counterKey,
            location: "server",
            scope: root,
            create: counterCreate("counter"),
            release: () => {
                order.push("provider");
            },
        });
        assembly.declare({id: "app", location: "server", scope: root, dependencies: [{key: counterKey}]});
        const access = assembly.access("app");
        const bound = resolved(await access.resolve(counterKey));
        access.scope.register({
            kind: "consumer",
            label: "uses-counter",
            value: 1,
            release: () => {
                order.push("consumer");
            },
            dependsOn: [bound.binding.dependency],
        });
        await expect(root.close()).resolves.toMatchObject({status: "closed"});
        expect(order).toEqual(["consumer", "provider"]);
        expect(bound.binding.stale).toBe(true);
    });
});

describe("Spec 验收 7：精确 factory 绑定", () => {
    it("登记与查询不实例化；绑定指向精确代次；目标换代后旧绑定 stale 且不改投新目标", async () => {
        const runtime = instance();
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const project1 = openedChild(root, "project#1");
        const create1 = vi.fn(counterCreate("gen-1"));
        assembly.declare({id: "counter@1", key: counterKey, location: "server", scope: project1, create: create1});
        assembly.declare({id: "app@1", location: "server", scope: project1, dependencies: [{key: counterKey}]});
        assembly.report();
        expect(assembly.providerState("counter@1")).toBe("unresolved");
        expect(create1).not.toHaveBeenCalled();

        const gen1 = resolved(await assembly.access("app@1").resolve(counterKey));
        expect(gen1.binding).toMatchObject({key: "counter", providerId: "counter@1", stale: false});
        await project1.close();
        expect(gen1.binding.stale).toBe(true);
        expect(assembly.providerState("counter@1")).toBe("stopped");

        const project2 = openedChild(root, "project#2");
        assembly.declare({id: "counter@2", key: counterKey, location: "server", scope: project2, create: counterCreate("gen-2")});
        assembly.declare({id: "app@2", location: "server", scope: project2, dependencies: [{key: counterKey}]});
        const gen2 = resolved(await assembly.access("app@2").resolve(counterKey));
        expect(gen2.binding.serviceScopeId).not.toBe(gen1.binding.serviceScopeId);
        expect(gen2.instance).not.toBe(gen1.instance);
        expect(gen1.binding.stale).toBe(true);
        gen1.binding.release();
        gen1.binding.release();
        expect(create1).toHaveBeenCalledTimes(1);
    });
});

describe("Spec 验收 8：诊断脱敏", () => {
    it("诊断与报告只含位置/作用域/服务键/入口/阶段/原因，不含实例值、声明附加字段或凭据", async () => {
        const secret = "sk-live-do-not-leak";
        const runtime = instance();
        const observed: AssemblyDiagnostic[] = [];
        const assembly = createServiceAssembly(runtime, {
            keys,
            observer: {
                diagnosticRecorded: (diagnostic) => {
                    observed.push(diagnostic);
                    throw new Error("observer boom");
                },
            },
        });
        const root = runtime.root;
        const declaration: ProviderDeclaration<Counter> & {readonly token: string} = {
            id: "counter",
            key: counterKey,
            location: "server",
            scope: root,
            create: () => ({...makeCounter("counter"), token: secret}),
            token: secret,
        };
        assembly.declare(declaration);
        assembly.declare({id: "cache", key: cacheKey, location: "server", scope: root, create: () => Promise.reject(new Error("cache down"))});
        assembly.declare({id: "app", location: "server", scope: root, dependencies: [{key: counterKey}, {key: cacheKey}]});
        assembly.declare({id: "dup", key: unknownKey, location: "server", scope: root, create: () => secret});

        resolved(await assembly.access("app").resolve(counterKey));
        expect(await assembly.access("app").resolve(cacheKey)).toMatchObject({status: "unavailable", reason: "initialization-failed"});
        const serialized = JSON.stringify({report: assembly.report(), diagnostics: assembly.diagnostics()});
        expect(serialized).not.toContain(secret);
        expect(assembly.diagnostics()).toMatchObject([
            {stage: "declare", entryId: "dup", key: "unknown", reason: "unknown-key", location: "server", instanceId: "server-1"},
            {stage: "initialize", entryId: "cache", key: "cache", reason: "initialization-failed", error: {name: "Error", message: "cache down"}},
        ]);
        expect(observed).toHaveLength(2);
    });
});

describe("Spec 验收 9：两种作用域 × 两个 host 复用", () => {
    async function assemble(location: RuntimeLocation) {
        const runtime = instance(location);
        const assembly = createServiceAssembly(runtime, {keys});
        const root = runtime.root;
        const operation = openedChild(root, "operation");
        assembly.declare({id: "counter", key: counterKey, location, scope: root, create: counterCreate(`${location}-counter`)});
        assembly.declare({id: "cache", key: cacheKey, location, scope: operation, create: () => Promise.reject(new Error(`${location} cache down`))});
        assembly.declare({id: "app", location, scope: root, dependencies: [{key: counterKey}]});
        assembly.declare({id: "op", location, scope: operation, dependencies: [{key: counterKey}, {key: cacheKey}]});
        const fromRoot = resolved(await assembly.access("app").resolve(counterKey));
        const fromOperation = resolved(await assembly.access("op").resolve(counterKey));
        const cache = await assembly.access("op").resolve(cacheKey);
        return {runtime, assembly, operation, fromRoot, fromOperation, cache};
    }

    it("浏览器与后端实例、实例级与操作级作用域各自独立解析与失败，互不串实例", async () => {
        const server = await assemble("server");
        const browser = await assemble("browser");
        for (const host of [server, browser]) {
            expect(host.fromOperation.instance).toBe(host.fromRoot.instance);
            expect(host.fromRoot.instance.name).toBe(`${host.runtime.identity.location}-counter`);
            expect(host.cache).toMatchObject({status: "unavailable", reason: "initialization-failed", error: {message: `${host.runtime.identity.location} cache down`}});
            expect(host.fromRoot.instance.count()).toBe(1);
        }
        expect(server.fromRoot.instance).not.toBe(browser.fromRoot.instance);
        expect(server.fromRoot.instance.count()).toBe(2);
        expect(browser.fromRoot.instance.count()).toBe(2);
        await server.operation.close();
        expect(server.assembly.providerState("cache")).toBe("stopped");
        expect(browser.assembly.providerState("cache")).toBe("failed");
        expect(server.assembly.providerState("counter")).toBe("available");
        expect(server.fromOperation.binding.stale).toBe(false);
    });
});
