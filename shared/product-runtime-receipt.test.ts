import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {buildTestRuntimeImage} from "nbook/packages/neuro-book-manager/src/fixtures/runtime-image";

import {
    authorizeProductRuntimeReceiptControlPlane,
    createProductRuntimeVerificationReceipt,
    PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT,
    PRODUCT_RUNTIME_RECEIPT_SHA256_ENVIRONMENT,
    PRODUCT_RUNTIME_RECEIPT_SCHEMA,
    productRuntimeReceiptAuthorizationFromEnvironment,
    productRuntimeReceiptEnvironment,
    readProductRuntimeVerificationReceipt,
    verifyAuthorizedProductRuntimeReceiptControlPlane,
    writeProductRuntimeVerificationReceipt,
} from "nbook/shared/product-runtime-receipt";

import type {ProductRuntimeExpectedIdentity, ProductRuntimeImageManifest} from "nbook/shared/product-runtime-image-verifier";

const roots: string[] = [];

describe("Product Runtime verification receipt", () => {
    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("原子写入并严格读取，不携带绝对路径", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-receipt-"));
        roots.push(root);
        const path = join(root, ".deploy", "product-runtime-receipt.json");
        const receipt = {
            schema: PRODUCT_RUNTIME_RECEIPT_SCHEMA as typeof PRODUCT_RUNTIME_RECEIPT_SCHEMA,
            imageId: digest("a"),
            version: "0.9.0",
            revision: "a".repeat(40),
            dirty: false,
            platform: "windows-x64" as const,
            sourceDigest: digest("b"),
            lockfileSha256: digest("c"),
            builderContractVersion: "3",
            treeDigest: digest("d"),
            shapeDigest: digest("e"),
            runtimeContract: {path: "server/runtime-contract.json" as const, sha256: digest("f")},
            issuedAt: "2026-08-05T00:00:00.000Z",
        };
        await writeProductRuntimeVerificationReceipt(path, receipt);
        expect(await readProductRuntimeVerificationReceipt(path)).toEqual(receipt);
        expect(await readFile(path, "utf8")).not.toContain(root.replaceAll("\\", "/"));
        await expect(readProductRuntimeVerificationReceipt(path).then(() => undefined)).resolves.toBeUndefined();
    });

    it("启动授权必须同时携带回执路径和内容摘要", () => {
        const authorization = {
            path: "C:\\NeuroBook\\.deploy\\product-runtime-receipt.json",
            sha256: digest("1"),
        };
        expect(productRuntimeReceiptEnvironment(authorization)).toEqual({
            [PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT]: authorization.path,
            [PRODUCT_RUNTIME_RECEIPT_SHA256_ENVIRONMENT]: authorization.sha256,
        });
        expect(productRuntimeReceiptAuthorizationFromEnvironment({
            ...productRuntimeReceiptEnvironment(authorization),
        })).toEqual(authorization);
        expect(productRuntimeReceiptAuthorizationFromEnvironment({})).toBeNull();
        expect(() => productRuntimeReceiptAuthorizationFromEnvironment({
            [PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT]: authorization.path,
        })).toThrow("必须同时提供");
    });
    it("控制面启动授权返回绝对回执路径与内容摘要", async () => {
        const fixture = await runtimeFixture();

        const authorization = await authorizeProductRuntimeReceiptControlPlane(
            fixture.imageRoot,
            fixture.receiptPath,
            fixture.expectedIdentity,
        );
        expect(authorization).toEqual({
            path: resolve(fixture.receiptPath),
            sha256: sha256(await readFile(fixture.receiptPath, "utf8")),
        });
    });

    it("控制面授权拒绝缺失回执、错误回执摘要和控制文件变化", async () => {
        const missingReceipt = await runtimeFixture();
        await rm(missingReceipt.receiptPath);
        await expect(authorizeProductRuntimeReceiptControlPlane(
            missingReceipt.imageRoot,
            missingReceipt.receiptPath,
            missingReceipt.expectedIdentity,
        )).rejects.toMatchObject({code: "ENOENT"});

        const wrongReceiptDigest = await runtimeFixture();
        const authorization = await authorizeProductRuntimeReceiptControlPlane(
            wrongReceiptDigest.imageRoot,
            wrongReceiptDigest.receiptPath,
            wrongReceiptDigest.expectedIdentity,
        );
        await expect(verifyAuthorizedProductRuntimeReceiptControlPlane(
            wrongReceiptDigest.imageRoot,
            wrongReceiptDigest.applicationRoot,
            {...authorization, sha256: digest("0")},
            wrongReceiptDigest.expectedIdentity,
        )).rejects.toThrow("授权摘要与磁盘内容不一致");

        const changedManifest = await runtimeFixture();
        await writeFile(changedManifest.manifestPath, `${await readFile(changedManifest.manifestPath, "utf8")}\n`, "utf8");
        await expect(authorizeProductRuntimeReceiptControlPlane(
            changedManifest.imageRoot,
            changedManifest.receiptPath,
            changedManifest.expectedIdentity,
        )).rejects.toThrow("ready marker");

        const changedReady = await runtimeFixture();
        const ready = JSON.parse(await readFile(changedReady.readyPath, "utf8")) as {schema: string; imageId: string; manifestSha256: string};
        ready.imageId = digest("0");
        await writeFile(changedReady.readyPath, `${JSON.stringify(ready)}\n`, "utf8");
        await expect(authorizeProductRuntimeReceiptControlPlane(
            changedReady.imageRoot,
            changedReady.receiptPath,
            changedReady.expectedIdentity,
        )).rejects.toThrow("ready marker");

        const changedContract = await runtimeFixture();
        await writeFile(changedContract.runtimeContractPath, `${await readFile(changedContract.runtimeContractPath, "utf8")}\n`, "utf8");
        await expect(authorizeProductRuntimeReceiptControlPlane(
            changedContract.imageRoot,
            changedContract.receiptPath,
            changedContract.expectedIdentity,
        )).rejects.toThrow("runtime contract 摘要");
    });
});

async function runtimeFixture(): Promise<{
    applicationRoot: string;
    imageRoot: string;
    receiptPath: string;
    manifestPath: string;
    readyPath: string;
    runtimeContractPath: string;
    expectedIdentity: ProductRuntimeExpectedIdentity;
}> {
    const applicationRoot = await mkdtemp(join(tmpdir(), "nbook-receipt-image-"));
    roots.push(applicationRoot);
    const image = await buildTestRuntimeImage({
        sourceRoot: applicationRoot,
        version: "0.9.0",
        revision: "a".repeat(40),
        platform: "windows-x64",
    });
    const receiptPath = join(applicationRoot, ".deploy", "product-runtime-receipt.json");
    await writeProductRuntimeVerificationReceipt(receiptPath, createProductRuntimeVerificationReceipt(image.manifest, "2026-08-13T00:00:00.000Z"));
    return {
        applicationRoot,
        imageRoot: image.path,
        receiptPath,
        manifestPath: join(image.path, "runtime-image.json"),
        readyPath: join(image.path, "runtime-image.ready"),
        runtimeContractPath: join(image.path, "server", "runtime-contract.json"),
        expectedIdentity: expectedIdentity(image.manifest),
    };
}

function expectedIdentity(manifest: ProductRuntimeImageManifest): ProductRuntimeExpectedIdentity {
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

function sha256(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function digest(character: string): string {
    return `sha256:${character.repeat(64)}`;
}
