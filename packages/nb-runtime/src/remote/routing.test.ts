import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {createApplication} from "../application/application";
import type {Application} from "../application/application";
import type {RuntimeClock} from "../lifecycle/lifecycle";
import {ManualClock} from "../lifecycle/testing/manual-clock";
import type {ActivationContext, PluginDefinition} from "../plugins/plugins";
import type {ConsumerIdentity} from "../services/services";

import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote, WIRE_PROTOCOL_VERSION} from "./remote";
import type {InstanceDescriptor, RemoteAccess, RemoteImplementation, RemoteNode, RemoteRouter, RemoteRouterOptions, RemoteTarget} from "./remote";
import {createLinkPair} from "./testing/in-process";

// ---------- 合同 ----------

const Empty = Type.Object({}, {additionalProperties: false});
const Caller = Type.Object({plugin: Type.Union([Type.String(), Type.Null()]), entry: Type.Union([Type.String(), Type.Null()]), instanceId: Type.String(), location: Type.String(), client: Type.Union([Type.String(), Type.Null()]), generation: Type.Union([Type.Integer(), Type.Null()])}, {additionalProperties: false});

/** 服务端、项目与 browser-2 各提供一份。 */
const echo = defineRemoteService({
    id: "demo.echo/echo",
    version: 1,
    provider: "any",
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
const restricted = defineRemoteService({id: "demo.echo/restricted", version: 1, provider: "server", callers: ["tui"], methods: {ping: {input: Empty, output: Type.Null(), effect: "read"}}});

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
            whoami: () => ({ok: true, value: {plugin: consumer.plugin, entry: consumer.entry, instanceId: consumer.instanceId, location: consumer.location, client: consumer.client, generation: consumer.generation}}),
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
    options: {readonly validateLocalCalls?: boolean; readonly bind?: {readonly project: string}} = {},
): Promise<Instance> {
    const contexts = new Map<string, ActivationContext>();
    const node = createRemoteNode({instance: descriptor, clock, validateLocalCalls: options.validateLocalCalls, bind: options.bind});
    const app = createApplication(
        {identity: {location: descriptor.kind, instanceId: descriptor.id, client: descriptor.client}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [], plugins: plugins(contexts), gates: [], remote: node},
    );
    expect(await app.startup).toMatchObject({status: "available"});
    return {app, node, contexts};
}

/**
 * 测试里的项目管理：只有项目 P（短名 p），实例由测试自己起。`end()` 结束当前代次（租约失效），`next()`
 * 开始下一代。首次绑定按引用取当前代次；重连只取原代次，已结束为 project-gone。
 */
function projectsStandIn() {
    let generation = 1;
    let running = true;
    let revoke = new AbortController();
    const released: string[] = [];
    /** 每次绑定请求的实例 id：判定在绑定之前就拒绝的 hello 不出现在这里。 */
    const requested: string[] = [];
    const bindProject: NonNullable<RemoteRouterOptions["bindProject"]> = async (request, client) => {
        requested.push(client.id);
        if (request.project !== "P" && request.project !== "p") {
            return {ok: false, reason: "project-unavailable", message: `没有项目 ${request.project}`};
        }
        if ("generation" in request && (!running || request.generation !== generation)) {
            return {ok: false, reason: "project-gone", message: `项目 P 的代次 ${String(request.generation)} 已结束`};
        }
        if (!running) {
            return {ok: false, reason: "project-unavailable", message: "项目 P 没在运行"};
        }
        return {ok: true, binding: {id: "P", name: "p", generation}, revoked: revoke.signal, release: () => void released.push(client.id)};
    };
    return {
        bindProject,
        released,
        requested,
        end(): void {
            running = false;
            revoke.abort();
        },
        next(): void {
            generation += 1;
            running = true;
            revoke = new AbortController();
        },
    };
}

interface Topology {
    readonly clock: ManualClock;
    readonly router: RemoteRouter;
    readonly projects: ReturnType<typeof projectsStandIn>;
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
    const hub = await start({id: "hub", kind: "server", role: "hub", project: null, client: null}, (contexts) => [provider("demo.server", "server", probes.hub), caller("app.caller", "server", contexts)], clock, {validateLocalCalls: options.validateLocalCalls});
    const project = await start({id: "project-P", kind: "project", role: "project", project: binding, client: null}, (contexts) => [provider("demo.project", "project", probes.project), caller("app.caller", "project", contexts)], clock);
    const browser1 = await start({id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}, (contexts) => [caller("app.caller", "browser", contexts)], clock, {bind: {project: "p"}});
    const browser2 = await start({id: "browser-2", kind: "browser", role: "client", project: null, client: "profile-1"}, (contexts) => [provider("demo.window", "browser", probes.browser2), caller("app.caller", "browser", contexts)], clock, {bind: {project: "p"}});
    const projects = projectsStandIn();
    const router = createRemoteRouter(hub.node, {bindProject: projects.bindProject});
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
        projects,
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

        const expected = {plugin: "app.caller", entry: "main", instanceId: "browser-1", location: "browser", client: "profile-1", generation: 1};
        expect(atServer).toEqual({ok: true, value: expected});
        expect(atProject).toEqual({ok: true, value: expected});
        expect(atClient).toEqual({ok: true, value: expected});
        expect([t.probes.hub.activations, t.probes.project.activations, t.probes.browser2.activations]).toEqual([1, 1, 1]);
    });

    it("同实例调用不经链路，结果与跨实例一致；开发模式下传不可序列化的值被拒", async () => {
        const t = await topology({validateLocalCalls: true});
        const local = await t.remote(t.hub).use(echo).at("server").whoami({});
        expect(local).toEqual({ok: true, value: {plugin: "app.caller", entry: "main", instanceId: "hub", location: "server", client: null, generation: 1}});

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
        // 结构化克隆能传 Date，JSON 会把它改写成字符串：链路按 JSON 编码，所以同样拒绝。
        expect(await atServer.relay({value: new Date(0)})).toMatchObject({ok: false, code: "invalid-input"});
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
        const hub = await start({id: "hub", kind: "server", role: "hub", project: null, client: null}, (contexts) => [lazy, caller("app.caller", "server", contexts)], clock);
        const context = hub.contexts.get("app.caller")!;

        expect(await context.remote.use(echo).at("server").whoami({})).toMatchObject({ok: false, code: "provider-error"});
        expect(hub.node.diagnostics().map((diagnostic) => diagnostic.reason)).toContain("facade-invalid");
    });
});

describe("Spec plugin-channel 状态与场景 8：项目代次结束", () => {
    it("项目实例下线：订阅以 onEnd(target-gone) 结束；新代次上线后，绑定旧代次的客户端请求与订阅都是 target-gone，不改投新代次", async () => {
        const t = await topology();
        const ended: string[] = [];
        await t.remote(t.browser1).use(echo).at("project").events.ticks.subscribe({topic: "a"}, () => undefined, {onEnd: (reason) => ended.push(reason)});
        await drain();
        const oldSink = t.probes.project.sinks[0]!;

        t.links.get("project-P")!.left.close();
        await drain();
        expect(ended).toEqual(["target-gone"]);
        expect(oldSink.signal.aborted).toBe(true);

        const nextProbe = newProbe();
        const next = await start({id: "project-P-2", kind: "project", role: "project", project: {id: "P", generation: 2}, client: null}, () => [provider("demo.project", "project", nextProbe)], t.clock);
        await t.connect(next);
        const atProject = t.remote(t.browser1).use(echo).at("project");

        expect(await atProject.whoami({})).toMatchObject({ok: false, code: "target-gone"});
        expect(await atProject.events.ticks.subscribe({topic: "a"}, () => undefined)).toMatchObject({ok: false, code: "target-gone"});
        expect(nextProbe.activations).toBe(0);
    });

    it("绑定的代次结束（租约失效）：路由关闭绑定它的客户端链路并释放租约；重连得到 project-gone，节点进入终态，订阅不复活", async () => {
        const t = await topology();
        const ended: string[] = [];
        const resynced: number[] = [];
        await t.remote(t.browser1).use(echo).at("server").events.ticks.subscribe({topic: "a"}, () => undefined, {onEnd: (reason) => ended.push(reason), onResync: () => resynced.push(1)});
        await drain();
        const browserClosed = Promise.withResolvers<void>();
        t.links.get("browser-1")!.left.onClose(() => browserClosed.resolve());

        t.projects.end();
        await browserClosed.promise;
        await drain();
        expect(t.projects.released.sort()).toEqual(["browser-1", "browser-2"]);
        expect(t.router.instances().map((instance) => instance.id).sort()).toEqual(["hub", "project-P"]);

        t.projects.next();
        const pair = createLinkPair();
        t.router.accept(pair.right);
        expect(await t.browser1.node.connect(pair.left)).toMatchObject({ok: false, reason: "project-gone"});
        await drain();
        expect(ended).toEqual(["project-gone"]);
        expect(resynced).toEqual([]);
        expect(await t.remote(t.browser1).use(echo).at("server").whoami({})).toMatchObject({ok: false, code: "unavailable"});
        expect(t.browser1.node.binding).toEqual({id: "P", name: "p", generation: 1});

        const again = createLinkPair();
        t.router.accept(again.right);
        expect(await t.browser1.node.connect(again.left)).toMatchObject({ok: false, reason: "project-gone"});
    });
});

describe("Spec plugin-channel 输出 3：调用方不可伪造", () => {
    it("链路上声称是其它实例的请求被路由拒绝", async () => {
        const t = await topology();
        const pair = createLinkPair();
        t.router.accept(pair.right);
        const frames: unknown[] = [];
        pair.left.onFrame((frame) => frames.push(frame));
        pair.left.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "intruder", kind: "browser", role: "client", project: null, client: null}, bind: null, boot: null});
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
            $nbConsumer: {instanceId: "browser-1", location: "browser", client: "profile-1", plugin: "app.caller", entry: "main", generation: 1, via: null},
            $nbChain: [],
        });
        await drain();
        expect(frames).toContainEqual({type: "result", id: "x1", outcome: {ok: false, code: "denied", detail: "调用方实例与链路登记的实例不符"}});
        expect(t.probes.hub.consumers).toEqual([]);
    });

    it("帧上自报的运行位置与客户端身份不算数：提供方看到登记的成员描述里的值，合同的调用方种类按它核对（随 t55）", async () => {
        const t = await topology();
        const pair = createLinkPair();
        t.router.accept(pair.right);
        const frames: unknown[] = [];
        pair.left.onFrame((frame) => frames.push(frame));
        pair.left.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: "profile-9"}, bind: null, boot: null});
        await drain();
        const forged = {instanceId: "browser-9", location: "tui", client: "profile-1", plugin: "app.caller", entry: "main", generation: 1, via: null};
        const request = (id: string, contract: string, method: string) => ({type: "request" as const, id, target: "server" as const, contract, version: 1, method, effect: "read" as const, input: {}, $nbConsumer: forged, $nbChain: []});
        pair.left.send(request("x1", echo.id, "whoami"));
        pair.left.send(request("x2", restricted.id, "ping"));
        await drain();

        expect(frames).toContainEqual({type: "result", id: "x1", outcome: {ok: true, value: {plugin: "app.caller", entry: "main", instanceId: "browser-9", location: "browser", client: "profile-9", generation: 1}}});
        expect(frames).toContainEqual({type: "result", id: "x2", outcome: expect.objectContaining({ok: false, code: "denied"})});
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

// ---------- 握手、重连与协议违规（WebSocket 传输与握手） ----------

interface RawLink {
    readonly frames: unknown[];
    readonly closed: Promise<void>;
    send(value: unknown): void;
}

/** 不经节点、直接向路由发帧的链路：用来发送节点自己不会发的帧。 */
function rawLink(router: RemoteRouter): RawLink {
    const pair = createLinkPair();
    router.accept(pair.right);
    const frames: unknown[] = [];
    const closed = Promise.withResolvers<void>();
    pair.left.onFrame((frame) => frames.push(frame));
    pair.left.onClose(() => closed.resolve());
    return {frames, closed: closed.promise, send: (value) => pair.left.send(value as never)};
}

describe("Spec plugin-channel WebSocket 传输第 3 条：握手", () => {
    it("hello 带客户端身份并登记；welcome 带服务端进程标识 boot", async () => {
        const t = await topology();
        const link = rawLink(t.router);
        link.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: "profile-9"}, bind: null, boot: null});
        await drain();

        expect(link.frames).toEqual([{type: "welcome", wire: WIRE_PROTOCOL_VERSION, boot: expect.any(String), binding: null}]);
        expect(t.router.instances()).toContainEqual({id: "browser-9", kind: "browser", role: "client", project: null, client: "profile-9"});
    });

    it("wire 不同的 hello 即使其余字段是另一版本的形状，也得到 wire-version 拒绝并关闭，不登记", async () => {
        const t = await topology();
        const link = rawLink(t.router);
        link.send({type: "hello", wire: 99, instance: {id: "browser-9"}, plugins: [{id: "nbook.files", version: "9.0.0"}]});
        await link.closed;

        expect(link.frames).toEqual([{type: "reject", reason: "wire-version", message: expect.any(String)}]);
        expect(t.router.instances().map((instance) => instance.id)).not.toContain("browser-9");
    });

    it("同一实例重连接管旧链路：旧链路上已派发的写请求为 unknown-outcome，新链路照常；描述不一致为 duplicate-instance", async () => {
        const t = await topology();
        const pending = t.remote(t.browser1).use(echo).at("project").hold({name: "w"});
        await drain();
        expect(t.probes.project.holdSignals).toHaveLength(1);

        // 不关闭旧链路直接再连一次：服务端还没察觉旧连接断开时客户端重连。绑定的窗口带原代次重连，按同一实例接管。
        await t.connect(t.browser1);
        expect(await pending).toEqual({ok: false, code: "unknown-outcome", cause: "disconnected"});
        expect(t.projects.released).toEqual(["browser-1"]);
        expect(t.probes.project.holdSignals[0]!.aborted).toBe(true);
        expect(await t.remote(t.browser1).use(echo).at("server").whoami({})).toMatchObject({ok: true});

        const impostors = [
            createRemoteNode({instance: {...t.browser1.node.instance, project: null, client: "profile-2"}, clock: t.clock, bind: {project: "p"}}),
            // 同 id、同客户端身份，但只按引用请求绑定（不是带原代次的重连）
            createRemoteNode({instance: {...t.browser1.node.instance, project: null}, clock: t.clock, bind: {project: "p"}}),
            createRemoteNode({instance: {...t.browser1.node.instance, project: null}, clock: t.clock}),
        ];
        for (const impostor of impostors) {
            const pair = createLinkPair();
            t.router.accept(pair.right);
            expect(await impostor.connect(pair.left)).toMatchObject({ok: false, reason: "duplicate-instance"});
        }
        expect(await t.remote(t.browser1).use(echo).at("server").whoami({})).toMatchObject({ok: true});

        // 同 id、同客户端身份，带代次的 bind 却指向别的项目或别的代次：在绑定之前就拒绝，原成员的绑定不变。
        const requestedBefore = t.projects.requested.length;
        for (const bind of [{project: "Q", generation: 1}, {project: "P", generation: 2}]) {
            const link = rawLink(t.router);
            link.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}, bind, boot: null});
            await link.closed;
            expect(link.frames, JSON.stringify(bind)).toEqual([{type: "reject", reason: "duplicate-instance", message: expect.any(String)}]);
        }
        expect(t.projects.requested.length).toBe(requestedBefore);
        expect(t.router.instances()).toContainEqual({id: "browser-1", kind: "browser", role: "client", project: {id: "P", generation: 1}, client: "profile-1"});
    });
});

/** 只有服务端实例与路由；路由的项目回调由测试给出。 */
async function bareHub(options: RemoteRouterOptions = {}) {
    const clock = new ManualClock();
    const hub = await start({id: "hub", kind: "server", role: "hub", project: null, client: null}, () => [], clock);
    return {clock, hub, router: createRemoteRouter(hub.node, options)};
}

describe("Spec plugin-channel WebSocket 传输第 3 条：绑定", () => {
    it("带 bind 的 hello 得到带 binding 的 welcome；成员描述带上项目代次；节点记下绑定", async () => {
        const t = await topology();
        const link = rawLink(t.router);
        link.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: "profile-9"}, bind: {project: "p"}, boot: null});
        await drain();

        expect(link.frames).toEqual([{type: "welcome", wire: WIRE_PROTOCOL_VERSION, boot: expect.any(String), binding: {id: "P", name: "p", generation: 1}}]);
        expect(t.router.instances()).toContainEqual({id: "browser-9", kind: "browser", role: "client", project: {id: "P", generation: 1}, client: "profile-9"});
        expect(t.browser1.node.binding).toEqual({id: "P", name: "p", generation: 1});
        expect(t.browser1.node.instance.project).toEqual({id: "P", generation: 1});
    });

    it("绑定回调拒绝为 project-unavailable；没有绑定回调同样是 project-unavailable", async () => {
        const t = await topology();
        const missing = createRemoteNode({instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: null}, bind: {project: "elsewhere"}});
        const pair = createLinkPair();
        t.router.accept(pair.right);
        expect(await missing.connect(pair.left)).toMatchObject({ok: false, reason: "project-unavailable"});
        expect(missing.binding).toBeNull();

        const bare = await bareHub();
        const unmanaged = createRemoteNode({instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: null}, bind: {project: "p"}});
        const other = createLinkPair();
        bare.router.accept(other.right);
        expect(await unmanaged.connect(other.left)).toMatchObject({ok: false, reason: "project-unavailable"});
    });

    it("{project} 目标：没有访问回调时一律 denied，项目没在运行为 target-gone", async () => {
        const t = await topology();
        expect(await t.remote(t.hub).use(echo).at({project: "P"}).whoami({})).toMatchObject({ok: false, code: "denied"});
        expect(await t.remote(t.hub).use(echo).at({project: "Q"}).whoami({})).toMatchObject({ok: false, code: "target-gone"});
        expect(t.probes.project.consumers).toEqual([]);
    });

    it("客户端自报项目代次、非客户端带 bind：以 role 拒绝", async () => {
        const t = await topology();
        const claims = rawLink(t.router);
        claims.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-9", kind: "browser", role: "client", project: {id: "P", generation: 1}, client: null}, bind: null, boot: null});
        await claims.closed;
        expect(claims.frames).toEqual([{type: "reject", reason: "role", message: expect.any(String)}]);

        const projectBinds = rawLink(t.router);
        projectBinds.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "project-Q", kind: "project", role: "project", project: {id: "Q", generation: 1}, client: null}, bind: {project: "p"}, boot: null});
        await projectBinds.closed;
        expect(projectBinds.frames).toEqual([{type: "reject", reason: "role", message: expect.any(String)}]);
    });

    it("等绑定期间链路关闭：绑定一出结果就释放租约，不登记成员；路由关闭时握手中的链路一并关闭", async () => {
        const pending: Array<PromiseWithResolvers<void>> = [];
        const released: string[] = [];
        const bare = await bareHub({
            bindProject: async (_request, client) => {
                const gate = Promise.withResolvers<void>();
                pending.push(gate);
                await gate.promise;
                return {ok: true, binding: {id: "P", name: "p", generation: 1}, revoked: new AbortController().signal, release: () => void released.push(client.id)};
            },
        });
        const first = rawLink(bare.router);
        first.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: null}, bind: {project: "p"}, boot: null});
        await drain();
        // 握手完成前发业务帧是协议违规：链路关闭。
        first.send({type: "release", target: "server", $nbConsumer: {instanceId: "browser-9", location: "browser", client: null, plugin: null, entry: null, generation: null, via: null}});
        await first.closed;
        pending[0]!.resolve();
        await drain();
        expect(released).toEqual(["browser-9"]);
        expect(bare.router.instances().map((instance) => instance.id)).toEqual(["hub"]);

        const second = rawLink(bare.router);
        second.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-10", kind: "browser", role: "client", project: null, client: null}, bind: {project: "p"}, boot: null});
        await drain();
        bare.router.close();
        await second.closed;
        pending[1]!.resolve();
        await drain();
        expect(released).toEqual(["browser-9", "browser-10"]);
        expect(second.frames).toEqual([]);
    });

    it("宿主给出 expect 的链路：描述不一致以 role 拒绝；一致的在停止接纳后照常登记", async () => {
        const t = await topology();
        const expected: InstanceDescriptor = {id: "project-Q-1", kind: "project", role: "project", project: {id: "Q", generation: 1}, client: null};
        const wrong = createLinkPair();
        t.router.accept(wrong.right, {expect: expected});
        const liar = createRemoteNode({instance: {...expected, project: {id: "Q", generation: 2}}});
        expect(await liar.connect(wrong.left)).toMatchObject({ok: false, reason: "role"});

        t.router.stopAdmission();
        const right = createLinkPair();
        t.router.accept(right.right, {expect: expected});
        expect(await createRemoteNode({instance: expected}).connect(right.left)).toEqual({ok: true});
        expect(t.router.instances().map((instance) => instance.id)).toContain("project-Q-1");
    });

    it("重连时 welcome 的绑定与记下的不同：节点不接受改投，按 project-gone 进入终态", async () => {
        let generation = 0;
        const bare = await bareHub({
            // 不按请求办事的宿主：每次都给新代次。节点是第二道防线。
            bindProject: async () => {
                generation += 1;
                return {ok: true, binding: {id: "P", name: "p", generation}, revoked: new AbortController().signal, release: () => undefined};
            },
        });
        const node = createRemoteNode({instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: null}, bind: {project: "p"}});
        const first = createLinkPair();
        bare.router.accept(first.right);
        expect(await node.connect(first.left)).toEqual({ok: true});
        first.left.close();
        await drain();

        const second = createLinkPair();
        bare.router.accept(second.right);
        expect(await node.connect(second.left)).toMatchObject({ok: false, reason: "project-gone"});
        expect(node.binding).toEqual({id: "P", name: "p", generation: 1});
    });
});

describe("Spec plugin-channel WebSocket 传输第 4 条：服务端重启", () => {
    it("连回另一个服务端进程：订阅以 server-restarted 结束且不重建，连接结果为 server-restarted；之后的调用为 unavailable，再连也是 server-restarted", async () => {
        const t = await topology();
        const ended: string[] = [];
        const resynced: number[] = [];
        await t.remote(t.browser1).use(echo).at("server").events.ticks.subscribe({topic: "a"}, () => undefined, {onEnd: (reason) => ended.push(reason), onResync: () => resynced.push(1)});
        await drain();
        t.links.get("browser-1")!.left.close();
        await drain();
        expect(ended).toEqual([]);

        // 第二个服务端进程：自己的服务端实例与路由，boot 不同。
        const restartedProbe = newProbe();
        const restarted = await start({id: "hub", kind: "server", role: "hub", project: null, client: null}, () => [provider("demo.server", "server", restartedProbe)], t.clock);
        const nextRouter = createRemoteRouter(restarted.node);
        const pair = createLinkPair();
        nextRouter.accept(pair.right);

        expect(await t.browser1.node.connect(pair.left)).toMatchObject({ok: false, reason: "server-restarted"});
        await drain();
        expect(ended).toEqual(["server-restarted"]);
        expect(resynced).toEqual([]);
        expect(restartedProbe.sinks).toEqual([]);
        expect(await t.remote(t.browser1).use(echo).at("server").whoami({})).toMatchObject({ok: false, code: "unavailable"});

        const again = createLinkPair();
        t.router.accept(again.right);
        expect(await t.browser1.node.connect(again.left)).toMatchObject({ok: false, reason: "server-restarted"});
    });
});

describe("Spec plugin-channel WebSocket 传输第 5 条：协议违规关闭链路", () => {
    it("握手完成前发送请求：路由不回复、关闭链路并记诊断", async () => {
        const t = await topology();
        const link = rawLink(t.router);
        link.send({type: "request", id: "x1", target: "server", contract: echo.id, version: 1, method: "whoami", effect: "read", input: {}, $nbConsumer: {instanceId: "x", location: "browser", client: null, plugin: null, entry: null, generation: null, via: null}, $nbChain: []});
        await link.closed;

        expect(link.frames).toEqual([]);
        expect(t.hub.node.diagnostics().map((diagnostic) => diagnostic.reason)).toContain("protocol-violation");
        expect(t.probes.hub.consumers).toEqual([]);
    });

    it("握手后收到无法解析的帧：链路关闭，对端在途请求立即按断开结算，不等超时", async () => {
        const t = await topology();
        const pending = t.remote(t.browser1).use(echo).at("project").hold({name: "w"}, {timeout: 60_000});
        await drain();

        t.links.get("browser-1")!.left.send({type: "teleport"} as never);
        expect(await pending).toEqual({ok: false, code: "unknown-outcome", cause: "disconnected"});
        expect(t.hub.node.diagnostics().filter((diagnostic) => diagnostic.reason === "protocol-violation")).toHaveLength(1);
    });
});

describe("Spec plugin-channel WebSocket 传输第 6 条：路由停止", () => {
    it("停止接纳：新 hello 以 stopping 拒绝，客户端的新请求与新订阅为 unavailable；项目成员照常", async () => {
        const t = await topology();
        t.router.stopAdmission();
        t.router.stopAdmission();

        const link = rawLink(t.router);
        link.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "browser-9", kind: "browser", role: "client", project: null, client: null}, bind: null, boot: null});
        await link.closed;
        expect(link.frames).toEqual([{type: "reject", reason: "stopping", message: expect.any(String)}]);

        const fromBrowser = t.remote(t.browser1).use(echo);
        expect(await fromBrowser.at("server").whoami({})).toMatchObject({ok: false, code: "unavailable", detail: "服务端正在停止"});
        expect(await fromBrowser.at({client: "browser-2"}).whoami({})).toMatchObject({ok: false, code: "unavailable"});
        expect(await fromBrowser.at("server").events.ticks.subscribe({topic: "a"}, () => undefined)).toMatchObject({ok: false, code: "unavailable"});
        expect(t.probes.hub.consumers).toEqual([]);
        expect(await t.remote(t.project).use(echo).at("server").whoami({})).toMatchObject({ok: true});
    });

    it("排空等已接纳的在途请求结算：客户端发给服务端的、转发给项目的、服务端插件发给客户端的，各自都要等", async () => {
        const cases: ReadonlyArray<{readonly label: string; send(t: Topology): Promise<unknown>; gate(t: Topology): PromiseWithResolvers<string>}> = [
            {label: "客户端 → 服务端", send: (t) => t.remote(t.browser1).use(echo).at("server").hold({name: "g"}), gate: (t) => t.probes.hub.gates.get("g")!},
            {label: "客户端 → 项目（转发）", send: (t) => t.remote(t.browser1).use(echo).at("project").hold({name: "g"}), gate: (t) => t.probes.project.gates.get("g")!},
            {label: "服务端插件 → 客户端", send: (t) => t.remote(t.hub).use(echo).at({client: "browser-2"}).hold({name: "g"}), gate: (t) => t.probes.browser2.gates.get("g")!},
        ];
        for (const {label, send, gate} of cases) {
            const t = await topology();
            const request = send(t);
            await drain();
            t.router.stopAdmission();
            const outcome: {drained: string | null} = {drained: null};
            const deadline = new AbortController();
            const draining = t.router.drain(deadline.signal).then((result) => {
                outcome.drained = result;
            });
            await drain();
            expect(outcome.drained, label).toBeNull();

            gate(t).resolve("done");
            await draining;
            expect(outcome.drained, label).toBe("drained");
            expect(await request, label).toEqual({ok: true, value: "done"});
            expect(await t.router.drain(deadline.signal), label).toBe("drained");
        }
    });

    it("排空到截止仍有在途请求：返回 deadline；关闭后成员全部断开，在途写请求为 unknown-outcome，新链路立即被关闭", async () => {
        const t = await topology();
        const stuck = t.remote(t.browser1).use(echo).at("server").hold({name: "never"});
        await drain();
        t.router.stopAdmission();
        const deadline = new AbortController();
        const draining = t.router.drain(deadline.signal);

        deadline.abort();
        expect(await draining).toBe("deadline");

        t.router.close();
        t.router.close();
        expect(await stuck).toEqual({ok: false, code: "unknown-outcome", cause: "disconnected"});
        await drain();
        expect(t.router.instances().map((instance) => instance.id)).toEqual(["hub"]);
        const late = rawLink(t.router);
        await late.closed;
        expect(late.frames).toEqual([]);
    });
});

describe("Spec plugin-channel 输出 1：合同的提供方位置", () => {
    const where = {input: Empty, output: Type.String(), effect: "read" as const};
    const tick = {filter: Empty, payload: Type.Null()};
    const atServer = defineRemoteService({id: "demo.where/server", version: 1, provider: "server", callers: ["browser", "project", "server"], methods: {where}, events: {tick}});
    const atProject = defineRemoteService({id: "demo.where/project", version: 1, provider: "project", callers: ["browser", "server"], methods: {where}});

    /** 回答自己所在位置的插件；`calls` 记下每次被调用，用来确认请求是否真的发出。 */
    function answering(id: string, location: string, contract: typeof atServer | typeof atProject, calls: string[]): PluginDefinition {
        return {
            id,
            entries: [{
                id: "main",
                location,
                remoteProvides: [contract.id],
                activate: () => ({
                    remote: [provideRemote(contract, () => ({
                        methods: {where: () => {
                            calls.push(location);
                            return {ok: true, value: location};
                        }},
                        events: {tick: {subscribe: () => undefined}},
                    }))],
                }),
            }],
        };
    }

    async function placed() {
        const clock = new ManualClock();
        const calls: string[] = [];
        const binding = {id: "P", generation: 1};
        const hub = await start({id: "hub", kind: "server", role: "hub", project: null, client: null}, (contexts) => [answering("demo.where-server", "server", atServer, calls), caller("app.caller", "server", contexts)], clock);
        const project = await start({id: "project-P", kind: "project", role: "project", project: binding, client: null}, () => [answering("demo.where-project", "project", atProject, calls)], clock);
        const browser = await start({id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}, (contexts) => [caller("app.caller", "browser", contexts)], clock, {bind: {project: "p"}});
        const router = createRemoteRouter(hub.node, {bindProject: projectsStandIn().bindProject, projectAccess: () => "allowed"});
        for (const instance of [project, browser]) {
            const pair = createLinkPair();
            router.accept(pair.right);
            expect(await instance.node.connect(pair.left)).toEqual({ok: true});
        }
        const remote = (instance: Instance): RemoteAccess => {
            const context = instance.contexts.get("app.caller");
            if (context === undefined) {
                throw new Error("没有调用方插件的激活上下文");
            }
            return context.remote;
        };
        return {calls, hub, browser, remote};
    }

    it("省略 .at() 时按提供方位置到达服务端或调用方绑定的项目；没有绑定的服务端插件用 {project} 指名", async () => {
        const t = await placed();
        expect(await t.remote(t.browser).use(atServer).where({})).toEqual({ok: true, value: "server"});
        expect(await t.remote(t.browser).use(atProject).where({})).toEqual({ok: true, value: "project"});
        expect(await t.remote(t.browser).use(atServer).at("server").where({})).toEqual({ok: true, value: "server"});
        expect(await t.remote(t.hub).use(atProject).at({project: "P"}).where({})).toEqual({ok: true, value: "project"});
        expect(t.calls).toEqual(["server", "project", "server", "project"]);
    });

    it("目标与提供方位置不符的调用与订阅在未派发阶段为 invalid-input，请求没有发出", async () => {
        const t = await placed();
        const browser = t.remote(t.browser);
        // @ts-expect-error 服务端合同只能发往服务端
        const misplacedServer = browser.use(atServer).at("project");
        // @ts-expect-error 项目合同不能发往客户端
        const misplacedProject = browser.use(atProject).at({client: "browser-1"});
        expect(await misplacedServer.where({})).toMatchObject({ok: false, code: "invalid-input"});
        expect(await misplacedServer.events.tick.subscribe({}, () => undefined)).toMatchObject({ok: false, code: "invalid-input"});
        expect(await misplacedProject.where({})).toMatchObject({ok: false, code: "invalid-input"});
        expect(t.calls).toEqual([]);
    });

    it("any 与 client 的合同推不出目标，必须写 .at()", async () => {
        const t = await placed();
        const use = t.remote(t.browser).use(echo);
        // @ts-expect-error 每个实例各有一份的合同没有缺省目标
        expect(use.whoami).toBeUndefined();
        expect(typeof use.at).toBe("function");
    });
});

describe("Spec plugins 输出 22：远程提供项的位置", () => {
    const atServer = defineRemoteService({id: "demo.where/server", version: 1, provider: "server", callers: ["browser"], methods: {where: {input: Empty, output: Type.String(), effect: "read"}}});
    const misplaced: PluginDefinition = {
        id: "demo.misplaced",
        entries: [{
            id: "main",
            location: "project",
            activationEvents: ["onStartup"],
            remoteProvides: [atServer.id],
            activate: () => ({remote: [provideRemote(atServer, () => ({methods: {where: () => ({ok: true, value: "project"})}}))]}),
        }],
    };

    it("合同的提供方位置与实例角色不符为输出阶段失败 remote-location-mismatch", async () => {
        const node = createRemoteNode({instance: {id: "project-P", kind: "project", role: "project", project: {id: "P", generation: 1}, client: null}});
        const app = createApplication(
            {identity: {location: "project", instanceId: "project-P"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {keys: [], plugins: [misplaced], gates: [], remote: node},
        );
        expect(await app.startup).toMatchObject({status: "available", failures: [{source: "demo.misplaced/main", reason: "output/remote-location-mismatch", required: false}]});
    });

    it("没有远程节点的实例不核对位置", async () => {
        const app = createApplication(
            {identity: {location: "project", instanceId: "project-P"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {keys: [], plugins: [misplaced], gates: [], remote: undefined},
        );
        expect(await app.startup).toMatchObject({status: "available", failures: []});
    });
});
