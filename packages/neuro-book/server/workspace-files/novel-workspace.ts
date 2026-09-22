import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {pinyin} from "pinyin-pro";
import {
    PROFILE_COMPILED_DIR_NAME,
    ProfileReleasePublisher,
    SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL,
    isProfileReleaseCommittedButRegistryFailedError,
    readProfileArtifactManifest,
    rehomeProfileArtifactItem,
    resolveProfileArtifactPathContext,
    validateProfileArtifact,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestEntry,
    type ProfileArtifactManifestItem,
    type ProfileReleasePublishOptions,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {
    readVariableDefinitionManifest,
    resolveVariableDefinitionArtifactPathContext,
    SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL,
    validateVariableDefinitionArtifact,
    type VariableDefinitionManifestItem,
} from "nbook/server/agent/variables/definition-artifact";
import {isUserAssetsStoragePath} from "nbook/server/workspace-files/workspace-storage-boundary";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {absoluteFsPath, assertRealPathContained, relativeFilePathInside, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {isRuntimeAgentAssetInstallMode, resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {
    LEGACY_HARD_CUT_TOMBSTONED_PATHS,
    LEGACY_HARD_CUT_TOMBSTONED_PREFIXES,
    LEGACY_STALE_TOMBSTONED_PREFIXES,
    LEGACY_TOMBSTONED_ASSET_PATHS,
    LEGACY_TOMBSTONED_ASSET_PREFIXES,
} from "nbook/server/workspace-files/legacy-agent-asset-tombstones";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {appLogger} from "nbook/server/app-logs/logger";
import {runtimePathsFromEnv, type RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import type {
    UserAssetsAssetSyncWarningDto,
    UserAssetsProfileSyncWarningDto,
    UserAssetsSyncConflictDetailDto,
    UserAssetsSyncResultDto,
} from "nbook/shared/dto/user-assets-sync.dto";

export const USER_ASSETS_WORKSPACE_KIND = "user-assets";
export const WORKSPACE_CONTAINER_ROOT = "workspace" as const;
export const USER_ASSETS_WORKSPACE_ROOT = "workspace/.nbook" as const;
export const USER_NBOOK_ROOT = USER_ASSETS_WORKSPACE_ROOT;
export const DEFAULT_NOVEL_WORKSPACE_SLUG = "silver-dragon-hime";

const PROJECT_DIRECTORY_TEMPLATE_ASSET_PREFIX = "templates/project-directory-templates/";
const DELETED_MANAGED_SYSTEM_ASSET_PATHS = new Set(LEGACY_TOMBSTONED_ASSET_PATHS);
const DELETED_MANAGED_SYSTEM_ASSET_PREFIXES = LEGACY_TOMBSTONED_ASSET_PREFIXES;

let userAssetsSyncStateWriteHookForTest: (() => Promise<void> | void) | null = null;
let userAssetsProfileArtifactStagedHookForTest: ((fileName: string) => Promise<void> | void) | null = null;

/**
 * 测试专用：在写 user assets sync state 前注入失败或竞态。
 */
export function setUserAssetsSyncStateWriteHookForTest(hook: (() => Promise<void> | void) | null): void {
    userAssetsSyncStateWriteHookForTest = hook;
}

/**
 * 测试专用：在 profile artifact entry staging 后注入源码变化。
 */
export function setUserAssetsProfileArtifactStagedHookForTest(hook: ((fileName: string) => Promise<void> | void) | null): void {
    userAssetsProfileArtifactStagedHookForTest = hook;
}

const HARD_CUT_DELETED_MANAGED_SYSTEM_ASSET_PREFIXES = LEGACY_HARD_CUT_TOMBSTONED_PREFIXES;
const HARD_CUT_DELETED_MANAGED_SYSTEM_ASSET_PATHS = new Set(LEGACY_HARD_CUT_TOMBSTONED_PATHS);
const STALE_MANAGED_SYSTEM_ASSET_PREFIXES = LEGACY_STALE_TOMBSTONED_PREFIXES;
const SKILL_DEPENDENCY_FILES = new Set(["package.json", "bun.lock"]);
const SKILL_PACKAGE_INSTALL_FIELDS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "bundledDependencies",
    "bundleDependencies",
    "overrides",
    "resolutions",
    "trustedDependencies",
    "patchedDependencies",
    "workspaces",
    "packageManager",
    "engines",
    "os",
    "cpu",
    "scripts",
] as const;
const LEGACY_WORKSPACE_MANIFEST_FILE = "workspace.yaml";
const USER_ASSETS_DIFF_MAX_BYTES = 512 * 1024;

function systemNbookRoot(explicitRoot?: string): string {
    return explicitRoot ? path.resolve(explicitRoot) : resolveSystemNbookRoot();
}

function userNbookAbsoluteRoot(explicitRoot?: string): string {
    return explicitRoot ? path.resolve(explicitRoot) : resolveUserNbookRoot();
}

function systemProfileRoot(explicitRoot?: string): string {
    return path.join(systemNbookRoot(explicitRoot), "agent", "profiles");
}

function userProfileRoot(explicitRoot?: string): string {
    return path.join(userNbookAbsoluteRoot(explicitRoot), "agent", "profiles");
}

function systemProfileArtifactPathContext(explicitRoot?: string): Promise<Awaited<ReturnType<typeof resolveProfileArtifactPathContext>>> {
    return resolveProfileArtifactPathContext(
        systemProfileRoot(explicitRoot),
        SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL,
        runtimePathsFromEnv().applicationRoot,
    );
}

function userProfileArtifactPathContext(explicitRoot?: string): Promise<Awaited<ReturnType<typeof resolveProfileArtifactPathContext>>> {
    return resolveProfileArtifactPathContext(userProfileRoot(explicitRoot), "workspace/.nbook/agent/profiles", runtimePathsFromEnv().applicationRoot);
}

function normalizeArtifactRootLabel(value: string): string {
    return value.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
}

function systemVariableDefinitionRoot(explicitRoot?: string): string {
    return path.join(systemNbookRoot(explicitRoot), "agent", "variables");
}

function userVariableDefinitionRoot(explicitRoot?: string): string {
    return path.join(userNbookAbsoluteRoot(explicitRoot), "agent", "variables");
}

function userSystemAssetsSyncStatePath(explicitRoot?: string): string {
    return path.join(userNbookAbsoluteRoot(explicitRoot), ".system-assets-sync-state.json");
}

function projectDirectoryTemplateRoot(explicitRoot?: string): string {
    return path.join(systemNbookRoot(explicitRoot), "templates", "project-directory-templates");
}

function userProjectDirectoryTemplateRoot(userNbookRoot = userNbookAbsoluteRoot()): string {
    return path.join(userNbookRoot, "templates", "project-directory-templates");
}

export type WorkspaceRootKind = "novel" | typeof USER_ASSETS_WORKSPACE_KIND;
export type UserAssetsSyncResult = UserAssetsSyncResultDto;
export type UserAssetsProfileSyncWarning = UserAssetsProfileSyncWarningDto;
export type UserAssetsAssetSyncWarning = UserAssetsAssetSyncWarningDto;
export type UserAssetsSyncOptions = {
    /** 为 true 时覆盖用户侧受管系统资源。默认 false，保留用户手改内容。 */
    force?: boolean;
    /** 为空时走 CLI/preflight disk-only 发布；HTTP runtime 传 in-process 以同步翻转 Registry。 */
    profileRelease?: ProfileReleasePublishOptions;
    /** legacy projection 的只读来源 `.nbook`；Runtime install 模式必须显式提供。 */
    sourceNbookRoot?: string;
    /** legacy projection 的可写目标 `.nbook`；Runtime install 模式必须显式提供。 */
    targetNbookRoot?: string;
    /** 是否同步旧的 templates/bin/config 等文件；Agent 三类包由 seeder/ledger 管理。 */
    syncManagedAssets?: boolean;
    /** 是否同步旧 profile shadow projection。Runtime Install Root 不走该旧路径。 */
    syncProfiles?: boolean;
    /** 是否同步旧 variable definition source projection。 */
    syncVariableDefinitions?: boolean;
    /** Runtime legacy projection 可显式跳过 Seed compiled；默认 Source/HTTP 同步仍会同步。 */
    syncVariableCompiledArtifacts?: boolean;
    /** Runtime legacy projection 专用：不触碰 skills/workflows/profiles package unit。 */
    excludeAgentPackages?: boolean;
};

export type SystemProfileMetadata = {
    generatedAt: string;
    profilesRoot: string;
    profiles: SystemProfileMetadataItem[];
};

export type SystemProfileMetadataItem = {
    fileName: string;
    profileKey: string;
    sha256: string;
    bytes: number;
};

type UserSystemAssetsSyncState = {
    profiles: UserProfileSyncStateItem[];
    assets?: UserAssetSyncStateItem[];
};

type UserProfileSyncStateItem = {
    fileName: string;
    profileKey: string;
    upstreamHash: string;
    lastSyncedUserHash: string;
    syncedAt: string;
};

type UserAssetSyncStateItem = {
    assetPath: string;
    upstreamHash: string;
    lastSyncedUserHash: string;
    syncedAt: string;
};

type SystemManagedAssetItem = {
    assetPath: string;
    sha256: string;
    bytes: number;
};

type CompiledArtifactSyncResult = {
    ok: true;
    warning?: string;
} | {
    ok: false;
    message: string;
};

type StagedFileReplacement = {
    sourcePath: string;
    targetPath: string;
};

type PendingSourceReplacement = {
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
};

type ProfileArtifactSyncBatch = {
    systemManifest: ProfileArtifactManifest;
    buildCompiledDir: string;
    stagedProfiles: Array<{fileName: string; profileKey: string; entry: ProfileArtifactManifestEntry}>;
};

type StagedArtifactSyncResult = {
    ok: true;
    file: StagedFileReplacement;
} | {
    ok: false;
    message: string;
};

/**
 * 将小说 workspace slug 归一成安全目录名。
 */
export function normalizeWorkspaceSlug(value: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "novel";
}

/**
 * 根据标题生成基础 workspace slug。中文标题无法转写时回落到 novel。
 */
export function buildWorkspaceSlugBase(title: string): string {
    const tokens = pinyin(title, {toneType: "none", type: "array"});
    const parts: string[] = [];
    let latinRun = "";
    for (const token of tokens) {
        if (/^[a-z0-9]$/i.test(token)) {
            latinRun += token;
            continue;
        }
        if (latinRun) {
            parts.push(latinRun);
            latinRun = "";
        }
        if (token.trim()) {
            parts.push(token);
        }
    }
    if (latinRun) {
        parts.push(latinRun);
    }
    return normalizeWorkspaceSlug(parts.join("-") || title);
}

/**
 * 从显式Runtime Paths解析指定 projectRoot 的文件操作目标。
 *
 * 入参是 HTTP 公开合同的单段 `projectRoot`；返回目标只保留单段 root 与物理根。
 */
export async function resolveNovelWorkspaceTarget(
    runtimePaths: RuntimePaths,
    projectRootInput: string,
): Promise<Extract<WorkspaceFileTarget, {kind: "project-workspace"}>> {
    const ref = projectWorkspaceRef(projectRootInput);
    const root = await assertProjectWorkspaceDirectory(runtimePaths.workspaceRoot, ref);
    return {
        kind: "project-workspace",
        root,
        projectRoot: ref.projectRoot,
    };
}

/**
 * 从DTO输入与显式Runtime Paths建立Workspace文件操作目标。
 *
 * 这是公开 `projectRoot` / workspaceKind 到物理Workspace Root的入口；返回后核心Module
 * 不得再次读取cwd、State Root或进程环境。
 */
export async function resolveWorkspaceFileTarget(
    runtimePaths: RuntimePaths,
    input: {projectRoot?: string; workspaceKind?: WorkspaceRootKind},
): Promise<WorkspaceFileTarget> {
    if (input.workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        await ensureUserAssetsWorkspaceRootAt(runtimePaths);
        await assertRealPathContained(runtimePaths.stateRoot, runtimePaths.userNbookRoot);
        return {
            kind: "user-assets",
            root: runtimePaths.userNbookRoot,
        };
    }
    if (input.projectRoot?.trim()) {
        return resolveNovelWorkspaceTarget(runtimePaths, input.projectRoot);
    }
    await assertRealPathContained(runtimePaths.stateRoot, runtimePaths.workspaceRoot);
    return {
        kind: "workspace-root",
        root: runtimePaths.workspaceRoot,
    };
}
/**
 * 读取系统 profile metadata。不存在时返回空 metadata，兼容开发期首次生成前的状态。
 */
export async function readSystemProfileMetadata(sourceNbookRoot?: string): Promise<SystemProfileMetadata> {
    const profileRoot = systemProfileRoot(sourceNbookRoot);
    const manifest = await readProfileArtifactManifest(profileRoot, await systemProfileArtifactPathContext(sourceNbookRoot));
    return {
        generatedAt: manifest.generatedAt,
        profilesRoot: manifest.profilesRoot,
        profiles: manifest.profiles.map((profile) => ({
            fileName: profile.fileName,
            profileKey: profile.profileKey,
            sha256: profile.sourceSha256,
            bytes: profile.sourceBytes,
        })).sort((left, right) => left.fileName.localeCompare(right.fileName)),
    };
}

/** 计算文件 sha256。系统 profile metadata 与用户 sync state 共用这一判断。 */
export async function sha256File(filePath: string): Promise<{sha256: string; bytes: number}> {
    const buffer = await fs.readFile(filePath);
    return {
        sha256: createHash("sha256").update(buffer).digest("hex"),
        bytes: buffer.byteLength,
    };
}
export async function ensureUserAssetsWorkspaceRootAt(runtimePaths: RuntimePaths): Promise<AbsoluteFsPath> {
    await fs.mkdir(runtimePaths.userNbookRoot, {recursive: true});
    return runtimePaths.userNbookRoot;
}

export async function ensureUserAssetsWorkspaceRoot(): Promise<AbsoluteFsPath> {
    return ensureUserAssetsWorkspaceRootAt(runtimePathsFromEnv());
}

type LegacyProjectionRoots = Readonly<{
    sourceNbookRoot: string;
    targetNbookRoot: string;
}>;

function resolveLegacyProjectionRoots(options: UserAssetsSyncOptions): LegacyProjectionRoots {
    const sourceNbookRoot = path.resolve(options.sourceNbookRoot ?? systemNbookRoot());
    const targetNbookRoot = path.resolve(options.targetNbookRoot ?? userNbookAbsoluteRoot());
    if (isRuntimeAgentAssetInstallMode() && (!options.sourceNbookRoot || !options.targetNbookRoot)) {
        throw new Error("Runtime Agent legacy projection 需要显式 sourceNbookRoot 和 targetNbookRoot。");
    }
    if (sourceNbookRoot === targetNbookRoot) {
        throw new Error(`Runtime Agent legacy projection source/target 不能相同：${sourceNbookRoot}`);
    }
    return {sourceNbookRoot, targetNbookRoot};
}
export async function syncSystemAssetsToUserAssets(options: UserAssetsSyncOptions = {}): Promise<UserAssetsSyncResult> {
    const roots = resolveLegacyProjectionRoots(options);
    await fs.mkdir(roots.targetNbookRoot, {recursive: true});
    const result: UserAssetsSyncResult = {
        copied: 0,
        skipped: 0,
        updatedProfiles: 0,
        profileWarnings: [],
        updatedAssets: 0,
        assetWarnings: [],
    };
    if (options.syncManagedAssets !== false && await isDirectory(roots.sourceNbookRoot)) {
        await syncManagedSystemAssetsToUserAssets(result, options, roots);
    }
    if (options.syncProfiles !== false) {
        await syncSystemProfilesToUserAssets(result, options, roots);
    }
    if (options.syncVariableDefinitions !== false) {
        await syncSystemVariableDefinitionsToUserAssets(result, options, roots);
    }
    return result;
}

export async function readUserAssetsSyncConflictDetail(input: {
    kind: "profile" | "asset";
    fileName?: string;
    assetPath?: string;
}): Promise<UserAssetsSyncConflictDetailDto> {
    if (input.kind === "profile") {
        const fileName = normalizeSafeRelativePath(input.fileName ?? "");
        if (!fileName) {
            throw new Error("fileName 不能为空");
        }
        const metadata = await readSystemProfileMetadata();
        const item = metadata.profiles.find((profile) => profile.fileName === fileName);
        if (!item) {
            throw new Error(`未找到系统 profile metadata: ${fileName}`);
        }
        const syncState = await readUserSystemAssetsSyncState();
        const stateItem = syncState.profiles.find((profile) => profile.fileName === fileName);
        const systemPath = resolveInsideRoot(systemProfileRoot(), fileName);
        const userPath = resolveInsideRoot(userProfileRoot(), fileName);
        const [systemFile, userFile] = await Promise.all([
            readTextFileForDiff(systemPath),
            readTextFileForDiff(userPath),
        ]);
        return {
            kind: "profile",
            fileName,
            label: item.profileKey,
            systemContent: systemFile.content,
            userContent: userFile.content,
            language: inferDiffLanguage(fileName),
            systemSha256: systemFile.sha256,
            userSha256: userFile.sha256,
            systemBytes: systemFile.bytes,
            userBytes: userFile.bytes,
            lastSyncedUserHash: stateItem?.lastSyncedUserHash,
            upstreamHash: stateItem?.upstreamHash,
            diffable: systemFile.diffable && userFile.diffable,
            reason: systemFile.reason ?? userFile.reason,
        };
    }
    const assetPath = normalizeSafeRelativePath(input.assetPath ?? "");
    if (!assetPath) {
        throw new Error("assetPath 不能为空或包含非法片段");
    }
    await assertReadableUserAssetsSyncAssetPath(assetPath);
    const syncState = await readUserSystemAssetsSyncState();
    const stateItem = findUserAssetSyncState(syncState, assetPath);
    const roots = resolveUserAssetConflictRoots(assetPath);
    const [systemFile, userFile] = await Promise.all([
        readTextFileForDiff(roots.systemPath),
        readTextFileForDiff(roots.userPath),
    ]);
    return {
        kind: "asset",
        assetPath,
        label: assetPath,
        systemContent: systemFile.content,
        userContent: userFile.content,
        language: inferDiffLanguage(assetPath),
        systemSha256: systemFile.sha256,
        userSha256: userFile.sha256,
        systemBytes: systemFile.bytes,
        userBytes: userFile.bytes,
        lastSyncedUserHash: stateItem?.lastSyncedUserHash,
        upstreamHash: stateItem?.upstreamHash,
        diffable: systemFile.diffable && userFile.diffable,
        reason: systemFile.reason ?? userFile.reason,
    };
}

export type NovelDirectoryTemplateOptions = {
    /** 为空时按当前runtime解析Workspace Root `.nbook`；Lifecycle必须显式传入自身绑定的路径。 */
    readonly userNbookRoot?: AbsoluteFsPath;
};

/** 把小说目录脚手架复制到Project Workspace，只补缺失文件，不覆盖用户已编辑内容。 */
export async function copyNovelDirectoryTemplate(
    projectRoot: AbsoluteFsPath,
    options: NovelDirectoryTemplateOptions = {},
): Promise<void> {
    const userTemplateRoot = userProjectDirectoryTemplateRoot(options.userNbookRoot);
    const mergedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-novel-template-"));
    try {
        await fs.cp(projectDirectoryTemplateRoot(), mergedRoot, {
            recursive: true,
            force: true,
            errorOnExist: false,
        });
        if (await isDirectory(userTemplateRoot)) {
            await fs.cp(userTemplateRoot, mergedRoot, {
                recursive: true,
                force: true,
                errorOnExist: false,
            });
        }
        await normalizeNovelDirectoryTemplateArtifacts(mergedRoot);
        await fs.cp(mergedRoot, projectRoot, {
            recursive: true,
            force: false,
            errorOnExist: false,
        });
    } finally {
        await fs.rm(mergedRoot, {recursive: true, force: true});
    }
}

/**
 * 清理旧模板产物，避免用户覆盖层把已废弃的默认文件重新带进新 Project。
 */
async function normalizeNovelDirectoryTemplateArtifacts(templateRoot: string): Promise<void> {
    await fs.rm(path.join(templateRoot, LEGACY_WORKSPACE_MANIFEST_FILE), {force: true});
    for (const assetPath of DELETED_MANAGED_SYSTEM_ASSET_PATHS) {
        if (!assetPath.startsWith(PROJECT_DIRECTORY_TEMPLATE_ASSET_PREFIX)) {
            continue;
        }
        const templateRelativePath = assetPath.slice(PROJECT_DIRECTORY_TEMPLATE_ASSET_PREFIX.length);
        await fs.rm(path.join(templateRoot, templateRelativePath), {force: true});
    }
    for (const assetPrefix of DELETED_MANAGED_SYSTEM_ASSET_PREFIXES) {
        if (!assetPrefix.startsWith(PROJECT_DIRECTORY_TEMPLATE_ASSET_PREFIX)) {
            continue;
        }
        const templateRelativePath = assetPrefix.slice(PROJECT_DIRECTORY_TEMPLATE_ASSET_PREFIX.length);
        await fs.rm(path.join(templateRoot, templateRelativePath), {recursive: true, force: true});
    }
}

/**
 * 同步系统 .nbook 内默认受管理资源；黑名单只保留本地状态、运行记录和编译产物。
 */
async function syncManagedSystemAssetsToUserAssets(result: UserAssetsSyncResult, options: UserAssetsSyncOptions, roots: LegacyProjectionRoots): Promise<void> {
    const syncState = await readUserSystemAssetsSyncState(roots.targetNbookRoot);
    const assets = await listManagedSystemAssets(roots.sourceNbookRoot, {
        excludeAgentPackages: options.excludeAgentPackages === true,
    });
    const activeAssetPaths = new Set(assets.map((asset) => asset.assetPath));
    const invalidatedSkills = new Set<string>();
    let stateChanged = false;
    for (const item of assets) {
        if (isUserAssetsStoragePath(item.assetPath)) {
            continue;
        }
        const systemPath = resolveInsideRoot(roots.sourceNbookRoot, item.assetPath);
        const userPath = resolveInsideRoot(roots.targetNbookRoot, item.assetPath);
        const stateItem = findUserAssetSyncState(syncState, item.assetPath);
        const dependencySkillKey = skillDependencyKey(item.assetPath);
        if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            stateChanged = true;
            continue;
        }
        if (!await pathExists(userPath)) {
            await fs.mkdir(path.dirname(userPath), {recursive: true});
            await fs.copyFile(systemPath, userPath);
            if (dependencySkillKey) {
                invalidatedSkills.add(dependencySkillKey);
            }
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.copied += 1;
            stateChanged = true;
            continue;
        }

        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            upsertUserAssetSyncState(syncState, item, currentUserHash);
            result.skipped += 1;
            stateChanged = true;
            continue;
        }
        if (options.force) {
            const invalidateDependencies = dependencySkillKey
                ? await skillInstallChanged(item.assetPath, systemPath, userPath)
                : false;
            await fs.copyFile(systemPath, userPath);
            if (dependencySkillKey && invalidateDependencies) {
                invalidatedSkills.add(dependencySkillKey);
            }
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.updatedAssets = (result.updatedAssets ?? 0) + 1;
            stateChanged = true;
            continue;
        }
        if (!stateItem) {
            result.assetWarnings?.push({
                assetPath: item.assetPath,
                message: "系统 .nbook asset 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。",
            });
            continue;
        }
        if (currentUserHash !== stateItem.lastSyncedUserHash) {
            if (item.sha256 !== stateItem.upstreamHash) {
                result.assetWarnings?.push({
                    assetPath: item.assetPath,
                    message: "系统 .nbook asset 已更新，但用户覆盖已手改，未自动覆盖。",
                });
            }
            continue;
        }
        if (item.sha256 === stateItem.upstreamHash) {
            continue;
        }
        const invalidateDependencies = dependencySkillKey
            ? await skillInstallChanged(item.assetPath, systemPath, userPath)
            : false;
        await fs.copyFile(systemPath, userPath);
        if (dependencySkillKey && invalidateDependencies) {
            invalidatedSkills.add(dependencySkillKey);
        }
        const hash = await sha256File(userPath);
        upsertUserAssetSyncState(syncState, item, hash.sha256);
        result.updatedAssets = (result.updatedAssets ?? 0) + 1;
        stateChanged = true;
    }
    await invalidateSkillDependencies(invalidatedSkills, roots.targetNbookRoot);
    const preservedDeletedAssetPaths = new Set<string>();
    const excludeAgentPackages = options.excludeAgentPackages === true;
    stateChanged = await removeDeletedManagedSystemAssets(syncState, activeAssetPaths, result, preservedDeletedAssetPaths, roots.targetNbookRoot, excludeAgentPackages) || stateChanged;
    stateChanged = await removeHardCutDeletedManagedSystemAssetPrefixes(syncState, result, preservedDeletedAssetPaths, roots.targetNbookRoot, excludeAgentPackages) || stateChanged;
    stateChanged = await removeStaleManagedSystemAssets(syncState, activeAssetPaths, result, preservedDeletedAssetPaths, roots.targetNbookRoot, excludeAgentPackages) || stateChanged;
    if (stateChanged) {
        await writeUserSystemAssetsSyncState(syncState, roots.targetNbookRoot);
    }
}

/**
 * 识别会改变 runnable Skill 本地安装结果的受管文件。
 */
function skillDependencyKey(assetPath: string): string | null {
    const parts = assetPath.split("/");
    if (parts.length !== 4 || parts[0] !== "agent" || parts[1] !== "skills" || !parts[2] || !parts[3]) {
        return null;
    }
    return SKILL_DEPENDENCY_FILES.has(parts[3]) ? parts[2] : null;
}

type SkillPackageJsonValue = null | boolean | number | string | SkillPackageJsonValue[] | {[key: string]: SkillPackageJsonValue};

/**
 * 比较真正影响 Bun 安装结果的 package 字段；发布版本等元数据变化不要求重装依赖。
 */
async function skillInstallChanged(assetPath: string, systemPath: string, userPath: string): Promise<boolean> {
    if (assetPath.endsWith("/bun.lock")) {
        return !await sameFile(systemPath, userPath);
    }
    const systemPackage = await readSkillPackageContract(systemPath);
    let userPackage: string;
    try {
        userPackage = await readSkillPackageContract(userPath);
    } catch {
        // force sync 必须能修复损坏的用户 manifest；旧安装结果也不能继续复用。
        return true;
    }
    return systemPackage !== userPackage;
}

/**
 * 从外部 package.json 提取 Bun install 输入，忽略 version、description 等发布元数据。
 */
async function readSkillPackageContract(packagePath: string): Promise<string> {
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8")) as {[key: string]: SkillPackageJsonValue};
    const contract: {[key: string]: SkillPackageJsonValue} = {};
    for (const field of SKILL_PACKAGE_INSTALL_FIELDS) {
        const value = packageJson[field];
        if (value !== undefined) {
            contract[field] = value;
        }
    }
    return stableSkillPackageJson(contract);
}

/**
 * 稳定序列化 package 安装合同，避免仅对象键顺序变化导致依赖误失效。
 */
function stableSkillPackageJson(value: SkillPackageJsonValue): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSkillPackageJson(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => {
        const child = value[key];
        return `${JSON.stringify(key)}:${stableSkillPackageJson(child ?? null)}`;
    }).join(",")}}`;
}

/**
 * 仅在依赖合同已发布到用户目录时失效对应 Skill 的本地派生依赖。
 */
async function invalidateSkillDependencies(skillKeys: ReadonlySet<string>, targetNbookRoot = userNbookAbsoluteRoot()): Promise<void> {
    for (const skillKey of skillKeys) {
        const nodeModulesPath = resolveInsideRoot(targetNbookRoot, `agent/skills/${skillKey}/node_modules`);
        await fs.rm(nodeModulesPath, {recursive: true, force: true});
    }
}
async function removeDeletedManagedSystemAssets(syncState: UserSystemAssetsSyncState, activeAssetPaths: Set<string>, result: UserAssetsSyncResult, preservedDeletedAssetPaths: Set<string>, targetNbookRoot = userNbookAbsoluteRoot(), excludeAgentPackages = false): Promise<boolean> {
    let changed = false;
    for (const item of [...syncState.assets ?? []]) {
        if (isUserAssetsStoragePath(item.assetPath)) {
            continue;
        }
        if ((excludeAgentPackages && isAgentPackageAssetPath(item.assetPath)) || activeAssetPaths.has(item.assetPath) || !isDeletedManagedSystemAssetPath(item.assetPath)) {
            continue;
        }
        const userPath = resolveInsideRoot(targetNbookRoot, item.assetPath);
        if (!await pathExists(userPath)) {
            removeUserAssetSyncState(syncState, item.assetPath);
            changed = true;
            continue;
        }
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.lastSyncedUserHash) {
            await fs.rm(userPath, {force: true});
            removeUserAssetSyncState(syncState, item.assetPath);
            changed = true;
            continue;
        }
        result.assetWarnings?.push({
            assetPath: item.assetPath,
            message: "系统 .nbook asset 已删除，但用户覆盖已手改，未自动删除。",
        });
        preservedDeletedAssetPaths.add(item.assetPath);
    }
    return changed;
}

async function removeStaleManagedSystemAssets(
    syncState: UserSystemAssetsSyncState,
    activeAssetPaths: Set<string>,
    result: UserAssetsSyncResult,
    preservedDeletedAssetPaths: Set<string>,
    targetNbookRoot = userNbookAbsoluteRoot(),
    excludeAgentPackages = false,
): Promise<boolean> {
    let changed = false;
    for (const item of [...syncState.assets ?? []]) {
        if (isUserAssetsStoragePath(item.assetPath)) {
            continue;
        }
        if ((excludeAgentPackages && isAgentPackageAssetPath(item.assetPath)) || activeAssetPaths.has(item.assetPath) || !STALE_MANAGED_SYSTEM_ASSET_PREFIXES.some((prefix) => item.assetPath.startsWith(prefix))) {
            continue;
        }
        const userPath = resolveInsideRoot(targetNbookRoot, item.assetPath);
        if (!await pathExists(userPath)) {
            removeUserAssetSyncState(syncState, item.assetPath);
            changed = true;
            continue;
        }
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.lastSyncedUserHash) {
            await fs.rm(userPath, {force: true});
            removeUserAssetSyncState(syncState, item.assetPath);
            changed = true;
            continue;
        }
        if (!preservedDeletedAssetPaths.has(item.assetPath)) {
            result.assetWarnings?.push({
                assetPath: item.assetPath,
                message: "系统 .nbook asset 已不再属于当前受管文件集合，但用户覆盖已手改，未自动删除。",
            });
        }
        preservedDeletedAssetPaths.add(item.assetPath);
    }
    for (const assetPrefix of STALE_MANAGED_SYSTEM_ASSET_PREFIXES) {
        if (excludeAgentPackages && isAgentPackageAssetPath(assetPrefix)) {
            continue;
        }
        const userPrefixPath = resolveInsideRoot(targetNbookRoot, assetPrefix);
        changed = await removeEmptyDirectories(userPrefixPath) || changed;
    }
    return changed;
}

/**
 * 清理硬切旧官方目录中没有 sync state 的残留文件。
 *
 * 普通 deleted asset 清理依赖 sync state；旧CLI脚本与llmlint旧目录都可能处于
 * “文件残留但 state 不完整”的半同步状态。这里仅扫描明确登记的官方旧路径，
 * 不触碰用户自建脚本或user ruleset。
 */
async function removeHardCutDeletedManagedSystemAssetPrefixes(syncState: UserSystemAssetsSyncState, result: UserAssetsSyncResult, preservedDeletedAssetPaths: Set<string>, targetNbookRoot = userNbookAbsoluteRoot(), excludeAgentPackages = false): Promise<boolean> {
    let changed = false;
    for (const assetPath of HARD_CUT_DELETED_MANAGED_SYSTEM_ASSET_PATHS) {
        if (isUserAssetsStoragePath(assetPath)) {
            continue;
        }
        if (excludeAgentPackages && isAgentPackageAssetPath(assetPath)) {
            continue;
        }
        const userPath = resolveInsideRoot(targetNbookRoot, assetPath);
        if (!await pathExists(userPath)) {
            continue;
        }
        const stateItem = syncState.assets?.find((item) => item.assetPath === assetPath);
        if (stateItem) {
            const currentUserHash = (await sha256File(userPath)).sha256;
            if (currentUserHash !== stateItem.lastSyncedUserHash) {
                if (!preservedDeletedAssetPaths.has(assetPath)) {
                    result.assetWarnings?.push({
                        assetPath,
                        message: "系统 .nbook asset 已硬切删除，但用户覆盖已手改，未自动删除。",
                    });
                }
                continue;
            }
            removeUserAssetSyncState(syncState, assetPath);
        }
        await fs.rm(userPath, {force: true});
        changed = true;
    }
    for (const assetPrefix of HARD_CUT_DELETED_MANAGED_SYSTEM_ASSET_PREFIXES) {
        if (excludeAgentPackages && isAgentPackageAssetPath(assetPrefix)) {
            continue;
        }
        const userPrefixPath = resolveInsideRoot(targetNbookRoot, assetPrefix);

        for (const assetPath of await listUserAssetFilesUnderPrefix(assetPrefix, targetNbookRoot)) {
            const userPath = resolveInsideRoot(targetNbookRoot, assetPath);
            const stateItem = syncState.assets?.find((item) => item.assetPath === assetPath);
            if (stateItem) {
                const currentUserHash = (await sha256File(userPath)).sha256;
                if (currentUserHash !== stateItem.lastSyncedUserHash) {
                    if (!preservedDeletedAssetPaths.has(assetPath)) {
                        result.assetWarnings?.push({
                            assetPath,
                            message: "系统 .nbook asset 已硬切删除，但用户覆盖已手改，未自动删除。",
                        });
                    }
                    continue;
                }
                removeUserAssetSyncState(syncState, assetPath);
            }
            await fs.rm(userPath, {force: true});
            changed = true;
        }

        changed = await removeEmptyDirectories(userPrefixPath) || changed;
    }
    return changed;
}
async function listUserAssetFilesUnderPrefix(assetPrefix: string, targetNbookRoot = userNbookAbsoluteRoot()): Promise<string[]> {
    const root = resolveInsideRoot(targetNbookRoot, assetPrefix);
    if (!await pathExists(root)) {
        return [];
    }
    const result: string[] = [];
    await collectUserAssetFiles(root, result, targetNbookRoot);
    return result;
}

async function collectUserAssetFiles(root: string, result: string[], targetNbookRoot: string): Promise<void> {
    const entries = await fs.readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            await collectUserAssetFiles(entryPath, result, targetNbookRoot);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        result.push(path.relative(targetNbookRoot, entryPath).split(path.sep).join("/"));
    }
}

async function removeEmptyDirectories(root: string): Promise<boolean> {
    if (!await pathExists(root)) {
        return false;
    }
    let changed = false;
    for (const entry of await fs.readdir(root, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            changed = await removeEmptyDirectories(path.join(root, entry.name)) || changed;
        }
    }
    if ((await fs.readdir(root)).length === 0) {
        await fs.rm(root, {recursive: true, force: true});
        return true;
    }
    return changed;
}

/**
 * 判断受管系统资源是否属于已从 bundled assets 删除的旧路径。
 */
function isDeletedManagedSystemAssetPath(assetPath: string): boolean {
    return DELETED_MANAGED_SYSTEM_ASSET_PATHS.has(assetPath)
        || DELETED_MANAGED_SYSTEM_ASSET_PREFIXES.some((prefix) => assetPath.startsWith(prefix));
}

async function syncSystemProfilesToUserAssets(result: UserAssetsSyncResult, options: UserAssetsSyncOptions, roots: LegacyProjectionRoots): Promise<void> {
    const metadata = await readSystemProfileMetadata(roots.sourceNbookRoot);
    if (metadata.profiles.length === 0) {
        return;
    }
    const profileRelease = options.profileRelease ?? {mode: "disk_only" as const};
    if (profileRelease.mode === "in_process" && !profileRelease.registry) {
        throw new Error("HTTP runtime 同步 user profile assets 必须提供 ProfileRegistry sink。");
    }
    const syncState = await readUserSystemAssetsSyncState(roots.targetNbookRoot);
    const artifactBatch = await createProfileArtifactSyncBatch(roots);
    const sourceReplacements: PendingSourceReplacement[] = [];
    let stateChanged = false;
    let profileReleaseState: "not_started" | "disk_committed" = "not_started";
    try {
        for (const item of metadata.profiles) {
            const systemPath = path.join(roots.sourceNbookRoot, "agent", "profiles", item.fileName);
            const userPath = path.join(roots.targetNbookRoot, "agent", "profiles", item.fileName);
            const stateItem = syncState.profiles.find((profile) => profile.fileName === item.fileName);
            if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
                const hash = await sha256File(userPath);
                const artifactSync = await stageCompiledProfileArtifact(artifactBatch, item.fileName, roots);
                if (!artifactSync.ok) {
                    result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                    continue;
                }
                upsertUserProfileSyncState(syncState, item, hash.sha256);
                stateChanged = true;
                continue;
            }
            if (!await pathExists(userPath)) {
                await fs.mkdir(path.dirname(userPath), {recursive: true});
                const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
                const artifactSync = await stageCompiledProfileArtifact(artifactBatch, item.fileName, roots);
                if (!artifactSync.ok) {
                    await sourceCopy.rollback();
                    result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                    continue;
                }
                sourceReplacements.push(sourceCopy);
                const hash = await sha256File(userPath);
                upsertUserProfileSyncState(syncState, item, hash.sha256);
                result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
                stateChanged = true;
                continue;
            }
            const currentUserHash = (await sha256File(userPath)).sha256;
            if (currentUserHash === item.sha256) {
                const artifactSync = await stageCompiledProfileArtifact(artifactBatch, item.fileName, roots);
                if (!artifactSync.ok) {
                    result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                    continue;
                }
                upsertUserProfileSyncState(syncState, item, currentUserHash);
                stateChanged = true;
                continue;
            }
            if (options.force) {
                const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
                const artifactSync = await stageCompiledProfileArtifact(artifactBatch, item.fileName, roots);
                if (!artifactSync.ok) {
                    await sourceCopy.rollback();
                    result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                    continue;
                }
                sourceReplacements.push(sourceCopy);
                const hash = await sha256File(userPath);
                upsertUserProfileSyncState(syncState, item, hash.sha256);
                result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
                stateChanged = true;
                continue;
            }
            if (!stateItem) {
                result.profileWarnings?.push({
                    fileName: item.fileName,
                    profileKey: item.profileKey,
                    message: `系统 profile ${item.profileKey} 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。`,
                });
                continue;
            }
            if (currentUserHash !== stateItem.lastSyncedUserHash) {
                if (item.sha256 !== stateItem.upstreamHash) {
                    result.profileWarnings?.push({
                        fileName: item.fileName,
                        profileKey: item.profileKey,
                        message: `系统 profile ${item.profileKey} 已更新，但用户覆盖已手改，未自动覆盖。`,
                    });
                }
                continue;
            }
            if (item.sha256 === stateItem.upstreamHash) {
                continue;
            }
            const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
            const artifactSync = await stageCompiledProfileArtifact(artifactBatch, item.fileName, roots);
            if (!artifactSync.ok) {
                await sourceCopy.rollback();
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                continue;
            }
            sourceReplacements.push(sourceCopy);
            const hash = await sha256File(userPath);
            upsertUserProfileSyncState(syncState, item, hash.sha256);
            result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
            stateChanged = true;
        }
        if (artifactBatch.stagedProfiles.length > 0) {
            await assertProfileArtifactBatchSourcesFresh(artifactBatch, roots.targetNbookRoot);
            try {
                const artifactPathContext = await userProfileArtifactPathContext(roots.targetNbookRoot);
                await new ProfileReleasePublisher({
                    profileRoot: userProfileRoot(roots.targetNbookRoot),
                    artifactPathContext,
                    ...profileRelease,
                }).publishStagedEntries(
                    artifactBatch.buildCompiledDir,
                    artifactBatch.stagedProfiles.map((profile) => profile.entry),
                );
                profileReleaseState = "disk_committed";
            } catch (error) {
                if (isProfileReleaseCommittedButRegistryFailedError(error)) {
                    profileReleaseState = "disk_committed";
                }
                throw error;
            }
            for (const staged of artifactBatch.stagedProfiles) {
                if (staged.entry.status === "compile_failed") {
                    continue;
                }
                const validation = await validateProfileArtifact(userProfileRoot(roots.targetNbookRoot), staged.entry, await userProfileArtifactPathContext(roots.targetNbookRoot)).catch((error) => ({
                    fresh: false,
                    reason: error instanceof Error ? error.message : String(error),
                }));
                if (!validation.fresh && validation.reason !== "dependency_changed") {
                    result.profileWarnings?.push({
                        fileName: staged.fileName,
                        profileKey: staged.profileKey,
                        message: `系统 profile ${staged.profileKey} 同步后仍不可运行：${validation.reason ?? "unknown"}。`,
                    });
                }
            }
        }
        for (const sourceCopy of sourceReplacements) {
            await sourceCopy.commit().catch((error) => {
                void appLogger.warn("workspaceFiles.userAssetsSync.profileSourceCommitCleanupFailed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }
        if (stateChanged) {
            await writeUserSystemAssetsSyncState(syncState, roots.targetNbookRoot);
        }
    } catch (error) {
        if (profileReleaseState === "disk_committed") {
            for (const sourceCopy of sourceReplacements) {
                await sourceCopy.commit().catch((commitError) => {
                    void appLogger.warn("workspaceFiles.userAssetsSync.profileSourceCommitCleanupFailed", {
                        error: commitError instanceof Error ? commitError.message : String(commitError),
                    });
                });
            }
        } else {
            for (const sourceCopy of sourceReplacements.toReversed()) {
                await sourceCopy.rollback().catch(() => undefined);
            }
        }
        throw error;
    } finally {
        await fs.rm(artifactBatch.buildCompiledDir, {recursive: true, force: true}).catch((error) => {
            void appLogger.warn("workspaceFiles.userAssetsSync.profileArtifactStagingCleanupFailed", {
                buildCompiledDir: artifactBatch.buildCompiledDir,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
    await removeCopiedSystemMetadata(roots.targetNbookRoot);
}

async function syncSystemVariableDefinitionsToUserAssets(result: UserAssetsSyncResult, options: UserAssetsSyncOptions, roots: LegacyProjectionRoots): Promise<void> {
    const systemRoot = systemVariableDefinitionRoot(roots.sourceNbookRoot);
    const targetRoot = userVariableDefinitionRoot(roots.targetNbookRoot);
    const systemPath = path.join(systemRoot, "definitions.ts");
    if (!await pathExists(systemPath)) {
        return;
    }
    const item = {
        assetPath: "agent/variables/definitions.ts",
        ...await sha256File(systemPath),
    };
    const userPath = path.join(targetRoot, "definitions.ts");
    const syncState = await readUserSystemAssetsSyncState(roots.targetNbookRoot);
    const stateItem = findUserAssetSyncState(syncState, item.assetPath);
    let stateChanged = false;
    const syncArtifact = async (): Promise<boolean> => {
        if (options.syncVariableCompiledArtifacts === false) {
            return true;
        }
        const artifactSync = await syncCompiledVariableDefinitionArtifact(roots);
        if (!artifactSync.ok) {
            result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.message});
            return false;
        }
        if (artifactSync.warning) {
            result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.warning});
        }
        return true;
    };
    if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
        const hash = await sha256File(userPath);
        if (await syncArtifact()) {
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            stateChanged = true;
        }
    } else if (!await pathExists(userPath)) {
        await fs.mkdir(path.dirname(userPath), {recursive: true});
        const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
        if (!await syncArtifact()) {
            await sourceCopy.rollback();
        } else {
            await sourceCopy.commit();
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.updatedAssets = (result.updatedAssets ?? 0) + 1;
            stateChanged = true;
        }
    } else {
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            if (await syncArtifact()) {
                upsertUserAssetSyncState(syncState, item, currentUserHash);
                stateChanged = true;
            }
        } else if (options.force) {
            const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
            if (!await syncArtifact()) {
                await sourceCopy.rollback();
            } else {
                await sourceCopy.commit();
                const hash = await sha256File(userPath);
                upsertUserAssetSyncState(syncState, item, hash.sha256);
                result.updatedAssets = (result.updatedAssets ?? 0) + 1;
                stateChanged = true;
            }
        } else if (!stateItem) {
            result.assetWarnings?.push({
                assetPath: item.assetPath,
                message: "系统 variable definition 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。",
            });
        } else if (currentUserHash !== stateItem.lastSyncedUserHash) {
            if (item.sha256 !== stateItem.upstreamHash) {
                result.assetWarnings?.push({
                    assetPath: item.assetPath,
                    message: "系统 variable definition 已更新，但用户覆盖已手改，未自动覆盖。",
                });
            }
        } else if (item.sha256 !== stateItem.upstreamHash) {
            const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
            if (!await syncArtifact()) {
                await sourceCopy.rollback();
            } else {
                await sourceCopy.commit();
                const hash = await sha256File(userPath);
                upsertUserAssetSyncState(syncState, item, hash.sha256);
                result.updatedAssets = (result.updatedAssets ?? 0) + 1;
                stateChanged = true;
            }
        }
    }
    if (stateChanged) {
        await writeUserSystemAssetsSyncState(syncState, roots.targetNbookRoot);
    }
}

async function listManagedSystemAssets(sourceNbookRoot = systemNbookRoot(), options: {excludeAgentPackages?: boolean} = {}): Promise<SystemManagedAssetItem[]> {
    const result: SystemManagedAssetItem[] = [];
    await collectManagedSystemAssets(sourceNbookRoot, "", result, options);
    return result.sort((left, right) => left.assetPath.localeCompare(right.assetPath));
}

async function collectManagedSystemAssets(root: string, relativeRoot: string, result: SystemManagedAssetItem[], options: {excludeAgentPackages?: boolean}): Promise<void> {
    const entries = await fs.readdir(path.join(root, relativeRoot), {withFileTypes: true});
    for (const entry of entries) {
        const relativePath = path.posix.join(relativeRoot.split(path.sep).join("/"), entry.name);
        if (entry.isDirectory()) {
            await collectManagedSystemAssets(root, relativePath, result, options);
            continue;
        }
        if (!entry.isFile() || isManagedAssetBlacklisted(relativePath, options)) {
            continue;
        }
        const absolutePath = path.join(root, relativePath);
        result.push({assetPath: relativePath, ...await sha256File(absolutePath)});
    }
}

function isManagedAssetBlacklisted(assetPath: string, options: {excludeAgentPackages?: boolean} = {}): boolean {
    const normalized = assetPath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    const isAgentPackage = parts[0] === "agent"
        && (parts[1] === "skills" || parts[1] === "workflows" || parts[1] === "profiles");
    if (isUserAssetsStoragePath(normalized)) {
        return true;
    }
    return normalized === "config.json"
        || normalized === "neuro-book.sqlite"
        || normalized === ".system-assets-sync-state.json"
        || normalized === "agent/session-seq.json"
        || normalized === "agent/profiles/.profile-sync-state.json"
        || normalized === "agent/profiles/.system-profile-metadata.json"
        || normalized.startsWith("agent/sessions/")
        || (normalized.startsWith("agent/profiles/") && !normalized.startsWith("agent/profiles/builtin/writer.home/"))
        || (options.excludeAgentPackages === true && isAgentPackage)
        || normalized === "agent/variables/definitions.ts"
        || normalized.startsWith("agent/skills/llmlint/.git/")
        || (parts[0] === "agent" && parts[1] === "skills" && parts[3] === "node_modules")
        || normalized.startsWith("agent/skills/llmlint/evals/")
        || parts.includes(".compiled")
        || parts.includes(".staging");
}
function isAgentPackageAssetPath(assetPath: string): boolean {
    const parts = assetPath.replaceAll("\\", "/").split("/");
    return parts[0] === "agent"
        && (parts[1] === "skills" || parts[1] === "workflows" || parts[1] === "profiles");
}


async function assertReadableUserAssetsSyncAssetPath(assetPath: string): Promise<void> {
    if (assetPath === "agent/variables/definitions.ts") {
        return;
    }
    const assets = await listManagedSystemAssets();
    if (!assets.some((asset) => asset.assetPath === assetPath)) {
        throw new Error(`assetPath 不属于可读取的系统同步资源: ${assetPath}`);
    }
}
async function createProfileArtifactSyncBatch(roots: LegacyProjectionRoots): Promise<ProfileArtifactSyncBatch> {
    const systemProfileRootPath = systemProfileRoot(roots.sourceNbookRoot);
    const userProfileRootPath = userProfileRoot(roots.targetNbookRoot);
    const systemManifest = await readProfileArtifactManifest(systemProfileRootPath, await systemProfileArtifactPathContext(roots.sourceNbookRoot));
    return {
        systemManifest,
        buildCompiledDir: path.join(path.dirname(userProfileRootPath), ".staging", "profile-artifact-sync", randomUUID()),
        stagedProfiles: [],
    };
}

async function stageCompiledProfileArtifact(batch: ProfileArtifactSyncBatch, fileName: string, roots: LegacyProjectionRoots): Promise<CompiledArtifactSyncResult> {
    const item = batch.systemManifest.profiles.find((profile) => profile.fileName === fileName);
    if (!item) {
        return {ok: false, message: `系统 profile ${fileName} 缺少 compiled manifest entry，未同步 compiled artifact。`};
    }
    const userSourceHash = await sha256File(path.join(userProfileRoot(roots.targetNbookRoot), item.fileName));
    const systemRootLabel = normalizeArtifactRootLabel(batch.systemManifest.profilesRoot);
    const userRootLabel = "workspace/.nbook/agent/profiles";
    const userItem = rehomeProfileArtifactItem(item, {
        fromRootLabel: systemRootLabel,
        toRootLabel: userRootLabel,
    });
    const userSourceDependencyPath = `${userRootLabel}/${item.fileName}`;
    const nextEntry: ProfileArtifactManifestItem = {
        ...userItem,
        sourceSha256: userSourceHash.sha256,
        sourceBytes: userSourceHash.bytes,
        dependencies: userItem.dependencies.map((dependency) => dependency.path.replace(/[\\/]+/g, "/") === userSourceDependencyPath
            ? {...dependency, sha256: userSourceHash.sha256, bytes: userSourceHash.bytes}
            : dependency),
    };
    try {
        await copyProfileArtifactToStaging(batch.buildCompiledDir, item.artifactFileName, roots.sourceNbookRoot);
        if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
            await copyProfileArtifactToStaging(batch.buildCompiledDir, item.typeFileName, roots.sourceNbookRoot);
        }
    } catch (error) {
        return {ok: false, message: error instanceof Error ? error.message : String(error)};
    }
    batch.stagedProfiles.push({fileName: item.fileName, profileKey: item.profileKey, entry: nextEntry});
    await userAssetsProfileArtifactStagedHookForTest?.(item.fileName);
    return {ok: true};
}

async function assertProfileArtifactBatchSourcesFresh(batch: ProfileArtifactSyncBatch, targetNbookRoot: string): Promise<void> {
    for (const staged of batch.stagedProfiles) {
        if (staged.entry.status === "compile_failed") {
            continue;
        }
        const current = await sha256File(path.join(userProfileRoot(targetNbookRoot), staged.entry.fileName));
        if (current.sha256 !== staged.entry.sourceSha256 || current.bytes !== staged.entry.sourceBytes) {
            throw new Error(`系统 profile ${staged.profileKey} 同步发布前源码又发生变化，已放弃本轮 compiled artifact 发布。`);
        }
    }
}

async function copyProfileArtifactToStaging(buildCompiledDir: string, artifactFileName: string, sourceNbookRoot: string): Promise<void> {
    const sourcePath = path.join(systemProfileRoot(sourceNbookRoot), PROFILE_COMPILED_DIR_NAME, ...artifactFileName.split("/"));
    const targetPath = path.join(buildCompiledDir, ...artifactFileName.split("/"));
    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    await fs.copyFile(sourcePath, targetPath);
}

async function syncCompiledVariableDefinitionArtifact(roots: LegacyProjectionRoots): Promise<CompiledArtifactSyncResult> {
    const runtimePaths = runtimePathsFromEnv();
    const systemRoot = systemVariableDefinitionRoot(roots.sourceNbookRoot);
    const userRoot = userVariableDefinitionRoot(roots.targetNbookRoot);
    const systemContext = await resolveVariableDefinitionArtifactPathContext(systemRoot, SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL, runtimePaths.applicationRoot);
    const userContext = await resolveVariableDefinitionArtifactPathContext(userRoot, "workspace/.nbook/agent/variables", runtimePaths.applicationRoot);
    const systemManifest = await readVariableDefinitionManifest(systemRoot, systemContext);
    const item = systemManifest.definitions.find((definition) => definition.fileName === "definitions.ts");
    if (!item) return {ok: false, message: "系统 variable definition 缺少 compiled manifest entry，未同步 compiled artifact。"};
    const userCompiledRoot = path.join(userRoot, ".compiled");
    await fs.mkdir(userCompiledRoot, {recursive: true});
    const userManifest = await readVariableDefinitionManifest(userRoot, userContext);
    const userSourceHash = await sha256File(path.join(userRoot, item.fileName));
    const systemRootLabel = normalizeArtifactRootLabel(systemManifest.definitionsRoot);
    const userRootLabel = "workspace/.nbook/agent/variables";
    const sourcePrefixes = [systemRootLabel, `.output/server/${systemRootLabel}`];
    const userSourceDependencyPath = `${userRootLabel}/${item.fileName}`;
    const nextItem = {
        ...item,
        sourceSha256: userSourceHash.sha256,
        sourceBytes: userSourceHash.bytes,
        dependencies: item.dependencies.map((dependency) => {
            const dependencyPath = dependency.path.replace(/[\\/]+/g, "/");
            return sourcePrefixes.some((prefix) => dependencyPath === `${prefix}/${item.fileName}`)
                ? {...dependency, path: userSourceDependencyPath, sha256: userSourceHash.sha256, bytes: userSourceHash.bytes}
                : dependency;
        }),
    };
    const nextManifest = {
        ...userManifest,
        definitionsRoot: userRootLabel,
        definitions: [
            ...userManifest.definitions.filter((definition) => definition.fileName !== item.fileName),
            nextItem,
        ].sort((left, right) => left.fileName.localeCompare(right.fileName)),
    };
    nextManifest.generatedAt = JSON.stringify(userManifest.definitions) === JSON.stringify(nextManifest.definitions) ? userManifest.generatedAt : new Date().toISOString();
    const artifactSync = await stageVerifiedArtifact(path.join(systemRoot, ".compiled", item.artifactFileName), path.join(userCompiledRoot, item.artifactFileName), item, "artifact");
    if (!artifactSync.ok) return {ok: false, message: `系统 variable definition compiled artifact 同步失败：${artifactSync.message}`};
    const stagedReplacements: StagedFileReplacement[] = [artifactSync.file];
    if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
        const typeSync = await stageVerifiedArtifact(path.join(systemRoot, ".compiled", item.typeFileName), path.join(userCompiledRoot, item.typeFileName), item, "type");
        if (!typeSync.ok) {
            await cleanupStagedReplacements(stagedReplacements);
            return {ok: false, message: `系统 variable definition type artifact 同步失败：${typeSync.message}`};
        }
        stagedReplacements.push(typeSync.file);
    }
    const manifestPath = path.join(userCompiledRoot, "manifest.json");
    const manifestStagePath = `${manifestPath}.${randomUUID()}.syncing`;
    await fs.writeFile(manifestStagePath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf-8");
    stagedReplacements.push({sourcePath: manifestStagePath, targetPath: manifestPath});
    await replaceFilesWithRollback(stagedReplacements);
    await pruneCompiledDirectory(userCompiledRoot, nextManifest.definitions.flatMap((definition) => [definition.artifactFileName, definition.typeFileName]));
    const validation = await validateVariableDefinitionArtifact(userRoot, nextItem, userContext);
    if (!validation.fresh && validation.reason !== "dependency_changed") return {ok: true, warning: `系统 variable definition 同步后仍不可运行：${validation.reason ?? "unknown"}。`};
    return {ok: true};
}

async function stageVerifiedArtifact(
    sourcePath: string,
    targetPath: string,
    item: ProfileArtifactManifestItem | VariableDefinitionManifestItem,
    kind: "artifact" | "type",
): Promise<StagedArtifactSyncResult> {
    const temporaryPath = `${targetPath}.${randomUUID()}.syncing`;
    const expectedSha256 = kind === "artifact" ? item.artifactSha256 : item.typeSha256;
    const expectedBytes = kind === "artifact" ? item.artifactBytes : item.typeBytes;
    if (!expectedSha256 || expectedBytes === undefined) {
        return {ok: false, message: `${kind} 缺少 manifest hash。`};
    }
    let staged = false;
    try {
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.copyFile(sourcePath, temporaryPath);
        const actual = await sha256File(temporaryPath);
        if (actual.sha256 !== expectedSha256 || actual.bytes !== expectedBytes) {
            return {ok: false, message: `${path.basename(targetPath)} hash 不匹配，expected ${expectedSha256}/${expectedBytes}, actual ${actual.sha256}/${actual.bytes}`};
        }
        staged = true;
        return {ok: true, file: {sourcePath: temporaryPath, targetPath}};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {ok: false, message};
    } finally {
        if (!staged) {
            await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
        }
    }
}

async function cleanupStagedReplacements(files: StagedFileReplacement[]): Promise<void> {
    await Promise.all(files.map((file) => fs.rm(file.sourcePath, {force: true})));
}

async function replaceFilesWithRollback(files: StagedFileReplacement[]): Promise<void> {
    const replacements: Array<{commit: () => Promise<void>; rollback: () => Promise<void>}> = [];
    try {
        for (const file of files) {
            replacements.push(await replaceFileWithRollback(file.sourcePath, file.targetPath));
        }
    } catch (error) {
        for (const replacement of replacements.toReversed()) {
            await replacement.rollback().catch(() => undefined);
        }
        await cleanupStagedReplacements(files);
        throw error;
    }
    try {
        for (const replacement of replacements) {
            await replacement.commit();
        }
    } finally {
        await cleanupStagedReplacements(files);
    }
}

async function replaceFileWithRollback(sourcePath: string, targetPath: string): Promise<{commit: () => Promise<void>; rollback: () => Promise<void>}> {
    const backupPath = `${targetPath}.${randomUUID()}.backup`;
    const hadOriginal = await pathExists(targetPath);
    let backupCreated = false;
    try {
        if (hadOriginal) {
            await fs.copyFile(targetPath, backupPath);
            backupCreated = true;
        }
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.copyFile(sourcePath, targetPath);
    } catch (error) {
        if (backupCreated) {
            try {
                await fs.copyFile(backupPath, targetPath);
                await fs.rm(backupPath, {force: true});
            } catch (restoreError) {
                const replaceMessage = error instanceof Error ? error.message : String(error);
                const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
                throw new Error(`替换文件失败，且恢复备份失败。备份已保留在 ${backupPath}。replace error: ${replaceMessage}; restore error: ${restoreMessage}`);
            }
        } else if (!hadOriginal) {
            await fs.rm(targetPath, {force: true}).catch(() => undefined);
        }
        throw error;
    }
    return {
        commit: async () => {
            await fs.rm(backupPath, {force: true});
        },
        rollback: async () => {
            if (hadOriginal) {
                await fs.copyFile(backupPath, targetPath);
                await fs.rm(backupPath, {force: true});
                return;
            }
            await fs.rm(targetPath, {force: true});
        },
    };
}

async function pruneCompiledDirectory(compiledRoot: string, referencedFiles: Array<string | undefined>): Promise<void> {
    const keep = new Set(["manifest.json", ...referencedFiles.filter((fileName): fileName is string => Boolean(fileName))]);
    const entries = await fs.readdir(compiledRoot, {withFileTypes: true}).catch(() => []);
    await Promise.all(entries
        .filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name) && !keep.has(entry.name))
        .map((entry) => fs.rm(path.join(compiledRoot, entry.name), {force: true})));
}

async function readUserSystemAssetsSyncState(targetNbookRoot = userNbookAbsoluteRoot()): Promise<UserSystemAssetsSyncState> {
    try {
        const parsed = JSON.parse(await fs.readFile(userSystemAssetsSyncStatePath(targetNbookRoot), "utf-8")) as UserSystemAssetsSyncState;
        return {profiles: parsed.profiles ?? [], assets: parsed.assets ?? []};
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {profiles: [], assets: []};
        }
        throw error;
    }
}

async function writeUserSystemAssetsSyncState(syncState: UserSystemAssetsSyncState, targetNbookRoot = userNbookAbsoluteRoot()): Promise<void> {
    await userAssetsSyncStateWriteHookForTest?.();
    const statePath = userSystemAssetsSyncStatePath(targetNbookRoot);
    await fs.mkdir(path.dirname(statePath), {recursive: true});
    await fs.writeFile(statePath, `${JSON.stringify(syncState, null, 2)}\n`, "utf-8");
}

function upsertUserProfileSyncState(syncState: UserSystemAssetsSyncState, metadata: SystemProfileMetadataItem, userHash: string): void {
    const next: UserProfileSyncStateItem = {
        fileName: metadata.fileName,
        profileKey: metadata.profileKey,
        upstreamHash: metadata.sha256,
        lastSyncedUserHash: userHash,
        syncedAt: new Date().toISOString(),
    };
    const index = syncState.profiles.findIndex((item) => item.fileName === metadata.fileName);
    if (index >= 0) {
        syncState.profiles[index] = next;
    } else {
        syncState.profiles.push(next);
    }
    syncState.profiles.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function upsertUserAssetSyncState(syncState: UserSystemAssetsSyncState, metadata: {assetPath: string; sha256: string}, userHash: string): void {
    const next: UserAssetSyncStateItem = {
        assetPath: metadata.assetPath,
        upstreamHash: metadata.sha256,
        lastSyncedUserHash: userHash,
        syncedAt: new Date().toISOString(),
    };
    syncState.assets ??= [];
    const index = syncState.assets.findIndex((item) => item.assetPath === metadata.assetPath);
    if (index >= 0) {
        syncState.assets[index] = next;
    } else {
        syncState.assets.push(next);
    }
    syncState.assets.sort((left, right) => left.assetPath.localeCompare(right.assetPath));
}

function removeUserAssetSyncState(syncState: UserSystemAssetsSyncState, assetPath: string): void {
    syncState.assets = (syncState.assets ?? []).filter((item) => item.assetPath !== assetPath);
}

function findUserAssetSyncState(syncState: UserSystemAssetsSyncState, assetPath: string): UserAssetSyncStateItem | undefined {
    const exact = syncState.assets?.find((item) => item.assetPath === assetPath);
    if (exact) {
        return exact;
    }
    const writerHomePrefix = "agent/profiles/builtin/writer.home/";
    if (assetPath.startsWith(writerHomePrefix)) {
        const legacyPath = `agent/writing-presets/${assetPath.slice(writerHomePrefix.length)}`;
        return syncState.assets?.find((item) => item.assetPath === legacyPath || item.assetPath === assetPath.slice(writerHomePrefix.length));
    }
    return undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function sameFile(leftPath: string, rightPath: string): Promise<boolean> {
    if (!await pathExists(leftPath) || !await pathExists(rightPath)) {
        return false;
    }
    const [left, right] = await Promise.all([
        sha256File(leftPath),
        sha256File(rightPath),
    ]);
    return left.sha256 === right.sha256;
}

/**
 * 读取当前 Git HEAD 中的系统 asset hash，用于迁移缺少 sync state 的未手改旧副本。
 */
async function removeCopiedSystemMetadata(targetNbookRoot = userNbookAbsoluteRoot()): Promise<void> {
    const copiedMetadataPath = path.join(userProfileRoot(targetNbookRoot), ".system-profile-metadata.json");
    await fs.rm(copiedMetadataPath, {force: true});
}

/**
 * 规范化用户传入的相对路径，禁止绝对路径和上跳路径。
 */
function normalizeSafeRelativePath(value: string): string {
    const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("\0") || path.posix.isAbsolute(normalized)) {
        return "";
    }
    const parts = normalized.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
        return "";
    }
    return parts.join("/");
}

/**
 * 将相对路径解析到指定 root 内，防止 detail API 读出 user-assets 边界。
 */
function resolveInsideRoot(root: string, relativePath: string): string {
    const normalized = normalizeSafeRelativePath(relativePath);
    if (!normalized) {
        throw new Error("路径不能为空或包含非法片段");
    }
    const absoluteRoot = path.resolve(root);
    const resolved = path.resolve(absoluteRoot, normalized);
    if (!relativeFilePathInside(absoluteFsPath(absoluteRoot), absoluteFsPath(resolved))) {
        throw new Error(`路径越界: ${relativePath}`);
    }
    return resolved;
}

/**
 * asset warning 只允许读取 Workspace Root .nbook 与系统 bundled .nbook 的同名资源。
 */
function resolveUserAssetConflictRoots(assetPath: string): {systemPath: string; userPath: string} {
    const normalized = normalizeSafeRelativePath(assetPath);
    if (!normalized) {
        throw new Error("assetPath 不能为空或包含非法片段");
    }
    return {
        systemPath: resolveInsideRoot(systemNbookRoot(), normalized),
        userPath: resolveInsideRoot(userNbookAbsoluteRoot(), normalized),
    };
}

/**
 * 读取可 diff 文本文件；大文件和二进制文件交给调用方显示不可 diff 提示。
 */
async function readTextFileForDiff(filePath: string): Promise<{
    content: string;
    sha256: string;
    bytes: number;
    diffable: boolean;
    reason?: "missing" | "binary" | "too_large";
}> {
    if (!await pathExists(filePath)) {
        return {
            content: "",
            sha256: "",
            bytes: 0,
            diffable: false,
            reason: "missing",
        };
    }
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
        throw new Error("目录不能用于文本 diff");
    }
    const buffer = await fs.readFile(filePath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (stat.size > USER_ASSETS_DIFF_MAX_BYTES) {
        return {
            content: "",
            sha256,
            bytes: buffer.byteLength,
            diffable: false,
            reason: "too_large",
        };
    }
    if (buffer.includes(0)) {
        return {
            content: "",
            sha256,
            bytes: buffer.byteLength,
            diffable: false,
            reason: "binary",
        };
    }
    return {
        content: buffer.toString("utf-8"),
        sha256,
        bytes: buffer.byteLength,
        diffable: true,
    };
}

/**
 * 为 Monaco diff 推断语言，保持为通用组件提供稳定的 language。
 */
function inferDiffLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts") {
        return "typescript";
    }
    if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
        return "javascript";
    }
    if (extension === ".json") {
        return "json";
    }
    if (extension === ".yaml" || extension === ".yml") {
        return "yaml";
    }
    if (extension === ".css") {
        return "css";
    }
    if (extension === ".html" || extension === ".vue") {
        return "html";
    }
    return "markdown";
}

/**
 * 判断路径是否为目录。
 */
async function isDirectory(directoryPath: string): Promise<boolean> {
    try {
        return (await fs.stat(directoryPath)).isDirectory();
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
