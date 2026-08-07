import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    PRODUCT_RUNTIME_RECEIPT_PATH_ENVIRONMENT,
    PRODUCT_RUNTIME_RECEIPT_SHA256_ENVIRONMENT,
    PRODUCT_RUNTIME_RECEIPT_SCHEMA,
    productRuntimeReceiptAuthorizationFromEnvironment,
    productRuntimeReceiptEnvironment,
    readProductRuntimeVerificationReceipt,
    writeProductRuntimeVerificationReceipt,
} from "nbook/shared/product-runtime-receipt";

describe("Product Runtime verification receipt", () => {
    const roots: string[] = [];

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
});

function digest(character: string): string {
    return `sha256:${character.repeat(64)}`;
}
