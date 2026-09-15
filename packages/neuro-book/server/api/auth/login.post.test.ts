import {beforeEach, describe, expect, it, vi} from "vitest";
import {hashUserPassword} from "nbook/server/utils/password";
import {loginFailureMessage, resetLoginSecurityState} from "nbook/server/utils/login-security";

const prismaMock = {
    user: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
};

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: prismaMock,
}));

vi.mock("nbook/server/utils/novel-chapter", () => ({
    validateBody: async () => (globalThis as typeof globalThis & {readBody: ReturnType<typeof vi.fn>}).readBody(),
}));

vi.mock("nbook/server/config/boot-config", () => ({
    loadBootAuthEnabledSync: () => true,
}));

vi.mock("h3", () => ({
    getRequestIP: vi.fn(() => "127.0.0.1"),
    getRequestProtocol: vi.fn(() => "http"),
}));

describe("POST /api/auth/login", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetLoginSecurityState();
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: unknown;
            readBody?: unknown;
            setUserSession?: unknown;
            getUserSession?: unknown;
            clearUserSession?: unknown;
            createError?: unknown;
        };
        globals.defineEventHandler = ((handler: unknown) => handler) as never;
        globals.readBody = vi.fn();
        globals.setUserSession = vi.fn();
        globals.getUserSession = vi.fn().mockResolvedValue({});
        globals.clearUserSession = vi.fn();
        globals.createError = ((input: {statusCode?: number; message?: string}) => {
            const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
            error.statusCode = input.statusCode;
            return error;
        }) as never;
    });

    it("密码正确时会写入 session 并更新时间", async () => {
        const passwordHash = await hashUserPassword("secret123");
        prismaMock.user.findUnique.mockResolvedValue({
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash,
            role: "admin",
            status: "active",
            sessionVersion: 3,
            lastLoginAt: null,
            lastSeenAt: null,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        });
        prismaMock.user.update.mockImplementation(async ({data}: {data: {lastLoginAt: Date}}) => ({
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash,
            role: "admin",
            status: "active",
            sessionVersion: 3,
            lastLoginAt: data.lastLoginAt,
            lastSeenAt: null,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        }));
        (globalThis as typeof globalThis & {readBody: ReturnType<typeof vi.fn>}).readBody.mockResolvedValue({
            username: "admin",
            password: "secret123",
        });

        const handler = (await import("nbook/server/api/auth/login.post")).default;
        const result = await handler({method: "POST", path: "/api/auth/login"} as never);

        expect(result.user).toMatchObject({
            id: "1",
            username: "admin",
            displayName: "管理员",
            role: "admin",
            sessionVersion: 3,
        });
        expect((globalThis as typeof globalThis & {setUserSession: ReturnType<typeof vi.fn>}).setUserSession).toHaveBeenCalledTimes(1);
        expect(prismaMock.user.update).toHaveBeenCalledWith({
            where: {id: 1},
            data: {lastLoginAt: expect.any(Date)},
        });
    });

    it("未知用户只返回统一的登录失败提示", async () => {
        prismaMock.user.findUnique.mockResolvedValue(null);
        (globalThis as typeof globalThis & {readBody: ReturnType<typeof vi.fn>}).readBody.mockResolvedValue({
            username: "missing",
            password: "secret123",
        });

        const handler = (await import("nbook/server/api/auth/login.post")).default;

        await expect(handler({method: "POST", path: "/api/auth/login"} as never)).rejects.toMatchObject({
            statusCode: 401,
            message: loginFailureMessage,
        });
    });
});
