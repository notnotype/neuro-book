/**
 * `example.notes` 对其它插件公开的合同：一份远程服务合同（服务端提供），一项本地服务（浏览器入口提供）。别的插件在
 * 运行时只引用这个文件；本插件两侧（`backend/` 与 `web/`）也只经这里交换 schema 与类型。
 *
 * 为什么两种都有：选用规则（docs/specs/runtime/plugin-api.md 的“选用规则”）要求只传数据、调用方可能在别的实例的
 * 接口写成远程服务合同，所有调用方直接用合同，不另包一层只转发的本地服务。笔记的读写就是这样，服务端的插件直接
 * `context.remote.use(notesContract)`。窗口里的 `NotesView` 包了一层，是因为它在合同之上加了东西：一份随服务端变化
 * 更新、可以同步读取的缓存；只转发 `add` 与 `list` 的包装不值得写。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

const Text = Type.String({minLength: 1, maxLength: 1000});

/** 一条笔记。schema 既用于远程合同，也用于服务端存进 `nbook.storage` 的记录，所以写在共用的这里。 */
export const NoteSchema = Type.Object(
    {
        text: Text,
        /** 写入时刻（毫秒）。服务端没有报时服务（`example.clock` 没装或用不了）时为 null。 */
        writtenAt: Type.Union([Type.Number(), Type.Null()]),
        /** 经哪个插件代理写入：服务端看到的调用方身份里的 `via`。调用方直接调用时为 null。 */
        via: Type.Union([Type.String(), Type.Null()]),
    },
    {additionalProperties: false},
);

export type Note = Static<typeof NoteSchema>;

const Empty = Type.Object({}, {additionalProperties: false});

/**
 * 业务失败：`nbook.storage` 读写失败时原样带上它的失败码。不能把 Storage 的码直接声明成本合同的业务失败码：
 * `denied`、`unavailable`、`unknown-outcome` 与路由层的失败码重名，`defineRemoteService` 在模块加载时就会拒绝这份
 * 合同；调用方也就分不清“路由没送到”与“Storage 拒绝了”。`nbook.storage` 自己的合同是同样的做法。
 */
const StorageFailed = Type.Object({code: Type.String(), detail: Type.String()}, {additionalProperties: false});

/**
 * 远程服务合同。提供方按 schema 校验输入，调用方再核对一次输出；不合 schema 的输入在到达提供方之前就以
 * `invalid-input` 被拒（docs/specs/runtime/plugin-channel.md 输出第 1、4 条）。
 *
 * - `provider: "server"`：服务端实例提供。调用方省略 `.at()` 就是发往服务端。
 * - `callers`：允许调用的运行位置。服务端的插件在同一实例里调用（走本地路径，不序列化，身份与代次照样核对）；
 *   窗口里的插件经 notes 的浏览器入口代理过来，到达服务端时调用方的位置仍是 `browser`。
 * - `effect`：写方法的请求一旦发出、结果又没回来（断线、超时），结果是 `unknown-outcome`，内核不自动重试
 *   （同文输出第 4 条）；读方法可以放心重试。
 * - 合同是本插件对外的公开接口：改动要升 `version`，旧调用方得到 `version-changed`。
 */
export const notesContract = defineRemoteService({
    id: "example.notes/remote",
    version: 1,
    provider: "server",
    callers: ["server", "browser"],
    methods: {
        add: {input: Type.Object({text: Text}, {additionalProperties: false}), output: NoteSchema, effect: "write", errors: {"storage-failed": StorageFailed}},
        list: {input: Empty, output: Type.Array(NoteSchema), effect: "read", errors: {"storage-failed": StorageFailed}},
    },
    events: {
        /** 调用方自己的笔记有变化时推送整份列表；订阅建立时先推一次当前列表，订阅方拿它当基线。 */
        changed: {filter: Empty, payload: Type.Array(NoteSchema)},
    },
});

/**
 * 窗口里的插件拿到的笔记视图（浏览器入口按调用方提供，每个插件一份）。接口上没有“哪个插件”的参数：身份由内核
 * 填写，调用方自报不了，所以 A 读不到 B 的笔记。
 */
export interface NotesView {
    /** 本窗口缓存的、调用方自己的笔记，同步可读。还没开始同步、或同步已经结束时为 null。 */
    notes(): ReadonlyArray<Note> | null;
    /** 开始同步：订阅服务端的 `changed`，拿到第一份列表后返回。重复调用共用同一次同步。 */
    sync(): Promise<RemoteResult<null>>;
    /** 写一条笔记。已经 `sync` 过时，拿到结果的那一刻服务端推来的新列表已经进了缓存（同一条链路按发送顺序送达）。 */
    add(text: string): Promise<RemoteResult<Note, "storage-failed">>;
}

export const notesViewKey: ServiceKey<NotesView> = defineServiceKey<NotesView>("example.notes/view");
