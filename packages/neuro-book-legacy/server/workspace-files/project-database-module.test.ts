import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {createClient} from "@libsql/client";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    PROJECT_DATABASE_MODULE_TOKEN,
    projectDatabaseModule,
} from "nbook/server/workspace-files/project-database-module";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {
    ProjectModule,
    ProjectModuleContext,
    ProjectModuleHandle,
    ProjectModuleToken,
} from "nbook/server/workspace-files/project-module";
import {
    projectModuleRegistry,
    projectModuleToken,
    registerProjectModule,
    replaceProjectModulesForTest,
} from "nbook/server/workspace-files/project-module";
import type {PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";
import type {ProjectLockCompromisedError, ProjectOccupancyHandle} from "nbook/server/workspace-files/project-lock";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

describe("Project Database Module Interface", () => {
    it("模块加载时把descriptor注册到required database位置", () => {
        registerProjectModule(requiredModule("history"));
        registerProjectModule(requiredModule("file-index"));

        expect(projectModuleRegistry().required).toEqual([
            projectDatabaseModule,
            expect.objectContaining({token: expect.objectContaining({name: "history"})}),
            expect.objectContaining({token: expect.objectContaining({name: "file-index"})}),
        ]);

        replaceProjectModulesForTest([projectDatabaseModule]);
    });

    it("以required database token注册并同步返回精确generation handle", async () => {
        const projectRoot = await createTempProjectRoot("descriptor");
        try {
            const handle = projectDatabaseModule.start(projectModuleContext(projectRoot, new AbortController().signal));

            expect(projectDatabaseModule.token).toBe(PROJECT_DATABASE_MODULE_TOKEN);
            expect(PROJECT_DATABASE_MODULE_TOKEN).toMatchObject({name: "database", kind: "required"});
            expect(handle).toMatchObject({
                databasePath: expect.any(Promise),
                ready: expect.any(Promise),
                close: expect.any(Function),
            });

            await handle.ready;
            await handle.close();
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("ready完成前建立Project schema并发布初始化函数返回的绝对数据库路径", async () => {
        const projectRoot = await createTempProjectRoot("schema");
        try {
            const handle = projectDatabaseModule.start(projectModuleContext(projectRoot, new AbortController().signal));

            await handle.ready;
            const databasePath = await handle.databasePath;
            expect(databasePath).toBe(path.join(projectRoot, ".nbook", "project.sqlite"));

            const client = createClient({url: toSqliteFileUrl(databasePath)});
            try {
                const schema = await client.execute(
                    `SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'ProjectMetadata'`,
                );
                expect(schema.rows).toEqual([expect.objectContaining({name: "ProjectMetadata"})]);
            } finally {
                await client.close();
            }
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("start前已经取消时同步返回handle但不开始创建数据库", async () => {
        const projectRoot = await createTempProjectRoot("pre-abort");
        const controller = new AbortController();
        const reason = new DOMException("database start cancelled", "AbortError");
        controller.abort(reason);
        try {
            const handle = projectDatabaseModule.start(projectModuleContext(projectRoot, controller.signal));

            await expect(handle.ready).rejects.toBe(reason);
            await expect(handle.databasePath).rejects.toBe(reason);
            await expect(fs.stat(path.join(projectRoot, ".nbook"))).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await removeTempProject(projectRoot);
        }
    });

    it("schema初始化期间取消时在初始化返回后拒绝ready且close可重复", async () => {
        const projectRoot = await createTempProjectRoot("post-abort");
        const controller = new AbortController();
        const reason = new DOMException("database publish cancelled", "AbortError");
        try {
            const handle = projectDatabaseModule.start(projectModuleContext(projectRoot, controller.signal));
            controller.abort(reason);

            await expect(handle.ready).rejects.toBe(reason);
            await expect(handle.databasePath).rejects.toBe(reason);
            await expect(fs.stat(path.join(projectRoot, ".nbook", "project.sqlite"))).resolves.toBeTruthy();
            await expect(handle.close()).resolves.toBeUndefined();
            await expect(handle.close()).resolves.toBeUndefined();
        } finally {
            await removeTempProject(projectRoot);
        }
    });
});

/** 为registry Interface证据提供不启动真实资源的required同伴Module。 */
function requiredModule(name: "history" | "file-index"): ProjectModule {
    return {
        token: projectModuleToken<ProjectModuleHandle>(name, "required"),
        start: () => ({
            ready: Promise.resolve(),
            async close(): Promise<void> {
                return undefined;
            },
        }),
    };
}

/** 建立只含Database Module所需公开字段的真实generation上下文。 */
function projectModuleContext(projectRoot: string, signal: AbortSignal): ProjectModuleContext {
    const root = absoluteFsPath(projectRoot);
    const workspaceRoot = absoluteFsPath(path.dirname(projectRoot));
    const ref = projectWorkspaceRef(path.basename(projectRoot));
    const workspace = resolvedProjectWorkspace(ref, root, createProjectWorkspaceKey(workspaceRoot, ref));
    const occupancy: ProjectOccupancyHandle = {
        compromised: new Promise<ProjectLockCompromisedError>(() => undefined),
        assertHealthy(): void {
            return undefined;
        },
        async release(): Promise<void> {
            return undefined;
        },
    };
    const prepared: PreparedProjectOpen = {
        revision: 1,
        project: Object.freeze({
            ...ref,
            kind: "novel",
            title: "Database Module Test",
            summary: "",
        }),
        change: "none",
        workspaceRoot,
        workspace,
        occupancy,
    };

    return {
        prepared,
        opener: {kind: "job", source: "project-database-module.test"},
        signal,
        require<THandle extends ProjectModuleHandle>(_token: ProjectModuleToken<THandle>): THandle {
            throw new Error("Database Module不应读取其他Module handle");
        },
    };
}

/** 创建位于临时Workspace Root一级目录下的Project root。 */
async function createTempProjectRoot(label: string): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(testHostPath(`nbook-database-module-${label}-`));
    const projectRoot = path.join(workspaceRoot, "project");
    await fs.mkdir(projectRoot);
    return projectRoot;
}

/** Windows上等待libSQL native handle释放后清理临时Workspace Root。 */
async function removeTempProject(projectRoot: string): Promise<void> {
    const workspaceRoot = path.dirname(projectRoot);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            collectReleasedSqliteHandles({force: true});
            await fs.rm(workspaceRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}
