import type {H3Event} from "h3";
import {getRequestProtocol} from "h3";
import {revokeStorageAuthSession} from "nbook/server/storage/host";
import type {Prisma, PrismaClient, User, UserRole} from "nbook/server/generated/prisma/client";
import {loadBootAuthEnabledSync} from "nbook/server/config/boot-config";
import {lockDatabaseKey} from "nbook/server/database/locks";
import {prisma} from "nbook/server/utils/prisma";
import type {AdminUserListItemDto, AuthUserDto} from "nbook/shared/dto/auth.dto";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

const adminStateLockId = 550317001;
const lastSeenWriteIntervalMs = 60_000;

/**
 * 根据当前请求协议生成 session 配置。HTTP 测试站点不能使用 Secure cookie。
 */
function authSessionConfig(event: H3Event) {
    return {
        cookie: {
            secure: getRequestProtocol(event) === "https",
            sameSite: "lax" as const,
        },
    };
}

/**
 * 判断 Boot Config 是否启用全站鉴权。未配置时开发环境关闭、其他环境开启。
 */
export function isAuthEnabled(): boolean {
    return loadBootAuthEnabledSync();
}

/**
 * 写入当前用户 session。
 */
export async function setAuthSession(event: H3Event, user: AuthUserDto): Promise<void> {
    // setUserSession 合并旧数据且保留 session ID；成功登录必须撤销旧访问并轮换会话。
    await clearAuthSession(event);
    await setUserSession(event, {user}, authSessionConfig(event));
}

/**
 * 清理当前用户 session。
 */
export async function clearAuthSession(event: H3Event): Promise<void> {
    const session = await getUserSession(event);
    if (session.user?.id && session.id) revokeStorageAuthSession(session.id);
    await clearUserSession(event, authSessionConfig(event));
}

/**
 * 将用户实体映射为可写入 session 的轻量身份。
 */
export function toAuthUser(user: Pick<User, "id" | "username" | "displayName" | "role" | "sessionVersion">): AuthUserDto {
    return {
        id: String(user.id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        sessionVersion: user.sessionVersion,
    };
}

/**
 * 将用户实体映射为管理员列表 DTO。
 */
export function toAdminUserListItem(user: User): AdminUserListItemDto {
    return {
        id: String(user.id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        sessionVersion: user.sessionVersion,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    };
}

/**
 * 解析用户 ID 路由参数。
 */
export function requireUserId(event: H3Event): number {
    const rawUserId = event.context.params?.userId ?? "";
    if (!/^\d+$/.test(rawUserId)) {
        throw createError({
            statusCode: 400,
            message: "userId 必须是正整数",
        });
    }

    const userId = Number.parseInt(rawUserId, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw createError({
            statusCode: 400,
            message: "userId 必须是正整数",
        });
    }

    return userId;
}

/**
 * 获取当前请求的有效用户。
 */
export async function getCurrentUser(event: H3Event): Promise<User | null> {
    const session = await getUserSession(event);
    const sessionUserId = session.user?.id;
    if (!sessionUserId) {
        return null;
    }

    const userId = Number.parseInt(sessionUserId, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        await clearAuthSession(event);
        return null;
    }

    const user = await prisma.user.findUnique({
        where: {id: userId},
    });
    if (!user || user.status !== "active" || user.sessionVersion !== session.user?.sessionVersion) {
        await clearAuthSession(event);
        return null;
    }

    const lastSeenThreshold = new Date(Date.now() - lastSeenWriteIntervalMs);
    if (!user.lastSeenAt || user.lastSeenAt < lastSeenThreshold) {
        const now = new Date();
        await prisma.user.updateMany({
            where: {
                id: user.id,
                OR: [
                    {lastSeenAt: null},
                    {lastSeenAt: {lt: lastSeenThreshold}},
                ],
            },
            data: {lastSeenAt: now},
        });
        return {
            ...user,
            lastSeenAt: now,
        };
    }

    return user;
}

/**
 * 要求当前请求来自已登录用户。
 */
export async function requireCurrentUser(event: H3Event): Promise<User> {
    const user = await getCurrentUser(event);
    if (!user) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }

    return user;
}

/**
 * 当前请求的 session 标识摘要来源，仅用于定位撤销；它不代替 requireCurrentUser 的主体核验。
 *
 * 登出再登录会换 session，因此同一用户编号不会让旧访问上下文继续有效。
 * h3 可能为匿名请求新建 session；宿主仍须核验用户，鉴权关闭时使用本地代次，不调用本函数。
 */
export async function requireCurrentAuthSessionId(event: H3Event): Promise<string> {
    const session = await getUserSession(event);
    if (!session.id) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }

    return session.id;
}

/**
 * 要求当前请求来自管理员。
 */
export async function requireAdmin(event: H3Event): Promise<User> {
    const user = await requireCurrentUser(event);
    if (user.role !== "admin") {
        throw createError({
            statusCode: 403,
            message: "需要管理员权限",
        });
    }

    return user;
}

/**
 * 执行管理员 API 的统一访问守卫。鉴权关闭时，管理员接口按本地无鉴权模式放行。
 */
export async function requireAdminAccess(event: H3Event): Promise<void> {
    if (!isAuthEnabled()) {
        return;
    }
    await requireAdmin(event);
}

/**
 * 在事务内串行化管理员状态变更，避免并发撤掉最后一个管理员。
 */
export async function lockAdminStateChanges(prismaClient: PrismaExecutor): Promise<void> {
    await lockDatabaseKey(prismaClient, adminStateLockId);
}

/**
 * 确保不会移除最后一个可用管理员。
 */
export async function assertCanChangeAdminState(prismaClient: PrismaExecutor, userId: number, nextRole?: UserRole, nextStatus?: "active" | "disabled"): Promise<void> {
    const user = await prismaClient.user.findUnique({
        where: {id: userId},
    });
    if (!user || user.role !== "admin" || user.status !== "active") {
        return;
    }

    const removesAdminPower = nextRole === "user" || nextStatus === "disabled";
    if (!removesAdminPower) {
        return;
    }

    const activeAdminCount = await prismaClient.user.count({
        where: {
            role: "admin",
            status: "active",
            id: {not: userId},
        },
    });
    if (activeAdminCount === 0) {
        throw createError({
            statusCode: 400,
            message: "不能移除最后一个可用管理员",
        });
    }
}
