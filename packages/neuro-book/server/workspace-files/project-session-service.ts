import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    canonicalProjectLocator,
    type ResolvedProjectWorkspace,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {
    type ProjectCandidateSnapshot,
    type ProjectCoverUpdateInput,
    type ProjectCoverUpdateResult,
    type ProjectCreateInput,
    type ProjectCreateResult,
    type ProjectDeleteResult,
    type ProjectEnsureResult,
    type ProjectListSnapshot,
    type ProjectMetadataAccess,
    type ProjectMetadataUpdateInput,
    type ProjectMetadataUpdateResult,
    type PreparedProjectOpen,
} from "nbook/server/workspace-files/project-lifecycle";
import type {
    ProjectModuleHandle,
    ProjectModuleToken,
} from "nbook/server/workspace-files/project-module";
import {ProjectInUseError} from "nbook/server/workspace-files/project-lock";
import {
    isProjectNotReadyError,
    ProjectSessionRuntime,
    ProjectSessionRuntimeClosedError,
    type ProjectSessionCloseReason,
    type ProjectSessionPresence,
    type ProjectUserPresence,
    type ProjectOperationStart,
    type ReadyProjectSessionRef,
} from "nbook/server/workspace-files/project-session-runtime";
import type {ProjectOpener} from "nbook/server/workspace-files/project-session-types";
import {
    isProjectDomainError,
    ProjectDomainError,
} from "nbook/server/workspace-files/project-domain-error";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
} from "nbook/server/workspace-files/project-file-index";

/** Project控制面端口；生产只注入composition root持有的唯一ProjectLifecycle。 */
export type ProjectControlLifecycle = {
    readProjects(): Promise<ProjectListSnapshot>;
    readCandidates(): Promise<ProjectCandidateSnapshot>;
    create(input: ProjectCreateInput): Promise<ProjectCreateResult>;
    updateMetadata(
        input: ProjectMetadataUpdateInput,
        access?: ProjectMetadataAccess,
    ): Promise<ProjectMetadataUpdateResult>;
    updateCover(
        input: ProjectCoverUpdateInput,
        access?: ProjectMetadataAccess,
    ): Promise<ProjectCoverUpdateResult>;
    delete(ref: ProjectWorkspaceRef): Promise<ProjectDeleteResult>;
    prepareOpen(ref: ProjectWorkspaceRef): Promise<PreparedProjectOpen>;
    /** 复核已发布workspace的物理root仍指向捕获时的目录；replacement通知必须是generation-scoped。 */
    revalidateWorkspace(workspace: ResolvedProjectWorkspace): Promise<void>;
    /** 观察同一Lifecycle捕获的物理root identity；replacement通知必须是generation-scoped。 */
    observeWorkspace(
        workspace: ResolvedProjectWorkspace,
        onReplaced: () => void,
    ): () => void;
    close(): Promise<void>;
};

/** ProjectSession Service进程依赖。 */
export type ProjectSessionServiceOptions = {
    readonly lifecycle: ProjectControlLifecycle;
    readonly runtime?: ProjectSessionRuntime;
};

/** 产品open同时返回Session精确generation与Lifecycle已发布的Project metadata。 */
export type ProjectControlOpenResult = {
    readonly ready: ReadyProjectSessionRef;
    readonly publication: ProjectEnsureResult;
};

/** ProjectSession控制面只读列表项；资源状态仍由Runtime独占。 */
export type ProjectSessionListEntry = ProjectSessionPresence & {
    readonly ref: ProjectWorkspaceRef;
};

/** Project尚未发布ready generation时的数据面错误。 */
export class ProjectNotOpenError extends ProjectDomainError {
    readonly code = "PROJECT_NOT_OPEN";
    readonly statusCode = 409;

    /** 保留稳定Project root供HTTP层返回。 */
    constructor(readonly projectRoot: string, options?: ErrorOptions) {
        super("session-not-open", `Project未打开：${projectRoot}`, options);
        this.name = "ProjectNotOpenError";
    }
}

/** HMR 后仍精确识别 Service 数据面未打开错误。 */
export function isProjectNotOpenError(error: unknown): error is ProjectNotOpenError {
    return isProjectDomainError(error, "session-not-open");
}

type ProjectServiceEntry = {
    maintenanceGates: Set<symbol>;
    terminalGates: Set<symbol>;
    /** Lifecycle 已观察到物理根被替换；已接纳操作的写入目标立即失效，不等控制面排空。 */
    targetInvalid: boolean;
    controlOperations: Set<Promise<void>>;
    handoffReady: Promise<void>;
    settleHandoff(): void;
    opening: Promise<ProjectControlOpenResult> | null;
    ready: ReadyProjectSessionRef | null;
    publication: ProjectEnsureResult | null;
    workspace: ResolvedProjectWorkspace | null;
    stopRootObservation: (() => void) | null;
};

/**
 * 组合Project Lifecycle与Session Runtime的进程内Facade。
 *
 * Lifecycle只负责把Occupancy所有权提交为PreparedProjectOpen；Runtime从adopt开始独占该handle。
 * locator Map只做同一Project的并发open去重，不保存Module资源或第二份生命周期状态。
 */
export class ProjectSessionService {
    private readonly lifecycle: ProjectControlLifecycle;
    private readonly runtime: ProjectSessionRuntime;
    private readonly entries = new Map<string, ProjectServiceEntry>();
    private state: "running" | "closing" | "closed" = "running";
    private closeAllPromise: Promise<void> | null = null;
    private lifecycleClosePromise: Promise<void> | null = null;

    /** 建立严格绑定单个Workspace Root的ProjectSession Service。 */
    constructor(
        private readonly workspaceRoot: AbsoluteFsPath,
        options: ProjectSessionServiceOptions,
    ) {
        this.lifecycle = options.lifecycle;
        this.runtime = options.runtime ?? new ProjectSessionRuntime();
    }

    /**
     * 幂等打开Project：并发调用共享同一prepare/adopt Promise；ready调用只恢复当前generation。
     */
    openProject(ref: ProjectWorkspaceRef, opener: ProjectOpener): Promise<ReadyProjectSessionRef> {
        return this.openProjectControl(ref, opener).then(({ready}) => ready);
    }

    /**
     * 产品控制面open：新generation携带prepareOpen publication，ready快速路径返回change=none。
     */
    openProjectControl(ref: ProjectWorkspaceRef, opener: ProjectOpener): Promise<ProjectControlOpenResult> {
        if (this.state !== "running") {
            return Promise.reject(new ProjectSessionRuntimeClosedError());
        }
        const locator = canonicalProjectLocator(this.workspaceRoot, ref);
        const existing = this.entries.get(locator);
        if (existing && existing.terminalGates.size > 0) {
            return Promise.reject(new ProjectNotOpenError(ref.projectRoot));
        }
        if (existing?.ready) {
            try {
                const ready = this.runtime.resumeReadyProject(existing.ready.workspace.key);
                if (!existing.publication) {
                    return Promise.reject(new ProjectNotOpenError(ref.projectRoot));
                }
                return Promise.resolve(Object.freeze({
                    ready,
                    publication: Object.freeze({
                        revision: existing.publication.revision,
                        project: existing.publication.project,
                        change: "none" as const,
                    }),
                }));
            } catch (error) {
                if (isProjectNotReadyError(error)) {
                    return Promise.reject(new ProjectNotOpenError(ref.projectRoot, {cause: error}));
                }
                return Promise.reject(error);
            }
        }
        if (existing?.opening) {
            return existing.opening;
        }
        if (existing) {
            return Promise.reject(new ProjectNotOpenError(ref.projectRoot));
        }

        let settleHandoff!: () => void;
        const handoffReady = new Promise<void>((resolve) => {
            settleHandoff = resolve;
        });
        const entry: ProjectServiceEntry = {
            maintenanceGates: new Set(),
            terminalGates: new Set(),
            targetInvalid: false,
            controlOperations: new Set(),
            handoffReady,
            settleHandoff,
            opening: null,
            ready: null,
            publication: null,
            workspace: null,
            stopRootObservation: null,
        };
        this.entries.set(locator, entry);
        const opening = this.lifecycle.prepareOpen(ref)
            .then((prepared) => {
                entry.workspace = prepared.workspace;
                entry.publication = projectPublication(prepared);
                const adopted = this.runtime.adoptPreparedProject(prepared, opener);
                entry.settleHandoff();
                entry.stopRootObservation = this.lifecycle.observeWorkspace(
                    prepared.workspace,
                    () => {
                        // 先同步失效写入目标，再排空：等锁中的 Storage 操作不能写已替换的根。
                        entry.targetInvalid = true;
                        void this.closeRootReplaced(locator, entry).catch(() => undefined);
                    },
                );
                return adopted;
            })
            .then((ready) => {
                entry.ready = ready;
                return Object.freeze({ready, publication: entry.publication!});
            })
            .catch((error: unknown) => {
                entry.settleHandoff();
                if (
                    this.entries.get(locator) === entry
                    && (!entry.workspace || !this.runtime.hasProjectGeneration(entry.workspace.key))
                ) {
                    this.removeEntry(locator, entry);
                }
                throw error;
            })
            .finally(() => {
                if (entry.opening === opening) {
                    entry.opening = null;
                }
            });
        entry.opening = opening;
        return opening;
    }

    /** 读取唯一Lifecycle维护的轻量Project snapshot，不访问任何Project Module。 */
    async listProjects(): Promise<ProjectListSnapshot> {
        if (this.state !== "running") {
            throw new ProjectSessionRuntimeClosedError();
        }
        const snapshot = await this.lifecycle.readProjects();
        for (const project of snapshot.projects) {
            const entry = this.entries.get(canonicalProjectLocator(this.workspaceRoot, project));
            if (
                entry?.ready
                && (!entry.publication || snapshot.revision >= entry.publication.revision)
            ) {
                entry.publication = Object.freeze({
                    revision: snapshot.revision,
                    project,
                    change: "none",
                });
            }
        }
        return snapshot;
    }

    /** 读取与Project列表同revision的一级候选目录投影。 */
    listCandidates(): Promise<ProjectCandidateSnapshot> {
        if (this.state !== "running") {
            return Promise.reject(new ProjectSessionRuntimeClosedError());
        }
        return this.lifecycle.readCandidates();
    }

    /** 通过唯一Lifecycle创建Project，不隐式打开Session。 */
    createProject(input: ProjectCreateInput): Promise<ProjectCreateResult> {
        if (this.state !== "running") {
            return Promise.reject(new ProjectSessionRuntimeClosedError());
        }
        return this.lifecycle.create(input);
    }

    /**
     * 更新Project metadata：ready generation借用其Occupancy；未运行Project由Lifecycle自行取得。
     */
    async updateProjectMetadata(input: ProjectMetadataUpdateInput): Promise<ProjectMetadataUpdateResult> {
        return this.updateProjectManifest(
            input.ref,
            (access) => this.lifecycle.updateMetadata(input, access),
        );
    }

    /** 更新 Project 封面，并复用 metadata mutation 的 Session generation 借用合同。 */
    async updateProjectCover(input: ProjectCoverUpdateInput): Promise<ProjectCoverUpdateResult> {
        return this.updateProjectManifest(
            input.ref,
            (access) => this.lifecycle.updateCover(input, access),
        );
    }

    /** 为 manifest mutation 选择 owned / borrowed Occupancy 并同步 ready publication。 */
    private async updateProjectManifest<TResult extends ProjectMetadataUpdateResult>(
        ref: ProjectWorkspaceRef,
        execute: (access: ProjectMetadataAccess) => Promise<TResult>,
    ): Promise<TResult> {
        if (this.state !== "running") {
            throw new ProjectSessionRuntimeClosedError();
        }
        const locator = canonicalProjectLocator(this.workspaceRoot, ref);
        let entry = this.entries.get(locator);
        if (entry?.opening && !entry.ready) {
            const openingEntry = entry;
            try {
                await entry.opening;
            } catch (error) {
                throw new ProjectNotOpenError(ref.projectRoot, {cause: error});
            }
            if (this.entries.get(locator) !== openingEntry) {
                throw new ProjectNotOpenError(ref.projectRoot);
            }
            entry = openingEntry;
        }
        const ready = entry?.ready;
        if (!entry) {
            return await execute({kind: "acquire"});
        }
        if (!ready) {
            throw new ProjectNotOpenError(ref.projectRoot);
        }
        if (entry.maintenanceGates.size > 0 || entry.terminalGates.size > 0) {
            throw new ProjectNotOpenError(ref.projectRoot);
        }
        const assertActive = () => {
            if (
                this.state !== "running"
                || this.entries.get(locator) !== entry
                || entry.ready !== ready
            ) {
                throw new ProjectNotOpenError(ref.projectRoot);
            }
            try {
                this.runtime.projectPresence(ready);
            } catch (error) {
                throw new ProjectNotOpenError(ref.projectRoot, {cause: error});
            }
        };
        assertActive();
        const fileIndex = this.requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN);
        const operation = fileIndex.mutate(() => {
            assertActive();
            return execute({
                kind: "borrowed",
                workspace: ready.workspace,
                assertActive,
            });
        });
        const completion = operation.then(() => undefined, () => undefined);
        entry.controlOperations.add(completion);
        try {
            const result = await operation;
            if (
                this.entries.get(locator) === entry
                && entry.ready === ready
                && (!entry.publication || result.revision >= entry.publication.revision)
            ) {
                entry.publication = Object.freeze({
                    revision: result.revision,
                    project: result.project,
                    change: "none",
                });
            }
            return result;
        } finally {
            entry.controlOperations.delete(completion);
        }
    }

    /** 删除已经关闭的Project；本方法不隐式关闭或等待任何Session generation。 */
    deleteProject(ref: ProjectWorkspaceRef): Promise<ProjectDeleteResult> {
        if (this.state !== "running") {
            return Promise.reject(new ProjectSessionRuntimeClosedError());
        }
        if (this.entries.has(canonicalProjectLocator(this.workspaceRoot, ref))) {
            return Promise.reject(new ProjectInUseError(
                ref.projectRoot,
                new Error("ProjectSession generation仍存在，必须先显式close成功"),
            ));
        }
        return this.lifecycle.delete(ref);
    }

    /** strict-open数据面只取得当前locator发布的精确ready generation。 */
    requireReadyProject(ref: ProjectWorkspaceRef): ReadyProjectSessionRef {
        const entry = this.entries.get(canonicalProjectLocator(this.workspaceRoot, ref));
        if (this.state !== "running" || !entry?.ready || entry.terminalGates.size > 0) {
            throw new ProjectNotOpenError(ref.projectRoot);
        }
        try {
            return this.runtime.requireReadyProject(entry.ready.workspace.key);
        } catch (error) {
            throw new ProjectNotOpenError(ref.projectRoot, {cause: error});
        }
    }

    /** 返回当前ready generation的presence只读快照。 */
    projectPresence(ref: ProjectWorkspaceRef): ProjectSessionPresence {
        return this.runtime.projectPresence(this.requireReadyProject(ref));
    }

    /**
     * 按浏览器持有的公开标识取得精确 ready generation。
     *
     * `ref` 只用于定位同一 Facade entry；标识与 entry 的 ready 对象必须精确相等，
     * 因此 close/reopen 后的旧标识、另一个 Project 的标识都拿不到新代次。
     */
    requireReadyProjectByPublicId(ref: ProjectWorkspaceRef, publicId: string): ReadyProjectSessionRef {
        const ready = this.state === "running" ? this.runtime.resolveReadyProject(publicId) : null;
        const entry = ready ? this.entries.get(canonicalProjectLocator(this.workspaceRoot, ref)) : undefined;
        if (!ready || !entry || entry.ready !== ready || entry.terminalGates.size > 0) {
            throw new ProjectNotOpenError(ref.projectRoot);
        }
        try {
            return this.runtime.requireReadyProject(ready.workspace.key);
        } catch (error) {
            throw new ProjectNotOpenError(ref.projectRoot, {cause: error});
        }
    }

    /** 为公开标识指定的精确 ready generation取得一路用户presence。 */
    acquireUserPresence(ref: ProjectWorkspaceRef, publicId: string): ProjectUserPresence {
        return this.runtime.acquireUserPresence(this.requireReadyProjectByPublicId(ref, publicId));
    }

    /** 注册按精确 ready generation 判断的 Agent presence 探针。 */
    registerAgentPresenceProbe(probe: ((session: ReadyProjectSessionRef) => boolean) | null): void {
        this.runtime.registerAgentPresenceProbe(probe);
    }

    /** 返回当前全部ready generation的presence投影。 */
    listOpenProjects(): ProjectSessionListEntry[] {
        if (this.state !== "running") {
            return [];
        }
        const result: ProjectSessionListEntry[] = [];
        for (const entry of this.entries.values()) {
            if (!entry.ready || entry.terminalGates.size > 0) {
                continue;
            }
            try {
                result.push(Object.freeze({
                    ref: entry.ready.workspace.ref,
                    ...this.runtime.projectPresence(entry.ready),
                }));
            } catch {
                // opening/closing generation不属于strict-open列表。
            }
        }
        return result;
    }

    /** 删除占用检查：未发布ready或已经closing时返回null。 */
    projectOccupancy(ref: ProjectWorkspaceRef): ProjectSessionPresence | null {
        const entry = this.entries.get(canonicalProjectLocator(this.workspaceRoot, ref));
        if (this.state !== "running" || !entry?.ready || entry.terminalGates.size > 0) {
            return null;
        }
        try {
            return this.runtime.projectPresence(entry.ready);
        } catch {
            return null;
        }
    }

    /** 刷新最近活动时间；未打开Project保持no-op。 */
    markProjectActivity(ref: ProjectWorkspaceRef): void {
        const entry = this.entries.get(canonicalProjectLocator(this.workspaceRoot, ref));
        if (this.state !== "running" || !entry?.ready || entry.terminalGates.size > 0) {
            return;
        }
        try {
            this.runtime.markProjectActivity(entry.ready);
        } catch {
            // closing generation不再接受活动更新。
        }
    }

    /** 执行presence/grace维护，并删除Runtime已完整关闭的Facade entries。 */
    async sweepProjectSessions(now?: number): Promise<ProjectWorkspaceRef[]> {
        const entries = [...this.entries.entries()].map(([locator, entry]) => ({
            locator,
            entry,
            gate: Symbol("project-session-sweep"),
        }));
        for (const {entry, gate} of entries) {
            entry.maintenanceGates.add(gate);
        }
        await Promise.all(entries.flatMap(({entry}) => [...entry.controlOperations]));
        let closed: ReadyProjectSessionRef[] = [];
        let sweepFailed = false;
        let sweepFailure: unknown;
        try {
            closed = await this.runtime.sweepProjectSessions(now);
        } catch (error) {
            sweepFailed = true;
            sweepFailure = error;
        } finally {
            for (const {locator, entry, gate} of entries) {
                if (this.entries.get(locator) === entry) {
                    entry.maintenanceGates.delete(gate);
                    if (entry.workspace && !this.runtime.hasProjectGeneration(entry.workspace.key)) {
                        this.removeEntry(locator, entry);
                    }
                }
            }
        }
        if (sweepFailed) {
            throw sweepFailure;
        }
        for (const session of closed) {
            const locator = canonicalProjectLocator(this.workspaceRoot, session.workspace.ref);
            const entry = this.entries.get(locator);
            if (entry?.ready === session) {
                this.removeEntry(locator, entry);
            }
        }
        return closed.map((session) => session.workspace.ref);
    }

    /** 从调用方已经捕获的精确 ready generation 取得 Module handle，拒绝 close/reopen 后的旧引用。 */
    requireReadyModuleHandle<THandle extends ProjectModuleHandle>(
        ready: ReadyProjectSessionRef,
        token: ProjectModuleToken<THandle>,
    ): THandle {
        return this.runtime.requireProjectModuleHandle(ready, token);
    }

    /**
     * 复核精确 ready generation 的 Occupancy 与 Project 物理目录仍可承载新的数据面操作。
     *
     * 已经 closing、已替换或被 Facade 移除的 generation 都不再返回，因此在核验与动作之间
     * 被关闭的 Project 不会让 Storage 在失效目标上继续建根或写盘。
     */
    async revalidateReadyProject(ready: ReadyProjectSessionRef): Promise<void> {
        const locator = canonicalProjectLocator(this.workspaceRoot, ready.workspace.ref);
        const entry = this.entries.get(locator);
        if (this.state !== "running" || !entry || entry.ready !== ready || entry.terminalGates.size > 0) {
            throw new ProjectNotOpenError(ready.workspace.ref.projectRoot);
        }
        try {
            this.runtime.projectPresence(ready);
        } catch (error) {
            throw new ProjectNotOpenError(ready.workspace.ref.projectRoot, {cause: error});
        }
        await this.lifecycle.revalidateWorkspace(ready.workspace);
    }

    /** 在调用方已经捕获的精确 ready generation 内激活 lazy Module。 */
    activateReadyProjectModule<THandle extends ProjectModuleHandle>(
        ready: ReadyProjectSessionRef,
        token: ProjectModuleToken<THandle>,
    ): Promise<THandle> {
        return this.runtime.activateProjectModule(ready, token);
    }

    /**
     * 在调用方已经捕获的精确ready generation登记一次数据面操作。
     * Service terminal gate先于Runtime close建立，因此root replacement/control close窗口也会fail closed。
     *
     * `assertTarget` 是同步目标核验；`revalidateTarget` 是副作用前的异步物理复核（Project 根身份）。
     * 后者不要求 Service 仍 open，普通关闭下已接纳操作仍能复核后收口。
     */
    runReadyProjectOperation<TResult>(
        ready: ReadyProjectSessionRef,
        operation: (
            signal: AbortSignal,
            assertTarget: () => void,
            revalidateTarget: () => Promise<void>,
        ) => Promise<TResult>,
    ): Promise<TResult> {
        const locator = canonicalProjectLocator(this.workspaceRoot, ready.workspace.ref);
        const entry = this.entries.get(locator);
        if (
            this.state !== "running"
            || !entry
            || entry.ready !== ready
            || entry.terminalGates.size > 0
        ) {
            return Promise.reject(new ProjectNotOpenError(ready.workspace.ref.projectRoot));
        }
        return this.runtime.runProjectOperation(ready, (signal) => operation(
            signal,
            this.projectTargetGuard(locator, entry, ready),
            this.projectTargetRevalidator(locator, entry, ready),
        )).catch((error: unknown) => {
            if (isProjectNotReadyError(error)) {
                throw new ProjectNotOpenError(ready.workspace.ref.projectRoot, {cause: error});
            }
            throw error;
        });
    }

    /**
     * 同步启动长生命周期数据面操作；result可立即返回，completion在terminal时才释放gate。
     * 两个目标核验能力与 `runReadyProjectOperation` 相同：同步归属检查 + 副作用前的异步物理复核。
     */
    startReadyProjectOperation<TResult>(
        ready: ReadyProjectSessionRef,
        start: (
            signal: AbortSignal,
            assertTarget: () => void,
            revalidateTarget: () => Promise<void>,
        ) => ProjectOperationStart<TResult>,
    ): TResult {
        const locator = canonicalProjectLocator(this.workspaceRoot, ready.workspace.ref);
        const entry = this.entries.get(locator);
        if (
            this.state !== "running"
            || !entry
            || entry.ready !== ready
            || entry.terminalGates.size > 0
        ) {
            throw new ProjectNotOpenError(ready.workspace.ref.projectRoot);
        }
        try {
            return this.runtime.startProjectOperation(ready, (signal) => start(
                signal,
                this.projectTargetGuard(locator, entry, ready),
                this.projectTargetRevalidator(locator, entry, ready),
            ));
        } catch (error) {
            if (isProjectNotReadyError(error)) {
                throw new ProjectNotOpenError(ready.workspace.ref.projectRoot, {cause: error});
            }
            throw error;
        }
    }

    /**
     * 已接纳数据面操作的同步写入目标核验能力。
     *
     * Service 归属（entry 与 ready）与 Runtime 精确世代、锁失效和根替换终止标记共同判定；关停是否
     * 已开始不改变结论，普通关闭与整体 shutdown 都必须让已接纳操作排空，新操作另由入口 gate 拒绝。
     */
    private projectTargetGuard(
        locator: string,
        entry: ProjectServiceEntry,
        ready: ReadyProjectSessionRef,
    ): () => void {
        return () => this.assertProjectTargetIdentity(locator, entry, ready);
    }

    /**
     * 已接纳数据面操作的异步物理复核能力。
     *
     * 与 `projectTargetGuard` 的分工：本能力补齐同步 guard 覆盖不到的物理目录检查，同样不看关停状态；
     * 它只对不再有效的目标失败，并在 Lifecycle 关闭后仍保留对原 root 的只读复核。
     */
    private projectTargetRevalidator(
        locator: string,
        entry: ProjectServiceEntry,
        ready: ReadyProjectSessionRef,
    ): () => Promise<void> {
        const guard = this.projectTargetGuard(locator, entry, ready);
        return async () => {
            guard();
            // Lifecycle 的 replacement 通知是异步且去抖的，只靠 entry.targetInvalid 会在这段窗口里写已替换的根。
            await this.lifecycle.revalidateWorkspace(ready.workspace);
        };
    }

    /** 精确世代归属与失效标记；不看 Service 状态与 terminal gate，普通关闭不因此阻断排空。 */
    private assertProjectTargetIdentity(
        locator: string,
        entry: ProjectServiceEntry,
        ready: ReadyProjectSessionRef,
    ): void {
        if (
            this.entries.get(locator) !== entry
            || entry.ready !== ready
            || entry.targetInvalid
        ) {
            throw new ProjectNotOpenError(ready.workspace.ref.projectRoot);
        }
        this.runtime.assertProjectOperationTarget(ready);
    }

    /**
     * 关闭locator当前generation；Runtime成功释放全部Module与Occupancy后才删除Facade entry。
     */
    async closeProject(ref: ProjectWorkspaceRef, reason: ProjectSessionCloseReason): Promise<void> {
        const locator = canonicalProjectLocator(this.workspaceRoot, ref);
        const entry = this.entries.get(locator);
        if (!entry) {
            return;
        }
        const controlGate = Symbol("project-session-close");
        entry.terminalGates.add(controlGate);
        await Promise.all([...entry.controlOperations]);
        let ready = entry.ready;
        if (!ready && entry.opening && !entry.workspace) {
            await entry.handoffReady;
            if (this.entries.get(locator) !== entry) {
                return;
            }
            ready = entry.ready;
        }
        if (!ready && entry.workspace) {
            await this.runtime.closeProjectGeneration(entry.workspace.key, reason);
            if (
                this.entries.get(locator) === entry
                && !this.runtime.hasProjectGeneration(entry.workspace.key)
            ) {
                this.removeEntry(locator, entry);
            }
            return;
        }
        if (!ready) {
            if (this.entries.get(locator) === entry) {
                entry.terminalGates.delete(controlGate);
            }
            return;
        }
        await this.runtime.closeProject(ready, reason);
        if (
            this.entries.get(locator) === entry
            && entry.ready === ready
            && !this.runtime.hasProjectGeneration(ready.workspace.key)
        ) {
            this.removeEntry(locator, entry);
        } else if (this.entries.get(locator) === entry) {
            entry.terminalGates.delete(controlGate);
        }
    }

    /**
     * 同步建立shutdown gate，先启动Lifecycle abort，再等待控制写与Runtime精确收口。
     * Module close可重试；Occupancy release与Lifecycle close失败是sticky，不重跑底层closure。
     */
    closeAll(): Promise<void> {
        if (this.closeAllPromise) {
            return this.closeAllPromise;
        }
        if (this.state === "closed") {
            return Promise.resolve();
        }
        this.state = "closing";
        const task = this.closeService().catch((error: unknown) => {
            if (this.closeAllPromise === task) {
                this.closeAllPromise = null;
            }
            throw error;
        });
        this.closeAllPromise = task;
        return task;
    }

    /** 收集Runtime与Lifecycle全部close failure，避免一侧失败遮蔽另一侧收口。 */
    private async closeService(): Promise<void> {
        if (!this.lifecycleClosePromise) {
            try {
                this.lifecycleClosePromise = this.lifecycle.close();
            } catch (error) {
                this.lifecycleClosePromise = Promise.reject(error);
            }
        }
        const lifecycleSettled = Promise.allSettled([this.lifecycleClosePromise]);
        await Promise.all([...this.entries.values()].flatMap((entry) => [...entry.controlOperations]));
        const results = [
            ...await Promise.allSettled([this.runtime.closeAll()]),
            ...await lifecycleSettled,
        ];
        const failures = results.flatMap((result) => result.status === "rejected"
            ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
            : []);
        if (failures.length > 0) {
            throw new AggregateError(failures, "ProjectSession Service关闭不完整");
        }
        this.entries.clear();
        this.state = "closed";
        this.closeAllPromise = null;
    }

    /** 外部root replacement必须先关闭Runtime精确generation，成功后才移除Facade locator。 */
    private async closeRootReplaced(locator: string, entry: ProjectServiceEntry): Promise<void> {
        if (this.entries.get(locator) !== entry || !entry.workspace) {
            return;
        }
        entry.terminalGates.add(Symbol("project-root-replaced"));
        await Promise.all([...entry.controlOperations]);
        await this.runtime.closeProjectGeneration(entry.workspace.key, "root-replaced");
        if (
            this.entries.get(locator) === entry
            && !this.runtime.hasProjectGeneration(entry.workspace.key)
        ) {
            this.removeEntry(locator, entry);
        }
    }

    /** 只移除调用generation自己的Facade entry与root observation。 */
    private removeEntry(locator: string, entry: ProjectServiceEntry): void {
        if (this.entries.get(locator) !== entry) {
            return;
        }
        entry.stopRootObservation?.();
        entry.stopRootObservation = null;
        this.entries.delete(locator);
    }
}

/** 从handoff对象复制只允许控制面发布的字段，避免泄漏Occupancy与绝对root。 */
function projectPublication(prepared: PreparedProjectOpen): ProjectEnsureResult {
    if (prepared.change === "normalized" || prepared.change === "recovered") {
        return Object.freeze({
            revision: prepared.revision,
            project: prepared.project,
            change: prepared.change,
            recoveryPath: prepared.recoveryPath,
        });
    }
    return Object.freeze({
        revision: prepared.revision,
        project: prepared.project,
        change: prepared.change,
    });
}
