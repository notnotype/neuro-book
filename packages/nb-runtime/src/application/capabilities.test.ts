import {describe, expect, it} from "bun:test";

import type {PluginDefinition} from "../plugins/plugins";
import {defineServiceKey, perConsumer, ServiceRevokedError} from "../services/services";
import type {ConsumerIdentity} from "../services/services";

import {createApplication} from "./application";

interface Registry {
    who(): ConsumerIdentity;
}

const registryKey = defineServiceKey<Registry>("host/registry");

/** 启动即激活、依赖宿主能力的插件；把取到的门面交给测试。 */
function consumer(id: string, seen: Map<string, Registry>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: registryKey}],
            activate: (context) => {
                seen.set(id, context.services.require(registryKey));
                return {};
            },
        }],
    };
}

describe("Spec application 清单：本地能力按调用方门面", () => {
    it("宿主能力返回 perConsumer：每个插件入口各得一个门面并看到自己的身份；实例停止时逐个释放，旧门面作废", async () => {
        const seen = new Map<string, Registry>();
        const released: string[] = [];
        const app = createApplication(
            {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                keys: [registryKey],
                capabilities: [{
                    id: "host.registry",
                    key: registryKey,
                    create: () => perConsumer((who: ConsumerIdentity) => ({who: () => who}), (_facade, who) => void released.push(`${who.plugin ?? "?"}#${String(who.generation)}`)),
                }],
                plugins: [consumer("demo.a", seen), consumer("demo.b", seen)],
                gates: [],
            },
        );
        expect(await app.startup).toMatchObject({status: "available"});

        const a = seen.get("demo.a")!;
        const b = seen.get("demo.b")!;
        expect(a).not.toBe(b);
        expect(a.who()).toMatchObject({instanceId: "hub", plugin: "demo.a", entry: "main", generation: 1, via: null});
        expect(b.who()).toMatchObject({plugin: "demo.b", entry: "main", generation: 1});

        expect(await app.stop()).toMatchObject({status: "closed"});
        expect(released.sort()).toEqual(["demo.a#1", "demo.b#1"]);
        expect(() => a.who()).toThrow(ServiceRevokedError);
    });
});
