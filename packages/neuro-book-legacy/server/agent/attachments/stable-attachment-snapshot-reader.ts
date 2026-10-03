import {open, realpath, stat} from "node:fs/promises";
import {resolve} from "node:path";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {absoluteFsPath, relativeFilePathInside, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

type FileIdentity = {
    dev: bigint;
    ino: bigint;
    birthtimeNs: bigint;
};

/**
 * 从一个稳定的普通文件句柄读取附件快照。
 *
 * realpath 只负责解析用户给出的路径；真正读取与读取后的稳定性校验始终使用同一个
 * FileHandle，避免路径在授权和读取之间被替换。
 */
export class StableAttachmentSnapshotReader {
    constructor(
        private readonly attachmentRoot: AbsoluteFsPath,
        private readonly maxBytes: number,
    ) {}

    /** 读取最多 maxBytes 的稳定快照；源文件身份或内容元数据变化时 fail closed。 */
    async read(sourcePath: AbsoluteFsPath): Promise<Uint8Array> {
        try {
            const canonicalPath = absoluteFsPath(await realpath(sourcePath));
            await this.assertOutsideAttachmentStore(canonicalPath);
            const pathStat = await stat(canonicalPath, {bigint: true});
            if (!pathStat.isFile()) {
                throw new AttachmentError("invalid_input", "图片源必须是普通文件。");
            }
            if (pathStat.size > BigInt(this.maxBytes)) {
                throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
            }

            const handle = await open(canonicalPath, "r");
            try {
                const before = await handle.stat({bigint: true});
                if (!before.isFile() || !sameIdentity(identity(pathStat), identity(before))) {
                    throw new AttachmentError("invalid_input", "图片源在打开前发生变化，请重试。");
                }

                const buffer = Buffer.allocUnsafe(this.maxBytes + 1);
                let offset = 0;
                while (offset < buffer.byteLength) {
                    const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
                    if (result.bytesRead === 0) {
                        break;
                    }
                    offset += result.bytesRead;
                }
                if (offset > this.maxBytes) {
                    throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
                }

                const after = await handle.stat({bigint: true});
                if (!sameIdentity(identity(before), identity(after))
                    || before.size !== after.size
                    || before.mtimeNs !== after.mtimeNs
                    || before.ctimeNs !== after.ctimeNs) {
                    throw new AttachmentError("invalid_input", "图片源在读取期间发生变化，请重试。");
                }
                return buffer.subarray(0, offset);
            } finally {
                await handle.close();
            }
        } catch (error) {
            if (error instanceof AttachmentError) {
                throw error;
            }
            if (nodeErrorCode(error) === "ENOENT") {
                throw new AttachmentError("not_found", "图片源文件不存在。", {cause: error});
            }
            throw new AttachmentError("invalid_input", "图片源文件无法读取。", {cause: error});
        }
    }

    /** canonical source 仍不得位于 Attachment Store 内。 */
    private async assertOutsideAttachmentStore(sourcePath: AbsoluteFsPath): Promise<void> {
        const attachmentRoot = await realpath(this.attachmentRoot)
            .then(absoluteFsPath)
            .catch(() => absoluteFsPath(resolve(this.attachmentRoot)));
        if (relativeFilePathInside(attachmentRoot, sourcePath) !== null) {
            throw new AttachmentError("invalid_input", "不能从 Attachment Store 自身创建快照。");
        }
    }
}

/** 提取 Windows/POSIX 都可由 Node bigint Stats 提供的文件身份。 */
function identity(value: {dev: bigint; ino: bigint; birthtimeNs: bigint}): FileIdentity {
    return {
        dev: value.dev,
        ino: value.ino,
        birthtimeNs: value.birthtimeNs,
    };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.birthtimeNs === right.birthtimeNs;
}

function nodeErrorCode(error: unknown): string | undefined {
    return error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
}
