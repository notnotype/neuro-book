import {beforeEach, describe, expect, it, vi} from "vitest";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session-service";

describe("GET /api/agent/profiles/settings", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("project scope 未 open 时返回稳定 PROJECT_NOT_OPEN", async () => {
        vi.doMock("h3", async (importOriginal) => {
            const actual = await importOriginal<typeof import("h3")>();
            return {
                ...actual,
                getQuery: vi.fn(() => ({
                    workspaceKind: "novel",
                    projectRoot: "settings-route-not-open",
                    scope: "project",
                })),
            };
        });
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentHarness: vi.fn(() => ({profiles: {}})),
        }));
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({
                measure: (_name: string, handler: () => unknown) => handler(),
            })),
        }));
        vi.doMock("nbook/server/config/query", () => ({
            validateConfigAgentProfileSettingsQuery: vi.fn(() => ({
                workspaceKind: "novel",
                projectRoot: "settings-route-not-open",
                scope: "project",
            })),
        }));
        vi.doMock("nbook/server/config/config-service", () => ({
            readConfigAgentProfileSettings: vi.fn(async () => {
                throw new ProjectNotOpenError("settings-route-not-open");
            }),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/settings.get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "settings-route-not-open",
            },
        });
    });
});
