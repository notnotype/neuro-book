import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
} from "nbook/server/plot/http/plot-route";
import {WorldEngineFacade} from "nbook/server/world-engine";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_DATABASE_MODULE_TOKEN,
    type ProjectDatabaseModuleHandle,
} from "nbook/server/workspace-files/project-database-module";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";

/** 单个ProjectSession generation拥有的Plot与World Engine门面。 */
export interface ProjectPlotWorldHandle extends ProjectModuleHandle {
    /** 只允许访问本generation绑定Project的Plot数据面。 */
    readonly plot: PlotFacade;
    /** 只允许访问本generation绑定Project的World Engine数据面。 */
    readonly world: WorldEngineFacade;
}

/** Plot/World lazy Module的稳定typed token。 */
export const PROJECT_PLOT_WORLD_MODULE_TOKEN = projectModuleToken<ProjectPlotWorldHandle>(
    "plot-world",
    "lazy",
);

/**
 * lazy Plot/World Module。
 *
 * start同步捕获当前ResolvedProjectWorkspace并创建一对generation专属facade；最低ready不打开数据库，
 * 后续按需创建的全部client都登记在这两个精确实例内，由同一handle关闭。
 */
export const projectPlotWorldModule: ProjectModule<ProjectPlotWorldHandle> = Object.freeze({
    token: PROJECT_PLOT_WORLD_MODULE_TOKEN,

    start(context): ProjectPlotWorldHandle {
        const database: ProjectDatabaseModuleHandle = context.require(PROJECT_DATABASE_MODULE_TOKEN);
        const fileIndex: ProjectFileIndexHandle = context.require(PROJECT_FILE_INDEX_MODULE_TOKEN);
        const history: ProjectHistoryHandle = context.require(PROJECT_HISTORY_MODULE_TOKEN);
        const world = new WorldEngineFacade(
            context.prepared.workspaceRoot,
            context.prepared.workspace,
            database,
            context.compilerContext ?? Promise.reject(new Error("World Engine 需要显式 Runtime Artifact Compiler Context。")),
        );
        const plot = new PlotFacade(
            context.prepared.workspace,
            context.prepared.project,
            database,
            fileIndex,
            history,
            world,
        );
        let plotClosed = false;
        let worldClosed = false;
        let closing: Promise<void> | null = null;
        let closed = false;

        const handle: ProjectPlotWorldHandle = {
            plot,
            world,
            ready: Promise.resolve().then(() => context.signal.throwIfAborted()),

            async close(): Promise<void> {
                if (closed) {
                    return;
                }
                if (closing) {
                    return closing;
                }
                const attempt = (async () => {
                    // Plot依赖World Engine，必须先完成Plot释放；失败时保留整条依赖供同handle重试。
                    if (!plotClosed) {
                        await plot.close();
                        plotClosed = true;
                    }
                    if (!worldClosed) {
                        await world.close();
                        worldClosed = true;
                    }
                    closed = true;
                })();
                closing = attempt;
                try {
                    await attempt;
                } finally {
                    if (!closed && closing === attempt) {
                        closing = null;
                    }
                }
            },
        };
        return Object.freeze(handle);
    },
});

registerProjectModule(projectPlotWorldModule);

export {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
};
