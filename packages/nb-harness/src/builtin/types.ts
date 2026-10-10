/** 内置工具模块的公开类型，逐字对应 docs/specs/harness/builtin-tools.md 的“输入与前置条件”。 */

import type {EditStore} from "@oh-my-pi/pi-natives";
import type {ToolDefinition, ToolSource} from "../tools/tools";

export type {EditStore, ToolDefinition, ToolSource};

export type FilesFailure = "outside-root" | "not-found" | "not-a-file" | "not-a-directory" | "io-failed";
export type FilesResult<T> = {ok: true; value: T} | {ok: false; code: FilesFailure; detail: string};

export type FileKind = "file" | "directory";

export interface FileAccess {
    readonly root: string;
    /** 只按字面规范化判根内，同步；不碰文件系统，所以认不出符号链接。 */
    resolve(path: string): FilesResult<string>;
    /** 按真实路径判根内：目标或任一级父目录经符号链接指向根外、或链接目标不存在（无法证明在根内）都是 outside-root。 */
    locate(path: string): Promise<FilesResult<string>>;
    stat(path: string): Promise<FilesResult<{kind: FileKind; bytes: number}>>;
    readBytes(path: string): Promise<FilesResult<Uint8Array>>;
    list(path: string): Promise<FilesResult<{name: string; kind: FileKind}[]>>;
    write(path: string, content: string): Promise<FilesResult<void>>;
    remove(path: string): Promise<FilesResult<void>>;
}

export interface SnapshotStores {
    forSession(sessionId: string): EditStore;
    release(sessionId: string): void;
}

export type ReadBudget = {maxLines?: number; maxBytes?: number};
