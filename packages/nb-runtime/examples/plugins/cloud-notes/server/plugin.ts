/**
 * `example.cloud-notes` 的服务端入口：按调用方插件分开存笔记。经浏览器入口代理来的调用，调用方身份是窗口里的
 * 原插件（`via` 是代理入口），所以同一个插件在哪个窗口写都落在同一份里，不同插件互不可见。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {descriptor} from "../plugin";
import {cloudNotesContract} from "../shared/contracts";

export function createCloudNotesServerPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            remoteProvides: [cloudNotesContract.id],
            activate: () => {
                const byPlugin = new Map<string, string[]>();
                return {
                    remote: [provideRemote(cloudNotesContract, (consumer) => {
                        const owner = consumer.plugin ?? "host";
                        return {
                            methods: {
                                add: ({text}) => {
                                    byPlugin.set(owner, [...(byPlugin.get(owner) ?? []), text]);
                                    return {ok: true, value: null};
                                },
                                list: () => ({ok: true, value: byPlugin.get(owner) ?? []}),
                            },
                        };
                    })],
                };
            },
        }],
    };
}
