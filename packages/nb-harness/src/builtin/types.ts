/** 内置工具模块的公开类型，逐字对应 docs/specs/harness/builtin-tools.md 的“输入与前置条件”。 */

import type {EditStore} from "@oh-my-pi/pi-natives";
import type {ToolDefinition, ToolSource} from "../tools/tools";

export type {EditStore, ToolDefinition, ToolSource};

export type FilesFailure = "outside-root" | "not-found" | "not-a-file" | "not-a-directory" | "io-failed";
export type FilesResult<T> = {ok: true; value: T} | {ok: false; code: FilesFailure; detail: string};

export type FileKind = "file" | "directory";

export interface FileAccess {
    readonly root: string;
    resolve(path: string): FilesResult<string>;
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
