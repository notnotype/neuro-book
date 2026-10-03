/**
 * platform.files 的公开合同：根能力、受根约束的操作、受管句柄与唯一会抛出的错误类。
 *
 * 本文件只有类型、错误类与服务键；实现见 ./grants、./paths、./service，装配见 ./plugin。
 * 调用方按 `PlatformFilesError.code` 分支，不按文案分支；错误文本不携带文件内容。
 * 行为合同见 docs/specs/platform/files.md。
 */

import type {ReleaseDependency, Scope} from "nbook/runtime/lifecycle/lifecycle";
import {defineServiceKey} from "nbook/runtime/services/services";
import type {ServiceKey} from "nbook/runtime/services/services";

/** 操作签字：只读、写（含创建与替换）、删除分开声明，任一缺失即整体拒绝。 */
export type RootOperation = "read" | "write" | "delete";

export type PlatformFilesErrorCode =
    | "outside-root"
    | "invalid-path"
    | "permission-denied"
    | "not-found"
    | "already-exists"
    | "identity-changed"
    | "grant-revoked"
    | "closed"
    | "stopping"
    | "cancelled"
    | "outcome-unknown"
    | "lock-held"
    | "lock-compromised"
    | "io-failed";

/** 本能力的唯一错误类型；`code` 是程序分支依据，`message` 只用于诊断。 */
export class PlatformFilesError extends Error {
    readonly code: PlatformFilesErrorCode;

    constructor(code: PlatformFilesErrorCode, message: string, options: {readonly cause?: unknown} = {}) {
        super(message, options);
        this.name = "PlatformFilesError";
        this.code = code;
    }
}

export function isPlatformFilesError(error: unknown): error is PlatformFilesError {
    return error instanceof PlatformFilesError;
}

/**
 * 一份根能力：可信 owner 签发给特定消费者的操作授予。
 *
 * 授予由服务实例签发并登记，调用方无法构造；`rootId` 是稳定根身份，`grantId` 每份授予独立。
 * `narrow()` 只能派生更窄的授予（原授予目录内的子目录 + 操作子集），不能扩大。所有地址（操作入参、
 * 派生目录、目录项与变更事件的路径）都以根为基准；授予目录只收窄可达范围，不改变寻址基准。
 */
export interface RootGrant {
    readonly rootId: string;
    readonly grantId: string;
    readonly operations: ReadonlyArray<RootOperation>;
    allows(operation: RootOperation): boolean;
    narrow(relativeDir: string, operations: ReadonlyArray<RootOperation>): RootGrant;
}

/** 宿主声明的根：绝对路径由宿主先校验，激活时再验证存在且为目录并记录 realpath 身份。 */
export interface RootSpec {
    readonly id: string;
    readonly path: string;
    readonly maxOperations: ReadonlyArray<RootOperation>;
}

/** 一份授予声明：消费者只能解析自己在清单里声明依赖的授予键。 */
export interface GrantSpec {
    readonly key: ServiceKey<RootGrant>;
    /** `RootSpec.id`。 */
    readonly root: string;
    /** 必须落在该根的 `maxOperations` 内。 */
    readonly operations: ReadonlyArray<RootOperation>;
}

export type EntryKind = "file" | "directory" | "link" | "other";

export interface FileStat {
    readonly kind: EntryKind;
    readonly size: number;
    readonly mtimeMs: number;
}

/** 目录项；`relativePath` 以根为基准、`/` 分隔，可原样作为后续操作的相对路径。 */
export interface DirectoryEntry {
    readonly name: string;
    readonly relativePath: string;
    readonly kind: EntryKind;
}

/** 所有操作都接受取消信号；取消是请求，不是终止确认。 */
export interface OperationOptions {
    readonly signal?: AbortSignal;
}

export interface WriteOptions extends OperationOptions {
    /** 要求返回前完成 flush（fsync）；不要求时不承诺崩溃后的持久性。 */
    readonly flush?: boolean;
}

export interface ReplaceOptions extends OperationOptions {
    /** 额外要求持久化目录项（同目录 best-effort fsync）；写入内容总是先 fsync。 */
    readonly durable?: boolean;
}

export interface RemoveOptions extends OperationOptions {
    /** 递归删除；不跨链接边界，遇链接只删除链接项本身。 */
    readonly recursive?: boolean;
}

/** 变更事件：根身份 + 根内相对路径 + 类别；尽力投递、可合并，消费者须重读内容。 */
export interface WatchEvent {
    readonly rootId: string;
    readonly path: string;
    readonly kind: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
}

export interface WatchOptions extends OperationOptions {
    /** 句柄登记到调用方作用域；作用域关闭即释放句柄。 */
    readonly scope: Scope;
    readonly onEvent: (event: WatchEvent) => void;
    /**
     * 本句柄消费的提供者（通常取服务解析结果里的 `binding.dependency`）：
     * 声明后本句柄先于该借用释放，owner 关闭时不会看到未释放的句柄。
     */
    readonly dependsOn?: ReadonlyArray<ReleaseDependency>;
}

export interface WatchHandle {
    /** watcher 完成初始扫描；`watch()` 返回时已兑现。 */
    readonly ready: Promise<void>;
    /** 幂等；释放后不再开始排队回调，已开始回调在释放时等待结束。 */
    close(): Promise<void>;
}

export type LockState = "held" | "compromised";

export interface LockOptions extends OperationOptions {
    readonly scope: Scope;
    /** 锁过期窗口（毫秒）；实现按 proper-lockfile 的下限收紧（>= 2000）。 */
    readonly staleMs?: number;
    /** 心跳间隔（毫秒）；实现按 proper-lockfile 的下限收紧（>= 1000）。 */
    readonly updateMs?: number;
    readonly dependsOn?: ReadonlyArray<ReleaseDependency>;
}

export interface LockHandle {
    /** 探测本参与者是否仍持有；探测到失效即报告 compromised，不自动抢回。 */
    check(): Promise<LockState>;
    /** 幂等；被接管时不删除他人的锁目录。 */
    release(): Promise<void>;
}

/**
 * 受根约束的文件能力：只接受根内相对路径与已签发授予，不服务任意 HTTP 路径，
 * 也不自行发现、扩大或提升根。
 */
export interface PlatformFiles {
    readFile(grant: RootGrant, relativePath: string, options?: OperationOptions): Promise<Uint8Array>;
    readText(grant: RootGrant, relativePath: string, options?: OperationOptions): Promise<string>;
    writeFile(grant: RootGrant, relativePath: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>;
    replaceFile(grant: RootGrant, relativePath: string, data: string | Uint8Array, options?: ReplaceOptions): Promise<void>;
    appendFile(grant: RootGrant, relativePath: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>;
    stat(grant: RootGrant, relativePath: string, options?: OperationOptions): Promise<FileStat>;
    list(grant: RootGrant, relativePath: string, options?: OperationOptions): Promise<ReadonlyArray<DirectoryEntry>>;
    /** 仅在父目录已存在时排他创建；目标已存在（包括链接）时不覆盖并报告 already-exists。 */
    createFile(grant: RootGrant, relativePath: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>;
    createDirectory(grant: RootGrant, relativePath: string, options?: OperationOptions): Promise<void>;
    mkdir(grant: RootGrant, relativePath: string, options?: OperationOptions): Promise<void>;
    remove(grant: RootGrant, relativePath: string, options?: RemoveOptions): Promise<void>;
    rename(grant: RootGrant, from: string, to: string, options?: OperationOptions): Promise<void>;
    watch(grant: RootGrant, relativePath: string, options: WatchOptions): Promise<WatchHandle>;
    lock(grant: RootGrant, relativePath: string, options: LockOptions): Promise<LockHandle>;
}

/** 平台文件服务键；消费者经它取得服务实例，经授予键取得根能力。 */
export const platformFilesKey = defineServiceKey<PlatformFiles>("nbook.platform-files/files");
