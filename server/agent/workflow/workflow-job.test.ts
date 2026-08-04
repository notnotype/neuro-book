import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";
import {spawnWorkflowJob} from "nbook/server/agent/workflow/workflow-job";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import type {RunView, WorkflowDefinition} from "nbook/server/vendor/nb-workflow/index";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {describe, expect, it, vi} from "vitest";

describe("spawnWorkflowJob cancellation", () => {
    it("Job 登记失败时补偿取消已经启动的 Run", async () => {
        const definition: WorkflowDefinition = {
            key: "spawn-rejected",
            run: async () => null,
        };
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递 followup");
        }, "");
        await jobs.shutdown();
        const done = new Promise<RunView>(() => undefined);
        const cancelRun = vi.fn(() => undefined);

        expect(() => spawnWorkflowJob({
            jobs,
            service: {
                startWorkflowRun: () => ({runId: "run_spawn_rejected", done, terminal: done.then(() => undefined)}),
                waitForRunSettled: vi.fn(),
                cancelRun,
                runSummary: vi.fn(),
            },
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project: null,
            deliver: "none",
        })).toThrow("Agent Job Manager 已关闭");
        expect(cancelRun).toHaveBeenCalledOnce();
        expect(cancelRun).toHaveBeenCalledWith("run_spawn_rejected");
    });

    it("Job 只在 Run 确认 cancelled 后进入取消终态", async () => {
        let settleRun: ((view: RunView) => void) | undefined;
        const done = new Promise<RunView>((resolve) => {
            settleRun = resolve;
        });
        const definition: WorkflowDefinition = {
            key: "running-cancel",
            run: async () => null,
        };
        const cancelledView: RunView = {
            runId: "run_running_cancel",
            workflowKey: definition.key,
            status: "cancelled",
            error: "workflow run 被取消",
            pendingAsks: [],
            logs: [],
            progress: null,
            journal: [],
        };
        const cancelRun = vi.fn(() => undefined);
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递 followup");
        }, "");
        const {job} = spawnWorkflowJob({
            jobs,
            service: {
                startWorkflowRun: () => ({
                    runId: cancelledView.runId,
                    done,
                    terminal: done.then(() => undefined),
                }),
                waitForRunSettled: vi.fn(),
                cancelRun,
                runSummary: vi.fn(),
            },
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project: null,
            deliver: "none",
        });

        const requested = await jobs.cancel(job.jobId);

        expect(cancelRun).toHaveBeenCalledWith(cancelledView.runId);
        expect(requested.status).toBe("running");
        await expect(jobs.get(job.jobId)).resolves.toMatchObject({status: "running"});

        settleRun!(cancelledView);
        await jobs.waitIdle();

        await expect(jobs.get(job.jobId)).resolves.toMatchObject({status: "cancelled"});
    });

    it("Project后台Run把exact generation与冻结Config交给统一Service并跨waiting跟踪", async () => {
        const ready = readyProject();
        const config = createDefaultEffectiveConfig();
        const initial = deferred<RunView>();
        const resumed = deferred<RunView>();
        const terminal = deferred<void>();
        const definition: WorkflowDefinition = {
            key: "project-waiting",
            run: async () => null,
        };
        const waitingView: RunView = {
            runId: "run_project_waiting",
            workflowKey: definition.key,
            status: "waiting",
            pendingAsks: [{
                key: "root#1",
                path: "root",
                seq: 1,
                fingerprint: "{}",
                spec: {kind: "approve", title: "继续"},
            }],
            logs: [],
            progress: null,
            journal: [],
        };
        const completedView: RunView = {
            ...waitingView,
            status: "completed",
            result: {ok: true},
            pendingAsks: [],
        };
        const startWorkflowRun = vi.fn(() => ({
            runId: waitingView.runId,
            done: initial.promise,
            terminal: terminal.promise,
        }));
        let markRunning: (() => void) | undefined;
        const waitForRunSettled = vi.fn(async (_runId: string, _signal?: AbortSignal, onRunning?: () => void) => {
            markRunning = onRunning;
            return resumed.promise;
        });
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递 followup");
        }, "");

        const {job, runId} = spawnWorkflowJob({
            jobs,
            service: {
                startWorkflowRun,
                waitForRunSettled,
                cancelRun: vi.fn(),
                runSummary: vi.fn(async () => ({
                    sessions: [],
                    usage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: 0,
                    },
                })),
            },
            def: definition,
            args: null,
            config,
            project: ready,
            deliver: "none",
        });

        expect(runId).toBe(waitingView.runId);
        expect(startWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
            config,
            project: ready,
        }));

        initial.resolve(waitingView);
        await vi.waitFor(async () => expect((await jobs.get(job.jobId))?.status).toBe("waiting"));

        markRunning?.();
        await expect(jobs.get(job.jobId)).resolves.toMatchObject({status: "running"});
        terminal.resolve();
        resumed.resolve(completedView);
        await jobs.waitIdle();

        await expect(jobs.get(job.jobId)).resolves.toMatchObject({status: "completed"});
        expect(waitForRunSettled).toHaveBeenCalledWith(waitingView.runId, expect.any(AbortSignal), expect.any(Function));
    });

    it("Workflow Job get_job 详情读取 Run 状态、pending asks、sessions 与 token usage", async () => {
        const definition: WorkflowDefinition = {key: "detail", run: async () => ({ok: true})};
        const completedView: RunView = {
            runId: "run_detail",
            workflowKey: definition.key,
            status: "completed",
            result: {ok: true},
            pendingAsks: [],
            logs: [],
            progress: null,
            journal: [],
        };
        const usage = {inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5};
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, "");
        const {job} = spawnWorkflowJob({
            jobs,
            service: {
                startWorkflowRun: () => ({runId: completedView.runId, done: Promise.resolve(completedView), terminal: Promise.resolve()}),
                waitForRunSettled: vi.fn(),
                cancelRun: vi.fn(),
                runSummary: vi.fn(async () => ({
                    sessions: [{sessionId: 4, profileKey: "writer.default", title: "写手", tokens: usage}],
                    usage,
                })),
                runState: vi.fn(async () => ({view: completedView, summary: {sessions: [{sessionId: 4, profileKey: "writer.default", title: "写手", tokens: usage}], usage}} as never)),
            },
            def: definition,
            args: null,
            config: createDefaultEffectiveConfig(),
            project: null,
            deliver: "none",
        });
        await jobs.waitIdle();

        const detail = await jobs.get(job.jobId);
        expect(detail).toMatchObject({
            status: "completed",
            result: expect.objectContaining({result: {ok: true}}),
            detail: {
                runStatus: "completed",
                pendingAsks: [],
                sessions: [{sessionId: 4, profileKey: "writer.default"}],
                usage,
                result: {ok: true},
            },
        });
        expect(JSON.stringify(detail)).not.toContain('"cost"');
    });
});

/** 构造只用于exact identity断言的Project generation。 */
function readyProject(): ReadyProjectSessionRef {
    const workspaceRoot = absoluteFsPath("C:/workflow-job-test");
    const ref = projectWorkspaceRef("project");
    return Object.freeze({
        workspace: resolvedProjectWorkspace(
            ref,
            absoluteFsPath("C:/workflow-job-test/project"),
            createProjectWorkspaceKey(workspaceRoot, ref),
        ),
        generation: 7,
    });
}

/** 建立测试可控的Promise。 */
function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
    let resolvePromise = (_value: T): void => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {promise, resolve: resolvePromise};
}
