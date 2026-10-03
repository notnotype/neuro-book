import {PrismaLibSql} from "@prisma/adapter-libsql";
import "@libsql/isomorphic-ws";
import {PrismaClient} from "nbook/server/generated/prisma/client";
import {resolveDatabaseConfig} from "nbook/server/database/config";

export type {PrismaClient};
export {Prisma} from "nbook/server/generated/prisma/client";
export type {
    User,
    UserRole,
} from "nbook/server/generated/prisma/client";

type GlobalPrisma = {
    prismaClient?: PrismaClient;
};

const globalForPrisma = globalThis as typeof globalThis & GlobalPrisma;
/**
 * 创建 App SQLite PrismaClient。
 */
const createPrismaClient = (): PrismaClient => {
    const config = resolveDatabaseConfig();
    const adapter = new PrismaLibSql({url: config.url});

    return new PrismaClient({
        adapter,
    });
};

/**
 * 获取进程级 PrismaClient 单例。
 */
export const usePrismaClient = (): PrismaClient => {
    if (!globalForPrisma.prismaClient) {
        globalForPrisma.prismaClient = createPrismaClient();
    }

    return globalForPrisma.prismaClient;
};

/**
 * 断开并清空进程级 App SQLite PrismaClient。
 *
 * Product shutdown 后进程会立即退出；即使 disconnect 报错也不能把已经进入关闭流程的
 * client 留在全局单例中，避免后续 close step 误认为它仍可用。
 */
export const disconnectPrismaClient = async (): Promise<void> => {
    const client = globalForPrisma.prismaClient;
    if (!client) return;
    try {
        await client.$disconnect();
    } finally {
        if (globalForPrisma.prismaClient === client) {
            delete globalForPrisma.prismaClient;
        }
    }
};

/**
 * 便捷导出：适合在 server/api 中直接使用。
 */
export const prisma = usePrismaClient();
