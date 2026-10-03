import {PrismaLibSql} from "@prisma/adapter-libsql";
import type {Client, Config} from "@libsql/client";

/**
 * 记录 Prisma adapter 创建的 libsql client，便于删除 Project 前显式释放 Windows 文件句柄。
 */
export class TrackedPrismaLibSql extends PrismaLibSql {
    private readonly openedClients: Client[] = [];

    /**
     * 创建并记录底层 libsql client。
     */
    override createClient(config: Config): Client {
        const client = super.createClient(config);
        this.openedClients.push(client);
        return client;
    }

    /**
     * 显式关闭所有已创建的底层 libsql client。Prisma $disconnect 后重复 close 视为清理兜底。
     */
    closeTrackedClients(): void {
        for (const client of this.openedClients.splice(0)) {
            try {
                client.close();
            } catch {
                // libsql close 是幂等清理兜底；已关闭的 client 可忽略。
            }
        }
    }
}
