#!/usr/bin/env bun
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, createWriteStream, mkdirSync} from "node:fs";
import {finished} from "node:stream/promises";
import {
    lstat,
    mkdtemp,
    mkdir,
    open,
    readFile,
    readdir,
    rename,
    rm,
    rmdir,
    writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, dirname, relative, resolve} from "node:path";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {Command} from "commander";
import {Unzip, UnzipInflate} from "fflate";
import {runCapture} from "#scripts/utils/process.mjs";

import {
    ensureStateFiles,
    installManagedBun,
    installManagedTool,
    installManagerExecutable,
    MANAGER_VERSION,
    writeInstallationManifest,
    writeManagedToolWrappers,
    writeManagerWrapper,
    writePortableLaunchers,
    writeRuntimeWrapper,
} from "@notnotype/neuro-book-manager/portable";
import {
    PORTABLE_ROOT_LOCATORS,
    type InstallationManifest,
    type ProductComponent,
    type SourceComponent,
} from "@notnotype/neuro-book-contracts/installation";
import {PRODUCT_ASSET_NAMES, type ProductPlatform} from "@notnotype/neuro-book-contracts/platform";
import {
    ProductRuntimeImageBuilder,
    type ProductRuntimeImageManifest,
} from "#scripts/build/product-runtime-image-builder";
import {materializePublicManagerPackage} from "#scripts/release/public-manager-package";
import {
    parseReleaseBuild,
    type ReleaseBuild,
    type ReleaseProductBuild,
    type ReleaseSourceBuild,
} from "#scripts/release/release-assets";
import {sanitizeZipEntryName, writeZipArchive} from "#scripts/utils/zip";

const WINDOWS_PRODUCT_PLATFORM: ProductPlatform = "windows-x64";
const ROOT = resolve(import.meta.dirname, "..", "..");
const SOURCE_BUILD_FILE = "source-build.json";
const PRODUCT_BUILD_FILE = "product-build.json";
const MAX_ZIP_COMMENT_BYTES = 65_535;
const MAX_ZIP_ENTRIES = 20_000;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_MATERIALIZED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_U16_SENTINEL = 0xffff;
const ZIP64_U32_SENTINEL = 0xffffffff;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_DIRECTORY = 0x4000;
const UNIX_REGULAR_FILE = 0x8000;
const UNIX_SYMBOLIC_LINK = 0xa000;
export const PORTABLE_GIT_SFX_OUTPUT_PATH_LIMIT = 170;

interface ZipArchiveEntry {
    archivePath: string;
    directory: boolean;
    compression: number;
    compressedBytes: number;
    bytes: number;
    /** ZIP 未声明 Unix mode 时为空；Windows 上创建文件时不会使用它。 */
    mode?: number;
}

export interface PortableArchiveIdentity {
    buildId: string;
    version: string;
    revision: string;
    sourceFiles: string[];
    sourceArchiveSha256: string;
    productArchiveSha256: string;
    runtimeImage: ProductRuntimeImageManifest;
}

/** CLI 只负责解析参数；测试导入本文件时不会触发真实 Portable 组装。 */
async function main(): Promise<void> {
    const program = new Command()
        .name("package-windows-portable")
        .requiredOption("--source-archive <path>", "同版本 Source archive。")
        .requiredOption("--product-archive <path>", "同版本 Windows Product archive。")
        .option("--output <path>", "输出 zip。", "dist/neuro-book-windows-x64.zip");
    program.parse();
    const options = program.opts<{output: string; sourceArchive: string; productArchive: string}>();
    await packagePortable(resolve(ROOT, options.output), resolve(ROOT, options.sourceArchive), resolve(ROOT, options.productArchive));
}

/** 仅从指定 Release archives 组装 Windows Portable，不读取 live Source 或 live `.output`。 */
export async function packagePortable(output: string, sourceArchive: string, productArchive: string): Promise<void> {
    if (process.platform !== "win32" || process.arch !== "x64") {
        throw new Error("Windows Portable 必须在 Windows x64 runner 构建。");
    }
    const operation = await createPortableOperation();
    const {root: operationRoot, stage, managerPackageStage} = operation;
    await mkdir(stage, {recursive: true});

    try {
        const archiveIdentity = await materializePortableArchives(stage, sourceArchive, productArchive);
        const publicManager = await materializePublicManagerPackage(MANAGER_VERSION, managerPackageStage);
        const releaseComponents = portableArchiveComponents(archiveIdentity);
        const runtime = await installManagedBun(stage);
        const rg = await installManagedTool(stage, "rg");
        const git = await installManagedTool(stage, "git");
        const manager = await installManagerExecutable(stage, MANAGER_VERSION, publicManager.executable);
        await writeRuntimeWrapper(stage, runtime);
        await writeManagedToolWrappers(stage, {rg, git});
        await writeManagerWrapper(stage, manager, runtime);
        await ensureStateFiles(resolve(stage, "data"), 3000, false);
        await writeFile(resolve(stage, "data", "README.txt"), "NeuroBook user state. Keep this directory when updating.\r\n", "utf8");
        await writePortableLaunchers(stage);
        await verifyPortableExecutables(stage, runtime.path, rg.path, git.path, git.bashPath);
        const now = new Date().toISOString();
        const manifest: InstallationManifest = {
            schemaVersion: 5,
            profile: "windows-portable",
            containerEngine: null,
            managerVersion: MANAGER_VERSION,
            appVersion: archiveIdentity.version,
            channel: archiveIdentity.version.includes("-") ? "canary" : "stable",
            sourceRevision: archiveIdentity.revision,
            roots: PORTABLE_ROOT_LOCATORS,
            components: {
                ...releaseComponents,
                manager,
                managerRuntime: runtime,
                applicationRuntime: runtime,
                tools: {rg, git},
            },
            installedAt: now,
            updatedAt: now,
        };
        await mkdir(resolve(stage, ".deploy"), {recursive: true});
        await writeInstallationManifest(resolve(stage, ".deploy", "installation.json"), manifest);
        await mkdir(dirname(output), {recursive: true});
        await zipDirectory(stage, output);
        const hash = await sha256(output);
        await writeFile(resolve(dirname(output), "SHA256SUMS.windows"), `${hash}  ${basename(output)}\n`, "utf8");
        console.log(`Windows Portable: ${relative(ROOT, output)} imageId=${archiveIdentity.runtimeImage.imageId}`);
    } finally {
        await rm(operationRoot, {recursive: true, force: true});
    }
}

/**
 * 创建短路径Portable组装根。
 *
 * PortableGit自解压程序仍受传统MAX_PATH约束，且必须完成包内post-install；
 * 因此整个一次性Installation Root放在OS临时目录，并在下载前拒绝过长环境。
 */
export async function createPortableOperation(): Promise<{
    root: string;
    stage: string;
    managerPackageStage: string;
}> {
    const root = await mkdtemp(resolve(tmpdir(), "nbp-"));
    const stage = resolve(root, "p");
    const managerPackageStage = resolve(root, "m");
    const managedGeneration = `managed-${"0".repeat(36)}`;
    const portableGitExtraction = resolve(stage, ".deploy", "staging", managedGeneration, "extracted");
    if (portableGitExtraction.length > PORTABLE_GIT_SFX_OUTPUT_PATH_LIMIT) {
        await rm(root, {recursive: true, force: true});
        throw new Error(
            `Windows临时目录过长，PortableGit无法安全完成解压：${portableGitExtraction.length}`
            + ` > ${PORTABLE_GIT_SFX_OUTPUT_PATH_LIMIT}。请为TEMP/TMP配置更短的可写目录后重试。`,
        );
    }
    return {root, stage, managerPackageStage};
}

/** 把已验证 archive identity 原样投影到 Installation Manifest v5 组件。 */
export function portableArchiveComponents(identity: PortableArchiveIdentity): {
    source: Extract<SourceComponent, {provider: "release"}>;
    product: Extract<ProductComponent, {provider: "release"}>;
} {
    const releaseRoot = `https://github.com/notnotype/neuro-book/releases/download/v${identity.version}`;
    return {
        source: {
            provider: "release",
            buildId: identity.buildId,
            version: identity.version,
            revision: identity.revision,
            path: ".",
            files: identity.sourceFiles,
            archiveSha256: identity.sourceArchiveSha256,
            sourceUrl: `${releaseRoot}/neuro-book-source.zip`,
            license: "AGPL-3.0-only",
            redistribution: "Windows Portable 内置同 revision NeuroBook Source snapshot。",
        },
        product: {
            provider: "release",
            buildId: identity.buildId,
            version: identity.version,
            revision: identity.revision,
            path: ".output",
            platform: WINDOWS_PRODUCT_PLATFORM,
            archiveSha256: identity.productArchiveSha256,
            sourceUrl: `${releaseRoot}/${PRODUCT_ASSET_NAMES[WINDOWS_PRODUCT_PLATFORM]}`,
            license: "AGPL-3.0-only",
            redistribution: "Windows Portable 内置 Windows x64 Product overlay。",
            imageId: identity.runtimeImage.imageId,
            sourceDigest: identity.runtimeImage.sourceDigest,
            lockfileSha256: identity.runtimeImage.lockfileSha256,
            builderContractVersion: identity.runtimeImage.builderContractVersion,
        },
    };
}

/**
 * 把 Source/Product archives 解包到一个空 Portable stage，并验证两者属于同一 Product 代次。
 * 两个 archive 先在 sibling candidate 中完整验证，成功后才用 rename 发布到调用方 stage。
 */
export async function materializePortableArchives(
    stage: string,
    sourceArchive: string,
    productArchive: string,
): Promise<PortableArchiveIdentity> {
    const stageInfo = await lstat(stage);
    if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink() || (await readdir(stage)).length > 0) {
        throw new Error("Windows Portable archive stage 必须是空的真实目录。");
    }
    const candidateRoot = resolve(dirname(stage), `.portable-archives-${randomUUID()}`);
    const sourceRoot = resolve(candidateRoot, "source");
    const productRoot = resolve(candidateRoot, "product");
    await mkdir(sourceRoot, {recursive: true});
    await mkdir(productRoot, {recursive: true});
    try {
        const sourceEntries = await inspectZipArchive(sourceArchive);
        assertSourceArchiveShape(sourceEntries);
        const productEntries = await inspectZipArchive(productArchive);
        assertProductArchiveShape(productEntries);
        const sourceArchiveSha256 = await extractZipArchive(sourceArchive, sourceRoot, sourceEntries);
        const productArchiveSha256 = await extractZipArchive(productArchive, productRoot, productEntries);

        const releaseBuilds = assertPortableReleaseBuild(
            parseReleaseBuild(await readArchiveControlFile(resolve(sourceRoot, SOURCE_BUILD_FILE))),
            parseReleaseBuild(await readArchiveControlFile(resolve(productRoot, PRODUCT_BUILD_FILE))),
        );
        const {source: sourceBuild, product: productBuild} = releaseBuilds;
        const rootPackage = parseSourcePackage(
            await readArchiveControlFile(resolve(sourceRoot, "package.json")),
            "neuro-book-workspace",
            "root",
        );
        const applicationPackage = parseSourcePackage(
            await readArchiveControlFile(resolve(sourceRoot, "packages", "neuro-book", "package.json")),
            "@notnotype/neuro-book",
            "application",
        );
        const sourceLockfileSha256 = `sha256:${await sha256(resolve(sourceRoot, "bun.lock"))}`;
        if (applicationPackage.version !== sourceBuild.version || rootPackage.version !== undefined || sourceLockfileSha256 !== sourceBuild.lockfileSha256) {
            throw new Error("Source archive payload 与 release-build.json 身份不一致。");
        }

        const runtimeImageRoot = resolve(productRoot, ".output");
        const expectedRuntime = parseRuntimeImageIdentity(
            await readArchiveControlFile(resolve(runtimeImageRoot, "runtime-image.json")),
        );
        assertProductRuntimeBuild(productBuild, expectedRuntime);
        const runtimeImage = await new ProductRuntimeImageBuilder(sourceRoot).openVerified(runtimeImageRoot, expectedRuntime);
        if (runtimeImage.manifest.treeDigest !== productBuild.treeDigest) {
            throw new Error("Product release-build.json 与 Runtime Image tree digest 不一致。");
        }

        // Product 根 product-build.json 只用于组装时证明代次；安装树保留 Source 的 source-build.json。
        await rename(runtimeImageRoot, resolve(sourceRoot, ".output"));
        await rmdir(stage);
        try {
            await rename(sourceRoot, stage);
        } catch (error) {
            await mkdir(stage, {recursive: true});
            throw error;
        }
        return {
            buildId: sourceBuild.buildId,
            version: sourceBuild.version,
            revision: sourceBuild.revision,
            sourceFiles: sourceEntries.filter((entry) => !entry.directory).map((entry) => entry.archivePath).sort(),
            sourceArchiveSha256,
            productArchiveSha256,
            runtimeImage: runtimeImage.manifest,
        };
    } finally {
        await rm(candidateRoot, {recursive: true, force: true});
    }
}

/** 读取并严格验证 ZIP 中央目录；ZIP64、多卷、加密、重复路径和特殊文件全部 fail closed。 */
async function inspectZipArchive(archivePath: string): Promise<ZipArchiveEntry[]> {
    const archiveInfo = await lstat(archivePath);
    if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink()) {
        throw new Error(`Release archive 必须是普通文件：${archivePath}`);
    }
    const tailLength = Math.min(archiveInfo.size, END_OF_CENTRAL_DIRECTORY_BYTES + MAX_ZIP_COMMENT_BYTES);
    if (tailLength < END_OF_CENTRAL_DIRECTORY_BYTES) throw new Error(`ZIP archive 过短：${archivePath}`);
    const handle = await open(archivePath, "r");
    try {
        const tail = Buffer.allocUnsafe(tailLength);
        await handle.read(tail, 0, tailLength, archiveInfo.size - tailLength);
        let endOffset = -1;
        for (let offset = tail.length - END_OF_CENTRAL_DIRECTORY_BYTES; offset >= 0; offset -= 1) {
            if (tail.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
            const commentLength = tail.readUInt16LE(offset + 20);
            if (offset + END_OF_CENTRAL_DIRECTORY_BYTES + commentLength === tail.length) {
                endOffset = offset;
                break;
            }
        }
        if (endOffset < 0) throw new Error(`ZIP archive 缺少有效中央目录：${archivePath}`);
        const disk = tail.readUInt16LE(endOffset + 4);
        const centralDisk = tail.readUInt16LE(endOffset + 6);
        const diskEntries = tail.readUInt16LE(endOffset + 8);
        const totalEntries = tail.readUInt16LE(endOffset + 10);
        const centralBytes = tail.readUInt32LE(endOffset + 12);
        const centralOffset = tail.readUInt32LE(endOffset + 16);
        if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
            throw new Error("Windows Portable 不支持多卷 ZIP archive。");
        }
        if (totalEntries === ZIP64_U16_SENTINEL || centralBytes === ZIP64_U32_SENTINEL || centralOffset === ZIP64_U32_SENTINEL) {
            throw new Error("Windows Portable 不接受 ZIP64 archive。");
        }
        if (totalEntries > MAX_ZIP_ENTRIES) {
            throw new Error(`ZIP archive entry 数超过预算：${totalEntries} > ${MAX_ZIP_ENTRIES}`);
        }
        if (centralBytes > MAX_CENTRAL_DIRECTORY_BYTES) {
            throw new Error(`ZIP archive 中央目录超过预算：${centralBytes} > ${MAX_CENTRAL_DIRECTORY_BYTES}`);
        }
        const endAbsoluteOffset = archiveInfo.size - tailLength + endOffset;
        if (centralOffset + centralBytes !== endAbsoluteOffset) {
            throw new Error("ZIP archive 中央目录 offset/size 不一致。");
        }
        const central = Buffer.allocUnsafe(centralBytes);
        const centralRead = await handle.read(central, 0, centralBytes, centralOffset);
        if (centralRead.bytesRead !== centralBytes) throw new Error("ZIP archive 中央目录读取不完整。");
        const entries: ZipArchiveEntry[] = [];
        const seen = new Set<string>();
        const windowsPaths = new Set<string>();
        let materializedBytes = 0;
        let offset = 0;
        while (offset < central.length) {
            if (offset + 46 > central.length || central.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
                throw new Error("ZIP archive 中央目录 entry 损坏。");
            }
            const versionMadeBy = central.readUInt16LE(offset + 4);
            const flags = central.readUInt16LE(offset + 8);
            const compression = central.readUInt16LE(offset + 10);
            const compressedBytes = central.readUInt32LE(offset + 20);
            const bytes = central.readUInt32LE(offset + 24);
            const nameBytes = central.readUInt16LE(offset + 28);
            const extraBytes = central.readUInt16LE(offset + 30);
            const commentBytes = central.readUInt16LE(offset + 32);
            const diskStart = central.readUInt16LE(offset + 34);
            const externalAttributes = central.readUInt32LE(offset + 38);
            const localOffset = central.readUInt32LE(offset + 42);
            const entryEnd = offset + 46 + nameBytes + extraBytes + commentBytes;
            if (entryEnd > central.length) throw new Error("ZIP archive 中央目录 entry 长度越界。");
            if ((flags & 0x1) !== 0) throw new Error("Windows Portable 不接受加密 ZIP entry。");
            if (compression !== 0 && compression !== 8) throw new Error(`Windows Portable 不支持 ZIP compression method ${compression}。`);
            if (compressedBytes === ZIP64_U32_SENTINEL || bytes === ZIP64_U32_SENTINEL
                || diskStart === ZIP64_U16_SENTINEL || localOffset === ZIP64_U32_SENTINEL) {
                throw new Error("Windows Portable 不接受 ZIP64 entry。");
            }
            if (localOffset >= centralOffset) throw new Error("ZIP archive local entry offset 越界。");
            const rawName = central.subarray(offset + 46, offset + 46 + nameBytes).toString("utf8");
            if (rawName.includes("\uFFFD")) throw new Error("ZIP archive entry name 不是有效 UTF-8。");
            const archivePath = sanitizeZipEntryName(rawName);
            if (archivePath === null || (rawName !== archivePath && rawName !== `${archivePath}/`)) {
                throw new Error(`ZIP archive 包含非法或不规范路径：${rawName}`);
            }
            if (seen.has(archivePath)) throw new Error(`ZIP archive 包含重复路径：${archivePath}`);
            seen.add(archivePath);
            assertWindowsArchivePath(archivePath);
            const windowsPath = archivePath.normalize("NFC").toLowerCase();
            if (windowsPaths.has(windowsPath)) throw new Error(`ZIP archive 包含 Windows 路径冲突：${archivePath}`);
            windowsPaths.add(windowsPath);
            const creatorSystem = versionMadeBy >>> 8;
            const unixMode = creatorSystem === 3 ? externalAttributes >>> 16 : 0;
            const unixType = unixMode & UNIX_FILE_TYPE_MASK;
            if (unixType === UNIX_SYMBOLIC_LINK) throw new Error(`ZIP archive 不接受 symlink：${archivePath}`);
            if (unixType !== 0 && unixType !== UNIX_DIRECTORY && unixType !== UNIX_REGULAR_FILE) {
                throw new Error(`ZIP archive 包含不受支持的特殊文件：${archivePath}`);
            }
            const directory = rawName.endsWith("/") || unixType === UNIX_DIRECTORY || (externalAttributes & 0x10) !== 0;
            if (directory !== rawName.endsWith("/")) throw new Error(`ZIP archive 目录 entry 形状不一致：${archivePath}`);
            if (directory && bytes !== 0) throw new Error(`ZIP archive 目录 entry 不能携带 payload：${archivePath}`);
            materializedBytes += bytes;
            if (!Number.isSafeInteger(materializedBytes) || materializedBytes > MAX_ARCHIVE_MATERIALIZED_BYTES) {
                throw new Error(`ZIP archive 解包总量超过预算：${materializedBytes} > ${MAX_ARCHIVE_MATERIALIZED_BYTES}`);
            }
            entries.push({
                archivePath,
                directory,
                compression,
                compressedBytes,
                bytes,
                ...unixMode ? {mode: unixMode & 0o777} : {},
            });
            offset = entryEnd;
        }
        if (entries.length !== totalEntries) throw new Error("ZIP archive entry 数与中央目录声明不一致。");
        assertNoFileDirectoryConflicts(entries);
        return entries;
    } finally {
        await handle.close();
    }
}

/** 使用 fflate 的结构化 streaming API 解包；本地 header 必须与预检中央目录逐项一致。 */
async function extractZipArchive(archivePath: string, targetRoot: string, inspectedEntries: ZipArchiveEntry[]): Promise<string> {
    const expected = new Map(inspectedEntries.map((entry) => [entry.archivePath, entry]));
    const completed = new Set<string>();
    const openStreams = new Set<ReturnType<typeof createWriteStream>>();
    const streamsDone: Promise<void>[] = [];
    const drainRef: {stream: ReturnType<typeof createWriteStream> | null} = {stream: null};
    const archiveHash = createHash("sha256");
    let failure: Error | null = null;
    const unzip = new Unzip((file) => {
        const archivePath = sanitizeZipEntryName(file.name);
        const entry = archivePath === null ? undefined : expected.get(archivePath);
        if (!entry || (file.name !== archivePath && file.name !== `${archivePath}/`)
            || entry.directory !== file.name.endsWith("/") || entry.compression !== file.compression || completed.has(archivePath!)) {
            failure = failure ?? new Error(`ZIP local entry 与中央目录不一致：${file.name}`);
            return;
        }
        if (file.originalSize !== undefined && file.originalSize !== entry.bytes) {
            failure = failure ?? new Error(`ZIP local entry 大小与中央目录不一致：${file.name}`);
            return;
        }
        if (file.size !== undefined && file.size !== entry.compressedBytes) {
            failure = failure ?? new Error(`ZIP local entry 压缩大小与中央目录不一致：${file.name}`);
            return;
        }
        completed.add(entry.archivePath);
        const targetPath = resolve(targetRoot, ...entry.archivePath.split("/"));
        if (entry.directory) {
            mkdirSync(targetPath, {recursive: true});
            file.ondata = (error) => {
                if (error) failure = failure ?? error;
            };
            file.start();
            return;
        }
        mkdirSync(dirname(targetPath), {recursive: true});
        let writtenBytes = 0;
        const output = createWriteStream(targetPath, {flags: "wx", ...entry.mode === undefined ? {} : {mode: entry.mode}});
        openStreams.add(output);
        streamsDone.push(finished(output).then(() => undefined).catch((error: Error) => {
            failure = failure ?? error;
        }));
        file.ondata = (error, data, final) => {
            if (error) {
                failure = failure ?? error;
                output.destroy(error);
                openStreams.delete(output);
                return;
            }
            writtenBytes += data.byteLength;
            if (writtenBytes > entry.bytes) {
                const sizeError = new Error(`ZIP entry 解包大小超过中央目录声明：${entry.archivePath}`);
                failure = failure ?? sizeError;
                output.destroy(sizeError);
                openStreams.delete(output);
                return;
            }
            if (!output.write(Buffer.from(data))) drainRef.stream = output;
            if (final) {
                if (writtenBytes !== entry.bytes) {
                    const sizeError = new Error(`ZIP entry 解包大小与中央目录不一致：${entry.archivePath}`);
                    failure = failure ?? sizeError;
                    output.destroy(sizeError);
                } else {
                    output.end();
                }
                openStreams.delete(output);
            }
        };
        file.start();
    });
    unzip.register(UnzipInflate);
    try {
        for await (const chunk of createReadStream(archivePath)) {
            archiveHash.update(chunk);
            unzip.push(chunk as Buffer);
            const drainTarget = drainRef.stream;
            if (drainTarget && !drainTarget.destroyed && drainTarget.writableNeedDrain) await once(drainTarget, "drain");
            drainRef.stream = null;
            if (failure) throw failure;
        }
        unzip.push(new Uint8Array(0), true);
        await Promise.all(streamsDone);
        if (failure) throw failure;
        if (completed.size !== expected.size) throw new Error("ZIP archive 缺少中央目录声明的 local entry。");
        return archiveHash.digest("hex");
    } catch (error) {
        for (const stream of openStreams) stream.destroy();
        await Promise.all(streamsDone);
        throw error;
    }
}

/** Source archive 只能是源码投影，不能夹带 Product、Git metadata 或 Developer Build State。 */
function assertSourceArchiveShape(entries: ZipArchiveEntry[]): void {
    const files = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.archivePath));
    for (const required of ["package.json", "packages/neuro-book/package.json", "bun.lock", SOURCE_BUILD_FILE]) {
        if (!files.has(required)) throw new Error(`Source archive 缺少 ${required}。`);
    }
    for (const entry of entries) {
        if (entry.archivePath === ".git" || entry.archivePath.startsWith(".git/")
            || entry.archivePath === ".output" || entry.archivePath.startsWith(".output/")
            || entry.archivePath === ".nuxt" || entry.archivePath.startsWith(".nuxt/")
            || entry.archivePath === "node_modules" || entry.archivePath.startsWith("node_modules/")
            || entry.archivePath === PRODUCT_BUILD_FILE) {
            throw new Error(`Source archive 包含禁止路径：${entry.archivePath}`);
        }
    }
}

/** Windows Product archive 只能包含 product build identity 与 `.output` overlay。 */
function assertProductArchiveShape(entries: ZipArchiveEntry[]): void {
    const files = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.archivePath));
    for (const entry of entries) {
        if (entry.archivePath !== PRODUCT_BUILD_FILE && entry.archivePath !== ".output" && !entry.archivePath.startsWith(".output/")) {
            throw new Error(`Windows Product archive 包含 .output 外路径：${entry.archivePath}`);
        }
    }
    for (const required of [
        PRODUCT_BUILD_FILE,
        ".output/server/index.mjs",
        ".output/runtime-image.json",
        ".output/runtime-image.ready",
    ]) {
        if (!files.has(required)) throw new Error(`Windows Product archive 缺少 ${required}。`);
    }
}

/** ZIP 名称在 Windows 最终会落成 NTFS 路径，提前拒绝会折叠或改语义的名称。 */
function assertWindowsArchivePath(archivePath: string): void {
    const reservedNames = new Set(["con", "prn", "aux", "nul", ...Array.from({length: 9}, (_, index) => `com${index + 1}`), ...Array.from({length: 9}, (_, index) => `lpt${index + 1}`)]);
    for (const segment of archivePath.split("/")) {
        if (segment.endsWith(".") || segment.endsWith(" ") || /[\u0000-\u001f<>"|?*:]/u.test(segment)) {
            throw new Error(`ZIP archive 包含 Windows 不可移植路径：${archivePath}`);
        }
        const baseName = segment.split(".")[0]!.toLowerCase();
        if (reservedNames.has(baseName)) throw new Error(`ZIP archive 包含 Windows 保留设备名：${archivePath}`);
    }
}

/** 拒绝 `file` 与 `file/child` 这类依赖解包顺序的路径冲突。 */
function assertNoFileDirectoryConflicts(entries: ZipArchiveEntry[]): void {
    const files = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.archivePath));
    const windowsFiles = new Set([...files].map((file) => file.normalize("NFC").toLowerCase()));
    for (const entry of entries) {
        const segments = entry.archivePath.split("/");
        for (let index = 1; index < segments.length; index += 1) {
            const parent = segments.slice(0, index).join("/");
            if (files.has(parent) || windowsFiles.has(parent.normalize("NFC").toLowerCase())) {
                throw new Error(`ZIP archive 文件与子路径冲突：${parent}`);
            }
        }
    }
}

/** 控制文件不接受 symlink、目录或异常大小，避免身份 JSON 从候选外部间接读取。 */
async function readArchiveControlFile(path: string): Promise<string> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CAPTURE_BYTES) {
        throw new Error(`Portable archive 控制文件无效：${path}`);
    }
    return await readFile(path, "utf8");
}

/** Source/Product 归档的跨平台 build identity 必须逐字段完全相同。 */
function assertPortableReleaseBuild(
    source: ReleaseBuild,
    product: ReleaseBuild,
): {source: ReleaseSourceBuild; product: ReleaseProductBuild} {
    if (source.kind !== "source") throw new Error("Source archive 的 source-build.json kind 必须是 source。");
    if (product.kind !== "product" || product.platform !== WINDOWS_PRODUCT_PLATFORM) {
        throw new Error("Windows Product archive 的 product-build.json platform/kind 不一致。");
    }
    if (source.buildId !== product.buildId || source.version !== product.version || source.revision !== product.revision
        || source.lockfileSha256 !== product.lockfileSha256 || source.dirty || product.dirty) {
        throw new Error("Source/Product build identity 代次不一致。");
    }
    return {source, product};
}

/** Runtime Image 是 Product archive 的 payload 真相，product-build 只能投影，不能反向伪造。 */
function assertProductRuntimeBuild(
    build: ReleaseProductBuild,
    runtime: ReturnType<typeof parseRuntimeImageIdentity>,
): void {
    if (runtime.dirty || runtime.platform !== WINDOWS_PRODUCT_PLATFORM
        || build.version !== runtime.version || build.revision !== runtime.revision
        || build.lockfileSha256 !== runtime.lockfileSha256 || build.imageId !== runtime.imageId
        || build.sourceDigest !== runtime.sourceDigest || build.builderContractVersion !== runtime.builderContractVersion) {
        throw new Error("Windows Product product-build.json 与 Runtime Image 身份不一致。");
    }
}

/** 外部 Source package JSON 在验证前是不可信输入，因此先收窄为最小身份。 */
function parseSourcePackage(text: string, expectedName: string, label: string): {version?: string} {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(`Source ${label} package.json 不是有效 JSON：${String(error)}`);
    }
    if (!isJsonObject(value) || value.name !== expectedName || (label === "application" && (typeof value.version !== "string" || !value.version))) {
        throw new Error(`Source archive ${label} package.json 身份无效。`);
    }
    return {version: typeof value.version === "string" ? value.version : undefined};
}

/** 只读取 openVerified 所需 expected identity；完整 schema 与 payload 由 Builder 再验证。 */
function parseRuntimeImageIdentity(text: string): {
    version: string;
    revision: string;
    dirty: boolean;
    platform: string;
    imageId: string;
    lockfileSha256: string;
    sourceDigest: string;
    builderContractVersion: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(`Product runtime-image.json 不是有效 JSON：${String(error)}`);
    }
    if (!isJsonObject(value)
        || typeof value.version !== "string"
        || typeof value.revision !== "string"
        || typeof value.dirty !== "boolean"
        || typeof value.platform !== "string"
        || typeof value.builderContractVersion !== "string"
        || !value.builderContractVersion
        || !isSha256Identity(value.imageId)
        || !isSha256Identity(value.lockfileSha256)
        || !isSha256Identity(value.sourceDigest)) {
        throw new Error("Product runtime-image.json 缺少有效代次身份。");
    }
    return {
        version: value.version,
        revision: value.revision,
        dirty: value.dirty,
        platform: value.platform,
        imageId: value.imageId,
        lockfileSha256: value.lockfileSha256,
        sourceDigest: value.sourceDigest,
        builderContractVersion: value.builderContractVersion,
    };
}

/** 外部 JSON object 使用 unknown index，是磁盘信任边界的显式类型。 */
function isJsonObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime Image 摘要统一携带 sha256: 前缀。 */
function isSha256Identity(value: unknown): value is string {
    return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

async function verifyPortableExecutables(root: string, bunPath: string, rgPath: string, gitPath: string, bashPath: string): Promise<void> {
    for (const [name, path] of [["bun", bunPath], ["rg", rgPath], ["git", gitPath], ["bash", bashPath]] as const) {
        const output = await runCapture(resolve(root, path), ["--version"], {cwd: root});
        if (!output.trim()) throw new Error(`Windows Portable ${name} --version 没有输出。`);
    }
}

async function zipDirectory(root: string, output: string): Promise<void> {
    const files = await directoryFiles(root);
    await writeZipArchive(output, [
        ...files.map((file) => ({kind: "file" as const, source: resolve(root, file), archivePath: file})),
        {kind: "directory", archivePath: "data/logs/"},
    ]);
}

async function directoryFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile()) result.push(relative(root, path));
        }
    };
    await visit(root);
    return result.sort();
}

async function sha256(path: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
}

if (import.meta.main) await main();
