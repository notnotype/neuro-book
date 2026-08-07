import {beforeEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const PROJECT_REF = {projectRoot: "rag-ready"};

const mocks = vi.hoisted(() => ({
    requireProjectRefQuery: vi.fn(() => ({projectRoot: "rag-ready"})),
    requireActiveReadyProject: vi.fn(),
    runReadyProjectOperation: vi.fn((_ready, operation: () => Promise<unknown>) => operation()),
}));

vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({
    runtimePathsFromEnv: () => ({workspaceRoot: testAbsoluteFsPath("project-rag", "workspace-root")}),
}));

vi.mock("nbook/server/api/projects/project-control-plane", () => ({
    requireProjectRefQuery: mocks.requireProjectRefQuery,
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    requireActiveReadyProject: mocks.requireActiveReadyProject,
    runReadyProjectOperation: mocks.runReadyProjectOperation,
}));

vi.mock("nbook/server/api/projects/project-http-error", () => ({
    withProjectHttpError: (handler: () => Promise<unknown>) => handler(),
}));

describe("Project RAG HTTP target", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("projectRoot query 只解析一次并返回 exact ready target", async () => {
        const ready = {generation: 7} as ReadyProjectSessionRef;
        mocks.requireActiveReadyProject.mockReturnValue(ready);
        const {requireProjectRagTarget} = await import("nbook/server/api/projects/rag/project-rag-http-target");

        const target = requireProjectRagTarget({} as never);

        expect(mocks.requireProjectRefQuery).toHaveBeenCalledOnce();
        expect(mocks.requireActiveReadyProject).toHaveBeenCalledOnce();
        expect(mocks.requireActiveReadyProject).toHaveBeenCalledWith(PROJECT_REF);
        expect(target).toEqual({
            workspaceRoot: testAbsoluteFsPath("project-rag", "workspace-root"),
            project: ready,
        });
    });

    it("请求只捕获并登记一次 exact ready generation", async () => {
        const ready = {generation: 11} as ReadyProjectSessionRef;
        mocks.requireActiveReadyProject.mockReturnValue(ready);
        const handler = vi.fn(async (target: {project: ReadyProjectSessionRef}) => target.project.generation);
        const {withProjectRagTarget} = await import("nbook/server/api/projects/rag/project-rag-http-target");

        await expect(withProjectRagTarget({} as never, handler)).resolves.toBe(11);

        expect(mocks.requireProjectRefQuery).toHaveBeenCalledOnce();
        expect(mocks.requireActiveReadyProject).toHaveBeenCalledOnce();
        expect(mocks.runReadyProjectOperation).toHaveBeenCalledOnce();
        expect(mocks.runReadyProjectOperation).toHaveBeenCalledWith(ready, expect.any(Function));
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith({
            workspaceRoot: testAbsoluteFsPath("project-rag", "workspace-root"),
            project: ready,
        });
    });
});
