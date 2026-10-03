import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

/**
 * 解析应用源码/Product 根。Manager 启动的进程会显式传入；普通开发默认 cwd。
 */
export function resolveApplicationRoot(startPath = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    return runtimePathsFromEnv(startPath, env).applicationRoot;
}

/**
 * 解析用户运行状态根。Windows Portable 指向 data/，其他模式默认等于应用根。
 */
export function resolveStateRoot(startPath = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    return runtimePathsFromEnv(startPath, env).stateRoot;
}

/** Workspace Root 的物理目录。Project Path 的逻辑前缀仍为 workspace/。 */
export function resolveStateWorkspaceRoot(startPath = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    return runtimePathsFromEnv(startPath, env).workspaceRoot;
}

/** Boot Config 物理路径。 */
export function resolveBootConfigPath(startPath = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    return runtimePathsFromEnv(startPath, env).bootConfigPath;
}

/** Product/Source 环境文件物理路径。 */
export function resolveStateEnvPath(startPath = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    return runtimePathsFromEnv(startPath, env).stateEnvPath;
}

/** 默认生产日志目录。 */
export function resolveStateLogRoot(startPath = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
    return runtimePathsFromEnv(startPath, env).logRoot;
}
