import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readFile, readdir, readlink, realpath, stat} from "node:fs/promises";
import {isAbsolute, posix, relative, resolve, sep, win32} from "node:path";

import {
    assertProductRuntimeBudget,
    assertProductRuntimeContainedPath,
    assertProductRuntimeExpectedIdentity,
    assertProductRuntimePolicy,
    canonicalProductRuntimeJson,
    compareProductRuntimeText,
    normalizeProductRuntimeOwners,
    parseProductRuntimeContract,
    parseProductRuntimeImageManifest as parseManifest,
    parseProductRuntimeReadyMarker as parseReadyMarker,
    productRuntimeContractSha256,
    productRuntimeManifestImageId,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_CONTRACT_PATH,
    sha256ProductRuntimeText,
} from "@notnotype/neuro-book-contracts/product-runtime";
import type {
    ParsedProductRuntimeContract,
    ProductRuntimeExpectedIdentity,
    ProductRuntimeFileRecord,
    ProductRuntimeImageBudget,
    ProductRuntimeImageControlPlane,
    ProductRuntimeImageManifest,
    ProductRuntimeImageOwner,
    ProductRuntimeImageVerificationOptions,
    ProductRuntimeInspection,
    VerifiedProductRuntimeImage,
} from "@notnotype/neuro-book-contracts/product-runtime";

const MANIFEST_FILE = "runtime-image.json";
const READY_FILE = "runtime-image.ready";
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;


interface RuntimeControlPlaneState extends ProductRuntimeImageControlPlane {
    manifestPath: string;
    markerPath: string;
    runtimeContractPath: string;
    manifestText: string;
    markerText: string;
    runtimeContractText: string;
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
        assertProductRuntimeExpectedIdentity(expectedIdentity);
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

/** 使用流式 SHA-256，避免大 Product 文件进入进程内存。 */
export async function productRuntimeFileDigest(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return `sha256:${hash.digest("hex")}`;
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

/** 读取并解析应用 Runtime Image 中的合同；文件访问只属于应用宿主。 */
export async function readProductRuntimeContract(imageRoot: string): Promise<import("@notnotype/neuro-book-contracts/product-runtime").ProductRuntimeContract>;
export async function readProductRuntimeContract(imageRoot: string, options: {allowPrevious: true}): Promise<ParsedProductRuntimeContract>;
export async function readProductRuntimeContract(
    imageRoot: string,
    options: {allowPrevious?: boolean} = {},
): Promise<ParsedProductRuntimeContract> {
    const text = await readProductRuntimeControlFile(
        resolve(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/")),
        "Product Runtime Contract",
    );
    return options.allowPrevious
        ? parseProductRuntimeContract(JSON.parse(text) as unknown, {allowPrevious: true})
        : parseProductRuntimeContract(JSON.parse(text) as unknown);
}

/** 验证合同入口存在且为普通文件；不把该文件系统检查放入 contracts。 */
export async function assertProductRuntimeContractFiles(
    contract: ParsedProductRuntimeContract,
    imageRoot: string,
): Promise<void> {
    const entries = new Set([
        PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
        ...Object.values(contract.commands).map((item) => item.entry),
        ...Object.values(contract.internal).map((item) => item.entry),
        ...Object.values(contract.checks).map((item) => item.entry),
    ]);
    for (const entry of entries) {
        const info = await stat(resolve(imageRoot, ...entry.split("/"))).catch(() => null);
        if (!info?.isFile()) {
            throw new Error(`Product Runtime Contract 入口不存在：${entry}`);
        }
    }
}
