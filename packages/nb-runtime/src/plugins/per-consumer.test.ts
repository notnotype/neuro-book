import {describe, expect, it} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";
import {createServiceAssembly, defineServiceKey, ServiceRevokedError} from "../services/services";
import type {ConsumerIdentity} from "../services/services";

import {createPluginHost, providePerConsumer} from "./plugins";
import type {ActivationContext, PluginDefinition, PluginHost} from "./plugins";

interface Store {
    who(): ConsumerIdentity;
}

const storeKey = defineServiceKey<Store>("store/data");

interface Fixture {
    readonly root: Scope;
    readonly host: PluginHost;
    readonly released: ConsumerIdentity[];
}

function setup(): Fixture {
    const runtime = createRuntimeInstance({location: "server", instanceId: "server-1"});
    runtime.root.open();
    const assembly = createServiceAssembly(runtime, {});
    const host = createPluginHost(runtime, assembly, {});
    const released: ConsumerIdentity[] = [];
    const store: PluginDefinition = {
        id: "store",
        entries: [{
            id: "main",
            location: "server",
            provides: [storeKey],
            activate: () => ({
                services: [providePerConsumer(storeKey, (consumer) => ({who: () => consumer}), {release: (_facade, consumer) => void released.push(consumer)})],
            }),
        }],
    };
    expect(host.register(store, {scope: runtime.root})).toMatchObject({status: "accepted"});
    return {root: runtime.root, host, released};
}

/** 必需依赖 store 的插件；激活时把取到的门面交给 `onActivate`。 */
function consumer(id: string, onActivate: (context: ActivationContext, store: Store) => void | Promise<void>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "server",
            dependencies: [{key: storeKey}],
            activate: async (context) => {
                await onActivate(context, context.services.require(storeKey));
                return {};
            },
        }],
    };
}

function openedChild(parent: Scope, label: string): Scope {
    const child = parent.createChild(label);
    child.open();
    return child;
}

describe("Spec plugins 输出 19：按调用方提供项", () => {
    it("两个插件各得自己的门面，并看到自己的插件、入口与激活代次", async () => {
        const {root, host} = setup();
        const seen = new Map<string, {readonly facade: Store; readonly identity: ConsumerIdentity}>();
        for (const id of ["alpha", "beta"]) {
            expect(host.register(consumer(id, (_context, store) => void seen.set(id, {facade: store, identity: store.who()})), {scope: root})).toMatchObject({status: "accepted"});
            expect(await host.activate({plugin: id, entry: "main"})).toMatchObject({status: "activated", generation: 1});
        }

        expect(seen.get("alpha")?.facade).not.toBe(seen.get("beta")?.facade);
        expect(seen.get("alpha")?.identity).toEqual({instanceId: "server-1", location: "server", client: null, plugin: "alpha", entry: "main", generation: 1, via: null});
        expect(seen.get("beta")?.identity).toMatchObject({plugin: "beta", entry: "main", generation: 1});
    });

    it("同一次激活里必需依赖与 context.services.resolve 得到同一门面", async () => {
        const {root, host} = setup();
        let required: Store | null = null;
        let resolved: unknown = null;
        host.register(
            consumer("alpha", async (context, store) => {
                required = store;
                const result = await context.services.resolve(storeKey);
                resolved = result.status === "resolved" ? result.instance : result;
            }),
            {scope: root},
        );

        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated"});
        expect(resolved).toBe(required);
    });

    it("入口停止后旧门面作废、释放函数收到旧调用方；重新登记激活得到新代次的新门面", async () => {
        const {root, host, released} = setup();
        let current: Store | null = null;
        const definition = consumer("alpha", (_context, store) => {
            current = store;
        });

        const first = openedChild(root, "registration-1");
        host.register(definition, {scope: first});
        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated", generation: 1});
        const old = current as unknown as Store;
        const oldIdentity = old.who();

        expect(await first.close()).toMatchObject({status: "closed"});
        expect(() => old.who()).toThrow(ServiceRevokedError);
        expect(released).toEqual([oldIdentity]);

        const second = openedChild(root, "registration-2");
        host.register(definition, {scope: second});
        expect(await host.activate({plugin: "alpha", entry: "main"})).toMatchObject({status: "activated", generation: 2});
        const fresh = current as unknown as Store;
        expect(fresh).not.toBe(old);
        expect(fresh.who()).toMatchObject({plugin: "alpha", generation: 2});
        expect(() => old.who()).toThrow(ServiceRevokedError);
    });
});
