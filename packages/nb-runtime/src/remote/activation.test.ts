import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {createApplication, createChildInstances} from "../application/application";
import type {Application} from "../application/application";
import type {RuntimeClock} from "../lifecycle/lifecycle";
import {ManualClock} from "../lifecycle/testing/manual-clock";
import type {ActivationContext, PluginDefinition, PluginDiagnostic} from "../plugins/plugins";

import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote} from "./remote";
import type {InstanceDescriptor, RemoteNode, RemoteResult} from "./remote";
import {createLinkPair} from "./testing/in-process";

const Empty = Type.Object({}, {additionalProperties: false});
const serviceA = defineRemoteService({id: "demo.a/a", version: 1, provider: "server", callers: ["browser", "server", "project"], methods: {ping: {input: Empty, output: Type.String(), effect: "read"}}});
const serviceB = defineRemoteService({id: "demo.b/b", version: 1, provider: "project", callers: ["browser", "server", "project"], methods: {ping: {input: Empty, output: Type.String(), effect: "read"}, wait: {input: Empty, output: Type.String(), effect: "read"}}});

interface Instance {
    readonly app: Application;
    readonly node: RemoteNode;
    readonly diagnostics: PluginDiagnostic[];
}

async function start(descriptor: InstanceDescriptor, plugins: ReadonlyArray<PluginDefinition>, clock: RuntimeClock, maxActivationCallMs?: number, bind?: {readonly project: string}): Promise<Instance> {
    const node = createRemoteNode({instance: descriptor, clock, maxActivationCallMs, bind});
    const diagnostics: PluginDiagnostic[] = [];
    const app = createApplication(
        {identity: {location: descriptor.kind, instanceId: descriptor.id}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins, gates: [], remote: node, observers: {plugins: {diagnosticRecorded: (diagnostic) => diagnostics.push(diagnostic)}}},
    );
    expect(await app.startup).toMatchObject({status: "available"});
    return {app, node, diagnostics};
}

/**
 * 服务端提供 A、项目提供 B；`activateA`、`activateB` 是两者激活时要做的事。浏览器有一个启动即激活的调用方。
 * 项目实例由服务端的子实例管理创建；A 所在插件持有项目 P 的租约，才能指名 `{project: "P"}` 调用。
 */
async function topology(options: {
    readonly activateA: (context: ActivationContext) => Promise<void>;
    readonly activateB: (context: ActivationContext) => Promise<void>;
    readonly waitB?: Promise<string>;
    readonly maxActivationCallMs?: number;
}) {
    const clock = new ManualClock();
    const pluginA: PluginDefinition = {
        id: "demo.a",
        entries: [{id: "main", location: "server", remoteProvides: [serviceA], activate: async (context) => {
            await options.activateA(context);
            return {remote: [provideRemote(serviceA, () => ({methods: {ping: () => ({ok: true, value: "a"})}}))]};
        }}],
    };
    const pluginB: PluginDefinition = {
        id: "demo.b",
        entries: [{id: "main", location: "project", remoteProvides: [serviceB], activate: async (context) => {
            await options.activateB(context);
            return {remote: [provideRemote(serviceB, () => ({methods: {ping: () => ({ok: true, value: "b"}), wait: async () => ({ok: true, value: await (options.waitB ?? Promise.resolve("b"))})}}))]};
        }}],
    };
    let browserContext: ActivationContext | null = null;
    const browserCaller: PluginDefinition = {
        id: "app.window",
        entries: [{id: "main", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
            browserContext = context;
            return {};
        }}],
    };
    const hub = await start({id: "hub", kind: "server", role: "hub", project: null, client: null}, [pluginA], clock, options.maxActivationCallMs);
    // 客户端经子实例管理绑定项目（持有者是客户端实例 id）；服务端插件 A 以插件 id 持有租约访问 `{project}`。
    const router = createRemoteRouter(hub.node, {
        bindProject: async (request, client) => {
            const result = await children.acquire(request.project, client.id, "generation" in request ? {generation: request.generation} : {});
            if (result.status !== "acquired") {
                return {ok: false, reason: result.reason === "generation-gone" ? "project-gone" : "project-unavailable", message: result.detail ?? result.reason};
            }
            const {lease} = result;
            return {ok: true, binding: {id: lease.key, name: lease.key, generation: lease.generation}, revoked: lease.revoked, release: () => lease.release()};
        },
        projectAccess: (caller, project, generation) => (caller.plugin !== null && children.holds(project, generation, caller.plugin) ? "allowed" : "denied"),
    });
    const join = async (instance: Instance): Promise<void> => {
        const pair = createLinkPair();
        router.accept(pair.right, instance.node.instance.role === "project" ? {expect: instance.node.instance} : {});
        expect(await instance.node.connect(pair.left)).toEqual({ok: true});
    };
    const children = createChildInstances(hub.app, {
        create: async (key, generation) => {
            const project = await start({id: `project-${key}`, kind: "project", role: "project", project: {id: key, generation}, client: null}, [pluginB], clock);
            await join(project);
            return project;
        },
        stop: async (project) => ((await project.app.stop()).status === "closed" ? "closed" : "forced"),
        graceMs: 1000,
        stopDeadlineMs: 1000,
        clock,
    });
    expect(await children.acquire("P", "demo.a")).toMatchObject({status: "acquired", lease: {key: "P", generation: 1}});
    const browser = await start({id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}, [browserCaller], clock, undefined, {project: "P"});
    await join(browser);
    return {clock, hub, browser, browserRemote: () => (browserContext as unknown as ActivationContext).remote};
}

async function drain(rounds = 40): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

describe("Spec plugin-channel 输出 6：激活期调用与等待环", () => {
    it("A 激活时调用 B、B 激活时又调用 A：B 立即得到 unavailable(activation-cycle) 而不是挂起，整条链照常完成并记诊断", async () => {
        // 在回调里赋值；用断言声明类型，避免控制流把它们收窄成 null。
        let fromB = null as RemoteResult<string> | null;
        let fromA = null as RemoteResult<string> | null;
        const t = await topology({
            activateA: async (context) => {
                // 服务端没有绑定项目，指名项目 P 调用
                fromA = await context.remote.use(serviceB).at({project: "P"}).ping({});
            },
            activateB: async (context) => {
                fromB = await context.remote.use(serviceA).at("server").ping({});
            },
        });

        const outcome = await t.browserRemote().use(serviceA).at("server").ping({});

        expect(outcome).toEqual({ok: true, value: "a"});
        expect(fromB).toMatchObject({ok: false, code: "unavailable", cause: "activation-cycle"});
        expect(fromA).toEqual({ok: true, value: "b"});
        expect(t.hub.diagnostics.some((diagnostic) => diagnostic.reason === "activation-cycle" && diagnostic.plugin === "demo.a")).toBe(true);
        expect(t.hub.node.diagnostics().some((diagnostic) => diagnostic.reason === "activation-cycle")).toBe(true);
    });

    it("A 激活期间发出对 B 的调用但不等待、自己先完成激活：B 激活时再调用 A 不算等待环，照常成功", async () => {
        let fromA = null as Promise<RemoteResult<string>> | null;
        let fromB = null as RemoteResult<string> | null;
        const aSettled = Promise.withResolvers<void>();
        const t = await topology({
            activateA: async (context) => {
                fromA = context.remote.use(serviceB).at({project: "P"}).ping({});
            },
            activateB: async (context) => {
                await aSettled.promise;
                fromB = await context.remote.use(serviceA).at("server").ping({});
            },
        });

        // 浏览器的调用触发 A 激活，A 激活完成后才回复。
        expect(await t.browserRemote().use(serviceA).at("server").ping({})).toEqual({ok: true, value: "a"});
        aSettled.resolve();

        expect(await fromA).toEqual({ok: true, value: "b"});
        expect(fromB).toEqual({ok: true, value: "a"});
        expect(t.hub.diagnostics.some((diagnostic) => diagnostic.reason === "activation-cycle")).toBe(false);
    });

    it("激活期间的远程调用受内核上限约束：作者给的超时更长也在上限处结束；激活结束后的调用不受上限约束", async () => {
        let duringActivation = null as RemoteResult<string> | null;
        const waitB = Promise.withResolvers<string>();
        const t = await topology({
            maxActivationCallMs: 5000,
            activateA: async (context) => {
                duringActivation = await context.remote.use(serviceB).at({project: "P"}).wait({}, {timeout: 60_000});
            },
            activateB: async () => undefined,
            waitB: waitB.promise,
        });

        const pending = t.browserRemote().use(serviceA).at("server").ping({});
        await drain();
        t.clock.advance(5000);

        expect(await pending).toEqual({ok: true, value: "a"});
        expect(duringActivation).toMatchObject({ok: false, code: "timeout", cause: "timeout"});

        // 浏览器调用方不在激活中：同样的长超时不被截短
        const later = t.browserRemote().use(serviceB).at("project").wait({}, {timeout: 60_000});
        await drain();
        t.clock.advance(5000);
        await drain();
        waitB.resolve("done");
        expect(await later).toEqual({ok: true, value: "done"});
    });
});
