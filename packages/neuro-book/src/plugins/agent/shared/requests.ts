/**
 * 远程合同 `nbook.agent/requests`（docs/specs/agent/request-trace.md 的“边界与兼容”“失败与恢复”）：查看器经它列出、读、清空模型
 * 请求记录，订阅“记录变了”。版本 1，服务端提供，只给浏览器调用。
 *
 * 记录的形状由 nb-harness 的记录器产生（`kit/requests/types`），这里用 `Type.Unsafe` 带上类型、schema 只核对是对象；从浏览器来的
 * 输入（筛选、游标、id、哈希、分段序号）按结构校验。行与详情另带服务端补的会话标题与后台标题会话的所属（`RowContext`）。
 *
 * 通道一条消息上限 1 MiB：详情的消息大纲按页取（`read` 带第一页，`messages` 接着取），一段内容与原始请求体按字节分段取。
 * 时序（Spec“时序与寿命”）：先订阅 `changed`、再 `list`，丢掉序号不大于这一页 `seq` 的事件；`onResync` 时重新 `list`。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import type {MessageOutline, RequestDetail, RequestHit, RequestMatch, RequestPage, RequestRow, RequestUsage} from "@notnotype/nb-harness/kit/requests/types";

/**
 * 服务端补的上下文：`title` 是会话标题（后台标题会话取它所属会话的）；`background` 只在后台标题会话的请求上有，`owner` 是它所属的
 * 会话，找不到时为 null（Spec 输出 14：归到所属会话、写“后台”，找不到时单独一组）。
 */
export interface RowContext {
    readonly title?: string;
    readonly background?: {readonly owner: string | null};
}

export type RequestRowView = RequestRow & RowContext;

export interface SessionFacet {
    readonly id: string;
    readonly count: number;
    readonly title?: string;
    /** 找不到所属会话的后台标题会话。 */
    readonly background?: true;
}

export type RequestPageView = Omit<RequestPage, "rows" | "facets"> & {
    readonly rows: readonly RequestRowView[];
    /** 会话的候选里，后台标题会话的条数并进它所属的会话。 */
    readonly facets: {readonly sessions: readonly SessionFacet[]; readonly models: RequestPage["facets"]["models"]};
};

export type RequestDetailView = Omit<RequestDetail, "messages"> & RowContext & {
    /** 发这次请求的会话的 Profile；会话索引读不到时没有。 */
    readonly profile?: string;
    /** 消息大纲的第一页；`messagesNext` 不为 null 时从这个序号起用 `messages` 接着取。 */
    readonly messages: readonly MessageOutline[];
    readonly messagesNext: number | null;
};

/** `removed` 的 id 很多时（清理、清空）拆成几条同一序号的事件，每条放得进一条消息。 */
export type RequestChangeView =
    | {readonly seq: number; readonly kind: "added" | "settled"; readonly row: RequestRowView}
    | {readonly seq: number; readonly kind: "removed"; readonly ids: readonly string[]};

/** 查找交回的一页：有命中的行（带命中），没扫完时 `truncated` 与接着扫的游标（Spec 输出 17）。 */
export interface RequestSearchView {
    readonly rows: readonly (RequestRowView & {readonly match: RequestMatch})[];
    readonly truncated: boolean;
    readonly next?: string;
    readonly seq: number;
}

export type {MessageOutline, RequestHit, RequestMatch, RequestUsage};

const object = <T>() => Type.Unsafe<T>(Type.Object({}, {additionalProperties: true}));

/** 记录 id 是记录器取的 UUID。 */
const RequestId = Type.String({pattern: "^[0-9a-f-]{36}$"});
const ContentHash = Type.String({pattern: "^[0-9a-f]{64}$"});
const ChunkIndex = Type.Integer({minimum: 0});
const Chunk = Type.Object({text: Type.String(), last: Type.Boolean()}, {additionalProperties: false});

const Status = Type.Union([Type.Literal("running"), Type.Literal("ok"), Type.Literal("error"), Type.Literal("aborted"), Type.Literal("interrupted"), Type.Literal("resend"), Type.Literal("cache-miss")]);
const Purpose = Type.Union([Type.Literal("turn"), Type.Literal("approval"), Type.Literal("compaction"), Type.Literal("background")]);

const QueryFields = {
    sessions: Type.Optional(Type.Array(Type.String({minLength: 1}), {maxItems: 200})),
    purposes: Type.Optional(Type.Array(Purpose)),
    statuses: Type.Optional(Type.Array(Status)),
    models: Type.Optional(Type.Array(Type.String({minLength: 1}), {maxItems: 200})),
    since: Type.Optional(Type.Integer({minimum: 0})),
    sort: Type.Optional(Type.Union([Type.Literal("time"), Type.Literal("duration"), Type.Literal("input"), Type.Literal("cost")])),
    cursor: Type.Optional(Type.String({minLength: 1, maxLength: 400})),
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: 500})),
};
const Query = Type.Object(QueryFields, {additionalProperties: false});
/** 查找词：去掉首尾空白之后不能为空（宿主不为空词发查找）。 */
const SearchText = Type.String({minLength: 1, maxLength: 200});

const NoDetail = Type.Undefined();
/** 记录目录整个读不了：`newer-format` 是更新的版本写的（不动它），`unreadable` 是权限、损坏之类。 */
const Unavailable = Type.Object({reason: Type.Union([Type.Literal("newer-format"), Type.Literal("unreadable")])}, {additionalProperties: false});

const methods = {
    list: {input: Query, output: object<RequestPageView>(), effect: "read", errors: {"trace-unavailable": Unavailable, "invalid-cursor": NoDetail}},
    /**
     * 全文查找（Spec 输出 17）：与 `list` 同一套筛选、排序与游标，只交回有命中的请求。一次最多扫 3 秒或留 200 条；新的查找
     * 开始时调用方中止上一次（调用的 `signal`），服务端随之停下。
     */
    search: {input: Type.Object({...QueryFields, text: SearchText}, {additionalProperties: false}), output: object<RequestSearchView>(), effect: "read", errors: {"trace-unavailable": Unavailable, "invalid-cursor": NoDetail}},
    /** 一条请求里全部的命中（详情的查找条，Spec 输出 20）：处数与 `search` 给这一条的相同。 */
    hits: {
        input: Type.Object({id: RequestId, text: SearchText}, {additionalProperties: false}),
        output: Type.Unsafe<readonly RequestHit[]>(Type.Array(Type.Unknown())),
        effect: "read",
        errors: {"trace-unavailable": Unavailable, "request-not-found": NoDetail},
    },
    /** 会话里第几次请求的记录（“查看这次请求”、命令的 `request` 参数）。 */
    find: {
        input: Type.Object({session: Type.String({minLength: 1}), request: Type.Integer({minimum: 1})}, {additionalProperties: false}),
        output: object<RequestRowView>(),
        effect: "read",
        errors: {"trace-unavailable": Unavailable, "request-not-found": NoDetail},
    },
    read: {input: Type.Object({id: RequestId}, {additionalProperties: false}), output: object<RequestDetailView>(), effect: "read", errors: {"trace-unavailable": Unavailable, "request-not-found": NoDetail}},
    messages: {
        input: Type.Object({id: RequestId, from: Type.Integer({minimum: 0})}, {additionalProperties: false}),
        output: object<{readonly items: readonly MessageOutline[]; readonly next: number | null}>(),
        effect: "read",
        errors: {"trace-unavailable": Unavailable, "request-not-found": NoDetail},
    },
    /** 一段内容（一条消息、一段系统提示词、一个工具声明、一份回复）存下的 JSON 文本，按字节分段。 */
    content: {
        input: Type.Object({hash: ContentHash, index: ChunkIndex}, {additionalProperties: false}),
        output: Chunk,
        effect: "read",
        errors: {"trace-unavailable": Unavailable, "content-not-found": NoDetail, "out-of-range": NoDetail},
    },
    payload: {
        input: Type.Object({id: RequestId, index: ChunkIndex}, {additionalProperties: false}),
        output: Chunk,
        effect: "read",
        errors: {"trace-unavailable": Unavailable, "payload-not-found": NoDetail, "out-of-range": NoDetail},
    },
    usage: {input: Type.Object({}, {additionalProperties: false}), output: object<RequestUsage>(), effect: "read", errors: {"trace-unavailable": Unavailable}},
    /** 清空一个会话（连同它的后台标题会话）或全部的记录；进行中的不清（Spec 输出 25）。 */
    clear: {
        input: Type.Object({session: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false}),
        output: Type.Object({removed: Type.Integer({minimum: 0})}, {additionalProperties: false}),
        effect: "write",
        errors: {"trace-unavailable": Unavailable},
    },
} as const;

const events = {
    changed: {filter: Type.Object({}, {additionalProperties: false}), payload: object<RequestChangeView>()},
} as const;

export const agentRequestsContract = defineRemoteService({id: "nbook.agent/requests", version: 1, provider: "server", callers: ["browser"], methods, events});
