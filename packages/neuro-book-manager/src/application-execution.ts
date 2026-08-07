import {resolve} from "node:path";
import {verifyInstalledProductRuntimeImage, type VerifiedRuntimeImageIdentity} from "#manager/product";
import {verifyContainerProductImage, type VerifiedContainerImage} from "#manager/docker";
import type {ContainerEngine, InstallationManifest, ProductComponent} from "#manager/types";
import {
    verifyAuthorizedProductRuntimeReceiptControlPlane,
    type ProductRuntimeReceiptAuthorization,
} from "nbook/shared/product-runtime-receipt";

/** 所有 Application 子进程只能消费的已验证执行身份。 */
export type VerifiedApplicationExecution =
    | Readonly<{
        kind: "source-dev";
        applicationRoot: string;
    }>
    | Readonly<{
        kind: "native-product";
        applicationRoot: string;
        imageRoot: string;
        identity: VerifiedRuntimeImageIdentity;
    }>
    | Readonly<{
        kind: "container-product";
        applicationRoot: string;
        engine: ContainerEngine;
        product: Extract<ProductComponent, {provider: "container"}>;
        image: VerifiedContainerImage;
    }>;

export type VerifyApplicationExecutionOptions = Readonly<{
    productRuntimeReceipt?: ProductRuntimeReceiptAuthorization;
}>;

/**
 * 在任何 spawn/Compose 调用前把 Installation Manifest 收窄为可执行句柄。
 * Source Dev 是唯一不消费 Product Runtime Image 的 Adapter。
 */
export async function verifyApplicationExecution(
    applicationRoot: string,
    manifest: InstallationManifest,
    options: VerifyApplicationExecutionOptions = {},
): Promise<VerifiedApplicationExecution> {
    const root = resolve(applicationRoot);
    if (manifest.profile === "source-dev") {
        return Object.freeze({kind: "source-dev", applicationRoot: root});
    }
    const product = manifest.components.product;
    if (!product) {
        throw new Error(`${manifest.profile} Installation Manifest 缺少 Product。`);
    }
    if (product.provider === "container") {
        if (!manifest.containerEngine) {
            throw new Error(`${manifest.profile} Installation Manifest 缺少 Container Engine。`);
        }
        const image = await verifyContainerProductImage(
            manifest.containerEngine,
            root,
            manifest.profile,
            product,
        );
        return Object.freeze({
            kind: "container-product",
            applicationRoot: root,
            engine: manifest.containerEngine,
            product,
            image,
        });
    }
    const identity = options.productRuntimeReceipt
        ? identityFromManifest(await verifyAuthorizedProductRuntimeReceiptControlPlane(
            resolve(root, product.path),
            root,
            options.productRuntimeReceipt,
            {
                version: product.version,
                revision: product.revision,
                dirty: false,
                platform: product.platform,
                imageId: product.imageId,
                sourceDigest: product.sourceDigest,
                lockfileSha256: product.lockfileSha256,
                builderContractVersion: product.builderContractVersion,
            },
        ))
        : await verifyInstalledProductRuntimeImage(root, product);
    return Object.freeze({
        kind: "native-product",
        applicationRoot: root,
        imageRoot: resolve(root, product.path),
        identity,
    });
}

function identityFromManifest(manifest: {
    version: string;
    revision: string;
    dirty: boolean;
    platform: VerifiedRuntimeImageIdentity["platform"];
    imageId: string;
    sourceDigest: string;
    lockfileSha256: string;
    builderContractVersion: string;
}): VerifiedRuntimeImageIdentity {
    return {
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        imageId: manifest.imageId,
        sourceDigest: manifest.sourceDigest,
        lockfileSha256: manifest.lockfileSha256,
        builderContractVersion: manifest.builderContractVersion,
    };
}
