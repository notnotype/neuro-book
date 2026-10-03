import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {build, type Metafile} from "esbuild";
import {lock as lockFile, type LockOptions} from "proper-lockfile";
import {appLogger} from "nbook/server/app-logs/logger";
import type {VariableDefinition, VariableNamespace, VariableAccessorIssue} from "nbook/server/agent/variables/types";
import {
    createProfileArtifactPathContext,
    hashFile,
    type ProfileArtifactPathContext,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {generateVariableTypes, VARIABLE_TYPES_FILE_NAME, type VariableTypeGenerationDiagnostic} from "nbook/server/agent/variables/generated-types";
import {DEFAULT_RUNTIME_ARTIFACT_RETENTION, importRuntimeArtifact, type RuntimeArtifactCacheSpec} from "nbook/server/utils/runtime-artifact-import";
import {runtimeArtifactBundlePlugin} from "nbook/server/utils/runtime-artifact-bundle-plugin";
import {
    normalizeRuntimeArtifactPath,
    resolveRuntimeArtifactCompilerContext,
    resolveRuntimeArtifactPath,
    type RuntimeArtifactCompilerContext,
} from "nbook/server/utils/runtime-artifact-compiler-context";
import {
    assertRuntimeArtifactAuthoringMetafile,
    validateRuntimeArtifactAuthoring,
} from "nbook/server/utils/runtime-artifact-authoring-interface";

export const VARIABLE_DEFINITION_COMPILER_VERSION = 3;
export const VARIABLE_DEFINITION_COMPILED_DIR = ".compiled";
export const VARIABLE_DEFINITION_ARTIFACTS_DIR = "artifacts";
export const VARIABLE_DEFINITION_MANIFEST_FILE = "manifest.json";
export const VARIABLE_DEFINITION_PUBLISH_LOCK = ".publish.lock";
export const VARIABLE_DEFINITION_ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
export const VARIABLE_DEFINITION_STAGING_DIR_NAME = "variable-definition-build";
export const VARIABLE_DEFINITION_STAGING_OWNER_FILE = ".nbook-staging-owner.json";
export const VARIABLE_DEFINITION_STAGING_LEASE_LOCK = ".nbook-staging-lease.lock";
export const VARIABLE_DEFINITION_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const VARIABLE_DEFINITION_STAGING_OWNER = "nbook.variable-definition-compiler";
export const VARIABLE_DEFINITION_STAGING_OWNER_SCHEMA = 1;
const VARIABLE_DEFINITION_STAGING_HEARTBEAT_MS = 10_000;

export type VariableDefinitionDependency = {
    path: string;
    sha256: string;
    bytes: number;
};

export type VariableDefinitionDependencyMismatch = {
    path: string;
    expected: {sha256: string; bytes: number};
    /** null 表示依赖文件不存在或无法读取。 */
    actual: {sha256: string; bytes: number} | null;
};

export type VariableDefinitionValidation = {
    fresh: boolean;
    reason?: string;
    /** 仅 dependency_changed 时存在，指出第一个失配依赖。 */
    dependency?: VariableDefinitionDependencyMismatch;
};

export type VariableDefinitionManifestItem = {
    fileName: string;
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
    registeredPaths: string[];
    dependencies: VariableDefinitionDependency[];
};

export type VariableDefinitionManifest = {
    compilerVersion: typeof VARIABLE_DEFINITION_COMPILER_VERSION;
    generatedAt: string;
    definitionsRoot: string;
    definitions: VariableDefinitionManifestItem[];
};
export const SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL = "assets/workspace/.nbook/agent/variables";
export type VariableDefinitionArtifactPathContext = ProfileArtifactPathContext;

export function createVariableDefinitionArtifactPathContext(
    definitionRoot: string,
    rootLabel: string,
    compilerContext: RuntimeArtifactCompilerContext,
): VariableDefinitionArtifactPathContext {
    return createProfileArtifactPathContext(definitionRoot, rootLabel, compilerContext);
}

export async function resolveVariableDefinitionArtifactPathContext(
    definitionRoot: string,
    rootLabel: string,
    compilerRoot: string,
): Promise<VariableDefinitionArtifactPathContext> {
    return createVariableDefinitionArtifactPathContext(
        definitionRoot,
        rootLabel,
        await resolveRuntimeArtifactCompilerContext(resolve(compilerRoot)),
    );
}
export type VariableDefinitionArtifactPathContextResolver = (
    definitionRoot: string,
    rootLabel: string,
) => Promise<VariableDefinitionArtifactPathContext>;

export function createVariableDefinitionArtifactPathContextResolver(
    compilerRoot: string,
): VariableDefinitionArtifactPathContextResolver {
    const compilerContext = resolveRuntimeArtifactCompilerContext(resolve(compilerRoot));
    return async (definitionRoot: string, rootLabel: string) =>
        createVariableDefinitionArtifactPathContext(definitionRoot, rootLabel, await compilerContext);
}

/** Variable definition staging owner marker 的稳定磁盘格式。 */
export type VariableDefinitionStagingOwner = {
    schema: typeof VARIABLE_DEFINITION_STAGING_OWNER_SCHEMA;
    owner: typeof VARIABLE_DEFINITION_STAGING_OWNER;
    operationId: string;
    pid: number;
    startedAt: string;
};

/** 一次 Variable definition staging 回收扫描的结果；未识别 owner 的目录始终保留。 */
export type VariableDefinitionStagingSweepReport = {
    scanned: number;
    fresh: number;
    active: number;
    deleted: number;
    malformed: number;
    failed: number;
};

type DefinitionFileEntry = {
    fileName: string;
    absolutePath: string;
};

const variableDefinitionStagingLeases = new Map<string, {
    token: object;
    release: () => Promise<void>;
}>();

/**
 * 为一次 Variable definition 编译建立 owner marker，并持有带 heartbeat 的 lease。
 * lease 保持到显式 cleanup；进程崩溃后 heartbeat 停止，后续 sweep 才能回收。
 */
async function createVariableDefinitionStaging(buildCompiledDir: string, operationId: string): Promise<void> {
    const resolvedDir = resolve(buildCompiledDir);
    let ownsDirectory = false;
    const token = {};
    try {
        await mkdir(dirname(resolvedDir), {recursive: true});
        await mkdir(resolvedDir);
        ownsDirectory = true;
        const marker: VariableDefinitionStagingOwner = {
            schema: VARIABLE_DEFINITION_STAGING_OWNER_SCHEMA,
            owner: VARIABLE_DEFINITION_STAGING_OWNER,
            operationId,
            pid: process.pid,
            startedAt: new Date().toISOString(),
        };
        await writeFile(
            join(resolvedDir, VARIABLE_DEFINITION_STAGING_OWNER_FILE),
            `${JSON.stringify(marker, null, 2)}\n`,
            {encoding: "utf8", flag: "wx"},
        );
        const release = await lockFile(resolvedDir, variableDefinitionStagingLockOptions(resolvedDir, (error) => {
            const lease = variableDefinitionStagingLeases.get(resolvedDir);
            if (lease?.token === token) {
                variableDefinitionStagingLeases.delete(resolvedDir);
            }
            // 其它线程按既有 finally 递归删除 staging 时，锁随目录消失属于正常清理。
            if (existsSync(resolvedDir)) {
                void appLogger.warn("agent.variableDefinition.stagingLeaseCompromised", {
                    buildCompiledDir: resolvedDir,
                    error: error.message,
                });
            }
        }));
        variableDefinitionStagingLeases.set(resolvedDir, {token, release});
    } catch (error) {
        if (ownsDirectory) {
            await rm(resolvedDir, {recursive: true, force: true}).catch(() => undefined);
        }
        throw error;
    }
}

/**
 * 回收同 owner、超过 24 小时且无法证明活跃的 Variable definition staging。
 * 未知或损坏 marker 一律保留；只有成功取得 lease 并二次确认 marker 后才删除。
 */
export async function sweepVariableDefinitionStaging(
    stagingRoot: string,
    now: number = Date.now(),
): Promise<VariableDefinitionStagingSweepReport> {
    const ownerRoot = join(resolve(stagingRoot), VARIABLE_DEFINITION_STAGING_DIR_NAME);
    const report: VariableDefinitionStagingSweepReport = {
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
        const marker = await readVariableDefinitionStagingOwner(candidate);
        if (!marker || marker.operationId !== entry.name) {
            report.malformed += 1;
            continue;
        }
        if (!variableDefinitionStagingExpired(marker, now)) {
            report.fresh += 1;
            continue;
        }

        let release: (() => Promise<void>) | undefined;
        try {
            release = await lockFile(candidate, variableDefinitionStagingLockOptions(candidate, (error) => {
                void appLogger.warn("agent.variableDefinition.stagingSweepLeaseCompromised", {
                    buildCompiledDir: candidate,
                    error: error.message,
                });
            }));
        } catch (error) {
            const code = variableDefinitionErrorCode(error);
            if (code === "ELOCKED") {
                report.active += 1;
            } else if (code !== "ENOENT") {
                report.failed += 1;
                void appLogger.warn("agent.variableDefinition.stagingSweepFailed", {
                    buildCompiledDir: candidate,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            continue;
        }

        try {
            const confirmed = await readVariableDefinitionStagingOwner(candidate);
            if (!confirmed || !variableDefinitionStagingOwnersEqual(marker, confirmed)) {
                report.malformed += 1;
                continue;
            }
            if (!variableDefinitionStagingExpired(confirmed, now)) {
                report.fresh += 1;
                continue;
            }
            await rm(candidate, {recursive: true, force: true});
            report.deleted += 1;
        } catch (error) {
            report.failed += 1;
            void appLogger.warn("agent.variableDefinition.stagingSweepFailed", {
                buildCompiledDir: candidate,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await release().catch((error) => {
                const code = variableDefinitionErrorCode(error);
                if (code !== "ERELEASED" && code !== "ENOENT") {
                    void appLogger.warn("agent.variableDefinition.stagingSweepReleaseFailed", {
                        buildCompiledDir: candidate,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        }
    }
    if (report.deleted > 0 || report.malformed > 0 || report.failed > 0) {
        appLogger.debug("agent.variableDefinition.stagingSweep", {stagingRoot: resolve(stagingRoot), ...report});
    }
    return report;
}

/** 读取并严格校验 Variable definition staging owner marker。 */
async function readVariableDefinitionStagingOwner(buildCompiledDir: string): Promise<VariableDefinitionStagingOwner | null> {
    try {
        // owner marker 来自磁盘 JSON，解析后必须先作为 unknown 收窄。
        const parsed: unknown = JSON.parse(await readFile(join(buildCompiledDir, VARIABLE_DEFINITION_STAGING_OWNER_FILE), "utf8"));
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        if (!("schema" in parsed) || parsed.schema !== VARIABLE_DEFINITION_STAGING_OWNER_SCHEMA
            || !("owner" in parsed) || parsed.owner !== VARIABLE_DEFINITION_STAGING_OWNER
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
function variableDefinitionStagingExpired(marker: VariableDefinitionStagingOwner, now: number): boolean {
    return now - Date.parse(marker.startedAt) >= VARIABLE_DEFINITION_STAGING_MAX_AGE_MS;
}

/** 二次确认锁内读取的 marker 仍对应同一个 staging operation。 */
function variableDefinitionStagingOwnersEqual(left: VariableDefinitionStagingOwner, right: VariableDefinitionStagingOwner): boolean {
    return left.schema === right.schema
        && left.owner === right.owner
        && left.operationId === right.operationId
        && left.pid === right.pid
        && left.startedAt === right.startedAt;
}

/** Variable definition lease 与 sweeper 必须共享同一 stale/heartbeat 合同。 */
function variableDefinitionStagingLockOptions(buildCompiledDir: string, onCompromised: (error: Error) => void): LockOptions {
    return {
        lockfilePath: join(buildCompiledDir, VARIABLE_DEFINITION_STAGING_LEASE_LOCK),
        realpath: false,
        stale: VARIABLE_DEFINITION_STAGING_MAX_AGE_MS,
        update: VARIABLE_DEFINITION_STAGING_HEARTBEAT_MS,
        retries: 0,
        onCompromised,
    };
}

/** 提取 Node/proper-lockfile 的稳定错误 code。 */
function variableDefinitionErrorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
}

/** 清理 Variable definition staging；清理失败不覆盖编译主结果。 */
export async function cleanupVariableDefinitionStaging(buildCompiledDir: string): Promise<void> {
    const resolvedDir = resolve(buildCompiledDir);
    const lease = variableDefinitionStagingLeases.get(resolvedDir);
    if (lease) {
        variableDefinitionStagingLeases.delete(resolvedDir);
        await lease.release().catch((error) => {
            const code = variableDefinitionErrorCode(error);
            if (code !== "ERELEASED" && code !== "ENOENT") {
                void appLogger.warn("agent.variableDefinition.stagingLeaseReleaseFailed", {
                    buildCompiledDir: resolvedDir,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });
    }
    await rm(resolvedDir, {recursive: true, force: true}).catch((error) => {
        void appLogger.warn("agent.variableDefinition.stagingCleanupFailed", {
            buildCompiledDir: resolvedDir,
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

/**
 * 编译变量 definition root，生成运行时 `.compiled` artifact。
 */
export async function compileVariableDefinitions(options: {
    definitionRoot: string;
    artifactPathContext: VariableDefinitionArtifactPathContext;
    skipFresh?: boolean;
    /** Product 可复现构建传入固定时间；普通 Source/User 编译为空并记录真实发布时间。 */
    manifestGeneratedAt?: string;
    /** Product 内置系统 assets 使用 forbid；新鲜时零写入，过期时要求重建 Product。 */
    writePolicy?: "allow" | "forbid";
    /** 非空时覆盖默认的 definition root 同级 Agent staging 根。 */
    stagingRoot?: string;
}): Promise<VariableDefinitionManifest> {
    const definitionRoot = resolve(options.definitionRoot);
    const compiledDir = join(definitionRoot, VARIABLE_DEFINITION_COMPILED_DIR);
    const stagingRoot = resolve(options.stagingRoot ?? join(dirname(definitionRoot), ".staging"));
    await sweepVariableDefinitionStaging(stagingRoot);
    const operationId = randomUUID();
    const buildCompiledDir = join(stagingRoot, VARIABLE_DEFINITION_STAGING_DIR_NAME, operationId);
    const existingManifest = await readVariableDefinitionManifest(definitionRoot, options.artifactPathContext);
    const files = await findDefinitionFiles(definitionRoot);
    const definitions: VariableDefinitionManifestItem[] = [];
    let compiledCount = 0;
    let stagingCreated = false;
    try {
        for (const file of files) {
            const existingItem = existingManifest.definitions.find((item) => item.fileName === file.fileName);
            let validation: VariableDefinitionValidation | undefined;
            if ((options.skipFresh || options.writePolicy === "forbid") && existingItem) {
                validation = await validateVariableDefinitionArtifact(definitionRoot, existingItem, options.artifactPathContext, {requireTypeArtifact: true});
                if (validation.fresh) {
                    definitions.push(existingItem);
                    continue;
                }
            }
            if (options.writePolicy === "forbid") {
                const detail = validation?.dependency
                    ? `${validation.reason}: ${validation.dependency.path}`
                    : validation?.reason ?? "manifest_missing";
                throw new Error(`Product 内置 variable definition 已过期或缺失：${file.fileName}（${detail}）。请重新构建或安装与源码匹配的 Product。`);
            }
            if (!stagingCreated) {
                await createVariableDefinitionStaging(buildCompiledDir, operationId);
                stagingCreated = true;
            }
            definitions.push(await compileDefinitionFile(definitionRoot, buildCompiledDir, file, options.artifactPathContext));
            compiledCount += 1;
        }
        const nextDefinitions = definitions.sort((left, right) => left.fileName.localeCompare(right.fileName));
        const manifest: VariableDefinitionManifest = {
            compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
            generatedAt: definitionsEqual(existingManifest.definitions, nextDefinitions)
                ? existingManifest.generatedAt
                : options.manifestGeneratedAt ?? new Date().toISOString(),
            definitionsRoot: options.artifactPathContext.rootLabel,
            definitions: nextDefinitions,
        };
        const publishRequired = compiledCount > 0
            || !definitionsEqual(existingManifest.definitions, nextDefinitions)
            || existingManifest.definitionsRoot !== manifest.definitionsRoot;
        if (!publishRequired) {
            return manifest;
        }
        if (options.writePolicy === "forbid") {
            throw new Error("Product 内置 variable definition manifest 与源码不匹配。请重新构建或安装与源码匹配的 Product。");
        }
        await commitArtifacts(definitionRoot, buildCompiledDir, compiledDir, manifest, options.artifactPathContext);
        return manifest;
    } finally {
        if (stagingCreated) {
            await cleanupVariableDefinitionStaging(buildCompiledDir);
        }
    }
}

/**
 * 加载 hash 匹配的 definition artifact。
 */
export async function loadCompiledVariableDefinitions(input: {
    definitionRoot: string;
    artifactPathContext: VariableDefinitionArtifactPathContext;
    namespace: Extract<VariableNamespace, "global" | "project">;
}): Promise<{definitions: VariableDefinition[]; issues: VariableAccessorIssue[]}> {
    const root = resolve(input.definitionRoot);
    const sourceFiles = await findDefinitionFiles(root);
    const manifest = await readVariableDefinitionManifest(root, input.artifactPathContext);
    const definitions: VariableDefinition[] = [];
    const issues: VariableAccessorIssue[] = [];
    for (const file of sourceFiles) {
        const item = manifest.definitions.find((entry) => entry.fileName === file.fileName);
        if (!item) {
            issues.push(issue("not_compiled", input.namespace, file.fileName, `变量 definition 未编译：${file.fileName}`));
            continue;
        }
        const validation = await validateVariableDefinitionArtifact(root, item, input.artifactPathContext);
        if (!validation.fresh) {
            issues.push(issue("compile_stale", input.namespace, file.fileName, `变量 definition 已过期：${file.fileName} (${validation.reason})`));
            continue;
        }
        try {
            const loaded = await importDefinitions(join(root, VARIABLE_DEFINITION_COMPILED_DIR, item.artifactFileName), {
                root: join(dirname(root), ".staging", "runtime-artifact-import-cache"),
                namespace: "variable-definition",
                key: item.artifactSha256,
                bytes: item.artifactBytes,
                retention: DEFAULT_RUNTIME_ARTIFACT_RETENTION,
            });
            for (const definition of loaded) {
                if (definition.namespace !== input.namespace) {
                    throw new Error(`${file.fileName} 只能注册 ${input.namespace}.*，实际为 ${definition.namespace}.${definition.key}`);
                }
                definitions.push(definition);
            }
        } catch (error) {
            issues.push(issue("compiled_load_failed", input.namespace, file.fileName, error instanceof Error ? error.message : String(error)));
        }
    }
    return {definitions, issues};
}

export async function readVariableDefinitionManifest(
    definitionRoot: string,
    artifactPathContext: VariableDefinitionArtifactPathContext,
): Promise<VariableDefinitionManifest> {
    const root = resolve(definitionRoot);
    try {
        const value = JSON.parse(await readFile(join(root, VARIABLE_DEFINITION_COMPILED_DIR, VARIABLE_DEFINITION_MANIFEST_FILE), "utf8")) as Partial<VariableDefinitionManifest>;
        if (value.compilerVersion !== VARIABLE_DEFINITION_COMPILER_VERSION || !Array.isArray(value.definitions)) {
            return emptyManifest(artifactPathContext);
        }
        return {
            compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
            generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : new Date(0).toISOString(),
            definitionsRoot: typeof value.definitionsRoot === "string" ? value.definitionsRoot : artifactPathContext.rootLabel,
            definitions: value.definitions.filter(isManifestItem),
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return emptyManifest(artifactPathContext);
        }
        throw error;
    }
}

export async function validateVariableDefinitionArtifact(
    root: string,
    item: VariableDefinitionManifestItem,
    artifactPathContext: VariableDefinitionArtifactPathContext,
    options: {requireTypeArtifact?: boolean} = {},
): Promise<VariableDefinitionValidation> {
    const sourceHash = await hashFile(join(root, ...item.fileName.split("/"))).catch(() => null);
    if (!sourceHash || sourceHash.sha256 !== item.sourceSha256 || sourceHash.bytes !== item.sourceBytes) {
        return {fresh: false, reason: "source_changed"};
    }
    const artifactHash = await hashFile(join(root, VARIABLE_DEFINITION_COMPILED_DIR, item.artifactFileName)).catch(() => null);
    if (!artifactHash) {
        return {fresh: false, reason: "artifact_missing"};
    }
    if (artifactHash.sha256 !== item.artifactSha256 || artifactHash.bytes !== item.artifactBytes) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (!options.requireTypeArtifact) {
        return validateVariableDefinitionDependencies(item, artifactPathContext);
    }
    if (!item.typeFileName || !item.typeSha256 || item.typeBytes === undefined) {
        return {fresh: false, reason: "type_artifact_missing"};
    }
    const typeArtifactHash = await hashFile(join(root, VARIABLE_DEFINITION_COMPILED_DIR, item.typeFileName)).catch(() => null);
    if (!typeArtifactHash) {
        return {fresh: false, reason: "type_artifact_missing"};
    }
    if (typeArtifactHash.sha256 !== item.typeSha256 || typeArtifactHash.bytes !== item.typeBytes) {
        return {fresh: false, reason: "type_artifact_changed"};
    }
    return validateVariableDefinitionDependencies(item, artifactPathContext);
}

async function validateVariableDefinitionDependencies(
    item: VariableDefinitionManifestItem,
    artifactPathContext: VariableDefinitionArtifactPathContext,
): Promise<VariableDefinitionValidation> {
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
 * 加载 hash 匹配的 definition artifact。
 */

async function compileDefinitionFile(
    root: string,
    compiledDir: string,
    file: DefinitionFileEntry,
    artifactPathContext: VariableDefinitionArtifactPathContext,
): Promise<VariableDefinitionManifestItem> {
    const authoringGraph = await validateRuntimeArtifactAuthoring({
        kind: "variable",
        root,
        entry: file.absolutePath,
        allowedSdkSpecifiers: ["nbook/variable-sdk"],
    });
    const sourceHash = await hashFile(file.absolutePath);
    const artifactStem = stableArtifactStem(file.fileName, /\.(tsx|ts|mjs|js)$/);
    const temporaryOutputPath = join(compiledDir, `${artifactStem}.${randomUUID()}.building.mjs`);
    const temporaryTypePath = join(compiledDir, `${artifactStem}.${randomUUID()}.building.${VARIABLE_TYPES_FILE_NAME}`);
    const compilerContext = artifactPathContext.compilerContext;
    const tsconfigPath = compilerContext.tsconfigPath;
    try {
        const result = await build({
            // esbuild 会把 entry 相对 absWorkingDir 写入 boundary comment；绑定 definition root
            // 后，artifact 内容不再受 Product candidate 的 staging UUID 影响。
            absWorkingDir: root,
            bundle: true,
            entryPoints: [file.absolutePath],
            format: "esm",
            logLevel: "silent",
            metafile: true,
            outfile: temporaryOutputPath,
            nodePaths: compilerContext.productRuntime ? [compilerContext.compilerNodeModulesRoot] : [],
            platform: "node",
            plugins: [runtimeArtifactBundlePlugin(compilerContext, "nbook-variable-definition-bundle")],
            target: "esnext",
            tsconfig: tsconfigPath,
        });
        if (!result.metafile) {
            throw new Error(`variable definition ${file.fileName} 编译缺少 esbuild metafile。`);
        }
        await assertRuntimeArtifactAuthoringMetafile(authoringGraph, result.metafile, root);
        const dependencies = await readDependencies(result.metafile, tsconfigPath, root, artifactPathContext);
        const dependencyHash = hashDependencies(file.absolutePath, dependencies, artifactPathContext);
        const artifactHash = await hashFile(temporaryOutputPath);
        const artifactFileName = `${VARIABLE_DEFINITION_ARTIFACTS_DIR}/${artifactHash.sha256}.mjs`;
        const artifactPath = join(compiledDir, artifactFileName);
        const definitions = await importDefinitions(temporaryOutputPath);
        const generatedTypes = generateVariableTypes(definitions, {
            header: `Variable definition types generated from ${file.fileName}.`,
        });
        const typeFileName = `${VARIABLE_DEFINITION_ARTIFACTS_DIR}/${typeHashFileStem(generatedTypes.text)}.${VARIABLE_TYPES_FILE_NAME}`;
        const typePath = join(compiledDir, typeFileName);
        await writeFile(temporaryTypePath, generatedTypes.text, "utf8");
        const typeHash = await hashFile(temporaryTypePath);
        await promoteImmutableArtifact(temporaryOutputPath, artifactPath, artifactHash);
        await promoteImmutableArtifact(temporaryTypePath, typePath, typeHash);
        return {
            fileName: file.fileName,
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
            registeredPaths: definitions.map((definition) => `${definition.namespace}.${definition.key}`).sort(),
            dependencies,
        };
    } finally {
        await rm(temporaryOutputPath, {force: true});
        await rm(temporaryTypePath, {force: true});
    }
}

/**
 * 导入编译后的 variable definition artifact。
 *
 * `cache` 为空表示直接 import 源路径，适用于源路径本身唯一的编译期调用；
 * 运行期调用方的源是固定文件名 `definitions.mjs`，必须传 cache 才能换内容换路径。
 */
async function importDefinitions(
    artifactPath: string,
    cache?: RuntimeArtifactCacheSpec,
): Promise<VariableDefinition[]> {
    const mod = await importRuntimeArtifact<{default?: unknown; definitions?: unknown}>(artifactPath, {cache});
    const value = mod.definitions ?? mod.default;
    if (!Array.isArray(value) || !value.every(isVariableDefinition)) {
        throw new Error(`compiled variable definition 没有导出 VariableDefinition[]：${artifactPath}`);
    }
    return value;
}

function isVariableDefinition(value: unknown): value is VariableDefinition {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && "namespace" in value && "key" in value && "schema" in value);
}

async function findDefinitionFiles(root: string): Promise<DefinitionFileEntry[]> {
    if (!existsSync(root)) {
        return [];
    }
    const result: DefinitionFileEntry[] = [];
    const entries = await readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.name === VARIABLE_DEFINITION_COMPILED_DIR) {
            continue;
        }
        const absolutePath = join(root, entry.name);
        if (entry.isFile() && /^definitions\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            result.push({fileName: entry.name, absolutePath});
        }
    }
    return result.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function readDependencies(
    metafile: Metafile,
    tsconfigPath: string,
    metafileWorkingDir: string,
    artifactPathContext: VariableDefinitionArtifactPathContext,
): Promise<VariableDefinitionDependency[]> {
    const paths = new Set<string>([tsconfigPath]);
    for (const inputPath of Object.keys(metafile.inputs)) {
        if (!inputPath.startsWith("<")) {
            paths.add(resolve(metafileWorkingDir, inputPath));
        }
    }
    return Promise.all([...paths].sort((left, right) => left.localeCompare(right)).map(async (filePath) => ({
        path: normalizeArtifactPath(filePath, artifactPathContext),
        ...await hashFile(filePath),
    })));
}

function hashDependencies(
    sourcePath: string,
    dependencies: VariableDefinitionDependency[],
    artifactPathContext: VariableDefinitionArtifactPathContext,
): string {
    const hash = createHash("sha256")
        .update("variable-definition-artifact")
        .update("\0")
        .update(String(VARIABLE_DEFINITION_COMPILER_VERSION))
        .update("\0")
        .update(normalizeArtifactPath(sourcePath, artifactPathContext));
    for (const dependency of dependencies) {
        hash.update("\0").update(dependency.path).update("\0").update(dependency.sha256).update("\0").update(String(dependency.bytes));
    }
    return hash.digest("hex").slice(0, 24);
}

async function promoteImmutableArtifact(
    temporaryOutputPath: string,
    outputPath: string,
    expected: {sha256: string; bytes: number},
): Promise<void> {
    await mkdir(dirname(outputPath), {recursive: true});
    const existing = await hashFile(outputPath).catch(() => null);
    if (existing) {
        if (existing.sha256 !== expected.sha256 || existing.bytes !== expected.bytes) {
            throw new Error(`content-addressed variable artifact 已存在但内容不匹配：${outputPath}`);
        }
        await rm(temporaryOutputPath, {force: true});
        return;
    }
    await renameWithRetry(temporaryOutputPath, outputPath);
}

/** 安装不可变 artifact，并在 publish lock 内原子翻转 manifest。 */
async function commitArtifacts(
    definitionRoot: string,
    buildDir: string,
    compiledDir: string,
    manifest: VariableDefinitionManifest,
    artifactPathContext: VariableDefinitionArtifactPathContext,
): Promise<void> {
    await mkdir(compiledDir, {recursive: true});
    await withVariablePublishLock(compiledDir, async () => {
        const previousManifest = await readVariableDefinitionManifest(definitionRoot, artifactPathContext);
        await assertVariableReleaseFresh(definitionRoot, manifest, artifactPathContext);
        for (const item of manifest.definitions) {
            await installImmutableArtifact(buildDir, compiledDir, item.artifactFileName, {
                sha256: item.artifactSha256,
                bytes: item.artifactBytes,
            });
            if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
                await installImmutableArtifact(buildDir, compiledDir, item.typeFileName, {
                    sha256: item.typeSha256,
                    bytes: item.typeBytes,
                });
            }
        }
        // artifact 安装期间作者仍可能改源码；manifest 翻转前必须再次关闭 TOCTOU 窗口。
        await assertVariableReleaseFresh(definitionRoot, manifest, artifactPathContext);
        await protectPreviousGeneration(compiledDir, previousManifest, manifest);
        await writeJsonIfChanged(join(compiledDir, VARIABLE_DEFINITION_MANIFEST_FILE), manifest);
        await pruneArtifacts(compiledDir, manifest);
    });
}

/**
 * manifest 翻转前刷新上一代将失去引用的 artifact。
 *
 * orphan 的 10 分钟保护期从“失去 manifest 引用”开始，而不是从文件最初创建时开始；
 * 这样已经读取旧 manifest 的并发消费者仍有时间完成 artifact 加载。
 */
async function protectPreviousGeneration(
    compiledDir: string,
    previousManifest: VariableDefinitionManifest,
    nextManifest: VariableDefinitionManifest,
): Promise<void> {
    const nextPaths = new Set(manifestArtifactPaths(nextManifest));
    const retiredPaths = manifestArtifactPaths(previousManifest).filter((path) => !nextPaths.has(path));
    const protectedAt = new Date();
    for (const relativePath of retiredPaths) {
        await utimes(join(compiledDir, ...relativePath.split("/")), protectedAt, protectedAt).catch((error: unknown) => {
            if (variableDefinitionErrorCode(error) !== "ENOENT") throw error;
        });
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

/** 删除当前 manifest 不可达且超过并发 reader 保护期的 artifact。 */
async function pruneArtifacts(compiledDir: string, manifest: VariableDefinitionManifest): Promise<void> {
    const keep = new Set(manifestArtifactPaths(manifest));
    const artifactsDir = join(compiledDir, VARIABLE_DEFINITION_ARTIFACTS_DIR);
    const entries = await readdir(artifactsDir, {withFileTypes: true}).catch(() => []);
    const now = Date.now();
    await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
        const relativePath = `${VARIABLE_DEFINITION_ARTIFACTS_DIR}/${entry.name}`;
        if (keep.has(relativePath)) return;
        const info = await stat(join(artifactsDir, entry.name)).catch(() => null);
        if (info && now - info.mtimeMs >= VARIABLE_DEFINITION_ORPHAN_MIN_AGE_MS) {
            await rm(join(artifactsDir, entry.name), {force: true});
        }
    }));
}

/** 返回一代 manifest 引用的全部不可变 artifact 路径。 */
function manifestArtifactPaths(manifest: VariableDefinitionManifest): string[] {
    return manifest.definitions.flatMap((item) => [item.artifactFileName, item.typeFileName]
        .filter((name): name is string => Boolean(name)));
}

/** publish lock 内复核源码集合、源码摘要和全部编译依赖。 */
async function assertVariableReleaseFresh(
    definitionRoot: string,
    manifest: VariableDefinitionManifest,
    artifactPathContext: VariableDefinitionArtifactPathContext,
): Promise<void> {
    const currentFiles = await findDefinitionFiles(definitionRoot);
    const currentNames = currentFiles.map((file) => file.fileName);
    const manifestNames = manifest.definitions.map((item) => item.fileName);
    if (JSON.stringify(currentNames) !== JSON.stringify(manifestNames)) {
        throw new Error("Variable definition 发布期间源码集合发生变化；本次 release 已放弃。");
    }
    for (const item of manifest.definitions) {
        const source = await hashFile(join(definitionRoot, ...item.fileName.split("/"))).catch(() => null);
        if (!source || source.sha256 !== item.sourceSha256 || source.bytes !== item.sourceBytes) {
            throw new Error(`Variable definition 发布期间源码发生变化：${item.fileName}`);
        }
        const dependency = await validateVariableDefinitionDependencies(item, artifactPathContext);
        if (!dependency.fresh) {
            throw new Error(`Variable definition 发布期间依赖发生变化：${dependency.dependency?.path ?? item.fileName}`);
        }
    }
}

/** 安装单个内容寻址 artifact；已有目标必须与 manifest 摘要完全一致。 */
async function installImmutableArtifact(
    buildDir: string,
    compiledDir: string,
    relativePath: string,
    expected: {sha256: string; bytes: number},
): Promise<void> {
    const outputPath = join(compiledDir, ...relativePath.split("/"));
    const existing = await hashFile(outputPath).catch(() => null);
    if (existing) {
        if (existing.sha256 !== expected.sha256 || existing.bytes !== expected.bytes) {
            throw new Error(`content-addressed variable artifact 已存在但内容不匹配：${relativePath}`);
        }
        return;
    }
    const sourcePath = join(buildDir, ...relativePath.split("/"));
    const source = await hashFile(sourcePath).catch(() => null);
    if (!source || source.sha256 !== expected.sha256 || source.bytes !== expected.bytes) {
        throw new Error(`Variable definition staging artifact 缺失或损坏：${relativePath}`);
    }
    await mkdir(dirname(outputPath), {recursive: true});
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    try {
        await copyFile(sourcePath, temporaryPath);
        const copied = await hashFile(temporaryPath);
        if (copied.sha256 !== expected.sha256 || copied.bytes !== expected.bytes) {
            throw new Error(`Variable definition artifact 写入校验失败：${relativePath}`);
        }
        await renameWithRetry(temporaryPath, outputPath);
    } finally {
        await rm(temporaryPath, {force: true});
    }
}

/** Variable release 的进程间发布锁。 */
async function withVariablePublishLock<T>(compiledDir: string, task: () => Promise<T>): Promise<T> {
    const release = await lockFile(compiledDir, {
        lockfilePath: join(compiledDir, VARIABLE_DEFINITION_PUBLISH_LOCK),
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

/** Windows Defender/索引器短暂占用目标时做有界 rename 重试。 */
async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
    const delays = [20, 50, 100, 200, 400];
    for (let attempt = 0; ; attempt += 1) {
        try {
            await rename(sourcePath, targetPath);
            return;
        } catch (error) {
            if (attempt >= delays.length || !transientRenameError(error)) throw error;
            await sleep(delays[attempt]!);
        }
    }
}

/** 只重试 Windows 常见的短暂文件占用错误。 */
function transientRenameError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error
        && (error.code === "EPERM" || error.code === "EBUSY" || error.code === "EACCES");
}

/** 在 type artifact 落盘前计算与最终 UTF-8 bytes 一致的内容摘要。 */
function typeHashFileStem(source: string): string {
    return createHash("sha256").update(source, "utf8").digest("hex");
}

function normalizeArtifactPath(filePath: string, artifactPathContext: VariableDefinitionArtifactPathContext): string {
    return normalizeRuntimeArtifactPath(filePath, artifactPathContext);
}

function emptyManifest(artifactPathContext: VariableDefinitionArtifactPathContext): VariableDefinitionManifest {
    return {
        compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        definitionsRoot: artifactPathContext.rootLabel,
        definitions: [],
    };
}

function definitionsEqual(left: VariableDefinitionManifestItem[], right: VariableDefinitionManifestItem[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function isManifestItem(value: unknown): value is VariableDefinitionManifestItem {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as {fileName?: unknown}).fileName === "string" && typeof (value as {artifactFileName?: unknown}).artifactFileName === "string");
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

function issue(code: VariableAccessorIssue["code"], namespace: VariableNamespace, path: string, message: string): VariableAccessorIssue {
    return {code, path: `${namespace}.${path}`, message};
}
