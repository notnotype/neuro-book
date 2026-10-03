import {createHash} from "node:crypto";
import type {BigIntStats} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
    assertRealPathContained,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import type {ImageVariantSource} from "nbook/server/media/image-variant-contract";
import {imageMimeType, type RasterImageMimeType} from "nbook/server/media/raster-image";
import {
    resolveProjectWorkspaceRoot,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {normalizeProjectCoverPath} from "nbook/shared/project-cover";

const PROJECT_COVER_MAX_BYTES = 20 * 1024 * 1024;

type ProjectCoverErrorCode = "PROJECT_COVER_UNAVAILABLE" | "PROJECT_COVER_CORRUPT" | "PROJECT_COVER_TOO_LARGE";

/** Project 封面读取失败；message 不携带物理路径，可直接映射到 HTTP。 */
export class ProjectCoverError extends Error {
    /** 建立稳定的封面读取错误。 */
    constructor(readonly code: ProjectCoverErrorCode) {
        const messages: Record<ProjectCoverErrorCode, string> = {
            PROJECT_COVER_UNAVAILABLE: "Project 封面不可用",
            PROJECT_COVER_CORRUPT: "Project 封面内容与文件类型不一致",
            PROJECT_COVER_TOO_LARGE: "Project 封面超过 20MB 大小限制",
        };
        super(messages[code]);
        this.name = "ProjectCoverError";
    }
}

export type ProjectCoverFile = Readonly<{
    bytes: Buffer;
    mimeType: Exclude<RasterImageMimeType, "image/gif">;
    etag: string;
}>;

/** manifest 与真实文件身份已经授权的封面 source capability。 */
export type AuthorizedProjectCover = Readonly<{
    mimeType: Exclude<RasterImageMimeType, "image/gif">;
    source: ImageVariantSource;
}>;

/**
 * 授权 manifest 指向的封面，并取得不读取文件内容的稳定 revision。
 *
 * source.read 会再次复核同一文件 identity，避免授权后替换把新 bytes 写入旧缓存键。
 */
export async function authorizeProjectCover(
    workspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
    manifestCoverPath: string,
): Promise<AuthorizedProjectCover> {
    const coverPath = normalizeProjectCoverPath(manifestCoverPath);
    if (!coverPath) {
        throw new ProjectCoverError("PROJECT_COVER_UNAVAILABLE");
    }
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, ref);
    const target = resolveContainedFilePath(projectRoot, coverPath);
    try {
        await assertRealPathContained(workspaceRoot, projectRoot);
        await assertRealPathContained(projectRoot, target);
        const entryStat = await fs.lstat(target, {bigint: true});
        if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
            throw new ProjectCoverError("PROJECT_COVER_UNAVAILABLE");
        }
        if (entryStat.size > BigInt(PROJECT_COVER_MAX_BYTES)) {
            throw new ProjectCoverError("PROJECT_COVER_TOO_LARGE");
        }
        const mimeType = mimeTypeForPath(coverPath);
        const revision = fileFingerprint(entryStat);
        return Object.freeze({
            mimeType,
            source: Object.freeze({
                identity: `project-cover:${ref.projectRoot}:${coverPath}`,
                revision,
                read: () => readAuthorizedCover(target, coverPath, revision),
            }),
        });
    } catch (error) {
        if (error instanceof ProjectCoverError) {
            throw error;
        }
        throw new ProjectCoverError("PROJECT_COVER_UNAVAILABLE");
    }
}

/**
 * 读取 manifest 已授权的 Project 封面。
 *
 * 调用方只能传入 manifest 中的相对路径；本函数再次验证路径、Project root 与封面
 * realpath，拒绝链接、目录、超限文件以及扩展名和魔数不一致的内容。
 */
export async function readProjectCover(
    workspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
    manifestCoverPath: string,
): Promise<ProjectCoverFile> {
    const authorized = await authorizeProjectCover(workspaceRoot, ref, manifestCoverPath);
    const bytes = Buffer.from(await authorized.source.read());
    return Object.freeze({
        bytes,
        mimeType: authorized.mimeType,
        etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
    });
}

/** 从已授权文件句柄稳定读取 bytes，并复核内容类型和读取前后 identity。 */
async function readAuthorizedCover(
    target: AbsoluteFsPath,
    coverPath: string,
    expectedRevision: string,
): Promise<Uint8Array> {
    try {
        const handle = await fs.open(target, "r");
        try {
            const before = await handle.stat({bigint: true});
            if (!before.isFile() || fileFingerprint(before) !== expectedRevision) {
                throw new ProjectCoverError("PROJECT_COVER_UNAVAILABLE");
            }
            if (before.size > BigInt(PROJECT_COVER_MAX_BYTES)) {
                throw new ProjectCoverError("PROJECT_COVER_TOO_LARGE");
            }
            const bytes = await handle.readFile();
            const after = await handle.stat({bigint: true});
            if (fileFingerprint(after) !== expectedRevision) {
                throw new ProjectCoverError("PROJECT_COVER_UNAVAILABLE");
            }
            const mimeType = imageMimeType(bytes);
            if (!mimeType || mimeType === "image/gif" || mimeType !== mimeTypeForPath(coverPath)) {
                throw new ProjectCoverError("PROJECT_COVER_CORRUPT");
            }
            return bytes;
        } finally {
            await handle.close();
        }
    } catch (error) {
        if (error instanceof ProjectCoverError) {
            throw error;
        }
        throw new ProjectCoverError("PROJECT_COVER_UNAVAILABLE");
    }
}

/** 使用 inode、大小和纳秒级修改时间形成稳定 source revision。 */
function fileFingerprint(entryStat: BigIntStats): string {
    return [
        entryStat.dev,
        entryStat.ino,
        entryStat.size,
        entryStat.mtimeNs,
        entryStat.ctimeNs,
    ].join(":");
}

/** 按已经校验的扩展名返回预期 MIME。 */
function mimeTypeForPath(coverPath: string): Exclude<RasterImageMimeType, "image/gif"> {
    const extension = path.posix.extname(coverPath).toLocaleLowerCase("en-US");
    if (extension === ".png") {
        return "image/png";
    }
    if (extension === ".webp") {
        return "image/webp";
    }
    return "image/jpeg";
}
