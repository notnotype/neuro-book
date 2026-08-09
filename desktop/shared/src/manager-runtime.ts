import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, rename, rm} from "node:fs/promises";
import {join, resolve} from "node:path";

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
