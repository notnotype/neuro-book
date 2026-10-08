import {afterEach, describe, expect, it} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly, defineServiceKey} from "../services/services";

import {createPluginHost, PluginStateError, provide} from "./plugins";
import type {
    ActivationContext,
    ContributionDeclaration,
    ContributionHandle,
    ContributionPointDefinition,
    ContributionReceiver,
    ContributionState,
    PluginDefinition,
    PluginDiagnostic,
    PluginEntryDefinition,
    PluginHost,
    RevokeReason,
} from "./plugins";

const roots: Scope[] = [];
const blockerKey = defineServiceKey("tests/missing");
const ownerOutputKey = defineServiceKey<{alive: boolean}>("owner/output");

afterEach(async () => {
    await Promise.all(roots.splice(0).map((scope) => scope.close()));
});

function fixture() {
    const runtime = createRuntimeInstance({location: "server", instanceId: "contribution-contract"});
    runtime.root.open();
    roots.push(runtime.root);
    const assembly = createServiceAssembly(runtime);
    const diagnostics: PluginDiagnostic[] = [];
    const host = createPluginHost(runtime, assembly, {observer: {diagnosticRecorded: (diagnostic) => diagnostics.push(diagnostic)}});
    return {host, root: runtime.root, assembly, diagnostics};
}

function child(parent: Scope, label: string): Scope {
    const scope = parent.createChild(label);
    scope.open();
    return scope;
}

function register(host: PluginHost, definition: PluginDefinition, scope: Scope): void {
    const result = host.register(definition, {scope});
    if (result.status !== "accepted") {
        throw new Error(`登记失败：${JSON.stringify(result.rejections)}`);
    }
}

function point(id = "commands", implementation: "required" | "none" = "required"): ContributionPointDefinition<{readonly title: string}> {
    return {id, implementation, validate: ({declaration}) => declaration.title.trim() === "" ? "title 不能为空" : null};
}

function declaration(id: string, capability = "commands", title = id): ContributionDeclaration<{readonly title: string}> {
    return {capability, id, declaration: {title}};
}

function entry(id: string, contributions: ReadonlyArray<ContributionDeclaration> = [], activate?: PluginEntryDefinition["activate"]): PluginEntryDefinition {
    return {
        id,
        location: "server",
        contributions,
        activate: activate ?? (() => {
            const implementations: Record<string, Record<string, () => string>> = {};
            for (const contribution of contributions) {
                const values = implementations[contribution.capability] ??= {};
                values[contribution.id] = () => contribution.id;
            }
            return {contributions: implementations};
        }),
    };
}

function source(id: string, contributions: ReadonlyArray<ContributionDeclaration>, activate?: PluginEntryDefinition["activate"]): PluginDefinition {
    return {id, entries: [entry("main", contributions, activate)]};
}

function owner(points: ReadonlyArray<ContributionPointDefinition>, receivers: Readonly<Record<string, ContributionReceiver>>, activate?: PluginEntryDefinition["activate"]): PluginDefinition {
    return {id: "owner", contributionPoints: points, entries: [{
        id: "main", location: "server", receives: points.map((item) => item.id), activate: activate ?? (() => ({receivers})),
    }]};
}

function recordingReceiver(events: string[]): ContributionReceiver {
    return {
        prepare: (handle) => {events.push(`prepare:${handle.id}`); return handle.id;},
        published: (handle) => {events.push(`published:${handle.id}`);},
        revoke: (handle, _prepared, reason) => {events.push(`revoke:${handle.id}:${reason}`);},
    };
}

function state(host: PluginHost, id: string, capability = "commands"): ContributionState {
    const result = host.contribution(capability, id);
    if (result.length !== 1) {
        throw new Error(`期望唯一贡献 ${capability}/${id}，实际 ${result.length}`);
    }
    return result[0]!;
}

describe("拥有者贡献点合同", () => {
    it("场景 1：拥有者已登记时只拒绝 invalid-declaration，给了实现也不发布，其它贡献与入口照常", async () => {
        const {host, root} = fixture();
        const events: string[] = [];
        register(host, owner([point()], {commands: recordingReceiver(events)}), root);
        await host.activate({plugin: "owner", entry: "main"});
        register(host, {id: "source", entries: [
            entry("main", [declaration("ok"), declaration("bad", "commands", " ")]),
            entry("other", [declaration("other")]),
        ]}, root);
        expect(state(host, "bad").validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "title 不能为空"});
        expect(state(host, "ok").validation).toEqual({status: "accepted"});
        expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
        expect((await host.activate({plugin: "source", entry: "other"})).status).toBe("activated");
        expect(events).toEqual(["prepare:ok", "published:ok", "prepare:other", "published:other"]);
        expect(state(host, "ok")).toMatchObject({status: "available", delivery: {status: "delivered"}});
        expect(state(host, "bad")).toMatchObject({status: "declared", validation: {status: "rejected"}, delivery: {status: "waiting-receiver"}});
        expect("implementation" in state(host, "bad")).toBe(false);
    });

    it("场景 2：required 拒绝顶层声明，none 拒绝入口实现，只拒绝单条贡献", async () => {
        const {host, root} = fixture();
        register(host, owner([point(), point("metadata", "none")], {}), root);
        register(host, {id: "source", contributions: [declaration("required-top"), declaration("none-top", "metadata")], entries: [
            entry("main", [declaration("none-entry", "metadata")], () => ({})),
        ]}, root);
        expect(state(host, "required-top").validation).toEqual({status: "rejected", reason: "implementation-required", detail: null});
        expect(state(host, "none-entry", "metadata").validation).toEqual({status: "rejected", reason: "implementation-not-accepted", detail: null});
        expect(state(host, "none-top", "metadata").validation).toEqual({status: "accepted"});
        expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
    });

    it("场景 3：三种登记顺序在拥有者缺席时 pending，登记后 accepted/rejected 目录一致且查询不记诊断", () => {
        const orders = [["owner", "good", "bad"], ["good", "owner", "bad"], ["bad", "good", "owner"]] as const;
        const catalogs = orders.map((order) => {
            const {host, root} = fixture();
            const definitions = {
                owner: owner([point()], {}),
                good: source("good", [declaration("good")]),
                bad: source("bad", [declaration("bad", "commands", " ")]),
            };
            let ownerRegistered = false;
            for (const id of order) {
                register(host, definitions[id], root);
                ownerRegistered ||= id === "owner";
                if (!ownerRegistered) {
                    expect(state(host, id).validation).toEqual({status: "pending", reason: "unknown-point"});
                }
            }
            const before = host.diagnostics();
            expect(state(host, "good").validation).toEqual({status: "accepted"});
            expect(state(host, "bad").validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "title 不能为空"});
            const first = host.catalog();
            expect(host.catalog()).toEqual(first);
            expect(host.diagnostics()).toEqual(before);
            return first;
        });
        expect(catalogs[1]).toEqual(catalogs[0]);
        expect(catalogs[2]).toEqual(catalogs[0]);
    });

    it("场景 4：两种登记顺序都拒绝同点同 id 的全部重复者，查询稳定返回两条，其它贡献与入口可用", async () => {
        const results = [];
        for (const order of [["a", "b"], ["b", "a"]] as const) {
            const {host, root} = fixture();
            register(host, owner([point()], {}), root);
            for (const id of order) {
                register(host, {id, entries: [
                    entry("main", [declaration("same"), declaration(`${id}.ok`)]),
                    entry("other"),
                ]}, root);
            }
            expect(host.contribution("commands", "same")).toMatchObject([
                {plugin: "a", validation: {status: "rejected", reason: "duplicate-contribution"}},
                {plugin: "b", validation: {status: "rejected", reason: "duplicate-contribution"}},
            ]);
            for (const id of order) {
                expect((await host.activate({plugin: id, entry: "main"})).status).toBe("activated");
                expect((await host.activate({plugin: id, entry: "other"})).status).toBe("activated");
                expect(state(host, `${id}.ok`).status).toBe("available");
            }
            results.push(host.contribution("commands", "same"));
        }
        expect(results[1]).toEqual(results[0]);
    });

    it("场景 5：rejected 不要求实现，accepted 与 pending 缺实现仍是 missing-implementation", async () => {
        const {host, root} = fixture();
        register(host, owner([point()], {}), root);
        register(host, {id: "source", entries: [
            entry("rejected", [declaration("bad", "commands", " ")], () => ({})),
            entry("accepted", [declaration("good")], () => ({})),
            entry("pending", [declaration("pending", "later")], () => ({})),
        ]}, root);
        expect((await host.activate({plugin: "source", entry: "rejected"})).status).toBe("activated");
        expect(await host.activate({plugin: "source", entry: "accepted"})).toMatchObject({status: "failed", stage: "output", reason: "missing-implementation", contribution: "good"});
        expect(state(host, "pending", "later").validation).toEqual({status: "pending", reason: "unknown-point"});
        expect(await host.activate({plugin: "source", entry: "pending"})).toMatchObject({status: "failed", stage: "output", reason: "missing-implementation", contribution: "pending"});
    });

    it("场景 6：拥有者先激活，第二接收者 prepare 失败使贡献方失败，第一接收者暂存项撤回且不可调用", async () => {
        const {host, root} = fixture();
        const events: string[] = [];
        let prepared: ContributionHandle | undefined;
        const commands: ContributionReceiver = {
            ...recordingReceiver(events),
            prepare: (handle) => {prepared = handle; events.push(`prepare:${handle.id}`); return handle.id;},
        };
        const views: ContributionReceiver = {
            ...recordingReceiver(events),
            prepare: (handle) => {events.push(`prepare:${handle.id}`); throw new Error("view prepare failed");},
        };
        register(host, owner([point(), point("views")], {commands, views}), root);
        expect((await host.activate({plugin: "owner", entry: "main"})).status).toBe("activated");
        register(host, source("source", [declaration("command"), declaration("view", "views")]), root);
        expect(await host.activate({plugin: "source", entry: "main"})).toMatchObject({status: "failed", stage: "prepare", reason: "receiver-prepare-failed", capability: "views", contribution: "view"});
        expect(events).toEqual(["prepare:command", "prepare:view", "revoke:command:activation-failed"]);
        expect(prepared?.published).toBe(false);
        expect(() => prepared!.implementation()).toThrow(PluginStateError);
        expect(state(host, "command").status).toBe("activation-failed");
        expect(host.entryState({plugin: "owner", entry: "main"})?.status).toBe("available");
    });

    it("场景 7：贡献方先发布等待接收者，跨两点按入口代次整批补交，单批失败逆序撤回并保留其它批", async () => {
        const {host, root} = fixture();
        const good = [declaration("good.command"), declaration("good.view", "views")];
        const bad = [declaration("bad.command"), declaration("bad.view", "views"), declaration("bad.last")];
        register(host, {id: "source", entries: [entry("good", good), entry("bad", bad)]}, root);
        await host.activate({plugin: "source", entry: "good"});
        await host.activate({plugin: "source", entry: "bad"});
        for (const item of [...good, ...bad]) {
            expect(state(host, item.id, item.capability)).toMatchObject({status: "available", delivery: {status: "waiting-receiver"}});
        }
        const events: string[] = [];
        const publishedDuringCallbacks: boolean[] = [];
        const receiver: ContributionReceiver = {
            prepare: (handle) => {
                events.push(`prepare:${handle.id}`);
                publishedDuringCallbacks.push(handle.published);
                if (handle.id === "bad.last") throw new Error("backfill prepare failed");
                return handle.id;
            },
            published: (handle) => {events.push(`published:${handle.id}`);},
            revoke: (handle, _prepared, reason) => {events.push(`revoke:${handle.id}:${reason}`);},
        };
        register(host, owner([point(), point("views")], {commands: receiver, views: receiver}), root);
        expect((await host.activate({plugin: "owner", entry: "main"})).status).toBe("activated");
        expect(events).toEqual([
            "prepare:good.command", "prepare:good.view", "published:good.command", "published:good.view",
            "prepare:bad.command", "prepare:bad.view", "prepare:bad.last",
            "revoke:bad.view:delivery-failed", "revoke:bad.command:delivery-failed",
        ]);
        expect(publishedDuringCallbacks.every((value) => !value)).toBe(true);
        for (const item of good) expect(state(host, item.id, item.capability)).toMatchObject({status: "available", delivery: {status: "delivered", receiver: {plugin: "owner", entry: "main", generation: 1}}});
        for (const item of bad) expect(state(host, item.id, item.capability)).toMatchObject({status: "available", delivery: {status: "delivery-failed", error: {name: "Error", message: "backfill prepare failed"}}});
        expect(host.entryState({plugin: "source", entry: "bad"})?.status).toBe("available");
        expect(host.diagnostics().filter((item) => item.reason === "backfill-failed" || item.reason === "delivery-failed").map((item) => item.reason)).toEqual(["delivery-failed", "backfill-failed"]);
    });

    it("场景 8：顶层声明逐条补交，无需激活贡献方，kind 为 plugin 且 implementation 抛 PluginStateError", async () => {
        const {host, root} = fixture();
        let activations = 0;
        register(host, {id: "source", contributions: [declaration("one", "metadata"), declaration("two", "metadata")], entries: [
            entry("main", [], () => {activations += 1; return {}; }),
        ]}, root);
        const events: string[] = [];
        const handles: ContributionHandle[] = [];
        const receiver: ContributionReceiver = {
            ...recordingReceiver(events),
            prepare: (handle) => {handles.push(handle); events.push(`prepare:${handle.id}`); return handle.id;},
        };
        register(host, owner([point("metadata", "none")], {metadata: receiver}), root);
        expect((await host.activate({plugin: "owner", entry: "main"})).status).toBe("activated");
        expect(events).toEqual(["prepare:one", "published:one", "prepare:two", "published:two"]);
        expect(activations).toBe(0);
        for (const handle of handles) {
            expect(handle).toMatchObject({kind: "plugin", entry: null, published: true});
            expect(() => handle.implementation()).toThrow(PluginStateError);
            expect(state(host, handle.id, "metadata").delivery.status).toBe("delivered");
        }
    });

    it("场景 9：拥有者先断开再释放产出，贡献方不受影响，新登记新代次补交且旧句柄不复活", async () => {
        const {host, root} = fixture();
        const ownerScope = child(root, "owner-1");
        const events: string[] = [];
        const handles: ContributionHandle[] = [];
        const output = {alive: true};
        const receiver: ContributionReceiver = {
            prepare: (handle) => {handles.push(handle); return handle.id;},
            published: (handle) => {events.push(`published:${handle.id}`);},
            revoke: (handle, _prepared, reason) => {events.push(`revoke:${handle.id}:${reason}:${output.alive}`);},
        };
        const definition = owner([point()], {commands: receiver});
        const firstDefinition: PluginDefinition = {...definition, entries: [{...definition.entries[0]!, provides: [ownerOutputKey], activate: () => ({
            receivers: {commands: receiver}, services: [provide(ownerOutputKey, output, (value) => {value.alive = false; events.push("release:output");})],
        })}]};
        register(host, source("source", [declaration("one")]), root);
        register(host, firstDefinition, ownerScope);
        await host.activate({plugin: "source", entry: "main"});
        await host.activate({plugin: "owner", entry: "main"});
        const oldHandle = handles[0]!;
        expect(oldHandle.implementation()).toBeTypeOf("function");
        expect((await ownerScope.close()).status).toBe("closed");
        expect(events).toEqual(["published:one", "revoke:one:receiver-closed:true", "release:output"]);
        expect(oldHandle.published).toBe(false);
        expect(() => oldHandle.implementation()).toThrow(PluginStateError);
        expect(state(host, "one")).toMatchObject({status: "available", validation: {status: "pending", reason: "unknown-point"}, delivery: {status: "waiting-receiver"}});
        expect(host.entryState({plugin: "source", entry: "main"})?.status).toBe("available");
        register(host, definition, child(root, "owner-2"));
        expect(state(host, "one").validation).toEqual({status: "accepted"});
        expect(await host.activate({plugin: "owner", entry: "main"})).toMatchObject({status: "activated", generation: 2});
        expect(handles).toHaveLength(2);
        expect(handles[1]?.published).toBe(true);
        expect(oldHandle.published).toBe(false);
        expect(state(host, "one").delivery).toEqual({status: "delivered", receiver: {plugin: "owner", entry: "main", generation: 2}});
    });

    it("场景 10：贡献方关闭逆序撤回各项，两边同时关闭也每条交付恰好撤回一次", async () => {
        for (const simultaneous of [false, true]) {
            const {host, root} = fixture();
            const sourceScope = child(root, "source");
            const ownerScope = child(root, "owner");
            const events: string[] = [];
            register(host, owner([point()], {commands: recordingReceiver(events)}), ownerScope);
            await host.activate({plugin: "owner", entry: "main"});
            register(host, source("source", [declaration("one"), declaration("two")]), sourceScope);
            await host.activate({plugin: "source", entry: "main"});
            events.length = 0;
            const closing = sourceScope.close();
            if (simultaneous) await Promise.all([closing, ownerScope.close()]);
            else expect((await closing).status).toBe("closed");
            expect(events).toHaveLength(2);
            expect(events[0]).toMatch(/^revoke:two:(?:scope-closed|receiver-closed)$/u);
            expect(events[1]).toMatch(/^revoke:one:(?:scope-closed|receiver-closed)$/u);
            if (!simultaneous) expect(events).toEqual(["revoke:two:scope-closed", "revoke:one:scope-closed"]);
            await Promise.all([sourceScope.close(), ownerScope.close()]);
            expect(events).toHaveLength(2);
        }
    });

    it("场景 11：挂起的补交与两个贡献方并发激活交错，同一接收者整批 prepare 仍不交错，published 不插进 prepare", async () => {
        const {host, root} = fixture();
        register(host, source("existing", [declaration("existing")]), root);
        await host.activate({plugin: "existing", entry: "main"});
        const events: string[] = [];
        const backfillStarted = Promise.withResolvers<void>();
        const releaseBackfill = Promise.withResolvers<void>();
        const aStarted = Promise.withResolvers<void>();
        const bStarted = Promise.withResolvers<void>();
        const receiver: ContributionReceiver = {
            prepare: async (handle) => {
                events.push(`prepare:start:${handle.id}`);
                if (handle.id === "existing") {backfillStarted.resolve(); await releaseBackfill.promise;}
                events.push(`prepare:end:${handle.id}`);
                return handle.id;
            },
            published: (handle) => {events.push(`published:${handle.id}`);},
        };
        register(host, owner([point()], {commands: receiver}), root);
        const activatingOwner = host.activate({plugin: "owner", entry: "main"});
        await backfillStarted.promise;
        const makeSource = (id: string, started: () => void) => {
            const current = source(id, [declaration(`${id}.one`), declaration(`${id}.two`)]);
            const activate = current.entries[0]!.activate;
            return {...current, entries: [{...current.entries[0]!, activate: (context: ActivationContext) => {started(); return activate(context);}}]};
        };
        register(host, makeSource("a", aStarted.resolve), root);
        register(host, makeSource("b", bStarted.resolve), root);
        const a = host.activate({plugin: "a", entry: "main"});
        const b = host.activate({plugin: "b", entry: "main"});
        try {
            await Promise.all([aStarted.promise, bStarted.promise]);
            expect(events).toEqual(["prepare:start:existing"]);
        } finally {
            releaseBackfill.resolve();
        }
        expect((await activatingOwner).status).toBe("activated");
        expect((await a).status).toBe("activated");
        expect((await b).status).toBe("activated");
        const prepares = events.filter((event) => event.startsWith("prepare:"));
        expect(prepares.slice(0, 2)).toEqual(["prepare:start:existing", "prepare:end:existing"]);
        const expectedBatch = (id: string) => [`prepare:start:${id}.one`, `prepare:end:${id}.one`, `prepare:start:${id}.two`, `prepare:end:${id}.two`];
        expect([prepares.slice(2, 6), prepares.slice(6, 10)].sort((left, right) => left[0]! < right[0]! ? -1 : 1)).toEqual([expectedBatch("a"), expectedBatch("b")]);
        let preparing: string | null = null;
        for (const event of events) {
            if (event.startsWith("prepare:start:")) preparing = event;
            else if (event.startsWith("prepare:end:")) preparing = null;
            else expect({event, preparing}).toEqual({event, preparing: null});
        }
        expect(events.filter((event) => event.startsWith("published:")).sort()).toEqual(["published:a.one", "published:a.two", "published:b.one", "published:b.two", "published:existing"]);
    });

    it("场景 12：结构错误整插件不登记，同点不同位置可接收，missing/undeclared receiver 是输出阶段失败", async () => {
        const badDefinitions: Array<{definition: PluginDefinition; reason: string}> = [
            {definition: {id: "bad", contributionPoints: [point("")], entries: [entry("main")]}, reason: "empty-id"},
            {definition: source("bad", [declaration("")]), reason: "empty-id"},
            {definition: {id: "bad", contributionPoints: [point()], entries: [{...entry("main"), receives: ["missing"]}]}, reason: "unknown-contribution-point"},
            {definition: {id: "bad", contributionPoints: [point()], entries: [{...entry("one"), receives: ["commands"]}, {...entry("two"), receives: ["commands"]}]}, reason: "duplicate-receiver"},
            {definition: {id: "bad", contributionPoints: [point(), point()], entries: [entry("main")]}, reason: "duplicate-contribution-point"},
        ];
        for (const {definition, reason} of badDefinitions) {
            const {host, root, assembly} = fixture();
            expect(host.register(definition, {scope: root})).toMatchObject({status: "rejected", rejections: [{reason}]});
            expect(host.catalog().plugins).toEqual([]);
            expect(assembly.report().entries).toEqual([]);
        }
        const {host, root} = fixture();
        register(host, {id: "owner", contributionPoints: [point()], entries: [
            {...entry("server"), receives: ["commands"]},
            {...entry("browser"), location: "browser", receives: ["commands"]},
        ]}, root);
        expect(host.register({...owner([point()], {}), id: "other"}, {scope: root})).toMatchObject({status: "rejected", rejections: [{reason: "duplicate-contribution-point"}]});
        expect(host.catalog().plugins.map((item) => item.id)).toEqual(["owner"]);
        for (const undeclared of [false, true]) {
            const current = fixture();
            register(current.host, owner([point()], {}, () => undeclared
                ? {receivers: {commands: {}, extra: {}}}
                : {}), current.root);
            expect(await current.host.activate({plugin: "owner", entry: "main"})).toMatchObject({status: "failed", stage: "output", reason: undeclared ? "undeclared-receiver" : "missing-receiver"});
        }
    });

    it("场景 13：拥有者受阻或激活失败都不是贡献方依赖，贡献方可用且等待接收者", async () => {
        for (const blocked of [true, false]) {
            const {host, root} = fixture();
            const definition = owner([point()], {}, () => {throw new Error("owner activation failed");});
            register(host, {...definition, entries: [{...definition.entries[0]!, dependencies: blocked ? [{key: blockerKey}] : []}]}, root);
            register(host, source("source", [declaration("one")]), root);
            expect(await host.activate({plugin: "owner", entry: "main"})).toMatchObject(blocked
                ? {status: "rejected", reason: "blocked", blocked: {reason: "missing-service"}}
                : {status: "failed", reason: "activation-threw"});
            expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
            expect(state(host, "one")).toMatchObject({status: "available", validation: {status: "accepted"}, delivery: {status: "waiting-receiver"}});
            expect(host.entryState({plugin: "source", entry: "main"})?.status).toBe("available");
        }
    });

    it("场景 11（发布通知）：贡献方发布时同一接收者上另一批的 prepare 还挂着，published 等那一批结束，不插进去", async () => {
        // 让 a 的交付分两轮：第二轮在后接上的接收者上挂起，b 趁这时占住共用接收者并挂在 prepare 里；
        // 再放行 a，它发布时 b 的 prepare 仍未结束。
        const runtime = createRuntimeInstance({location: "server", instanceId: "published-serial"});
        runtime.root.open();
        roots.push(runtime.root);
        const aPublished = Promise.withResolvers<void>();
        const host = createPluginHost(runtime, createServiceAssembly(runtime), {observer: {diagnosticRecorded: (diagnostic) => {
            if (diagnostic.stage === "publish" && diagnostic.reason === "published" && diagnostic.plugin === "a") aPublished.resolve();
        }}});
        const root = runtime.root;
        const events: string[] = [];
        const gates = new Map(["a.one", "a.late", "b.one"].map((id) => [id, {started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>()}]));
        const gated = async (id: string) => {
            const gate = gates.get(id);
            if (gate === undefined) return;
            gate.started.resolve();
            await gate.release.promise;
        };
        const shared: ContributionReceiver = {
            prepare: async (handle) => {events.push(`prepare:start:${handle.id}`); await gated(handle.id); events.push(`prepare:end:${handle.id}`);},
            published: (handle) => {events.push(`published:${handle.id}`);},
        };
        const late: ContributionReceiver = {prepare: (handle) => gated(handle.id)};
        register(host, {...owner([point("shared")], {shared}), id: "shared-owner"}, root);
        await host.activate({plugin: "shared-owner", entry: "main"});
        register(host, source("a", [declaration("a.one", "shared"), declaration("a.late", "late")]), root);
        register(host, source("b", [declaration("b.one", "shared")]), root);
        const gate = (id: string) => gates.get(id)!;
        const a = host.activate({plugin: "a", entry: "main"});
        await gate("a.one").started.promise;
        register(host, {...owner([point("late")], {late}), id: "late-owner"}, root);
        expect((await host.activate({plugin: "late-owner", entry: "main"})).status).toBe("activated");
        gate("a.one").release.resolve();
        await gate("a.late").started.promise;
        const b = host.activate({plugin: "b", entry: "main"});
        await gate("b.one").started.promise;
        gate("a.late").release.resolve();
        await aPublished.promise;
        gate("b.one").release.resolve();
        expect((await a).status).toBe("activated");
        expect((await b).status).toBe("activated");
        expect(events).toEqual(["prepare:start:a.one", "prepare:end:a.one", "prepare:start:b.one", "prepare:end:b.one", "published:a.one", "published:b.one"]);
    });

    it("发布前新接上的第二个接收者仍收到贡献，不漏交激活中的代次", async () => {
        const {host, root} = fixture();
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const first: ContributionReceiver = {prepare: async () => {started.resolve(); await gate.promise;}};
        const events: string[] = [];
        register(host, {...owner([point("first")], {first}), id: "first-owner"}, root);
        await host.activate({plugin: "first-owner", entry: "main"});
        register(host, source("source", [declaration("one", "first"), declaration("two", "second")]), root);
        const activating = host.activate({plugin: "source", entry: "main"});
        await started.promise;
        try {
            register(host, {...owner([point("second")], {second: recordingReceiver(events)}), id: "second-owner"}, root);
            expect((await host.activate({plugin: "second-owner", entry: "main"})).status).toBe("activated");
        } finally {
            gate.resolve();
        }
        expect((await activating).status).toBe("activated");
        expect(events).toEqual(["prepare:two", "published:two"]);
        expect(state(host, "two", "second").delivery).toMatchObject({status: "delivered", receiver: {plugin: "second-owner"}});
    });

    it("接收者关闭与贡献方 prepare 交错时不释放在途回调的产出，贡献方仍成功等待接收者", async () => {
        const {host, root} = fixture();
        const ownerScope = child(root, "owner");
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const events: string[] = [];
        const output = {alive: true};
        const receiver: ContributionReceiver = {
            prepare: async () => {events.push("prepare:start"); started.resolve(); await gate.promise; events.push(`prepare:end:${output.alive}`);},
            published: () => {events.push("published");},
            revoke: (_handle, _prepared, reason) => {events.push(`revoke:${reason}:${output.alive}`);},
        };
        const definition = owner([point()], {commands: receiver});
        register(host, {...definition, entries: [{...definition.entries[0]!, provides: [ownerOutputKey], activate: () => ({
            receivers: {commands: receiver}, services: [provide(ownerOutputKey, output, (value) => {value.alive = false; events.push("release");})],
        })}]}, ownerScope);
        await host.activate({plugin: "owner", entry: "main"});
        register(host, source("source", [declaration("one")]), root);
        const activating = host.activate({plugin: "source", entry: "main"});
        await started.promise;
        const closing = ownerScope.close();
        gate.resolve();
        expect((await activating).status).toBe("activated");
        expect((await closing).status).toBe("closed");
        expect(events).toEqual(["prepare:start", "prepare:end:true", "revoke:receiver-closed:true", "release"]);
        expect(state(host, "one")).toMatchObject({status: "available", delivery: {status: "waiting-receiver"}});
    });

    it("贡献方在补交 prepare 中关闭时不迟到 published，已准备项撤回后才释放贡献方产出", async () => {
        const {host, root} = fixture();
        const sourceScope = child(root, "source");
        const events: string[] = [];
        register(host, source("source", [declaration("one"), declaration("two")], (context) => {
            context.scope.register({kind: "source-output", label: "source", value: null, release: () => {events.push("release:source");}});
            return {contributions: {commands: {one: () => "one", two: () => "two"}}};
        }), sourceScope);
        await host.activate({plugin: "source", entry: "main"});
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const receiver: ContributionReceiver = {
            prepare: async (handle) => {events.push(`prepare:${handle.id}`); started.resolve(); await gate.promise; return handle.id;},
            published: (handle) => {events.push(`published:${handle.id}`);},
            revoke: (handle, _prepared, reason) => {events.push(`revoke:${handle.id}:${reason}`);},
        };
        register(host, owner([point()], {commands: receiver}), root);
        const activating = host.activate({plugin: "owner", entry: "main"});
        await started.promise;
        const closing = sourceScope.close();
        gate.resolve();
        expect((await activating).status).toBe("activated");
        expect((await closing).status).toBe("closed");
        expect(events).toEqual(["prepare:one", "revoke:one:scope-closed", "release:source"]);
    });

    it("不同贡献点和 id 中的分隔符不产生身份碰撞或误判重复", async () => {
        const {host, root} = fixture();
        register(host, owner([point("a:b"), point("a")], {}), root);
        register(host, source("source", [declaration("c", "a:b"), declaration("b:c", "a")]), root);
        expect(state(host, "c", "a:b").validation).toEqual({status: "accepted"});
        expect(state(host, "b:c", "a").validation).toEqual({status: "accepted"});
        expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
    });
    it("已交给 services 的拥有者产出仍在接收者撤回完成后才释放", async () => {
        const {host, root, assembly} = fixture();
        const ownerScope = child(root, "owner");
        const output = {alive: true};
        const events: string[] = [];
        const receiver: ContributionReceiver = {
            revoke: () => {events.push(`revoke:${output.alive}`);},
        };
        const definition = owner([point()], {commands: receiver});
        register(host, {...definition, entries: [{...definition.entries[0]!, provides: [ownerOutputKey], activate: () => ({
            receivers: {commands: receiver}, services: [provide(ownerOutputKey, output, (value) => {value.alive = false; events.push("release");})],
        })}]}, ownerScope);
        const consumerScope = child(ownerScope, "consumer");
        assembly.declare({id: "consumer", location: "server", scope: consumerScope, dependencies: [{key: ownerOutputKey}]});
        const result = await assembly.access("consumer").resolve(ownerOutputKey);
        expect(result.status).toBe("resolved");
        register(host, source("source", [declaration("one")]), root);
        await host.activate({plugin: "source", entry: "main"});
        expect((await ownerScope.close()).status).toBe("closed");
        expect(events).toEqual(["revoke:true", "release"]);
    });

});

describe("Spec runtime.plugins 输出 24：接收者的 published 回调", () => {
    /** 记录回调顺序，并在每个回调里试取实现：prepare 时还取不到，published 时取得到。 */
    function publishingReceiver(events: string[], options: {readonly throwOnPublished?: boolean; readonly prepared?: () => void; readonly gate?: Promise<void>} = {}): ContributionReceiver {
        const reachable = (handle: ContributionHandle): string => {
            try {
                return String((handle.implementation() as () => string)());
            } catch (error) {
                return error instanceof PluginStateError ? "未发布" : "其它错误";
            }
        };
        return {
            prepare: async (handle) => {
                events.push(`prepare:${handle.id}:${reachable(handle)}`);
                options.prepared?.();
                await options.gate;
            },
            published: (handle) => {
                events.push(`published:${handle.id}:${reachable(handle)}`);
                if (options.throwOnPublished === true) throw new Error("published 回调出错");
            },
            revoke: (handle, _prepared, reason) => {
                events.push(`revoke:${handle.id}:${reason}`);
            },
        };
    }

    it("激活事务：prepare 时实现还取不到，贡献方发布后每条通知一次，此时取得到；撤回之后不再通知", async () => {
        const {host, root} = fixture();
        const events: string[] = [];
        register(host, owner([point()], {commands: publishingReceiver(events)}), root);
        await host.activate({plugin: "owner", entry: "main"});
        const scope = child(root, "source");
        register(host, source("source", [declaration("a"), declaration("b")]), scope);
        expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
        expect(events).toEqual(["prepare:a:未发布", "prepare:b:未发布", "published:a:a", "published:b:b"]);
        await scope.close();
        expect(events.slice(4)).toEqual(["revoke:b:scope-closed", "revoke:a:scope-closed"]);
    });

    it("补交：贡献方先发布、拥有者后激活时，prepare 期间同样取不到实现，prepare 之后随即通知、取得到", async () => {
        const {host, root} = fixture();
        const events: string[] = [];
        register(host, source("source", [declaration("a")]), root);
        expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
        register(host, owner([point()], {commands: publishingReceiver(events)}), root);
        expect((await host.activate({plugin: "owner", entry: "main"})).status).toBe("activated");
        expect(events).toEqual(["prepare:a:未发布", "published:a:a"]);
    });

    it("验收 27：贡献方在 prepare 之后停止，已准备的项只收到 revoke，收不到 published", async () => {
        const {host, root} = fixture();
        const events: string[] = [];
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        register(host, owner([point()], {commands: publishingReceiver(events, {prepared: started.resolve, gate: gate.promise})}), root);
        await host.activate({plugin: "owner", entry: "main"});
        const scope = child(root, "source");
        register(host, source("source", [declaration("a")]), scope);
        const activating = host.activate({plugin: "source", entry: "main"});
        await started.promise;
        const closing = scope.close();
        gate.resolve();
        expect((await activating).status).not.toBe("activated");
        expect((await closing).status).toBe("closed");
        expect(events).toEqual(["prepare:a:未发布", "revoke:a:activation-stopped"]);
    });

    it("published 回调抛错：只记诊断，贡献照常可用", async () => {
        const {host, root, diagnostics} = fixture();
        const events: string[] = [];
        register(host, owner([point()], {commands: publishingReceiver(events, {throwOnPublished: true})}), root);
        await host.activate({plugin: "owner", entry: "main"});
        register(host, source("source", [declaration("a")]), root);
        expect((await host.activate({plugin: "source", entry: "main"})).status).toBe("activated");
        expect(state(host, "a")).toMatchObject({status: "available", delivery: {status: "delivered"}});
        expect(diagnostics.filter((diagnostic) => diagnostic.reason === "receiver-published-threw").map((diagnostic) => diagnostic.contribution)).toEqual(["a"]);
    });
});
