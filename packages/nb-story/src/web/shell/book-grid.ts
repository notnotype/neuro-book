/**
 * 书页外壳的分栏（导航 | 主区 | 详情）：nb-layout 的一棵网格，交给 `BookFrame` 经 `NestedGrid` 加 `useGridHost` 画出来
 * （docs/specs/story/viewer.md 输出 1、32、66）。结构从头到尾不变，不随档位、张数增删叶：
 * - 详情（`details`）是一个保留像素的分支，宽度意图就是“抽屉”的宽度，整块收起的策略挂在它上面；
 * - 里面两块叶 `drawer`、`drawer2` 按比例分它的宽度，一张卡时 `drawer2` 收起到 0、中间那条线 0 像素，两张时各一张卡。
 * 张数变了由宿主改 `drawer2` 的收起与 `details` 的宽度（`grid.setCollapsed`、`grid.setSize`），见 `BookFrame`。
 *
 * 不存网格快照：要记的只有导航收起与否、一张卡的宽度两项偏好（`host/prefs.ts`），建树时读进来。
 */

import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridExtent, GridFailure} from "@notnotype/nb-layout";

import {DRAWER_WIDTH_RANGE} from "../host/prefs";

export type BookPane = "nav" | "main" | "details" | "drawer" | "drawer2";

/** 导航展开的缺省宽度与收起后的图标条宽度。 */
const NAV_WIDTH = 188;
const NAV_COLLAPSED_WIDTH = 44;
/** 两张卡中间那条线的宽度。 */
const DETAILS_SASH = 1;
/** 只给主轴约束的叶，交叉轴不限（上限写 0 是“上限 0”，`layout()` 报出的高会是 0）。 */
const UNBOUNDED = Number.POSITIVE_INFINITY;

/** 详情这一栏的宽度：一张时是一张卡的宽度，两张时两张加中间那条线。 */
export function detailsWidth(cardWidth: number, cards: number): number {
    return cards >= 2 ? 2 * cardWidth + DETAILS_SASH : cardWidth;
}

/** 两张时详情这一栏的宽度换回一张卡的宽度（落账时写偏好用），取整、夹在上下限里。 */
export function cardWidthOf(details: number, cards: number): number {
    const width = Math.round(cards >= 2 ? (details - DETAILS_SASH) / 2 : details);
    return Math.min(DRAWER_WIDTH_RANGE.max, Math.max(DRAWER_WIDTH_RANGE.min, width));
}

export interface BookGridInput {
    /** 一张卡的宽度（偏好），也是收起后再展开的宽度。 */
    readonly drawerWidth: number;
    readonly navCollapsed: boolean;
    readonly drawerCollapsed: boolean;
    /**
     * 平板档：抽屉画成浮层，主区与详情之间那条线的宽度为 0（不接指针、不画接缝、Tab 落不上），主区与只有两块时一样宽。
     * 每次布局都读它，档位变了宿主要让网格重算（`host.invalidate()`）。
     */
    readonly compact: () => boolean;
    /** 并排的张数（1 或 2）：建树时按它建，之后每次布局读它定中间那条线的宽度。 */
    readonly cardCount: () => number;
}

/**
 * 建分栏的网格。数值与换成网格之前的 `Splitter` 配置相同：导航保留像素 188、150 到 300、收起到 44；主区按比例吸收余量、
 * 不小于 360；一张卡 280 到 640，详情整块收起到 0。拖过最小尺寸再往里的阈值（导航 60、详情 80）收起，反向 40 展开。
 */
export function createBookGrid(input: BookGridInput): Grid<BookPane> {
    const cards = input.cardCount();
    const width = detailsWidth(input.drawerWidth, cards);
    const card = (id: "drawer" | "drawer2") => ({
        kind: "leaf" as const,
        id,
        ref: id,
        size: {width: 1, height: 0},
        minimumSize: {width: DRAWER_WIDTH_RANGE.min, height: 0},
        maximumSize: {width: DRAWER_WIDTH_RANGE.max, height: UNBOUNDED},
    });
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
                maximumSize: {width: 300, height: UNBOUNDED},
                collapse: {collapsed: input.navCollapsed, collapsedSize: NAV_COLLAPSED_WIDTH, collapseThreshold: 60, expandThreshold: 40},
            },
            {kind: "leaf", id: "main", ref: "main", size: {width: 600, height: 0}, minimumSize: {width: 360, height: 0}},
            {
                kind: "branch",
                id: "details",
                orientation: "horizontal",
                size: {width, height: 0},
                sizing: "fixed",
                collapse: {collapsed: input.drawerCollapsed, collapsedSize: 0, collapseThreshold: 80, expandThreshold: 40},
                children: [
                    card("drawer"),
                    // 第二张：一张卡时收起到 0。锁住收起状态：中间那条线拖到底停在 280，不会把第二张拖没，Enter 也不翻它；
                    // 收起与展开只由宿主随张数改（`setCardCount` 经 `grid.setCollapsed`）。
                    {...card("drawer2"), collapse: {collapsed: cards < 2, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 40, locked: true}},
                ],
            },
        ],
    }, {
        // 外层第 1 条在主区与详情之间；详情里那条在两张卡之间，一张时 0 像素（看不见、不接指针）。
        sashSize: (branch, index) => {
            if (branch === "details") return input.cardCount() >= 2 ? DETAILS_SASH : 0;
            return index === 1 && input.compact() ? 0 : 1;
        },
    });
}

/**
 * 换并排的张数（宿主在张数变了时调，之后要发布一次布局）。先展开或收起第二张，再设详情的宽度：反过来 `details` 会被一张卡时的上限
 * （640）夹住。开第二张时把两张拉平：两张按比例分，上次拖过中间那条线的份额会留着，关一张再开一张时不等宽又回来；关的时候第二张
 * 收着，拉不平，所以在开的时候拉。整块收起着、或还没量到容器时没有呈现可比，不拉。
 */
export function setCardCount(grid: Grid<BookPane>, input: {readonly cards: number; readonly cardWidth: number; readonly extent: GridExtent | null}): {ok: true} | GridFailure {
    const two = input.cards >= 2;
    const collapsed = grid.setCollapsed("drawer2", !two);
    if (!collapsed.ok) return collapsed;
    const sized = grid.setSize("details", detailsWidth(input.cardWidth, input.cards));
    if (!sized.ok) return sized;
    if (!two || input.extent === null || grid.find("details")?.collapse?.collapsed === true) return {ok: true};
    const sizes = grid.layout(input.extent).sizes;
    const left = sizes.drawer?.width ?? 0;
    const right = sizes.drawer2?.width ?? 0;
    if (Math.abs(left - right) < 0.5) return {ok: true};
    const half = (left + right) / 2;
    const evened = grid.resizeBranches([{branchId: "details", axis: "width", baseline: {drawer: left, drawer2: right}, target: {drawer: half, drawer2: half}}]);
    return evened.ok ? {ok: true} : evened;
}
