import {beforeEach, describe, expect, it, vi} from "vitest";

const getWorldStatus = vi.fn();
const listSubjects = vi.fn();
const readRpRuntimeOverview = vi.fn();

describe("GET /api/projects/rp/overview", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.doMock("nbook/server/rp/api-project", () => ({
            withRpApiProject: async (_event: unknown, action: (projectRoot: string, context: {workspaceRoot: string; projectPath: string}) => Promise<unknown>) => action(
                "E:/state/workspace/test-project",
                {workspaceRoot: "E:/state/workspace", projectPath: "workspace/test-project"},
            ),
        }));
        vi.doMock("nbook/server/world-engine", () => ({
            worldEngineFacadeForWorkspaceRoot: vi.fn(() => ({getWorldStatus, listSubjects})),
        }));
        vi.doMock("nbook/server/rp/runtime-view-store", () => ({readRpRuntimeOverview}));
        readRpRuntimeOverview.mockResolvedValue({intake: {phase: "reviewing"}});
    });

    it("RP 尚未初始化时正常返回 overview，且不提前读取 World Engine", async () => {
        getWorldStatus.mockResolvedValue({
            worldKey: "rp",
            initialized: false,
            missing: ["rp/world-engine/schema/index.ts", "rp/world-engine/calendar.ts"],
            errors: [],
        });
        const handler = (await import("nbook/server/api/projects/rp/overview.get")).default;

        await expect(handler({} as never)).resolves.toEqual({intake: {phase: "reviewing"}});
        expect(getWorldStatus).toHaveBeenCalledWith("workspace/test-project", "rp");
        expect(listSubjects).not.toHaveBeenCalled();
        expect(readRpRuntimeOverview).toHaveBeenCalledWith("E:/state/workspace/test-project", []);
    });

    it("RP 初始化完成后读取独立世界线角色并合并到 overview", async () => {
        const subjects = [{id: "player", name: "玩家"}];
        getWorldStatus.mockResolvedValue({worldKey: "rp", initialized: true, missing: [], errors: []});
        listSubjects.mockResolvedValue(subjects);
        const handler = (await import("nbook/server/api/projects/rp/overview.get")).default;

        await handler({} as never);

        expect(listSubjects).toHaveBeenCalledWith("workspace/test-project", {type: "character"}, "rp");
        expect(readRpRuntimeOverview).toHaveBeenCalledWith("E:/state/workspace/test-project", subjects);
    });
});
