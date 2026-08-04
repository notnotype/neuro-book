import {randomUUID} from "node:crypto";
import {cp, mkdir, rename, rm} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";

import type {StagedProduct} from "#manager/component";
import {removePath} from "#manager/files";
import {run, runBun} from "#manager/process";
import {currentProductPlatform} from "#manager/platform";
import type {ProductComponent, ProductPlatform, ProductRuntimeImageIdentity} from "#manager/types";
import {
    PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION,
    type ProductRuntimeExpectedIdentity,
    type ProductRuntimeImageManifest,
} from "nbook/scripts/build/product-runtime-image-builder";
import {ProductRuntimeImageVerifier} from "nbook/shared/product-runtime-image-verifier";

const RUNTIME_IMAGE_BUILDER_CONTRACT = PRODUCT_RUNTIME_BUILDER_CONTRACT_VERSION;

/** Manager 完成只读控制面验证后返回的 Runtime Image 身份。 */
export type VerifiedRuntimeImageIdentity = ProductRuntimeImageIdentity & {
    version: string;
    revision: string;
    dirty: boolean;
    platform: ProductPlatform;
};

/** 使用 Application Runtime 安装源码依赖。 */
export async function installSourceDependencies(root: string, bun = "bun"): Promise<void> {
    await runBun(bun, ["install", "--frozen-lockfile", "--no-save", "--linker", "hoisted"], {
        cwd: root,
        env: {...process.env, NODE_ENV: "development"},
    });
}

/**
 * 从源码执行统一 `nuxt:build` Builder，并把已验证镜像移入 Manager staging。
 *
 * Builder 输出先放在 Source Root 内被 Git 忽略的 `.agent`，既满足 Builder
 * 同盘原子切换合同，也不会提前覆盖 Installation Root 当前 `.output`。
 */
export async function buildSourceProduct(input: {
    root: string;
    /** Git staged worktree；未设置时等于 Installation Root。 */
    sourceRoot?: string;
    staging: string;
    version: string;
    revision: string;
    stateRoot: string;
    bun?: string;
}): Promise<StagedProduct> {
    const sourceRoot = input.sourceRoot ?? input.root;
    const operationId = `manager-${randomUUID()}`;
    const buildOutput = join(sourceRoot, ".agent", "manager-product-build", operationId, ".output");
    const stagedOutput = join(input.staging, ".output");
    await removePath(stagedOutput);
    await removePath(dirname(buildOutput));
    try {
        await run(input.bun ?? "bun", ["run", "nuxt:build"], {
            cwd: sourceRoot,
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: relative(sourceRoot, buildOutput).replaceAll("\\", "/"),
                NEURO_BOOK_STATE_ROOT: input.stateRoot,
            },
        });
        const identity = await verifyProductRuntimeImage(buildOutput, {
            version: input.version,
            revision: input.revision,
            dirty: false,
            platform: currentProductPlatform(),
            builderContractVersion: RUNTIME_IMAGE_BUILDER_CONTRACT,
        });
        await mkdir(input.staging, {recursive: true});
        await moveRuntimeImage(buildOutput, stagedOutput);
        await verifyProductRuntimeImage(stagedOutput, identity);
        return {
            outputRoot: stagedOutput,
            component: {
                provider: "git",
                version: identity.version,
                revision: identity.revision,
                path: ".output",
                platform: identity.platform,
                imageId: identity.imageId,
                sourceDigest: identity.sourceDigest,
                lockfileSha256: identity.lockfileSha256,
                builderContractVersion: identity.builderContractVersion,
            },
        };
    } finally {
        await removePath(dirname(buildOutput));
    }
}

/** 通过 Builder 的只读 Interface 复核控制文件、Runtime Contract、payload digest 与代次身份。 */
export async function verifyProductRuntimeImage(
    outputRoot: string,
    expected: Partial<ProductRuntimeImageIdentity> & {
        version: string;
        revision: string;
        dirty: boolean;
        platform: ProductPlatform;
    },
): Promise<VerifiedRuntimeImageIdentity> {
    const identity: ProductRuntimeExpectedIdentity = expected;
    const image = await new ProductRuntimeImageVerifier().openVerified(outputRoot, identity);
    return verifiedIdentity(image.manifest);
}

/**
 * 只验证 ready 控制面与 Runtime Contract，供 status/discovery 展示。
 * 该结果不能用于执行、安装、激活、导入或归档 Product。
 */
export async function verifyProductRuntimeControlPlane(
    outputRoot: string,
    expected: Partial<ProductRuntimeImageIdentity> & {
        version: string;
        revision: string;
        dirty: boolean;
        platform: ProductPlatform;
    },
): Promise<VerifiedRuntimeImageIdentity> {
    const image = await new ProductRuntimeImageVerifier().openControlPlane(outputRoot, expected);
    return verifiedIdentity(image.manifest);
}

/** 把 Builder manifest 收窄为 Manager 持久合同中的 Runtime Image 身份。 */
function verifiedIdentity(manifest: ProductRuntimeImageManifest): VerifiedRuntimeImageIdentity {
    return {
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform as ProductPlatform,
        imageId: manifest.imageId,
        sourceDigest: manifest.sourceDigest,
        lockfileSha256: manifest.lockfileSha256,
        builderContractVersion: manifest.builderContractVersion,
    };
}

/**
 * 按 Installation Manifest 的完整代次身份验证磁盘 Product Runtime Image。
 *
 * 该调用会重算 payload/shape digest，供 doctor、导入、安装、更新与发布使用。
 */
export function verifyInstalledProductRuntimeImage(
    installationRoot: string,
    product: Exclude<ProductComponent, {provider: "container"}>,
): Promise<VerifiedRuntimeImageIdentity> {
    return verifyProductRuntimeImage(resolve(installationRoot, product.path), {
        version: product.version,
        revision: product.revision,
        dirty: false,
        platform: product.platform,
        imageId: product.imageId,
        sourceDigest: product.sourceDigest,
        lockfileSha256: product.lockfileSha256,
        builderContractVersion: product.builderContractVersion,
    });
}

/** 只读状态页使用的安装 Product 控制面验证，不遍历 payload。 */
export function verifyInstalledProductRuntimeControlPlane(
    installationRoot: string,
    product: Exclude<ProductComponent, {provider: "container"}>,
): Promise<VerifiedRuntimeImageIdentity> {
    return verifyProductRuntimeControlPlane(resolve(installationRoot, product.path), {
        version: product.version,
        revision: product.revision,
        dirty: false,
        platform: product.platform,
        imageId: product.imageId,
        sourceDigest: product.sourceDigest,
        lockfileSha256: product.lockfileSha256,
        builderContractVersion: product.builderContractVersion,
    });
}

/** 同盘优先 rename；跨盘 staging 明确退化为复制，并由调用方再次验证完整 payload。 */
async function moveRuntimeImage(source: string, target: string): Promise<void> {
    try {
        await rename(source, target);
    } catch (error) {
        if (!isNodeError(error) || error.code !== "EXDEV") throw error;
        await cp(source, target, {recursive: true, dereference: false, force: false});
        await rm(source, {recursive: true, force: true});
    }
}

/** Node 文件系统错误的集中收窄。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
