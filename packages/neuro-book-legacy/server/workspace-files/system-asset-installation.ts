import {createHash, randomUUID} from "node:crypto";
import {chmod, copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import {
    LEGACY_HARD_CUT_TOMBSTONED_PATHS,
    LEGACY_HARD_CUT_TOMBSTONED_PREFIXES,
    LEGACY_STALE_TOMBSTONED_PREFIXES,
    LEGACY_TOMBSTONED_ASSET_PATHS,
    LEGACY_TOMBSTONED_ASSET_PREFIXES,
} from "nbook/server/workspace-files/legacy-agent-asset-tombstones";

export const SYSTEM_ASSET_INSTALL_SCHEMA = "system-asset-install/v2" as const;
export const SYSTEM_REFERENCE_INSTALL_SCHEMA = "system-reference-install/v1" as const;
export const INSTALL_ROOT_RELATIVE = path.join("workspace", ".nbook", "agent");
export const REFERENCE_ROOT_RELATIVE = path.join("workspace", ".nbook", "reference");
export const SYSTEM_ASSET_INSTALL_MANIFEST = "installed.json" as const;
export const SYSTEM_REFERENCE_INSTALL_MANIFEST = "reference-manifest.json" as const;
export const TRANSACTION_PREFIX = ".agent-assets" as const;
export const REFERENCE_TRANSACTION_PREFIX = ".reference-assets" as const;
export const INSTALL_LOCK_FILE = ".agent-assets.install.lock" as const;
const INSTALL_LOCK_TARGET = ".agent-assets.install-target" as const;
const TRANSACTION_ARTIFACT_PATTERN = /^(?:\.agent-assets|\.reference-assets)\.(?:previous|staging)-[0-9a-f-]+$/i;
const MANAGED_AGENT_DIRECTORIES = ["skills", "workflows", "profiles"] as const;
const PROFILE_FILE_PATTERN = /\.profile\.(tsx|ts|mjs|js)$/u;
const PROFILE_SIDEcar_PATTERN = /\.profile\.(tsx|ts|mjs|js)$/u;

type ManagedAgentDirectory = typeof MANAGED_AGENT_DIRECTORIES[number];
type TreeDigest = Readonly<{hash: string; files: number}>;
type RemoveOptions = Readonly<{recursive: true; force: true}>;
type DirectoryEntry = import("node:fs").Dirent;

export type SystemAgentAssetType = "skill" | "workflow" | "profile";
export type SystemAgentAssetLedgerEntry = Readonly<{
    type: SystemAgentAssetType;
    id: string;
    state: "installed" | "removed";
    origin: Readonly<{kind: "bundled" | "workshop" | "git" | "local"}>;
    contentHash?: string;
    fileName?: string;
    version?: string;
    installedAt?: string;
    removedAt?: string;
    /** 磁盘内容与 Seed 同 id 包不一致时由账本重建写入；带此标记的包不参与自动升级。 */
    dirtyAt?: string;
}>;

export type SystemAssetInstallPaths = Readonly<{
    /** State Root/workspace/.nbook/agent，直接承载 skills/workflows/profiles。 */
    installRoot: string;
    /** State Root/workspace/.nbook；仅作为 Agent 与 Reference 的共同父目录。 */
    systemNbookRoot: string;
    /** State Root/workspace/.nbook/reference，独立于 Agent Install Root。 */
    systemReferenceRoot: string;
    manifestPath: string;
    referenceManifestPath: string;
    lockPath: string;
}>;

export type SystemAssetSeedPaths = Readonly<{
    /** Application/Product assets/workspace/.nbook/agent。 */
    seedNbookRoot: string;
    /** Application/Product assets/reference。 */
    seedReferenceRoot: string;
    kind: "source" | "product";
}>;

/** Agent provenance ledger；nbookHash 只覆盖三类 Agent 包，不覆盖 legacy/runtime 文件。 */
export type SystemAssetInstallManifest = Readonly<{
    schema: typeof SYSTEM_ASSET_INSTALL_SCHEMA;
    schemaVersion: 1;
    assets: readonly SystemAgentAssetLedgerEntry[];
    nbookHash: string;
    nbookFiles: number;
}>;

export type SystemReferenceInstallManifest = Readonly<{
    schema: typeof SYSTEM_REFERENCE_INSTALL_SCHEMA;
    referenceHash: string;
    referenceFiles: number;
}>;

export type SeedSystemAssetsOptions = Readonly<{
    applicationRoot: string;
    stateRoot: string;
    seed?: Partial<SystemAssetSeedPaths>;
}>;

export type SeedSystemAssetsResult = Readonly<{
    seeded: boolean;
    installRoot: string;
    manifest: SystemAssetInstallManifest;
    referenceManifest: SystemReferenceInstallManifest;
    /** 事务残留清理失败；有效安装保持不回滚，下一次持锁启动重试。 */
    cleanupPending: boolean;
    /** 账本缺失或损坏时的启动重建报告；仅在实际执行了重建时出现。 */
    legacyAdoption?: LegacyAdoptionReport;
}>;

/** 账本缺失/损坏时从磁盘包与 Seed content hash 比对重建的诊断报告；无法恢复 removed 墓碑。 */
export type LegacyAdoptionReport = Readonly<{
    /** 触发原因：账本文件缺失，或读取失败诊断。 */
    reason: string;
    /** 与 Seed 同 id 且 contentHash 一致，重建为 bundled 的包数。 */
    bundled: number;
    /** 与 Seed 同 id 但内容不一致：保留磁盘字节并标 dirty，不参与自动升级。 */
    dirty: readonly string[];
    /** Seed 中无同 id 包，记为 local。 */
    local: readonly string[];
}>;

/** 仅用于受控故障注入；生产调用使用默认 fs 实现。 */
export type SystemAssetInstallOperations = Readonly<{
    rename?: (oldPath: string, newPath: string) => Promise<void>;
    rm?: (target: string, options: RemoveOptions) => Promise<void>;
}>;

type ResolvedOperations = Readonly<{
    rename: (oldPath: string, newPath: string) => Promise<void>;
    rm: (target: string, options: RemoveOptions) => Promise<void>;
}>;

type SeedPackage = Readonly<{
    type: SystemAgentAssetType;
    id: string;
    sourcePath: string;
    fileName?: string;
    version?: string;
    contentHash: string;
}>;

type RootInspection<Manifest> =
    | {kind: "absent"}
    | {kind: "valid"; manifest: Manifest}
    | {kind: "dirty"; manifest: Manifest}
    | {kind: "invalid"; reason: string};

type RecoveryResult = Readonly<{cleanupPending: boolean}>;

const defaultOperations: ResolvedOperations = {
    rename: (oldPath, newPath) => rename(oldPath, newPath),
    rm: (target, options) => rm(target, options),
};

/** State Root/workspace/.nbook/agent 是唯一 Agent Install Root。 */
export function getSystemAssetInstallPaths(stateRoot: string): SystemAssetInstallPaths {
    return createInstallPaths(path.resolve(stateRoot, INSTALL_ROOT_RELATIVE));
}

/** 解析随当前 Application/Product 发布的只读 Seed Source。 */
export function getSystemAssetSeedPaths(applicationRoot: string, env: NodeJS.ProcessEnv = process.env): SystemAssetSeedPaths {
    const productImageRoot = env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
    if (productImageRoot) {
        const serverRoot = path.resolve(productImageRoot, "server");
        return Object.freeze({
            seedNbookRoot: path.join(serverRoot, "assets", "workspace", ".nbook", "agent"),
            seedReferenceRoot: path.join(serverRoot, "assets", "reference"),
            kind: "product",
        });
    }
    const root = path.resolve(applicationRoot);
    return Object.freeze({
        seedNbookRoot: path.join(root, "assets", "workspace", ".nbook", "agent"),
        seedReferenceRoot: path.join(root, "assets", "reference"),
        kind: "source",
    });
}

/**
 * 在 Install Root 级别锁内投放三类 bundled Agent 包与独立 Runtime Reference。
 * Agent 提交只移动受管包单元；variables、templates、bin、config、jobs、sessions、
 * traces 和 Profile .compiled/manifest 由各自 owner 保持原位。
 */
export async function seedSystemAssets(
    options: SeedSystemAssetsOptions,
    operations: SystemAssetInstallOperations = {},
): Promise<SeedSystemAssetsResult> {
    const paths = getSystemAssetInstallPaths(options.stateRoot);
    const seed = resolveSeedPaths(options.applicationRoot, options.seed);
    const io = resolveOperations(operations);
    await assertSeedDirectory(seed.seedNbookRoot, "workspace agent seed");
    await assertSeedDirectory(seed.seedReferenceRoot, "Reference seed");
    return await withInstallLock(paths, (abortIfCompromised, isCompromised) =>
        seedSystemAssetsLocked(paths, seed, io, abortIfCompromised, isCompromised));
}

/** Install Root 排他锁内的统一事务包装：compromise 追踪、释放错误聚合与种子逻辑保持一致。 */
async function withInstallLock<T>(paths: SystemAssetInstallPaths, body: (abortIfCompromised: () => void, isCompromised: () => boolean) => Promise<T>): Promise<T> {
    await mkdir(paths.systemNbookRoot, {recursive: true});
    const lockTarget = path.join(paths.systemNbookRoot, INSTALL_LOCK_TARGET);
    await mkdir(lockTarget, {recursive: true});
    let compromised: Error | undefined;
    const isCompromised = (): boolean => compromised !== undefined;
    const abortIfCompromised = (): void => {
        if (compromised) throw new Error("system asset install lock 已失去所有权，事务已中止", {cause: compromised});
    };
    const release = await acquireFileLock(lockTarget, {
        lockfilePath: paths.lockPath,
        realpath: false,
        stale: 5 * 60 * 1000,
        update: 30 * 1000,
        retries: 0,
        onCompromised: (error: Error) => {
            compromised = error;
        },
    });
    let result: T | undefined;
    let primaryError: unknown;
    try {
        abortIfCompromised();
        result = await body(abortIfCompromised, isCompromised);
        abortIfCompromised();
    } catch (error) {
        primaryError = error;
    }
    const releaseErrors: unknown[] = [];
    try {
        await release();
    } catch (error) {
        releaseErrors.push(error);
    }
    if (compromised && !primaryError) releaseErrors.push(new Error("system asset install lock 已失去所有权", {cause: compromised}));
    if (primaryError) {
        if (releaseErrors.length > 0) throw new AggregateError([primaryError, ...releaseErrors], `system asset install 失败：${paths.installRoot}`);
        throw primaryError;
    }
    if (releaseErrors.length > 0) throw new AggregateError(releaseErrors, `system asset install lock 释放失败：${paths.lockPath}`);
    return result!;
}
 
async function seedSystemAssetsLocked(paths: SystemAssetInstallPaths, seed: SystemAssetSeedPaths, io: ResolvedOperations, abortIfCompromised: () => void, isCompromised: () => boolean): Promise<SeedSystemAssetsResult> {
    abortIfCompromised();
    const agentRecovery = await recoverAgentTransaction(paths, io, abortIfCompromised);
    abortIfCompromised();
    const referenceRecovery = await recoverReferenceTransaction(paths, io, abortIfCompromised);
    abortIfCompromised();
    const [seedPackages, referenceDigest] = await Promise.all([
        discoverAgentPackages(seed.seedNbookRoot),
        hashReferenceTree(seed.seedReferenceRoot),
    ]);
    abortIfCompromised();
    const currentPackages = await discoverAgentPackagesIfPresent(paths.installRoot);
    const currentMap = packageMap(currentPackages);
    let currentManifest: SystemAssetInstallManifest | null = null;
    let ledgerReadError: unknown;
    try {
        currentManifest = await readInstallManifest(paths.manifestPath);
    } catch (error) {
        if (!isUnreadableLedgerError(error)) throw error;
        ledgerReadError = error;
    }
    let adoptedEntries: readonly SystemAgentAssetLedgerEntry[] = [];
    let legacyAdoption: LegacyAdoptionReport | undefined;
    if (!currentManifest && currentPackages.length > 0) {
        abortIfCompromised();
        const rebuild = planLedgerRebuild(seedPackages, currentPackages);
        legacyAdoption = {
            reason: ledgerUnavailableReason(ledgerReadError),
            bundled: rebuild.bundled.length,
            dirty: rebuild.dirty,
            local: rebuild.local,
        };
        await mkdir(paths.installRoot, {recursive: true});
        await writeInstallManifestAtomic(paths.manifestPath, await buildInstallManifest(paths.installRoot, rebuild.entries));
        adoptedEntries = rebuild.entries;
    }
    const ledgerSource = currentManifest?.assets ?? adoptedEntries;
    const ledger = new Map<string, SystemAgentAssetLedgerEntry>(ledgerSource.map((entry) => [assetKey(entry.type, entry.id), entry] as const));
    await assertBundledPackagesClean(currentMap, ledger);
    const nextLedger = new Map(ledger);
    let ledgerChanged = !legacyAdoption && currentManifest === null;
    for (const currentPackage of currentPackages) {
        const key = assetKey(currentPackage.type, currentPackage.id);
        if (!nextLedger.has(key)) {
            nextLedger.set(key, localLedgerEntry(currentPackage));
            ledgerChanged = true;
        }
    }
    const seedMap = packageMap(seedPackages);
    for (const [key, entry] of ledger) {
        if (entry.state === "installed" && entry.origin.kind === "bundled" && !seedMap.has(key)) {
            nextLedger.set(key, {
                ...entry,
                state: "removed",
                removedAt: entry.removedAt ?? new Date().toISOString(),
            });
            ledgerChanged = true;
        }
    }
    const packagesToInstall: SeedPackage[] = [];
    for (const candidate of seedPackages) {
        const key = assetKey(candidate.type, candidate.id);
        const existingLedger = nextLedger.get(key);
        const installed = currentMap.get(key);
        if (existingLedger?.state === "removed") continue;
        if (existingLedger?.state === "installed" && existingLedger.origin.kind !== "bundled") continue;
        if (existingLedger?.state === "installed" && existingLedger.dirtyAt) continue;
        if (installed?.contentHash === candidate.contentHash && existingLedger?.contentHash === candidate.contentHash) continue;
        if (!installed || existingLedger?.origin.kind === "bundled") packagesToInstall.push(candidate);
        const nextEntry = bundledLedgerEntry(candidate, existingLedger);
        if (!existingLedger || JSON.stringify(existingLedger) !== JSON.stringify(nextEntry)) ledgerChanged = true;
        nextLedger.set(key, nextEntry);
    }

    let cleanupPending = agentRecovery.cleanupPending || referenceRecovery.cleanupPending;
    if (packagesToInstall.length > 0) {
        abortIfCompromised();
        const committed = await replaceAgentPackages(paths, currentManifest, packagesToInstall, [...nextLedger.values()], io, abortIfCompromised, isCompromised);
        cleanupPending = committed.cleanupPending || cleanupPending;
    } else if (ledgerChanged) {
        abortIfCompromised();
        await mkdir(paths.installRoot, {recursive: true});
        await writeInstallManifestAtomic(paths.manifestPath, await buildInstallManifest(paths.installRoot, [...nextLedger.values()]));
    }

    abortIfCompromised();

    const currentReference = await readReferenceState(paths);
    const nextReference: SystemReferenceInstallManifest = {
        schema: SYSTEM_REFERENCE_INSTALL_SCHEMA,
        referenceHash: referenceDigest.hash,
        referenceFiles: referenceDigest.files,
    };
    let referenceSeeded = false;
    if (!currentReference || currentReference.referenceHash !== nextReference.referenceHash) {
        referenceSeeded = true;
        abortIfCompromised();
        await replaceReferenceTree(paths, seed.seedReferenceRoot, nextReference, io, abortIfCompromised, isCompromised);
    }
    abortIfCompromised();
    const manifest = await readInstallState(paths);
    const referenceManifest = await readReferenceState(paths);
    if (!manifest || !referenceManifest) throw new Error(`system assets 安装完成后缺少有效 manifest：${paths.installRoot}`);
    return {
        seeded: packagesToInstall.length > 0 || ledgerChanged || referenceSeeded || legacyAdoption !== undefined,
        installRoot: paths.installRoot,
        manifest,
        referenceManifest,
        cleanupPending,
        ...(legacyAdoption ? {legacyAdoption} : {}),
    };
}

export type LegacyAgentAssetMigrationPlan = Readonly<{
    installRoot: string;
    /** 触发原因：账本文件缺失、读取失败诊断，或账本有效但仍有旧投影孤儿/state 残留。 */
    ledgerReason: string;
    /** 将按墓碑语义删除的旧投影孤儿文件（相对 .nbook 根）。 */
    orphanRemovals: readonly string[];
    /** sync-state 证明已手改或无法证明未手改、将保留的墓碑文件；其所在包会标 dirty。 */
    preservedOrphans: readonly string[];
    /** sync-state 中仍存在三类 Agent 包条目，apply 将剥离。 */
    syncStateCleanupPending: boolean;
    /** 基于当前磁盘状态（未删孤儿）的分类；apply 在删除后重新评估。 */
    bundled: readonly string[];
    dirty: readonly string[];
    local: readonly string[];
}>;

export type LegacyAgentAssetMigrationResult = Readonly<{
    report: LegacyAdoptionReport;
    removedOrphans: readonly string[];
    preservedOrphans: readonly string[];
    /** 迁移提交后已从 `.system-assets-sync-state.json` 剥离三类 Agent 包条目。 */
    syncStateCleaned: boolean;
    manifest: SystemAssetInstallManifest;
}>;

/**
 * 显式 legacy migration preflight：只读扫描 Install Root、旧投影孤儿与账本状态，
 * 不写任何文件。返回 null 表示不存在待迁移的 legacy 状态。
 */
export async function planLegacyAgentAssetMigration(options: SeedSystemAssetsOptions): Promise<LegacyAgentAssetMigrationPlan | null> {
    return await runLegacyAgentAssetMigration(options, defaultOperations, "preflight");
}

/**
 * 显式 legacy migration 执行：在 Install Root 锁内按墓碑语义清理旧投影孤儿
 * （sync-state 证明手改的保留），再从磁盘与 Seed content hash 比对重建账本。
 * 已有有效账本且无孤儿时返回 null（幂等 no-op）；失败时已删内容仅限墓碑名单，
 * 账本保持未写入，旧状态仍可用。
 */
export async function applyLegacyAgentAssetMigration(options: SeedSystemAssetsOptions, operations: SystemAssetInstallOperations = {}): Promise<LegacyAgentAssetMigrationResult | null> {
    return await runLegacyAgentAssetMigration(options, resolveOperations(operations), "apply");
}

type LegacyMigrationMode = "preflight" | "apply";

function runLegacyAgentAssetMigration(options: SeedSystemAssetsOptions, io: ResolvedOperations, mode: "preflight"): Promise<LegacyAgentAssetMigrationPlan | null>;
function runLegacyAgentAssetMigration(options: SeedSystemAssetsOptions, io: ResolvedOperations, mode: "apply"): Promise<LegacyAgentAssetMigrationResult | null>;


async function runLegacyAgentAssetMigration(options: SeedSystemAssetsOptions, io: ResolvedOperations, mode: LegacyMigrationMode): Promise<LegacyAgentAssetMigrationPlan | LegacyAgentAssetMigrationResult | null> {
    const paths = getSystemAssetInstallPaths(options.stateRoot);
    const seed = resolveSeedPaths(options.applicationRoot, options.seed);
    await assertSeedDirectory(seed.seedNbookRoot, "workspace agent seed");
    return await withInstallLock(paths, async (abortIfCompromised) => {
        abortIfCompromised();
        const {manifest, error} = await readTolerantInstallManifest(paths.manifestPath);
        const seedPackages = await discoverAgentPackages(seed.seedNbookRoot);
        const {removals, preserved} = await planLegacyOrphanCleanup(paths.systemNbookRoot, seed.seedNbookRoot);
        const syncStateCleanupPending = await legacySyncStateHasManagedEntries(paths.systemNbookRoot);
        if (manifest && removals.length === 0 && preserved.length === 0 && !syncStateCleanupPending) return null;
        const ledgerReason = manifest
            ? "账本已存在（可能由启动恢复重建）；仍存在待处理的旧投影孤儿或 sync state 残留"
            : ledgerUnavailableReason(error);
        const currentPackages = await discoverAgentPackagesIfPresent(paths.installRoot);
        if (mode === "preflight") {
            const rebuild = planLedgerRebuild(seedPackages, currentPackages);
            return {
                installRoot: paths.installRoot,
                ledgerReason,
                orphanRemovals: removals,
                preservedOrphans: preserved,
                syncStateCleanupPending,
                bundled: rebuild.bundled,
                dirty: rebuild.dirty,
                local: rebuild.local,
            };
        }
        for (const assetPath of removals) {
            abortIfCompromised();
            await io.rm(path.join(paths.systemNbookRoot, ...assetPath.split("/")), {recursive: true, force: true});
        }
        for (const prefix of legacyManagedPrefixRoots(removals)) {
            abortIfCompromised();
            await pruneEmptyDirectories(path.join(paths.systemNbookRoot, ...prefix.split("/")));
        }
        abortIfCompromised();
        const remainingPackages = await discoverAgentPackagesIfPresent(paths.installRoot);
        if (!manifest && removals.length === 0 && remainingPackages.length === 0 && !syncStateCleanupPending) return null;
        const rebuild = planLedgerRebuild(seedPackages, remainingPackages);
        const mergedAssets = mergeLedgerWithRebuild(manifest?.assets ?? [], rebuild.entries);
        const report: LegacyAdoptionReport = {
            reason: ledgerReason,
            bundled: rebuild.bundled.length,
            dirty: rebuild.dirty,
            local: rebuild.local,
        };
        abortIfCompromised();
        await mkdir(paths.installRoot, {recursive: true});
        const manifestWritten = await buildInstallManifest(paths.installRoot, mergedAssets);
        await writeInstallManifestAtomic(paths.manifestPath, manifestWritten);
        abortIfCompromised();
        const syncStateCleaned = await stripMigratedSyncStateEntries(paths.systemNbookRoot, io, abortIfCompromised);
        abortIfCompromised();
        return {
            report,
            removedOrphans: removals,
            preservedOrphans: preserved,
            syncStateCleaned,
            manifest: manifestWritten,
        };
    });
}

/** sync-state 中是否仍存在三类 Agent 包条目：非空 profiles 数组或受管资产路径，与条目形状是否可提取 hash 无关。 */
async function legacySyncStateHasManagedEntries(systemNbookRoot: string): Promise<boolean> {
    const document = await parseLegacySyncState(systemNbookRoot);
    if (document === null) return false;
    if (Array.isArray(document.profiles) && document.profiles.length > 0) return true;
    if (!Array.isArray(document.assets)) return false;
    return document.assets.some((item) => typeof item === "object" && item !== null
        && "assetPath" in item && typeof item.assetPath === "string"
        && isManagedPackageTombstone(item.assetPath));
}

/** 墓碑名单中位于三类受管 Agent 包目录下的前缀根；用于删除后修剪空目录。 */
function legacyManagedPrefixRoots(removals: readonly string[]): readonly string[] {
    const roots = new Set<string>();
    for (const assetPath of removals) {
        for (const prefix of [...LEGACY_TOMBSTONED_ASSET_PREFIXES, ...LEGACY_HARD_CUT_TOMBSTONED_PREFIXES, ...LEGACY_STALE_TOMBSTONED_PREFIXES]) {
            if (isManagedPackageTombstone(prefix) && assetPath.startsWith(prefix)) roots.add(prefix);
        }
    }
    return [...roots].sort((left, right) => left.localeCompare(right));
}

async function pruneEmptyDirectories(root: string): Promise<void> {
    if (!await directoryExists(root)) return;
    for (const entry of await readDirectoryEntries(root)) {
        if (entry.isDirectory()) await pruneEmptyDirectories(path.join(root, entry.name));
    }
    if ((await readdir(root)).length === 0) await rm(root, {recursive: true, force: true});
}

/** 用磁盘比对结果覆盖既有账本同 key 条目；不在磁盘上的既有条目（含 removed 墓碑）保持不变。 */
function mergeLedgerWithRebuild(existing: readonly SystemAgentAssetLedgerEntry[], rebuilt: readonly SystemAgentAssetLedgerEntry[]): readonly SystemAgentAssetLedgerEntry[] {
    const merged = new Map<string, SystemAgentAssetLedgerEntry>(existing.map((entry) => [assetKey(entry.type, entry.id), entry] as const));
    for (const entry of rebuilt) {
        const previous = merged.get(assetKey(entry.type, entry.id));
        merged.set(assetKey(entry.type, entry.id), previous?.installedAt ? {...entry, installedAt: previous.installedAt} : entry);
    }
    return [...merged.values()];
}

const MANAGED_PACKAGE_ROOT_PREFIXES = ["agent/skills/", "agent/workflows/", "agent/profiles/"] as const;
const LEGACY_SYNC_STATE_FILE = ".system-assets-sync-state.json";

function isManagedPackageTombstone(assetPath: string): boolean {
    return MANAGED_PACKAGE_ROOT_PREFIXES.some((prefix) => assetPath.startsWith(prefix));
}

/**
 * 按旧投影协议的墓碑语义枚举孤儿，与既有 owner（novel-workspace）逐类对齐：
 * - 普通 exact/前缀/STALE 墓碑：仅删除 sync-state 有记录且磁盘 hash 等于
 *   `lastSyncedUserHash` 的文件；未记录的可能是用户文件，保留并报告。
 * - hard-cut exact/前缀：官方登记的半同步残留，无 state 也可删；state 证明
 *   手改的一律保留。
 * 所有候选先以当前 Seed 清单兜底——名单中 Seed 仍携带的路径不是孤儿。
 */
async function planLegacyOrphanCleanup(systemNbookRoot: string, seedNbookRoot: string): Promise<Readonly<{removals: string[]; preserved: string[]}>> {
    const candidates = new Set<string>();
    for (const assetPath of [...LEGACY_TOMBSTONED_ASSET_PATHS, ...LEGACY_HARD_CUT_TOMBSTONED_PATHS]) {
        if (isManagedPackageTombstone(assetPath)) candidates.add(assetPath);
    }
    for (const assetPrefix of [...LEGACY_TOMBSTONED_ASSET_PREFIXES, ...LEGACY_HARD_CUT_TOMBSTONED_PREFIXES, ...LEGACY_STALE_TOMBSTONED_PREFIXES]) {
        if (!isManagedPackageTombstone(assetPrefix)) continue;
        for (const file of await listFilesUnderPrefix(systemNbookRoot, assetPrefix)) candidates.add(file);
    }
    const syncStateHashes = await readLegacySyncStateHashes(systemNbookRoot);
    const removals: string[] = [];
    const preserved: string[] = [];
    for (const assetPath of [...candidates].sort((left, right) => left.localeCompare(right))) {
        const absolutePath = path.join(systemNbookRoot, ...assetPath.split("/"));
        if (!await pathExists(absolutePath)) continue;
        // 墓碑路径相对 .nbook 根；Seed 根已位于 .nbook/agent，需要剥掉一级 agent 前缀。
        const seedRelative = assetPath.split("/").slice(1).join("/");
        if (await pathExists(path.join(seedNbookRoot, ...seedRelative.split("/")))) continue;
        const lastSyncedUserHash = syncStateHashes.get(assetPath);
        if (lastSyncedUserHash === null || (lastSyncedUserHash !== undefined && sha256(await readFile(absolutePath)) !== lastSyncedUserHash)) {
            // sync-state 记录了该文件但无法证明未被手改（或已证明手改）：保留并报告。
            preserved.push(assetPath);
            continue;
        }
        if (lastSyncedUserHash === undefined && !isHardCutTombstone(assetPath)) {
            // 普通墓碑要求 sync-state 证明该文件自上次同步未被改动；
            // 未记录的可能是用户自建文件，保留待人工处理。
            preserved.push(assetPath);
            continue;
        }
        removals.push(assetPath);
    }
    return {removals, preserved};
}

function isHardCutTombstone(assetPath: string): boolean {
    return LEGACY_HARD_CUT_TOMBSTONED_PATHS.includes(assetPath)
        || LEGACY_HARD_CUT_TOMBSTONED_PREFIXES.some((prefix) => assetPath.startsWith(prefix));
}

async function listFilesUnderPrefix(systemNbookRoot: string, assetPrefix: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (absoluteRoot: string, relativeRoot: string): Promise<void> => {
        for (const entry of await readDirectoryEntries(absoluteRoot)) {
            const absolutePath = path.join(absoluteRoot, entry.name);
            const relativePath = relativeRoot ? path.posix.join(relativeRoot, entry.name) : entry.name;
            if (entry.isDirectory()) await visit(absolutePath, relativePath);
            else if (entry.isFile()) files.push(relativePath);
            else throw new Error(`legacy migration 遇到特殊文件或符号链接：${absolutePath}`);
        }
    };
    const prefixRoot = path.join(systemNbookRoot, ...assetPrefix.split("/"));
    if (await directoryExists(prefixRoot)) await visit(prefixRoot, assetPrefix);
    return files;
}

type LegacySyncStateRecord = Record<string, unknown>;
type LegacySyncStateDocument = LegacySyncStateRecord & {
    assets?: readonly LegacySyncStateRecord[];
    profiles?: readonly LegacySyncStateRecord[];
};

function legacySyncStateNeedsReview(statePath: string, reason: string, cause?: unknown): Error {
    return new Error(`legacy migration 需要人工核查（needs-review）：旧投影 sync state ${reason}，无法证明墓碑文件未被手改：${statePath}`, {cause});
}

/**
 * 读取并严格校验旧投影 sync state（真实结构为 `{profiles: [...], assets?: [...]}`）：
 * 任一键存在但不是数组、或两类键均缺失，一律抛 needs-review（旧投影写该文件
 * 不持安装锁，规划与剥离之间可能被并发改坏）。文件缺失返回 null。
 */
async function parseLegacySyncState(systemNbookRoot: string): Promise<LegacySyncStateDocument | null> {
    const statePath = path.join(systemNbookRoot, LEGACY_SYNC_STATE_FILE);
    const text = await readFile(statePath, "utf8").catch((error: unknown) => isErrorCode(error, "ENOENT") ? null : Promise.reject(error));
    if (text === null) return null;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw legacySyncStateNeedsReview(statePath, "不是有效 JSON", error);
    }
    if (typeof value !== "object" || value === null) throw legacySyncStateNeedsReview(statePath, "结构无效");
    const record = value as LegacySyncStateRecord;
    const hasAssets = "assets" in record;
    const hasProfiles = "profiles" in record;
    const assets = Array.isArray(record.assets) ? record.assets : undefined;
    const profiles = Array.isArray(record.profiles) ? record.profiles : undefined;
    // 条目级形状同样严格：旧投影写入的条目恒带字符串键（assetPath/fileName），
    // 缺失即并发改坏或外部污染，无法安全分类时必须 fail closed 而非静默残留。
    if ((hasAssets && assets === undefined) || (hasProfiles && profiles === undefined) || (!hasAssets && !hasProfiles)) {
        throw legacySyncStateNeedsReview(statePath, "结构无效");
    }
    if (assets !== undefined && !assets.every((item) => typeof item === "object" && item !== null && "assetPath" in item && typeof item.assetPath === "string")) {
        throw legacySyncStateNeedsReview(statePath, "assets 条目结构无效");
    }
    if (profiles !== undefined && !profiles.every((item) => typeof item === "object" && item !== null && "fileName" in item && typeof item.fileName === "string")) {
        throw legacySyncStateNeedsReview(statePath, "profiles 条目结构无效");
    }
    return record as LegacySyncStateDocument;
}

/**
 * 解析旧投影 sync state 并汇总为「相对 .nbook 路径 → lastSyncedUserHash」映射；
 * profiles 条目映射到 `agent/profiles/<fileName>`。值为 null 表示有条目但
 * 无法证明未被手改。
 */
async function readLegacySyncStateHashes(systemNbookRoot: string): Promise<Map<string, string | null>> {
    const document = await parseLegacySyncState(systemNbookRoot);
    const hashes = new Map<string, string | null>();
    if (document === null) return hashes;
    const collect = (items: readonly unknown[], resolveKey: (record: {fileName?: unknown; assetPath?: unknown}) => string | null): void => {
        for (const item of items) {
            if (typeof item !== "object" || item === null) continue;
            const key = resolveKey(item);
            if (key === null) continue;
            hashes.set(key, "lastSyncedUserHash" in item && typeof item.lastSyncedUserHash === "string" ? item.lastSyncedUserHash : null);
        }
    };
    if (Array.isArray(document.assets)) collect(document.assets, (record) => typeof record.assetPath === "string" ? record.assetPath : null);
    if (Array.isArray(document.profiles)) collect(document.profiles, (record) => typeof record.fileName === "string" ? path.posix.join("agent", "profiles", record.fileName) : null);
    return hashes;
}

/**
 * 迁移提交后剥离 sync state 中属于三类 Agent 包的条目（profiles 数组全部 +
 * 受管 `agent/skills|workflows|profiles` 资产条目），templates/variables 等
 * 旧协议条目原样保留。文件缺失或无受管条目时不写盘。
 *
 * 提交前经 `parseLegacySyncState` 严格校验：旧投影写该文件不持安装锁，
 * 规划与剥离之间可能被并发改坏，此时抛 needs-review，不得虚报清理成功。
 *
 * 失败恢复合同：写入为「临时文件 + 同卷原子 rename」，任一步失败时旧 state
 * 原样保留、三类条目仍在磁盘上；迁移触发条件每次运行实时重读 state，
 * 下一次 apply 会经 `legacySyncStateHasManagedEntries` 自动重试本清理，
 * 不存在「已短路且无法重试」的状态。
 */
async function stripMigratedSyncStateEntries(systemNbookRoot: string, io: ResolvedOperations, abortIfCompromised: () => void): Promise<boolean> {
    const statePath = path.join(systemNbookRoot, LEGACY_SYNC_STATE_FILE);
    const document = await parseLegacySyncState(systemNbookRoot);
    if (document === null) return false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(document)) next[key] = item;
    let removed = 0;
    if (Array.isArray(document.profiles) && document.profiles.length > 0) {
        removed += document.profiles.length;
        next.profiles = [];
    }
    if (Array.isArray(document.assets)) {
        const kept = document.assets.filter((item) => {
            if (typeof item !== "object" || item === null || !("assetPath" in item) || typeof item.assetPath !== "string") return true;
            return !isManagedPackageTombstone(item.assetPath);
        });
        removed += document.assets.length - kept.length;
        next.assets = kept;
    }
    if (removed === 0) return false;
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    abortIfCompromised();
    try {
        await writeFile(temporaryPath, `${JSON.stringify(next, null, 4)}\n`, "utf8");
        abortIfCompromised();
        await io.rename(temporaryPath, statePath);
        abortIfCompromised();
    } finally {
        await io.rm(temporaryPath, {recursive: true, force: true});
    }
    return true;
}

async function readTolerantInstallManifest(manifestPath: string): Promise<Readonly<{manifest: SystemAssetInstallManifest | null; error: unknown}>> {
    try {
        return {manifest: await readInstallManifest(manifestPath), error: undefined};
    } catch (error) {
        if (!isUnreadableLedgerError(error)) throw error;
        return {manifest: null, error};
    }
}

/** 从磁盘包与 Seed 同 id 包比对 contentHash 重建账本条目：一致 bundled、不一致 dirty、无同 id local。 */
function planLedgerRebuild(seedPackages: readonly SeedPackage[], currentPackages: readonly SeedPackage[]): Readonly<{entries: readonly SystemAgentAssetLedgerEntry[]; bundled: readonly string[]; dirty: readonly string[]; local: readonly string[]}> {
    const seedMap = packageMap(seedPackages);
    const installedAt = new Date().toISOString();
    const entries: SystemAgentAssetLedgerEntry[] = [];
    const bundled: string[] = [];
    const dirty: string[] = [];
    const local: string[] = [];
    for (const currentPackage of currentPackages) {
        const key = assetKey(currentPackage.type, currentPackage.id);
        const seedPackage = seedMap.get(key);
        if (!seedPackage) {
            entries.push(localLedgerEntry(currentPackage));
            local.push(key);
            continue;
        }
        if (seedPackage.contentHash === currentPackage.contentHash) {
            entries.push(bundledLedgerEntry(seedPackage));
            bundled.push(key);
            continue;
        }
        entries.push({
            ...bundledLedgerEntry({...seedPackage, contentHash: currentPackage.contentHash, version: currentPackage.version}),
            installedAt,
            dirtyAt: installedAt,
        });
        dirty.push(key);
    }
    return {entries, bundled, dirty, local};
}

function isUnreadableLedgerError(error: unknown): boolean {
    return error instanceof Error && (error.message.includes("不是有效 JSON") || error.message.includes("manifest schema 无效"));
}

function ledgerUnavailableReason(error: unknown): string {
    return error instanceof Error ? `账本读取失败：${error.message}` : "账本文件缺失";
}

async function assertBundledPackagesClean(current: ReadonlyMap<string, SeedPackage>, ledger: ReadonlyMap<string, SystemAgentAssetLedgerEntry>): Promise<void> {
    for (const [key, entry] of ledger) {
        if (entry.state !== "installed" || entry.origin.kind !== "bundled" || !entry.contentHash) continue;
        const currentPackage = current.get(key);
        if (!currentPackage) {
            throw new Error(`system install bundled package 缺失或被删除：${key}`);
        }
        if (currentPackage.contentHash !== entry.contentHash) {
            throw new Error(`system install package 内容已被修改：${key}`);
        }
    }
}

async function replaceAgentPackages(
    paths: SystemAssetInstallPaths,
    currentManifest: SystemAssetInstallManifest | null,
    candidates: readonly SeedPackage[],
    assets: readonly SystemAgentAssetLedgerEntry[],
    io: ResolvedOperations,
    abortIfCompromised: () => void,
    isCompromised: () => boolean,
): Promise<RecoveryResult> {
    const stagingRoot = path.join(paths.systemNbookRoot, `${TRANSACTION_PREFIX}.staging-${randomUUID()}`);
    const previousRoot = path.join(paths.systemNbookRoot, `${TRANSACTION_PREFIX}.previous-${randomUUID()}`);
    const movedToLive: SeedPackage[] = [];
    let previousReady = false;
    try {
        abortIfCompromised();
        await mkdir(stagingRoot, {recursive: true});
        for (const candidate of candidates) {
            abortIfCompromised();
            await stagePackage(stagingRoot, candidate);
            const staged = installedPackageAt(stagingRoot, candidate);
            if (!staged || (await packageContentHash(staged, candidate.type)) !== candidate.contentHash) {
                throw new Error(`system install package staging 校验失败：${assetKey(candidate.type, candidate.id)}`);
            }
        }
        abortIfCompromised();
        if (currentManifest) {
            await copyManagedEntries(paths.installRoot, previousRoot);
            await writeInstallManifest(path.join(previousRoot, SYSTEM_ASSET_INSTALL_MANIFEST), currentManifest);
            previousReady = true;
        }
        for (const candidate of candidates) {
            abortIfCompromised();
            movedToLive.push(candidate);
            await movePackageUnit(stagingRoot, paths.installRoot, candidate, io);
        }
        abortIfCompromised();
        const manifest = await buildInstallManifest(paths.installRoot, assets);
        await writeInstallManifestAtomic(paths.manifestPath, manifest);
        abortIfCompromised();
        const installed = await readInstallState(paths);
        if (!installed || installed.nbookHash !== manifest.nbookHash || installed.nbookFiles !== manifest.nbookFiles) {
            throw new Error(`system install root 发布后完整性校验失败：${paths.installRoot}`);
        }
    } catch (error) {
        const recoveryErrors: unknown[] = [];
        if (!isCompromised() && !isLockCompromisedError(error)) {
            try {
                if (previousReady) {
                    for (const candidate of movedToLive.reverse()) await removePackageUnit(paths.installRoot, candidate, io);
                    await restoreManagedEntries(previousRoot, paths.installRoot, io);
                } else {
                    for (const candidate of movedToLive.reverse()) await removePackageUnit(paths.installRoot, candidate, io);
                }
            } catch (restoreError) {
                recoveryErrors.push(new Error(`恢复 system install package 失败：${paths.installRoot}`, {cause: restoreError}));
            }
            if (!(await bestEffortRemove(stagingRoot, io))) recoveryErrors.push(new Error(`清理 system install package staging 失败：${stagingRoot}`));
        }
        if (recoveryErrors.length > 0) throw new AggregateError([error, ...recoveryErrors], `system install root 安装失败且恢复未完成：${paths.installRoot}`);
        throw new Error(`system install root 安装失败（旧安装已恢复）：${paths.installRoot}`, {cause: error});
    }
    if (isCompromised()) throw new Error("system asset install lock 已失去所有权，事务已中止");
    const cleanupPending = !(await bestEffortRemove(previousRoot, io));
    if (!(await bestEffortRemove(stagingRoot, io))) return {cleanupPending: true};
    return {cleanupPending};
}
async function stagePackage(stagingRoot: string, candidate: SeedPackage): Promise<void> {
    if (candidate.type === "profile") {
        const target = path.join(stagingRoot, "profiles", ...(candidate.fileName ?? `${candidate.id}.profile.tsx`).split("/"));
        await mkdir(path.dirname(target), {recursive: true});
        await copyFileWithMode(candidate.sourcePath, target);
        const sourceSidecar = profileSidecarPath(candidate.sourcePath);
        if (await directoryExists(sourceSidecar)) await copyTree(sourceSidecar, profileSidecarPath(target));
        return;
    }
    const target = path.join(stagingRoot, candidate.type === "skill" ? "skills" : "workflows", candidate.id);
    await copyTree(candidate.sourcePath, target);
}

async function movePackageUnit(fromRoot: string, toRoot: string, candidate: SeedPackage, io: ResolvedOperations): Promise<void> {
    if (candidate.type === "profile") {
        const fileName = candidate.fileName ?? `${candidate.id}.profile.tsx`;
        const source = path.join(fromRoot, "profiles", ...fileName.split("/"));
        const target = path.join(toRoot, "profiles", ...fileName.split("/"));
        if (await pathExists(source)) {
            await mkdir(path.dirname(target), {recursive: true});
            if (await pathExists(target)) await io.rm(target, {recursive: true, force: true});
            await io.rename(source, target);
        }
        const sourceSidecar = profileSidecarPath(source);
        const targetSidecar = profileSidecarPath(target);
        if (await pathExists(sourceSidecar)) {
            await mkdir(path.dirname(targetSidecar), {recursive: true});
            if (await pathExists(targetSidecar)) await io.rm(targetSidecar, {recursive: true, force: true});
            await io.rename(sourceSidecar, targetSidecar);
        }
        return;
    }
    const directory = candidate.type === "skill" ? "skills" : "workflows";
    const source = path.join(fromRoot, directory, candidate.id);
    const target = path.join(toRoot, directory, candidate.id);
    if (!await pathExists(source)) return;
    await mkdir(path.dirname(target), {recursive: true});
    if (await pathExists(target)) await io.rm(target, {recursive: true, force: true});
    await io.rename(source, target);
}

async function removePackageUnit(root: string, candidate: SeedPackage, io: ResolvedOperations): Promise<void> {
    if (candidate.type === "profile") {
        const fileName = candidate.fileName ?? `${candidate.id}.profile.tsx`;
        await bestEffortRemove(path.join(root, "profiles", ...fileName.split("/")), io);
        await bestEffortRemove(profileSidecarPath(path.join(root, "profiles", ...fileName.split("/"))), io);
        return;
    }
    await bestEffortRemove(path.join(root, candidate.type === "skill" ? "skills" : "workflows", candidate.id), io);
}

async function recoverAgentTransaction(paths: SystemAssetInstallPaths, io: ResolvedOperations, abortIfCompromised: () => void): Promise<RecoveryResult> {
    abortIfCompromised();
    const previous = await listTransactionRoots(paths.systemNbookRoot, TRANSACTION_PREFIX, "previous");
    const staging = await listTransactionRoots(paths.systemNbookRoot, TRANSACTION_PREFIX, "staging");
    const current = await inspectAgentRoot(paths.installRoot);
    const validPrevious: string[] = [];
    const invalidRoots: string[] = [];
    for (const root of previous) {
        abortIfCompromised();
        if (await inspectAgentTransactionRoot(root)) validPrevious.push(root);
        else invalidRoots.push(root);
    }
    for (const root of staging) {
        abortIfCompromised();
        if (await inspectAgentTransactionRoot(root)) validPrevious.push(root);
        else invalidRoots.push(root);
    }
    if (current.kind === "valid") return {cleanupPending: await preserveInvalidTransactionRoots(validPrevious, invalidRoots, paths.systemNbookRoot, TRANSACTION_PREFIX, io)};
    if (current.kind === "dirty") return {cleanupPending: validPrevious.length > 0 || invalidRoots.length > 0};
    if (current.kind === "absent" && validPrevious.length === 0 && invalidRoots.length === 0) return {cleanupPending: false};
    if (validPrevious.length > 1) throw new Error(`system assets 存在多个有效 previous/staging，拒绝猜测：${paths.installRoot}`);
    if (validPrevious.length === 0) {
        if (current.kind === "invalid" && previous.length === 0 && staging.length === 0) return {cleanupPending: false};
        throw new Error(`system assets current 无法证明为可恢复发布残骸：${paths.installRoot}（无有效 previous）`);
    }
    abortIfCompromised();
    const invalidRoot = path.join(paths.systemNbookRoot, `${TRANSACTION_PREFIX}.invalid-${randomUUID()}`);
    if (current.kind === "invalid") await isolateManagedEntries(paths.installRoot, invalidRoot, io);
    abortIfCompromised();
    const candidate = validPrevious[0]!;
    await restoreManagedEntries(candidate, paths.installRoot, io);
    if ((await inspectAgentRoot(paths.installRoot)).kind !== "valid") throw new Error(`system assets 旧安装恢复后完整性校验失败：${paths.installRoot}`);
    return {cleanupPending: await preserveInvalidTransactionRoots(validPrevious.slice(1), invalidRoots, paths.systemNbookRoot, TRANSACTION_PREFIX, io)};
}

async function copyManagedEntries(sourceRoot: string, targetRoot: string): Promise<void> {
    await mkdir(targetRoot, {recursive: true});
    for (const directory of MANAGED_AGENT_DIRECTORIES) {
        const source = path.join(sourceRoot, directory);
        if (await pathExists(source)) await copyTree(source, path.join(targetRoot, directory));
    }
}

async function preserveInvalidTransactionRoots(
    validRoots: readonly string[],
    invalidRoots: readonly string[],
    parent: string,
    prefix: string,
    io: ResolvedOperations,
): Promise<boolean> {
    let pending = false;
    for (const root of invalidRoots) {
        try {
            await io.rename(root, path.join(parent, `${prefix}.invalid-${randomUUID()}`));
        } catch {
            pending = true;
        }
    }
    for (const root of validRoots) if (!(await bestEffortRemove(root, io))) pending = true;
    return pending;
}

function isLockCompromisedError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("lock 已失去所有权");
}

async function inspectAgentTransactionRoot(root: string): Promise<boolean> {
    const manifest = await readInstallManifest(path.join(root, SYSTEM_ASSET_INSTALL_MANIFEST));
    if (!manifest) return false;
    const digest = await hashAgentTree(root).catch(() => null);
    return Boolean(digest && digest.hash === manifest.nbookHash && digest.files === manifest.nbookFiles);
}

async function isolateManagedEntries(fromRoot: string, invalidRoot: string, io: ResolvedOperations): Promise<void> {
    await mkdir(invalidRoot, {recursive: true});
    for (const directory of MANAGED_AGENT_DIRECTORIES) {
        const source = path.join(fromRoot, directory);
        if (!await pathExists(source)) continue;
        await io.rename(source, path.join(invalidRoot, directory));
    }
    const manifest = path.join(fromRoot, SYSTEM_ASSET_INSTALL_MANIFEST);
    if (await pathExists(manifest)) await io.rename(manifest, path.join(invalidRoot, SYSTEM_ASSET_INSTALL_MANIFEST));
}

async function restoreManagedEntries(fromRoot: string, toRoot: string, io: ResolvedOperations): Promise<void> {
    await mkdir(toRoot, {recursive: true});
    for (const directory of ["skills", "workflows"] as const) {
        const source = path.join(fromRoot, directory);
        const target = path.join(toRoot, directory);
        if (await pathExists(target)) await io.rm(target, {recursive: true, force: true});
        if (await pathExists(source)) await copyTree(source, target);
    }
    const targetProfiles = path.join(toRoot, "profiles");
    for (const file of await collectProfileFiles(targetProfiles)) {
        await io.rm(file, {recursive: true, force: true});
        const sidecar = profileSidecarPath(file);
        if (await pathExists(sidecar)) await io.rm(sidecar, {recursive: true, force: true});
    }
    const sourceProfiles = path.join(fromRoot, "profiles");
    for (const file of await collectProfileFiles(sourceProfiles)) {
        const relative = path.relative(sourceProfiles, file);
        const target = path.join(targetProfiles, relative);
        await copyFileWithMode(file, target);
        const sidecar = profileSidecarPath(file);
        if (await directoryExists(sidecar)) await copyTree(sidecar, profileSidecarPath(target));
    }
    const sourceManifest = path.join(fromRoot, SYSTEM_ASSET_INSTALL_MANIFEST);
    if (!await pathExists(sourceManifest)) throw new Error(`previous snapshot 缺少安装 manifest：${fromRoot}`);
    await copyFileWithMode(sourceManifest, path.join(toRoot, SYSTEM_ASSET_INSTALL_MANIFEST));
}

async function recoverReferenceTransaction(paths: SystemAssetInstallPaths, io: ResolvedOperations, abortIfCompromised: () => void): Promise<RecoveryResult> {
    abortIfCompromised();
    const previous = await listTransactionRoots(paths.systemNbookRoot, REFERENCE_TRANSACTION_PREFIX, "previous");
    const staging = await listTransactionRoots(paths.systemNbookRoot, REFERENCE_TRANSACTION_PREFIX, "staging");
    const current = await inspectReferenceRoot(paths.systemReferenceRoot);
    const validPrevious: string[] = [];
    const invalidRoots: string[] = [];
    for (const root of [...previous, ...staging]) {
        abortIfCompromised();
        if ((await inspectReferenceRoot(root)).kind === "valid") validPrevious.push(root);
        else invalidRoots.push(root);
    }
    if (current.kind === "valid") return {cleanupPending: await preserveInvalidTransactionRoots(validPrevious, invalidRoots, paths.systemNbookRoot, REFERENCE_TRANSACTION_PREFIX, io)};
    if (current.kind === "dirty") return {cleanupPending: validPrevious.length > 0 || invalidRoots.length > 0};
    if (current.kind === "absent" && validPrevious.length === 0 && invalidRoots.length === 0) return {cleanupPending: false};
    if (validPrevious.length > 1) throw new Error(`system Reference 存在多个有效 previous/staging，拒绝猜测：${paths.systemReferenceRoot}`);
    if (validPrevious.length === 0) throw new Error(`system Reference current 无有效事务可恢复：${paths.systemReferenceRoot}`);
    abortIfCompromised();
    if (current.kind === "invalid") await io.rename(paths.systemReferenceRoot, path.join(paths.systemNbookRoot, `${REFERENCE_TRANSACTION_PREFIX}.invalid-${randomUUID()}`));
    abortIfCompromised();
    await io.rename(validPrevious[0]!, paths.systemReferenceRoot);
    if ((await inspectReferenceRoot(paths.systemReferenceRoot)).kind !== "valid") throw new Error(`system Reference 旧安装恢复后完整性校验失败：${paths.systemReferenceRoot}`);
    return {cleanupPending: await preserveInvalidTransactionRoots(validPrevious.slice(1), invalidRoots, paths.systemNbookRoot, REFERENCE_TRANSACTION_PREFIX, io)};
}

async function replaceReferenceTree(paths: SystemAssetInstallPaths, sourceRoot: string, manifest: SystemReferenceInstallManifest, io: ResolvedOperations, abortIfCompromised: () => void, isCompromised: () => boolean): Promise<RecoveryResult> {
    const stagingRoot = path.join(paths.systemNbookRoot, `${REFERENCE_TRANSACTION_PREFIX}.staging-${randomUUID()}`);
    const previousRoot = path.join(paths.systemNbookRoot, `${REFERENCE_TRANSACTION_PREFIX}.previous-${randomUUID()}`);
    try {
        abortIfCompromised();
        await copyTree(sourceRoot, stagingRoot);
        await writeReferenceManifest(path.join(stagingRoot, SYSTEM_REFERENCE_INSTALL_MANIFEST), manifest);
        abortIfCompromised();
        if (await pathExists(paths.systemReferenceRoot)) await io.rename(paths.systemReferenceRoot, previousRoot);
        abortIfCompromised();
        await io.rename(stagingRoot, paths.systemReferenceRoot);
        if ((await inspectReferenceRoot(paths.systemReferenceRoot)).kind !== "valid") throw new Error(`system Reference root 发布后完整性校验失败：${paths.systemReferenceRoot}`);
    } catch (error) {
        if (isCompromised() || isLockCompromisedError(error)) throw error;
        const recoveryErrors: unknown[] = [];
        try {
            if (await pathExists(paths.systemReferenceRoot)) await io.rm(paths.systemReferenceRoot, {recursive: true, force: true});
            if (await pathExists(previousRoot)) await io.rename(previousRoot, paths.systemReferenceRoot);
        } catch (restoreError) {
            recoveryErrors.push(restoreError);
        }
        if (!(await bestEffortRemove(stagingRoot, io))) recoveryErrors.push(new Error(`清理 system Reference staging 失败：${stagingRoot}`));
        if (recoveryErrors.length > 0) throw new AggregateError([error, ...recoveryErrors], `system Reference 安装失败且恢复未完成：${paths.systemReferenceRoot}`);
        throw new Error(`system Reference 安装失败（旧安装已恢复）：${paths.systemReferenceRoot}`, {cause: error});
    }
    if (isCompromised()) throw new Error("system asset install lock 已失去所有权，事务已中止");
    return {cleanupPending: !(await bestEffortRemove(previousRoot, io))};
}

async function inspectAgentRoot(root: string): Promise<RootInspection<SystemAssetInstallManifest>> {
    if (!await pathExists(root)) return {kind: "absent"};
    try {
        await assertRealDirectory(root, "system install root");
        const manifest = await readInstallManifest(path.join(root, SYSTEM_ASSET_INSTALL_MANIFEST));
        if (!manifest) return {kind: "invalid", reason: "缺少 install manifest"};
        const digest = await hashAgentTree(root);
        if (digest.hash !== manifest.nbookHash || digest.files !== manifest.nbookFiles) return {kind: "dirty", manifest};
        return {kind: "valid", manifest};
    } catch (error) {
        return {kind: "invalid", reason: error instanceof Error ? error.message : String(error)};
    }
}

async function inspectReferenceRoot(root: string): Promise<RootInspection<SystemReferenceInstallManifest>> {
    if (!await pathExists(root)) return {kind: "absent"};
    try {
        await assertRealDirectory(root, "system Reference root");
        const manifest = await readReferenceManifest(path.join(root, SYSTEM_REFERENCE_INSTALL_MANIFEST));
        if (!manifest) return {kind: "invalid", reason: "缺少 Reference manifest"};
        const digest = await hashReferenceTree(root);
        if (digest.hash !== manifest.referenceHash || digest.files !== manifest.referenceFiles) return {kind: "dirty", manifest};
        return {kind: "valid", manifest};
    } catch (error) {
        return {kind: "invalid", reason: error instanceof Error ? error.message : String(error)};
    }
}

async function readInstallState(paths: SystemAssetInstallPaths): Promise<SystemAssetInstallManifest | null> {
    const state = await inspectAgentRoot(paths.installRoot);
    if (state.kind === "absent") return null;
    if (state.kind === "invalid") throw new Error(`system install root 缺少有效安装账本：${paths.installRoot}（${state.reason}）`);
    if (state.kind === "dirty") throw new Error(`system install root 内容已被修改：${paths.installRoot}`);
    return state.manifest;
}

async function readReferenceState(paths: SystemAssetInstallPaths): Promise<SystemReferenceInstallManifest | null> {
    const state = await inspectReferenceRoot(paths.systemReferenceRoot);
    if (state.kind === "absent") return null;
    if (state.kind === "invalid") throw new Error(`system Reference root 缺少有效 manifest：${paths.systemReferenceRoot}（${state.reason}）`);
    if (state.kind === "dirty") throw new Error(`system Reference root 内容已被修改：${paths.systemReferenceRoot}`);
    return state.manifest;
}

async function readInstallManifest(filePath: string): Promise<SystemAssetInstallManifest | null> {
    const value = await readJsonManifest(filePath, "system install manifest");
    if (value === null) return null;
    if (!isInstallManifest(value)) throw new Error(`system install manifest schema 无效：${filePath}`);
    return value;
}

async function readReferenceManifest(filePath: string): Promise<SystemReferenceInstallManifest | null> {
    const value = await readJsonManifest(filePath, "system Reference manifest");
    if (value === null) return null;
    if (!isReferenceManifest(value)) throw new Error(`system Reference manifest schema 无效：${filePath}`);
    return value;
}

async function readJsonManifest(filePath: string, label: string): Promise<unknown | null> {
    const text = await readFile(filePath, "utf8").catch((error: unknown) => isErrorCode(error, "ENOENT") ? null : Promise.reject(error));
    if (text === null) return null;
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} 不是有效 JSON：${filePath}`, {cause: error});
    }
}

async function writeInstallManifest(filePath: string, manifest: SystemAssetInstallManifest): Promise<void> {
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
}

async function writeInstallManifestAtomic(filePath: string, manifest: SystemAssetInstallManifest): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        await writeInstallManifest(temporaryPath, manifest);
        await rename(temporaryPath, filePath);
    } finally {
        await rm(temporaryPath, {force: true});
    }
}

async function writeReferenceManifest(filePath: string, manifest: SystemReferenceInstallManifest): Promise<void> {
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
}

async function buildInstallManifest(root: string, assets: readonly SystemAgentAssetLedgerEntry[]): Promise<SystemAssetInstallManifest> {
    const digest = await hashAgentTree(root);
    return {
        schema: SYSTEM_ASSET_INSTALL_SCHEMA,
        schemaVersion: 1,
        assets: [...assets].sort(compareLedgerEntries),
        nbookHash: digest.hash,
        nbookFiles: digest.files,
    };
}

async function hashAgentTree(root: string): Promise<TreeDigest> {
    await assertRealDirectory(root, "system install root");
    const entries: string[] = [];
    let files = 0;
    for (const directory of MANAGED_AGENT_DIRECTORIES) {
        const child = path.join(root, directory);
        if (!await directoryExists(child)) continue;
        const digest = await collectTreeEntries(child, directory, new Set());
        entries.push(...digest.entries);
        files += digest.files;
    }
    return digestEntries(entries, files);
}

async function hashReferenceTree(root: string): Promise<TreeDigest> {
    await assertSeedDirectory(root, "Reference");
    const digest = await collectTreeEntries(root, "", new Set([SYSTEM_REFERENCE_INSTALL_MANIFEST]));
    return digestEntries(digest.entries, digest.files);
}

async function packageContentHash(root: string, type: SystemAgentAssetType): Promise<string> {
    return (await (type === "profile" ? hashProfilePackage(root) : hashTree(root))).hash;
}

async function hashProfilePackage(filePath: string): Promise<TreeDigest> {
    const source = await readFile(filePath);
    const entries = [`entry\0${source.byteLength}\0${sha256(source)}`];
    let files = 1;
    const sidecar = profileSidecarPath(filePath);
    if (await directoryExists(sidecar)) {
        const digest = await collectTreeEntries(sidecar, "sidecar", new Set());
        entries.push(...digest.entries);
        files += digest.files;
    }
    return digestEntries(entries, files);
}

async function hashTree(root: string): Promise<TreeDigest> {
    await assertRealDirectory(root, "system assets");
    const digest = await collectTreeEntries(root, "", new Set());
    return digestEntries(digest.entries, digest.files);
}

async function collectTreeEntries(root: string, relativeRoot: string, excludedFiles: ReadonlySet<string>): Promise<{entries: string[]; files: number}> {
    const entries: string[] = [];
    let files = 0;
    const collect = async (current: string, base: string): Promise<void> => {
        for (const entry of (await readdir(current, {withFileTypes: true})).sort((left, right) => left.name.localeCompare(right.name))) {
            const relativePath = base ? path.posix.join(base, entry.name) : entry.name;
            if (excludedFiles.has(relativePath) || isGeneratedPath(relativePath)) continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await collect(fullPath, relativePath);
            } else if (entry.isFile()) {
                const content = await readFile(fullPath);
                entries.push(`${relativePath.replaceAll("\\", "/")}\0${content.byteLength}\0${sha256(content)}`);
                files += 1;
            } else {
                throw new Error(`system assets 不允许特殊文件或符号链接：${fullPath}`);
            }
        }
    };
    await collect(root, relativeRoot);
    return {entries, files};
}

function digestEntries(entries: readonly string[], files: number): TreeDigest {
    return {hash: sha256(entries.join("\0")), files};
}

function sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

async function copyTree(sourceRoot: string, targetRoot: string): Promise<void> {
    const sourceStats = await lstat(sourceRoot);
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) throw new Error(`system assets seed 必须是真实目录：${sourceRoot}`);
    await mkdir(targetRoot, {recursive: true});
    for (const entry of (await readdir(sourceRoot, {withFileTypes: true})).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name === ".compiled" || entry.name === ".staging" || entry.name === "node_modules") continue;
        const sourcePath = path.join(sourceRoot, entry.name);
        const targetPath = path.join(targetRoot, entry.name);
        if (entry.isDirectory()) await copyTree(sourcePath, targetPath);
        else if (entry.isFile()) await copyFileWithMode(sourcePath, targetPath);
        else throw new Error(`system assets seed 不允许特殊文件或符号链接：${sourcePath}`);
    }
}

async function copyFileWithMode(sourcePath: string, targetPath: string): Promise<void> {
    await mkdir(path.dirname(targetPath), {recursive: true});
    await copyFile(sourcePath, targetPath);
    const stats = await lstat(sourcePath);
    await chmod(targetPath, stats.mode & 0o777);
}

async function discoverAgentPackagesIfPresent(root: string): Promise<SeedPackage[]> {
    return await pathExists(root) ? discoverAgentPackages(root) : [];
}

async function discoverAgentPackages(root: string): Promise<SeedPackage[]> {
    await assertRealDirectory(root, "system assets agent root");
    const packages: SeedPackage[] = [];
    for (const [type, directory] of [["skill", "skills"], ["workflow", "workflows"]] as const) {
        const parent = path.join(root, directory);
        if (!await pathExists(parent)) {
            continue;
        }
        await assertRealDirectory(parent, `system assets ${directory} root`);
        for (const entry of await readDirectoryEntries(parent)) {
            const packagePath = path.join(parent, entry.name);
            if (entry.isSymbolicLink() || !entry.isDirectory()) {
                throw new Error(`system assets ${type} package 不允许特殊文件或符号链接：${packagePath}`);
            }
            if (type === "skill" && !await hasAnyFile(packagePath, ["SKILL.md", "skill.md"])) {
                throw new Error(`system assets skill package 缺少 SKILL.md：${packagePath}`);
            }
            if (type === "workflow" && !await isRegularFile(path.join(packagePath, "workflow.ts"))) {
                throw new Error(`system assets workflow package 缺少 workflow.ts：${packagePath}`);
            }
            packages.push({
                type,
                id: entry.name,
                sourcePath: packagePath,
                version: type === "skill" ? await readPackageVersion(packagePath) : undefined,
                contentHash: (await hashTree(packagePath)).hash,
            });
        }
    }
    const profilesRoot = path.join(root, "profiles");
    if (await pathExists(profilesRoot)) {
        await assertRealDirectory(profilesRoot, "system assets profiles root");
        for (const file of await collectProfileFiles(profilesRoot)) {
            const fileName = path.relative(profilesRoot, file).split(path.sep).join("/");
            packages.push({
                type: "profile",
                id: await readProfileId(file),
                sourcePath: file,
                fileName,
                contentHash: (await hashProfilePackage(file)).hash,
            });
        }
    }
    return packages.sort((left, right) => assetKey(left.type, left.id).localeCompare(assetKey(right.type, right.id)));
}

async function collectProfileFiles(root: string): Promise<string[]> {
    if (!await pathExists(root)) return [];
    await assertRealDirectory(root, "system profile seed root");
    const result: string[] = [];
    const visit = async (current: string): Promise<void> => {
        for (const entry of await readdir(current, {withFileTypes: true})) {
            if (entry.name === ".compiled" || entry.name === ".staging" || entry.name === "node_modules") continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) await visit(fullPath);
            else if (entry.isFile() && PROFILE_FILE_PATTERN.test(entry.name)) result.push(fullPath);
            else if (!entry.isFile()) throw new Error(`system profile seed 不允许特殊文件或符号链接：${fullPath}`);
        }
    };
    await visit(root);
    return result.sort((left, right) => left.localeCompare(right));
}

function localLedgerEntry(candidate: SeedPackage): SystemAgentAssetLedgerEntry {
    return {
        type: candidate.type,
        id: candidate.id,
        state: "installed",
        origin: {kind: "local"},
        contentHash: candidate.contentHash,
        ...(candidate.fileName ? {fileName: candidate.fileName} : {}),
        ...(candidate.version ? {version: candidate.version} : {}),
        installedAt: new Date().toISOString(),
    };
}

async function readProfileId(filePath: string): Promise<string> {
    const source = await readFile(filePath, "utf8");
    const match = source.match(/(?:key|profileKey)\s*:\s*["'`]([^"'`]+)["'`]/u);
    return match?.[1] ?? path.basename(filePath).replace(PROFILE_FILE_PATTERN, "");
}

async function readPackageVersion(root: string): Promise<string | undefined> {
    const text = await readFile(path.join(root, "package.json"), "utf8").catch(() => null);
    if (!text) return undefined;
    try {
        const value = JSON.parse(text) as {version?: unknown};
        return typeof value.version === "string" && value.version.trim() ? value.version.trim() : undefined;
    } catch {
        return undefined;
    }
}

function bundledLedgerEntry(candidate: SeedPackage, previous?: SystemAgentAssetLedgerEntry): SystemAgentAssetLedgerEntry {
    return {
        type: candidate.type,
        id: candidate.id,
        state: "installed",
        origin: {kind: "bundled"},
        contentHash: candidate.contentHash,
        ...(candidate.fileName ? {fileName: candidate.fileName} : {}),
        ...(candidate.version ? {version: candidate.version} : {}),
        installedAt: previous?.installedAt ?? new Date().toISOString(),
    };
}

function packageMap(packages: readonly SeedPackage[]): Map<string, SeedPackage> {
    return new Map(packages.map((item) => [assetKey(item.type, item.id), item]));
}

function assetKey(type: SystemAgentAssetType, id: string): string {
    return `${type}:${id}`;
}

function compareLedgerEntries(left: SystemAgentAssetLedgerEntry, right: SystemAgentAssetLedgerEntry): number {
    return assetKey(left.type, left.id).localeCompare(assetKey(right.type, right.id));
}

function installedPackageAt(root: string, candidate: SeedPackage): string | null {
    if (candidate.type === "profile") return path.join(root, "profiles", ...(candidate.fileName ?? `${candidate.id}.profile.tsx`).split("/"));
    return path.join(root, candidate.type === "skill" ? "skills" : "workflows", candidate.id);
}

function profileSidecarPath(filePath: string): string {
    return path.join(path.dirname(filePath), `${path.basename(filePath).replace(PROFILE_SIDEcar_PATTERN, "")}.home`);
}

async function pathExists(target: string): Promise<boolean> {
    return (await pathStat(target)) !== null;
}

async function directoryExists(target: string): Promise<boolean> {
    const stats = await pathStat(target);
    return Boolean(stats?.isDirectory() && !stats.isSymbolicLink());
}

async function pathStat(target: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
    return lstat(target).catch((error: unknown) => isErrorCode(error, "ENOENT") ? null : Promise.reject(error));
}

async function readDirectoryEntries(root: string): Promise<DirectoryEntry[]> {
    return readdir(root, {withFileTypes: true}).catch((error: unknown) => isErrorCode(error, "ENOENT") ? [] : Promise.reject(error));
}
async function isRegularFile(target: string): Promise<boolean> {
    const stats = await pathStat(target);
    return Boolean(stats?.isFile() && !stats.isSymbolicLink());
}

async function hasAnyFile(root: string, names: readonly string[]): Promise<boolean> {
    for (const name of names) if (await isRegularFile(path.join(root, name))) return true;
    return false;
}


async function assertSeedDirectory(root: string, label: string): Promise<void> {
    const stats = await lstat(path.resolve(root)).catch((error: unknown) => {
        if (isErrorCode(error, "ENOENT")) throw new Error(`system assets ${label} 不存在：${path.resolve(root)}`);
        throw error;
    });
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`system assets ${label} 必须是真实目录：${path.resolve(root)}`);
}

async function assertRealDirectory(root: string, label: string): Promise<void> {
    const stats = await lstat(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} 必须是真实目录：${root}`);
}

async function listTransactionRoots(parent: string, prefix: string, kind: "previous" | "staging"): Promise<string[]> {
    const entries = await readDirectoryEntries(parent);
    const expected = `${prefix}.${kind}-`;
    const roots: string[] = [];
    for (const entry of entries) {
        if (!entry.name.startsWith(expected) || !TRANSACTION_ARTIFACT_PATTERN.test(entry.name)) continue;
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`system assets 事务残留不是安全目录：${path.join(parent, entry.name)}`);
        roots.push(path.join(parent, entry.name));
    }
    return roots.sort((left, right) => left.localeCompare(right));
}

async function cleanupTransactionRoots(roots: readonly string[], io: ResolvedOperations): Promise<boolean> {
    let pending = false;
    for (const root of roots) if (!(await bestEffortRemove(root, io))) pending = true;
    return pending;
}

async function bestEffortRemove(root: string, io: ResolvedOperations): Promise<boolean> {
    try {
        await io.rm(root, {recursive: true, force: true});
        return true;
    } catch {
        return false;
    }
}

function resolveSeedPaths(applicationRoot: string, override: unknown): SystemAssetSeedPaths {
    const defaults = getSystemAssetSeedPaths(applicationRoot);
    if (override === undefined) return defaults;
    if (!isRecord(override)) throw new TypeError("seed 必须是对象");
    const allowed = new Set(["seedNbookRoot", "seedReferenceRoot", "kind"]);
    for (const key of Object.keys(override)) if (!allowed.has(key)) throw new TypeError(`seed 包含未知字段：${key}`);
    return Object.freeze({
        seedNbookRoot: readSeedPath(override, "seedNbookRoot", defaults.seedNbookRoot),
        seedReferenceRoot: readSeedPath(override, "seedReferenceRoot", defaults.seedReferenceRoot),
        kind: readSeedKind(override, defaults.kind),
    });
}

function readSeedPath(record: Record<string, unknown>, key: "seedNbookRoot" | "seedReferenceRoot", fallback: string): string {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return fallback;
    const value = record[key];
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`seed.${key} 必须是非空字符串`);
    return value;
}

function readSeedKind(record: Record<string, unknown>, fallback: SystemAssetSeedPaths["kind"]): SystemAssetSeedPaths["kind"] {
    if (!Object.prototype.hasOwnProperty.call(record, "kind")) return fallback;
    const value = record.kind;
    if (value !== "source" && value !== "product") throw new TypeError("seed.kind 必须是 source 或 product");
    return value;
}

function createInstallPaths(installRoot: string): SystemAssetInstallPaths {
    const normalizedInstallRoot = path.resolve(installRoot);
    const systemNbookRoot = path.dirname(normalizedInstallRoot);
    return Object.freeze({
        installRoot: normalizedInstallRoot,
        systemNbookRoot,
        systemReferenceRoot: path.join(systemNbookRoot, "reference"),
        manifestPath: path.join(normalizedInstallRoot, SYSTEM_ASSET_INSTALL_MANIFEST),
        referenceManifestPath: path.join(systemNbookRoot, "reference", SYSTEM_REFERENCE_INSTALL_MANIFEST),
        lockPath: path.join(systemNbookRoot, INSTALL_LOCK_FILE),
    });
}

function resolveOperations(operations: SystemAssetInstallOperations): ResolvedOperations {
    if (!isRecord(operations)) throw new TypeError("system asset install operations 必须是对象");
    if (operations.rename !== undefined && typeof operations.rename !== "function") throw new TypeError("system asset install operations.rename 必须是函数");
    if (operations.rm !== undefined && typeof operations.rm !== "function") throw new TypeError("system asset install operations.rm 必须是函数");
    return {rename: operations.rename ?? defaultOperations.rename, rm: operations.rm ?? defaultOperations.rm};
}

function isGeneratedPath(relativePath: string): boolean {
    const normalized = relativePath.replaceAll("\\", "/");
    const segments = normalized.split("/");
    return segments.includes(".compiled")
        || segments.includes(".staging")
        || segments.includes("node_modules")
        || normalized === "profiles/.system-profile-metadata.json"
        || normalized === SYSTEM_ASSET_INSTALL_MANIFEST
        || normalized === SYSTEM_REFERENCE_INSTALL_MANIFEST;
}

function isInstallManifest(value: unknown): value is SystemAssetInstallManifest {
    if (!isRecord(value) || value.schema !== SYSTEM_ASSET_INSTALL_SCHEMA || value.schemaVersion !== 1 || !Array.isArray(value.assets)) return false;
    return value.assets.every(isLedgerEntry) && typeof value.nbookHash === "string" && Number.isInteger(value.nbookFiles);
}

function isLedgerEntry(value: unknown): value is SystemAgentAssetLedgerEntry {
    if (!isRecord(value) || (value.type !== "skill" && value.type !== "workflow" && value.type !== "profile") || typeof value.id !== "string" || !value.id || (value.state !== "installed" && value.state !== "removed") || !isRecord(value.origin) || typeof value.origin.kind !== "string") return false;
    return ["bundled", "workshop", "git", "local"].includes(value.origin.kind)
        && (value.contentHash === undefined || typeof value.contentHash === "string")
        && (value.fileName === undefined || typeof value.fileName === "string")
        && (value.dirtyAt === undefined || typeof value.dirtyAt === "string");
}

function isReferenceManifest(value: unknown): value is SystemReferenceInstallManifest {
    return isRecord(value) && value.schema === SYSTEM_REFERENCE_INSTALL_SCHEMA && typeof value.referenceHash === "string" && Number.isInteger(value.referenceFiles);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
