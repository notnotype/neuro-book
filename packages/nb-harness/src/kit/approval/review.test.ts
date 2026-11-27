/**
 * 审批模型作审批者（docs/specs/agent/permissions.md 输出 19–21）：强制调用判定工具、放行或转人工、没判出来时转人工并记诊断、
 * 超时、太长的调用不问模型、审批用途没绑模型时用对话模型。模型端口按内核 `ModelCaller` 的形状给定回复；经真实插件的一条留在宿主。
 */

import {describe, expect, test} from "bun:test";

import type {ApprovalCtx, ModelDraft, ModelResponse, ToolSessionContext} from "../../kernel/contracts.js";
import {modelReviewer} from "./review.js";
import type {ReviewRequest} from "./types.js";

const REASONS = {failed: "host/failed", escalatedPrefix: "host/escalated:"};
const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: true};
const request: ReviewRequest = {call: {id: "c", tool: "kit.shell", args: {command: "touch a"}}, effect: "exec", paths: [{access: "write", address: "work://a"}], subjects: []};

type Reply = Partial<ModelResponse> | ((options: {signal?: AbortSignal; sessionModel?: boolean}) => Promise<ModelResponse>);
const verdictReply = (decision: string, reason = "因为如此"): Partial<ModelResponse> => ({stopReason: "tool", toolCalls: [{id: "v", tool: "submit_verdict", args: {decision, reason}}]});

function review(replies: readonly Reply[], options: {readonly timeoutMs?: number; readonly project?: string | null; readonly call?: ReviewRequest["call"]; readonly subjects?: ReviewRequest["subjects"]} = {}) {
    const drafts: {draft: ModelDraft; options: {purpose: string; sessionModel?: boolean}}[] = [];
    const reports: string[] = [];
    let index = 0;
    const ctx = {
        signal: new AbortController().signal,
        sessionId: "s-1",
        context: {sessionId: "s-1", profile: "p"} as ToolSessionContext,
        read: () => undefined,
        model: async (draft: ModelDraft, callOptions: {purpose: string; sessionModel?: boolean; signal?: AbortSignal}) => {
            drafts.push({draft, options: callOptions});
            const reply = replies[index++] ?? {};
            if (typeof reply === "function") return reply(callOptions);
            return {content: [], toolCalls: [], stopReason: "stop", usage, model: "m", ...reply} as ModelResponse;
        },
    } as unknown as ApprovalCtx;
    const reviewer = modelReviewer({
        agentDescription: "a test agent",
        provider: "kit.test",
        projectOf: () => options.project ?? null,
        reasons: REASONS,
        report: (code, _message, params) => void reports.push(`${code}:${String(params?.kind)}`),
        ...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs}),
    });
    return {run: () => reviewer({...request, ...(options.call === undefined ? {} : {call: options.call}), ...(options.subjects === undefined ? {} : {subjects: options.subjects})}, ctx), drafts, reports};
}

describe("审批模型", () => {
    test("输出 19：答放行才放行；请求强制调用判定工具、关思考，称呼与 provider 来自宿主，项目与路径在输入里", async () => {
        const r = review([verdictReply("allow")], {project: "work://project"});
        expect(await r.run()).toEqual({verdict: "allow", by: "mode:auto"});
        const {draft, options} = r.drafts[0]!;
        expect(options.purpose).toBe("approval");
        expect(draft.toolChoice).toEqual({tool: "submit_verdict"});
        expect(draft.params).toMatchObject({disableReasoning: true});
        expect(draft.tools.map((tool) => [tool.id, tool.provider])).toEqual([["submit_verdict", "kit.test"]]);
        expect((draft.system[0] as {text: string}).text).toContain("from a test agent on behalf of its user");
        const input = JSON.parse((draft.messages[0]!.content[0] as {text: string}).text) as {project: string; pending_action: {paths: unknown}};
        expect(input.project).toBe("work://project");
        expect(input.pending_action.paths).toEqual(request.paths);
    });

    test("输出 21：答转人工：转问，带上模型的理由（接在宿主给的前缀后面）", async () => {
        expect(await review([verdictReply("escalate", "要删远端分支")]).run()).toEqual({verdict: "ask", reason: "host/escalated:要删远端分支"});
    });

    test("输出 19、21：没判出来（形状不对、服务商出错）转人工，记一条诊断", async () => {
        const garbage = review([{stopReason: "stop"}]);
        expect(await garbage.run()).toEqual({verdict: "ask", reason: REASONS.failed});
        expect(garbage.reports).toEqual(["permission-auto-failed:stop"]);
        const wrongTool = review([{stopReason: "tool", toolCalls: [{id: "v", tool: "other", args: {}}]}]);
        expect(await wrongTool.run()).toEqual({verdict: "ask", reason: REASONS.failed});
    });

    test("输出 19：审批用途没绑模型时改用对话模型再问一次", async () => {
        const r = review([{stopReason: "error", error: {kind: "local", code: "role-unbound", message: "x"}} as Partial<ModelResponse>, verdictReply("allow")]);
        expect(await r.run()).toEqual({verdict: "allow", by: "mode:auto"});
        expect(r.drafts.map((item) => item.options.sessionModel === true)).toEqual([false, true]);
    });

    test("超时：转人工，不放行", async () => {
        const never: Reply = (callOptions) => new Promise((resolve) => {
            callOptions.signal!.addEventListener("abort", () => resolve({content: [], toolCalls: [], stopReason: "aborted", usage, model: "m"}));
        });
        const r = review([never], {timeoutMs: 5});
        expect(await r.run()).toEqual({verdict: "ask", reason: REASONS.failed});
        expect(r.reports).toEqual(["permission-auto-failed:timeout"]);
    });

    test("输出 20：路径与命令之外的判定对象也交给审批模型，算进这次调用的长度", async () => {
        const shown = review([verdictReply("allow")], {subjects: [{kind: "screen", value: "element"}]});
        expect(await shown.run()).toEqual({verdict: "allow", by: "mode:auto"});
        const input = JSON.parse((shown.drafts[0]!.draft.messages[0]!.content[0] as {text: string}).text) as {pending_action: {subjects?: unknown}};
        expect(input.pending_action.subjects).toEqual([{kind: "screen", value: "element"}]);
        const long = review([verdictReply("allow")], {subjects: [{kind: "screen", value: "x".repeat(20_000)}]});
        expect(await long.run()).toEqual({verdict: "ask", reason: REASONS.failed});
        expect(long.drafts).toHaveLength(0);
    });

    test("输出 20：这次调用太长不问模型，直接转人工", async () => {
        const r = review([verdictReply("allow")], {call: {id: "c", tool: "kit.write", args: {content: "x".repeat(20_000)}}});
        expect(await r.run()).toEqual({verdict: "ask", reason: REASONS.failed});
        expect(r.drafts).toHaveLength(0);
        expect(r.reports).toEqual(["permission-auto-failed:too-long"]);
    });
});
