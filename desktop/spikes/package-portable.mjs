#!/usr/bin/env bun
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    utimes,
    writeFile,
} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

import {createPackage} from "./electron/node_modules/@electron/asar/lib/asar.js";
import {writeZipArchive} from "../../scripts/utils/zip.ts";
import {ProductRuntimeImageVerifier} from "../../shared/product-runtime-image-verifier.ts";
import {readProductRuntimeContract} from "../../shared/product-runtime-contract.ts";
import {createProductRuntimeVerificationReceipt, writeProductRuntimeVerificationReceipt} from "../../shared/product-runtime-receipt.ts";
import {
    DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
    DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
    DESKTOP_AGGREGATE_DEPOT_ENTRIES,
    createDesktopAggregateDepotManifest,
    inspectDesktopAggregateDepot,
} from "./shared/src/desktop-aggregate-depot.ts";

const execFileAsync = promisify(execFile);
const PORTABLE_SCHEMA = "nbook.desktop-portable/v1";
const FIXED_TIME = new Date("1980-01-01T00:00:00.000Z");
const PRODUCT_MANIFEST = ".output/runtime-image.json";
const PRODUCT_READY = ".output/runtime-image.ready";

/** 解析只供本地打包使用的显式参数；不读取 cwd 猜测 Product。 */
function parseArgs(argv) {
    const values = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (!key?.startsWith("--")) throw new Error(`未知参数：${String(key)}`);
        const value = argv[index + 1];
        if (!value || value.startsWith("--") || values.has(key)) {
            throw new Error(`参数 ${key} 缺少值或重复。`);
        }
        values.set(key, value);
        index += 1;
    }
    const required = ["--image", "--output-dir", "--electron-runtime", "--tauri-exe", "--manager", "--tool-pack"];
    for (const key of required) {
        if (!values.has(key)) throw new Error(`缺少参数：${key}`);
    }
    const bunExecutable = resolve(values.get("--bun") || process.execPath);
    const normalizedBunPath = bunExecutable.replaceAll(/\\/gu, "/").toLowerCase();
    if (normalizedBunPath.includes("/shims/") || normalizedBunPath.includes("/node_modules/.bin/")) {
        throw new Error(`Portable 必须携带真实 Bun executable，拒绝 shim：${bunExecutable}`);
    }
    return {
        imageRoot: resolve(values.get("--image")),
        outputDir: resolve(values.get("--output-dir")),
        shellOutputDir: values.has("--shell-output-dir") ? resolve(values.get("--shell-output-dir")) : null,
        electronRuntime: resolve(values.get("--electron-runtime")),
        tauriExecutable: resolve(values.get("--tauri-exe")),
        managerExecutable: resolve(values.get("--manager")),
        toolPack: resolve(values.get("--tool-pack")),
        bunExecutable,
    };
}

/** 复制普通文件树；portable payload 不接受 symlink 或特殊文件。 */
async function copyTree(sourceRoot, targetRoot) {
    const sourceInfo = await lstat(sourceRoot);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
        throw new Error(`复制源必须是真实目录：${sourceRoot}`);
    }
    await mkdir(targetRoot, {recursive: true});
    const entries = await readdir(sourceRoot, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        const source = join(sourceRoot, entry.name);
        const target = join(targetRoot, entry.name);
        const info = await lstat(source);
        if (info.isSymbolicLink()) throw new Error(`portable payload 不接受 symlink：${source}`);
        if (info.isDirectory()) {
            await copyTree(source, target);
        } else if (info.isFile()) {
            await mkdir(dirname(target), {recursive: true});
            await copyFile(source, target);
        } else {
            throw new Error(`portable payload 包含不受支持的文件：${source}`);
        }
    }
}

/** 将一个目录登记为 ZIP 条目，路径按字典序稳定排序。 */
async function collectEntries(root, relativeRoot = "") {
    const output = [];
    const entries = await readdir(root, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        const source = join(root, entry.name);
        const archivePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
        const info = await lstat(source);
        if (info.isSymbolicLink()) throw new Error(`portable ZIP 不接受 symlink：${archivePath}`);
        if (info.isDirectory()) {
            output.push(...await collectEntries(source, archivePath));
        } else if (info.isFile()) {
            output.push({kind: "file", source, archivePath});
        } else {
            throw new Error(`portable ZIP 包含不受支持的文件：${archivePath}`);
        }
    }
    return output;
}

/** 固定 staging 的时间元数据，使同一输入的 ZIP payload 可复现。 */
async function freezeTimes(root) {
    const entries = await readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        const path = join(root, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw new Error(`portable staging 不接受 symlink：${path}`);
        if (info.isDirectory()) await freezeTimes(path);
        await utimes(path, FIXED_TIME, FIXED_TIME);
    }
}

/** 计算不含外层 manifest 的稳定 payload identity。 */
async function payloadIdentity(root) {
    const entries = (await collectEntries(root)).filter((entry) => entry.archivePath !== "manifest.json");
    const files = entries.filter((entry) => entry.kind === "file");
    const hash = createHash("sha256");
    let bytes = 0;
    for (const entry of files) {
        const content = await readFile(entry.source);
        const fileHash = createHash("sha256").update(content).digest("hex");
        bytes += content.byteLength;
        hash.update(`${entry.archivePath}\0${content.byteLength}\0${fileHash}\n`);
    }
    return {files: files.length, bytes, digest: `sha256:${hash.digest("hex")}`};
}

/** 扫描可执行与 JSON 文本，拒绝构建机绝对路径、包管理器物理路径和明文 token。 */
async function assertPortableText(root, sourceRoot) {
    const entries = await collectEntries(root);
    const forbidden = [sourceRoot.replaceAll("\\", "/"), ".bun/", ".pnpm/"];
    for (const entry of entries.filter((item) => item.kind === "file")) {
        if (!/\.(?:mjs|json|cmd|bat|ps1|html)$/u.test(entry.archivePath)) continue;
        const text = await readFile(entry.source, "utf8").catch(() => null);
        if (text === null) continue;
        for (const needle of forbidden) {
            if (text.includes(needle)) throw new Error(`portable 文件泄漏受禁止路径 ${needle}：${entry.archivePath}`);
        }
        if (/NEURO_BOOK_SHUTDOWN_TOKEN\s*[:=]\s*["']?[a-f0-9]{64}/iu.test(text)) {
            throw new Error(`portable 文件包含疑似固定 shutdown token：${entry.archivePath}`);
        }
    }
}

/** 读取 Bun 与 Electron 版本，写入脱敏 manifest。 */
async function runtimeVersions(bunExecutable, electronPackage, tauriCargo) {
    const bun = (await execFileAsync(bunExecutable, ["--version"], {windowsHide: true})).stdout.trim();
    const electron = JSON.parse(await readFile(electronPackage, "utf8"));
    const cargo = await readFile(tauriCargo, "utf8");
    const tauriVersion = cargo.match(/^\s*version\s*=\s*"([^"]+)"/mu)?.[1];
    if (!/^\d+\.\d+\.\d+$/u.test(bun) || typeof electron.version !== "string" || !tauriVersion) {
        throw new Error("无法读取 portable runtime 版本。");
    }
    return {bun, electron: electron.version, tauri: tauriVersion};
}

/** 读取 Tool Pack 中的真实可执行文件位置与版本；不接受 shim 或缺失依赖。 */
async function toolPackInfo(root) {
    const gitPath = join(root, "git", "cmd", "git.exe");
    const bashPath = join(root, "git", "usr", "bin", "bash.exe");
    const rgPath = join(root, "rg", "rg.exe");
    const [git, bash, rg] = await Promise.all([
        execFileAsync(gitPath, ["--version"], {windowsHide: true}),
        execFileAsync(bashPath, ["--version"], {windowsHide: true}),
        execFileAsync(rgPath, ["--version"], {windowsHide: true}),
    ]);
    const gitVersion = git.stdout.trim().match(/git version ([^\s]+)/u)?.[1];
    const rgVersion = rg.stdout.trim().match(/^ripgrep ([^\s]+)/mu)?.[1];
    if (!gitVersion || !rgVersion || !/^GNU bash(?:,| )/u.test(bash.stdout.trim())) {
        throw new Error("Tool Pack 的 Git/Bash/rg 版本无法验证。");
    }
    return {
        gitPath: "tools/git/cmd/git.exe",
        bashPath: "tools/git/usr/bin/bash.exe",
        rgPath: "tools/rg/rg.exe",
        gitVersion,
        rgVersion,
    };
}

async function fileSha256(path) {
    return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** 复制 Electron runtime；壳代码进入 app.asar，native 图标留在 resources 根。 */
async function copyElectronRuntime(sourceRoot, stageRoot) {
    const targetRoot = join(stageRoot, "desktop");
    await mkdir(targetRoot, {recursive: true});
    const entries = await readdir(sourceRoot, {withFileTypes: true});
    for (const entry of entries) {
        const source = join(sourceRoot, entry.name);
        if (entry.name === "electron.exe") {
            await copyFile(source, join(targetRoot, "NeuroBook-Electron.exe"));
        } else if (entry.isDirectory()) {
            await copyTree(source, join(targetRoot, entry.name));
        } else if (entry.isFile()) {
            await copyFile(source, join(targetRoot, entry.name));
        } else {
            throw new Error(`Electron runtime 包含不受支持的文件：${source}`);
        }
    }
    const resourcesRoot = join(targetRoot, "resources");
    const appStagingRoot = join(resourcesRoot, "app");
    await mkdir(appStagingRoot, {recursive: true});
    const envelopeDist = resolve(sourceRoot, "..", "..", "..", "dist");
    await copyFile(join(envelopeDist, "main.mjs"), join(appStagingRoot, "main.mjs"));
    await copyFile(join(envelopeDist, "preload.cjs"), join(appStagingRoot, "preload.cjs"));
    await copyFile(join(envelopeDist, "startup.html"), join(appStagingRoot, "startup.html"));
    await writeFile(join(appStagingRoot, "package.json"), `${JSON.stringify({
        name: "neuro-book-portable-electron-envelope",
        version: "0.0.0",
        private: true,
        main: "main.mjs",
    }, null, 4)}\n`, "utf8");
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    await assertPortableText(appStagingRoot, repoRoot);
    await createPackage(appStagingRoot, join(resourcesRoot, "app.asar"));
    await rm(appStagingRoot, {recursive: true, force: true});
    await copyFile(join(envelopeDist, "icon.ico"), join(resourcesRoot, "icon.ico"));
}

/** 建立一个没有用户内容的 Portable stage。 */
async function createStage(kind, args, verified, versions, stageRoot) {
    await mkdir(stageRoot, {recursive: true});
    await copyTree(args.imageRoot, join(stageRoot, ".output"));
    await mkdir(join(stageRoot, "runtime"), {recursive: true});
    await copyFile(args.bunExecutable, join(stageRoot, "runtime", "bun.exe"));
    await mkdir(join(stageRoot, "desktop"), {recursive: true});
    await mkdir(join(stageRoot, "manager"), {recursive: true});
    await copyTree(args.toolPack, join(stageRoot, "tools"));
    await copyFile(args.managerExecutable, join(stageRoot, "manager", "neuro-book.mjs"));
    if (kind === "electron") {
        await copyElectronRuntime(args.electronRuntime, stageRoot);
    } else {
        await copyFile(args.tauriExecutable, join(stageRoot, "desktop", "NeuroBook-Tauri.exe"));
    }

    for (const path of [
        "data/.keep",
        "data/.desktop/.keep",
        "data/.desktop/webview/.keep",
        ".cache/.keep",
    ]) {
        const target = join(stageRoot, path);
        await mkdir(dirname(target), {recursive: true});
        await writeFile(target, "portable-root\n", "utf8");
    }

    const contract = await readProductRuntimeContract(join(stageRoot, ".output"));
    if (contract.schema !== "nbook.product-runtime-contract/v5") {
        throw new Error(`Portable 只接受 Product Runtime Contract v5，当前为 ${contract.schema}`);
    }
    const managerSha256 = await fileSha256(join(stageRoot, "manager", "neuro-book.mjs"));
    const bunSha256 = await fileSha256(join(stageRoot, "runtime", "bun.exe"));
    const toolInfo = await toolPackInfo(join(stageRoot, "tools"));
    const toolIdentity = await payloadIdentity(join(stageRoot, "tools"));
    const toolArchiveSha256 = toolIdentity.digest.slice("sha256:".length);
    const bareDigest = verified.manifest.imageId.slice("sha256:".length);
    const managerPackage = JSON.parse(await readFile(resolve(dirname(args.managerExecutable), "..", "package.json"), "utf8"));
    const now = "2026-08-05T00:00:00.000Z";
    const installationManifest = {
        schemaVersion: 5,
        profile: "windows-portable",
        containerEngine: null,
        managerVersion: managerPackage.version,
        appVersion: verified.manifest.version,
        channel: "canary",
        sourceRevision: verified.manifest.revision,
        roots: {
            state: {base: "installation-root", path: "data"},
            cache: {base: "installation-root", path: ".cache"},
            desktop: {base: "installation-root", path: "data/.desktop"},
            webview: {base: "installation-root", path: "data/.desktop/webview"},
        },
        components: {
            source: {
                provider: "release",
                buildId: verified.manifest.imageId,
                version: verified.manifest.version,
                revision: verified.manifest.revision,
                path: ".",
                files: [],
                archiveSha256: bareDigest,
                sourceUrl: "local:portable-product-source",
                license: "AGPL-3.0-only",
                redistribution: "完整 Release Source 由 Manager CLI 单独管理",
            },
            product: {
                provider: "release",
                buildId: verified.manifest.imageId,
                version: verified.manifest.version,
                revision: verified.manifest.revision,
                path: ".output",
                platform: "windows-x64",
                archiveSha256: bareDigest,
                sourceUrl: "local:verified-product-runtime-image",
                license: "AGPL-3.0-only",
                redistribution: "verified Product Runtime Image",
                imageId: verified.manifest.imageId,
                sourceDigest: verified.manifest.sourceDigest,
                lockfileSha256: verified.manifest.lockfileSha256,
                builderContractVersion: verified.manifest.builderContractVersion,
            },
            manager: {provider: "managed", version: managerPackage.version, path: "manager/neuro-book.mjs", bundleSha256: managerSha256},
            managerRuntime: {
                provider: "managed",
                version: versions.bun,
                path: "runtime/bun.exe",
                executableSha256: bunSha256,
                archiveSha256: bunSha256,
                sourceUrl: "local:bun-runtime",
                license: "参见 Bun Runtime license",
                redistribution: "Bun executable",
            },
            applicationRuntime: {
                provider: "managed",
                version: versions.bun,
                path: "runtime/bun.exe",
                executableSha256: bunSha256,
                archiveSha256: bunSha256,
                sourceUrl: "local:bun-runtime",
                license: "参见 Bun Runtime license",
                redistribution: "Bun executable",
            },
            tools: {
                rg: {
                    provider: "managed",
                    version: toolInfo.rgVersion,
                    path: toolInfo.rgPath,
                    executableSha256: await fileSha256(join(stageRoot, toolInfo.rgPath)),
                    archiveSha256: toolArchiveSha256,
                    sourceUrl: "local:neuro-book-toolpack-win-x64",
                    license: "MIT OR Unlicense",
                    redistribution: "按 ripgrep 官方 Release 原样再分发，并保留许可证文件。",
                },
                git: {
                    provider: "managed",
                    distribution: "PortableGit",
                    version: toolInfo.gitVersion,
                    path: toolInfo.gitPath,
                    bashPath: toolInfo.bashPath,
                    archiveSha256: toolArchiveSha256,
                    gitSha256: await fileSha256(join(stageRoot, toolInfo.gitPath)),
                    bashSha256: await fileSha256(join(stageRoot, toolInfo.bashPath)),
                    sourceUrl: "local:neuro-book-toolpack-win-x64",
                    license: "GPL-2.0-only",
                    redistribution: "按 Git for Windows PortableGit 原样再分发；包内许可证文件随组件保留。",
                },
            },
        },
        installedAt: now,
        updatedAt: now,
    };
    await mkdir(join(stageRoot, ".deploy"), {recursive: true});
    await writeFile(join(stageRoot, ".deploy", "installation.json"), `${JSON.stringify(installationManifest, null, 4)}\n`, "utf8");
    await writeProductRuntimeVerificationReceipt(
        join(stageRoot, ".deploy", "product-runtime-receipt.json"),
        createProductRuntimeVerificationReceipt(verified.manifest, now),
    );
    const identity = await payloadIdentity(stageRoot);
    const manifest = {
        schema: PORTABLE_SCHEMA,
        kind,
        platform: "windows-x64",
        product: {
            imagePath: ".output",
            imageId: verified.manifest.imageId,
            sourceRevision: verified.manifest.revision,
            sourceDigest: verified.manifest.sourceDigest,
            dirty: verified.manifest.dirty,
            contractSchema: contract.schema,
            contractSha256: verified.manifest.runtimeContract.sha256,
        },
        runtime: {
            bunPath: "runtime/bun.exe",
            bunVersion: versions.bun,
            envelopePath: kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe",
            envelopeVersion: kind === "electron" ? versions.electron : versions.tauri,
            envelopeSha256: `sha256:${await fileSha256(join(stageRoot, kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe"))}`,
        },
        toolPack: {
            files: toolIdentity.files,
            bytes: toolIdentity.bytes,
            digest: toolIdentity.digest,
        },
        roots: {
            application: ".",
            state: "data",
            cache: ".cache",
            desktop: "data/.desktop",
            webview: "data/.desktop/webview",
        },
        webview: kind === "electron"
            ? {kind: "bundled-chromium", webviewRoot: "data/.desktop/webview"}
            : {kind: "system-evergreen", provider: "Microsoft WebView2 Evergreen", install: "not-included", webviewRoot: "data/.desktop/webview"},
        payload: identity,
    };
    await writeFile(join(stageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
    await freezeTimes(stageRoot);
    const scriptRoot = dirname(fileURLToPath(import.meta.url));
    await assertPortableText(stageRoot, resolve(scriptRoot, "..", ".."));
    const archiveEntries = await collectEntries(stageRoot);
    return {manifest, archiveEntries};
}

/** 生成两个 ZIP 以及不含本机路径的 manifest sidecar。 */
async function buildPortable(kind, args, verified, versions, outputDir) {
    const stageRoot = await mkdtemp(join(outputDir, `.stage-${kind}-`));
    try {
        const {manifest, archiveEntries} = await createStage(kind, args, verified, versions, stageRoot);
        const baseName = `neuro-book-${kind}-portable-win-x64`;
        const archive = join(outputDir, `${baseName}.zip`);
        await writeZipArchive(archive, archiveEntries, 2000);
        await writeFile(join(outputDir, `${baseName}.manifest.json`), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
        return {archive, manifest};
    } finally {
        await rm(stageRoot, {recursive: true, force: true});
    }
}

/** 建立只含 Desktop Envelope 的远端 shell depot；Product/Bun/Manager/Tool Pack 均不进入。 */
async function createShellStage(kind, args, versions, stageRoot) {
    await mkdir(stageRoot, {recursive: true});
    if (kind === "electron") {
        await copyElectronRuntime(args.electronRuntime, stageRoot);
    } else {
        await mkdir(join(stageRoot, "desktop"), {recursive: true});
        await copyFile(args.tauriExecutable, join(stageRoot, "desktop", "NeuroBook-Tauri.exe"));
    }
    const envelopePath = kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe";
    const manifest = {
        schema: "nbook.desktop-shell/v1",
        kind,
        platform: "windows-x64",
        envelopePath,
        envelopeVersion: kind === "electron" ? versions.electron : versions.tauri,
        envelopeSha256: `sha256:${await fileSha256(join(stageRoot, envelopePath))}`,
        webview: kind === "electron" ? "bundled-chromium" : "system-evergreen",
    };
    await writeFile(join(stageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
    await freezeTimes(stageRoot);
    const scriptRoot = dirname(fileURLToPath(import.meta.url));
    await assertPortableText(stageRoot, resolve(scriptRoot, "..", ".."));
    return {manifest, archiveEntries: await collectEntries(stageRoot)};
}

/** 生成独立 shell ZIP 和 sidecar manifest。 */
async function buildShell(kind, args, versions, outputDir) {
    const stageRoot = await mkdtemp(join(outputDir, `.stage-${kind}-shell-`));
    try {
        const {manifest, archiveEntries} = await createShellStage(kind, args, versions, stageRoot);
        const baseName = `neuro-book-${kind}-shell-win-x64`;
        const archive = join(outputDir, `${baseName}.zip`);
        await writeZipArchive(archive, archiveEntries, 2000);
        await writeFile(join(outputDir, `${baseName}.manifest.json`), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
        return {archive, manifest};
    } finally {
        await rm(stageRoot, {recursive: true, force: true});
    }
}

/** 为本地 depot 生成可被 Manager 解析的组件发行清单。 */
async function writeDistributionManifest(outputDir, fileName, version, channel, archives) {
    const components = await Promise.all(archives.map(async ({id, archive, componentVersion, required}) => {
        const info = await stat(archive);
        return {
            id,
            version: componentVersion,
            archive: {
                kind: "path",
                location: basename(archive),
                sha256: `sha256:${await fileSha256(archive)}`,
                bytes: info.size,
                format: "zip",
            },
            required,
        };
    }));
    const manifest = {
        schema: "nbook.desktop-distribution/v1",
        version,
        channel,
        platform: "windows",
        architecture: "x64",
        components,
    };
    await writeFile(join(outputDir, fileName), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
    return manifest;
}

/** 将两个已完成的 Portable 与安装入口聚合为一个不展开大目录的本地 depot。 */
async function buildAggregateDepot(outputDir, distribution) {
    const baseName = "neuro-book-desktop-spike-win-x64";
    const files = [...DESKTOP_AGGREGATE_DEPOT_ENTRIES];
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const sourcePaths = new Map([
        ["install-desktop.ps1", join(repoRoot, "scripts", "install", "install-desktop.ps1")],
        ["windows-bun-stage0.ps1", join(repoRoot, "scripts", "install", "windows-bun-stage0.ps1")],
        ...files.slice(2).map((file) => [file, join(outputDir, file)]),
    ]);
    const stageRoot = await mkdtemp(join(outputDir, ".stage-aggregate-"));
    try {
        for (const file of files) {
            const source = sourcePaths.get(file);
            if (!source || !(await stat(source).catch(() => null))?.isFile()) {
                throw new Error(`Aggregate depot 缺少文件：${file}`);
            }
            await copyFile(source, join(stageRoot, file));
        }
        await freezeTimes(stageRoot);
        const archiveEntries = (await inspectDesktopAggregateDepot(stageRoot)).entries;
        if (archiveEntries.length !== files.length || archiveEntries.some((entry, index) => entry.archivePath !== files[index])) {
            throw new Error("Aggregate depot ZIP 条目顺序不符合固定合同。" );
        }
        const archive = join(outputDir, DESKTOP_AGGREGATE_DEPOT_ARCHIVE);
        await writeZipArchive(archive, archiveEntries, 2000);
        if (distribution.schema !== "nbook.desktop-distribution/v1") {
            throw new Error(`Aggregate depot 只接受 ${"nbook.desktop-distribution/v1"} distribution manifest。`);
        }
        const sidecar = await createDesktopAggregateDepotManifest({stagingRoot: stageRoot, archivePath: archive});
        if (sidecar.distributionManifest !== DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST || sidecar.distributionSchema !== distribution.schema) {
            throw new Error("Aggregate depot sidecar 与 distribution manifest 不一致。" );
        }
        await writeFile(join(outputDir, `${baseName}.manifest.json`), `${JSON.stringify(sidecar, null, 4)}\n`, "utf8");
        return {archive, manifest: sidecar};
    } finally {
        await rm(stageRoot, {recursive: true, force: true});
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    await mkdir(args.outputDir, {recursive: true});
    const existing = await readdir(args.outputDir);
    if (existing.length > 0) throw new Error(`Portable 输出目录必须为空：${args.outputDir}`);
    const verified = await new ProductRuntimeImageVerifier().openSelfVerified(args.imageRoot);
    if (verified.manifest.platform !== "windows-x64") {
        throw new Error("Portable 只接受 windows-x64 verified Product Image。");
    }
    if (verified.manifest.dirty) {
        console.warn("Portable 使用 dirty spike Product Image；该 ZIP 不是正式 Release。");
    }
    const versions = await runtimeVersions(
        args.bunExecutable,
        join(args.electronRuntime, "..", "package.json"),
        resolve(dirname(args.tauriExecutable), "..", "..", "Cargo.toml"),
    );
    const electron = await buildPortable("electron", args, verified, versions, args.outputDir);
    const tauri = await buildPortable("tauri", args, verified, versions, args.outputDir);
    const distribution = await writeDistributionManifest(
        args.outputDir,
        "neuro-book-desktop-spike-win-x64.distribution.json",
        verified.manifest.version,
        "canary",
        [
            {id: "electron-envelope", componentVersion: electron.manifest.runtime.envelopeVersion, archive: electron.archive, required: false},
            {id: "tauri-envelope", componentVersion: tauri.manifest.runtime.envelopeVersion, archive: tauri.archive, required: false},
        ],
    );
    const aggregate = await buildAggregateDepot(args.outputDir, distribution);
    let shells = null;
    if (args.shellOutputDir) {
        await mkdir(args.shellOutputDir, {recursive: true});
        if ((await readdir(args.shellOutputDir)).length > 0) {
            throw new Error(`Shell 输出目录必须为空：${args.shellOutputDir}`);
        }
        shells = {
            electron: await buildShell("electron", args, versions, args.shellOutputDir),
            tauri: await buildShell("tauri", args, versions, args.shellOutputDir),
        };
        shells.distribution = await writeDistributionManifest(
            args.shellOutputDir,
            "neuro-book-shell-win-x64.distribution.json",
            verified.manifest.version,
            "canary",
            [
                {id: "electron-envelope", componentVersion: shells.electron.manifest.envelopeVersion, archive: shells.electron.archive, required: false},
                {id: "tauri-envelope", componentVersion: shells.tauri.manifest.envelopeVersion, archive: shells.tauri.archive, required: false},
            ],
        );
    }
    console.log(JSON.stringify({
        imageId: verified.manifest.imageId,
        bun: versions.bun,
        electron: electron.archive,
        tauri: tauri.archive,
        distribution,
        aggregate,
        ...(shells ? {shells} : {}),
    }, null, 4));
}

await main();
