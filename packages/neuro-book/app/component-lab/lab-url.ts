/**
 * Lab 地址栏参数。除组件与场景外，尺寸、配色和主题也能从 URL 直接指定，
 * 这样截图脚本和分享出去的链接打开就是同一个状态，不必再去点界面上的按钮。
 */

/** 画布尺寸预设；宽高都为 0 表示随窗口。 */
export const LAB_VIEWPORT_PRESETS: Record<string, readonly [number, number]> = {
    free: [0, 0],
    tablet: [768, 1024],
    phone: [390, 844],
};

const MAX_CANVAS_SIZE = 16384;

export type LabUrlParams = {
    component?: string;
    scene?: string;
    themeId?: string;
    colorwayId?: string;
    canvasSize?: {width: number; height: number};
};

/** `vp=phone|tablet|free` 或 `vp=<宽>x<高>`；不认识或越界时返回 undefined。 */
export function parseLabViewport(value: string | null): {width: number; height: number} | undefined {
    if (value === null) {
        return undefined;
    }
    const preset = LAB_VIEWPORT_PRESETS[value];
    if (preset !== undefined) {
        return {width: preset[0], height: preset[1]};
    }
    const match = /^(\d{1,5})x(\d{1,5})$/u.exec(value);
    if (match === null) {
        return undefined;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width <= MAX_CANVAS_SIZE && height <= MAX_CANVAS_SIZE ? {width, height} : undefined;
}

/**
 * `cw` 可以写配色 id，也可以写 `light` / `dark`，取第一套外观相符的配色。
 * 主题与配色是否真的存在由偏好恢复按登记表再校验一次。
 */
export function parseLabUrl(search: string, colorways: Record<string, {appearance: "light" | "dark"}>): LabUrlParams {
    const params = new URLSearchParams(search);
    const colorway = params.get("cw");
    const byAppearance = colorway === "light" || colorway === "dark"
        ? Object.entries(colorways).find(([, meta]) => meta.appearance === colorway)?.[0]
        : undefined;
    return {
        component: params.get("c") ?? params.get("component") ?? undefined,
        scene: params.get("s") ?? params.get("scene") ?? undefined,
        themeId: params.get("theme") ?? undefined,
        colorwayId: byAppearance ?? colorway ?? undefined,
        canvasSize: parseLabViewport(params.get("vp")),
    };
}
