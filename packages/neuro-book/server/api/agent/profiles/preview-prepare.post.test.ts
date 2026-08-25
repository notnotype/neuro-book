import {tmpdir} from "node:os";
import {join} from "node:path";

import {beforeEach, describe, expect, it, vi} from "vitest";


describe("POST /api/agent/profiles/preview-prepare", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    // project-session-service 的动态导入链冷加载较慢，显式放宽以避免误报超时。
    it("sourceOverride worker preview 触发 Project lifecycle error 时返回稳定 PROJECT_NOT_OPEN", {timeout: 30_000}, async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
                sessionId: "7",
                sourceOverride: {
                    fileName: "builtin/writer.profile.tsx",
                    source: "export default {};",
                },
            })),
        }));
        // vi.doMock 必须先注册、再动态加载被测模块才能生效（模块加载边界测试）。
        vi.doMock("nbook/server/agent/http", async () => {
            // t135 起 sourceOverride 分支要求显式 RuntimePaths；fixture 越过守卫，
            // 才能到达本测试针对的 worker Project lifecycle error 映射点。
            const {createRuntimePaths} = await import("nbook/server/runtime/paths/runtime-paths");
            const {absoluteFsPath} = await import("nbook/server/runtime/paths/file-path");
            return {
                ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
                useAgentHarness: vi.fn(() => ({
                    profiles: {},
                    runtimePaths: createRuntimePaths({
                        applicationRoot: absoluteFsPath(join(tmpdir(), "nbook-profile-preview-mock", "app")),
                        stateRoot: absoluteFsPath(join(tmpdir(), "nbook-profile-preview-mock", "state")),
                    }),
                })),
            };
        });
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", async () => {
            const {ProjectNotOpenError} = await import("nbook/server/workspace-files/project-session-service");
            return {
                useProfileCompileWorker: vi.fn(() => ({
                    compile: vi.fn(async () => {
                        throw new ProjectNotOpenError("profile-preview-not-open");
                    }),
                })),
            };
        });

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "profile-preview-not-open",
            },
        });
    }, 10_000);

    it.each([
        [7, 404, "SESSION_NOT_FOUND"],
        [8, 409, "SESSION_DEPENDENCY_NOT_FOUND"],
    ] as const)("in-process preview 将缺失 Session %i 映射为稳定生命周期错误", async (missingSessionId, statusCode, code) => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
                sessionId: "7",
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(() => ({profiles: {}})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(async () => {
                throw Object.assign(new Error("missing"), {
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: missingSessionId,
                });
            }),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", () => ({
            useProfileCompileWorker: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode,
            data: {code},
        });
    }, 10_000);

    it("未提供 Session ID 仍映射关联 Session 缺失为 409", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(() => ({profiles: {}})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(async () => {
                throw Object.assign(new Error("missing dependency"), {
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: 8,
                });
            }),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    }, 10_000);

    it.each(["abc", "NaN", "0", "-1", "9007199254740992"])("拒绝无效 Session ID %s", async (sessionId) => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "writer",
                sessionId,
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/preview-prepare.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }, 10_000);
});
