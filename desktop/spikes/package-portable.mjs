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
    utimes,
    writeFile,
} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

import {writeZipArchive} from "../../scripts/utils/zip.ts";
import {ProductRuntimeImageVerifier} from "../../shared/product-runtime-image-verifier.ts";
import {readProductRuntimeContract} from "../../shared/product-runtime-contract.ts";

const execFileAsync = promisify(execFile);
const PORTABLE_SCHEMA = "nbook.desktop-portable/v1";
const FIXED_TIME = new Date("1980-01-01T00:00:00.000Z");
const PRODUCT_MANIFEST = "app/.output/runtime-image.json";
const PRODUCT_READY = "app/.output/runtime-image.ready";

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
    const required = ["--image", "--output-dir", "--electron-runtime", "--tauri-exe"];
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
        electronRuntime: resolve(values.get("--electron-runtime")),
        tauriExecutable: resolve(values.get("--tauri-exe")),
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
async function runtimeVersions(bunExecutable, electronPackage) {
    const bun = (await execFileAsync(bunExecutable, ["--version"], {windowsHide: true})).stdout.trim();
    const electron = JSON.parse(await readFile(electronPackage, "utf8"));
    if (!/^\d+\.\d+\.\d+$/u.test(bun) || typeof electron.version !== "string") {
        throw new Error("无法读取 portable runtime 版本。");
    }
    return {bun, electron: electron.version};
}

/** 复制 Electron runtime，并把 main/preload 放入 Electron 约定的 resources/app。 */
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
    await mkdir(join(targetRoot, "resources", "app"), {recursive: true});
    const envelopeDist = resolve(sourceRoot, "..", "..", "..", "dist");
    await copyFile(join(envelopeDist, "main.mjs"), join(targetRoot, "resources", "app", "main.mjs"));
    await copyFile(join(envelopeDist, "preload.mjs"), join(targetRoot, "resources", "app", "preload.mjs"));
    await writeFile(join(targetRoot, "resources", "app", "package.json"), `${JSON.stringify({
        name: "neuro-book-portable-electron-envelope",
        version: "0.0.0",
        private: true,
        main: "main.mjs",
    }, null, 4)}\n`, "utf8");
}

/** 建立一个没有用户内容的 Portable stage。 */
async function createStage(kind, args, verified, versions, stageRoot) {
    await mkdir(stageRoot, {recursive: true});
    await copyTree(args.imageRoot, join(stageRoot, "app", ".output"));
    await mkdir(join(stageRoot, "runtime"), {recursive: true});
    await copyFile(args.bunExecutable, join(stageRoot, "runtime", "bun.exe"));
    await mkdir(join(stageRoot, "desktop"), {recursive: true});
    const scriptRoot = dirname(fileURLToPath(import.meta.url));
    const launcherSource = resolve(scriptRoot, "shared", "dist", "product-launcher.mjs");
    await copyFile(launcherSource, join(stageRoot, "desktop", "product-launcher.mjs"));
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

    const contract = await readProductRuntimeContract(join(stageRoot, "app", ".output"));
    if (contract.schema !== "nbook.product-runtime-contract/v4") {
        throw new Error(`Portable 只接受 Product Runtime Contract v4，当前为 ${contract.schema}`);
    }
    const identity = await payloadIdentity(stageRoot);
    const manifest = {
        schema: PORTABLE_SCHEMA,
        kind,
        platform: "windows-x64",
        product: {
            imagePath: "app/.output",
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
            envelopeVersion: kind === "electron" ? versions.electron : "tauri-2.11.5",
        },
        roots: {
            application: "app",
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
    );
    const electron = await buildPortable("electron", args, verified, versions, args.outputDir);
    const tauri = await buildPortable("tauri", args, verified, versions, args.outputDir);
    console.log(JSON.stringify({
        imageId: verified.manifest.imageId,
        bun: versions.bun,
        electron: electron.archive,
        tauri: tauri.archive,
    }, null, 4));
}

await main();
