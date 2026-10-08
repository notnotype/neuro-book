/**
 * 示例 5：代理插件。浏览器窗口里的插件像用本地服务一样用笔记，数据却存在服务端，并按调用方插件分开。
 *
 * - 服务端的 `example.notes-store` 以远程服务提供读写，按调用方插件分开数据（同示例 2、4）。
 * - 窗口里的 `example.notes-proxy` 给每个调用方插件生成本地门面（`providePerConsumer`），门面的方法以
 *   **收到的调用方身份** 转发：`context.remote.on(调用方).use(合同)`。服务端看到的调用方是原插件，`via` 是代理；
 *   如果代理用自己的身份转发，服务端看到的就全是代理，所有插件的数据会混在一起。
 * - 以调用方身份转发是受控能力：入口在 `remoteDelegates` 里声明要代理的合同，插件还要在宿主给的代理允许清单
 *   （清单的 `delegation`）里；伪造的身份对象、别的入口签发的身份、签发它的门面已释放，都得到 `denied`。
 * - `remote.on` 要在门面方法被调用时取，不能在门面工厂里取：工厂返回之后内核才签发这个身份。
 *
 * `nbook.storage` 的浏览器入口就是这样把读写转给分区的拥有者。
 * 行为合同：docs/specs/runtime/services.md 输出第 13 条、docs/specs/runtime/plugin-channel.md 输出第 10 条。
 * 运行：`bun packages/nb-runtime/examples/05-delegating-proxy.ts`。
 */

import {Type} from "typebox";

import {createApplication} from "@notnotype/nb-runtime/application";
import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {defineServiceKey} from "@notnotype/nb-runtime/services";

export const notesStoreContract = defineRemoteService({
    id: "example.notes-store/notes",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        write: {input: Type.Object({text: Type.String()}, {additionalProperties: false}), output: Type.Null(), effect: "write"},
        read: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(Type.String()), effect: "read"},
    },
});

/** 服务端：按调用方插件分开存笔记，并记下每次写入是谁、经谁代理。 */
export function notesStorePlugin(log: string[]): PluginDefinition {
    return {
        id: "example.notes-store",
        entries: [{
            id: "server",
            location: "server",
            remoteProvides: [notesStoreContract.id],
            activate: () => {
                const byPlugin = new Map<string, string[]>();
                return {
                    remote: [provideRemote(notesStoreContract, (consumer) => {
                        const owner = consumer.plugin ?? "host";
                        return {
                            methods: {
                                write: ({text}) => {
                                    byPlugin.set(owner, [...(byPlugin.get(owner) ?? []), text]);
                                    log.push(`${owner} 经 ${consumer.via?.plugin ?? "（直接）"} 写入`);
                                    return {ok: true, value: null};
                                },
                                read: () => ({ok: true, value: byPlugin.get(owner) ?? []}),
                            },
                        };
                    })],
                };
            },
        }],
    };
}

/** 代理给窗口里的插件的本地接口。 */
export interface Notes {
    write(text: string): Promise<RemoteResult<null>>;
    read(): Promise<RemoteResult<ReadonlyArray<string>>>;
}

export const notesKey = defineServiceKey<Notes>("example.notes-proxy/notes");

export function notesProxyPlugin(): PluginDefinition {
    return {
        id: "example.notes-proxy",
        entries: [{
            id: "browser",
            location: "browser",
            provides: [notesKey],
            remoteDelegates: [notesStoreContract.id],
            activate: (context) => ({
                services: [providePerConsumer(notesKey, (consumer): Notes => {
                    // 每次调用时才取：工厂运行时 consumer 还没签发完。
                    const store = () => context.remote.on(consumer).use(notesStoreContract).at("server");
                    return {
                        write: (text) => store().write({text}),
                        read: () => store().read({}),
                    };
                })],
            }),
        }],
    };
}

/** 窗口里使用笔记的插件：把拿到的门面交给示例。 */
function writerPlugin(id: string, captured: Map<string, Notes>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: notesKey}],
            activate: (context) => {
                captured.set(id, context.services.require(notesKey));
                return {};
            },
        }],
    };
}

const quietHost = {stopSignal: new AbortController().signal, emergency: () => undefined};

export async function runDelegatingProxyExample(): Promise<{readonly log: ReadonlyArray<string>; readonly reads: Readonly<Record<string, unknown>>}> {
    const log: string[] = [];
    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    const hub = createApplication({...quietHost, identity: {location: "server", instanceId: "hub"}}, {keys: [], plugins: [notesStorePlugin(log)], gates: [], remote: hubNode});
    await hub.startup;
    const router = createRemoteRouter(hubNode);

    const windowNode = createRemoteNode({instance: {id: "window-1", kind: "browser", role: "client", project: null, client: "profile-1"}});
    const link = createLinkPair();
    router.accept(link.right);
    await windowNode.connect(link.left);
    const captured = new Map<string, Notes>();
    const window = createApplication(
        {...quietHost, identity: {location: "browser", instanceId: "window-1", client: "profile-1"}},
        {
            keys: [notesKey],
            plugins: [notesProxyPlugin(), writerPlugin("example.a", captured), writerPlugin("example.b", captured)],
            gates: [],
            remote: windowNode,
            // 代理允许清单：只有列在这里的插件能以调用方的身份转发。
            delegation: (plugin) => plugin === "example.notes-proxy",
        },
    );
    await window.startup;

    const a = captured.get("example.a")!;
    const b = captured.get("example.b")!;
    await a.write("A 的笔记");
    await b.write("B 的笔记");
    const reads = {"example.a": await a.read(), "example.b": await b.read()};

    await window.stop();
    await hub.stop();
    router.close();
    return {log, reads};
}

if (import.meta.main) {
    console.log(JSON.stringify(await runDelegatingProxyExample(), null, 2));
}
