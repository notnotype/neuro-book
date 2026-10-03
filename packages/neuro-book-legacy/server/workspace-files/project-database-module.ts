import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";
import {initProjectDatabaseAtRoot} from "nbook/server/workspace-files/project-workspace";

/** Database Module当前generation发布的schema-ready结果。 */
export interface ProjectDatabaseModuleHandle extends ProjectModuleHandle {
    /** schema初始化成功后得到的Project SQLite绝对路径；取消或初始化失败时拒绝。 */
    readonly databasePath: Promise<AbsoluteFsPath>;
}

/** Project Database的稳定typed token。 */
export const PROJECT_DATABASE_MODULE_TOKEN = projectModuleToken<ProjectDatabaseModuleHandle>(
    "database",
    "required",
);

/**
 * required Database Module。
 *
 * 初始化函数自行拥有并关闭迁移期间的临时client，本handle不持有长生命周期数据库连接。
 */
export const projectDatabaseModule: ProjectModule<ProjectDatabaseModuleHandle> = Object.freeze({
    token: PROJECT_DATABASE_MODULE_TOKEN,

    /** 同步捕获本generation的root与signal，并立即返回可由Session接管的精确handle。 */
    start(context) {
        const databasePath = (async (): Promise<AbsoluteFsPath> => {
            context.signal.throwIfAborted();
            const initializedPath = await initProjectDatabaseAtRoot(context.prepared.workspace.root);
            context.signal.throwIfAborted();
            return absoluteFsPath(initializedPath);
        })();
        const ready = databasePath.then(() => undefined);

        return Object.freeze({
            databasePath,
            ready,
            /** 本适配器没有持久资源；重复关闭始终只完成当前handle的空释放。 */
            async close(): Promise<void> {
                return undefined;
            },
        });
    },
});

registerProjectModule(projectDatabaseModule);
