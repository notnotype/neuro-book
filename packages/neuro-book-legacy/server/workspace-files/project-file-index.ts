import fs from "node:fs/promises";
import path from "node:path";
import {watch} from "chokidar";
import {
    SnapshotCache,
    SnapshotClosedError,
    type SnapshotActivation,
    type SnapshotCacheDiagnostics,
    type SnapshotRawEventBatch,
    type SnapshotWatchHandle,
} from "@notnotype/file-snapshot-cache";
import {readProjectManifestIssueFromRoot} from "nbook/server/workspace-files/project-workspace";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";
import {
    plainFileIndexKey,
    projectFileIndexKey,
    workspaceFileIndexKeyId,
    type WorkspaceFileIndexKey,
} from "nbook/server/workspace-files/workspace-file-index-key";
import {workspaceFileTargetRef, type WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {isRuntimeGeneratedWorkspacePath} from "nbook/server/workspace-files/runtime-generated-path";
import {projectWorkspacePathPolicy} from "nbook/server/workspace-files/project-workspace-path-policy";
import {isWorkspaceStoragePath} from "nbook/server/workspace-files/workspace-storage-boundary";
import {
    createWorkspaceContentIssues,
    scanWorkspaceTree,
    toWorkspaceDisplayPath,
    type WorkspaceFileIssue,
    type WorkspaceFileNode,
} from "nbook/server/workspace-files/workspace-files";
import type {
    WorkspaceFileChangeEventDto,
    WorkspaceFileStreamEventDto,
} from "nbook/shared/dto/workspace-file-events.dto";
import type {
    WorkspaceIssueSummaryDto,
    WorkspaceTreeSnapshotDto,
} from "nbook/shared/dto/workspace-tree.dto";

type FileIndexCacheKey = Readonly<{
    identity: WorkspaceFileIndexKey;
    target: WorkspaceFileTarget;
    /** 仅 Project generation 非空；plain Workspace 不可伪造领域身份。 */
    workspace?: ResolvedProjectWorkspace;
}>;

type PlainWorkspaceFileTarget = Exclude<WorkspaceFileTarget, {kind: "project-workspace"}>;

type PlainActivationLease = {
    readonly key: FileIndexCacheKey;
    readonly activation: SnapshotActivation;
    references: number;
    closePromise: Promise<void> | null;
};

const FILE_INDEX_REBUILD_DEBOUNCE_MS = 120;
const IGNORED_WORKSPACE_WATCH_SEGMENTS = new Set([".git", ".nbook", ".agent"]);
let beforeProjectFileIndexCommitForTest: (() => void | Promise<void>) | null = null;

/** File Index 完整树构建边界；扫描策略由 cache identity 固定。 */
export type ProjectFileIndexBuild = (input: {
    readonly target: WorkspaceFileTarget;
    /** Project build非空，供cold scan应用同generation联合Path Policy。 */
    readonly workspace?: ResolvedProjectWorkspace;
    readonly signal: AbortSignal;
}) => Promise<{
    readonly nodes: WorkspaceFileNode[];
    readonly issues: WorkspaceFileIssue[];
}>;

/** File Index watcher 边界；生产实现负责把原始文件事件归一化为 Workspace DTO。 */
export type ProjectFileIndexWatcherOpen = (input: {
    readonly target: WorkspaceFileTarget;
    /** Project watcher 非空，供generation-scoped Path Policy查询；plain Workspace为空。 */
    readonly workspace?: ResolvedProjectWorkspace;
    readonly signal: AbortSignal;
    readonly onEvent: (event: WorkspaceFileChangeEventDto) => void;
    readonly onError: (error: Error) => void;
}) => SnapshotWatchHandle | Promise<SnapshotWatchHandle>;

/** 构造 File Index Adapter 所需的领域 I/O。 */
export type ProjectFileIndexAdapterOptions = {
    readonly build: ProjectFileIndexBuild;
    readonly openWatcher: ProjectFileIndexWatcherOpen;
};

/** 当前 ProjectSession generation 独占的 File Index handle。 */
export type ProjectFileIndexHandle = ProjectModuleHandle & {
    /** 读取本 generation 的最新稳定完整树。 */
    read(): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>>;
    /** 与本 generation 的完整树构建串行执行一次 Project Workspace mutation。 */
    mutate<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult>;
    /** 订阅本 generation 的 watcher ready 与稳定 snapshot commit。 */
    subscribe(handler: (event: WorkspaceFileStreamEventDto) => void | Promise<void>): () => void;
};

/** ProjectSession 数据面取得当前 generation File Index handle 的 typed token。 */
export const PROJECT_FILE_INDEX_MODULE_TOKEN = projectModuleToken<ProjectFileIndexHandle>(
    "file-index",
    "required",
);

/** Project File Index 启动输入；History raw seam 必须在调用前已经取得。 */
export type ProjectFileIndexStart = {
    readonly workspace: ResolvedProjectWorkspace;
    readonly signal: AbortSignal;
    readonly onRawEvents: (batch: SnapshotRawEventBatch<WorkspaceFileChangeEventDto>) => void | Promise<void>;
};

/**
 * NeuroBook 对独立 SnapshotCache 的领域 Adapter。
 *
 * SnapshotCache 是唯一 snapshot/watcher 生命周期内核；本类只组合 typed target、DTO 与
 * Project generation handle，不保存 dirty、revision、timer、subscriber 或 build Promise。
 */
export class ProjectFileIndexAdapter {
    private readonly cache: SnapshotCache<FileIndexCacheKey, WorkspaceFileNode, WorkspaceFileIssue, WorkspaceFileChangeEventDto>;
    /** plain Workspace 只有 activation ownership；snapshot 状态始终只存在于 SnapshotCache。 */
    private readonly plainActivations = new Map<string, PlainActivationLease>();

    /** 建立一个拥有单一 SnapshotCache 的 Adapter。 */
    constructor(options: ProjectFileIndexAdapterOptions) {
        this.cache = new SnapshotCache({
            keyId: (key) => workspaceFileIndexKeyId(key.identity),
            builder: {
                build: ({key, signal}) => options.build({
                    target: key.target,
                    workspace: key.workspace,
                    signal,
                }),
            },
            watcher: {
                open: ({key, signal, onEvent, onError}) => options.openWatcher({
                    target: key.target,
                    workspace: key.workspace,
                    signal,
                    onEvent,
                    onError,
                }),
            },
            eventId: (event) => event.path,
            debounceMs: FILE_INDEX_REBUILD_DEBOUNCE_MS,
            maxConcurrentBuilds: 2,
        });
    }

    /** 单次读取 plain Workspace；仅建立可 idle eviction 的 cache entry，不取得 watcher activation。 */
    async readPlain(target: PlainWorkspaceFileTarget): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
        const key = plainCacheKey(target);
        try {
            return snapshotDto(await this.cache.read(key));
        } catch (error) {
            if (!(error instanceof SnapshotClosedError)) {
                throw error;
            }
            const id = workspaceFileIndexKeyId(key.identity);
            await this.finishPlainClose(id, error);
            return snapshotDto(await this.cache.read(key));
        }
    }

    /**
     * 为 plain Workspace SSE 消费者取得引用计数 activation lease。
     * 首个消费者启动 watcher，最后一个消费者释放同一精确 activation。
     */
    subscribePlain(
        target: PlainWorkspaceFileTarget,
        handler: (event: WorkspaceFileStreamEventDto) => void | Promise<void>,
    ): () => void {
        const candidateKey = plainCacheKey(target);
        const id = workspaceFileIndexKeyId(candidateKey.identity);
        let lease = this.plainActivations.get(id);
        if (lease?.closePromise) {
            throw new SnapshotClosedError(`plain Workspace File Index ${id} is closing`);
        }
        if (!lease) {
            const activation = this.cache.activate(candidateKey);
            lease = {
                key: candidateKey,
                activation,
                references: 0,
                closePromise: null,
            };
            this.plainActivations.set(id, lease);
        }
        lease.references += 1;
        let subscribed = true;
        let unsubscribeCommit: (() => void) | null = null;
        try {
            unsubscribeCommit = subscribeToCache(this.cache, lease.key, lease.activation.ready, handler);
        } catch (error) {
            lease.references -= 1;
            if (lease.references === 0) {
                void this.closePlainLease(id, lease).catch(() => undefined);
            }
            throw error;
        }

        return () => {
            if (!subscribed) {
                return;
            }
            subscribed = false;
            unsubscribeCommit?.();
            lease!.references -= 1;
            if (lease!.references === 0) {
                void this.closePlainLease(id, lease!).catch(() => undefined);
            }
        };
    }

    /** 等待当前 plain Workspace SSE lease 的 watcher ready；调用方必须先 subscribePlain。 */
    async waitPlainReady(target: PlainWorkspaceFileTarget): Promise<void> {
        const key = plainCacheKey(target);
        const id = workspaceFileIndexKeyId(key.identity);
        const lease = this.plainActivations.get(id);
        if (!lease) {
            throw new Error(`plain Workspace File Index ${id} 尚未取得 activation lease`);
        }
        await lease.activation.ready;
    }

    /**
     * 显式关闭 plain Workspace entry；用于 root 删除、测试清理与 close failure 重试。
     * 若存在 activation lease，始终重用该精确 handle，不按 root 猜测新 watcher。
     */
    async closePlain(target: PlainWorkspaceFileTarget): Promise<void> {
        const candidateKey = plainCacheKey(target);
        const id = workspaceFileIndexKeyId(candidateKey.identity);
        const lease = this.plainActivations.get(id);
        if (!lease) {
            await this.cache.close(candidateKey);
            return;
        }
        lease.references = 0;
        const pendingClose = lease.closePromise;
        if (pendingClose) {
            try {
                await pendingClose;
                return;
            } catch {
                // 最后一个SSE消费者的后台close已报告失败；本次显式调用负责重试同一activation。
            }
        }
        await this.closePlainLease(id, lease);
    }

    /** 与相同 plain Workspace cache entry 的完整树构建串行执行 mutation。 */
    async mutatePlain<TResult>(
        target: PlainWorkspaceFileTarget,
        operation: () => TResult | Promise<TResult>,
    ): Promise<TResult> {
        const key = plainCacheKey(target);
        let operationStarted = false;
        try {
            return await this.cache.mutate(key, () => {
                operationStarted = true;
                return operation();
            });
        } catch (error) {
            if (!(error instanceof SnapshotClosedError) || operationStarted) {
                throw error;
            }
            const id = workspaceFileIndexKeyId(key.identity);
            await this.finishPlainClose(id, error);
            return this.cache.mutate(key, operation);
        }
    }

    /** Nitro shutdown/HMR 最终释放全部 entry；关闭后的 Adapter 不再接受新消费者。 */
    async closeAll(): Promise<void> {
        await this.cache.closeAll();
        this.plainActivations.clear();
    }

    /** 暴露 package 的有界资源诊断，不复制任何 entry 状态。 */
    diagnostics(): SnapshotCacheDiagnostics {
        return this.cache.diagnostics();
    }

    /**
     * 同步接管一个 Project generation；activation 原子绑定 raw seam 后才开始打开 watcher。
     * ready 只表达 watcher minimum-ready，完整树读取作为共享、可取消 warm-up 在后台运行。
     */
    startProject(input: ProjectFileIndexStart): ProjectFileIndexHandle {
        const target: Extract<WorkspaceFileTarget, {kind: "project-workspace"}> = Object.freeze({
            kind: "project-workspace",
            root: input.workspace.root,
            projectRoot: input.workspace.ref.projectRoot,
        });
        const key: FileIndexCacheKey = Object.freeze({
            identity: projectFileIndexKey(input.workspace.key),
            target,
            workspace: input.workspace,
        });
        const activation = this.cache.activate(key, {onRawEvents: input.onRawEvents});
        const warmup = activation.ready.then(async () => {
            await this.cache.read(key);
        });
        void warmup.catch(() => undefined);

        let closeSucceeded = false;
        const close = async (): Promise<void> => {
            if (closeSucceeded) {
                return;
            }
            await activation.close();
            closeSucceeded = true;
            input.signal.removeEventListener("abort", abort);
        };
        const abort = (): void => {
            void close().catch(() => undefined);
        };
        input.signal.addEventListener("abort", abort, {once: true});
        if (input.signal.aborted) {
            abort();
        }

        return Object.freeze({
            ready: activation.ready,
            close,
            read: async () => snapshotDto(await this.cache.read(key)),
            mutate: <TResult>(operation: () => TResult | Promise<TResult>) => this.cache.mutate(key, operation),
            subscribe: (handler: (event: WorkspaceFileStreamEventDto) => void | Promise<void>) => (
                subscribeToCache(this.cache, key, activation.ready, handler)
            ),
        });
    }

    /** 关闭 plain Workspace 的精确 activation；失败时保留同一 lease 供显式重试。 */
    private async closePlainLease(id: string, lease: PlainActivationLease): Promise<void> {
        if (lease.closePromise) {
            return lease.closePromise;
        }
        const closing = lease.activation.close().then(() => {
            if (this.plainActivations.get(id) === lease) {
                this.plainActivations.delete(id);
            }
        }).catch((error: unknown) => {
            if (lease.closePromise === closing) {
                lease.closePromise = null;
            }
            throw error;
        });
        lease.closePromise = closing;
        return closing;
    }

    /** 等待或重试最后一个 plain activation 的关闭，供 one-shot read/mutation 重新建 entry。 */
    private async finishPlainClose(id: string, closedError: SnapshotClosedError): Promise<void> {
        const lease = this.plainActivations.get(id);
        if (!lease) {
            throw closedError;
        }
        await (lease.closePromise ?? this.closePlainLease(id, lease));
    }
}

/** 生产 File Index singleton；Project 与 plain Workspace 共用这一套 cache 内核。 */
export const projectFileIndexAdapter = new ProjectFileIndexAdapter({
    build: buildProductionSnapshot,
    openWatcher: openProductionWatcher,
});

/** required File Index Module；同步取得本 generation History handle 后才激活 watcher。 */
export const projectFileIndexModule: ProjectModule<ProjectFileIndexHandle> = Object.freeze({
    token: PROJECT_FILE_INDEX_MODULE_TOKEN,
    start(context): ProjectFileIndexHandle {
        const history: ProjectHistoryHandle = context.require(PROJECT_HISTORY_MODULE_TOKEN);
        return projectFileIndexAdapter.startProject({
            workspace: context.prepared.workspace,
            signal: context.signal,
            onRawEvents: (batch) => history.reconcileRawEvents(batch),
        });
    },
});

registerProjectModule(projectFileIndexModule);

/** 测试专用：在完整扫描结束、package稳定提交检查前插入并发 mutation。 */
export function setProjectFileIndexCommitHookForTest(hook: (() => void | Promise<void>) | null): void {
    beforeProjectFileIndexCommitForTest = hook;
}

/** watcher 与完整扫描共用同一忽略合同。 */
export function isIgnoredProjectFileIndexPath(value: string): boolean {
    const normalized = value.replace(/\\/g, "/");
    return isRuntimeGeneratedWorkspacePath(normalized)
        || normalized.split("/").some((segment) => IGNORED_WORKSPACE_WATCH_SEGMENTS.has(segment));
}

/**
 * Project generation watcher 的组合排除合同。
 *
 * 联合Path Policy先决定Project领域路径；`.git/.nbook/.agent`继续是File Index消费者私有排除。
 */
export function isIgnoredProjectFileIndexWatchPath(
    workspace: ResolvedProjectWorkspace,
    relativePath: string,
): boolean {
    const normalized = relativePath.replaceAll("\\", "/");
    if (!normalized || normalized === ".") {
        return false;
    }
    return projectWorkspacePathPolicy({
        workspace,
        relativePath: normalized,
        consumer: "file-index",
    }).disposition !== "consume" || isIgnoredProjectFileIndexPath(normalized);
}

/** 生产 builder：完整扫描与 Project issue projection 都响应 Module generation 取消。 */
async function buildProductionSnapshot(input: {
    readonly target: WorkspaceFileTarget;
    readonly workspace?: ResolvedProjectWorkspace;
    readonly signal: AbortSignal;
}): Promise<{nodes: WorkspaceFileNode[]; issues: WorkspaceFileIssue[]}> {
    input.signal.throwIfAborted();
    const workspace = input.workspace;
    if (input.target.kind === "project-workspace" && !workspace) {
        throw new Error("Project File Index cold scan缺少ResolvedProjectWorkspace");
    }
    const scannedNodes = await scanWorkspaceTree({
        root: input.target.root,
        signal: input.signal,
        pathPredicate: workspace
            ? ({relativePath}) => !isIgnoredProjectFileIndexWatchPath(workspace, relativePath)
            : ({relativePath}) => !isWorkspaceStoragePath(input.target, relativePath),
    });
    input.signal.throwIfAborted();
    const issues = input.target.kind === "project-workspace"
        ? await createProjectIssues(input.target.root, scannedNodes)
        : [];
    input.signal.throwIfAborted();
    const summaryByPath = input.target.kind === "project-workspace"
        ? buildIssueSummaryByPath(issues, scannedNodes)
        : new Map<string, WorkspaceIssueSummaryDto>();
    await beforeProjectFileIndexCommitForTest?.();
    input.signal.throwIfAborted();
    return {
        nodes: scannedNodes.map((node) => ({
            ...node,
            issueSummary: summaryByPath.get(normalizeIssuePath(node.path)) ?? emptyIssueSummary(),
        })),
        issues,
    };
}

/** 生产 watcher：只有 chokidar ready 才完成 activation.ready；运行期错误进入 cache diagnostics。 */
async function openProductionWatcher(input: Parameters<ProjectFileIndexWatcherOpen>[0]): Promise<SnapshotWatchHandle> {
    let stat;
    try {
        stat = await fs.stat(input.target.root);
    } catch (error) {
        if (isNoEntryError(error) && input.target.kind !== "project-workspace") {
            return {close: async () => undefined};
        }
        throw error;
    }
    if (!stat.isDirectory()) {
        throw new Error(`workspace root 不是目录: ${workspaceFileTargetRef(input.target)}`);
    }
    input.signal.throwIfAborted();
    const watcher = watch(input.target.root, {
        awaitWriteFinish: {
            stabilityThreshold: FILE_INDEX_REBUILD_DEBOUNCE_MS,
            pollInterval: 50,
        },
        cwd: input.target.root,
        ignoreInitial: true,
        ignored: (watchedPath: string) => isIgnoredFileIndexWatchPath(
            input,
            path.relative(input.target.root, watchedPath),
        ),
        persistent: true,
    });
    watcher.on("all", (eventName, changedPath) => {
        const kind = normalizeEventKind(eventName);
        if (!kind) {
            return;
        }
        const eventPath = normalizeEventPath(input.target.root, String(changedPath));
        if (!eventPath || isIgnoredFileIndexWatchPath(input, eventPath)) {
            return;
        }
        input.onEvent({kind, path: eventPath});
    });

    const handle: SnapshotWatchHandle = {
        close: () => watcher.close(),
    };
    return new Promise<SnapshotWatchHandle>((resolve, reject) => {
        let opening = true;
        const abort = (): void => {
            if (!opening) {
                return;
            }
            opening = false;
            void watcher.close().then(
                () => reject(abortReason(input.signal)),
                reject,
            );
        };
        input.signal.addEventListener("abort", abort, {once: true});
        watcher.once("ready", () => {
            if (!opening) {
                return;
            }
            opening = false;
            input.signal.removeEventListener("abort", abort);
            resolve(handle);
        });
        watcher.on("error", (error) => {
            const watcherError = error instanceof Error ? error : new Error(String(error));
            input.onError(watcherError);
            if (!opening) {
                return;
            }
            opening = false;
            input.signal.removeEventListener("abort", abort);
            void watcher.close().then(
                () => reject(watcherError),
                () => reject(watcherError),
            );
        });
    });
}

/** Project watcher使用联合Policy；plain watcher额外排除自身 Storage 根后再走runtime/helper合同。 */
function isIgnoredFileIndexWatchPath(
    input: Parameters<ProjectFileIndexWatcherOpen>[0],
    relativePath: string,
): boolean {
    return input.workspace
        ? isIgnoredProjectFileIndexWatchPath(input.workspace, relativePath)
        : isWorkspaceStoragePath(input.target, relativePath) || isIgnoredProjectFileIndexPath(relativePath);
}

/** 只把真实 ENOENT 当作可为空的 plain Workspace，其他 I/O 必须上抛。 */
function isNoEntryError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}

/** 把 AbortSignal.reason 收窄为可抛 Error。 */
function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error("Project File Index watcher 已取消");
}

/** Project 完整树 issue 构建仍属于领域 Adapter，不进入通用 cache package。 */
async function createProjectIssues(root: AbsoluteFsPath, nodes: WorkspaceFileNode[]): Promise<WorkspaceFileIssue[]> {
    const existingPathSet = new Set(nodes.flatMap((node) => normalizedExistingPaths(node)));
    const issues = createWorkspaceContentIssues({
        root,
        nodes,
        existingPathSet,
    });
    const manifestMessage = await readProjectManifestIssueFromRoot(root);
    if (manifestMessage) {
        issues.unshift({
            level: "P1",
            code: "invalid-project-manifest",
            path: "project.yaml",
            message: manifestMessage,
        });
    }
    return issues;
}

/** 节点不存在 issue 时仍发布稳定的零摘要。 */
function emptyIssueSummary(): WorkspaceIssueSummaryDto {
    return {
        selfCount: 0,
        subtreeCount: 0,
        count: 0,
        highestLevel: null,
    };
}

/** 同时接受目录地址带/不带尾斜杠，供引用存在性校验复用。 */
function normalizedExistingPaths(node: WorkspaceFileNode): string[] {
    const normalized = normalizeIssuePath(node.path);
    return node.isDirectory && normalized.endsWith("/")
        ? [normalized, normalized.slice(0, -1)]
        : [normalized];
}

/** 把完整 issue 列表投影为节点 self/subtree 摘要。 */
function buildIssueSummaryByPath(
    issues: WorkspaceFileIssue[],
    nodes: WorkspaceFileNode[],
): Map<string, WorkspaceIssueSummaryDto> {
    const summaryByPath = new Map<string, WorkspaceIssueSummaryDto>();
    const nodePaths = new Set(nodes.map((node) => normalizeIssuePath(node.path)));
    for (const nodePath of nodePaths) {
        summaryByPath.set(nodePath, emptyIssueSummary());
    }
    for (const issue of issues) {
        const issuePath = normalizeIssuePath(issue.path);
        const selfPath = resolveIssueOwnerPath(issuePath, nodePaths);
        if (!selfPath) {
            continue;
        }
        incrementIssueSummary(summaryByPath, selfPath, issue.level, "self");
        for (const ancestor of issueAncestorPaths(selfPath, nodePaths)) {
            incrementIssueSummary(summaryByPath, ancestor, issue.level, "subtree");
        }
    }
    return summaryByPath;
}

/** 累加单节点 issue 摘要并维护最高级别。 */
function incrementIssueSummary(
    summaryByPath: Map<string, WorkspaceIssueSummaryDto>,
    issuePath: string,
    level: WorkspaceFileIssue["level"],
    scope: "self" | "subtree",
): void {
    const current = summaryByPath.get(issuePath) ?? emptyIssueSummary();
    summaryByPath.set(issuePath, {
        selfCount: current.selfCount + (scope === "self" ? 1 : 0),
        subtreeCount: current.subtreeCount + (scope === "subtree" ? 1 : 0),
        count: current.count + 1,
        highestLevel: higherIssueLevel(current.highestLevel, level),
    });
}

/** 将文件、index.md/state.md 与任意后代 issue 归到最近内容节点。 */
function resolveIssueOwnerPath(issuePath: string, nodePaths: Set<string>): string | null {
    if (nodePaths.has(issuePath)) {
        return issuePath;
    }
    for (const suffix of ["/index.md", "/state.md"]) {
        const owner = issuePath.replace(new RegExp(`${suffix.replace(".", "\\.")}$`, "u"), "/");
        if (nodePaths.has(owner)) {
            return owner;
        }
    }
    const segments = issuePath.split("/").filter(Boolean);
    while (segments.length > 0) {
        const candidate = `${segments.join("/")}/`;
        if (nodePaths.has(candidate)) {
            return candidate;
        }
        segments.pop();
    }
    return nodePaths.has("./") ? "./" : null;
}

/** 返回 issue owner 在当前完整树中的全部祖先节点。 */
function issueAncestorPaths(issuePath: string, nodePaths: Set<string>): string[] {
    const normalized = issuePath.endsWith("/") ? issuePath.slice(0, -1) : issuePath;
    const segments = normalized.split("/").filter(Boolean);
    const ancestors: string[] = [];
    while (segments.length > 1) {
        segments.pop();
        const candidate = `${segments.join("/")}/`;
        if (nodePaths.has(candidate)) {
            ancestors.push(candidate);
        }
    }
    if (nodePaths.has("./")) {
        ancestors.push("./");
    }
    return ancestors;
}

/** 取两个 issue level 中更高的一个。 */
function higherIssueLevel(
    left: WorkspaceFileIssue["level"] | null,
    right: WorkspaceFileIssue["level"],
): WorkspaceFileIssue["level"] {
    if (!left) {
        return right;
    }
    const rank: Record<WorkspaceFileIssue["level"], number> = {
        P1: 4,
        P2: 3,
        P3: 2,
        WARN: 1,
    };
    return rank[right] > rank[left] ? right : left;
}

/** 统一 issue/node path 的正斜杠与根地址表示。 */
function normalizeIssuePath(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized || ".";
}

/** 收窄 chokidar all 事件为公开 DTO 支持的五种变化。 */
function normalizeEventKind(eventName: string): WorkspaceFileChangeEventDto["kind"] | null {
    return eventName === "add"
        || eventName === "change"
        || eventName === "unlink"
        || eventName === "addDir"
        || eventName === "unlinkDir"
        ? eventName
        : null;
}

/** watcher path 统一投影为相对 root 的正斜杠地址。 */
function normalizeEventPath(root: string, changedPath: string): string {
    const absolutePath = path.isAbsolute(changedPath) ? changedPath : path.resolve(root, changedPath);
    return toWorkspaceDisplayPath(root, absolutePath).replace(/\\/g, "/").replace(/\/+$/u, "");
}

/** 建立不携带任何 lifecycle 状态的 plain Workspace cache 输入。 */
function plainCacheKey(target: PlainWorkspaceFileTarget): FileIndexCacheKey {
    return Object.freeze({
        identity: plainFileIndexKey(target.root),
        target,
    });
}

/** 把 package snapshot 投影为既有 HTTP/SSE DTO，不泄漏 package 字段。 */
function snapshotDto(snapshot: {
    readonly nodes: readonly WorkspaceFileNode[];
    readonly issues: readonly WorkspaceFileIssue[];
    readonly revision: number;
    readonly calculatedAt: string;
}): WorkspaceTreeSnapshotDto<WorkspaceFileNode> {
    return {
        nodes: [...snapshot.nodes],
        issues: [...snapshot.issues],
        revision: snapshot.revision,
        validatedAt: snapshot.calculatedAt,
    };
}

/** 只从 activation.ready 发布 watch-ready，从稳定 commit 发布 files-changed。 */
function subscribeToCache(
    cache: SnapshotCache<FileIndexCacheKey, WorkspaceFileNode, WorkspaceFileIssue, WorkspaceFileChangeEventDto>,
    key: FileIndexCacheKey,
    ready: Promise<void>,
    handler: (event: WorkspaceFileStreamEventDto) => void | Promise<void>,
): () => void {
    let subscribed = true;
    const unsubscribeCommit = cache.subscribe(key, (commit) => handler({
        type: "workspace_files_changed",
        root: workspaceFileTargetRef(key.target),
        sequence: commit.snapshot.revision,
        revision: commit.snapshot.revision,
        validatedAt: commit.snapshot.calculatedAt,
        changedAt: new Date().toISOString(),
        events: [...commit.events],
    }));
    void ready.then(async () => {
        if (!subscribed) {
            return;
        }
        await handler({
            type: "workspace_watch_ready",
            root: workspaceFileTargetRef(key.target),
            sequence: 0,
            changedAt: new Date().toISOString(),
        });
    }).catch(() => undefined);
    return () => {
        if (!subscribed) {
            return;
        }
        subscribed = false;
        unsubscribeCommit();
    };
}
