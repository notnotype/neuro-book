/**
 * `example.counter` 的服务端入口：提供远程服务 `example.counter/remote`。
 *
 * 入口声明 `remoteProvides`、不声明启动激活：第一次有调用到达时内核才激活它（`onRemote`）。`provideRemote` 的
 * 工厂收到调用方身份（插件、入口、所在实例），与按调用方门面是同一个机制；这里计数是全局一份，身份只用来演示
 * 提供方看得到谁在调。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {descriptor} from "../plugin";
import {counterContract} from "../shared/contracts";

export const counterBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [{
        id: "server",
        location: "server",
        remoteProvides: [counterContract],
        activate: () => {
            let count = 0;
            const sinks = new Set<(value: number) => void>();
            return {
                remote: [provideRemote(counterContract, () => ({
                    methods: {
                        increment: ({by}) => {
                            count += by;
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
