/**
 * 浏览器场景里量几何的几个小工具：元素的边框盒与“是不是落在格线上”。登录页、注册页与同意页的场景共用。
 */

import {expect} from "@playwright/test";
import type {Page} from "@playwright/test";

export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 元素的边框盒（相对页面的左上角，含滚动）。 */
export async function boxes(page: Page, selector: string): Promise<Box[]> {
    return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height};
    }));
}

export async function box(page: Page, selector: string): Promise<Box> {
    const found = await boxes(page, selector);
    expect(found, selector).toHaveLength(1);
    return found[0]!;
}

/** 偏移是不是周期的整数倍（容许取整的误差）。 */
export function onGrid(offset: number, period: number): boolean {
    const remainder = ((offset % period) + period) % period;
    return remainder < 0.01 || period - remainder < 0.01;
}
