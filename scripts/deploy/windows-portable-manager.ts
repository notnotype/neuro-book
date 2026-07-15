#!/usr/bin/env bun
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {cp, mkdir, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";
import {Command} from "commander";

import {ensureStateFiles} from "nbook/packages/neuro-book-manager/src/config";
import {writeInstallationManifest} from "nbook/packages/neuro-book-manager/src/manifest-store";
import {writePortableLaunchers} from "nbook/packages/neuro-book-manager/src/portable-launchers";
import {installManagedBun, installManagerExecutable, writeManagerWrapper, writeRuntimeWrapper} from "nbook/packages/neuro-book-manager/src/runtime";
import {installManagedTool, writeManagedToolWrappers} from "nbook/packages/neuro-book-manager/src/tools";
import type {InstallationManifest} from "nbook/packages/neuro-book-manager/src/types";
import {MANAGER_VERSION} from "nbook/packages/neuro-book-manager/src/version-info";
import {shouldIncludePortableFile} from "nbook/scripts/build/portable-file-policy";
import {run, runCapture} from "nbook/scripts/utils/process.mjs";
import {writeZipArchive} from "nbook/scripts/utils/zip";

const ROOT = resolve(import.meta.dir, "..", "..");

const program = new Command()
    .name("package-windows-portable")
    .requiredOption("--source-archive <path>", "同版本 Source archive。")
    .requiredOption("--product-archive <path>", "同版本 Windows Product archive。")
    .option("--output <path>", "输出 zip。", "dist/neuro-book-windows-x64.zip");
program.parse();

const options = program.opts<{output: string; sourceArchive: string; productArchive: string}>();
await packagePortable(resolve(ROOT, options.output), resolve(ROOT, options.sourceArchive), resolve(ROOT, options.productArchive));

/** 组装以仓库根为底座的 Windows Portable。 */
async function packagePortable(output: string, sourceArchive: string, productArchive: string): Promise<void> {
    if (process.platform !== "win32" || process.arch !== "x64") {
        throw new Error("Windows Portable 必须在 Windows x64 runner 构建。");
    }
    const outputEntry = resolve(ROOT, ".output", "server", "index.mjs");
    if (!await exists(outputEntry)) {
        throw new Error("缺少 .output/server/index.mjs，请先执行 bun run nuxt:build。");
    }
    await run("bun", ["run", "manager:build"], {cwd: ROOT});
    const stage = resolve(ROOT, ".agent", "workspace", "windows-portable-manager-stage");
    await rm(stage, {recursive: true, force: true});
    await mkdir(stage, {recursive: true});
    const sourceFiles = await trackedFiles();
    for (const file of sourceFiles) {
        const target = resolve(stage, file);
        await mkdir(dirname(target), {recursive: true});
        await cp(resolve(ROOT, file), target, {force: true});
    }
    await cp(resolve(ROOT, ".output"), resolve(stage, ".output"), {recursive: true});

    const version = await appVersion();
    const sourceRevision = await revision();
    const releaseRoot = `https://github.com/notnotype/neuro-book/releases/download/v${version}`;
    const runtime = await installManagedBun(stage);
    const rg = await installManagedTool(stage, "rg");
    const git = await installManagedTool(stage, "git");
    const managerExecutable = resolve(ROOT, "packages", "neuro-book-manager", "dist", "neuro-book.mjs");
    const manager = await installManagerExecutable(stage, MANAGER_VERSION, managerExecutable);
    await writeRuntimeWrapper(stage, runtime);
    await writeManagedToolWrappers(stage, {rg, git});
    await writeManagerWrapper(stage, manager, runtime);
    await ensureStateFiles(resolve(stage, "data"), 3000, false);
    await writeFile(resolve(stage, "data", "README.txt"), "NeuroBook user state. Keep this directory when updating.\r\n", "utf8");
    await writePortableLaunchers(stage);
    await verifyPortableExecutables(stage, runtime.path, rg.path, git.path, git.bashPath);
    const now = new Date().toISOString();
    const manifest: InstallationManifest = {
        schemaVersion: 3,
        profile: "windows-portable",
        managerVersion: MANAGER_VERSION,
        appVersion: version,
        channel: version.includes("-") ? "canary" : "stable",
        sourceRevision,
        stateRoot: "data",
        components: {
            source: {
                provider: "release",
                version,
                revision: sourceRevision,
                path: ".",
                files: sourceFiles,
                archiveSha256: await sha256(sourceArchive),
                sourceUrl: `${releaseRoot}/neuro-book-source.zip`,
                license: "AGPL-3.0-only",
                redistribution: "Windows Portable 内置同 revision NeuroBook Source snapshot。",
            },
            product: {
                provider: "release",
                version,
                revision: sourceRevision,
                path: ".output",
                platform: "windows-x64",
                archiveSha256: await sha256(productArchive),
                sourceUrl: `${releaseRoot}/neuro-book-product-windows-x64.zip`,
                license: "AGPL-3.0-only",
                redistribution: "Windows Portable 内置 Windows x64 Product overlay。",
            },
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
    await zipDirectory(stage, output);
    const hash = await sha256(output);
    await mkdir(dirname(output), {recursive: true});
    await writeFile(resolve(dirname(output), "SHA256SUMS.windows"), `${hash}  ${basename(output)}\n`, "utf8");
    console.log(`Windows Portable: ${relative(ROOT, output)}`);
}

async function verifyPortableExecutables(root: string, bunPath: string, rgPath: string, gitPath: string, bashPath: string): Promise<void> {
    for (const [name, path] of [["bun", bunPath], ["rg", rgPath], ["git", gitPath], ["bash", bashPath]] as const) {
        const output = await runCapture(resolve(root, path), ["--version"], {cwd: root});
        if (!output.trim()) throw new Error(`Windows Portable ${name} --version 没有输出。`);
    }
}

async function trackedFiles(): Promise<string[]> {
    const indexedFiles = (await runCapture("git", ["ls-files", "-z"], {cwd: ROOT}))
        .split("\0")
        .filter(Boolean)
        .filter(shouldIncludePortableFile)
        .filter((path) => !path.startsWith("packages/neuro-book-manager/dist/"));
    const existingFiles: string[] = [];
    const skippedFiles: string[] = [];
    for (const path of indexedFiles) {
        if (await exists(resolve(ROOT, path))) existingFiles.push(path);
        else skippedFiles.push(path);
    }
    if (skippedFiles.length > 0) {
        console.warn(`跳过 ${skippedFiles.length} 个已从工作区删除但仍在 Git 索引中的文件：`);
        for (const path of skippedFiles) console.warn(`- ${path}`);
    }
    return existingFiles.sort();
}

async function appVersion(): Promise<string> {
    return String((JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8")) as {version: string}).version);
}

async function revision(): Promise<string> {
    return (await runCapture("git", ["rev-parse", "HEAD"], {cwd: ROOT})).trim();
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
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const stream = createReadStream(path);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", rejectPromise);
        stream.on("end", resolvePromise);
    });
    return hash.digest("hex");
}

async function sha256Directory(root: string): Promise<string> {
    return sha256Files(root, await directoryFiles(root));
}

async function sha256Files(root: string, files: string[]): Promise<string> {
    const hash = createHash("sha256");
    for (const file of [...files].sort()) {
        hash.update(file.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(await readFile(resolve(root, file)));
        hash.update("\0");
    }
    return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
    return stat(path).then(() => true).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error));
}
