import {describe, expect, it} from "vitest";
import {
    createProjectAgentSqlModule,
    PROJECT_AGENT_SQL_MODULE_TOKEN,
    projectAgentSqlModule,
} from "nbook/server/agent/tools/agent-sql-project-module";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {
    PROJECT_DATABASE_MODULE_TOKEN,
    type ProjectDatabaseModuleHandle,
} from "nbook/server/workspace-files/project-database-module";
import type {
    ProjectModuleContext,
    ProjectModuleHandle,
    ProjectModuleToken,
} from "nbook/server/workspace-files/project-module";
import type {PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";

describe("Project Agent SQL Module Interface", () => {
    it("以lazy agent-sql token同步绑定同generation Database且ready不等待databasePath", async () => {
        const database: ProjectDatabaseModuleHandle = {
            databasePath: new Promise(() => undefined),
            ready: Promise.resolve(),
            async close(): Promise<void> {
                return undefined;
            },
        };
        let requiredToken: ProjectModuleToken<ProjectModuleHandle> | undefined;
        const context: ProjectModuleContext = {
            prepared: {} as PreparedProjectOpen,
            opener: {kind: "job", source: "agent-sql-project-module.test"},
            signal: new AbortController().signal,
            require<THandle extends ProjectModuleHandle>(token: ProjectModuleToken<THandle>): THandle {
                requiredToken = token;
                // 测试上下文已记录并在断言中验证精确token，generic签名无法表达该运行时收窄。
                return database as unknown as THandle;
            },
        };

        const handle = projectAgentSqlModule.start(context);

        expect(projectAgentSqlModule.token).toBe(PROJECT_AGENT_SQL_MODULE_TOKEN);
        expect(PROJECT_AGENT_SQL_MODULE_TOKEN).toMatchObject({name: "agent-sql", kind: "lazy"});
        expect(requiredToken).toBe(PROJECT_DATABASE_MODULE_TOKEN);
        await expect(handle.ready).resolves.toBeUndefined();
        await expect(handle.close()).resolves.toBeUndefined();
    });

    it("不同generation各自打开Database连接且close只释放当前handle的精确实例", async () => {
        const opened: string[] = [];
        const closeCounts = new Map<string, number>();
        const module = createProjectAgentSqlModule({
            openClient(databasePath) {
                opened.push(databasePath);
                return {
                    async execute() {
                        return {
                            rows: [{databasePath}],
                            rowsAffected: 0,
                        };
                    },
                    async close(): Promise<void> {
                        closeCounts.set(databasePath, (closeCounts.get(databasePath) ?? 0) + 1);
                    },
                };
            },
            clientClosed() {},
        });
        const firstPath = testAbsoluteFsPath("agent-sql", "workspace", "first", ".nbook", "project.sqlite");
        const secondPath = testAbsoluteFsPath("agent-sql", "workspace", "second", ".nbook", "project.sqlite");
        const first = module.start(projectModuleContext(databaseHandle(firstPath)));
        const second = module.start(projectModuleContext(databaseHandle(secondPath)));

        await Promise.all([first.ready, second.ready]);
        await expect(first.execute("SELECT 1")).resolves.toMatchObject({
            mode: "read",
            rows: [{databasePath: firstPath}],
        });
        await expect(second.execute("SELECT 1")).resolves.toMatchObject({
            mode: "read",
            rows: [{databasePath: secondPath}],
        });
        expect(opened).toEqual([firstPath, secondPath]);

        await expect(first.schemaSummary()).resolves.toContain("当前 Project SQLite");

        await first.close();
        expect(closeCounts.get(firstPath)).toBe(1);
        expect(closeCounts.get(secondPath)).toBeUndefined();
        await expect(second.execute("SELECT 2")).resolves.toMatchObject({
            rows: [{databasePath: secondPath}],
        });
        expect(opened).toEqual([firstPath, secondPath]);

        await second.close();
        expect(closeCounts.get(secondPath)).toBe(1);
    });

    it("client close失败后保留精确实例并允许同handle重试", async () => {
        const databasePath = testAbsoluteFsPath("agent-sql", "workspace", "retry", ".nbook", "project.sqlite");
        let openCount = 0;
        let closeCount = 0;
        const firstFailure = new Error("native handle仍被占用");
        const module = createProjectAgentSqlModule({
            openClient() {
                openCount += 1;
                return {
                    async execute() {
                        return {rows: [{ok: true}], rowsAffected: 0};
                    },
                    async close(): Promise<void> {
                        closeCount += 1;
                        if (closeCount === 1) {
                            throw firstFailure;
                        }
                    },
                };
            },
            clientClosed() {},
        });
        const handle = module.start(projectModuleContext(databaseHandle(databasePath)));
        await handle.execute("SELECT 1");

        await expect(handle.close()).rejects.toBe(firstFailure);
        expect(openCount).toBe(1);
        expect(closeCount).toBe(1);
        await expect(handle.execute("SELECT 2")).rejects.toThrow("已经开始关闭");

        await expect(handle.close()).resolves.toBeUndefined();
        expect(openCount).toBe(1);
        expect(closeCount).toBe(2);
        await expect(handle.close()).resolves.toBeUndefined();
        expect(closeCount).toBe(2);
    });
});

/** 构造已完成required ready、只发布数据库路径的同generation Database handle。 */
function databaseHandle(databasePath: AbsoluteFsPath): ProjectDatabaseModuleHandle {
    return {
        databasePath: Promise.resolve(databasePath),
        ready: Promise.resolve(),
        async close(): Promise<void> {
            return undefined;
        },
    };
}

/** 建立Agent SQL Module只依赖Database token的公开启动上下文。 */
function projectModuleContext(database: ProjectDatabaseModuleHandle): ProjectModuleContext {
    return {
        prepared: {} as PreparedProjectOpen,
        opener: {kind: "job", source: "agent-sql-project-module.test"},
        signal: new AbortController().signal,
        require<THandle extends ProjectModuleHandle>(token: ProjectModuleToken<THandle>): THandle {
            if (token.name !== PROJECT_DATABASE_MODULE_TOKEN.name) {
                throw new Error(`Agent SQL Module读取了未知依赖：${token.name}`);
            }
            // token name已完成运行时校验，generic签名无法把该分支收窄为Database handle。
            return database as unknown as THandle;
        },
    };
}
