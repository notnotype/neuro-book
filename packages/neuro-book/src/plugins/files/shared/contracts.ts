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
    return new TextEncoder().encode(JSON.stringify(text)).length;
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
/** 冲突带回磁盘上的当前基线。 */
const ConflictDetail = Type.Object({detail: Type.String(), current: BaselineSchema}, {additionalProperties: false});

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
    "io-failed": Detail,
} as const satisfies Record<Exclude<FilesFailureCode, "unknown-scheme">, TSchema>;

const PathInput = Type.Object({path: Type.String()}, {additionalProperties: false});

const methods = {
    list: {input: PathInput, output: ListingSchema, effect: "read", errors},
    read: {input: PathInput, output: FileTextSchema, effect: "read", errors},
    write: {input: Type.Object({path: Type.String(), text: Type.String(), baseline: BaselineSchema}, {additionalProperties: false}), output: Saved, effect: "write", errors},
} as const;

/** 写入来源（docs/specs/workspace/resources.md 的“写入来源”）。 */
const SourceSchema = Type.Union([
    Type.Object({kind: Type.Literal("user"), plugin: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("system"), plugin: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("external")}, {additionalProperties: false}),
]);
export type ChangeSource = Static<typeof SourceSchema>;

/** 外部变化只有 `changed`（路径现在存在）与 `deleted`；经文件服务的操作给精确类型。 */
const ChangeSchema = Type.Object({type: Type.Union([Type.Literal("created"), Type.Literal("changed"), Type.Literal("deleted")]), path: Type.String(), source: SourceSchema}, {additionalProperties: false});
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

export interface FilesService {
    list(address: string, options?: {readonly signal?: AbortSignal}): Promise<FilesResult<Listing>>;
    read(address: string, options?: {readonly signal?: AbortSignal}): Promise<FilesResult<FileText>>;
    /** 只保存已有文件；正文超过上限时不发出请求，直接 `too-large`。 */
    write(address: string, text: string, baseline: Baseline): Promise<FilesResult<{readonly baseline: Baseline}>>;
    /** 订阅一个方案的变更：同一窗口同一方案共用一条远程订阅。返回释放函数（幂等），释放后不再有回调。 */
    watch(scheme: Scheme, listener: (message: WatchMessage) => void): () => void;
}

/** 浏览器里的插件依赖它取得按调用方的文件客户端。 */
export const filesKey: ServiceKey<FilesService> = defineServiceKey<FilesService>("nbook.files/files");
