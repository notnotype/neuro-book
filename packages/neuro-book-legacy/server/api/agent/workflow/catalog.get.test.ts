import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {join, resolve} from "node:path";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

describe("GET /api/agent/workflow/catalog", () => {
    const cleanupRoots: string[] = [];

    afterEach(async () => {
        vi.resetModules();
        vi.restoreAllMocks();
        delete (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
        await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("从显式 Project Workspace 读取项目 workflow，且无项目查询不泄漏", async () => {
        const root = testHostPath("workflow-catalog-route-test", randomUUID());
        cleanupRoots.push(root);
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(root),
        });
        const projectRoot = join(runtimePaths.workspaceRoot, "catalog-project");
        const workflowRoot = join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening");
        await mkdir(workflowRoot, {recursive: true});
        await writeFile(join(workflowRoot, "workflow.ts"), "export default { title: '开篇脑暴', run: async () => null };\n", "utf8");
        const catalog = new WorkflowCatalog(join(root, "install"));
        const listWorkflows = vi.spyOn(catalog, "list");
        const ref = projectWorkspaceRef("catalog-project");
        const ready: ReadyProjectSessionRef = {
            workspace: resolvedProjectWorkspace(
                ref,
                absoluteFsPath(projectRoot),
                createProjectWorkspaceKey(runtimePaths.workspaceRoot, ref),
            ),
            generation: 1,
        };
        const requireActiveReadyProject = vi.fn(() => ready);
        const runReadyProjectOperation = vi.fn((_ready, operation: () => Promise<unknown>) => operation());
        const loadEffectiveConfigFromTarget = vi.fn(async () => ({}));
        let query: {projectRoot?: string} = {projectRoot: "catalog-project"};

        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {...actual, defineEventHandler: (handler: unknown) => handler, getQuery: vi.fn(() => query)};
        });
        vi.doMock("nbook/server/runtime/paths/runtime-paths", async () => {
            const actual = await vi.importActual<typeof import("nbook/server/runtime/paths/runtime-paths")>("nbook/server/runtime/paths/runtime-paths");
            return {...actual, runtimePathsFromEnv: vi.fn(() => runtimePaths)};
        });
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: () => ({workflows: catalog}),
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            loadEffectiveConfigFromTarget,
        }));
        vi.doMock("nbook/server/runtime/product-project", () => ({
            requireActiveReadyProject,
            runReadyProjectOperation,
        }));
        vi.doMock("nbook/server/api/projects/project-http-error", () => ({
            withProjectHttpError: (operation: () => Promise<unknown>) => operation(),
        }));
        vi.doMock("nbook/server/agent/harness/agent-visible-models", () => ({
            resolveAgentVisibleModels: vi.fn(() => []),
        }));
        (globalThis as typeof globalThis & {defineEventHandler?: (handler: unknown) => unknown}).defineEventHandler = (handler) => handler;
        const handler = (await import("nbook/server/api/agent/workflow/catalog.get")).default;

        const projectCatalog = await handler({} as never);
        expect(projectCatalog.workflows).toEqual([
            expect.objectContaining({key: "brainstorm-opening", source: "project", title: "开篇脑暴"}),
        ]);
        expect(requireActiveReadyProject).toHaveBeenCalledOnce();
        expect(requireActiveReadyProject).toHaveBeenCalledWith(projectWorkspaceRef("catalog-project"));
        expect(runReadyProjectOperation).toHaveBeenCalledOnce();
        expect(runReadyProjectOperation).toHaveBeenCalledWith(ready, expect.any(Function));
        expect(listWorkflows).toHaveBeenLastCalledWith(ready.workspace);
        expect(loadEffectiveConfigFromTarget).toHaveBeenLastCalledWith({
            scope: "project",
            workspaceRoot: runtimePaths.workspaceRoot,
            project: ready,
        });

        query = {};
        const globalCatalog = await handler({} as never);
        expect(globalCatalog.workflows).toEqual([]);
        expect(requireActiveReadyProject).toHaveBeenCalledTimes(1);
        expect(runReadyProjectOperation).toHaveBeenCalledTimes(1);
        expect(listWorkflows).toHaveBeenLastCalledWith(undefined);
        expect(loadEffectiveConfigFromTarget).toHaveBeenLastCalledWith({
            scope: "global",
            workspaceRoot: runtimePaths.workspaceRoot,
            project: null,
        });
    });
});
