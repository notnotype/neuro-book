import {createHash} from "node:crypto";
import {copyFile, lstat, mkdir, readdir, readFile, rename, rm} from "node:fs/promises";
import {join, relative, resolve} from "node:path";

/**
 * Bun 在 Windows Program Files 安装根执行 Manager bundle 时可能返回
 * `EPERM reading`，即使普通用户对文件拥有 ReadAndExecute。Manager source
 * 仍由 Installation Root 持有；这里只在用户 Cache Root 建立按摘要命名的
 * 临时执行投影，避免把 Application Root 改成可写。
 */
export async function materializeMachineManagerScript(
    sourcePath: string,
    cacheRoot: string,
    programFilesRoot = process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"),
): Promise<string> {
    const source = resolve(sourcePath);
    if (process.platform !== "win32" || !isCanonicalMachineManagerPath(source, programFilesRoot)) return source;

    const sourceBytes = await readFile(source);
    const digest = createHash("sha256").update(sourceBytes).digest("hex");
    const targetRoot = resolve(cacheRoot, "manager-runtime", digest);
    const target = join(targetRoot, "neuro-book.mjs");
    await mkdir(targetRoot, {recursive: true});
    try {
        const existing = await readFile(target);
        if (createHash("sha256").update(existing).digest("hex") === digest) return target;
    } catch {
        // A missing or partial projection is replaced atomically below.
    }
    const temporary = join(targetRoot, `.neuro-book-${process.pid}-${Date.now()}.mjs`);
    try {
        await copyFile(source, temporary);
        const copied = await readFile(temporary);
        if (createHash("sha256").update(copied).digest("hex") !== digest) {
            throw new Error("Manager Cache projection checksum 不匹配。");
        }
        await rename(temporary, target).catch(async (error: unknown) => {
            try {
                const current = await readFile(target);
                if (createHash("sha256").update(current).digest("hex") === digest) return;
            } catch {
                // The target does not exist or is incomplete; propagate the original error.
            }
            throw error;
        });
        return target;
    } finally {
        await rm(temporary, {force: true}).catch(() => undefined);
    }
}

export function isCanonicalMachineManagerPath(sourcePath: string, programFilesRoot: string): boolean {
    const source = resolve(sourcePath);
    const machineRoot = resolve(programFilesRoot, "NeuroBook");
    return source.toLocaleLowerCase().startsWith(`${machineRoot.toLocaleLowerCase()}\\manager\\`)
        || source.toLocaleLowerCase().startsWith(`${machineRoot.toLocaleLowerCase()}/manager/`);
}

/**
 * Bun 在 Windows Program Files 中直接加载 Product `.mjs` 也可能返回
 * `EPERM reading`。Machine Desktop 只把 verified `.output` 投影到 Cache；
 * Application Root 仍保持 Program Files，投影只负责执行入口和其相对 bundle。
 */
export async function materializeMachineProductImage(
    sourceImageRoot: string,
    cacheRoot: string,
    programFilesRoot = process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"),
): Promise<string> {
    const source = resolve(sourceImageRoot);
    if (process.platform !== "win32" || !isCanonicalMachineProductImagePath(source, programFilesRoot)) return source;

    const manifestPath = join(source, "runtime-image.json");
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as {imageId?: unknown};
    if (typeof manifest.imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(manifest.imageId)) {
        throw new Error(`Machine Product Runtime Image manifest identity 无效：${manifestPath}`);
    }
    const digest = manifest.imageId.slice("sha256:".length).toLowerCase();
    const projectionRoot = resolve(cacheRoot, "product-runtime", digest);
    const projectionImageRoot = join(projectionRoot, ".output");
    if (await projectedImageMatches(projectionImageRoot, manifestText)) return projectionImageRoot;

    const stagingRoot = resolve(cacheRoot, "product-runtime", `.staging-${process.pid}-${Date.now()}`);
    await rm(stagingRoot, {recursive: true, force: true}).catch(() => undefined);
    await mkdir(stagingRoot, {recursive: true});
    try {
        await copyTreeWithoutSymlinks(source, join(stagingRoot, ".output"));
        const copiedManifest = await readFile(join(stagingRoot, ".output", "runtime-image.json"), "utf8");
        const copiedValue = JSON.parse(copiedManifest) as {imageId?: unknown};
        if (copiedValue.imageId !== manifest.imageId) {
            throw new Error("Machine Product Runtime Image projection identity 不一致。");
        }
        await mkdir(resolve(projectionRoot, ".."), {recursive: true});
        try {
            await rename(stagingRoot, projectionRoot);
        } catch (error) {
            if (!await projectedImageMatches(projectionImageRoot, manifestText)) throw error;
        }
        return projectionImageRoot;
    } finally {
        await rm(stagingRoot, {recursive: true, force: true}).catch(() => undefined);
    }
}

export function isCanonicalMachineProductImagePath(sourceImageRoot: string, programFilesRoot: string): boolean {
    const source = resolve(sourceImageRoot);
    const machineImageRoot = resolve(programFilesRoot, "NeuroBook", ".output");
    return source.toLocaleLowerCase() === machineImageRoot.toLocaleLowerCase();
}

async function projectedImageMatches(projectionImageRoot: string, sourceManifestText: string): Promise<boolean> {
    try {
        const targetManifest = await readFile(join(projectionImageRoot, "runtime-image.json"), "utf8");
        const source = JSON.parse(sourceManifestText) as {imageId?: unknown};
        const target = JSON.parse(targetManifest) as {imageId?: unknown};
        return typeof source.imageId === "string" && source.imageId === target.imageId;
    } catch {
        return false;
    }
}

async function copyTreeWithoutSymlinks(sourceRoot: string, targetRoot: string): Promise<void> {
    const sourceInfo = await lstat(sourceRoot);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
        throw new Error(`Product Runtime Image projection 源必须是真实目录：${sourceRoot}`);
    }
    await mkdir(targetRoot, {recursive: true});
    const entries = await readdir(sourceRoot, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        const source = join(sourceRoot, entry.name);
        const target = join(targetRoot, entry.name);
        const info = await lstat(source);
        if (info.isSymbolicLink()) {
            throw new Error(`Product Runtime Image projection 不接受 symlink：${relative(sourceRoot, source)}`);
        }
        if (info.isDirectory()) {
            await copyTreeWithoutSymlinks(source, target);
        } else if (info.isFile()) {
            await copyFile(source, target);
        } else {
            throw new Error(`Product Runtime Image projection 包含不受支持的文件：${relative(sourceRoot, source)}`);
        }
    }
}
