import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, rename, rm} from "node:fs/promises";
import {join, resolve} from "node:path";

export const MANAGER_RUNTIME_PROJECTION_DIRECTORY = "manager-runtime";
export const MANAGER_RUNTIME_PROJECTION_FILENAME = "neuro-book.mjs";

/** Manager GUI、主 Electron 与稳定 CLI wrapper 共用同一 Cache identity。 */
export function managerRuntimeProjectionPath(cacheRoot: string, digest: string): string {
    return resolve(
        cacheRoot,
        MANAGER_RUNTIME_PROJECTION_DIRECTORY,
        digest.toLowerCase(),
        MANAGER_RUNTIME_PROJECTION_FILENAME,
    );
}

/**
 * Bun 在 Windows Program Files 中加载 Manager ESM 时要求文件 WriteAttributes。
 *
 * Installation Root 仍保持只读；执行前只把经过 SHA-256 校验的单文件 Manager
 * 投影到用户 Cache Root。此函数是 Electron/Manager GUI 的执行入口，稳定 CLI
 * wrapper 使用相同的目录与摘要合同。
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
    const target = managerRuntimeProjectionPath(cacheRoot, digest);
    const targetRoot = resolve(target, "..");
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
    const source = resolve(sourcePath).toLocaleLowerCase();
    const machineRoot = resolve(programFilesRoot, "NeuroBook").toLocaleLowerCase();
    return source.startsWith(`${machineRoot}\\manager\\`)
        || source.startsWith(`${machineRoot}/manager/`)
        || source.startsWith(`${machineRoot}\\.runtime\\manager\\`)
        || source.startsWith(`${machineRoot}/.runtime/manager/`);
}
