import path from "node:path";
import {homedir} from "node:os";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** 一次NeuroBook进程使用的不可变物理根集合。 */
export type RuntimePaths = Readonly<{
    applicationRoot: AbsoluteFsPath;
    stateRoot: AbsoluteFsPath;
    cacheRoot: AbsoluteFsPath;
    workspaceRoot: AbsoluteFsPath;
    userNbookRoot: AbsoluteFsPath;
    bootConfigPath: AbsoluteFsPath;
    stateEnvPath: AbsoluteFsPath;
    logRoot: AbsoluteFsPath;
    imageVariantRoot: AbsoluteFsPath;
    llmlintStateRoot: AbsoluteFsPath;
    llmlintCacheRoot: AbsoluteFsPath;
    bunInstallCacheRoot: AbsoluteFsPath;
    bashOutputRoot: AbsoluteFsPath;
    secretsRoot: AbsoluteFsPath;
    backupKeyringPath: AbsoluteFsPath;
}>;

/**
 * 从已确定的Application Root与State Root建立Runtime Paths。
 *
 * 本函数不读取cwd或环境变量；生产、开发和测试Adapter必须在调用前决定两个根。
 */
export function createRuntimePaths(input: {
    applicationRoot: AbsoluteFsPath;
    stateRoot: AbsoluteFsPath;
    /** 未提供时使用State Root下的cache，供源码开发与隔离测试使用。 */
    cacheRoot?: AbsoluteFsPath;
}): RuntimePaths {
    const cacheRoot = input.cacheRoot ?? absoluteFsPath(path.join(input.stateRoot, "cache"));
    return Object.freeze({
        applicationRoot: input.applicationRoot,
        stateRoot: input.stateRoot,
        cacheRoot,
        workspaceRoot: absoluteFsPath(path.join(input.stateRoot, "workspace")),
        userNbookRoot: absoluteFsPath(path.join(input.stateRoot, "workspace", ".nbook")),
        bootConfigPath: absoluteFsPath(path.join(input.stateRoot, "config.yaml")),
        stateEnvPath: absoluteFsPath(path.join(input.stateRoot, ".env")),
        logRoot: absoluteFsPath(path.join(input.stateRoot, "logs")),
        imageVariantRoot: absoluteFsPath(path.join(cacheRoot, "image-variants")),
        llmlintStateRoot: absoluteFsPath(path.join(input.stateRoot, "tool-state", "llmlint")),
        llmlintCacheRoot: absoluteFsPath(path.join(cacheRoot, "llmlint")),
        bunInstallCacheRoot: absoluteFsPath(path.join(cacheRoot, "bun", "install")),
        bashOutputRoot: absoluteFsPath(path.join(cacheRoot, "agent", "bash-output")),
        secretsRoot: absoluteFsPath(path.join(input.stateRoot, "secrets")),
        backupKeyringPath: absoluteFsPath(path.join(input.stateRoot, "secrets", "backup-keyring.json")),
    });
}

/**
 * 进程环境Adapter：按Manager传入的环境变量或显式startPath建立Runtime Paths。
 * 未设置State/Cache时使用平台用户级根，绝不把运行态写回repository/application source root。
 */
export function runtimePathsFromEnv(
    startPath = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
): RuntimePaths {
    const startRoot = path.resolve(startPath);
    const applicationInput = env.NEURO_BOOK_APPLICATION_ROOT?.trim();
    const applicationRoot = absoluteFsPath(applicationInput
        ? path.isAbsolute(applicationInput)
            ? applicationInput
            : path.resolve(startRoot, applicationInput)
        : startRoot);
    const defaults = defaultUserRoots(env);
    const stateInput = env.NEURO_BOOK_STATE_ROOT?.trim();
    const stateRoot = absoluteFsPath(stateInput
        ? path.isAbsolute(stateInput)
            ? stateInput
            : path.resolve(applicationRoot, stateInput)
        : defaults.stateRoot);
    const cacheInput = env.NEURO_BOOK_CACHE_ROOT?.trim();
    const cacheRoot = absoluteFsPath(cacheInput
        ? path.isAbsolute(cacheInput)
            ? cacheInput
            : path.resolve(applicationRoot, cacheInput)
        : defaults.cacheRoot);
    return createRuntimePaths({applicationRoot, stateRoot, cacheRoot});
}

function defaultUserRoots(env: NodeJS.ProcessEnv): {stateRoot: string; cacheRoot: string} {
    const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
    if (process.platform === "win32") {
        const base = path.resolve(env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local"), "NeuroBook");
        return {stateRoot: path.join(base, "data"), cacheRoot: path.join(base, "cache")};
    }
    if (process.platform === "darwin") {
        return {
            stateRoot: path.join(home, "Library", "Application Support", "NeuroBook", "data"),
            cacheRoot: path.join(home, "Library", "Caches", "NeuroBook"),
        };
    }
    return {
        stateRoot: path.join(env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share"), "NeuroBook", "data"),
        cacheRoot: path.join(env.XDG_CACHE_HOME?.trim() || path.join(home, ".cache"), "NeuroBook"),
    };
}
