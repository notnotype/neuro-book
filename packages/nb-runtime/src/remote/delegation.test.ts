/**
 * 经代理的远程调用（runtime/plugin-channel.md 输出第 10 条、场景 19）：浏览器实例里的代理插件以签发给它的
 * 调用方身份调用服务端的远程服务。服务端是真实的应用实例与路由，浏览器是真实的运行实例、服务装配与插件宿主，
 * 两者经进程内链路连接；浏览器一侧直接用插件宿主，以便单独关闭某个插件的登记作用域。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {createApplication} from "../application/application";
import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {ManualClock} from "../lifecycle/testing/manual-clock";
import {createPluginHost, providePerConsumer} from "../plugins/plugins";
import type {PluginDefinition, PluginHost} from "../plugins/plugins";
import {createServiceAssembly, defineServiceKey} from "../services/services";
import type {ConsumerIdentity} from "../services/services";

import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote} from "./remote";
import type {RemoteResult} from "./remote";
import {createLinkPair} from "./testing/in-process";

const Empty = Type.Object({}, {additionalProperties: false});

const echo = defineRemoteService({
    id: "demo.server/echo",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {whoami: {input: Empty, output: Type.Unknown(), effect: "read"}},
    events: {ticks: {filter: Type.Object({topic: Type.String()}, {additionalProperties: false}), payload: Type.Integer()}},
});

/** 服务端同样提供，但代理没有在 `remoteDelegates` 里声明它。 */
const other = defineRemoteService({id: "demo.server/other", version: 1, provider: "server", callers: ["browser"], methods: {ping: {input: Empty, output: Type.Null(), effect: "read"}}});

/** 代理交给调用方的门面：以收到的调用方身份调用服务端。 */
interface Proxy {
    whoami(): Promise<RemoteResult<unknown>>;
    ping(): Promise<RemoteResult<null>>;
    /** 以指定身份代理，测试伪造与转交。 */
    whoamiAs(consumer: ConsumerIdentity): Promise<RemoteResult<unknown>>;
    identity(): ConsumerIdentity;
    subscribe(topic: string): Promise<RemoteResult<{release(): void}>>;
}

const proxyKey = defineServiceKey<Proxy>("app.proxy/echo");
const otherProxyKey = defineServiceKey<Proxy>("app.other-proxy/echo");

interface Server {
    /** 服务端看到的门面释放：`<插件> via <代理>`。 */
    readonly released: string[];
    readonly sinks: Array<{readonly topic: string; readonly signal: AbortSignal}>;
}

async function startServer(clock: ManualClock): Promise<{readonly server: Server; readonly router: ReturnType<typeof createRemoteRouter>}> {
    const server: Server = {released: [], sinks: []};
    const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}, clock});
    const plugin: PluginDefinition = {
        id: "demo.server",
        entries: [{
            id: "main",
            location: "server",
            remoteProvides: [echo.id, other.id],
            activate: () => ({
                remote: [
                    provideRemote(echo, (consumer) => ({
                        methods: {whoami: () => ({ok: true, value: consumer})},
                        events: {ticks: {subscribe: ({topic}, _sink, {signal}) => void server.sinks.push({topic, signal})}},
                    }), {release: (_implementation, consumer) => void server.released.push(`${consumer.plugin ?? "?"} via ${consumer.via?.plugin ?? "-"}`)}),
                    provideRemote(other, () => ({methods: {ping: () => ({ok: true, value: null})}})),
                ],
            }),
        }],
    };
    const app = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [], plugins: [plugin], gates: [], remote: node},
    );
    expect(await app.startup).toMatchObject({status: "available"});
    return {server, router: createRemoteRouter(node)};
}

/** 代理插件：为每个调用方提供 Proxy 门面；释放函数里再以该调用方身份调用一次，记下结果。 */
function proxyPlugin(id: string, key: typeof proxyKey, events: string[], remoteDelegates: ReadonlyArray<string> = [echo.id]): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "browser",
            provides: [key],
            remoteDelegates,
            activate: (context) => ({
                services: [providePerConsumer(key, (consumer): Proxy => ({
                    whoami: () => context.remote.on(consumer).use(echo).whoami({}),
                    ping: () => context.remote.on(consumer).use(other).ping({}),
                    whoamiAs: (identity) => context.remote.on(identity).use(echo).whoami({}),
                    identity: () => consumer,
                    subscribe: (topic) => context.remote.on(consumer).use(echo).events.ticks.subscribe({topic}, () => undefined),
                }), {
                    release: async (_facade, consumer) => {
                        const during = await context.remote.on(consumer).use(echo).whoami({});
                        events.push(`proxy-release ${consumer.plugin ?? "?"} ${during.ok ? "call-ok" : during.code}`);
                    },
                })],
            }),
        }],
    };
}

/** 调用方插件：依赖给出的代理，激活时把门面交给测试。 */
function userPlugin(id: string, keys: ReadonlyArray<typeof proxyKey>, captured: Map<string, Proxy[]>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "browser",
            dependencies: keys.map((key) => ({key})),
            activate: (context) => {
                captured.set(id, keys.map((key) => context.services.require(key)));
                return {};
            },
        }],
    };
}

interface Browser {
    readonly root: Scope;
    readonly host: PluginHost;
    readonly server: Server;
    readonly events: string[];
    readonly captured: Map<string, Proxy[]>;
}

async function setup(allowed: ReadonlyArray<string> = ["app.proxy", "app.other-proxy"], remoteDelegates?: ReadonlyArray<string>): Promise<Browser> {
    const clock = new ManualClock();
    const {server, router} = await startServer(clock);
    const node = createRemoteNode({instance: {id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}, clock});
    const runtime = createRuntimeInstance({location: "browser", instanceId: "browser-1", client: "profile-1"});
    runtime.root.open();
    const assembly = createServiceAssembly(runtime, {keys: [proxyKey, otherProxyKey]});
    const host = createPluginHost(runtime, assembly, {delegation: (plugin) => allowed.includes(plugin), remote: node});
    const pair = createLinkPair();
    router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    const events: string[] = [];
    expect(host.register(proxyPlugin("app.proxy", proxyKey, events, remoteDelegates), {scope: runtime.root})).toMatchObject({status: "accepted"});
    expect(host.register(proxyPlugin("app.other-proxy", otherProxyKey, events), {scope: runtime.root})).toMatchObject({status: "accepted"});
    return {root: runtime.root, host, server, events, captured: new Map()};
}

function openedChild(parent: Scope, label: string): Scope {
    const child = parent.createChild(label);
    child.open();
    return child;
}

/** 让微任务里的投递走完；不按时间等待。 */
async function drain(rounds = 20): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

async function activateUser(b: Browser, keys: ReadonlyArray<typeof proxyKey> = [proxyKey], scope: Scope = b.root): Promise<Proxy[]> {
    expect(b.host.register(userPlugin("app.user", keys, b.captured), {scope})).toMatchObject({status: "accepted"});
    expect(await b.host.activate({plugin: "app.user", entry: "main"})).toMatchObject({status: "activated"});
    return b.captured.get("app.user")!;
}

describe("Spec plugin-channel 输出 10、场景 19：经代理的远程调用", () => {
    it("提供方看到的调用方是原插件（带客户端身份），via 为代理入口", async () => {
        const b = await setup();
        const [proxy] = await activateUser(b);

        expect(await proxy!.whoami()).toEqual({
            ok: true,
            value: {instanceId: "browser-1", location: "browser", client: "profile-1", plugin: "app.user", entry: "main", generation: 1, via: {plugin: "app.proxy", entry: "main", generation: 1}},
        });
    });

    it("拒绝：伪造的身份、签发给别的入口的身份、未声明的合同、不在允许清单的插件，都是 denied 且没有发出请求", async () => {
        const b = await setup();
        const [proxy, otherProxy] = await activateUser(b, [proxyKey, otherProxyKey]);

        expect(await proxy!.whoamiAs({...proxy!.identity()})).toMatchObject({ok: false, code: "denied", detail: "调用方身份不是装配签发的"});
        expect(await proxy!.whoamiAs(otherProxy!.identity())).toMatchObject({ok: false, code: "denied", detail: "调用方身份签发给其它入口的门面"});
        expect(await proxy!.ping()).toMatchObject({ok: false, code: "denied"});

        const unlisted = await setup(["app.other-proxy"]);
        const [notAllowed] = await activateUser(unlisted);
        expect(await notAllowed!.whoami()).toMatchObject({ok: false, code: "denied"});
        expect(await notAllowed!.subscribe("a")).toMatchObject({ok: false, code: "denied"});
        await drain();
        expect(unlisted.server.sinks).toEqual([]);
    });

    it("原调用方入口停止（代理仍在）：代理的释放函数运行时仍可调用，之后经代理的订阅结束、服务端释放为它生成的门面", async () => {
        const b = await setup();
        const registration = openedChild(b.root, "user-registration");
        const [proxy] = await activateUser(b, [proxyKey], registration);
        expect(await proxy!.whoami()).toMatchObject({ok: true});
        expect(await proxy!.subscribe("a")).toMatchObject({ok: true});
        await drain();
        expect(b.server.sinks.map((sink) => sink.topic)).toEqual(["a"]);

        expect(await registration.close()).toMatchObject({status: "closed"});
        await drain();

        expect(b.events).toEqual(["proxy-release app.user call-ok"]);
        expect(b.server.sinks[0]!.signal.aborted).toBe(true);
        expect(b.server.released).toEqual(["app.user via app.proxy"]);
        expect(b.host.entryState({plugin: "app.proxy", entry: "main"})).toMatchObject({status: "available", generation: 1});
    });
});
