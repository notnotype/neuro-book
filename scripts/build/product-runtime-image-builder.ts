import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {
    lstat,
    mkdir,
    readFile,
    readdir,
    readlink,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import {promisify} from "node:util";
import {lock as acquireFileLock} from "proper-lockfile";
import {resolve} from "node:path";
import {existsSync as existsSyncPath} from "node:fs";
import type {ProductPlatform} from "@notnotype/neuro-book-contracts/platform";
import {readApplicationPackageManifest} from "#scripts/utils/application-package";
import {SOURCE_APPLICATION_RELATIVE_PATH} from "#scripts/utils/workspace-roots";
import {assertProductRuntimeModuleClosure} from "#scripts/build/product-runtime-module-closure.mjs";
import {
    parseProductRuntimeContract,
    PRODUCT_RUNTIME_CONTRACT_PATH,
    productRuntimeContractSha256,
} from "@notnotype/neuro-book-contracts/product-runtime";
import {
    assertProductRuntimeBudget as assertBudget,
    assertProductRuntimeContainedPath as assertContainedPath,
    assertProductRuntimeGlobalBudget as assertGlobalBudget,
    assertProductRuntimePlatform as assertPlatform,
    assertProductRuntimePolicy as assertPolicyWithinCanonical,
    canonicalProductRuntimeJson as canonicalJson,
    createProductRuntimePolicy as runtimeImagePolicy,
    hasProductRuntimeBuildPolicy,
    normalizeProductRuntimeBudget as normalizeBudget,
    normalizeProductRuntimeOwners as normalizeOwners,
    normalizeProductRuntimeRelativePath as normalizeRelativePath,
    productRuntimeBuildPolicy,
    productRuntimeOwners,
    PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
    PRODUCT_RUNTIME_IMAGE_MANIFEST_SCHEMA,
    PRODUCT_RUNTIME_IMAGE_READY_SCHEMA,
    PRODUCT_RUNTIME_MAX_BYTES,
    PRODUCT_RUNTIME_MAX_FILES,
    sha256ProductRuntimeText as sha256Text,
} from "@notnotype/neuro-book-contracts/product-runtime";
import {
    assertProductRuntimeContractFiles,
    inspectProductRuntimeImage as inspectRuntimeImage,
    productRuntimeFileDigest as sha256File,
    readProductRuntimeControlFile as readControlFile,
    ProductRuntimeImageVerifier,
} from "@notnotype/neuro-book/product-verification";
import type {
    ProductRuntimeBuildPolicy,
    ProductRuntimeExpectedIdentity,
    ProductRuntimeGlobalBudget,
    ProductRuntimeImageBudget,
    ProductRuntimeImageManifest,
    ProductRuntimeImageOwner,
    ProductRuntimeFileRecord,
    ProductRuntimeInspection,
    ProductRuntimeOwnerBaseline,
    VerifiedProductRuntimeImage,
} from "@notnotype/neuro-book-contracts/product-runtime";

export {
    hasProductRuntimeBuildPolicy,
    productRuntimeBuildPolicy,
    PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
    PRODUCT_RUNTIME_MAX_BYTES,
    PRODUCT_RUNTIME_MAX_FILES,
} from "@notnotype/neuro-book-contracts/product-runtime";
export type {
    ProductRuntimeBuildPolicy,
    ProductRuntimeExpectedIdentity,
    ProductRuntimeGlobalBudget,
    ProductRuntimeImageBudget,
    ProductRuntimeImageManifest,
    ProductRuntimeImageOwner,
    ProductRuntimeOwnerBaseline,
    VerifiedProductRuntimeImage,
} from "@notnotype/neuro-book-contracts/product-runtime";


const execFileAsync = promisify(execFile);
const MANIFEST_FILE = "runtime-image.json";
const READY_FILE = "runtime-image.ready";
const MANIFEST_SCHEMA = PRODUCT_RUNTIME_IMAGE_MANIFEST_SCHEMA;
const READY_SCHEMA = PRODUCT_RUNTIME_IMAGE_READY_SCHEMA;
export const PRODUCT_RUNTIME_MEASUREMENT_SCHEMA = "nbook.product-runtime-image-measurement/v3";
const BUILDER_CONTRACT_VERSION = PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION;
const STAGING_LEASE_STALE_MS = 24 * 60 * 60 * 1000;
const STAGING_LEASE_UPDATE_MS = 60 * 1000;
const STAGING_OWNER_SCHEMA = "nbook.product-runtime-image-staging-owner/v1";
const GITLESS_SOURCE_EXCLUDES = new Set([
    ".agent", ".cache", ".deploy", ".git", ".nuxt", ".output", ".runtime",
    "coverage", "dist", "logs", "node_modules", "tmp", "workspace",
]);
const GITLESS_SOURCE_PATH_EXCLUDES = new Set(["server/generated/prisma"]);

function isGitlessSourceExcluded(segments: readonly string[], entryName: string): boolean {
    const relativePath = [...segments, entryName].join("/");
    // 通用生成态目录必须在任意深度排除：monorepo 收敛后应用生成物位于
    // packages/<app>/node_modules/.cache/nuxt/.nuxt 等嵌套路径，仅根层短路
    // 会让构建期写入的缓存进入 Source 身份并误报「Source 输入发生变化」。
    return GITLESS_SOURCE_EXCLUDES.has(entryName)
        || GITLESS_SOURCE_PATH_EXCLUDES.has(relativePath)
        || (segments[0] === "packages" && (entryName === "data.db" || entryName.startsWith("data.db-")))
        || (segments[0] === "packages" && relativePath.endsWith("/server/generated/prisma"));
}
/** 调用方在构建前已经锁定、需要 Builder 复核的 Source 身份。 */
export interface ProductRuntimeBuildExpectation {
    /** 未提供时使用应用 identity manifest 中的版本。 */
    version?: string;
    /** 未提供时使用当前 Git HEAD。 */
    revision?: string;
    /** 正式发行应显式传 false；本地验收可以不限制。 */
    dirty?: boolean;
    /** 未提供时仅使用 request.platform。 */
    lockfileSha256?: string;
}

/** 构建回调只能向本次 operation 的候选根与临时根写入。 */
export interface ProductRuntimeBuildContext {
    imageRoot: string;
    /**
     * 与候选共享 lease 的临时目录。回调可以按需创建子目录；Builder 会在清点
     * payload 前删除它，进程硬中断后则随整个候选一起由 stale sweep 回收。
     */
    scratchRoot: string;
    operationId: string;
    /** 构建开始前锁定的完整 Source 内容身份；用于派生可复现的 Product 构建字段。 */
    sourceDigest: string;
}

/** 创建一个隔离候选镜像所需的完整请求。 */
export interface ProductRuntimeBuildRequest {
    operationId: string;
    platform: ProductPlatform;
    owners: readonly ProductRuntimeImageOwner[];
    budget: ProductRuntimeImageBudget;
    expectedSource?: ProductRuntimeBuildExpectation;
    build(context: ProductRuntimeBuildContext): Promise<void>;
}

/** 未登记平台只允许走该测量请求；调用方不能注入 owner 或放宽全局硬预算。 */
export interface ProductRuntimeMeasurementRequest {
    operationId: string;
    platform: ProductPlatform;
    expectedSource?: ProductRuntimeBuildExpectation;
    build(context: ProductRuntimeBuildContext): Promise<void>;
}

/** measurement-only 的完整结果；它不是可启动、可发布或可由 openVerified 打开的镜像。 */
export interface ProductRuntimeMeasurementReport {
    schema: typeof PRODUCT_RUNTIME_MEASUREMENT_SCHEMA;
    builderContractVersion: typeof BUILDER_CONTRACT_VERSION;
    version: string;
    revision: string;
    dirty: boolean;
    platform: ProductPlatform;
    lockfileSha256: string;
    sourceDigest: string;
    runtime: ProductRuntimeImageManifest["runtime"];
    runtimeContract: ProductRuntimeImageManifest["runtimeContract"];
    policy: {
        registered: boolean;
        owners: ProductRuntimeImageOwner[];
        globalBudget: ProductRuntimeGlobalBudget;
    };
    inventory: ProductRuntimeImageManifest["inventory"];
    treeDigest: string;
    shapeDigest: string;
    evidence: {
        /** 对最终 native islands 和全部可执行 ESM 根的结构化复核结果。 */
        moduleClosure: Awaited<ReturnType<typeof assertProductRuntimeModuleClosure>>;
        /** 按路径排序的逐文件大小、mode 与 SHA-256，用于定位 A/B 漂移。 */
        payloadFiles: ProductRuntimeFileRecord[];
    };
    measuredAt: string;
}

interface SourceSnapshot {
    version: string;
    revision: string;
    dirty: boolean;
    lockfileSha256: string;
    sourceDigest: string;
    /** 仅供构建竞态诊断；不会写入 Runtime Image manifest。 */
    sourceEntries: Map<string, string>;
    /** 用于报告构建期间新增、删除或状态变化的 dirty path。 */
    statusResult: string;
}

/** buildCandidate 与 measureCandidate 共用的候选检查结果。 */
interface InspectedProductRuntimeCandidate {
    imageRoot: string;
    source: SourceSnapshot;
    inspection: ProductRuntimeInspection;
    runtime: ProductRuntimeImageManifest["runtime"];
    runtimeContractText: string;
}

interface ReadyMarker {
    schema: typeof READY_SCHEMA;
    imageId: string;
    manifestSha256: string;
}

/**
 * 统一拥有 Product Runtime Image 的候选构建与身份生成。
 *
 * 写侧区分正式 `buildCandidate` 与不可发布的 `measureCandidate`；只读验证委托给共享 Verifier。
 * 调用方不能绕过 Source 竞态检查自行写 manifest，也不能把“目录存在”误当成 ready。
 */
export type ProductRuntimeImageBuilderOptions = Readonly<{
    repositoryRoot: string;
    applicationSourceRoot: string;
    deployRoot?: string;
}>;

export class ProductRuntimeImageBuilder {
    private readonly repositoryRoot: string;
    private readonly applicationSourceRoot: string;
    private readonly deployRoot: string;

    /** 绑定 repository/application source/deploy 三个 owner 根；字符串仅保留 fixture 兼容。 */
    constructor(options: ProductRuntimeImageBuilderOptions | string) {
        if (typeof options === "string") {
            this.repositoryRoot = resolve(options);
            const migratedApplicationRoot = resolve(this.repositoryRoot, SOURCE_APPLICATION_RELATIVE_PATH);
            this.applicationSourceRoot = existsSyncPath(resolve(migratedApplicationRoot, "nuxt.config.ts"))
                ? migratedApplicationRoot
                : this.repositoryRoot;
            this.deployRoot = resolve(this.repositoryRoot, ".deploy");
            return;
        }
        this.repositoryRoot = resolve(options.repositoryRoot);
        this.applicationSourceRoot = resolve(options.applicationSourceRoot);
        this.deployRoot = resolve(options.deployRoot ?? this.repositoryRoot);
    }

    /**
     * 在隔离目录构建候选，验证 Source 前后未变化，并最后写 ready marker。
     * 任何失败都会删除本次未 ready 候选，不触碰当前 `.output`。
     */
    async buildCandidate(request: ProductRuntimeBuildRequest): Promise<VerifiedProductRuntimeImage> {
        assertOperationId(request.operationId);
        assertPlatform(request.platform);
        const owners = normalizeOwners(request.owners);
        const budget = normalizeBudget(request.budget, owners);
        assertPolicyWithinCanonical(request.platform, owners, budget);
        const policy = runtimeImagePolicy(owners, budget);

        return await this.withInspectedCandidate(request, owners, true, async (candidate) => {
            assertBudget(candidate.inspection, budget);
            const createdAt = new Date().toISOString();
            const identityPayload: Omit<ProductRuntimeImageManifest, "imageId" | "createdAt"> = {
                schema: MANIFEST_SCHEMA,
                builderContractVersion: BUILDER_CONTRACT_VERSION,
                version: candidate.source.version,
                revision: candidate.source.revision,
                dirty: candidate.source.dirty,
                platform: request.platform,
                lockfileSha256: candidate.source.lockfileSha256,
                sourceDigest: candidate.source.sourceDigest,
                runtime: candidate.runtime,
                runtimeContract: {
                    path: PRODUCT_RUNTIME_CONTRACT_PATH,
                    sha256: productRuntimeContractSha256(candidate.runtimeContractText),
                },
                policy,
                inventory: {
                    files: candidate.inspection.files,
                    bytes: candidate.inspection.bytes,
                    owners: candidate.inspection.owners,
                },
                treeDigest: candidate.inspection.treeDigest,
                shapeDigest: candidate.inspection.shapeDigest,
            };
            const manifest: ProductRuntimeImageManifest = {
                ...identityPayload,
                imageId: sha256Text(canonicalJson(identityPayload)),
                createdAt,
            };
            const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
            await writeFile(resolve(candidate.imageRoot, MANIFEST_FILE), manifestText, {encoding: "utf8", flag: "wx"});
            const marker: ReadyMarker = {
                schema: READY_SCHEMA,
                imageId: manifest.imageId,
                manifestSha256: sha256Text(manifestText),
            };
            await writeFile(
                resolve(candidate.imageRoot, READY_FILE),
                `${JSON.stringify(marker)}\n`,
                {encoding: "utf8", flag: "wx"},
            );

            return await this.openVerified(candidate.imageRoot, {
                version: manifest.version,
                revision: manifest.revision,
                dirty: manifest.dirty,
                platform: manifest.platform,
                imageId: manifest.imageId,
                lockfileSha256: manifest.lockfileSha256,
                sourceDigest: manifest.sourceDigest,
                builderContractVersion: manifest.builderContractVersion,
            });
        });
    }

    /**
     * 在所有受支持平台构建一次临时候选并输出可登记的实际 inventory。
     * 测量不使用 owner baseline，也绝不写 ready 控制面或保留可执行候选。
     */
    async measureCandidate(request: ProductRuntimeMeasurementRequest): Promise<ProductRuntimeMeasurementReport> {
        assertOperationId(request.operationId);
        assertPlatform(request.platform);
        const owners = normalizeOwners(productRuntimeOwners());
        const globalBudget: ProductRuntimeGlobalBudget = {
            maxFiles: PRODUCT_RUNTIME_MAX_FILES,
            maxBytes: PRODUCT_RUNTIME_MAX_BYTES,
        };

        return await this.withInspectedCandidate(request, owners, false, async (candidate) => {
            assertGlobalBudget(candidate.inspection, globalBudget);
            const moduleClosure = await assertProductRuntimeModuleClosure({
                imageRoot: candidate.imageRoot,
                buildRoots: [this.repositoryRoot, this.applicationSourceRoot],
                expectedPlatform: request.platform,
            });
            return {
                schema: PRODUCT_RUNTIME_MEASUREMENT_SCHEMA,
                builderContractVersion: BUILDER_CONTRACT_VERSION,
                version: candidate.source.version,
                revision: candidate.source.revision,
                dirty: candidate.source.dirty,
                platform: request.platform,
                lockfileSha256: candidate.source.lockfileSha256,
                sourceDigest: candidate.source.sourceDigest,
                runtime: candidate.runtime,
                runtimeContract: {
                    path: PRODUCT_RUNTIME_CONTRACT_PATH,
                    sha256: productRuntimeContractSha256(candidate.runtimeContractText),
                },
                policy: {
                    registered: hasProductRuntimeBuildPolicy(request.platform),
                    owners: owners.map((owner) => ({name: owner.name, paths: [...owner.paths]})),
                    globalBudget,
                },
                inventory: {
                    files: candidate.inspection.files,
                    bytes: candidate.inspection.bytes,
                    owners: candidate.inspection.owners,
                },
                treeDigest: candidate.inspection.treeDigest,
                shapeDigest: candidate.inspection.shapeDigest,
                evidence: {
                    moduleClosure,
                    payloadFiles: candidate.inspection.records,
                },
                measuredAt: new Date().toISOString(),
            };
        });
    }

    /**
     * 统一拥有候选目录、Source 前后快照、lease、运行合同和 payload inspection。
     * finalize 只决定生成正式控制面还是返回测量报告，不能绕开这些共同检查。
     */
    private async withInspectedCandidate<T>(
        request: ProductRuntimeBuildRequest | ProductRuntimeMeasurementRequest,
        owners: readonly ProductRuntimeImageOwner[],
        retainCandidate: boolean,
        finalize: (candidate: InspectedProductRuntimeCandidate) => Promise<T>,
    ): Promise<T> {
        const stagingRoot = resolve(this.deployRoot, "staging");
        const stagingLeaseRoot = resolve(this.deployRoot, "staging-leases");
        const imageRoot = resolve(stagingRoot, request.operationId);
        const scratchRoot = resolve(imageRoot, ".build-scratch");
        const leaseTarget = resolve(stagingLeaseRoot, request.operationId);
        assertContainedPath(stagingRoot, imageRoot, "候选目录");
        assertContainedPath(imageRoot, scratchRoot, "构建临时目录");
        await mkdir(stagingRoot, {recursive: true});
        await mkdir(stagingLeaseRoot, {recursive: true});
        await this.sweepStaleStaging(stagingRoot, stagingLeaseRoot);
        if (await pathExists(imageRoot)) {
            throw new Error(`Product Runtime Image operation 已存在：${request.operationId}`);
        }

        const before = await this.sourceSnapshot(request.platform, request.expectedSource);
        assertBuildExpectation(before, request.platform, request.expectedSource);
        await mkdir(imageRoot, {recursive: false});
        const startedAt = new Date().toISOString();
        let releaseStagingLease: (() => Promise<void>) | undefined;
        try {
            await writeFile(leaseTarget, `${JSON.stringify({
                schema: STAGING_OWNER_SCHEMA,
                operationId: request.operationId,
                pid: process.pid,
                createdAt: startedAt,
            })}\n`, {encoding: "utf8", flag: "wx"});
            releaseStagingLease = await acquireFileLock(leaseTarget, {
                realpath: false,
                stale: STAGING_LEASE_STALE_MS,
                update: STAGING_LEASE_UPDATE_MS,
                retries: 0,
            });
        } catch (error) {
            await rm(imageRoot, {recursive: true, force: true});
            await rm(leaseTarget, {force: true});
            throw error;
        }

        try {
            await request.build({
                imageRoot,
                scratchRoot,
                operationId: request.operationId,
                sourceDigest: before.sourceDigest,
            });
            await rm(scratchRoot, {recursive: true, force: true});
            if (await pathExists(resolve(imageRoot, MANIFEST_FILE)) || await pathExists(resolve(imageRoot, READY_FILE))) {
                throw new Error("Product build 回调不得自行写入 runtime-image manifest 或 ready marker。");
            }

            const afterBuild = await this.sourceSnapshot(request.platform, request.expectedSource);
            assertSameSource(before, afterBuild);
            const runtimeContractText = await readControlFile(
                resolve(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/")),
                "Product Runtime Contract",
            );
            const runtimeContract = parseProductRuntimeContract(JSON.parse(runtimeContractText) as unknown);
            await assertProductRuntimeContractFiles(runtimeContract, imageRoot);
            const inspection = await inspectRuntimeImage(imageRoot, owners);
            const runtime = await this.runtimeVersions();
            const result = await finalize({
                imageRoot,
                source: before,
                inspection,
                runtime,
                runtimeContractText,
            });
            const afterFinalize = await this.sourceSnapshot(request.platform, request.expectedSource);
            assertSameSource(before, afterFinalize);
            if (!retainCandidate) {
                await rm(imageRoot, {recursive: true, force: true});
            }
            return result;
        } catch (error) {
            await rm(imageRoot, {recursive: true, force: true});
            throw error;
        } finally {
            try {
                await writeFile(leaseTarget, `${JSON.stringify({
                    schema: STAGING_OWNER_SCHEMA,
                    operationId: request.operationId,
                    pid: process.pid,
                    createdAt: startedAt,
                    completedAt: new Date().toISOString(),
                })}\n`, "utf8");
            } finally {
                try {
                    await releaseStagingLease();
                } finally {
                    // 候选是否保留由调用模式决定；operation lease 只描述活跃构建，完成后不能留下孤立 marker。
                    await rm(leaseTarget, {force: true});
                }
            }
        }
    }

    /**
     * 回收超过 24 小时且无法证明仍有活跃 owner 的候选，并清理已经失去 candidate 的 marker。
     * proper-lockfile 的 lock mtime 是 heartbeat；只有成功取得同一 lease 才允许删除。
     */
    private async sweepStaleStaging(stagingRoot: string, leaseRoot: string): Promise<void> {
        const entries = await readdir(stagingRoot, {withFileTypes: true});
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) {
                continue;
            }
            const candidatePath = resolve(stagingRoot, entry.name);
            const leaseTarget = resolve(leaseRoot, entry.name);
            const lockPath = `${leaseTarget}.lock`;
            const heartbeatPath = await pathExists(lockPath) ? lockPath : await pathExists(leaseTarget) ? leaseTarget : candidatePath;
            if (Date.now() - (await stat(heartbeatPath)).mtimeMs <= STAGING_LEASE_STALE_MS) {
                continue;
            }
            if (!await pathExists(leaseTarget)) {
                await writeFile(leaseTarget, "stale staging candidate without owner marker\n", {encoding: "utf8", flag: "wx"});
            }
            let release: (() => Promise<void>) | undefined;
            try {
                release = await acquireFileLock(leaseTarget, {
                    realpath: false,
                    stale: STAGING_LEASE_STALE_MS,
                    update: STAGING_LEASE_UPDATE_MS,
                    retries: 0,
                });
            } catch (error) {
                if (isLockContention(error)) continue;
                throw error;
            }
            await release();
            await rm(candidatePath, {recursive: true, force: true});
            await rm(leaseTarget, {force: true});
        }

        // candidate 被 Publisher 移走或旧进程在收尾阶段中断时，marker 可能单独遗留。
        // 取得同一 lease 并在持锁期间复核 candidate，避免删除仍有活跃 owner 的 marker。
        const leaseEntries = await readdir(leaseRoot, {withFileTypes: true});
        for (const entry of leaseEntries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) {
                continue;
            }
            const candidatePath = resolve(stagingRoot, entry.name);
            if (await pathExists(candidatePath)) continue;
            const leaseTarget = resolve(leaseRoot, entry.name);
            let release: (() => Promise<void>) | undefined;
            try {
                release = await acquireFileLock(leaseTarget, {
                    realpath: false,
                    stale: STAGING_LEASE_STALE_MS,
                    update: STAGING_LEASE_UPDATE_MS,
                    retries: 0,
                });
            } catch (error) {
                if (isLockContention(error)) continue;
                throw error;
            }
            try {
                if (!await pathExists(candidatePath)) {
                    await rm(leaseTarget, {force: true});
                }
            } finally {
                await release();
            }
        }
    }

    /**
     * 重新证明 ready marker、manifest 身份、payload digests 与 owner inventory。
     * 缺字段、未知 schema、路径逃逸或任何 expected identity 不一致都直接失败。
     */
    async openVerified(imagePath: string, expectedIdentity: ProductRuntimeExpectedIdentity): Promise<VerifiedProductRuntimeImage> {
        return await new ProductRuntimeImageVerifier().openVerified(imagePath, expectedIdentity);
    }

    /**
     * 验证 manifest、ready marker、运行合同摘要与全部合同入口，不遍历 payload。
     * 该结果只适合只读状态展示；任何会执行或分发 Product 的调用方必须使用 `openVerified`。
     */
    async openControlPlane(
        imagePath: string,
        expectedIdentity: ProductRuntimeExpectedIdentity,
    ): Promise<import("@notnotype/neuro-book-contracts/product-runtime").ProductRuntimeImageControlPlane> {
        return await new ProductRuntimeImageVerifier().openControlPlane(imagePath, expectedIdentity);
    }

    /** 读取并摘要当前 Git Source、lockfile 与目标平台身份。 */
    private async sourceSnapshot(
        platform: ProductPlatform,
        expectation?: ProductRuntimeBuildExpectation,
    ): Promise<SourceSnapshot> {
        const identityManifestPath = resolve(this.repositoryRoot, SOURCE_APPLICATION_RELATIVE_PATH, "package.json");
        const packagePath = existsSyncPath(identityManifestPath)
            ? identityManifestPath
            : resolve(this.applicationSourceRoot, "package.json");
        const lockfilePath = resolve(this.repositoryRoot, "bun.lock");
        const [packageText, lockfileSha256] = await Promise.all([
            readFile(packagePath, "utf8"),
            sha256File(lockfilePath),
        ]);
        const version = packagePath === identityManifestPath
            ? (await readApplicationPackageManifest(this.repositoryRoot)).version
            : packageVersion(packageText, packagePath);
        const gitBacked = await pathExists(resolve(this.repositoryRoot, ".git"));
        let revision: string;
        let dirty: boolean;
        let statusResult: string;
        let sourcePaths: string[];
        if (gitBacked) {
            // porcelain v2 的 branch.oid 与变更集合来自同一次 index snapshot，避免分开读取形成混合身份。
            statusResult = await runCapture("git", [
                "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all",
            ], this.repositoryRoot);
            revision = statusResult.split("\0")
                .find((entry) => entry.startsWith("# branch.oid "))
                ?.slice("# branch.oid ".length)
                .trim() ?? "";
            dirty = statusResult.split("\0").some((entry) => entry.length > 0 && !entry.startsWith("# "));
            // 每次快照都重新枚举。复用首次路径集会漏掉构建期间新增的 tracked/untracked Source。
            const trackedResult = await runCapture(
                "git",
                ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                this.repositoryRoot,
            );
            sourcePaths = [...new Set([
                ...trackedResult.split("\0").filter(Boolean),
                "package.json",
                "bun.lock",
            ])].sort(compareText);
        } else {
            if (!expectation?.revision || expectation.dirty !== false) {
                throw new Error("Git-less Product build 必须显式提供 expectedSource.revision 与 dirty=false。");
            }
            revision = expectation.revision;
            dirty = false;
            statusResult = "gitless-source\0";
            sourcePaths = await gitlessSourcePaths(this.repositoryRoot);
        }
        if (!/^[0-9a-f]{40,64}$/i.test(revision)) {
            throw new Error(`无法读取有效 Source revision：${revision || "empty"}`);
        }
        const sourceHash = createHash("sha256");
        const sourceEntries = new Map<string, string>();
        // branch/upstream 与 index staging 只是 Git 操作状态；同 revision、dirty 语义和文件内容必须得到同一 Source identity。
        sourceHash.update(`platform\0${platform}\0revision\0${revision}\0dirty\0${dirty ? "1" : "0"}\0`);
        for (const trackedPath of sourcePaths) {
            const normalized = normalizeRelativePath(trackedPath, "Git Source input");
            const absolutePath = resolve(this.repositoryRoot, ...normalized.split("/"));
            assertContainedPath(this.repositoryRoot, absolutePath, `Git Source input ${normalized}`);
            let info: Awaited<ReturnType<typeof lstat>>;
            try {
                info = await lstat(absolutePath);
            } catch (error) {
                if (isNodeError(error) && error.code === "ENOENT") {
                    // `git ls-files --cached` 会保留 worktree 中已删除的 tracked path；删除本身也是稳定输入。
                    sourceEntries.set(normalized, "missing");
                    sourceHash.update(`${normalized}\0missing\n`);
                    continue;
                }
                throw error;
            }
            if (!info.isFile() && !info.isSymbolicLink()) {
                throw new Error(`Git Source input 不是普通文件：${normalized}`);
            }
            const contentDigest = info.isSymbolicLink()
                ? sha256Text(await readlink(absolutePath))
                : await sha256File(absolutePath);
            sourceEntries.set(
                normalized,
                `${info.isSymbolicLink() ? "symlink" : "file"}:${info.mode & 0o777}:${info.size}:${contentDigest}`,
            );
            sourceHash.update(`${normalized}\0${info.mode & 0o777}\0${info.size}\0${contentDigest}\n`);
        }
        return {
            version,
            revision,
            dirty,
            lockfileSha256,
            sourceDigest: `sha256:${sourceHash.digest("hex")}`,
            sourceEntries,
            statusResult,
        };
    }

    /** 从真实构建宿主和已安装包读取版本，不接受调用方伪造。 */
    private async runtimeVersions(): Promise<ProductRuntimeImageManifest["runtime"]> {
        const bun = process.versions.bun
            ?? (await runCapture("bun", ["--version"], this.applicationSourceRoot)).trim();
        if (!bun) {
            throw new Error("无法读取 Bun 版本。");
        }
        const [nuxt, nitro] = await Promise.all([
            installedPackageVersion(this.repositoryRoot, "nuxt"),
            installedPackageVersion(this.repositoryRoot, "nitropack"),
        ]);
        return {bun, nuxt, nitro};
    }
}

/** 对照调用方锁定的 Source 代次；提供了哪个字段就严格比较哪个字段。 */
function assertBuildExpectation(
    snapshot: SourceSnapshot,
    platform: ProductPlatform,
    expected: ProductRuntimeBuildExpectation | undefined,
): void {
    if (!expected) return;
    const actual = {...snapshot, platform};
    for (const key of ["version", "revision", "dirty", "lockfileSha256"] as const) {
        if (expected[key] !== undefined && expected[key] !== actual[key]) {
            const details = key === "dirty" ? sourceSnapshotStatusDetails(snapshot) : [];
            throw new Error([
                `Product build Source 身份不一致：${key} expected=${String(expected[key])} actual=${String(actual[key])}`,
                ...details.map((detail) => `- ${detail}`),
            ].join("\n"));
        }
    }
}

/** 将 porcelain v2 的当前变化集合转换为可直接定位的初始 Source dirty 诊断。 */
function sourceSnapshotStatusDetails(snapshot: SourceSnapshot): string[] {
    const changes = snapshot.statusResult.split("\0")
        .filter((entry) => entry.length > 0 && !entry.startsWith("# "))
        .slice(0, 20)
        .map((entry) => `Git 状态：${entry.slice(0, 300)}`);
    return changes.length > 0 ? changes : ["Git 报告 dirty，但 porcelain 中没有可枚举的变化路径"];
}

/** Source 的任意输入或 dirty 集合在构建期间变化都拒绝发布。 */
function assertSameSource(before: SourceSnapshot, after: SourceSnapshot): void {
    for (const key of ["version", "revision", "dirty", "lockfileSha256", "sourceDigest"] as const) {
        if (before[key] !== after[key]) {
            const details = key === "dirty" || key === "sourceDigest" ? sourceSnapshotDiff(before, after) : [];
            throw new Error([
                `Product build 期间 Source 输入发生变化：${key}`,
                ...details.map((detail) => `- ${detail}`),
            ].join("\n"));
        }
    }
}

/** 把摘要变化还原为可操作路径；最多报告 20 项，避免巨型 dirty worktree 淹没日志。 */
function sourceSnapshotDiff(before: SourceSnapshot, after: SourceSnapshot): string[] {
    const details: string[] = [];
    const paths = new Set([...before.sourceEntries.keys(), ...after.sourceEntries.keys()]);
    for (const path of [...paths].sort(compareText)) {
        if (before.sourceEntries.get(path) === after.sourceEntries.get(path)) continue;
        details.push(`内容变化：${path}`);
        if (details.length >= 20) return details;
    }
    if (before.statusResult !== after.statusResult) {
        const beforeStatus = new Set(before.statusResult.split("\0"));
        for (const entry of after.statusResult.split("\0")) {
            if (!entry || entry.startsWith("# ") || beforeStatus.has(entry)) continue;
            details.push(`Git 状态变化：${entry.slice(0, 240)}`);
            if (details.length >= 20) break;
        }
    }
    if (details.length === 0) details.push("Source 集合摘要变化，但没有可枚举的路径差异");
    return details;
}

/** 读取 package.json 的版本字段。 */
function packageVersion(text: string, source: string): string {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`${source} 不是有效 JSON：${String(error)}`);
    }
    const record = plainObject(value, source);
    if (typeof record.version !== "string" || !record.version) {
        throw new Error(`${source} 缺少 version。`);
    }
    return record.version;
}

/** 从安装树读取实际 Nuxt/Nitro 版本。 */
async function installedPackageVersion(projectRoot: string, packageName: string): Promise<string> {
    const packagePath = resolve(projectRoot, "node_modules", ...packageName.split("/"), "package.json");
    return packageVersion(await readFile(packagePath, "utf8"), packagePath);
}

/** 执行只读身份命令并保留 NUL 输出。 */
async function runCapture(command: string, args: string[], cwd: string): Promise<string> {
    try {
        const result = await execFileAsync(command, args, {
            cwd,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
        });
        return result.stdout;
    } catch (error) {
        throw new Error(`执行 ${command} ${args.join(" ")} 失败：${String(error)}`);
    }
}

/**
 * 枚举 Git-less Docker build context 的 Source 输入。
 * 排除集合与 `.dockerignore` 的生成态目录一致；node_modules 由 lockfile 表达，不属于 Source。
 */
async function gitlessSourcePaths(projectRoot: string): Promise<string[]> {
    const paths: string[] = [];
    const walk = async (directory: string, segments: string[]): Promise<void> => {
        for (const entry of (await readdir(directory, {withFileTypes: true})).sort((left, right) => compareText(left.name, right.name))) {
            if (segments.length === 0 && GITLESS_SOURCE_EXCLUDES.has(entry.name)) continue;
            const nextSegments = [...segments, entry.name];
            const absolutePath = resolve(directory, entry.name);
            if (isGitlessSourceExcluded(segments, entry.name)) continue;
            if (entry.isDirectory()) {
                await walk(absolutePath, nextSegments);
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                paths.push(nextSegments.join("/"));
            } else {
                throw new Error(`Git-less Source 含不支持的特殊文件：${nextSegments.join("/")}`);
            }
        }
    };
    await walk(projectRoot, []);
    return [...new Set([...paths, "package.json", "bun.lock"])].sort(compareText);
}

/** owner path 匹配完整路径段，避免 `server` 意外拥有 `server-old`。 */
function pathOwnedBy(filePath: string, ownerPath: string): boolean {
    return ownerPath === "." || filePath === ownerPath || filePath.startsWith(`${ownerPath}/`);
}

/** operation ID 直接成为目录名，因此只接受稳定的单段 ASCII 标识。 */
function assertOperationId(operationId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(operationId) || operationId === "." || operationId === "..") {
        throw new Error(`Product Runtime Image operationId 无效：${JSON.stringify(operationId)}`);
    }
}

/** JSON 外部对象的唯一集中收窄点。 */
function plainObject(value: unknown, label: string): {[key: string]: unknown} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Product Runtime Image ${label} 必须是 object。`);
    }
    return value as {[key: string]: unknown};
}

/** v1 manifest 使用精确字段集合，未知字段必须通过新 schema 演进。 */
function assertExactKeys(record: {[key: string]: unknown}, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const required = [...expected].sort();
    if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
        throw new Error(`Product Runtime Image ${label} 字段集合无效。`);
    }
}

/** 使用固定 UTF-16 code unit 顺序，避免 locale/ICU 改变跨机器 digest。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 无 TOCTOU 副作用地判断候选 operation 是否已经存在。 */
async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return false;
        throw error;
    }
}

/** Node filesystem error 的集中收窄。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

/** proper-lockfile 在其他 owner 仍持有 lease 时使用 ELOCKED。 */
function isLockContention(error: unknown): boolean {
    return isNodeError(error) && error.code === "ELOCKED";
}
