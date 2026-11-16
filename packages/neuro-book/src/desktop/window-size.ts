/**
 * 桌面窗口的尺寸（docs/specs/runtime/desktop-shell.md 输出 10）：产品窗口客户区的最小值，与新窗口居中摆放的外框。不依赖 Electrobun，
 * 壳在 `desktop/src/bun/index.ts` 里用；拖动改大小时的下限由 `desktop/src/bun/min-size.c` 的窗口过程守着，这里只管打开那一刻。
 */

export interface Size {
    readonly width: number;
    readonly height: number;
}

export interface Frame extends Size {
    readonly x: number;
    readonly y: number;
}

/** 产品窗口客户区的最小值（逻辑像素，界面缩放不影响）。 */
export const MIN_PAGE_SIZE: Size = {width: 800, height: 560};

/**
 * 外框比客户区多出的部分（逻辑像素，100% 时量得）：没有系统标题栏时只有左右下三边看不见的拉伸边框，有系统标题栏时再加标题栏。
 * 只用来估初始外框，拖动时的下限按窗口此刻的真实外框算（`min-size.c`）。
 */
export const FRAME_ALLOWANCE: Readonly<Record<"custom" | "system", Size>> = {
    custom: {width: 16, height: 8},
    system: {width: 16, height: 39},
};

/** 工作区放不下缺省大小时，新窗口取工作区的这么多。 */
const FIT = 0.9;

/**
 * 新窗口在工作区里居中的外框。缺省大小放不下时取工作区的九成；给了 `minimum`（外框的下限，产品窗口与启动页传）时不小于它，
 * 但不超出工作区：工作区比下限还小时窗口就是工作区大小。工作区量不到（宽或高不是正数）时放在左上角附近、用缺省大小。
 */
export function centeredFrame(area: Frame, size: Size, minimum?: Size): Frame {
    if (area.width <= 0 || area.height <= 0) return {x: 120, y: 80, width: Math.max(size.width, minimum?.width ?? 0), height: Math.max(size.height, minimum?.height ?? 0)};
    const fit = (wanted: number, floor: number, available: number): number => Math.min(available, Math.max(floor, Math.min(wanted, Math.floor(available * FIT))));
    const width = fit(size.width, minimum?.width ?? 0, area.width);
    const height = fit(size.height, minimum?.height ?? 0, area.height);
    return {x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), width, height};
}

/** 产品窗口与启动页的外框下限：最小客户区加外框。 */
export function minimumFrame(customFrame: boolean): Size {
    const allowance = FRAME_ALLOWANCE[customFrame ? "custom" : "system"];
    return {width: MIN_PAGE_SIZE.width + allowance.width, height: MIN_PAGE_SIZE.height + allowance.height};
}
