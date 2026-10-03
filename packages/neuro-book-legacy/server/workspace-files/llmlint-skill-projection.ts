import {createHash} from "node:crypto";
import {copyFile, lstat, mkdir, readdir, readFile, rm, stat} from "node:fs/promises";
import path from "node:path";

const EXCLUDED_DIRECTORY_NAMES = new Set([
    ".agent",
    ".bun",
    ".cache",
    ".data",
    ".git",
    ".local",
    ".nuxt",
    ".output",
    ".playwright-cli",
    ".worktree",
    "coverage",
    "dist",
    "evals",
    "node_modules",
    "tests",
]);

const EXCLUDED_FILE_NAMES = new Set([
    ".DS_Store",
    "Thumbs.db",
]);

const EXCLUDED_FILE_SUFFIXES = [".log"];

export type LlmlintSkillProjectionResult = {
    sourceFiles: number;
    copied: number;
    unchanged: number;
    removed: number;
    bytes: number;
    manifestSha256: string;
};

type SkillManifest = {
    name?: unknown;
    version?: unknown;
};

/**
 * 把 llmlint package island 的 skill 投影到 system Workspace Template。
 * source 是唯一真相；target 是可重建的运行时资产，不保留 node_modules、用户状态或评测目录。
 */
export async function projectLlmlintSkill(input: {
    sourceRoot: string;
    targetRoot: string;
}): Promise<LlmlintSkillProjectionResult> {
    const sourceRoot = path.resolve(input.sourceRoot);
    const targetRoot = path.resolve(input.targetRoot);
    if (sourceRoot === targetRoot) {
        throw new Error("llmlint skill source 与 target 不能相同");
    }

    await assertDirectory(sourceRoot, "llmlint skill source");
    const sourceFiles = await listRelativeFiles(sourceRoot);
    if (sourceFiles.length === 0) {
        throw new Error(`llmlint skill source 为空: ${sourceRoot}`);
    }
    const sourceManifestPath = path.join(sourceRoot, "package.json");
    if (!sourceFiles.includes("package.json")) {
        throw new Error(`llmlint skill source 缺少 package.json: ${sourceManifestPath}`);
    }
    const sourceManifest = await readSkillManifest(sourceManifestPath);
    if (sourceManifest.name !== "llmlint" || typeof sourceManifest.version !== "string") {
        throw new Error(`llmlint skill package.json manifest 无效: ${sourceManifestPath}`);
    }

    await ensureTargetDirectory(targetRoot);
    const sourceSet = new Set(sourceFiles);
    const targetFiles = await listRelativeFiles(targetRoot);
    let removed = 0;
    for (const relativePath of targetFiles) {
        if (sourceSet.has(relativePath)) {
            continue;
        }
        await rm(path.join(targetRoot, ...relativePath.split("/")), {force: true});
        removed += 1;
    }
    await removeStaleDirectories(targetRoot, sourceSet);

    let copied = 0;
    let unchanged = 0;
    let bytes = 0;
    for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
        const targetPath = path.join(targetRoot, ...relativePath.split("/"));
        const sourceStat = await stat(sourcePath);
        bytes += sourceStat.size;
        if (await sameFile(sourcePath, targetPath)) {
            unchanged += 1;
            continue;
        }
        await mkdir(path.dirname(targetPath), {recursive: true});
        await copyFile(sourcePath, targetPath);
        copied += 1;
    }

    const targetManifestPath = path.join(targetRoot, "package.json");
    const targetManifest = await readSkillManifest(targetManifestPath);
    if (targetManifest.name !== sourceManifest.name || targetManifest.version !== sourceManifest.version) {
        throw new Error(`llmlint skill target manifest 与 source 不一致: ${targetManifestPath}`);
    }
    const manifestSha256 = await hashFile(sourceManifestPath);
    if (manifestSha256 !== await hashFile(targetManifestPath)) {
        throw new Error(`llmlint skill manifest 投影校验失败: ${targetManifestPath}`);
    }
    const projectedFiles = await listRelativeFiles(targetRoot);
    if (projectedFiles.length !== sourceFiles.length || projectedFiles.some((file, index) => file !== sourceFiles[index])) {
        throw new Error(`llmlint skill 投影文件集合校验失败: ${targetRoot}`);
    }
    for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
        const targetPath = path.join(targetRoot, ...relativePath.split("/"));
        if (await hashFile(sourcePath) !== await hashFile(targetPath)) {
            throw new Error(`llmlint skill 投影内容校验失败: ${relativePath}`);
        }
    }

    return {sourceFiles: sourceFiles.length, copied, unchanged, removed, bytes, manifestSha256};
}

async function assertDirectory(root: string, label: string): Promise<void> {
    const entry = await lstat(root).catch((error: unknown) => {
        if (isMissingError(error)) return null;
        throw error;
    });
    if (!entry?.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`${label} 必须是真实目录: ${root}`);
    }
}

async function ensureTargetDirectory(root: string): Promise<void> {
    const entry = await lstat(root).catch((error: unknown) => {
        if (isMissingError(error)) return null;
        throw error;
    });
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
        throw new Error("llmlint skill target 必须是真实目录或不存在: " + root);
    }
    await mkdir(root, {recursive: true});
}

async function listRelativeFiles(root: string, current = ""): Promise<string[]> {
    const absolute = current ? path.join(root, ...current.split("/")) : root;
    const entries = await readdir(absolute, {withFileTypes: true});
    const files: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) {
            throw new Error(`llmlint skill 不允许符号链接: ${path.join(absolute, entry.name)}`);
        }
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
                const relativePath = current ? `${current}/${entry.name}` : entry.name;
                files.push(...await listRelativeFiles(root, relativePath));
            }
            continue;
        }
        if (!entry.isFile()) {
            throw new Error(`llmlint skill 不允许特殊文件: ${path.join(absolute, entry.name)}`);
        }
        if (EXCLUDED_FILE_NAMES.has(entry.name) || isExcludedFile(entry.name)) {
            continue;
        }
        const relativePath = current ? `${current}/${entry.name}` : entry.name;
        files.push(relativePath);
    }
    return files;
}

async function removeStaleDirectories(root: string, sourceFiles: ReadonlySet<string>, current = ""): Promise<void> {
    const absolute = current ? path.join(root, ...current.split("/")) : root;
    const entries = await readdir(absolute, {withFileTypes: true});
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const relativePath = current ? `${current}/${entry.name}` : entry.name;
        const hasSourceDescendant = [...sourceFiles].some((file) => file.startsWith(`${relativePath}/`));
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name) || !hasSourceDescendant) {
            await rm(path.join(root, ...relativePath.split("/")), {recursive: true, force: true});
            continue;
        }
        await removeStaleDirectories(root, sourceFiles, relativePath);
    }
}

function isExcludedFile(fileName: string): boolean {
    return EXCLUDED_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix))
        || fileName === ".env"
        || fileName.startsWith(".env.");
}

async function readSkillManifest(filePath: string): Promise<SkillManifest> {
    return JSON.parse(await readFile(filePath, "utf8")) as SkillManifest;
}

async function sameFile(left: string, right: string): Promise<boolean> {
    const rightExists = await lstat(right).then((entry) => entry.isFile() && !entry.isSymbolicLink(), () => false);
    return rightExists && await hashFile(left) === await hashFile(right);
}

async function hashFile(filePath: string): Promise<string> {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function isMissingError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
