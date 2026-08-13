import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, resolve, win32} from "node:path";

import {
    ProductRuntimeImageVerifier,
    type ProductRuntimeExpectedIdentity,
    type ProductRuntimeImageManifest,
    type ProductRuntimeImageVerificationOptions,
} from "nbook/shared/product-runtime-image-verifier";

export const PRODUCT_RUNTIME_RECEIPT_SCHEMA = "nbook.product-runtime-receipt/v1";
export const PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT = "NEURO_BOOK_PRODUCT_RUNTIME_RECEIPT_PATH";
export const PRODUCT_RUNTIME_RECEIPT_SHA256_ENVIRONMENT = "NEURO_BOOK_PRODUCT_RUNTIME_RECEIPT_SHA256";

export type ProductRuntimeReceiptAuthorization = Readonly<{
    path: string;
    sha256: string;
}>;

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

/** 快验控制面与回执的一致性；不遍历 payload，供诊断或显式检查使用。 */
export async function verifyProductRuntimeReceiptControlPlane(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeImageManifest> {
    return (await inspectProductRuntimeReceipt(imageRoot, receiptPath, expectedIdentity, false)).manifest;
}

/**
 * Manager 在需要完整验证的 Product 子进程路径前完整验证镜像，并把本次读到的精确回执内容授权给子进程。
 * 授权只存在于进程环境，不写入 Runtime Image 或 State Root；它不能替代启动前的完整验证。
 */
export async function authorizeProductRuntimeReceiptFully(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeReceiptAuthorization> {
    return (await inspectProductRuntimeReceipt(imageRoot, receiptPath, expectedIdentity, true)).authorization;
}
/**
 * Manager 普通 Desktop 启动只复核已签发回执与 Runtime 控制面，不遍历 payload。
 * 完整 payload 验证仍由安装、更新、Repair、doctor 和显式 verify 路径拥有。
 */
export async function authorizeProductRuntimeReceiptControlPlane(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeReceiptAuthorization> {
    return (await inspectProductRuntimeReceipt(imageRoot, receiptPath, expectedIdentity, false)).authorization;
}

/**
 * Product bootstrap 消费 Manager 已在启动前完整验证过的回执授权，只复核控制面。
 * 回执路径固定在当前 Application Root 的 `.deploy`，不能借此验证任意外部文件。
 */
export async function verifyAuthorizedProductRuntimeReceiptControlPlane(
    imageRoot: string,
    applicationRoot: string,
    authorization: ProductRuntimeReceiptAuthorization,
    expectedIdentity?: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeImageManifest> {
    const expectedReceiptPath = resolve(applicationRoot, ".deploy", "product-runtime-receipt.json");
    const authorizedPath = resolve(authorization.path);
    if (authorizedPath !== expectedReceiptPath) {
        throw new Error("Product Runtime receipt 授权路径不是当前 Installation Root 的受管回执。");
    }
    assertReceiptSha256(authorization.sha256, "Product Runtime receipt 授权摘要");
    const receiptText = await readFile(authorizedPath, "utf8");
    if (productRuntimeReceiptSha256(receiptText) !== authorization.sha256) {
        throw new Error("Product Runtime receipt 授权摘要与磁盘内容不一致。");
    }
    const receipt = parseProductRuntimeVerificationReceipt(JSON.parse(receiptText) as unknown);
    const verified = await new ProductRuntimeImageVerifier().openControlPlane(
        imageRoot,
        expectedIdentity ?? expectedIdentityFromReceipt(receipt),
        {allowPreviousRuntimeContract: true},
    );
    assertReceiptMatchesManifest(receipt, verified.manifest);
    if (await readFile(authorizedPath, "utf8") !== receiptText) {
        throw new Error("Product Runtime verification receipt 在验证期间发生变化。");
    }
    return verified.manifest;
}

/** 将内存授权投影为 Product command 子进程环境。 */
export function productRuntimeReceiptEnvironment(
    authorization: ProductRuntimeReceiptAuthorization,
): NodeJS.ProcessEnv {
    const path = authorization.path.trim();
    if (!path || !isPortableAbsolutePath(path)) {
        throw new Error("Product Runtime receipt 授权路径必须是绝对路径。");
    }
    assertReceiptSha256(authorization.sha256, "Product Runtime receipt 授权摘要");
    return {
        [PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT]: path,
        [PRODUCT_RUNTIME_RECEIPT_SHA256_ENVIRONMENT]: authorization.sha256,
    };
}

/** 从 Product command 环境读取成对授权；缺一项时 fail closed。 */
export function productRuntimeReceiptAuthorizationFromEnvironment(
    environment: Readonly<Record<string, string | undefined>>,
): ProductRuntimeReceiptAuthorization | null {
    const path = environment[PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT]?.trim() ?? "";
    const sha256 = environment[PRODUCT_RUNTIME_RECEIPT_SHA256_ENVIRONMENT]?.trim() ?? "";
    if (!path && !sha256) return null;
    if (!path || !sha256) {
        throw new Error("Product Runtime receipt 启动授权必须同时提供路径和摘要。");
    }
    productRuntimeReceiptEnvironment({path, sha256});
    return {path, sha256};
}

/** 完整复核镜像并确认安装回执仍绑定同一代次。 */
export async function verifyProductRuntimeReceiptFully(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
): Promise<ProductRuntimeImageManifest> {
    return (await inspectProductRuntimeReceipt(imageRoot, receiptPath, expectedIdentity, true)).manifest;
}

async function inspectProductRuntimeReceipt(
    imageRoot: string,
    receiptPath: string,
    expectedIdentity: ProductRuntimeExpectedIdentity,
    full: boolean,
): Promise<{
    manifest: ProductRuntimeImageManifest;
    authorization: ProductRuntimeReceiptAuthorization;
}> {
    const absoluteReceiptPath = resolve(receiptPath);
    const receiptText = await readFile(absoluteReceiptPath, "utf8");
    const receipt = parseProductRuntimeVerificationReceipt(JSON.parse(receiptText) as unknown);
    const verifier = new ProductRuntimeImageVerifier();
    const verified = full
        ? await verifier.openVerified(imageRoot, expectedIdentity, {allowPreviousRuntimeContract: true})
        : await verifier.openControlPlane(imageRoot, expectedIdentity, {allowPreviousRuntimeContract: true});
    assertReceiptMatchesManifest(receipt, verified.manifest);
    if (await readFile(absoluteReceiptPath, "utf8") !== receiptText) {
        throw new Error("Product Runtime verification receipt 在验证期间发生变化。");
    }
    return {
        manifest: verified.manifest,
        authorization: {
            path: absoluteReceiptPath,
            sha256: productRuntimeReceiptSha256(receiptText),
        },
    };
}

function expectedIdentityFromReceipt(receipt: ProductRuntimeVerificationReceipt): ProductRuntimeExpectedIdentity {
    return {
        version: receipt.version,
        revision: receipt.revision,
        dirty: receipt.dirty,
        platform: receipt.platform,
        imageId: receipt.imageId,
        sourceDigest: receipt.sourceDigest,
        lockfileSha256: receipt.lockfileSha256,
        builderContractVersion: receipt.builderContractVersion,
    };
}

function productRuntimeReceiptSha256(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function assertReceiptSha256(value: string, label: string): void {
    if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
        throw new Error(`${label} 必须是 sha256 摘要。`);
    }
}

function isPortableAbsolutePath(value: string): boolean {
    return isAbsolute(value) || win32.isAbsolute(value);
}

function assertReceiptMatchesManifest(receipt: ProductRuntimeVerificationReceipt, manifest: ProductRuntimeImageManifest): void {
    const expected = createProductRuntimeVerificationReceipt(manifest, receipt.issuedAt);
    const runtimeContractMatches = receipt.runtimeContract.path === expected.runtimeContract.path
        && receipt.runtimeContract.sha256 === expected.runtimeContract.sha256;
    if (
        receipt.schema !== expected.schema
        || receipt.imageId !== expected.imageId
        || receipt.version !== expected.version
        || receipt.revision !== expected.revision
        || receipt.dirty !== expected.dirty
        || receipt.platform !== expected.platform
        || receipt.sourceDigest !== expected.sourceDigest
        || receipt.lockfileSha256 !== expected.lockfileSha256
        || receipt.builderContractVersion !== expected.builderContractVersion
        || receipt.treeDigest !== expected.treeDigest
        || receipt.shapeDigest !== expected.shapeDigest
        || !runtimeContractMatches
    ) {
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
