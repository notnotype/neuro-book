import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";
import type {WorkflowRunStart} from "nbook/server/agent/workflow/workflow-demo-service";
import type {EffectiveConfig} from "nbook/server/config/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths, type RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import type {JsonValue, RunView, WorkflowDefinition, WorkspacePort} from "nbook/server/vendor/nb-workflow/index";
import type {RuntimeConfigTarget} from "nbook/server/config/types";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
    type ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import type {AgentJobStartDto} from "nbook/shared/dto/agent-job.dto";

type StartInput = {
    def: WorkflowDefinition;
    args: JsonValue;
    model?: string;
    workspace?: WorkspacePort;
    config: EffectiveConfig;
    project: ReadyProjectSessionRef | null;
    workspaceKey: string;
    signal?: AbortSignal;
};

type RouteFixture = {
    handler: (event: never) => Promise<AgentJobStartDto & {runId: string}>;
    jobs: AgentJobManager;
    requireActiveReadyProject: ReturnType<typeof vi.fn<(ref: ReturnType<typeof projectWorkspaceRef>) => ReadyProjectSessionRef>>;
    runReadyProjectOperation: ReturnType<typeof vi.fn>;
    getWorkflow: ReturnType<typeof vi.fn<(key: string, workspace?: ResolvedProjectWorkspace) => Promise<{def: WorkflowDefinition} | null>>>;
    loadConfig: ReturnType<typeof vi.fn<(target: RuntimeConfigTarget) => Promise<EffectiveConfig>>>;
    startWorkflow: ReturnType<typeof vi.fn<(input: StartInput) => WorkflowRunStart>>;
};

describe("POST /api/agent/workflow/runs", () => {
    const testRoot = resolve(".agent", "workspace", "workflow-runs-post-test");
    const cleanupRoots: string[] = [];

    beforeAll(async () => {
        await rm(testRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    });

    afterAll(async () => {
        await rm(testRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    });

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        await Promise.all(cleanupRoots.splice(0).map(async (root) => {
            await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        }));
    });

    it("把合法 Project 的授权只读 WorkspacePort 与可见模型传给正式 run", async () => {
        const project = await createProject("legal");
        const config = visibleModelConfig();
        const fixture = await routeFixture({
            body: {
                projectRoot: project.projectRoot,
                workflowKey: "test-workflow",
                args: {path: "manuscript/chapter.md"},
                model: "local/default-model",
            },
            runtimePaths: project.runtimePaths,
            config,
            ready: project.ready,
        });

        const response = await fixture.handler(routeEvent());
        expect(response).toEqual({
            jobId: expect.stringMatching(/^job_/u),
            jobEventCursor: {eventEpoch: expect.any(String), after: 1},
            runId: "run_api",
        });
        await fixture.jobs.waitIdle();
        await expect(fixture.jobs.get(response.jobId)).resolves.toMatchObject({
            kind: "workflow",
            ownerSessionId: null,
            status: "completed",
            ref: {runId: "run_api", workflowKey: "test-workflow"},
        });
        expect(fixture.requireActiveReadyProject).toHaveBeenCalledOnce();
        expect(fixture.requireActiveReadyProject).toHaveBeenCalledWith(projectWorkspaceRef(project.projectRoot));
        expect(fixture.runReadyProjectOperation).toHaveBeenCalledOnce();
        expect(fixture.runReadyProjectOperation).toHaveBeenCalledWith(project.ready, expect.any(Function));
        expect(fixture.loadConfig).toHaveBeenCalledWith({
            scope: "project",
            workspaceRoot: project.runtimePaths.workspaceRoot,
            project: project.ready,
        });
        expect(fixture.startWorkflow).toHaveBeenCalledTimes(1);
        const startInput = fixture.startWorkflow.mock.calls[0]![0];
        expect(startInput).toMatchObject({
            args: {path: "manuscript/chapter.md"},
            model: "local/default-model",
            config,
            project: project.ready,
        });
        expect(startInput.workspace).toBeDefined();
        await expect(startInput.workspace!.read("manuscript/chapter.md")).resolves.toBe("Project 正文");
        await expect(startInput.workspace!.read("../outside.md")).rejects.toThrow(/路径|越过/u);
    }, 15_000);

    it("正式 run API 从同一个 Project Workspace Catalog 读取项目 workflow", async () => {
        const project = await createProject("catalog-run");
        const projectRoot = join(project.runtimePaths.workspaceRoot, "catalog-run");
        const workflowRoot = join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening");
        await mkdir(workflowRoot, {recursive: true});
        await writeFile(join(workflowRoot, "workflow.ts"), "export default { title: '项目开篇脑暴', run: async () => ({source: 'project'}) };\n", "utf8");
        const fixture = await routeFixture({
            body: {projectRoot: project.projectRoot, workflowKey: "brainstorm-opening"},
            runtimePaths: project.runtimePaths,
            config: visibleModelConfig(),
            ready: project.ready,
            workflowCatalog: new WorkflowCatalog(join(project.runtimePaths.applicationRoot, "system"), join(project.runtimePaths.applicationRoot, "user")),
        });

        const response = await fixture.handler(routeEvent());

        expect(response).toEqual({
            jobId: expect.stringMatching(/^job_/u),
            jobEventCursor: {eventEpoch: expect.any(String), after: 1},
            runId: "run_api",
        });
        expect(fixture.getWorkflow).not.toHaveBeenCalled();
        await fixture.jobs.waitIdle();
        await expect(fixture.jobs.get(response.jobId)).resolves.toMatchObject({
            status: "completed",
            ref: {runId: "run_api", workflowKey: "brainstorm-opening"},
        });
    }, 15_000);

    it.each([
        ["缺少 projectRoot", {workflowKey: "test-workflow"}],
        ["非法 projectRoot", {projectRoot: "../escape", workflowKey: "test-workflow"}],
    ])("%s 时在启动 run 前以 400 拒绝", async (_label, body) => {
        const runtimePaths = await createTestRuntime("invalid");
        const fixture = await routeFixture({body, runtimePaths, config: visibleModelConfig()});

        await expect(fixture.handler(routeEvent())).rejects.toMatchObject({statusCode: 400});
        expect(fixture.startWorkflow).not.toHaveBeenCalled();
    });

    it("Project 不存在时按 strict-ready 门禁以 409 拒绝", async () => {
        const runtimePaths = await createTestRuntime("missing");
        const projectRoot = "not-found";
        const fixture = await routeFixture({
            body: {projectRoot, workflowKey: "test-workflow"},
            runtimePaths,
            config: visibleModelConfig(),
            projectReadyError: Object.assign(new Error(`Project 未打开：${projectRoot}`), {
                statusCode: 409,
                data: {code: "PROJECT_NOT_OPEN", projectRoot},
            }),
        });

        await expect(fixture.handler(routeEvent())).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot},
        });
        expect(fixture.startWorkflow).not.toHaveBeenCalled();
    });

    it("Project 存在但未 open 时以稳定 409 门禁拒绝", async () => {
        const project = await createProject("closed");
        const fixture = await routeFixture({
            body: {projectRoot: project.projectRoot, workflowKey: "test-workflow"},
            runtimePaths: project.runtimePaths,
            config: visibleModelConfig(),
            projectReadyError: Object.assign(new Error(`Project 未打开：${project.projectRoot}`), {
                statusCode: 409,
                data: {code: "PROJECT_NOT_OPEN", projectRoot: project.projectRoot},
            }),
        });

        await expect(fixture.handler(routeEvent())).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot: project.projectRoot},
        });
        expect(fixture.startWorkflow).not.toHaveBeenCalled();
    });

    it("不可见 model 在启动 run 前以 400 拒绝", async () => {
        const project = await createProject("hidden-model");
        const fixture = await routeFixture({
            body: {
                projectRoot: project.projectRoot,
                workflowKey: "test-workflow",
                model: "local/hidden-model",
            },
            runtimePaths: project.runtimePaths,
            config: visibleModelConfig(),
            ready: project.ready,
        });

        await expect(fixture.handler(routeEvent())).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("不在 agent 可见模型清单内"),
        });
        expect(fixture.loadConfig).toHaveBeenCalledWith({
            scope: "project",
            workspaceRoot: project.runtimePaths.workspaceRoot,
            project: project.ready,
        });
        expect(fixture.getWorkflow).not.toHaveBeenCalled();
        expect(fixture.startWorkflow).not.toHaveBeenCalled();
    });

    /** 为每个用例建立独立 State Root，避免测试读取开发 workspace。 */
    async function createTestRuntime(label: string): Promise<RuntimePaths> {
        const root = join(testRoot, `${label}-${randomUUID()}`);
        cleanupRoots.push(root);
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(root),
        });
        await mkdir(runtimePaths.workspaceRoot, {recursive: true});
        return runtimePaths;
    }

    /** 建立一个最小 managed Project Workspace；是否 open 由用例显式决定。 */
    async function createProject(label: string): Promise<{
        runtimePaths: RuntimePaths;
        projectRoot: string;
        ready: ReadyProjectSessionRef;
    }> {
        const runtimePaths = await createTestRuntime(label);
        const projectRoot = label;
        const projectFsRoot = absoluteFsPath(join(runtimePaths.workspaceRoot, label));
        await mkdir(join(projectFsRoot, "manuscript"), {recursive: true});
        await writeFile(join(projectFsRoot, "manuscript", "chapter.md"), "Project 正文", "utf8");
        const ref = projectWorkspaceRef(label);
        const ready: ReadyProjectSessionRef = {
            workspace: resolvedProjectWorkspace(
                ref,
                projectFsRoot,
                createProjectWorkspaceKey(runtimePaths.workspaceRoot, ref),
            ),
            generation: 1,
        };
        return {runtimePaths, projectRoot, ready};
    }

    /** 动态注入进程边界，结构化 Project Workspace 只读端口保持真实实现。 */
    async function routeFixture(input: {
        body: object;
        runtimePaths: RuntimePaths;
        config: EffectiveConfig;
        ready?: ReadyProjectSessionRef;
        projectReadyError?: Error;
        workflowCatalog?: WorkflowCatalog;
    }): Promise<RouteFixture> {
        const definition: WorkflowDefinition = {
            key: "test-workflow",
            run: async () => ({ok: true}),
        };
        const getWorkflow = vi.fn(async (key: string, _workspace?: ResolvedProjectWorkspace) => key === definition.key ? {def: definition} : null);
        const loadConfig = vi.fn(async (_target: RuntimeConfigTarget) => input.config);
        const completed: RunView = {
            runId: "run_api",
            workflowKey: definition.key,
            status: "completed",
            result: null,
            pendingAsks: [],
            logs: [],
            progress: null,
            journal: [],
        };
        const startWorkflow = vi.fn((_startInput: StartInput) => ({
            runId: completed.runId,
            done: Promise.resolve(completed),
            terminal: Promise.resolve(),
        }));
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless HTTP workflow 不应触发 followup 回流");
        }, "");
        const requireActiveReadyProject = vi.fn((ref: ReturnType<typeof projectWorkspaceRef>): ReadyProjectSessionRef => {
            if (input.projectReadyError) throw input.projectReadyError;
            if (!input.ready) {
                throw new Error("测试 fixture 缺少 ready ProjectSession");
            }
            if (ref.projectRoot !== input.ready.workspace.ref.projectRoot) {
                throw new Error(`未预期的 Project root：${ref.projectRoot}`);
            }
            return input.ready;
        });
        const runReadyProjectOperation = vi.fn((_ready: ReadyProjectSessionRef, operation: () => Promise<unknown>) => operation());

        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {...actual, readBody: vi.fn(async () => input.body)};
        });
        vi.doMock("nbook/server/runtime/paths/runtime-paths", async () => {
            const actual = await vi.importActual<typeof import("nbook/server/runtime/paths/runtime-paths")>("nbook/server/runtime/paths/runtime-paths");
            return {...actual, runtimePathsFromEnv: vi.fn(() => input.runtimePaths)};
        });
        vi.doMock("nbook/server/config/config-service", () => ({
            loadEffectiveConfigFromTarget: loadConfig,
        }));
        vi.doMock("nbook/server/api/projects/project-http-error", () => ({
            withProjectHttpError: (operation: () => Promise<unknown>) => operation(),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            isProjectNotOpenError: (error: unknown) => error === input.projectReadyError,
            requireActiveReadyProject,
            runReadyProjectOperation,
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: () => ({workflows: input.workflowCatalog ?? {get: getWorkflow}, jobs}),
        }));
        vi.doMock("nbook/server/agent/workflow/workflow-demo-service", () => ({
            useWorkflowDemoService: () => ({
                startWorkflowRun: startWorkflow,
                waitForRunSettled: vi.fn(),
                cancelRun: vi.fn(),
                runSummary: vi.fn(async () => ({sessions: [], usage: {inputTokens: 0, outputTokens: 0}})),
            }),
        }));

        const handler = (await import("nbook/server/api/agent/workflow/runs.post")).default;
        return {
            handler,
            jobs,
            requireActiveReadyProject,
            runReadyProjectOperation,
            getWorkflow,
            loadConfig,
            startWorkflow,
        };
    }
});

/** 路由校验错误日志会读取 method/path；测试只需这两个稳定字段。 */
function routeEvent(): never {
    return {method: "POST", path: "/api/agent/workflow/runs"} as never;
}

/** 构造一条可解析且只暴露默认模型的 Effective Config。 */
function visibleModelConfig(): EffectiveConfig {
    const config = createDefaultEffectiveConfig();
    config.models = {
        defaultModelKey: "local/default-model",
        providers: {
            local: {
                name: "Local",
                enabled: true,
                modelApi: "openai-completions",
                options: {
                    apiKey: "secret",
                    baseURL: "https://example.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
                models: {
                    "default-model": {
                        name: "Default Model",
                        id: "default-model",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8_192,
                        cost: null,
                        compat: null,
                        headers: null,
                        thinkingLevelMap: null,
                        contextWindowTokens: 128_000,
                    },
                },
            },
        },
    };
    config.agent.visibleModels = [{modelKey: "local/default-model", note: "默认"}];
    return config;
}
