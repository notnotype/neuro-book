import {copyFile, mkdir, readdir, rm, stat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

type NativeImport = (specifier: string) => Promise<unknown>;
type RuntimeArtifactQuery = Record<string, string | number | bigint | boolean>;

/** 单个 namespace 的物理副本上限。条目数与字节数两个维度同时生效，谁先触发用谁。 */
export type RuntimeArtifactRetention = {
    /** 保留的条目数上限，超出部分按 mtime 从旧到新驱逐。 */
    maxEntries: number;
    /** namespace 内所有物理副本的字节上限。 */
    maxBytes: number;
};

/** 默认 retention。调用方仍需显式传入，以此强制作者看见回收责任。 */
export const DEFAULT_RUNTIME_ARTIFACT_RETENTION: RuntimeArtifactRetention = {
    maxEntries: 64,
    maxBytes: 32 * 1024 * 1024,
};

/**
 * 物理执行副本的落点与回收合同。
 *
 * 只有「源路径不随内容变」的调用方需要它：Bun 的 ESM module cache 只按 pathname 去重，
 * 忽略 file URL 上的 `?v=hash`，所以换内容必须换物理路径。
 * 源路径本身已经内容寻址时**必须省略 cache**，直接 import 原路径。
 */
export type RuntimeArtifactCacheSpec = {
    /** 物理缓存根必须由领域 Adapter 显式决定，禁止从 cwd 或只读 artifact 位置猜测。 */
    root: string;
    /** 同一 root 下按 artifact 家族分目录；回收以 namespace 为单位。 */
    namespace: string;
    /** 内容寻址 key，通常是 artifact sha256。 */
    key: string;
    /** 源 artifact 字节数。已存在副本字节数不等时重建副本。 */
    bytes: number;
    /** namespace 级 retention policy，必填；这是阻止无界持久缓存的类型层门禁。 */
    retention: RuntimeArtifactRetention;
};

type RuntimeArtifactImportOptions = {
    /** 附加给 file URL 的 query，仅用于诊断或 Node module cache，不作为 Bun cache key。 */
    query?: RuntimeArtifactQuery;
    /** 为空表示直接 import 源路径，不建立任何持久副本。 */
    cache?: RuntimeArtifactCacheSpec;
};

const nativeImport = new Function("specifier", "return import(specifier)") as NativeImport;

/**
 * 导入运行时生成的 ESM artifact 文件。
 *
 * Product/Nitro 会接管普通 `import(variable)` 并尝试从 bundle 图里解析模块。
 * `.compiled/*.mjs`、World Engine hash `.mjs` 这类运行时落盘产物必须走这里，
 * 避免打包器把 Windows file URL / 绝对路径当成构建期依赖处理。
 */
export async function importRuntimeArtifact<TModule>(
    artifactPath: string,
    options: RuntimeArtifactImportOptions = {},
): Promise<TModule> {
    const importPath = options.cache
        ? await prepareCachedArtifactPath(artifactPath, options.cache)
        : artifactPath;
    return await importSpecifierNatively<TModule>(runtimeArtifactSpecifier(importPath, options.query ?? {}));
}

async function prepareCachedArtifactPath(artifactPath: string, cache: RuntimeArtifactCacheSpec): Promise<string> {
    const namespaceRoot = join(resolve(cache.root), safeSegment(cache.namespace));
    const importPath = join(namespaceRoot, `${safeSegment(cache.key)}.mjs`);
    const existing = await stat(importPath).catch(() => null);
    if (existing && existing.size === cache.bytes) {
        return importPath;
    }
    await mkdir(namespaceRoot, {recursive: true});
    await copyFile(artifactPath, importPath);
    // 只在 miss 写入后回收一次；命中路径不付任何额外代价。
    await enforceRuntimeArtifactRetention(namespaceRoot, cache.retention, importPath);
    return importPath;
}

/**
 * 把单个 namespace 的物理副本收敛回 retention policy 之内。
 *
 * 按 mtime 从新到旧保留，超出条目数或字节预算的部分删除。
 * 三条不变式：绝不驱逐本次即将 import 的文件；驱逐失败一律吞掉（Bun/Node 的 ESM
 * module cache 会持有已加载模块，Windows 上可能 EPERM），下次 miss 再试；
 * 多进程并发驱逐同一文件由 `force: true` 覆盖 ENOENT。
 */
async function enforceRuntimeArtifactRetention(
    namespaceRoot: string,
    retention: RuntimeArtifactRetention,
    keepPath: string,
): Promise<void> {
    const entries = await readdir(namespaceRoot, {withFileTypes: true}).catch(() => []);
    const candidates: {path: string; bytes: number; mtimeMs: number}[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".mjs")) {
            continue;
        }
        const filePath = join(namespaceRoot, entry.name);
        if (filePath === keepPath) {
            continue;
        }
        const fileStat = await stat(filePath).catch(() => null);
        if (fileStat) {
            candidates.push({path: filePath, bytes: fileStat.size, mtimeMs: fileStat.mtimeMs});
        }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const keepStat = await stat(keepPath).catch(() => null);
    let entryCount = 1;
    let byteTotal = keepStat?.size ?? 0;
    for (const candidate of candidates) {
        entryCount += 1;
        byteTotal += candidate.bytes;
        if (entryCount <= retention.maxEntries && byteTotal <= retention.maxBytes) {
            continue;
        }
        await rm(candidate.path, {force: true}).catch(() => undefined);
    }
}

/**
 * 归一化目录/文件名片段。
 * 当前所有 cache key 都是 hex sha，不存在折叠碰撞；若将来允许非 hex key 需重新评估。
 */
function safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "artifact";
}

function runtimeArtifactSpecifier(artifactPath: string, query: RuntimeArtifactQuery): string {
    const artifactUrl = pathToFileURL(artifactPath);
    for (const [key, value] of Object.entries(query)) {
        artifactUrl.searchParams.set(key, String(value));
    }
    return artifactUrl.href;
}

async function importSpecifierNatively<TModule>(specifier: string): Promise<TModule> {
    try {
        return await nativeImport(specifier) as TModule;
    } catch (error) {
        if (!isMissingDynamicImportCallback(error)) {
            throw error;
        }
        return await import(/* @vite-ignore */ specifier) as TModule;
    }
}

/** 判断当前宿主是否是缺少 eval/new Function 动态导入回调的测试 VM。 */
function isMissingDynamicImportCallback(error: unknown): boolean {
    return error instanceof TypeError
        && error.message.includes("dynamic import callback");
}
