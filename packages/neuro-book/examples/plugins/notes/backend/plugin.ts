/**
 * `example.notes` 的服务端入口。读这个文件学四件事：
 *
 * 1. **必需依赖内置插件**：笔记落进 `nbook.storage`（真实的 SQLite），服务端重启后还在。服务键从内置插件的
 *    `shared/contracts.ts` 引用，和引用别的示例插件一样（docs/specs/storage/persistence.md）。
 * 2. **可选依赖**：有报时服务时给笔记打上写入时刻，没有时照常工作。依赖写成 `required: false`，激活时用
 *    `context.services.resolve` 解析，按结果分两种情况处理（docs/specs/runtime/plugin-api.md 的“可选功能”）。
 * 3. **按调用方提供远程服务**：`provideRemote` 的工厂对每个调用方各调用一次，参数是内核填写的调用方身份；工厂
 *    返回的门面只服务这一个调用方，所以每个插件只看到自己的笔记（docs/specs/runtime/services.md 输出第 11–12 条、
 *    docs/specs/runtime/plugin-channel.md）。
 * 4. **按需激活**：入口声明了 `remoteProvides`、没写 `activationEvents`：第一次有调用到达时内核才激活它，并先激活
 *    它的必需依赖（docs/specs/runtime/plugin-channel.md 输出第 5 条）。
 *
 * 对应的场景：`scenarios/01-services.test.ts`、`02-per-consumer.test.ts`、`05-delegating-proxy.test.ts`。
 */

import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {defineRecord} from "nbook/shared/storage";
import type {RecordHandle} from "nbook/shared/storage";

import {clockKey} from "../../clock/shared/contracts";
import {descriptor} from "../plugin";
import {NoteSchema, notesContract} from "../shared/contracts";
import type {Note} from "../shared/contracts";

/**
 * 笔记在 `nbook.storage` 里的记录。
 *
 * - `scope: "user"`：存在服务端的 user 分区（状态根下的 `storage/user.sqlite`）；`project` 记录要在项目实例里打开。
 * - `locality: "shared"`：不区分客户端。`local` 记录按客户端身份分开存，服务端的入口没有客户端身份，打不开它。
 * - `keyed: true`：同一条记录下按资源 id 分开存。资源 id 写调用方插件的 id，每个调用方一份列表。
 * - `version` 与 `schema`：值的形状。改形状要升版本，旧数据读出来是 `unsupported-version`，不会被当成新形状。
 *
 * Storage 也按调用方分开：记录的拥有者是调用 Storage 的插件，也就是 notes 自己。别的插件即使定义同名的记录，也读不到
 * 这里的数据（docs/specs/storage/persistence.md 输出第 1 条）。
 */
const notesRecord = defineRecord({
    key: "notes",
    scope: "user",
    locality: "shared",
    version: 1,
    keyed: true,
    schema: Type.Object({items: Type.Array(NoteSchema)}, {additionalProperties: false}),
});

type NotesValue = {readonly items: ReadonlyArray<Note>};

/** 两个调用同时追加时，后保存的那个会冲突，重读后再写。连续冲突到这个次数就放弃，交给调用方决定。 */
const SAVE_ATTEMPTS = 3;

/** 合同里声明的业务失败 `storage-failed`，详情带上 Storage 的失败码。 */
function storageFailed(failure: {readonly code: string; readonly detail: string}) {
    return {ok: false, code: "storage-failed", detail: {code: failure.code, detail: failure.detail}} as const;
}

type NotesFailure = ReturnType<typeof storageFailed>;

/** 读出整份列表。记录还没写过（`missing`）就是空列表。 */
async function readNotes(handle: RecordHandle<NotesValue>): Promise<{readonly ok: true; readonly value: ReadonlyArray<Note>; readonly revision: string | null} | NotesFailure> {
    const snapshot = await handle.read();
    switch (snapshot.status) {
        case "ok":
            return {ok: true, value: snapshot.value.items, revision: snapshot.revision};
        case "missing":
            return {ok: true, value: [], revision: snapshot.revision};
        case "error":
            return storageFailed(snapshot);
        // 记录坏了或版本不认识：Storage 保护着原件，普通保存会被拒；示例不演示修复，把原因交给调用方。
        case "corrupt":
        case "unsupported-version":
            return storageFailed({code: snapshot.status, detail: snapshot.detail});
    }
}

export const notesBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        defineEntry({
            id: "server",
            location: "server",
            dependencies: [
                // 必需依赖：缺了它这个入口受阻、不激活。内核在激活本入口之前先激活提供方（`nbook.storage` 的服务端入口）。
                {key: storageKey},
                // 诊断：内置的诊断服务，记录给运维人员看的事件（packages/neuro-book/AGENTS.md 的“后端”）。
                {key: diagnosticsKey},
                // 可选依赖：缺了它本入口照常激活，只是用到它的那一处功能不可用。
                {key: clockKey, required: false},
            ],
            remoteProvides: [notesContract],
            activate: async (context) => {
                const storage = context.services.require(storageKey);
                const diagnostics = context.services.require(diagnosticsKey);

                // 可选依赖不能 `require`（会抛错）：用 `resolve`，它返回结构化结果、不抛。解析会按需激活 clock 的入口。
                // 拿到的服务只在本入口的这一代里有效，内核管它的寿命：clock 停止之前，本入口先停（依赖的先激活、后停止）。
                // 不要把它存到寿命更长的地方（例如模块顶层的变量）：本入口停止后它就失效了，下一代要重新解析。
                const clock = await context.services.resolve(clockKey);
                if (clock.status !== "resolved") {
                    // 两种原因要分开处理：`missing-provider` 是没有任何插件提供报时服务，这项功能本来就不存在；其它原因
                    // （例如 `provider-rejected`：clock 装了，但它自己缺宿主时钟而受阻）是提供方在但现在用不了，值得
                    // 提醒（docs/specs/runtime/plugin-api.md 的“可选功能”）。
                    diagnostics.record({
                        level: clock.reason === "missing-provider" ? "info" : "warn",
                        event: "example.notes.clock-unavailable",
                        message: "没有可用的报时服务，笔记不带写入时刻",
                        data: {reason: clock.reason},
                        source: {plugin: descriptor.id, entry: "server"},
                    });
                }
                const stamp = async (): Promise<number | null> => (clock.status === "resolved" ? clock.instance.now() : null);

                // 远程提供项：内核对每个调用方调用一次工厂，参数是内核填写的调用方身份，调用方自报不了。同一个调用方
                // 入口的同一代复用同一个门面；调用方入口停止、或本入口停止时门面释放，之后再用它的调用得到失败码。
                return {
                    remote: [
                        provideRemote(notesContract, (consumer) => {
                            // 调用方插件 id 就是它那份笔记的资源 id。经窗口里的代理来的调用，`plugin` 仍是窗口里的原插件，
                            // `via` 才是代理：同一个插件在服务端直接写、在窗口里经代理写，落在同一份列表里。
                            const owner = consumer.plugin ?? "host";
                            const via = consumer.via?.plugin ?? null;
                            const open = async () => {
                                const opened = await storage.open(notesRecord, owner);
                                return opened.ok ? opened : storageFailed(opened);
                            };
                            return {
                                methods: {
                                    add: async ({text}) => {
                                        const opened = await open();
                                        if (!opened.ok) return opened;
                                        const note: Note = {text, writtenAt: await stamp(), via};
                                        // 条件保存：只在记录仍是刚读到的那个 revision 时写入，别处先写了就得到 `conflict`。
                                        // 不带条件直接覆盖，两个同时追加的调用会有一条笔记悄悄丢掉。
                                        for (let attempt = 1; ; attempt += 1) {
                                            const current = await readNotes(opened.handle);
                                            if (!current.ok) return current;
                                            const saved = await opened.handle.save({items: [...current.value, note]}, {expect: current.revision});
                                            if (saved.ok) return {ok: true, value: note};
                                            if (saved.code !== "conflict" || attempt === SAVE_ATTEMPTS) return storageFailed(saved);
                                        }
                                    },
                                    list: async () => {
                                        const opened = await open();
                                        if (!opened.ok) return opened;
                                        const current = await readNotes(opened.handle);
                                        return current.ok ? {ok: true, value: [...current.value]} : current;
                                    },
                                },
                                events: {
                                    changed: {
                                        // 每个订阅调用一次。`signal` 在订阅因任何原因结束时触发（调用方释放、任一端停止、连接
                                        // 断开），这里用它释放对 Storage 记录的订阅；不释放，Storage 会一直替一个已经不存在的
                                        // 订阅方推送。
                                        subscribe: async (_filter, sink, {signal}) => {
                                            const opened = await open();
                                            // 抛错时内核记一条诊断，以 `provider-error` 结束这条订阅，订阅方的 `onEnd` 收到它。
                                            if (!opened.ok) throw new Error(`打不开 ${owner} 的笔记：${opened.detail.code}`);
                                            // Storage 的订阅先推一次当前快照、之后推每次写入，正好就是 `changed` 的语义。它在本
                                            // 实例里同步通知，早于保存返回：`add` 的结果送回调用方之前，新列表已经推出去了。
                                            const subscribed = await opened.handle.subscribe((snapshot) => {
                                                if (snapshot.status === "ok") sink.next([...snapshot.value.items]);
                                                else if (snapshot.status === "missing") sink.next([]);
                                                // 读取出错或记录坏了：不推，订阅方保留上一份列表，下次 `list` 会拿到原因。记一条
                                                // 诊断，否则订阅方只会看到列表不再更新，查不到为什么。
                                                else diagnostics.record({level: "warn", event: "example.notes.snapshot-unreadable", message: `${owner} 的笔记读不出来，没有推送`, data: {status: snapshot.status}, source: {plugin: descriptor.id, entry: "server"}});
                                            });
                                            if (!subscribed.ok) throw new Error(`订阅不了 ${owner} 的笔记：${subscribed.code}`);
                                            // Storage 的订阅自己结束，只会发生在 notes 的这一代停止（它的 Storage 门面随之释放）或
                                            // Storage 停止时；notes 依赖 Storage、比它先停，两种情况下内核都已经结束了这条远程订阅，
                                            // 所以不用 `onEnd`。
                                            if (signal.aborted) subscribed.handle.release();
                                            else signal.addEventListener("abort", () => subscribed.handle.release(), {once: true});
                                        },
                                    },
                                },
                            };
                        }),
                    ],
                };
            },
        }),
    ],
};
