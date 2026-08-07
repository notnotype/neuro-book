import {createHash, randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {installationTarget} from "#manager/installation-path";

/** 确保目录存在。 */
export async function ensureDirectory(path: string): Promise<void> {
    try {
        await mkdir(path, {recursive: true});
    } catch (error) {
        // Bun on Windows may report EEXIST for an existing read-only directory
        // (for example the user's Desktop). Treat that as success only after
        // verifying that the target is still a directory; a file or a race
        // that replaced the path remains a hard failure.
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
            throw error;
        }
        const info = await stat(path);
        if (!info.isDirectory()) {
            throw error;
        }
    }
}

/** 原子写入 UTF-8 文本。 */
export async function writeTextAtomic(path: string, content: string): Promise<void> {
    await ensureDirectory(dirname(path));
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
}

/** 原子写入 JSON。 */
export async function writeJsonAtomic(path: string, value: object): Promise<void> {
    await writeTextAtomic(path, `${JSON.stringify(value, null, 4)}\n`);
}

/** 读取 JSON，文件不存在时返回 null。 */
export async function readJson(path: string): Promise<unknown | null> {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
        if (isFileError(error, "ENOENT")) {
            return null;
        }
        throw error;
    }
}

/** 计算文件 SHA256。 */
export async function sha256File(path: string): Promise<string> {
    const hash = createHash("sha256");
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const stream = createReadStream(path);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", rejectPromise);
        stream.on("end", resolvePromise);
    });
    return hash.digest("hex");
}

/** 安全删除 staging 路径。 */
export async function removePath(path: string): Promise<void> {
    await rm(path, {recursive: true, force: true});
}

/** 判断文件或目录是否存在。 */
export async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (isFileError(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

/** 断言子路径没有越出目标根。 */
export function safeTarget(root: string, relativePath: string): string {
    return installationTarget(root, relativePath);
}

function isFileError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}
