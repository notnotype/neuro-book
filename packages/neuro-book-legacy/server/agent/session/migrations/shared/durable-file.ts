import {createHash} from "node:crypto";
import {access, mkdir, open, readFile, readdir, rename, rm} from "node:fs/promises";
import {dirname, relative, resolve, sep} from "node:path";

/** Agent Session JSONL 真相源中的一个受 containment 保护的文件。 */
export type SessionJsonlFile = {
    absolutePath: string;
    sourcePath: string;
};

/** 将文件目录项同步到磁盘，保证 create/rename 的目录项可恢复。 */
export async function syncParentDirectories(...paths: string[]): Promise<void> {
    if (process.platform === "win32") {
        return;
    }
    for (const directory of new Set(paths.map((path) => dirname(path)))) {
        const handle = await open(directory, "r");
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    }
}

/** 将 Workspace Root-relative portable path 解析为受 containment 保护的绝对路径。 */
export function workspacePath(rootWorkspace: string, portablePath: string): string {
    const path = resolve(rootWorkspace, ...portablePath.split("/"));
    const relativePath = relative(rootWorkspace, path);
    if (!relativePath || relativePath === "." || relativePath.startsWith("..")
        || resolve(rootWorkspace, relativePath) !== path) {
        throw new Error("migration manifest 包含越界路径");
    }
    return path;
}

/** 将绝对路径转换为 Workspace Root-relative portable path。 */
export function portableRelative(rootWorkspace: string, path: string): string {
    const contained = workspacePath(rootWorkspace, relative(rootWorkspace, path).split(sep).join("/"));
    if (contained !== resolve(path)) {
        throw new Error("migration path 不属于 Workspace Root");
    }
    return relative(rootWorkspace, path).split(sep).join("/");
}

/** 递归枚举 Agent Session Store 中全部 JSONL，旧分目录同样纳入硬切复扫。 */
export async function sessionJsonlFiles(rootWorkspace: string): Promise<SessionJsonlFile[]> {
    const sessionsRoot = resolve(rootWorkspace, ".nbook", "agent", "sessions");
    const paths = await jsonlFiles(sessionsRoot);
    return paths.map((absolutePath) => ({
        absolutePath,
        sourcePath: portableRelative(rootWorkspace, absolutePath),
    })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

/** 计算迁移计划使用的 SHA-256 文件身份。 */
export function sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

/** 读取文件 hash；文件不存在时返回 null。 */
export async function optionalFileHash(path: string): Promise<string | null> {
    return readFile(path).then((bytes) => sha256(bytes)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    });
}

/** 断言磁盘文件与迁移计划中的 hash 一致。 */
export async function assertFileHash(path: string, expected: string, message: string): Promise<void> {
    const actual = await optionalFileHash(path);
    if (actual !== expected) {
        throw new Error(`${message}：expected=${expected} actual=${actual ?? "missing"}`);
    }
}

/** 写入并同步文本；exclusive=true 时拒绝覆盖既有文件。 */
export async function writeDurableText(path: string, text: string, exclusive = false): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, exclusive ? "wx" : "w");
    try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await syncParentDirectories(path);
}

/** 写入并同步可读 JSON 文件。 */
export async function writeDurableJson(path: string, value: object): Promise<void> {
    await writeDurableText(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** 用同目录版本化 temp + rename 原子替换 durable JSON。 */
export async function writeAtomicDurableJson(path: string, value: object): Promise<void> {
    await writeAtomicDurableBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

/** 用同目录 temp + rename 原子替换原始 bytes，不重新序列化迁移前状态。 */
export async function writeAtomicDurableBytes(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const tempPath = `${path}.next`;
    await rm(tempPath, {force: true});
    const handle = await open(tempPath, "wx");
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await renameDurable(tempPath, path);
    } finally {
        await rm(tempPath, {force: true});
    }
}

/** 同步既有文件及其父目录。 */
export async function syncFile(path: string): Promise<void> {
    const handle = await open(path, "r+");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
    await syncParentDirectories(path);
}

/** 原子 rename 后同步源、目标父目录。 */
export async function renameDurable(source: string, target: string): Promise<void> {
    await rename(source, target);
    await syncParentDirectories(source, target);
}

/** 判断路径是否存在，并保留非 ENOENT I/O 错误。 */
export async function pathExists(path: string): Promise<boolean> {
    return access(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    });
}

/** 递归枚举目录中的普通 JSONL 文件，不跟随 symlink/junction。 */
async function jsonlFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    });
    const paths: string[] = [];
    for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            paths.push(...await jsonlFiles(path));
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            paths.push(path);
        }
    }
    return paths;
}
