import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {describe, expect, it, vi} from "bun:test";
import type {Mock} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {RuntimeInstance, RuntimeLocation, Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly, defineServiceKey} from "../services/services";
import type {ServiceAssembly} from "../services/services";

import {createPluginHost, PluginStateError, provide} from "./plugins";
import type {
    ActivationContext,
    ActivationOutput,
    ContributionHandle,
    ContributionReceiver,
    ContributionPointDefinition,
    PluginDefinition,
    PluginDiagnostic,
    PluginEntryDefinition,
    PluginHost,
    RegistrationRejectionReason,
    RevokeReason,
} from "./plugins";

const moduleDir = dirname(fileURLToPath(import.meta.url));

interface Clock {
    now(): number;
}

interface Logger {
    readonly lines: string[];
    log(line: string): void;
}

type Command = () => string;

const clockKey = defineServiceKey<Clock>("clock/clock");
const loggerKey = defineServiceKey<Logger>("clock/logger");
const unknownKey = defineServiceKey<unknown>("unknown");
const keys = [clockKey, loggerKey];
const receiverKey = defineServiceKey<boolean>("receivers/lifetime");

/** 等待事件循环检查点，不推进真实时间。 */
function tick(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    setImmediate(resolve);
    return promise;
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

type CommandHandle = ContributionHandle<{readonly title: string}, Command>;

interface RecordingReceiver extends ContributionReceiver<{readonly title: string}, Command, string> {
    readonly handles: Map<string, CommandHandle>;
    readonly revocations: Array<{readonly id: string; readonly reason: RevokeReason; readonly prepared: string}>;
    readonly prepare: Mock<(handle: CommandHandle) => string>;
    readonly commit: Mock<(handle: CommandHandle, prepared: string) => void>;
}

function recordingReceiver(hooks: {prepare?: (id: string) => void; commit?: (id: string) => void; revoke?: (id: string) => void} = {}): RecordingReceiver {
    const handles = new Map<string, ContributionHandle<{readonly title: string}, Command>>();
    const revocations: RecordingReceiver["revocations"] = [];
    return {
        handles,
        revocations,
        prepare: vi.fn((handle) => {
            hooks.prepare?.(handle.id);
            handles.set(handle.id, handle);
            return `${handle.id}#${handle.generation}`;
        }),
        commit: vi.fn((handle) => {
            hooks.commit?.(handle.id);
        }),
        revoke: (handle, prepared, reason) => {
            hooks.revoke?.(handle.id);
            revocations.push({id: handle.id, reason, prepared});
        },
    };
}

interface Host {
    readonly runtime: RuntimeInstance;
    readonly root: Scope;
    readonly assembly: ServiceAssembly;
    readonly host: PluginHost;
    readonly commands: RecordingReceiver;
    readonly views: RecordingReceiver;
    readonly diagnostics: PluginDiagnostic[];
}

async function setup(location: RuntimeLocation = "server", instanceId = `${location}-1`, receivers: {commands?: RecordingReceiver; views?: RecordingReceiver} = {}, connect = true): Promise<Host> {
    const runtime = createRuntimeInstance({location, instanceId});
    runtime.root.open();
    const assembly = createServiceAssembly(runtime, {keys: [...keys, receiverKey]});
    const commands = receivers.commands ?? recordingReceiver();
    const views = receivers.views ?? recordingReceiver();
    const diagnostics: PluginDiagnostic[] = [];
    const host = createPluginHost(runtime, assembly, {observer: {diagnosticRecorded: (diagnostic) => diagnostics.push(diagnostic)}});
    if (connect) {
        accepted(host, receiverOwner(location, {commands, views}), runtime.root);
        expect(await host.activate({plugin: "receivers", entry: "main"})).toMatchObject({status: "activated"});
    }
    return {runtime, root: runtime.root, assembly, host, commands, views, diagnostics};
}

function receiverOwner(location: RuntimeLocation, receivers: Readonly<Record<string, ContributionReceiver>>): PluginDefinition {
    const contributionPoints: ContributionPointDefinition<{readonly title: string}>[] = Object.keys(receivers).map((id) => ({
        id,
        implementation: "required",
        validate: ({declaration}) => declaration.title.trim() === "" ? "title 不能为空" : null,
    }));
    return {id: "receivers", contributionPoints, entries: [{
        id: "main", location, provides: [receiverKey], receives: Object.keys(receivers), activate: () => ({services: [provide(receiverKey, true)], receivers}),
    }]};
}

function openedChild(parent: Scope, label: string): Scope {
    const child = parent.createChild(label);
    child.open();
    return child;
}

/** 声明若干 commands 贡献的入口；每个命令实现记录自己被执行的次数。 */
function commandEntry(
    id: string,
    commandIds: ReadonlyArray<string>,
    options: Partial<Omit<PluginEntryDefinition, "id" | "contributions">> & {readonly executions?: Map<string, number>; readonly extra?: (context: ActivationContext) => Partial<ActivationOutput> | Promise<Partial<ActivationOutput>>} = {},
): PluginEntryDefinition {
    const executions = options.executions ?? new Map<string, number>();
    return {
        id,
        location: options.location ?? "server",
        dependencies: options.dependencies,
        provides: options.provides,
        contributions: commandIds.map((commandId) => ({capability: "commands", id: commandId, declaration: {title: commandId}})),
        activate:
            options.activate ??
            (async (context) => {
                const extra = (await options.extra?.(context)) ?? {};
                const commands: Record<string, Command> = {};
                for (const commandId of commandIds) {
                    commands[commandId] = () => {
                        executions.set(commandId, (executions.get(commandId) ?? 0) + 1);
                        return `${commandId}@${context.generation}`;
                    };
                }
                return {...extra, contributions: {commands, ...(extra.contributions ?? {})}};
            }),
    };
}

function plugin(id: string, ...entries: PluginEntryDefinition[]): PluginDefinition {
    return {id, entries};
}

function accepted(host: PluginHost, definition: PluginDefinition, scope: Scope): void {
    const result = host.register(definition, {scope});
    if (result.status !== "accepted") {
        throw new Error(`期望登记成功：${JSON.stringify(result.rejections)}`);
    }
}

function deferred<T>() {
    const {promise, resolve, reject} = Promise.withResolvers<T>();
    return {promise, resolve, reject};
}

describe("runtime.plugins 机制边界", () => {
    it("机制源码只使用同目录相对导入与 lifecycle/services 入口，不 import 框架、驱动或产品领域", async () => {
        const sources = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
        expect(sources).toContain("plugins.ts");
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const fromSpecifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
            const sideEffectSpecifiers = [...code.matchAll(/^\s*import\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
            for (const specifier of [...fromSpecifiers, ...sideEffectSpecifiers]) {
                expect(specifier, `${name} 导入了 ${specifier}`).toMatch(/^(?:\.\/[^/]+|\.\.\/lifecycle\/lifecycle|\.\.\/services\/services)$/u);
            }
            expect(code, `${name} 不得使用动态 import`).not.toMatch(/\bimport\s*\(/u);
        }
    });

    it("宿主只接受同一运行实例的装配", async () => {
        const a = await setup();
        const other = createRuntimeInstance({location: "server", instanceId: "server-2"});
        expect(() => createPluginHost(other, a.assembly, {})).toThrow(TypeError);
    });
});

describe("描述登记", () => {
    it("结构失败或重复插件 id 整体拒绝、报错可见、不留下部分服务声明", async () => {
        const {host, root, assembly, commands, diagnostics} = await setup("server", "registration", {}, false);
        accepted(host, plugin("a", commandEntry("main", ["a.run"])), root);
        const before = assembly.report().entries.length;
        const other = createRuntimeInstance({location: "server", instanceId: "server-9"});
        const closed = root.createChild("closed");
        void closed.close();

        const cases: Array<{definition: PluginDefinition; scope?: Scope; reason: RegistrationRejectionReason}> = [
            {definition: plugin(" "), reason: "empty-id"},
            {definition: plugin("empty"), reason: "no-entries"},
            {definition: plugin("a", commandEntry("again", ["a.other"])), reason: "duplicate-plugin"},
            {definition: plugin("dup", commandEntry("e", ["d.1"]), commandEntry("e", ["d.2"])), reason: "duplicate-entry"},
            {definition: plugin("key", commandEntry("e", [], {provides: [unknownKey]})), reason: "unknown-service-key"},
            {definition: plugin("self", commandEntry("e", [], {provides: [clockKey], dependencies: [{key: clockKey}]})), reason: "self-dependency"},
            {definition: plugin("foreign", commandEntry("e", [])), scope: other.root, reason: "foreign-scope"},
            {definition: plugin("dead", commandEntry("e", [])), scope: closed, reason: "scope-not-alive"},
        ];
        for (const item of cases) {
            const result = host.register(item.definition, {scope: item.scope ?? root});
            expect(result.status, item.reason).toBe("rejected");
            if (result.status === "rejected") {
                expect(result.rejections.map((rejection) => rejection.reason), item.reason).toContain(item.reason);
            }
        }
        expect(host.catalog().plugins.map((entry) => entry.id)).toEqual(["a"]);
        expect(assembly.report().entries.length).toBe(before);
        expect(diagnostics.filter((diagnostic) => diagnostic.stage === "register").length).toBeGreaterThanOrEqual(cases.length);
        expect(commands.prepare).not.toHaveBeenCalled();
    });

    it("登记不创建资源、不调用 activate；目录列出依赖、提供项与贡献描述；其它位置的入口只进描述", async () => {
        const {host, root, assembly} = await setup("server", "catalog", {}, false);
        const activate = vi.fn(async () => ({contributions: {commands: {"p.run": () => "run"}}, services: [provide(clockKey, {now: () => 1})]}));
        accepted(
            host,
            plugin(
                "clock",
                {...commandEntry("server", ["p.run"], {provides: [clockKey], dependencies: [{key: loggerKey, required: false}]}), activate},
                commandEntry("browser", ["p.open"], {location: "browser"}),
            ),
            root,
        );
        const [description] = host.catalog().plugins;
        expect(description).toMatchObject({id: "clock", scopeId: root.id});
        expect(description!.entries).toMatchObject([
            {
                entry: "server",
                location: "server",
                dependencies: [{key: "clock/logger", required: false}],
                provides: ["clock/clock"],
                contributions: [{capability: "commands", id: "p.run", declaration: {title: "p.run"}, status: "declared", reason: "not-activated"}],
                state: {status: "registered", generation: null},
            },
            {entry: "browser", location: "browser", contributions: [{id: "p.open", status: "declared"}], state: {status: "foreign-location"}},
        ]);
        expect(activate).not.toHaveBeenCalled();
        expect(assembly.report().entries.map((entry) => entry.id).sort()).toEqual(["plugin:clock/server@1", "plugin:clock/server@1:clock/clock"]);
        expect(assembly.providerState("plugin:clock/server@1:clock/clock")).toBe("unresolved");
        expect(host.contribution("commands", "p.open")).toMatchObject([{status: "declared", location: "browser"}]);
        expect(root.snapshot().resources).toEqual([]);
        expect(root.snapshot().children.length).toBe(1);
    });
});

describe("Spec 验收 1：描述先于实现", () => {
    it("解析尚未激活提供者的服务触发一次激活；两个并发解析与一次直接触发共享同一次激活，入口不等待自身提供项", async () => {
        const {host, root, assembly, commands} = await setup();
        const gate = deferred<void>();
        const activate = vi.fn(async (context: ActivationContext) => {
            await gate.promise;
            return {
                contributions: {commands: {"clock.show": () => `now=${context.generation}`}},
                services: [provide(clockKey, {now: () => 42})],
            };
        });
        accepted(host, plugin("clock", {...commandEntry("main", ["clock.show"], {provides: [clockKey]}), activate}), root);
        assembly.declare({id: "consumer", location: "server", scope: root, dependencies: [{key: clockKey}]});
        expect(assembly.report().entries.find((entry) => entry.id === "consumer")).toMatchObject({verdict: "usable"});

        const first = assembly.access("consumer").resolve(clockKey);
        const second = assembly.access("consumer").resolve(clockKey);
        const direct = host.activate({plugin: "clock", entry: "main"});
        await tick();
        expect(activate).toHaveBeenCalledTimes(1);
        expect(host.entryState({plugin: "clock", entry: "main"})).toMatchObject({status: "activating", generation: 1});
        expect(host.contribution("commands", "clock.show")).toMatchObject([{status: "activating"}]);
        gate.resolve();
        const [a, b, activation] = await Promise.all([first, second, direct]);
        expect(activation).toMatchObject({status: "activated", generation: 1});
        expect(a.status).toBe("resolved");
        expect(b.status).toBe("resolved");
        if (a.status === "resolved" && b.status === "resolved") {
            expect(a.instance).toBe(b.instance);
            expect(a.instance.now()).toBe(42);
        }
        expect(activate).toHaveBeenCalledTimes(1);
        expect(commands.prepare).toHaveBeenCalledTimes(1);
        expect(assembly.providerState("plugin:clock/main@2:clock/clock")).toBe("available");
    });
});

describe("Spec 验收 2：激活一次、执行两次", () => {
    it("两个消费者并发首次触发只激活一次、贡献只发布一次，两次调用各自独立执行", async () => {
        const executions = new Map<string, number>();
        const {host, root, commands} = await setup();
        const activate = vi.fn(commandEntry("main", ["p.run"], {executions}).activate);
        accepted(host, plugin("p", {...commandEntry("main", ["p.run"], {executions}), activate}), root);

        const [viaCommand, viaView] = await Promise.all([host.activate({plugin: "p", entry: "main"}), host.activate({plugin: "p", entry: "main"})]);
        expect(viaCommand).toMatchObject({status: "activated", generation: 1});
        expect(viaView).toEqual(viaCommand);
        expect(activate).toHaveBeenCalledTimes(1);
        expect(commands.prepare).toHaveBeenCalledTimes(1);
        expect(commands.commit).toHaveBeenCalledTimes(1);

        const handle = commands.handles.get("p.run")!;
        expect(handle.implementation()()).toBe("p.run@1");
        expect(host.contribution<unknown, Command>("commands", "p.run")).toMatchObject([{status: "available", generation: 1}]);
        expect(handle.implementation()()).toBe("p.run@1");
        expect(executions.get("p.run")).toBe(2);
        // 成功后同代次再次触发复用，不再调用 activate。
        expect(await host.activate({plugin: "p", entry: "main"})).toEqual(viaCommand);
        expect(activate).toHaveBeenCalledTimes(1);
    });

    it("单个等待方取消只结束自身等待；其它等待方正常取得能力，激活仍只发生一次", async () => {
        const gate = deferred<void>();
        const {host, root} = await setup();
        const activate = vi.fn(async () => {
            await gate.promise;
            return {contributions: {commands: {"p.run": () => "ok"}}};
        });
        accepted(host, plugin("p", {...commandEntry("main", ["p.run"]), activate}), root);
        const controller = new AbortController();
        const cancelled = host.activate({plugin: "p", entry: "main"}, {signal: controller.signal});
        const waiting = host.activate({plugin: "p", entry: "main"});
        await tick();
        controller.abort();
        expect(await cancelled).toEqual({status: "cancelled", plugin: "p", entry: "main"});
        expect(await isSettled(waiting)).toBe(false);
        gate.resolve();
        expect(await waiting).toMatchObject({status: "activated", generation: 1});
        expect(activate).toHaveBeenCalledTimes(1);
    });
});

describe("Spec 验收 3、8：入口独立与跨位置非原子", () => {
    it("同一定义在 server 与 browser 宿主分别激活；一处失败不阻止另一处可用，结果分别报告", async () => {
        const server = await setup("server");
        const browser = await setup("browser", "browser-1");
        const definition = plugin(
            "files",
            {
                ...commandEntry("server", ["files.index"]),
                activate: () => {
                    throw new Error("server 端索引失败: token=secret");
                },
            },
            commandEntry("browser", ["files.open"], {location: "browser"}),
        );
        accepted(server.host, definition, server.root);
        accepted(browser.host, definition, browser.root);

        const serverResult = await server.host.activate({plugin: "files", entry: "server"});
        const browserResult = await browser.host.activate({plugin: "files", entry: "browser"});
        expect(serverResult).toMatchObject({status: "failed", stage: "activate", reason: "activation-threw", error: {name: "Error"}});
        expect(browserResult).toMatchObject({status: "activated", generation: 1});
        expect(server.host.entryState({plugin: "files", entry: "server"})).toMatchObject({status: "failed"});
        expect(server.host.entryState({plugin: "files", entry: "browser"})).toMatchObject({status: "foreign-location"});
        expect(await server.host.activate({plugin: "files", entry: "browser"})).toMatchObject({status: "rejected", reason: "location-mismatch"});
        expect(browser.host.entryState({plugin: "files", entry: "browser"})).toMatchObject({status: "available"});
        expect(browser.host.contribution("commands", "files.open")).toMatchObject([{status: "available"}]);
    });

    it("宿主声明的运行位置：tui 入口只在 tui 实例装配，在 server 实例是 foreign-location", async () => {
        const server = await setup("server");
        const tui = await setup("tui", "tui-1");
        const definition = plugin("shell", commandEntry("terminal", ["shell.split"], {location: "tui"}));
        accepted(server.host, definition, server.root);
        accepted(tui.host, definition, tui.root);

        expect(server.host.entryState({plugin: "shell", entry: "terminal"})).toMatchObject({status: "foreign-location"});
        expect(await server.host.activate({plugin: "shell", entry: "terminal"})).toMatchObject({status: "rejected", reason: "location-mismatch"});
        expect(await tui.host.activate({plugin: "shell", entry: "terminal"})).toMatchObject({status: "activated", generation: 1});
        expect(tui.host.contribution("commands", "shell.split")).toMatchObject([{status: "available", location: "tui"}]);
    });

    it("同一位置的两个入口不共享激活状态", async () => {
        const {host, root} = await setup();
        const activateA = vi.fn(commandEntry("a", ["p.a"]).activate);
        const activateB = vi.fn(commandEntry("b", ["p.b"]).activate);
        accepted(host, plugin("p", {...commandEntry("a", ["p.a"]), activate: activateA}, {...commandEntry("b", ["p.b"]), activate: activateB}), root);
        expect(await host.activate({plugin: "p", entry: "a"})).toMatchObject({status: "activated"});
        expect(activateB).not.toHaveBeenCalled();
        expect(host.entryState({plugin: "p", entry: "b"})).toMatchObject({status: "registered"});
        expect(host.contribution("commands", "p.b")).toMatchObject([{status: "declared", reason: "not-activated"}]);
    });
});

describe("Spec 验收 4、7：失败隔离与普通关闭", () => {
    it("插件 A 中途失败时插件 B 已发布的贡献仍可用；A 的描述与失败原因保留，本次暂存项撤回，失败原因脱敏", async () => {
        const {host, root, commands, views, diagnostics} = await setup();
        accepted(host, plugin("b", commandEntry("main", ["b.run"])), root);
        expect(await host.activate({plugin: "b", entry: "main"})).toMatchObject({status: "activated"});
        accepted(
            host,
            plugin("a", {
                ...commandEntry("main", ["a.run"]),
                contributions: [
                    {capability: "commands", id: "a.run", declaration: {title: "a"}},
                    {capability: "views", id: "a.view", declaration: {title: "v"}},
                ],
                activate: () => ({contributions: {commands: {"a.run": () => "a"}, views: {"a.view": () => "view"}}}),
            }),
            root,
        );
        views.commit.mockImplementationOnce(() => {
            throw new Error("view 提交失败 password=hunter2");
        });
        const result = await host.activate({plugin: "a", entry: "main"});
        expect(result).toMatchObject({status: "failed", stage: "commit", reason: "receiver-commit-failed", capability: "views", contribution: "a.view"});
        expect(commands.revocations).toEqual([{id: "a.run", reason: "activation-failed", prepared: "a.run#1"}]);
        expect(views.revocations).toEqual([{id: "a.view", reason: "activation-failed", prepared: "a.view#1"}]);
        expect(() => commands.handles.get("a.run")!.implementation()).toThrow(PluginStateError);
        expect(host.contribution("commands", "a.run")).toMatchObject([{status: "activation-failed", failure: {reason: "receiver-commit-failed"}}]);
        expect(host.contribution("commands", "b.run")).toMatchObject([{status: "available"}]);
        expect(commands.handles.get("b.run")!.implementation()()).toBe("b.run@1");
        expect(host.catalog().plugins.map((description) => description.id).sort()).toEqual(["a", "b", "receivers"]);
        expect(host.entryState({plugin: "a", entry: "main"})).toMatchObject({status: "failed", closeout: "pending"});
        await tick();
        expect(host.entryState({plugin: "a", entry: "main"})).toMatchObject({status: "failed", closeout: "closed"});
        const failure = diagnostics.find((diagnostic) => diagnostic.reason === "receiver-commit-failed")!;
        expect(Object.keys(failure).sort()).toEqual(["capability", "contribution", "entry", "error", "generation", "instanceId", "location", "plugin", "reason", "sequence", "stage"]);
        expect(failure.error).toEqual({name: "Error", message: "view 提交失败 password=hunter2"});
        expect(JSON.stringify(failure)).not.toContain("implementation");
        // 失败稳定：再次触发得到同一结果，不自动重试。
        expect(await host.activate({plugin: "a", entry: "main"})).toEqual(result);
        expect(views.commit).toHaveBeenCalledTimes(1);
    });

    it("关闭操作级作用域撤回该实例已发布的实现并释放资源；描述保留并带不可用原因；重复关闭不重复副作用；根上的必需插件不受影响", async () => {
        const {host, root, commands} = await setup();
        accepted(host, plugin("base", commandEntry("main", ["base.run"])), root);
        expect(await host.activate({plugin: "base", entry: "main"})).toMatchObject({status: "activated"});
        const view = openedChild(root, "view");
        const release = vi.fn();
        accepted(
            host,
            plugin("viewer", {
                ...commandEntry("main", ["viewer.close"]),
                activate: (context) => {
                    context.scope.register({kind: "subscription", label: "events", value: "sub", release});
                    return {contributions: {commands: {"viewer.close": () => "closed"}}};
                },
            }),
            view,
        );
        expect(await host.activate({plugin: "viewer", entry: "main"})).toMatchObject({status: "activated", generation: 1});
        const handle = commands.handles.get("viewer.close")!;
        expect(handle.implementation()()).toBe("closed");

        const first = await view.close();
        expect(first.status).toBe("closed");
        expect(release).toHaveBeenCalledTimes(1);
        expect(commands.revocations).toEqual([{id: "viewer.close", reason: "scope-closed", prepared: "viewer.close#1"}]);
        expect(handle.published).toBe(false);
        expect(() => handle.implementation()).toThrow(PluginStateError);
        expect(host.contribution("commands", "viewer.close")).toMatchObject([{status: "revoked", generation: 1, reason: "scope-closed", declaration: {title: "viewer.close"}}]);
        expect(host.entryState({plugin: "viewer", entry: "main"})).toMatchObject({status: "closed", generation: 1, closeout: "closed"});
        expect(host.catalog().plugins.map((description) => description.id).sort()).toEqual(["base", "receivers", "viewer"]);

        expect(await view.close()).toEqual(first);
        expect(release).toHaveBeenCalledTimes(1);
        expect(commands.revocations.length).toBe(1);
        expect(host.contribution("commands", "base.run")).toMatchObject([{status: "available"}]);
        expect(commands.handles.get("base.run")!.implementation()()).toBe("base.run@1");
        expect(await host.activate({plugin: "viewer", entry: "main"})).toEqual({status: "rejected", plugin: "viewer", entry: "main", reason: "scope-closed"});
    });
});

describe("Spec 验收 5：迟到发布阻断与再激活边界", () => {
    it("激活等待期间作用域关闭：迟到的成功不发布、已登记资源收口；已关闭作用域拒绝再触发；重新启用基于新作用域产生新代次", async () => {
        const {host, root, commands} = await setup();
        const scope = openedChild(root, "project-1");
        const gate = deferred<void>();
        const release = vi.fn();
        const late = vi.fn();
        const definition = plugin("p", {
            ...commandEntry("main", ["p.run"]),
            activate: async (context) => {
                context.scope.register({kind: "conn", label: "db", value: "conn", release});
                await gate.promise;
                late();
                return {contributions: {commands: {"p.run": () => "late"}}};
            },
        });
        accepted(host, definition, scope);
        const activation = host.activate({plugin: "p", entry: "main"});
        await tick();
        const closing = scope.close();
        await tick();
        expect(await isSettled(closing)).toBe(false);
        gate.resolve();
        expect(await activation).toEqual({status: "stopped", plugin: "p", entry: "main", generation: 1});
        expect((await closing).status).toBe("closed");
        expect(late).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
        expect(commands.prepare).not.toHaveBeenCalled();
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "declared", reason: "scope-closed"}]);
        expect(host.entryState({plugin: "p", entry: "main"})).toMatchObject({status: "closed", generation: 1});
        expect(await host.activate({plugin: "p", entry: "main"})).toEqual({status: "rejected", plugin: "p", entry: "main", reason: "scope-closed"});

        // 同一插件在新作用域重新登记：新代次，旧代次身份不复用。
        const next = openedChild(root, "project-2");
        expect(host.register(definition, {scope: next}).status).toBe("accepted");
        gate.resolve();
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "activated", generation: 2});
        expect(commands.handles.get("p.run")!.generation).toBe(2);
        expect(host.catalog().plugins.map((description) => description.id)).toEqual(["p", "receivers"]);
        expect(host.catalog().plugins.find((description) => description.id === "p")).toMatchObject({scopeId: next.id});
    });

    it("已登记但从未激活的入口在作用域关闭后拒绝触发", async () => {
        const {host, root} = await setup();
        const scope = openedChild(root, "op");
        accepted(host, plugin("p", commandEntry("main", ["p.run"])), scope);
        await scope.close();
        expect(await host.activate({plugin: "p", entry: "main"})).toEqual({status: "rejected", plugin: "p", entry: "main", reason: "scope-closed"});
        expect(host.entryState({plugin: "p", entry: "main"})).toMatchObject({status: "closed", generation: null});
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "declared", reason: "scope-closed"}]);
    });
});

describe("Spec 验收 6：接收者五态", () => {
    it("描述已登记、实现待激活、实现可用、激活失败、已撤回五种结果可区分；缺失实现即失败，不产生空 handler", async () => {
        const {host, root, commands} = await setup();
        const gate = deferred<void>();
        accepted(
            host,
            plugin("p", {
                ...commandEntry("main", ["p.run"]),
                activate: async () => {
                    await gate.promise;
                    return {contributions: {commands: {"p.run": () => "ok"}}};
                },
            }),
            root,
        );
        const scope = openedChild(root, "op");
        accepted(host, plugin("empty", {...commandEntry("main", ["empty.run"]), activate: () => ({contributions: {}})}), scope);

        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "declared", reason: "not-activated"}]);
        const activation = host.activate({plugin: "p", entry: "main"});
        await tick();
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "activating", generation: 1}]);
        gate.resolve();
        await activation;
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "available", generation: 1}]);

        expect(await host.activate({plugin: "empty", entry: "main"})).toMatchObject({status: "failed", stage: "output", reason: "missing-implementation", capability: "commands", contribution: "empty.run"});
        expect(host.contribution("commands", "empty.run")).toMatchObject([{status: "activation-failed"}]);
        expect(commands.handles.has("empty.run")).toBe(false);

        // 撤回：在事务中止或关闭后才出现，且描述仍可查询。
        await scope.close();
        expect(host.contribution("commands", "empty.run")).toMatchObject([{status: "activation-failed", declaration: {title: "empty.run"}}]);
        await root.close();
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "revoked", reason: "scope-closed", declaration: {title: "p.run"}}]);
    });
});

describe("Spec 验收 9：两种作用域 × 两个 host 复用", () => {
    it.each([
        ["server", "root"],
        ["server", "operation"],
        ["browser", "root"],
        ["browser", "operation"],
    ] as const)("%s 位置、%s 作用域上得到相同可观察结果", async (location, level) => {
        const executions = new Map<string, number>();
        const {host, root, commands} = await setup(location, `${location}-${level}`);
        const scope = level === "root" ? root : openedChild(root, "operation");
        const dependencies = level === "root" ? [{key: receiverKey}] : [];
        const activate = vi.fn(commandEntry("main", ["p.run"], {executions, location}).activate);
        accepted(host, plugin("p", {...commandEntry("main", ["p.run"], {executions, location, dependencies}), activate}), scope);
        const [a, b] = await Promise.all([host.activate({plugin: "p", entry: "main"}), host.activate({plugin: "p", entry: "main"})]);
        expect(a).toEqual(b);
        expect(a).toMatchObject({status: "activated", generation: 1});
        expect(activate).toHaveBeenCalledTimes(1);
        const handle = commands.handles.get("p.run")!;
        handle.implementation()();
        handle.implementation()();
        expect(executions.get("p.run")).toBe(2);
        await scope.close();
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "revoked", reason: "scope-closed"}]);
        expect(commands.revocations).toEqual([{id: "p.run", reason: "scope-closed", prepared: "p.run#1"}]);
    });
});

describe("Spec 验收 10：重试前置收口", () => {
    it("失败后资源收口完成前 recover 不结算；收口完成后显式恢复产生新代次并成功", async () => {
        const {host, root, commands} = await setup();
        const releaseGate = deferred<void>();
        let attempts = 0;
        accepted(
            host,
            plugin("p", {
                ...commandEntry("main", ["p.run"]),
                activate: (context) => {
                    attempts += 1;
                    if (attempts === 1) {
                        context.scope.register({kind: "conn", label: "db", value: "conn", release: () => releaseGate.promise});
                        throw new Error("第一次失败");
                    }
                    return {contributions: {commands: {"p.run": () => `ok@${context.generation}`}}};
                },
            }),
            root,
        );
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "failed", generation: 1, reason: "activation-threw"});
        expect(host.entryState({plugin: "p", entry: "main"})).toMatchObject({status: "failed", closeout: "pending"});
        const recovering = host.recover({plugin: "p", entry: "main"});
        expect(await isSettled(recovering)).toBe(false);
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "failed", generation: 1});
        expect(attempts).toBe(1);
        releaseGate.resolve();
        expect(await recovering).toEqual({status: "reset", plugin: "p", entry: "main", generation: 1});
        expect(host.entryState({plugin: "p", entry: "main"})).toMatchObject({status: "registered"});
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "activated", generation: 2});
        expect(commands.handles.get("p.run")!.implementation()()).toBe("ok@2");
        expect(await host.recover({plugin: "p", entry: "main"})).toMatchObject({status: "not-failed", state: "available"});
    });

    it("经服务解析触发的失败也稳定；recover 同时重置提供者，之后解析得到新代次实例", async () => {
        const {host, root, assembly} = await setup();
        let attempts = 0;
        accepted(
            host,
            plugin("clock", {
                ...commandEntry("main", [], {provides: [clockKey]}),
                activate: () => {
                    attempts += 1;
                    if (attempts === 1) {
                        throw new Error("boot failed");
                    }
                    return {services: [provide(clockKey, {now: () => attempts})]};
                },
            }),
            root,
        );
        assembly.declare({id: "consumer", location: "server", scope: root, dependencies: [{key: clockKey}]});
        const first = await assembly.access("consumer").resolve(clockKey);
        expect(first).toMatchObject({status: "unavailable", reason: "initialization-failed", error: {name: "PluginStateError"}});
        expect(await assembly.access("consumer").resolve(clockKey)).toEqual(first);
        expect(await host.activate({plugin: "clock", entry: "main"})).toMatchObject({status: "failed", generation: 1});
        expect(assembly.providerState("plugin:clock/main@2:clock/clock")).toBe("failed");
        expect(await host.recover({plugin: "clock", entry: "main"})).toMatchObject({status: "reset"});
        expect(assembly.providerState("plugin:clock/main@2:clock/clock")).toBe("unresolved");
        const second = await assembly.access("consumer").resolve(clockKey);
        expect(second.status).toBe("resolved");
        if (second.status === "resolved") {
            expect(second.instance.now()).toBe(2);
        }
        expect(host.entryState({plugin: "clock", entry: "main"})).toMatchObject({status: "available", generation: 2});
    });
});

describe("Spec 验收 11：多接收者事务", () => {
    it("第二个接收者准备失败：第一个接收者的暂存项撤回且不可调用，其它插件仍可调用；成功路径全部接收者完成后才可调用", async () => {
        const order: string[] = [];
        const commands = recordingReceiver({prepare: (id) => order.push(`prepare:${id}`), commit: (id) => order.push(`commit:${id}`), revoke: (id) => order.push(`revoke:${id}`)});
        const views = recordingReceiver({prepare: (id) => order.push(`prepare:${id}`), commit: (id) => order.push(`commit:${id}`), revoke: (id) => order.push(`revoke:${id}`)});
        const {host, root} = await setup("server", "server-1", {commands, views});
        accepted(host, plugin("other", commandEntry("main", ["other.run"])), root);
        await host.activate({plugin: "other", entry: "main"});
        order.length = 0;

        const twoReceivers = (id: string): PluginEntryDefinition => ({
            id: "main",
            location: "server",
            contributions: [
                {capability: "commands", id: `${id}.run`, declaration: {title: "run"}},
                {capability: "views", id: `${id}.view`, declaration: {title: "view"}},
            ],
            activate: () => ({contributions: {commands: {[`${id}.run`]: () => "run"}, views: {[`${id}.view`]: () => "view"}}}),
        });
        accepted(host, plugin("a", twoReceivers("a")), root);
        views.prepare.mockImplementationOnce((handle) => {
            order.push(`prepare:${handle.id}`);
            throw new Error("view 准备失败");
        });
        expect(await host.activate({plugin: "a", entry: "main"})).toMatchObject({status: "failed", stage: "prepare", reason: "receiver-prepare-failed", capability: "views"});
        expect(order).toEqual(["prepare:a.run", "prepare:a.view", "revoke:a.run"]);
        expect(() => commands.handles.get("a.run")!.implementation()).toThrow(PluginStateError);
        expect(host.contribution("commands", "a.run")).toMatchObject([{status: "activation-failed"}]);
        expect(host.contribution("views", "a.view")).toMatchObject([{status: "activation-failed"}]);
        expect(commands.handles.get("other.run")!.implementation()()).toBe("other.run@1");

        order.length = 0;
        accepted(host, plugin("b", twoReceivers("b")), root);
        // 在回调里赋值，用数组收集，避免控制流分析把局部变量收窄成初始值。
        const visibleAtCommit: boolean[] = [];
        views.commit.mockImplementationOnce((handle) => {
            order.push(`commit:${handle.id}`);
            visibleAtCommit.push(commands.handles.get("b.run")!.published || handle.published);
        });
        expect(await host.activate({plugin: "b", entry: "main"})).toMatchObject({status: "activated"});
        expect(order).toEqual(["prepare:b.run", "prepare:b.view", "commit:b.run", "commit:b.view"]);
        expect(visibleAtCommit).toEqual([false]);
        expect(commands.handles.get("b.run")!.implementation()()).toBe("run");
        expect(views.handles.get("b.view")!.implementation()()).toBe("view");
    });
});

describe("提供项与依赖协作", () => {
    it("必需依赖缺失时入口受阻且不消耗代次，依赖可用后经 require 取得，实例与借用随激活作用域", async () => {
        const {host, root, assembly} = await setup();
        const activate = vi.fn((context: ActivationContext) => {
            context.services.require(clockKey).now();
            return {contributions: {commands: {"p.run": () => "ok"}}};
        });
        accepted(host, plugin("p", {...commandEntry("main", ["p.run"], {dependencies: [{key: clockKey}]}), activate}), root);
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "rejected", reason: "blocked", blocked: {reason: "missing-service", key: "clock/clock", path: ["p/main"]}});
        expect(activate).not.toHaveBeenCalled();

        const releaseClock = vi.fn();
        assembly.declare({id: "clock", key: clockKey, location: "server", scope: root, create: () => ({now: () => 7}), release: releaseClock});
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "activated", generation: 1});
        expect(activate).toHaveBeenCalledTimes(1);
        await root.close();
        expect(releaseClock).toHaveBeenCalledTimes(1);
    });

    it("提供项实例交付给 services 后随本代次关闭，只释放一次；旧绑定 stale；产出未声明的键即失败", async () => {
        const {host, root, assembly} = await setup();
        const release = vi.fn();
        const scope = openedChild(root, "op");
        accepted(host, plugin("clock", {...commandEntry("main", [], {provides: [clockKey]}), activate: () => ({services: [provide(clockKey, {now: () => 1}, release)]})}), scope);
        assembly.declare({id: "consumer", location: "server", scope, dependencies: [{key: clockKey}]});
        const resolved = await assembly.access("consumer").resolve(clockKey);
        expect(resolved.status).toBe("resolved");
        await scope.close();
        expect(release).toHaveBeenCalledTimes(1);
        if (resolved.status === "resolved") {
            expect(resolved.binding.stale).toBe(true);
        }
        expect(host.entryState({plugin: "clock", entry: "main"})).toMatchObject({status: "closed"});

        accepted(host, plugin("extra", {...commandEntry("main", []), activate: () => ({services: [provide(loggerKey, {lines: [], log: () => undefined})]})}), root);
        expect(await host.activate({plugin: "extra", entry: "main"})).toMatchObject({status: "failed", stage: "output", reason: "undeclared-service", key: "clock/logger"});
    });

    it("提供项释放失败不被标记为已释放：交付给 services 与未交付两条路径都在显式恢复时重试，成功后不再重复", async () => {
        const {host, root, assembly} = await setup();
        const attempts = {adopted: 0, unadopted: 0};
        let fail = true;
        const failingOnce = (label: "adopted" | "unadopted") => () => {
            attempts[label] += 1;
            if (fail) {
                throw new Error(`${label} 释放失败`);
            }
        };
        const scope = openedChild(root, "op");
        accepted(host, plugin("clock", {
            ...commandEntry("main", [], {provides: [clockKey, loggerKey]}),
            activate: () => ({services: [
                provide(clockKey, {now: () => 1}, failingOnce("adopted")),
                provide(loggerKey, {lines: [], log: () => undefined}, failingOnce("unadopted")),
            ]}),
        }), scope);
        assembly.declare({id: "consumer", location: "server", scope, dependencies: [{key: clockKey}]});
        expect((await assembly.access("consumer").resolve(clockKey)).status).toBe("resolved");
        expect((await scope.close()).status).toBe("incomplete");
        expect(attempts).toEqual({adopted: 1, unadopted: 1});
        fail = false;
        expect((await scope.recover()).status).toBe("closed");
        expect(attempts).toEqual({adopted: 2, unadopted: 2});
        expect((await scope.recover()).status).toBe("closed");
        expect(attempts).toEqual({adopted: 2, unadopted: 2});
    });

    it("三层服务依赖的最下游消费者释放失败后，一次根恢复完成整条插件级联", async () => {
        const runtime = createRuntimeInstance({location: "server", instanceId: "three-level-recovery"});
        runtime.root.open();
        const aKey = defineServiceKey<{readonly name: string}>("cascade-a/a");
        const bKey = defineServiceKey<{readonly name: string}>("cascade-b/b");
        const cKey = defineServiceKey<{readonly name: string}>("cascade-c/c");
        const assembly = createServiceAssembly(runtime, {keys: [aKey, bKey, cKey]});
        const host = createPluginHost(runtime, assembly, {});
        let downstreamReleases = 0;
        const releaseDownstream = vi.fn(() => {
            downstreamReleases += 1;
            if (downstreamReleases === 1) {
                throw new Error("最下游消费者释放失败");
            }
        });

        accepted(host, plugin("cascade-a", {
            id: "main",
            location: "server",
            provides: [aKey],
            activate: () => ({services: [provide(aKey, {name: "a"})]}),
        }), runtime.root);
        accepted(host, plugin("cascade-b", {
            id: "main",
            location: "server",
            dependencies: [{key: aKey}],
            provides: [bKey],
            activate: () => ({services: [provide(bKey, {name: "b"})]}),
        }), runtime.root);
        accepted(host, plugin("cascade-c", {
            id: "main",
            location: "server",
            dependencies: [{key: bKey}],
            provides: [cKey],
            activate: async (context) => {
                const dependency = await context.services.resolve(bKey);
                if (dependency.status !== "resolved") {
                    throw new Error(`依赖 b 不可用：${dependency.reason}`);
                }
                context.scope.register({
                    kind: "downstream-consumer",
                    label: "cascade-c",
                    value: null,
                    dependsOn: [dependency.binding.dependency],
                    release: releaseDownstream,
                });
                return {services: [provide(cKey, {name: "c"})]};
            },
        }), runtime.root);

        await expect(host.activate({plugin: "cascade-a", entry: "main"})).resolves.toMatchObject({status: "activated"});
        await expect(host.activate({plugin: "cascade-b", entry: "main"})).resolves.toMatchObject({status: "activated"});
        await expect(host.activate({plugin: "cascade-c", entry: "main"})).resolves.toMatchObject({status: "activated"});

        await expect(runtime.root.close()).resolves.toMatchObject({status: "incomplete", reason: "blocked"});
        expect(releaseDownstream).toHaveBeenCalledTimes(1);
        await expect(runtime.root.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(releaseDownstream).toHaveBeenCalledTimes(2);
        expect(host.entryState({plugin: "cascade-a", entry: "main"})).toMatchObject({status: "closed"});
        expect(host.entryState({plugin: "cascade-b", entry: "main"})).toMatchObject({status: "closed"});
        expect(host.entryState({plugin: "cascade-c", entry: "main"})).toMatchObject({status: "closed"});
    });

    it("观察者异常不影响机制；接收者 revoke 抛错只记诊断", async () => {
        const runtime = createRuntimeInstance({location: "server", instanceId: "server-obs"});
        runtime.root.open();
        const assembly = createServiceAssembly(runtime, {keys: [...keys, receiverKey]});
        const commands = recordingReceiver();
        commands.revoke = () => {
            throw new Error("revoke 崩溃");
        };
        const host = createPluginHost(runtime, assembly, {
            observer: {
                diagnosticRecorded: () => {
                    throw new Error("观察者崩溃");
                },
            },
        });
        accepted(host, receiverOwner("server", {commands}), runtime.root);
        expect((await host.activate({plugin: "receivers", entry: "main"})).status).toBe("activated");
        accepted(host, plugin("p", commandEntry("main", ["p.run"])), runtime.root);
        expect(await host.activate({plugin: "p", entry: "main"})).toMatchObject({status: "activated"});
        expect((await runtime.root.close()).status).toBe("closed");
        expect(host.diagnostics().map((diagnostic) => diagnostic.reason)).toContain("receiver-revoke-threw");
        expect(host.contribution("commands", "p.run")).toMatchObject([{status: "revoked"}]);
    });
});
