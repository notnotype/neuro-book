/**
 * `example.board` 的项目入口：运行在项目子进程里，只服务这一个项目，代码里不出现项目参数。条目放在内存里，项目
 * 实例结束即丢；要留到下次打开，就放进 `nbook.storage` 的 project 分区（`<项目目录>/.nbook/storage.sqlite`）。
 *
 * 和服务端入口用同一个 `backend/` 目录：两种进程都是后端，区别只在入口声明的运行位置。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {descriptor} from "../plugin";
import {boardContract} from "../shared/contracts";

export function createBoardProjectPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "project",
            location: "project",
            remoteProvides: [boardContract.id],
            activate: () => {
                const items: string[] = [];
                const sinks = new Set<(text: string) => void>();
                return {
                    remote: [provideRemote(boardContract, () => ({
                        methods: {
                            pin: ({text}) => {
                                items.push(text);
                                for (const sink of sinks) sink(text);
                                return {ok: true, value: null};
                            },
                            items: () => ({ok: true, value: [...items]}),
                        },
                        events: {
                            pinned: {
                                subscribe: (_filter, sink, {signal}) => {
                                    const next = (text: string): void => sink.next(text);
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
