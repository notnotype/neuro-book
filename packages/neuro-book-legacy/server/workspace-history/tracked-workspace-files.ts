import path from "node:path";
import fs from "node:fs/promises";
import {consola} from "consola";
import type {OperationActor} from "@notnotype/nb-history";
import type {WorkspaceFileSourceIdentity} from "nbook/shared/dto/workspace-file-operation.dto";
import {
    convertWorkspaceFileToDirectory,
    WorkspacePathCopyError,
    copyWorkspacePath,
    createWorkspaceDirectory,
    createWorkspaceFile,
    deleteWorkspacePath,
    renameWorkspacePath,
    resolveWorkspacePath,
    writeWorkspaceTextFile,
    type WorkspaceFileNode,
    type WorkspaceFileToDirectoryInput,
    type WorkspaceNewDirectoryInput,
    type WorkspaceNewFileInput,
} from "nbook/server/workspace-files/workspace-files";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import type {WorkspaceUploadedFileResult} from "nbook/server/workspace-files/workspace-upload";
import {assertWorkspaceStorageBoundary, WorkspaceStorageBoundaryError} from "nbook/server/workspace-files/workspace-storage-boundary";
import {
    LOCAL_USER_ID,
    collectTrackedDiskFiles,
    recordProjectDelete,
    recordProjectRename,
    recordProjectWrite,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

/**
 * 带记账的 workspace 写入包装层（Task 95 N2）。
 *
 * 每个包装函数 = 原核心函数 + 文件历史记账：非项目 root（user-assets / 容器根）零成本透传；
 * 项目 root 下补齐 before 读取并按操作语义 register 到 history。记账一律 fail-open——
 * 任何记账环节失败都不影响写盘结果（漏账由 watcher / 写入口内建对账收敛为 external）。
 * 不动 workspace-files.ts 的核心函数签名：它还服务 user-assets，且底层纯 fs 模块不应反向依赖 history。
 */

/** 编辑器 / 前端路由写入的固定归因（D10：单机产品本地用户）。 */
export const USER_LOCAL_ACTOR: OperationActor = {kind: "user", userId: LOCAL_USER_ID};

/** 记账读盘上限：删除/上传记账单文件读取的最大字节，超限跳过记账（对账自愈补 external）。 */
const RECORD_READ_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 覆盖写文本文件 + 记账。
 * knownBefore：调用方已读到的写前内容（如 write 路由冲突检测已读），省一次读盘；
 * undefined = 由本函数读盘补 before，null = 明确此前文件不存在。
 */
export async function writeWorkspaceTextFileTracked(input: {
    target: WorkspaceFileTarget;
    /** Project target必填；plain Workspace不使用History。 */
    history?: ProjectHistoryHandle;
    filePath: string;
    content: string;
    actor: OperationActor;
    knownBefore?: string | null;
}): Promise<void> {
    await assertWorkspaceStorageBoundary(input.target, input.filePath, "mutation");
    const target = historyTarget(input.target);
    const before = target === null
        ? null
        : input.knownBefore !== undefined
            ? (input.knownBefore === null ? null : new TextEncoder().encode(input.knownBefore))
            : await readBytesForRecord(target.projectRoot, input.filePath);
    await writeWorkspaceTextFile(input.target.root, input.filePath, input.content);
    if (target !== null) {
        await recordProjectWrite(requireHistory(input.history), {
            relativePath: input.filePath,
            actor: input.actor,
            before,
            after: new TextEncoder().encode(input.content),
        });
    }
}

/** 创建新文本文件 + 记账（已存在时核心函数拒绝，不会产生覆盖语义）。 */
export async function createWorkspaceFileTracked(input: Omit<WorkspaceNewFileInput, "root"> & {target: WorkspaceFileTarget; history?: ProjectHistoryHandle; actor: OperationActor}): Promise<WorkspaceFileNode> {
    await assertWorkspaceStorageBoundary(input.target, input.filePath, "mutation");
    const node = await createWorkspaceFile({...input, root: input.target.root});
    const target = historyTarget(input.target);
    if (target !== null) {
        await recordProjectWrite(requireHistory(input.history), {
            relativePath: input.filePath,
            actor: input.actor,
            before: null,
            after: new TextEncoder().encode(input.content ?? ""),
        });
    }
    return node;
}

/** 创建目录 + 对附带的 index.md / state.md 逐个记账（目录本身不是账面对象）。 */
export async function createWorkspaceDirectoryTracked(input: Omit<WorkspaceNewDirectoryInput, "root"> & {target: WorkspaceFileTarget; history?: ProjectHistoryHandle; actor: OperationActor}): Promise<WorkspaceFileNode> {
    await assertWorkspaceStorageBoundary(input.target, input.dirPath, "mutation");
    const node = await createWorkspaceDirectory({...input, root: input.target.root});
    const target = historyTarget(input.target);
    if (target !== null) {
        const dirPath = normalizeSlashes(input.dirPath);
        if (input.indexContent !== undefined && input.indexContent !== null) {
            await recordProjectWrite(requireHistory(input.history), {
                relativePath: `${dirPath}/index.md`,
                actor: input.actor,
                before: null,
                after: new TextEncoder().encode(input.indexContent),
            });
        }
        if (input.stateContent !== undefined && input.stateContent !== null) {
            await recordProjectWrite(requireHistory(input.history), {
                relativePath: `${dirPath}/state.md`,
                actor: input.actor,
                before: null,
                after: new TextEncoder().encode(input.stateContent),
            });
        }
    }
    return node;
}

/**
 * 文件转目录节点 + 记账。语义 = 一条 rename（`foo.md` → `foo/index.md`，内容不变）：
 * 时间线跨转换连续，优于 delete + create 的断链表达。
 */
export async function convertWorkspaceFileToDirectoryTracked(input: Omit<WorkspaceFileToDirectoryInput, "root"> & {target: WorkspaceFileTarget; history?: ProjectHistoryHandle; actor: OperationActor}): Promise<WorkspaceFileNode> {
    await assertWorkspaceStorageBoundary(input.target, input.filePath, "mutation");
    const node = await convertWorkspaceFileToDirectory({...input, root: input.target.root});
    const target = historyTarget(input.target);
    if (target !== null) {
        const fromPath = normalizeSlashes(input.filePath);
        const parsed = path.posix.parse(fromPath);
        await recordProjectRename(requireHistory(input.history), {
            fromPath,
            toPath: path.posix.join(parsed.dir, parsed.name, "index.md"),
            actor: input.actor,
        });
    }
    return node;
}

/** 移动 / 改名 + 记账。目录改名展开为「目录内每个受管文件一条 rename」（账面对象是文件）。 */
export async function renameWorkspacePathTracked(input: {
    target: WorkspaceFileTarget;
    /** Project target必填；plain Workspace不使用History。 */
    history?: ProjectHistoryHandle;
    fromPath: string;
    toPath: string;
    actor: OperationActor;
}): Promise<WorkspaceFileNode> {
    const target = historyTarget(input.target);
    await assertWorkspaceStorageBoundary(input.target, input.fromPath, "mutation");
    await assertWorkspaceStorageBoundary(input.target, input.toPath, "mutation");
    const fromPath = normalizeSlashes(input.fromPath);
    const toPath = normalizeSlashes(input.toPath);
    if (fromPath === toPath) {
        return await renameWorkspacePath(input.target.root, input.fromPath, input.toPath);
    }
    // rename 前判定形态并枚举目录内容（rename 后源路径已不存在）。
    const childFiles = target === null ? [] : await listDirectoryFilesForRecord(target.projectRoot, fromPath);
    const node = await renameWorkspacePath(input.target.root, input.fromPath, input.toPath);
    if (target !== null) {
        if (childFiles === null) {
            await recordProjectRename(requireHistory(input.history), {fromPath, toPath, actor: input.actor});
        } else {
            for (const child of childFiles) {
                await recordProjectRename(requireHistory(input.history), {
                    fromPath: `${fromPath}/${child}`,
                    toPath: `${toPath}/${child}`,
                    actor: input.actor,
                });
            }
        }
    }
    return node;
}

/** 删除 + 记账。目录删除展开为「每个受管文件一条 delete」，删除前逐个读 before 保住找回快照。 */
export async function deleteWorkspacePathTracked(input: {
    target: WorkspaceFileTarget;
    /** Project target必填；plain Workspace不使用History。 */
    history?: ProjectHistoryHandle;
    filePath: string;
    recursive: boolean;
    actor: OperationActor;
}): Promise<void> {
    const target = historyTarget(input.target);
    await assertWorkspaceStorageBoundary(input.target, input.filePath, "mutation");
    const filePath = normalizeSlashes(input.filePath);
    // 删除前收集 before：文件 = 单条；目录 = 目录内全部受管文件。
    const pendingDeletes: Array<{relativePath: string; before: Uint8Array}> = [];
    if (target !== null) {
        const childFiles = await listDirectoryFilesForRecord(target.projectRoot, filePath);
        const targets = childFiles === null ? [filePath] : childFiles.map((child) => `${filePath}/${child}`);
        for (const relativePath of targets) {
            const before = await readBytesForRecord(target.projectRoot, relativePath);
            if (before !== null) {
                pendingDeletes.push({relativePath, before});
            }
        }
    }
    await deleteWorkspacePath(input.target.root, input.filePath, input.recursive);
    for (const pending of pendingDeletes) {
        await recordProjectDelete(requireHistory(input.history), {
            relativePath: pending.relativePath,
            actor: input.actor,
            before: pending.before,
        });
    }
}
export type BatchWorkspacePathItem = {
    source: string;
    target: string;
    status: "success" | "failed" | "skipped" | "not-executed" | "cancelled" | "unknown";
    stopReason?: "binding" | "authorization";
    reason?: string;
    residualPaths?: readonly string[];
};

export async function batchWorkspacePathsTracked(input: {
    target: WorkspaceFileTarget;
    history?: ProjectHistoryHandle;
    kind: "copy" | "move";
    sources: string[];
    destination: string;
    actor: OperationActor;
    targetNames?: Record<string, string>;
    expectedSources?: Record<string, WorkspaceFileSourceIdentity>;
    revalidateTarget?: () => Promise<void>;
}): Promise<BatchWorkspacePathItem[]> {
    const results: BatchWorkspacePathItem[] = [];
    let stopReason: "binding" | "authorization" | undefined;
    const valid = (value: string): boolean => value.length > 0
        && !value.startsWith("/") && !path.win32.isAbsolute(value)
        && !value.split("/").some((segment) => segment === ".." || segment === "." || segment === "");
    const unique = [...new Set(input.sources.map((source) => source.replace(/\\/g, "/").replace(/\/+$/u, "")))];
    const sources = unique.filter((source) => !unique.some((other) => other !== source && valid(other) && source.startsWith(`${other}/`)));
    const seenSourceIdentities = new Set<string>();
    const destinationValid = input.destination === "" || valid(input.destination.replace(/\\/g, "/").replace(/\/+$/u, ""));
    const destination = normalizeSlashes(input.destination);
    for (const rawSource of sources) {
        const name = input.targetNames && Object.hasOwn(input.targetNames, rawSource) ? input.targetNames[rawSource]! : path.posix.basename(rawSource);
        const source = normalizeSlashes(rawSource);
        const targetPath = destination ? `${destination}/${name}` : name;
        if (!stopReason && input.revalidateTarget) {
            try {
                await input.revalidateTarget();
            } catch {
                stopReason = "binding";
            }
        }
        if (stopReason) {
            results.push({source, target: targetPath, status: "not-executed", stopReason, reason: stopReason === "binding" ? "Project 绑定已失效" : "工作区授权已失效"});
            continue;
        }
        if (!valid(rawSource) || !destinationValid || !valid(name) || name !== name.trim() || /[\\/]/u.test(name)) {
            results.push({source: rawSource, target: targetPath, status: destinationValid ? "failed" : "not-executed", reason: "文件路径无效"});
            continue;
        }
        if (input.target.kind === "project-workspace" && !input.history) {
            stopReason = "binding";
            results.push({source, target: targetPath, status: "not-executed", stopReason, reason: "Project 绑定已失效"});
            continue;
        }
        try {
            await assertWorkspaceStorageBoundary(input.target, source, "mutation");
            await assertWorkspaceStorageBoundary(input.target, targetPath, "mutation");
            const absoluteSource = resolveWorkspacePath(input.target.root, source);
            const sourceEntry = await fs.lstat(absoluteSource);
            if (sourceEntry.isSymbolicLink()) {
                results.push({source, target: targetPath, status: "failed", reason: "不支持操作符号链接来源"});
                continue;
            }
            const sourceStat = await fs.stat(absoluteSource);
            const physicalSource = await fs.realpath(absoluteSource);
            const sourceIdentityKey = process.platform === "win32" ? physicalSource.toLowerCase() : physicalSource;
            if (seenSourceIdentities.has(sourceIdentityKey)) {
                results.push({source, target: targetPath, status: "skipped", reason: "来源与本批次另一项指向同一文件"});
                continue;
            }
            seenSourceIdentities.add(sourceIdentityKey);
            if (targetPath === source || targetPath.startsWith(`${source}/`)) {
                results.push({source, target: targetPath, status: "skipped", reason: "不能移动到自身或自身后代"});
                continue;
            }
            if (input.expectedSources) {
                const expected = Object.hasOwn(input.expectedSources, rawSource) ? input.expectedSources[rawSource] : undefined;
                if (!expected) {
                    results.push({source, target: targetPath, status: "failed", reason: "缺少来源身份，请重新选择文件"});
                    continue;
                }
                const actual = sourceStat;
                if (!Number.isFinite(actual.dev) || !Number.isFinite(actual.ino) || actual.ino === 0 || !Number.isFinite(actual.birthtimeMs)
                    || !Number.isFinite(expected.dev) || !Number.isFinite(expected.ino) || expected.ino === 0 || !Number.isFinite(expected.birthtimeMs)
                    || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.birthtimeMs !== expected.birthtimeMs) {
                    results.push({source, target: targetPath, status: "failed", reason: "来源文件已被替换，请重新选择文件"});
                    continue;
                }
            }
            if (input.kind === "copy") {
                await copyWorkspacePath(input.target.root, source, targetPath);
                const history = historyTarget(input.target);
                if (history) {
                    try {
                        const children = await listDirectoryFilesForRecord(history.projectRoot, targetPath);
                        for (const file of children === null ? [targetPath] : children.map(child => `${targetPath}/${child}`)) {
                            const after = await readBytesForRecord(history.projectRoot, file);
                            if (after) await recordProjectWrite(requireHistory(input.history), {relativePath: file, actor: input.actor, before: null, after});
                        }
                    } catch (error) {
                        consola.warn({targetPath, error}, "批量复制已完成但History记账失败");
                    }
                }
            } else {
                await renameWorkspacePathTracked({target: input.target, history: input.history, fromPath: source, toPath: targetPath, actor: input.actor});
            }
            results.push({source, target: targetPath, status: "success"});
        } catch (error) {
            if (error instanceof WorkspacePathCopyError) {
                const history = historyTarget(input.target);
                if (history) {
                    for (const residual of error.mappings) {
                        try {
                            const after = await readBytesForRecord(history.projectRoot, residual);
                            if (after) await recordProjectWrite(requireHistory(input.history), {relativePath: residual, actor: input.actor, before: null, after});
                        } catch (recordError) {
                            consola.warn({residual, error: recordError}, "批量复制残留History记账失败");
                        }
                    }
                }
            }
            if (error instanceof WorkspaceStorageBoundaryError || isAuthorizationFailure(error instanceof WorkspacePathCopyError ? error.cause : error)) stopReason = "authorization";
            results.push({source, target: targetPath, status: "failed", reason: error instanceof Error ? error.message : "文件操作失败",
                ...(stopReason ? {stopReason} : {}),
                ...(error instanceof WorkspacePathCopyError ? {residualPaths: error.mappings} : {})});
        }
    }
    return results;
}

function isAuthorizationFailure(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    return ("statusCode" in error && (error.statusCode === 401 || error.statusCode === 403))
        || ("code" in error && (error.code === "EACCES" || error.code === "EPERM"));
}


/** 上传结果记账：对 action === "written" 的文件补 create 账（upload 对已存在文件恒 skip，before 必为 null）。 */
export async function recordUploadedFiles(input: {
    target: WorkspaceFileTarget;
    /** Project target必填；plain Workspace不使用History。 */
    history?: ProjectHistoryHandle;
    files: WorkspaceUploadedFileResult[];
    actor: OperationActor;
}): Promise<void> {
    const target = historyTarget(input.target);
    if (target === null) {
        return;
    }
    for (const file of input.files) {
        if (file.action !== "written") {
            continue;
        }
        const bytes = await readBytesForRecord(target.projectRoot, file.path);
        if (bytes === null) {
            continue;
        }
        await recordProjectWrite(requireHistory(input.history), {
            relativePath: file.path,
            actor: input.actor,
            before: null,
            after: bytes,
        });
    }
}

/** 记账用读盘：不存在 / 非文件 / 超限 / 读失败一律返回 null（fail-open，误差由对账自愈）。 */
async function readBytesForRecord(projectRoot: AbsoluteFsPath, relativePath: string): Promise<Uint8Array | null> {
    try {
        const absolutePath = resolveWorkspacePath(projectRoot, relativePath);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat?.isFile() || stat.size > RECORD_READ_MAX_BYTES) {
            return null;
        }
        return await fs.readFile(absolutePath);
    } catch (error) {
        consola.warn({relativePath, error}, "workspace-history 记账读盘失败（跳过 before）");
        return null;
    }
}

/** 目录记账枚举：目标是目录时返回其中受管文件的相对子路径清单；是文件时返回 null。失败按空目录处理。 */
async function listDirectoryFilesForRecord(projectRoot: AbsoluteFsPath, relativePath: string): Promise<string[] | null> {
    try {
        const absolutePath = resolveWorkspacePath(projectRoot, relativePath);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat) {
            return null;
        }
        if (!stat.isDirectory()) {
            return null;
        }
        const files = await collectTrackedDiskFiles(projectRoot, normalizeSlashes(relativePath));
        const prefix = `${normalizeSlashes(relativePath)}/`;
        return files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
    } catch (error) {
        consola.warn({relativePath, error}, "workspace-history 目录记账枚举失败（跳过该目录记账）");
        return [];
    }
}

/**
 * 从Workspace文件操作目标取得History项目身份。
 *
 * Project root与物理Project Workspace根由上游入口一次确定；本层不从绝对路径
 * 反推领域身份，也不重新读取State Root或cwd。
 */
function historyTarget(target: WorkspaceFileTarget): {projectRoot: AbsoluteFsPath} | null {
    if (target.kind !== "project-workspace") {
        return null;
    }
    return {
        projectRoot: target.root,
    };
}

function normalizeSlashes(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
}

/** Project分支必须由ReadyProjectSession显式注入同generation History handle。 */
function requireHistory(history: ProjectHistoryHandle | undefined): ProjectHistoryHandle {
    if (!history) {
        throw new Error("Project Workspace mutation缺少当前generation History handle");
    }
    return history;
}
