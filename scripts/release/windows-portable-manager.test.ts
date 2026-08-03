import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {relative, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {strToU8, zipSync} from "fflate";

import {
    ProductRuntimeImageBuilder,
    productRuntimeBuildPolicy,
} from "nbook/scripts/build/product-runtime-image-builder";
import {writeInstallationManifest} from "nbook/packages/neuro-book-manager/src/manifest-store";
import {PRODUCT_ASSET_NAMES} from "nbook/packages/neuro-book-manager/src/platform";
import {PORTABLE_ROOT_LOCATORS} from "nbook/packages/neuro-book-manager/src/root-locators";
import {PRODUCT_PLATFORMS, type InstallationManifest, type ReleaseManifest} from "nbook/packages/neuro-book-manager/src/types";
import {
    createPortableOperation,
    materializePortableArchives,
    PORTABLE_GIT_SFX_OUTPUT_PATH_LIMIT,
    portableArchiveComponents,
} from "nbook/scripts/deploy/windows-portable-manager";
import {releaseBuildId as computeReleaseBuildId} from "nbook/scripts/release/release-output";
import {verifyWindowsPortable} from "nbook/scripts/release/verify-windows-portable";
import {writeZipArchive, type ZipEntry} from "nbook/scripts/utils/zip";
import {
    createProductRuntimeContract,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_CONTRACT_PATH,
} from "nbook/shared/product-runtime-contract";

const VERSION = "1.2.3-canary.1";
const REVISION = "a".repeat(40);
const PAYLOAD_PATH = "server/index.mjs";
const COMMAND_PATH = "server/commands/all.mjs";
const LOCKFILE = "lockfileVersion = 1\n";

const cleanupRoots: string[] = [];

afterEach(async () => {
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Portable archive provenance", () => {
    it.runIf(process.platform === "win32")("组装根为PortableGit SFX保留传统MAX_PATH空间", async () => {
        const operation = await createPortableOperation();
        cleanupRoots.push(operation.root);

        expect(resolve(operation.root, "..")).toBe(resolve(tmpdir()));
        expect(operation.stage).toBe(resolve(operation.root, "p"));
        expect(operation.managerPackageStage).toBe(resolve(operation.root, "m"));
        const managedGeneration = `managed-${"0".repeat(36)}`;
        const portableGitExtraction = resolve(
            operation.stage,
            ".deploy",
            "staging",
            managedGeneration,
            "extracted",
        );
        expect(portableGitExtraction.length).toBeLessThanOrEqual(PORTABLE_GIT_SFX_OUTPUT_PATH_LIMIT);
    });

    it("工作树与归档内容不同时只组装传入的 Source/Product archives", async () => {
        const root = await temporaryRoot();
        const liveRoot = resolve(root, "live-worktree");
        const archiveRoot = resolve(root, "archive-input");
        const stage = resolve(root, "portable-stage");
        await mkdir(resolve(liveRoot, ".output", "server"), {recursive: true});
        await writeFile(resolve(liveRoot, "package.json"), JSON.stringify({name: "neuro-book", version: "9.9.9"}), "utf8");
        await writeFile(resolve(liveRoot, "live-only.txt"), "live source", "utf8");
        await writeFile(resolve(liveRoot, ".output", "server", "index.mjs"), "live product", "utf8");

        const archives = await writeValidArchives(archiveRoot);
        await mkdir(stage, {recursive: true});
        const identity = await materializePortableArchives(stage, archives.source, archives.product);

        expect(identity.version).toBe(VERSION);
        expect(identity.revision).toBe(REVISION);
        expect(identity.buildId).toBe(releaseBuildId());
        expect(identity.sourceArchiveSha256).toBe(createHash("sha256").update(await readFile(archives.source)).digest("hex"));
        expect(identity.productArchiveSha256).toBe(createHash("sha256").update(await readFile(archives.product)).digest("hex"));
        expect(identity.runtimeImage.imageId).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(identity.sourceFiles).toEqual(["archive-only.txt", "bun.lock", "package.json", "source-build.json"]);
        expect(await readFile(resolve(stage, "archive-only.txt"), "utf8")).toBe("archive source");
        expect(await readFile(resolve(stage, ".output", "server", "index.mjs"), "utf8")).toBe("export const origin = 'archive product';\n");
        expect(await readdir(stage)).not.toContain("live-only.txt");
        const components = portableArchiveComponents(identity);
        expect(components.source.archiveSha256).toBe(identity.sourceArchiveSha256);
        expect(components.product).toMatchObject({
            archiveSha256: identity.productArchiveSha256,
            version: VERSION,
            revision: REVISION,
            platform: "windows-x64",
            imageId: identity.runtimeImage.imageId,
            sourceDigest: identity.runtimeImage.sourceDigest,
            lockfileSha256: identity.runtimeImage.lockfileSha256,
            builderContractVersion: identity.runtimeImage.builderContractVersion,
        });
        expect((await readdir(root)).some((entry) => entry.startsWith(".portable-archives-"))).toBe(false);
    });

    it("Source archive 的 path traversal 在写入前失败", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "stage");
        const source = resolve(root, "traversal.zip");
        await mkdir(stage, {recursive: true});
        await writeFile(source, zipSync({
            "package.json": strToU8(JSON.stringify({name: "neuro-book", version: VERSION})),
            "bun.lock": strToU8(LOCKFILE),
            "../escape.txt": strToU8("escape"),
        }));

        await expect(materializePortableArchives(stage, source, resolve(root, "unused-product.zip")))
            .rejects.toThrow("非法或不规范路径");
        await expect(readFile(resolve(root, "escape.txt"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
        expect(await readdir(stage)).toEqual([]);
    });

    it("Source archive 的 Unix symlink entry 在写入前失败", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "stage");
        const source = resolve(root, "symlink.zip");
        await mkdir(stage, {recursive: true});
        const archive = zipSync({
            "package.json": strToU8(JSON.stringify({name: "neuro-book", version: VERSION})),
            "bun.lock": strToU8(LOCKFILE),
            "link": strToU8("package.json"),
        });
        markCentralEntryAsSymlink(archive, "link");
        await writeFile(source, archive);

        await expect(materializePortableArchives(stage, source, resolve(root, "unused-product.zip")))
            .rejects.toThrow("不接受 symlink");
        expect(await readdir(stage)).toEqual([]);
    });

    it("Source/Product buildId 不一致时拒绝发布任何 stage 内容", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "stage");
        const archives = await writeValidArchives(resolve(root, "archives"), {productBuildRevision: "b".repeat(40)});
        await mkdir(stage, {recursive: true});

        await expect(materializePortableArchives(stage, archives.source, archives.product))
            .rejects.toThrow("build identity 代次不一致");
        expect(await readdir(stage)).toEqual([]);
        expect((await readdir(root)).some((entry) => entry.startsWith(".portable-archives-"))).toBe(false);
    });

    it("最终 verifier 把 Release、Portable、Installation 与 Runtime Image 连成同一代次", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "portable");
        const archives = await writeValidArchives(resolve(root, "archives"));
        await mkdir(stage, {recursive: true});
        const identity = await materializePortableArchives(stage, archives.source, archives.product);
        const components = portableArchiveComponents(identity);
        const asset = {
            archiveSha256: "d".repeat(64),
            sourceUrl: "https://example.com/runtime.zip",
            license: "test",
            redistribution: "test",
        };
        const runtime = {
            provider: "managed" as const,
            version: "1.3.0",
            path: ".runtime/bun/1.3.0/bun.exe",
            executableSha256: "e".repeat(64),
            ...asset,
        };
        const now = new Date().toISOString();
        const installation: InstallationManifest = {
            schemaVersion: 5,
            profile: "windows-portable",
            containerEngine: null,
            managerVersion: "0.1.0-canary.34",
            appVersion: VERSION,
            channel: "canary",
            sourceRevision: REVISION,
            roots: PORTABLE_ROOT_LOCATORS,
            components: {
                ...components,
                manager: {provider: "managed", version: "0.1.0-canary.34", path: ".runtime/manager/0.1.0-canary.34/neuro-book.mjs", bundleSha256: "f".repeat(64)},
                managerRuntime: runtime,
                applicationRuntime: runtime,
                tools: {
                    rg: {provider: "managed", version: "14.1.1", path: ".runtime/tools/rg/14.1.1/rg.exe", executableSha256: "1".repeat(64), ...asset},
                    git: {provider: "managed", version: "2.49.0", path: ".runtime/tools/git/2.49.0/cmd/git.exe", bashPath: ".runtime/tools/git/2.49.0/bin/bash.exe", distribution: "PortableGit", gitSha256: "2".repeat(64), bashSha256: "3".repeat(64), ...asset},
                },
            },
            installedAt: now,
            updatedAt: now,
        };
        await mkdir(resolve(stage, ".deploy"), {recursive: true});
        await writeInstallationManifest(resolve(stage, ".deploy", "installation.json"), installation);

        const portableArchive = resolve(root, "neuro-book-windows-x64.zip");
        await writeZipArchive(portableArchive, await directoryZipEntries(stage));
        const portableInfo = await stat(portableArchive);
        const sourceInfo = await stat(archives.source);
        const productInfo = await stat(archives.product);
        const releaseRoot = `https://github.com/notnotype/neuro-book/releases/download/v${VERSION}`;
        const release: ReleaseManifest = {
            schemaVersion: 5,
            buildId: identity.buildId,
            version: VERSION,
            channel: "canary",
            sourceRevision: REVISION,
            minManagerVersion: "0.1.0-canary.34",
            source: {url: components.source.sourceUrl, sha256: identity.sourceArchiveSha256, bytes: sourceInfo.size},
            products: PRODUCT_PLATFORMS.map((platform) => ({
                platform,
                sourceRevision: REVISION,
                url: `${releaseRoot}/${PRODUCT_ASSET_NAMES[platform]}`,
                sha256: platform === "windows-x64" ? identity.productArchiveSha256 : "4".repeat(64),
                bytes: platform === "windows-x64" ? productInfo.size : 1,
                imageId: identity.runtimeImage.imageId,
                sourceDigest: identity.runtimeImage.sourceDigest,
                lockfileSha256: identity.runtimeImage.lockfileSha256,
                builderContractVersion: identity.runtimeImage.builderContractVersion,
            })),
            windowsPortable: {
                url: `${releaseRoot}/neuro-book-windows-x64.zip`,
                sha256: createHash("sha256").update(await readFile(portableArchive)).digest("hex"),
                bytes: portableInfo.size,
            },
            ghcr: {ref: `ghcr.io/notnotype/neuro-book@sha256:${"5".repeat(64)}`, digest: `sha256:${"5".repeat(64)}`, sourceRevision: REVISION},
            stateMigration: {policy: "none", steps: []},
        };
        const releaseManifestPath = resolve(root, "release-manifest.json");
        await writeFile(releaseManifestPath, `${JSON.stringify(release, null, 4)}\n`, "utf8");

        await expect(verifyWindowsPortable({releaseManifestPath, portableArchivePath: portableArchive, portableRoot: stage}))
            .resolves.toMatchObject({buildId: identity.buildId, imageId: identity.runtimeImage.imageId});

        installation.components.source = {...installation.components.source, buildId: `sha256:${"6".repeat(64)}`};
        await writeInstallationManifest(resolve(stage, ".deploy", "installation.json"), installation);
        await expect(verifyWindowsPortable({releaseManifestPath, portableArchivePath: portableArchive, portableRoot: stage}))
            .rejects.toThrow("build ID 证明链不一致");
    });
});

/** 通过正式 Builder 生成可被完整复核的最小双归档。 */
async function writeValidArchives(
    root: string,
    options: {productBuildRevision?: string} = {},
): Promise<{source: string; product: string}> {
    const sourceRoot = resolve(root, "source");
    await mkdir(sourceRoot, {recursive: true});
    const packagePath = resolve(sourceRoot, "package.json");
    const lockfilePath = resolve(sourceRoot, "bun.lock");
    const markerPath = resolve(sourceRoot, "archive-only.txt");
    const sourceBuildPath = resolve(sourceRoot, "source-build.json");
    await Promise.all([
        mkdir(resolve(sourceRoot, "node_modules", "nuxt"), {recursive: true}),
        mkdir(resolve(sourceRoot, "node_modules", "nitropack"), {recursive: true}),
    ]);
    await writeFile(packagePath, `${JSON.stringify({name: "neuro-book", version: VERSION}, null, 4)}\n`, "utf8");
    await writeFile(lockfilePath, LOCKFILE, "utf8");
    await writeFile(markerPath, "archive source", "utf8");
    await Promise.all([
        writeFile(resolve(sourceRoot, "node_modules", "nuxt", "package.json"), `${JSON.stringify({
            name: "nuxt",
            version: "4.3.1",
        })}\n`, "utf8"),
        writeFile(resolve(sourceRoot, "node_modules", "nitropack", "package.json"), `${JSON.stringify({
            name: "nitropack",
            version: "2.13.4",
        })}\n`, "utf8"),
    ]);
    await writeFile(sourceBuildPath, `${JSON.stringify({
        schema: "nbook.release-build/v1",
        kind: "source",
        buildId: releaseBuildId(),
        version: VERSION,
        revision: REVISION,
        dirty: false,
        lockfileSha256: sha256Identity(LOCKFILE),
    }, null, 4)}\n`, "utf8");

    const payloadText = "export const origin = 'archive product';\n";
    const image = await new ProductRuntimeImageBuilder(sourceRoot).buildCandidate({
        operationId: "portable-archive-fixture",
        platform: "windows-x64",
        expectedSource: {version: VERSION, revision: REVISION, dirty: false},
        owners: productRuntimeBuildPolicy("windows-x64").owners,
        budget: productRuntimeBuildPolicy("windows-x64").budget,
        async build({imageRoot}) {
            const contract = createProductRuntimeContract({
                productStart: COMMAND_PATH,
                sqliteMigrate: COMMAND_PATH,
                applicationStateMigration: COMMAND_PATH,
                createAdmin: COMMAND_PATH,
                profile: COMMAND_PATH,
                variable: COMMAND_PATH,
                workspace: COMMAND_PATH,
                prepareSystemAssets: COMMAND_PATH,
                checkMigrations: COMMAND_PATH,
                profileAuthoringSmoke: COMMAND_PATH,
                variableAuthoringSmoke: COMMAND_PATH,
                imageVariantSmoke: COMMAND_PATH,
                sqliteVecSmoke: COMMAND_PATH,
                webFetchSmoke: COMMAND_PATH,
                worldEngineConfigSmoke: COMMAND_PATH,
            });
            await mkdir(resolve(imageRoot, "server", "commands"), {recursive: true});
            await Promise.all([
                writeFile(resolve(imageRoot, PAYLOAD_PATH), payloadText, "utf8"),
                writeFile(resolve(imageRoot, COMMAND_PATH), "export {};\n", "utf8"),
                writeFile(resolve(imageRoot, PRODUCT_RUNTIME_COMMAND_BOOTSTRAP), "export {};\n", "utf8"),
                writeFile(
                    resolve(imageRoot, PRODUCT_RUNTIME_CONTRACT_PATH),
                    `${JSON.stringify(contract, null, 2)}\n`,
                    "utf8",
                ),
            ]);
        },
    });
    const productBuildPath = resolve(root, "product", "product-build.json");
    await mkdir(resolve(root, "product"), {recursive: true});
    await writeFile(productBuildPath, `${JSON.stringify({
        schema: "nbook.release-build/v1",
        kind: "product",
        buildId: releaseBuildId(options.productBuildRevision),
        version: VERSION,
        revision: options.productBuildRevision ?? REVISION,
        dirty: false,
        lockfileSha256: sha256Identity(LOCKFILE),
        platform: "windows-x64",
        imageId: image.manifest.imageId,
        sourceDigest: image.manifest.sourceDigest,
        treeDigest: image.manifest.treeDigest,
        builderContractVersion: image.manifest.builderContractVersion,
    }, null, 4)}\n`, "utf8");

    const sourceArchive = resolve(root, "source.zip");
    const productArchive = resolve(root, "product.zip");
    await writeZipArchive(sourceArchive, [
        {kind: "file", source: packagePath, archivePath: "package.json"},
        {kind: "file", source: lockfilePath, archivePath: "bun.lock"},
        {kind: "file", source: markerPath, archivePath: "archive-only.txt"},
        {kind: "file", source: sourceBuildPath, archivePath: "source-build.json"},
    ]);
    await writeZipArchive(productArchive, [
        {kind: "file", source: productBuildPath, archivePath: "product-build.json"},
        ...await runtimeImageZipEntries(image.path),
    ]);
    return {source: sourceArchive, product: productArchive};
}

/** 把 Builder 产出的完整镜像逐文件收入 Product ZIP，不重建任何控制字段。 */
async function runtimeImageZipEntries(imageRoot: string): Promise<ZipEntry[]> {
    const entries: ZipEntry[] = [];

    async function walk(directory: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const absolutePath = resolve(directory, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
                await walk(absolutePath);
            } else if (entry.isFile() && !entry.isSymbolicLink()) {
                const archivePath = `.output/${relative(imageRoot, absolutePath).replaceAll("\\", "/")}`;
                entries.push({kind: "file", source: absolutePath, archivePath});
            } else {
                throw new Error(`测试 Runtime Image 包含不受支持的 entry：${absolutePath}`);
            }
        }
    }

    await walk(imageRoot);
    return entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

/** 把测试 Portable stage 按真实相对路径写成最终 ZIP。 */
async function directoryZipEntries(root: string): Promise<ZipEntry[]> {
    const entries: ZipEntry[] = [];
    async function walk(directory: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(path);
            else if (entry.isFile() && !entry.isSymbolicLink()) {
                entries.push({kind: "file", source: path, archivePath: relative(root, path).replaceAll("\\", "/")});
            } else throw new Error(`测试 Portable 包含不受支持的 entry：${path}`);
        }
    }
    await walk(root);
    return entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

/** 测试专用：把指定中央目录 entry 标记为 Unix symbolic link。 */
function markCentralEntryAsSymlink(archive: Uint8Array, target: string): void {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let offset = 0; offset + 46 <= archive.byteLength; offset += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        const nameLength = view.getUint16(offset + 28, true);
        const name = Buffer.from(archive.subarray(offset + 46, offset + 46 + nameLength)).toString("utf8");
        if (name !== target) continue;
        view.setUint8(offset + 5, 3);
        view.setUint32(offset + 38, (0o120777 << 16) >>> 0, true);
        return;
    }
    throw new Error(`测试 ZIP 缺少中央目录 entry：${target}`);
}

function sha256Identity(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function releaseBuildId(revision = REVISION): string {
    return computeReleaseBuildId({
        lockfileSha256: sha256Identity(LOCKFILE),
        revision,
        version: VERSION,
    });
}

async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "nbook-portable-provenance-"));
    cleanupRoots.push(root);
    return root;
}
