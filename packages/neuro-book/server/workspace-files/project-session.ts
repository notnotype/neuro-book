import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {
    projectWorkspaceRef,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
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
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

// Production composition root：required与lazy descriptor在任何Project open前完成注册。
import "nbook/server/workspace-files/project-database-module";
import "nbook/server/workspace-history/project-history";
import "nbook/server/workspace-files/project-file-index";
import "nbook/server/plot/index";
import "nbook/server/agent/tools/agent-sql-project-module";
import "nbook/server/storage/project-storage-module";

export {isProjectNotOpenError, PROJECT_GRACE_MS, ProjectNotOpenError};
export type {ProjectOpener, ProjectOperationStart, ReadyProjectSessionRef};

const MAINTENANCE_INTERVAL_MS = 30_000;

type ProjectSessionGlobalState = {
    lifecycle: ProjectLifecycle | null;
    service: ProjectSessionService | null;
    workspaceRoot: AbsoluteFsPath | null;
    compilerRoot: AbsoluteFsPath | null;
    compilerContext: ReturnType<typeof resolveRuntimeArtifactCompilerContext> | null;
    agentProbe: ((session: ReadyProjectSessionRef) => boolean) | null;
    maintenanceTimer: ReturnType<typeof setInterval> | null;
    sweepInFlight: boolean;
    /** 升级前各代 owner 的排空；新 owner 取得任何 Occupancy 前必须等待整条链。 */
    previousClose: Promise<void> | null;
    /** Facade 关闭次数，令仍等待 HMR 交接的旧请求失效。 */
    epoch: number;
    closing: Promise<void> | null;
};

/** V2 槽形状；旧 Service 不认 publicId，只能排空，不能当成本版 owner 复用。 */
type PreviousProjectSessionV2State = {
    readonly service: {closeAll(): Promise<void>} | null;
    readonly agentProbe: ((session: ReadyProjectSessionRef) => boolean) | null;
    readonly maintenanceTimer: ReturnType<typeof setInterval> | null;
};

/**
 * V3 槽（基线 `0d66064b`）的排空与探针承接字段。
 *
 * 真实 V3 还带 lifecycle/workspaceRoot/compilerRoot/compilerContext/sweepInFlight/epoch/closing；
 * 本版只读这里的字段，其余不能按本版 `ProjectSessionGlobalState` 复用：V3 的 Service 已有
 * `requireReadyProjectByPublicId`（缺的是旧 Facade 未导出它），真正没有的是本轮新增的
 * `revalidateReadyProject`/写入目标核验，以及 Project Storage lazy Module 登记。
 */
type PreviousProjectSessionV3State = PreviousProjectSessionV2State & {
    /** V3 自己尚未排空的更早一代；新 owner 必须继承整条链，不能只交接本版。 */
    readonly previousClose: Promise<void> | null;
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

const globalForProjectSession = globalThis as typeof globalThis & {
    __nbookProjectSessionV2?: PreviousProjectSessionV2State;
    __nbookProjectSessionV3?: PreviousProjectSessionV3State;
    __nbookProjectSessionV4?: ProjectSessionGlobalState;
};
const globalState = globalForProjectSession.__nbookProjectSessionV4
    ?? (globalForProjectSession.__nbookProjectSessionV4 = createHandoffState(
        globalForProjectSession.__nbookProjectSessionV3,
        globalForProjectSession.__nbookProjectSessionV2,
    ));

/**
 * 建立本版合同的 owner，并排空升级前的 owner。
 *
 * V2 不认 publicId：旧 acquireUserPresence 会忽略新增参数，旧 publication 也带不上标识；V3 的 Facade
 * 未导出 `requireReadyProjectByPublicId`（Service 已有），也没有本轮新增的 `revalidateReadyProject`/
 * 写入目标核验与 Project Storage lazy Module 登记。复用旧对象会把「按公开标识取得精确代次」与
 * 「已接纳操作的物理前置」静默降级成运行期 TypeError 或漏建 lazy Module，因此这里先停掉旧维护定时器、
 * 关闭旧 Service（Lifecycle、Module 与 Occupancy），再由新 owner 从空 Session 状态重建；
 * 旧标识属于旧 Runtime，在新 owner 中无法解析。
 */
function createHandoffState(
    previousV3: PreviousProjectSessionV3State | undefined,
    previousV2: PreviousProjectSessionV2State | undefined,
): ProjectSessionGlobalState {
    const pending: Promise<void>[] = [];
    // V3 自己的 previousClose 可能仍在排空更早一代：整条链都要在新 owner 取得 Occupancy 之前完成。
    if (previousV3?.previousClose) {
        pending.push(previousV3.previousClose);
    }
    for (const previous of [previousV3, previousV2]) {
        if (previous?.maintenanceTimer) {
            clearInterval(previous.maintenanceTimer);
        }
        try {
            const closed = previous?.service?.closeAll();
            if (closed) pending.push(closed);
        } catch (error) {
            pending.push(Promise.reject(error));
        }
    }
    const previousClose: Promise<void> | null = pending.length === 0 ? null : Promise.all(pending).then(() => undefined);
    // import 本身没有等待方；保留拒绝给所有后续请求和 shutdown，避免未观察的 rejection。
    void previousClose?.catch(() => undefined);
    return {
        lifecycle: null,
        service: null,
        workspaceRoot: null,
        compilerRoot: null,
        compilerContext: null,
        // 探针属于 Agent owner；它继续按精确 ready 对象核对，而不是让 Facade 建第二份在场状态。
        agentProbe: previousV3?.agentProbe ?? previousV2?.agentProbe ?? null,
        maintenanceTimer: null,
        sweepInFlight: false,
        previousClose,
        epoch: 0,
        closing: null,
    };
}

/** 旧 owner 排空完成前不取得任何 Project Occupancy，避免两代同时持有同一 Project 的锁。 */
async function withProjectService<T>(
    workspaceRoot: AbsoluteFsPath,
    operation: (service: ProjectSessionService) => Promise<T>,
): Promise<T> {
    const epoch = globalState.epoch;
    if (globalState.closing) throw new ProjectSessionRuntimeClosedError();
    if (globalState.previousClose) await globalState.previousClose;
    if (globalState.closing || epoch !== globalState.epoch) throw new ProjectSessionRuntimeClosedError();
    // 核验与操作接纳之间不 await；closeAll 的同步 gate 能覆盖交接完成这一刻的新请求。
    return operation(serviceFor(workspaceRoot));
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
    const ready = await withProjectService(workspaceRoot ?? resolveRuntimeWorkspaceRoot(), (service) => service.openProject(ref, opener));
    ensureMaintenanceTimer();
    return ready;
}

/** 产品控制面结构化open，同时返回最终Project publication与ready generation。 */
export async function openProjectControl(
    ref: ProjectWorkspaceRef,
    opener: ProjectOpener,
): Promise<ProjectControlOpenResult> {
    const result = await withProjectService(resolveRuntimeWorkspaceRoot(), (service) => service.openProjectControl(ref, opener));
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
    const service = globalState.service;
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
    const service = globalState.service;
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
    const service = globalState.service;
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
    const service = globalState.service;
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
    const service = globalState.service;
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
    return globalState.service?.listOpenProjects().map(({ref, ...presence}) => ({
        projectRoot: ref.projectRoot,
        ...presence,
    })) ?? [];
}

/** 删除控制面读取当前ready generation占用；opening/closing返回null。 */
export function projectOccupancy(ref: ProjectWorkspaceRef): ProjectOccupancySnapshot | null {
    const occupancy = globalState.service?.projectOccupancy(ref);
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
    const service = globalState.service;
    if (!service) {
        throw new ProjectNotOpenError(ref.projectRoot);
    }
    return service.requireReadyProjectByPublicId(ref, publicId);
}

/** 复核精确 ready generation 的 Occupancy 与 Project 物理目录；已关闭或被替换时抛出。 */
export function revalidateReadyProject(ready: ReadyProjectSessionRef): Promise<void> {
    const service = globalState.service;
    if (!service) {
        return Promise.reject(new ProjectNotOpenError(ready.workspace.ref.projectRoot));
    }
    return service.revalidateReadyProject(ready);
}

/** 为公开标识指定的精确 ready generation取得一路用户presence。 */
export function acquireUserPresence(ref: ProjectWorkspaceRef, publicId: string): ProjectUserPresence {
    const service = globalState.service;
    if (!service) {
        throw new ProjectNotOpenError(ref.projectRoot);
    }
    return service.acquireUserPresence(ref, publicId);
}

/** 注册 Agent 在场探针；ready 对象身份确保旧 invocation 不会占用重开的 generation。 */
export function registerAgentPresenceProbe(probe: ((session: ReadyProjectSessionRef) => boolean) | null): void {
    globalState.agentProbe = probe;
    globalState.service?.registerAgentPresenceProbe(probe);
}

/** 仅刷新结构化 Project ref 对应 ready generation 的活动时间；未打开保持no-op。 */
export function markProjectActivity(ref: ProjectWorkspaceRef): void {
    globalState.service?.markProjectActivity(ref);
}

/**
 * 关闭结构化 Project ref 绑定的精确generation。
 * Module或Occupancy关闭失败时Service保留entry，调用方必须处理拒绝，delete不得继续。
 */
export async function closeProject(ref: ProjectWorkspaceRef, reason: ProjectSessionCloseReason): Promise<void> {
    const service = globalState.service;
    if (!service) {
        return;
    }
    await service.closeProject(ref, reason);
    collectReleasedSqliteHandles({force: reason === "delete" || reason === "shutdown"});
}

/** 执行Agent/presence/grace维护，返回本轮完整关闭的 Project roots。 */
export async function sweepProjectSessions(now = Date.now()): Promise<string[]> {
    const service = globalState.service;
    if (!service) {
        return [];
    }
    const closed = await service.sweepProjectSessions(now);
    if (closed.length > 0) {
        collectReleasedSqliteHandles();
    }
    return closed.map((ref) => ref.projectRoot);
}

/** Nitro shutdown/HMR最终关闭唯一Service及其Lifecycle、Module与plain adapter资源。 */
export function closeAllProjects(): Promise<void> {
    if (globalState.closing) return globalState.closing;
    const close = Promise.withResolvers<void>();
    globalState.closing = close.promise;
    globalState.epoch += 1;
    stopMaintenanceTimer();
    const service = globalState.service;
    const closing = (async () => {
        // 同步封住现有 Service，随后同时等待旧版交接，避免 shutdown 在交接中提前结束。
        await Promise.all([service?.closeAll(), globalState.previousClose]);
        if (globalState.service === service) {
            globalState.lifecycle = null;
            globalState.service = null;
            globalState.workspaceRoot = null;
            globalState.compilerRoot = null;
            globalState.compilerContext = null;
        }
        collectReleasedSqliteHandles({force: true});
    })();
    void closing.then(close.resolve, close.reject);
    const settled = () => { if (globalState.closing === close.promise) globalState.closing = null; };
    void close.promise.then(settled, settled);
    return close.promise;
}

/**
 * 测试专用：仅在测试已经显式close后清空HMR容器与探针。
 * 不执行隐藏async cleanup，避免同步reset制造无人观察的关闭失败。
 */
export function resetProjectSessionsForTest(): void {
    stopMaintenanceTimer();
    globalState.lifecycle = null;
    globalState.service = null;
    globalState.workspaceRoot = null;
    globalState.compilerRoot = null;
    globalState.compilerContext = null;
    globalState.agentProbe = null;
    globalState.sweepInFlight = false;
    globalState.previousClose = null;
    globalState.closing = null;
    globalState.epoch += 1;
}

/** 创建或返回绑定同一Runtime Workspace Root与Application Root的HMR稳定Service。 */
function serviceFor(workspaceRoot: AbsoluteFsPath): ProjectSessionService {
    const compilerRoot = runtimePathsFromEnv().applicationRoot;
    if (globalState.service) {
        if (workspaceRootIdentity(globalState.workspaceRoot!) !== workspaceRootIdentity(workspaceRoot)) {
            throw new Error("ProjectSession Service已经绑定到另一个Workspace Root");
        }
        if (workspaceRootIdentity(globalState.compilerRoot!) !== workspaceRootIdentity(compilerRoot)) {
            throw new Error("ProjectSession Service已经绑定到另一个Application Root");
        }
        return globalState.service;
    }
    const lifecycle = new ProjectLifecycle(workspaceRoot);
    const compilerContext = resolveRuntimeArtifactCompilerContext(compilerRoot);
    const service = new ProjectSessionService(workspaceRoot, {
        lifecycle,
        runtime: new ProjectSessionRuntime({compilerContext}),
    });
    service.registerAgentPresenceProbe(globalState.agentProbe);
    globalState.lifecycle = lifecycle;
    globalState.service = service;
    globalState.workspaceRoot = workspaceRoot;
    globalState.compilerRoot = compilerRoot;
    globalState.compilerContext = compilerContext;
    return service;
}
/** 比较单进程Service的Workspace Root绑定，Windows按文件系统大小写语义处理。 */
function workspaceRootIdentity(workspaceRoot: AbsoluteFsPath): string {
    const resolved = path.resolve(workspaceRoot);
    return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

/** 首个ready generation建立后启动唯一维护定时器。 */
function ensureMaintenanceTimer(): void {
    if (globalState.maintenanceTimer || globalState.closing || !globalState.service) {
        return;
    }
    globalState.maintenanceTimer = setInterval(() => {
        if (globalState.sweepInFlight) {
            return;
        }
        globalState.sweepInFlight = true;
        void sweepProjectSessions()
            .catch(() => undefined)
            .finally(() => {
                globalState.sweepInFlight = false;
            });
    }, MAINTENANCE_INTERVAL_MS);
    globalState.maintenanceTimer.unref?.();
}

/** 停止维护定时器；Service close失败时仍保持shutdown gate，不再执行grace sweep。 */
function stopMaintenanceTimer(): void {
    if (globalState.maintenanceTimer) {
        clearInterval(globalState.maintenanceTimer);
        globalState.maintenanceTimer = null;
    }
}
