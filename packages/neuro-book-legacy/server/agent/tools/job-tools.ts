import {Type} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroToolResult} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {AgentJobSnapshot} from "nbook/server/agent/jobs/agent-job-manager";

/** job 快照 → 列表行文本（agent 可读） */
function jobLine(job: AgentJobSnapshot): string {
    const when = new Date(job.createdAt).toLocaleTimeString("zh-CN", {hour12: false});
    return `- ${job.jobId} [${job.status}] ${job.kind}：${job.title}（${when} 启动）${job.preview ? ` — ${job.preview}` : ""}${job.error ? ` — 错误：${job.error}` : ""}`;
}

/**
 * 后台任务管理工具（Task 111 PLAN-E）：list_jobs / get_job / cancel_job。
 * 纪律：后台任务结果会自动以后续消息回流，这些工具用于用户主动询问进度或要求取消时，不要空转轮询。
 */
export function createJobTools() {
    const listJobs = defineAgentTool({
        key: "list_jobs",
        description: "List background jobs (workflows, background bash, background agent invocations). Defaults to jobs started from the current session; set all=true to list every job. Results arrive automatically as follow-up messages — do not poll this in a loop.",
        parameters: Type.Object({
            all: Type.Optional(Type.Boolean({description: "Default false: only jobs owned by the current session."})),
            status: Type.Optional(Type.Union([
                Type.Literal("running"), Type.Literal("waiting"), Type.Literal("completed"),
                Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("interrupted"),
            ])),
        }),
        async executeWithContext(context, _toolCallId, params): Promise<NeuroToolResult> {
            await context.harness.jobs.recoverInterrupted();
            const input = params as {all?: boolean; status?: AgentJobSnapshot["status"]};
            const jobs = context.harness.jobs.list({
                ownerSessionId: input.all ? undefined : context.sessionId,
                status: input.status,
            });
            return {
                content: [{type: "text", text: jobs.length === 0 ? "当前没有匹配的后台任务。" : jobs.map(jobLine).join("\n")}],
                details: normalizeToolResultDetails({jobs} as unknown as JsonValue),
            };
        },
    });

    const getJob = defineAgentTool({
        key: "get_job",
        description: "Get one background job's complete detail. Completed workflows return the exact same full JSON result as their completion notification; never poll it merely to wait for completion.",
        parameters: Type.Object({
            jobId: Type.String(),
        }),
        async executeWithContext(context, _toolCallId, params): Promise<NeuroToolResult> {
            await context.harness.jobs.recoverInterrupted();
            const input = params as {jobId: string};
            const job = await context.harness.jobs.get(input.jobId);
            if (!job) throw new Error(`job ${input.jobId} 不存在（已完成任务会在重启后保留；旧登记表中没有终态结果的任务不可查询）`);
            return {
                content: [{type: "text", text: JSON.stringify(job, null, 2)}],
                details: normalizeToolResultDetails({job} as unknown as JsonValue),
            };
        },
    });

    const cancelJob = defineAgentTool({
        key: "cancel_job",
        description: "Request cancellation of a background job started from the current session. Agent invocations use Harness bounded cancellation, workflows propagate cancellation to their current agent activities, and the final cancelled status is confirmed after the execution chain settles.",
        parameters: Type.Object({
            jobId: Type.String(),
        }),
        async executeWithContext(context, _toolCallId, params): Promise<NeuroToolResult> {
            await context.harness.jobs.recoverInterrupted();
            const input = params as {jobId: string};
            const job = await context.harness.jobs.get(input.jobId);
            if (!job) throw new Error(`job ${input.jobId} 不存在`);
            if (job.ownerSessionId !== context.sessionId) {
                throw new Error(`job ${input.jobId} 不是本 session 发起的，不能取消`);
            }
            const cancelled = await context.harness.jobs.cancel(input.jobId);
            return {
                content: [{type: "text", text: `已请求取消 ${cancelled.jobId}（当前状态 ${cancelled.status}）。取消信号已向执行链传播，最终 cancelled 状态将在 Agent invocation、Workflow Run 或外部进程完成收口后确认。`}],
                details: normalizeToolResultDetails({job: cancelled} as unknown as JsonValue),
            };
        },
    });

    return {listJobs, getJob, cancelJob};
}
