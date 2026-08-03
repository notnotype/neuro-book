import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {
    lstat,
    readFile,
    readdir,
    readlink,
    realpath,
    stat,
} from "node:fs/promises";
import {isAbsolute, posix, relative, resolve, sep, win32} from "node:path";

import {
    PRODUCT_PLATFORMS,
    type ProductPlatform,
} from "nbook/packages/neuro-book-manager/src/types";
import {
    assertProductRuntimeContractFiles,
    parseProductRuntimeContract,
    PRODUCT_RUNTIME_CONTRACT_PATH,
    productRuntimeContractSha256,
} from "nbook/shared/product-runtime-contract";

const MANIFEST_FILE = "runtime-image.json";
const READY_FILE = "runtime-image.ready";
export const PRODUCT_RUNTIME_IMAGE_MANIFEST_SCHEMA = "nbook.product-runtime-image/v3";
export const PRODUCT_RUNTIME_IMAGE_READY_SCHEMA = "nbook.product-runtime-image-ready/v1";
const MANIFEST_SCHEMA = PRODUCT_RUNTIME_IMAGE_MANIFEST_SCHEMA;
const READY_SCHEMA = PRODUCT_RUNTIME_IMAGE_READY_SCHEMA;
const POLICY_SCHEMA = "nbook.product-runtime-image-policy/v1";
const OWNER_GROWTH_LIMIT = 0.10;
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;

export const PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION = "3";
export const PRODUCT_RUNTIME_MAX_BYTES = 360 * 1024 * 1024;
export const PRODUCT_RUNTIME_MAX_FILES = 6_000;

/** Product Runtime Image 中一个明确的磁盘 owner。路径均相对镜像根。 */
export interface ProductRuntimeImageOwner {
    name: string;
    paths: readonly string[];
}

/** 已登记 owner 的稳定基线；Verifier 固定只允许最多 10% 增长。 */
export interface ProductRuntimeOwnerBaseline {
    name: string;
    files: number;
    bytes: number;
}

/** 所有平台共用的 Product Runtime Image 硬上限。 */
export interface ProductRuntimeGlobalBudget {
    maxFiles: number;
    maxBytes: number;
}

/** Runtime Image 的总量与 owner 回归预算。 */
export interface ProductRuntimeImageBudget extends ProductRuntimeGlobalBudget {
    ownerBaselines: readonly ProductRuntimeOwnerBaseline[];
}

/** Builder 当前允许生成的规范平台策略。 */
export interface ProductRuntimeBuildPolicy {
    platform: ProductPlatform;
    owners: ProductRuntimeImageOwner[];
    budget: ProductRuntimeImageBudget;
}

/** manifest 中持久化的实际构建策略及其稳定摘要。 */
export interface ProductRuntimeImagePolicy {
    schema: typeof POLICY_SCHEMA;
    sha256: string;
    owners: ProductRuntimeImageOwner[];
    budget: ProductRuntimeImageBudget;
}

/** `openVerified` 必须由调用方给出的代次身份。 */
export interface ProductRuntimeExpectedIdentity {
    version: string;
    revision: string;
    dirty: boolean;
    platform: ProductPlatform;
    imageId?: string;
    lockfileSha256?: string;
    sourceDigest?: string;
    builderContractVersion?: string;
}

/** Manager 仅在读取已安装旧代次时开启 v3 合同兼容；新 Product 默认 v4。 */
export interface ProductRuntimeImageVerificationOptions {
    allowPreviousRuntimeContract?: boolean;
}

/** 一个 owner 在最终不可变 payload 中的实际占用。 */
export interface ProductRuntimeOwnerInventory {
    name: string;
    paths: string[];
    files: number;
    bytes: number;
}

/** `runtime-image.json` 的 v3 固定合同。 */
export interface ProductRuntimeImageManifest {
    schema: typeof MANIFEST_SCHEMA;
    builderContractVersion: typeof PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION;
    imageId: string;
    version: string;
    revision: string;
    dirty: boolean;
    platform: ProductPlatform;
    lockfileSha256: string;
    sourceDigest: string;
    runtime: {bun: string; nuxt: string; nitro: string};
    runtimeContract: {
        path: typeof PRODUCT_RUNTIME_CONTRACT_PATH;
        sha256: string;
    };
    policy: ProductRuntimeImagePolicy;
    inventory: {
        files: number;
        bytes: number;
        owners: ProductRuntimeOwnerInventory[];
    };
    treeDigest: string;
    shapeDigest: string;
    createdAt: string;
}

/** 只有 manifest、ready marker 与 payload 全部互相吻合时才返回此句柄。 */
export interface VerifiedProductRuntimeImage {
    path: string;
    manifest: ProductRuntimeImageManifest;
}

/** 只证明 ready 控制面和运行合同完整；不能用于执行或发布。 */
export interface ProductRuntimeImageControlPlane {
    path: string;
    manifest: ProductRuntimeImageManifest;
}

export interface ProductRuntimeInspection {
    files: number;
    bytes: number;
    owners: ProductRuntimeOwnerInventory[];
    treeDigest: string;
    shapeDigest: string;
    /** 按规范路径排序的逐文件证据；正式 manifest 只持久化聚合 digest。 */
    records: ProductRuntimeFileRecord[];
}

/** measurement 用于定位 A/B 漂移的逐文件证据。 */
export interface ProductRuntimeFileRecord {
    relativePath: string;
    kind: "file" | "symlink";
    bytes: number;
    mode: number;
    contentDigest: string;
}

interface ReadyMarker {
    schema: typeof READY_SCHEMA;
    imageId: string;
    manifestSha256: string;
}

interface RuntimeControlPlaneState extends ProductRuntimeImageControlPlane {
    manifestPath: string;
    markerPath: string;
    runtimeContractPath: string;
    manifestText: string;
    markerText: string;
    runtimeContractText: string;
}

const PRODUCT_RUNTIME_OWNERS: readonly ProductRuntimeImageOwner[] = [
    {name: "frontend", paths: ["public"]},
    {name: "server-bundle", paths: ["server/index.mjs", "server/index.mjs.map"]},
    {name: "commands", paths: ["server/commands", "server/prisma"]},
    {name: "authoring-kit", paths: ["server/authoring"]},
    {name: "native-islands", paths: ["server/node_modules", "server/native-islands.json"]},
    {name: "system-assets", paths: ["server/assets"]},
    {name: "runtime-meta", paths: ["nitro.json", "server/package.json", "server/runtime-contract.json"]},
] as const;

// 2026-08-02：五个平台在 clean Source 上完成 A/B measurement、owner 与 native island 审查。
const PRODUCT_RUNTIME_OWNER_BASELINES: Partial<Record<ProductPlatform, readonly ProductRuntimeOwnerBaseline[]>> = {
    "windows-x64": [
        {name: "frontend", files: 177, bytes: 15_272_680},
        {name: "server-bundle", files: 1, bytes: 12_300_171},
        {name: "commands", files: 116, bytes: 10_865_638},
        {name: "authoring-kit", files: 509, bytes: 14_477_260},
        {name: "native-islands", files: 2_059, bytes: 75_260_630},
        {name: "system-assets", files: 373, bytes: 5_274_435},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "linux-x64-glibc": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 75_144_692},
        {name: "system-assets", files: 373, bytes: 5_229_844},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "linux-aarch64-glibc": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 72_567_998},
        {name: "system-assets", files: 373, bytes: 5_229_844},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "darwin-x64": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 75_913_156},
        {name: "system-assets", files: 373, bytes: 5_229_844},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "darwin-aarch64": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 71_965_408},
        {name: "system-assets", files: 373, bytes: 5_229_844},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
};

/** 判断平台是否拥有经过审查的 canonical owner policy。 */
export function hasProductRuntimeBuildPolicy(platform: ProductPlatform): boolean {
    return Object.hasOwn(PRODUCT_RUNTIME_OWNER_BASELINES, platform);
}

/** 返回平台唯一的 owner/预算策略。 */
export function productRuntimeBuildPolicy(platform: ProductPlatform): ProductRuntimeBuildPolicy {
    const ownerBaselines = PRODUCT_RUNTIME_OWNER_BASELINES[platform];
    if (!ownerBaselines) {
        throw new Error(`Product Runtime Image 尚未登记 ${platform} 的规范 owner policy。`);
    }
    return {
        platform,
        owners: PRODUCT_RUNTIME_OWNERS.map((owner) => ({name: owner.name, paths: [...owner.paths]})),
        budget: {
            maxFiles: PRODUCT_RUNTIME_MAX_FILES,
            maxBytes: PRODUCT_RUNTIME_MAX_BYTES,
            ownerBaselines: ownerBaselines.map((baseline) => ({...baseline})),
        },
    };
}

/** 返回 Runtime Image 固定 owner 集合，供未登记平台执行 measurement-only 构建。 */
export function productRuntimeOwners(): ProductRuntimeImageOwner[] {
    return PRODUCT_RUNTIME_OWNERS.map((owner) => ({name: owner.name, paths: [...owner.paths]}));
}

/** Product Runtime Image 的只读验证器；不持有 Source、staging、锁或构建回调。 */
export class ProductRuntimeImageVerifier {
    /** 使用调用方提供的外部代次身份完整复算镜像。 */
    async openVerified(
        imagePath: string,
        expectedIdentity: ProductRuntimeExpectedIdentity,
        options: ProductRuntimeImageVerificationOptions = {},
    ): Promise<VerifiedProductRuntimeImage> {
        const control = await this.readControlPlane(imagePath, expectedIdentity, options);
        const inspection = await inspectProductRuntimeImage(control.path, control.manifest.policy.owners);
        assertProductRuntimeBudget(inspection, control.manifest.policy.budget);
        assertPhysicalBudget(inspection, control, control.manifest.policy.budget);
        if (inspection.treeDigest !== control.manifest.treeDigest || inspection.shapeDigest !== control.manifest.shapeDigest) {
            throw new Error("Product Runtime Image payload digest 不一致，镜像可能被篡改或未完整写入。");
        }
        if (inspection.files !== control.manifest.inventory.files || inspection.bytes !== control.manifest.inventory.bytes
            || canonicalProductRuntimeJson(inspection.owners) !== canonicalProductRuntimeJson(control.manifest.inventory.owners)) {
            throw new Error("Product Runtime Image owner inventory 与实际 payload 不一致。");
        }
        await this.assertControlPlaneUnchanged(control);
        return {path: control.path, manifest: control.manifest};
    }

    /** 独立 Product bootstrap 以镜像内 manifest 建立身份后执行完整自洽验证。 */
    async openSelfVerified(
        imageRoot: string,
        options: ProductRuntimeImageVerificationOptions = {},
    ): Promise<VerifiedProductRuntimeImage> {
        const manifest = parseManifest(await readProductRuntimeControlFile(resolve(imageRoot, MANIFEST_FILE), "runtime-image manifest"));
        return await this.openVerified(imageRoot, {
            version: manifest.version,
            revision: manifest.revision,
            dirty: manifest.dirty,
            platform: manifest.platform,
            imageId: manifest.imageId,
            lockfileSha256: manifest.lockfileSha256,
            sourceDigest: manifest.sourceDigest,
            builderContractVersion: manifest.builderContractVersion,
        }, options);
    }

    /** 验证控制面和 Runtime Contract，不遍历 payload。 */
    async openControlPlane(
        imagePath: string,
        expectedIdentity: ProductRuntimeExpectedIdentity,
        options: ProductRuntimeImageVerificationOptions = {},
    ): Promise<ProductRuntimeImageControlPlane> {
        const control = await this.readControlPlane(imagePath, expectedIdentity, options);
        await this.assertControlPlaneUnchanged(control);
        return {path: control.path, manifest: control.manifest};
    }

    /** 读取并严格验证一代 Runtime Image 的全部控制文件。 */
    private async readControlPlane(
        imagePath: string,
        expectedIdentity: ProductRuntimeExpectedIdentity,
        options: ProductRuntimeImageVerificationOptions,
    ): Promise<RuntimeControlPlaneState> {
        assertExpectedIdentity(expectedIdentity);
        const imageRoot = resolve(imagePath);
        const rootInfo = await lstat(imageRoot);
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
            throw new Error(`Product Runtime Image 根必须是真实目录：${imageRoot}`);
        }

        const manifestPath = resolve(imageRoot, MANIFEST_FILE);
        const markerPath = resolve(imageRoot, READY_FILE);
        const manifestText = await readProductRuntimeControlFile(manifestPath, "runtime-image manifest");
        const markerText = await readProductRuntimeControlFile(markerPath, "runtime-image ready marker");
        const manifest = parseManifest(manifestText);
        assertProductRuntimePolicy(manifest.platform, manifest.policy.owners, manifest.policy.budget);
        const marker = parseReadyMarker(markerText);
        if (marker.imageId !== manifest.imageId || marker.manifestSha256 !== sha256ProductRuntimeText(manifestText)) {
            throw new Error("Product Runtime Image ready marker 与 manifest 不一致。");
        }
        if (manifest.imageId !== productRuntimeManifestImageId(manifest)) {
            throw new Error("Product Runtime Image imageId 无法由 manifest 身份重建。");
        }
        assertIdentity(manifest, expectedIdentity);

        const runtimeContractPath = resolve(imageRoot, ...manifest.runtimeContract.path.split("/"));
        const runtimeContractText = await readProductRuntimeControlFile(runtimeContractPath, "Product Runtime Contract");
        if (productRuntimeContractSha256(runtimeContractText) !== manifest.runtimeContract.sha256) {
            throw new Error("Product Runtime Image runtime contract 摘要与 manifest 不一致。");
        }
        const runtimeContract = options.allowPreviousRuntimeContract
            ? parseProductRuntimeContract(JSON.parse(runtimeContractText) as unknown, {allowPrevious: true})
            : parseProductRuntimeContract(JSON.parse(runtimeContractText) as unknown);
        await assertProductRuntimeContractFiles(runtimeContract, imageRoot);
        return {
            path: imageRoot,
            manifest,
            manifestPath,
            markerPath,
            runtimeContractPath,
            manifestText,
            markerText,
            runtimeContractText,
        };
    }

    /** 防止检查期间另一进程替换控制文件并返回混合代次。 */
    private async assertControlPlaneUnchanged(control: RuntimeControlPlaneState): Promise<void> {
        if (await readProductRuntimeControlFile(control.manifestPath, "runtime-image manifest") !== control.manifestText
            || await readProductRuntimeControlFile(control.markerPath, "runtime-image ready marker") !== control.markerText
            || await readProductRuntimeControlFile(control.runtimeContractPath, "Product Runtime Contract") !== control.runtimeContractText) {
            throw new Error("Product Runtime Image 在验证期间发生变化。");
        }
    }
}

/** 扫描 payload，拒绝外部 symlink，并生成内容与 shape 两种 digest。 */
export async function inspectProductRuntimeImage(
    imageRoot: string,
    ownerInput: readonly ProductRuntimeImageOwner[],
): Promise<ProductRuntimeInspection> {
    const owners = normalizeProductRuntimeOwners(ownerInput);
    const rootRealPath = await realpath(imageRoot);
    const pending: Array<{absolutePath: string; relativePath: string}> = [];

    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
        const entries = await readdir(directory, {withFileTypes: true});
        entries.sort((left, right) => compareProductRuntimeText(left.name, right.name));
        for (const entry of entries) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (!relativeDirectory && (relativePath === MANIFEST_FILE || relativePath === READY_FILE)) continue;
            const absolutePath = resolve(directory, entry.name);
            const info = await lstat(absolutePath);
            if (info.isDirectory() && !info.isSymbolicLink()) {
                assertProductRuntimeContainedPath(rootRealPath, await realpath(absolutePath), `目录 ${relativePath}`);
                await walk(absolutePath, relativePath);
            } else {
                pending.push({absolutePath, relativePath});
            }
        }
    };

    await walk(imageRoot, "");
    const records: ProductRuntimeFileRecord[] = [];
    for (let offset = 0; offset < pending.length; offset += 24) {
        const batch = pending.slice(offset, offset + 24);
        records.push(...await Promise.all(batch.map(async ({absolutePath, relativePath}) => {
            const before = await lstat(absolutePath);
            if (before.isSymbolicLink()) {
                const target = await readlink(absolutePath);
                if (isAbsolute(target) || win32.isAbsolute(target) || posix.isAbsolute(target)) {
                    throw new Error(`Product Runtime Image 不接受绝对 symlink：${relativePath} -> ${target}`);
                }
                assertProductRuntimeContainedPath(rootRealPath, await realpath(absolutePath), `symlink ${relativePath}`);
                const targetInfo = await stat(absolutePath);
                if (!targetInfo.isFile() && !targetInfo.isDirectory()) {
                    throw new Error(`Product Runtime Image symlink 目标类型不受支持：${relativePath}`);
                }
                return {
                    relativePath,
                    kind: "symlink" as const,
                    bytes: Buffer.byteLength(target),
                    mode: before.mode & 0o777,
                    contentDigest: sha256ProductRuntimeText(target),
                };
            }
            if (!before.isFile()) {
                throw new Error(`Product Runtime Image 包含不受支持的文件类型：${relativePath}`);
            }
            const contentDigest = await productRuntimeFileDigest(absolutePath);
            const after = await lstat(absolutePath);
            if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
                throw new Error(`Product Runtime Image 文件在摘要期间变化：${relativePath}`);
            }
            return {
                relativePath,
                kind: "file" as const,
                bytes: after.size,
                mode: after.mode & 0o777,
                contentDigest,
            };
        })));
    }
    records.sort((left, right) => compareProductRuntimeText(left.relativePath, right.relativePath));
    if (records.length === 0) throw new Error("Product Runtime Image payload 为空。");

    const inventories = owners.map((owner) => ({name: owner.name, paths: [...owner.paths], files: 0, bytes: 0}));
    const treeHash = createHash("sha256");
    const shapeHash = createHash("sha256");
    let bytes = 0;
    for (const record of records) {
        const matches = owners
            .map((owner, index) => ({owner, index}))
            .filter(({owner}) => owner.paths.some((ownerPath) => pathOwnedBy(record.relativePath, ownerPath)));
        if (matches.length !== 1) {
            const names = matches.map(({owner}) => owner.name).join(", ") || "none";
            throw new Error(`Product Runtime Image 文件必须恰好属于一个 owner：${record.relativePath}（${names}）`);
        }
        const inventory = inventories[matches[0]!.index]!;
        inventory.files += 1;
        inventory.bytes += record.bytes;
        bytes += record.bytes;
        treeHash.update(`${record.relativePath}\0${record.kind}\0${record.bytes}\0${record.mode}\0${record.contentDigest}\n`);
        shapeHash.update(`${record.relativePath}\0${record.kind}\n`);
    }
    inventories.sort((left, right) => compareProductRuntimeText(left.name, right.name));
    return {
        files: records.length,
        bytes,
        owners: inventories,
        treeDigest: `sha256:${treeHash.digest("hex")}`,
        shapeDigest: `sha256:${shapeHash.digest("hex")}`,
        records,
    };
}

/** 将 owner 路径正规化并拒绝名字、路径歧义。 */
export function normalizeProductRuntimeOwners(input: readonly ProductRuntimeImageOwner[]): ProductRuntimeImageOwner[] {
    if (input.length === 0) throw new Error("Product Runtime Image 至少需要一个 owner。");
    const names = new Set<string>();
    return input.map((owner) => {
        if (!owner.name.trim() || owner.name !== owner.name.trim() || /[\u0000-\u001f]/u.test(owner.name)) {
            throw new Error(`Product Runtime Image owner 名称无效：${JSON.stringify(owner.name)}`);
        }
        if (names.has(owner.name)) throw new Error(`Product Runtime Image owner 名称重复：${owner.name}`);
        names.add(owner.name);
        if (owner.paths.length === 0) throw new Error(`Product Runtime Image owner 没有路径：${owner.name}`);
        const paths = [...new Set(owner.paths.map((ownerPath) => normalizeProductRuntimeRelativePath(ownerPath, `owner ${owner.name}`)))]
            .sort(compareProductRuntimeText);
        return {name: owner.name, paths};
    }).sort((left, right) => compareProductRuntimeText(left.name, right.name));
}

/** 校验所有测量和正式构建都不能突破的总量硬门禁。 */
export function assertProductRuntimeGlobalBudget(
    inspection: ProductRuntimeInspection,
    budget: ProductRuntimeGlobalBudget,
): void {
    if (inspection.files > budget.maxFiles || inspection.bytes > budget.maxBytes) {
        throw new Error(
            `Product Runtime Image 超出总预算：${inspection.files}/${budget.maxFiles} files，`
            + `${inspection.bytes}/${budget.maxBytes} bytes。`,
        );
    }
}

/** 校验总预算与每个 owner 的固定 10% 回归门禁。 */
export function assertProductRuntimeBudget(
    inspection: ProductRuntimeInspection,
    budget: ProductRuntimeImageBudget,
): void {
    assertProductRuntimeGlobalBudget(inspection, budget);
    const baselines = new Map(budget.ownerBaselines.map((baseline) => [baseline.name, baseline]));
    for (const owner of inspection.owners) {
        const baseline = baselines.get(owner.name);
        if (!baseline) throw new Error(`Product Runtime Image 缺少 owner 登记基线：${owner.name}`);
        const maxFiles = Math.floor(baseline.files * (1 + OWNER_GROWTH_LIMIT));
        const maxBytes = Math.floor(baseline.bytes * (1 + OWNER_GROWTH_LIMIT));
        if (owner.files > maxFiles || owner.bytes > maxBytes) {
            throw new Error(
                `Product Runtime Image owner 超出登记基线 10%：${owner.name} `
                + `${owner.files}/${maxFiles} files，${owner.bytes}/${maxBytes} bytes。`,
            );
        }
    }
}

/** 正规化并校验每个 owner 都有唯一基线。 */
export function normalizeProductRuntimeBudget(
    input: ProductRuntimeImageBudget,
    owners: readonly ProductRuntimeImageOwner[],
): ProductRuntimeImageBudget {
    assertNonNegativeInteger(input.maxFiles, "budget.maxFiles");
    assertNonNegativeInteger(input.maxBytes, "budget.maxBytes");
    const names = new Set<string>();
    const baselines = input.ownerBaselines.map((baseline) => {
        if (!baseline.name || baseline.name !== baseline.name.trim() || names.has(baseline.name)) {
            throw new Error(`Product Runtime Image owner baseline 名称无效或重复：${JSON.stringify(baseline.name)}`);
        }
        names.add(baseline.name);
        assertNonNegativeInteger(baseline.files, `owner baseline ${baseline.name}.files`);
        assertNonNegativeInteger(baseline.bytes, `owner baseline ${baseline.name}.bytes`);
        return {...baseline};
    }).sort((left, right) => compareProductRuntimeText(left.name, right.name));
    const ownerNames = new Set(owners.map((owner) => owner.name));
    const unknown = baselines.find((baseline) => !ownerNames.has(baseline.name));
    if (unknown) {
        throw new Error(`Product Runtime Image owner baseline 没有对应 owner：${unknown.name}`);
    }
    const baselineNames = new Set(baselines.map((baseline) => baseline.name));
    const missing = owners.find((owner) => !baselineNames.has(owner.name));
    if (missing) {
        throw new Error(`Product Runtime Image 缺少 owner 登记基线：${missing.name}`);
    }
    return {maxFiles: input.maxFiles, maxBytes: input.maxBytes, ownerBaselines: baselines};
}

/** 生成进入 manifest 的稳定 policy 与摘要。 */
export function createProductRuntimePolicy(
    ownerInput: readonly ProductRuntimeImageOwner[],
    budgetInput: ProductRuntimeImageBudget,
): ProductRuntimeImagePolicy {
    const owners = normalizeProductRuntimeOwners(ownerInput);
    const budget = normalizeProductRuntimeBudget(budgetInput, owners);
    const payload: Omit<ProductRuntimeImagePolicy, "sha256"> = {schema: POLICY_SCHEMA, owners, budget};
    return {...payload, sha256: sha256ProductRuntimeText(canonicalProductRuntimeJson(payload))};
}

/** 要求 owner 边界与 canonical policy 相同，预算只能保持或收紧。 */
export function assertProductRuntimePolicy(
    platform: ProductPlatform,
    ownerInput: readonly ProductRuntimeImageOwner[],
    budgetInput: ProductRuntimeImageBudget,
): void {
    const canonical = productRuntimeBuildPolicy(platform);
    const owners = normalizeProductRuntimeOwners(ownerInput);
    const canonicalOwners = normalizeProductRuntimeOwners(canonical.owners);
    if (canonicalProductRuntimeJson(owners) !== canonicalProductRuntimeJson(canonicalOwners)) {
        throw new Error(`Product Runtime Image ${platform} owners 不符合规范平台 policy，policy 摘要不被接受。`);
    }
    const budget = normalizeProductRuntimeBudget(budgetInput, owners);
    const canonicalBudget = normalizeProductRuntimeBudget(canonical.budget, canonicalOwners);
    if (budget.maxFiles > canonicalBudget.maxFiles || budget.maxBytes > canonicalBudget.maxBytes) {
        throw new Error(`Product Runtime Image ${platform} 总预算放宽了规范平台 policy，policy 摘要不被接受。`);
    }
    const canonicalBaselines = new Map(canonicalBudget.ownerBaselines.map((baseline) => [baseline.name, baseline]));
    for (const baseline of budget.ownerBaselines) {
        const ceiling = canonicalBaselines.get(baseline.name)!;
        if (baseline.files > ceiling.files || baseline.bytes > ceiling.bytes) {
            throw new Error(`Product Runtime Image ${platform} owner baseline 放宽了规范平台 policy：${baseline.name}，policy 摘要不被接受。`);
        }
    }
}

/** 将 manifest 可复算身份稳定投影为 image ID。 */
export function productRuntimeManifestImageId(manifest: ProductRuntimeImageManifest): string {
    return sha256ProductRuntimeText(canonicalProductRuntimeJson({
        schema: manifest.schema,
        builderContractVersion: manifest.builderContractVersion,
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        lockfileSha256: manifest.lockfileSha256,
        sourceDigest: manifest.sourceDigest,
        runtime: manifest.runtime,
        runtimeContract: manifest.runtimeContract,
        policy: manifest.policy,
        inventory: manifest.inventory,
        treeDigest: manifest.treeDigest,
        shapeDigest: manifest.shapeDigest,
    }));
}

/** 使用流式 SHA-256，避免大 Product 文件进入进程内存。 */
export async function productRuntimeFileDigest(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return `sha256:${hash.digest("hex")}`;
}

/** 生成统一带算法前缀的文本摘要。 */
export function sha256ProductRuntimeText(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** JSON key 排序后序列化，保证 manifest key 顺序变化不影响 image ID。 */
export function canonicalProductRuntimeJson(value: unknown): string {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("canonical JSON 不接受非有限数字。");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalProductRuntimeJson(entry)).join(",")}]`;
    if (typeof value === "object") {
        const record = value as {[key: string]: unknown};
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalProductRuntimeJson(record[key])}`).join(",")}}`;
    }
    throw new Error(`canonical JSON 不接受 ${typeof value}。`);
}

/** inventory 外的 manifest/ready 控制文件也必须计入物理硬上限。 */
function assertPhysicalBudget(
    inspection: ProductRuntimeInspection,
    control: RuntimeControlPlaneState,
    budget: ProductRuntimeImageBudget,
): void {
    const physicalFiles = inspection.files + 2;
    const physicalBytes = inspection.bytes
        + Buffer.byteLength(control.manifestText)
        + Buffer.byteLength(control.markerText);
    if (physicalFiles > budget.maxFiles || physicalBytes > budget.maxBytes) {
        throw new Error(
            `Product Runtime Image 物理载荷超出总预算：${physicalFiles}/${budget.maxFiles} files，`
            + `${physicalBytes}/${budget.maxBytes} bytes。`,
        );
    }
}

/** expected identity 是消费方与 Verifier 之间的 fail-closed 代次合同。 */
function assertIdentity(manifest: ProductRuntimeImageManifest, expected: ProductRuntimeExpectedIdentity): void {
    for (const key of [
        "version", "revision", "dirty", "platform", "imageId", "lockfileSha256", "sourceDigest", "builderContractVersion",
    ] as const) {
        if (expected[key] !== undefined && expected[key] !== manifest[key]) {
            throw new Error(`Product Runtime Image 身份不一致：${key} expected=${String(expected[key])} actual=${String(manifest[key])}`);
        }
    }
}

/** 解析外部 manifest；磁盘 JSON 在验证前始终按 unknown 处理。 */
function parseManifest(text: string): ProductRuntimeImageManifest {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`Product Runtime Image manifest 不是有效 JSON：${String(error)}`);
    }
    const record = plainObject(value, "runtime-image manifest");
    assertExactKeys(record, [
        "schema", "builderContractVersion", "imageId", "version", "revision", "dirty", "platform",
        "lockfileSha256", "sourceDigest", "runtime", "runtimeContract", "policy", "inventory", "treeDigest", "shapeDigest", "createdAt",
    ], "runtime-image manifest");
    if (record.schema !== MANIFEST_SCHEMA || record.builderContractVersion !== PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION) {
        throw new Error("Product Runtime Image manifest schema 或 Builder 合同版本不受支持。");
    }
    const runtime = plainObject(record.runtime, "runtime-image runtime");
    assertExactKeys(runtime, ["bun", "nuxt", "nitro"], "runtime-image runtime");
    const runtimeContract = plainObject(record.runtimeContract, "runtime-image runtimeContract");
    assertExactKeys(runtimeContract, ["path", "sha256"], "runtime-image runtimeContract");
    if (runtimeContract.path !== PRODUCT_RUNTIME_CONTRACT_PATH || !isProductRuntimeSha256(runtimeContract.sha256)) {
        throw new Error("Product Runtime Image runtimeContract identity 无效。");
    }
    const policyRecord = plainObject(record.policy, "runtime-image policy");
    assertExactKeys(policyRecord, ["schema", "sha256", "owners", "budget"], "runtime-image policy");
    if (policyRecord.schema !== POLICY_SCHEMA || !isProductRuntimeSha256(policyRecord.sha256)) {
        throw new Error("Product Runtime Image policy identity 无效。");
    }
    if (!Array.isArray(policyRecord.owners)) throw new Error("Product Runtime Image policy.owners 必须是数组。");
    const policyOwners = normalizeProductRuntimeOwners(policyRecord.owners.map((ownerValue, index) => {
        const owner = plainObject(ownerValue, `runtime-image policy owner[${index}]`);
        assertExactKeys(owner, ["name", "paths"], `runtime-image policy owner[${index}]`);
        if (typeof owner.name !== "string" || !Array.isArray(owner.paths)
            || !owner.paths.every((path) => typeof path === "string")) {
            throw new Error(`Product Runtime Image policy owner[${index}] identity 无效。`);
        }
        return {name: owner.name, paths: owner.paths};
    }));
    const budgetRecord = plainObject(policyRecord.budget, "runtime-image policy budget");
    assertExactKeys(budgetRecord, ["maxFiles", "maxBytes", "ownerBaselines"], "runtime-image policy budget");
    if (!Array.isArray(budgetRecord.ownerBaselines)) {
        throw new Error("Product Runtime Image policy ownerBaselines 必须是数组。");
    }
    const policyBudget = normalizeProductRuntimeBudget({
        maxFiles: budgetRecord.maxFiles as number,
        maxBytes: budgetRecord.maxBytes as number,
        ownerBaselines: budgetRecord.ownerBaselines.map((baselineValue, index) => {
            const baseline = plainObject(baselineValue, `runtime-image policy baseline[${index}]`);
            assertExactKeys(baseline, ["name", "files", "bytes"], `runtime-image policy baseline[${index}]`);
            if (typeof baseline.name !== "string") {
                throw new Error(`Product Runtime Image policy baseline[${index}] name 无效。`);
            }
            return {name: baseline.name, files: baseline.files as number, bytes: baseline.bytes as number};
        }),
    }, policyOwners);
    const policy = createProductRuntimePolicy(policyOwners, policyBudget);
    if (policy.sha256 !== policyRecord.sha256) {
        throw new Error("Product Runtime Image policy 摘要无法由策略内容重建。");
    }
    const inventory = plainObject(record.inventory, "runtime-image inventory");
    assertExactKeys(inventory, ["files", "bytes", "owners"], "runtime-image inventory");
    if (!Array.isArray(inventory.owners)) throw new Error("Product Runtime Image inventory.owners 必须是数组。");
    const owners = inventory.owners.map((ownerValue, index) => {
        const owner = plainObject(ownerValue, `runtime-image owner[${index}]`);
        assertExactKeys(owner, ["name", "paths", "files", "bytes"], `runtime-image owner[${index}]`);
        if (typeof owner.name !== "string" || !Array.isArray(owner.paths)
            || !owner.paths.every((path) => typeof path === "string")) {
            throw new Error(`Product Runtime Image owner[${index}] identity 无效。`);
        }
        assertNonNegativeInteger(owner.files, `owner[${index}].files`);
        assertNonNegativeInteger(owner.bytes, `owner[${index}].bytes`);
        return {name: owner.name, paths: owner.paths, files: owner.files, bytes: owner.bytes};
    });
    normalizeProductRuntimeOwners(owners);
    assertNonNegativeInteger(inventory.files, "inventory.files");
    assertNonNegativeInteger(inventory.bytes, "inventory.bytes");
    for (const [label, field] of [
        ["imageId", record.imageId],
        ["lockfileSha256", record.lockfileSha256],
        ["sourceDigest", record.sourceDigest],
        ["treeDigest", record.treeDigest],
        ["shapeDigest", record.shapeDigest],
    ] as const) {
        if (!isProductRuntimeSha256(field)) throw new Error(`Product Runtime Image ${label} 无效。`);
    }
    for (const [label, field] of [
        ["version", record.version], ["revision", record.revision], ["platform", record.platform],
        ["runtime.bun", runtime.bun], ["runtime.nuxt", runtime.nuxt], ["runtime.nitro", runtime.nitro],
        ["createdAt", record.createdAt],
    ] as const) {
        if (typeof field !== "string" || !field) throw new Error(`Product Runtime Image ${label} 无效。`);
    }
    if (typeof record.dirty !== "boolean" || Number.isNaN(Date.parse(record.createdAt as string))) {
        throw new Error("Product Runtime Image dirty 或 createdAt 无效。");
    }
    if (!/^[0-9a-f]{40,64}$/iu.test(record.revision as string)) {
        throw new Error("Product Runtime Image revision 不是 Git object ID。");
    }
    assertProductRuntimePlatform(record.platform as string);
    return {
        schema: MANIFEST_SCHEMA,
        builderContractVersion: PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
        imageId: record.imageId as string,
        version: record.version as string,
        revision: record.revision as string,
        dirty: record.dirty,
        platform: record.platform as ProductPlatform,
        lockfileSha256: record.lockfileSha256 as string,
        sourceDigest: record.sourceDigest as string,
        runtime: {bun: runtime.bun as string, nuxt: runtime.nuxt as string, nitro: runtime.nitro as string},
        runtimeContract: {path: PRODUCT_RUNTIME_CONTRACT_PATH, sha256: runtimeContract.sha256},
        policy,
        inventory: {files: inventory.files, bytes: inventory.bytes, owners},
        treeDigest: record.treeDigest as string,
        shapeDigest: record.shapeDigest as string,
        createdAt: record.createdAt as string,
    };
}

/** 解析并严格校验最后写入的 ready marker。 */
function parseReadyMarker(text: string): ReadyMarker {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`Product Runtime Image ready marker 不是有效 JSON：${String(error)}`);
    }
    const marker = plainObject(value, "runtime-image ready marker");
    assertExactKeys(marker, ["schema", "imageId", "manifestSha256"], "runtime-image ready marker");
    if (marker.schema !== READY_SCHEMA || !isProductRuntimeSha256(marker.imageId)
        || !isProductRuntimeSha256(marker.manifestSha256)) {
        throw new Error("Product Runtime Image ready marker 字段无效。");
    }
    return {schema: READY_SCHEMA, imageId: marker.imageId, manifestSha256: marker.manifestSha256};
}

/** 控制文件必须是有大小上限的普通文件，不能借 symlink 读取候选外内容。 */
export async function readProductRuntimeControlFile(filePath: string, label: string): Promise<string> {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONTROL_FILE_BYTES) {
        throw new Error(`Product Runtime Image ${label} 不是有效普通文件。`);
    }
    return await readFile(filePath, "utf8");
}

/** owner path 匹配完整路径段，避免相似前缀被误归属。 */
function pathOwnedBy(filePath: string, ownerPath: string): boolean {
    return ownerPath === "." || filePath === ownerPath || filePath.startsWith(`${ownerPath}/`);
}

/** 所有相对路径统一为 POSIX 形态，并拒绝盘符、UNC 与 `..`。 */
export function normalizeProductRuntimeRelativePath(input: string, label: string): string {
    const portableInput = input.replaceAll("\\", "/");
    const segments = portableInput.split("/");
    if (!input || input.includes("\0") || /^[A-Za-z]:/u.test(input)
        || isAbsolute(input) || win32.isAbsolute(input) || posix.isAbsolute(input)) {
        throw new Error(`${label} 必须是候选根内相对路径：${JSON.stringify(input)}`);
    }
    if (segments.includes("..")) throw new Error(`${label} 不能逃逸候选根：${JSON.stringify(input)}`);
    const normalized = posix.normalize(portableInput);
    return normalized === "./" ? "." : normalized.replace(/^\.\//u, "");
}

/** 候选与 symlink target 必须位于声明根之内。 */
export function assertProductRuntimeContainedPath(root: string, target: string, label: string): void {
    const child = relative(resolve(root), resolve(target));
    if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) return;
    throw new Error(`${label} 逃逸允许根：${target}`);
}

/** 平台身份只接受 Manager 穷举的平台集合。 */
export function assertProductRuntimePlatform(platform: string): asserts platform is ProductPlatform {
    if (!platform.trim() || platform !== platform.trim() || /[\u0000-\u001f]/u.test(platform)
        || !PRODUCT_PLATFORMS.some((candidate) => candidate === platform)) {
        throw new Error(`Product Runtime Image platform 无效：${JSON.stringify(platform)}`);
    }
}

/** openVerified 的四项基础代次身份不可省略。 */
function assertExpectedIdentity(identity: ProductRuntimeExpectedIdentity): void {
    if (!identity.version || !identity.revision || !identity.platform || typeof identity.dirty !== "boolean") {
        throw new Error("Product Runtime Image expected identity 必须包含 version、revision、dirty 与 platform。");
    }
    if (!/^[0-9a-f]{40,64}$/iu.test(identity.revision)) {
        throw new Error("Product Runtime Image expected revision 必须是 Git object ID。");
    }
    assertProductRuntimePlatform(identity.platform);
    for (const [label, digest] of [
        ["imageId", identity.imageId],
        ["lockfileSha256", identity.lockfileSha256],
        ["sourceDigest", identity.sourceDigest],
    ] as const) {
        if (digest !== undefined && !isProductRuntimeSha256(digest)) {
            throw new Error(`Product Runtime Image expected ${label} 无效。`);
        }
    }
    if (identity.builderContractVersion !== undefined
        && (!identity.builderContractVersion.trim() || /[\u0000-\u001f]/u.test(identity.builderContractVersion))) {
        throw new Error("Product Runtime Image expected builderContractVersion 无效。");
    }
}

/** JSON 外部对象的唯一集中收窄点。 */
function plainObject(value: unknown, label: string): {[key: string]: unknown} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Product Runtime Image ${label} 必须是 object。`);
    }
    return value as {[key: string]: unknown};
}

/** 未知字段必须通过新 schema 演进。 */
function assertExactKeys(record: {[key: string]: unknown}, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const required = [...expected].sort();
    if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
        throw new Error(`Product Runtime Image ${label} 字段集合无效。`);
    }
}

/** 数量与字节预算只接受可精确表达的非负整数。 */
function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Product Runtime Image ${label} 必须是非负安全整数。`);
    }
}

/** 所有持久化摘要都显式携带 SHA-256 算法名。 */
export function isProductRuntimeSha256(value: unknown): value is string {
    return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** 使用固定 UTF-16 code unit 顺序，避免 locale/ICU 改变跨机器 digest。 */
export function compareProductRuntimeText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
