import {beforeEach, describe, expect, it, vi} from "vitest";

type Occupancy = {state: string; userConnections: number; agentActive: boolean} | null;

/** 装载 close 路由并注入指定占用快照。 */
async function loadHandler(occupancy: Occupancy): Promise<{
    handler: (event: never) => Promise<unknown>;
    closeProject: ReturnType<typeof vi.fn>;
}> {
    const closeProject = vi.fn(async () => undefined);
    vi.doMock("nbook/server/api/projects/project-control-plane", () => ({
        requireProjectRefBody: vi.fn(async () => ({projectRoot: "novel-a"})),
    }));
    vi.doMock("nbook/server/runtime/product-project", () => ({
        closeProject,
        projectOccupancy: vi.fn(() => occupancy),
    }));
    const handler = (await import("nbook/server/api/projects/close.post")).default as (event: never) => Promise<unknown>;
    return {handler, closeProject};
}

describe("POST /api/projects/close", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("无人在场时关闭 Project 会话", async () => {
        const {handler, closeProject} = await loadHandler({state: "ready", userConnections: 0, agentActive: false});

        await expect(handler({} as never)).resolves.toEqual({
            success: true,
            projectRoot: "novel-a",
        });
        expect(closeProject).toHaveBeenCalledWith({projectRoot: "novel-a"}, "user");
    });

    it("Project 本就未打开时幂等返回成功且不调用 close", async () => {
        const {handler, closeProject} = await loadHandler(null);

        await expect(handler({} as never)).resolves.toEqual({
            success: true,
            projectRoot: "novel-a",
        });
        expect(closeProject).not.toHaveBeenCalled();
    });

    it("其他标签页仍在场时返回 PROJECT_IN_USE 且保持打开", async () => {
        const {handler, closeProject} = await loadHandler({state: "ready", userConnections: 1, agentActive: false});

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_IN_USE", userConnections: 1},
        });
        expect(closeProject).not.toHaveBeenCalled();
    });

    it("agent 运行中时返回 PROJECT_IN_USE 且保持打开", async () => {
        const {handler, closeProject} = await loadHandler({state: "ready", userConnections: 0, agentActive: true});

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_IN_USE", agentActive: true},
        });
        expect(closeProject).not.toHaveBeenCalled();
    });
});
