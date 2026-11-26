/**
 * 书页外壳的三栏网格（docs/specs/story/viewer.md 输出 1、32）：宽屏三栏的宽度、收起后的宽度、平板档主区与只有两块时同宽。
 * 期望值与换成网格之前 `Splitter` 的配置算出的一致（改前的探针在 1440 宽量到导航 188、主区 850、抽屉 400）。
 */

import {describe, expect, it} from "bun:test";

import {createBookGrid, setCardCount} from "./book-grid";

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

describe("张数变了（setCardCount，输出 66）", () => {
    const build = (cards: number, extent = WIDE) => {
        let count = cards;
        const grid = createBookGrid({drawerWidth: 400, navCollapsed: false, drawerCollapsed: false, compact: () => false, cardCount: () => count});
        const widthsNow = () => {
            const layout = grid.layout(extent);
            const w = (id: string) => Math.round(layout.sizes[id]!.width * 10) / 10;
            return {nav: w("nav"), main: w("main"), drawer: w("drawer"), drawer2: w("drawer2"), inner: layout.sashSizes.details};
        };
        const setCards = (next: number) => {
            count = next;
            return setCardCount(grid, {cards: next, cardWidth: 400, extent});
        };
        return {grid, widthsNow, setCards};
    };

    it("开第二张：两张各一张卡的宽度、主区吸收，中间那条线 1 像素；关一张回到一张", () => {
        const {widthsNow, setCards} = build(1);
        expect(setCards(2)).toEqual({ok: true});
        expect(widthsNow()).toEqual({nav: 188, main: 449, drawer: 400, drawer2: 400, inner: [1]});
        expect(setCards(1)).toEqual({ok: true});
        expect(widthsNow()).toEqual({nav: 188, main: 850, drawer: 400, drawer2: 0, inner: [0]});
    });

    it("建树时就是两张（从地址载入两张）", () => {
        expect(build(2).widthsNow()).toEqual({nav: 188, main: 449, drawer: 400, drawer2: 400, inner: [1]});
    });

    it("先后要对：先设宽度再展开第二张，详情会被一张卡时的上限 640 夹住", () => {
        const {grid} = build(1);
        expect(grid.setSize("details", 801)).toMatchObject({ok: true, size: 640});
    });

    it("拖过中间那条线、关一张再开一张：回到等宽", () => {
        const {grid, widthsNow, setCards} = build(2);
        expect(grid.resizeBranches([{branchId: "details", axis: "width", baseline: {drawer: 400, drawer2: 400}, target: {drawer: 520, drawer2: 280}}]).ok).toBe(true);
        expect(widthsNow()).toMatchObject({drawer: 520, drawer2: 280});
        setCards(1);
        setCards(2);
        expect(widthsNow()).toMatchObject({drawer: 400, drawer2: 400});
    });

    it("第二张锁住收起状态：手势要翻它时整批不落账，宿主随张数照常翻、锁不变", () => {
        const {grid, widthsNow, setCards} = build(2);
        const locked = grid.resizeBranches([{branchId: "details", axis: "width", baseline: {drawer: 400, drawer2: 400}, target: {drawer: 800, drawer2: 0}, collapsed: {drawer2: true}}]);
        expect(locked.ok ? null : {code: locked.code, params: locked.params}).toEqual({code: "collapse-locked", params: {id: "drawer2", branch: "details"}});
        expect(widthsNow()).toMatchObject({drawer: 400, drawer2: 400});
        setCards(1);
        expect(grid.find("drawer2")?.collapse).toMatchObject({collapsed: true, locked: true});
    });

    it("整块收起再展开：两张都回来，不等宽也还在", () => {
        const {grid, widthsNow} = build(2);
        grid.resizeBranches([{branchId: "details", axis: "width", baseline: {drawer: 400, drawer2: 400}, target: {drawer: 520, drawer2: 280}}]);
        grid.setCollapsed("details", true);
        expect(widthsNow()).toMatchObject({main: 1250, drawer: 0, drawer2: 0});
        grid.setCollapsed("details", false);
        expect(widthsNow()).toMatchObject({main: 449, drawer: 520, drawer2: 280});
    });

    it("1280 宽开两张：网格按最小值压缩（主区停在 360，两张一样宽、都不小于 280），拉平时按压缩后的呈现算", () => {
        const narrow = {width: 1280, height: 800};
        const {grid, widthsNow, setCards} = build(1, narrow);
        setCards(2);
        // 压缩的分法是 nb-layout 的事，这里只看本模块承诺的几样：主区到最小值、两张拉平、都不小于 280。
        const squeezed = widthsNow();
        expect(squeezed.main).toBe(360);
        expect(Math.abs(squeezed.drawer - squeezed.drawer2)).toBeLessThan(0.5);
        expect(Math.min(squeezed.drawer, squeezed.drawer2)).toBeGreaterThanOrEqual(280);
        const now = widthsNow();
        grid.resizeBranches([{branchId: "details", axis: "width", baseline: {drawer: now.drawer, drawer2: now.drawer2}, target: {drawer: now.drawer + 50, drawer2: now.drawer2 - 50}}]);
        setCards(1);
        setCards(2);
        const evened = widthsNow();
        expect(Math.abs(evened.drawer - evened.drawer2)).toBeLessThan(0.5);
    });
});
