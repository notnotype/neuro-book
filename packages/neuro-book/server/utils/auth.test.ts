import {beforeEach, describe, expect, it, vi} from "vitest";

const bootConfigMock = vi.hoisted(() => ({enabled: false}));

vi.mock("nbook/server/config/boot-config", () => ({
    loadBootAuthEnabledSync: () => bootConfigMock.enabled,
}));

const prismaMock = {
    user: {
        findUnique: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
};

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: prismaMock,
}));

describe("auth utils", () => {
    beforeEach(() => {
        const globals = globalThis as typeof globalThis & {
            createError?: unknown;
            getUserSession?: unknown;
            setUserSession?: unknown;
            clearUserSession?: unknown;
        };
        vi.clearAllMocks();
        bootConfigMock.enabled = false;
        globals.createError = ((input: {statusCode?: number; message?: string}) => {
            const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
            error.statusCode = input.statusCode;
            return error;
        }) as never;
        globals.getUserSession = vi.fn().mockResolvedValue({});
        globals.setUserSession = vi.fn();
        globals.clearUserSession = vi.fn();
    });

    it("鉴权关闭时管理员访问守卫不会读取 session", async () => {
        const {requireAdminAccess} = await import("nbook/server/utils/auth");

        await expect(requireAdminAccess({} as never)).resolves.toBeUndefined();
        expect((globalThis as typeof globalThis & {getUserSession: ReturnType<typeof vi.fn>}).getUserSession).not.toHaveBeenCalled();
    });

    it("鉴权开启时管理员访问守卫拒绝匿名用户", async () => {
        bootConfigMock.enabled = true;
        (globalThis as typeof globalThis & {getUserSession: ReturnType<typeof vi.fn>}).getUserSession.mockResolvedValue({});
        const {requireAdminAccess} = await import("nbook/server/utils/auth");

        await expect(requireAdminAccess({} as never)).rejects.toMatchObject({statusCode: 401});
    });

    it("鉴权开启时管理员访问守卫拒绝普通用户并允许管理员", async () => {
        bootConfigMock.enabled = true;
        const getUserSessionMock = (globalThis as typeof globalThis & {getUserSession: ReturnType<typeof vi.fn>}).getUserSession;
        getUserSessionMock.mockResolvedValue({user: {id: "1", sessionVersion: 1}});
        prismaMock.user.findUnique.mockResolvedValueOnce({
            id: 1,
            role: "user",
            status: "active",
            sessionVersion: 1,
            lastSeenAt: new Date(),
        });
        const {requireAdminAccess} = await import("nbook/server/utils/auth");
        await expect(requireAdminAccess({} as never)).rejects.toMatchObject({statusCode: 403});

        prismaMock.user.findUnique.mockResolvedValueOnce({
            id: 1,
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastSeenAt: new Date(),
        });
        await expect(requireAdminAccess({} as never)).resolves.toBeUndefined();
    });

    it("密码哈希可以正确校验", async () => {
        const {hashUserPassword, verifyUserPassword} = await import("nbook/server/utils/password");
        const hash = await hashUserPassword("secret123");
        await expect(verifyUserPassword("secret123", hash)).resolves.toBe(true);
        await expect(verifyUserPassword("wrong", hash)).resolves.toBe(false);
    });

    it("不能移除最后一个可用管理员", async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash: "x",
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastLoginAt: null,
            lastSeenAt: null,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        });
        prismaMock.user.count.mockResolvedValue(0);

        const {assertCanChangeAdminState} = await import("nbook/server/utils/auth");
        await expect(assertCanChangeAdminState(prismaMock as never, 1, "user", "active")).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it("管理员状态变更会使用事务级 advisory lock", async () => {
        const {lockAdminStateChanges} = await import("nbook/server/utils/auth");

        await lockAdminStateChanges(prismaMock as never);

        expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it("HTTP 登录会写入非 Secure session cookie", async () => {
        const {setAuthSession} = await import("nbook/server/utils/auth");

        await setAuthSession({
            node: {
                req: {
                    headers: {},
                    connection: {},
                },
            },
        } as never, {
            id: "1",
            username: "admin",
            displayName: "管理员",
            role: "admin",
            sessionVersion: 1,
        });

        expect((globalThis as typeof globalThis & {setUserSession: ReturnType<typeof vi.fn>}).setUserSession).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({
                cookie: expect.objectContaining({
                    secure: false,
                }),
            }),
        );
    });

    it("管理员用户列表 DTO 会输出最后活跃时间", async () => {
        const {toAdminUserListItem} = await import("nbook/server/utils/auth");

        const result = toAdminUserListItem({
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash: "x",
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastLoginAt: null,
            lastSeenAt: new Date("2026-05-19T12:00:00.000Z"),
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        });

        expect(result.lastLoginAt).toBeNull();
        expect(result.lastSeenAt).toBe("2026-05-19T12:00:00.000Z");
    });

    it("获取当前用户时会节流更新最后活跃时间", async () => {
        const staleLastSeenAt = new Date(Date.now() - 120_000);
        const user = {
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash: "x",
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastLoginAt: null,
            lastSeenAt: staleLastSeenAt,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        };
        (globalThis as typeof globalThis & {getUserSession: ReturnType<typeof vi.fn>}).getUserSession.mockResolvedValue({
            user: {
                id: "1",
                sessionVersion: 1,
            },
        });
        prismaMock.user.findUnique.mockResolvedValue(user);
        prismaMock.user.updateMany.mockResolvedValue({count: 1});

        const {getCurrentUser} = await import("nbook/server/utils/auth");
        const result = await getCurrentUser({} as never);

        expect(result?.lastSeenAt).toBeInstanceOf(Date);
        expect(result?.lastSeenAt?.getTime()).toBeGreaterThan(staleLastSeenAt.getTime());
        expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
            where: {
                id: 1,
                OR: [
                    {lastSeenAt: null},
                    {lastSeenAt: {lt: expect.any(Date)}},
                ],
            },
            data: {lastSeenAt: expect.any(Date)},
        });
    });

    it("最后活跃时间未超过节流阈值时不会写库", async () => {
        const recentLastSeenAt = new Date(Date.now() - 30_000);
        const user = {
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash: "x",
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastLoginAt: null,
            lastSeenAt: recentLastSeenAt,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        };
        (globalThis as typeof globalThis & {getUserSession: ReturnType<typeof vi.fn>}).getUserSession.mockResolvedValue({
            user: {
                id: "1",
                sessionVersion: 1,
            },
        });
        prismaMock.user.findUnique.mockResolvedValue(user);

        const {getCurrentUser} = await import("nbook/server/utils/auth");
        const result = await getCurrentUser({} as never);

        expect(result?.lastSeenAt?.toISOString()).toBe(recentLastSeenAt.toISOString());
        expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    });
});
