import {describe, expect, it, vi} from "bun:test";

import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {LifecycleStateError} from "../lifecycle/lifecycle";
import type {PluginDefinition} from "../plugins/plugins";
import {provide} from "../plugins/plugins";
import {defineServiceKey} from "../services/services";

import {createApplication, createInstanceTable, stopTimeout} from "./application";
import type {ApplicationManifest, EmergencyReport, HostContext, StartupGate} from "./application";

const moduleDir = dirname(fileURLToPath(import.meta.url));

interface Clock {
    now(): number;
}

const clockKey = defineServiceKey<Clock>("clock");
const greeterKey = defineServiceKey<{greet(name: string): string}>("greeter/greeter");

function host(instanceId = "app-1", location: "server" | "browser" = "server") {
    const controller = new AbortController();
    const emergencies: EmergencyReport[] = [];
    const context: HostContext = {identity: {location, instanceId}, stopSignal: controller.signal, emergency: (report) => emergencies.push(report)};
    return {context, controller, emergencies};
}

function greeterPlugin(location: "server" | "browser" = "server", activate?: PluginDefinition["entries"][number]["activate"]): PluginDefinition {
    return {
        id: "greeter",
        entries: [
            {
                id: "main",
                location,
                dependencies: [{key: clockKey}],
                provides: [greeterKey],
                activate:
                    activate ??
                    ((context) => {
                        const clock = context.services.require(clockKey);
                        return {services: [provide(greeterKey, {greet: (name) => `hi ${name} @${clock.now()}`})]};
                    }),
            },
        ],
    };
}

function manifest(overrides: Partial<ApplicationManifest> & {readonly extraGates?: StartupGate[]; readonly releaseClock?: () => void} = {}): ApplicationManifest {
    return {
        keys: [clockKey, greeterKey],
        capabilities: [{id: "clock", key: clockKey, create: (): Clock => ({now: () => 1}), release: overrides.releaseClock}],
        plugins: [greeterPlugin()],
        gates: [{id: "greeter", kind: "activate", entry: {plugin: "greeter", entry: "main"}}, ...(overrides.extraGates ?? [])],
        ...overrides,
    };
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runtime.application 机制边界", () => {
    it("内核源码只使用同目录相对导入与三个机制入口，不 import 框架、进程、DOM 或产品领域", async () => {
        const sources = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
        expect(sources).toContain("application.ts");
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
            for (const specifier of specifiers) {
                expect(specifier, `${name} 导入了 ${specifier}`).toMatch(/^(?:\.\/[^/]+|\.\.\/(?:lifecycle\/lifecycle|services\/services|plugins\/plugins))$/u);
            }
            expect(code, `${name} 不得引用 process/window`).not.toMatch(/\b(?:process|window|document)\./u);
        }
    });
});

describe("启动与接纳", () => {
    it("清单只登记描述；必需门禁全部成功才开放接纳；并发接纳请求等待同一启动结果，不另起初始化", async () => {
        const create = vi.fn((): Clock => ({now: () => 42}));
        const {context} = host();
        const application = createApplication(context, manifest({capabilities: [{id: "clock", key: clockKey, create}]}));
        expect(application.status()).toMatchObject({phase: "creating", admission: "closed", startup: null});
        const [a, b] = await Promise.all([
            application.admit({label: "a", run: () => "a"}),
            application.admit({label: "b", run: () => "b"}),
        ]);
        expect(a.status).toBe("accepted");
        expect(b.status).toBe("accepted");
        expect(create).toHaveBeenCalledTimes(1);
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "available", gates: [{id: "greeter", status: "passed", required: true}], failures: []});
        expect(application.status()).toMatchObject({phase: "available", admission: "open"});
        if (a.status === "accepted") {
            expect(await a.operation.outcome).toEqual({status: "completed", value: "a"});
        }
    });

    it("清单里的机制观察者在任何插件激活前就收到生命周期与装配事件；观察者抛错不改变启动结果", async () => {
        const phases: string[] = [];
        const assemblyDiagnostics: string[] = [];
        const pluginDiagnostics: string[] = [];
        const {context} = host();
        const application = createApplication(
            context,
            manifest({
                extraGates: [{id: "missing", kind: "resolve", required: false, key: defineServiceKey("missing")}],
                observers: {
                    lifecycle: {phaseChanged: (change) => {
                        phases.push(`${change.scopeId}:${change.from}>${change.to}`);
                        throw new Error("观察者崩溃");
                    }},
                    services: {diagnosticRecorded: (diagnostic) => void assemblyDiagnostics.push(diagnostic.reason)},
                    plugins: {diagnosticRecorded: (diagnostic) => void pluginDiagnostics.push(diagnostic.reason)},
                },
            }),
        );
        const startup = await application.startup;
        expect(startup.status).toBe("available");
        // 首个事件是 greeter 激活作用域的创建，早于任何插件可调用；根作用域 open 也被记录。
        expect(phases.some((entry) => entry.endsWith(":creating>available"))).toBe(true);
        expect(phases.at(-1)).toMatch(/^scope-1:creating>available$/u);
        expect(assemblyDiagnostics).toContain("unknown-key");
        expect(pluginDiagnostics).toEqual(["activation-started", "published"]);
    });

    it("必需门禁失败：不接纳、紧急输出可见、已取得资源收口；可选门禁失败只报告，无关能力继续可用", async () => {
        const releaseClock = vi.fn();
        const {context, emergencies} = host();
        const failing = createApplication(
            context,
            manifest({
                releaseClock,
                extraGates: [
                    {id: "optional", kind: "check", required: false, check: () => {
                        throw new Error("可选检查失败");
                    }},
                    {id: "required", kind: "resolve", key: defineServiceKey("unknown")},
                ],
            }),
        );
        const startup = await failing.startup;
        expect(startup).toMatchObject({
            status: "failed",
            gates: [
                {id: "greeter", status: "passed"},
                {id: "optional", status: "failed", required: false, reason: "check:threw", error: {name: "Error", message: "可选检查失败"}},
                {id: "required", status: "failed", required: true, reason: "resolve:unknown-key"},
            ],
            stop: {status: "closed"},
        });
        expect(startup.failures.map((failure) => `${failure.source}:${failure.required}`)).toEqual(["optional:false", "required:true"]);
        expect(emergencies).toEqual([{instanceId: "app-1", stage: "startup", reason: "必需门禁失败，业务不接纳", detail: "required:resolve:unknown-key"}]);
        expect(releaseClock).toHaveBeenCalledTimes(1);
        expect(await failing.admit({label: "x", run: () => 1})).toEqual({status: "rejected", reason: "startup-failed"});
        expect(failing.status()).toMatchObject({phase: "closed", admission: "closed"});

        const {context: okContext} = host("app-2");
        const tolerant = createApplication(okContext, manifest({extraGates: [{id: "optional", kind: "check", required: false, check: () => {
            throw new Error("可选检查失败");
        }}]}));
        expect(await tolerant.startup).toMatchObject({status: "available", gates: [{id: "greeter", status: "passed"}, {id: "optional", status: "failed", required: false}]});
        expect((await tolerant.admit({label: "x", run: () => 1})).status).toBe("accepted");
    });

    it("清单被拒绝的插件是结构化失败：被必需门禁引用时启动失败，门禁本身报 unknown-entry", async () => {
        const unregisteredKey = defineServiceKey<string>("greeter/unregistered");
        const rejected: PluginDefinition = {id: "greeter", entries: [{id: "main", location: "server", provides: [unregisteredKey], activate: () => ({services: [provide(unregisteredKey, "x")]})}]};
        const {context} = host();
        const application = createApplication(context, manifest({plugins: [rejected]}));
        const startup = await application.startup;
        expect(startup.status).toBe("failed");
        expect(startup.failures[0]).toMatchObject({category: "manifest", required: true, source: "greeter", stage: "register", reason: "plugin:main:unknown-service-key"});
        expect(startup.gates).toEqual([{id: "greeter", required: true, status: "failed", reason: "activate:unknown-entry", error: null}]);
    });
});

describe("启动与关闭竞态", () => {
    it("初始化未完成时宿主要求停止：迟到完成不重开接纳，已取得资源释放一次，余下门禁跳过", async () => {
        const gate = Promise.withResolvers<void>();
        const releaseClock = vi.fn();
        const {context, controller} = host();
        const application = createApplication(
            context,
            manifest({
                releaseClock,
                plugins: [greeterPlugin("server", async (activation) => {
                    activation.services.require(clockKey);
                    await gate.promise;
                    return {services: [provide(greeterKey, {greet: (name) => name})]};
                })],
                extraGates: [{id: "after", kind: "check", check: () => undefined}],
            }),
        );
        await tick();
        controller.abort();
        gate.resolve();
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "stopped", stop: {status: "closed"}, gates: [{id: "greeter", status: "failed"}, {id: "after", status: "skipped"}]});
        expect(application.status()).toMatchObject({phase: "closed", admission: "closed"});
        expect(releaseClock).toHaveBeenCalledTimes(1);
        expect(await application.stop()).toEqual({status: "closed"});
        // 启动前被宿主停止不是启动失败：接纳拒绝原因按根作用域阶段报告。
        expect(await application.admit({label: "late", run: () => 1})).toEqual({status: "rejected", reason: "closed"});
    });

    it("停止进入后拒绝新业务，已接纳操作仍完成；依赖关闭失败则不报整实例 closed，重复停止观察同一结果；显式恢复才另起尝试", async () => {
        const {context, emergencies} = host();
        let failRelease = true;
        const application = createApplication(
            context,
            manifest({
                capabilities: [{id: "clock", key: clockKey, create: (): Clock => ({now: () => 1}), release: () => {
                    if (failRelease) {
                        throw new Error("clock 释放失败");
                    }
                }}],
            }),
        );
        await application.startup;
        const inFlight = Promise.withResolvers<string>();
        const admitted = await application.admit({label: "long", run: () => inFlight.promise});
        expect(admitted.status).toBe("accepted");
        const stopping = application.stop();
        await tick();
        expect(application.status().admission).toBe("closed");
        expect(await application.admit({label: "late", run: () => 1})).toEqual({status: "rejected", reason: "stopping"});
        inFlight.resolve("done");
        if (admitted.status === "accepted") {
            // 等待方立即得到 cancelled；执行方仍在存活依赖上跑完，关闭等它结算后才释放资源。
            expect(await admitted.operation.outcome).toEqual({status: "cancelled", reason: "scope-stopping"});
            expect(await admitted.operation.termination).toEqual({status: "completed"});
        }
        const stop = await stopping;
        // clock 由 services 的服务作用域持有：它释放失败留在 stopping，根作用域因未关闭的子作用域报 blocked。
        expect(stop).toMatchObject({status: "incomplete", reason: "blocked", report: {failedResources: [], unclosedChildren: [expect.any(String)]}});
        expect(await application.stop()).toBe(stop);
        expect(await application.stopped).toBe(stop);
        expect(application.status()).toMatchObject({phase: "stopping", stop});
        expect(emergencies.at(-1)).toEqual({instanceId: "app-1", stage: "stop", reason: "关闭未完成：blocked", detail: "failedResources=0 pendingReleases=0 unclosedChildren=1"});

        // 显式恢复：释放不再失败后，恢复级联到持有 clock 的服务作用域并完成关闭；之后 stop() 观察恢复结果。
        failRelease = false;
        const recovered = await application.recover();
        expect(recovered).toEqual({status: "closed"});
        expect(await application.stop()).toBe(recovered);
        expect(application.status()).toMatchObject({phase: "closed", stop: recovered});
        // 首次停止结算不因恢复改写。
        expect(await application.stopped).toBe(stop);
    });

    it("stopped 在宿主信号触发的停止结算后兑现；未停止的实例 recover 抛 LifecycleStateError", async () => {
        const {context, controller} = host();
        const application = createApplication(context, manifest());
        await application.startup;
        expect(() => application.recover()).toThrow(LifecycleStateError);
        controller.abort();
        expect(await application.stopped).toEqual({status: "closed"});
        expect(application.status()).toMatchObject({phase: "closed"});
    });

    it("宿主截止约束首次停止：释放挂起时停止结算为 incomplete(deadline)，挂起的释放不被重入，紧急输出一次", async () => {
        const hang = Promise.withResolvers<void>();
        const release = vi.fn(() => hang.promise);
        const {context, controller, emergencies} = host();
        const application = createApplication({...context, stopDeadline: stopTimeout(20)}, manifest({releaseClock: release}));
        await application.startup;
        controller.abort();
        const stop = await application.stopped;
        expect(stop).toMatchObject({status: "incomplete", reason: "deadline"});
        expect(application.status().phase).toBe("stopping");
        expect(emergencies.filter((report) => report.stage === "stop")).toHaveLength(1);
        expect(release).toHaveBeenCalledTimes(1);
        hang.resolve();
    });

    it("显式恢复加入在途停止时观察同一结果，不重复紧急输出", async () => {
        const hang = Promise.withResolvers<void>();
        const {context, emergencies} = host();
        const application = createApplication(context, manifest({releaseClock: () => hang.promise.then(() => {
            throw new Error("clock 释放失败");
        })}));
        await application.startup;
        const stopping = application.stop();
        await tick();
        const recovering = application.recover();
        hang.resolve();
        const [stop, recovered] = await Promise.all([stopping, recovering]);
        expect(stop.status).toBe("incomplete");
        expect(recovered).toEqual(stop);
        expect(emergencies.filter((report) => report.stage === "stop")).toHaveLength(1);
    });

    it("stopTimeout 只接受 1..2^31-1 的整数毫秒；超出定时器范围的值会被运行时缩成立即触发，必须拒绝", () => {
        for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
            expect(() => stopTimeout(invalid)).toThrow(TypeError);
        }
        expect(stopTimeout(2 ** 31 - 1)().aborted).toBe(false);
    });
});

describe("宿主实例表", () => {
    it("存活实例共享同一宿主对象；关闭后 id 退役不能再启动，新 id 可以启动，表不再返回已关闭实例", async () => {
        const table = createInstanceTable<{readonly application: ReturnType<typeof createApplication>}>();
        const create = vi.fn(() => ({application: createApplication(host("app-1").context, manifest())}));
        const first = table.start("app-1", create);
        expect(table.start("app-1", create)).toBe(first);
        expect(create).toHaveBeenCalledTimes(1);
        await first.application.startup;
        await first.application.stop();
        await tick();
        expect(table.get("app-1")).toBeNull();
        expect(() => table.start("app-1", create)).toThrow(TypeError);
        const second = table.start("app-2", () => ({application: createApplication(host("app-2").context, manifest())}));
        expect(table.get("app-2")).toBe(second);
        await second.application.stop();
    });

    it("停止未完成的实例保留在表中；之后恢复关闭时立即退役，不等下一次查询", async () => {
        const table = createInstanceTable<{readonly application: ReturnType<typeof createApplication>}>();
        let failRelease = true;
        const entry = table.start("app-1", () => ({application: createApplication(host("app-1").context, manifest({releaseClock: () => {
            if (failRelease) {
                throw new Error("clock 释放失败");
            }
        }}))}));
        await entry.application.startup;
        expect((await entry.application.stop()).status).toBe("incomplete");
        await tick();
        expect(table.get("app-1")).toBe(entry);
        failRelease = false;
        expect(await entry.application.recover()).toEqual({status: "closed"});
        await tick();
        expect(table.get("app-1")).toBeNull();
        expect(() => table.start("app-1", () => entry)).toThrow(TypeError);
    });
});

describe("检查门禁的服务访问", () => {
    it("check 门禁只能解析自己声明的依赖；未声明的键解析失败，声明了缺失键时门禁在检查前即失败", async () => {
        const seen: string[] = [];
        const {context} = host();
        const application = createApplication(
            context,
            manifest({
                extraGates: [
                    {id: "reads-clock", kind: "check", dependencies: [{key: clockKey}], check: async ({services}) => {
                        const clock = await services.resolve(clockKey);
                        seen.push(clock.status === "resolved" ? `clock:${clock.instance.now()}` : clock.reason);
                        const greeter = await services.resolve(greeterKey);
                        seen.push(greeter.status === "resolved" ? "greeter" : greeter.reason);
                    }},
                    {id: "missing-dependency", kind: "check", required: false, dependencies: [{key: defineServiceKey("nowhere")}], check: () => void seen.push("should-not-run")},
                ],
            }),
        );
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "available", gates: [{id: "greeter", status: "passed"}, {id: "reads-clock", status: "passed"}, {id: "missing-dependency", status: "failed", reason: "check:unknown-key"}]});
        expect(seen).toEqual(["clock:1", "undeclared-dependency"]);
    });
});
