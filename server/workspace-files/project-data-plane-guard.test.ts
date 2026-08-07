import {describe, expect, it, vi} from "vitest";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ResolvedFileTarget} from "nbook/server/workspace-files/authorized-file-operation";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const mocks = vi.hoisted(() => ({
    currentBySlug: new Map<string, ReadyProjectSessionRef>(),
    fileIndexByReady: new Map<ReadyProjectSessionRef, {mutate: (operation: () => Promise<unknown>) => Promise<unknown>}>(),
    requireActiveReadyProject: vi.fn(),
    requireReadyModuleHandle: vi.fn(),
    runReadyProjectOperation: vi.fn(),
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    requireActiveReadyProject: mocks.requireActiveReadyProject,
    requireReadyModuleHandle: mocks.requireReadyModuleHandle,
    runReadyProjectOperation: mocks.runReadyProjectOperation,
}));

vi.mock("nbook/server/workspace-files/project-file-index", () => ({
    PROJECT_FILE_INDEX_MODULE_TOKEN: {name: "file-index", kind: "required"},
}));

describe("Project file data-plane mutation guard", () => {
    it("多 Project mutation 按稳定顺序取得 exact generation gate", async () => {
        const gateEntries: string[] = [];
        const first = readyProject("first");
        const second = readyProject("second");
        for (const ready of [first, second]) {
            const slug = ready.workspace.ref.projectRoot;
            mocks.currentBySlug.set(slug, ready);
            mocks.fileIndexByReady.set(ready, {
                mutate: async (operation) => {
                    gateEntries.push(slug);
                    return operation();
                },
            });
        }
        mocks.requireActiveReadyProject.mockImplementation((ref: {projectRoot: string}) => (
            mocks.currentBySlug.get(ref.projectRoot)
        ));
        mocks.requireReadyModuleHandle.mockImplementation((ready: ReadyProjectSessionRef) => (
            mocks.fileIndexByReady.get(ready)
        ));
        mocks.runReadyProjectOperation.mockImplementation((_ready, operation: () => Promise<unknown>) => operation());
        const {runProjectFileMutation} = await import("nbook/server/workspace-files/project-data-plane-guard");
        const operation = vi.fn(async () => "done");

        await expect(runProjectFileMutation([fileTarget(first), fileTarget(second)], operation)).resolves.toBe("done");
        const expectedOrder = [...gateEntries];
        gateEntries.length = 0;
        await expect(runProjectFileMutation([fileTarget(second), fileTarget(first)], operation)).resolves.toBe("done");

        expect(gateEntries).toEqual(expectedOrder);
        expect(new Set(gateEntries)).toEqual(new Set(["first", "second"]));
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it("Agent read 与三个专用写工具使用各自的数据面边界", async () => {
        const source = await readFile(path.resolve("server/agent/tools/file-tools.ts"), "utf-8");

        expect(source.match(/return runProjectFileOperation\(/g)).toHaveLength(1);
        expect(source.match(/return runProjectFileMutation\(/g)).toHaveLength(3);
    });
});

/** 构造 mutation guard 测试使用的 exact ready generation。 */
function readyProject(slug: string): ReadyProjectSessionRef {
    const workspaceRoot = testAbsoluteFsPath("project-data-plane", "workspace-root");
    const ref = projectWorkspaceRef(slug);
    return {
        workspace: resolvedProjectWorkspace(
            ref,
            testAbsoluteFsPath("project-data-plane", "workspace-root", slug),
            createProjectWorkspaceKey(workspaceRoot, ref),
        ),
        generation: 1,
    };
}

/** 构造携带 exact Project generation 的最小文件目标。 */
function fileTarget(project: ReadyProjectSessionRef): ResolvedFileTarget {
    return {
        kind: "project",
        absolutePath: testAbsoluteFsPath(
            "project-data-plane",
            "workspace-root",
            project.workspace.ref.projectRoot,
            "manuscript",
            "a.md",
        ),
        project,
        relativePath: "manuscript/a.md",
    };
}
