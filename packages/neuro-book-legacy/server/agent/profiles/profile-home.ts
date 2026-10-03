import fs from "node:fs/promises";
import path from "node:path";
import {
    absoluteFsPath,
    assertRealParentContained,
    assertRealPathContained,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    type ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {
    ProfileHomeContext,
    ProfileHomeDefinition,
    ProfileHomeFacade,
    ProfileHomeListItem,
    ProfileHomeScope,
    ProfileHomeWriteMode,
    ProfileHomeWriteResult,
    ProfileJsonValue,
} from "nbook/profile-sdk/contracts";
export type {
    ProfileHomeContext,
    ProfileHomeDefinition,
    ProfileHomeFacade,
    ProfileHomeListItem,
    ProfileHomeScope,
    ProfileHomeWriteMode,
    ProfileHomeWriteResult,
} from "nbook/profile-sdk/contracts";

type ProfileHomeMetadata = {
    profileKey: string;
    version: number;
    initializedAt: string;
    updatedAt: string;
};

/**
 * 定义 profile home 生命周期。目录由运行时决定，profile 只维护目录内容。
 */
export function defineProfileHome(definition: ProfileHomeDefinition): ProfileHomeDefinition {
    return definition;
}

/**
 * 计算 Project Workspace 下某个 profile 的 home 根目录。
 */
export function profileHomeRoot(workspace: ResolvedProjectWorkspace, profileKey: string): string {
    return path.join(workspace.root, "agents", safeProfileId(profileKey));
}

/**
 * 计算 Workspace Root `.nbook` 下某个全局 profile home 根目录。
 */
export function globalProfileHomeRoot(workspaceNbookRoot: AbsoluteFsPath, profileKey: string): string {
    return path.join(workspaceNbookRoot, "agents", safeProfileId(profileKey));
}

/**
 * 创建受限 profile home 文件 facade。
 */
export function createProfileHomeFacade(workspace: ResolvedProjectWorkspace, profileKey: string): ProfileHomeFacade {
    const containmentRoot = workspace.root;
    const root = resolveContainedFilePath(containmentRoot, path.posix.join("agents", safeProfileId(profileKey)));
    return createProfileHomeFacadeAtRoot(containmentRoot, root);
}

/**
 * 创建全局 profile home 文件 facade。
 */
export function createGlobalProfileHomeFacade(workspaceNbookRoot: AbsoluteFsPath, profileKey: string): ProfileHomeFacade {
    const containmentRoot = workspaceNbookRoot;
    const root = resolveContainedFilePath(containmentRoot, path.posix.join("agents", safeProfileId(profileKey)));
    return createProfileHomeFacadeAtRoot(containmentRoot, root);
}

/**
 * 创建按 Project 优先、Global 兜底读取的 profile home facade。写入类操作只写 primary。
 */
export function createLayeredProfileHomeFacade(primary: ProfileHomeFacade, fallback: ProfileHomeFacade | undefined): ProfileHomeFacade {
    if (!fallback) {
        return primary;
    }
    return {
        root: primary.root,
        async readText(filePath) {
            try {
                return await primary.readText(filePath);
            } catch (error) {
                if (isNotFoundError(error)) {
                    return fallback.readText(filePath);
                }
                throw error;
            }
        },
        writeText: (filePath, content, options) => primary.writeText(filePath, content, options),
        async readJson(filePath) {
            try {
                return await primary.readJson(filePath);
            } catch (error) {
                if (isNotFoundError(error)) {
                    return fallback.readJson(filePath);
                }
                throw error;
            }
        },
        writeJson: (filePath, value, options) => primary.writeJson(filePath, value, options),
        exists: async (filePath) => await primary.exists(filePath) || await fallback.exists(filePath),
        async list(directoryPath = "") {
            const itemsByPath = new Map<string, ProfileHomeListItem>();
            for (const item of await fallback.list(directoryPath)) {
                itemsByPath.set(item.path, item);
            }
            for (const item of await primary.list(directoryPath)) {
                itemsByPath.set(item.path, item);
            }
            return [...itemsByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
        },
        move: (fromPath, toPath, options) => primary.move(fromPath, toPath, options),
        remove: (filePath) => primary.remove(filePath),
        clear: () => primary.clear(),
    };
}

function createProfileHomeFacadeAtRoot(containmentRoot: AbsoluteFsPath, root: AbsoluteFsPath): ProfileHomeFacade {
    return {
        root,
        readText: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            await assertRealPathContained(root, target);
            return fs.readFile(target, "utf-8");
        },
        writeText: async (filePath, content, options) => writeText(containmentRoot, root, filePath, content, options),
        readJson: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            await assertRealPathContained(root, target);
            return JSON.parse(await fs.readFile(target, "utf-8")) as ProfileJsonValue;
        },
        writeJson: async (filePath, value, options) => writeText(containmentRoot, root, filePath, `${JSON.stringify(value, null, 4)}\n`, options),
        exists: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            try {
                await assertRealPathContained(root, target);
                await fs.access(target);
                return true;
            } catch (error) {
                if (isNotFoundError(error)) {
                    return false;
                }
                throw error;
            }
        },
        list: async (directoryPath = "") => {
            const dir = directoryPath.trim() ? resolveHomePath(root, directoryPath) : root;
            await assertRealPathContained(root, absoluteFsPath(dir));
            const entries = await fs.readdir(dir, {withFileTypes: true}).catch((error) => {
                if (isNotFoundError(error)) return [];
                throw error;
            });
            return entries
                .filter((entry) => entry.isFile() || entry.isDirectory())
                .map((entry) => ({
                    name: entry.name,
                    path: normalizeRelativePath(path.posix.join(toPosixPath(directoryPath), entry.name)),
                    kind: entry.isDirectory() ? "directory" as const : "file" as const,
                }));
        },
        move: async (fromPath, toPath, options) => movePath(containmentRoot, root, fromPath, toPath, options),
        remove: async (filePath) => {
            const target = resolveHomePath(root, filePath);
            await assertRealParentContained(root, target);
            await fs.rm(target, {force: true, recursive: true});
        },
        clear: async () => {
            await assertRealParentContained(containmentRoot, root);
            await fs.rm(root, {force: true, recursive: true});
            await prepareProfileHomeRoot(containmentRoot, root);
        },
    };
}

/**
 * 确保 profile home 已按 profile version 初始化或升级。
 */
export async function ensureProfileHome(input: {
    workspace: ResolvedProjectWorkspace;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const home = createProfileHomeFacade(input.workspace, input.profileKey);
    return ensureProfileHomeFacade({
        scope: "project",
        containmentRoot: input.workspace.root,
        root: home.root,
        workspace: input.workspace,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

/**
 * 确保全局 profile home 已按 profile version 初始化或升级。
 */
export async function ensureGlobalProfileHome(input: {
    /** 当前Runtime Workspace Root；调用方必须在进入本Module前完成环境投影。 */
    workspaceRoot: AbsoluteFsPath;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const workspaceNbookRoot = resolveContainedFilePath(input.workspaceRoot, ".nbook");
    await prepareProfileHomeRoot(input.workspaceRoot, workspaceNbookRoot);
    const home = createGlobalProfileHomeFacade(workspaceNbookRoot, input.profileKey);
    return ensureProfileHomeFacade({
        scope: "global",
        containmentRoot: workspaceNbookRoot,
        root: home.root,
        workspaceRoot: input.workspaceRoot,
        workspaceNbookRoot,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

type ProfileHomeFacadeLifecycleInput = {
    containmentRoot: AbsoluteFsPath;
    root: string;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
    home: ProfileHomeFacade;
} & ({
    scope: "project";
    workspace: ResolvedProjectWorkspace;
} | {
    scope: "global";
    workspaceRoot: AbsoluteFsPath;
    workspaceNbookRoot: AbsoluteFsPath;
});

async function ensureProfileHomeFacade(input: ProfileHomeFacadeLifecycleInput): Promise<ProfileHomeFacade> {
    const home = input.home;
    await prepareProfileHomeRoot(input.containmentRoot, absoluteFsPath(home.root));
    const now = new Date().toISOString();
    const metadata = await readMetadata(home);
    const ctx: ProfileHomeContext = input.scope === "project"
        ? {
            profileKey: input.profileKey,
            profileVersion: input.profileVersion,
            scope: input.scope,
            root: input.root,
            workspace: input.workspace,
            home,
        }
        : {
            profileKey: input.profileKey,
            profileVersion: input.profileVersion,
            scope: input.scope,
            root: input.root,
            workspaceRoot: input.workspaceRoot,
            workspaceNbookRoot: input.workspaceNbookRoot,
            home,
        };
    if (!metadata) {
        await input.definition?.init?.(ctx);
        await writeMetadata(home, {
            profileKey: input.profileKey,
            version: input.profileVersion,
            initializedAt: now,
            updatedAt: now,
        });
        return home;
    }
    if (metadata.version < input.profileVersion) {
        await input.definition?.upgrade?.(ctx, metadata.version, input.profileVersion);
        await writeMetadata(home, {
            ...metadata,
            profileKey: input.profileKey,
            version: input.profileVersion,
            updatedAt: now,
        });
    }
    return home;
}

/**
 * 重置 profile home，并刷新 home metadata。
 */
export async function resetProfileHome(input: {
    workspace: ResolvedProjectWorkspace;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const home = createProfileHomeFacade(input.workspace, input.profileKey);
    return resetProfileHomeFacade({
        scope: "project",
        containmentRoot: input.workspace.root,
        root: home.root,
        workspace: input.workspace,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

/**
 * 重置全局 profile home，并刷新 home metadata。
 */
export async function resetGlobalProfileHome(input: {
    /** 当前Runtime Workspace Root；调用方必须在进入本Module前完成环境投影。 */
    workspaceRoot: AbsoluteFsPath;
    profileKey: string;
    profileVersion: number;
    definition?: ProfileHomeDefinition;
}): Promise<ProfileHomeFacade> {
    const workspaceNbookRoot = resolveContainedFilePath(input.workspaceRoot, ".nbook");
    await prepareProfileHomeRoot(input.workspaceRoot, workspaceNbookRoot);
    const home = createGlobalProfileHomeFacade(workspaceNbookRoot, input.profileKey);
    return resetProfileHomeFacade({
        scope: "global",
        containmentRoot: workspaceNbookRoot,
        root: home.root,
        workspaceRoot: input.workspaceRoot,
        workspaceNbookRoot,
        profileKey: input.profileKey,
        profileVersion: input.profileVersion,
        definition: input.definition,
        home,
    });
}

async function resetProfileHomeFacade(input: ProfileHomeFacadeLifecycleInput): Promise<ProfileHomeFacade> {
    const home = input.home;
    await prepareProfileHomeRoot(input.containmentRoot, absoluteFsPath(home.root));
    const ctx: ProfileHomeContext = input.scope === "project"
        ? {
            profileKey: input.profileKey,
            profileVersion: input.profileVersion,
            scope: input.scope,
            root: input.root,
            workspace: input.workspace,
            home,
        }
        : {
            profileKey: input.profileKey,
            profileVersion: input.profileVersion,
            scope: input.scope,
            root: input.root,
            workspaceRoot: input.workspaceRoot,
            workspaceNbookRoot: input.workspaceNbookRoot,
            home,
        };
    await input.definition?.reset?.(ctx);
    const now = new Date().toISOString();
    await writeMetadata(home, {
        profileKey: input.profileKey,
        version: input.profileVersion,
        initializedAt: now,
        updatedAt: now,
    });
    return home;
}

function safeProfileId(profileKey: string): string {
    if (!/^[A-Za-z0-9._-]+$/u.test(profileKey)) {
        throw new Error(`profile key 不能作为 profile home 目录名：${profileKey}`);
    }
    return profileKey;
}

async function writeText(
    containmentRoot: AbsoluteFsPath,
    root: AbsoluteFsPath,
    filePath: string,
    content: string,
    options: {mode?: ProfileHomeWriteMode} = {},
): Promise<ProfileHomeWriteResult> {
    const mode = options.mode ?? "create";
    await prepareProfileHomeRoot(containmentRoot, root);
    const target = resolveHomePath(root, filePath);
    await assertRealPathContained(root, target);
    await fs.mkdir(path.dirname(target), {recursive: true});
    if (mode === "create" && await existsAbsolute(target)) {
        return {written: false};
    }
    await fs.writeFile(target, content, "utf-8");
    return {written: true};
}

async function movePath(
    containmentRoot: AbsoluteFsPath,
    root: AbsoluteFsPath,
    fromPath: string,
    toPath: string,
    options: {mode?: ProfileHomeWriteMode} = {},
): Promise<ProfileHomeWriteResult> {
    const mode = options.mode ?? "create";
    await prepareProfileHomeRoot(containmentRoot, root);
    const from = resolveHomePath(root, fromPath);
    const to = resolveHomePath(root, toPath);
    await assertRealParentContained(root, from);
    await assertRealParentContained(root, to);
    if (mode === "create" && await existsAbsolute(to)) {
        return {written: false};
    }
    await fs.mkdir(path.dirname(to), {recursive: true});
    if (mode === "overwrite") {
        await fs.rm(to, {force: true, recursive: true});
    }
    await fs.rename(from, to);
    return {written: true};
}

function resolveHomePath(root: AbsoluteFsPath, filePath: string): AbsoluteFsPath {
    const normalized = normalizeRelativePath(filePath);
    try {
        return resolveContainedFilePath(root, normalized);
    } catch {
        throw new Error(`profile home 路径越界：${filePath}`);
    }
}

function normalizeRelativePath(filePath: string): string {
    const normalized = toPosixPath(filePath).replace(/^\/+/u, "").replace(/\/+$/u, "");
    if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`非法 profile home 路径：${filePath}`);
    }
    return normalized;
}

function toPosixPath(filePath: string): string {
    return filePath.trim().replaceAll("\\", "/");
}

async function readMetadata(home: ProfileHomeFacade): Promise<ProfileHomeMetadata | null> {
    try {
        const parsed = JSON.parse(await home.readText("home.json")) as Partial<ProfileHomeMetadata>;
        if (typeof parsed.profileKey === "string" && typeof parsed.version === "number") {
            return {
                profileKey: parsed.profileKey,
                version: parsed.version,
                initializedAt: parsed.initializedAt ?? new Date(0).toISOString(),
                updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
            };
        }
    } catch (error) {
        if (!isNotFoundError(error)) {
            throw error;
        }
    }
    return null;
}

async function writeMetadata(home: ProfileHomeFacade, metadata: ProfileHomeMetadata): Promise<void> {
    await home.writeText("home.json", `${JSON.stringify(metadata, null, 4)}\n`, {mode: "overwrite"});
}

/** 安全创建Profile Home根，并确认父级链接没有逃出所属Project/Global根。 */
async function prepareProfileHomeRoot(containmentRoot: AbsoluteFsPath, root: AbsoluteFsPath): Promise<void> {
    await assertRealPathContained(containmentRoot, root);
    await fs.mkdir(root, {recursive: true});
    await assertRealPathContained(containmentRoot, root);
}

async function existsAbsolute(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch (error) {
        if (isNotFoundError(error)) {
            return false;
        }
        throw error;
    }
}

function isNotFoundError(error: unknown): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
