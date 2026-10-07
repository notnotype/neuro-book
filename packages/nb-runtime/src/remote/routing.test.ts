import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {createApplication} from "../application/application";
import type {Application} from "../application/application";
import type {RuntimeClock} from "../lifecycle/lifecycle";
import {ManualClock} from "../lifecycle/testing/manual-clock";
import type {ActivationContext, PluginDefinition} from "../plugins/plugins";
import type {ConsumerIdentity} from "../services/services";

import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote} from "./remote";
import type {InstanceDescriptor, RemoteAccess, RemoteImplementation, RemoteNode, RemoteRouter, RemoteTarget} from "./remote";
import {createLinkPair} from "./testing/in-process";

// ---------- 合同 ----------

const Empty = Type.Object({}, {additionalProperties: false});
const Caller = Type.Object({plugin: Type.Union([Type.String(), Type.Null()]), entry: Type.Union([Type.String(), Type.Null()]), instanceId: Type.String(), location: Type.String(), generation: Type.Union([Type.Integer(), Type.Null()])}, {additionalProperties: false});

const echo = defineRemoteService({
    id: "demo.echo/echo",
    version: 1,
    callers: ["browser", "server", "project"],
    methods: {
        whoami: {input: Empty, output: Caller, effect: "read"},
        /** 等到测试放行才返回；用来制造“已派发未回复”。 */
        hold: {input: Type.Object({name: Type.String()}, {additionalProperties: false}), output: Type.String(), effect: "write"},
        peek: {input: Type.Object({name: Type.String()}, {additionalProperties: false}), output: Type.String(), effect: "read"},
        refuse: {input: Empty, output: Type.Null(), effect: "write", errors: {"no-luck": Type.Object({}, {additionalProperties: false})}},
        misbehave: {input: Type.Object({how: Type.String()}, {additionalProperties: false}), output: Type.String(), effect: "read"},
        /** 合同不限制值的形状：用来检验链路编码失败。`"function"` 让提供方返回一个函数。 */
        relay: {input: Type.Object({value: Type.Unknown()}, {additionalProperties: false}), output: Type.Unknown(), effect: "read"},
    },
    events: {
        ticks: {filter: Type.Object({topic: Type.String()}, {additionalProperties: false}), payload: Type.Object({topic: Type.String(), n: Type.Integer()}, {additionalProperties: false})},
        raw: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Unknown()},
    },
});

/** 调用方只认版本 2：与提供方的版本 1 不兼容。 */
const echoV2 = defineRemoteService({...echo, version: 2, events: echo.events});

/** 只允许 tui 调用的合同，由服务端一并提供。 */
const restricted = defineRemoteService({id: "demo.echo/restricted", version: 1, callers: ["tui"], methods: {ping: {input: Empty, output: Type.Null(), effect: "read"}}});

// ---------- 提供方的探针 ----------

interface Probe {
    activations: number;
    readonly consumers: ConsumerIdentity[];
    readonly released: string[];
    readonly gates: Map<string, PromiseWithResolvers<string>>;
    readonly holdSignals: AbortSignal[];
    readonly sinks: Array<{readonly topic: string; readonly next: (payload: {topic: string; n: number}) => void; readonly signal: AbortSignal}>;
    readonly rawSinks: Array<{readonly next: (payload: unknown) => void; readonly signal: AbortSignal}>;
}

function newProbe(): Probe {
    return {activations: 0, consumers: [], released: [], gates: new Map(), holdSignals: [], sinks: [], rawSinks: []};
}

function implementation(consumer: ConsumerIdentity, probe: Probe): RemoteImplementation<typeof echo> {
    probe.consumers.push(consumer);
    const gate = (name: string): PromiseWithResolvers<string> => {
        let entry = probe.gates.get(name);
        if (entry === undefined) {
            entry = Promise.withResolvers<string>();
            probe.gates.set(name, entry);
        }
        return entry;
    };
    return {
        methods: {
            whoami: () => ({ok: true, value: {plugin: consumer.plugin, entry: consumer.entry, instanceId: consumer.instanceId, location: consumer.location, generation: consumer.generation}}),
            hold: async ({name}, {signal}) => {
                probe.holdSignals.push(signal);
                return {ok: true, value: await gate(name).promise};
            },
            peek: async ({name}) => ({ok: true, value: await gate(name).promise}),
            refuse: () => ({ok: false, code: "no-luck"}),
            misbehave: ({how}) => {
                if (how === "throw") {
                    throw new Error("boom");
                }
                if (how === "bad-output") {
                    return {ok: true, value: 42 as unknown as string};
                }
                // 故意返回合同没有声明的失败码
                return {ok: false, code: "unheard-of" as never};
            },
            relay: ({value}) => ({ok: true, value: value === "function" ? () => "not sendable" : value}),
        },
        events: {
            ticks: {
                subscribe: ({topic}, sink, {signal}) => {
                    probe.sinks.push({topic, next: (payload) => sink.next(payload), signal});
                },
            },
            raw: {
                subscribe: (_filter, sink, {signal}) => {
                    probe.rawSinks.push({next: (payload) => sink.next(payload), signal});
                },
            },
        },
    };
}

/** 提供 echo 的插件：不声明 onStartup，首次远程调用时按需激活。 */
function provider(id: string, location: string, probe: Probe): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location,
            remoteProvides: location === "server" ? [echo.id, restricted.id] : [echo.id],
            activate: () => {
                probe.activations += 1;
                const remote = [provideRemote(echo, (consumer) => implementation(consumer, probe), {release: (_implementation, consumer) => void probe.released.push(`${consumer.instanceId}:${consumer.plugin ?? "?"}#${String(consumer.generation)}`)})];
                return {remote: location === "server" ? [...remote, provideRemote(restricted, () => ({methods: {ping: () => ({ok: true, value: null})}}))] : remote};
            },
        }],
    };
}

/** 调用方插件：启动时激活，把激活上下文交给测试。 */
function caller(id: string, location: string, captured: Map<string, ActivationContext>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location,
            activationEvents: ["onStartup"],
            activate: (context) => {
                captured.set(id, context);
                return {};
            },
        }],
    };
}

// ---------- 实例与时钟 ----------

interface Instance {
    readonly app: Application;
    readonly node: RemoteNode;
    /** 本实例里调用方插件的激活上下文，按插件 id。 */
    readonly contexts: Map<string, ActivationContext>;
}

async function start(
    descriptor: InstanceDescriptor,
    plugins: (contexts: Map<string, ActivationContext>) => ReadonlyArray<PluginDefinition>,
    clock: RuntimeClock,
    validateLocalCalls = false,
): Promise<Instance> {
    const contexts = new Map<string, ActivationContext>();
    const node = createRemoteNode({instance: descriptor, clock, validateLocalCalls});
    const app = createApplication(
        {identity: {location: descriptor.kind, instanceId: descriptor.id}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [], plugins: plugins(contexts), gates: [], remote: node},
    );
    expect(await app.startup).toMatchObject({status: "available"});
    return {app, node, contexts};
}

interface Topology {
    readonly clock: ManualClock;
    readonly router: RemoteRouter;
    readonly hub: Instance;
    readonly project: Instance;
    readonly browser1: Instance;
    readonly browser2: Instance;
    readonly probes: {readonly hub: Probe; readonly project: Probe; readonly browser2: Probe};
    readonly links: Map<string, ReturnType<typeof createLinkPair>>;
    /** 实例里调用方插件（app.*）的 `context.remote`。 */
    remote(instance: Instance): RemoteAccess;
    connect(instance: Instance): Promise<void>;
}

/** 服务端（hub）、项目 P 代次 1、两个绑定 P 的浏览器窗口；hub、项目与 browser-2 各提供 echo。 */
async function topology(options: {readonly validateLocalCalls?: boolean} = {}): Promise<Topology> {
    const clock = new ManualClock();
    const probes = {hub: newProbe(), project: newProbe(), browser2: newProbe()};
    const binding = {id: "P", generation: 1};
    const hub = await start({id: "hub", kind: "server", role: "hub", project: null}, (contexts) => [provider("demo.server", "server", probes.hub), caller("app.caller", "server", contexts)], clock, options.validateLocalCalls);
    const project = await start({id: "project-P", kind: "project", role: "project", project: binding}, (contexts) => [provider("demo.project", "project", probes.project), caller("app.caller", "project", contexts)], clock);
    const browser1 = await start({id: "browser-1", kind: "browser", role: "client", project: binding}, (contexts) => [caller("app.caller", "browser", contexts)], clock);
    const browser2 = await start({id: "browser-2", kind: "browser", role: "client", project: binding}, (contexts) => [provider("demo.window", "browser", probes.browser2), caller("app.caller", "browser", contexts)], clock);
    const router = createRemoteRouter(hub.node);
    const links = new Map<string, ReturnType<typeof createLinkPair>>();
    const connect = async (instance: Instance): Promise<void> => {
        const pair = createLinkPair();
        links.set(instance.node.instance.id, pair);
        router.accept(pair.right);
        expect(await instance.node.connect(pair.left)).toEqual({ok: true});
    };
    for (const instance of [project, browser1, browser2]) {
        await connect(instance);
    }
    return {
        clock,
        router,
        hub,
        project,
        browser1,
        browser2,
        probes,
        links,
        connect,
        remote: (instance) => {
            const context = instance.contexts.get("app.caller");
            if (context === undefined) {
                throw new Error(`实例 ${instance.node.instance.id} 没有调用方插件的激活上下文`);
            }
            return context.remote;
        },
    };
}

/** 让微任务里的投递走完；不按时间等待。 */
async function drain(rounds = 20): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

describe("Spec plugin-channel 输出 1–3、5：调用、寻址与按需激活", () => {
    it("客户端调用服务端、绑定的项目与另一个客户端；提供方看到真实调用方；提供入口在首次调用时才激活", async () => {
        const t = await topology();
        const fromBrowser = (target: RemoteTarget) => t.remote(t.browser1).use(echo).at(target);
        expect([t.probes.hub.activations, t.probes.project.activations, t.probes.browser2.activations]).toEqual([0, 0, 0]);

        const atServer = await fromBrowser("server").whoami({});
        const atProject = await fromBrowser("project").whoami({});
        const atClient = await fromBrowser({client: "browser-2"}).whoami({});

        const expected = {plugin: "app.caller", entry: "main", instanceId: "browser-1", location: "browser", generation: 1};
        expect(atServer).toEqual({ok: true, value: expected});
        expect(atProject).toEqual({ok: true, value: expected});
        expect(atClient).toEqual({ok: true, value: expected});
        expect([t.probes.hub.activations, t.probes.project.activations, t.probes.browser2.activations]).toEqual([1, 1, 1]);
    });

    it("同实例调用不经链路，结果与跨实例一致；开发模式下传不可序列化的值被拒", async () => {
        const t = await topology({validateLocalCalls: true});
        const local = await t.remote(t.hub).use(echo).at("server").whoami({});
        expect(local).toEqual({ok: true, value: {plugin: "app.caller", entry: "main", instanceId: "hub", location: "server", generation: 1}});

        const rejected = await t.remote(t.hub).use(echo).at("server").peek({name: (() => "x") as unknown as string});
        expect(rejected).toMatchObject({ok: false, code: "invalid-input"});
    });

    it("实例查询列出服务端与在线实例", async () => {
        const t = await topology();
        const listed = await t.remote(t.browser1).instances();
        expect(listed.ok ? listed.value.map((instance) => instance.id).sort() : listed).toEqual(["browser-1", "browser-2", "hub", "project-P"]);
    });
});

describe("Spec plugin-channel 输出 4：请求阶段与失败码", () => {
    it("未派发阶段的确定失败：多余字段、保留字段、版本不符、调用方种类不允许、目标不在线", async () => {
        const t = await topology();
        const atServer = t.remote(t.browser1).use(echo).at("server");
        expect(await atServer.peek({name: "a", extra: 1} as never)).toMatchObject({ok: false, code: "invalid-input"});
        expect(await atServer.peek({name: "a", $nbConsumer: {}} as never)).toMatchObject({ok: false, code: "invalid-input"});
        expect(await t.remote(t.browser1).use(echoV2).at("server").whoami({})).toMatchObject({ok: false, code: "version-changed"});
        expect(await t.remote(t.browser1).use(echo).at({client: "nobody"}).whoami({})).toMatchObject({ok: false, code: "target-gone"});
        expect(await t.remote(t.browser1).use(restricted).at("server").ping({})).toMatchObject({ok: false, code: "denied"});
        expect(t.probes.hub.consumers).toEqual([]);
    });

    it("已派发后链路断开：写请求为 unknown-outcome，读请求为 target-gone，原因都是 disconnected", async () => {
        const t = await topology();
        const atProject = t.remote(t.browser1).use(echo).at("project");
        const write = atProject.hold({name: "w"});
        const read = atProject.peek({name: "r"});
        await drain();
        expect(t.probes.project.holdSignals).toHaveLength(1);

        t.links.get("project-P")!.left.close();
        await drain();

        expect(await write).toEqual({ok: false, code: "unknown-outcome", cause: "disconnected"});
        expect(await read).toMatchObject({ok: false, code: "target-gone", cause: "disconnected"});
        expect(t.probes.project.holdSignals[0]!.aborted).toBe(true);
    });

    it("超时按注入时钟：写请求已派发为 unknown-outcome(timeout)，提供方收到取消", async () => {
        const t = await topology();
        const pending = t.remote(t.browser1).use(echo).at("project").hold({name: "slow"}, {timeout: 1000});
        await drain();
        t.clock.advance(1000);
        expect(await pending).toEqual({ok: false, code: "unknown-outcome", cause: "timeout"});
        await drain();
        expect(t.probes.project.holdSignals[0]!.aborted).toBe(true);
    });

    it("回复阶段：业务失败码原样返回；抛错、输出不符合合同、未声明的失败码都是 provider-error", async () => {
        const t = await topology();
        const atServer = t.remote(t.browser1).use(echo).at("server");
        expect(await atServer.refuse({})).toEqual({ok: false, code: "no-luck"});
        expect(await atServer.misbehave({how: "throw"})).toMatchObject({ok: false, code: "provider-error"});
        expect(await atServer.misbehave({how: "bad-output"})).toMatchObject({ok: false, code: "provider-error"});
        expect(await atServer.misbehave({how: "undeclared"})).toMatchObject({ok: false, code: "provider-error"});
    });
});

describe("Spec plugin-channel 输出 1、4：链路编码失败是结构化失败", () => {
    it("跨实例传不能序列化的参数：立即得到 invalid-input，不等超时；之后的调用照常", async () => {
        const t = await topology();
        const atServer = t.remote(t.browser1).use(echo).at("server");

        expect(await atServer.relay({value: () => 1})).toMatchObject({ok: false, code: "invalid-input"});
        expect(await atServer.relay({value: 1})).toEqual({ok: true, value: 1});
    });

    it("提供方返回不能序列化的结果：调用方得到 provider-error，不挂起", async () => {
        const t = await topology();
        expect(await t.remote(t.browser1).use(echo).at("project").relay({value: "function"})).toMatchObject({ok: false, code: "provider-error"});
    });

    it("提供方推送不能序列化的事件：订阅以 onEnd(provider-error) 结束，提供方信号触发", async () => {
        const t = await topology();
        const ended: string[] = [];
        await t.remote(t.browser1).use(echo).at("server").events.raw.subscribe({}, () => undefined, {onEnd: (reason) => ended.push(reason)});
        await drain();
        const sink = t.probes.hub.rawSinks[0]!;

        sink.next(() => "not sendable");
        await drain();

        expect(ended).toEqual(["provider-error"]);
        expect(sink.signal.aborted).toBe(true);
    });

    it("远程实现工厂是 async 函数：这次调用为 provider-error 并记诊断，不交出没有方法的实现", async () => {
        const clock = new ManualClock();
        const lazy: PluginDefinition = {
            id: "demo.lazy",
            entries: [{
                id: "main",
                location: "server",
                remoteProvides: [echo.id],
                activate: () => ({remote: [provideRemote(echo, (async (consumer: ConsumerIdentity) => implementation(consumer, newProbe())) as unknown as (consumer: ConsumerIdentity) => RemoteImplementation<typeof echo>)]}),
            }],
        };
        const hub = await start({id: "hub", kind: "server", role: "hub", project: null}, (contexts) => [lazy, caller("app.caller", "server", contexts)], clock);
        const context = hub.contexts.get("app.caller")!;

        expect(await context.remote.use(echo).at("server").whoami({})).toMatchObject({ok: false, code: "provider-error"});
        expect(hub.node.diagnostics().map((diagnostic) => diagnostic.reason)).toContain("facade-invalid");
    });
});

describe("Spec plugin-channel 状态与场景 8：项目代次结束", () => {
    it("项目实例下线：订阅以 onEnd(target-gone) 结束；新代次上线后，绑定旧代次的客户端请求与订阅都是 target-gone，不改投新代次，重连也不复活旧订阅", async () => {
        const t = await topology();
        const ended: string[] = [];
        const resynced: number[] = [];
        await t.remote(t.browser1).use(echo).at("project").events.ticks.subscribe({topic: "a"}, () => undefined, {onEnd: (reason) => ended.push(reason), onResync: () => resynced.push(1)});
        await drain();
        const oldSink = t.probes.project.sinks[0]!;

        t.links.get("project-P")!.left.close();
        await drain();
        expect(ended).toEqual(["target-gone"]);
        expect(oldSink.signal.aborted).toBe(true);

        const nextProbe = newProbe();
        const next = await start({id: "project-P-2", kind: "project", role: "project", project: {id: "P", generation: 2}}, () => [provider("demo.project", "project", nextProbe)], t.clock);
        await t.connect(next);
        const atProject = t.remote(t.browser1).use(echo).at("project");

        expect(await atProject.whoami({})).toMatchObject({ok: false, code: "target-gone"});
        expect(await atProject.events.ticks.subscribe({topic: "a"}, () => undefined)).toMatchObject({ok: false, code: "target-gone"});
        t.links.get("browser-1")!.left.close();
        await drain();
        await t.connect(t.browser1);
        await drain();
        expect(resynced).toEqual([]);
        expect(nextProbe.activations).toBe(0);
        expect(nextProbe.sinks).toEqual([]);
    });
});

describe("Spec plugin-channel 输出 3：调用方不可伪造", () => {
    it("链路上声称是其它实例的请求被路由拒绝", async () => {
        const t = await topology();
        const pair = createLinkPair();
        t.router.accept(pair.right);
        const frames: unknown[] = [];
        pair.left.onFrame((frame) => frames.push(frame));
        pair.left.send({type: "hello", wire: 1, instance: {id: "intruder", kind: "browser", role: "client", project: null}});
        await drain();
        pair.left.send({
            type: "request",
            id: "x1",
            target: "server",
            contract: echo.id,
            version: 1,
            method: "whoami",
            effect: "read",
            input: {},
            $nbConsumer: {instanceId: "browser-1", location: "browser", plugin: "app.caller", entry: "main", generation: 1, via: null},
            $nbChain: [],
        });
        await drain();
        expect(frames).toContainEqual({type: "result", id: "x1", outcome: {ok: false, code: "denied", detail: "调用方实例与链路登记的实例不符"}});
        expect(t.probes.hub.consumers).toEqual([]);
    });
});

describe("Spec plugin-channel 输出 7：订阅", () => {
    it("提供方按过滤参数推送；调用方只收到自己订阅的；释放句柄后提供方信号触发、迟到事件丢弃", async () => {
        const t = await topology();
        const received: unknown[] = [];
        const subscribed = await t.remote(t.browser1).use(echo).at("project").events.ticks.subscribe({topic: "a"}, (payload) => received.push(payload));
        expect(subscribed.ok).toBe(true);
        await drain();
        const sink = t.probes.project.sinks[0]!;
        expect(sink.topic).toBe("a");

        sink.next({topic: "a", n: 1});
        sink.next({topic: "a", n: 2});
        await drain();
        expect(received).toEqual([{topic: "a", n: 1}, {topic: "a", n: 2}]);

        if (subscribed.ok) {
            subscribed.value.release();
        }
        await drain();
        expect(sink.signal.aborted).toBe(true);
        sink.next({topic: "a", n: 3});
        await drain();
        expect(received).toHaveLength(2);
    });

    it("提供入口停止：订阅方收到 onEnd(provider-stopped)", async () => {
        const t = await topology();
        const ended: string[] = [];
        await t.remote(t.browser1).use(echo).at("project").events.ticks.subscribe({topic: "a"}, () => undefined, {onEnd: (reason) => ended.push(reason)});
        await drain();

        await t.project.app.stop();
        await drain();
        expect(ended).toEqual(["provider-stopped"]);
    });

    it("订阅方入口停止：提供方信号触发，并释放为它生成的门面", async () => {
        const t = await topology();
        await t.remote(t.browser1).use(echo).at("project").events.ticks.subscribe({topic: "a"}, () => undefined);
        await drain();
        const sink = t.probes.project.sinks[0]!;

        await t.browser1.app.stop();
        await drain();
        expect(sink.signal.aborted).toBe(true);
        expect(t.probes.project.released).toEqual(["browser-1:app.caller#1"]);
    });

    it("连接结束：提供方信号触发；同一绑定重连后订阅重建并收到 onResync", async () => {
        const t = await topology();
        const resynced: number[] = [];
        const received: unknown[] = [];
        await t.remote(t.browser1).use(echo).at("project").events.ticks.subscribe({topic: "a"}, (payload) => received.push(payload), {onResync: () => resynced.push(1)});
        await drain();
        const first = t.probes.project.sinks[0]!;

        t.links.get("browser-1")!.left.close();
        await drain();
        expect(first.signal.aborted).toBe(true);

        await t.connect(t.browser1);
        await drain();
        expect(resynced).toEqual([1]);
        const second = t.probes.project.sinks[1]!;
        second.next({topic: "a", n: 7});
        first.next({topic: "a", n: 99});
        await drain();
        expect(received).toEqual([{topic: "a", n: 7}]);
    });
});
