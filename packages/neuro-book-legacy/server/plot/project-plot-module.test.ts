import {mkdir, mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {PROJECT_PLOT_WORLD_MODULE_TOKEN, projectPlotWorldModule, type ProjectPlotWorldHandle} from "nbook/server/plot";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {createProjectWorkspaceKey, projectWorkspaceRef, resolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import type {PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";
import {PROJECT_DATABASE_MODULE_TOKEN, type ProjectDatabaseModuleHandle} from "nbook/server/workspace-files/project-database-module";
import {projectModuleRegistry, type ProjectModuleContext, type ProjectModuleHandle, type ProjectModuleToken} from "nbook/server/workspace-files/project-module";
import type {ProjectOccupancyHandle} from "nbook/server/workspace-files/project-lock";
import {PROJECT_FILE_INDEX_MODULE_TOKEN, type ProjectFileIndexHandle} from "nbook/server/workspace-files/project-file-index";
import {initProjectDatabaseAtRoot} from "nbook/server/workspace-files/project-workspace";
import {PROJECT_HISTORY_MODULE_TOKEN, type ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";
describe("Plot/World ProjectModule", () => {
    const tempRoots: string[] = [];
    const handles: ProjectPlotWorldHandle[] = [];

    afterEach(async () => {
        for (const handle of handles.splice(0).reverse()) {
            await handle.close().catch(() => undefined);
        }
        for (const tempRoot of tempRoots.splice(0).reverse()) {
            await rm(tempRoot, {recursive: true, force: true});
        }
        vi.restoreAllMocks();
    });

    it("以lazy token注册且最低ready不打开Project数据库", async () => {
        const prepared = await createPreparedProject("minimum-ready");
        const handle = projectPlotWorldModule.start(moduleContext(prepared));
        handles.push(handle);

        expect(PROJECT_PLOT_WORLD_MODULE_TOKEN).toMatchObject({name: "plot-world", kind: "lazy"});
        expect(projectPlotWorldModule.token).toBe(PROJECT_PLOT_WORLD_MODULE_TOKEN);
        expect(projectModuleRegistry().lazy.find(({token}) => token.name === "plot-world"))
            .toBe(projectPlotWorldModule);
        expect(handle.plot).toBeDefined();
        expect(handle.world).toBeDefined();
        await expect(handle.ready).resolves.toBeUndefined();
        await expect(stat(path.join(prepared.workspace.root, ".nbook"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("不同handle各自捕获open时的Project manifest，不接受运行时Project切换参数", async () => {
        const firstPrepared = await createPreparedProject("scope-first");
        const secondPrepared = await createPreparedProject("scope-second");
        await Promise.all([
            initProjectDatabaseAtRoot(firstPrepared.workspace.root),
            initProjectDatabaseAtRoot(secondPrepared.workspace.root),
        ]);
        const first = projectPlotWorldModule.start(moduleContext(firstPrepared));
        const second = projectPlotWorldModule.start(moduleContext(secondPrepared));
        handles.push(first, second);

        await expect(first.plot.getStoryDto()).resolves.toMatchObject({title: "scope-first"});
        await expect(second.plot.getStoryDto()).resolves.toMatchObject({title: "scope-second"});
    });

    it("同一Project的两次start捕获不同generation资源，关闭一代不触碰另一代", async () => {
        const prepared = await createPreparedProject("generation-isolation");
        const first = projectPlotWorldModule.start(moduleContext(prepared));
        const second = projectPlotWorldModule.start(moduleContext(prepared));
        handles.push(first, second);
        const firstPlotClose = vi.spyOn(first.plot, "close");
        const firstWorldClose = vi.spyOn(first.world, "close");
        const secondPlotClose = vi.spyOn(second.plot, "close");
        const secondWorldClose = vi.spyOn(second.world, "close");

        expect(first.plot).not.toBe(second.plot);
        expect(first.world).not.toBe(second.world);
        await first.close();

        expect(firstPlotClose).toHaveBeenCalledOnce();
        expect(firstWorldClose).toHaveBeenCalledOnce();
        expect(secondPlotClose).not.toHaveBeenCalled();
        expect(secondWorldClose).not.toHaveBeenCalled();
    });

    it("close失败后保留同一精确facade并只重试未成功的资源", async () => {
        const prepared = await createPreparedProject("retry-close");
        const handle = projectPlotWorldModule.start(moduleContext(prepared));
        handles.push(handle);
        const originalPlotClose = handle.plot.close.bind(handle.plot);
        const plotClose = vi.spyOn(handle.plot, "close")
            .mockRejectedValueOnce(new Error("injected plot close failure"))
            .mockImplementation(originalPlotClose);
        const worldClose = vi.spyOn(handle.world, "close");

        await expect(handle.close()).rejects.toThrow("injected plot close failure");
        expect(plotClose).toHaveBeenCalledOnce();
        expect(worldClose).not.toHaveBeenCalled();

        await expect(handle.close()).resolves.toBeUndefined();
        expect(plotClose).toHaveBeenCalledTimes(2);
        expect(worldClose).toHaveBeenCalledOnce();
        await handle.close();
        expect(plotClose).toHaveBeenCalledTimes(2);
        expect(worldClose).toHaveBeenCalledOnce();
    });

    it("Plot client关闭失败时不删除entry，重试关闭同一个Prisma实例", async () => {
        const prepared = await createPreparedProject("client-retry");
        await writeFile(
            path.join(prepared.workspace.root, "project.yaml"),
            "kind: novel\ntitle: Client Retry\nsummary: ''\n",
            "utf8",
        );
        await initProjectDatabaseAtRoot(prepared.workspace.root);
        const handle = projectPlotWorldModule.start(moduleContext(prepared));
        handles.push(handle);
        await handle.plot.getStoryDto();
        const originalDisconnect = PrismaClient.prototype.$disconnect;
        const disconnectedInstances: PrismaClient[] = [];
        const disconnect = vi.spyOn(PrismaClient.prototype, "$disconnect")
            .mockImplementationOnce(function (this: PrismaClient): Promise<void> {
                disconnectedInstances.push(this);
                return Promise.reject(new Error("injected Prisma disconnect failure"));
            })
            .mockImplementation(function (this: PrismaClient): Promise<void> {
                disconnectedInstances.push(this);
                return originalDisconnect.call(this);
            });

        await expect(handle.close()).rejects.toThrow("injected Prisma disconnect failure");
        await expect(handle.close()).resolves.toBeUndefined();

        expect(disconnect).toHaveBeenCalledTimes(2);
        expect(disconnectedInstances[0]).toBe(disconnectedInstances[1]);
    });

    /** 创建真实一级Project root，但不执行任何模块初始化。 */
    async function createPreparedProject(projectRoot: string): Promise<PreparedProjectOpen> {
        const tempRoot = await mkdtemp(testHostPath("nbook-plot-world-module-"));
        tempRoots.push(tempRoot);
        const workspaceRoot = absoluteFsPath(path.join(tempRoot, "workspace"));
        const root = absoluteFsPath(path.join(workspaceRoot, projectRoot));
        await mkdir(root, {recursive: true});
        const ref = projectWorkspaceRef(projectRoot);
        const workspace = resolvedProjectWorkspace(
            ref,
            root,
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
        const occupancy: ProjectOccupancyHandle = {
            compromised: new Promise(() => undefined),
            assertHealthy(): void {
                return undefined;
            },
            async release(): Promise<void> {
                return undefined;
            },
        };
        return {
            revision: 1,
            project: Object.freeze({
                ...ref,
                kind: "novel",
                title: projectRoot,
                summary: "",
            }),
            change: "none",
            workspace,
            occupancy,
        };
    }
});

/** 构造只启动Plot/World lazy Module所需的公开generation上下文。 */
function moduleContext(prepared: PreparedProjectOpen): ProjectModuleContext {
    const database: ProjectDatabaseModuleHandle = {
        databasePath: Promise.resolve(absoluteFsPath(path.join(prepared.workspace.root, ".nbook", "project.sqlite"))),
        ready: Promise.resolve(),
        async close(): Promise<void> {
            return undefined;
        },
    };
    const fileIndex: ProjectFileIndexHandle = {
        ready: Promise.resolve(),
        async close(): Promise<void> {
            return undefined;
        },
        async read() {
            throw new Error("本测试未请求File Index snapshot");
        },
        async mutate<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> {
            return operation();
        },
        subscribe() {
            throw new Error("本测试未订阅File Index");
        },
    };
    const compilerContext = resolveRuntimeArtifactCompilerContext(path.resolve(import.meta.dirname, "../../"));
    const history: ProjectHistoryHandle = {
        history: Promise.resolve(null),
        ready: Promise.resolve(),
        async waitForWarmup(): Promise<void> {
            return undefined;
        },
        diagnostics: () => ({
            warmup: {
                state: "disabled",
                phase: null,
                attemptCount: 0,
                startedAt: null,
                succeededAt: null,
                lastFailure: null,
            },
        }),
        pathPolicy: () => ({disposition: "consume", relativePath: "manuscript/index.md"}),
        async reconcileRawEvents(): Promise<void> {
            return undefined;
        },
        async close(): Promise<void> {
            return undefined;
        },
    };
    return {
        prepared,
        opener: {kind: "job", source: "project-plot-module.test"},
        signal: new AbortController().signal,
        compilerContext,
        require<THandle extends ProjectModuleHandle>(token: ProjectModuleToken<THandle>): THandle {
            if (token.name === PROJECT_DATABASE_MODULE_TOKEN.name) {
                return database as ProjectModuleHandle as THandle;
            }
            if (token.name === PROJECT_FILE_INDEX_MODULE_TOKEN.name) {
                // 测试上下文只注册这一项依赖；token名称已经完成运行时收窄。
                return fileIndex as ProjectModuleHandle as THandle;
            }
            if (token.name === PROJECT_HISTORY_MODULE_TOKEN.name) {
                return history as ProjectModuleHandle as THandle;
            }
            throw new Error(`Plot/World Module没有前置Module依赖：${token.name}`);
        },
    };
}
