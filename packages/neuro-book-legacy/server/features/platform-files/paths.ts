/**
 * platform.files 的寻址与包含校验：根内相对路径的拒绝集合、目标身份，以及两档包含判定。
 *
 * 包含校验只消费 `nbook/server/runtime/paths/file-path` 的既有工具：词法解析用
 * `resolveContainedFilePath()`，真实路径判定用 `relativeRealPathInside()`。目标型操作要求
 * 目标（解析可检测链接后）位于授予目录内；目录项操作只要求真实父目录位于授予目录内，
 * 因此删除/移动不跟随目标自身的链接。
 *
 * 本文件只做判定与错误构造，不发起任何写操作：判定失败时根外不会有任何创建。
 */

import type {BigIntStats} from "node:fs";
import {lstat} from "node:fs/promises";
import path from "node:path";

import {
    absoluteFsPath,
    relativeFilePathInside,
    relativeRealPathInside,
    resolveContainedFilePath,
} from "nbook/server/runtime/paths/file-path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

import {PlatformFilesError} from "./contracts";
import type {EntryKind} from "./contracts";

export function invalidPathError(detail: string): PlatformFilesError {
    return new PlatformFilesError("invalid-path", `不接受的文件地址：${detail}`);
}

export function outsideRootError(detail: string): PlatformFilesError {
    return new PlatformFilesError("outside-root", `拒绝根外或无法证明位于根内的目标：${detail}`);
}

export function notFoundError(label: string): PlatformFilesError {
    return new PlatformFilesError("not-found", `目标不存在：${label}`);
}

export function ioFailedError(operation: string, cause: unknown): PlatformFilesError {
    return new PlatformFilesError("io-failed", `${operation}失败（${nodeErrorCode(cause)}）`, {cause});
}

export function nodeErrorCode(error: unknown): string {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
        return error.code;
    }
    return "unknown";
}

/**
 * 校验根内相对地址并规范化。
 *
 * 只接受以 `/` 或 `\\` 分隔的相对路径：拒绝空串、NUL、绝对路径、盘符（含 Windows 数据流语法）、
 * UNC 前缀与任何 `..` 段；`.` 段被消去，`.（根自身）` 保留为 `.`。返回结果以 `/` 分隔。
 */
export function assertRelativeAddress(input: string): string {
    if (input.trim() === "") {
        throw invalidPathError("地址不能为空");
    }
    if (input.includes("\0")) {
        throw invalidPathError("地址不能包含 NUL 字符");
    }
    if (/^[\\/]/u.test(input)) {
        throw invalidPathError("不接受绝对路径或 UNC 前缀");
    }
    if (/^[A-Za-z]:/u.test(input)) {
        throw invalidPathError("不接受盘符或缺省目录形式");
    }
    if (process.platform === "win32" && input.includes(":")) {
        throw invalidPathError("Windows 上不接受包含 `:` 的地址段");
    }
    const segments = input.split(/[\\/]+/u);
    for (const segment of segments) {
        if (segment === "..") {
            throw invalidPathError("不接受 `..` 段");
        }
    }
    const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
    return normalized === "" ? "." : normalized;
}

export interface EntryIdentity {
    readonly kind: EntryKind;
    /** 设备与 inode 以字符串比较，避免平台数字精度差异。 */
    readonly device: string;
    readonly inode: string;
    readonly mtimeMs: number;
}

/** 只需三种类型判定，`Stats` 与 `BigIntStats` 都能满足。 */
export interface EntryKindSource {
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
}

export function entryKindOf(stats: EntryKindSource): EntryKind {
    if (stats.isSymbolicLink()) {
        return "link";
    }
    if (stats.isDirectory()) {
        return "directory";
    }
    if (stats.isFile()) {
        return "file";
    }
    return "other";
}

/** 读取目录项自身的身份（不跟随链接）；不存在（含父路径不是目录）返回 null。 */
export async function readEntryIdentity(target: AbsoluteFsPath): Promise<EntryIdentity | null> {
    let stats: BigIntStats;
    try {
        stats = await lstat(target, {bigint: true});
    } catch (error) {
        const code = nodeErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
            return null;
        }
        throw ioFailedError("读取目录项身份", error);
    }
    return {kind: entryKindOf(stats), device: String(stats.dev), inode: String(stats.ino), mtimeMs: Number(stats.mtimeMs)};
}

/** 身份比较只认设备、inode 与类型；mtime 只用于锁探测。 */
export function sameEntryIdentity(expected: EntryIdentity, actual: EntryIdentity): boolean {
    return expected.device === actual.device && expected.inode === actual.inode && expected.kind === actual.kind;
}

export interface ResolvedTarget {
    readonly absolute: AbsoluteFsPath;
    /** 根内相对路径，`/` 分隔，根自身为 `.`。 */
    readonly relativePath: string;
}

export interface ContainedTargetInput {
    readonly rootRealPath: AbsoluteFsPath;
    /** 授予目录：根内相对路径，`.` 表示根自身；它只收窄可达范围，不改变寻址基准。 */
    readonly directory: string;
    /** 已由 `assertRelativeAddress()` 规范化的根内相对路径（以根为基准，与目录项与变更事件同一坐标）。 */
    readonly relativePath: string;
}

/**
 * 目标型操作（read/write/replace/append/stat/list/watch/lock）的包含解析：
 * 目标可以尚不存在，但解析可检测链接后的真实路径必须落在授予目录内。
 */
export async function resolveContainedTarget(input: ContainedTargetInput): Promise<ResolvedTarget> {
    const absolute = absoluteTarget(input);
    const scope = await realGrantScope(input);
    const realTarget = await realRelative(input.rootRealPath, absolute, "解析目标真实路径");
    if (!isInsideScope(scope, realTarget)) {
        throw outsideRootError(`目标 ${relativeText(input)} 解析后不在授予目录内`);
    }
    return {absolute, relativePath: lexicalRelative(input.rootRealPath, absolute)};
}

/**
 * 目录项操作（remove/rename）的包含解析：只校验真实父目录，不跟随目标自身的链接，
 * 因此删除链接只删除链接项本身。授予目录自身是权限边界，不接受对它做目录项操作。
 */
export async function resolveEntryTarget(input: ContainedTargetInput): Promise<ResolvedTarget> {
    const absolute = absoluteTarget(input);
    const relativePath = lexicalRelative(input.rootRealPath, absolute);
    if (relativePath === input.directory) {
        throw new PlatformFilesError("permission-denied", `目录项操作不接受授予目录自身：${relativePath}`);
    }
    const scope = await realGrantScope(input);
    const realParent = await realRelative(input.rootRealPath, absoluteFsPath(path.dirname(absolute)), "解析父目录真实路径");
    if (!isInsideScope(scope, realParent)) {
        throw outsideRootError(`目标 ${relativePath} 的父目录不在授予目录内`);
    }
    return {absolute, relativePath};
}

/**
 * 校验目标父目录的真实路径位于授予目录内；写操作创建父目录前后各调用一次，
 * 使“创建父目录”只在能证明位于根内时发生。
 */
export async function assertParentContained(input: ContainedTargetInput): Promise<void> {
    const scope = await realGrantScope(input);
    const absolute = absoluteTarget(input);
    const realParent = await realRelative(input.rootRealPath, absoluteFsPath(path.dirname(absolute)), "解析父目录真实路径");
    if (!isInsideScope(scope, realParent)) {
        throw outsideRootError(`目标 ${relativeText(input)} 的父目录不在授予目录内`);
    }
}

/** 授予目录自身的真实相对路径；它必须位于根内，否则授予无法定义有效范围。 */
async function realGrantScope(input: ContainedTargetInput): Promise<string> {
    const directoryAbsolute = absoluteFsPath(path.join(input.rootRealPath, input.directory));
    const scope = await realRelative(input.rootRealPath, directoryAbsolute, "解析授予目录真实路径");
    if (scope === null) {
        throw outsideRootError("授予目录的真实路径越过根");
    }
    return scope;
}

/** 真实路径相对化：null 表示位于根外；I/O 与 ENOTDIR 以稳定错误收口。 */
async function realRelative(root: AbsoluteFsPath, target: AbsoluteFsPath, operation: string): Promise<string | null> {
    try {
        return await relativeRealPathInside(root, target);
    } catch (error) {
        if (nodeErrorCode(error) === "ENOTDIR") {
            throw invalidPathError("路径分量不是目录");
        }
        throw ioFailedError(operation, error);
    }
}

function absoluteTarget(input: ContainedTargetInput): AbsoluteFsPath {
    try {
        const target = resolveContainedFilePath(input.rootRealPath, input.relativePath);
        return absoluteFsPath(target);
    } catch (error) {
        if (nodeErrorCode(error) === "unknown") {
            throw outsideRootError(`目标 ${relativeText(input)} 的词法解析越过根`);
        }
        throw ioFailedError("解析目标路径", error);
    }
}

/** 词法相对路径：目标由 `absoluteTarget()` 从根拼出，因此结果必然位于根内。 */
function lexicalRelative(root: AbsoluteFsPath, target: AbsoluteFsPath): string {
    const relative = relativeFilePathInside(root, target);
    if (relative === null) {
        throw outsideRootError("目标词法解析越过根");
    }
    return relative;
}

function isInsideScope(scope: string, candidate: string | null): boolean {
    if (candidate === null) {
        return false;
    }
    if (scope === ".") {
        return true;
    }
    return candidate === scope || candidate.startsWith(`${scope}/`);
}

/** 错误文本里的目标描述：只用根内相对地址，不带宿主绝对路径。 */
function relativeText(input: ContainedTargetInput): string {
    return input.relativePath;
}
