/**
 * 书页外壳的三栏（导航 | 主区 | 抽屉）：nb-layout 的一棵网格，交给 `BookFrame` 经 `NestedGrid` 加 `useGridHost` 画出来
 * （docs/specs/story/viewer.md 输出 1、32）。结构固定三片叶、不随档位增删；档位只改收起状态与主区和抽屉之间那条线的宽度。
 *
 * 不存网格快照：要记的只有导航收起与否、抽屉宽度两项偏好（`host/prefs.ts`），建树时读进来。
 */

import {createGrid} from "@notnotype/nb-layout";
import type {Grid} from "@notnotype/nb-layout";

import {DRAWER_WIDTH_RANGE} from "../host/prefs";

export type BookPane = "nav" | "main" | "drawer";

/** 导航展开的缺省宽度与收起后的图标条宽度。 */
export const NAV_WIDTH = 188;
export const NAV_COLLAPSED_WIDTH = 44;

export interface BookGridInput {
    /** 抽屉的宽度（偏好），也是它收起后再展开的宽度。 */
    readonly drawerWidth: number;
    readonly navCollapsed: boolean;
    readonly drawerCollapsed: boolean;
    /**
     * 平板档：抽屉画成浮层，主区与抽屉之间那条线的宽度为 0（不接指针、不画接缝、Tab 落不上），主区与只有两块时一样宽。
     * 每次布局都读它，档位变了宿主要让网格重算（`host.invalidate()`）。
     */
    readonly compact: () => boolean;
}

/**
 * 建三栏的网格。数值与换成网格之前的 `Splitter` 配置相同：导航保留像素 188、150 到 300、收起到 44；主区按比例吸收余量、
 * 不小于 360；抽屉保留像素、280 到 640、收起到 0。拖过最小尺寸再往里的阈值（导航 60、抽屉 80）收起，反向 40 展开。
 */
export function createBookGrid(input: BookGridInput): Grid<BookPane> {
    return createGrid<BookPane>({
        kind: "branch",
        id: "frame",
        orientation: "horizontal",
        children: [
            {
                kind: "leaf",
                id: "nav",
                ref: "nav",
                size: {width: NAV_WIDTH, height: 0},
                sizing: "fixed",
                minimumSize: {width: 150, height: 0},
                maximumSize: {width: 300, height: 0},
                collapse: {collapsed: input.navCollapsed, collapsedSize: NAV_COLLAPSED_WIDTH, restoreSize: NAV_WIDTH, collapseThreshold: 60, expandThreshold: 40},
            },
            {kind: "leaf", id: "main", ref: "main", size: {width: 600, height: 0}, minimumSize: {width: 360, height: 0}},
            {
                kind: "leaf",
                id: "drawer",
                ref: "drawer",
                size: {width: input.drawerWidth, height: 0},
                sizing: "fixed",
                minimumSize: {width: DRAWER_WIDTH_RANGE.min, height: 0},
                maximumSize: {width: DRAWER_WIDTH_RANGE.max, height: 0},
                collapse: {collapsed: input.drawerCollapsed, collapsedSize: 0, restoreSize: input.drawerWidth, collapseThreshold: 80, expandThreshold: 40},
            },
        ],
    }, {
        // 第 0 条在导航与主区之间，第 1 条在主区与抽屉之间。
        sashSize: (_branch, index) => (index === 1 && input.compact() ? 0 : 1),
    });
}
