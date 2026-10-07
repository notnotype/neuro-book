import {describe, expect, it} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly, defineServiceKey, ServiceRevokedError} from "../services/services";
import type {ConsumerIdentity, ResolveResult} from "../services/services";

import {createPluginHost, providePerConsumer} from "./plugins";
import type {ActivationContext, PluginDefinition, PluginHost} from "./plugins";

interface Store {
    who(): ConsumerIdentity;
}

/** 代理交给调用方的门面：经委托取得 store 门面后返回 store 看到的身份。 */
interface Proxy {
    whoAtStore(): Promise<ConsumerIdentity>;
    /** 用指定身份委托，测试伪造与转交。 */
    delegateAs(consumer: ConsumerIdentity): Promise<ResolveResult<Store>>;
    identity(): ConsumerIdentity;
}

const storeKey = defineServiceKey<Store>("store/data");
const proxyKey = defineServiceKey<Proxy>("proxy/data");
const otherProxyKey = defineServiceKey<Proxy>("other/data");

interface Fixture {
    readonly root: Scope;
    readonly host: PluginHost;
    /** 按发生顺序记录：`store-release <插件>`、`proxy-release <插件> uses <store 看到的插件>`。 */
    readonly events: string[];
}

function storePlugin(events: string[]): PluginDefinition {
    return {
        id: "store",
        entries: [{
            id: "main",
            location: "server",
            provides: [storeKey],
            activate: () => ({
                services: [providePerConsumer(storeKey, (consumer) => ({who: () => consumer}), {
                    release: (_facade, consumer) => void events.push(`store-release ${consumer.plugin ?? "?"} via ${consumer.via?.plugin ?? "-"}`),
                })],
            }),
        }],
    };
}

/** 代理插件：依赖并可代理 store，为每个调用方提供 Proxy 门面；释放时仍使用委托取得的 store 门面。 */
function proxyPlugin(id: string, key: typeof proxyKey, events: string[], options: {readonly delegates?: boolean} = {}): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "server",
            dependencies: [{key: storeKey}],
            delegates: options.delegates === false ? [] : [storeKey],
            provides: [key],
            activate: (context: ActivationContext) => {
                const delegated = new Map<ConsumerIdentity, Store>();
                const storeFor = async (consumer: ConsumerIdentity): Promise<Store> => {
                    const result = await context.services.resolveFor(consumer, storeKey);
                    if (result.status !== "resolved") {
                        throw new Error(`委托失败：${result.reason} ${result.error?.message ?? ""}`);
                    }
                    delegated.set(consumer, result.instance);
                    return result.instance;
                };
                return {
                    services: [providePerConsumer(key, (consumer): Proxy => ({
                        whoAtStore: async () => (await storeFor(consumer)).who(),
                        delegateAs: (other) => context.services.resolveFor(other, storeKey),
                        identity: () => consumer,
                    }), {
                        release: (_facade, consumer) => {
                            const store = delegated.get(consumer);
                            events.push(`proxy-release ${consumer.plugin ?? "?"} uses ${store === undefined ? "-" : (store.who().plugin ?? "?")}`);
                        },
                    })],
                };
            },
        }],
    };
}

/** 调用方插件：依赖代理与 store 本身，激活时把两个门面交给 `onActivate`。 */
function callerPlugin(id: string, key: typeof proxyKey, onActivate: (proxy: Proxy, store: Store) => void | Promise<void>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "server",
            dependencies: [{key}, {key: storeKey}],
            activate: async (context) => {
                await onActivate(context.services.require(key), context.services.require(storeKey));
                return {};
            },
        }],
    };
}

function setup(allowed: ReadonlyArray<string> = ["proxy", "other"]): Fixture {
    const runtime = createRuntimeInstance({location: "server", instanceId: "server-1"});
    runtime.root.open();
    const assembly = createServiceAssembly(runtime, {keys: [storeKey, proxyKey, otherProxyKey]});
    const host = createPluginHost(runtime, assembly, {delegation: (pluginId) => allowed.includes(pluginId)});
    const events: string[] = [];
    expect(host.register(storePlugin(events), {scope: runtime.root})).toMatchObject({status: "accepted"});
    expect(host.register(proxyPlugin("proxy", proxyKey, events), {scope: runtime.root})).toMatchObject({status: "accepted"});
    return {root: runtime.root, host, events};
}

function openedChild(parent: Scope, label: string): Scope {
    const child = parent.createChild(label);
    child.open();
    return child;
}

describe("Spec services 输出 13、plugins 输出 20：委托", () => {
    it("A 经代理 P 访问 store：store 看到的调用方是 A，via 为 P；与 A 直接访问 store 是同一插件身份", async () => {
        const {root, host} = setup();
        // 在回调里赋值；用断言声明类型，避免控制流把它们收窄成 null。
        let viaProxy = null as ConsumerIdentity | null;
        let direct = null as ConsumerIdentity | null;
        host.register(
            callerPlugin("alpha", proxyKey, async (proxy, store) => {
                viaProxy = await proxy.whoAtStore();
                direct = store.who();
            }),
            {scope: root},
        );

        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated"});

        expect(viaProxy).toEqual({instanceId: "server-1", location: "server", client: null, plugin: "alpha", entry: "main", generation: 1, via: {plugin: "proxy", entry: "main", generation: 1}});
        expect(direct).toEqual({instanceId: "server-1", location: "server", client: null, plugin: "alpha", entry: "main", generation: 1, via: null});
    });

    it("A 停止：代理的释放函数先运行且仍能使用委托取得的门面，之后委托门面才释放并作废", async () => {
        const {root, host, events} = setup();
        const registration = openedChild(root, "alpha-registration");
        let proxyFacade: Proxy | null = null;
        host.register(
            callerPlugin("alpha", proxyKey, async (proxy) => {
                proxyFacade = proxy;
                await proxy.whoAtStore();
            }),
            {scope: registration},
        );
        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated"});

        expect(await registration.close()).toMatchObject({status: "closed"});

        const proxyRelease = events.indexOf("proxy-release alpha uses alpha");
        const delegatedRelease = events.indexOf("store-release alpha via proxy");
        expect(proxyRelease).toBeGreaterThanOrEqual(0);
        expect(delegatedRelease).toBeGreaterThan(proxyRelease);
        expect(() => (proxyFacade as unknown as Proxy).identity()).toThrow(ServiceRevokedError);
    });

    it("拒绝：插件不在代理允许清单", async () => {
        const {root, host} = setup(["other"]);
        let message = "";
        host.register(
            callerPlugin("alpha", proxyKey, async (proxy) => {
                message = await proxy.whoAtStore().then(() => "", (error: Error) => error.message);
            }),
            {scope: root},
        );

        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated"});
        expect(message).toContain("delegation-denied");
        expect(message).toContain("允许清单");
    });

    it("拒绝：入口没有把键声明为可代理", async () => {
        const {root, host, events} = setup();
        host.register(proxyPlugin("other", otherProxyKey, events, {delegates: false}), {scope: root});
        let message = "";
        host.register(
            callerPlugin("alpha", otherProxyKey, async (proxy) => {
                message = await proxy.whoAtStore().then(() => "", (error: Error) => error.message);
            }),
            {scope: root},
        );

        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated"});
        expect(message).toContain("delegation-denied");
        expect(message).toContain("没有声明可代理");
    });

    it("拒绝：伪造的身份对象（字段相同但不是装配签发的）", async () => {
        const {root, host} = setup();
        let result: ResolveResult<Store> | null = null;
        host.register(
            callerPlugin("alpha", proxyKey, async (proxy) => {
                result = await proxy.delegateAs({...proxy.identity()});
            }),
            {scope: root},
        );

        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated"});
        expect(result).toMatchObject({status: "unavailable", reason: "delegation-denied", error: {message: expect.stringContaining("不是装配签发")}});
    });

    it("拒绝：身份签发给其它入口的门面", async () => {
        const {root, host, events} = setup();
        host.register(proxyPlugin("other", otherProxyKey, events), {scope: root});
        let result: ResolveResult<Store> | null = null;
        host.register(
            {
                id: "beta",
                entries: [{
                    id: "main",
                    location: "server",
                    dependencies: [{key: otherProxyKey}, {key: proxyKey}],
                    activate: async (context) => {
                        const issuedByProxy = context.services.require(proxyKey).identity();
                        result = await context.services.require(otherProxyKey).delegateAs(issuedByProxy);
                        return {};
                    },
                }],
            },
            {scope: root},
        );

        expect(await host.activate({plugin: "beta", entry: "main"})).toMatchObject({status: "activated"});
        expect(result).toMatchObject({status: "unavailable", reason: "delegation-denied", error: {message: expect.stringContaining("其它入口")}});
    });
});
