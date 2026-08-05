import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";

import {
    ProductRuntimeImageVerifier,
    type ProductRuntimeExpectedIdentity,
    type ProductRuntimeImageManifest,
    type ProductRuntimeImageVerificationOptions,
} from "nbook/shared/product-runtime-image-verifier";

export const PRODUCT_RUNTIME_RECEIPT_SCHEMA = "nbook.product-runtime-receipt/v1";

export type ProductRuntimeVerificationReceipt = {
    schema: typeof PRODUCT_RUNTIME_RECEIPT_SCHEMA;
    imageId: string;
    version: string;
    revision: string;
    dirty: boolean;
    platform: ProductRuntimeImageManifest["platform"];
    sourceDigest: string;
    lockfileSha256: string;
    builderContractVersion: string;
    treeDigest: string;
    shapeDigest: string;
    runtimeContract: ProductRuntimeImageManifest["runtimeContract"];
    issuedAt: string;
};

/** 从已完整验证的 Product manifest 建立不含绝对路径的安装回执。 */
export function createProductRuntimeVerificationReceipt(
    manifest: ProductRuntimeImageManifest,
    issuedAt = new Date().toISOString(),
): ProductRuntimeVerificationReceipt {
    return {
        schema: PRODUCT_RUNTIME_RECEIPT_SCHEMA,
        imageId: manifest.imageId,
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        sourceDigest: manifest.sourceDigest,
        lockfileSha256: manifest.lockfileSha256,
        builderContractVersion: manifest.builderContractVersion,
        treeDigest: manifest.treeDigest,
        shapeDigest: manifest.shapeDigest,
        runtimeContract: {...manifest.runtimeContract},
        issuedAt,
    };
}

/** 完整验证镜像并生成回执；回执不能脱离本次验证单独伪造。 */
export async function issueProductRuntimeVerificationReceipt(
    imageRoot: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
    options: ProductRuntimeImageVerificationOptions = {},
    issuedAt?: string,
): Promise<ProductRuntimeVerificationReceipt> {
    const verified = await new ProductRuntimeImageVerifier().openVerified(imageRoot, expectedIdentity, options);
    return createProductRuntimeVerificationReceipt(verified.manifest, issuedAt);
}

/** 原子写入 Installation Root 的回执，临时文件只存在于 .deploy 内。 */
export async function writeProductRuntimeVerificationReceipt(
    receiptPath: string,
    receipt: ProductRuntimeVerificationReceipt,
): Promise<void> {
    const parsed = parseProductRuntimeVerificationReceipt(receipt);
    await mkdir(dirname(receiptPath), {recursive: true});
    const temporaryPath = `${receiptPath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 4)}\n`, "utf8");
        await rename(temporaryPath, receiptPath);
    } finally {
        await rm(temporaryPath, {force: true}).catch(() => undefined);
    }
}

/** 严格读取安装回执，不接受未知字段、绝对路径或不匹配的摘要。 */
export async function readProductRuntimeVerificationReceipt(receiptPath: string): Promise<ProductRuntimeVerificationReceipt> {
    return parseProductRuntimeVerificationReceipt(JSON.parse(await readFile(resolve(receiptPath), "utf8")) as unknown);
}

/** 快验控制面与回执的一致性；不遍历 payload，供启动前使用。 */
export async function verifyProductRuntimeReceiptControlPlane(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeImageManifest> {
    const receipt = await readProductRuntimeVerificationReceipt(receiptPath);
    const verified = await new ProductRuntimeImageVerifier().openControlPlane(imageRoot, expectedIdentity, {allowPreviousRuntimeContract: true});
    assertReceiptMatchesManifest(receipt, verified.manifest);
    return verified.manifest;
}

/** 完整复核镜像并确认安装回执仍绑定同一代次。 */
export async function verifyProductRuntimeReceiptFully(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeImageManifest> {
    const receipt = await readProductRuntimeVerificationReceipt(receiptPath);
    const verified = await new ProductRuntimeImageVerifier().openVerified(imageRoot, expectedIdentity, {allowPreviousRuntimeContract: true});
    assertReceiptMatchesManifest(receipt, verified.manifest);
    return verified.manifest;
}

function assertReceiptMatchesManifest(receipt: ProductRuntimeVerificationReceipt, manifest: ProductRuntimeImageManifest): void {
    const expected = createProductRuntimeVerificationReceipt(manifest, receipt.issuedAt);
    if (JSON.stringify(expected) !== JSON.stringify(receipt)) {
        throw new Error("Product Runtime verification receipt 与镜像 manifest 不一致。");
    }
}

function parseProductRuntimeVerificationReceipt(value: unknown): ProductRuntimeVerificationReceipt {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Product Runtime verification receipt 必须是对象。");
    const root = value as Record<string, unknown>;
    exactKeys(root, [
        "schema", "imageId", "version", "revision", "dirty", "platform", "sourceDigest", "lockfileSha256",
        "builderContractVersion", "treeDigest", "shapeDigest", "runtimeContract", "issuedAt",
    ], "Product Runtime verification receipt");
    if (root.schema !== PRODUCT_RUNTIME_RECEIPT_SCHEMA) throw new Error("Product Runtime verification receipt schema 不受支持。");
    for (const key of ["imageId", "sourceDigest", "lockfileSha256", "treeDigest", "shapeDigest"] as const) {
        if (typeof root[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(root[key])) throw new Error(`${key} 必须是 sha256 摘要。`);
    }
    for (const key of ["version", "revision", "builderContractVersion", "issuedAt"] as const) {
        if (typeof root[key] !== "string" || !root[key]) throw new Error(`${key} 必须是非空字符串。`);
    }
    if (typeof root.dirty !== "boolean") throw new Error("dirty 必须是 boolean。");
    if (typeof root.platform !== "string" || !["windows-x64", "linux-x64-glibc", "linux-aarch64-glibc", "darwin-x64", "darwin-aarch64"].includes(root.platform)) {
        throw new Error("platform 不受支持。");
    }
    if (!root.runtimeContract || typeof root.runtimeContract !== "object" || Array.isArray(root.runtimeContract)) throw new Error("runtimeContract 必须是对象。");
    const runtimeContract = root.runtimeContract as Record<string, unknown>;
    if (runtimeContract.path !== "server/runtime-contract.json" || typeof runtimeContract.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(runtimeContract.sha256)) {
        throw new Error("runtimeContract 回执无效。");
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(root.issuedAt as string)) throw new Error("issuedAt 必须是 UTC 时间。");
    return {
        schema: PRODUCT_RUNTIME_RECEIPT_SCHEMA,
        imageId: root.imageId as string,
        version: root.version as string,
        revision: root.revision as string,
        dirty: root.dirty as boolean,
        platform: root.platform as ProductRuntimeImageManifest["platform"],
        sourceDigest: root.sourceDigest as string,
        lockfileSha256: root.lockfileSha256 as string,
        builderContractVersion: root.builderContractVersion as string,
        treeDigest: root.treeDigest as string,
        shapeDigest: root.shapeDigest as string,
        runtimeContract: {path: runtimeContract.path as "server/runtime-contract.json", sha256: runtimeContract.sha256 as string},
        issuedAt: root.issuedAt as string,
    };
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} 字段不匹配。`);
}
