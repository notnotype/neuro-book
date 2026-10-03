import {copyFile, link, lstat, mkdir, readdir, stat} from "node:fs/promises";
import path from "node:path";
import {
    PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
    PROFILE_COMPILED_DIR_NAME,
    PROFILE_COMPILED_MANIFEST_FILE,
    readProfileArtifactManifest,
    resolveProfileArtifactPathContext,
    SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {
    readVariableDefinitionManifest,
    resolveVariableDefinitionArtifactPathContext,
    SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL,
    VARIABLE_DEFINITION_COMPILED_DIR,
    VARIABLE_DEFINITION_MANIFEST_FILE,
} from "nbook/server/agent/variables/definition-artifact";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

const PROFILE_ROOT_SEGMENTS = ["agent", "profiles"] as const;
const VARIABLE_ROOT_SEGMENTS = ["agent", "variables"] as const;
const RUNTIME_CACHE_SEGMENTS = new Set([".runtime-artifact-import-cache", "runtime-artifact-import-cache"]);
const VITEPRESS_GENERATED_SEGMENTS = new Set(["cache", "dist", "staged", "temp"]);

export type SystemAssetsProjectionInventory = {
    fileCount: number;
    bytes: number;
    /** Profile manifest 当前引用的文件，路径相对 `agent/profiles/.compiled`。 */
    profileArtifacts: string[];
    /** Variable manifest 当前引用的文件，路径相对 `agent/variables/.compiled`。 */
    variableArtifacts: string[];
};

export type SystemAssetsArtifactVerification = {
    expected: string[];
    actual: string[];
};

export type SystemAssetsProjectionVerification = {
    profileArtifacts: SystemAssetsArtifactVerification;
    variableArtifacts: SystemAssetsArtifactVerification;
};

export type SystemAssetsProjectionRequest = {
    sourceRoot: string;
    targetRoot: string;
    /** `hardlink` 只用于内容寻址的 Profile artifact；缺省为真实复制。 */
    profileArtifactMode?: "copy" | "hardlink";
    /** `exclude` 用于 Product 空目标重编；默认投影 manifest current。 */
    compiledArtifactMode?: "current" | "exclude";
};

export type SystemAssetsProjectionResult = {
    inventory: SystemAssetsProjectionInventory;
    verification: SystemAssetsProjectionVerification;
};

type ProjectionSelection = {
    sourceRoot: string;
    profileManifest: boolean;
    profileArtifacts: ReadonlySet<string>;
    variableManifest: boolean;
    variableArtifacts: ReadonlySet<string>;
};

type ProjectionFile = {
    sourcePath: string;
    relativePath: string;
    bytes: number;
    immutableProfileArtifact: boolean;
};

type ProjectionPlan = {
    files: ProjectionFile[];
    inventory: SystemAssetsProjectionInventory;
};

/**
 * 把开发树中的 system assets 收敛成可发布投影。
 *
 * Module 同时拥有选择规则、复制和产物验证，避免测试、Product 与发行脚本各自维护一套
 * 排除列表。调用方只需提供 system `.nbook` 根和一个空目标。
 */
export class SystemAssetsProjection {
    /** 计算实际会进入投影的文件数和字节数，不写目标目录。 */
    async inventory(sourceRoot: string): Promise<SystemAssetsProjectionInventory> {
        return (await buildProjectionPlan(path.resolve(sourceRoot))).inventory;
    }

    /**
     * 把 system assets 复制到不存在或为空的目标，随后验证 manifest current 与磁盘集合完全相等。
     */
    async copyToEmpty(request: SystemAssetsProjectionRequest): Promise<SystemAssetsProjectionResult> {
        const sourceRoot = path.resolve(request.sourceRoot);
        const targetRoot = path.resolve(request.targetRoot);
        await assertProjectionRoots(sourceRoot, targetRoot);
        const plan = await buildProjectionPlan(sourceRoot, request.compiledArtifactMode ?? "current");
        // 生成 plan 期间可能耗时，再检查一次，拒绝覆盖并发写入的目标内容。
        await assertEmptyTarget(targetRoot);
        await mkdir(targetRoot, {recursive: true});

        for (const file of plan.files) {
            const targetPath = path.join(targetRoot, ...file.relativePath.split("/"));
            await mkdir(path.dirname(targetPath), {recursive: true});
            if (request.profileArtifactMode === "hardlink" && file.immutableProfileArtifact) {
                try {
                    await link(file.sourcePath, targetPath);
                    continue;
                } catch {
                    // 跨卷或文件系统不支持硬链接时，真实复制保持相同语义。
                }
            }
            await copyFile(file.sourcePath, targetPath);
        }

        return {
            inventory: plan.inventory,
            verification: await this.verify(targetRoot),
        };
    }

    /** 验证两类 manifest 的 current 引用与磁盘 `.compiled` 文件双向完全相等。 */
    async verify(projectedRoot: string): Promise<SystemAssetsProjectionVerification> {
        const root = path.resolve(projectedRoot);
        const selection = await readProjectionSelection(root);
        const profileActual = await listCompiledFiles(
            path.join(root, ...PROFILE_ROOT_SEGMENTS, PROFILE_COMPILED_DIR_NAME),
            PROFILE_COMPILED_MANIFEST_FILE,
        );
        const variableActual = await listCompiledFiles(
            path.join(root, ...VARIABLE_ROOT_SEGMENTS, VARIABLE_DEFINITION_COMPILED_DIR),
            VARIABLE_DEFINITION_MANIFEST_FILE,
        );
        const profileExpected = [...selection.profileArtifacts].sort(comparePaths);
        const variableExpected = [...selection.variableArtifacts].sort(comparePaths);
        assertArtifactSet("Profile", profileExpected, profileActual);
        assertArtifactSet("Variable", variableExpected, variableActual);
        return {
            profileArtifacts: {expected: profileExpected, actual: profileActual},
            variableArtifacts: {expected: variableExpected, actual: variableActual},
        };
    }
}

/** 建立一次不可变的投影计划，inventory 与真正复制共用同一选择结果。 */
async function buildProjectionPlan(
    sourceRoot: string,
    compiledArtifactMode: "current" | "exclude" = "current",
): Promise<ProjectionPlan> {
    const sourceStats = await lstat(sourceRoot).catch((error: unknown) => {
        // 文件系统错误来自外部环境，进入此处前无法拥有更窄的类型。
        if (isMissingError(error)) {
            throw new Error(`System assets 来源不存在：${sourceRoot}`);
        }
        throw error;
    });
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
        throw new Error(`System assets 来源必须是真实目录：${sourceRoot}`);
    }
    const currentSelection = await readProjectionSelection(sourceRoot);
    const selection = compiledArtifactMode === "current"
        ? currentSelection
        : {
            ...currentSelection,
            profileManifest: false,
            profileArtifacts: new Set<string>(),
            variableManifest: false,
            variableArtifacts: new Set<string>(),
        };
    const files: ProjectionFile[] = [];

    /** 只遍历会进入 Product 的目录；被排除的树不会继续 stat。 */
    const walk = async (relativeSegments: string[]): Promise<void> => {
        const sourceDirectory = path.join(sourceRoot, ...relativeSegments);
        const entries = await readdir(sourceDirectory, {withFileTypes: true});
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const nextSegments = [...relativeSegments, entry.name];
            const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
            if (!includeProjectionPath(nextSegments, kind, selection)) {
                continue;
            }
            const sourcePath = path.join(sourceRoot, ...nextSegments);
            if (entry.isDirectory()) {
                await walk(nextSegments);
                continue;
            }
            if (!entry.isFile()) {
                throw new Error(`System assets 不允许特殊文件或符号链接：${sourcePath}`);
            }
            const relativePath = nextSegments.join("/");
            const profileCompiledPrefix = [...PROFILE_ROOT_SEGMENTS, PROFILE_COMPILED_DIR_NAME].join("/");
            files.push({
                sourcePath,
                relativePath,
                bytes: (await stat(sourcePath)).size,
                immutableProfileArtifact: relativePath.startsWith(`${profileCompiledPrefix}/${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/`),
            });
        }
    };
    await walk([]);

    return {
        files,
        inventory: {
            fileCount: files.length,
            bytes: files.reduce((sum, file) => sum + file.bytes, 0),
            profileArtifacts: [...selection.profileArtifacts].sort(comparePaths),
            variableArtifacts: [...selection.variableArtifacts].sort(comparePaths),
        },
    };
}
async function readProjectionSelection(sourceRoot: string): Promise<ProjectionSelection> {
    const profileRoot = path.join(sourceRoot, ...PROFILE_ROOT_SEGMENTS);
    const variableRoot = path.join(sourceRoot, ...VARIABLE_ROOT_SEGMENTS);
    const compilerRoot = runtimePathsFromEnv().applicationRoot;
    const [profileArtifactPathContext, variableArtifactPathContext] = await Promise.all([
        resolveProfileArtifactPathContext(profileRoot, SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL, compilerRoot),
        resolveVariableDefinitionArtifactPathContext(variableRoot, SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL, compilerRoot),
    ]);
    const [profileManifest, variableManifest, profileManifestExists, variableManifestExists] = await Promise.all([
        readProfileArtifactManifest(profileRoot, profileArtifactPathContext),
        readVariableDefinitionManifest(variableRoot, variableArtifactPathContext),
        regularFileExists(path.join(profileRoot, PROFILE_COMPILED_DIR_NAME, PROFILE_COMPILED_MANIFEST_FILE)),
        regularFileExists(path.join(variableRoot, VARIABLE_DEFINITION_COMPILED_DIR, VARIABLE_DEFINITION_MANIFEST_FILE)),
    ]);
    const profileArtifacts = new Set<string>();
    for (const item of profileManifest.profiles) {
        profileArtifacts.add(normalizeCompiledReference(item.artifactFileName, "Profile", PROFILE_COMPILED_ARTIFACTS_DIR_NAME));
        if (item.typeFileName) {
            profileArtifacts.add(normalizeCompiledReference(item.typeFileName, "Profile", PROFILE_COMPILED_ARTIFACTS_DIR_NAME));
        }
    }
    const variableArtifacts = new Set<string>();
    for (const item of variableManifest.definitions) {
        variableArtifacts.add(normalizeCompiledReference(item.artifactFileName, "Variable"));
        if (item.typeFileName) {
            variableArtifacts.add(normalizeCompiledReference(item.typeFileName, "Variable"));
        }
    }
    return {
        sourceRoot,
        profileManifest: profileManifestExists,
        profileArtifacts,
        variableManifest: variableManifestExists,
        variableArtifacts,
    };
}

/** 判断一个来源路径是否属于静态投影或 manifest 当前引用。 */
function includeProjectionPath(
    relativeSegments: string[],
    kind: "directory" | "file" | "other",
    selection: ProjectionSelection,
): boolean {
    const logicalSegments = ["server", "docs"].includes(path.basename(selection.sourceRoot))
        ? [path.basename(selection.sourceRoot), ...relativeSegments]
        : relativeSegments;
    if (relativeSegments.some((segment) => segment === ".staging" || RUNTIME_CACHE_SEGMENTS.has(segment))) {
        return false;
    }
    if (relativeSegments.includes("node_modules") || relativeSegments.at(-1) === ".publish.lock") {
        return false;
    }
    if (containsPair(logicalSegments, "server", ".agent")) {
        return false;
    }
    if (isVitePressGenerated(logicalSegments)) {
        return false;
    }

    const compiledIndex = relativeSegments.indexOf(".compiled");
    if (compiledIndex < 0) {
        return true;
    }
    const compiledRoot = relativeSegments.slice(0, compiledIndex + 1).join("/");
    const compiledRelative = relativeSegments.slice(compiledIndex + 1).join("/");
    const profileCompiledRoot = [...PROFILE_ROOT_SEGMENTS, PROFILE_COMPILED_DIR_NAME].join("/");
    if (compiledRoot === profileCompiledRoot) {
        return includeCompiledPath(
            compiledRelative,
            kind,
            selection.profileManifest,
            PROFILE_COMPILED_MANIFEST_FILE,
            selection.profileArtifacts,
        );
    }
    const variableCompiledRoot = [...VARIABLE_ROOT_SEGMENTS, VARIABLE_DEFINITION_COMPILED_DIR].join("/");
    if (compiledRoot === variableCompiledRoot) {
        return includeCompiledPath(
            compiledRelative,
            kind,
            selection.variableManifest,
            VARIABLE_DEFINITION_MANIFEST_FILE,
            selection.variableArtifacts,
        );
    }
    // 无 manifest 合同的 `.compiled` 都是可重建生成物，整棵排除。
    return false;
}

/** 保留 manifest、current 文件，以及通向 current 文件的目录。 */
function includeCompiledPath(
    compiledRelative: string,
    kind: "directory" | "file" | "other",
    manifestExists: boolean,
    manifestFileName: string,
    artifacts: ReadonlySet<string>,
): boolean {
    if (!compiledRelative) {
        return kind === "directory" && (manifestExists || artifacts.size > 0);
    }
    if (compiledRelative === manifestFileName) {
        return kind === "file" && manifestExists;
    }
    if (kind === "directory") {
        return [...artifacts].some((artifact) => artifact.startsWith(`${compiledRelative}/`));
    }
    return kind === "file" && artifacts.has(compiledRelative);
}

/** 将 manifest 的外部路径输入收窄为不能逃离 `.compiled` 的 POSIX 相对路径。 */
function normalizeCompiledReference(reference: string, owner: "Profile" | "Variable", requiredRoot?: string): string {
    const normalizedInput = reference.replace(/\\/g, "/");
    const normalized = path.posix.normalize(normalizedInput);
    const segments = normalized.split("/");
    if (
        !normalizedInput
        || path.posix.isAbsolute(normalizedInput)
        || /^[A-Za-z]:/u.test(normalizedInput)
        || normalized === "."
        || segments.includes("..")
        || (requiredRoot !== undefined && segments[0] !== requiredRoot)
    ) {
        throw new Error(`${owner} manifest 含非法 artifact 路径：${reference}`);
    }
    return normalized;
}

/** 枚举 `.compiled` 内除 manifest 外的全部文件，供 current 双向集合验证。 */
async function listCompiledFiles(compiledRoot: string, manifestFileName: string): Promise<string[]> {
    if (!await directoryExists(compiledRoot)) {
        return [];
    }
    const files: string[] = [];
    /** 验证阶段拒绝特殊文件，避免集合检查绕过真实磁盘节点。 */
    const walk = async (directory: string, relativeSegments: string[]): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const nextSegments = [...relativeSegments, entry.name];
            const filePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(filePath, nextSegments);
                continue;
            }
            if (!entry.isFile()) {
                throw new Error(`System assets .compiled 不允许特殊文件或符号链接：${filePath}`);
            }
            const relativePath = nextSegments.join("/");
            if (relativePath !== manifestFileName) {
                files.push(relativePath);
            }
        }
    };
    await walk(compiledRoot, []);
    return files.sort(comparePaths);
}

/** 确认来源真实存在，且目标不会覆盖来源或任何已有文件。 */
async function assertProjectionRoots(sourceRoot: string, targetRoot: string): Promise<void> {
    if (sourceRoot === targetRoot || targetRoot.startsWith(`${sourceRoot}${path.sep}`)) {
        throw new Error(`System assets 投影目标不能等于或位于来源内：${targetRoot}`);
    }
    await assertEmptyTarget(targetRoot);
}

/** 目标可以不存在或是空的真实目录；其他形态一律拒绝。 */
async function assertEmptyTarget(targetRoot: string): Promise<void> {
    const targetStats = await lstat(targetRoot).catch((error: unknown) => {
        // 文件系统错误来自外部环境，进入此处前无法拥有更窄的类型。
        if (isMissingError(error)) {
            return null;
        }
        throw error;
    });
    if (targetStats === null) {
        return;
    }
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
        throw new Error(`System assets 投影目标必须是空的真实目录：${targetRoot}`);
    }
    if ((await readdir(targetRoot)).length > 0) {
        throw new Error(`System assets 投影目标不是空目录：${targetRoot}`);
    }
}

/** 检查普通文件是否存在；同名目录或链接属于结构错误。 */
async function regularFileExists(filePath: string): Promise<boolean> {
    const fileStats = await lstat(filePath).catch((error: unknown) => {
        // 文件系统错误来自外部环境，进入此处前无法拥有更窄的类型。
        if (isMissingError(error)) {
            return null;
        }
        throw error;
    });
    if (fileStats === null) {
        return false;
    }
    if (!fileStats.isFile()) {
        throw new Error(`System assets manifest 必须是普通文件：${filePath}`);
    }
    return true;
}

/** 检查真实目录是否存在；同名文件或链接属于结构错误。 */
async function directoryExists(directory: string): Promise<boolean> {
    const directoryStats = await lstat(directory).catch((error: unknown) => {
        // 文件系统错误来自外部环境，进入此处前无法拥有更窄的类型。
        if (isMissingError(error)) {
            return null;
        }
        throw error;
    });
    if (directoryStats === null) {
        return false;
    }
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        throw new Error(`System assets .compiled 必须是真实目录：${directory}`);
    }
    return true;
}

/** 比较 current 期望集合和磁盘实际集合，任何缺失或 orphan 都 fail closed。 */
function assertArtifactSet(owner: "Profile" | "Variable", expected: string[], actual: string[]): void {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((item) => !actualSet.has(item));
    const unexpected = actual.filter((item) => !expectedSet.has(item));
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(
            `${owner} manifest current 与磁盘 artifact 不一致`
            + `；缺失：${missing.join(", ") || "无"}`
            + `；orphan：${unexpected.join(", ") || "无"}`,
        );
    }
}

/** 判断路径中是否出现指定的相邻目录段。 */
function containsPair(segments: string[], left: string, right: string): boolean {
    return segments.some((segment, index) => segment === left && segments[index + 1] === right);
}

/** 排除 VitePress 的生成目录，保留 config、locale 导航与 theme 源码。 */
function isVitePressGenerated(segments: string[]): boolean {
    return segments.some((segment, index) =>
        segment === "vitepress"
        && segments[index + 1] === ".vitepress"
        && VITEPRESS_GENERATED_SEGMENTS.has(segments[index + 2] ?? ""));
}

/** localeCompare 的稳定路径排序器。 */
function comparePaths(left: string, right: string): number {
    return left.localeCompare(right);
}

/** 外部文件系统错误只在明确 ENOENT 时收窄为“缺失”。 */
function isMissingError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
