import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";
/**
 * 可解析的 assets 来源。
 */
export type AssetSource = "user" | "system";

/**
 * 解析后的 assets 文件。
 */
export type ResolvedAssetFile = {
    absolutePath: string;
    relativePath: string;
    source: AssetSource;
};

/**
 * 解析后的 assets 目录。
 */
export type ResolvedAssetDirectory = {
    name: string;
    absolutePath: string;
    relativePath: string;
    source: AssetSource;
};

/**
 * 解析系统 assets 与用户 assets 的覆盖关系。
 */
export class AssetResolver {
    constructor(
        private readonly startPath?: string,
        private readonly runtimePaths?: RuntimePaths,
    ) {}

    /** 解析器只保存入口提示，不缓存 cwd 或运行根；每次读取使用当前 Runtime 环境。 */
    private get runtimeStartPath(): string {
        return this.startPath ?? process.cwd();
    }

    /** Install Root；非 Agent legacy assets 仍与 user overlay 共用 State `.nbook`。 */
    get systemRoot(): string {
        return this.runtimePaths?.userNbookRoot ?? resolveSystemNbookRoot(this.runtimeStartPath);
    }

    /** Legacy user assets 根目录。 */
    get userRoot(): string {
        return this.runtimePaths?.userNbookRoot ?? resolveUserNbookRoot(this.runtimeStartPath);
    }

    /**
     * 按用户优先顺序解析单个 assets 文件。
     */
    async resolveFile(relativePath: string): Promise<ResolvedAssetFile | null> {
        const normalizedPath = normalizeAssetRelativePath(relativePath);
        const userPath = path.join(this.userRoot, normalizedPath);
        if (await isFile(userPath)) {
            return {
                absolutePath: userPath,
                relativePath: toPosixPath(normalizedPath),
                source: "user",
            };
        }

        const systemPath = path.join(this.systemRoot, normalizedPath);
        if (await isFile(systemPath)) {
            return {
                absolutePath: systemPath,
                relativePath: toPosixPath(normalizedPath),
                source: "system",
            };
        }

        return null;
    }

    /**
     * 同步解析单个 assets 文件，供 CLI 模板渲染等同步路径使用。
     */
    resolveFileSync(relativePath: string): ResolvedAssetFile | null {
        const normalizedPath = normalizeAssetRelativePath(relativePath);
        const userPath = path.join(this.userRoot, normalizedPath);
        if (isFileSync(userPath)) {
            return {
                absolutePath: userPath,
                relativePath: toPosixPath(normalizedPath),
                source: "user",
            };
        }

        const systemPath = path.join(this.systemRoot, normalizedPath);
        if (isFileSync(systemPath)) {
            return {
                absolutePath: systemPath,
                relativePath: toPosixPath(normalizedPath),
                source: "system",
            };
        }

        return null;
    }

    /**
     * 读取用户覆盖后的 assets 文件。
     */
    async readFile(relativePath: string): Promise<string> {
        const resolved = await this.resolveFile(relativePath);
        if (!resolved) {
            throw new Error(`assets 文件不存在: ${toPosixPath(relativePath)}`);
        }
        return fs.readFile(resolved.absolutePath, "utf-8");
    }

    /**
     * 列出目录下一级子目录；同名目录按用户优先整体覆盖。
     */
    async listDirectories(relativePath: string): Promise<ResolvedAssetDirectory[]> {
        const normalizedPath = normalizeAssetRelativePath(relativePath);
        const directoriesByName = new Map<string, ResolvedAssetDirectory>();

        await this.appendDirectories(directoriesByName, path.join(this.systemRoot, normalizedPath), normalizedPath, "system");
        await fs.mkdir(this.userRoot, {recursive: true});
        await this.appendDirectories(directoriesByName, path.join(this.userRoot, normalizedPath), normalizedPath, "user");

        return [...directoriesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    }

    /**
     * 将目录按系统基础 + 用户覆盖复制到目标目录。
     */
    async copyMergedDirectory(relativePath: string, targetRoot: string): Promise<void> {
        const normalizedPath = normalizeAssetRelativePath(relativePath);
        const systemPath = path.join(this.systemRoot, normalizedPath);
        const userPath = path.join(this.userRoot, normalizedPath);
        const mergedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-asset-merge-"));

        try {
            if (await isDirectory(systemPath)) {
                await fs.cp(systemPath, mergedRoot, {
                    recursive: true,
                    force: true,
                    errorOnExist: false,
                });
            }
            if (await isDirectory(userPath)) {
                await fs.cp(userPath, mergedRoot, {
                    recursive: true,
                    force: true,
                    errorOnExist: false,
                });
            }
            await fs.cp(mergedRoot, targetRoot, {
                recursive: true,
                force: false,
                errorOnExist: false,
            });
        } finally {
            await fs.rm(mergedRoot, {recursive: true, force: true});
        }
    }

    /**
     * 追加目录下的一级目录。
     */
    private async appendDirectories(
        directoriesByName: Map<string, ResolvedAssetDirectory>,
        root: string,
        relativeRoot: string,
        source: AssetSource,
    ): Promise<void> {
        let entries: Array<import("node:fs").Dirent>;
        try {
            entries = await fs.readdir(root, {withFileTypes: true});
        } catch (error) {
            if (isMissingPathError(error)) {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const childRelativePath = path.join(relativeRoot, entry.name);
            directoriesByName.set(entry.name, {
                name: entry.name,
                absolutePath: path.join(root, entry.name),
                relativePath: toPosixPath(childRelativePath),
                source,
            });
        }
    }
}

/**
 * 默认 assets 解析器。
 */
export const assetResolver = new AssetResolver();

/**
 * 归一化 assets 内部相对路径，禁止逃逸根目录。
 */
export function normalizeAssetRelativePath(relativePath: string): string {
    const normalizedPath = path.normalize(relativePath).replace(/^([/\\])+/, "");
    if (normalizedPath === ".." || normalizedPath.startsWith(`..${path.sep}`)) {
        throw new Error(`非法 assets 路径: ${relativePath}`);
    }
    return normalizedPath;
}

/**
 * 转换为展示用 POSIX 路径。
 */
export function toPosixPath(inputPath: string): string {
    return inputPath.split(path.sep).join("/");
}

/**
 * 判断路径是否为普通文件。
 */
async function isFile(filePath: string): Promise<boolean> {
    try {
        return (await fs.stat(filePath)).isFile();
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}

/**
 * 判断路径是否为目录。
 */
async function isDirectory(directoryPath: string): Promise<boolean> {
    try {
        return (await fs.stat(directoryPath)).isDirectory();
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}

/**
 * 判断是否为路径不存在错误。
 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}

/**
 * 同步判断路径是否为普通文件。
 */
function isFileSync(filePath: string): boolean {
    try {
        return fsSync.statSync(filePath).isFile();
    } catch (error) {
        if (isMissingPathError(error)) {
            return false;
        }
        throw error;
    }
}
