/**
 * `example.notes` 的浏览器入口：给本窗口里的每个插件一份笔记视图（`NotesView`），以**那个插件的身份**访问服务端。
 * 结构是 `nbook.storage` 浏览器入口的缩小版（`src/plugins/storage/web/plugin.ts`）。读这个文件学三件事：
 *
 * 1. **按调用方提供本地服务**：`providePerConsumer` 的工厂对每个依赖 `notesViewKey` 的入口各调用一次，参数是内核
 *    签发的调用方身份。门面随调用方入口的这一代释放（docs/specs/runtime/services.md 输出第 11–13 条）。
 * 2. **以调用方身份代理**：`context.remote.on(调用方).use(合同)` 发出的调用与订阅，到达服务端时调用方是窗口里的原
 *    插件，另附 `via`（本入口）。这是受控的能力：合同要写进 `remoteDelegates`，插件要在宿主的代理允许清单里，否则得到
 *    `denied`（docs/specs/runtime/plugin-channel.md 输出第 10 条、docs/specs/runtime/plugins.md 输出第 20 条）。
 * 3. **为什么值得包这一层**：它在远程合同之上加了一份同步可读、随服务端变化更新的缓存。只转发 `add`、`list` 的包装
 *    不写：窗口里的插件可以直接用合同（docs/specs/runtime/plugin-api.md 的“选用规则”）。
 *
 * 对应的场景：`scenarios/05-delegating-proxy.test.ts`。
 */

import {defineEntry, providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";

import {descriptor} from "../plugin";
import {notesContract, notesViewKey} from "../shared/contracts";
import type {Note, NotesView} from "../shared/contracts";

export const notesBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        defineEntry({
            id: "browser",
            location: "browser",
            provides: [notesViewKey],
            // 本入口要以调用方身份调用的合同。只声明这里列出的；没列出的合同经 `remote.on` 调用得到 `denied`。
            remoteDelegates: [notesContract],
            activate: (context) => ({
                services: [
                    providePerConsumer(notesViewKey, (consumer): NotesView => {
                        // 用调用方的身份，而不是本入口自己的身份（`context.remote.use`）：后者到达服务端时调用方全是
                        // `example.notes`，所有插件的笔记就混在一份里了。
                        //
                        // `remote.on(consumer)` 每次用时才取，不在工厂里取一次存起来：工厂返回之后，内核才把 `consumer`
                        // 登记为签发给这个门面的身份，在工厂里取得到的是 `denied`。门面释放（调用方入口停止、或本入口停止）
                        // 之后这个身份作废，经它建立的订阅由内核结束，不用自己记着释放。
                        const server = () => context.remote.on(consumer).use(notesContract);

                        let cache: ReadonlyArray<Note> | null = null;
                        let syncing: Promise<RemoteResult<null>> | null = null;

                        const startSync = async (): Promise<RemoteResult<null>> => {
                            const first = Promise.withResolvers<string | null>();
                            const subscribed = await server().events.changed.subscribe(
                                {},
                                // 服务端订阅建立时先推一次当前列表，之后每次变化推整份列表：直接替换缓存。
                                (notes) => {
                                    cache = notes;
                                    first.resolve(null);
                                },
                                {
                                    // 订阅结束（服务端停止、连接结束、门面释放）：缓存不再更新，就不再给出旧数据；下次
                                    // `sync` 重新订阅。
                                    onEnd: (reason) => {
                                        cache = null;
                                        syncing = null;
                                        first.resolve(reason);
                                    },
                                },
                            );
                            if (!subscribed.ok) {
                                syncing = null;
                                return subscribed;
                            }
                            // 第一份列表可能早于 `subscribe` 返回就到了，也可能稍后才到；两种都等它，返回时缓存已经可读。
                            const ended = await first.promise;
                            return ended === null ? {ok: true, value: null} : {ok: false, code: "unavailable", detail: `同步在拿到第一份列表之前结束：${ended}`};
                        };

                        return {
                            notes: () => cache,
                            sync: () => (syncing ??= startSync()),
                            add: (text) => server().add({text}),
                        };
                    }),
                ],
            }),
        }),
    ],
};
