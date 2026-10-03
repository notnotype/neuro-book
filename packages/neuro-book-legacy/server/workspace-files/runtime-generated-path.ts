/** 旧位置的隐藏 runtime artifact cache 目录名；任意深度命中都视为可重建生成物。 */
const LEGACY_RUNTIME_CACHE_SEGMENT = ".runtime-artifact-import-cache";

/** 新位置的 cache 目录名；仅允许出现在 NeuroBook 控制区或其 staging 控制区。 */
const RUNTIME_CACHE_SEGMENT = "runtime-artifact-import-cache";

/** World Engine 旧位置的内容 hash 转译中转文件。 */
const WORLD_ENGINE_TEMP_FILE_PATTERN = /^\.world-engine-(?:calendar|schema)-[a-f0-9]{16}\.(?:mjs|ts)$/u;

/**
 * 判断 File Scope 相对路径是否是 NeuroBook 生成、可随时重建的 runtime artifact。
 *
 * watcher、History、Project Workspace File Index 与归档共用该 Interface。
 * 精确保留目录名和 World Engine hash 文件名，普通 `.mjs`、源码与形似说明文件不受影响。
 */
export function isRuntimeGeneratedWorkspacePath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/gu, "");
    if (!normalized) {
        return false;
    }
    const segments = normalized.split("/");
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment === LEGACY_RUNTIME_CACHE_SEGMENT) {
            return true;
        }
        if (
            segment === RUNTIME_CACHE_SEGMENT
            && (segments[index - 1] === ".nbook" || segments[index - 1] === ".staging")
        ) {
            return true;
        }
    }
    return WORLD_ENGINE_TEMP_FILE_PATTERN.test(segments[segments.length - 1]!);
}
