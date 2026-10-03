import {describe, expect, it} from "vitest";

import type {ContributionHandle, ContributionPointDefinition, PluginDefinition} from "../plugins/plugins";
import {provide} from "../plugins/plugins";
import {defineServiceKey} from "../services/services";

import {createApplication} from "./application";
import type {ApplicationManifest, HostContext} from "./application";

function host() {
    const controller = new AbortController();
    const context: HostContext = {identity: {location: "server", instanceId: "startup-contract"}, stopSignal: controller.signal, emergency: () => undefined};
    return {context, controller};
}

function manifest(overrides: Partial<ApplicationManifest>): ApplicationManifest {
    return {keys: [], plugins: [], gates: [], ...overrides};
}

function dependencyChain() {
    const trace: string[] = [];
    const bKey = defineServiceKey<{value: string}>("B/service");
    const cKey = defineServiceKey<{value: string}>("C/service");
    const aOutput = defineServiceKey<string>("A/output");
    const bOutput = defineServiceKey<string>("B/output");
    const cOutput = defineServiceKey<string>("C/output");
    const receiverKey = defineServiceKey<boolean>("command-owner/lifetime");
    const handles: ContributionHandle[] = [];
    const commandPoint: ContributionPointDefinition = {id: "commands", implementation: "required"};
    const commandOwner: PluginDefinition = {
        id: "command-owner",
        contributionPoints: [commandPoint],
        entries: [{
            id: "main",
            location: "server",
            receives: ["commands"],
            provides: [receiverKey],
            activate: () => ({services: [provide(receiverKey, true)], receivers: {commands: {
                prepare: (handle) => {
                    handles.push(handle);
                    return handle;
                },
                revoke: (handle) => void trace.push(`revoke:${handle.plugin}`),
            }}}),
        }],
    };
    const plugins: PluginDefinition[] = [
        {
            id: "A",
            entries: [{id: "main", location: "server", activationEvents: ["onStartup"], dependencies: [{key: receiverKey}, {key: bKey}], provides: [aOutput], contributions: [{capability: "commands", id: "A.run", declaration: {}}], activate: (context) => {
                expect(context.services.require(bKey).value).toBe("B:C");
                trace.push("activate:A");
                context.scope.register({kind: "owned", label: "A:first", value: "first", release: () => void trace.push("resource:A:first")});
                context.scope.register({kind: "owned", label: "A:second", value: "second", release: () => void trace.push("resource:A:second")});
                return {contributions: {commands: {"A.run": () => "A"}}, services: [provide(aOutput, "A", () => void trace.push("output:A"))]};
            }}]},
        {
            id: "B",
            entries: [{id: "main", location: "server", activationEvents: ["onStartup"], dependencies: [{key: receiverKey}, {key: cKey}], provides: [bKey, bOutput], contributions: [{capability: "commands", id: "B.run", declaration: {}}], activate: (context) => {
                const c = context.services.require(cKey);
                trace.push("activate:B");
                context.scope.register({kind: "owned", label: "B:first", value: "first", release: () => void trace.push("resource:B:first")});
                context.scope.register({kind: "owned", label: "B:second", value: "second", release: () => void trace.push("resource:B:second")});
                return {contributions: {commands: {"B.run": () => c.value}}, services: [
                    provide(bKey, {value: `B:${c.value}`}, () => void trace.push("service:B")),
                    provide(bOutput, "B", () => void trace.push("output:B")),
                ]};
            }}]},
        {
            id: "C",
            entries: [{id: "main", location: "server", activationEvents: ["onStartup"], dependencies: [{key: receiverKey}], provides: [cKey, cOutput], contributions: [{capability: "commands", id: "C.run", declaration: {}}], activate: (context) => {
                trace.push("activate:C");
                context.scope.register({kind: "owned", label: "C:first", value: "first", release: () => void trace.push("resource:C:first")});
                context.scope.register({kind: "owned", label: "C:second", value: "second", release: () => void trace.push("resource:C:second")});
                return {contributions: {commands: {"C.run": () => "C"}}, services: [
                    provide(cKey, {value: "C"}, () => void trace.push("service:C")),
                    provide(cOutput, "C", () => void trace.push("output:C")),
                ]};
            }}]},
        {id: "independent", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            trace.push("activate:independent");
            context.scope.register({kind: "owned", label: "independent", value: null, release: () => void trace.push("resource:independent")});
            return {};
        }}]},
        {id: "lazy", entries: [{id: "main", location: "server", activate: () => {
            trace.push("activate:lazy");
            return {};
        }}]},
    ];
    const application = createApplication(host().context, manifest({
        keys: [receiverKey, aOutput, bKey, bOutput, cKey, cOutput],
        plugins: [commandOwner, ...plugins],
        requiredPlugins: [commandOwner.id],
        observers: {plugins: {diagnosticRecorded: (diagnostic) => {
            if (diagnostic.reason === "published" || diagnostic.reason === "closed") {
                trace.push(`${diagnostic.reason}:${diagnostic.plugin}`);
            }
        }}},
    }));
    return {application, trace, handles};
}

describe("启动入口选择与失败", () => {
    it("验收 11：必需入口受阻使启动失败，不强行激活未选中的入口", async () => {
        const missing = defineServiceKey<string>("missing/service");
        const calls: string[] = [];
        const application = createApplication(host().context, manifest({keys: [missing], requiredPlugins: ["required"], plugins: [
            {id: "required", entries: [{id: "main", location: "server", dependencies: [{key: missing}], activate: () => {
                calls.push("required");
                return {};
            }}]},
            {id: "lazy", entries: [{id: "main", location: "server", activate: () => {
                calls.push("lazy");
                return {};
            }}]},
        ]}));
        expect(await application.startup).toMatchObject({status: "failed", gates: [], failures: [{category: "activation", source: "required/main", stage: "activate", required: true, reason: "blocked:missing-service", error: null}], stop: {status: "closed"}});
        expect(calls).toEqual([]);
        expect(application.plugins.entryState({plugin: "lazy", entry: "main"})).toMatchObject({generation: null, scopeId: null});
        expect(await application.admit({label: "rejected", run: () => "no"})).toEqual({status: "rejected", reason: "startup-failed"});
    });

    it("验收 11：非必需 onStartup 入口激活失败被记录，但启动仍可用", async () => {
        const application = createApplication(host().context, manifest({plugins: [{id: "optional", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: () => {
            throw new Error("optional activation failed");
        }}]}]}));
        expect(await application.startup).toMatchObject({status: "available", failures: [{category: "activation", required: false, source: "optional/main", stage: "activate", reason: "activate/activation-threw", error: {name: "Error", message: "optional activation failed"}}]});
        expect((await application.admit({label: "accepted", run: () => "ok"})).status).toBe("accepted");
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("验收 11：非必需 onStartup 入口受阻只记录失败，不调用激活", async () => {
        const missing = defineServiceKey<string>("missing/service");
        let called = false;
        const application = createApplication(host().context, manifest({keys: [missing], plugins: [{id: "optional", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], dependencies: [{key: missing}], activate: () => {
            called = true;
            return {};
        }}]}]}));
        expect(await application.startup).toMatchObject({status: "available", failures: [{category: "activation", required: false, source: "optional/main", reason: "blocked:missing-service"}]});
        expect(called).toBe(false);
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("验收 11：既非必需也无 onStartup 的入口保持 registered 与未分配代次", async () => {
        let called = false;
        const application = createApplication(host().context, manifest({plugins: [{id: "lazy", entries: [{id: "main", location: "server", activate: () => {
            called = true;
            return {};
        }}]}]}));
        expect(await application.startup).toMatchObject({status: "available", failures: []});
        expect(application.plugins.entryState({plugin: "lazy", entry: "main"})).toMatchObject({status: "registered", generation: null, scopeId: null, blocked: null});
        expect(called).toBe(false);
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("必需插件的全部本位置入口并发启动，外位置入口不激活，门禁在全部激活完成后执行", async () => {
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const calls: string[] = [];
        const application = createApplication(host().context, manifest({requiredPlugins: ["required"], plugins: [{id: "required", entries: [
            {id: "first", location: "server", activate: async () => {
                calls.push("first");
                await finish.promise;
                return {};
            }},
            {id: "second", location: "server", activate: () => {
                calls.push("second");
                started.resolve();
                return {};
            }},
            {id: "foreign", location: "browser", activationEvents: ["onStartup"], activate: () => {
                calls.push("foreign");
                return {};
            }},
        ]}], gates: [{id: "after-activation", kind: "check", check: () => {
            expect(application.plugins.entryState({plugin: "required", entry: "first"})?.status).toBe("available");
            expect(application.plugins.entryState({plugin: "required", entry: "second"})?.status).toBe("available");
            calls.push("gate");
        }}]}));
        await started.promise;
        try {
            expect(calls).toEqual(["first", "second"]);
            expect(application.status().admission).toBe("closed");
        } finally {
            finish.resolve();
        }
        expect(await application.startup).toMatchObject({status: "available", gates: [{id: "after-activation", status: "passed"}], failures: []});
        expect(calls).toEqual(["first", "second", "gate"]);
        expect(application.plugins.entryState({plugin: "required", entry: "foreign"})).toMatchObject({status: "foreign-location", generation: null});
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("并发激活失败按清单选择顺序记录，而不是按完成顺序", async () => {
        const laterStarted = Promise.withResolvers<void>();
        const completion: string[] = [];
        const application = createApplication(host().context, manifest({plugins: [{id: "optional", entries: [
            {id: "first", location: "server", activationEvents: ["onStartup"], activate: async () => {
                await laterStarted.promise;
                completion.push("first");
                throw new Error("first failed");
            }},
            {id: "second", location: "server", activationEvents: ["onStartup"], activate: () => {
                completion.push("second");
                laterStarted.resolve();
                throw new Error("second failed");
            }},
        ]}]}));
        const startup = await application.startup;
        expect(startup.status).toBe("available");
        expect(completion).toEqual(["second", "first"]);
        expect(startup.failures.map((failure) => failure.source)).toEqual(["optional/first", "optional/second"]);
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("必需插件登记被拒绝只报告一条 manifest 失败，不启动入口", async () => {
        const invalid = defineServiceKey<string>("foreign/service");
        let called = false;
        const application = createApplication(host().context, manifest({keys: [invalid], requiredPlugins: ["required"], plugins: [{id: "required", entries: [{id: "main", location: "server", provides: [invalid], activate: () => {
            called = true;
            return {services: [provide(invalid, "invalid")]};
        }}]}]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "failed", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "manifest", required: true, source: "required", stage: "register", reason: "plugin:main:foreign-service-id", error: null},
        ]);
        expect(called).toBe(false);
        expect(application.plugins.entryState({plugin: "required", entry: "main"})).toBeNull();
    });

    it("必需 activate 门禁引用被拒绝插件时报告 manifest 与独立 unknown-entry 门禁失败", async () => {
        const unregistered = defineServiceKey<string>("required/unregistered");
        let called = false;
        const application = createApplication(host().context, manifest({plugins: [{id: "required", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], provides: [unregistered], activate: () => {
            called = true;
            return {services: [provide(unregistered, "invalid")]};
        }}]}], gates: [{id: "required-entry", kind: "activate", entry: {plugin: "required", entry: "main"}}]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "failed", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "manifest", required: true, source: "required", stage: "register", reason: "plugin:main:unknown-service-key", error: null},
            {category: "gate", required: true, source: "required-entry", stage: "gate", reason: "activate:unknown-entry", error: null},
        ]);
        expect(startup.gates).toEqual([{id: "required-entry", required: true, status: "failed", reason: "activate:unknown-entry", error: null}]);
        expect(called).toBe(false);
        expect(application.plugins.entryState({plugin: "required", entry: "main"})).toBeNull();
    });

    it("必需插件仅含外位置入口且登记被拒绝时只报告一条 manifest 失败", async () => {
        const invalid = defineServiceKey<string>("foreign/service");
        let called = false;
        const application = createApplication(host().context, manifest({keys: [invalid], requiredPlugins: ["required"], plugins: [{id: "required", entries: [{id: "foreign", location: "browser", activationEvents: ["onStartup"], provides: [invalid], activate: () => {
            called = true;
            return {services: [provide(invalid, "invalid")]};
        }}]}]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "failed", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "manifest", required: true, source: "required", stage: "register", reason: "plugin:foreign:foreign-service-id", error: null},
        ]);
        expect(called).toBe(false);
        expect(application.plugins.entryState({plugin: "required", entry: "foreign"})).toBeNull();
    });

    it("必需插件没有入口且登记被拒绝时只报告一条 manifest 失败", async () => {
        const application = createApplication(host().context, manifest({requiredPlugins: ["required"], plugins: [{id: "required", entries: []}]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "failed", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "manifest", required: true, source: "required", stage: "register", reason: "plugin:no-entries", error: null},
        ]);
    });

    it("非必需 onStartup 插件登记被拒绝只报告一条 manifest 失败，不阻止应用启动", async () => {
        const unregistered = defineServiceKey<string>("optional/unregistered");
        let called = false;
        const application = createApplication(host().context, manifest({plugins: [{id: "optional", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], provides: [unregistered], activate: () => {
            called = true;
            return {services: [provide(unregistered, "invalid")]};
        }}]}]}));
        const startup = await application.startup;
        expect(startup.status).toBe("available");
        expect(startup.failures).toEqual([
            {category: "manifest", required: false, source: "optional", stage: "register", reason: "plugin:main:unknown-service-key", error: null},
        ]);
        expect(called).toBe(false);
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("清单缺少必需插件时报告 manifest 失败，不能因没有选中入口而放行", async () => {
        const application = createApplication(host().context, manifest({requiredPlugins: ["absent"]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "failed", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "manifest", required: true, source: "absent", stage: "register", reason: "plugin:unknown-plugin", error: null},
        ]);
    });

    it("必需启动激活中宿主停止时结果为 stopped，迟到资源释放且未选中入口不激活", async () => {
        const {context, controller} = host();
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const released: string[] = [];
        const output = defineServiceKey<string>("required/output");
        const application = createApplication(context, manifest({keys: [output], requiredPlugins: ["required"], plugins: [
            {id: "required", entries: [{id: "main", location: "server", provides: [output], activate: async (context) => {
                context.scope.register({kind: "owned", label: "required", value: "resource", release: (value) => void released.push(value)});
                started.resolve();
                await finish.promise;
                return {services: [provide(output, "output", (value) => void released.push(value))]};
            }}]},
            {id: "lazy", entries: [{id: "main", location: "server", activate: () => {
                throw new Error("unselected entry must stay lazy");
            }}]},
        ]}));
        await started.promise;
        controller.abort();
        finish.resolve();
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "stopped", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "stopped", required: true, source: context.identity.instanceId, stage: "gate", reason: "宿主在启动完成前要求停止", error: null},
        ]);
        expect(released.sort()).toEqual(["output", "resource"]);
        expect(application.plugins.entryState({plugin: "lazy", entry: "main"})).toMatchObject({generation: null});
        expect(await application.admit({label: "late", run: () => "no"})).toEqual({status: "rejected", reason: "closed"});
    });

    it("插件登记过程中生命周期观察者发停止后不启动入口", async () => {
        const {context, controller} = host();
        let called = false;
        const application = createApplication(context, manifest({
            requiredPlugins: ["required"],
            observers: {lifecycle: {phaseChanged: (change) => {
                if (change.to === "available") {
                    controller.abort();
                }
            }}},
            plugins: [{id: "required", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: () => {
                called = true;
                return {};
            }}]}],
            gates: [{id: "after-registration", kind: "check", check: () => {
                throw new Error("stopped gate must be skipped");
            }}],
        }));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "stopped", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "stopped", required: true, source: context.identity.instanceId, stage: "gate", reason: "宿主在启动完成前要求停止", error: null},
        ]);
        expect(called).toBe(false);
        expect(startup.gates).toEqual([{id: "after-registration", required: true, status: "skipped"}]);
        expect(application.plugins.entryState({plugin: "required", entry: "main"})).toMatchObject({generation: null, scopeId: null});
        expect(application.plugins.diagnostics().filter((diagnostic) => diagnostic.stage === "activate")).toEqual([]);
        expect(await application.admit({label: "late", run: () => "no"})).toEqual({status: "rejected", reason: "closed"});
    });

    it("同步启动入口触发宿主停止后不再触发后续启动入口", async () => {
        const {context, controller} = host();
        const calls: string[] = [];
        const application = createApplication(context, manifest({requiredPlugins: ["required"], plugins: [
            {id: "required", entries: [
                {id: "first", location: "server", activate: () => {
                    calls.push("first");
                    controller.abort();
                    return {};
                }},
                {id: "second", location: "server", activate: () => {
                    calls.push("second");
                    return {};
                }},
            ]},
            {id: "optional", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: () => {
                calls.push("optional");
                return {};
            }}]},
            {id: "lazy", entries: [{id: "main", location: "server", activate: () => {
                calls.push("lazy");
                return {};
            }}]},
        ], gates: [{id: "after-activation", kind: "check", check: () => void calls.push("gate")}]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "stopped", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "stopped", required: true, source: context.identity.instanceId, stage: "gate", reason: "宿主在启动完成前要求停止", error: null},
        ]);
        expect(startup.gates).toEqual([{id: "after-activation", required: true, status: "skipped"}]);
        expect(calls).toEqual(["first"]);
        expect(application.plugins.entryState({plugin: "required", entry: "second"})).toMatchObject({generation: null, scopeId: null});
        expect(application.plugins.entryState({plugin: "optional", entry: "main"})).toMatchObject({generation: null, scopeId: null});
        expect(application.plugins.entryState({plugin: "lazy", entry: "main"})).toMatchObject({generation: null, scopeId: null});
        expect(await application.admit({label: "late", run: () => "no"})).toEqual({status: "rejected", reason: "closed"});
    });

    it("宿主截止先于启动激活收口时结果为 stopped，接纳按 stopping 拒绝", async () => {
        const {context, controller} = host();
        const deadline = new AbortController();
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const released: string[] = [];
        const application = createApplication({...context, stopDeadline: () => deadline.signal}, manifest({requiredPlugins: ["required"], plugins: [{id: "required", entries: [{id: "main", location: "server", activate: async (activation) => {
            activation.scope.register({kind: "owned", label: "required", value: "resource", release: (value) => void released.push(value)});
            started.resolve();
            await finish.promise;
            return {};
        }}]}]}));
        await started.promise;
        try {
            controller.abort();
            deadline.abort();
            const startup = await application.startup;
            expect(startup).toMatchObject({status: "stopped", stop: {status: "incomplete", reason: "deadline"}});
            expect(startup.failures).toEqual([
                {category: "stopped", required: true, source: context.identity.instanceId, stage: "gate", reason: "宿主在启动完成前要求停止", error: null},
            ]);
            expect(application.status()).toMatchObject({phase: "stopping", admission: "closed"});
            expect(await application.admit({label: "late", run: () => "no"})).toEqual({status: "rejected", reason: "stopping"});
        } finally {
            finish.resolve();
            expect(await application.recover()).toEqual({status: "closed"});
        }
        expect(released).toEqual(["resource"]);
    });

    it("必需启动激活失败后宿主停止仍返回 stopped，并保留真实激活失败", async () => {
        const {context, controller} = host();
        const application = createApplication(context, manifest({requiredPlugins: ["required"], plugins: [{id: "required", entries: [{id: "main", location: "server", activate: () => {
            throw new Error("required activation failed");
        }}]}], gates: [{id: "host-stop", kind: "check", check: () => controller.abort()}]}));
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "stopped", stop: {status: "closed"}});
        expect(startup.failures).toEqual([
            {category: "activation", required: true, source: "required/main", stage: "activate", reason: "activate/activation-threw", error: {name: "Error", message: "required activation failed"}},
            {category: "stopped", required: true, source: context.identity.instanceId, stage: "gate", reason: "宿主在启动完成前要求停止", error: null},
        ]);
        expect(startup.gates).toEqual([{id: "host-stop", required: true, status: "passed"}]);
        expect(await application.admit({label: "late", run: () => "no"})).toEqual({status: "rejected", reason: "closed"});
    });

    it("必需入口抛错时失败阶段被保留，已成功的启动入口随应用有序停止", async () => {
        const released: string[] = [];
        const called: string[] = [];
        const output = defineServiceKey<string>("healthy/output");
        const application = createApplication(host().context, manifest({keys: [output], requiredPlugins: ["required"], plugins: [
            {id: "required", entries: [{id: "main", location: "server", activate: (context) => {
                context.scope.register({kind: "owned", label: "failed", value: "failed-resource", release: (value) => void released.push(value)});
                throw new Error("required activation failed");
            }}]},
            {id: "healthy", entries: [{id: "main", location: "server", activationEvents: ["onStartup"], provides: [output], activate: () => {
                called.push("healthy");
                return {services: [provide(output, "healthy-output", (value) => void released.push(value))]};
            }}]},
            {id: "lazy", entries: [{id: "main", location: "server", activate: () => {
                called.push("lazy");
                return {};
            }}]},
        ]}));
        expect(await application.startup).toMatchObject({status: "failed", failures: [{category: "activation", required: true, source: "required/main", stage: "activate", reason: "activate/activation-threw", error: {name: "Error", message: "required activation failed"}}], stop: {status: "closed"}});
        expect(called).toEqual(["healthy"]);
        expect(released.sort()).toEqual(["failed-resource", "healthy-output"]);
        expect(application.status()).toMatchObject({phase: "closed", admission: "closed"});
    });
});

describe("依赖链启动与关闭合同", () => {
    it("验收 12：清单 A B C 并发启动按依赖先调用 C B A，published 诊断顺序相同", async () => {
        const {application, trace} = dependencyChain();
        expect(await application.startup).toMatchObject({status: "available", failures: []});
        expect(trace.filter((item) => /^activate:[ABC]$/u.test(item))).toEqual(["activate:C", "activate:B", "activate:A"]);
        expect(trace.filter((item) => /^published:[ABC]$/u.test(item))).toEqual(["published:C", "published:B", "published:A"]);
        expect(await application.stop()).toEqual({status: "closed"});
    });

    it("验收 13：A 全部资源与贡献先于 B 服务释放，提供者服务先于其自身资源，入口按 A B C 关闭", async () => {
        const {application, trace, handles} = dependencyChain();
        expect((await application.startup).status).toBe("available");
        expect(handles.map((handle) => handle.plugin)).toEqual(["C", "B", "A"]);
        expect(handles.every((handle) => handle.published)).toBe(true);
        expect(application.plugins.contribution("commands", "A.run")).toMatchObject([{status: "available"}]);
        expect(await application.stop()).toEqual({status: "closed"});
        const before = (first: string, second: string) => {
            expect(trace.filter((item) => item === first)).toEqual([first]);
            expect(trace.filter((item) => item === second)).toEqual([second]);
            expect(trace.indexOf(first), `${first} before ${second}: ${trace.join(",")}`).toBeLessThan(trace.indexOf(second));
        };
        for (const resource of ["revoke:A", "output:A", "resource:A:first", "resource:A:second"]) {
            before(resource, "service:B");
            before(resource, "closed:A");
        }
        for (const resource of ["revoke:B", "output:B", "resource:B:first", "resource:B:second"]) {
            before("service:B", resource);
            before(resource, "service:C");
            before(resource, "closed:B");
        }
        for (const resource of ["revoke:C", "output:C", "resource:C:first", "resource:C:second"]) {
            before("service:C", resource);
            before(resource, "closed:C");
        }
        before("revoke:A", "output:A");
        before("revoke:B", "output:B");
        before("revoke:C", "output:C");
        before("closed:A", "service:B");
        before("closed:B", "service:C");
        expect(trace.filter((item) => /^published:[ABC]$/u.test(item))).toEqual(["published:C", "published:B", "published:A"]);
        expect(trace.filter((item) => /^closed:[ABC]$/u.test(item))).toEqual(["closed:A", "closed:B", "closed:C"]);
        expect(handles.every((handle) => !handle.published)).toBe(true);
        expect(application.plugins.contribution("commands", "A.run")).toMatchObject([{status: "revoked"}]);
    });

    it("验收 14：每个激活代次各有一次 close-started 和 closed，懒入口没有关闭诊断", async () => {
        const {application} = dependencyChain();
        expect((await application.startup).status).toBe("available");
        expect(await application.stop()).toEqual({status: "closed"});
        expect(await application.stop()).toEqual({status: "closed"});
        const diagnostics = application.plugins.diagnostics();
        for (const plugin of ["A", "B", "C", "independent"]) {
            const own = diagnostics.filter((diagnostic) => diagnostic.plugin === plugin && diagnostic.entry === "main");
            expect(own.filter((diagnostic) => diagnostic.reason === "activation-started")).toMatchObject([{stage: "activate", generation: 1}]);
            expect(own.filter((diagnostic) => diagnostic.reason === "published")).toMatchObject([{stage: "publish", generation: 1}]);
            expect(own.filter((diagnostic) => diagnostic.reason === "close-started")).toMatchObject([{stage: "close", generation: 1}]);
            expect(own.filter((diagnostic) => diagnostic.reason === "closed")).toMatchObject([{stage: "close", generation: 1}]);
            const started = own.find((diagnostic) => diagnostic.reason === "close-started")!;
            const closed = own.find((diagnostic) => diagnostic.reason === "closed")!;
            expect(started.sequence).toBeLessThan(closed.sequence);
        }
        expect(diagnostics.filter((diagnostic) => diagnostic.plugin === "lazy")).toEqual([]);
        expect(application.plugins.entryState({plugin: "lazy", entry: "main"})).toMatchObject({generation: null});
    });
});
