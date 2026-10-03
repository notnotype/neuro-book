import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {availableParallelism} from "node:os";
import {setTimeout as sleep} from "node:timers/promises";
import {build, type Metafile} from "esbuild";
import {lock as lockFile, type LockOptions} from "proper-lockfile";
import {normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import type {AgentProfile, AgentProfileDefinition} from "nbook/server/agent/profiles/types";
import {generateVariableTypes, VARIABLE_TYPES_FILE_NAME, type VariableTypeGenerationDiagnostic} from "nbook/server/agent/variables/generated-types";
import {appLogger} from "nbook/server/app-logs/logger";
import {importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";
import {runtimeArtifactBundlePlugin} from "nbook/server/utils/runtime-artifact-bundle-plugin";
import {
    assertRuntimeArtifactAuthoringMetafile,
    validateRuntimeArtifactAuthoring,
} from "nbook/server/utils/runtime-artifact-authoring-interface";
import {
    normalizeRuntimeArtifactPath,
    resolveRuntimeArtifactCompilerContext,
    resolveRuntimeArtifactPath,
    type RuntimeArtifactCompilerContext,
    type RuntimeArtifactPathContext,
    type RuntimeArtifactPathMapping,
} from "nbook/server/utils/runtime-artifact-compiler-context";

// Profile artifact 从 v11 起只保存 authoring 声明；宿主在 import 后统一 materialize/normalize。
export const PROFILE_ARTIFACT_COMPILER_VERSION = 11;
export const PROFILE_COMPILED_DIR_NAME = ".compiled";
export const PROFILE_COMPILED_ARTIFACTS_DIR_NAME = "artifacts";
export const PROFILE_COMPILED_MANIFEST_FILE = "manifest.json";
export const PROFILE_COMPILED_PUBLISH_LOCK = ".publish.lock";
export const PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 未引用 artifact 的最小安全年龄。硬预算不得突破这条地板。
 *
 * 它保护的是**在途读者**：进程 A 已读到 manifest v1、正准备 import 其中的 artifact 时，
 * 进程 B 发布 v2 并触发预算回收。没有这条地板，A 会拿到 ENOENT 变成 compiled_load_failed。
 */
export const PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS = 10 * 60 * 1000;
/** Product 镜像不得携带未被 current manifest 引用的 artifact。 */
export const PROFILE_COMPILED_PRODUCT_ORPHAN_BUDGET_BYTES = 0;
/** 仓库内置 Source 允许保留的未引用 artifact 字节预算。 */
export const PROFILE_COMPILED_BUILTIN_SOURCE_ORPHAN_BUDGET_BYTES = 128 * 1024 * 1024;
/** 用户 Profile 允许保留的未引用 artifact 字节预算。 */
export const PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES = 512 * 1024 * 1024;
/** 普通运行默认使用用户 Profile 预算。current 引用不计入，永不驱逐。 */
export const PROFILE_COMPILED_ORPHAN_BUDGET_BYTES = PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES;
export const PROFILE_ARTIFACT_STAGING_DIR_NAME = "profile-artifact-build";
export const PROFILE_ARTIFACT_STAGING_OWNER_FILE = ".nbook-staging-owner.json";
export const PROFILE_ARTIFACT_STAGING_LEASE_LOCK = ".nbook-staging-lease.lock";
export const PROFILE_ARTIFACT_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PROFILE_ARTIFACT_STAGING_OWNER = "nbook.profile-artifact-compiler";
export const PROFILE_ARTIFACT_STAGING_OWNER_SCHEMA = 1;
const PROFILE_ARTIFACT_STAGING_HEARTBEAT_MS = 10_000;
const PROFILE_COMPILE_MAX_FILE_CONCURRENCY = 4;
const PROFILE_DEPENDENCY_HASH_CONCURRENCY = 16;

/** artifact orphan 预算按产物所属生命周期显式选择，避免靠路径猜测。 */
export type ProfileArtifactOrphanBudgetPolicy = "product" | "builtin_source" | "user";

/** 返回指定生命周期允许保留的 orphan 字节数。 */
export function profileArtifactOrphanBudget(policy: ProfileArtifactOrphanBudgetPolicy): number {
    if (policy === "product") {
        return PROFILE_COMPILED_PRODUCT_ORPHAN_BUDGET_BYTES;
    }
    if (policy === "builtin_source") {
        return PROFILE_COMPILED_BUILTIN_SOURCE_ORPHAN_BUDGET_BYTES;
    }
    return PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES;
}
export const SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL = "assets/workspace/.nbook/agent/profiles";

export type ProfileArtifactDependency = {
    path: string;
    sha256: string;
    bytes: number;
};

/** artifact 回收的触发入口。 */
export type ProfileArtifactGcTrigger = "publish" | "sweep";

/** 一次内容寻址 artifact 回收的完整账目。current 引用永不计入可驱逐字节。 */
export type ProfileArtifactGcReport = {
    trigger: ProfileArtifactGcTrigger;
    /** current manifest 引用的 artifact 数与字节数。 */
    currentFiles: number;
    currentBytes: number;
    /** 回收前未被 current manifest 引用的 artifact 数与字节数。 */
    orphanFiles: number;
    orphanBytes: number;
    /** 本次实际删除的数量与字节数。 */
    deletedFiles: number;
    deletedBytes: number;
    /** rm 失败的文件数（Windows 文件占用等）；不影响 release 主结果。 */
    failedFiles: number;
    /** 因未过最小安全年龄而拒绝驱逐的字节数。 */
    protectedBytes: number;
    /** 回收后仍超预算的字节数；>0 表示地板挡住了预算，需要关注写入速度。 */
    overBudgetBytes: number;
    /** 目录内最大的单个 artifact，用于定位 bundle 膨胀；目录为空时为 null。 */
    largestArtifact: {fileName: string; bytes: number} | null;
    /** true 表示命中退化状态守卫（loaded entry 为 0），本次跳过了预算回收。 */
    skippedDegenerate: boolean;
};

/** staging owner marker 的稳定磁盘格式。 */
export type ProfileArtifactStagingOwner = {
    schema: typeof PROFILE_ARTIFACT_STAGING_OWNER_SCHEMA;
    owner: typeof PROFILE_ARTIFACT_STAGING_OWNER;
    operationId: string;
    pid: number;
    startedAt: string;
};

/** 一次 staging 回收扫描的结果；未识别 owner 的目录始终保留。 */
export type ProfileArtifactStagingSweepReport = {
    scanned: number;
    fresh: number;
    active: number;
    deleted: number;
    malformed: number;
    failed: number;
};

export type ProfileArtifactDependencyMismatch = {
    path: string;
    expected: {sha256: string; bytes: number};
    /** null 表示依赖文件不存在或无法读取。 */
    actual: {sha256: string; bytes: number} | null;
};

export type ProfileArtifactValidation = {
    fresh: boolean;
    reason?: "source_changed" | "dependency_changed" | "artifact_missing" | "artifact_changed" | "type_artifact_missing" | "type_artifact_changed";
    /** 仅 dependency_changed 时存在，指出第一个失配依赖。 */
    dependency?: ProfileArtifactDependencyMismatch;
};

export type ProfileArtifactManifestItem = {
    status?: "loaded";
    fileName: string;
    profileKey: string;
    sourceSha256: string;
    sourceBytes: number;
    dependencyHash: string;
    artifactFileName: string;
    artifactSha256: string;
    artifactBytes: number;
    typeFileName?: string;
    typeSha256?: string;
    typeBytes?: number;
    typeDiagnostics?: VariableTypeGenerationDiagnostic[];
    registeredVariablePaths?: string[];
    dependencies: ProfileArtifactDependency[];
};

export type ProfileArtifactCompileFailure = {
    code: "compile_failed";
    message: string;
    stack?: string;
};

export type ProfileArtifactManifestFailureItem = {
    status: "compile_failed";
    fileName: string;
    profileKey: string;
    sourceSha256: string;
    sourceBytes: number;
    issues: ProfileArtifactCompileFailure[];
};

export type ProfileArtifactManifestEntry = ProfileArtifactManifestItem | ProfileArtifactManifestFailureItem;

export type ProfileArtifactManifest = {
    compilerVersion: typeof PROFILE_ARTIFACT_COMPILER_VERSION;
    generatedAt: string;
    profilesRoot: string;
    /** 包含 loaded 与 compile_failed 的完整发布账本。 */
    entries: ProfileArtifactManifestEntry[];
    /** 仅包含 loaded entry 的数组视图，供运行时 artifact 读取与旧调用点逐步迁移。 */
    profiles: ProfileArtifactManifestItem[];
};
export type ProfileArtifactPathContext = RuntimeArtifactPathContext & Readonly<{
    rootLabel: string;
}>;

export type ProfileArtifactPathContextResolver = (
    profileRoot: string,
    rootLabel: string,
) => Promise<ProfileArtifactPathContext>;

export function createProfileArtifactPathContext(
    profileRoot: string,
    rootLabel: string,
    compilerContext: RuntimeArtifactCompilerContext,
): ProfileArtifactPathContext {
    const normalizedRootLabel = rootLabel.replace(/[\\/]+/gu, "/").replace(/^\/+|\/+$/gu, "");
    const profileRootPath = resolve(profileRoot);
    const compilerOutputRoot = resolve(compilerContext.outputRoot);
    const outputRelative = relative(compilerOutputRoot, profileRootPath);
    const profileInsideCompilerOutput = outputRelative === ""
        || (outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`) && !isAbsolute(outputRelative));
    const profileMapping: RuntimeArtifactPathMapping = {
        physicalRoot: profileRootPath,
        logicalRoot: normalizedRootLabel,
    };
    const mappings = profileInsideCompilerOutput
        ? compilerContext.sourcePathMappings
        : [profileMapping, ...compilerContext.sourcePathMappings];
    return Object.freeze({
        compilerContext,
        mappings: Object.freeze(mappings),
        rootLabel: normalizedRootLabel,
    });
}

/** 用调用方显式指定的 compiler root 建立稳定 Profile artifact 路径上下文。 */
export async function resolveProfileArtifactPathContext(
    profileRoot: string,
    rootLabel: string,
    compilerRoot: string,
): Promise<ProfileArtifactPathContext> {
    const compilerContext = await resolveRuntimeArtifactCompilerContext(resolve(compilerRoot));
    return createProfileArtifactPathContext(profileRoot, rootLabel, compilerContext);
}

/** 缓存一次显式 compiler root 的解析，供 Catalog 的 install/project 两层共用。 */
export function createProfileArtifactPathContextResolver(compilerRoot: string): ProfileArtifactPathContextResolver {
    const compilerContext = resolveRuntimeArtifactCompilerContext(resolve(compilerRoot));
    return async (profileRoot: string, rootLabel: string): Promise<ProfileArtifactPathContext> =>
        createProfileArtifactPathContext(profileRoot, rootLabel, await compilerContext);
}

export type CompileProfileArtifactsOptions = {
    profileRoot: string;
    artifactPathContext: ProfileArtifactPathContext;
    fileName?: string;
    skipFresh?: boolean;
    /** Product 可复现构建传入固定时间；普通 Source/User 编译为空并记录真实发布时间。 */
    manifestGeneratedAt?: string;
    /** Product 内置系统 assets 使用 forbid；新鲜时零写入，过期时要求重建 Product。 */
    writePolicy?: "allow" | "forbid";
    /** 非空时覆盖默认的 profile root 同级 Agent staging 根。 */
    stagingRoot?: string;
    /** artifact orphan 所属生命周期；默认 user，Product/内置 Source 构建必须显式传入。 */
    orphanBudgetPolicy?: ProfileArtifactOrphanBudgetPolicy;
    /** 为空时按 CLI/preflight disk-only 发布；HTTP runtime 可传 in-process 发布策略。 */
    publish?: ProfileReleasePublishOptions;
};

export type CompileProfileArtifactsResult = {
    manifest: ProfileArtifactManifest;
    compiledDir: string;
    manifestPath: string;
    compiled: ProfileArtifactManifestItem[];
    /** 本次回收账目；只读 root 或预检判定无孤儿时为空。 */
    gc?: ProfileArtifactGcReport | null;
};

export type StagedProfileArtifactsResult = CompileProfileArtifactsResult & {
    profileRoot: string;
    buildCompiledDir: string;
    sourceFilesAtStart: ProfileArtifactSourceFile[];
    /** false 表示所有 artifact 与 manifest 已新鲜，调用方不得获取发布锁或改写磁盘。 */
    publishRequired: boolean;
};

export type ProfileArtifactSourceFile = {
    fileName: string;
    absolutePath: string;
};

export type StagedProfileArtifactEntryResult = {
    profileRoot: string;
    buildCompiledDir: string;
    entry: ProfileArtifactManifestEntry;
    /** 为空表示该 profile 编译失败，entry 中会记录 compile_failed。 */
    compiled?: ProfileArtifactManifestItem;
};

export type ProfileReleasePublishMode = "disk_only" | "in_process";

export type ProfileReleaseRegistrySink = {
    publishProfileRelease(profileRoot: string, manifest: ProfileArtifactManifest): Promise<void> | void;
};

export type ProfileReleasePublishOptions = {
    mode: ProfileReleasePublishMode;
    registry?: ProfileReleaseRegistrySink;
};

export type ProfileReleaseOperation = "full" | "single" | "batch";

/**
 * release 已经写入磁盘，但 server 进程内 Registry 翻转失败。
 * 调用方不能再回滚与 manifest 匹配的 source，只能把请求作为强一致失败返回。
 */
export class ProfileReleaseCommittedButRegistryFailedError extends Error {
    readonly profileRoot: string;
    readonly manifest: ProfileArtifactManifest;
    readonly operation: ProfileReleaseOperation;
    override readonly cause: unknown;

    constructor(input: {
        profileRoot: string;
        manifest: ProfileArtifactManifest;
        operation: ProfileReleaseOperation;
        cause: unknown;
    }) {
        const message = `profile release 已写入磁盘，但 Registry 翻转失败：${input.profileRoot}`;
        super(message);
        this.name = "ProfileReleaseCommittedButRegistryFailedError";
        this.profileRoot = input.profileRoot;
        this.manifest = input.manifest;
        this.operation = input.operation;
        this.cause = input.cause;
    }
}

/**
 * 判断错误是否表示 release 已落盘但 Registry 未完成翻转。
 */
export function isProfileReleaseCommittedButRegistryFailedError(error: unknown): error is ProfileReleaseCommittedButRegistryFailedError {
    return error instanceof ProfileReleaseCommittedButRegistryFailedError;
}

/**
 * full replacement 发布前发现源码文件集合变化。
 */
export class ProfileArtifactSourceFileSetChangedError extends Error {
    constructor(readonly profileRoot: string) {
        super(`profile full compile 期间源码文件集合发生变化，已放弃发布：${profileRoot}`);
        this.name = "ProfileArtifactSourceFileSetChangedError";
    }
}

/**
 * full replacement 发布前发现同名源码内容变化。
 */
export class ProfileArtifactSourceContentChangedError extends Error {
    constructor(readonly profileRoot: string, readonly fileName: string) {
        super(`profile full compile 期间源码内容发生变化，已放弃发布：${fileName}`);
        this.name = "ProfileArtifactSourceContentChangedError";
    }
}

type ProfileFileEntry = ProfileArtifactSourceFile;

type ProfileCompileFileResult = {
    entry: ProfileArtifactManifestEntry;
    compiled?: ProfileArtifactManifestItem;
};

type ProfileArtifactStagingLease = {
    token: object;
    release: () => Promise<void>;
};

const artifactPromotionLocks = new Map<string, Promise<void>>();
const profileReleaseQueues = new Map<string, Promise<void>>();
const profileArtifactStagingLeases = new Map<string, ProfileArtifactStagingLease>();

/**
 * 编译开始前源码已消失。Coordinator 应把这类情况视为 generation 变化并重排，
 * 而不是发布 compile_failed 账本。
 */
export class ProfileArtifactSourceMissingError extends Error {}

/**
 * `.compiled` 指针持久化层。只有它负责把 staging artifact 安装到真实 root，
 * 并用 advisory lock 包住 manifest 原子替换。
 */
export class ProfileReleaseStore {
    constructor(
        readonly profileRoot: string,
        readonly artifactPathContext: ProfileArtifactPathContext,
        readonly orphanBudgetBytes: number = PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES,
    ) {}

    /** 读取当前 profile release。 */
    async read(): Promise<ProfileArtifactManifest> {
        return readProfileArtifactManifest(this.profileRoot, this.artifactPathContext);
    }

    /** 将 staging 中的不可变 artifact 安装到真实 `.compiled`。 */
    async publishStaged(buildCompiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
        await commitCompiledArtifacts(
            buildCompiledDir,
            join(resolve(this.profileRoot), PROFILE_COMPILED_DIR_NAME),
            manifest,
            this.orphanBudgetBytes,
            this.artifactPathContext,
        );
    }

    /** 将单个 profile entry 合并进当前 manifest。 */
    async publishStagedEntry(buildCompiledDir: string, entry: ProfileArtifactManifestEntry): Promise<ProfileArtifactManifest> {
        return commitCompiledArtifactEntry(
            buildCompiledDir,
            join(resolve(this.profileRoot), PROFILE_COMPILED_DIR_NAME),
            entry,
            this.orphanBudgetBytes,
            this.artifactPathContext,
        );
    }

    /** 将一批 profile entries 合并进当前 manifest。 */
    async publishStagedEntries(buildCompiledDir: string, entries: ProfileArtifactManifestEntry[]): Promise<ProfileArtifactManifest> {
        return commitCompiledArtifactEntries(
            buildCompiledDir,
            join(resolve(this.profileRoot), PROFILE_COMPILED_DIR_NAME),
            entries,
            this.orphanBudgetBytes,
            this.artifactPathContext,
        );
    }
}


/**
 * profile release 的唯一发布入口。CLI/preflight 使用 disk-only 模式；
 * HTTP runtime 后续接入 Registry 时使用 in-process 模式同步翻内存。
 */
export class ProfileReleasePublisher {
    private readonly store: ProfileReleaseStore;

    constructor(readonly input: {
        profileRoot: string;
        artifactPathContext: ProfileArtifactPathContext;
        orphanBudgetPolicy?: ProfileArtifactOrphanBudgetPolicy;
    } & ProfileReleasePublishOptions) {
        if (input.mode === "in_process" && !input.registry) {
            throw new Error("in_process profile release 必须提供 Registry sink。");
        }
        this.store = new ProfileReleaseStore(
            input.profileRoot,
            input.artifactPathContext,
            profileArtifactOrphanBudget(input.orphanBudgetPolicy ?? "user"),
        );
    }

    /** 发布 staging 编译结果。 */
    async publishStaged(buildCompiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
        await withProfileReleaseQueue(this.input.profileRoot, async () => {
            await this.store.publishStaged(buildCompiledDir, manifest);
            await this.publishRegistry(manifest, "full");
        });
    }

    /** 发布单文件 staging entry。 */
    async publishStagedEntry(buildCompiledDir: string, entry: ProfileArtifactManifestEntry): Promise<ProfileArtifactManifest> {
        return withProfileReleaseQueue(this.input.profileRoot, async () => {
            const manifest = await this.store.publishStagedEntry(buildCompiledDir, entry);
            await this.publishRegistry(manifest, "single");
            return manifest;
        });
    }

    /** 发布一批 staging entries。 */
    async publishStagedEntries(buildCompiledDir: string, entries: ProfileArtifactManifestEntry[]): Promise<ProfileArtifactManifest> {
        return withProfileReleaseQueue(this.input.profileRoot, async () => {
            const manifest = await this.store.publishStagedEntries(buildCompiledDir, entries);
            await this.publishRegistry(manifest, "batch");
            return manifest;
        });
    }

    /** 磁盘 release 已提交后翻转 Registry；失败时只允许抛 committed error。 */
    private async publishRegistry(manifest: ProfileArtifactManifest, operation: ProfileReleaseOperation): Promise<void> {
        if (this.input.mode !== "in_process") {
            return;
        }
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                await this.input.registry!.publishProfileRelease(this.input.profileRoot, manifest);
                return;
            } catch (error) {
                lastError = error;
                if (attempt === 0) {
                    await sleep(50);
                }
            }
        }
        void appLogger.warn("agent.profileRelease.registryPublishFailedAfterDiskCommit", {
            profileRoot: this.input.profileRoot,
            operation,
            error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        throw new ProfileReleaseCommittedButRegistryFailedError({
            profileRoot: this.input.profileRoot,
            manifest,
            operation,
            cause: lastError,
        });
    }
}
/** 编译 profile root 下的 profile 源码，生成 runtime 可加载的 `.compiled` 产物。 */
export async function compileProfileArtifacts(options: CompileProfileArtifactsOptions): Promise<CompileProfileArtifactsResult> {
    const staged = await stageProfileArtifacts(options);
    try {
        if (!options.fileName) {
            await assertProfileFullReleaseFresh(staged.profileRoot, staged.sourceFilesAtStart, staged.manifest.entries);
        }
        if (!staged.publishRequired) {
            const gc = options.writePolicy === "forbid"
                ? undefined
                : await sweepProfileArtifactBudget(
                    staged.profileRoot,
                    options.artifactPathContext,
                    profileArtifactOrphanBudget(options.orphanBudgetPolicy ?? "user"),
                );
            return {
                manifest: staged.manifest,
                compiledDir: staged.compiledDir,
                manifestPath: staged.manifestPath,
                compiled: staged.compiled,
                gc,
            };
        }
        await new ProfileReleasePublisher({
            profileRoot: staged.profileRoot,
            artifactPathContext: options.artifactPathContext,
            mode: options.publish?.mode ?? "disk_only",
            registry: options.publish?.registry,
            orphanBudgetPolicy: options.orphanBudgetPolicy,
        }).publishStaged(staged.buildCompiledDir, staged.manifest);
        return {
            manifest: staged.manifest,
            compiledDir: staged.compiledDir,
            manifestPath: staged.manifestPath,
            compiled: staged.compiled,
        };
    } finally {
        await cleanupProfileArtifactStaging(staged.buildCompiledDir);
    }
}
/**
 * 只生成 staging artifact 与下一版 manifest，不发布到真实 `.compiled`。
 * HTTP runtime worker 使用该函数把发布权交回 server 主线程。
 */
export async function stageProfileArtifacts(options: CompileProfileArtifactsOptions): Promise<StagedProfileArtifactsResult> {
    const profileRoot = resolve(options.profileRoot);
    const pathContext = options.artifactPathContext;
    const compiledDir = join(profileRoot, PROFILE_COMPILED_DIR_NAME);
    const fullCompile = !options.fileName;
    const stagingRoot = resolve(options.stagingRoot ?? join(dirname(profileRoot), ".staging"));
    await sweepProfileArtifactStaging(stagingRoot);
    const operationId = randomUUID();
    const buildCompiledDir = join(stagingRoot, PROFILE_ARTIFACT_STAGING_DIR_NAME, operationId);
    let stagingReady: Promise<void> | undefined;
    const existingManifest = await readProfileArtifactManifest(profileRoot, pathContext);
    const targetFiles = options.fileName
        ? [resolveProfileFile(profileRoot, options.fileName)]
        : await findProfileFiles(profileRoot);
    const manifestEntries: ProfileArtifactManifestEntry[] = [];
    const compiled: ProfileArtifactManifestItem[] = [];

    try {
        const compileResults = await mapConcurrent(targetFiles, profileCompileConcurrency(targetFiles.length), async (file): Promise<ProfileCompileFileResult> => {
            const existingItem = existingManifest.profiles.find((item) => item.fileName === file.fileName);
            let validation: ProfileArtifactValidation | undefined;
            if ((options.skipFresh || options.writePolicy === "forbid") && existingItem) {
                validation = await validateProfileArtifact(profileRoot, existingItem, pathContext, {requireTypeArtifact: true});
                if (validation.fresh) return {entry: existingItem};
            }
            if (options.writePolicy === "forbid") {
                const detail = validation?.dependency
                    ? `${validation.reason}: ${validation.dependency.path}`
                    : validation?.reason ?? "manifest_missing";
                throw new Error(`Product 内置 profile artifact 已过期或缺失：${file.fileName}（${detail}）。请重新构建或安装与源码匹配的 Product。`);
            }
            try {
                stagingReady ??= createProfileArtifactStaging(buildCompiledDir, operationId);
                await stagingReady;
                const item = await compileProfileFile(profileRoot, buildCompiledDir, file, pathContext);
                return {entry: item, compiled: item};
            } catch (error) {
                return {entry: await compileFailureEntry(file, error)};
            }
        });
        for (const result of compileResults) {
            manifestEntries.push(result.entry);
            if (result.compiled) {
                compiled.push(result.compiled);
            }
        }

        const nextEntries = (fullCompile
            ? manifestEntries
            : [
                ...existingManifest.entries.filter((item) => !manifestEntries.some((next) => next.fileName === item.fileName)),
                ...manifestEntries,
            ]).sort((left, right) => left.fileName.localeCompare(right.fileName));
        const nextProfiles = nextEntries.filter(isLoadedManifestEntry);
        const manifest: ProfileArtifactManifest = {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: profilesEqual(existingManifest.entries, nextEntries)
                ? existingManifest.generatedAt
                : options.manifestGeneratedAt ?? new Date().toISOString(),
            profilesRoot: pathContext.rootLabel,
            entries: nextEntries,
            profiles: nextProfiles,
        };
        const publishRequired = compiled.length > 0
            || !profilesEqual(existingManifest.entries, nextEntries)
            || existingManifest.profilesRoot !== manifest.profilesRoot;
        if (publishRequired && options.writePolicy === "forbid") {
            throw new Error("Product 内置 profile manifest 与源码不匹配。请重新构建或安装与源码匹配的 Product。");
        }
        const manifestPath = profileArtifactManifestPath(profileRoot);
        return {
            manifest,
            compiledDir,
            manifestPath,
            compiled,
            profileRoot,
            buildCompiledDir,
            sourceFilesAtStart: targetFiles,
            publishRequired,
        };
    } catch (error) {
        await cleanupProfileArtifactStaging(buildCompiledDir);
        throw error;
    }
}

/**
 * 判断 full compile 期间 profile 源文件集合是否发生变化。
 */
export async function profileSourceFileSetChangedSinceCompile(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[]): Promise<boolean> {
    const started = profileSourceFileNames(filesAtStart);
    const current = profileSourceFileNames(await listProfileArtifactSourceFiles(profileRoot));
    if (started.length !== current.length) {
        return true;
    }
    return started.some((fileName, index) => fileName !== current[index]);
}

/**
 * full replacement 发布前统一执行 source file set gate。
 */
export async function assertProfileSourceFileSetUnchanged(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[]): Promise<void> {
    if (await profileSourceFileSetChangedSinceCompile(profileRoot, filesAtStart)) {
        throw new ProfileArtifactSourceFileSetChangedError(profileRoot);
    }
}

/**
 * full replacement 发布前统一执行 freshness gate：源码集合和每个 entry 对应源码内容都必须未变化。
 */
export async function assertProfileFullReleaseFresh(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[], entries: ProfileArtifactManifestEntry[]): Promise<void> {
    await assertProfileSourceFileSetUnchanged(profileRoot, filesAtStart);
    for (const entry of entries) {
        const current = await hashFile(join(profileRoot, ...entry.fileName.split("/"))).catch(() => null);
        if (!current || current.sha256 !== entry.sourceSha256 || current.bytes !== entry.sourceBytes) {
            throw new ProfileArtifactSourceContentChangedError(profileRoot, entry.fileName);
        }
    }
}

/**
 * 判断 full replacement 发布前源码集合或同名源码内容是否已经变化。
 */
export async function profileFullReleaseChangedSinceCompile(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[], entries: ProfileArtifactManifestEntry[]): Promise<boolean> {
    try {
        await assertProfileFullReleaseFresh(profileRoot, filesAtStart, entries);
        return false;
    } catch (error) {
        if (error instanceof ProfileArtifactSourceFileSetChangedError || error instanceof ProfileArtifactSourceContentChangedError) {
            return true;
        }
        throw error;
    }
}

/**
 * 生成稳定排序的 profile source fileName 视图。
 */
function profileSourceFileNames(files: ProfileArtifactSourceFile[]): string[] {
    return files.map((file) => file.fileName).sort((left, right) => left.localeCompare(right));
}

/**
 * 为一个 UUID staging 建立 owner marker，并持有带 heartbeat 的 proper-lockfile lease。
 * lease 一直保持到显式 cleanup；进程崩溃后 lock heartbeat 停止，下一次运行才可回收。
 */
async function createProfileArtifactStaging(buildCompiledDir: string, operationId: string): Promise<void> {
    const resolvedDir = resolve(buildCompiledDir);
    let ownsDirectory = false;
    const token = {};
    try {
        await mkdir(dirname(resolvedDir), {recursive: true});
        await mkdir(resolvedDir);
        ownsDirectory = true;
        const marker: ProfileArtifactStagingOwner = {
            schema: PROFILE_ARTIFACT_STAGING_OWNER_SCHEMA,
            owner: PROFILE_ARTIFACT_STAGING_OWNER,
            operationId,
            pid: process.pid,
            startedAt: new Date().toISOString(),
        };
        await writeFile(
            join(resolvedDir, PROFILE_ARTIFACT_STAGING_OWNER_FILE),
            `${JSON.stringify(marker, null, 2)}\n`,
            {encoding: "utf8", flag: "wx"},
        );
        const release = await lockFile(resolvedDir, profileArtifactStagingLockOptions(resolvedDir, (error) => {
            const lease = profileArtifactStagingLeases.get(resolvedDir);
            if (lease?.token === token) {
                profileArtifactStagingLeases.delete(resolvedDir);
            }
            // 其它线程沿既有合同直接递归删除 staging 时，锁随目录消失属于正常清理。
            if (existsSync(resolvedDir)) {
                void appLogger.warn("agent.profileArtifact.stagingLeaseCompromised", {
                    buildCompiledDir: resolvedDir,
                    error: error.message,
                });
            }
        }));
        profileArtifactStagingLeases.set(resolvedDir, {token, release});
    } catch (error) {
        if (ownsDirectory) {
            await rm(resolvedDir, {recursive: true, force: true}).catch(() => undefined);
        }
        throw error;
    }
}

/**
 * 回收同 owner、超过 24 小时且无法证明活跃的 profile artifact staging。
 * 未知或损坏 marker 一律保留；只有成功取得 lease 并二次确认 marker 后才删除。
 */
export async function sweepProfileArtifactStaging(
    stagingRoot: string,
    now: number = Date.now(),
): Promise<ProfileArtifactStagingSweepReport> {
    const ownerRoot = join(resolve(stagingRoot), PROFILE_ARTIFACT_STAGING_DIR_NAME);
    const report: ProfileArtifactStagingSweepReport = {
        scanned: 0,
        fresh: 0,
        active: 0,
        deleted: 0,
        malformed: 0,
        failed: 0,
    };
    const entries = await readdir(ownerRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory()) {
            continue;
        }
        report.scanned += 1;
        const candidate = join(ownerRoot, entry.name);
        const marker = await readProfileArtifactStagingOwner(candidate);
        if (!marker || marker.operationId !== entry.name) {
            report.malformed += 1;
            continue;
        }
        if (!profileArtifactStagingExpired(marker, now)) {
            report.fresh += 1;
            continue;
        }

        let release: (() => Promise<void>) | undefined;
        try {
            release = await lockFile(candidate, profileArtifactStagingLockOptions(candidate, (error) => {
                void appLogger.warn("agent.profileArtifact.stagingSweepLeaseCompromised", {
                    buildCompiledDir: candidate,
                    error: error.message,
                });
            }));
        } catch (error) {
            const code = profileArtifactErrorCode(error);
            if (code === "ELOCKED") {
                report.active += 1;
            } else if (code !== "ENOENT") {
                report.failed += 1;
                void appLogger.warn("agent.profileArtifact.stagingSweepFailed", {
                    buildCompiledDir: candidate,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            continue;
        }

        try {
            const confirmed = await readProfileArtifactStagingOwner(candidate);
            if (!confirmed || !profileArtifactStagingOwnersEqual(marker, confirmed)) {
                report.malformed += 1;
                continue;
            }
            if (!profileArtifactStagingExpired(confirmed, now)) {
                report.fresh += 1;
                continue;
            }
            await rm(candidate, {recursive: true, force: true});
            report.deleted += 1;
        } catch (error) {
            report.failed += 1;
            void appLogger.warn("agent.profileArtifact.stagingSweepFailed", {
                buildCompiledDir: candidate,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await release().catch((error) => {
                const code = profileArtifactErrorCode(error);
                if (code !== "ERELEASED" && code !== "ENOENT") {
                    void appLogger.warn("agent.profileArtifact.stagingSweepReleaseFailed", {
                        buildCompiledDir: candidate,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        }
    }
    if (report.deleted > 0 || report.malformed > 0 || report.failed > 0) {
        appLogger.debug("agent.profileArtifact.stagingSweep", {stagingRoot: resolve(stagingRoot), ...report});
    }
    return report;
}

/** 读取并严格校验 staging owner marker；外部磁盘 JSON 必须先作为 unknown 收窄。 */
async function readProfileArtifactStagingOwner(buildCompiledDir: string): Promise<ProfileArtifactStagingOwner | null> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(buildCompiledDir, PROFILE_ARTIFACT_STAGING_OWNER_FILE), "utf8"));
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        if (!("schema" in parsed) || parsed.schema !== PROFILE_ARTIFACT_STAGING_OWNER_SCHEMA
            || !("owner" in parsed) || parsed.owner !== PROFILE_ARTIFACT_STAGING_OWNER
            || !("operationId" in parsed) || typeof parsed.operationId !== "string" || !parsed.operationId
            || !("pid" in parsed) || typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0
            || !("startedAt" in parsed) || typeof parsed.startedAt !== "string" || !Number.isFinite(Date.parse(parsed.startedAt))) {
            return null;
        }
        return {
            schema: parsed.schema,
            owner: parsed.owner,
            operationId: parsed.operationId,
            pid: parsed.pid,
            startedAt: parsed.startedAt,
        };
    } catch {
        return null;
    }
}

/** 判断 owner marker 是否已经超过保守回收年龄。 */
function profileArtifactStagingExpired(marker: ProfileArtifactStagingOwner, now: number): boolean {
    return now - Date.parse(marker.startedAt) >= PROFILE_ARTIFACT_STAGING_MAX_AGE_MS;
}

/** 二次确认锁内读取的 marker 仍对应同一个 staging operation。 */
function profileArtifactStagingOwnersEqual(left: ProfileArtifactStagingOwner, right: ProfileArtifactStagingOwner): boolean {
    return left.schema === right.schema
        && left.owner === right.owner
        && left.operationId === right.operationId
        && left.pid === right.pid
        && left.startedAt === right.startedAt;
}

/** staging lease 与 sweeper 必须共享同一 stale/heartbeat 合同。 */
function profileArtifactStagingLockOptions(buildCompiledDir: string, onCompromised: (error: Error) => void): LockOptions {
    return {
        lockfilePath: join(buildCompiledDir, PROFILE_ARTIFACT_STAGING_LEASE_LOCK),
        realpath: false,
        stale: PROFILE_ARTIFACT_STAGING_MAX_AGE_MS,
        update: PROFILE_ARTIFACT_STAGING_HEARTBEAT_MS,
        retries: 0,
        onCompromised,
    };
}

/** 提取 Node/proper-lockfile 的稳定错误 code。 */
function profileArtifactErrorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
}

/**
 * 清理 profile artifact staging 目录。清理失败不改变 release 主结果。
 */
export async function cleanupProfileArtifactStaging(buildCompiledDir: string): Promise<void> {
    const resolvedDir = resolve(buildCompiledDir);
    const lease = profileArtifactStagingLeases.get(resolvedDir);
    if (lease) {
        profileArtifactStagingLeases.delete(resolvedDir);
        await lease.release().catch((error) => {
            const code = profileArtifactErrorCode(error);
            if (code !== "ERELEASED" && code !== "ENOENT") {
                void appLogger.warn("agent.profileArtifact.stagingLeaseReleaseFailed", {
                    buildCompiledDir: resolvedDir,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });
    }
    await rm(resolvedDir, {recursive: true, force: true}).catch((error) => {
        void appLogger.warn("agent.profileArtifact.stagingCleanupFailed", {
            buildCompiledDir: resolvedDir,
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

/**
 * 只编译一个 profile 源码到独立 staging，并返回单条 manifest entry。
 * worker 池全量编译使用它做 fan-out，主线程再 fan-in 成一次 manifest 发布。
 */
export async function stageProfileArtifactEntry(options: {
    profileRoot: string;
    fileName: string;
    artifactPathContext: ProfileArtifactPathContext;
    stagingRoot?: string;
}): Promise<StagedProfileArtifactEntryResult> {
    const profileRoot = resolve(options.profileRoot);
    const stagingRoot = resolve(options.stagingRoot ?? join(dirname(profileRoot), ".staging"));
    await sweepProfileArtifactStaging(stagingRoot);
    const operationId = randomUUID();
    const buildCompiledDir = join(stagingRoot, PROFILE_ARTIFACT_STAGING_DIR_NAME, operationId);
    await createProfileArtifactStaging(buildCompiledDir, operationId);
    try {
        const file = resolveProfileFile(profileRoot, options.fileName);
        try {
            const item = await compileProfileFile(profileRoot, buildCompiledDir, file, options.artifactPathContext);
            return {
                profileRoot,
                buildCompiledDir,
                entry: item,
                compiled: item,
            };
        } catch (error) {
            return {
                profileRoot,
                buildCompiledDir,
                entry: await compileFailureEntry(file, error),
            };
        }
    } catch (error) {
        await cleanupProfileArtifactStaging(buildCompiledDir);
        throw error;
    }
}

/**
 * 列出 profile root 下所有可编译 profile 源文件。
 */
export async function listProfileArtifactSourceFiles(profileRoot: string): Promise<ProfileArtifactSourceFile[]> {
    return findProfileFiles(resolve(profileRoot));
}

/**
 * 读取 `.compiled/manifest.json`。缺失或格式不匹配时返回空 manifest。
 */
export async function readProfileArtifactManifest(profileRoot: string, artifactPathContext: ProfileArtifactPathContext): Promise<ProfileArtifactManifest> {
    const root = resolve(profileRoot);
    try {
        const value = JSON.parse(await readFile(profileArtifactManifestPath(root), "utf8")) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return emptyArtifactManifest(artifactPathContext);
        }
        const record = value as Record<string, unknown>;
        if (record.compilerVersion !== PROFILE_ARTIFACT_COMPILER_VERSION) {
            return emptyArtifactManifest(artifactPathContext);
        }
        const rawEntries = normalizeManifestProfileEntries(record.profiles);
        if (!rawEntries) {
            return emptyArtifactManifest(artifactPathContext);
        }
        const entries = rawEntries.flatMap(parseManifestEntry);
        if (entries.length !== rawEntries.length) {
            return emptyArtifactManifest(artifactPathContext);
        }
        const profiles = entries.filter(isLoadedManifestEntry);
        return {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date(0).toISOString(),
            profilesRoot: typeof record.profilesRoot === "string" ? record.profilesRoot : artifactPathContext.rootLabel,
            entries,
            profiles,
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return emptyArtifactManifest(artifactPathContext);
        }
        throw error;
    }
}
function normalizeManifestProfileEntries(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
        return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return Object.values(value);
}
function parseManifestEntry(item: unknown): ProfileArtifactManifestEntry[] {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
    }
    const profile = item as Record<string, unknown>;
    if (profile.status === "compile_failed") {
        return parseFailedManifestEntry(profile);
    }
    return parseLoadedManifestEntry(profile);
}

function parseLoadedManifestEntry(profile: Record<string, unknown>): ProfileArtifactManifestItem[] {
    const artifactSha256 = typeof profile.artifactSha === "string" ? profile.artifactSha : profile.artifactSha256;
    const typeSha256 = typeof profile.typeSha === "string" ? profile.typeSha : profile.typeSha256;
    const artifactFileName = typeof profile.artifactFileName === "string"
        ? profile.artifactFileName
        : typeof artifactSha256 === "string"
            ? `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactSha256}.mjs`
            : undefined;
    const typeFileName = typeof profile.typeFileName === "string"
        ? profile.typeFileName
        : typeof artifactSha256 === "string" && typeof typeSha256 === "string"
            ? `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactSha256}.${VARIABLE_TYPES_FILE_NAME}`
            : undefined;
    if (
        (profile.status !== undefined && profile.status !== "loaded")
        || typeof profile.fileName !== "string"
        || typeof profile.profileKey !== "string"
        || typeof profile.sourceSha256 !== "string"
        || typeof profile.sourceBytes !== "number"
        || typeof profile.dependencyHash !== "string"
        || typeof artifactFileName !== "string"
        || typeof artifactSha256 !== "string"
        || typeof profile.artifactBytes !== "number"
        || !Array.isArray(profile.dependencies)
    ) {
        return [];
    }
    const dependencies = profile.dependencies.flatMap((dependency): ProfileArtifactDependency[] => {
        if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
            return [];
        }
        const value = dependency as Record<string, unknown>;
        return typeof value.path === "string" && typeof value.sha256 === "string" && typeof value.bytes === "number"
            ? [{path: value.path, sha256: value.sha256, bytes: value.bytes}]
            : [];
    });
    if (dependencies.length !== profile.dependencies.length) {
        return [];
    }
    return [{
        status: "loaded",
        fileName: profile.fileName,
        profileKey: profile.profileKey,
        sourceSha256: profile.sourceSha256,
        sourceBytes: profile.sourceBytes,
        dependencyHash: profile.dependencyHash,
        artifactFileName,
        artifactSha256,
        artifactBytes: profile.artifactBytes,
        typeFileName,
        typeSha256: typeof typeSha256 === "string" ? typeSha256 : undefined,
        typeBytes: typeof profile.typeBytes === "number" ? profile.typeBytes : undefined,
        typeDiagnostics: Array.isArray(profile.typeDiagnostics) ? profile.typeDiagnostics as VariableTypeGenerationDiagnostic[] : undefined,
        registeredVariablePaths: Array.isArray(profile.registeredVariablePaths) ? profile.registeredVariablePaths.filter((item): item is string => typeof item === "string") : undefined,
        dependencies,
    }];
}

function parseFailedManifestEntry(profile: Record<string, unknown>): ProfileArtifactManifestFailureItem[] {
    if (
        typeof profile.fileName !== "string"
        || typeof profile.profileKey !== "string"
        || typeof profile.sourceSha256 !== "string"
        || typeof profile.sourceBytes !== "number"
        || !Array.isArray(profile.issues)
    ) {
        return [];
    }
    const issues = profile.issues.flatMap((issue): ProfileArtifactCompileFailure[] => {
        if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
            return [];
        }
        const value = issue as Record<string, unknown>;
        return value.code === "compile_failed" && typeof value.message === "string"
            ? [{
                code: "compile_failed",
                message: value.message,
                stack: typeof value.stack === "string" ? value.stack : undefined,
            }]
            : [];
    });
    if (issues.length !== profile.issues.length) {
        return [];
    }
    return [{
        status: "compile_failed",
        fileName: profile.fileName,
        profileKey: profile.profileKey,
        sourceSha256: profile.sourceSha256,
        sourceBytes: profile.sourceBytes,
        issues,
    }];
}

function isLoadedManifestEntry(entry: ProfileArtifactManifestEntry): entry is ProfileArtifactManifestItem {
    return entry.status !== "compile_failed";
}

/**
 * 返回指定 profile root 下的 manifest 文件路径。
 */
export function profileArtifactManifestPath(profileRoot: string): string {
    return join(resolve(profileRoot), PROFILE_COMPILED_DIR_NAME, PROFILE_COMPILED_MANIFEST_FILE);
}

/**
 * 验证 manifest item 对应的源码、依赖和 artifact 是否仍然新鲜。
 */
export async function validateProfileArtifact(
    profileRoot: string,
    item: ProfileArtifactManifestItem,
    artifactPathContext: ProfileArtifactPathContext,
    options: {requireTypeArtifact?: boolean; checkDependencies?: boolean} = {},
): Promise<ProfileArtifactValidation> {
    const root = resolve(profileRoot);
    const sourcePath = join(root, ...item.fileName.split("/"));
    const sourceHash = await hashFile(sourcePath).catch(() => null);
    if (!sourceHash || sourceHash.sha256 !== item.sourceSha256 || sourceHash.bytes !== item.sourceBytes) {
        return {fresh: false, reason: "source_changed"};
    }
    const artifactPath = join(root, PROFILE_COMPILED_DIR_NAME, item.artifactFileName);
    if (!existsSync(artifactPath)) {
        return {fresh: false, reason: "artifact_missing"};
    }
    const artifactHash = await hashFile(artifactPath);
    if (artifactHash.sha256 !== item.artifactSha256 || artifactHash.bytes !== item.artifactBytes) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (await artifactHasNitroImportMetaShim(artifactPath)) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (artifactPathContext.compilerContext.productRuntime && !await artifactHasProductRequireShim(artifactPath)) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (!options.requireTypeArtifact) {
        if (options.checkDependencies === false) {
            return {fresh: true};
        }
        return validateProfileArtifactDependencies(item, artifactPathContext);
    }
    if (!item.typeFileName || !item.typeSha256 || item.typeBytes === undefined) {
        return {fresh: false, reason: "type_artifact_missing"};
    }
    const typeArtifactHash = await hashFile(join(root, PROFILE_COMPILED_DIR_NAME, item.typeFileName)).catch(() => null);
    if (!typeArtifactHash) {
        return {fresh: false, reason: "type_artifact_missing"};
    }
    if (typeArtifactHash.sha256 !== item.typeSha256 || typeArtifactHash.bytes !== item.typeBytes) {
        return {fresh: false, reason: "type_artifact_changed"};
    }
    if (options.checkDependencies === false) {
        return {fresh: true};
    }
    return validateProfileArtifactDependencies(item, artifactPathContext);
}

async function validateProfileArtifactDependencies(item: ProfileArtifactManifestItem, artifactPathContext: ProfileArtifactPathContext): Promise<{
    fresh: boolean;
    reason?: "dependency_changed";
    dependency?: ProfileArtifactDependencyMismatch;
}> {
    for (const dependency of item.dependencies) {
        const current = await hashFile(resolveRuntimeArtifactPath(dependency.path, artifactPathContext)).catch(() => null);
        if (!current || current.sha256 !== dependency.sha256 || current.bytes !== dependency.bytes) {
            return {
                fresh: false,
                reason: "dependency_changed",
                dependency: {
                    path: dependency.path,
                    expected: {sha256: dependency.sha256, bytes: dependency.bytes},
                    actual: current,
                },
            };
        }
    }
    return {fresh: true};
}

/**
 * 复制系统 artifact manifest entry 到另一个 profile root 时，重写入口源码依赖路径。
 * bundle artifact 本身不变，但用户覆盖的源码 hash 应绑定用户侧源码文件。
 */
export function rehomeProfileArtifactItem(item: ProfileArtifactManifestItem, input: {
    fromRootLabel: string;
    toRootLabel: string;
}): ProfileArtifactManifestItem {
    const fromPrefix = input.fromRootLabel.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    const toPrefix = input.toRootLabel.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    const sourcePrefixes = [fromPrefix, `.output/server/${fromPrefix}`];
    return {
        ...item,
        dependencies: item.dependencies.map((dependency) => {
            const dependencyPath = dependency.path.replace(/[\\/]+/g, "/");
            const sourcePrefix = sourcePrefixes.find((prefix) => dependencyPath === `${prefix}/${item.fileName}`);
            if (!sourcePrefix) {
                return dependency;
            }
            return {
                ...dependency,
                path: `${toPrefix}/${item.fileName}`,
            };
        }),
    };
}


/**
 * 计算文件 sha256 与大小。
 */
export async function hashFile(filePath: string): Promise<{sha256: string; bytes: number}> {
    const bytes = await readFile(filePath);
    return {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
    };
}

function profileCompileConcurrency(fileCount: number): number {
    if (fileCount <= 1) {
        return 1;
    }
    return Math.max(1, Math.min(fileCount, PROFILE_COMPILE_MAX_FILE_CONCURRENCY, Math.max(1, availableParallelism() - 2)));
}

async function mapConcurrent<TInput, TOutput>(items: TInput[], concurrency: number, task: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
    const results: TOutput[] = new Array<TOutput>(items.length);
    let nextIndex = 0;
    const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            const item = items[index]!;
            results[index] = await task(item);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * profile artifact 依赖门禁允许的 `server/` 源码前缀（posix、cwd 相对，与
 * `normalizeArtifactPath` 一致）。以 2026-07 切边后全量 builtin 依赖并集定稿；
 * 新 profile 合法需要新宿主模块时显式扩这里并过 review，而不是放松门禁。
 */
const PROFILE_ARTIFACT_ALLOWED_SERVER_PREFIXES = [
    "server/agent/messages/",
    "server/agent/profiles/",
    "server/agent/session/",
    "server/agent/plan-mode-directory.ts",
    "server/agent/test/",
    "server/agent/tools/types.ts",
    "server/agent/variables/registry.ts",
    "server/agent/variables/schema-resolver.ts",
    "server/agent/variables/types.ts",
    "server/agent/world-engine-tool-description.ts",
    "server/assets/",
    "server/low-code-form/",
    "server/runtime/",
    "server/utils/",
    "server/workspace-files/project-manifest.ts",
    "server/workspace-files/project-identity.ts",
    "server/workspace-files/project-domain-error.ts",
    "server/workspace-files/system-workspace-assets.ts",
    "server/workspace-files/workspace-runtime-root.ts",
] as const;

/**
 * 禁止进 artifact 的依赖族。带 `/` 结尾按 scope/前缀匹配，否则按包名全等。
 * 这些族要么是宿主实现（DB 驱动、Provider SDK），要么单包就有数 MiB；
 * 历史上单 artifact 曾因此膨胀到 27 MiB。
 */
const PROFILE_ARTIFACT_FORBIDDEN_PACKAGES = [
    "jsdom",
    "@mozilla/",
    "@prisma/",
    "@libsql/",
    "@earendil-works/",
    "@mistralai/",
    "openai",
    "@anthropic-ai/",
    "@google/",
    "@smithy/",
    "google-auth-library",
    "@opentelemetry/",
    "@notnotype/",
] as const;

/** 单个 profile artifact 的字节上限；切边后正常产物在 1-2 MiB 量级。 */
export const PROFILE_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 从 normalize 后的依赖路径解析 npm 包名；非 node_modules 路径返回 null。
 * 兼容 bun 布局 `node_modules/.bun/<pkg>@<ver>/...` 与常规 `node_modules/<pkg>/...`。
 */
function dependencyPackageName(dependencyPath: string): string | null {
    const bunMatch = dependencyPath.match(/(?:^|\/)node_modules\/\.bun\/([^/]+)\//u);
    if (bunMatch) {
        const segment = bunMatch[1]!;
        return segment.startsWith("@")
            ? `@${segment.slice(1).split("@")[0]!.replace(/\+/gu, "/")}`
            : segment.split("@")[0]!;
    }
    const plainMatch = dependencyPath.match(/(?:^|\/)node_modules\/(@[^/]+\/[^/]+|[^@.][^/]*)\//u);
    return plainMatch ? plainMatch[1]! : null;
}

/**
 * profile artifact 依赖门禁：宿主实现与重依赖族不允许被冻结进内容寻址 artifact。
 * 违规抛错，由调用方包装成 `compile_failed` entry；message 固定以「依赖门禁违规」
 * 开头并列出全部违规项，供测试与用户诊断。
 */
export function assertProfileArtifactDependencyGate(
    fileName: string,
    dependencies: readonly ProfileArtifactDependency[],
    artifactBytes: number,
): void {
    const violations: string[] = [];
    for (const dependency of dependencies) {
        const packageName = dependencyPackageName(dependency.path);
        if (packageName) {
            const forbidden = PROFILE_ARTIFACT_FORBIDDEN_PACKAGES.some((entry) => entry.endsWith("/") ? packageName.startsWith(entry) : packageName === entry);
            if (forbidden) {
                violations.push(`禁止依赖族：${packageName}（${dependency.path}）`);
            }
            continue;
        }
        if (dependency.path.startsWith("server/") && !PROFILE_ARTIFACT_ALLOWED_SERVER_PREFIXES.some((prefix) => dependency.path.startsWith(prefix))) {
            violations.push(`server/ 白名单之外的宿主源码：${dependency.path}`);
        }
    }
    if (artifactBytes > PROFILE_ARTIFACT_MAX_BYTES) {
        violations.push(`artifact ${artifactBytes} 字节超过上限 ${PROFILE_ARTIFACT_MAX_BYTES}`);
    }
    if (violations.length > 0) {
        throw new Error([
            `依赖门禁违规：profile ${fileName} 的编译产物携带了不允许进 artifact 的依赖。`,
            "profile 只能依赖 DSL 表面（profile-dsl、messages、纯路径模块）；宿主能力请经 ProfilePrepareContext.runtime 注入。",
            ...violations.map((violation) => `- ${violation}`),
        ].join("\n"));
    }
}

async function compileFailureEntry(file: ProfileFileEntry, error: unknown): Promise<ProfileArtifactManifestFailureItem> {
    const sourceHash = await hashFile(file.absolutePath);
    const message = error instanceof Error ? error.message : String(error);
    return {
        status: "compile_failed",
        fileName: file.fileName,
        profileKey: await profileKeyFromSource(file),
        sourceSha256: sourceHash.sha256,
        sourceBytes: sourceHash.bytes,
        issues: [{
            code: "compile_failed",
            message,
            stack: process.env.NODE_ENV === "production" || !(error instanceof Error) ? undefined : error.stack,
        }],
    };
}

async function profileKeyFromSource(file: ProfileFileEntry): Promise<string> {
    const source = await readFile(file.absolutePath, "utf8").catch(() => "");
    const match = source.match(/\bkey\s*:\s*["'`]([^"'`]+)["'`]/u);
    return match?.[1] ?? profileKeyFromFileName(file.fileName);
}

function profileKeyFromFileName(fileName: string): string {
    return basename(fileName).replace(/\.profile\.(tsx|ts|mjs|js)$/u, "");
}
async function compileProfileFile(profileRoot: string, compiledDir: string, file: ProfileFileEntry, artifactPathContext: ProfileArtifactPathContext): Promise<ProfileArtifactManifestItem> {
    const sourceHash = await hashFile(file.absolutePath);
    const authoringGraph = await validateRuntimeArtifactAuthoring({
        kind: "profile",
        root: profileRoot,
        entry: file.absolutePath,
        allowedSdkSpecifiers: ["nbook/profile-sdk", "nbook/profile-sdk/writing"],
    });
    const temporaryStem = stableArtifactStem(file.fileName, /\.profile\.(tsx|ts|mjs|js)$/);
    const temporaryOutputPath = join(compiledDir, `${temporaryStem}.${randomUUID()}.building.mjs`);
    const temporaryTypePath = join(compiledDir, `${temporaryStem}.${randomUUID()}.building.${VARIABLE_TYPES_FILE_NAME}`);
    const compilerContext = artifactPathContext.compilerContext;
    const tsconfigPath = compilerContext.tsconfigPath;
    let dependencies: ProfileArtifactDependency[];

    try {
        const result = await build({
            // esbuild 会把 entry 相对 absWorkingDir 写入 boundary comment；绑定 profileRoot
            // 才不会把 Product staging operation ID 混入内容寻址 artifact。
            absWorkingDir: profileRoot,
            banner: {
                js: runtimeRequireBanner(compilerContext),
            },
            bundle: true,
            entryPoints: [file.absolutePath],
            format: "esm",
            jsx: "automatic",
            jsxImportSource: "nbook/profile-sdk",
            logLevel: "silent",
            metafile: true,
            nodePaths: compilerContext.productRuntime ? [compilerContext.compilerNodeModulesRoot] : [],
            outfile: temporaryOutputPath,
            platform: "node",
            plugins: [runtimeArtifactBundlePlugin(compilerContext, "nbook-profile-artifact-bundle")],
            target: "esnext",
            tsconfig: tsconfigPath,
        });
        if (!result.metafile) {
            throw new Error(`profile ${file.fileName} 编译缺少 esbuild metafile。`);
        }
        await assertRuntimeArtifactAuthoringMetafile(authoringGraph, result.metafile, profileRoot);
        dependencies = await readArtifactDependencies(result.metafile, tsconfigPath, profileRoot, artifactPathContext);
        const dependencyHash = hashArtifactDependencies(file.absolutePath, dependencies, artifactPathContext);
        const artifactHash = await hashFile(temporaryOutputPath);
        assertProfileArtifactDependencyGate(file.fileName, dependencies, artifactHash.bytes);
        const artifactFileName = `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactHash.sha256}.mjs`;
        const artifactPath = join(compiledDir, ...artifactFileName.split("/"));
        const profile = await importCompiledProfile(temporaryOutputPath);
        const typeFileName = `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactHash.sha256}.${VARIABLE_TYPES_FILE_NAME}`;
        const typePath = join(compiledDir, ...typeFileName.split("/"));
        const generatedTypes = generateVariableTypes(profile.variableDefinitions ?? [], {
            header: `Session variable authoring types generated from ${file.fileName}.`,
        });
        await writeFile(temporaryTypePath, generatedTypes.text, "utf8");
        const typeHash = await hashFile(temporaryTypePath);
        await promoteImmutableArtifact(temporaryOutputPath, artifactPath, artifactHash);
        await promoteImmutableArtifact(temporaryTypePath, typePath, typeHash);
        return {
            status: "loaded",
            fileName: file.fileName,
            profileKey: profile.manifest.key,
            sourceSha256: sourceHash.sha256,
            sourceBytes: sourceHash.bytes,
            dependencyHash,
            artifactFileName,
            artifactSha256: artifactHash.sha256,
            artifactBytes: artifactHash.bytes,
            typeFileName,
            typeSha256: typeHash.sha256,
            typeBytes: typeHash.bytes,
            typeDiagnostics: generatedTypes.diagnostics,
            registeredVariablePaths: (profile.variableDefinitions ?? []).map((definition) => `${definition.namespace}.${definition.key}`).sort(),
            dependencies,
        };
    } finally {
        await rm(temporaryOutputPath, {force: true});
        await rm(temporaryTypePath, {force: true});
    }
}

/**
 * 导入刚编译出的 staging artifact，用于读取 profile manifest 与 variable 定义。
 *
 * 不建立 Runtime Import Cache 物理副本：`temporaryOutputPath` 本身带 `randomUUID()`，
 * 每轮编译路径都不同，不存在 Bun 按 pathname 复用旧模块的问题。
 */
async function importCompiledProfile(artifactPath: string): Promise<AgentProfile> {
    const mod = await importRuntimeArtifact<{default?: unknown}>(artifactPath);
    const profile = mod.default;
    if (!isProfileDefinition(profile)) {
        throw new Error(`compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
    }
    return normalizeAgentProfile(profile);
}

async function artifactHasProductRequireShim(artifactPath: string): Promise<boolean> {
    const head = (await readFile(artifactPath, "utf8")).slice(0, 2048);
    return head.includes("__nbookResolveProductRequireRoot");
}

async function artifactHasNitroImportMetaShim(artifactPath: string): Promise<boolean> {
    const head = (await readFile(artifactPath, "utf8")).slice(0, 2048);
    return head.includes("globalThis._importMeta_");
}

/** 验证编译产物的最小 authoring 声明形状。 */
function isProfileDefinition(value: unknown): value is AgentProfileDefinition {
    return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "initialSchema" in value
            && "tools" in value
    );
}

async function findProfileFiles(root: string, current = root): Promise<ProfileFileEntry[]> {
    if (!existsSync(current)) {
        return [];
    }
    const entries = await readdir(current, {withFileTypes: true});
    const files: ProfileFileEntry[] = [];
    for (const entry of entries) {
        if (entry.name === PROFILE_COMPILED_DIR_NAME) {
            continue;
        }
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findProfileFiles(root, fullPath));
            continue;
        }
        if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            files.push({
                fileName: relative(root, fullPath).split(/[\\/]+/).join("/"),
                absolutePath: fullPath,
            });
        }
    }
    return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function resolveProfileFile(profileRoot: string, fileName: string): ProfileFileEntry {
    const normalized = fileName.split(/[\\/]+/).filter(Boolean).join("/");
    if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || /^[A-Za-z]:/.test(fileName) || fileName.startsWith("/") || fileName.startsWith("\\")) {
        throw new Error("profile fileName 必须是 profile root 下的相对路径。");
    }
    if (!/\.profile\.(tsx|ts|mjs|js)$/.test(basename(normalized))) {
        throw new Error("profile 文件名必须使用 .profile.tsx/.profile.ts/.profile.mjs/.profile.js。");
    }
    const absolutePath = join(profileRoot, ...normalized.split("/"));
    if (!existsSync(absolutePath)) {
        throw new ProfileArtifactSourceMissingError(`profile 文件不存在：${normalized}`);
    }
    return {
        fileName: normalized,
        absolutePath,
    };
}
async function readArtifactDependencies(
    metafile: Metafile,
    tsconfigPath: string,
    metafileWorkingDir: string,
    artifactPathContext: ProfileArtifactPathContext,
): Promise<ProfileArtifactDependency[]> {
    const paths = new Set<string>([tsconfigPath]);
    for (const inputPath of Object.keys(metafile.inputs)) {
        if (!inputPath.startsWith("<")) {
            paths.add(resolve(metafileWorkingDir, inputPath));
        }
    }
    const dependencies = await mapConcurrent(
        [...paths].sort((left, right) => left.localeCompare(right)),
        PROFILE_DEPENDENCY_HASH_CONCURRENCY,
        (filePath) => artifactDependency(filePath, artifactPathContext),
    );
    return dependencies.sort((left, right) => left.path.localeCompare(right.path));
}

async function artifactDependency(filePath: string, artifactPathContext: ProfileArtifactPathContext): Promise<ProfileArtifactDependency> {
    const hash = await hashFile(filePath);
    return {
        path: normalizeArtifactPath(filePath, artifactPathContext),
        sha256: hash.sha256,
        bytes: hash.bytes,
    };
}

function hashArtifactDependencies(sourcePath: string, dependencies: ProfileArtifactDependency[], artifactPathContext: ProfileArtifactPathContext): string {
    const hash = createHash("sha256")
        .update("profile-artifact")
        .update("\0")
        .update(String(PROFILE_ARTIFACT_COMPILER_VERSION))
        .update("\0")
        .update(normalizeArtifactPath(sourcePath, artifactPathContext));
    for (const dependency of dependencies) {
        hash.update("\0")
            .update(dependency.path)
            .update("\0")
            .update(dependency.sha256)
            .update("\0")
            .update(String(dependency.bytes));
    }
    return hash.digest("hex").slice(0, 24);
}
async function promoteImmutableArtifact(temporaryOutputPath: string, outputPath: string, expected: {sha256: string; bytes: number}): Promise<boolean> {
    const previous = artifactPromotionLocks.get(outputPath) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = previous.then(() => new Promise<void>((resolveLock) => {
        release = resolveLock;
    }));
    artifactPromotionLocks.set(outputPath, current);
    await previous;
    try {
        return await promoteImmutableArtifactUnlocked(temporaryOutputPath, outputPath, expected);
    } finally {
        release();
        if (artifactPromotionLocks.get(outputPath) === current) {
            artifactPromotionLocks.delete(outputPath);
        }
    }
}

async function promoteImmutableArtifactUnlocked(temporaryOutputPath: string, outputPath: string, expected: {sha256: string; bytes: number}): Promise<boolean> {
    await mkdir(dirname(outputPath), {recursive: true});
    const existing = await hashFile(outputPath).catch(() => null);
    if (existing) {
        if (existing.sha256 !== expected.sha256 || existing.bytes !== expected.bytes) {
            throw new Error(`content-addressed artifact 已存在但内容不匹配：${outputPath}`);
        }
        await rm(temporaryOutputPath, {force: true});
        return false;
    }
    await renameWithRetry(temporaryOutputPath, outputPath);
    return true;
}

async function commitCompiledArtifacts(
    buildCompiledDir: string,
    compiledDir: string,
    manifest: ProfileArtifactManifest,
    orphanBudgetBytes: number,
    artifactPathContext: ProfileArtifactPathContext,
): Promise<void> {
    await mkdir(compiledDir, {recursive: true});
    await withCompiledPublishLock(compiledDir, async () => {
        for (const item of manifest.profiles) {
            await installManifestEntryArtifacts(buildCompiledDir, compiledDir, item);
        }
        await writeJsonIfChanged(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), serializeProfileArtifactManifest(manifest));
        logProfileArtifactGc(compiledDir, await pruneCompiledArtifacts(compiledDir, manifest, "publish", orphanBudgetBytes));
    });
}

async function commitCompiledArtifactEntry(
    buildCompiledDir: string,
    compiledDir: string,
    entry: ProfileArtifactManifestEntry,
    orphanBudgetBytes: number,
    artifactPathContext: ProfileArtifactPathContext,
): Promise<ProfileArtifactManifest> {
    return commitCompiledArtifactEntries(buildCompiledDir, compiledDir, [entry], orphanBudgetBytes, artifactPathContext);
}

async function commitCompiledArtifactEntries(
    buildCompiledDir: string,
    compiledDir: string,
    entries: ProfileArtifactManifestEntry[],
    orphanBudgetBytes: number,
    artifactPathContext: ProfileArtifactPathContext,
): Promise<ProfileArtifactManifest> {
    await mkdir(compiledDir, {recursive: true});
    return withCompiledPublishLock(compiledDir, async () => {
        const existingManifest = await readProfileArtifactManifest(dirname(compiledDir), artifactPathContext);
        for (const entry of entries) {
            if (entry.status === "compile_failed") {
                continue;
            }
            await installManifestEntryArtifacts(buildCompiledDir, compiledDir, entry);
        }
        const replaceFileNames = new Set(entries.map((entry) => entry.fileName));
        const nextEntries = [
            ...existingManifest.entries.filter((item) => !replaceFileNames.has(item.fileName)),
            ...entries,
        ].sort((left, right) => left.fileName.localeCompare(right.fileName));
        const manifest: ProfileArtifactManifest = {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: profilesEqual(existingManifest.entries, nextEntries) ? existingManifest.generatedAt : new Date().toISOString(),
            profilesRoot: existingManifest.entries.length > 0 ? existingManifest.profilesRoot : artifactPathContext.rootLabel,
            entries: nextEntries,
            profiles: nextEntries.filter(isLoadedManifestEntry),
        };
        await writeJsonIfChanged(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), serializeProfileArtifactManifest(manifest));
        logProfileArtifactGc(compiledDir, await pruneCompiledArtifacts(compiledDir, manifest, "publish", orphanBudgetBytes));
        return manifest;
    });
}

/**
 * 不发布新 release，只把 `.compiled/artifacts` 收敛回预算内。
 *
 * 只读 root（`writePolicy: "forbid"`，即 Product 内置 assets）不得调用：那是只读安装目录，
 * 在那里删文件等于篡改 Product 安装。
 *
 * 两阶段，避免每次启动都付取锁的代价：先无锁 readdir 做廉价预检，全部可达就直接返回；
 * 确实有 orphan 才进 publish lock，并**在锁内重读磁盘 manifest**重建可达集合
 * ——不能用预检时那份，并发 Publisher 可能已经加了 entry。
 *
 * 返回 null 表示预检认定无事可做，未取锁。
 */
export async function sweepProfileArtifactBudget(
    profileRoot: string,
    artifactPathContext: ProfileArtifactPathContext,
    budgetBytes: number = PROFILE_COMPILED_ORPHAN_BUDGET_BYTES,
): Promise<ProfileArtifactGcReport | null> {
    const compiledDir = join(resolve(profileRoot), PROFILE_COMPILED_DIR_NAME);
    const artifactsDir = join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME);
    const names = await readdir(artifactsDir).catch(() => []);
    if (names.length === 0) {
        return null;
    }
    const preflight = await readProfileArtifactManifest(dirname(compiledDir), artifactPathContext).catch(() => null);
    if (!preflight) {
        return null;
    }
    const reachable = new Set(preflight.profiles.flatMap((item) => [item.artifactFileName, item.typeFileName]
        .filter((name): name is string => Boolean(name))
        .map((name) => name.split("/").pop() ?? name)));
    if (names.every((name) => reachable.has(name))) {
        return null;
    }
    return withCompiledPublishLock(compiledDir, async () => {
        const manifest = await readProfileArtifactManifest(dirname(compiledDir), artifactPathContext);
        const report = await pruneCompiledArtifacts(compiledDir, manifest, "sweep", budgetBytes);
        logProfileArtifactGc(compiledDir, report);
        return report;
    });
}

/**
 * 上报一次 artifact 回收账目。
 * 命中退化守卫或仍然超预算时升为 warn，让这两种需要关注的状态显性化。
 */
function logProfileArtifactGc(compiledDir: string, report: ProfileArtifactGcReport): void {
    const payload = {compiledDir, ...report};
    if (report.skippedDegenerate || report.overBudgetBytes > 0) {
        appLogger.warn("agent.profileArtifact.gc", payload);
        return;
    }
    appLogger.debug("agent.profileArtifact.gc", payload);
}

async function withProfileReleaseQueue<T>(profileRoot: string, task: () => Promise<T>): Promise<T> {
    const key = resolve(profileRoot);
    const previous = profileReleaseQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const queued = run.then(() => undefined, () => undefined);
    profileReleaseQueues.set(key, queued);
    try {
        return await run;
    } finally {
        if (profileReleaseQueues.get(key) === queued) {
            profileReleaseQueues.delete(key);
        }
    }
}

async function installManifestEntryArtifacts(buildCompiledDir: string, compiledDir: string, item: ProfileArtifactManifestItem): Promise<void> {
    const sourcePath = join(buildCompiledDir, ...item.artifactFileName.split("/"));
    if (existsSync(sourcePath)) {
        await installImmutableArtifact(sourcePath, join(compiledDir, ...item.artifactFileName.split("/")), {
            sha256: item.artifactSha256,
            bytes: item.artifactBytes,
        });
    }
    if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
        const typeSourcePath = join(buildCompiledDir, ...item.typeFileName.split("/"));
        if (existsSync(typeSourcePath)) {
            await installImmutableArtifact(typeSourcePath, join(compiledDir, ...item.typeFileName.split("/")), {
                sha256: item.typeSha256,
                bytes: item.typeBytes,
            });
        }
    }
}

function serializeProfileArtifactManifest(manifest: ProfileArtifactManifest): unknown {
    return {
        compilerVersion: manifest.compilerVersion,
        generatedAt: manifest.generatedAt,
        profilesRoot: manifest.profilesRoot,
        profiles: Object.fromEntries(manifest.entries.map((entry) => [entry.profileKey, serializeManifestEntry(entry)])),
    };
}

function serializeManifestEntry(entry: ProfileArtifactManifestEntry): unknown {
    if (entry.status === "compile_failed") {
        return entry;
    }
    return {
        status: "loaded",
        fileName: entry.fileName,
        profileKey: entry.profileKey,
        sourceSha256: entry.sourceSha256,
        sourceBytes: entry.sourceBytes,
        dependencyHash: entry.dependencyHash,
        artifactSha: entry.artifactSha256,
        artifactBytes: entry.artifactBytes,
        typeSha: entry.typeSha256,
        typeBytes: entry.typeBytes,
        typeDiagnostics: entry.typeDiagnostics,
        registeredVariablePaths: entry.registeredVariablePaths,
        dependencies: entry.dependencies,
    };
}

async function withCompiledPublishLock<T>(compiledDir: string, task: () => Promise<T>): Promise<T> {
    const release = await lockFile(compiledDir, {
        lockfilePath: join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK),
        realpath: false,
        stale: 30_000,
        update: 10_000,
        retries: {
            retries: 20,
            factor: 1.2,
            minTimeout: 50,
            maxTimeout: 500,
        },
    });
    try {
        return await task();
    } finally {
        await release();
    }
}

async function installImmutableArtifact(sourcePath: string, outputPath: string, expected: {sha256: string; bytes: number}): Promise<void> {
    await mkdir(dirname(outputPath), {recursive: true});
    const existing = await hashFile(outputPath).catch(() => null);
    if (existing) {
        if (existing.sha256 === expected.sha256 && existing.bytes === expected.bytes) {
            return;
        }
        void appLogger.warn("agent.profileArtifact.corruptArtifactReplaced", {
            outputPath,
            expectedSha256: expected.sha256,
            expectedBytes: expected.bytes,
            actualSha256: existing.sha256,
            actualBytes: existing.bytes,
        });
    }
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    try {
        await copyFile(sourcePath, temporaryPath);
        const copied = await hashFile(temporaryPath);
        if (copied.sha256 !== expected.sha256 || copied.bytes !== expected.bytes) {
            throw new Error(`content-addressed artifact 写入校验失败：${outputPath}`);
        }
        if (existing) {
            await rm(outputPath, {force: true});
        }
        await renameWithRetry(temporaryPath, outputPath);
    } finally {
        await rm(temporaryPath, {force: true});
    }
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
    const next = `${JSON.stringify(value, null, 2)}\n`;
    const current = await readFile(filePath, "utf8").catch(() => null);
    if (current === next) {
        return;
    }
    await mkdir(dirname(filePath), {recursive: true});
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, next, "utf8");
        await renameWithRetry(temporaryPath, filePath);
    } finally {
        await rm(temporaryPath, {force: true});
    }
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
    const delays = [20, 50, 100, 200, 400];
    for (let attempt = 0; ; attempt += 1) {
        try {
            await rename(sourcePath, targetPath);
            return;
        } catch (error) {
            if (attempt >= delays.length || !isTransientRenameError(error)) {
                throw error;
            }
            await sleep(delays[attempt]!);
        }
    }
}

function isTransientRenameError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return false;
    }
    return error.code === "EPERM" || error.code === "EBUSY" || error.code === "EACCES";
}

/**
 * 回收一个 `.compiled/` 目录里不再可达的 artifact。
 *
 * 由发布路径在 publish lock 内调用。`budgetBytes` 是显式参数而非只读常量，
 * 这样预算行为可以被直接测试，不必伪造 512 MiB 的磁盘数据。
 */
export async function pruneCompiledArtifacts(
    compiledDir: string,
    manifest: ProfileArtifactManifest,
    trigger: ProfileArtifactGcTrigger,
    budgetBytes: number = PROFILE_COMPILED_ORPHAN_BUDGET_BYTES,
): Promise<ProfileArtifactGcReport> {
    const keep = new Set([
        PROFILE_COMPILED_MANIFEST_FILE,
        ...manifest.profiles.flatMap((item) => [item.artifactFileName, item.typeFileName].filter((name): name is string => Boolean(name))),
    ]);
    const entries = await readdir(compiledDir, {withFileTypes: true}).catch(() => []);
    // `.compiled/` 根目录的历史扁平 artifact 是 Task 79 迁移残留，无 grace 立即删。
    await Promise.all(entries
        .filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name) && !keep.has(entry.name))
        .map((entry) => rm(join(compiledDir, entry.name), {force: true})));
    // manifest 没有任何 loaded entry 属于退化态（例如宿主依赖临时缺失导致全量编译失败）。
    // 此时可达集合为空，按预算回收会删光整个 artifacts 目录，因此只保留 grace 行为。
    const degenerate = manifest.profiles.length === 0;
    return pruneContentAddressedArtifacts(compiledDir, keep, trigger, budgetBytes, degenerate);
}

/**
 * 回收 `.compiled/artifacts/` 中不再被 current manifest 引用的 artifact。
 *
 * 优先级：最小安全年龄地板 > 硬字节预算 > 7 天 grace。
 * 即地板内的 orphan 绝不删；地板外先按 grace 删一批，仍超预算就继续按
 * “最久未被引用优先”删到预算内（此时突破 grace）。
 */
async function pruneContentAddressedArtifacts(
    compiledDir: string,
    keep: Set<string>,
    trigger: ProfileArtifactGcTrigger,
    budgetBytes: number,
    degenerate: boolean,
): Promise<ProfileArtifactGcReport> {
    const artifactsDir = join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME);
    const entries = await readdir(artifactsDir, {withFileTypes: true}).catch(() => []);
    const now = Date.now();
    const report: ProfileArtifactGcReport = {
        trigger,
        currentFiles: 0,
        currentBytes: 0,
        orphanFiles: 0,
        orphanBytes: 0,
        deletedFiles: 0,
        deletedBytes: 0,
        failedFiles: 0,
        protectedBytes: 0,
        overBudgetBytes: 0,
        largestArtifact: null,
        skippedDegenerate: false,
    };
    const orphans: {path: string; bytes: number; mtimeMs: number}[] = [];
    const files = entries.filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name));
    await mapConcurrent(files, PROFILE_DEPENDENCY_HASH_CONCURRENCY, async (entry) => {
        const filePath = join(artifactsDir, entry.name);
        const fileStat = await stat(filePath).catch(() => null);
        if (!fileStat) {
            return;
        }
        if (!report.largestArtifact || fileStat.size > report.largestArtifact.bytes) {
            report.largestArtifact = {fileName: entry.name, bytes: fileStat.size};
        }
        if (keep.has(`${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${entry.name}`)) {
            report.currentFiles += 1;
            report.currentBytes += fileStat.size;
            // 幂等复用 artifact 时 installImmutableArtifact 不会刷新 mtime，
            // 于是一个被连续引用很久的 artifact 会带着很旧的 mtime。这里把它刷新成
            // “最后一次仍被 current 引用的时间”，驱逐序才是正确的最久未引用优先。
            await utimes(filePath, now / 1000, now / 1000).catch(() => undefined);
            return;
        }
        report.orphanFiles += 1;
        report.orphanBytes += fileStat.size;
        orphans.push({path: filePath, bytes: fileStat.size, mtimeMs: fileStat.mtimeMs});
    });

    const removeOrphan = async (orphan: {path: string; bytes: number}): Promise<void> => {
        try {
            await rm(orphan.path, {force: true});
            report.deletedFiles += 1;
            report.deletedBytes += orphan.bytes;
        } catch {
            // 单个 artifact 删不掉（Windows 文件占用等）不得让整个发布失败。
            report.failedFiles += 1;
        }
    };

    const remaining: {path: string; bytes: number; mtimeMs: number}[] = [];
    for (const orphan of orphans) {
        if (now - orphan.mtimeMs >= PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS) {
            await removeOrphan(orphan);
            continue;
        }
        remaining.push(orphan);
    }

    if (degenerate) {
        report.skippedDegenerate = true;
        report.overBudgetBytes = Math.max(0, report.orphanBytes - report.deletedBytes - budgetBytes);
        return report;
    }

    report.protectedBytes = remaining
        .filter((orphan) => now - orphan.mtimeMs < PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS)
        .reduce((total, orphan) => total + orphan.bytes, 0);
    const evictable = remaining
        .filter((orphan) => now - orphan.mtimeMs >= PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS)
        .sort((left, right) => left.mtimeMs - right.mtimeMs);
    // 预算回收必须串行：要知道删完这一个之后的累计剩余字节，才能决定要不要删下一个。
    let live = report.orphanBytes - report.deletedBytes;
    for (const orphan of evictable) {
        if (live <= budgetBytes) {
            break;
        }
        await removeOrphan(orphan);
        live -= orphan.bytes;
    }
    report.overBudgetBytes = Math.max(0, live - budgetBytes);
    return report;
}

/**
 * Product Runtime 的动态 artifact 不在 `.output/server` 下，不能用 artifact
 * 自身位置解析 native/dynamic require；否则会越过 Nitro vendor。
 */
function runtimeRequireBanner(context: RuntimeArtifactCompilerContext): string {
    const artifactUrl = runtimeImportMetaUrlExpression();
    const compilerVersionBanner = `/* nbook-profile-artifact-compiler-version:${PROFILE_ARTIFACT_COMPILER_VERSION} */`;
    if (!context.productRuntime) {
        return `${compilerVersionBanner}import {createRequire as __nbookCreateRequire} from "node:module";const require=__nbookCreateRequire(${artifactUrl});`;
    }
    const runtimeRequirePath = normalizeRuntimeArtifactPath(context.artifactRuntimeRequireRoot, context);
    if (runtimeRequirePath !== ".output/server/index.mjs") {
        throw new Error(`Product artifact runtime require root 无法规范化：${runtimeRequirePath}`);
    }
    return [
        compilerVersionBanner,
        'import {createRequire as __nbookCreateRequire} from "node:module";',
        'import {existsSync as __nbookExistsSync} from "node:fs";',
        'import {resolve as __nbookResolve} from "node:path";',
        'function __nbookResolveProductRequireRoot(){const applicationRoot=process.env.NEURO_BOOK_APPLICATION_ROOT?.trim();const buildImageRoot=process.env.NEURO_BOOK_PRODUCT_BUILD==="1"?process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim():"";const entry=buildImageRoot?__nbookResolve(buildImageRoot,"server","index.mjs"):applicationRoot?__nbookResolve(applicationRoot,".output","server","index.mjs"):"";if(!entry||!__nbookExistsSync(entry))throw new Error("Product Profile artifact 缺少 NEURO_BOOK_APPLICATION_ROOT 或已验证的 runtime require root。");return entry;}',
        "const require=__nbookCreateRequire(__nbookResolveProductRequireRoot());",
    ].join("");
}

function runtimeImportMetaUrlExpression(): string {
    return ["import", ".", "meta", ".", "url"].join("");
}

function emptyArtifactManifest(artifactPathContext: ProfileArtifactPathContext): ProfileArtifactManifest {
    return {
        compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        profilesRoot: artifactPathContext.rootLabel,
        entries: [],
        profiles: [],
    };
}

function profilesEqual(left: ProfileArtifactManifestEntry[], right: ProfileArtifactManifestEntry[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function stableArtifactStem(fileName: string, extensionPattern: RegExp): string {
    const withoutExtension = fileName.replace(extensionPattern, "");
    const stem = withoutExtension
        .split(/[\\/]+/)
        .filter(Boolean)
        .join("__")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return stem || "artifact";
}

function normalizeArtifactPath(filePath: string, artifactPathContext: ProfileArtifactPathContext): string {
    return normalizeRuntimeArtifactPath(filePath, artifactPathContext);
}
