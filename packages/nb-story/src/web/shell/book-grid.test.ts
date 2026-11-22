/**
 * 书页外壳的三栏网格（docs/specs/story/viewer.md 输出 1、32）：宽屏三栏的宽度、收起后的宽度、平板档主区与只有两块时同宽。
 * 期望值与换成网格之前 `Splitter` 的配置算出的一致（改前的探针在 1440 宽量到导航 188、主区 850、抽屉 400）。
 */

import {describe, expect, it} from "bun:test";

import {createBookGrid} from "./book-grid";

const WIDE = {width: 1440, height: 900};

function widths(input: {drawerWidth?: number; navCollapsed?: boolean; drawerCollapsed?: boolean; compact?: boolean; cards?: number}, extent = WIDE) {
    const grid = createBookGrid({drawerWidth: input.drawerWidth ?? 400, navCollapsed: input.navCollapsed ?? false, drawerCollapsed: input.drawerCollapsed ?? false, compact: () => input.compact ?? false, cardCount: () => input.cards ?? 1});
    const layout = grid.layout(extent);
    return {nav: layout.sizes.nav!.width, main: layout.sizes.main!.width, drawer: layout.sizes.drawer!.width, sashes: layout.sashSizes.frame, inner: layout.sashSizes.details, issues: layout.issues};
}

describe("书页外壳的分栏网格", () => {
    it("宽屏一张卡：导航 188、卡取偏好宽度、主区吸收余量，两条线各 1 像素，详情里那条 0 像素", () => {
        expect(widths({})).toEqual({nav: 188, main: 850, drawer: 400, sashes: [1, 1], inner: [0], issues: []});
        expect(widths({drawerWidth: 460}).drawer).toBe(460);
    });

    it("详情整块收起时宽 0、主区吸收；导航收起时是 44 宽的图标条", () => {
        expect(widths({drawerCollapsed: true})).toMatchObject({nav: 188, main: 1250, drawer: 0});
        expect(widths({navCollapsed: true})).toMatchObject({nav: 44, main: 994, drawer: 400});
    });

    it("平板档：主区与详情之间那条线宽 0，主区与只有导航、主区两块时同宽", () => {
        const tablet = widths({navCollapsed: true, drawerCollapsed: true, compact: true}, {width: 1024, height: 768});
        expect(tablet).toMatchObject({nav: 44, drawer: 0, sashes: [1, 0]});
        expect(tablet.main).toBe(1024 - 44 - 1);
    });

    it("宽度守着上下限：一张卡 280 到 640，导航 150 到 300，主区不小于 360", () => {
        const grid = createBookGrid({drawerWidth: 400, navCollapsed: false, drawerCollapsed: false, compact: () => false, cardCount: () => 1});
        const layout = grid.layout(WIDE);
        expect(layout.constraints.details).toMatchObject({minimumSize: {width: 280}, maximumSize: {width: 640}});
        expect(grid.find("details")).toMatchObject({sizing: "fixed"});
        expect(grid.find("nav")).toMatchObject({minimumSize: {width: 150}, maximumSize: {width: 300}, sizing: "fixed"});
        expect(grid.find("main")).toMatchObject({minimumSize: {width: 360}});
        // 交叉轴不限：上限写 0 时 layout() 报出的高是 0。
        expect(layout.sizes.nav!.height).toBe(WIDE.height);
        expect(layout.sizes.drawer!.height).toBe(WIDE.height);
    });
});
