/**
 * canon 里显示图片的夹具共用：几张内联的样本图（作品内路径到 data URL），注入给 `CanonImage`；`ImageInput` 的候选与上传是内存里的
 * 一份（上传等一拍以后成功，“慢”的场景一直在传）。在夹具的 setup 里调用。
 */
import {reactive} from "vue";

import {IMAGE_CANDIDATES, provideCanonImageUrl, provideImagePicking} from "nbook/plugins/canon/web/images";
import type {ImageCandidate, ImagePicking} from "nbook/plugins/canon/web/images";

const swatch = (from: string, to: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="120" height="160" fill="url(#g)"/><circle cx="60" cy="58" r="26" fill="#fff" fill-opacity="0.55"/><rect x="26" y="96" width="68" height="64" rx="30" fill="#fff" fill-opacity="0.45"/></svg>`)}`;

/** 样本图：作品内路径 → 地址。 */
export const SAMPLE_IMAGES: Readonly<Record<string, string>> = {
    "插图/星瑕-立绘.png": swatch("#c9d6f2", "#6f7fb3"),
    "插图/星瑕-学院制服.png": swatch("#e8d9c4", "#9b7b54"),
    "插图/星瑕-便服.png": swatch("#d6eadb", "#5f8f6c"),
    "插图/星瑾-立绘.png": swatch("#f0d3dc", "#a35d74"),
};

export function provideSampleImages(): void {
    provideCanonImageUrl((path) => SAMPLE_IMAGES[path] ?? null);
}

/** 候选与上传的样本：`mode` 为 `uploading` 时一直在传。 */
export function provideSamplePicking(mode: "ready" | "uploading" | "empty" = "ready"): void {
    const candidates: ImageCandidate[] = mode === "empty" ? [] : Object.keys(SAMPLE_IMAGES).map((path) => ({path, name: path.slice(path.indexOf("/") + 1), url: SAMPLE_IMAGES[path]!}));
    const picking: ImagePicking = reactive({
        available: true,
        candidates,
        uploading: mode === "uploading",
        reason: "",
        notice: "",
        url: (path: string) => SAMPLE_IMAGES[path] ?? null,
        browse: () => undefined,
        upload: async (file: File) => {
            state.uploading = true;
            await new Promise((resolve) => setTimeout(resolve, 600));
            state.uploading = false;
            const path = `插图/${file.name}`;
            state.candidates = [{path, name: file.name, url: null}, ...(state.candidates ?? [])].slice(0, IMAGE_CANDIDATES);
            return path;
        },
        cancel: () => {
            state.uploading = false;
        },
    });
    const state = picking as {-readonly [K in keyof ImagePicking]: ImagePicking[K]};
    provideImagePicking(picking);
}
