/**
 * 编辑器粘贴图片要的宿主能力（`MarkdownViewImages`，docs/specs/workbench/markdown-editing.md 输出 55、58）：把 `media.ts` 的存放与上传
 * 接成 nb-markdown 的粘贴插件认的形状，并把失败换成给用户的通知。
 */

import type {ImageFailure, ImageUploadResult, MarkdownViewImages} from "@notnotype/nb-markdown/editor";

import type {MarkdownMedia} from "./media";

/** 一条通知：编辑器目录里 `menus.<key>` 的文字，`params` 填进 `{{name}}` 这类占位。 */
export interface ImageNotice {
    readonly key: string;
    readonly params?: Readonly<Record<string, string>>;
}

/** 失败时图可能已经写进作品的码：结果未知、断开、调用方取消（请求体发完之后取消同样可能已经写下）。 */
export const maybeStored = (code: string): boolean => code === "unknown-outcome" || code === "network" || code === "cancelled";

/**
 * 一张图的失败给用户看什么。按码分：粘贴插件自己的码（`not-allowed-here`、`not-inserted`）、客户端的码（`unavailable`、`cancelled`、
 * `network`）与服务端的码表（docs/specs/workspace/files.md 的“写入图片”）。`stored` 为真的（结果未知、取消、断开）说明图可能已经在作品里。
 */
export function imageFailureNotice(failure: ImageFailure): ImageNotice {
    const name = {name: failure.file};
    switch (failure.code) {
        case "not-allowed-here":
            return {key: "imageNotAllowedHere"};
        case "unavailable":
            return {key: "imageUnavailable"};
        case "not-inserted":
            return {key: "imageNotInserted", params: {...name, address: failure.detail}};
        case "too-large":
            return {key: "imageTooLarge", params: name};
        case "unsupported-type":
        case "extension-mismatch":
            return {key: "imageUnsupported", params: name};
        case "invalid-address":
            return {key: "imageNameInvalid", params: name};
        case "permission-denied":
        case "not-a-directory":
        case "protected-path":
        case "outside-root":
        case "conflict":
            return {key: "imageFolderDenied", params: name};
        default:
            return failure.stored ? {key: "imageMaybeStored", params: name} : {key: "imageFailed", params: {...name, detail: failure.detail}};
    }
}

/**
 * `current` 取此刻正在编辑的文件的地址（挂载换了文件、改了名也对）；`notify` 是编辑器区的通知。图的说明留空：粘贴的图的文件名是时间，
 * 当说明没有意义。
 */
export function createViewImages(media: MarkdownMedia, current: () => string | null, notify: (key: string, params?: Readonly<Record<string, string>>) => void): MarkdownViewImages {
    return {
        upload: async (file, signal): Promise<ImageUploadResult> => {
            if (!media.bound) return {ok: false, code: "unavailable", detail: "没有打开作品，不能保存图片"};
            // 在传之前按浏览器给的类型判：不是 PNG、JPEG、GIF、WebP 的不上传。
            const name = media.pastedName(file.type);
            if (name === null) return {ok: false, code: "unsupported-type", detail: `不支持的图片类型 ${file.type === "" ? "（未知）" : file.type}`};
            const address = media.destination(current(), name);
            if (address === null) return {ok: false, code: "unavailable", detail: "当前文件不在作品里，不能保存图片"};
            const result = await media.upload(address, file, signal);
            return result.ok ? {ok: true, address: result.address, alt: ""} : {ok: false, code: result.code, detail: result.detail, stored: maybeStored(result.code)};
        },
        failed: (failure) => {
            const notice = imageFailureNotice(failure);
            notify(notice.key, notice.params);
        },
    };
}
