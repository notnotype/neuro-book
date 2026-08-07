import {beforeEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";

const tokens = vi.hoisted(() => ({
    fileIndex: Symbol("file-index"),
    history: Symbol("history"),
}));

const mocks = vi.hoisted(() => ({
    requireActiveReadyProject: vi.fn(),
    requireReadyModuleHandle: vi.fn(),
    runReadyProjectOperation: vi.fn(),
    mutatePlain: vi.fn(),
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    assertProjectOpen: vi.fn(),
    markProjectActivity: vi.fn(),
    requireActiveReadyProject: mocks.requireActiveReadyProject,
    requireReadyModuleHandle: mocks.requireReadyModuleHandle,
    runReadyProjectOperation: mocks.runReadyProjectOperation,
    startReadyProjectOperation: vi.fn(),
    isProjectNotOpenError: () => false,
    ProjectNotOpenError: class ProjectNotOpenError extends Error {},
}));

vi.mock("nbook/server/workspace-files/project-file-index", () => ({
    PROJECT_FILE_INDEX_MODULE_TOKEN: tokens.fileIndex,
    projectFileIndexAdapter: {mutatePlain: mocks.mutatePlain},
}));

vi.mock("nbook/server/workspace-history/project-history", () => ({
    PROJECT_HISTORY_MODULE_TOKEN: tokens.history,
}));

describe("Project HTTP data-plane operation guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("普通请求的 operation 持有到 handler settle，close 不能提前越过", async () => {
        const ready = {generation: 9} as ReadyProjectSessionRef;
        const fileIndex = {kind: "file-index"};
        const history = {kind: "history"};
        const active = new Set<Promise<void>>();
        const signal = new AbortController().signal;
        mocks.requireActiveReadyProject.mockReturnValue(ready);
        mocks.requireReadyModuleHandle.mockImplementation((_ready, token) => (
            token === tokens.fileIndex ? fileIndex : history
        ));
        mocks.runReadyProjectOperation.mockImplementation((_ready, operation) => {
            const result = Promise.resolve(operation(signal));
            const completion = result.then(() => undefined, () => undefined);
            active.add(completion);
            void completion.finally(() => active.delete(completion));
            return result;
        });
        let releaseHandler: () => void = () => undefined;
        const handlerGate = new Promise<void>((resolve) => {
            releaseHandler = resolve;
        });
        let handlerEntered: () => void = () => undefined;
        const entered = new Promise<void>((resolve) => {
            handlerEntered = resolve;
        });
        const target: WorkspaceFileTarget = {
            kind: "project-workspace",
            root: testAbsoluteFsPath("project-open-guard", "workspace-root", "guard"),
            projectRoot: projectWorkspaceRef("guard").projectRoot,
        };
        const {withProjectTargetOperation} = await import("nbook/server/workspace-files/project-open-guard");

        const request = withProjectTargetOperation(target, async (handles) => {
            expect(handles).toEqual({ready, fileIndex, history});
            handlerEntered();
            await handlerGate;
            return "done";
        });
        await entered;
        let closeSettled = false;
        const closing = Promise.all([...active]).then(() => {
            closeSettled = true;
        });

        await Promise.resolve();
        expect(closeSettled).toBe(false);
        expect(mocks.requireActiveReadyProject).toHaveBeenCalledOnce();
        expect(mocks.runReadyProjectOperation).toHaveBeenCalledOnce();
        expect(mocks.runReadyProjectOperation).toHaveBeenCalledWith(ready, expect.any(Function));

        releaseHandler();
        await expect(request).resolves.toBe("done");
        await closing;
        expect(closeSettled).toBe(true);
    });

    it("Project mutation 同时持有 ready operation 与当前 File Index generation gate", async () => {
        const ready = {generation: 10} as ReadyProjectSessionRef;
        const fileIndex = {
            mutate: vi.fn(async (operation: () => Promise<string>) => operation()),
        };
        const history = {kind: "history"};
        mocks.requireActiveReadyProject.mockReturnValue(ready);
        mocks.requireReadyModuleHandle.mockImplementation((_ready, token) => (
            token === tokens.fileIndex ? fileIndex : history
        ));
        mocks.runReadyProjectOperation.mockImplementation((_ready, operation) => operation());
        const target: WorkspaceFileTarget = {
            kind: "project-workspace",
            root: testAbsoluteFsPath("project-open-guard", "workspace-root", "mutation"),
            projectRoot: projectWorkspaceRef("mutation").projectRoot,
        };
        const {withProjectTargetMutation} = await import("nbook/server/workspace-files/project-open-guard");
        const handler = vi.fn(async () => "mutated");

        await expect(withProjectTargetMutation(target, handler)).resolves.toBe("mutated");

        expect(mocks.runReadyProjectOperation).toHaveBeenCalledWith(ready, expect.any(Function));
        expect(fileIndex.mutate).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith({ready, fileIndex, history});
        expect(mocks.mutatePlain).not.toHaveBeenCalled();
    });

    it("plain Workspace mutation 不创建 ProjectSession，但仍使用 File Index entry gate", async () => {
        mocks.mutatePlain.mockImplementation((_target, operation) => operation());
        const target: WorkspaceFileTarget = {
            kind: "workspace-root",
            root: testAbsoluteFsPath("project-open-guard", "workspace-root", "plain-mutation"),
        };
        const {withProjectTargetMutation} = await import("nbook/server/workspace-files/project-open-guard");
        const handler = vi.fn(async () => "mutated");

        await expect(withProjectTargetMutation(target, handler)).resolves.toBe("mutated");

        expect(mocks.mutatePlain).toHaveBeenCalledWith(target, expect.any(Function));
        expect(handler).toHaveBeenCalledWith(undefined);
        expect(mocks.requireActiveReadyProject).not.toHaveBeenCalled();
        expect(mocks.runReadyProjectOperation).not.toHaveBeenCalled();
    });
});
