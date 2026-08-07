import {mkdir, mkdtemp, rename, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {verifyApplicationExecution} from "#manager/application-execution";
import {buildTestRuntimeImage, TEST_RUNTIME_IMAGE_PLATFORM} from "#manager/fixtures/runtime-image";
import {issueInstalledProductRuntimeReceipt} from "#manager/product";
import {INSTALLATION_SCOPED_ROOT_LOCATORS} from "#manager/root-locators";
import type {InstallationManifest} from "#manager/types";
import {authorizeProductRuntimeReceiptControlPlane} from "nbook/shared/product-runtime-receipt";

const roots: string[] = [];
const VERSION = "0.8.0-canary.1";
const REVISION = "a".repeat(40);

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Verified Application Execution", () => {
    it("Native Product 复算完整镜像并返回不可执行前的 verified handle", async () => {
        const fixture = await nativeFixture();

        await expect(verifyApplicationExecution(fixture.root, fixture.manifest)).resolves.toMatchObject({
            kind: "native-product",
            imageRoot: join(fixture.root, ".output"),
            identity: {imageId: fixture.imageId},
        });
    });

    it("非入口 payload 篡改时在返回执行句柄前失败", async () => {
        const fixture = await nativeFixture();
        await writeFile(join(fixture.root, ".output", "server", "commands", "all.mjs"), "export const tampered = true;\n", "utf8");

        await expect(verifyApplicationExecution(fixture.root, fixture.manifest))
            .rejects.toThrow("payload digest 不一致");
    });

    it("Desktop 回执授权只做控制面快验，payload 篡改由 ready 后完整复核拦截", async () => {
        const fixture = await nativeFixture();
        const product = fixture.manifest.components.product;
        if (!product || product.provider === "container") throw new Error("测试 fixture 缺少 native Product");
        const receiptPath = join(fixture.root, ".deploy", "product-runtime-receipt.json");
        await issueInstalledProductRuntimeReceipt(fixture.root, product, receiptPath);
        const authorization = await authorizeProductRuntimeReceiptControlPlane(
            join(fixture.root, ".output"),
            receiptPath,
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
        );
        await writeFile(join(fixture.root, ".output", "server", "commands", "all.mjs"), "export const tampered = true;\n", "utf8");

        await expect(verifyApplicationExecution(fixture.root, fixture.manifest, {
            productRuntimeReceipt: authorization,
        })).resolves.toMatchObject({
            kind: "native-product",
            identity: {imageId: fixture.imageId},
        });
        await expect(verifyApplicationExecution(fixture.root, fixture.manifest))
            .rejects.toThrow("payload digest 不一致");
        await expect(verifyApplicationExecution(fixture.root, fixture.manifest, {
            productRuntimeReceipt: {...authorization, sha256: `sha256:${"0".repeat(64)}`},
        })).rejects.toThrow("授权摘要");
    });

    it("Source Dev 明确跳过 Runtime Image 验证", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-source-execution-"));
        roots.push(root);
        const manifest = installationManifest(undefined);
        manifest.profile = "source-dev";
        manifest.components.product = undefined;

        await expect(verifyApplicationExecution(root, manifest)).resolves.toEqual({
            kind: "source-dev",
            applicationRoot: root,
        });
    });
});

/** 使用正式 Builder 生成可由 Installation Manifest 外部身份验证的 Native Product。 */
async function nativeFixture(): Promise<{root: string; manifest: InstallationManifest; imageId: string}> {
    const root = await mkdtemp(join(tmpdir(), "manager-verified-execution-"));
    roots.push(root);
    const sourceRoot = join(root, "source-fixture");
    await mkdir(sourceRoot, {recursive: true});
    const image = await buildTestRuntimeImage({
        sourceRoot,
        version: VERSION,
        revision: REVISION,
        platform: TEST_RUNTIME_IMAGE_PLATFORM,
    });
    await rename(image.path, join(root, ".output"));
    const manifest = installationManifest({
        provider: "release", buildId: `sha256:${"9".repeat(64)}`,
        version: VERSION,
        revision: REVISION,
        path: ".output",
        platform: TEST_RUNTIME_IMAGE_PLATFORM,
        imageId: image.manifest.imageId,
        sourceDigest: image.manifest.sourceDigest,
        lockfileSha256: image.manifest.lockfileSha256,
        builderContractVersion: image.manifest.builderContractVersion,
        archiveSha256: "b".repeat(64),
        sourceUrl: "https://example.com/product.zip",
        license: "AGPL-3.0-only",
        redistribution: "test fixture",
    });
    return {root, manifest, imageId: image.manifest.imageId};
}

/** 建立执行验证测试所需的最小 Installation Manifest。 */
function installationManifest(product: InstallationManifest["components"]["product"]): InstallationManifest {
    return {
        schemaVersion: 5,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: VERSION,
        channel: "canary",
        sourceRevision: REVISION,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {
                provider: "git",
                version: VERSION,
                revision: REVISION,
                path: ".",
                repository: "https://example.com/neuro-book.git",
                branch: "master",
            },
            product,
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/manager.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
    };
}
