import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {watch} from "chokidar";
import {
    absoluteFsPath,
    assertRealPathContained,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    isProjectLockReleaseFailedError,
    ProjectLockModule,
    ProjectLockReleaseFailedError,
    type ProjectLockContext,
    type ProjectOccupancyHandle,
    type WorkspaceMutationHandle,
} from "nbook/server/workspace-files/project-lock";
import {
    isProjectLifecycleError,
    isProjectRootCaseCollisionError,
    ProjectLifecycleError,
    ProjectRootCaseCollisionError,
    projectWorkspaceRef,
    type ProjectLifecycleErrorCode,
    type ProjectWorkspaceRef,
    type ResolvedProjectWorkspace,
    type WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";
import {
    isProjectDomainError,
    ProjectDomainError,
} from "nbook/server/workspace-files/project-domain-error";
import {
    isProjectLifecycleTempName,
    NODE_PROJECT_MANIFEST_ADAPTER,
    ProjectManifestPersistence,
    ProjectManifestPublishedError,
    type ProjectManifest,
    type ProjectManifestAdapter,
    type ProjectManifestChange,
    type ProjectManifestCleanupIssue as ManifestCleanupIssue,
    type ProjectManifestEnsureResult,
    type ProjectManifestInspection,
    type ProjectManifestIssue,
    type ProjectManifestMetadataPatch,
    type ProjectValidationResult,
} from "nbook/server/workspace-files/project-lifecycle-manifest";
import {
    ProjectRootIdentityModule,
    type ProjectRootPhysicalToken,
    type ProjectRootIdentityOptions,
} from "nbook/server/workspace-files/project-root-identity";
import {
    ProjectCoverStore,
    type ProjectCoverCleanupIssue,
    type ProjectCoverUpload,
    type PublishedProjectCover,
} from "nbook/server/workspace-files/project-cover-store";

export {
    isProjectLifecycleError,
    ProjectLifecycleError,
    projectWorkspaceRef,
    type ProjectLifecycleErrorCode,
    type ProjectWorkspaceKey,
    type ProjectWorkspaceRef,
    type ResolvedProjectWorkspace,
    type WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";

export {isProjectLifecycleTempName};
export type {
    ProjectManifest,
    ProjectManifestAdapter,
    ProjectManifestChange,
    ProjectManifestIssue,
    ProjectManifestMetadataPatch,
    ProjectValidationResult,
};

/** 首版公开模板名；不泄漏Bundled Workspace Template的物理目录名。 */
export type ProjectTemplateName = "default";

/** Lifecycle交给模板Adapter的完整、可取消staging上下文。 */
export type ProjectTemplateMaterializeInput = {
    readonly template: ProjectTemplateName;
    readonly stagingRoot: AbsoluteFsPath;
    readonly signal: AbortSignal;
};

/** Lifecycle create对目录模板能力使用的窄Adapter。 */
export type ProjectTemplateAdapter = {
    materialize(input: ProjectTemplateMaterializeInput): Promise<void>;
};

/** Workspace Root浅watcher传给Lifecycle的原始文件系统事件。 */
export type ProjectLifecycleWatchEvent = {
    readonly kind: "add" | "addDir" | "change" | "unlink" | "unlinkDir";
    readonly path: string;
};

/** 单个Workspace Root浅watcher的可等待ready与关闭句柄。 */
export type ProjectLifecycleWatchHandle = {
    readonly ready: Promise<void>;
    close(): Promise<void>;
};

/** Project Lifecycle唯一外部watcher边界；生产默认使用chokidar。 */
export type ProjectLifecycleWatcherAdapter = {
    open(input: {
        readonly workspaceRoot: AbsoluteFsPath;
        readonly onEvent: (event: ProjectLifecycleWatchEvent) => void;
        readonly onError: (error: unknown) => void;
    }): ProjectLifecycleWatchHandle;
};

/** create只接受结构化Project ref与公开manifest metadata。 */
export type ProjectCreateInput = {
    readonly ref: ProjectWorkspaceRef;
    readonly title: string;
    readonly summary?: string;
    readonly template?: ProjectTemplateName;
};

/** create成功只返回已发布的轻量Project metadata与revision。 */
export type ProjectCreateResult = {
    readonly revision: number;
    readonly project: ProjectListEntry;
};

/** Lifecycle交给Archive/Upload source的可取消私有staging上下文。 */
export type ProjectImportMaterializeInput = {
    readonly stagingRoot: AbsoluteFsPath;
    readonly signal: AbortSignal;
};

/** Import source完成内容物化后交回Lifecycle拥有的manifest原始bytes。 */
export type ProjectImportMaterializeResult = {
    /** 未提供时Lifecycle会按目标Project root创建最小manifest。 */
    readonly manifestBytes?: Uint8Array;
};

/** Archive/Upload层实现的服务端source capability；不属于HTTP或CLI DTO。 */
export type ProjectImportSource = {
    materialize(input: ProjectImportMaterializeInput): Promise<ProjectImportMaterializeResult>;
};

/** import只接受目标Project ref与可物化source，不把staging路径泄漏给控制面。 */
export type ProjectImportInput = {
    readonly ref: ProjectWorkspaceRef;
    readonly source: ProjectImportSource;
};

/** import成功只返回已发布的轻量Project metadata与revision。 */
export type ProjectImportResult = {
    readonly revision: number;
    readonly project: ProjectListEntry;
};

/** metadata update只接受Project引用与NeuroBook拥有的公开manifest字段。 */
export type ProjectMetadataUpdateInput = {
    readonly ref: ProjectWorkspaceRef;
    /** undefined表示不修改；提供时去除首尾空白后必须非空。 */
    readonly title?: string;
    /** undefined表示不修改；空字符串表示清空。 */
    readonly summary?: string;
};

/** 运行中Project借用当前session generation；未运行Project由Lifecycle自行取得Occupancy。 */
export type ProjectMetadataAccess =
    | {readonly kind: "acquire"}
    | {
        readonly kind: "borrowed";
        readonly workspace: ResolvedProjectWorkspace;
        /** 同步复核session generation和既有Occupancy仍可继续承载本次操作。 */
        assertActive(): void;
    };

/** metadata update成功只返回已发布的轻量Project metadata与revision。 */
export type ProjectMetadataUpdateResult = {
    readonly revision: number;
    readonly project: ProjectListEntry;
};

/** cover update 接受上传后的原始 bytes，null 表示清除 manifest 引用。 */
export type ProjectCoverUpdateInput = {
    readonly ref: ProjectWorkspaceRef;
    readonly cover: ProjectCoverUpload | null;
};

/** cover update 与其他 Project mutation 返回同一轻量 publication。 */
export type ProjectCoverUpdateResult = ProjectMetadataUpdateResult;

/** delete成功后返回已发布的absence revision。 */
export type ProjectDeleteResult = {
    readonly revision: number;
    readonly projectRoot: WorkspaceRelativePath;
};

const DEFAULT_PROJECT_TEMPLATE: ProjectTemplateName = "default";

/** 首版只包装现有默认模板能力，不在Lifecycle内建设模板registry。 */
function nodeProjectTemplateAdapter(workspaceRoot: AbsoluteFsPath): ProjectTemplateAdapter {
    const userNbookRoot = absoluteFsPath(path.join(workspaceRoot, ".nbook"));
    return {
        materialize: async (input) => {
            input.signal.throwIfAborted();
            if (input.template !== DEFAULT_PROJECT_TEMPLATE) {
                throw new Error(`未知Project模板：${input.template}`);
            }
            const {copyNovelDirectoryTemplate} = await import("nbook/server/workspace-files/novel-workspace");
            await copyNovelDirectoryTemplate(input.stagingRoot, {userNbookRoot});
            input.signal.throwIfAborted();
        },
    };
}

/** 使用单个depth=1 chokidar实例观察一级目录与其直接project.yaml。 */
const NODE_PROJECT_LIFECYCLE_WATCHER_ADAPTER: ProjectLifecycleWatcherAdapter = {
    open: (input) => {
        let readySettled = false;
        let resolveReady: () => void = () => undefined;
        let rejectReady: (error: unknown) => void = () => undefined;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        const watcher = watch(input.workspaceRoot, {
            depth: 1,
            followSymlinks: false,
            ignoreInitial: true,
            ignored: (watchedPath) => {
                const relativePath = path.relative(input.workspaceRoot, String(watchedPath));
                const firstSegment = relativePath.split(path.sep)[0] ?? "";
                return firstSegment.toLocaleLowerCase("en-US") === ".nbook";
            },
            persistent: true,
        });
        watcher.on("all", (kind, changedPath) => {
            if (isProjectLifecycleWatchEventKind(kind)) {
                input.onEvent({kind, path: String(changedPath)});
            }
        });
        watcher.once("ready", () => {
            if (!readySettled) {
                readySettled = true;
                resolveReady();
            }
        });
        watcher.on("error", (error) => {
            if (!readySettled) {
                readySettled = true;
                rejectReady(error);
            }
            input.onError(error);
        });
        return {
            ready,
            close: async () => {
                if (!readySettled) {
                    readySettled = true;
                    rejectReady(new Error("Project Lifecycle watcher在ready前关闭"));
                }
                await watcher.close();
            },
        };
    },
};

/** Project Lifecycle 的构造依赖；生产默认使用 Node 文件系统 Adapter。 */
export type ProjectLifecycleOptions = {
    readonly coverStore?: ProjectCoverStore;
    readonly manifestAdapter?: ProjectManifestAdapter;
    readonly lockModule?: ProjectLockModule;
    readonly now?: () => number;
    readonly rootIdentityOptions?: ProjectRootIdentityOptions;
    readonly snapshotTtlMs?: number;
    readonly templateAdapter?: ProjectTemplateAdapter;
    readonly watchDebounceMs?: number;
    readonly watcherAdapter?: ProjectLifecycleWatcherAdapter;
};

/** Project 列表可公开的轻量 metadata。 */
export type ProjectListEntry = ProjectWorkspaceRef & ProjectManifest & {
    /** 仅表示 project.yaml 的文件修改时间，不表示正文活动时间。 */
    readonly manifestUpdatedAt?: string;
};

/** 同一次浅扫描发布的合法 Project 列表。 */
export type ProjectListSnapshot = {
    readonly revision: number;
    readonly projects: readonly ProjectListEntry[];
};

/** 可以由用户显式打开并 ensure 的一级物理目录。 */
export type ProjectCandidate = ProjectWorkspaceRef;

/** 与 Project 列表同 revision 的候选目录投影。 */
export type ProjectCandidateSnapshot = {
    readonly revision: number;
    readonly candidates: readonly ProjectCandidate[];
};

/** 最近一次成功浅扫描发现、但不会进入Project或candidate DTO的领域问题。 */
export type ProjectDiscoveryIssue =
    | {
        readonly kind: "unsafe-manifest";
        readonly projectRoot: WorkspaceRelativePath;
        readonly code: ProjectLifecycleErrorCode;
    }
    | {
        readonly kind: "unsafe-root";
        readonly projectRoot: WorkspaceRelativePath;
        readonly code: ProjectLifecycleErrorCode;
    }
    | {
        readonly kind: "case-collision";
        readonly projectRoots: readonly WorkspaceRelativePath[];
        readonly code: "PROJECT_ROOT_CASE_COLLISION";
    };

/** Lifecycle事务临时目录未能完成best-effort清理时保留的内部诊断。 */
export type ProjectCleanupIssue = {
    readonly kind: "transaction-cleanup";
    readonly operation: "ensure" | "create" | "import" | "delete" | "metadata-update" | "cover-update";
    readonly target: "staging" | "tombstone" | "manifest-temp" | "recovery-temp" | "cover-file";
    /** Workspace Root-relative内部事务路径，不暴露绝对文件系统位置。 */
    readonly path: WorkspaceRelativePath;
} & (
    | {
        readonly phase: "ownership-check";
        readonly code: "PROJECT_ROOT_REPLACED";
    }
    | {
        readonly phase: "ownership-check" | "remove";
        readonly code: "PROJECT_ROOT_IO";
        /** 底层文件系统错误提供字符串code时保留，例如EIO、EPERM。 */
        readonly systemCode?: string;
    }
);

/** Project Lifecycle最近一次浅刷新由哪条控制流触发。 */
export type ProjectLifecycleRefreshReason = "initial-read" | "ttl" | "watcher" | "mutation";

/** diagnostics只保留可序列化的稳定错误摘要，不暴露任意Error对象。 */
export type ProjectLifecycleDiagnosticError = {
    readonly code: string;
    readonly message: string;
};

/** Project Lifecycle当前只读diagnostics投影；读取getter不会启动I/O或watcher。 */
export type ProjectLifecycleDiagnostics = {
    readonly revision: number;
    readonly cache: {
        readonly state: "empty" | "fresh" | "expired";
        readonly publishedAt: number | null;
        readonly lastRefreshReason: ProjectLifecycleRefreshReason | null;
        readonly lastRefreshAt: number | null;
        readonly lastRefreshError: ProjectLifecycleDiagnosticError | null;
    };
    readonly watcher: {
        readonly state: "idle" | "starting" | "ready" | "failed" | "closed";
        readonly lastAttemptAt: number | null;
        readonly error: ProjectLifecycleDiagnosticError | null;
    };
    readonly discoveryIssues: readonly ProjectDiscoveryIssue[];
    readonly omittedDiscoveryIssueCount: number;
    readonly cleanupIssues: readonly ProjectCleanupIssue[];
    readonly omittedCleanupIssueCount: number;
};

type ProjectEnsurePublishedResult = {
    readonly revision: number;
    readonly project: ProjectListEntry;
};

/** 普通ensure只公开已发布metadata与可解释的manifest动作，不泄漏进程内workspace identity。 */
export type ProjectEnsureResult = ProjectEnsurePublishedResult & (
    | {
        readonly change: "none" | "created";
    }
    | {
        readonly change: "normalized" | "recovered";
        /** 已有manifest的原始bytes备份到该Workspace Root-relative路径。 */
        readonly recoveryPath: WorkspaceRelativePath;
    }
);

/** Lifecycle私有ensure提交结果；只有prepareOpen可以把workspace继续移交ProjectSession。 */
type ProjectEnsureCommit = ProjectEnsureResult & {
    readonly workspace: ResolvedProjectWorkspace;
};

/** prepareOpen 成功后移交给 ProjectSession 的完整结果。 */
export type PreparedProjectOpen = ProjectEnsureResult & {
    /** 当前 Lifecycle 明确绑定的 Workspace Root；Project Module 不得从 Project Workspace 反推。 */
    readonly workspaceRoot: AbsoluteFsPath;
    readonly workspace: ResolvedProjectWorkspace;
    readonly occupancy: ProjectOccupancyHandle;
};

/** Lifecycle公开mutation操作名。 */
export type ProjectLifecycleOperation = "ensure" | "create" | "import" | "delete" | "metadata-update" | "cover-update";

/** Mutation失败时所处的稳定事务阶段。 */
export type ProjectLifecycleTransactionPhase =
    | "stage"
    | "materialize"
    | "validate"
    | "publish-manifest"
    | "publish-root"
    | "resolve-root"
    | "publish-snapshot"
    | "rollback"
    | "release";

/** Mutation事务对外稳定的typed failure code。 */
export type ProjectLifecycleTransactionErrorCode =
    | "PROJECT_EXISTS"
    | "PROJECT_TEMPLATE_FAILED"
    | "PROJECT_IMPORT_FAILED"
    | "PROJECT_VALIDATION_FAILED"
    | "PROJECT_PUBLISH_FAILED"
    | "PROJECT_ROLLBACK_FAILED";

/**
 * Lifecycle mutation失败。
 *
 * committed为"unknown"时调用方必须先重新读取snapshot/磁盘事实，不能直接重试。
 */
export class ProjectLifecycleTransactionError extends ProjectDomainError {
    readonly code: ProjectLifecycleTransactionErrorCode;
    readonly statusCode: number;
    readonly operation: ProjectLifecycleOperation;
    readonly phase: ProjectLifecycleTransactionPhase;
    readonly committed: boolean | "unknown";
    override readonly cause: unknown;

    constructor(
        code: ProjectLifecycleTransactionErrorCode,
        operation: ProjectLifecycleOperation,
        phase: ProjectLifecycleTransactionPhase,
        committed: boolean | "unknown",
        message: string,
        cause?: unknown,
    ) {
        super("lifecycle-transaction", message, {cause});
        this.name = "ProjectLifecycleTransactionError";
        this.code = code;
        this.statusCode = code === "PROJECT_EXISTS" ? 409 : code === "PROJECT_VALIDATION_FAILED" ? 400 : 500;
        this.operation = operation;
        this.phase = phase;
        this.committed = committed;
        this.cause = cause;
    }
}

/** HMR 后仍精确识别 Lifecycle mutation transaction error。 */
export function isProjectLifecycleTransactionError(error: unknown): error is ProjectLifecycleTransactionError {
    return isProjectDomainError(error, "lifecycle-transaction");
}

/** durable mutation提交后仍无法确认锁释放完成。 */
export class ProjectLifecycleLockReleaseFailedError extends ProjectLockReleaseFailedError {
    readonly operation: ProjectLifecycleOperation;
    readonly phase = "release" as const;
    readonly committed: boolean | "unknown";

    /** 保留Lock Module的稳定code，同时补齐Lifecycle事务结果语义。 */
    constructor(
        operation: ProjectLifecycleOperation,
        committed: boolean | "unknown",
        failure: ProjectLockReleaseFailedError,
    ) {
        super(projectLockContext(failure), failure.cause, "lifecycle-lock-release");
        this.name = "ProjectLifecycleLockReleaseFailedError";
        this.operation = operation;
        this.committed = committed;
    }
}

/** HMR 后仍优先识别带 committed 语义的 Lifecycle release error。 */
export function isProjectLifecycleLockReleaseFailedError(
    error: unknown,
): error is ProjectLifecycleLockReleaseFailedError {
    return isProjectDomainError(error, "lifecycle-lock-release");
}

type ProjectDiscoveryState = {
    readonly revision: number;
    readonly projects: readonly ProjectListEntry[];
    readonly candidates: readonly ProjectCandidate[];
    readonly discoveryIssues: readonly ProjectDiscoveryIssue[];
    readonly omittedDiscoveryIssueCount: number;
};

type ProjectDiscoveryScan = Omit<ProjectDiscoveryState, "revision">;

type ProjectLifecycleDiagnosticsSnapshot = Pick<
    ProjectLifecycleDiagnostics,
    | "revision"
    | "discoveryIssues"
    | "omittedDiscoveryIssueCount"
    | "cleanupIssues"
    | "omittedCleanupIssueCount"
>;

type ProjectLifecycleState = "running" | "closing" | "closed";

type ProjectLifecycleWatcherState = "idle" | "starting" | "ready" | "failed" | "closed";

type LifecycleOperationContext = {
    readonly signal: AbortSignal;
    assertActive(): void;
};

type LifecycleCommitGate = () => Promise<void>;

const PROJECT_DISCOVERY_ISSUE_LIMIT = 64;
const PROJECT_CLEANUP_ISSUE_LIMIT = 64;
const DEFAULT_PROJECT_SNAPSHOT_TTL_MS = 5_000;
const DEFAULT_PROJECT_WATCH_DEBOUNCE_MS = 120;
const EMPTY_PROJECT_LIFECYCLE_DIAGNOSTICS: ProjectLifecycleDiagnosticsSnapshot = Object.freeze({
    revision: 0,
    discoveryIssues: Object.freeze([]),
    omittedDiscoveryIssueCount: 0,
    cleanupIssues: Object.freeze([]),
    omittedCleanupIssueCount: 0,
});

/** prepareOpen内层完成后仍由Lifecycle持有、尚未公开移交的结果。 */
type PendingPreparedProjectOpen = {
    readonly ensured: ProjectEnsureCommit;
    readonly occupancy: ProjectOccupancyHandle;
    /** 最后一次root复核后捕获的浅失效generation，只供同步handoff门禁使用。 */
    readonly rootGeneration: number;
};

/** Lifecycle私有token路径与其不可持久化物理所有权。 */
type TransactionOwnedRoot = {
    readonly root: AbsoluteFsPath;
    readonly token: ProjectRootPhysicalToken;
};

/** 公开Promise的最终提交策略；handoff与durable mutation使用不同close语义。 */
type LifecycleOperationCompletion<Pending, Result> =
    | {
        readonly kind: "handoff";
        /** 不得返回Promise或执行I/O，确保所有权翻转后立即settle公开Promise。 */
        commit(pending: Pending): Result;
        abort(pending: Pending, error: unknown): Promise<never>;
    }
    | {
        readonly kind: "durable";
        /** execute返回即表示durable结果已确定；close不得再把结果改写为未提交失败。 */
        commit(pending: Pending): Result;
    };

/**
 * Project Lifecycle 深 Module。
 *
 * 当前 Interface 统一承担 Workspace Root 一级浅扫描、Project/candidate 同代投影、manifest ensure
 * 与同步失效。后续 mutation lock、Occupancy handoff、watcher 和 TTL 继续收口在本 Module 内。
 */
export class ProjectLifecycle {
    private readonly workspaceRoot: AbsoluteFsPath;
    private readonly transactionAdapter: ProjectManifestAdapter;
    private readonly coverStore: ProjectCoverStore;
    private readonly manifestPersistence: ProjectManifestPersistence;
    private readonly lockModule: ProjectLockModule;
    private readonly now: () => number;
    private readonly rootIdentity: ProjectRootIdentityModule;
    private readonly snapshotTtlMs: number;
    private readonly templateAdapter: ProjectTemplateAdapter;
    private readonly watchDebounceMs: number;
    private readonly watcherAdapter: ProjectLifecycleWatcherAdapter;
    private revision = 0;
    private cachedState: ProjectDiscoveryState | null = null;
    private invalidationGeneration = 0;
    private cachedInvalidationGeneration = -1;
    private cachePublishedAt: number | null = null;
    private diagnosticsSnapshot = EMPTY_PROJECT_LIFECYCLE_DIAGNOSTICS;
    private lastRefreshReason: ProjectLifecycleRefreshReason | null = null;
    private lastRefreshAt: number | null = null;
    private lastRefreshError: ProjectLifecycleDiagnosticError | null = null;
    private cleanupIssues: readonly ProjectCleanupIssue[] = Object.freeze([]);
    private omittedCleanupIssueCount = 0;
    private readInFlight: Promise<ProjectDiscoveryState> | null = null;
    private lifecycleState: ProjectLifecycleState = "running";
    private readonly abortController = new AbortController();
    private readonly inFlight = new Set<Promise<void>>();
    private watcher: ProjectLifecycleWatchHandle | null = null;
    private watcherClosePromise: Promise<void> | null = null;
    private watcherState: ProjectLifecycleWatcherState = "idle";
    private watcherGeneration = 0;
    private watcherLastAttemptAt: number | null = null;
    private watcherError: ProjectLifecycleDiagnosticError | null = null;
    private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private closePromise: Promise<void> | null = null;
    private readonly workspaceObservers = new Map<ResolvedProjectWorkspace, Set<() => void>>();

    /** 建立一个严格绑定到指定 Workspace Root 的 Project 生命周期。 */
    constructor(workspaceRoot: AbsoluteFsPath, options: ProjectLifecycleOptions = {}) {
        this.workspaceRoot = workspaceRoot;
        this.transactionAdapter = options.manifestAdapter ?? NODE_PROJECT_MANIFEST_ADAPTER;
        this.coverStore = options.coverStore ?? new ProjectCoverStore();
        this.manifestPersistence = new ProjectManifestPersistence(
            workspaceRoot,
            this.transactionAdapter,
            (issue) => this.recordManifestCleanupIssue(issue),
        );
        this.lockModule = options.lockModule ?? new ProjectLockModule(workspaceRoot);
        this.now = options.now ?? Date.now;
        this.rootIdentity = new ProjectRootIdentityModule(workspaceRoot, options.rootIdentityOptions);
        this.snapshotTtlMs = options.snapshotTtlMs ?? DEFAULT_PROJECT_SNAPSHOT_TTL_MS;
        this.templateAdapter = options.templateAdapter ?? nodeProjectTemplateAdapter(workspaceRoot);
        this.watchDebounceMs = options.watchDebounceMs ?? DEFAULT_PROJECT_WATCH_DEBOUNCE_MS;
        this.watcherAdapter = options.watcherAdapter ?? NODE_PROJECT_LIFECYCLE_WATCHER_ADAPTER;
    }

    /** 返回合法 Project 的轻量、不可变 snapshot。 */
    async readProjects(): Promise<ProjectListSnapshot> {
        this.ensureWatcherStarted();
        return this.runOperation(async (operation) => {
            const state = await this.readState(operation);
            operation.assertActive();
            return Object.freeze({
                revision: state.revision,
                projects: state.projects,
            });
        });
    }

    /** 返回同一浅扫描 revision 中尚未成为合法 Project 的候选目录。 */
    async readCandidates(): Promise<ProjectCandidateSnapshot> {
        this.ensureWatcherStarted();
        return this.runOperation(async (operation) => {
            const state = await this.readState(operation);
            operation.assertActive();
            return Object.freeze({
                revision: state.revision,
                candidates: state.candidates,
            });
        });
    }

    /** 同步返回最近一次成功浅扫描的只读diagnostics，不触发任何文件系统工作。 */
    get diagnostics(): ProjectLifecycleDiagnostics {
        return Object.freeze({
            ...this.diagnosticsSnapshot,
            cache: Object.freeze({
                state: this.cacheDiagnosticState(),
                publishedAt: this.cachePublishedAt,
                lastRefreshReason: this.lastRefreshReason,
                lastRefreshAt: this.lastRefreshAt,
                lastRefreshError: this.lastRefreshError,
            }),
            watcher: Object.freeze({
                state: this.watcherState,
                lastAttemptAt: this.watcherLastAttemptAt,
                error: this.watcherError,
            }),
        });
    }

    /**
     * 观察本Lifecycle generation捕获的物理Project root。
     * 浅snapshot确认root missing/ABA replacement后只通知一次；普通manifest变化不影响Session。
     */
    observeWorkspace(workspace: ResolvedProjectWorkspace, onReplaced: () => void): () => void {
        this.assertRunning();
        this.ensureWatcherStarted();
        const observers = this.workspaceObservers.get(workspace) ?? new Set<() => void>();
        observers.add(onReplaced);
        this.workspaceObservers.set(workspace, observers);
        let active = true;
        return () => {
            if (!active) {
                return;
            }
            active = false;
            observers.delete(onReplaced);
            if (observers.size === 0 && this.workspaceObservers.get(workspace) === observers) {
                this.workspaceObservers.delete(workspace);
            }
        };
    }

    /**
     * 复核调用方已捕获的 workspace 仍指向 capture 时的同一个物理目录。
     *
     * 供已签发访问在每次动作边界重新核验：本方法不取得锁、不写盘、不推进 snapshot，
     * 因此同路径 rename/delete/recreate 的 ABA 只能被失败关闭，不能被当成新的当前项目。
     * 它也不看 Lifecycle 是否关闭：只读复核在 close 后仍要供已接纳操作收口，新操作另由 runOperation gate 拒绝。
     */
    revalidateWorkspace(workspace: ResolvedProjectWorkspace): Promise<void> {
        return this.rootIdentity.revalidate(workspace);
    }

    /** 在当前Lifecycle operation中解析Project root，避免内部递归登记公开operation。 */
    private async resolveWithin(
        ref: ProjectWorkspaceRef,
        operation: LifecycleOperationContext,
        knownDirectoryNames?: readonly string[],
    ): Promise<ResolvedProjectWorkspace> {
        operation.assertActive();
        const resolved = await this.rootIdentity.resolve(ref, knownDirectoryNames);
        operation.assertActive();
        return resolved;
    }

    /**
     * 幂等确保一级物理目录具有最小合法 manifest。
     *
     * 健康 manifest 保持原始 bytes 与 mtime；缺失 manifest 只创建 project.yaml，不初始化任何
     * Project Module。损坏与可归一化 manifest 的备份恢复将在同一 Interface 内继续实现。
     */
    async ensure(ref: ProjectWorkspaceRef): Promise<ProjectEnsureResult> {
        return this.runOperation(
            (operation) => this.ensureWithin(ref, operation),
            {kind: "durable", commit: projectEnsureResult},
        );
    }

    /**
     * 只读校验指定Project Workspace的root与manifest。
     *
     * 本操作不取得mutation/Occupancy、不写入manifest、不失效snapshot，也不推进revision。
     */
    async validate(ref: ProjectWorkspaceRef): Promise<ProjectValidationResult> {
        return this.runOperation(async (operation) => {
            const workspace = await this.resolveWithin(ref, operation);
            const manifest = await this.manifestPersistence.inspect(workspace);
            operation.assertActive();
            await this.rootIdentity.revalidate(workspace);
            operation.assertActive();

            if (manifest.status === "unsafe") {
                throw manifest.error;
            }
            if (manifest.status === "valid") {
                return Object.freeze({
                    status: "valid",
                    projectRoot: workspace.ref.projectRoot,
                    manifest: Object.freeze({...manifest.manifest}),
                    issues: Object.freeze([]),
                });
            }
            return Object.freeze({
                status: "repairable",
                projectRoot: workspace.ref.projectRoot,
                proposedManifest: manifest.proposedManifest,
                issues: manifest.issues,
            });
        });
    }

    /** 从默认/指定模板创建一个全新Project；已有root稳定返回PROJECT_EXISTS。 */
    async create(input: ProjectCreateInput): Promise<ProjectCreateResult> {
        return this.runOperation(
            (operation) => this.createWithin(input, operation),
            {kind: "durable", commit: (result) => result},
        );
    }

    /** 先完成慢速staging materialize，再进入短mutation/Occupancy发布事务。 */
    private async createWithin(
        input: ProjectCreateInput,
        operation: LifecycleOperationContext,
    ): Promise<ProjectCreateResult> {
        const ref = projectWorkspaceRef(input.ref.projectRoot);
        const manifest: ProjectManifest = {
            kind: "novel",
            title: input.title.trim() || ref.projectRoot,
            summary: input.summary?.trim() ?? "",
        };
        const staging = await this.stageProject("create", ref, operation, async ({root}) => {
            try {
                await this.templateAdapter.materialize({
                    template: input.template ?? DEFAULT_PROJECT_TEMPLATE,
                    stagingRoot: root,
                    signal: operation.signal,
                });
            } catch (error) {
                operation.assertActive();
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_TEMPLATE_FAILED",
                    "create",
                    "materialize",
                    false,
                    `Project模板物化失败：${ref.projectRoot}`,
                    error,
                );
            }
            if (await transactionPathExists(path.join(root, "project.yaml"), this.transactionAdapter)) {
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_TEMPLATE_FAILED",
                    "create",
                    "materialize",
                    false,
                    "Project模板不得拥有project.yaml",
                );
            }
            await this.manifestPersistence.materializeManifest(root, ref.projectRoot, manifest);
        });
        let mutation: WorkspaceMutationHandle | null = null;
        let occupancy: ProjectOccupancyHandle | null = null;
        let committedResult: ProjectCreateResult | null = null;
        try {
            operation.assertActive();
            mutation = await this.lockModule.acquireMutation();
            operation.assertActive();
            occupancy = await this.lockModule.acquireOccupancy(ref);
            operation.assertActive();
            const published = await this.publishStagedProject(
                "create",
                ref,
                staging,
                operation,
                mutation,
                occupancy,
            );
            committedResult = Object.freeze({
                revision: published.revision,
                project: published.project,
            });
            try {
                await releaseProjectLocks(mutation, occupancy);
            } catch (error) {
                throwCommittedLockReleaseFailure("create", error);
            }
            return committedResult;
        } catch (error) {
            if (committedResult) {
                throw error;
            }
            return await throwAfterLockRelease(error, mutation, occupancy, "create");
        } finally {
            await this.cleanupOwnedTransactionPath("create", "staging", staging.root, staging.token);
        }
    }

    /** 从Archive/Upload source导入全新Project；source不直接拥有最终Project root或manifest写入。 */
    async importProject(input: ProjectImportInput): Promise<ProjectImportResult> {
        return this.runOperation(
            (operation) => this.importWithin(input, operation),
            {kind: "durable", commit: (result) => result},
        );
    }

    /** 在私有staging完成source物化和manifest ensure，再复用create的短发布事务。 */
    private async importWithin(
        input: ProjectImportInput,
        operation: LifecycleOperationContext,
    ): Promise<ProjectImportResult> {
        const ref = projectWorkspaceRef(input.ref.projectRoot);
        const staging = await this.stageProject("import", ref, operation, async (owned) => {
            let sourceResult: ProjectImportMaterializeResult;
            try {
                sourceResult = await input.source.materialize({
                    stagingRoot: owned.root,
                    signal: operation.signal,
                });
            } catch (error) {
                operation.assertActive();
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_IMPORT_FAILED",
                    "import",
                    "materialize",
                    false,
                    `Project source物化失败：${ref.projectRoot}`,
                    error,
                );
            }

            const stagingGate = async () => {
                operation.assertActive();
                await this.rootIdentity.revalidatePhysical(owned.root, owned.token);
                operation.assertActive();
            };
            await stagingGate();
            if (await transactionPathExists(path.join(owned.root, "project.yaml"), this.transactionAdapter)) {
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_IMPORT_FAILED",
                    "import",
                    "materialize",
                    false,
                    "Project import source不得直接写入project.yaml",
                );
            }
            try {
                await this.manifestPersistence.materializeImportedManifest(
                    owned.root,
                    ref.projectRoot,
                    sourceResult.manifestBytes,
                    stagingGate,
                );
            } catch (error) {
                operation.assertActive();
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_PUBLISH_FAILED",
                    "import",
                    "publish-manifest",
                    false,
                    `无法在import staging中发布合法manifest：${ref.projectRoot}`,
                    error,
                );
            }
        });
        let mutation: WorkspaceMutationHandle | null = null;
        let occupancy: ProjectOccupancyHandle | null = null;
        let committedResult: ProjectImportResult | null = null;
        try {
            operation.assertActive();
            mutation = await this.lockModule.acquireMutation();
            operation.assertActive();
            occupancy = await this.lockModule.acquireOccupancy(ref);
            operation.assertActive();
            const published = await this.publishStagedProject(
                "import",
                ref,
                staging,
                operation,
                mutation,
                occupancy,
            );
            committedResult = Object.freeze({
                revision: published.revision,
                project: published.project,
            });
            try {
                await releaseProjectLocks(mutation, occupancy);
            } catch (error) {
                throwCommittedLockReleaseFailure("import", error);
            }
            return committedResult;
        } catch (error) {
            if (committedResult) {
                throw error;
            }
            return await throwAfterLockRelease(error, mutation, occupancy, "import");
        } finally {
            await this.cleanupOwnedTransactionPath("import", "staging", staging.root, staging.token);
        }
    }

    /** 原子更新Project metadata；运行中调用方必须显式借用当前session generation。 */
    async updateMetadata(
        input: ProjectMetadataUpdateInput,
        access: ProjectMetadataAccess = {kind: "acquire"},
    ): Promise<ProjectMetadataUpdateResult> {
        return this.runOperation(
            (operation) => this.updateMetadataWithin(input, access, operation),
            {kind: "durable", commit: (result) => result},
        );
    }

    /** 按owned或borrowed Occupancy合同写入manifest并发布同一代snapshot。 */
    private async updateMetadataWithin(
        input: ProjectMetadataUpdateInput,
        access: ProjectMetadataAccess,
        operation: LifecycleOperationContext,
    ): Promise<ProjectMetadataUpdateResult> {
        const ref = projectWorkspaceRef(input.ref.projectRoot);
        const patch: ProjectManifestMetadataPatch = {
            title: input.title?.trim(),
            summary: input.summary?.trim(),
        };
        if (patch.title !== undefined && patch.title.length === 0) {
            throw new ProjectLifecycleTransactionError(
                "PROJECT_VALIDATION_FAILED",
                "metadata-update",
                "validate",
                false,
                "Project title不能为空",
            );
        }
        if (patch.title === undefined && patch.summary === undefined) {
            throw new ProjectLifecycleTransactionError(
                "PROJECT_VALIDATION_FAILED",
                "metadata-update",
                "validate",
                false,
                "metadata update至少需要title或summary之一",
            );
        }

        return this.updateManifestWithin(
            ref,
            access,
            operation,
            "metadata-update",
            async () => ({patch}),
        );
    }

    /** 原子更新 Project 封面；manifest 是提交点，原图先按内容寻址发布。 */
    async updateCover(
        input: ProjectCoverUpdateInput,
        access: ProjectMetadataAccess = {kind: "acquire"},
    ): Promise<ProjectCoverUpdateResult> {
        return this.runOperation(
            (operation) => this.updateCoverWithin(input, access, operation),
            {kind: "durable", commit: (result) => result},
        );
    }

    /** 准备封面原图后复用唯一 manifest mutation 事务骨架。 */
    private async updateCoverWithin(
        input: ProjectCoverUpdateInput,
        access: ProjectMetadataAccess,
        operation: LifecycleOperationContext,
    ): Promise<ProjectCoverUpdateResult> {
        const ref = projectWorkspaceRef(input.ref.projectRoot);
        return this.updateManifestWithin(
            ref,
            access,
            operation,
            "cover-update",
            async (workspace, commitGate) => {
                await commitGate();
                if (input.cover === null) {
                    return {
                        patch: {cover: null},
                        afterCommit: async (project) => {
                            await this.recordCoverCleanupIssues(
                                await this.coverStore.converge(workspace, project.cover),
                            );
                        },
                    };
                }
                let published: PublishedProjectCover;
                try {
                    published = await this.coverStore.publish(workspace, input.cover);
                } catch (error) {
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_PUBLISH_FAILED",
                        "cover-update",
                        "materialize",
                        false,
                        `Project 封面原图发布失败：${ref.projectRoot}`,
                        error,
                    );
                }
                this.recordCoverCleanupIssues(published.cleanupIssues);
                return {
                    patch: {cover: published.path},
                    rollback: () => this.coverStore.rollback(workspace, published),
                    afterCommit: async (project) => {
                        await this.recordCoverCleanupIssues(
                            await this.coverStore.converge(workspace, project.cover),
                        );
                    },
                };
            },
        );
    }

    /**
     * metadata 与 cover 共享的唯一 manifest mutation 骨架。
     *
     * prepare 在锁与 root identity 门禁内运行；manifest 发布后失败统一标记 unknown，
     * 只有明确未提交时才执行调用方提供的原图回滚。
     */
    private async updateManifestWithin(
        ref: ProjectWorkspaceRef,
        access: ProjectMetadataAccess,
        operation: LifecycleOperationContext,
        lifecycleOperation: Extract<ProjectLifecycleOperation, "metadata-update" | "cover-update">,
        prepare: (
            workspace: ResolvedProjectWorkspace,
            commitGate: LifecycleCommitGate,
        ) => Promise<{
            readonly patch: ProjectManifestMetadataPatch;
            readonly rollback?: () => Promise<void>;
            readonly afterCommit?: (project: ProjectListEntry) => Promise<void>;
        }>,
    ): Promise<ProjectMetadataUpdateResult> {

        const mutation = await this.lockModule.acquireMutation();
        let occupancy: ProjectOccupancyHandle | null = null;
        let committedResult: ProjectMetadataUpdateResult | null = null;
        let prepared: Awaited<ReturnType<typeof prepare>> | null = null;
        let manifestChanged = false;
        try {
            operation.assertActive();
            if (access.kind === "acquire") {
                occupancy = await this.lockModule.acquireOccupancy(ref);
                operation.assertActive();
            } else {
                access.assertActive();
            }

            const current = await this.resolveWithin(ref, operation);
            let workspace = current;
            if (access.kind === "borrowed") {
                access.assertActive();
                await this.rootIdentity.revalidate(access.workspace);
                operation.assertActive();
                access.assertActive();
                if (current.key !== access.workspace.key || current.root !== access.workspace.root) {
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_VALIDATION_FAILED",
                        lifecycleOperation,
                        "validate",
                        false,
                        "借用的Project session generation与目标Project不一致",
                    );
                }
                workspace = access.workspace;
            }

            const commitGate = async () => {
                operation.assertActive();
                mutation.assertHealthy();
                if (access.kind === "borrowed") {
                    access.assertActive();
                } else {
                    occupancy!.assertHealthy();
                }
                await this.rootIdentity.revalidate(workspace);
                operation.assertActive();
                mutation.assertHealthy();
                if (access.kind === "borrowed") {
                    access.assertActive();
                } else {
                    occupancy!.assertHealthy();
                }
            };

            let manifestResult: ProjectManifestEnsureResult;
            try {
                prepared = await prepare(workspace, commitGate);
                manifestResult = await this.manifestPersistence.updateMetadata(
                    workspace,
                    prepared.patch,
                    commitGate,
                    lifecycleOperation,
                );
            } catch (error) {
                if (error instanceof ProjectManifestPublishedError) {
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_PUBLISH_FAILED",
                        lifecycleOperation,
                        "publish-manifest",
                        "unknown",
                        `project.yaml已经更新，但Project snapshot尚未确认：${ref.projectRoot}`,
                        error,
                    );
                }
                throw error;
            }
            manifestChanged = manifestResult.change !== "none";

            let publishedProject: {readonly revision: number; readonly project: ProjectListEntry};
            try {
                publishedProject = await this.publishEnsuredProject(
                    workspace.ref.projectRoot,
                    operation,
                    commitGate,
                    mutation,
                );
            } catch (error) {
                if (manifestChanged) {
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_PUBLISH_FAILED",
                        lifecycleOperation,
                        "publish-snapshot",
                        "unknown",
                        `Project metadata已经写入，但snapshot尚未确认：${ref.projectRoot}`,
                        error,
                    );
                }
                throw error;
            }
            committedResult = Object.freeze({
                revision: publishedProject.revision,
                project: publishedProject.project,
            });
            if (prepared.afterCommit) {
                await prepared.afterCommit(publishedProject.project);
            }
            try {
                await releaseProjectLocks(mutation, occupancy);
            } catch (error) {
                throwCommittedLockReleaseFailure(lifecycleOperation, error);
            }
            return committedResult;
        } catch (cause) {
            if (committedResult) {
                throw cause;
            }
            let error = cause;
            if (prepared?.rollback && committedState(cause) === false) {
                try {
                    await prepared.rollback();
                } catch (rollbackError) {
                    error = new ProjectLifecycleTransactionError(
                        "PROJECT_ROLLBACK_FAILED",
                        lifecycleOperation,
                        "rollback",
                        false,
                        `${lifecycleOperation} 未提交，但新封面原图回滚失败`,
                        new AggregateError([cause, rollbackError]),
                    );
                }
            }
            return await throwAfterLockRelease(error, mutation, occupancy, lifecycleOperation);
        }
    }

    /**
     * 删除一个已经由调用方关闭的Project。
     *
     * Lifecycle不隐式close；若仍有session持有Occupancy，本操作直接返回PROJECT_IN_USE。
     */
    async delete(ref: ProjectWorkspaceRef): Promise<ProjectDeleteResult> {
        return this.runOperation(
            (operation) => this.deleteWithin(ref, operation),
            {kind: "durable", commit: (result) => result},
        );
    }

    /** 在持锁短事务中移动root、发布absence，并把墓碑清理降为后台best-effort。 */
    private async deleteWithin(
        inputRef: ProjectWorkspaceRef,
        operation: LifecycleOperationContext,
    ): Promise<ProjectDeleteResult> {
        const ref = projectWorkspaceRef(inputRef.projectRoot);
        const mutation = await this.lockModule.acquireMutation();
        let occupancy: ProjectOccupancyHandle | null = null;
        let committedResult: ProjectDeleteResult | null = null;
        try {
            operation.assertActive();
            occupancy = await this.lockModule.acquireOccupancy(ref);
            operation.assertActive();
            const resolved = await this.resolveWithin(ref, operation);
            await this.rootIdentity.revalidate(resolved);
            mutation.assertHealthy();
            occupancy.assertHealthy();
            operation.assertActive();

            const tombstoneParent = absoluteFsPath(path.join(this.workspaceRoot, ".nbook", "deleted-projects"));
            const tombstoneRoot = absoluteFsPath(path.join(tombstoneParent, `v1-${randomUUID()}`));
            await assertRealPathContained(this.workspaceRoot, tombstoneParent);
            await this.transactionAdapter.mkdir(tombstoneParent, {recursive: true});
            await assertRealPathContained(this.workspaceRoot, tombstoneParent);

            const tombstoneToken = await this.rootIdentity.capturePhysical(resolved.root);
            let tombstonePublished = false;
            try {
                await this.transactionAdapter.rename(resolved.root, tombstoneRoot);
                tombstonePublished = true;
                await this.rootIdentity.revalidatePhysical(tombstoneRoot, tombstoneToken);
            } catch (error) {
                if (!tombstonePublished) {
                    try {
                        await this.rootIdentity.revalidatePhysical(tombstoneRoot, tombstoneToken);
                        tombstonePublished = true;
                    } catch (tombstoneError) {
                        try {
                            await this.rootIdentity.revalidatePhysical(resolved.root, tombstoneToken);
                        } catch (sourceError) {
                            throw new ProjectLifecycleTransactionError(
                                "PROJECT_ROLLBACK_FAILED",
                                "delete",
                                "rollback",
                                "unknown",
                                `delete rename失败后无法确认Project root位置：${ref.projectRoot}`,
                                new AggregateError(
                                    [error, tombstoneError, sourceError],
                                    "Project delete rename结果无法判定",
                                ),
                            );
                        }
                        throw new ProjectLifecycleTransactionError(
                            "PROJECT_PUBLISH_FAILED",
                            "delete",
                            "publish-root",
                            false,
                            `无法把Project移动到删除墓碑：${ref.projectRoot}`,
                            error,
                        );
                    }
                }
                await this.rollbackDeletedProject(
                    ref,
                    resolved,
                    tombstoneRoot,
                    tombstoneToken,
                    "publish-root",
                    error,
                );
            }

            try {
                const transactionGate = this.transactionCommitGate(operation, mutation, occupancy);
                const commitGate = async () => {
                    await transactionGate();
                    await this.rootIdentity.revalidatePhysical(tombstoneRoot, tombstoneToken);
                    await transactionGate();
                };
                const state = await this.refreshState(operation, commitGate, mutation);
                if (
                    state.projects.some((project) => project.projectRoot === ref.projectRoot)
                    || state.candidates.some((candidate) => candidate.projectRoot === ref.projectRoot)
                ) {
                    throw new Error(`delete后snapshot仍包含Project：${ref.projectRoot}`);
                }
                committedResult = Object.freeze({
                    revision: state.revision,
                    projectRoot: ref.projectRoot,
                });
            } catch (error) {
                await this.rollbackDeletedProject(
                    ref,
                    resolved,
                    tombstoneRoot,
                    tombstoneToken,
                    "publish-snapshot",
                    error,
                );
            }

            this.startBackground(
                this.cleanupOwnedTransactionPath("delete", "tombstone", tombstoneRoot, tombstoneToken),
            );
            try {
                await releaseProjectLocks(mutation, occupancy);
            } catch (error) {
                throwCommittedLockReleaseFailure("delete", error);
            }
            if (!committedResult) {
                throw new Error(`delete未产生已提交结果：${ref.projectRoot}`);
            }
            return committedResult;
        } catch (error) {
            if (committedResult) {
                throw error;
            }
            return await throwAfterLockRelease(error, mutation, occupancy, "delete");
        }
    }

    /** delete未提交时只把仍由本事务拥有的tombstone恢复到仍为空闲的原Project Path。 */
    private async rollbackDeletedProject(
        ref: ProjectWorkspaceRef,
        resolved: ResolvedProjectWorkspace,
        tombstoneRoot: AbsoluteFsPath,
        tombstoneToken: ProjectRootPhysicalToken,
        phase: Extract<ProjectLifecycleTransactionPhase, "publish-root" | "publish-snapshot">,
        cause: unknown,
    ): Promise<never> {
        try {
            await this.rootIdentity.assertPhysicalVacant(resolved.root);
            await this.rootIdentity.revalidatePhysical(tombstoneRoot, tombstoneToken);
            await this.transactionAdapter.rename(tombstoneRoot, resolved.root);
            await this.rootIdentity.revalidate(resolved);
        } catch (rollbackError) {
            throw new ProjectLifecycleTransactionError(
                "PROJECT_ROLLBACK_FAILED",
                "delete",
                "rollback",
                "unknown",
                `delete失败且无法恢复Project root：${ref.projectRoot}`,
                new AggregateError([cause, rollbackError], "Project delete rollback失败"),
            );
        }
        throw new ProjectLifecycleTransactionError(
            "PROJECT_PUBLISH_FAILED",
            "delete",
            phase,
            false,
            `delete无法发布Project absence：${ref.projectRoot}`,
            cause,
        );
    }

    /** 在单个Lifecycle operation内完成ensure，统一close/abort门禁。 */
    private async ensureWithin(
        ref: ProjectWorkspaceRef,
        operation: LifecycleOperationContext,
    ): Promise<ProjectEnsureCommit> {
        let firstResolved: ResolvedProjectWorkspace | null = null;
        let firstManifest: ProjectManifestInspection | null = null;
        try {
            firstResolved = await this.resolveWithin(ref, operation);
            firstManifest = await this.manifestPersistence.inspect(firstResolved);
            operation.assertActive();
            if (firstManifest.status === "unsafe") {
                throw firstManifest.error;
            }
        } catch (error) {
            if (!isProjectNotFoundError(error)) {
                throw error;
            }
        }

        const mutation = await this.lockModule.acquireMutation();
        let occupancy: ProjectOccupancyHandle | null = null;
        let committedResult: ProjectEnsureCommit | null = null;
        try {
            operation.assertActive();
            if (firstResolved && firstManifest?.status === "valid") {
                committedResult = await this.ensureResolved(
                    firstResolved,
                    operation,
                    this.commitGate(operation, firstResolved, mutation),
                    mutation,
                    firstManifest,
                );
            } else {
                occupancy = await this.lockModule.acquireOccupancy(ref);
                operation.assertActive();
                try {
                    const resolved = await this.resolveWithin(ref, operation);
                    committedResult = await this.ensureResolved(
                        resolved,
                        operation,
                        this.commitGate(operation, resolved, mutation, occupancy),
                        mutation,
                    );
                } catch (error) {
                    if (!isProjectNotFoundError(error)) {
                        throw error;
                    }
                    committedResult = await this.publishMissingProject(ref, operation, mutation, occupancy);
                }
            }
            try {
                await releaseProjectLocks(mutation, occupancy);
            } catch (error) {
                throwCommittedLockReleaseFailure("ensure", error);
            }
            return committedResult;
        } catch (error) {
            if (committedResult) {
                throw error;
            }
            return await throwAfterLockRelease(error, mutation, occupancy, "ensure");
        }
    }

    /** 在私有同卷staging中构造最小Project root，再复用通用发布事务。 */
    private async publishMissingProject(
        ref: ProjectWorkspaceRef,
        operation: LifecycleOperationContext,
        mutation: WorkspaceMutationHandle,
        occupancy: ProjectOccupancyHandle,
    ): Promise<ProjectEnsureCommit> {
        const staging = await this.stageProject("ensure", ref, operation, ({root}) => (
            this.manifestPersistence.materializeManifest(root, ref.projectRoot)
        ));
        try {
            return await this.publishStagedProject(
                "ensure",
                ref,
                staging,
                operation,
                mutation,
                occupancy,
                (existing) => this.ensureResolved(
                    existing,
                    operation,
                    this.commitGate(operation, existing, mutation, occupancy),
                    mutation,
                ),
            );
        } finally {
            await this.cleanupOwnedTransactionPath("ensure", "staging", staging.root, staging.token);
        }
    }

    /** 创建owner-token staging并执行调用方materialize；失败只清理本token目录。 */
    private async stageProject(
        lifecycleOperation: Extract<ProjectLifecycleOperation, "ensure" | "create" | "import">,
        ref: ProjectWorkspaceRef,
        operation: LifecycleOperationContext,
        materialize: (staging: TransactionOwnedRoot) => Promise<void>,
    ): Promise<TransactionOwnedRoot> {
        const ownerToken = randomUUID();
        const stagingParent = absoluteFsPath(path.join(
            this.workspaceRoot,
            ".nbook",
            "lifecycle",
            "staging",
        ));
        const stagingRoot = absoluteFsPath(path.join(stagingParent, `v1-${ownerToken}`));
        let stagingCreated = false;
        let stagingToken: ProjectRootPhysicalToken | null = null;
        try {
            await assertRealPathContained(this.workspaceRoot, stagingParent);
            await this.transactionAdapter.mkdir(stagingParent, {recursive: true});
            await assertRealPathContained(this.workspaceRoot, stagingParent);
            await this.transactionAdapter.mkdir(stagingRoot, {recursive: false});
            stagingCreated = true;
            stagingToken = await this.rootIdentity.capturePhysical(stagingRoot);
            operation.assertActive();
            const staging = {root: stagingRoot, token: stagingToken};
            await materialize(staging);
            await this.rootIdentity.revalidatePhysical(stagingRoot, stagingToken);
            operation.assertActive();
            return staging;
        } catch (error) {
            if (stagingToken) {
                await this.cleanupOwnedTransactionPath(
                    lifecycleOperation,
                    "staging",
                    stagingRoot,
                    stagingToken,
                );
            } else if (stagingCreated) {
                this.recordCleanupIoIssue(
                    lifecycleOperation,
                    "staging",
                    stagingRoot,
                    "ownership-check",
                    error,
                );
            }
            throw error;
        }
    }

    /** cleanup前复核token，避免owner路径被外部替换后递归删除replacement。 */
    private async cleanupOwnedTransactionPath(
        operation: ProjectCleanupIssue["operation"],
        target: ProjectCleanupIssue["target"],
        transactionRoot: AbsoluteFsPath,
        token: ProjectRootPhysicalToken,
    ): Promise<void> {
        let ownership: Awaited<ReturnType<ProjectRootIdentityModule["inspectPhysicalOwnership"]>>;
        try {
            ownership = await this.rootIdentity.inspectPhysicalOwnership(transactionRoot, token);
        } catch (error) {
            this.recordCleanupIoIssue(operation, target, transactionRoot, "ownership-check", error);
            return;
        }
        if (ownership === "missing") {
            return;
        }
        if (ownership === "replaced") {
            this.appendCleanupIssue(Object.freeze({
                kind: "transaction-cleanup",
                operation,
                target,
                phase: "ownership-check",
                path: cleanupRelativePath(this.workspaceRoot, transactionRoot),
                code: "PROJECT_ROOT_REPLACED",
            }));
            return;
        }
        try {
            await this.transactionAdapter.rm(transactionRoot, {recursive: true, force: true});
        } catch (error) {
            this.recordCleanupIoIssue(operation, target, transactionRoot, "remove", error);
        }
    }

    /** 把ownership或remove的真实I/O失败压缩为稳定cleanup诊断。 */
    private recordCleanupIoIssue(
        operation: ProjectCleanupIssue["operation"],
        target: ProjectCleanupIssue["target"],
        transactionRoot: AbsoluteFsPath,
        phase: Extract<ProjectCleanupIssue, {readonly code: "PROJECT_ROOT_IO"}>["phase"],
        error: unknown,
    ): void {
        const systemCode = diagnosticSystemCode(error);
        this.appendCleanupIssue(Object.freeze({
            kind: "transaction-cleanup",
            operation,
            target,
            phase,
            path: cleanupRelativePath(this.workspaceRoot, transactionRoot),
            code: "PROJECT_ROOT_IO",
            ...(systemCode ? {systemCode} : {}),
        }));
    }

    /** 把Manifest深Module的temp清理失败投影为Lifecycle统一有界diagnostics。 */
    private recordManifestCleanupIssue(issue: ManifestCleanupIssue): void {
        const systemCode = diagnosticSystemCode(issue.error);
        this.appendCleanupIssue(Object.freeze({
            kind: "transaction-cleanup",
            operation: issue.operation,
            target: issue.target,
            phase: "remove",
            path: issue.path,
            code: "PROJECT_ROOT_IO",
            ...(systemCode ? {systemCode} : {}),
        }));
    }

    /** 把已提交 cover mutation 的旧托管文件清理失败投影为有界 diagnostics。 */
    private recordCoverCleanupIssues(issues: readonly ProjectCoverCleanupIssue[]): void {
        for (const issue of issues) {
            const systemCode = diagnosticSystemCode(issue.error);
            this.appendCleanupIssue(Object.freeze({
                kind: "transaction-cleanup",
                operation: "cover-update",
                target: "cover-file",
                phase: "remove",
                path: issue.path,
                code: "PROJECT_ROOT_IO",
                ...(systemCode ? {systemCode} : {}),
            }));
        }
    }

    /** 追加一条有界cleanup诊断；记录动作本身同步且不得改变原事务结果。 */
    private appendCleanupIssue(issue: ProjectCleanupIssue): void {
        const nextIssues = [...this.cleanupIssues, issue];
        const overflow = Math.max(0, nextIssues.length - PROJECT_CLEANUP_ISSUE_LIMIT);
        this.cleanupIssues = Object.freeze(nextIssues.slice(-PROJECT_CLEANUP_ISSUE_LIMIT));
        this.omittedCleanupIssueCount += overflow;
        this.diagnosticsSnapshot = Object.freeze({
            ...this.diagnosticsSnapshot,
            cleanupIssues: this.cleanupIssues,
            omittedCleanupIssueCount: this.omittedCleanupIssueCount,
        });
    }

    /** 已持锁时把完整staging root发布为Project，并在snapshot提交前失败时回滚。 */
    private async publishStagedProject(
        lifecycleOperation: Extract<ProjectLifecycleOperation, "ensure" | "create" | "import">,
        ref: ProjectWorkspaceRef,
        staging: TransactionOwnedRoot,
        operation: LifecycleOperationContext,
        mutation: WorkspaceMutationHandle,
        occupancy: ProjectOccupancyHandle,
        onExisting?: (existing: ResolvedProjectWorkspace) => Promise<ProjectEnsureCommit>,
    ): Promise<ProjectEnsureCommit> {
        const {root: stagingRoot, token: publishedToken} = staging;
        const targetRoot = absoluteFsPath(path.join(this.workspaceRoot, ref.projectRoot));
        let published = false;
        let publishedWorkspace: ResolvedProjectWorkspace | null = null;
        let phase: ProjectLifecycleTransactionPhase = "publish-root";
        /** 在发布前解析当前target；只有明确PROJECT_NOT_FOUND才表示当前可继续发布。 */
        const resolveExisting = async (): Promise<ResolvedProjectWorkspace | null> => {
            try {
                return await this.resolveWithin(ref, operation);
            } catch (error) {
                if (isProjectNotFoundError(error)) {
                    return null;
                }
                throw error;
            }
        };
        /** ensure切换到已有root；create/import保持create-only并返回稳定PROJECT_EXISTS。 */
        const finishExisting = async (existing: ResolvedProjectWorkspace): Promise<ProjectEnsureCommit> => {
            if (onExisting) {
                return onExisting(existing);
            }
            throw new ProjectLifecycleTransactionError(
                "PROJECT_EXISTS",
                lifecycleOperation,
                "publish-root",
                false,
                `Project Workspace已存在：${ref.projectRoot}`,
            );
        };
        try {
            const existing = await resolveExisting();
            if (existing) {
                return finishExisting(existing);
            }

            await assertRealPathContained(this.workspaceRoot, targetRoot);
            const finalExisting = await resolveExisting();
            if (finalExisting) {
                return finishExisting(finalExisting);
            }
            operation.assertActive();
            mutation.assertHealthy();
            occupancy.assertHealthy();
            try {
                await this.transactionAdapter.rename(stagingRoot, targetRoot);
                published = true;
            } catch (error) {
                try {
                    await this.rootIdentity.revalidatePhysical(targetRoot, publishedToken);
                } catch (targetError) {
                    try {
                        await this.rootIdentity.revalidatePhysical(stagingRoot, publishedToken);
                    } catch (sourceError) {
                        throw new ProjectLifecycleTransactionError(
                            "PROJECT_ROLLBACK_FAILED",
                            lifecycleOperation,
                            "rollback",
                            "unknown",
                            `${lifecycleOperation} rename失败后无法确认Project root位置：${ref.projectRoot}`,
                            new AggregateError(
                                [error, targetError, sourceError],
                                "Project root rename结果无法判定",
                            ),
                        );
                    }
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_PUBLISH_FAILED",
                        lifecycleOperation,
                        "publish-root",
                        false,
                        `${lifecycleOperation} Project root未发布：${ref.projectRoot}`,
                        error,
                    );
                }
                published = true;
                throw error;
            }
            await this.rootIdentity.revalidatePhysical(targetRoot, publishedToken);
            operation.assertActive();
            mutation.assertHealthy();
            occupancy.assertHealthy();

            phase = "resolve-root";
            publishedWorkspace = await this.resolveWithin(ref, operation);
            const commitGate = this.commitGate(operation, publishedWorkspace, mutation, occupancy);
            await commitGate();
            phase = "publish-snapshot";
            const publishedProject = await this.publishEnsuredProject(
                ref.projectRoot,
                operation,
                commitGate,
                mutation,
            );
            published = false;
            return projectEnsureCommit(
                publishedProject.revision,
                publishedProject.project,
                publishedWorkspace,
                "created",
            );
        } catch (error) {
            if (published) {
                try {
                    await this.rootIdentity.revalidatePhysical(targetRoot, publishedToken);
                } catch (ownershipError) {
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_ROLLBACK_FAILED",
                        lifecycleOperation,
                        "rollback",
                        "unknown",
                        `${lifecycleOperation} Project失败且target所有权已变化：${ref.projectRoot}`,
                        new AggregateError([error, ownershipError], "Project root rollback所有权复核失败"),
                    );
                }
                try {
                    await this.rootIdentity.assertPhysicalVacant(stagingRoot);
                    await this.transactionAdapter.rename(targetRoot, stagingRoot);
                    published = false;
                } catch (rollbackError) {
                    throw new ProjectLifecycleTransactionError(
                        "PROJECT_ROLLBACK_FAILED",
                        lifecycleOperation,
                        "rollback",
                        "unknown",
                        `${lifecycleOperation} Project失败且无法回滚：${ref.projectRoot}`,
                        new AggregateError([error, rollbackError], "Project root rollback失败"),
                    );
                }
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_PUBLISH_FAILED",
                    lifecycleOperation,
                    phase,
                    false,
                    `${lifecycleOperation} Project发布失败：${ref.projectRoot}`,
                    error,
                );
            }
            throw error;
        }
    }

    /**
     * 为产品open执行固定的mutation → Occupancy → ensure → snapshot publish顺序。
     * mutation在返回前释放；同一Occupancy handle由调用方直接移交ProjectSession，不得release/reacquire。
     */
    async prepareOpen(ref: ProjectWorkspaceRef): Promise<PreparedProjectOpen> {
        return this.runOperation(
            (operation) => this.prepareOpenWithin(ref, operation),
            {
                kind: "handoff",
                commit: (pending) => {
                    if (pending.rootGeneration !== this.invalidationGeneration) {
                        throw new ProjectLifecycleError(
                            "PROJECT_ROOT_REPLACED",
                            "Project Workspace在Occupancy handoff前发生新的文件系统变化",
                        );
                    }
                    pending.occupancy.assertHealthy();
                    return preparedProjectOpen(this.workspaceRoot, pending.ensured, pending.occupancy);
                },
                abort: (pending, error) => throwAfterLockRelease(error, null, pending.occupancy),
            },
        );
    }

    /** 在单个Lifecycle operation内完成prepare-open与Occupancy ownership handoff。 */
    private async prepareOpenWithin(
        ref: ProjectWorkspaceRef,
        operation: LifecycleOperationContext,
    ): Promise<PendingPreparedProjectOpen> {
        const mutation = await this.lockModule.acquireMutation();
        let pendingMutation: WorkspaceMutationHandle | null = mutation;
        let occupancy: ProjectOccupancyHandle | null = null;
        try {
            operation.assertActive();
            occupancy = await this.lockModule.acquireOccupancy(ref);
            occupancy.assertHealthy();
            operation.assertActive();
            const resolved = await this.resolveWithin(ref, operation);
            const commitGate = this.commitGate(operation, resolved, mutation, occupancy);
            const ensured = await this.ensureResolved(resolved, operation, commitGate, mutation);
            await this.rootIdentity.revalidate(resolved);
            mutation.assertHealthy();
            occupancy.assertHealthy();
            operation.assertActive();
            const releasingMutation = pendingMutation;
            pendingMutation = null;
            await releasingMutation.release();
            await this.rootIdentity.revalidate(resolved);
            operation.assertActive();
            occupancy.assertHealthy();
            if (this.cachedInvalidationGeneration !== this.invalidationGeneration) {
                throw new ProjectLifecycleError(
                    "PROJECT_ROOT_REPLACED",
                    "Project Workspace snapshot在Occupancy handoff前已经失效",
                );
            }
            return {ensured, occupancy, rootGeneration: this.invalidationGeneration};
        } catch (error) {
            return await throwAfterLockRelease(error, pendingMutation, occupancy);
        }
    }

    /** 在调用方已经持有所需锁时完成manifest ensure与snapshot发布。 */
    private async ensureResolved(
        resolved: ResolvedProjectWorkspace,
        operation: LifecycleOperationContext,
        commitGate: LifecycleCommitGate,
        mutation: WorkspaceMutationHandle,
        knownManifest?: ProjectManifestInspection,
    ): Promise<ProjectEnsureCommit> {
        let ensuredManifest: ProjectManifestEnsureResult;
        try {
            ensuredManifest = await this.manifestPersistence.ensure(resolved, commitGate, knownManifest);
        } catch (error) {
            if (error instanceof ProjectManifestPublishedError) {
                throw new ProjectLifecycleTransactionError(
                    "PROJECT_PUBLISH_FAILED",
                    "ensure",
                    "publish-manifest",
                    "unknown",
                    `project.yaml已经发布，但Project snapshot尚未确认：${resolved.ref.projectRoot}`,
                    error,
                );
            }
            throw error;
        }
        operation.assertActive();
        await commitGate();
        const publishedProject = await this.publishEnsuredProject(
            resolved.ref.projectRoot,
            operation,
            commitGate,
            mutation,
        );
        return projectEnsureCommit(
            publishedProject.revision,
            publishedProject.project,
            resolved,
            ensuredManifest.change,
            ensuredManifest.recoveryPath,
        );
    }

    /** 首次读取幂等启动唯一Workspace Root浅watcher；ready不阻塞初始扫描。 */
    private ensureWatcherStarted(): void {
        if (this.lifecycleState !== "running") {
            return;
        }
        if (this.watcher) {
            return;
        }
        const retryDue = this.watcherState === "failed"
            && this.watcherLastAttemptAt !== null
            && this.now() - this.watcherLastAttemptAt >= this.snapshotTtlMs;
        if (this.watcherState !== "idle" && !retryDue) {
            return;
        }
        const generation = this.watcherGeneration + 1;
        this.watcherGeneration = generation;
        this.watcherLastAttemptAt = this.now();
        this.watcherError = null;
        this.watcherState = "starting";
        try {
            const watcher = this.watcherAdapter.open({
                workspaceRoot: this.workspaceRoot,
                onEvent: (event) => this.handleWatcherEvent(generation, event),
                onError: (error) => this.failWatcher(generation, error),
            });
            this.watcher = watcher;
            void watcher.ready.then(
                () => {
                    if (
                        this.lifecycleState === "running"
                        && this.watcherGeneration === generation
                        && this.watcher === watcher
                        && this.watcherState === "starting"
                    ) {
                        this.watcherState = "ready";
                        this.watcherError = null;
                    }
                },
                (error: unknown) => this.failWatcher(generation, error),
            );
        } catch (error) {
            this.failWatcher(generation, error);
        }
    }

    /** watcher错误只降级实时收敛能力；TTL读取仍是最终兜底。 */
    private failWatcher(generation: number, error: unknown): void {
        if (this.lifecycleState !== "running" || this.watcherGeneration !== generation) {
            return;
        }
        this.watcherState = "failed";
        if (this.watcherClosePromise) {
            return;
        }
        this.watcherError = freezeDiagnosticError(error);
        const watcher = this.watcher;
        if (watcher) {
            const closePromise = watcher.close();
            this.watcherClosePromise = closePromise;
            this.startBackground(closePromise.then(
                () => {
                    if (this.watcher === watcher) {
                        this.watcher = null;
                        this.watcherClosePromise = null;
                    }
                },
                (closeError: unknown) => {
                    if (this.watcher === watcher) {
                        this.watcherError = freezeDiagnosticError(closeError);
                    }
                    throw closeError;
                },
            ));
        }
    }

    /** 接受有限浅事件、同步失效当前cache generation并重置单个debounce。 */
    private handleWatcherEvent(generation: number, event: ProjectLifecycleWatchEvent): void {
        if (
            this.lifecycleState !== "running"
            || this.watcherGeneration !== generation
            || (this.watcherState !== "starting" && this.watcherState !== "ready")
            || !isRelevantProjectLifecycleWatchEvent(this.workspaceRoot, event)
        ) {
            return;
        }
        this.invalidationGeneration += 1;
        if (this.watchDebounceTimer) {
            clearTimeout(this.watchDebounceTimer);
        }
        this.watchDebounceTimer = setTimeout(() => {
            this.watchDebounceTimer = null;
            if (this.lifecycleState !== "running") {
                return;
            }
            const refresh = this.runOperation(async (operation) => {
                await this.readState(operation);
                while (this.cachedInvalidationGeneration !== this.invalidationGeneration) {
                    operation.assertActive();
                    await this.readState(operation);
                }
            });
            void refresh.catch(() => undefined);
        }, this.watchDebounceMs);
    }

    /** 关闭Lifecycle：先拒绝新操作、abort并等待当前generation全部in-flight收口。 */
    close(): Promise<void> {
        if (this.closePromise) {
            return this.closePromise;
        }
        this.lifecycleState = "closing";
        this.abortController.abort();
        this.watcherGeneration += 1;
        if (this.watchDebounceTimer) {
            clearTimeout(this.watchDebounceTimer);
            this.watchDebounceTimer = null;
        }
        const watcher = this.watcher;
        const watcherClosePromise = this.watcherClosePromise;
        this.cachedState = null;
        this.cachePublishedAt = null;
        this.workspaceObservers.clear();
        this.closePromise = (async () => {
            let watcherCloseError: unknown;
            try {
                if (watcherClosePromise) {
                    await watcherClosePromise;
                } else {
                    await watcher?.close();
                }
                if (this.watcher === watcher) {
                    this.watcher = null;
                    this.watcherClosePromise = null;
                }
            } catch (error) {
                watcherCloseError = error;
                this.watcherError = freezeDiagnosticError(error);
            }
            while (this.inFlight.size > 0) {
                await Promise.allSettled([...this.inFlight]);
            }
            this.cachedState = null;
            this.cachePublishedAt = null;
            this.readInFlight = null;
            this.lifecycleState = "closed";
            this.watcherState = watcherCloseError ? "failed" : "closed";
            if (watcherCloseError) {
                throw watcherCloseError;
            }
        })();
        return this.closePromise;
    }

    /** 读取或重建 Project discovery state，并对并发读取去重。 */
    private async readState(operation: LifecycleOperationContext): Promise<ProjectDiscoveryState> {
        operation.assertActive();
        const freshState = this.freshCachedState();
        if (freshState) {
            return freshState;
        }
        if (this.readInFlight) {
            return this.readInFlight;
        }
        let trackedPromise: Promise<ProjectDiscoveryState>;
        const scanPromise = this.readStateWithMutation(operation);
        trackedPromise = scanPromise.finally(() => {
            if (this.readInFlight === trackedPromise) {
                this.readInFlight = null;
            }
        });
        this.readInFlight = trackedPromise;
        return trackedPromise;
    }

    /** cache miss临时取得Workspace mutation，避免读取其他协作事务的provisional root。 */
    private async readStateWithMutation(operation: LifecycleOperationContext): Promise<ProjectDiscoveryState> {
        let pendingMutation: WorkspaceMutationHandle | null;
        try {
            pendingMutation = await this.lockModule.acquireMutation();
        } catch (error) {
            this.lastRefreshReason = this.readRefreshReason();
            this.lastRefreshAt = this.now();
            this.lastRefreshError = freezeDiagnosticError(error);
            throw error;
        }
        try {
            operation.assertActive();
            const freshState = this.freshCachedState();
            const state = freshState ?? await this.rebuildState(
                operation,
                undefined,
                pendingMutation,
                this.readRefreshReason(),
            );
            const releasingMutation = pendingMutation;
            pendingMutation = null;
            try {
                await releasingMutation.release();
            } catch (error) {
                this.lastRefreshError = freezeDiagnosticError(error);
                throw error;
            }
            return state;
        } catch (error) {
            return await throwAfterLockRelease(error, pendingMutation, null);
        }
    }

    /** TTL只从成功发布时间计算；普通cache hit不续期，也不建立周期timer。 */
    private freshCachedState(): ProjectDiscoveryState | null {
        if (
            !this.cachedState
            || this.cachePublishedAt === null
            || this.cachedInvalidationGeneration !== this.invalidationGeneration
        ) {
            return null;
        }
        return this.now() - this.cachePublishedAt < this.snapshotTtlMs ? this.cachedState : null;
    }

    /** diagnostics按当前时钟同步投影cache状态；读取本身不续期也不触发扫描。 */
    private cacheDiagnosticState(): ProjectLifecycleDiagnostics["cache"]["state"] {
        if (!this.cachedState || this.cachePublishedAt === null) {
            return "empty";
        }
        return this.freshCachedState() ? "fresh" : "expired";
    }

    /** cache miss按是否首次、watcher失效或TTL到期分类，供diagnostics解释本次扫描。 */
    private readRefreshReason(): Exclude<ProjectLifecycleRefreshReason, "mutation"> {
        if (!this.cachedState) {
            return "initial-read";
        }
        return this.cachedInvalidationGeneration !== this.invalidationGeneration ? "watcher" : "ttl";
    }

    /** 执行一次只读一级扫描，并同时生成 Project、candidate 与单调 revision。 */
    private async scan(operation: LifecycleOperationContext): Promise<ProjectDiscoveryScan> {
        const entries = await fs.readdir(this.workspaceRoot, {withFileTypes: true});
        operation.assertActive();
        const projects: ProjectListEntry[] = [];
        const candidates: ProjectCandidate[] = [];
        const discoveryIssues: ProjectDiscoveryIssue[] = [];
        const collisionIssueKeys = new Set<string>();
        const directoryNames = entries
            .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
            .map((entry) => entry.name);

        for (const entry of entries) {
            operation.assertActive();
            if (entry.name.toLocaleLowerCase("en-US") === ".nbook") {
                continue;
            }
            if (entry.isSymbolicLink()) {
                try {
                    discoveryIssues.push({
                        kind: "unsafe-root",
                        projectRoot: projectWorkspaceRef(entry.name).projectRoot,
                        code: "PROJECT_ROOT_LINK_UNSUPPORTED",
                    });
                } catch (error) {
                    if (!isProjectLifecycleError(error) || error.code !== "INVALID_PROJECT_ROOT") {
                        throw error;
                    }
                }
                continue;
            }
            if (!entry.isDirectory()) {
                continue;
            }
            let resolved: ResolvedProjectWorkspace;
            try {
                resolved = await this.resolveWithin(projectWorkspaceRef(entry.name), operation, directoryNames);
            } catch (error) {
                operation.assertActive();
                if (isProjectRootCaseCollisionError(error)) {
                    const collisionKey = error.projectRoots.join("\0");
                    if (!collisionIssueKeys.has(collisionKey)) {
                        collisionIssueKeys.add(collisionKey);
                        discoveryIssues.push({
                            kind: "case-collision",
                            projectRoots: error.projectRoots,
                            code: "PROJECT_ROOT_CASE_COLLISION",
                        });
                    }
                    continue;
                }
                if (isIgnorableDiscoveryRootError(error)) {
                    if (
                        isProjectLifecycleError(error)
                        && (error.code === "PROJECT_ROOT_LINK_UNSUPPORTED" || error.code === "PROJECT_ROOT_REPLACED")
                    ) {
                        discoveryIssues.push({
                            kind: "unsafe-root",
                            projectRoot: projectWorkspaceRef(entry.name).projectRoot,
                            code: error.code,
                        });
                    }
                    continue;
                }
                throw error;
            }
            const {projectRoot} = resolved.ref;
            const manifest = await this.manifestPersistence.inspect(resolved);
            operation.assertActive();
            await this.rootIdentity.revalidate(resolved);
            operation.assertActive();
            if (manifest.status === "valid") {
                projects.push(projectEntry(resolved.ref, manifest));
                continue;
            }
            if (manifest.status === "repairable") {
                candidates.push(resolved.ref);
                continue;
            }
            discoveryIssues.push({
                kind: "unsafe-manifest",
                projectRoot,
                code: manifest.error.code,
            });
        }

        projects.sort((left, right) => {
            const updatedOrder = (right.manifestUpdatedAt ?? "").localeCompare(left.manifestUpdatedAt ?? "");
            return updatedOrder || left.projectRoot.localeCompare(right.projectRoot);
        });
        candidates.sort((left, right) => left.projectRoot.localeCompare(right.projectRoot));
        discoveryIssues.sort((left, right) => (
            discoveryIssueSortKey(left).localeCompare(discoveryIssueSortKey(right))
        ));
        return {
            projects,
            candidates,
            discoveryIssues: discoveryIssues.slice(0, PROJECT_DISCOVERY_ISSUE_LIMIT),
            omittedDiscoveryIssueCount: Math.max(0, discoveryIssues.length - PROJECT_DISCOVERY_ISSUE_LIMIT),
        };
    }

    /**
     * 强制构建并原子发布新snapshot；扫描/门禁失败时保留上一份cache与revision。
     *
     * 没有旧cache的并发reader共享本次refresh；已有cache的reader在事务提交前仍可读取旧事实。
     */
    private async refreshState(
        operation: LifecycleOperationContext,
        beforeCommit: LifecycleCommitGate,
        mutation: WorkspaceMutationHandle,
    ): Promise<ProjectDiscoveryState> {
        return this.rebuildState(operation, beforeCommit, mutation, "mutation");
    }

    /** mutation单写者完成scan与异步gate后，同步翻转revision/cache。 */
    private async rebuildState(
        operation: LifecycleOperationContext,
        beforeCommit: LifecycleCommitGate | undefined,
        mutation: WorkspaceMutationHandle,
        reason: ProjectLifecycleRefreshReason,
    ): Promise<ProjectDiscoveryState> {
        this.lastRefreshReason = reason;
        this.lastRefreshAt = this.now();
        this.lastRefreshError = null;
        try {
            operation.assertActive();
            mutation.assertHealthy();
            let invalidationGeneration: number;
            let scan: ProjectDiscoveryScan;
            do {
                invalidationGeneration = this.invalidationGeneration;
                scan = await this.scan(operation);
                operation.assertActive();
                mutation.assertHealthy();
            } while (
                reason !== "mutation"
                && invalidationGeneration !== this.invalidationGeneration
            );
            const state = freezeDiscoveryState({
                revision: this.revision + 1,
                projects: scan.projects,
                candidates: scan.candidates,
                discoveryIssues: scan.discoveryIssues,
                omittedDiscoveryIssueCount: scan.omittedDiscoveryIssueCount,
            });
            if (beforeCommit) {
                await beforeCommit();
            }
            operation.assertActive();
            mutation.assertHealthy();
            this.revision = state.revision;
            this.cachedState = state;
            this.cachedInvalidationGeneration = invalidationGeneration;
            this.cachePublishedAt = this.now();
            this.diagnosticsSnapshot = freezeLifecycleDiagnostics(
                state,
                this.cleanupIssues,
                this.omittedCleanupIssueCount,
            );
            await this.notifyReplacedWorkspaces();
            return state;
        } catch (error) {
            this.lastRefreshError = freezeDiagnosticError(error);
            throw error;
        }
    }

    /** 用Root Identity已有fingerprint复核全部open generation，不建立per-Project watcher。 */
    private async notifyReplacedWorkspaces(): Promise<void> {
        for (const [workspace, observers] of [...this.workspaceObservers]) {
            try {
                await this.rootIdentity.revalidate(workspace);
            } catch (error) {
                if (!isProjectLifecycleError(error) || error.code !== "PROJECT_ROOT_REPLACED") {
                    continue;
                }
                this.workspaceObservers.delete(workspace);
                for (const observer of observers) {
                    try {
                        observer();
                    } catch {
                        // Session通知失败不能回滚已经提交的磁盘snapshot；Runtime仍有Occupancy compromise兜底。
                    }
                }
            }
        }
    }

    /** 构造manifest/snapshot提交共用的Lifecycle、lock与root健康门禁。 */
    private commitGate(
        operation: LifecycleOperationContext,
        workspace: ResolvedProjectWorkspace,
        mutation?: WorkspaceMutationHandle,
        occupancy?: ProjectOccupancyHandle,
    ): LifecycleCommitGate {
        return async () => {
            operation.assertActive();
            mutation?.assertHealthy();
            occupancy?.assertHealthy();
            await this.rootIdentity.revalidate(workspace);
            operation.assertActive();
            mutation?.assertHealthy();
            occupancy?.assertHealthy();
        };
    }

    /** 构造不再依赖已移动root的Lifecycle/lock提交门禁。 */
    private transactionCommitGate(
        operation: LifecycleOperationContext,
        mutation: WorkspaceMutationHandle,
        occupancy: ProjectOccupancyHandle,
    ): LifecycleCommitGate {
        return async () => {
            operation.assertActive();
            mutation.assertHealthy();
            occupancy.assertHealthy();
        };
    }

    /** 强制从 mutation 后的新 generation 发布目标 Project，并返回同一 snapshot 中的 entry。 */
    private async publishEnsuredProject(
        projectRoot: WorkspaceRelativePath,
        operation: LifecycleOperationContext,
        commitGate: LifecycleCommitGate,
        mutation: WorkspaceMutationHandle,
    ): Promise<{readonly revision: number; readonly project: ProjectListEntry}> {
        await commitGate();
        const state = await this.refreshState(operation, commitGate, mutation);
        // readState在beforeCommit门禁后同步翻转revision/cache；返回即表示snapshot已经提交。
        const project = state.projects.find((entry) => entry.projectRoot === projectRoot);
        if (!project) {
            throw new Error(`ensure 后未能发布 Project：${projectRoot}`);
        }
        return {revision: state.revision, project};
    }

    /** 登记一个公开Lifecycle operation，供close统一abort与等待。 */
    private runOperation<Pending, Result = Pending>(
        execute: (operation: LifecycleOperationContext) => Promise<Pending>,
        completion?: LifecycleOperationCompletion<Pending, Result>,
    ): Promise<Result> {
        this.assertRunning();
        const operation: LifecycleOperationContext = {
            signal: this.abortController.signal,
            assertActive: () => this.assertOperationActive(),
        };
        const result = (async () => {
            operation.assertActive();
            const value = await execute(operation);
            try {
                if (!completion || completion.kind === "handoff") {
                    operation.assertActive();
                }
                return completion ? completion.commit(value) : value as Result;
            } catch (error) {
                if (completion?.kind === "handoff") {
                    return completion.abort(value, error);
                }
                throw error;
            }
        })();
        const trackedCompletion = result.then(
            () => undefined,
            () => undefined,
        );
        this.trackInFlight(trackedCompletion);
        return result;
    }

    /** 登记不阻塞durable结果、但必须在Lifecycle close前收口的后台任务。 */
    private startBackground(task: Promise<void>): void {
        this.trackInFlight(task.then(
            () => undefined,
            () => undefined,
        ));
    }

    /** 把公开operation或generation-scoped后台任务纳入统一close等待集合。 */
    private trackInFlight(completion: Promise<void>): void {
        this.inFlight.add(completion);
        void completion.finally(() => {
            this.inFlight.delete(completion);
        });
    }

    /** Lifecycle只在running状态接受新的公开operation。 */
    private assertRunning(): void {
        if (this.lifecycleState !== "running") {
            throw lifecycleClosedError();
        }
    }

    /** 所有不可取消I/O返回后与状态提交前都调用同一门禁。 */
    private assertOperationActive(): void {
        if (this.lifecycleState !== "running" || this.abortController.signal.aborted) {
            throw lifecycleClosedError();
        }
    }
}

/** 浅扫描只忽略明确的domain-invalid/transient root；真实I/O必须上抛。 */
function isIgnorableDiscoveryRootError(error: unknown): boolean {
    return isProjectLifecycleError(error) && (
        error.code === "INVALID_PROJECT_ROOT"
        || error.code === "PROJECT_NOT_FOUND"
        || error.code === "PROJECT_ROOT_LINK_UNSUPPORTED"
        || error.code === "PROJECT_ROOT_CASE_COLLISION"
        || error.code === "PROJECT_ROOT_REPLACED"
    );
}

/** 判断resolve失败是否仅表示目标Project root尚不存在。 */
function isProjectNotFoundError(error: unknown): error is ProjectLifecycleError {
    return isProjectLifecycleError(error) && error.code === "PROJECT_NOT_FOUND";
}

/** Staging事务使用的存在性检查；除ENOENT外的真实I/O继续上抛。 */
async function transactionPathExists(
    targetPath: string,
    adapter: ProjectManifestAdapter,
): Promise<boolean> {
    try {
        await adapter.access(targetPath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

/** Lifecycle closing/closed统一返回稳定typed failure。 */
function lifecycleClosedError(): ProjectLifecycleError {
    return new ProjectLifecycleError(
        "PROJECT_LIFECYCLE_CLOSED",
        "Project Lifecycle 正在关闭或已经关闭",
    );
}

/** 按依赖逆序释放成功取得的Project锁；任一失败都向调用方报告。 */
async function releaseProjectLocks(
    mutation: WorkspaceMutationHandle,
    occupancy: ProjectOccupancyHandle | null,
): Promise<void> {
    const errors: unknown[] = [];
    if (occupancy) {
        try {
            await occupancy.release();
        } catch (error) {
            errors.push(error);
        }
    }
    try {
        await mutation.release();
    } catch (error) {
        errors.push(error);
    }
    if (errors.length === 1) {
        throw errors[0];
    }
    if (errors.length > 1) {
        throwReleaseFailureOrAggregate(errors, "释放Project mutation/Occupancy锁失败");
    }
}

/** 保留原始失败并在抛出前尽力释放已取得的锁。 */
async function throwAfterLockRelease(
    cause: unknown,
    mutation: WorkspaceMutationHandle | null,
    occupancy: ProjectOccupancyHandle | null,
    operation?: ProjectLifecycleOperation,
): Promise<never> {
    const errors: unknown[] = [cause];
    if (occupancy) {
        try {
            await occupancy.release();
        } catch (error) {
            errors.push(error);
        }
    }
    if (mutation) {
        try {
            await mutation.release();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length === 1) {
        throw cause;
    }
    throwReleaseFailureOrAggregate(
        errors,
        "Project lifecycle操作失败且锁释放不完整",
        operation ? {operation, committed: committedState(cause)} : undefined,
    );
}

/** release failure存在时保留typed顶层code；否则退回普通AggregateError。 */
function throwReleaseFailureOrAggregate(
    errors: readonly unknown[],
    message: string,
    lifecycle?: {
        readonly operation: ProjectLifecycleOperation;
        readonly committed: boolean | "unknown";
    },
): never {
    const releaseFailure = errors.find(
        (error): error is ProjectLockReleaseFailedError => isProjectLockReleaseFailedError(error),
    );
    if (!releaseFailure) {
        throw new AggregateError(errors, message);
    }
    const wrapped = new ProjectLockReleaseFailedError(
        projectLockContext(releaseFailure),
        new AggregateError(errors, message),
    );
    if (lifecycle) {
        throw new ProjectLifecycleLockReleaseFailedError(
            lifecycle.operation,
            lifecycle.committed,
            wrapped,
        );
    }
    throw wrapped;
}

/** 从原始事务失败恢复锁释放错误需要携带的durable completion状态。 */
function committedState(cause: unknown): boolean | "unknown" {
    return isProjectLifecycleTransactionError(cause) ? cause.committed : false;
}

/** durable结果已提交后把Lock release failure补全为可判定事务结果。 */
function throwCommittedLockReleaseFailure(
    operation: ProjectLifecycleOperation,
    error: unknown,
): never {
    if (isProjectLockReleaseFailedError(error)) {
        throw new ProjectLifecycleLockReleaseFailedError(operation, true, error);
    }
    throw new ProjectLifecycleTransactionError(
        "PROJECT_PUBLISH_FAILED",
        operation,
        "release",
        true,
        `${operation}已经提交，但锁释放失败`,
        error,
    );
}

/** 从typed release failure恢复其原始锁上下文。 */
function projectLockContext(failure: ProjectLockReleaseFailedError): ProjectLockContext {
    return failure.kind === "project-occupancy"
        ? {kind: "project-occupancy", projectRoot: failure.projectRoot!}
        : {kind: "workspace-mutation"};
}

/** 冻结 snapshot entry 集合，防止调用方污染 Lifecycle 内部 cache。 */
function freezeDiscoveryState(state: ProjectDiscoveryState): ProjectDiscoveryState {
    return Object.freeze({
        revision: state.revision,
        projects: Object.freeze([...state.projects]),
        candidates: Object.freeze([...state.candidates]),
        discoveryIssues: Object.freeze(state.discoveryIssues.map(freezeDiscoveryIssue)),
        omittedDiscoveryIssueCount: state.omittedDiscoveryIssueCount,
    });
}

/** 从已冻结的discovery state发布独立只读diagnostics对象。 */
function freezeLifecycleDiagnostics(
    state: ProjectDiscoveryState,
    cleanupIssues: readonly ProjectCleanupIssue[],
    omittedCleanupIssueCount: number,
): ProjectLifecycleDiagnosticsSnapshot {
    return Object.freeze({
        revision: state.revision,
        discoveryIssues: state.discoveryIssues,
        omittedDiscoveryIssueCount: state.omittedDiscoveryIssueCount,
        cleanupIssues,
        omittedCleanupIssueCount,
    });
}

/** 深冻结单条discovery issue，避免collision成员数组被调用方污染。 */
function freezeDiscoveryIssue(issue: ProjectDiscoveryIssue): ProjectDiscoveryIssue {
    if (issue.kind === "case-collision") {
        return Object.freeze({
            ...issue,
            projectRoots: Object.freeze([...issue.projectRoots]),
        });
    }
    return Object.freeze({...issue});
}

/** 为不同issue形状生成稳定排序key。 */
function discoveryIssueSortKey(issue: ProjectDiscoveryIssue): string {
    return issue.kind === "case-collision"
        ? `${issue.kind}:${issue.projectRoots.join("\0")}`
        : `${issue.kind}:${issue.projectRoot}`;
}

/** 把内部构造的token路径转成不含Workspace Root绝对位置的diagnostic路径。 */
function cleanupRelativePath(
    workspaceRoot: AbsoluteFsPath,
    transactionRoot: AbsoluteFsPath,
): WorkspaceRelativePath {
    return path.relative(workspaceRoot, transactionRoot).replaceAll(path.sep, "/") as WorkspaceRelativePath;
}

/** 从Error cause链提取最底层系统错误码；Project领域code不重复写入systemCode。 */
function diagnosticSystemCode(error: unknown, seen = new Set<object>()): string | undefined {
    if (typeof error !== "object" || error === null || seen.has(error)) {
        return undefined;
    }
    seen.add(error);
    if ("cause" in error) {
        const causeCode = diagnosticSystemCode(error.cause, seen);
        if (causeCode) {
            return causeCode;
        }
    }
    if (
        "code" in error
        && typeof error.code === "string"
        && !error.code.startsWith("PROJECT_")
    ) {
        return error.code;
    }
    return undefined;
}

/** 把任意运行时错误冻结为diagnostics可安全读取的code/message摘要。 */
function freezeDiagnosticError(error: unknown): ProjectLifecycleDiagnosticError {
    const code = typeof error === "object"
        && error !== null
        && "code" in error
        && typeof error.code === "string"
        ? error.code
        : error instanceof Error
            ? error.name
            : "UNKNOWN";
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({code, message});
}

/** 收窄chokidar的all事件，只保留Lifecycle定义的五类文件系统变化。 */
function isProjectLifecycleWatchEventKind(kind: string): kind is ProjectLifecycleWatchEvent["kind"] {
    return kind === "add"
        || kind === "addDir"
        || kind === "change"
        || kind === "unlink"
        || kind === "unlinkDir";
}

/** watcher只接受一级目录或一级目录直属project.yaml事件。 */
function isRelevantProjectLifecycleWatchEvent(
    workspaceRoot: AbsoluteFsPath,
    event: ProjectLifecycleWatchEvent,
): boolean {
    const absolutePath = path.isAbsolute(event.path)
        ? event.path
        : path.resolve(workspaceRoot, event.path);
    const relativePath = path.relative(workspaceRoot, absolutePath);
    if (
        relativePath === ""
        || relativePath === ".."
        || relativePath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativePath)
    ) {
        return false;
    }
    const segments = relativePath.split(path.sep);
    if (segments[0]?.toLocaleLowerCase("en-US") === ".nbook") {
        return false;
    }
    if (event.kind === "addDir" || event.kind === "unlinkDir") {
        return segments.length === 1;
    }
    return segments.length === 2 && segments[1] === "project.yaml";
}

/** 构造私有ensure提交并在类型/运行时同时约束recovery与change关系。 */
function projectEnsureCommit(
    revision: number,
    project: ProjectListEntry,
    workspace: ResolvedProjectWorkspace,
    change: ProjectManifestChange,
    recoveryPath?: WorkspaceRelativePath,
): ProjectEnsureCommit {
    if (change === "updated") {
        throw new Error("ensure不得返回metadata update专用change");
    }
    if (change === "normalized" || change === "recovered") {
        if (!recoveryPath) {
            throw new Error(`${change} ensure缺少manifest recoveryPath`);
        }
        return Object.freeze({revision, project, workspace, change, recoveryPath});
    }
    return Object.freeze({revision, project, workspace, change});
}

/** 从私有提交逐字段投影普通ensure公开结果，防止未来字段通过对象spread泄漏。 */
function projectEnsureResult(commit: ProjectEnsureCommit): ProjectEnsureResult {
    if (commit.change === "normalized" || commit.change === "recovered") {
        return Object.freeze({
            revision: commit.revision,
            project: commit.project,
            change: commit.change,
            recoveryPath: commit.recoveryPath,
        });
    }
    return Object.freeze({
        revision: commit.revision,
        project: commit.project,
        change: commit.change,
    });
}

/** prepareOpen只显式增加workspace与Occupancy，不传播其他Lifecycle私有字段。 */
function preparedProjectOpen(
    workspaceRoot: AbsoluteFsPath,
    commit: ProjectEnsureCommit,
    occupancy: ProjectOccupancyHandle,
): PreparedProjectOpen {
    if (commit.change === "normalized" || commit.change === "recovered") {
        return Object.freeze({
            revision: commit.revision,
            project: commit.project,
            change: commit.change,
            recoveryPath: commit.recoveryPath,
            workspaceRoot,
            workspace: commit.workspace,
            occupancy,
        } satisfies PreparedProjectOpen);
    }
    return Object.freeze({
        revision: commit.revision,
        project: commit.project,
        change: commit.change,
        workspaceRoot,
        workspace: commit.workspace,
        occupancy,
    } satisfies PreparedProjectOpen);
}

/** 构造一个只含公开 manifest metadata 的 Project snapshot entry。 */
function projectEntry(
    ref: ProjectWorkspaceRef,
    inspection: Extract<ProjectManifestInspection, {readonly status: "valid"}>,
): ProjectListEntry {
    return Object.freeze({
        projectRoot: ref.projectRoot,
        ...inspection.manifest,
        manifestUpdatedAt: inspection.manifestUpdatedAt,
    }) as ProjectListEntry;
}
