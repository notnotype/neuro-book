import {randomUUID} from "node:crypto";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {
    ComfyUiRequestError,
    fetchHistory,
    fetchViewImage,
    interruptExecution,
    normalizeComfyUiBaseUrl,
    submitPrompt,
} from "nbook/server/comfyui/client";
import {ensureComfyUiSocket, markComfyUiSocketIdle, type ComfyUiWsEvent} from "nbook/server/comfyui/ws-listener";
import {
    buildBuiltinWorkflow,
    buildWorkflow,
    ComfyUiWorkflowMappingError,
    type ComfyUiInjectionParams,
} from "nbook/server/comfyui/workflow-template";
import {resolveWorkflowForJob} from "nbook/server/comfyui/user-workflows";
import {saveIllustrationImages} from "nbook/server/comfyui/illustration-store";
import type {ComfyUiCreateJobRequestDto, ComfyUiJobDto, ComfyUiJobEventDto} from "nbook/shared/dto/comfyui.dto";

/**
 * ComfyUI 生图任务生命周期（进程内单例）。
 *
 * 状态机：pending → running(progress) → downloading → completed / failed / cancelled。
 * Job 只存内存（最近 MAX_JOBS 条），持久产物是落盘图片与正文里的引用；
 * 进度以 WS 事件为主，另有 history 轮询兜底（WS 断线也能收敛到终态）；
 * 全部变更通过 subscribeJobEvents 广播给 SSE 端点。
 */

const MAX_JOBS = 50;
/** 任务看门狗：超过该时长无任何事件推进则判失败。 */
const JOB_WATCHDOG_MS = 10 * 60 * 1000;
/** history 轮询兜底间隔。 */
const HISTORY_POLL_MS = 2_500;

/** 每个在途任务的运行时上下文（不进 DTO）。 */
type JobRuntime = {
    baseURL: string;
    timeoutMs: number;
    /** 已提交的工作流 JSON，用于把 executing 的 nodeId 换成 class_type 展示。 */
    workflow: Record<string, unknown>;
    watchdog: NodeJS.Timeout | null;
    pollTimer: NodeJS.Timeout | null;
    /** 终态收敛只允许执行一次（WS executed 与轮询可能同时命中）。 */
    finalizing: boolean;
};

const jobs = new Map<string, ComfyUiJobDto>();
const runtimes = new Map<string, JobRuntime>();
const listeners = new Set<(event: ComfyUiJobEventDto) => void>();

/** 进程级 WS clientId：ComfyUI 用它把进度事件路由回本进程。 */
const wsClientId = randomUUID();

/** 业务校验失败（HTTP 400 语义）。 */
export class ComfyUiJobInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ComfyUiJobInputError";
    }
}

export class ComfyUiJobNotFoundError extends Error {
    constructor(readonly jobId: string) {
        super(`生图任务不存在：${jobId}`);
        this.name = "ComfyUiJobNotFoundError";
    }
}

/** 列出全部任务（新→旧）。 */
export function listJobs(): ComfyUiJobDto[] {
    return [...jobs.values()].sort((left, right) => right.createdAt - left.createdAt);
}

/**
 * 订阅任务事件。返回退订函数。订阅方（SSE 路由）自行推送建连 snapshot。
 */
export function subscribeJobEvents(listener: (event: ComfyUiJobEventDto) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function emitJobUpdate(job: ComfyUiJobDto): void {
    for (const listener of listeners) {
        try {
            listener({type: "job_update", job});
        } catch {
            // 单个订阅者失败不影响其他订阅者。
        }
    }
}

/** 更新任务字段并广播。 */
function patchJob(jobId: string, patch: Partial<ComfyUiJobDto>): ComfyUiJobDto | null {
    const current = jobs.get(jobId);
    if (!current) {
        return null;
    }
    const next: ComfyUiJobDto = {...current, ...patch, updatedAt: Date.now()};
    jobs.set(jobId, next);
    emitJobUpdate(next);
    return next;
}

function isTerminal(status: ComfyUiJobDto["status"]): boolean {
    return status === "completed" || status === "failed" || status === "cancelled";
}

/** 清理运行时资源；全部任务终态后通知 WS 进入空闲倒计时。 */
function disposeRuntime(jobId: string): void {
    const runtime = runtimes.get(jobId);
    if (!runtime) {
        return;
    }
    if (runtime.watchdog) {
        clearTimeout(runtime.watchdog);
    }
    if (runtime.pollTimer) {
        clearInterval(runtime.pollTimer);
    }
    runtimes.delete(jobId);
    if (runtimes.size === 0) {
        markComfyUiSocketIdle();
    }
}

/** 续命看门狗：收到任何推进事件时调用。 */
function feedWatchdog(jobId: string): void {
    const runtime = runtimes.get(jobId);
    if (!runtime) {
        return;
    }
    if (runtime.watchdog) {
        clearTimeout(runtime.watchdog);
    }
    runtime.watchdog = setTimeout(() => {
        failJob(jobId, `生图任务超过 ${String(JOB_WATCHDOG_MS / 60_000)} 分钟无进展，已判定失败`);
    }, JOB_WATCHDOG_MS);
}

function failJob(jobId: string, message: string): void {
    const job = jobs.get(jobId);
    if (!job || isTerminal(job.status)) {
        return;
    }
    disposeRuntime(jobId);
    patchJob(jobId, {status: "failed", error: message, progress: null, progressNode: null});
}

/** 裁剪历史：保留最近 MAX_JOBS 条，只删终态任务。 */
function pruneJobs(): void {
    if (jobs.size <= MAX_JOBS) {
        return;
    }
    const terminal = [...jobs.values()]
        .filter((job) => isTerminal(job.status))
        .sort((left, right) => left.createdAt - right.createdAt);
    for (const job of terminal) {
        if (jobs.size <= MAX_JOBS) {
            break;
        }
        jobs.delete(job.jobId);
    }
}

/**
 * 创建生图任务：构建工作流 → 提交 ComfyUI → 进入 running，立即返回 job。
 * 后续进度经 WS/轮询推进，最终图片落盘到项目 assets/illustrations/。
 */
export async function createIllustrationJob(input: {
    projectPath: string;
    request: ComfyUiCreateJobRequestDto;
}): Promise<ComfyUiJobDto> {
    const config = loadGlobalEffectiveConfigSync();
    if (!config.comfyui.enabled) {
        throw new ComfyUiJobInputError("ComfyUI 生图功能未启用，请先在配置中心的「ComfyUI 生图」中开启");
    }
    const baseURL = normalizeComfyUiBaseUrl(config.comfyui.baseURL);
    const timeoutMs = config.comfyui.timeoutMs ?? 30_000;
    const resolvedSeed = input.request.seed ?? Math.floor(Math.random() * 0xffff_ffff);
    const params: ComfyUiInjectionParams = {
        positive: input.request.positive,
        negative: input.request.negative,
        width: input.request.width,
        height: input.request.height,
        steps: input.request.steps,
        cfg: input.request.cfg,
        seed: resolvedSeed,
    };

    // 构建工作流：自定义 mapping 缺 positive 直接拒绝；内置模板要求 checkpoint 已配置。
    let workflow: Record<string, unknown>;
    try {
        const custom = await resolveWorkflowForJob(input.request.workflowId);
        if (custom) {
            if (!custom.mapping.positive) {
                throw new ComfyUiJobInputError("该工作流没有指定正向提示词注入点，请先在设置中补全");
            }
            workflow = buildWorkflow(custom.workflow, custom.mapping, params);
        } else {
            workflow = buildBuiltinWorkflow(params, config.comfyui.defaults.checkpoint);
        }
    } catch (error) {
        if (error instanceof ComfyUiWorkflowMappingError) {
            throw new ComfyUiJobInputError(error.message);
        }
        throw error;
    }

    const now = Date.now();
    const job: ComfyUiJobDto = {
        jobId: randomUUID(),
        projectPath: input.projectPath,
        status: "pending",
        progress: null,
        progressNode: null,
        promptId: null,
        params: input.request,
        resolvedSeed,
        images: [],
        error: null,
        createdAt: now,
        updatedAt: now,
    };
    jobs.set(job.jobId, job);
    pruneJobs();
    emitJobUpdate(job);

    runtimes.set(job.jobId, {
        baseURL,
        timeoutMs,
        workflow,
        watchdog: null,
        pollTimer: null,
        finalizing: false,
    });
    feedWatchdog(job.jobId);
    ensureComfyUiSocket(baseURL, wsClientId, handleWsEvent);

    // 提交是异步推进的：路由立即返回 pending job，提交结果通过事件广播。
    void submitJob(job.jobId);
    return job;
}

/** 提交工作流并把任务推进到 running；失败转 failed。 */
async function submitJob(jobId: string): Promise<void> {
    const runtime = runtimes.get(jobId);
    const job = jobs.get(jobId);
    if (!runtime || !job || job.status !== "pending") {
        return;
    }
    try {
        const promptId = await submitPrompt(runtime.baseURL, runtime.workflow, wsClientId, runtime.timeoutMs);
        const current = jobs.get(jobId);
        if (!current || current.status !== "pending") {
            // 提交期间被取消：尽力中断远端，本地状态不再回滚。
            void interruptExecution(runtime.baseURL, runtime.timeoutMs);
            return;
        }
        patchJob(jobId, {status: "running", promptId});
        feedWatchdog(jobId);
        startHistoryPolling(jobId);
    } catch (error) {
        const message = error instanceof ComfyUiRequestError ? error.message : error instanceof Error ? error.message : String(error);
        failJob(jobId, message);
    }
}

/** history 轮询兜底：WS 掉线时仍能把任务收敛到终态。 */
function startHistoryPolling(jobId: string): void {
    const runtime = runtimes.get(jobId);
    if (!runtime || runtime.pollTimer) {
        return;
    }
    runtime.pollTimer = setInterval(() => {
        void pollHistoryOnce(jobId);
    }, HISTORY_POLL_MS);
}

async function pollHistoryOnce(jobId: string): Promise<void> {
    const runtime = runtimes.get(jobId);
    const job = jobs.get(jobId);
    if (!runtime || !job || job.status !== "running" || !job.promptId || runtime.finalizing) {
        return;
    }
    try {
        const entry = await fetchHistory(runtime.baseURL, job.promptId, runtime.timeoutMs);
        if (!entry) {
            return;
        }
        if (entry.error) {
            failJob(jobId, entry.error);
            return;
        }
        if (entry.completed) {
            void finalizeJob(jobId);
        }
    } catch {
        // 轮询失败不致命：看门狗兜底超时。
    }
}

/** WS 事件路由：按 promptId 找到任务推进状态。 */
function handleWsEvent(event: ComfyUiWsEvent): void {
    const job = [...jobs.values()].find((item) => item.promptId === event.promptId);
    if (!job || isTerminal(job.status)) {
        return;
    }
    const runtime = runtimes.get(job.jobId);
    feedWatchdog(job.jobId);
    switch (event.type) {
        case "progress":
            patchJob(job.jobId, {status: "running", progress: Math.min(event.value / event.max, 1)});
            break;
        case "executing": {
            if (event.nodeId === null) {
                // node=null 表示队列项执行结束。
                void finalizeJob(job.jobId);
                break;
            }
            const node = runtime?.workflow[event.nodeId] as {class_type?: string} | undefined;
            patchJob(job.jobId, {status: "running", progressNode: node?.class_type ?? event.nodeId});
            break;
        }
        case "executed":
        case "execution_success":
            void finalizeJob(job.jobId);
            break;
        case "execution_error":
            failJob(job.jobId, event.message);
            break;
    }
}

/**
 * 终态收敛：等 history 出结果 → 下载全部输出图片 → 落盘 → completed。
 * WS executed 与轮询可能并发触发，finalizing 标记保证只执行一次。
 */
async function finalizeJob(jobId: string): Promise<void> {
    const runtime = runtimes.get(jobId);
    const job = jobs.get(jobId);
    if (!runtime || !job || runtime.finalizing || isTerminal(job.status) || !job.promptId) {
        return;
    }
    runtime.finalizing = true;
    try {
        // history 可能滞后于 executed 事件，短重试等待。
        let entry = await fetchHistory(runtime.baseURL, job.promptId, runtime.timeoutMs);
        for (let attempt = 0; attempt < 5 && (!entry || (!entry.completed && !entry.error)); attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            entry = await fetchHistory(runtime.baseURL, job.promptId, runtime.timeoutMs);
        }
        if (!entry) {
            failJob(jobId, "ComfyUI 历史中找不到任务结果");
            return;
        }
        if (entry.error) {
            failJob(jobId, entry.error);
            return;
        }
        if (entry.images.length === 0) {
            failJob(jobId, "任务完成但没有输出图片（工作流可能缺少 SaveImage 节点）");
            return;
        }
        patchJob(jobId, {status: "downloading", progress: 1, progressNode: null});
        const images: Array<{bytes: Buffer}> = [];
        for (const image of entry.images) {
            images.push({bytes: await fetchViewImage(runtime.baseURL, image, runtime.timeoutMs)});
        }
        const paths = await saveIllustrationImages({projectPath: job.projectPath, jobId, images});
        disposeRuntime(jobId);
        patchJob(jobId, {status: "completed", images: paths.map((path) => ({path}))});
    } catch (error) {
        runtime.finalizing = false;
        const message = error instanceof Error ? error.message : String(error);
        failJob(jobId, message);
    }
}

/**
 * 取消任务：pending 直接标记；running 先尽力 POST /interrupt 再标记。
 * 已终态任务原样返回（幂等）。
 */
export async function cancelJob(jobId: string): Promise<ComfyUiJobDto> {
    const job = jobs.get(jobId);
    if (!job) {
        throw new ComfyUiJobNotFoundError(jobId);
    }
    if (isTerminal(job.status)) {
        return job;
    }
    const runtime = runtimes.get(jobId);
    if (job.status === "running" && runtime) {
        await interruptExecution(runtime.baseURL, runtime.timeoutMs);
    }
    disposeRuntime(jobId);
    return patchJob(jobId, {status: "cancelled", progress: null, progressNode: null}) ?? job;
}
