/**
 * Workbench 外壳的几何：默认拓扑、可用宽换算与叶尺寸夹取。
 *
 * 公式取自批准的骨架计划（步骤 1 / 步骤 4）：
 * - `avail = 外壳宽 − SASH_PX × (可见叶数 − 1)`（调用方按可见叶算好再传进来）；
 * - `editor = avail − activity − left − right`（编辑器是**唯一**吸收余量的叶）；
 * - activity 48/48 刚性、left 280..560、right 320..max(360, ratio × 视口)、editor 0..大值；
 * - 垂直方向：titlebar 36/36 刚性（不可见时不占高度），main 吸收余量。
 *
 * 尺寸约束的唯一真相是**树**：叶自带的 min/max 由 `shellLeafLimits` 在建树时写入，本文件的函数
 * 全部是纯函数——读树、算结果、报 issue，不写回树，不依赖 Vue（可在单测里直接跑）。
 */

import {createGrid, type Grid, type GridLeaf, type GridNode} from "@notnotype/nb-ui/components";
import type {WorkbenchPartId} from "nbook/app/utils/workbench/descriptors";

/** 壳层 sash 的流内宽度：命中区由绝对定位扩展，不吃叶宽（不要沿用验证台的 8px）。 */
export const SASH_PX = 1;

/** 外壳拓扑的宽度叶 id：顺序即渲染顺序，也是「可见叶」过滤前的完整集合。 */
export const SHELL_LEAF_IDS = ["activity", "left", "editor", "right"] as const satisfies readonly WorkbenchPartId[];

export type ShellLeafId = (typeof SHELL_LEAF_IDS)[number];

/** 取值域成员表：静态字面量用 Record（不建 Set）。 */
const SHELL_LEAVES: Record<string, true> = Object.fromEntries(SHELL_LEAF_IDS.map((id) => [id, true]));

/** 根分支 id：拓扑 `root(vertical){titlebar, main(horizontal){activity, left, editor, right}}`。 */
export const SHELL_ROOT_ID = "root";

/** 主区分支 id：承载四个宽度叶（步骤 4 起根分支转垂直，横向照旧）。 */
export const SHELL_MAIN_ID = "main";

/** 标题栏叶 id；它是**高度**叶，不参与横向分配。 */
export const SHELL_TITLEBAR_ID = "titlebar";

/** 标题栏 36：`DesktopTitleBar.vue` 的 `.desktop-title-bar { height: 36px; flex: 0 0 36px }`。 */
export const SHELL_TITLEBAR_HEIGHT = 36;

/** 可隐藏叶的成员表：四个宽度叶 + 标题栏（main 是分支，不可隐藏）。 */
const SHELL_HIDDEN_IDS: Record<string, true> = {...SHELL_LEAVES, [SHELL_TITLEBAR_ID]: true};

/**
 * 活动栏**卡片**的宽度：图标条本体（40px 按钮 + 两侧 4px 内边距）。
 * 卡片是浮在窗体底上的一块面，它四周的留白由**外壳**加在叶上（`WorkbenchShell` 给
 * `[data-leaf="activity"]` 的内边距），组件自己不写宽度也不写 margin——48 只在这里出现一次。
 */
export const SHELL_ACTIVITY_CARD_WIDTH = 48;

/** 卡片与窗体边界、相邻叶之间的留白（四边各一份）。 */
export const SHELL_ACTIVITY_GUTTER_PX = 6;

/**
 * 侧栏**容器卡片**四周的留白：取值与活动栏卡片同源（两张卡片四周的留白是同一个视觉量，
 * 改一处两张一起动），机制也同一套——外壳把它喂给叶的内边距，卡片自己是叶的内接盒。
 * 代价写在明处：容器内容区比叶窄 2 × 6 = 12px（叶尺寸与 min/max 不受影响）。
 */
export const SHELL_CONTAINER_GUTTER_PX = SHELL_ACTIVITY_GUTTER_PX;

/** 活动栏叶宽（刚性）：60 = 卡片 48 + 两侧留白 6；叶宽是树上唯一的逻辑尺寸。 */
export const SHELL_ACTIVITY_WIDTH = SHELL_ACTIVITY_CARD_WIDTH + SHELL_ACTIVITY_GUTTER_PX * 2;

/** 左栏 340 / 右栏 400：store 的 leftPanelWidth / agentPanelWidth 初值（app/stores/novel-ide.ts）。 */
export const SHELL_LEFT_PANEL_DEFAULT_WIDTH = 340;
export const SHELL_RIGHT_PANEL_DEFAULT_WIDTH = 400;

/** 左栏 280..560：NovelIdeToolPanel 的 MIN_PANEL_WIDTH / MAX_PANEL_WIDTH 原值。 */
export const SHELL_LEFT_PANEL_MIN_WIDTH = 280;
export const SHELL_LEFT_PANEL_MAX_WIDTH = 560;

/** 右栏下限 320：同现状 index.vue 的 minSize。 */
export const SHELL_RIGHT_PANEL_MIN_WIDTH = 320;

/** 右栏上限的兜底：max(360, ratio × 视口) 的 360。 */
export const SHELL_RIGHT_PANEL_MAX_FLOOR_WIDTH = 360;

/**
 * 右栏上限比值。骨架计划写的是 15%，但 15% 在任何常见视口下上限都是 360 < 右栏默认宽 400，
 * 会把默认宽度夹掉（与「默认宽对齐基线」矛盾）；实体现状（`app/pages/index.vue:378`）是 0.45。
 * 取值收敛在这一行，裁定后只改这里（步骤 1 报告里已提出待裁）。
 */
export const SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO = 0.45;

/** 编辑器吸收余量；上限给大值而不是 Infinity：快照要 JSON 序列化，Infinity 变成 null 会破坏恢复。 */
export const SHELL_EDITOR_MAX_WIDTH = Number.MAX_SAFE_INTEGER;

export type ShellLeafLimits = {minimumSize: number; maximumSize: number};

/** 右栏上限：max(360, ratio × 视口)；视口不是有限值时退回兜底值。 */
function rightPanelMaxWidth(viewportWidth: number): number {
    const scaled = Number.isFinite(viewportWidth) ? Math.floor(viewportWidth * SHELL_RIGHT_PANEL_MAX_VIEWPORT_RATIO) : 0;
    return Math.max(SHELL_RIGHT_PANEL_MAX_FLOOR_WIDTH, scaled);
}

/** 每个叶的 min/max 构造表（以联合类型闭合：加叶而不加约束直接编译失败）。 */
const SHELL_LEAF_LIMITS: Record<string, (viewportWidth: number) => ShellLeafLimits> = {
    // 活动栏刚性 48/48：宽度由图标与命中区决定，不由拖动决定。
    activity: () => ({minimumSize: SHELL_ACTIVITY_WIDTH, maximumSize: SHELL_ACTIVITY_WIDTH}),
    left: () => ({minimumSize: SHELL_LEFT_PANEL_MIN_WIDTH, maximumSize: SHELL_LEFT_PANEL_MAX_WIDTH}),
    right: (viewportWidth) => ({minimumSize: SHELL_RIGHT_PANEL_MIN_WIDTH, maximumSize: rightPanelMaxWidth(viewportWidth)}),
    editor: () => ({minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH}),
} satisfies Record<ShellLeafId, (viewportWidth: number) => ShellLeafLimits>;

/**
 * 叶的 min/max（固定叶的数字唯一来源）。右栏上限随视口变化，而原语的叶约束在建树时写死
 * （没有「改约束」的 API），所以视口宽在 `createDefaultShellGrid` 时定稿；窗口尺寸变化后
 * 要刷新上限就得重建树——这是步骤 2 的取舍，本函数保证重建时两处用到的数字一致。
 */
export function shellLeafLimits(leafId: ShellLeafId, viewportWidth: number): ShellLeafLimits {
    return SHELL_LEAF_LIMITS[leafId]!(viewportWidth);
}

/**
 * 单叶夹取：口径同 `useResizablePanel.clampResizablePanelSize`（max < min 时以 min 为准）；
 * 非有限值按 min 处理，避免 NaN 顺着尺寸表传进 Splitter 的百分比换算。
 */
export function clampLeafSize(size: number, limits: ShellLeafLimits): number {
    const low = Math.max(0, limits.minimumSize);
    const high = Math.max(low, limits.maximumSize);
    return Math.min(high, Math.max(low, Number.isFinite(size) ? size : low));
}

/** 树里的叶：id → 叶（含将来可能加的非外壳叶；本文件只处理 SHELL_LEAF_IDS 那四个）。 */
function leavesOf(grid: Grid<string>): Map<string, GridLeaf<string>> {
    const leaves = new Map<string, GridLeaf<string>>();
    const walk = (node: GridNode<string> | null): void => {
        if (!node) {
            return;
        }
        if (node.kind === "leaf") {
            leaves.set(node.id, node);
            return;
        }
        for (const child of node.children) {
            walk(child);
        }
    };
    walk(grid.root());
    return leaves;
}

/**
 * 一批尺寸的逐叶夹取（store 值、拖拽写回、恢复快照共用这一条口径）。
 * 约束取自**树**：树里没有的 id 报 issue 并丢弃，不静默保留；返回值不写回树。
 */
export function clampLeafSizes(grid: Grid<string>, sizes: Readonly<Record<string, number>>): {sizes: Record<string, number>; issues: string[]} {
    const leaves = leavesOf(grid);
    const clamped: Record<string, number> = {};
    const issues: string[] = [];
    for (const [id, size] of Object.entries(sizes)) {
        const leaf = leaves.get(id);
        if (!leaf) {
            issues.push(`尺寸表引用了树里没有的叶：${id}`);
            continue;
        }
        clamped[id] = clampLeafSize(size, leaf);
    }
    return {sizes: clamped, issues};
}

/** store 值（`novel.ide.local` 的 leftPanelWidth / agentPanelWidth）加上当前的收起集合。 */
export type ShellSizeStore = {
    leftPanelWidth: number;
    agentPanelWidth: number;
    /** 已收起的叶：不参与排布、不占宽度；重新展开时按 store 值恢复（收起不写进树）。 */
    hidden: readonly string[];
};

/** 四个叶的目标逻辑尺寸；隐藏叶为 0。 */
export type ShellSizes = Record<ShellLeafId, number>;

export type ShellSizesResult = {
    sizes: ShellSizes;
    /** 需要上报的布局 issue；空数组表示干净。 */
    issues: string[];
};

/**
 * 四个叶的目标尺寸：固定叶按期望值各自夹取，编辑器吸收余量。
 * `Σ固定 > avail` 时固定叶**不缩**、编辑器置 0 并给出可上报的 issue（骨架计划的规定）。
 */
function distributeShellSizes(limits: Record<ShellLeafId, ShellLeafLimits>, store: ShellSizeStore, avail: number): ShellSizesResult {
    const issues: string[] = [];
    const hidden: Record<string, true> = {};
    for (const id of store.hidden) {
        if (SHELL_HIDDEN_IDS[id]) {
            hidden[id] = true;
        } else {
            issues.push(`隐藏列表引用了未登记的叶：${id}`);
        }
    }

    const sizes = {} as ShellSizes;
    let fixedSum = 0;
    // 固定叶的期望值：活动栏常量 + store 的左右栏宽。
    const desired: Record<string, number> = {
        activity: SHELL_ACTIVITY_WIDTH,
        left: store.leftPanelWidth,
        right: store.agentPanelWidth,
    };
    for (const id of ["activity", "left", "right"] as const) {
        const size = hidden[id] ? 0 : clampLeafSize(desired[id]!, limits[id]);
        sizes[id] = size;
        fixedSum += size;
    }

    if (hidden.editor) {
        sizes.editor = 0;
        if (avail > fixedSum) {
            issues.push(`编辑器叶不可见：剩余 ${avail - fixedSum}px 没有叶吸收`);
        }
    } else if (avail < fixedSum) {
        sizes.editor = 0;
        issues.push(`固定叶总宽 ${fixedSum}px 超过可用宽 ${avail}px：固定叶不缩，编辑器置 0`);
    } else {
        sizes.editor = clampLeafSize(avail - fixedSum, limits.editor);
    }

    return {sizes, issues};
}

/**
 * 按 `avail`（= 外壳宽 − SASH_PX ×（可见叶数 − 1））重算四个叶的目标尺寸。
 * 尺寸约束读**树里各自声明的 min/max**，因此先要有一棵 `createDefaultShellGrid` 建的树。
 * 纯函数：不写回树；调用方拿结果决定是否提交（与当前 sizes 差 ≥1px 才重挂）。
 */
export function recalcShellSizes(grid: Grid<string>, store: ShellSizeStore, avail: number): ShellSizesResult {
    const leaves = leavesOf(grid);
    const issues: string[] = [];
    const limits = {} as Record<ShellLeafId, ShellLeafLimits>;
    for (const id of SHELL_LEAF_IDS) {
        const leaf = leaves.get(id);
        if (leaf) {
            limits[id] = leaf;
        } else {
            limits[id] = {minimumSize: 0, maximumSize: 0};
            issues.push(`布局树缺少叶：${id}（按 0 宽处理）`);
        }
    }
    const distributed = distributeShellSizes(limits, store, avail);
    return {sizes: distributed.sizes, issues: [...issues, ...distributed.issues]};
}

/**
 * 垂直方向分配：titlebar 刚性 36（不可见时不占高度），main 吸收余量。
 * 与横向同一套口径：可见叶之间每条 sash 占 `SASH_PX`。
 */
export function distributeShellHeights(shellHeight: number, titlebarVisible: boolean): {titlebar: number; main: number} {
    const height = Number.isFinite(shellHeight) ? Math.max(0, shellHeight) : 0;
    const titlebar = titlebarVisible ? Math.min(SHELL_TITLEBAR_HEIGHT, height) : 0;
    const sashes = titlebarVisible && height > titlebar ? SASH_PX : 0;
    return {titlebar, main: Math.max(0, height - titlebar - sashes)};
}

/**
 * 按给定叶尺寸重建外壳树（约束与 `createDefaultShellGrid` 同源）：外壳把「尺寸模型」收敛回原语时用。
 * 落账尺寸先按各叶 min/max 夹取——模型与树必须描述同一份布局，否则下一次拖拽会从漂移值起算。
 */
export function createShellGrid(viewportWidth: number, sizes: Readonly<Record<string, number>>): Grid<string> {
    const limits = {} as Record<ShellLeafId, ShellLeafLimits>;
    for (const id of SHELL_LEAF_IDS) {
        limits[id] = shellLeafLimits(id, viewportWidth);
    }
    return createGrid<string>({
        kind: "branch",
        id: SHELL_ROOT_ID,
        orientation: "vertical",
        children: [
            {
                kind: "leaf",
                id: SHELL_TITLEBAR_ID,
                ref: SHELL_TITLEBAR_ID,
                minimumSize: SHELL_TITLEBAR_HEIGHT,
                maximumSize: SHELL_TITLEBAR_HEIGHT,
                size: clampLeafSize(sizes[SHELL_TITLEBAR_ID] ?? SHELL_TITLEBAR_HEIGHT, {
                    minimumSize: SHELL_TITLEBAR_HEIGHT,
                    maximumSize: SHELL_TITLEBAR_HEIGHT,
                }),
            },
            {
                kind: "branch",
                id: SHELL_MAIN_ID,
                orientation: "horizontal",
                children: SHELL_LEAF_IDS.map((id): GridLeaf<string> => ({
                    kind: "leaf",
                    id,
                    ref: id,
                    minimumSize: limits[id].minimumSize,
                    maximumSize: limits[id].maximumSize,
                    size: clampLeafSize(sizes[id] ?? 0, limits[id]),
                })),
            },
        ],
    });
}

/**
 * 默认外壳拓扑 `root(horizontal){activity, left, editor, right}`。
 * 初始尺寸走同一套分配公式（按视口宽算一遍），因此首屏与 `recalcShellSizes` 的结果一致，
 * 除非真实外壳宽与视口宽不同。
 */
export function createDefaultShellGrid(viewportWidth: number): Grid<string> {
    const limits = {} as Record<ShellLeafId, ShellLeafLimits>;
    for (const id of SHELL_LEAF_IDS) {
        limits[id] = shellLeafLimits(id, viewportWidth);
    }
    const avail = Math.max(0, viewportWidth - SASH_PX * (SHELL_LEAF_IDS.length - 1));
    const initial = distributeShellSizes(limits, {
        leftPanelWidth: SHELL_LEFT_PANEL_DEFAULT_WIDTH,
        agentPanelWidth: SHELL_RIGHT_PANEL_DEFAULT_WIDTH,
        hidden: [],
    }, avail);
    return createShellGrid(viewportWidth, initial.sizes);
}
