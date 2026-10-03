import {resolve} from "node:path";
import type {ProductComponent, ProductRuntimeImageIdentity} from "@notnotype/neuro-book-contracts/installation";
import type {ProductPlatform} from "@notnotype/neuro-book-contracts/platform";

import {ProductRuntimeImageVerifier} from "../server/interfaces/product-runtime-image-verifier";
export {
    authorizeProductRuntimeReceiptControlPlane,
    authorizeProductRuntimeReceiptFully,
    issueProductRuntimeVerificationReceipt,
    readProductRuntimeVerificationReceipt,
    verifyAuthorizedProductRuntimeReceiptControlPlane,
    verifyProductRuntimeReceiptControlPlane,
    verifyProductRuntimeReceiptFully,
    writeProductRuntimeVerificationReceipt,
} from "../server/interfaces/product-verification";
export {
    assertProductRuntimeContractFiles,
    inspectProductRuntimeImage,
    ProductRuntimeImageVerifier,
    productRuntimeFileDigest,
    readProductRuntimeContract,
    readProductRuntimeControlFile,
} from "../server/interfaces/product-runtime-image-verifier";
export type {
    ProductRuntimeExpectedIdentity,
    ProductRuntimeImageManifest,
    ProductRuntimeImageVerificationOptions,
    ProductRuntimeReceiptAuthorization,
    ProductRuntimeVerificationReceipt,
} from "@notnotype/neuro-book-contracts/product-runtime";

/** 验证 Installation Manifest 指向的完整 Product Runtime Image。 */
export async function verifyInstalledProductRuntimeImage(
    installationRoot: string,
    product: Exclude<ProductComponent, {provider: "container"}>,
): Promise<ProductRuntimeImageIdentity & {version: string; revision: string; dirty: boolean; platform: ProductPlatform}> {
    const image = await new ProductRuntimeImageVerifier().openVerified(resolve(installationRoot, product.path), {
        version: product.version,
        revision: product.revision,
        dirty: false,
        platform: product.platform,
        imageId: product.imageId,
        sourceDigest: product.sourceDigest,
        lockfileSha256: product.lockfileSha256,
        builderContractVersion: product.builderContractVersion,
    }, {allowPreviousRuntimeContract: true});
    return {
        version: image.manifest.version,
        revision: image.manifest.revision,
        dirty: image.manifest.dirty,
        platform: image.manifest.platform,
        imageId: image.manifest.imageId,
        sourceDigest: image.manifest.sourceDigest,
        lockfileSha256: image.manifest.lockfileSha256,
        builderContractVersion: image.manifest.builderContractVersion,
    };
}
