/**
 * 场景图的取景（docs/specs/theme/editor.md 输出 12、13）：声明里写的是 CSS 的 `background-size` 与 `background-position`，编辑器里画的是图上的一个框。
 * 这个模块在两者之间换算，只认编辑器自己写出的几种形式，别的读不懂时返回 null（该位置的框不可拖，数值照常能改）：
 *
 * - 正文两侧：`size: "auto <H>%"`（图的高是参照盒高的 H%，宽按图的比例）加 `position: "<x>% <y>%"`；
 * - 两个角：`size: "<W>px auto"`（图的宽是 W 像素）加 `position`；
 * - 空状态：只有 `position`，大小由 `cover` 决定（`EditorGroup` 的写法），框只能拖不能缩放；`cover` 让图在一个方向上刚好填满盒子，
 *   这个方向上位置没有余量（读出来固定在一边），所以一张横图通常只有横向能拖。
 *
 * 参照盒是各位置在默认布局下大致的尺寸，只用来把“放大多少”换成框的大小；真实窗口的尺寸不同，所以框是示意，真实位置以工作台里为准。
 */

export type CropRegion = "empty" | "marginLeft" | "marginRight" | "sidebarCorner" | "auxiliaryCorner";

export const CROP_REGIONS: ReadonlyArray<CropRegion> = ["empty", "marginLeft", "marginRight", "sidebarCorner", "auxiliaryCorner"];

/** 各位置的参照盒（像素）：空状态按 1920 宽下的内容区，两侧按版心外的留白，两个角按默认栏宽与 240px 的高。 */
export const REGION_BOX: Readonly<Record<CropRegion, {readonly width: number; readonly height: number}>> = {
    empty: {width: 1130, height: 900},
    marginLeft: {width: 205, height: 800},
    marginRight: {width: 205, height: 800},
    sidebarCorner: {width: 340, height: 240},
    auxiliaryCorner: {width: 395, height: 240},
};

/** 取景框：占原图的比例，左上角 `x`、`y` 与宽高 `w`、`h`，都在 0 到 1 之间（图比参照盒小时可以超出）。 */
export interface CropFrame {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface ImageSize {
    readonly width: number;
    readonly height: number;
}

/** 声明里一个位置写的两个值；空状态没有 `size`。 */
export interface CropCss {
    readonly size?: string;
    readonly position?: string;
}

const NUMBER = "(\\d+(?:\\.\\d+)?)";
const AUTO_HEIGHT = new RegExp(`^auto\\s+${NUMBER}%$`, "u");
const PIXEL_WIDTH = new RegExp(`^${NUMBER}px\\s+auto$`, "u");
const PERCENT = new RegExp(`^${NUMBER}%$`, "u");

const round = (value: number): number => Math.round(value * 10) / 10;

/** 读 `background-position`：两项，每项是百分数或 `left/center/right`（横）、`top/center/bottom`（纵）；读不懂返回 null。单位是百分数。 */
export function parsePosition(position: string | undefined): {readonly x: number; readonly y: number} | null {
    if (position === undefined) return null;
    const parts = position.trim().split(/\s+/u);
    if (parts.length !== 2) return null;
    const axis = (part: string, names: Readonly<Record<string, number>>): number | null => {
        const name = names[part];
        if (name !== undefined) return name;
        const percent = PERCENT.exec(part);
        return percent === null ? null : Number(percent[1]);
    };
    const x = axis(parts[0] as string, {left: 0, center: 50, right: 100});
    const y = axis(parts[1] as string, {top: 0, center: 50, bottom: 100});
    return x === null || y === null ? null : {x, y};
}

/** 图在这个位置被画成多大（像素）；`size` 读不懂返回 null。 */
function rendered(region: CropRegion, size: string | undefined, image: ImageSize): {readonly width: number; readonly height: number} | null {
    const box = REGION_BOX[region];
    const aspect = image.width / image.height;
    if (region === "empty") {
        const scale = Math.max(box.width / image.width, box.height / image.height);
        return {width: image.width * scale, height: image.height * scale};
    }
    if (size === undefined) return null;
    if (region === "marginLeft" || region === "marginRight") {
        const match = AUTO_HEIGHT.exec(size.trim());
        if (match === null) return null;
        const height = (box.height * Number(match[1])) / 100;
        return {width: height * aspect, height};
    }
    const match = PIXEL_WIDTH.exec(size.trim());
    if (match === null) return null;
    const width = Number(match[1]);
    return {width, height: width / aspect};
}

/** 声明里的写法换成图上的框；读不懂返回 null。 */
export function readFrame(region: CropRegion, css: CropCss, image: ImageSize): CropFrame | null {
    const position = parsePosition(css.position);
    const size = rendered(region, css.size, image);
    if (position === null || size === null || size.width <= 0 || size.height <= 0) return null;
    const box = REGION_BOX[region];
    const [w, h] = [box.width / size.width, box.height / size.height];
    return {x: (position.x / 100) * (1 - w), y: (position.y / 100) * (1 - h), w, h};
}

/** 框的宽高比必须等于参照盒的：拖框缩放时靠它保持比例。返回 h/w（在图的比例坐标里）。 */
export function frameAspect(region: CropRegion, image: ImageSize): number {
    const box = REGION_BOX[region];
    return (box.height / box.width) * (image.width / image.height);
}

/** 框换成声明里的写法；空状态只有位置（大小由 `cover` 定）。 */
export function writeFrame(region: CropRegion, frame: CropFrame): Required<CropCss> | {readonly position: string} {
    const place = (offset: number, span: number): number => (Math.abs(1 - span) < 1e-6 ? 50 : round((offset / (1 - span)) * 100));
    const position = `${String(place(frame.x, frame.w))}% ${String(place(frame.y, frame.h))}%`;
    if (region === "empty") return {position};
    if (region === "marginLeft" || region === "marginRight") return {size: `auto ${String(round(100 / frame.h))}%`, position};
    return {size: `${String(round(REGION_BOX[region].width / frame.w))}px auto`, position};
}

/** 把框收在图内、不小于最小宽度；保持参照盒的比例。 */
export function clampFrame(region: CropRegion, frame: CropFrame, image: ImageSize, minimumWidth = 0.08): CropFrame {
    const aspect = frameAspect(region, image);
    let w = Math.min(1, Math.max(minimumWidth, frame.w));
    let h = w * aspect;
    if (h > 1) {
        h = 1;
        w = h / aspect;
    }
    return {x: Math.min(1 - w, Math.max(0, frame.x)), y: Math.min(1 - h, Math.max(0, frame.y)), w, h};
}
