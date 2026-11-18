/**
 * 编辑器往正文里放图片要的宿主能力（docs/specs/workbench/markdown-editing.md 输出 54 到 58）：存放目录与文件名、上传、存放目录里的
 * 图片与按名字找图、缩略图地址。独立的注入键，不放进 `EditorMenus`：控件在没有编辑器区的场景（Lab、组件测试）里也要能挂上它。
 *
 * 三种状态（输出 58）：没有提供（`inject` 得 null，插图卡片只能插网址、粘贴照原来的粘贴）；提供了但没有绑定作品（`bound` 为 false，
 * 列表为空、上传不可用）；绑定了作品。设置与文件服务都由插件入口交进来，这里只放规则，读取设置在调用时，所以设置变了立即生效。
 */

import type {InjectionKey} from "vue";

import {imageDirectory} from "nbook/plugins/editor/shared/contracts";
import type {ImageLocation} from "nbook/plugins/editor/shared/contracts";
import type {FilesService, FindResult} from "nbook/plugins/files/shared/contracts";
import type {UploadResult} from "nbook/plugins/files/shared/upload";

/** 插图卡片一次列出的图片数。 */
export const MEDIA_LIST_LIMIT = 12;

/** 卡片里“图片”指的扩展名（输出 54）；上传只收其中的四种，列出与插入不限于它们。 */
export const IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

/** 卡片列表里的一张图。 */
export interface MediaImage {
    /** 资源地址（`project://插图/a.png`）。 */
    readonly address: string;
    readonly name: string;
    /** 所在目录在作品里的路径，作品根是空串。 */
    readonly directory: string;
}

export type MediaListing =
    | {readonly ok: true; readonly images: readonly MediaImage[]; readonly truncated: boolean}
    | {readonly ok: false; readonly detail: string};

export interface MarkdownMedia {
    /** 窗口有没有绑定作品：没有时上传不可用、列表为空。 */
    readonly bound: boolean;
    /** 一个文件名存进哪个地址（含文件名）；当前文件不在作品里、没有绑定作品时为 null。 */
    destination(currentAddress: string | null, fileName: string): string | null;
    /** 粘贴的图的文件名：“粘贴的图片 年月日-时分秒”加按类型定的扩展名（本机时间，不随界面语言变）；类型不是允许的四种为 null。 */
    pastedName(type: string): string | null;
    /** 选的本机文件存下来的名字：保留原名，JPEG 的扩展名不是 `.jpg`、`.jpeg` 时换成 `.jpg`（例如 `.jfif`）。 */
    localName(file: {readonly name: string; readonly type: string}): string;
    /** 存一张图：重名时加序号、不覆盖。`address` 取自 `destination`。 */
    upload(address: string, body: Blob, signal?: AbortSignal): Promise<UploadResult>;
    /** 存放目录里的图片，名字倒序（粘贴的图按时间命名，所以大致是新的在前）；目录还没有算空。 */
    recent(currentAddress: string | null, options?: {readonly signal?: AbortSignal}): Promise<MediaListing>;
    /** 按名字在整部作品里找图片。 */
    find(query: string, options?: {readonly signal?: AbortSignal}): Promise<MediaListing>;
    /** 缩略图的地址；没有绑定作品时为 null。 */
    thumbnail(address: string): string | null;
}

export const markdownMediaKey: InjectionKey<MarkdownMedia> = Symbol("nbook.markdown/media");

export interface MediaSources {
    readonly files: Pick<FilesService, "list" | "upload" | "rawUrl">;
    /** 远程 `find`（失败只留说明）；没有绑定作品时为 null。 */
    readonly find: ((input: {query: string; limit: number; extensions: readonly string[]}, options: {signal?: AbortSignal}) => Promise<{readonly ok: true; readonly value: FindResult} | {readonly ok: false; readonly detail: string}>) | null;
    readonly bound: boolean;
    readonly settings: {location(): ImageLocation; folder(): string};
    /** 本机时间；测试注入。 */
    readonly now?: () => Date;
}

const EXTENSION_OF_TYPE: Readonly<Record<string, string>> = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"};

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

function directoryOf(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
}

const hasImageExtension = (name: string): boolean => {
    const dot = name.lastIndexOf(".");
    return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
};

export function createMarkdownMedia(sources: MediaSources): MarkdownMedia {
    const now = sources.now ?? (() => new Date());
    const addressIn = (directory: string, name: string): string => `project://${directory === "" ? "" : `${directory}/`}${name}`;
    const destination = (currentAddress: string | null, fileName: string): string | null => {
        if (!sources.bound) return null;
        const directory = imageDirectory(sources.settings.location(), sources.settings.folder(), currentAddress);
        return directory === null ? null : addressIn(directory, fileName);
    };
    return {
        bound: sources.bound,
        destination,
        pastedName: (type) => {
            const extension = EXTENSION_OF_TYPE[type];
            if (extension === undefined) return null;
            const time = now();
            return `粘贴的图片 ${pad(time.getFullYear(), 4)}${pad(time.getMonth() + 1)}${pad(time.getDate())}-${pad(time.getHours())}${pad(time.getMinutes())}${pad(time.getSeconds())}.${extension}`;
        },
        localName: (file) => {
            const dot = file.name.lastIndexOf(".");
            const extension = dot < 0 ? "" : file.name.slice(dot + 1).toLowerCase();
            if (file.type === "image/jpeg" && dot > 0 && extension !== "jpg" && extension !== "jpeg") return `${file.name.slice(0, dot)}.jpg`;
            return file.name;
        },
        upload: (address, body, signal) => sources.files.upload(address, body, {exists: "rename", ...(signal === undefined ? {} : {signal})}),
        recent: async (currentAddress, options) => {
            if (!sources.bound) return {ok: true, images: [], truncated: false};
            const directory = imageDirectory(sources.settings.location(), sources.settings.folder(), currentAddress);
            if (directory === null) return {ok: true, images: [], truncated: false};
            const listed = await sources.files.list(directory === "" ? "project://" : `project://${directory}`, options?.signal === undefined ? undefined : {signal: options.signal});
            // 存放目录还没建出来（第一次粘贴时才建）不是错误。
            if (!listed.ok) return listed.code === "not-found" ? {ok: true, images: [], truncated: false} : {ok: false, detail: listed.detail};
            const names = listed.value.entries.filter((entry) => entry.kind === "file" && hasImageExtension(entry.name)).map((entry) => entry.name).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
            return {ok: true, images: names.slice(0, MEDIA_LIST_LIMIT).map((name) => ({address: addressIn(directory, name), name, directory})), truncated: names.length > MEDIA_LIST_LIMIT};
        },
        find: async (query, options) => {
            if (!sources.bound || sources.find === null) return {ok: true, images: [], truncated: false};
            const found = await sources.find({query, limit: MEDIA_LIST_LIMIT, extensions: IMAGE_EXTENSIONS}, options?.signal === undefined ? {} : {signal: options.signal});
            if (!found.ok) return {ok: false, detail: found.detail};
            return {ok: true, images: found.value.items.map((item) => ({address: `project://${item.path}`, name: item.name, directory: directoryOf(item.path)})), truncated: found.value.truncated};
        },
        thumbnail: (address) => (sources.bound ? sources.files.rawUrl(address) : null),
    };
}
