/**
 * `example.cloud-notes` 的浏览器入口：给窗口里每个调用方插件生成本地门面，以**收到的调用方身份**转发到服务端。
 *
 * - `context.remote.on(调用方).use(合同)`：服务端看到的调用方是原插件、`via` 是本入口。若用本入口自己的身份
 *   （`context.remote.use`）转发，服务端看到的全是 `example.cloud-notes`，所有插件的数据会混在一起。
 * - 以调用方身份转发是受控能力：`remoteDelegates` 声明要代理的合同，插件还要在宿主给的代理允许清单
 *   （应用清单的 `delegation`）里；否则调用得到 `denied`。伪造的身份对象、签发它的门面已释放，同样 `denied`。
 * - `remote.on` 在门面方法被调用时才取，不能在门面工厂里取：工厂返回之后内核才签发这个身份。
 */

import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {cloudNotesContract, cloudNotesKey} from "../shared/contracts";
import type {CloudNotes} from "../shared/contracts";

export const cloudNotesBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [{
        id: "browser",
        location: "browser",
        provides: [cloudNotesKey],
        remoteDelegates: [cloudNotesContract.id],
        activate: (context) => ({
            services: [providePerConsumer(cloudNotesKey, (consumer): CloudNotes => {
                const server = () => context.remote.on(consumer).use(cloudNotesContract).at("server");
                return {
                    add: (text) => server().add({text}),
                    list: () => server().list({}),
                };
            })],
        }),
    }],
};
