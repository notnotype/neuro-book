/**
 * 把一个图片背景算成能画的样子（docs/specs/ui/backgrounds.md 输出 5、8 与“时序与寿命”）：先加载，加载好才换，旧图留到新图好；
 * 遮罩按下限抬高，设置不改写。
 */

import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import type {ComputedRef, Ref} from "vue";

import {luminance, scrimFloor, WORST_CASE_EXTREMES} from "./background-legibility";
import type {Rgb} from "./background-legibility";
import {readDocumentColors, useDocumentThemeVersion, usePrefersSolid} from "./document-colors";

export interface BackgroundImageInput {
    readonly url: string;
    readonly fit: "cover" | "contain" | "repeat";
    readonly blur: boolean;
    readonly scrim: number;
}

export interface BackgroundImageState {
    /** 能画了：图加载好、系统偏好允许。 */
    readonly active: ComputedRef<{readonly url: string; readonly fit: BackgroundImageInput["fit"]; readonly blur: boolean; readonly alpha: number; readonly floor: number} | null>;
    /** 这张图加载失败（输出“失败与恢复”）。 */
    readonly failed: Readonly<Ref<boolean>>;
}

type Extremes = Readonly<{lightest: Rgb; darkest: Rgb}>;

/** 同一张图只加载一次。 */
const loads = new Map<string, Promise<HTMLImageElement>>();

function load(url: string): Promise<HTMLImageElement> {
    const known = loads.get(url);
    if (known !== undefined) return known;
    const image = new Image();
    const loading = new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`背景图片加载失败：${url}`));
    });
    image.src = url;
    // 失败的不留：文件放回来后下次还要能加载。
    loading.catch(() => loads.delete(url));
    loads.set(url, loading);
    return loading;
}

/**
 * 这张图模糊之后最亮、最暗的地方：缩到每格约等于模糊半径的小图再找。不模糊时细节全在，屏幕上的放大倍数也不确定，直接按最坏的图；量不了也是。
 * 模糊的半径是 14 像素：铺满时图被缩放到窗口上下，128 格在 4K 宽屏上每格约 30 像素，比模糊抹掉的范围细；平铺按图的原尺寸显示，格子跟着原尺寸算。
 */
function extremesOf(image: HTMLImageElement, blur: boolean, fit: BackgroundImageInput["fit"]): Extremes {
    if (!blur) return WORST_CASE_EXTREMES;
    const width = fit === "repeat" ? Math.max(1, Math.ceil(image.naturalWidth / 20)) : 128;
    const height = Math.max(1, Math.round(width * (image.naturalHeight / Math.max(1, image.naturalWidth))));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    if (context === null) return WORST_CASE_EXTREMES;
    try {
        context.drawImage(image, 0, 0, width, height);
        const {data} = context.getImageData(0, 0, width, height);
        let lightest: Rgb = [0, 0, 0];
        let darkest: Rgb = [255, 255, 255];
        let top = -1;
        let bottom = 2;
        for (let index = 0; index < data.length; index += 4) {
            const [r, g, b] = [data[index] as number, data[index + 1] as number, data[index + 2] as number];
            const level = luminance([r, g, b]);
            if (level > top) {
                top = level;
                lightest = [r, g, b];
            }
            if (level < bottom) {
                bottom = level;
                darkest = [r, g, b];
            }
        }
        return {lightest, darkest};
    } catch {
        return WORST_CASE_EXTREMES;
    }
}

export function useBackgroundImage(input: () => BackgroundImageInput | null, report: (error: unknown) => void): BackgroundImageState {
    const themeVersion = useDocumentThemeVersion();
    const solid = usePrefersSolid();
    const loaded = shallowRef<{readonly url: string; readonly image: HTMLImageElement} | null>(null);
    const failed = ref(false);
    let token = 0;

    const stop = watch(() => input()?.url ?? null, (url) => {
        token += 1;
        const mine = token;
        failed.value = false;
        if (url === null) {
            loaded.value = null;
            return;
        }
        load(url).then((image) => {
            if (mine === token) loaded.value = {url, image};
        }).catch((error: unknown) => {
            if (mine !== token) return;
            loaded.value = null;
            failed.value = true;
            report(error);
        });
    }, {immediate: true});
    onBeforeUnmount(stop);

    // 单独一个 computed：拖遮罩时不重新量图。
    const extremes = computed(() => {
        const current = input();
        const image = loaded.value;
        return current === null || image === null ? WORST_CASE_EXTREMES : extremesOf(image.image, current.blur, current.fit);
    });
    const active = computed(() => {
        const current = input();
        const image = loaded.value;
        if (current === null || image === null || solid.value) return null;
        void themeVersion.value;
        const colors = readDocumentColors();
        const floor = scrimFloor({surface: colors.surface, roles: colors.roles, extremes: extremes.value, blur: current.blur});
        return {url: image.url, fit: current.fit, blur: current.blur, alpha: Math.max(current.scrim, floor) / 100, floor};
    });
    return {active, failed};
}
