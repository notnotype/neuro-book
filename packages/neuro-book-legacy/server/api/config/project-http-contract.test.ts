import {beforeEach, describe, expect, it, vi} from "vitest";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session-service";

describe("Config Project HTTP contract", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.doMock("h3", async (importOriginal) => ({
            ...await importOriginal<typeof import("h3")>(),
            getQuery: vi.fn(() => ({workspaceKind: "novel", projectRoot: "closed-project"})),
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            readConfigBootstrap: vi.fn(async () => {
                throw new ProjectNotOpenError("closed-project");
            }),
            readConfigSnapshot: vi.fn(async () => {
                throw new ProjectNotOpenError("closed-project");
            }),
        }));
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({
                measure: async (_name: string, operation: () => Promise<unknown>) => operation(),
            })),
        }));
    });

    it.each([
        "nbook/server/api/config/bootstrap.get",
        "nbook/server/api/config/snapshot.get",
    ])("%s 将未打开 Project 映射为稳定 409", async (moduleId) => {
        const handler = (await import(moduleId)).default as (event: object) => Promise<unknown>;

        await expect(handler({})).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot: "closed-project"},
        });
    });
});
