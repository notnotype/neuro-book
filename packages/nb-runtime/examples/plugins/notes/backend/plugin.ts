/**
 * `example.notes` 的服务端入口：按调用方提供服务（`providePerConsumer`）。
 *
 * 工厂为每个依赖它的插件入口各生成一个门面，参数是内核填写的调用方身份，调用方不能自报，所以 A 读不到
 * B 的笔记；`nbook.storage` 按插件划分命名空间也是这样做的。数据由提供方持有，门面只是带着身份的一层访问。
 * 门面随调用方入口的这一代释放，之后再用会抛 `ServiceRevokedError`。门面要是由函数组成的普通对象：内核交出的
 * 是包装过的代理。
 */

import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {notesKey} from "../shared/contracts";
import type {NotesService} from "../shared/contracts";

export function createNotesServerPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            provides: [notesKey],
            activate: () => {
                const byPlugin = new Map<string, string[]>();
                return {
                    services: [providePerConsumer(notesKey, (consumer): NotesService => {
                        // 宿主能力等非插件调用方没有插件 id，归到同一个“host”命名空间。
                        const owner = consumer.plugin ?? "host";
                        return {
                            add: (text) => void byPlugin.set(owner, [...(byPlugin.get(owner) ?? []), text]),
                            list: () => byPlugin.get(owner) ?? [],
                        };
                    })],
                };
            },
        }],
    };
}
