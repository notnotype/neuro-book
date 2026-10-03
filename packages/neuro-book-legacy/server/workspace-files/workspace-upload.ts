import fs from "node:fs/promises";
import path from "node:path";
import {unzipSync} from "fflate";
import {
    pathExists,
    resolveWorkspacePath,
} from "nbook/server/workspace-files/workspace-files";
import {assertRealParentContained} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {assertWorkspaceStorageBoundary} from "nbook/server/workspace-files/workspace-storage-boundary";

export const SINGLE_FILE_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
export const PROJECT_UPLOAD_LIMIT_BYTES = 500 * 1024 * 1024;

export type WorkspaceUploadFile = {
    fileName: string;
    data: Buffer | Uint8Array;
    relativePath?: string;
};

export type WorkspaceUploadResult = {
    written: number;
    skipped: number;
    totalBytes: number;
    files: WorkspaceUploadedFileResult[];
};

export type WorkspaceUploadedFileResult = {
    path: string;
    size: number;
    action: "written" | "skipped";
};

export class WorkspaceUploadError extends Error {
    constructor(message: string, readonly statusCode = 400) {
        super(message);
        this.name = "WorkspaceUploadError";
    }
}

/**
 * 上传单个文件到当前挂载根的 upload/ 目录。已有文件跳过。
 */
export async function uploadWorkspaceFile(target: WorkspaceFileTarget, file: WorkspaceUploadFile): Promise<WorkspaceUploadResult> {
    const size = byteLength(file.data);
    assertByteLimit(size, SINGLE_FILE_UPLOAD_LIMIT_BYTES, "单文件上传");
    return writeWorkspaceUploads(target, [{
        relativePath: path.posix.join("upload", sanitizeFileName(file.fileName)),
        data: file.data,
    }], PROJECT_UPLOAD_LIMIT_BYTES);
}

/**
 * 上传 Project 文件集合，路径由浏览器目录上传的相对路径提供。
 */
export async function uploadWorkspaceProjectFiles(target: WorkspaceFileTarget, files: WorkspaceUploadFile[]): Promise<WorkspaceUploadResult> {
    const entries = files.map((file) => ({
        relativePath: file.relativePath?.trim() || file.fileName,
        data: file.data,
    }));
    return writeWorkspaceUploads(target, entries, PROJECT_UPLOAD_LIMIT_BYTES);
}

/**
 * 解包 zip 并上传到当前挂载根。zip 内路径原样保留，已有文件跳过。
 */
export async function uploadWorkspaceProjectZip(target: WorkspaceFileTarget, zipFile: WorkspaceUploadFile): Promise<WorkspaceUploadResult> {
    const zipSize = byteLength(zipFile.data);
    assertByteLimit(zipSize, PROJECT_UPLOAD_LIMIT_BYTES, "Project 压缩包上传");

    let unzipped: Record<string, Uint8Array>;
    try {
        unzipped = unzipSync(toUint8Array(zipFile.data));
    } catch (error) {
        throw new WorkspaceUploadError(`无法解压 zip 文件: ${error instanceof Error ? error.message : String(error)}`);
    }

    const entries = Object.entries(unzipped)
        .filter(([entryPath]) => !isDirectoryEntry(entryPath))
        .map(([relativePath, data]) => ({relativePath, data}));
    return writeWorkspaceUploads(target, entries, PROJECT_UPLOAD_LIMIT_BYTES);
}

async function writeWorkspaceUploads(
    target: WorkspaceFileTarget,
    entries: Array<{relativePath: string; data: Buffer | Uint8Array}>,
    limitBytes: number,
): Promise<WorkspaceUploadResult> {
    let totalBytes = 0;
    const normalizedEntries: Array<{relativePath: string; data: Buffer | Uint8Array; size: number}> = [];
    for (const entry of entries) {
        const size = byteLength(entry.data);
        totalBytes += size;
        normalizedEntries.push({
            relativePath: normalizeUploadPath(entry.relativePath),
            data: entry.data,
            size,
        });
    }
    assertByteLimit(totalBytes, limitBytes, "Project 上传");
    // Storage 边界在写盘前整批校验：命中 Storage 的一次上传不留下半批普通文件。
    for (const entry of normalizedEntries) {
        await assertWorkspaceStorageBoundary(target, entry.relativePath, "mutation");
    }

    const files: WorkspaceUploadedFileResult[] = [];
    let written = 0;
    let skipped = 0;

    for (const entry of normalizedEntries) {
        const absolutePath = resolveWorkspacePath(target.root, entry.relativePath);
        await assertRealParentContained(target.root, absolutePath);
        if (await pathExists(absolutePath)) {
            skipped += 1;
            files.push({path: entry.relativePath, size: entry.size, action: "skipped"});
            continue;
        }

        await fs.mkdir(path.dirname(absolutePath), {recursive: true});
        await fs.writeFile(absolutePath, entry.data);
        written += 1;
        files.push({path: entry.relativePath, size: entry.size, action: "written"});
    }

    return {
        written,
        skipped,
        totalBytes,
        files,
    };
}

function normalizeUploadPath(inputPath: string): string {
    const pathWithForwardSlashes = inputPath.replace(/\\/g, "/").trim();
    if (path.posix.isAbsolute(pathWithForwardSlashes)) {
        throw new WorkspaceUploadError(`不允许上传绝对路径: ${inputPath}`);
    }
    const normalizedPath = inputPath
        .replace(/\\/g, "/")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+$/g, "");
    if (!normalizedPath || normalizedPath === ".") {
        throw new WorkspaceUploadError("上传路径不能为空");
    }

    const segments = normalizedPath.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new WorkspaceUploadError(`上传路径包含非法片段: ${inputPath}`);
    }
    return segments.join("/");
}

function sanitizeFileName(fileName: string): string {
    const normalizedName = path.basename(fileName.replace(/\\/g, "/")).trim();
    if (!normalizedName || normalizedName === "." || normalizedName === "..") {
        throw new WorkspaceUploadError("上传文件名不能为空");
    }
    return normalizedName;
}

function isDirectoryEntry(entryPath: string): boolean {
    return entryPath.endsWith("/") || entryPath.endsWith("\\");
}

function byteLength(data: Buffer | Uint8Array): number {
    return data.byteLength;
}

function toUint8Array(data: Buffer | Uint8Array): Uint8Array {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function assertByteLimit(size: number, limit: number, label: string): void {
    if (size > limit) {
        throw new WorkspaceUploadError(`${label}超过大小限制: ${formatBytes(size)} / ${formatBytes(limit)}`, 413);
    }
}

function formatBytes(bytes: number): string {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`;
}
