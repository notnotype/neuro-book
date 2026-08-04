import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";
import {spawnWorkflowJob} from "nbook/server/agent/workflow/workflow-job";
import type {WorkflowRunStart} from "nbook/server/agent/workflow/workflow-demo-service";
import type {ActivityRecord, AgentInvokeUsage, JsonValue, PendingAsk, RunView, WorkflowDefinition} from "nbook/server/vendor/nb-workflow/index";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

describe("WorkflowDemoService terminal summary", () => {
    const serviceGlobal = globalThis as typeof globalThis & {workflowDemoService?: unknown};
    const zeroUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
    };
    let generationController: AbortController;
    let leasedCompletion: Promise<void> | undefined;
    let harnessProvider: () => object;
    let startReadyProjectOperation: ReturnType<typeof vi.fn<(
        ready: ReadyProjectSessionRef,
        start: (signal: AbortSignal) => {result: WorkflowRunStart; completion: Promise<void>},
    ) => WorkflowRunStart>>;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        delete serviceGlobal.workflowDemoService;
        generationController = new AbortController();
        leasedCompletion = undefined;
        startReadyProjectOperation = vi.fn((_ready, start) => {
            const operation = start(generationController.signal);
            leasedCompletion = operation.completion;
            return operation.result;
        });
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            startReadyProjectOperation,
        }));
        harnessProvider = () => ({
            repo: {readSession: vi.fn()},
            createAgent: vi.fn(),
        });
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: () => harnessProvider(),
        }));
    });

    afterEach(() => {
        delete serviceGlobal.workflowDemoService;
        vi.restoreAllMocks();
    });

    it("waiting 不读取 summary，resume 完成后的 RunState 带终态 summary", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const definition: WorkflowDefinition = {
            key: "ask-then-complete",
            run: async (wf) => ({answer: await wf.ask({kind: "approve", title: "继续"})}),
        };
        const {runId, done, terminal} = service.startWorkflowRun({def: definition, args: null, config: createDefaultEffectiveConfig(), project: null});
        const waiting = await done;
        expect(waiting.status).toBe("waiting");
        const ask = waiting.pendingAsks[0];
        expect(ask).toBeDefined();
        expect(await Promise.race([
            terminal.then(() => "settled"),
            Promise.resolve("pending"),
        ])).toBe("pending");

        const summarySpy = vi.spyOn(service, "runSummary");
        const waitingState = await service.runState(runId, 0);
        expect(waitingState.summary).toBeUndefined();
        expect(summarySpy).not.toHaveBeenCalled();

        service.resume(runId, {[ask!.key]: true});
        await terminal;
        await vi.waitFor(() => {
            expect(service.listRuns().find((run) => run.runId === runId)?.status).toBe("completed");
        });
        const completedState = await service.runState(runId, waitingState.nextCursor);
        expect(completedState.summary).toEqual({
            sessions: [],
            usage: zeroUsage,
        });
        expect(summarySpy).toHaveBeenCalledTimes(1);
    });

    it("resume 校验所有 ask 类型、选项与 key，并保证非法请求不触碰 journal", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const journal: ActivityRecord[] = [{
            key: "root#1",
            path: "root",
            seq: 1,
            kind: "workflow.marker",
            fingerprint: "{}",
            result: {before: true},
        }];
        let currentView: RunView;
        const resume = vi.fn(async () => undefined);
        const runner = {
            view: vi.fn(() => currentView),
            resume,
        };
        (service as unknown as {runner: typeof runner}).runner = runner;
        const waiting = (pendingAsks: PendingAsk[]): RunView => ({
            runId: "run-resume-validation",
            workflowKey: "resume-validation",
            status: "waiting",
            pendingAsks,
            logs: [],
            progress: null,
            journal,
        });
        const approve: PendingAsk = {
            key: "approve",
            path: "root",
            seq: 1,
            fingerprint: "{}",
            spec: {kind: "approve", title: "确认"},
        };
        const single: PendingAsk = {
            key: "single",
            path: "root",
            seq: 2,
            fingerprint: "{}",
            spec: {kind: "select", title: "选择一个", options: [{id: "a", label: "A"}, {id: "b", label: "B"}]},
        };
        const multi: PendingAsk = {
            key: "multi",
            path: "root",
            seq: 3,
            fingerprint: "{}",
            spec: {kind: "select", title: "选择多个", multi: true, options: [{id: "a", label: "A"}, {id: "b", label: "B"}]},
        };
        const text: PendingAsk = {
            key: "text",
            path: "root",
            seq: 4,
            fingerprint: "{}",
            spec: {kind: "text", title: "补充说明"},
        };

        currentView = waiting([approve]);
        service.resume(currentView.runId, {approve: false});
        expect(resume).toHaveBeenCalledWith(currentView.runId, {approve: false});

        resume.mockClear();
        currentView = waiting([single]);
        service.resume(currentView.runId, {single: "b"});
        expect(resume).toHaveBeenCalledWith(currentView.runId, {single: "b"});

        const invalidSingleAnswers: Array<[Record<string, JsonValue>, string]> = [
            [{single: "unknown"}, "必须选择声明的选项"],
            [{single: ["a"]}, "必须选择声明的选项"],
        ];
        for (const [answers, message] of invalidSingleAnswers) {
            resume.mockClear();
            const before = [...journal];
            currentView = waiting([single]);
            expect(() => service.resume(currentView.runId, answers)).toThrow(message);
            expect(resume).not.toHaveBeenCalled();
            expect(journal).toEqual(before);
        }

        resume.mockClear();
        currentView = waiting([multi]);
        service.resume(currentView.runId, {multi: ["a", "b"]});
        expect(resume).toHaveBeenCalledWith(currentView.runId, {multi: ["a", "b"]});
        const invalidMultiAnswers: Array<Record<string, JsonValue>> = [{multi: "a"}, {multi: ["unknown"]}, {multi: []}];
        for (const answers of invalidMultiAnswers) {
            resume.mockClear();
            const before = [...journal];
            currentView = waiting([multi]);
            expect(() => service.resume(currentView.runId, answers)).toThrow("必须选择声明的一个或多个选项");
            expect(resume).not.toHaveBeenCalled();
            expect(journal).toEqual(before);
        }

        resume.mockClear();
        currentView = waiting([text]);
        service.resume(currentView.runId, {text: "有内容"});
        expect(resume).toHaveBeenCalledWith(currentView.runId, {text: "有内容"});
        for (const answer of ["", "   ", 42] as const) {
            resume.mockClear();
            const before = [...journal];
            currentView = waiting([text]);
            expect(() => service.resume(currentView.runId, {text: answer})).toThrow("必须填写非空文本");
            expect(resume).not.toHaveBeenCalled();
            expect(journal).toEqual(before);
        }

        const invalidKeyAnswers: Array<Record<string, JsonValue>> = [{approve: true, extra: true}, {extra: true}];
        for (const answers of invalidKeyAnswers) {
            resume.mockClear();
            const before = [...journal];
            currentView = waiting([approve]);
            expect(() => service.resume(currentView.runId, answers)).toThrow(/未知 ask 应答|缺少 ask 应答/);
            expect(resume).not.toHaveBeenCalled();
            expect(journal).toEqual(before);
        }

        for (const answers of [[], "true", 1, null] as JsonValue[]) {
            resume.mockClear();
            const before = [...journal];
            currentView = waiting([approve]);
            expect(() => service.resume(currentView.runId, answers)).toThrow("workflow 应答必须是对象");
            expect(resume).not.toHaveBeenCalled();
            expect(journal).toEqual(before);
        }
    });

    it("Project generation signal在waiting期间取消Run并解除最终terminal", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const project = {workspace: {ref: {projectRoot: "generation-cancel"}}} as never;
        const invocationController = new AbortController();
        const definition: WorkflowDefinition = {
            key: "generation-cancel-waiting",
            run: async (wf) => ({answer: await wf.ask({kind: "approve", title: "等待Project关闭"})}),
        };
        const {runId, done, terminal} = service.startWorkflowRun({
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project,
            signal: invocationController.signal,
        });

        await expect(done).resolves.toMatchObject({status: "waiting"});
        expect(startReadyProjectOperation).toHaveBeenCalledWith(project, expect.any(Function));
        expect(leasedCompletion).toBe(terminal);
        generationController.abort(new Error("Project generation关闭"));
        await terminal;

        await expect(service.runState(runId, 0)).resolves.toMatchObject({
            view: {status: "cancelled"},
        });
        expect(() => service.resume(runId, {})).toThrow(`run ${runId} 非 waiting 状态`);
    });

    it("failed RunState 同样带终态 summary", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const definition: WorkflowDefinition = {
            key: "fail",
            run: async () => {
                throw new Error("预期失败");
            },
        };
        const project = {workspace: {ref: {projectRoot: "failed-project"}}} as never;
        const {runId, done, terminal} = service.startWorkflowRun({def: definition, args: null, config: createDefaultEffectiveConfig(), project});
        await expect(done).resolves.toMatchObject({status: "failed", error: "预期失败"});
        expect(startReadyProjectOperation).toHaveBeenCalledWith(project, expect.any(Function));
        expect(leasedCompletion).toBe(terminal);
        await expect(terminal).resolves.toBeUndefined();

        await expect(service.runState(runId, 0)).resolves.toMatchObject({
            summary: {
                sessions: [],
                usage: zeroUsage,
            },
        });
    });

    it("启动时保留首个同步 status 事件", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const definition: WorkflowDefinition = {
            key: "sync-complete",
            run: async () => ({ok: true}),
        };
        const {runId, done} = service.startWorkflowRun({def: definition, args: null, config: createDefaultEffectiveConfig(), project: null});
        await done;

        const state = await service.runState(runId, 0);
        expect(state.events[0]).toMatchObject({type: "status", status: "running"});
        expect(state.events.at(-1)).toMatchObject({type: "status", status: "completed"});
        expect(() => service.rerun(runId)).toThrow(`正式workflow run不支持rerun：${runId}`);
    });

    it("runSummary 累加多 session、多轮 invocation 与完整 cache/reasoning/cost 用量", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const usage = (inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, reasoningTokens: number, cost: AgentInvokeUsage["cost"]): AgentInvokeUsage => ({
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            cacheWrite1hTokens: cacheWriteTokens + 1,
            reasoningTokens,
            totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
            cost,
        });
        const firstTurn = usage(100, 40, 10, 5, 3, {input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, total: 3.3});
        const secondTurn = usage(20, 8, 2, 1, 1, {input: 0.2, output: 0.4, cacheRead: 0.02, cacheWrite: 0.04, total: 0.66});
        const otherSessionTurn = usage(50, 15, 0, 4, 0, {input: 0.5, output: 0.75, cacheRead: 0, cacheWrite: 0.08, total: 1.33});
        const {cost: _otherSessionCost, ...otherSessionTokens} = otherSessionTurn;
        const journal: ActivityRecord[] = [
            {
                key: "root#1",
                path: "root",
                seq: 1,
                kind: "agents.create",
                fingerprint: JSON.stringify({profileKey: "writer.default"}),
                result: {sessionId: 11},
            },
            {
                key: "root#2",
                path: "root",
                seq: 2,
                kind: "agents.create",
                fingerprint: JSON.stringify({profileKey: "researcher"}),
                result: {sessionId: 22},
            },
            {
                key: "root#3",
                path: "root",
                seq: 3,
                kind: "agents.create",
                fingerprint: JSON.stringify({profileKey: "no-call"}),
                result: {sessionId: 33},
            },
            {
                key: "root#4",
                path: "root",
                seq: 4,
                kind: "agents.invoke",
                fingerprint: JSON.stringify({id: 11}),
                result: {usage: firstTurn},
            },
            {
                key: "root#5",
                path: "root",
                seq: 5,
                kind: "agents.invoke",
                fingerprint: JSON.stringify({id: 11}),
                result: {usage: secondTurn},
            },
            {
                key: "root#6",
                path: "root",
                seq: 6,
                kind: "agents.invoke",
                fingerprint: JSON.stringify({id: 22}),
                result: {usage: otherSessionTurn},
            },
            {
                key: "root#7",
                path: "root",
                seq: 7,
                kind: "workflow.result",
                fingerprint: "{}",
                result: {cost: {total: 9}, data: {cost: "user-defined-cost"}},
            },
        ];
        const view: RunView = {
            runId: "run-usage",
            workflowKey: "usage",
            status: "completed",
            pendingAsks: [],
            logs: [],
            progress: null,
            journal,
        };
        const invocationEvent = {
            event: {type: "activity", runId: "run-usage", record: journal[3]!, cached: false},
            at: 1,
        };
        const customEvent = {
            event: {type: "activity", runId: "run-usage", record: journal[6]!, cached: false},
            at: 2,
        };
        const events = [invocationEvent, customEvent];
        const internals = service as unknown as {
            runner: {view(runId: string): RunView};
            buffers: Map<string, {after: (after: number) => {events: typeof events; nextCursor: number}; all: () => typeof events}>;
        };
        internals.runner = {view: () => view};
        internals.buffers = new Map([["run-usage", {
            after: () => ({events, nextCursor: events.length}),
            all: () => events,
        }]]);

        const summary = await service.runSummary("run-usage");
        expect(summary).toMatchObject({
            sessions: [
                {sessionId: 11, profileKey: "writer.default", title: "", tokens: {
                    inputTokens: 120,
                    outputTokens: 48,
                    cacheReadTokens: 12,
                    cacheWriteTokens: 6,
                    cacheWrite1hTokens: 8,
                    reasoningTokens: 4,
                    totalTokens: 186,
                }},
                {sessionId: 22, profileKey: "researcher", title: "", tokens: otherSessionTokens},
                {sessionId: 33, profileKey: "no-call", title: "", tokens: null},
            ],
            usage: {
                inputTokens: 170,
                outputTokens: 63,
                cacheReadTokens: 12,
                cacheWriteTokens: 10,
                cacheWrite1hTokens: 13,
                reasoningTokens: 4,
                totalTokens: 255,
            },
        });

        const publicState = await service.runState("run-usage", 0);
        const publicInvocation = publicState.view.journal.find((record) => record.key === "root#4");
        expect(publicInvocation?.result).toEqual({usage: expect.not.objectContaining({cost: expect.anything()})});
        expect(publicState.events.find((event) => event.type === "activity" && event.record.key === "root#4")).toEqual(expect.objectContaining({
            type: "activity",
            record: expect.objectContaining({result: {usage: expect.not.objectContaining({cost: expect.anything()})}}),
        }));
        expect(publicState.view.journal.find((record) => record.key === "root#7")?.result).toEqual({
            cost: {total: 9},
            data: {cost: "user-defined-cost"},
        });
        expect(publicState.events.find((event) => event.type === "activity" && event.record.key === "root#7")).toEqual(expect.objectContaining({
            type: "activity",
            record: expect.objectContaining({result: {cost: {total: 9}, data: {cost: "user-defined-cost"}}}),
        }));
    });

    it("workflow job 保存超过 4000 字符的完整 JSON，不使用 code fence", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const largeText = "大结果".repeat(3_000);
        const definition: WorkflowDefinition = {
            key: "large-result",
            run: async () => ({text: largeText}),
        };
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试 job 不应请求 harness 回流");
        }, "");
        const {job} = spawnWorkflowJob({
            jobs,
            service,
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project: null,
            deliver: "none",
        });
        await jobs.waitIdle();

        const detail = (await jobs.get(job.jobId))!;
        expect(detail.result).toMatchObject({
            workflowKey: "large-result",
            status: "completed",
            result: {text: largeText},
            sessions: [],
            usage: zeroUsage,
        });
        expect(JSON.stringify(detail.result)).not.toContain("截断");
    });

    it("waiting workflow job 取消后解除 settle 等待并让 JobManager idle", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const definition: WorkflowDefinition = {
            key: "waiting-cancel",
            run: async (wf) => ({answer: await wf.ask({kind: "approve", title: "等待取消"})}),
        };
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试 job 不应请求 harness 回流");
        }, "");
        const {job} = spawnWorkflowJob({
            jobs,
            service,
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project: null,
            deliver: "none",
        });
        await vi.waitFor(async () => expect((await jobs.get(job.jobId))?.status).toBe("waiting"));

        await jobs.cancel(job.jobId);
        await jobs.waitIdle();

        await expect(jobs.get(job.jobId)).resolves.toMatchObject({status: "cancelled"});
    });

    it("waiting workflow 应答后 Job 立即恢复 running，完成后落终态", async () => {
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        let release = (): void => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const definition: WorkflowDefinition = {
            key: "waiting-resume",
            run: async (wf) => {
                await wf.ask({kind: "approve", title: "继续执行"});
                await gate;
                return {ok: true};
            },
        };
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试 job 不应请求 harness 回流");
        }, "");
        const project = {workspace: {ref: {projectRoot: "waiting-resume"}}} as never;
        const {job, runId} = spawnWorkflowJob({
            jobs,
            service,
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project,
            deliver: "none",
        });
        await vi.waitFor(async () => expect((await jobs.get(job.jobId))?.status).toBe("waiting"));
        expect(startReadyProjectOperation).toHaveBeenCalledWith(project, expect.any(Function));
        const waiting = await service.runState(runId, 0);
        const ask = waiting.view.pendingAsks[0];
        expect(ask).toBeDefined();

        service.resume(runId, {[ask!.key]: true});
        await vi.waitFor(async () => expect((await jobs.get(job.jobId))?.status).toBe("running"));
        release();
        await jobs.waitIdle();

        await expect(jobs.get(job.jobId)).resolves.toMatchObject({status: "completed", preview: "完成：{\"ok\":true}"});
    });

    it("正式run创建participant时复用冻结的Config与Project generation", async () => {
        const snapshot = {
            metadata: {
                schemaVersion: 2,
                sessionId: 42,
                profileKey: "adhoc",
                initial: null,
                currentProjectRoot: "book",
                createdAt: Date.now(),
                kind: "workflow",
                tags: [],
            },
            entries: [],
            leafId: null,
        };
        const repo = {
            readSession: vi.fn(async () => snapshot),
            reduce: vi.fn(() => ({title: "Participant", archived: false})),
        };
        const createAgent = vi.fn(async () => ({sessionId: 42, profileKey: "adhoc", title: "Participant"}));
        const runCommand = vi.fn(async () => undefined);
        const assertVisibleModel = vi.fn();
        harnessProvider = () => ({repo, createAgent, runCommand});
        vi.doMock("nbook/server/agent/harness/agent-visible-models", () => ({assertVisibleModel}));
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const config = createDefaultEffectiveConfig();
        const project = {workspace: {ref: {projectRoot: "book"}}} as never;
        const definition: WorkflowDefinition = {
            key: "project-participant",
            run: async (wf) => {
                await wf.ask({kind: "approve", title: "继续创建Participant"});
                await wf.agents.create("adhoc", {model: "local/allowed", initial: {systemPrompt: "test"}});
                return null;
            },
        };

        const {runId, done, terminal} = service.startWorkflowRun({
            def: definition,
            args: null,
            config,
            project,
        });

        const waiting = await done;
        expect(waiting.status).toBe("waiting");
        expect(startReadyProjectOperation).toHaveBeenCalledWith(project, expect.any(Function));
        expect(leasedCompletion).toBe(terminal);
        expect(createAgent).not.toHaveBeenCalled();
        service.resume(runId, {[waiting.pendingAsks[0]!.key]: true});
        await terminal;
        const completed = await service.runState(runId, 0);
        expect(completed.view.error).toBeUndefined();
        expect(completed.view.status).toBe("completed");
        expect(createAgent).toHaveBeenCalledTimes(1);
        expect(assertVisibleModel).toHaveBeenCalledWith(config, "local/allowed");
        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
            profileKey: "adhoc",
            currentProjectRoot: "book",
        }));
        expect(runCommand).toHaveBeenCalledWith(42, {command: "model", modelKey: "local/allowed"});
    });

    it("脚本内 agents.create 显式模型同样经过 visibleModels 宿主门禁", async () => {
        const createAgent = vi.fn();
        const assertVisibleModel = vi.fn((_config: unknown, modelKey: string) => {
            if (modelKey === "local/hidden") throw new Error("模型 local/hidden 不在 agent 可见模型清单内");
        });
        harnessProvider = () => ({
            workspaceRoot: "C:/workspace",
            repo: {readSession: vi.fn()},
            createAgent,
            runCommand: vi.fn(),
        });
        vi.doMock("nbook/server/agent/harness/agent-visible-models", () => ({assertVisibleModel}));
        const {useWorkflowDemoService} = await import("nbook/server/agent/workflow/workflow-demo-service");
        const service = useWorkflowDemoService();
        const definition: WorkflowDefinition = {
            key: "hidden-model",
            run: async (wf) => {
                await wf.agents.create("adhoc", {model: "local/hidden", initial: {systemPrompt: "test"}});
                return null;
            },
        };

        const {done} = service.startWorkflowRun({def: definition, args: null, config: {} as never, project: null});

        await expect(done).resolves.toMatchObject({
            status: "failed",
            error: expect.stringContaining("不在 agent 可见模型清单内"),
        });
        expect(assertVisibleModel).toHaveBeenCalledWith({}, "local/hidden");
        expect(createAgent).not.toHaveBeenCalled();
    });
});
