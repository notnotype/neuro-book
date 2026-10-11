/** 内置工具模块的公开类型，逐字对应 docs/specs/harness/builtin-tools.md 的“输入与前置条件”。 */

import type {EditStore} from "@oh-my-pi/pi-natives";
import type {ToolDefinition, ToolSource} from "../tools/tools";

export type {EditStore, ToolDefinition, ToolSource};

export type FilesFailure = "invalid-address" | "unknown-scheme" | "read-only" | "outside-root" | "not-found" | "not-a-file" | "not-a-directory" | "io-failed";
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

/** 资源地址 `方案://路径`（docs/specs/workspace/resources.md）：路径相对方案根，根本身是空路径。 */
export type ResourceAddress = {scheme: string; path: string};

/** 目录型提供者：一个真实目录当根，就是 `FileAccess`；`readonly` 的方案拒绝写入（`read-only`）。 */
export interface DirectoryProvider extends FileAccess {
    readonly kind: "directory";
    readonly readonly: boolean;
}

/** 虚拟提供者：数据不在真实目录里（例如溢出的工具结果），只读，不可编辑。 */
export interface VirtualProvider {
    readonly kind: "virtual";
    stat(path: string): Promise<FilesResult<{kind: FileKind; bytes: number}>>;
    readText(path: string): Promise<FilesResult<string>>;
    list(path: string): Promise<FilesResult<{name: string; kind: FileKind}[]>>;
}

export type ResourceProvider = DirectoryProvider | VirtualProvider;
export type SchemeContext = {sessionId: string};
/** 登记一个方案：给提供者对象，或按会话构造提供者的工厂（`local://`、`artifact://` 都是按会话的）；`doc` 一句话告诉模型它是什么。 */
export type SchemeDefinition = {provider: ResourceProvider | ((context: SchemeContext) => ResourceProvider); doc: string};
export type SchemeInfo = {scheme: string; doc: string};

/** 按方案取提供者；内核不预设任何方案，都由使用方登记。 */
export interface ResourceAccess {
    schemes(): SchemeInfo[];
    open(scheme: string, context: SchemeContext): ResourceProvider | undefined;
}

export interface SnapshotStores {
    forSession(sessionId: string): EditStore;
    release(sessionId: string): void;
}

export type ReadBudget = {maxLines?: number; maxBytes?: number};
