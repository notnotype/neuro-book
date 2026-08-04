import {AgentJobCancelledError, type AgentJobManager, type AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";
import type {AgentJobEventCursor} from "nbook/shared/dto/agent-job.dto";
import type {WorkflowDemoRunState, WorkflowRunStart, WorkflowRunSummary} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue, RunView, SessionId, WorkflowDefinition, WorkspacePort} from "nbook/server/vendor/nb-workflow/index";
import type {EffectiveConfig} from "nbook/server/config/types";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** Workflow Job 编排所依赖的最小服务合同，便于 HTTP 与 Agent 工具共用同一启动边界。 */
type WorkflowJobService = {
    startWorkflowRun(input: {
        def: WorkflowDefinition;
        args: JsonValue;
        callerSessionId?: SessionId;
        model?: string;
        workspace?: WorkspacePort;
        config: EffectiveConfig;
        project: ReadyProjectSessionRef | null;
        signal?: AbortSignal;
    }): WorkflowRunStart;
    waitForRunSettled(runId: string, signal?: AbortSignal, onRunning?: () => void): Promise<RunView>;
    cancelRun(runId: string): void;
    runSummary(runId: string): Promise<WorkflowRunSummary>;
    /** 公开 Run 投影；详情 provider 用它读取 waiting/completed 状态和完整 pending asks。 */
    runState?(runId: string, after: number): Promise<WorkflowDemoRunState>;
};

export type SpawnWorkflowJobInput = {
    jobs: AgentJobManager;
    service: WorkflowJobService;
    def: WorkflowDefinition;
    args: JsonValue;
    callerSessionId?: SessionId;
    model?: string;
    workspace?: WorkspacePort;
    config: EffectiveConfig;
    project: ReadyProjectSessionRef | null;
    /** Agent 工具发起时是回流收件人；用户从正式 HTTP 入口触发时为空。 */
    ownerSessionId?: number;
    /** Agent 工具调用 id；HTTP 主动触发时为空。 */
    originToolCallId?: string;
    /** 有 owner 时默认 followup；HTTP 主动触发显式传 none。 */
    deliver?: "followup" | "none";
};

export type SpawnedWorkflowJob = {
    job: AgentJobSnapshot;
    jobEventCursor: AgentJobEventCursor;
    runId: string;
};

/** Workflow Job 的完整结果真相源：完成通知、get_job 和 Job detail 共用，绝不字符截断。 */
export type WorkflowJobResult = {
    runId: string;
    workflowKey: string;
    status: "completed";
    result: JsonValue | null;
    sessions: WorkflowRunSummary["sessions"];
    usage: WorkflowRunSummary["usage"];
};

/**
 * 启动 workflow run，并立即把它纳入 AgentJobManager 生命周期。
 *
 * 工具调用与用户主动触发都必须经过这里，避免各自复制 waiting、取消和结果汇总状态机。
 */
export function spawnWorkflowJob(input: SpawnWorkflowJobInput): SpawnedWorkflowJob {
    const {runId, done} = input.service.startWorkflowRun({
        def: input.def,
        args: input.args,
        callerSessionId: input.callerSessionId,
        model: input.model,
        workspace: input.workspace,
        config: input.config,
        project: input.project,
    });
    let spawned: ReturnType<AgentJobManager["spawn"]>;
    try {
        spawned = input.jobs.spawn({
            kind: "workflow",
            title: `workflow ${input.def.key}`,
            ownerSessionId: input.ownerSessionId,
            originToolCallId: input.originToolCallId,
            ref: {runId, workflowKey: input.def.key},
            deliver: input.deliver,
            detail: async () => {
                if (!input.service.runState) return undefined;
                const state = await input.service.runState(runId, 0);
                const summary = state.summary ?? await input.service.runSummary(runId);
                // RunView 的递归 JsonValue 由 Workflow 内核保证可序列化，这里只改变公开字段形状。
                return {
                    runId,
                    workflowKey: input.def.key,
                    runStatus: state.view.status,
                    pendingAsks: state.view.pendingAsks,
                    sessions: summary.sessions,
                    usage: summary.usage,
                    result: state.view.result ?? null,
                } as unknown as JsonValue;
            },
            onCancel: () => input.service.cancelRun(runId),
            run: async (ctx) => {
                let view = await done;
                while (view.status === "waiting" && !ctx.signal.aborted) {
                    ctx.setWaiting(`等待用户应答：${view.pendingAsks.map((ask) => ask.spec.title).join("；") || "待应答"}`);
                    view = await input.service.waitForRunSettled(runId, ctx.signal, () => ctx.setRunning());
                }
                if (ctx.signal.aborted || view.status === "cancelled") {
                    throw new AgentJobCancelledError();
                }
                if (view.status === "failed") throw new Error(view.error ?? "workflow 失败");
                if (view.status !== "completed") throw new Error("workflow 未完成即停止");
                const summary = await input.service.runSummary(runId);
                const result: WorkflowJobResult = {
                    runId,
                    workflowKey: input.def.key,
                    status: "completed",
                    result: view.result ?? null,
                    sessions: summary.sessions,
                    usage: summary.usage,
                };
                return {
                    resultPreview: `完成：${JSON.stringify(view.result ?? null)}`,
                    result: result as unknown as JsonValue,
                    message: [
                        "[后台 Workflow 完成]",
                        JSON.stringify(result, null, 2),
                        "请根据该结果向用户汇报，或继续后续编排。",
                    ].join("\n"),
                };
            },
        });
    } catch (error) {
        // Run 已在 service 中登记；Job 登记失败时必须补偿取消，不能留下无观测入口的执行。
        input.service.cancelRun(runId);
        throw error;
    }
    const {job, jobEventCursor} = spawned;
    return {job, jobEventCursor, runId};
}
