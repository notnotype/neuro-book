/**
 * 呈现树（docs/specs/ui/workbench-layout.md 的“尺寸”）：由文档和呈现事实算出这一刻交给 `createGrid` 的树。
 *
 * 放不下被收走的面板、不用容器的文档里隐藏的具名面板不进呈现树：它们的零宽缝如果夹在两个可见面板之间，拖那条缝改的是它们，不是两边。文档树不动，
 * 单子分支在呈现里塌陷时用 `collapsedTo` 记下它由谁代表，意图回写（`intent-writeback.ts`）据此把尺寸写回文档树。
 *
 * 带容器的区域（ADR 0046）：锚和不在当前容器里的分节不进呈现树（`isPanelShown`）；整个区域拖到零的收起策略配在区域在呈现树里的那个节点上，
 * 状态记在锚上（`regionAnchors`）。区域隐藏着时按拖到零画（`hiddenRegionsAtZero`）：区域挨着条或窗口边，零宽缝只有一个可见邻居，上面那条理由不成立；
 * 留着这条缝才能从它拉开，它和挨着的缝才有交汇处。
 *
 * 入口条（宿主给 `regionStrip`，docs/specs/ui/workbench-layout.md 输出 47）：区域在呈现里至少有一节时，区域节点呈现成纵向的包装分支
 * `[入口条叶, 内层]`，id 仍是文档里区域节点的 id（拖到零、隐藏都配在它上面，入口条跟着整个区域缩到零）；内层是原来呈现出来的节点（一节时是那一节的叶，
 * 几节时是原来的分支，id 加 `:sections`）。入口条叶只在呈现里，不进文档。当前容器在文档里恰有一节、它呈现着时，它的头并进入口条这一行（`strips` 的
 * `merged`）：按被投影的那份文档判，所以拖动的预览、隐藏与拖到零的过渡、放不下收走都和放下的结果一致，不在两片叶之间来回搬。
 *
 * 侧轨（宿主给 `rail`，docs/specs/ui/workbench-layout.md 输出 50）：右栏在文档里有分节时，`body` 横向分支里右栏那一列的外侧多一片侧轨叶 `rail:<区域>`，
 * 和别的孩子一起过滤、塌陷、算缝（两侧缝 0，同条）；区域隐藏、拖到零、放不下收走时它照样在。左轨就是活动栏，不在这里加。侧轨叶只在呈现里，不进文档与意图回写。
 * 展开的侧轨要的宽度由宿主先算好预算（`regionWidth`）：区域节点这一次按给的宽度呈现。覆盖只加在区域节点上，它和编辑区并排、保留像素（`isFixedChild`），
 * 结构操作前的回写本来就不写保留像素的节点（`intent-writeback.ts`），所以预算的结果不会变成意图；覆盖挪到区域里按比例分的节点上，结构操作就会把它写进意图。
 * 手势动了这个节点时（拖右栏与编辑区的分隔线），落账只把拖动的那一段加到原来的意图上（`widthOverrides`）。
 */

import {GRID_UNBOUNDED, UNBOUNDED_EXTENT} from "@notnotype/nb-layout";
import {axisOf, barOfRef, hiddenRegionsAtZero, isBarLeaf, isContainerAnchor, isFixedChild, isPanelShown, isSectionCollapsed, REGION_ORIENTATION, regionHasSections, regionNodeOf, treeLeaves} from "./layout-doc";
import type {LayoutBar, LayoutDoc, PanelName, PanelRecord} from "./layout-doc";
import {INNER_SECTIONS_SUFFIX, RAIL_LEAF_PREFIX, STRIP_LEAF_PREFIX} from "./presented-ids";
import type {GridExtent, GridNodeInput, GridOrientation, GridSizing, GridSnapshotNode, SashCollapseState} from "@notnotype/nb-layout";

export interface PanelConstraints {
    readonly minimumSize: GridExtent;
    readonly maximumSize: GridExtent;
}

export interface LayoutProjectionOptions {
    /** 面板的约束（工作台给）。 */
    constraints(id: string, panel: PanelRecord): PanelConstraints;
    /** 条的厚度。 */
    barThickness(bar: LayoutBar): number;
    /** 面板头高度：纵向分支里收起的面板占这么高，横向分支里收起是 0。 */
    readonly headHeight: number;
    readonly collapseThreshold: number;
    /** 普通缝的主轴占用。条两侧恒为 0。 */
    readonly sashSize: number;
    /** 呈现里去掉的面板：放不下被收走的。 */
    readonly removed?: ReadonlySet<string>;
    /** 带容器的区域顶上一行入口条：高度与只有一节时并不并进来；null 或不给是没有（见模块说明）。 */
    regionStrip?(region: PanelName): LayoutRegionStrip | null;
    /** 区域外侧的侧轨：这一刻的叶厚（px，收着或展开后的，已含缝）；null 或不给是没有。现在只问右栏。 */
    rail?(region: PanelName): number | null;
    /** 区域这一次的呈现宽度（侧轨展开的预算结果，输出 50 的“预算”）：不写意图。只对右栏起作用。 */
    readonly regionWidth?: Readonly<Partial<Record<PanelName, number>>>;
}

export interface LayoutRegionStrip {
    /** 入口条的高度（px），大于 0 才有。 */
    readonly height: number;
    /** 当前容器只有一节时，那一节的头并进入口条这一行：它的叶里没有头，最小、最大高度都减去入口条的高度，区域合计和只有一节时一样。 */
    readonly mergeSole: boolean;
}

/** 呈现里的一条侧轨：哪个区域、侧轨叶的 id。 */
export interface LayoutRailPlacement {
    readonly region: PanelName;
    readonly leaf: string;
}

/** 呈现里的一条入口条：哪个区域、入口条叶的 id、并进来的那一节（没有是 null）。 */
export interface LayoutStripPlacement {
    readonly region: PanelName;
    readonly leaf: string;
    readonly merged: string | null;
}

export interface LayoutProjection {
    readonly input: GridNodeInput<string>;
    readonly sashSize: (branchId: string, index: number) => number;
    /** 呈现里塌陷掉的文档分支 → 代表它的节点。 */
    readonly collapsedTo: ReadonlyMap<string, string>;
    /**
     * 呈现树里代表一个带容器的区域的节点 → 这个区域的锚（面板 id）。节点是当前容器那一列（排）的分支；只显示一个分节时分支塌陷，就是那个分节的叶；
     * 有入口条的区域是包装分支，不塌陷；区域空着、打开着时是锚自己这片叶（ADR 0050）。这个节点上的收起是整个区域拖到零：手势报告它收起或展开时，宿主要写到锚的 `collapsed` 上，
     * 不写到这个节点同名的面板上；区域是隐藏着的（按拖到零画）时，展开还要清掉锚的 `hidden`。不用容器的文档里是空的。
     */
    readonly regionAnchors: ReadonlyMap<string, string>;
    /** 这一次呈现出来的入口条（`regionStrip`）。 */
    readonly strips: ReadonlyArray<LayoutStripPlacement>;
    /**
     * 垫底的分节（docs/specs/ui/workbench-layout.md 输出 11）：一列分节全部收成标题行时最后一节，呈现里按比例分、吸收这一列剩下的空间，卡片满高；
     * 文档里它仍是收起的（内容停放、意图不写回），宿主按“收起”画它、只是外框更长。
     */
    readonly fillers: ReadonlySet<string>;
    /** 这一次呈现出来的侧轨（`rail`）。 */
    readonly rails: ReadonlyArray<LayoutRailPlacement>;
    /**
     * 这一次按预算宽度呈现的节点（`regionWidth`）→ 文档里它的宽度意图。手势落账按它只写拖动的那一段（`applyGestureCommit`）：呈现宽是预算压出来的，
     * 直接写回就把压掉的那段变成了意图。
     */
    readonly widthOverrides: ReadonlyMap<string, number>;
}

const REGION_NAMES: ReadonlySet<string> = new Set<PanelName>(["sidebar", "auxiliarybar", "panel"]);

/** 区域的入口条叶的 id（也是它的 `ref`）。 */
export const regionStripLeafId = (region: PanelName): string => `${STRIP_LEAF_PREFIX}${region}`;

/** 区域的侧轨叶的 id（也是它的 `ref`）。 */
export const railLeafId = (region: PanelName): string => `${RAIL_LEAF_PREFIX}${region}`;

/** 侧轨叶的 id → 区域；不是侧轨叶是 null。 */
export function regionOfRailLeaf(id: string): PanelName | null {
    if (!id.startsWith(RAIL_LEAF_PREFIX)) return null;
    const region = id.slice(RAIL_LEAF_PREFIX.length);
    return REGION_NAMES.has(region) ? (region as PanelName) : null;
}

/** 两侧不留缝的叶：条与侧轨。 */
const isSeamless = (node: GridNodeInput<string>): boolean => isBarLeaf(node) || (node.kind === "leaf" && regionOfRailLeaf(node.id) !== null);

/** 入口条叶的 id（或 `ref`）→ 区域；不是入口条叶是 null。 */
export function regionOfStripLeaf(id: string): PanelName | null {
    if (!id.startsWith(STRIP_LEAF_PREFIX)) return null;
    const region = id.slice(STRIP_LEAF_PREFIX.length);
    return REGION_NAMES.has(region) ? (region as PanelName) : null;
}

/**
 * 按所在分支写运行约束。呈现里的单子分支已经塌陷，所以这里看到的才是真实的父分支。
 *
 * - 谁吸收余量：`isFixedChild`。所以和编辑区并排的工具面板保留像素，全是工具面板的一列按比例分，分支里总有人吸收余量，不留白。
 * - 收起：横向分支里拖到零，纵向分支里收成标题行。编辑组不可收起。
 * - 带容器的区域（docs/specs/ui/workbench-layout.md 输出 11、12）：代表区域的节点（`regionAnchors`）收起是整个区域拖到零，沿它所在的骨架分支那一轴为 0，状态读锚的；
 *   这个节点是分节的叶时，一个节点只有一份收起策略，给区域用；这个分节自己这时不算收起（`isSectionCollapsed`，输出 11：区域只显示一个分节时它不收成标题行）。区域里的分节（`region` 非空）只会收成标题行：
 *   只有一列的区域（侧栏、右栏）里直接排在纵向分支里的分节有；底部面板里的、区域里被左右拆开的没有收起策略，它们之间的边界停在最小尺寸。
 */
function assignByParent(doc: LayoutDoc, node: GridNodeInput<string>, options: LayoutProjectionOptions, regionAnchors: ReadonlyMap<string, string>, fillers: Set<string>, region: PanelName | null = null): void {
    if (node.kind === "leaf") return;
    // 收起策略里没有恢复尺寸：Enter 与改了收起记录再呈现（按钮、命令）一样，都回到意图（输出 12；`ui/nested-grid` 输出 166）。
    const collapseOf = (collapsed: boolean, collapsedSize: number): SashCollapseState => ({
        collapsed,
        collapsedSize,
        collapseThreshold: options.collapseThreshold,
        expandThreshold: options.collapseThreshold,
    });
    // 包装分支（见模块说明）：入口条叶固定高度，内层吸收余量；内层是一节的叶时它是区域唯一的分节，不收成标题行（输出 11）。
    if (regionOfStripLeaf(node.children[0]?.id ?? "") !== null) {
        const inner = node.children[1];
        if (inner === undefined) return;
        inner.sizing = "weight";
        if (inner.kind === "branch") assignByParent(doc, inner, options, regionAnchors, fillers, region);
        return;
    }
    // 一列分节全部收成标题行：网格会把剩下的空间留空，卡片是按叶画的，空出来的地方就没有卡片。最后一节不配收起策略、按比例分、最小高度是面板头，
    // 吸收剩下的空间（垫底）。这一列的分隔线宿主要设成不能拖（`fillers`、NestedGrid 的 `sashDisabled`）：拖开时预览里它在吸收，松手后它回到标题行，
    // 结果和预览对不上。按呈现出来的子节点数（放不下收走的不算），只在一列都是分节的叶时这样做。
    const column = region !== null && REGION_ORIENTATION[region] === "vertical" && node.orientation === "vertical";
    const sections = node.children.filter((child) => child.kind === "leaf" && doc.panels[child.id]?.role === "tool");
    const filler = column && sections.length > 1 && sections.length === node.children.length && sections.every((child) => isSectionCollapsed(doc, child.id)) ? sections.at(-1) : undefined;
    for (const child of node.children) {
        const sizing: GridSizing = isFixedChild(doc, node.children, child) ? "fixed" : "weight";
        child.sizing = sizing;
        const anchor = doc.panels[regionAnchors.get(child.id) ?? ""];
        if (anchor?.name !== undefined) {
            child.collapse = collapseOf(anchor.collapsed === true, 0);
            if (child.kind === "branch") assignByParent(doc, child, options, regionAnchors, fillers, anchor.name);
            continue;
        }
        if (child.kind === "branch") {
            assignByParent(doc, child, options, regionAnchors, fillers, region);
            continue;
        }
        const panel = doc.panels[child.id];
        if (panel?.role !== "tool") continue;
        if (region !== null && (REGION_ORIENTATION[region] !== "vertical" || node.orientation !== "vertical")) continue;
        if (child === filler) {
            // 视图声明的最大高度也不算：它要吸收这一列剩下的全部，不然下面又留空（它是收起的，内容不显示）。
            child.minimumSize = {width: child.minimumSize?.width ?? 0, height: options.headHeight};
            child.maximumSize = {width: child.maximumSize?.width ?? GRID_UNBOUNDED, height: GRID_UNBOUNDED};
            fillers.add(child.id);
            continue;
        }
        child.collapse = collapseOf(isSectionCollapsed(doc, child.id), node.orientation === "vertical" ? options.headHeight : 0);
    }
}

export function projectLayoutDoc(recorded: LayoutDoc, options: LayoutProjectionOptions): LayoutProjection {
    const doc = hiddenRegionsAtZero(recorded);
    const collapsedTo = new Map<string, string>();
    const sashes = new Map<string, number[]>();
    const regionAnchors = new Map<string, string>();
    const strips: LayoutStripPlacement[] = [];
    const rails: LayoutRailPlacement[] = [];
    const widthOverrides = new Map<string, number>();
    // 右栏的侧轨（见模块说明）：区域在文档里有分节才有，插在 `body` 横向分支里右栏那一列的后面。
    const auxiliary = regionNodeOf(doc, "auxiliarybar");
    const railThickness = auxiliary !== null && regionHasSections(doc, "auxiliarybar") ? options.rail?.("auxiliarybar") ?? null : null;
    const auxiliaryWidth = options.regionWidth?.auxiliarybar;
    // 带容器的区域在文档树里的节点 → 锚。
    const regionRoots = new Map<string, string>();
    for (const panel of Object.values(doc.panels)) {
        const region = panel.name === undefined || !isContainerAnchor(panel) ? null : regionNodeOf(doc, panel.name);
        if (region !== null) regionRoots.set(region.node.id, region.anchor);
    }

    /**
     * 有入口条的区域：`presented` 是区域节点呈现出来的样子，包成 `[入口条叶, 内层]`。区域空着（呈现出来的是锚自己）时没有入口条。
     * 并不并按文档：当前容器在文档里显示着的分节恰有一节（`hiddenRegionsAtZero` 之后数，隐藏的区域照样算；不看放不下收走），而且它呈现着。
     */
    const withStrip = (node: GridSnapshotNode, anchorId: string, presented: GridNodeInput<string>): GridNodeInput<string> => {
        const region = doc.panels[anchorId]?.name;
        const strip = region === undefined ? null : options.regionStrip?.(region) ?? null;
        if (region === undefined || strip === null || strip.height <= 0 || presented.id === anchorId) return presented;
        const sections = treeLeaves(node).filter((leaf) => leaf.id !== anchorId && doc.panels[leaf.id]?.container !== undefined && isPanelShown(doc, leaf.id));
        const sole = strip.mergeSole && sections.length === 1 ? (sections[0]?.id ?? null) : null;
        const merged = sole !== null && presented.kind === "leaf" && presented.id === sole ? sole : null;
        const leaf = regionStripLeafId(region);
        strips.push({region, leaf, merged});
        let inner: GridNodeInput<string>;
        if (presented.kind === "branch") {
            const id = `${node.id}${INNER_SECTIONS_SUFFIX}`;
            sashes.set(id, sashes.get(presented.id) ?? []);
            sashes.delete(presented.id);
            inner = {...presented, id};
        } else if (merged !== null) {
            // 头在入口条里：叶的最小、最大高度都去掉入口条那一行，区域合计和只有一节时一样（输出 6）。
            const less = (height: number | undefined): number => Math.max(0, (height ?? 0) - strip.height);
            const maximum = presented.maximumSize?.height ?? GRID_UNBOUNDED;
            inner = {
                ...presented,
                minimumSize: {width: presented.minimumSize?.width ?? 0, height: less(presented.minimumSize?.height)},
                maximumSize: {width: presented.maximumSize?.width ?? GRID_UNBOUNDED, height: maximum >= GRID_UNBOUNDED ? maximum : less(maximum)},
            };
        } else {
            inner = presented;
        }
        // 包装分支的 id 就是区域节点，没有塌陷：内层是一节的叶时不登记 `collapsedTo`。
        collapsedTo.delete(node.id);
        sashes.set(node.id, [0]);
        const height = {width: 0, height: strip.height};
        return {
            kind: "branch",
            id: node.id,
            orientation: "vertical",
            size: {...node.size},
            children: [{kind: "leaf", id: leaf, ref: leaf, size: height, minimumSize: height, maximumSize: {width: GRID_UNBOUNDED, height: strip.height}, sizing: "fixed"}, inner],
        };
    };
    /** 文档树的 `node` 呈现成了 `presented`：它是区域的节点时按呈现后的 id 记下（分支可能已经塌陷成一片叶；有入口条时包一层）。 */
    const presentedAs = (node: GridSnapshotNode, presented: GridNodeInput<string>): GridNodeInput<string> => {
        const anchor = regionRoots.get(node.id);
        if (anchor === undefined) return presented;
        let result = withStrip(node, anchor, presented);
        if (auxiliaryWidth !== undefined && node.id === auxiliary?.node.id) {
            result = {...result, size: {width: auxiliaryWidth, height: result.size?.height ?? node.size.height}};
            widthOverrides.set(result.id, node.size.width);
        }
        regionAnchors.set(result.id, anchor);
        return result;
    };
    const railLeaf = (thickness: number): GridNodeInput<string> => {
        const leaf = railLeafId("auxiliarybar");
        rails.push({region: "auxiliarybar", leaf});
        const fixed: GridExtent = {width: thickness, height: 0};
        return {kind: "leaf", id: leaf, ref: leaf, size: fixed, minimumSize: fixed, maximumSize: {...UNBOUNDED_EXTENT, width: thickness}, sizing: "fixed"};
    };

    const project = (node: GridSnapshotNode, parentOrientation: GridOrientation | null): GridNodeInput<string> | null => {
        if (node.kind === "branch") {
            const children: GridNodeInput<string>[] = [];
            for (const child of node.children) {
                const presented = project(child, node.orientation);
                if (presented !== null) children.push(presented);
                // 右栏被放不下收走时这一列没有了，侧轨照样在原来的位置。
                if (railThickness !== null && node.orientation === "horizontal" && child.id === auxiliary?.node.id) children.push(railLeaf(railThickness));
            }
            if (children.length === 0) return null;
            if (children.length === 1) {
                const survivor = children[0] as GridNodeInput<string>;
                collapsedTo.set(node.id, survivor.id);
                return presentedAs(node, {...survivor, size: {...node.size}});
            }
            sashes.set(node.id, children.slice(0, -1).map((child, index) => (isSeamless(child) || isSeamless(children[index + 1] as GridNodeInput<string>) ? 0 : options.sashSize)));
            return presentedAs(node, {kind: "branch", id: node.id, orientation: node.orientation, size: {...node.size}, children});
        }
        const bar = barOfRef(node.ref);
        if (bar !== null) {
            if (doc.hiddenBars.includes(bar)) return null;
            const thickness = options.barThickness(bar);
            const main = axisOf(parentOrientation ?? "horizontal");
            const fixed: GridExtent = {width: 0, height: 0, [main]: thickness};
            return {kind: "leaf", id: node.id, ref: node.ref, size: fixed, minimumSize: fixed, maximumSize: {...UNBOUNDED_EXTENT, [main]: thickness}, sizing: "fixed"};
        }
        const panel = doc.panels[node.id];
        if (panel === undefined || !isPanelShown(doc, node.id) || options.removed?.has(node.id) === true) return null;
        const {minimumSize, maximumSize} = options.constraints(node.id, panel);
        // 空区域里锚自己就是区域的节点（ADR 0050）：同分支一样登记，拖到零才读得到锚上的 `collapsed`。
        return presentedAs(node, {kind: "leaf", id: node.id, ref: node.ref, size: {...node.size}, minimumSize, maximumSize});
    };

    const input = project(doc.tree.root, null);
    if (input === null) throw new Error("布局文档的树里没有可呈现的节点：校验应该已经拒绝");
    const fillers = new Set<string>();
    assignByParent(doc, input, options, regionAnchors, fillers);
    return {input, collapsedTo, regionAnchors, strips, fillers, rails, widthOverrides, sashSize: (branchId, index) => sashes.get(branchId)?.[index] ?? 0};
}

function minimumOf(node: GridNodeInput<string>, axis: keyof GridExtent, parentAxis: keyof GridExtent | null, sashSize: (branchId: string, index: number) => number): number {
    // 收起为零的节点（整个区域拖到零、横向分支里拖到零的面板）没有看得见的内容，两根轴都不占最小尺寸（docs/specs/ui/nested-grid.md 输出 137）：
    // 不然窗口窄了、矮了，会把看不见的分节“收走”。收成标题行的还占着面板头，只在父分支主轴上换成面板头的高度。
    if (node.collapse?.collapsed === true && (node.collapse.collapsedSize === 0 || axis === parentAxis)) return node.collapse.collapsedSize;
    if (node.kind === "leaf") return node.minimumSize?.[axis] ?? 0;
    const own = axisOf(node.orientation);
    const inner = node.children.map((child) => minimumOf(child, axis, own, sashSize));
    if (own !== axis) return Math.max(...inner);
    return inner.reduce((sum, value) => sum + value, 0) + node.children.slice(0, -1).reduce((sum, _, index) => sum + sashSize(node.id, index), 0);
}

export interface PresentationCollapse {
    readonly removed: ReadonlySet<string>;
    /** 收走了几块；全收走还放不下时 `squeezed` 为真，编辑组也要压。 */
    readonly squeezed: boolean;
}

/**
 * 放不下时收走哪些工具面板（docs/specs/ui/workbench-layout.md 输出 10）。先由 grid 压到最小，这里只判最小值都放不下的情况：按 `order` 一块块收走，放得下就停；
 * 焦点所在的面板最后收。结果只影响呈现，不写文档。
 */
export function presentationCollapse(doc: LayoutDoc, extent: GridExtent, options: LayoutProjectionOptions & {readonly order: ReadonlyArray<string>; readonly focused?: string | null}): PresentationCollapse {
    /** 最小值超出窗口多少；0 是放得下。 */
    const overflowOf = (removed: ReadonlySet<string>): number => {
        const {input, sashSize} = projectLayoutDoc(doc, {...options, removed});
        return Math.max(0, minimumOf(input, "width", null, sashSize) - extent.width) + Math.max(0, minimumOf(input, "height", null, sashSize) - extent.height);
    };
    const removed = new Set<string>();
    // `overflow` 始终是 `removed` 当前这一份的结果：每一步只多算新的那一次，上一步算过的带到下一步。
    let overflow = overflowOf(removed);
    if (overflow === 0) return {removed, squeezed: false};
    const shown = new Set(treeLeaves(doc.tree.root).map((leaf) => leaf.id).filter((id) => doc.panels[id]?.role === "tool" && isPanelShown(doc, id)));
    const queue = [...options.order.filter((id) => shown.has(id)), ...[...shown].filter((id) => !options.order.includes(id))];
    const ordered = [...queue.filter((id) => id !== options.focused), ...queue.filter((id) => id === options.focused)];
    let squeezed = true;
    for (const id of ordered) {
        removed.add(id);
        overflow = overflowOf(removed);
        if (overflow === 0) {
            squeezed = false;
            break;
        }
    }
    // 前面收走的不一定帮上了忙（窄的时候，收走纵向的那块不省宽度）：从后往前放回来，放回来不更挤的就不收。全收走还放不下时也一样，不然窗口再窄一点底部面板反而不见了。
    for (const back of [...removed].reverse()) {
        removed.delete(back);
        const after = overflowOf(removed);
        if (after > overflow) removed.add(back);
        else overflow = after;
    }
    return {removed, squeezed};
}
