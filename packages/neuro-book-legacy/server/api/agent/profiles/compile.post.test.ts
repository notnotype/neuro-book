import {tmpdir} from "node:os";
import {join} from "node:path";

import {beforeEach, describe, expect, it, vi} from "vitest";


describe("POST /api/agent/profiles/compile", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    // project-session-service 的动态导入链冷加载较慢，显式放宽以避免误报超时。
    it("preview 触发 Project lifecycle error 时返回稳定 PROJECT_NOT_OPEN", {timeout: 30_000}, async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                fileName: "builtin/writer.profile.tsx",
                dryRun: false,
                preview: true,
                sessionId: "7",
            })),
        }));
        // vi.doMock 必须先注册、再动态加载被测模块才能生效（模块加载边界测试）。
        vi.doMock("nbook/server/agent/http", async () => {
            // t135 起 API 合同要求显式 RuntimePaths；fixture 越过守卫，
            // 才能到达本测试针对的 Project lifecycle error 映射点。
            const {createRuntimePaths} = await import("nbook/server/runtime/paths/runtime-paths");
            const {absoluteFsPath} = await import("nbook/server/runtime/paths/file-path");
            return {
                ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
                useAgentHarness: vi.fn(() => ({
                    profiles: {},
                    runtimePaths: createRuntimePaths({
                        applicationRoot: absoluteFsPath(join(tmpdir(), "nbook-profile-compile-mock", "app")),
                        stateRoot: absoluteFsPath(join(tmpdir(), "nbook-profile-compile-mock", "state")),
                    }),
                })),
            };
        });
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", () => ({
            useProfileCompileWorker: vi.fn(() => ({
                compile: vi.fn(async () => ({
                    ok: true,
                    stale: false,
                    detail: null,
                    preview: null,
                    issues: [],
                })),
            })),
        }));
        vi.doMock("nbook/server/agent/profiles/workbench-service", () => ({
            readProfileSource: vi.fn(async () => ({
                manifest: {key: "writer"},
            })),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", async () => {
            const {ProjectNotOpenError} = await import("nbook/server/workspace-files/project-session-service");
            return {
                previewAgentProfilePrepare: vi.fn(async () => {
                    throw new ProjectNotOpenError("profile-compile-not-open");
                }),
            };
        });

        const handler = (await import("nbook/server/api/agent/profiles/compile.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: "profile-compile-not-open",
            },
        });
    }, 10_000);

    it("compile preview 保留关联 Session 缺失的 409", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                fileName: "builtin/writer.profile.tsx",
                dryRun: false,
                preview: true,
                sessionId: "7",
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(() => ({profiles: {}, runtimePaths: {}})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-compile-worker", () => ({
            useProfileCompileWorker: vi.fn(() => ({
                compile: vi.fn(async () => ({
                    ok: true,
                    stale: false,
                    detail: null,
                    preview: null,
                    issues: [],
                })),
            })),
        }));
        vi.doMock("nbook/server/agent/profiles/workbench-service", () => ({
            readProfileSource: vi.fn(async () => ({manifest: {key: "writer"}})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-workbench-roots", () => ({
            profileWorkbenchRootsFromRuntime: vi.fn(() => ({})),
        }));
        vi.doMock("nbook/server/agent/profiles/profile-http-service", () => ({
            previewAgentProfilePrepare: vi.fn(async () => {
                throw Object.assign(new Error("dependency missing"), {
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: 8,
                });
            }),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/compile.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    });

    it.each(["abc", "NaN", "0", "-1", "9007199254740992"])("拒绝无效 Session ID %s", async (sessionId) => {
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                fileName: "builtin/writer.profile.tsx",
                dryRun: false,
                preview: true,
                sessionId,
            })),
        }));
        vi.doMock("nbook/server/agent/http", async () => ({
            ...await vi.importActual<typeof import("nbook/server/agent/http")>("nbook/server/agent/http"),
            useAgentHarness: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/profiles/compile.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    });
});
