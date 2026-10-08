/**
 * 示例 4：跨实例的远程服务。服务端实例里的插件提供计数器，浏览器窗口实例里的插件调用它、订阅它的变化。
 *
 * - **合同**（`defineRemoteService`）：id、版本、提供方位置、允许的调用方、方法（输入输出 schema 与读写类型）
 *   与事件。两端共用同一份合同：提供方按 schema 校验输入与输出，调用方再核对一次输出。
 * - **提供方**：入口声明 `remoteProvides`、不声明启动激活，第一次有调用到达时内核才激活它（`onRemote`）。
 *   `provideRemote` 的工厂收到调用方身份，和示例 2 的按调用方门面同一机制。
 * - **调用方**：`context.remote.use(合同).at(目标)` 得到客户端；方法返回 `{ok, value}` 或带失败码的结果，
 *   不抛异常。订阅返回可释放的句柄，提供方停止或连接结束时以 `onEnd` 结束。
 * - **连接**：服务端有路由（`createRemoteRouter`），窗口的远程节点经链路连上它。产品里链路是 WebSocket
 *   （`packages/neuro-book/src/shared/rpc-socket.ts`）；这里用测试支持里的进程内链路，帧照样经 JSON 编解码。
 *
 * 行为合同：docs/specs/runtime/plugin-channel.md。
 * 运行：`bun packages/nb-runtime/examples/04-remote-service.ts`。
 */

import {Type} from "typebox";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

export const counterContract = defineRemoteService({
    id: "example.counter/counter",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        increment: {input: Type.Object({by: Type.Integer({minimum: 1})}, {additionalProperties: false}), output: Type.Integer(), effect: "write"},
        current: {input: Type.Object({}, {additionalProperties: false}), output: Type.Integer(), effect: "read"},
    },
    events: {
        changed: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Integer()},
    },
});

export function counterPlugin(log: string[]): PluginDefinition {
    return {
        id: "example.counter",
        entries: [{
            id: "server",
            location: "server",
            remoteProvides: [counterContract.id],
            activate: () => {
                log.push("counter 激活");
                let count = 0;
                const sinks = new Set<(value: number) => void>();
                return {
                    remote: [provideRemote(counterContract, (consumer) => ({
                        methods: {
                            increment: ({by}) => {
                                count += by;
                                log.push(`${consumer.plugin ?? "?"}@${consumer.instanceId} 加了 ${String(by)}`);
                                for (const sink of sinks) sink(count);
                                return {ok: true, value: count};
                            },
                            current: () => ({ok: true, value: count}),
                        },
                        events: {
                            changed: {
                                // 每个订阅调用一次；订阅结束（调用方释放、任一端停止、连接断开）时 signal 触发。
                                subscribe: (_filter, sink, {signal}) => {
                                    const next = (value: number): void => sink.next(value);
                                    sinks.add(next);
                                    signal.addEventListener("abort", () => sinks.delete(next), {once: true});
                                },
                            },
                        },
                    }))],
                };
            },
        }],
    };
}

/** 窗口里的调用方：启动即激活，把激活上下文交给示例。 */
function panelPlugin(captured: {context: ActivationContext | null}): PluginDefinition {
    return {
        id: "example.panel",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            activate: (context) => {
                captured.context = context;
                return {};
            },
        }],
    };
}

const quietHost = {stopSignal: new AbortController().signal, emergency: () => undefined};

export async function runRemoteServiceExample(): Promise<{readonly log: ReadonlyArray<string>; readonly results: ReadonlyArray<unknown>; readonly seen: ReadonlyArray<number>}> {
    const log: string[] = [];

    // 服务端实例：远程节点 + 路由。
    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    const hub = createApplication({...quietHost, identity: {location: "server", instanceId: "hub"}}, {keys: [], plugins: [counterPlugin(log)], gates: [], remote: hubNode});
    await hub.startup;
    const router = createRemoteRouter(hubNode);

    // 窗口实例：先连上服务端，再起运行实例。
    const windowNode = createRemoteNode({instance: {id: "window-1", kind: "browser", role: "client", project: null, client: "profile-1"}});
    const link = createLinkPair();
    router.accept(link.right);
    await windowNode.connect(link.left);
    const captured: {context: ActivationContext | null} = {context: null};
    const window = createApplication({...quietHost, identity: {location: "browser", instanceId: "window-1", client: "profile-1"}}, {keys: [], plugins: [panelPlugin(captured)], gates: [], remote: windowNode});
    await window.startup;
    log.push("两个实例都已启动");

    const counter = captured.context!.remote.use(counterContract).at("server");
    const seen: number[] = [];
    const subscription = await counter.events.changed.subscribe({}, (value) => seen.push(value));
    const results = [
        await counter.increment({by: 2}),
        await counter.increment({by: 3}),
        await counter.current({}),
        // 输入不合合同：提供方在执行之前拒绝，实现不会被调用。
        await counter.increment({by: 0}),
    ];
    if (subscription.ok) subscription.value.release();

    await window.stop();
    await hub.stop();
    router.close();
    return {log, results, seen};
}

if (import.meta.main) {
    console.log(JSON.stringify(await runRemoteServiceExample(), null, 2));
}
