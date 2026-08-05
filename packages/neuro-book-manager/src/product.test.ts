import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {buildTestRuntimeImage, TEST_RUNTIME_IMAGE_PLATFORM} from "#manager/fixtures/runtime-image";
import {verifyInstalledProductRuntimeImage, verifyProductRuntimeControlPlane, verifyProductRuntimeImage} from "#manager/product";
import type {ProductComponent} from "#manager/types";
import {
    inspectProductRuntimeImage,
    productRuntimeManifestImageId,
    sha256ProductRuntimeText,
    PRODUCT_RUNTIME_IMAGE_READY_SCHEMA,
    type ProductRuntimeImageManifest,
} from "nbook/shared/product-runtime-image-verifier";
import {PRODUCT_RUNTIME_CONTRACT_PATH, PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA, type ProductRuntimeContract} from "nbook/shared/product-runtime-contract";

const roots: string[] = [];
const REVISION = "b".repeat(40);

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Manager Product Runtime Image control plane", () => {
    it("接受 manifest、ready marker 和关键 bundle command 一致的镜像", async () => {
        const fixture = await runtimeImageFixture();

        await expect(verifyProductRuntimeImage(fixture.root, fixture.identity)).resolves.toEqual(fixture.identity);
        await expect(verifyProductRuntimeControlPlane(fixture.root, fixture.identity)).resolves.toEqual(fixture.identity);
    });

    it("拒绝缺少 ready marker、错误代次和 payload 篡改", async () => {
        const missingReady = await runtimeImageFixture();
        await rm(join(missingReady.root, "runtime-image.ready"));
        await expect(verifyProductRuntimeImage(missingReady.root, missingReady.identity)).rejects.toMatchObject({code: "ENOENT"});

        const mismatch = await runtimeImageFixture();
        await expect(verifyProductRuntimeImage(mismatch.root, {...mismatch.identity, revision: "c".repeat(40)}))
            .rejects.toThrow("revision");

        const tampered = await runtimeImageFixture();
        await writeFile(join(tampered.root, "server", "index.mjs"), "export const tampered = true;\n", "utf8");
        await expect(verifyProductRuntimeControlPlane(tampered.root, tampered.identity)).resolves.toEqual(tampered.identity);
        await expect(verifyProductRuntimeImage(tampered.root, tampered.identity))
            .rejects.toThrow("payload digest 不一致");
    });

    it("新候选严格拒绝 v4，已安装 Product 读取可显式兼容 v4", async () => {
        const fixture = await legacyRuntimeImageFixture();

        await expect(verifyProductRuntimeImage(fixture.root, fixture.identity))
            .rejects.toThrow("schema 不受支持");
        await expect(verifyInstalledProductRuntimeImage(fixture.installationRoot, fixture.product))
            .resolves.toEqual(fixture.identity);
    });
});

/** 创建 Manager 控制面所需的最小 verified-image fixture。 */
async function runtimeImageFixture() {
    const sourceRoot = await mkdtemp(join(tmpdir(), "nbook-manager-runtime-image-"));
    roots.push(sourceRoot);
    const platform = TEST_RUNTIME_IMAGE_PLATFORM;
    const image = await buildTestRuntimeImage({sourceRoot, version: "0.8.0", revision: REVISION, platform});
    const identity = {
        version: image.manifest.version,
        revision: image.manifest.revision,
        dirty: image.manifest.dirty,
        platform: image.manifest.platform,
        imageId: image.manifest.imageId,
        sourceDigest: image.manifest.sourceDigest,
        lockfileSha256: image.manifest.lockfileSha256,
        builderContractVersion: image.manifest.builderContractVersion,
    };
    return {root: image.path, identity};
}

/** 将正式 v4 fixture 降级为真实可验证的历史 v3 Product。 */
async function legacyRuntimeImageFixture() {
    const fixture = await runtimeImageFixture();
    const installationRoot = join(fixture.root, "..", "..", "..", "legacy-installation");
    await rm(installationRoot, {recursive: true, force: true});
    await mkdir(join(installationRoot, ".output"), {recursive: true});
    await cp(fixture.root, join(installationRoot, ".output"), {recursive: true});
    const imageRoot = join(installationRoot, ".output");
    const contractPath = join(imageRoot, ...PRODUCT_RUNTIME_CONTRACT_PATH.split("/"));
    const contract = JSON.parse(await readFile(contractPath, "utf8")) as ProductRuntimeContract;
    const {startup: _removedStartup, ...withoutStartup} = contract;
    const previousContract = {
        ...withoutStartup,
        schema: PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA,
    };
    const contractText = `${JSON.stringify(previousContract, null, 2)}\n`;
    await writeFile(contractPath, contractText, "utf8");

    const manifestPath = join(imageRoot, "runtime-image.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ProductRuntimeImageManifest;
    const inspection = await inspectProductRuntimeImage(imageRoot, manifest.policy.owners);
    manifest.runtimeContract = {
        path: PRODUCT_RUNTIME_CONTRACT_PATH,
        sha256: sha256ProductRuntimeText(contractText),
    };
    manifest.inventory = {
        files: inspection.files,
        bytes: inspection.bytes,
        owners: inspection.owners,
    };
    manifest.treeDigest = inspection.treeDigest;
    manifest.shapeDigest = inspection.shapeDigest;
    manifest.imageId = productRuntimeManifestImageId(manifest);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestText, "utf8");
    await writeFile(join(imageRoot, "runtime-image.ready"), `${JSON.stringify({
        schema: PRODUCT_RUNTIME_IMAGE_READY_SCHEMA,
        imageId: manifest.imageId,
        manifestSha256: sha256ProductRuntimeText(manifestText),
    })}\n`, "utf8");

    const identity = {
        ...fixture.identity,
        imageId: manifest.imageId,
    };
    const product: ProductComponent = {
        provider: "release",
        buildId: `sha256:${"a".repeat(64)}`,
        ...identity,
        path: ".output",
        archiveSha256: "b".repeat(64),
        sourceUrl: "https://example.test/neuro-book.zip",
        license: "test",
        redistribution: "test",
    };
    return {root: imageRoot, installationRoot, identity, product};
}
