import path from "node:path";
import {createRuntimeInstance} from "nbook/runtime/lifecycle/lifecycle";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
import {productProjectOwner} from "nbook/server/runtime/product-startup";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import type {ProjectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    ProjectLifecycle,
    type ProjectCandidateSnapshot,
    type ProjectCoverUpdateInput,
    type ProjectCoverUpdateResult,
    type ProjectCreateInput,
    type ProjectCreateResult,
    type ProjectDeleteResult,
    type ProjectListSnapshot,
    type ProjectMetadataUpdateInput,
    type ProjectMetadataUpdateResult,
} from "nbook/server/workspace-files/project-lifecycle";
import type {
    ProjectModuleHandle,
    ProjectModuleToken,
} from "nbook/server/workspace-files/project-module";
import {
    PROJECT_GRACE_MS,
    ProjectSessionRuntime,
    ProjectSessionRuntimeClosedError,
    type ProjectOperationStart,
    type ProjectSessionCloseReason,
    type ProjectUserPresence,
    type ReadyProjectSessionRef,
} from "nbook/server/workspace-files/project-session-runtime";
import {
    isProjectNotOpenError,
    ProjectNotOpenError,
    ProjectSessionService,
    type ProjectControlOpenResult,
} from "nbook/server/workspace-files/project-session-service";
import type {ProjectOpener} from "nbook/server/workspace-files/project-session-types";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {getWorkspaceRuntimeRootContextForTest, resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

// Production composition root：required与lazy descriptor在任何Project open前完成注册。
import "nbook/server/workspace-files/project-database-module";
import "nbook/server/workspace-history/project-history";
import "nbook/server/workspace-files/project-file-index";
import "nbook/server/plot/index";
import "nbook/server/agent/tools/agent-sql-project-module";
import "nbook/server/storage/project-storage-module";

export {
    isProductRuntimeNotReadyError,
    ProductRuntimeNotReadyError,
} from "nbook/server/runtime/product-startup";
export {isProjectNotOpenError, PROJECT_GRACE_MS, ProjectNotOpenError};
export type {ProjectOpener, ProjectOperationStart, ReadyProjectSessionRef};

const MAINTENANCE_INTERVAL_MS = 30_000;

type ProjectGeneration = {
    readonly scope: Scope;
    readonly ready: () => ReadyProjectSessionRef | null;
    readonly opening: () => Promise<ProjectControlOpenResult> | null;
    replacementPending: boolean;
    replacementClosed: boolean;
    setReady(ready: ReadyProjectSessionRef): void;
    setOpening(opening: Promise<ProjectControlOpenResult>): void;
    setCloseReason(reason: ProjectSessionCloseReason): void;
};

type ProjectOwner = {
    readonly root: Scope;
    service: ProjectSessionService | null;
    workspaceRoot: AbsoluteFsPath | null;
    compilerRoot: AbsoluteFsPath | null;
    agentProbe: ((session: ReadyProjectSessionRef) => boolean) | null;
    maintenanceTimer: ReturnType<typeof setInterval> | null;
    sweepInFlight: boolean;
    readonly generations: Map<string, ProjectGeneration>;
    closing: Promise<void> | null;
};
type ProjectOccupancySnapshot = {
    readonly state: "open" | "grace";
    readonly userConnections: number;
    readonly agentActive: boolean;
};

type OpenProjectSnapshot = ProjectOccupancySnapshot & {
    readonly projectRoot: string;
    readonly openedAt: string;
    readonly lastActivityAt: string;
};

let testOwner: ProjectOwner | null = null;
let activeOwner: ProjectOwner | null = null;
let pendingAgentProbe: ((session: ReadyProjectSessionRef) => boolean) | null = null;

function state(): ProjectOwner {
    const context = getWorkspaceRuntimeRootContextForTest();
    if (context?.workspaceRoot) {
        if (!testOwner) {
            const runtime = createRuntimeInstance({location: "server", instanceId: "project-test"});
            runtime.root.open();
            testOwner = createOwner(runtime.root);
        }
        if (testOwner.workspaceRoot && workspaceRootIdentity(testOwner.workspaceRoot) !== workspaceRootIdentity(absoluteFsPath(context.workspaceRoot))) {
            throw new Error("Project test owner仍绑定另一隔离 Workspace Root，必须先完整关闭");
        }
        return testOwner;
    }
    return productProjectOwner(createOwner);
}

function createOwner(root: Scope): ProjectOwner {
    const scope = root.createChild("project-owner");
    scope.open();
    const owner: ProjectOwner = {
        root: scope,
        service: null,
        workspaceRoot: null,
        compilerRoot: null,
        agentProbe: pendingAgentProbe,
        maintenanceTimer: null,
        sweepInFlight: false,
        generations: new Map(),
        closing: null,
    };
    activeOwner = owner;
    return owner;
}

/** Project generation 在 Application 子作用域接纳 opening，并由同一作用域负责最终释放。 */
async function withProjectService<T>(
    workspaceRoot: AbsoluteFsPath,
    operation: (service: ProjectSessionService) => Promise<T>,
): Promise<T> {
    const owner = state();
    if (owner.root.phase !== "available" || owner.closing) throw new ProjectSessionRuntimeClosedError();
    return operation(serviceFor(owner, workspaceRoot));
}

async function openProjectGeneration(ref: ProjectWorkspaceRef, opener: ProjectOpener, workspaceRoot: AbsoluteFsPath): Promise<ProjectControlOpenResult> {
    const owner = state();
    if (owner.root.phase !== "available" || owner.closing) throw new ProjectSessionRuntimeClosedError();
    const service = serviceFor(owner, workspaceRoot);
    let generation = owner.generations.get(ref.projectRoot);
    if (generation && (generation.scope.phase !== "available" || generation.replacementPending)) throw new ProjectSessionRuntimeClosedError();
    if (!generation) {
        const scope = owner.root.createChild(`project:${ref.projectRoot}`);
        let ready: ReadyProjectSessionRef | null = null;
        let opening: Promise<ProjectControlOpenResult> | null = null;
        let closeReason: ProjectSessionCloseReason = "shutdown";
        generation = {
            scope,
            ready: () => ready,
            opening: () => opening,
            replacementPending: false,
            replacementClosed: false,
            setReady: (value) => { ready = value; },
            setOpening: (value) => { opening ??= value; },
            setCloseReason: (reason) => { closeReason = reason; },
        };
        const captured = generation;
        scope.register({
            kind: "project-generation",
            label: ref.projectRoot,
            value: ref,
            release: async () => {
                if (owner.generations.get(ref.projectRoot) !== captured) return;
                if (!captured.replacementClosed) {
                    if (opening) {
                        try { ready = (await opening).ready; } catch { /* Failed opening retains its entry only if resources remain. */ }
                    }
                    if (ready) await service.closeReadyProject(ready, closeReason);
                    else if (opening) await service.closeOpeningProject(ref, opening, closeReason);
                }
                collectReleasedSqliteHandles({force: closeReason === "delete" || closeReason === "shutdown"});
            },
        });
        scope.open();
        owner.generations.set(ref.projectRoot, generation);
    }
    const captured = generation;
    try {
        const opened = service.openProjectControl(ref, opener);
        captured.setOpening(opened);
        const result = await opened;
        captured.setReady(result.ready);
        if (captured.scope.phase !== "available") throw new ProjectSessionRuntimeClosedError();
        return result;
    } catch (error) {
        if (captured.scope.phase === "available" && !captured.replacementPending && !service.projectOccupancy(ref)) {
            const closed = await captured.scope.close();
            if (closed.status === "closed" && owner.generations.get(ref.projectRoot) === captured) owner.generations.delete(ref.projectRoot);
        }
        throw error;
    }
}

/**
 * 打开结构化 Project ref。
 *
 * Facade 只接受 `ProjectWorkspaceRef`：字符串身份在 HTTP / CLI 入口一次性收窄，
 * 之后的调用链没有任何再次「从路径求根」的口子。
 */
export async function openProject(
    ref: ProjectWorkspaceRef,
    opener: ProjectOpener,
    workspaceRoot?: AbsoluteFsPath,
): Promise<ReadyProjectSessionRef> {
    const ready = (await openProjectGeneration(ref, opener, workspaceRoot ?? resolveRuntimeWorkspaceRoot())).ready;
    ensureMaintenanceTimer();
    return ready;
}

/** 产品控制面结构化open，同时返回最终Project publication与ready generation。 */
export async function openProjectControl(
    ref: ProjectWorkspaceRef,
    opener: ProjectOpener,
): Promise<ProjectControlOpenResult> {
    const result = await openProjectGeneration(ref, opener, resolveRuntimeWorkspaceRoot());
    ensureMaintenanceTimer();
    return result;
}

/** 读取唯一Lifecycle的轻量Project列表snapshot；测试与独立 Harness 可显式指定 Workspace Root。 */
export async function listProjects(workspaceRoot?: AbsoluteFsPath): Promise<ProjectListSnapshot> {
    return withProjectService(workspaceRoot ?? resolveRuntimeWorkspaceRoot(), (service) => service.listProjects());
}

/** 读取与Project列表同revision的一级候选目录。 */
export async function listProjectCandidates(): Promise<ProjectCandidateSnapshot> {
    return withProjectService(resolveRuntimeWorkspaceRoot(), (service) => service.listCandidates());
}

/** 通过唯一Lifecycle创建Project；创建不隐式打开Session。 */
export async function createProject(input: ProjectCreateInput): Promise<ProjectCreateResult> {
    return withProjectService(resolveRuntimeWorkspaceRoot(), (service) => service.createProject(input));
}

/** 通过唯一Service更新Project metadata，并自动选择borrowed或owned Occupancy。 */
export async function updateProjectMetadata(input: ProjectMetadataUpdateInput): Promise<ProjectMetadataUpdateResult> {
    return withProjectService(resolveRuntimeWorkspaceRoot(), (service) => service.updateProjectMetadata(input));
}

/** 通过唯一 Service 更新 Project 封面，并自动选择 borrowed 或 owned Occupancy。 */
export async function updateProjectCover(input: ProjectCoverUpdateInput): Promise<ProjectCoverUpdateResult> {
    return withProjectService(resolveRuntimeWorkspaceRoot(), (service) => service.updateProjectCover(input));
}

/** 删除已经显式关闭的Project；本入口绝不隐式close。 */
export async function deleteProject(ref: ProjectWorkspaceRef): Promise<ProjectDeleteResult> {
    return withProjectService(resolveRuntimeWorkspaceRoot(), (service) => service.deleteProject(ref));
}

/** strict-open accessor：只返回当前结构化Project的ready generation。 */
export function requireReadyProject(ref: ProjectWorkspaceRef): ReadyProjectSessionRef {
    const service = state().service;
    if (!service) {
        throw new ProjectNotOpenError(ref.projectRoot);
    }
    return service.requireReadyProject(ref);
}

/**
 * 数据面入口：取得 ready Project 并顺带刷新活动时间。
 * 返回值之后必须沿调用链传播，业务 Module 不得再次求根。
 */
export function requireActiveReadyProject(ref: ProjectWorkspaceRef): ReadyProjectSessionRef {
    const ready = requireReadyProject(ref);
    markProjectActivity(ready.workspace.ref);
    return ready;
}

/** 使用入口已经捕获的精确 ready generation 取得 Module handle。 */
export function requireReadyModuleHandle<THandle extends ProjectModuleHandle>(
    ready: ReadyProjectSessionRef,
    token: ProjectModuleToken<THandle>,
): THandle {
    const service = state().service;
    if (!service) {
        throw new ProjectNotOpenError(ready.workspace.ref.projectRoot);
    }
    return service.requireReadyModuleHandle(ready, token);
}

/** 使用入口捕获的精确 ready generation 激活 lazy Module，拒绝 close/reopen 后串代。 */
export function activateReadyProjectModule<THandle extends ProjectModuleHandle>(
    ready: ReadyProjectSessionRef,
    token: ProjectModuleToken<THandle>,
): Promise<THandle> {
    const service = state().service;
    if (!service) {
        return Promise.reject(new ProjectNotOpenError(ready.workspace.ref.projectRoot));
    }
    return service.activateReadyProjectModule(ready, token);
}

/**
 * 在精确ready generation同步登记一次异步数据面操作。
 * terminal close会先封住后续登记，再等待本入口已经接纳的操作settle。
 *
 * `assertTarget` 是已接纳操作的同步写入目标核验：在真实副作用前调用，锁失效与根替换立即失败，
 * 普通关闭不阻止排空；`revalidateTarget` 补齐副作用前的异步物理复核（Project 根身份），
 * 同样不要求 Project 仍 open；调用方不能从 abort reason 文本自行判断目标是否仍然有效。
 */
export function runReadyProjectOperation<TResult>(
    ready: ReadyProjectSessionRef,
    operation: (
        signal: AbortSignal,
        assertTarget: () => void,
        revalidateTarget: () => Promise<void>,
    ) => Promise<TResult>,
): Promise<TResult> {
    const service = state().service;
    if (!service) {
        return Promise.reject(new ProjectNotOpenError(ready.workspace.ref.projectRoot));
    }
    return service.runReadyProjectOperation(ready, operation);
}

/**
 * 同步启动长生命周期数据面操作：start同步返回result，completion到最终terminal才允许close继续。
 * 适用于Workflow这类先返回runId、随后跨waiting状态继续运行的后台任务。
 * 两个目标核验能力的语义与 `runReadyProjectOperation` 相同。
 */
export function startReadyProjectOperation<TResult>(
    ready: ReadyProjectSessionRef,
    start: (
        signal: AbortSignal,
        assertTarget: () => void,
        revalidateTarget: () => Promise<void>,
    ) => ProjectOperationStart<TResult>,
): TResult {
    const service = state().service;
    if (!service) {
        throw new ProjectNotOpenError(ready.workspace.ref.projectRoot);
    }
    return service.startReadyProjectOperation(ready, start);
}

/** 数据面守卫；grace仍属于ready。 */
export function assertProjectOpen(ref: ProjectWorkspaceRef): void {
    requireReadyProject(ref);
}

/** Project当前是否发布ready generation。 */
export function isProjectOpen(ref: ProjectWorkspaceRef): boolean {
    try {
        assertProjectOpen(ref);
        return true;
    } catch {
        return false;
    }
}

/** 返回全部ready generation的轻量presence投影。 */
export function listOpenProjects(): OpenProjectSnapshot[] {
    return state().service?.listOpenProjects().map(({ref, ...presence}) => ({
        projectRoot: ref.projectRoot,
        ...presence,
    })) ?? [];
}

/** 删除控制面读取当前ready generation占用；opening/closing返回null。 */
export function projectOccupancy(ref: ProjectWorkspaceRef): ProjectOccupancySnapshot | null {
    const occupancy = state().service?.projectOccupancy(ref);
    if (!occupancy) {
        return null;
    }
    return {
        state: occupancy.state,
        userConnections: occupancy.userConnections,
        agentActive: occupancy.agentActive,
    };
}

/**
 * 按浏览器持有的公开标识取得精确 ready generation。
 *
 * 只返回本运行期仍 live、仍被 Facade entry 发布的那一个对象：闭后重开、另一个 Project 与旧运行期的
 * 标识都拿不到新代次；路径相同不能替代标识。
 */
export function requireReadyProjectByPublicId(ref: ProjectWorkspaceRef, publicId: string): ReadyProjectSessionRef {
    const service = state().service;
    if (!service) {
        throw new ProjectNotOpenError(ref.projectRoot);
    }
    return service.requireReadyProjectByPublicId(ref, publicId);
}

/** 复核精确 ready generation 的 Occupancy 与 Project 物理目录；已关闭或被替换时抛出。 */
export function revalidateReadyProject(ready: ReadyProjectSessionRef): Promise<void> {
    const service = state().service;
    if (!service) {
        return Promise.reject(new ProjectNotOpenError(ready.workspace.ref.projectRoot));
    }
    return service.revalidateReadyProject(ready);
}

/** 为公开标识指定的精确 ready generation取得一路用户presence。 */
export function acquireUserPresence(ref: ProjectWorkspaceRef, publicId: string): ProjectUserPresence {
    const service = state().service;
    if (!service) {
        throw new ProjectNotOpenError(ref.projectRoot);
    }
    return service.acquireUserPresence(ref, publicId);
}

/** 注册 Agent 在场探针；探针可先于 Application owner 登记，Project generation仍由 owner门禁接纳。 */
export function registerAgentPresenceProbe(probe: ((session: ReadyProjectSessionRef) => boolean) | null): void {
    pendingAgentProbe = probe;
    if (!activeOwner) return;
    activeOwner.agentProbe = probe;
    activeOwner.service?.registerAgentPresenceProbe(probe);
}

/** 仅刷新结构化 Project ref 对应 ready generation 的活动时间；未打开保持no-op。 */
export function markProjectActivity(ref: ProjectWorkspaceRef): void {
    state().service?.markProjectActivity(ref);
}

/**
 * 关闭结构化 Project ref 绑定的精确generation。
 * Module或Occupancy关闭失败时Service保留entry，调用方必须处理拒绝，delete不得继续。
 */
export async function closeProject(ref: ProjectWorkspaceRef, reason: ProjectSessionCloseReason): Promise<void> {
    const owner = state();
    const generation = owner.generations.get(ref.projectRoot);
    if (!generation) return;
    if (generation.replacementPending) throw new ProjectSessionRuntimeClosedError();
    if (reason === "grace-expired") {
        await owner.service?.closeProject(ref, reason);
        if (owner.service?.projectOccupancy(ref)) return;
    }
    generation.setCloseReason(reason);
    const scope = generation.scope;
    const result = scope.phase === "available" ? await scope.close() : await scope.recover();
    if (result.status !== "closed") throw new Error(`Project generation关闭不完整：${ref.projectRoot}；${result.reason}`);
    if (owner.generations.get(ref.projectRoot) === generation) owner.generations.delete(ref.projectRoot);
}

/** 执行Agent/presence/grace维护，返回本轮完整关闭的 Project roots。 */
export async function sweepProjectSessions(now = Date.now()): Promise<string[]> {
    const owner = state();
    if (!owner.service) return [];
    const closed = await owner.service.sweepProjectSessions(now);
    for (const ready of closed) {
        const ref = ready.workspace.ref;
        const generation = owner.generations.get(ref.projectRoot);
        if (!generation || generation.ready() !== ready) continue;
        const result = await generation.scope.close();
        if (result.status === "closed" && owner.generations.get(ref.projectRoot) === generation) owner.generations.delete(ref.projectRoot);
    }
    if (closed.length > 0) collectReleasedSqliteHandles();
    return closed.map((ready) => ready.workspace.ref.projectRoot);
}

/** 测试显式关闭；正式产品随 Application.stop 关闭根作用域。 */
export async function closeAllProjects(): Promise<void> {
    if (!testOwner) return;
    const owner = testOwner;
    const result = owner.root.phase === "available" ? await owner.root.close() : await owner.root.recover();
    if (result.status !== "closed") throw new Error(`Project test owner关闭不完整：${result.reason}`);
    if (activeOwner === owner) activeOwner = null;
    testOwner = null;
}

/** 测试隔离根必须在先前显式 close 之后才可重置。 */
export function resetProjectSessionsForTest(): void {
    if (testOwner?.root.phase === "closed") {
        if (activeOwner === testOwner) activeOwner = null;
        testOwner = null;
    }
    if (testOwner?.service || testOwner?.generations.size) {
        throw new Error("Project test owner未关闭，不允许重置");
    }
}

/** 服务随 Application 根获取一次；根资源比其所有 Project child scope 后释放。 */
function serviceFor(owner: ProjectOwner, workspaceRoot: AbsoluteFsPath): ProjectSessionService {
    const compilerRoot = runtimePathsFromEnv().applicationRoot;
    if (owner.service) {
        if (workspaceRootIdentity(owner.workspaceRoot!) !== workspaceRootIdentity(workspaceRoot)) {
            throw new Error("ProjectSession Service已经绑定到另一个Workspace Root");
        }
        if (workspaceRootIdentity(owner.compilerRoot!) !== workspaceRootIdentity(compilerRoot)) {
            throw new Error("ProjectSession Service已经绑定到另一个Application Root");
        }
        return owner.service;
    }
    const lifecycle = new ProjectLifecycle(workspaceRoot);
    const compilerContext = resolveRuntimeArtifactCompilerContext(compilerRoot);
    const service = new ProjectSessionService(workspaceRoot, {
        lifecycle,
        onRootReplacementDetected: (ref, opening) => {
            const generation = owner.generations.get(ref.projectRoot);
            if (generation?.opening() === opening) generation.replacementPending = true;
        },
        onRootReplaced: async (ref, ready, opening) => {
            const generation = owner.generations.get(ref.projectRoot);
            if (!generation || generation.opening() !== opening || (ready && generation.ready() && generation.ready() !== ready)) return;
            generation.setCloseReason("root-replaced");
            generation.replacementClosed = true;
            const scope = generation.scope;
            const result = scope.phase === "available" ? await scope.close() : await scope.recover();
            if (result.status !== "closed") throw new Error(`Project generation关闭不完整：${ref.projectRoot}；${result.reason}`);
            if (owner.generations.get(ref.projectRoot) === generation) owner.generations.delete(ref.projectRoot);
        },
        runtime: new ProjectSessionRuntime({compilerContext}),
    });
    service.registerAgentPresenceProbe(owner.agentProbe);
    owner.root.register({
        kind: "project-service",
        label: "workspace-projects",
        value: service,
        release: async () => {
            await closeOwner(owner);
        },
    });
    owner.service = service;
    owner.workspaceRoot = workspaceRoot;
    owner.compilerRoot = compilerRoot;
    return service;
}

async function closeOwner(owner: ProjectOwner): Promise<void> {
    if (owner.closing) return owner.closing;
    stopMaintenanceTimer(owner);
    const closing = (async () => {
        for (const generation of owner.generations.values()) {
            if (generation.scope.phase !== "closed") {
                throw new Error("Project generation仍未完整关闭，保留Service与Occupancy");
            }
        }
        await owner.service?.closeAll();
        owner.service = null;
        owner.generations.clear();
        owner.workspaceRoot = null;
        owner.compilerRoot = null;
        if (activeOwner === owner) activeOwner = null;
        collectReleasedSqliteHandles({force: true});
    })();
    owner.closing = closing;
    try {
        await closing;
    } finally {
        if (owner.closing === closing) owner.closing = null;
    }
}
/** 比较单进程Service的Workspace Root绑定，Windows按文件系统大小写语义处理。 */
function workspaceRootIdentity(workspaceRoot: AbsoluteFsPath): string {
    const resolved = path.resolve(workspaceRoot);
    return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

/** 首个ready generation建立后启动唯一维护定时器。 */
function ensureMaintenanceTimer(): void {
    const owner = state();
    if (owner.maintenanceTimer || owner.closing || !owner.service) return;
    owner.maintenanceTimer = setInterval(() => {
        if (owner.sweepInFlight) return;
        owner.sweepInFlight = true;
        void sweepProjectSessions().catch(() => undefined).finally(() => {
            owner.sweepInFlight = false;
        });
    }, MAINTENANCE_INTERVAL_MS);
    owner.maintenanceTimer.unref?.();
}

function stopMaintenanceTimer(owner: ProjectOwner): void {
    if (owner.maintenanceTimer) clearInterval(owner.maintenanceTimer);
    owner.maintenanceTimer = null;
}
