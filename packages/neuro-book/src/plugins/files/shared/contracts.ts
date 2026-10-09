/**
 * `nbook.files` 的服务键与远程服务合同（docs/specs/workspace/resources.md、folder-kinds.md、files.md）。
 *
 * 两份远程合同的方法、事件与业务失败码相同，只是方案不同：`nbook.files/project` 由项目实例提供（`project://`），
 * `nbook.files/user` 由服务端实例提供（`user://`）。服务端与项目实例里的插件直接用这两份合同；浏览器里的插件经
 * `filesKey` 按资源地址取用，不直接调用合同。写入来源由提供者按内核填写的调用方身份确定，输入里没有来源字段。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteCause, RemoteFailureCode} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

import {RPC_MAX_MESSAGE_BYTES} from "nbook/shared/rpc-socket";

import {FILES_FAILURES} from "./failures";
import type {FilesFailureCode} from "./failures";
import type {Scheme} from "./resource";

export {FILES_FAILURES};
export type {FilesFailureCode};
export {basenameOf, formatResource, joinResource, parentOf, parseResource, SCHEMES} from "./resource";
export type {Resource, Scheme} from "./resource";

/**
 * 正文按 JSON 编码后的字节上限：保存请求要装进一条 RPC 消息（超过时连接被断开、写请求成为结果未知），余下 64 KiB
 * 留给地址、基线与帧包络（docs/specs/workspace/files.md 的“读取与保存”）。
 */
export const TEXT_BUDGET_BYTES = RPC_MAX_MESSAGE_BYTES - 64 * 1024;

/** 正文经 JSON 编码后的 UTF-8 字节数；浏览器在发出保存前、提供者在读取与保存时用同一个算法。 */
export function encodedTextBytes(text: string): number {
    return encodedBytes(text);
}

/** 任意请求或结果经 JSON 编码后的 UTF-8 字节数：批量与身份查询的输入、批量结果都按它核对预算。 */
export function encodedBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

const BaselineSchema = Type.Object({hash: Type.String()}, {additionalProperties: false});
export type Baseline = Static<typeof BaselineSchema>;

const FolderSchema = Type.Union([Type.Literal("plain"), Type.Literal("content"), Type.Literal("binder")]);
export type FolderKind = Static<typeof FolderSchema>;

/**
 * 目录项。`kind` 是目录项本身的类型（符号链接不跟随）；`missing` 是清单里有、磁盘上没有的条目。
 * - `folder`：目录按名字后缀的类型；
 * - `title`、`icon`：清单给的展示名与图标；
 * - `listed`：内容文件夹里是否列在清单中（未列入项为 false）；
 * - `body`：内容树里的子目录有没有正文（`index.md` 是普通文件）；
 * - `role`：内容节点自己的 `index.md` 为 `body`，内容根上的 `content.xml` 为 `manifest`。
 */
const EntrySchema = Type.Object({
    name: Type.String(),
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("link"), Type.Literal("other"), Type.Literal("missing")]),
    folder: Type.Optional(FolderSchema),
    title: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),
    listed: Type.Optional(Type.Boolean()),
    body: Type.Optional(Type.Boolean()),
    role: Type.Optional(Type.Union([Type.Literal("body"), Type.Literal("manifest")])),
}, {additionalProperties: false});
export type DirectoryEntry = Static<typeof EntrySchema>;

/** 清单的状态：内容文件夹按它显示；不是 `ok` 时退回普通文件夹的排序与名字。 */
const ManifestStateSchema = Type.Union([
    Type.Object({status: Type.Literal("ok")}, {additionalProperties: false}),
    Type.Object({status: Type.Union([Type.Literal("absent"), Type.Literal("unreadable"), Type.Literal("invalid")]), detail: Type.String()}, {additionalProperties: false}),
]);
export type ManifestState = Static<typeof ManifestStateSchema>;

/** 一层目录：自身的类型、所属内容根（相对方案根的路径）与清单状态，以及排好序的目录项。 */
const ListingSchema = Type.Object({
    folder: FolderSchema,
    contentRoot: Type.Union([Type.String(), Type.Null()]),
    manifest: Type.Optional(ManifestStateSchema),
    entries: Type.Array(EntrySchema),
}, {additionalProperties: false});
export type Listing = Static<typeof ListingSchema>;

const FileTextSchema = Type.Object({text: Type.String(), baseline: BaselineSchema}, {additionalProperties: false});
export type FileText = Static<typeof FileTextSchema>;

const Saved = Type.Object({baseline: BaselineSchema}, {additionalProperties: false});

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
/** 保存冲突带回磁盘上的当前基线；文件操作的冲突（目标已存在）不带。 */
const ConflictDetail = Type.Object({detail: Type.String(), current: Type.Optional(BaselineSchema)}, {additionalProperties: false});

/** 每个业务失败码的详情；`unknown-scheme` 只由客户端在发出前给出。 */
const errors = {
    "invalid-address": Detail,
    "root-gone": Detail,
    "outside-root": Detail,
    "protected-path": Detail,
    "permission-denied": Detail,
    "not-found": Detail,
    "not-a-file": Detail,
    "not-a-directory": Detail,
    "not-text": Detail,
    "too-large": Detail,
    "conflict": ConflictDetail,
    "into-itself": Detail,
    "source-changed": Detail,
    "unsupported": Detail,
    "invalid-order": Detail,
    "busy": Detail,
    "io-failed": Detail,
} as const satisfies Record<Exclude<FilesFailureCode, "unknown-scheme">, TSchema>;

const PathInput = Type.Object({path: Type.String()}, {additionalProperties: false});

/** 一次批量或身份查询最多这么多项（另受编码后的字节预算约束，见 `TEXT_BUDGET_BYTES`）。 */
export const MAX_OPERATION_ITEMS = 1000;

const IdentifySchema = Type.Object({
    items: Type.Array(Type.Union([
        Type.Object({kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("link"), Type.Literal("other")]), token: Type.String()}, {additionalProperties: false}),
        Type.Object({code: Type.String(), detail: Type.String()}, {additionalProperties: false}),
    ])),
}, {additionalProperties: false});
export type Identified = Static<typeof IdentifySchema>;

/** 文件已改而清单没改成（docs/specs/workspace/folder-kinds.md 的“失败与恢复”）：哪份清单、为什么。 */
const ManifestIssueSchema = Type.Object({path: Type.String(), status: Type.Union([Type.Literal("failed"), Type.Literal("invalid")]), detail: Type.String()}, {additionalProperties: false});
export type ManifestIssue = Static<typeof ManifestIssueSchema>;

/** 单项操作的成功值：清单都改成了时为空对象。 */
const DoneSchema = Type.Object({manifests: Type.Optional(Type.Array(ManifestIssueSchema, {maxItems: 2}))}, {additionalProperties: false});
export type OperationDone = Static<typeof DoneSchema>;

/** 部分完成的范围：路径装不下一条消息时清空并标 `truncated`，调用方重新列出核对。 */
const RangeSchema = Type.Object({paths: Type.Array(Type.String()), truncated: Type.Boolean()}, {additionalProperties: false});
const Manifests = Type.Optional(Type.Array(ManifestIssueSchema, {maxItems: 2}));

/** 批量的一项结果，与输入按下标对齐（docs/specs/workspace/files.md 的“逐项结果”）。 */
const ItemResultSchema = Type.Union([
    Type.Object({status: Type.Literal("done"), manifests: Manifests}, {additionalProperties: false}),
    Type.Object({
        status: Type.Literal("failed"),
        code: Type.String(),
        detail: Type.String(),
        partial: Type.Optional(Type.Object({removed: Type.Optional(RangeSchema), residual: Type.Optional(RangeSchema)}, {additionalProperties: false})),
        manifests: Manifests,
    }, {additionalProperties: false}),
    Type.Object({status: Type.Literal("skipped"), reason: Type.Union([Type.Literal("duplicate"), Type.Literal("covered")])}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("not-run"), reason: Type.Union([Type.Literal("root-gone"), Type.Literal("stopped")])}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("cancelled")}, {additionalProperties: false}),
]);
export type ItemResult = Static<typeof ItemResultSchema>;

const BatchSchema = Type.Object({items: Type.Array(ItemResultSchema)}, {additionalProperties: false});
export type BatchResult = Static<typeof BatchSchema>;

const Expected = Type.Optional(Type.String());
const Operation = Type.String({minLength: 1, maxLength: 64});
const Name = Type.String();
const Display = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const methods = {
    list: {input: PathInput, output: ListingSchema, effect: "read", errors},
    read: {input: PathInput, output: FileTextSchema, effect: "read", errors},
    write: {input: Type.Object({path: Type.String(), text: Type.String(), baseline: BaselineSchema}, {additionalProperties: false}), output: Saved, effect: "write", errors},
    identify: {input: Type.Object({paths: Type.Array(Type.String(), {maxItems: MAX_OPERATION_ITEMS})}, {additionalProperties: false}), output: IdentifySchema, effect: "read", errors},
    create: {input: Type.Object({path: Type.String(), kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]), before: Type.Optional(Name)}, {additionalProperties: false}), output: DoneSchema, effect: "write", errors},
    createContent: {input: PathInput, output: DoneSchema, effect: "write", errors},
    rename: {input: Type.Object({path: Type.String(), name: Name, expected: Expected}, {additionalProperties: false}), output: DoneSchema, effect: "write", errors},
    convert: {input: Type.Object({path: Type.String(), to: Type.Union([Type.Literal("content"), Type.Literal("plain")]), expected: Expected}, {additionalProperties: false}), output: DoneSchema, effect: "write", errors},
    reorder: {input: Type.Object({directory: Type.String(), names: Type.Array(Name, {maxItems: MAX_OPERATION_ITEMS})}, {additionalProperties: false}), output: DoneSchema, effect: "write", errors},
    display: {input: Type.Object({path: Type.String(), title: Display, icon: Display}, {additionalProperties: false}), output: DoneSchema, effect: "write", errors},
    include: {input: Type.Object({path: Type.String(), before: Type.Optional(Name)}, {additionalProperties: false}), output: DoneSchema, effect: "write", errors},
    drop: {input: PathInput, output: DoneSchema, effect: "write", errors},
    move: {input: Type.Object({operation: Operation, items: Type.Array(Type.Object({source: Type.String(), target: Type.String(), expected: Expected}, {additionalProperties: false}), {maxItems: MAX_OPERATION_ITEMS})}, {additionalProperties: false}), output: BatchSchema, effect: "write", errors},
    copy: {input: Type.Object({operation: Operation, items: Type.Array(Type.Object({source: Type.String(), target: Type.String(), expected: Expected}, {additionalProperties: false}), {maxItems: MAX_OPERATION_ITEMS})}, {additionalProperties: false}), output: BatchSchema, effect: "write", errors},
    delete: {input: Type.Object({operation: Operation, items: Type.Array(Type.Object({path: Type.String(), expected: Expected}, {additionalProperties: false}), {maxItems: MAX_OPERATION_ITEMS})}, {additionalProperties: false}), output: BatchSchema, effect: "write", errors},
    /** 只命中同一调用方在途的批量；不等批量结束。 */
    cancel: {input: Type.Object({operation: Operation}, {additionalProperties: false}), output: Type.Object({found: Type.Boolean()}, {additionalProperties: false}), effect: "write", errors},
} as const;

/** 写入来源（docs/specs/workspace/resources.md 的“写入来源”）。 */
const SourceSchema = Type.Union([
    Type.Object({kind: Type.Literal("user"), plugin: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("system"), plugin: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("external")}, {additionalProperties: false}),
]);
export type ChangeSource = Static<typeof SourceSchema>;

/**
 * 外部变化只有 `changed`（路径现在存在）与 `deleted`；经文件服务的操作给精确类型。`renamed` 与 `deleted` 对路径本身及
 * 按段边界的全部后代生效。
 */
const ChangeSchema = Type.Union([
    Type.Object({type: Type.Union([Type.Literal("created"), Type.Literal("changed"), Type.Literal("deleted")]), path: Type.String(), source: SourceSchema}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("renamed"), path: Type.String(), from: Type.String(), source: SourceSchema}, {additionalProperties: false}),
]);
export type FileChange = Static<typeof ChangeSchema>;

/**
 * 订阅先推 `ready`，之后成批推变化；`resync` 表示有变化可能漏掉，订阅方按当前状态重新核对；`ended` 是提供方结束了
 * 这个订阅（例如根目录不在），之后不再推送。远程事件的提供方只能推送、不能结束订阅，所以结束也是一条消息。
 */
const ChangesPayload = Type.Union([
    Type.Object({kind: Type.Literal("ready")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("batch"), events: Type.Array(ChangeSchema)}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("resync")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("ended"), reason: Type.String()}, {additionalProperties: false}),
]);
export type ChangesMessage = Static<typeof ChangesPayload>;

const events = {changes: {filter: Type.Object({}, {additionalProperties: false}), payload: ChangesPayload}} as const;

const CALLERS = ["browser", "tui", "project", "server"];

export const projectFilesContract = defineRemoteService({id: "nbook.files/project", version: 1, provider: "project", callers: CALLERS, methods, events});

export const userFilesContract = defineRemoteService({id: "nbook.files/user", version: 1, provider: "server", callers: CALLERS, methods, events});

export type FilesContract = typeof projectFilesContract | typeof userFilesContract;

export function contractOf(scheme: Scheme): FilesContract {
    return scheme === "project" ? projectFilesContract : userFilesContract;
}

/** 浏览器文件客户端的结果：业务失败与路由层失败都原样带码，路由层的中断原因（`cause`）也原样带出，不转成空结果。 */
export type FilesResult<T> =
    | {readonly ok: true; readonly value: T}
    | {readonly ok: false; readonly code: FilesFailureCode | RemoteFailureCode; readonly detail: string; readonly current?: Baseline; readonly cause?: RemoteCause};

/**
 * `watch` 的监听者收到的消息。`resync` 另包括同一项目代次内断线重连（断线期间的事件不补发）；`ended` 另包括订阅建立
 * 失败与内核结束订阅（提供者停止、项目代次结束等），原因原样带出；`ended` 之后不再有回调。
 */
export type WatchMessage = ChangesMessage;

export interface BatchTransfer {
    readonly source: string;
    readonly target: string;
    /** `identify` 的令牌：源被替换或移走时该项为 `source-changed`。 */
    readonly expected?: string;
}

/**
 * 一次批量：`result` 是逐项结果；`cancel` 让它在项与项之间停下（正在执行的项做完，已完成的不回滚），回答是否命中了
 * 在途的批量。操作 id 与方案都在句柄里。
 */
export interface BatchHandle {
    readonly result: Promise<FilesResult<BatchResult>>;
    cancel(): Promise<FilesResult<{readonly found: boolean}>>;
}

export interface FilesService {
    list(address: string, options?: {readonly signal?: AbortSignal}): Promise<FilesResult<Listing>>;
    read(address: string, options?: {readonly signal?: AbortSignal}): Promise<FilesResult<FileText>>;
    /** 只保存已有文件；正文超过上限时不发出请求，直接 `too-large`。 */
    write(address: string, text: string, baseline: Baseline): Promise<FilesResult<{readonly baseline: Baseline}>>;
    /** 冻结一组目录项的身份（剪贴板、拖动）；地址必须同一方案。结果与输入按下标对齐。 */
    identify(addresses: ReadonlyArray<string>): Promise<FilesResult<Identified>>;
    /** 排他新建空文件或目录；`before` 是内容文件夹里同层另一项的名字。 */
    create(address: string, kind: "file" | "directory", options?: {readonly before?: string}): Promise<FilesResult<OperationDone>>;
    /** 在内容文件夹的节点目录里排他新建空白 `index.md`。 */
    createContent(address: string): Promise<FilesResult<OperationDone>>;
    /** 同目录改名；`expected` 是 `identify` 的令牌。 */
    rename(address: string, name: string, options?: {readonly expected?: string}): Promise<FilesResult<OperationDone>>;
    /** 普通文件夹与内容文件夹互转（加或去 `.content` 后缀）。 */
    convert(address: string, to: "content" | "plain", options?: {readonly expected?: string}): Promise<FilesResult<OperationDone>>;
    /** 只改清单：一层的顺序（恰好是这一层清单里的全部条目）。 */
    reorder(directory: string, names: ReadonlyArray<string>): Promise<FilesResult<OperationDone>>;
    /** 只改清单：展示名与图标，`null` 去掉。 */
    display(address: string, display: {readonly title?: string | null; readonly icon?: string | null}): Promise<FilesResult<OperationDone>>;
    /** 只改清单：把未列入的项加入清单。 */
    include(address: string, options?: {readonly before?: string}): Promise<FilesResult<OperationDone>>;
    /** 只改清单：移除一个条目，不动磁盘。 */
    drop(address: string): Promise<FilesResult<OperationDone>>;
    /** 批量移动：源与目标是完整地址，必须同一方案；目标已存在为该项冲突，不覆盖、不合并。立即返回句柄。 */
    move(items: ReadonlyArray<BatchTransfer>): BatchHandle;
    /** 批量复制，规则同移动；源不变。 */
    copy(items: ReadonlyArray<BatchTransfer>): BatchHandle;
    /** 批量删除。 */
    delete(items: ReadonlyArray<{readonly address: string; readonly expected?: string}>): BatchHandle;
    /** 订阅一个方案的变更：同一窗口同一方案共用一条远程订阅。返回释放函数（幂等），释放后不再有回调。 */
    watch(scheme: Scheme, listener: (message: WatchMessage) => void): () => void;
}

/** 浏览器里的插件依赖它取得按调用方的文件客户端。 */
export const filesKey: ServiceKey<FilesService> = defineServiceKey<FilesService>("nbook.files/files");
