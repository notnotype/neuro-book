import {ensurePrismaRuntime} from "nbook/server/deploy/prisma-runtime-preflight";

type PrismaClientInstance = typeof import("nbook/server/utils/prisma").prisma;
let prisma: PrismaClientInstance | null = null;

/**
 * 输出 App SQLite 中是否已经存在用户。
 *
 * Windows portable bootstrap 用它决定首次启动时是否需要内联引导创建管理员。
 */
async function main(): Promise<void> {
    await ensurePrismaRuntime();
    ({prisma} = await import("nbook/server/utils/prisma"));
    const count = await prisma.user.count();
    console.log(count > 0 ? "yes" : "no");
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma?.$disconnect();
    });
