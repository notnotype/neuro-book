import type {JsonValue} from "nbook/server/agent/messages/types";
import type {AgentJobEventCursor, AgentJobStatus} from "nbook/shared/dto/agent-job.dto";
import type {PendingAsk, RunStatus} from "nbook/server/vendor/nb-workflow/index";

/** run_workflow 工具参数的前端展示模型。 */
export type RunWorkflowArgs = {
    workflowKey?: string;
    script?: string;
    args?: JsonValue;
    model?: string;
    wait?: boolean;
};

/** workflow 触达的单个 Agent session 摘要。 */
export type WorkflowSessionDetails = {
    sessionId: number;
    profileKey: string;
    title: string;
    /** 没有执行模型调用时为空。 */
    tokens: WorkflowUsage | null;
};

/** workflow token 用量。 */
export type WorkflowUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** provider 提供 1h cache write 明细时存在。 */
    cacheWrite1hTokens?: number;
    /** provider 提供 reasoning token 明细时存在。 */
    reasoningTokens?: number;
    totalTokens: number;
};

/** 正式 RunState 在终态附带的最新执行摘要。 */
export type WorkflowRunSummary = {
    sessions: WorkflowSessionDetails[];
    usage: WorkflowUsage;
};

/** 气泡实际展示的摘要；旧 waiting details 可能还没有 usage。 */
export type WorkflowDisplaySummary = {
    sessions: WorkflowSessionDetails[];
    usage: WorkflowUsage | null;
};

export type RunWorkflowToolStatus = RunStatus | "started";

/** run_workflow details；后台默认只返回 jobId/runId/started，wait:true 才返回终态元数据。 */
export type RunWorkflowDetails = {
    runId: string;
    jobId?: string;
    jobEventCursor?: AgentJobEventCursor;
    workflowKey?: string;
    status?: RunWorkflowToolStatus;
    background?: boolean;
    chartMermaid?: string | null;
    result?: JsonValue;
    error?: string | null;
    pendingAsks?: string[];
    sessions?: WorkflowSessionDetails[];
    usage?: WorkflowUsage;
};

const RUN_STATUSES = new Set<RunStatus>(["running", "waiting", "completed", "failed", "cancelled"]);
const TOOL_STATUSES = new Set<RunWorkflowToolStatus>([...RUN_STATUSES, "started"]);

/** Workflow 气泡对用户展示的统一状态。 */
export type WorkflowBubbleStatus = "approval" | "starting" | "not_started" | RunStatus | "cancelled" | "interrupted";

/** 状态归约输入；Run 可见后以 Run 为 Workflow 生命周期真相源，Job 负责启动与中断兜底。 */
export type WorkflowBubbleStatusInput = {
    pendingApproval: boolean;
    toolCallStatus: string;
    detailsStatus?: RunWorkflowToolStatus;
    hasBackgroundJob: boolean;
    jobStatus?: AgentJobStatus;
    jobUnavailable?: boolean;
    runStatus?: RunStatus;
    runUnavailable?: boolean;
};

/** 为一次 ask 阶段生成稳定指纹；resume 后出现下一轮问题时释放提交锁。 */
export function workflowPendingAskSignature(asks: readonly PendingAsk[]): string {
    return JSON.stringify(asks.map((ask) => [ask.key, ask.fingerprint]));
}

/** 判断 workflow 是否已经进入不会再自行变化的终态。 */
export function isWorkflowTerminalStatus(status: string | undefined): status is "completed" | "failed" | "cancelled" {
    return status === "completed" || status === "failed" || status === "cancelled";
}

/** 后台 job 的全部终态。 */
export function isAgentJobTerminalStatus(status: AgentJobStatus | undefined): boolean {
    return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

/**
 * 判断是否继续读取 Run 快照。
 * Job 与 Run 的观察请求可能先后返回；即使先看到 Job cancelled，也必须读取到 Run 自身终态。
 * 只有 Run 终态或 Run 不可查询才停止观察；Job 只负责取消和启动阶段提示。
 */
export function shouldPollWorkflowRun(input: {
    hasBackgroundJob: boolean;
    detailsStatus?: RunWorkflowToolStatus;
    runStatus?: RunStatus;
    runUnavailable?: boolean;
}): boolean {
    if (input.runUnavailable) return false;
    if (isWorkflowTerminalStatus(input.runStatus)) return false;
    if (!input.hasBackgroundJob && isWorkflowTerminalStatus(input.detailsStatus)) return false;
    return true;
}

/**
 * 把工具、job、run 三层状态归约为气泡状态。
 * 工具调用 success 只表示后台 job 已登记，绝不能直接归约成 workflow completed。
 */
export function resolveWorkflowBubbleStatus(input: WorkflowBubbleStatusInput): WorkflowBubbleStatus {
    if (input.pendingApproval) return "approval";
    if (input.hasBackgroundJob) {
        if (input.runUnavailable) return "interrupted";
        if (input.runStatus) return input.runStatus;
        if (input.jobStatus) {
            if (isAgentJobTerminalStatus(input.jobStatus)) return input.jobStatus;
            if (input.jobStatus === "waiting") return "waiting";
            return "running";
        }
        return input.detailsStatus === "started" ? "starting" : "running";
    }
    if (input.runUnavailable && (input.detailsStatus === "running" || input.detailsStatus === "waiting" || input.detailsStatus === "started")) {
        return "interrupted";
    }
    if (input.runStatus) return input.runStatus;
    if (input.detailsStatus && input.detailsStatus !== "started") return input.detailsStatus;
    if (input.detailsStatus === "started") return "starting";
    if (input.toolCallStatus === "error" || input.toolCallStatus === "invalid") return "failed";
    if (input.toolCallStatus === "running" || input.toolCallStatus === "streaming") return "starting";
    return "not_started";
}

/** Workflow 错误归属：Run 一旦可见便独占 Workflow 真相，Job 错误由 Job 区域单独展示。 */
export function resolveWorkflowBubbleError(input: {
    runObserved: boolean;
    runError?: string | null;
    detailsError?: string | null;
    toolCallError?: string | null;
}): string {
    if (input.runObserved) return input.runError ?? "";
    return input.detailsError ?? input.toolCallError ?? "";
}

/** workflow 气泡的轮询节奏：运行中快刷，等待用户时降频。 */
export function workflowPollDelay(status: RunStatus | AgentJobStatus | undefined): number {
    return status === "waiting" ? 2000 : 500;
}

/** 终态 RunState summary 是最新真相源；字段缺省时回退工具 details。 */
export function resolveWorkflowDisplaySummary(
    runSummary: WorkflowRunSummary | null | undefined,
    details: RunWorkflowDetails | null,
): WorkflowDisplaySummary {
    return {
        sessions: runSummary?.sessions ?? details?.sessions ?? [],
        usage: runSummary?.usage ?? details?.usage ?? null,
    };
}

/** 解析工具参数；流式 JSON 尚未闭合时返回空模型。 */
export function parseRunWorkflowArgs(raw: string): RunWorkflowArgs {
    try {
        const parsed = JSON.parse(raw) as JsonValue;
        if (!isJsonObject(parsed)) {
            return {};
        }
        return {
            workflowKey: typeof parsed.workflowKey === "string" ? parsed.workflowKey : undefined,
            script: typeof parsed.script === "string" ? parsed.script : undefined,
            args: parsed.args,
            model: typeof parsed.model === "string" ? parsed.model : undefined,
            wait: typeof parsed.wait === "boolean" ? parsed.wait : undefined,
        };
    } catch {
        return {};
    }
}

/**
 * 收窄公开 tool details。这里不信任字段形状：details 既可能是心跳 partial，
 * 也可能来自旧 durable history 的有界公开投影。
 */
export function parseRunWorkflowDetails(value: JsonValue | undefined): RunWorkflowDetails | null {
    if (!isJsonObject(value) || typeof value.runId !== "string" || !value.runId) {
        return null;
    }

    const sessions = Array.isArray(value.sessions)
        ? value.sessions.flatMap((item) => {
            if (!isJsonObject(item) || typeof item.sessionId !== "number") {
                return [];
            }
            return [{
                sessionId: item.sessionId,
                profileKey: typeof item.profileKey === "string" ? item.profileKey : "",
                title: typeof item.title === "string" ? item.title : "",
                tokens: parseUsage(item.tokens),
            }];
        })
        : undefined;

    return {
        runId: value.runId,
        jobId: typeof value.jobId === "string" ? value.jobId : undefined,
        jobEventCursor: parseJobEventCursor(value.jobEventCursor),
        workflowKey: typeof value.workflowKey === "string" ? value.workflowKey : undefined,
        status: typeof value.status === "string" && TOOL_STATUSES.has(value.status as RunWorkflowToolStatus)
            ? value.status as RunWorkflowToolStatus
            : undefined,
        background: typeof value.background === "boolean" ? value.background : undefined,
        chartMermaid: typeof value.chartMermaid === "string" || value.chartMermaid === null
            ? value.chartMermaid
            : undefined,
        ...(Object.prototype.hasOwnProperty.call(value, "result") ? {result: value.result} : {}),
        error: typeof value.error === "string" || value.error === null ? value.error : undefined,
        pendingAsks: Array.isArray(value.pendingAsks)
            ? value.pendingAsks.filter((item): item is string => typeof item === "string")
            : undefined,
        sessions,
        usage: parseUsage(value.usage) ?? undefined,
    };
}

/** 解析后台任务创建游标；旧历史没有该字段时保持 undefined。 */
function parseJobEventCursor(value: JsonValue | undefined): AgentJobEventCursor | undefined {
    if (!isJsonObject(value)
        || typeof value.eventEpoch !== "string"
        || !value.eventEpoch
        || typeof value.after !== "number"
        || !Number.isInteger(value.after)
        || value.after < 0) {
        return undefined;
    }
    return {eventEpoch: value.eventEpoch, after: value.after};
}

/** JSON object 类型守卫。 */
function isJsonObject(value: JsonValue | undefined): value is {[key: string]: JsonValue} {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 收窄 token 用量；不完整或非法数据按无用量处理。 */
function parseUsage(value: JsonValue | undefined): WorkflowUsage | null {
    if (!isJsonObject(value)
        || typeof value.inputTokens !== "number"
        || typeof value.outputTokens !== "number"
        || typeof value.cacheReadTokens !== "number"
        || typeof value.cacheWriteTokens !== "number"
        || typeof value.totalTokens !== "number") {
        return null;
    }
    return {
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
        cacheReadTokens: value.cacheReadTokens,
        cacheWriteTokens: value.cacheWriteTokens,
        ...(typeof value.cacheWrite1hTokens === "number" ? {cacheWrite1hTokens: value.cacheWrite1hTokens} : {}),
        ...(typeof value.reasoningTokens === "number" ? {reasoningTokens: value.reasoningTokens} : {}),
        totalTokens: value.totalTokens,
    };
}
