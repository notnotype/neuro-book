import {beforeEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";

const WORKSPACE_ROOT = testAbsoluteFsPath("control-plane", "workspace");

describe("Project 控制面不要求 open", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({
            runtimePathsFromEnv: vi.fn(() => ({workspaceRoot: WORKSPACE_ROOT})),
        }));
    });

    it("POST /api/projects 未 open 时仍可创建 Project", async () => {
        const createProject = vi.fn(async () => ({
            revision: 4,
            project: {projectRoot: "new-book", kind: "novel", title: "New Book", summary: "control"},
        }));

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({title: "New Book", summary: "control"})),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            buildWorkspaceSlugBase: vi.fn(() => "new-book"),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            createProject,
            listProjects: vi.fn(async () => ({revision: 3, projects: []})),
        }));

        const handler = (await import("nbook/server/api/projects/index.post")).default;
        await expect(handler({} as never)).resolves.toEqual({
            revision: 4,
            project: {projectRoot: "new-book", kind: "novel", title: "New Book", summary: "control"},
        });
        // 创建走唯一 Facade，不再由 route 自行写 manifest / 拷模板 / 初始化数据库。
        expect(createProject).toHaveBeenCalledWith({
            ref: {projectRoot: "new-book"},
            title: "New Book",
            summary: "control",
        });
    });

    it("DELETE /api/projects/item 未 open 时仍可通过 Lifecycle 删除 Project", async () => {
        const closeProject = vi.fn(async () => undefined);
        const deleteProject = vi.fn(async () => ({revision: 5, projectRoot: "delete-me"}));
        const archiveSessionsByProjectRoot = vi.fn(async () => 0);
        vi.doMock("nbook/server/api/projects/project-control-plane", () => ({
            requireProjectRefQuery: vi.fn(() => ({projectRoot: "delete-me"})),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            closeProject,
            deleteProject,
            projectOccupancy: vi.fn(() => null),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({archiveSessionsByProjectRoot})),
        }));

        const handler = (await import("nbook/server/api/projects/item.delete")).default;
        await expect(handler({} as never)).resolves.toEqual({revision: 5, projectRoot: "delete-me"});
        expect(closeProject).toHaveBeenCalledWith({projectRoot: "delete-me"}, "delete");
        expect(deleteProject).toHaveBeenCalledWith({projectRoot: "delete-me"});
        expect(archiveSessionsByProjectRoot).toHaveBeenCalledWith("delete-me", "project.deleted");
    });
});
