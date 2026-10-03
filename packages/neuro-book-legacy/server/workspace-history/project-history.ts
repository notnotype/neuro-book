import path from "node:path";
import fs from "node:fs/promises";
import {consola} from "consola";
import {
    HistoryError,
    WorkspaceHistory,
    type OperationActor,
    type UnseenGroup,
} from "@notnotype/nb-history";
import type {SnapshotRawEventBatch} from "@notnotype/file-snapshot-cache";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectWorkspaceKey} from "nbook/server/workspace-files/project-identity";
import {
    projectWorkspacePathPolicy,
    type ProjectWorkspacePathPolicyResult,
} from "nbook/server/workspace-files/project-workspace-path-policy";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {loadGlobalEffectiveConfigSync, loadProjectModuleConfig} from "nbook/server/config/config-service";
import type {WorkspaceHistorySettingsConfig} from "nbook/server/config/types";
import {isHistoryTrackedRelativePath} from "nbook/server/workspace-history/history-paths";
import type {WorkspaceFileChangeEventDto} from "nbook/shared/dto/workspace-file-events.dto";

/**
 * Project 文件历史门面（Task 95：nb-history 集成）。
 *
 * 职责：
 * - 每ProjectSession generation一个精确History handle；required ready负责开库与必要路径清理，
 *   D15与维护作为可取消warm-up运行。
 * - 记账入口（recordProjectWrite/Delete/Rename）：写入收口层调用，**fail-open**——记账失败绝不
 *   阻断用户写文件，漏账由模块写入口内建对账与 watcher reconcile 收敛为 external 条目（只丢归因不丢历史）。
 * - watcher 对账：由File Index generation handle在rebuild前投递raw batch；丢事件时执行完整补账。
 * - open 后维护：D15 全量对账扫描（closed 期间外部变更补 external 账）→
 *   auto-accept（组内最新条目也超龄才整组接受）→ prune，进程内每项目 24h 一轮。
 * - harness 消费面：`readUnseenForAgent`（懒 initCursor）/ `advanceAgentCursor`。
 *
 * 隐私红线：history.sqlite 含全文快照，严禁进入 task 72 可分享日志包或任何导出诊断流程。
 */

/** 收件箱审查者：单机产品固定本地用户（D10）；模块本身 n 用户就绪，将来接真实 userId 零迁移。 */
export const LOCAL_USER_ID = "local";

const HISTORY_DATABASE_RELATIVE_PATH = ".nbook/history.sqlite";
/** open 后维护（对账扫描 + auto-accept + prune）的进程内最小间隔。 */
const MAINTENANCE_MIN_INTERVAL_MS = 24 * 60 * 60_000;
/** 对账面单文件读取上限：超大二进制不主动读盘对账（正文场景不存在，历史链例外记录于注释）。 */
const RECONCILE_MAX_BYTES = 8 * 1024 * 1024;
/** diagnostics 只保留最近一次错误的有界摘要，避免未知异常携带大对象或长文本。 */
const WARMUP_ERROR_MESSAGE_MAX_LENGTH = 1_024;

/** open 后维护的进程内水位；使用稳定Project key，不参与generation资源查找或持久化。 */
const maintenanceRanAt = new Map<ProjectWorkspaceKey, number>();

/** 全局总开关（Global Config 独有；改动在项目下次 open 生效）。 */
function historyEnabled(): boolean {
    return historyEnabledOverrideForTest ?? loadGlobalEffectiveConfigSync().history.enabled;
}

let historyEnabledOverrideForTest: boolean | null = null;

/** 测试专用：覆盖 history.enabled 判定（隔离真实 Global Config），null 恢复真实配置。 */
export function setHistoryEnabledOverrideForTest(value: boolean | null): void {
    historyEnabledOverrideForTest = value;
}

/** History generation warm-up当前所处的重工作阶段。 */
export type ProjectHistoryWarmupPhase = "reconcile" | "maintenance";

/** 最近一次History warm-up失败的有界诊断。 */
export type ProjectHistoryWarmupFailure = {
    readonly phase: ProjectHistoryWarmupPhase;
    readonly failedAt: string;
    readonly message: string;
};

/** 单个History generation的只读warm-up诊断快照。 */
export type ProjectHistoryWarmupDiagnostics = {
    readonly state: "idle" | "running" | "ready" | "failed" | "cancelled" | "disabled";
    /** 仅running/failed/cancelled时表示对应尝试所处阶段，其余状态为null。 */
    readonly phase: ProjectHistoryWarmupPhase | null;
    readonly attemptCount: number;
    /** 尚未开始任何尝试时为null。 */
    readonly startedAt: string | null;
    /** 当前generation尚未成功完成warm-up时为null。 */
    readonly succeededAt: string | null;
    /** 没有失败过时为null；成功重试后仍保留最近一次失败供诊断。 */
    readonly lastFailure: ProjectHistoryWarmupFailure | null;
};

/** History generation公开的有界资源与后台任务诊断。 */
export type ProjectHistoryDiagnostics = {
    readonly warmup: ProjectHistoryWarmupDiagnostics;
};

/** History在单个ProjectSession generation中拥有的精确资源句柄。 */
export interface ProjectHistoryHandle extends ProjectModuleHandle {
    /** 当前generation完成最低ready后打开的History；功能关闭时为null。 */
    readonly history: Promise<WorkspaceHistory | null>;
    /** 等待或启动当前generation的共享warm-up；失败后下一批消费者会共享一次新尝试。 */
    waitForWarmup(): Promise<void>;
    /** 返回当前generation的有界只读诊断快照。 */
    diagnostics(): ProjectHistoryDiagnostics;
    /** 消费File Index在rebuild前投递的原始事件批。 */
    reconcileRawEvents(batch: SnapshotRawEventBatch<WorkspaceFileChangeEventDto>): Promise<void>;
    /** 当前generation统一判断一条Project-relative路径是否由History消费。 */
    readonly pathPolicy: (relativePath: string) => ProjectWorkspacePathPolicyResult;
}

/** ReadyProjectSession数据面取得History generation handle使用的稳定token。 */
export const PROJECT_HISTORY_MODULE_TOKEN = projectModuleToken<ProjectHistoryHandle>("history", "required");

/** required History Module：最低ready只包含开库与必要路径清理。 */
export const projectHistoryModule: ProjectModule<ProjectHistoryHandle> = {
    token: PROJECT_HISTORY_MODULE_TOKEN,
    start(context): ProjectHistoryHandle {
        let exactHistory: WorkspaceHistory | null = null;
        let exactConfig: WorkspaceHistorySettingsConfig | null = null;
        let warmupPromise: Promise<void> | null = null;
        let warmupDiagnostics: ProjectHistoryWarmupDiagnostics = Object.freeze({
            state: "idle",
            phase: null,
            attemptCount: 0,
            startedAt: null,
            succeededAt: null,
            lastFailure: null,
        });
        let fullReconcileInFlight: Promise<void> | null = null;
        let closed = false;
        let closing: Promise<void> | null = null;
        const projectRoot = context.prepared.workspace.ref.projectRoot;
        const pathPolicy = (relativePath: string): ProjectWorkspacePathPolicyResult => projectWorkspacePathPolicy({
            workspace: context.prepared.workspace,
            relativePath,
            consumer: "history",
        });
        const consumesPath = (relativePath: string) => {
            try {
                return pathPolicy(relativePath).disposition === "consume"
                    && isHistoryTrackedRelativePath(relativePath);
            } catch {
                return false;
            }
        };
        const moduleController = new AbortController();
        const abortModule = () => moduleController.abort(context.signal.reason);
        if (context.signal.aborted) {
            abortModule();
        } else {
            context.signal.addEventListener("abort", abortModule, {once: true});
        }
        const fullReconcile = (history: WorkspaceHistory): Promise<void> => {
            if (fullReconcileInFlight) {
                return fullReconcileInFlight;
            }
            const attempt = reconcileFullScan(
                context.prepared.workspace.root,
                projectRoot,
                history,
                consumesPath,
                moduleController.signal,
            ).finally(() => {
                if (fullReconcileInFlight === attempt) {
                    fullReconcileInFlight = null;
                }
            });
            fullReconcileInFlight = attempt;
            return attempt;
        };
        const opening = Promise.resolve().then(async () => {
            if (!historyEnabled()) {
                return null;
            }
            moduleController.signal.throwIfAborted();
            const config = (await loadProjectModuleConfig({
                workspaceRoot: context.prepared.workspaceRoot,
                projectWorkspace: context.prepared.workspace,
            })).history;
            exactConfig = config;
            moduleController.signal.throwIfAborted();
            const history = await openHistoryInstance(
                context.prepared.workspace.root,
                projectRoot,
                config,
                consumesPath,
                moduleController.signal,
            );
            exactHistory = history;
            moduleController.signal.throwIfAborted();
            return history;
        });

        /** 取得当前generation唯一warm-up Promise；失败后清除Promise以允许下一消费者立即重试。 */
        const waitForWarmup = (): Promise<void> => {
            if (warmupPromise) {
                return warmupPromise;
            }
            const attempt = opening.then(async (history) => {
                if (!history) {
                    warmupDiagnostics = Object.freeze({
                        ...warmupDiagnostics,
                        state: "disabled",
                        phase: null,
                    });
                    return;
                }
                if (!exactConfig) {
                    throw new Error("History Module 已打开但缺少同 generation 配置快照");
                }
                const startedAt = new Date().toISOString();
                let phase: ProjectHistoryWarmupPhase = "reconcile";
                warmupDiagnostics = Object.freeze({
                    ...warmupDiagnostics,
                    state: "running",
                    phase,
                    attemptCount: warmupDiagnostics.attemptCount + 1,
                    startedAt,
                });
                try {
                    await runHistoryWarmup(
                        context.prepared.workspace.key,
                        projectRoot,
                        history,
                        exactConfig,
                        moduleController.signal,
                        () => fullReconcile(history),
                        (nextPhase) => {
                            phase = nextPhase;
                            warmupDiagnostics = Object.freeze({
                                ...warmupDiagnostics,
                                phase,
                            });
                        },
                    );
                    warmupDiagnostics = Object.freeze({
                        ...warmupDiagnostics,
                        state: "ready",
                        phase: null,
                        succeededAt: new Date().toISOString(),
                    });
                } catch (error) {
                    if (moduleController.signal.aborted) {
                        warmupDiagnostics = Object.freeze({
                            ...warmupDiagnostics,
                            state: "cancelled",
                            phase,
                        });
                    } else {
                        const rawMessage = error instanceof Error ? error.message : String(error);
                        const lastFailure: ProjectHistoryWarmupFailure = Object.freeze({
                            phase,
                            failedAt: new Date().toISOString(),
                            message: (rawMessage || "未知History warm-up错误").slice(0, WARMUP_ERROR_MESSAGE_MAX_LENGTH),
                        });
                        warmupDiagnostics = Object.freeze({
                            ...warmupDiagnostics,
                            state: "failed",
                            phase,
                            lastFailure,
                        });
                        consola.warn({projectRoot, phase, error}, "workspace-history warm-up失败");
                    }
                    throw error;
                }
            });
            warmupPromise = attempt;
            void attempt.catch(() => {
                if (warmupPromise === attempt) {
                    warmupPromise = null;
                }
            });
            return attempt;
        };

        // open完成后立即预热，但错误只进入diagnostics；真实数据消费者通过waitForWarmup共享或重试。
        void opening.then(() => waitForWarmup()).catch(() => undefined);

        const handle: ProjectHistoryHandle = {
            history: opening,
            ready: opening.then(() => undefined),
            waitForWarmup,
            diagnostics() {
                return Object.freeze({warmup: warmupDiagnostics});
            },
            pathPolicy,
            async reconcileRawEvents(batch) {
                await waitForWarmup();
                const history = await opening;
                if (!history) {
                    return;
                }
                if (batch.droppedEventCount > 0) {
                    await fullReconcile(history);
                }
                moduleController.signal.throwIfAborted();
                await reconcileEventBatch(
                    history,
                    context.prepared.workspace.root,
                    projectRoot,
                    batch.events,
                    consumesPath,
                );
            },
            async close() {
                if (closed) {
                    return;
                }
                if (closing) {
                    return closing;
                }
                const attempt = (async () => {
                    moduleController.abort(new Error("History Module正在关闭"));
                    context.signal.removeEventListener("abort", abortModule);
                    await opening.catch(() => undefined);
                    await warmupPromise?.catch(() => undefined);
                    if (!exactHistory) {
                        closed = true;
                        return;
                    }
                    await exactHistory.close();
                    exactHistory = null;
                    closed = true;
                    collectReleasedSqliteHandles();
                    consola.info({projectRoot}, "workspace-history 已关闭");
                })();
                closing = attempt;
                try {
                    await attempt;
                } finally {
                    if (!closed && closing === attempt) {
                        closing = null;
                    }
                }
            },
        };
        return handle;
    },
};

registerProjectModule(projectHistoryModule);

/** 真正打开库实例：retention 参数取项目覆盖后的 effective config（D9/N6）。 */
async function openHistoryInstance(
    projectWorkspaceRoot: AbsoluteFsPath,
    projectRoot: string,
    config: WorkspaceHistorySettingsConfig,
    consumesPath: (relativePath: string) => boolean,
    signal?: AbortSignal,
): Promise<WorkspaceHistory> {
    signal?.throwIfAborted();
    const databasePath = path.join(projectWorkspaceRoot, ...HISTORY_DATABASE_RELATIVE_PATH.split("/"));
    await fs.mkdir(path.dirname(databasePath), {recursive: true});
    signal?.throwIfAborted();
    const history = await WorkspaceHistory.open({
        databasePath,
        resolvePath: (relativePath) => path.join(projectWorkspaceRoot, ...relativePath.split("/")),
        config: {
            retentionFullDays: config.retentionFullDays,
            keepDailyLastAfterWindow: config.keepDailyLastAfterWindow,
        },
    });
    try {
        signal?.throwIfAborted();
        const purge = await history.purgePaths((recordedPath) => !consumesPath(recordedPath));
        signal?.throwIfAborted();
        if (purge.entriesDeleted > 0 || purge.acceptancesDeleted > 0 || purge.snapshotsDeleted > 0) {
            consola.info({projectRoot, ...purge}, "workspace-history 已清理不再受管的路径历史");
        }
        consola.info({projectRoot}, "workspace-history 已打开");
        return history;
    } catch (error) {
        await history.close().catch(() => undefined);
        collectReleasedSqliteHandles();
        throw error;
    }
}

/** 测试专用：清空进程内维护水位；generation资源必须由各自handle关闭。 */
export async function resetWorkspaceHistoryForTest(): Promise<void> {
    maintenanceRanAt.clear();
}

/** 把单批raw watcher事件应用到调用generation捕获的精确History实例。 */
async function reconcileEventBatch(
    history: WorkspaceHistory,
    root: string,
    projectRoot: string,
    events: readonly WorkspaceFileChangeEventDto[],
    consumesPath: (relativePath: string) => boolean,
): Promise<void> {
    for (const event of events) {
        if (!consumesPath(event.path) || event.kind === "addDir") {
            continue;
        }
        try {
            if (event.kind === "unlink" || event.kind === "unlinkDir") {
                // 目录路径账面无文件条目，reconcile 为 no-op；子文件删除由各自 unlink 事件处理。
                await history.reconcile(event.path, null);
            } else {
                await history.reconcile(event.path, await readFileForReconcile(root, event.path));
            }
        } catch (error) {
            consola.warn({projectRoot, path: event.path, error}, "workspace-history 单路径对账失败");
        }
    }
}

/** 对账用读盘：文件不存在 / 读失败 / 超过大小上限按「不存在 / 跳过」处理。 */
async function readFileForReconcile(
    root: string,
    relativePath: string,
    signal?: AbortSignal,
): Promise<Uint8Array | null> {
    signal?.throwIfAborted();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const stat = await fs.stat(absolutePath).catch(() => null);
    signal?.throwIfAborted();
    if (!stat?.isFile() || stat.size > RECONCILE_MAX_BYTES) {
        return null;
    }
    try {
        const content = await fs.readFile(absolutePath, signal ? {signal} : undefined);
        signal?.throwIfAborted();
        return content;
    } catch (error) {
        if (signal?.aborted) {
            throw signal.reason;
        }
        return null;
    }
}

// ── 写入记账面（S4/S5 收口层调用；全部 fail-open）─────────────────────────

/** 记一次写入（create/edit 由模块按账面自动判定）。before 为 null 表示此前文件不存在。 */
export async function recordProjectWrite(handle: ProjectHistoryHandle, input: {
    relativePath: string;
    actor: OperationActor;
    before: Uint8Array | null;
    after: Uint8Array;
}): Promise<void> {
    const relativePath = normalizeRecordPath(input.relativePath);
    await recordSafely(handle, relativePath, async (history) => {
        await history.registerWrite(input.actor, relativePath, input.before, input.after);
    });
}

/** 记一次删除。before 是删除前内容（删除找回的快照来源）。 */
export async function recordProjectDelete(handle: ProjectHistoryHandle, input: {
    relativePath: string;
    actor: OperationActor;
    before: Uint8Array;
}): Promise<void> {
    const relativePath = normalizeRecordPath(input.relativePath);
    await recordSafely(handle, relativePath, async (history) => {
        await history.registerDelete(input.actor, relativePath, input.before);
    });
}

/** 记一次改名（内容不变）。from/to 任一不在记账范围则整条跳过（罕见的跨界移动，注释于谓词）。 */
export async function recordProjectRename(handle: ProjectHistoryHandle, input: {
    fromPath: string;
    toPath: string;
    actor: OperationActor;
}): Promise<void> {
    const fromPath = normalizeRecordPath(input.fromPath);
    const toPath = normalizeRecordPath(input.toPath);
    if (!historyConsumesPath(handle, fromPath)) {
        return;
    }
    await recordSafely(handle, toPath, async (history) => {
        await history.registerRename(input.actor, fromPath, toPath);
    });
}

/** 记账公共外壳：路径归一化 + 谓词过滤 + 实例获取 + fail-open（记账失败告警降级，绝不向调用方抛出，N3）。 */
async function recordSafely(
    handle: ProjectHistoryHandle,
    relativePath: string,
    fn: (history: WorkspaceHistory) => Promise<void>,
): Promise<void> {
    if (!historyConsumesPath(handle, relativePath)) {
        return;
    }
    try {
        await handle.waitForWarmup();
        const history = await handle.history;
        if (!history) {
            return;
        }
        await fn(history);
    } catch (error) {
        consola.warn({path: relativePath, error}, "workspace-history 记账失败（fail-open 降级，历史由对账自愈）");
    }
}

/** 归一化记账相对路径：只转换分隔符并去尾斜杠，绝对/越界输入交由Project Path Policy拒绝。 */
function normalizeRecordPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/\/+$/u, "");
}

// ── harness 消费面（S6）────────────────────────────────────────────────

/**
 * 会话未见变更（fail-open：任何失败返回空数组）。
 * 游标懒初始化（N8）：会话首次查询时以「当下」为基线建游标并返回空——新会话不被历史淹没，
 * 也避免在 createAgent（无 ensure-open 保证）挂 initCursor。
 */
export async function readUnseenForAgent(
    handle: ProjectHistoryHandle,
    sessionId: number,
): Promise<UnseenGroup[]> {
    try {
        await handle.waitForWarmup();
        const history = await handle.history;
        if (!history) {
            return [];
        }
        try {
            return await history.unseenChanges(String(sessionId));
        } catch (error) {
            // 与 nb-history 正式包的错误文案耦合：游标未初始化 = 会话首次接触该项目。
            if (error instanceof HistoryError && error.message.includes("游标未初始化")) {
                await history.initCursor(String(sessionId));
                return [];
            }
            throw error;
        }
    } catch (error) {
        consola.warn({sessionId, error}, "workspace-history 未见变更查询失败（视为无变更）");
        return [];
    }
}

/** 推进会话游标（提醒成功送达后调用；fail-open）。 */
export async function advanceAgentCursor(
    handle: ProjectHistoryHandle,
    sessionId: number,
    entryId: number,
): Promise<void> {
    try {
        await handle.waitForWarmup();
        const history = await handle.history;
        await history?.advanceCursor(String(sessionId), entryId);
    } catch (error) {
        consola.warn({sessionId, error}, "workspace-history 游标推进失败（下轮提醒将重复出现）");
    }
}

// ── generation-scoped warm-up 与维护 ─────────────────────────────────

/** generation-scoped后台预热；取消与失败都不反向污染最低ready。 */
async function runHistoryWarmup(
    workspaceKey: ProjectWorkspaceKey,
    projectRoot: string,
    history: WorkspaceHistory,
    config: WorkspaceHistorySettingsConfig,
    signal: AbortSignal,
    reconcileAll: () => Promise<void>,
    onPhase: (phase: ProjectHistoryWarmupPhase) => void,
): Promise<void> {
    onPhase("reconcile");
    await reconcileAll();
    signal.throwIfAborted();
    onPhase("maintenance");
    await runMaintenanceIfDue(
        workspaceKey,
        projectRoot,
        history,
        config,
        signal,
    );
}

/** 路径策略错误按fail-open记账入口的既有语义降级为不消费。 */
function historyConsumesPath(handle: ProjectHistoryHandle, relativePath: string): boolean {
    try {
        return handle.pathPolicy(relativePath).disposition === "consume"
            && isHistoryTrackedRelativePath(relativePath);
    } catch {
        return false;
    }
}

/**
 * D15 全量对账扫描：closed 期间的外部变更补 external 账。
 * 拆「记账 / 呈现」两半——此处只补记账保历史链完整；呈现侧天然安全：external 条目不触发
 * 用户收件箱（模块 R5 只由 agent/system 触发），而会话 unseen 恰好需要让 agent 看到这些变更。
 * 未变文件被模块 hash 比对吸收为 no-op；账面存活但磁盘缺失的文件补删除条目。
 */
async function reconcileFullScan(
    projectWorkspaceRoot: AbsoluteFsPath,
    key: string,
    history: WorkspaceHistory,
    consumesPath: (relativePath: string) => boolean,
    signal?: AbortSignal,
): Promise<void> {
    signal?.throwIfAborted();
    const diskFiles = await collectTrackedDiskFiles(projectWorkspaceRoot, "", signal, consumesPath);
    for (const relativePath of diskFiles) {
        signal?.throwIfAborted();
        try {
            await history.reconcile(relativePath, await readFileForReconcile(projectWorkspaceRoot, relativePath, signal));
            signal?.throwIfAborted();
        } catch (error) {
            if (signal?.aborted) {
                throw signal.reason;
            }
            consola.warn({projectRoot: key, path: relativePath, error}, "workspace-history open 对账单文件失败");
        }
    }
    const diskSet = new Set(diskFiles);
    signal?.throwIfAborted();
    for (const live of await history.liveFiles()) {
        signal?.throwIfAborted();
        if (!consumesPath(live.path) || diskSet.has(live.path)) {
            continue;
        }
        try {
            await history.reconcile(live.path, null);
            signal?.throwIfAborted();
        } catch (error) {
            if (signal?.aborted) {
                throw signal.reason;
            }
            consola.warn({projectRoot: key, path: live.path, error}, "workspace-history open 删除对账失败");
        }
    }
}

/** 递归收集受管文件相对路径（正斜杠）；排除段目录整树跳过。写面目录记账与 open 对账扫描共用。 */
export async function collectTrackedDiskFiles(
    root: string,
    prefix: string,
    signal?: AbortSignal,
    consumesPath: (relativePath: string) => boolean = isHistoryTrackedRelativePath,
): Promise<string[]> {
    signal?.throwIfAborted();
    const absolute = prefix ? path.join(root, ...prefix.split("/")) : root;
    const entries = await fs.readdir(absolute, {withFileTypes: true}).catch(() => []);
    signal?.throwIfAborted();
    const files: string[] = [];
    for (const entry of entries) {
        signal?.throwIfAborted();
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!consumesPath(relativePath)) {
            continue;
        }
        if (entry.isDirectory()) {
            files.push(...await collectTrackedDiskFiles(root, relativePath, signal, consumesPath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files;
}

/** 24h 一轮维护：auto-accept（D8）→ prune。进程内水位，重启后首次 open 会再跑一轮（幂等无害）。 */
async function runMaintenanceIfDue(
    workspaceKey: ProjectWorkspaceKey,
    projectRoot: string,
    history: WorkspaceHistory,
    config: WorkspaceHistorySettingsConfig,
    signal?: AbortSignal,
): Promise<void> {
    signal?.throwIfAborted();
    const last = maintenanceRanAt.get(workspaceKey) ?? 0;
    if (Date.now() - last < MAINTENANCE_MIN_INTERVAL_MS) {
        return;
    }
    const accepted = await runAutoAccept(projectRoot, history, config, signal);
    signal?.throwIfAborted();
    const report = await history.prune();
    signal?.throwIfAborted();
    maintenanceRanAt.set(workspaceKey, Date.now());
    consola.info({projectRoot, autoAccepted: accepted, ...report}, "workspace-history 维护完成");
}

/**
 * auto-accept（D8）：收件箱组内**最后一条**条目也超过 autoAcceptDays 未审查时整组接受——
 * 活跃变更（组内还有新条目）整组保留不被吞；兼解「未接受段永不 prune」导致库只增不减。
 */
async function runAutoAccept(
    projectRoot: string,
    history: WorkspaceHistory,
    config: WorkspaceHistorySettingsConfig,
    signal?: AbortSignal,
): Promise<number> {
    signal?.throwIfAborted();
    if (!config.autoAcceptEnabled) {
        return 0;
    }
    const cutoff = Date.now() - config.autoAcceptDays * 24 * 60 * 60_000;
    let accepted = 0;
    for (const group of await history.inbox(LOCAL_USER_ID)) {
        signal?.throwIfAborted();
        const last = group.entries[group.entries.length - 1];
        if (!last || Date.parse(last.occurredAt) > cutoff) {
            continue;
        }
        try {
            await history.accept(LOCAL_USER_ID, group.path);
            signal?.throwIfAborted();
            accepted += 1;
        } catch (error) {
            if (signal?.aborted) {
                throw signal.reason;
            }
            consola.warn({projectRoot, path: group.path, error}, "workspace-history auto-accept 单组失败");
        }
    }
    return accepted;
}
