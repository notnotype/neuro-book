import {WORKFLOW_DEMO_PROFILE_PREFIX} from "nbook/server/agent/workflow/workflow-session-port";
import type {AgentInvokeOutcome, AgentInvokeUsage, AgentPort, EntryId, InvokeOptions, JsonValue, SessionId, SessionPort} from "@notnotype/nb-workflow";
import type {MockAgentPort} from "@notnotype/nb-workflow";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";

/**
 * 真实 AgentPort：一次 invoke = 一轮真实 harness 调用（真 profile、真模型、真工具）。
 *
 * - F2 锚定：invoke 前若 session 当前 leaf ≠ 游标，先 moveLeaf 回游标（run 持锁期间无人竞争）；
 * - harness 自己写入本轮全部 entry（用户输入 origin=prompt、助手回复等），端口只读回新 leaf；
 * - status=error → throw（内核 F4 只 journal 成功）；admission 排队意味着 session 被并发占用，
 *   与 run 持锁假设冲突，直接报错暴露。
 */
export class HarnessAgentPort implements AgentPort {
    constructor(private harness: NeuroAgentHarness) {}

    async profileInfo(profileKey: string): Promise<JsonValue> {
        return {profileKey};
    }

    async invoke(sessionId: SessionId, fromLeaf: EntryId | null, opts: InvokeOptions): Promise<AgentInvokeOutcome> {
        const before = await this.harness.repo.readSession(sessionId);
        if ((before.leafId ?? null) !== fromLeaf) {
            await this.harness.repo.moveLeaf(sessionId, fromLeaf);
        }
        const result = await this.harness.invokeAgent({
            sessionId,
            mode: opts.mode ?? "prompt",
            ...(opts.message === undefined || opts.message === null ? {} : {message: {text: opts.message}}),
            ...(opts.input === undefined ? {} : {payload: opts.input}),
            caller: {kind: "user"},
            block: true,
            signal: opts.signal,
        });
        if (result.queuedItem) {
            throw new Error(`session ${sessionId} 的 invocation 被排队：workflow run 期望独占该 session`);
        }
        if (result.status === "error") {
            throw new Error(result.error ?? `session ${sessionId} invocation 失败`);
        }
        const after = await this.harness.repo.readSession(sessionId);
        const usage: AgentInvokeUsage | null = result.usage ? {
            inputTokens: result.usage.input,
            outputTokens: result.usage.output,
            cacheReadTokens: result.usage.cacheRead,
            cacheWriteTokens: result.usage.cacheWrite,
            ...(result.usage.cacheWrite1h === undefined ? {} : {cacheWrite1hTokens: result.usage.cacheWrite1h}),
            ...(result.usage.reasoning === undefined ? {} : {reasoningTokens: result.usage.reasoning}),
            totalTokens: result.usage.totalTokens,
            cost: {
                input: result.usage.cost.input,
                output: result.usage.cost.output,
                cacheRead: result.usage.cost.cacheRead,
                cacheWrite: result.usage.cost.cacheWrite,
                total: result.usage.cost.total,
            },
        } : null;
        return {
            status: result.status,
            message: result.reportResult?.result ?? result.finalMessage ?? "",
            data: result.reportResult?.data ?? null,
            newLeaf: after.leafId,
            // 本轮 token 用量：随 journal 持久，run 级汇总（Task 111 返回契约）
            usage,
        };
    }
}

/**
 * 按 profileKey 前缀分流的 AgentPort：`workflow.demo.*` → mock responder，其余 → 真实 harness。
 * 让同一个 workflow 内核实例同时承载确定性演示场景与真实 agent 场景。
 */
export class RoutingAgentPort implements AgentPort {
    constructor(
        private mock: MockAgentPort,
        private real: HarnessAgentPort,
        /** 查 sessionId → profileKey（分流依据） */
        private sessions: SessionPort,
        private mockOnly: boolean,
    ) {}

    private pick(profileKey: string): AgentPort {
        if (profileKey.startsWith(WORKFLOW_DEMO_PROFILE_PREFIX)) return this.mock;
        if (this.mockOnly) throw new Error(`真实 agent 调用未启用（profile: ${profileKey}）`);
        return this.real;
    }

    async profileInfo(profileKey: string): Promise<JsonValue> {
        return this.pick(profileKey).profileInfo(profileKey);
    }

    async invoke(sessionId: SessionId, fromLeaf: EntryId | null, opts: InvokeOptions): Promise<AgentInvokeOutcome> {
        const {profileKey} = await this.sessions.meta(sessionId);
        return this.pick(profileKey).invoke(sessionId, fromLeaf, opts);
    }
}
