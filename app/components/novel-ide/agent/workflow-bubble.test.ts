import {describe, expect, it} from "vitest";
import {
    isAgentJobTerminalStatus,
    isWorkflowTerminalStatus,
    parseRunWorkflowArgs,
    parseRunWorkflowDetails,
    resolveWorkflowBubbleError,
    resolveWorkflowBubbleStatus,
    resolveWorkflowDisplaySummary,
    shouldPollWorkflowRun,
    workflowPendingAskSignature,
    workflowPollDelay,
} from "nbook/app/components/novel-ide/agent/workflow-bubble";
import type {PendingAsk} from "nbook/server/vendor/nb-workflow/index";

const usage = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    outputTokens,
    cacheReadTokens: 4,
    cacheWriteTokens: 2,
    cacheWrite1hTokens: 1,
    reasoningTokens: 3,
    totalTokens: inputTokens + outputTokens + 6,
});

describe("workflow bubble view model", () => {
    it("识别默认后台启动 details", () => {
        expect(parseRunWorkflowDetails({
            jobId: "job_abcd1234",
            jobEventCursor: {eventEpoch: "epoch-jobs", after: 12},
            runId: "run-1",
            workflowKey: "split-book",
            status: "started",
            background: true,
        })).toMatchObject({
            jobId: "job_abcd1234",
            jobEventCursor: {eventEpoch: "epoch-jobs", after: 12},
            runId: "run-1",
            status: "started",
            background: true,
        });
    });

    it("兼容运行期 partial 与最终 details", () => {
        expect(parseRunWorkflowDetails({
            runId: "run-1",
            workflowKey: "split-book",
            status: "running",
            chartMermaid: "graph LR\nA-->B",
        })).toMatchObject({runId: "run-1", status: "running"});

        expect(parseRunWorkflowDetails({
            runId: "run-1",
            workflowKey: "split-book",
            status: "completed",
            result: {summary: "done"},
            error: null,
            pendingAsks: [],
            sessions: [{
                sessionId: 12,
                profileKey: "writer.default",
                title: "拆书合并",
                tokens: usage(120, 30),
            }],
            usage: usage(120, 30),
            chartMermaid: "graph LR\nA-->B",
        })).toMatchObject({
            status: "completed",
            result: {summary: "done"},
            usage: usage(120, 30),
            sessions: [{sessionId: 12, tokens: usage(120, 30)}],
        });
    });

    it("拒绝非 workflow details，并容忍流式参数未闭合", () => {
        expect(parseRunWorkflowDetails({status: "running"})).toBeNull();
        expect(parseRunWorkflowArgs('{"workflowKey":"split-book"')).toEqual({});
        expect(parseRunWorkflowArgs('{"workflowKey":"split-book","model":"openai/gpt-5"}')).toEqual({
            workflowKey: "split-book",
            model: "openai/gpt-5",
            script: undefined,
            args: undefined,
            wait: undefined,
        });
    });

    it("completed/failed/cancelled 都停止轮询，waiting 降频", () => {
        expect(isWorkflowTerminalStatus("waiting")).toBe(false);
        expect(isWorkflowTerminalStatus("completed")).toBe(true);
        expect(isWorkflowTerminalStatus("failed")).toBe(true);
        expect(isWorkflowTerminalStatus("cancelled")).toBe(true);
        expect(isAgentJobTerminalStatus("waiting")).toBe(false);
        expect(isAgentJobTerminalStatus("cancelled")).toBe(true);
        expect(isAgentJobTerminalStatus("interrupted")).toBe(true);
        expect(workflowPollDelay("running")).toBe(500);
        expect(workflowPollDelay("waiting")).toBe(2000);
    });

    it("Run 轮询只依赖 Run 与工具启动状态", () => {
        expect(shouldPollWorkflowRun({
            hasBackgroundJob: true,
            runStatus: "running",
        })).toBe(true);
        expect(shouldPollWorkflowRun({
            hasBackgroundJob: true,
            runStatus: "cancelled",
        })).toBe(false);
        expect(shouldPollWorkflowRun({
            hasBackgroundJob: false,
            detailsStatus: "completed",
        })).toBe(false);
    });

    it("后台模式在 Run 可见后以 Run 真实状态为准，Job 只负责尚未观测到 Run 时兜底", () => {
        const base = {
            pendingApproval: false,
            toolCallStatus: "success",
            detailsStatus: "started" as const,
            hasBackgroundJob: true,
        };
        expect(resolveWorkflowBubbleStatus(base)).toBe("starting");
        expect(resolveWorkflowBubbleStatus({...base, runStatus: "waiting"})).toBe("waiting");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "running", runStatus: "completed"})).toBe("completed");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "cancelled", runStatus: "running"})).toBe("running");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "waiting", runStatus: "waiting"})).toBe("waiting");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "completed", runStatus: "completed"})).toBe("completed");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "failed", runStatus: "failed"})).toBe("failed");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "cancelled"})).toBe("cancelled");
        expect(resolveWorkflowBubbleStatus({...base, jobStatus: "running", jobUnavailable: true})).toBe("running");
        expect(resolveWorkflowBubbleStatus({...base, jobUnavailable: true})).toBe("starting");
        expect(resolveWorkflowBubbleStatus({...base, jobUnavailable: true, runStatus: "completed"})).toBe("completed");
    });

    it("Run 可见后 Workflow 错误只使用 Run，启动阶段才回退工具错误", () => {
        expect(resolveWorkflowBubbleError({
            runObserved: true,
            runError: null,
            detailsError: "旧 details 错误",
            toolCallError: "工具错误",
        })).toBe("");
        expect(resolveWorkflowBubbleError({
            runObserved: true,
            runError: "Run 失败",
            detailsError: "旧 details 错误",
        })).toBe("Run 失败");
        expect(resolveWorkflowBubbleError({
            runObserved: false,
            detailsError: "启动失败",
            toolCallError: "工具错误",
        })).toBe("启动失败");
        expect(resolveWorkflowBubbleError({
            runObserved: false,
            toolCallError: "工具错误",
        })).toBe("工具错误");
    });

    it("wait:true 继续按 run 终态，并把刷新后丢失的非终态 run 标为中断", () => {
        expect(resolveWorkflowBubbleStatus({
            pendingApproval: false,
            toolCallStatus: "success",
            detailsStatus: "completed",
            hasBackgroundJob: false,
        })).toBe("completed");
        expect(resolveWorkflowBubbleStatus({
            pendingApproval: false,
            toolCallStatus: "success",
            detailsStatus: "cancelled",
            hasBackgroundJob: false,
        })).toBe("cancelled");
        expect(resolveWorkflowBubbleStatus({
            pendingApproval: false,
            toolCallStatus: "success",
            detailsStatus: "waiting",
            hasBackgroundJob: false,
            runUnavailable: true,
        })).toBe("interrupted");
    });

    it("ask 续跑完成后优先展示终态 RunState summary", () => {
        const waitingDetails = parseRunWorkflowDetails({
            runId: "run-ask",
            status: "waiting",
            sessions: [{sessionId: 1, profileKey: "leader.default", title: "第一段", tokens: null}],
            usage: usage(10, 5),
        });
        const summary = resolveWorkflowDisplaySummary({
            sessions: [
                {sessionId: 1, profileKey: "leader.default", title: "第一段", tokens: usage(10, 5)},
                {sessionId: 2, profileKey: "researcher", title: "续跑分析", tokens: usage(20, 8)},
            ],
            usage: usage(30, 13),
        }, waitingDetails);

        expect(summary.sessions.map((session) => session.sessionId)).toEqual([1, 2]);
        expect(summary.usage).toEqual(usage(30, 13));
    });

    it("保留完整 usage 并拒绝不完整旧结构", () => {
        const full = usage(90, 10);
        expect(parseRunWorkflowDetails({runId: "run-usage", status: "completed", usage: full})?.usage).toEqual(full);
        expect(parseRunWorkflowDetails({
            runId: "run-usage",
            status: "completed",
            usage: {inputTokens: 90, outputTokens: 10},
        })?.usage).toBeUndefined();
    });

    it("ask 阶段指纹区分 resume 后的下一轮问题", () => {
        const ask = (key: string, fingerprint: string): PendingAsk => ({
            key,
            path: "root",
            seq: 1,
            fingerprint,
            spec: {kind: "approve", title: key},
        });
        expect(workflowPendingAskSignature([ask("root#1", "a")])).toBe(workflowPendingAskSignature([ask("root#1", "a")]));
        expect(workflowPendingAskSignature([ask("root#1", "a")])).not.toBe(workflowPendingAskSignature([ask("root#2", "a")]));
    });
});
