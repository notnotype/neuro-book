import {describe, expect, it} from "bun:test";

import {createRuntimeInstance} from "../lifecycle/lifecycle";
import type {Scope} from "../lifecycle/lifecycle";

import {createServiceAssembly, defineServiceKey, perConsumer, ServiceRevokedError} from "./services";
import type {ConsumerIdentity, ServiceAssembly} from "./services";

interface Store {
    who(): ConsumerIdentity;
    write(value: string): string;
}

const storeKey = defineServiceKey<Store>("test/store");

interface Fixture {
    readonly root: Scope;
    readonly assembly: ServiceAssembly;
    readonly released: Array<{readonly facade: Store; readonly consumer: ConsumerIdentity}>;
}

/** 根作用域上声明一个按调用方提供的 store，与一个没有插件身份的消费者入口。 */
function setup(options: {readonly facade?: (consumer: ConsumerIdentity) => Store; readonly release?: (facade: Store) => void} = {}): Fixture {
    const runtime = createRuntimeInstance({location: "server", instanceId: "server-1"});
    runtime.root.open();
    const assembly = createServiceAssembly(runtime, {keys: [storeKey]});
    const released: Fixture["released"] = [];
    const facade = options.facade ?? ((consumer: ConsumerIdentity): Store => ({who: () => consumer, write: (value) => `${consumer.entry ?? "host"}:${value}`}));
    expect(
        assembly.declare({
            id: "store",
            key: storeKey,
            location: "server",
            scope: runtime.root,
            create: () =>
                perConsumer(facade, (instance, consumer) => {
                    released.push({facade: instance, consumer});
                    options.release?.(instance);
                }),
        }),
    ).toMatchObject({status: "accepted"});
    expect(assembly.declare({id: "host-consumer", location: "server", scope: runtime.root, dependencies: [{key: storeKey}]})).toMatchObject({status: "accepted"});
    return {root: runtime.root, assembly, released};
}

function openedChild(parent: Scope, label: string): Scope {
    const child = parent.createChild(label);
    child.open();
    return child;
}

async function resolveStore(assembly: ServiceAssembly, scope: Scope): Promise<Store> {
    const result = await assembly.access("host-consumer", scope).resolve(storeKey);
    if (result.status !== "resolved") {
        throw new Error(`期望解析成功：${result.reason}`);
    }
    return result.instance;
}

describe("Spec services 输出 11–12：按调用方门面（装配层）", () => {
    it("没有激活代次的调用方按访问作用域各得一个门面；同一访问作用域重复解析得到同一门面；身份由装配填写", async () => {
        const {root, assembly} = setup();
        const first = openedChild(root, "op-1");
        const second = openedChild(root, "op-2");

        const a = await resolveStore(assembly, first);
        const again = await resolveStore(assembly, first);
        const b = await resolveStore(assembly, second);

        expect(again).toBe(a);
        expect(b).not.toBe(a);
        expect(a.who()).toEqual({instanceId: "server-1", location: "server", plugin: null, entry: null, generation: null, via: null});
        expect(Object.isFrozen(a.who())).toBe(true);
    });

    it("调用方作用域关闭：释放函数收到这个门面与调用方，之后访问门面或先取出的方法都抛 ServiceRevokedError", async () => {
        const {root, assembly, released} = setup();
        const scope = openedChild(root, "op");
        const store = await resolveStore(assembly, scope);
        const write = store.write;
        const identity = store.who();
        expect(write("draft")).toBe("host:draft");

        expect(await scope.close()).toMatchObject({status: "closed"});

        expect(released).toHaveLength(1);
        expect(released[0]?.consumer).toBe(identity);
        expect(released[0]?.facade.write("raw")).toBe("host:raw");
        expect(() => store.write("late")).toThrow(ServiceRevokedError);
        expect(() => write("late")).toThrow(ServiceRevokedError);
        expect(() => store.who()).toThrow(ServiceRevokedError);
    });

    it("门面不是 thenable：作废后仍可被 await 或从 async 函数返回", async () => {
        const {root, assembly} = setup();
        const scope = openedChild(root, "op");
        const store = await resolveStore(assembly, scope);
        await scope.close();

        const passthrough = async (): Promise<Store> => store;
        expect(await passthrough()).toBe(store);
    });

    it("释放函数抛错：调用方作用域关闭未完成，失败记录可查，门面仍然作废", async () => {
        const {root, assembly} = setup({
            release: () => {
                throw new Error("flush failed");
            },
        });
        const scope = openedChild(root, "op");
        const store = await resolveStore(assembly, scope);

        const result = await scope.close();

        expect(result).toMatchObject({status: "incomplete", reason: "release-failed"});
        expect(result.status === "incomplete" ? result.failures.map((failure) => failure.error.message) : []).toEqual(["flush failed"]);
        expect(() => store.who()).toThrow(ServiceRevokedError);
    });

    it("工厂抛错或返回非对象：这次解析为 initialization-failed 并记诊断，其它调用方照常", async () => {
        let mode: "throw" | "primitive" | "ok" = "throw";
        const {root, assembly} = setup({
            facade: (consumer) => {
                if (mode === "throw") {
                    throw new Error("no quota");
                }
                if (mode === "primitive") {
                    return 42 as unknown as Store;
                }
                return {who: () => consumer, write: (value) => value};
            },
        });

        const failed = await assembly.access("host-consumer", openedChild(root, "op-1")).resolve(storeKey);
        mode = "primitive";
        const notObject = await assembly.access("host-consumer", openedChild(root, "op-2")).resolve(storeKey);
        mode = "ok";
        const ok = await assembly.access("host-consumer", openedChild(root, "op-3")).resolve(storeKey);

        expect(failed).toMatchObject({status: "unavailable", reason: "initialization-failed", providerId: "store", error: {message: "no quota"}});
        expect(notObject).toMatchObject({status: "unavailable", reason: "initialization-failed", providerId: "store"});
        expect(ok).toMatchObject({status: "resolved"});
        expect(assembly.diagnostics().map((diagnostic) => diagnostic.reason)).toEqual(expect.arrayContaining(["facade-failed", "facade-not-object"]));
    });
});
