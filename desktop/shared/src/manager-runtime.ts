import {copyFile, lstat, mkdir, readdir, readFile, rename, rm} from "node:fs/promises";
import {join, relative, resolve} from "node:path";

export {
    isCanonicalMachineManagerPath,
    materializeMachineManagerScript,
} from "nbook/packages/neuro-book-manager/src/manager-runtime-projection";

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
