/**
 * 设定里的图片（docs/specs/canon/author-ui.md 输出 53、canon/components.md 输出 15）：作品内路径换成取图地址、列出图片文件夹里
 * 的候选、上传。读写都经文件插件的服务（`filesKey`），类型、大小的规则与失败码都是它的；存放的目录是作品设置里的图片文件夹
 * （编辑器插件的 `imageFolder`，经 `normalizeImageFolder` 收成合规的目录），条目不是作品里的文件，没有“所在目录”。
 *
 * 候选按名字倒序取前几张（同章节插图的候选，`markdown/web/media.ts`）：目录列表里没有修改时间。章节里粘贴的图名字带日期，倒序
 * 大致是新的在前；这里上传的图保留原来的文件名，不一定排在前面，所以本页刚传的另外插在最前。
 */

import {inject, provide, reactive} from "vue";
import type {InjectionKey} from "vue";

import type {Text} from "@notnotype/nb-ui/text";

import {normalizeImageFolder} from "nbook/plugins/editor/shared/contracts";
import {UPLOAD_EXTENSIONS, UPLOAD_MAX_BYTES} from "nbook/plugins/files/shared/contracts";
import type {FilesService} from "nbook/plugins/files/shared/contracts";

import {canonText} from "../shared/text";

/** 候选至多列几张。 */
export const IMAGE_CANDIDATES = 12;
/** 选文件框只列这几种（文件服务收的四种）。 */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

export interface ImageCandidate {
    /** 作品内路径，存进图片字段的值。 */
    readonly path: string;
    readonly name: string;
    /** 缩略图的取图地址。 */
    readonly url: string | null;
}

/** 上传没成的四种（输出 53）：类型或大小不合；网络失败或结果不明（图可能已经写进作品）；作者自己取消了（同样可能已经写进去）；别的。 */
export type UploadFailure = {readonly kind: "rejected" | "unknown" | "cancelled" | "other"; readonly reason: Text};

export interface CanonImages {
    /** 窗口里有文件服务、绑定了作品：有候选与上传。没有时只剩手填路径。 */
    readonly available: boolean;
    /** 作品内路径的取图地址；没有文件服务或路径不在作品里时为 null。 */
    url(path: string): string | null;
    recent(signal?: AbortSignal): Promise<{readonly ok: true; readonly images: readonly ImageCandidate[]} | {readonly ok: false; readonly reason: Text}>;
    upload(file: File, signal?: AbortSignal): Promise<{readonly ok: true; readonly path: string} | ({readonly ok: false} & UploadFailure)>;
}

const extensionOf = (name: string): string => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
const isImageName = (name: string): boolean => Object.hasOwn(UPLOAD_EXTENSIONS, extensionOf(name));

/** `files` 为 null（窗口里没有文件服务）时什么都没有；`folder` 每次现读（作者在设置里改了就跟着变）。 */
export function createCanonImages(files: FilesService | null, folder: () => string): CanonImages {
    const directory = (): string => normalizeImageFolder(folder());
    const addressOf = (path: string): string => `project://${path}`;
    const available = files !== null && files.rawUrl("project://") !== null;
    return {
        available,
        url: (path) => (files === null || path === "" ? null : files.rawUrl(addressOf(path))),
        recent: async (signal) => {
            if (files === null) return {ok: true, images: []};
            const dir = directory();
            const listed = await files.list(addressOf(dir), signal === undefined ? undefined : {signal});
            // 图片文件夹还没建出来（第一次上传时才建）不是错误。
            if (!listed.ok) return listed.code === "not-found" ? {ok: true, images: []} : {ok: false, reason: canonText("images.listFailed")};
            const names = listed.value.entries.filter((entry) => entry.kind === "file" && isImageName(entry.name)).map((entry) => entry.name).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
            return {ok: true, images: names.slice(0, IMAGE_CANDIDATES).map((name) => ({path: `${dir}/${name}`, name, url: files.rawUrl(addressOf(`${dir}/${name}`))}))};
        },
        upload: async (file, signal) => {
            if (files === null) return {ok: false, kind: "other", reason: canonText("images.unavailable")};
            // 先在本地拦一遍类型与大小：太大的文件到不了路由，页面拿不到原因（同主题素材的做法）。
            if (!isImageName(file.name) || file.size > UPLOAD_MAX_BYTES) return {ok: false, kind: "rejected", reason: canonText("images.rejected")};
            const result = await files.upload(addressOf(`${directory()}/${file.name}`), file, {exists: "rename", ...(signal === undefined ? {} : {signal})});
            if (result.ok) return {ok: true, path: result.address.slice("project://".length)};
            if (result.code === "too-large" || result.code === "unsupported-type" || result.code === "extension-mismatch") return {ok: false, kind: "rejected", reason: canonText("images.rejected")};
            if (result.code === "cancelled") return {ok: false, kind: "cancelled", reason: canonText("images.cancelled")};
            if (result.code === "network" || result.code === "unknown-outcome") return {ok: false, kind: "unknown", reason: canonText("images.unknown")};
            return {ok: false, kind: "other", reason: canonText("images.failed", {detail: result.detail})};
        },
    };
}

/**
 * 一处选图片的地方要的东西（输出 53），由宿主一层给（条目页给确认条、元素对话框与就地改共用一份：同一时间只有一处在填）：候选、
 * 上传中、原因与几个动作。`ImageInput` 只收它、发动作，不自己读写。
 */
export interface ImagePicking {
    /** 有文件服务：有候选与上传。 */
    readonly available: boolean;
    /** 列出来的候选；还没列为 null。 */
    readonly candidates: readonly ImageCandidate[] | null;
    readonly uploading: boolean;
    /** 列候选或上传失败的原因；没有时为空。 */
    readonly reason: string;
    /** 不算失败的一句（作者取消了上传、图可能已经写进作品）；没有时为空。 */
    readonly notice: string;
    url(path: string): string | null;
    /** 一处选图片的地方开始用（挂上时）：清掉上一次的原因，重列候选（别处可能加了图）。 */
    browse(): void;
    /** 上传一个文件；成功时给出存下的作品内路径（重名时是实际的名字）。 */
    upload(file: File): Promise<string | null>;
    /** 取消正在上传的（图可能已经写进作品，留在那里）。 */
    cancel(): void;
}

/** 条目页的那一份：`resolve` 把原因的文字换成当前语言。 */
export function createImagePicking(images: CanonImages, resolve: (text: Text) => string): ImagePicking {
    let uploadRun: AbortController | null = null;
    let listRun: AbortController | null = null;
    /** 重列候选；原因留着（上传结果不明以后重列，那句“看一下图片文件夹”还要在）。 */
    const list = (): void => {
        listRun?.abort();
        const run = new AbortController();
        listRun = run;
        void images.recent(run.signal).then((listed) => {
            if (listRun !== run) return;
            listRun = null;
            if (listed.ok) state.candidates = mergeRecent(listed.images);
            else state.reason = resolve(listed.reason);
        });
    };
    /** 本页刚传的排在最前：它们保留原来的文件名，按名字倒序不一定在前面。 */
    const uploaded: ImageCandidate[] = [];
    const mergeRecent = (listed: readonly ImageCandidate[]): readonly ImageCandidate[] => [...uploaded, ...listed.filter((item) => !uploaded.some((mine) => mine.path === item.path))].slice(0, IMAGE_CANDIDATES);
    const picking: ImagePicking = reactive({
        available: images.available,
        candidates: null as readonly ImageCandidate[] | null,
        uploading: false,
        reason: "",
        notice: "",
        url: (path: string) => images.url(path),
        browse: () => {
            state.reason = "";
            state.notice = "";
            list();
        },
        upload: async (file: File) => {
            uploadRun?.abort();
            const run = new AbortController();
            uploadRun = run;
            state.uploading = true;
            state.reason = "";
            state.notice = "";
            const result = await images.upload(file, run.signal);
            if (uploadRun !== run) return null;
            uploadRun = null;
            state.uploading = false;
            if (!result.ok) {
                if (result.kind === "cancelled") state.notice = resolve(result.reason);
                else state.reason = resolve(result.reason);
                // 图可能已经写进作品：重列一次，写进去了的话它会出现在候选里。
                if (result.kind === "cancelled" || result.kind === "unknown") list();
                return null;
            }
            const candidate = {path: result.path, name: result.path.slice(result.path.lastIndexOf("/") + 1), url: images.url(result.path)};
            uploaded.splice(0, uploaded.length, ...[candidate, ...uploaded.filter((item) => item.path !== result.path)].slice(0, IMAGE_CANDIDATES));
            state.candidates = mergeRecent(state.candidates ?? []);
            return result.path;
        },
        cancel: () => {
            uploadRun?.abort();
        },
    });
    const state = picking as {-readonly [K in keyof ImagePicking]: ImagePicking[K]};
    return picking;
}

/** 作品内路径换成取图地址的函数：条目页注入（`CanonImage` 用），Lab 换成样本图。没有注入时没有地址，画“图片找不到”。 */
export const CANON_IMAGE_URL: InjectionKey<(path: string) => string | null> = Symbol("canon.image-url");

export function provideCanonImageUrl(url: (path: string) => string | null): void {
    provide(CANON_IMAGE_URL, url);
}

export function useCanonImageUrl(): (path: string) => string | null {
    return inject(CANON_IMAGE_URL, () => null);
}

/**
 * 选图片的地方用的那一份候选与上传：条目页注入（确认条、元素对话框、就地改里的 `ImageInput` 隔着几层组件，不一层层传），Lab 注入
 * 样本。没有注入时 `ImageInput` 只有手填路径。
 */
export const CANON_IMAGE_PICKING: InjectionKey<ImagePicking> = Symbol("canon.image-picking");

export function provideImagePicking(picking: ImagePicking): void {
    provide(CANON_IMAGE_PICKING, picking);
}

export function useImagePicking(): ImagePicking | null {
    return inject(CANON_IMAGE_PICKING, null);
}
