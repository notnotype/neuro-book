import path from "node:path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {uploadWorkspaceProjectFiles} from "nbook/server/workspace-files/workspace-upload";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";
import {recordUploadedFiles, USER_LOCAL_ACTOR} from "nbook/server/workspace-history/tracked-workspace-files";
import {imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";

/**
 * 生图产物落盘。
 *
 * 图片统一写入 Project Workspace 的 assets/illustrations/ 目录，文件名带时间戳 + jobId 前缀
 * 保证唯一（上传通道对已存在文件是 skip 语义，唯一文件名规避该分支）。
 * 写入走 uploadWorkspaceProjectFiles（含路径归一与越界防护），写后记账 + 文件索引失效。
 */

export const ILLUSTRATIONS_RELATIVE_DIR = "assets/illustrations";

/** MIME → 扩展名。写盘前已通过魔数校验，未知类型不会走到这里。 */
const EXTENSION_BY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};

export class ComfyUiIllustrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ComfyUiIllustrationError";
    }
}

/** 时间戳目录内文件名段：20260727-153001 形态（本地时间）。 */
function timestampSegment(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 把一次任务的全部输出图片写入项目 assets/illustrations/，返回 project root 相对路径列表。
 * 任一图片魔数校验失败（非 PNG/JPEG/GIF/WebP）都会整体拒绝。
 */
export async function saveIllustrationImages(input: {
    projectPath: string;
    jobId: string;
    images: Array<{bytes: Buffer}>;
}): Promise<string[]> {
    if (input.images.length === 0) {
        return [];
    }
    const files = input.images.map((image, index) => {
        const mime = imageMimeType(image.bytes);
        if (!mime) {
            throw new ComfyUiIllustrationError("ComfyUI 返回的数据不是可识别的图片格式");
        }
        const extension = EXTENSION_BY_MIME[mime] ?? "png";
        const fileName = `${timestampSegment(new Date())}-${input.jobId.slice(0, 8)}-${String(index + 1)}.${extension}`;
        return {
            fileName,
            relativePath: path.posix.join(ILLUSTRATIONS_RELATIVE_DIR, fileName),
            data: image.bytes,
        };
    });
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectPath: input.projectPath});
    const result = await uploadWorkspaceProjectFiles(target.root, files);
    await recordUploadedFiles({target, files: result.files, actor: USER_LOCAL_ACTOR});
    invalidateProjectWorkspaceIndexAfterMutation(target);
    return files.map((file) => file.relativePath);
}
