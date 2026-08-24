import {createHash} from "node:crypto";
import {isAbsolute, posix, relative, resolve, sep, win32} from "node:path";

import {PRODUCT_PLATFORMS, type ProductPlatform} from "../platform";
import {PRODUCT_RUNTIME_CONTRACT_PATH} from "./contract";

const MANIFEST_FILE = "runtime-image.json";
const READY_FILE = "runtime-image.ready";
export const PRODUCT_RUNTIME_IMAGE_MANIFEST_SCHEMA = "nbook.product-runtime-image/v3";
export const PRODUCT_RUNTIME_IMAGE_READY_SCHEMA = "nbook.product-runtime-image-ready/v1";
const MANIFEST_SCHEMA = PRODUCT_RUNTIME_IMAGE_MANIFEST_SCHEMA;
const READY_SCHEMA = PRODUCT_RUNTIME_IMAGE_READY_SCHEMA;
const POLICY_SCHEMA = "nbook.product-runtime-image-policy/v1";
const OWNER_GROWTH_LIMIT = 0.10;
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;
export const PRODUCT_RUNTIME_IMAGE_MANIFEST_FILE = MANIFEST_FILE;
export const PRODUCT_RUNTIME_IMAGE_READY_FILE = READY_FILE;
export const PRODUCT_RUNTIME_IMAGE_POLICY_SCHEMA = POLICY_SCHEMA;

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
export type ProductRuntimeImageReadyMarker = ReadyMarker;
const PRODUCT_RUNTIME_OWNERS: readonly ProductRuntimeImageOwner[] = [
    {name: "frontend", paths: ["public"]},
    {name: "server-bundle", paths: ["server/index.mjs", "server/index.mjs.map"]},
    {name: "commands", paths: ["server/commands", "server/prisma"]},
    {name: "authoring-kit", paths: ["server/authoring"]},
    {name: "native-islands", paths: ["server/node_modules", "server/native-islands.json"]},
    {name: "system-assets", paths: ["server/assets"]},
    {name: "runtime-meta", paths: ["nitro.json", "server/package.json", "server/runtime-contract.json"]},
] as const;

// 2026-08-24：t135 资产安装 runtime 落地后 system-assets 全平台同源增长（442 files）；
// Windows 行尾差异使 bytes 略高，POSIX 与 darwin 实测均为 5_856_353。
const PRODUCT_RUNTIME_OWNER_BASELINES: Partial<Record<ProductPlatform, readonly ProductRuntimeOwnerBaseline[]>> = {
    "windows-x64": [
        {name: "frontend", files: 177, bytes: 15_272_680},
        {name: "server-bundle", files: 1, bytes: 12_300_171},
        {name: "commands", files: 116, bytes: 10_865_638},
        {name: "authoring-kit", files: 509, bytes: 14_477_260},
        {name: "native-islands", files: 2_059, bytes: 75_260_630},
        {name: "system-assets", files: 442, bytes: 5_919_094},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "linux-x64-glibc": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 75_144_692},
        {name: "system-assets", files: 442, bytes: 5_856_353},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "linux-aarch64-glibc": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 72_567_998},
        {name: "system-assets", files: 442, bytes: 5_856_353},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "darwin-x64": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 75_913_156},
        {name: "system-assets", files: 442, bytes: 5_856_353},
        {name: "runtime-meta", files: 3, bytes: 4_762},
    ],
    "darwin-aarch64": [
        {name: "frontend", files: 177, bytes: 15_272_675},
        {name: "server-bundle", files: 1, bytes: 12_300_888},
        {name: "commands", files: 116, bytes: 10_866_185},
        {name: "authoring-kit", files: 509, bytes: 14_475_922},
        {name: "native-islands", files: 2_062, bytes: 71_965_408},
        {name: "system-assets", files: 442, bytes: 5_856_353},
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
export const parseProductRuntimeImageManifest = parseManifest;
export const parseProductRuntimeReadyMarker = parseReadyMarker;
export const assertProductRuntimeExpectedIdentity = assertExpectedIdentity;
