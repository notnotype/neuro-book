type DatabaseLockExecutor = {
    $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

/**
 * 在当前事务中获取数据库锁。
 *
 * SQLite 在同一个 Prisma transaction 内写入内部锁表，
 * 借数据库写锁保护 read-before-write 的排序/管理员检查窗口。
 */
export async function lockDatabaseKey(prismaClient: DatabaseLockExecutor, key: number): Promise<void> {
    const lockKey = Math.trunc(key);
    await prismaClient.$executeRawUnsafe(
        `INSERT INTO "DatabaseLock" ("key", "updatedAt") VALUES (${String(lockKey)}, CURRENT_TIMESTAMP) ON CONFLICT("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP`,
    );
}
