/**
 * 写入接口（docs/specs/workspace/resources.md 的“写入接口”）：`nbook.files` 交给服务端与项目实例里插件的按调用方服务。
 * 读交回字节与基线或本机读路径，调用方自己读；写只有一个入口：写入方把新内容写进暂存文件，由拥有根的进程在锁里提交。
 * 这里只有类型与两端都能用的辅助，不引 Node。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {Baseline, BatchResult, CommitExpect, Identified, Listing, OperationDone} from "./contracts";
import type {AgentOnBehalf, ServerFilesResult, VirtualListing} from "./schemes";

export type {Baseline, CommitExpect} from "./contracts";
export type {ServerFilesResult} from "./schemes";

export interface CallOptions {
    readonly signal?: AbortSignal;
    /**
     * 只接受服务端的 `nbook.agent`：注明代表哪个 Agent 会话（`entry` 是一次工具调用的条目 id）。别的调用方带了为
     * `invalid-input`。
     */
    readonly as?: {readonly agent: AgentOnBehalf & {readonly entry?: string}};
}

export interface CommitOptions extends CallOptions {
    /** 必填：基线是条件写；`absent` 只在不存在时新建；`any` 不论现状覆盖。 */
    readonly expect: CommitExpect;
    /** 父目录不存在时按段建好。 */
    readonly createParents?: boolean;
}

/** `stage` 交给写入函数的写入口。 */
export interface StagedSink {
    /** 只收字节：文本自己编码（避免在多字节字符中间切块）。写盘失败或调用已取消时抛出，`stage` 交回失败结果。 */
    write(chunk: Uint8Array): Promise<void>;
}

/** 本机读路径：只用来读，往里写等于外部改动。 */
export interface ReadPath {
    readonly path: string;
    readonly kind: "file" | "directory" | "other";
}

export interface WorkspaceFiles {
    /** 字节与基线，读改写用；超过 32 MB 为 `too-large`，改用 `readPath`。虚拟根交回它的文字。 */
    read(address: string, options?: CallOptions): Promise<ServerFilesResult<{readonly bytes: Uint8Array; readonly baseline: Baseline}>>;
    /** 本机读路径（按方案的读授权；项目与 `user://` 里的链接跟到最终目标）。 */
    readPath(address: string, options?: CallOptions): Promise<ServerFilesResult<ReadPath>>;
    list(address: string, options?: CallOptions): Promise<ServerFilesResult<Listing | VirtualListing>>;
    /** 流式写：`write` 正常结束即提交，抛错或取消即丢弃；结果统一经返回值交回，不抛出。 */
    stage(address: string, write: (sink: StagedSink) => Promise<void>, options: CommitOptions): Promise<ServerFilesResult<{readonly baseline: Baseline}>>;
    /** 整份写入并提交；字符串按 UTF-8 编码。 */
    write(address: string, content: Uint8Array | string, options: CommitOptions): Promise<ServerFilesResult<{readonly baseline: Baseline}>>;
    /** 读、改、按读到的基线写回，冲突时重读重算（至多 3 次）。只用于 UTF-8 文本。 */
    update(address: string, edit: (text: string) => string, options?: CallOptions): Promise<ServerFilesResult<{readonly baseline: Baseline}>>;

    // 文件操作：参数、结果与失败码同浏览器的 FilesService（docs/specs/workspace/files.md 的“文件操作”）；挂载方案只有 `create`。
    identify(addresses: ReadonlyArray<string>, options?: CallOptions): Promise<ServerFilesResult<Identified>>;
    create(address: string, kind: "file" | "directory", options?: CallOptions & {readonly before?: string}): Promise<ServerFilesResult<OperationDone>>;
    createContent(address: string, options?: CallOptions): Promise<ServerFilesResult<OperationDone>>;
    rename(address: string, name: string, options?: CallOptions & {readonly expected?: string}): Promise<ServerFilesResult<OperationDone>>;
    convert(address: string, to: "content" | "plain", options?: CallOptions & {readonly expected?: string}): Promise<ServerFilesResult<OperationDone>>;
    reorder(directory: string, names: ReadonlyArray<string>, options?: CallOptions): Promise<ServerFilesResult<OperationDone>>;
    display(address: string, display: {readonly title?: string | null; readonly icon?: string | null}, options?: CallOptions): Promise<ServerFilesResult<OperationDone>>;
    include(address: string, options?: CallOptions & {readonly before?: string}): Promise<ServerFilesResult<OperationDone>>;
    drop(address: string, options?: CallOptions): Promise<ServerFilesResult<OperationDone>>;
    /** 批量移动；源与目标是完整地址，必须同一方案。`before` 见 `FilesService.move`。 */
    move(items: ReadonlyArray<{readonly source: string; readonly target: string; readonly expected?: string; readonly before?: string | null}>, options?: CallOptions): Promise<ServerFilesResult<BatchResult>>;
    copy(items: ReadonlyArray<{readonly source: string; readonly target: string; readonly expected?: string}>, options?: CallOptions): Promise<ServerFilesResult<BatchResult>>;
    delete(items: ReadonlyArray<{readonly address: string; readonly expected?: string}>, options?: CallOptions): Promise<ServerFilesResult<BatchResult>>;

    /** 操作分组：经 `scoped` 的写入与文件操作带同一个组；不回滚。 */
    group<T>(info: {readonly title: string; readonly note?: string}, run: (scoped: WorkspaceFiles) => Promise<T>): Promise<T>;
}


export const workspaceFilesKey: ServiceKey<WorkspaceFiles> = defineServiceKey<WorkspaceFiles>("nbook.files/workspace");

/** 磁盘字节的基线，与文件服务同一算法（SHA-256）；给已经自己读了文件的调用方。 */
export async function baselineOf(bytes: Uint8Array<ArrayBuffer>): Promise<Baseline> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return {hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")};
}
