import {Type} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {loadEffectiveConfigFromTarget} from "nbook/server/config/config-service";
import type {RuntimeConfigTarget} from "nbook/server/config/types";
import {assertVisibleModel, resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";
import {spawnWorkflowJob} from "nbook/server/agent/workflow/workflow-job";
import {createProjectWorkflowWorkspace} from "nbook/server/agent/workflow/workflow-workspace-port";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {WorkflowDefinition, WorkspacePort} from "nbook/server/vendor/nb-workflow/index";
import type {WorkflowUsage} from "nbook/server/agent/workflow/workflow-demo-service";

const RunWorkflowSchema = Type.Object({
    workflowKey: Type.Optional(Type.String({
        description: "Key of a catalog workflow (see WorkflowCatalog in your context). Exactly one of workflowKey / script is required.",
    })),
    script: Type.Optional(Type.String({
        description: "Inline workflow TypeScript source: `export default {key, title, phases?, run}` with a `run(wf, args)` function. Read reference/agent/workflow/ docs before writing one.",
    })),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "Arguments object passed to the workflow run(wf, args). Pass a real object, not a JSON string.",
    })),
    model: Type.Optional(Type.String({
        description: "Default model for agent sessions created by this workflow, as provider/model key. Must be one of the user-approved visible models listed in your context. Omit to use each profile's default.",
    })),
    wait: Type.Optional(Type.Boolean({
        description: "Default false: run in background, tool returns jobId immediately and the result arrives later as a follow-up message. Set true only for short inline workflows where you need the result in this very turn.",
    })),
});

/** run_workflow 工具返回契约（details）：workflow 自定义结果 + session/token 元数据（Task 111 拍板） */
type RunWorkflowDetails = {
    runId: string;
    workflowKey: string;
    status: string;
    /** workflow return 值；waiting/failed 时为空 */
    result: JsonValue | null;
    error: string | null;
    /** 等待用户应答的 ask 标题（status=waiting 时非空） */
    pendingAsks: string[];
    sessions: {sessionId: number; profileKey: string; title: string; tokens: WorkflowUsage | null}[];
    usage: WorkflowUsage;
    /** 终态状态图（wf.chart 投影；气泡静态兜底） */
    chartMermaid: string | null;
};

/** 从 invocation admission 复用 exact Project generation。 */
function resolveWorkflowTarget(context: ToolExecutionContext): RuntimeConfigTarget {
    if (!context.invocationId) {
        throw new Error("Workflow工具缺少invocationId，无法读取已捕获的Project generation。");
    }
    return context.harness.configTargetForInvocation(context.invocationId);
}

/**
 * run_workflow：运行一个 catalog workflow 或 agent 现写的内联 workflow 脚本（Task 111 面 B）。
 *
 * - approvalRequired：每次运行都要用户审批（脚本可编排多 agent 与真实模型调用）；
 * - model 只能选 agent 可见模型清单内的 key（唯一真相源 resolveAgentVisibleModels）；
 * - 默认后台路径即时返回 jobId + runId，前端分别观察 Job 生命周期与 Run 状态图；
 * - wait:true 才通过 onUpdate 周期推送状态图 partial，父 invocation 取消会传播到该 run；
 * - waiting（wf.ask 挂起）由 Job 保持 waiting，应答走 workflow run API/气泡，不占用原工具调用。
 */
export function createWorkflowTools() {
    const runWorkflow = defineAgentTool({
        key: "run_workflow",
        description: "Run a multi-agent workflow: either a catalog workflow by workflowKey, or an inline workflow script you wrote. Runs in background by default: returns jobId+runId immediately, the result arrives later as a follow-up message — start it, tell the user, and end your turn. Authoring guide: reference/agent/workflow/. Requires user approval.",
        parameters: RunWorkflowSchema,
        approvalRequired: true,
        async executeWithContext(context, toolCallId, params, _userInput, signal, onUpdate): Promise<NeuroToolResult> {
            const input = params as {workflowKey?: string; script?: string; args?: Record<string, unknown>; model?: string; wait?: boolean};
            if (Boolean(input.workflowKey) === Boolean(input.script)) {
                throw new Error("workflowKey 与 script 必须二选一");
            }
            const target = resolveWorkflowTarget(context);

            // 解析 workflow 定义：catalog 目录名寻址 / 内联脚本即时编译
            let def: WorkflowDefinition;
            if (input.workflowKey) {
                const item = await context.harness.workflows.get(input.workflowKey, target.project?.workspace);
                if (!item) {
                    const known = (await context.harness.workflows.list(target.project?.workspace)).map((w) => w.key).join("、") || "（空）";
                    throw new Error(`workflow ${input.workflowKey} 不存在。当前可用：${known}`);
                }
                def = item.def;
            } else {
                def = context.harness.workflows.compileInline(input.script!);
            }

            // 模型校验：只能从用户配置的 agent 可见模型清单里选
            const config = await loadEffectiveConfigFromTarget(target);
            if (input.model) assertVisibleModel(config, input.model);

            // 循环依赖规避：tools/index 由 harness 引入，service 又引入 http(useAgentHarness)，执行期动态加载
            const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
            const service = useWorkflowDemoService();
            const args = (input.args ?? null) as JsonValue;
            const workspace: WorkspacePort | undefined = target.project
                ? createProjectWorkflowWorkspace(target.project.workspace)
                : undefined;

            // 默认后台（PLAN-E）：立即返回 jobId+runId，结果以 followup 消息回流；wait:true 走阻塞路径
            if (input.wait !== true) {
                const {job, jobEventCursor, runId} = spawnWorkflowJob({
                    jobs: context.harness.jobs,
                    service,
                    def,
                    args,
                    callerSessionId: context.sessionId,
                    model: input.model,
                    workspace,
                    config,
                    project: target.project,
                    ownerSessionId: context.sessionId,
                    originToolCallId: toolCallId,
                });
                return {
                    content: [{type: "text", text: [
                        `后台 workflow 已启动：${job.jobId}（run ${runId}，${def.key}）。`,
                        "结果将以后续消息自动回流到本会话。现在向用户简述已启动的任务并正常收尾本回合，不要轮询等待。",
                    ].join("\n")}],
                    details: normalizeToolResultDetails({
                        jobId: job.jobId,
                        jobEventCursor,
                        runId,
                        workflowKey: def.key,
                        status: "started",
                        background: true,
                    }),
                };
            }

            const {runId, done, terminal} = service.startWorkflowRun({
                def,
                args,
                callerSessionId: context.sessionId,
                model: input.model,
                workspace,
                config,
                project: target.project,
                signal,
            });

            // 运行期心跳：把 runId 与最新状态图推给前端气泡（partial details，不进最终 truth）
            const heartbeat = onUpdate ? setInterval(() => {
                void (async () => {
                    try {
                        const state = await service.runState(runId, 0);
                        onUpdate({
                            content: [{type: "text", text: `workflow ${def.key} 运行中…`}],
                            details: normalizeToolResultDetails({runId, workflowKey: def.key, status: "running", chartMermaid: state.machineMermaid}),
                        });
                    } catch {
                        // 心跳失败不影响 run 本身
                    }
                })();
            }, 1200) : null;

            let view;
            try {
                view = await done;
            } finally {
                if (heartbeat) clearInterval(heartbeat);
            }

            if (view.status === "waiting" || view.pendingAsks.length > 0) {
                // wait:true 没有 Job/Composer 收件箱，不能留下无法继续的 waiting Run。
                service.cancelRun(runId);
                await terminal;
                throw new Error(`workflow ${def.key} 在 wait:true 下需要用户应答；该 Run 已取消，请改用默认后台模式。`);
            }

            const summary = await service.runSummary(runId);
            const state = await service.runState(runId, 0);
            const details: RunWorkflowDetails = {
                runId,
                workflowKey: def.key,
                status: view.status,
                result: view.result ?? null,
                error: view.error ?? null,
                pendingAsks: view.pendingAsks.map((ask) => ask.spec.title),
                sessions: summary.sessions,
                usage: summary.usage,
                chartMermaid: state.machineMermaid,
            };

            const usageText = summary.usage.totalTokens > 0
                ? `token 用量 total ${summary.usage.totalTokens}（in ${summary.usage.inputTokens} / out ${summary.usage.outputTokens} / cache read ${summary.usage.cacheReadTokens} / cache write ${summary.usage.cacheWriteTokens}）`
                : "无 token 用量记录";
            const lines: string[] = [];
            if (view.status === "completed") {
                lines.push(`workflow ${def.key} 已完成（run ${runId}）。`);
                lines.push(`结果：${JSON.stringify(view.result ?? null)}`);
            } else if (view.status === "cancelled") {
                lines.push(`workflow ${def.key} 已取消（run ${runId}）。`);
            } else {
                lines.push(`workflow ${def.key} 失败（run ${runId}）：${view.error ?? "未知错误"}`);
            }
            lines.push(`触达 session：${summary.sessions.map((s) => `#${s.sessionId} ${s.title || s.profileKey}`).join("、") || "无"}；${usageText}。`);
            return {
                content: [{type: "text", text: lines.join("\n")}],
                details: normalizeToolResultDetails(details as unknown as JsonValue),
            };
        },
    });

    const listWorkflows = defineAgentTool({
        key: "list_workflows",
        description: "List available workflows (key, title, whenToUse) and refresh the user-approved visible models you may pass to run_workflow or invoke_agent.",
        parameters: Type.Object({}),
        async executeWithContext(context): Promise<NeuroToolResult> {
            const target = resolveWorkflowTarget(context);
            const items = await context.harness.workflows.list(target.project?.workspace);
            const config = await loadEffectiveConfigFromTarget(target);
            const models = resolveAgentVisibleModels(config);
            const lines = [
                "可用 workflow：",
                ...items.map((w) => `- ${w.key}：${w.title}${w.whenToUse ? `（适用：${w.whenToUse}）` : ""}`),
                "",
                "可指定模型：",
                ...models.map((m) => `- ${m.modelKey}${m.note ? ` —— ${m.note}` : ""}`),
            ];
            return {
                content: [{type: "text", text: lines.join("\n")}],
                details: normalizeToolResultDetails({
                    workflows: items.map((w) => ({key: w.key, title: w.title, description: w.description, whenToUse: w.whenToUse ?? null, source: w.source})),
                    models: models.map((m) => ({modelKey: m.modelKey, note: m.note})),
                } as JsonValue),
            };
        },
    });

    return {runWorkflow, listWorkflows};
}
