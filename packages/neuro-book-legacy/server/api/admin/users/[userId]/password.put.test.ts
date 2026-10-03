import {beforeEach, describe, expect, it, vi} from "vitest";

const prismaMock = {
    user: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
};

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: prismaMock,
}));

vi.mock("nbook/server/config/boot-config", () => ({
    loadBootAuthEnabledSync: () => false,
}));

vi.mock("nbook/server/utils/novel-chapter", () => ({
    validateBody: vi.fn(async () => ({password: "secret123"})),
}));

describe("PUT /api/admin/users/:userId/password", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: unknown;
            createError?: unknown;
        };
        globals.defineEventHandler = ((handler: unknown) => handler) as never;
        globals.createError = ((input: {statusCode?: number; message?: string}) => {
            const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
            error.statusCode = input.statusCode;
            return error;
        }) as never;
        prismaMock.$transaction.mockImplementation(async (callback: (transactionClient: typeof prismaMock) => Promise<unknown>) => await callback(prismaMock));
    });

    it("重置密码时会在事务内锁定管理员状态变更", async () => {
        const currentUser = {
            id: 1,
            username: "admin",
            displayName: "管理员",
            passwordHash: "old",
            role: "admin",
            status: "active",
            sessionVersion: 1,
            lastLoginAt: null,
            lastSeenAt: null,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
            updatedAt: new Date("2026-05-17T00:00:00.000Z"),
        };
        prismaMock.user.findUnique.mockResolvedValue(currentUser);
        prismaMock.user.update.mockImplementation(async ({data}: {data: {passwordHash: string; sessionVersion: {increment: number}}}) => ({
            ...currentUser,
            passwordHash: data.passwordHash,
            sessionVersion: currentUser.sessionVersion + data.sessionVersion.increment,
            updatedAt: new Date("2026-05-17T00:00:01.000Z"),
        }));

        const handler = (await import("nbook/server/api/admin/users/[userId]/password.put")).default;
        const result = await handler({
            context: {params: {userId: "1"}},
            method: "PUT",
            path: "/api/admin/users/1/password",
        } as never);

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledTimes(1);
        expect(prismaMock.user.update).toHaveBeenCalledWith({
            where: {id: 1},
            data: {
                passwordHash: expect.stringMatching(/^scrypt:/),
                sessionVersion: {increment: 1},
            },
        });
        expect(result).toMatchObject({
            id: "1",
            username: "admin",
            sessionVersion: 2,
        });
    });
});
