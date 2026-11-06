/**
 * 布局文档（docs/specs/ui/workbench-layout.md）：工作台的一棵树与树上的面板。文档是用户的布局，隐藏的面板也在里面；交给 `createGrid` 的
 * 呈现树由 `layout-project.ts` 算。
 *
 * 操作都是纯函数：失败返回问题码，文档不变；结果和现状一样（结构、顺序、标签、活动标签都相同）时返回原对象，调用方据此不提交。
 * 结构操作的出口统一过一次规范形（`normalizeTree`）。`createGrid` 的结构操作语义不动：现有宿主和测试依赖它只塌陷单子分支。
 *
 * 尺寸意图统一是 CSS px，只有一条写入路径：`rebaseIntents` 把呈现尺寸写回。手势落账后和结构操作之前都走它，不读 `grid.serialize()`：那里的 `weight` 是反解出来的比例，
 * 不是 px。所以展平不用换算单位，`fixed` 与 `weight` 之间切换也不用。收起的面板和呈现为零的轴不写，那就是它展开时的尺寸。
 *
 * 文档放在 `shallowRef` 里：操作用 `structuredClone` 复制，Vue 的响应式代理会让它抛错。
 */

import {GRID_MAX_DEPTH, GRID_MAX_NODES, GRID_SNAPSHOT_VERSION} from "./grid-types";
import type {GridExtent, GridOrientation, GridSnapshot, GridSnapshotBranch, GridSnapshotLeaf, GridSnapshotNode} from "./grid-types";

export const LAYOUT_DOC_VERSION = 1;

export type LayoutBar = "activitybar" | "statusbar";
export type PanelName = "sidebar" | "auxiliarybar" | "panel";
export type PanelRole = "tool" | "editor";
export type LayoutEdge = "left" | "right" | "top" | "bottom";

export type TabRef =
    | {readonly kind: "view"; readonly viewId: string}
    | {readonly kind: "tab"; readonly type: string; readonly tabId: string};

export interface PanelRecord {
    readonly role: PanelRole;
    readonly name?: PanelName;
    /** 顺序就是显示顺序。 */
    readonly tabs: ReadonlyArray<TabRef>;
    /** 活动标签的 `tabKey`。 */
    readonly active: string | null;
    /** 只有具名面板会隐藏。 */
    readonly hidden?: boolean;
    readonly collapsed?: boolean;
}

export interface LayoutDoc {
    readonly version: typeof LAYOUT_DOC_VERSION;
    readonly tree: GridSnapshot;
    readonly panels: Readonly<Record<string, PanelRecord>>;
    /** 浮动随后面的切片做，现在恒为空。 */
    readonly floats: ReadonlyArray<never>;
    readonly hiddenBars: ReadonlyArray<LayoutBar>;
    readonly currentEditor: string | null;
}

export type LayoutFailureCode = "not-found" | "rejected" | "limit-exceeded";
export type LayoutResult = {readonly ok: true; readonly doc: LayoutDoc} | {readonly ok: false; readonly code: LayoutFailureCode; readonly detail: string};

/** 被拖的东西：一个标签，或整个面板。 */
export type LayoutSource =
    | {readonly kind: "tab"; readonly tab: string}
    | {readonly kind: "panel"; readonly panel: string};

export type LayoutDropRegion = "strip" | "center" | "edge";

/** 宿主给的策略：库不知道角色的含义。 */
export interface LayoutPolicy {
    /** 接受矩阵。`tabs` 是被拖的全部标签（整个面板时不止一个）。 */
    accepts(tabs: ReadonlyArray<TabRef>, target: PanelRecord, region: LayoutDropRegion): boolean;
    /** 分区限制（固定标签）；缺省都可以。 */
    canInsert?(tab: TabRef, target: PanelRecord, index: number): boolean;
    /** 新节点的 id：由宿主给，保证唯一。 */
    newId(kind: "panel" | "branch"): string;
}

const BAR_PREFIX = "bar:";
const PANEL_PREFIX = "panel:";

export const panelRef = (id: string): string => `${PANEL_PREFIX}${id}`;
export const barRef = (bar: LayoutBar): string => `${BAR_PREFIX}${bar}`;
export const barOfRef = (ref: string): LayoutBar | null => (ref.startsWith(BAR_PREFIX) ? (ref.slice(BAR_PREFIX.length) as LayoutBar) : null);
export const panelOfRef = (ref: string): string | null => (ref.startsWith(PANEL_PREFIX) ? ref.slice(PANEL_PREFIX.length) : null);
export const tabKey = (tab: TabRef): string => (tab.kind === "view" ? `view:${tab.viewId}` : `tab:${tab.tabId}`);

const failure = (code: LayoutFailureCode, detail: string): LayoutResult => ({ok: false, code, detail});

type MutableDoc = {
    version: typeof LAYOUT_DOC_VERSION;
    tree: {version: typeof GRID_SNAPSHOT_VERSION; root: GridSnapshotNode};
    panels: Record<string, PanelRecord>;
    floats: never[];
    hiddenBars: LayoutBar[];
    currentEditor: string | null;
};

const editable = (doc: LayoutDoc): MutableDoc => structuredClone(doc) as unknown as MutableDoc;

const axisOf = (orientation: GridOrientation): keyof GridExtent => (orientation === "horizontal" ? "width" : "height");
const crossOf = (orientation: GridOrientation): keyof GridExtent => (orientation === "horizontal" ? "height" : "width");
const orientationOfEdge = (edge: LayoutEdge): GridOrientation => (edge === "left" || edge === "right" ? "horizontal" : "vertical");
const isBeforeEdge = (edge: LayoutEdge): boolean => edge === "left" || edge === "top";

export interface TreeHit {
    readonly node: GridSnapshotNode;
    readonly parent: GridSnapshotBranch | null;
    readonly index: number;
}

export function findTreeNode(root: GridSnapshotNode, id: string): TreeHit | null {
    if (root.id === id) return {node: root, parent: null, index: 0};
    if (root.kind === "leaf") return null;
    for (const [index, child] of root.children.entries()) {
        if (child.id === id) return {node: child, parent: root, index};
        const found = findTreeNode(child, id);
        if (found !== null) return found;
    }
    return null;
}

/** 树序的全部叶。 */
export function treeLeaves(node: GridSnapshotNode): GridSnapshotLeaf[] {
    return node.kind === "leaf" ? [node] : node.children.flatMap(treeLeaves);
}

/** 这个节点此刻占不占地方：隐藏的具名面板、隐藏的条不占；分支看它的子节点。 */
export function isNodeShown(doc: LayoutDoc, node: GridSnapshotNode): boolean {
    if (node.kind === "branch") return node.children.some((child) => isNodeShown(doc, child));
    const bar = barOfRef(node.ref);
    if (bar !== null) return !doc.hiddenBars.includes(bar);
    const panel = doc.panels[node.id];
    return panel !== undefined && panel.hidden !== true;
}

/** 这个节点占不占主轴的份额：隐藏的不占，收起的只占面板头。 */
export function countsInShare(doc: LayoutDoc, node: GridSnapshotNode): boolean {
    if (node.kind === "branch") return node.children.some((child) => countsInShare(doc, child));
    return isNodeShown(doc, node) && doc.panels[node.id]?.collapsed !== true;
}

const isBarLeaf = (node: GridSnapshotNode): boolean => node.kind === "leaf" && barOfRef(node.ref) !== null;

function collapseInto(branch: GridSnapshotBranch, survivor: GridSnapshotNode): GridSnapshotNode {
    return {...survivor, size: {...branch.size}};
}

/**
 * 规范形：同轴嵌套展平，单子分支塌陷。子分支展平时，把占着地方的孙节点的主轴意图放大到等于子分支的外部分配，展平前后每块的尺寸不变；隐藏、收起的孙节点按同一比例，
 * 回来时份额不变。`counts` 是“这个节点占不占主轴的份额”。
 */
export function normalizeTree(node: GridSnapshotNode, counts: (node: GridSnapshotNode) => boolean = () => true): GridSnapshotNode {
    if (node.kind === "leaf") return node;
    const main = axisOf(node.orientation);
    const cross = crossOf(node.orientation);
    const children: GridSnapshotNode[] = [];
    for (const raw of node.children) {
        const child = normalizeTree(raw, counts);
        if (child.kind === "leaf" || child.orientation !== node.orientation) {
            children.push(child);
            continue;
        }
        const total = child.children.filter(counts).reduce((sum, grand) => sum + grand.size[main], 0);
        const scale = total > 0 ? child.size[main] / total : 1;
        for (const grand of child.children) children.push({...grand, size: {...grand.size, [main]: grand.size[main] * scale, [cross]: child.size[cross]}});
    }
    if (children.length === 1) return collapseInto(node, children[0] as GridSnapshotNode);
    return {...node, children};
}

/** 摘掉一个节点；空分支一起摘，单子分支塌陷。`aliases` 记下塌陷掉的分支现在由谁代表，后面的操作按 id 找目标时要用。 */
function detachNode(root: GridSnapshotNode, id: string, aliases: Map<string, string>): GridSnapshotNode | null {
    if (root.id === id) return null;
    if (root.kind === "leaf") return root;
    const children: GridSnapshotNode[] = [];
    for (const child of root.children) {
        const next = detachNode(child, id, aliases);
        if (next !== null) children.push(next);
    }
    if (children.length === 0) return null;
    if (children.length === 1 && children.length !== root.children.length) {
        const survivor = children[0] as GridSnapshotNode;
        aliases.set(root.id, survivor.id);
        return collapseInto(root, survivor);
    }
    return {...root, children};
}

const resolveAlias = (aliases: ReadonlyMap<string, string>, id: string): string => {
    let current = id;
    while (aliases.has(current)) current = aliases.get(current) as string;
    return current;
};

function countScale(node: GridSnapshotNode, depth = 1): {nodes: number; depth: number} {
    if (node.kind === "leaf") return {nodes: 1, depth};
    let nodes = 1;
    let deepest = depth;
    for (const child of node.children) {
        const inner = countScale(child, depth + 1);
        nodes += inner.nodes;
        deepest = Math.max(deepest, inner.depth);
    }
    return {nodes, depth: deepest};
}

/** 树的结构、方向与叶序一样吗。 */
export function sameTreeShape(left: LayoutDoc, right: LayoutDoc): boolean {
    const shape = (node: GridSnapshotNode): unknown => (node.kind === "leaf" ? node.id : {o: node.orientation, c: node.children.map(shape)});
    return JSON.stringify(shape(left.tree.root)) === JSON.stringify(shape(right.tree.root));
}

/** 结果和现状一样吗：结构、方向、叶序、标签、活动标签、显隐与收起。不比意图：摘出再放回，比例舍入后不会相等；也不比分支 id。 */
export function sameLayoutShape(left: LayoutDoc, right: LayoutDoc): boolean {
    if (!sameTreeShape(left, right)) return false;
    const leftIds = Object.keys(left.panels).sort();
    const rightIds = Object.keys(right.panels).sort();
    if (JSON.stringify(leftIds) !== JSON.stringify(rightIds)) return false;
    const record = (panel: PanelRecord): unknown => [panel.name ?? null, panel.tabs.map(tabKey), panel.active, panel.hidden === true, panel.collapsed === true];
    return leftIds.every((id) => JSON.stringify(record(left.panels[id] as PanelRecord)) === JSON.stringify(record(right.panels[id] as PanelRecord)))
        && JSON.stringify([...left.hiddenBars].sort()) === JSON.stringify([...right.hiddenBars].sort())
        && left.currentEditor === right.currentEditor;
}

/** 出口：过规范形、查规模；结果和现状一样时返回原对象。 */
function finish(original: LayoutDoc, next: MutableDoc): LayoutResult {
    next.tree.root = normalizeTree(next.tree.root, (node) => countsInShare(next as unknown as LayoutDoc, node));
    const scale = countScale(next.tree.root);
    if (scale.nodes > GRID_MAX_NODES || scale.depth > GRID_MAX_DEPTH) return failure("limit-exceeded", `节点 ${String(scale.nodes)} 个、深度 ${String(scale.depth)} 层`);
    const doc = next as unknown as LayoutDoc;
    return {ok: true, doc: sameLayoutShape(original, doc) ? original : doc};
}

/**
 * 把呈现尺寸写回意图：手势落账后、结构操作之前调。`collapsedTo` 是呈现里塌陷掉的分支由谁代表（`projectLayoutDoc` 给），它们的尺寸就是幸存者的。
 * 不写的：呈现为零的轴；收起的面板（纵向收成标题行时呈现高度是面板头，不是展开尺寸）；条（厚度不是意图）。
 *
 * 全是工具面板的分支按比例分（`projectLayoutDoc`）：里面有收起或隐藏的兄弟时，其余的呈现尺寸是占了它们的空间之后的，直接写进去，兄弟回来时比例就错了，展开只回到一部分。
 * 所以这些子节点只更新彼此的比例，总量保持原来的份额。含编辑组的分支不用：工具面板保留像素，余量归编辑组。
 */
export function rebaseIntents(doc: LayoutDoc, sizes: Readonly<Record<string, GridExtent>>, collapsedTo: ReadonlyMap<string, string> = new Map()): LayoutDoc {
    const sizeOfNode = (node: GridSnapshotNode): GridExtent | undefined => sizes[node.id] ?? sizes[collapsedTo.get(node.id) ?? ""];
    const isSkipped = (node: GridSnapshotNode): boolean => node.kind === "leaf" && (barOfRef(node.ref) !== null || doc.panels[node.id]?.collapsed === true);
    const holdsEditor = (node: GridSnapshotNode): boolean => treeLeaves(node).some((leaf) => doc.panels[leaf.id]?.role === "editor");

    const write = (node: GridSnapshotNode): GridSnapshotNode => {
        const size = isSkipped(node) ? undefined : sizeOfNode(node);
        const nextSize = size === undefined ? node.size : {width: size.width > 0 ? size.width : node.size.width, height: size.height > 0 ? size.height : node.size.height};
        if (node.kind === "leaf") return {...node, size: nextSize};
        const children = node.children.map(write);
        const main = axisOf(node.orientation);
        const away = (child: GridSnapshotNode): boolean => isSkipped(child) || sizeOfNode(child) === undefined;
        if (!node.children.some(away) || holdsEditor(node)) return {...node, size: nextSize, children};
        const present = node.children.filter((child) => !away(child));
        const before = present.reduce((sum, child) => sum + child.size[main], 0);
        const after = children.filter((_, index) => !away(node.children[index] as GridSnapshotNode)).reduce((sum, child) => sum + child.size[main], 0);
        const scale = before > 0 && after > 0 ? before / after : 1;
        return {...node, size: nextSize, children: children.map((child, index) => (away(node.children[index] as GridSnapshotNode) ? child : {...child, size: {...child.size, [main]: child.size[main] * scale}}))};
    };
    return {...doc, tree: {...doc.tree, root: write(doc.tree.root)}};
}

// ── 标签 ──

export function findTab(doc: LayoutDoc, key: string): {readonly panel: string; readonly index: number; readonly tab: TabRef} | null {
    for (const [panel, record] of Object.entries(doc.panels)) {
        const index = record.tabs.findIndex((tab) => tabKey(tab) === key);
        if (index !== -1) return {panel, index, tab: record.tabs[index] as TabRef};
    }
    return null;
}

/** 活动标签被拿走：优先后一个，没有就前一个。 */
function neighbourActive(tabs: ReadonlyArray<TabRef>, removedIndex: number): string | null {
    const next = tabs[removedIndex] ?? tabs[removedIndex - 1];
    return next === undefined ? null : tabKey(next);
}

function takeTab(next: MutableDoc, panelId: string, index: number): void {
    const panel = next.panels[panelId] as PanelRecord;
    const tabs = panel.tabs.filter((_, at) => at !== index);
    const removedKey = tabKey(panel.tabs[index] as TabRef);
    next.panels[panelId] = {...panel, tabs, active: panel.active === removedKey ? neighbourActive(tabs, index) : panel.active};
}

function removePanelNode(next: MutableDoc, id: string): void {
    const aliases = new Map<string, string>();
    const root = detachNode(next.tree.root, id, aliases);
    if (root !== null) next.tree.root = root;
    delete next.panels[id];
}

const editorIds = (next: {readonly panels: Readonly<Record<string, PanelRecord>>}): string[] => Object.keys(next.panels).filter((id) => next.panels[id]?.role === "editor");

/** 面板空了之后（不变量）：具名面板隐藏，无名工具面板移除，编辑组移除但最后一个留着。 */
function settleEmptyPanel(next: MutableDoc, id: string): void {
    const panel = next.panels[id];
    if (panel === undefined || panel.tabs.length > 0) return;
    if (panel.name !== undefined) {
        next.panels[id] = {...panel, hidden: true};
        return;
    }
    if (panel.role === "editor" && editorIds(next).length <= 1) return;
    removePanelNode(next, id);
    if (next.currentEditor === id) next.currentEditor = editorIds(next)[0] ?? null;
}

export function insertTab(doc: LayoutDoc, input: {readonly panel: string; readonly tab: TabRef; readonly index?: number; readonly activate?: boolean}): LayoutResult {
    const panel = doc.panels[input.panel];
    if (panel === undefined) return failure("not-found", `面板 ${input.panel}`);
    if (findTab(doc, tabKey(input.tab)) !== null) return failure("rejected", `标签已存在 ${tabKey(input.tab)}`);
    const next = editable(doc);
    const tabs = [...panel.tabs];
    tabs.splice(Math.min(input.index ?? tabs.length, tabs.length), 0, input.tab);
    next.panels[input.panel] = {...panel, tabs, active: input.activate === false ? (panel.active ?? tabKey(input.tab)) : tabKey(input.tab)};
    if (panel.role === "editor" && input.activate !== false) next.currentEditor = input.panel;
    return finish(doc, next);
}

/** preview 替换：一次写完，没有“旧的没了、新的还没来”的中间态。 */
export function replaceTab(doc: LayoutDoc, input: {readonly tab: string; readonly next: TabRef}): LayoutResult {
    const found = findTab(doc, input.tab);
    if (found === null) return failure("not-found", `标签 ${input.tab}`);
    const nextKey = tabKey(input.next);
    if (nextKey !== input.tab && findTab(doc, nextKey) !== null) return failure("rejected", `标签已存在 ${nextKey}`);
    const next = editable(doc);
    const panel = next.panels[found.panel] as PanelRecord;
    const tabs = [...panel.tabs];
    tabs[found.index] = input.next;
    next.panels[found.panel] = {...panel, tabs, active: panel.active === input.tab ? tabKey(input.next) : panel.active};
    return finish(doc, next);
}

export function removeTab(doc: LayoutDoc, key: string): LayoutResult {
    const found = findTab(doc, key);
    if (found === null) return failure("not-found", `标签 ${key}`);
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    settleEmptyPanel(next, found.panel);
    return finish(doc, next);
}

export function activateTab(doc: LayoutDoc, key: string): LayoutResult {
    const found = findTab(doc, key);
    if (found === null) return failure("not-found", `标签 ${key}`);
    const next = editable(doc);
    next.panels[found.panel] = {...(next.panels[found.panel] as PanelRecord), active: key};
    if (next.panels[found.panel]?.role === "editor") next.currentEditor = found.panel;
    return finish(doc, next);
}

/** 移到一个面板的标签条。同一面板就是换顺序；`index` 是摘掉来源之前的插入位。 */
export function moveTabToStrip(doc: LayoutDoc, input: {readonly tab: string; readonly panel: string; readonly index: number}, policy: LayoutPolicy): LayoutResult {
    const found = findTab(doc, input.tab);
    const target = doc.panels[input.panel];
    if (found === null || target === undefined) return failure("not-found", `标签 ${input.tab} 或面板 ${input.panel}`);
    if (found.panel !== input.panel && !policy.accepts([found.tab], target, "strip")) return failure("rejected", "接受矩阵拒绝");
    const at = Math.max(0, found.panel === input.panel && found.index < input.index ? input.index - 1 : input.index);
    if (policy.canInsert?.(found.tab, target, at) === false) return failure("rejected", "分区不允许");
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    const panel = next.panels[input.panel] as PanelRecord;
    const tabs = [...panel.tabs];
    tabs.splice(Math.min(at, tabs.length), 0, found.tab);
    next.panels[input.panel] = {...panel, tabs, active: tabKey(found.tab), ...(panel.collapsed === true && found.panel !== input.panel ? {collapsed: false} : {})};
    if (target.role === "editor") next.currentEditor = input.panel;
    settleEmptyPanel(next, found.panel);
    return finish(doc, next);
}

/** 整个面板并入另一面板的标签条：全部标签一起，保持顺序。来源按“拖空”处理。 */
export function movePanelToStrip(doc: LayoutDoc, input: {readonly panel: string; readonly target: string; readonly index?: number}, policy: LayoutPolicy): LayoutResult {
    const source = doc.panels[input.panel];
    const target = doc.panels[input.target];
    if (source === undefined || target === undefined) return failure("not-found", `面板 ${input.panel} 或 ${input.target}`);
    if (input.panel === input.target) return {ok: true, doc};
    if (!policy.accepts(source.tabs, target, "strip")) return failure("rejected", "接受矩阵拒绝");
    const at = Math.min(Math.max(0, input.index ?? target.tabs.length), target.tabs.length);
    if (source.tabs.some((tab, offset) => policy.canInsert?.(tab, target, at + offset) === false)) return failure("rejected", "分区不允许");
    const next = editable(doc);
    next.panels[input.panel] = {...source, tabs: [], active: null};
    const tabs = [...target.tabs];
    tabs.splice(at, 0, ...source.tabs);
    next.panels[input.target] = {...target, tabs, active: source.active ?? target.active, ...(target.collapsed === true ? {collapsed: false} : {})};
    if (target.role === "editor") next.currentEditor = input.target;
    settleEmptyPanel(next, input.panel);
    return finish(doc, next);
}

// ── 外缘 ──

/** 外缘的目标：放到两块之间（这条边、缝、对面那块的边是同一个落点），或拆这一块。 */
export type LayoutEdgeTarget =
    | {readonly kind: "between"; readonly branch: string; readonly before: string; readonly after: string}
    | {readonly kind: "split"; readonly panel: string; readonly edge: LayoutEdge};

/** 这条边对面是同一分支的相邻兄弟吗（规则 4、5）。隐藏的兄弟不算，跳过去找下一个；条不算。 */
export function edgeTargetOf(doc: LayoutDoc, panel: string, edge: LayoutEdge): LayoutEdgeTarget | null {
    const hit = findTreeNode(doc.tree.root, panel);
    if (hit === null) return null;
    const {parent, index} = hit;
    if (parent === null || parent.orientation !== orientationOfEdge(edge)) return {kind: "split", panel, edge};
    const step = isBeforeEdge(edge) ? -1 : 1;
    for (let at = index + step; at >= 0 && at < parent.children.length; at += step) {
        const sibling = parent.children[at] as GridSnapshotNode;
        if (isBarLeaf(sibling)) break;
        if (!isNodeShown(doc, sibling)) continue;
        return step === 1 ? {kind: "between", branch: parent.id, before: panel, after: sibling.id} : {kind: "between", branch: parent.id, before: sibling.id, after: panel};
    }
    return {kind: "split", panel, edge};
}

/** 把一片叶放到外缘目标（来源已经摘掉）。规则 4 新块只从两块取、各让三分之一；规则 5 新块取目标的一半。 */
function placeLeaf(next: MutableDoc, target: LayoutEdgeTarget, leaf: GridSnapshotLeaf, aliases: ReadonlyMap<string, string>, newBranchId: () => string): boolean {
    const root = next.tree.root;
    if (target.kind === "between") {
        const before = resolveAlias(aliases, target.before);
        const after = resolveAlias(aliases, target.after);
        const beforeHit = findTreeNode(root, before);
        const afterHit = findTreeNode(root, after);
        if (beforeHit === null || afterHit === null || beforeHit.parent === null || beforeHit.parent !== afterHit.parent) return false;
        const parent = beforeHit.parent;
        const main = axisOf(parent.orientation);
        const cross = crossOf(parent.orientation);
        const share = (beforeHit.node.size[main] + afterHit.node.size[main]) / 3;
        const children = parent.children.map((child) => (child.id === before || child.id === after ? {...child, size: {...child.size, [main]: child.size[main] * (2 / 3)}} : child));
        const placed: GridSnapshotLeaf = {...leaf, size: {...leaf.size, [main]: share, [cross]: beforeHit.node.size[cross]}};
        children.splice(beforeHit.index + 1, 0, placed);
        replaceChildren(next, parent.id, children);
        return true;
    }
    const panel = resolveAlias(aliases, target.panel);
    const hit = findTreeNode(root, panel);
    if (hit === null) return false;
    const orientation = orientationOfEdge(target.edge);
    const main = axisOf(orientation);
    const cross = crossOf(orientation);
    const half = hit.node.size[main] / 2;
    const kept = {...hit.node, size: {...hit.node.size, [main]: half}};
    const placed: GridSnapshotLeaf = {...leaf, size: {...leaf.size, [main]: half, [cross]: hit.node.size[cross]}};
    const pair = isBeforeEdge(target.edge) ? [placed, kept] : [kept, placed];
    if (hit.parent !== null && hit.parent.orientation === orientation) {
        const children = [...hit.parent.children];
        children.splice(hit.index, 1, ...pair);
        replaceChildren(next, hit.parent.id, children);
        return true;
    }
    const branch: GridSnapshotBranch = {kind: "branch", id: newBranchId(), orientation, size: {...hit.node.size}, children: pair};
    if (hit.parent === null) {
        next.tree.root = branch;
        return true;
    }
    const children = [...hit.parent.children];
    children.splice(hit.index, 1, branch);
    replaceChildren(next, hit.parent.id, children);
    return true;
}

function replaceChildren(next: MutableDoc, branchId: string, children: GridSnapshotNode[]): void {
    const write = (node: GridSnapshotNode): GridSnapshotNode => {
        if (node.kind === "leaf") return node;
        if (node.id === branchId) return {...node, children};
        return {...node, children: node.children.map(write)};
    };
    next.tree.root = write(next.tree.root);
}

/** 外缘目标里的一块真实面板，接受矩阵问它。`before`、`after` 可能是分支，取分支树序的第一块。 */
function edgeAnchorOf(doc: LayoutDoc, target: LayoutEdgeTarget): PanelRecord | null {
    const id = target.kind === "split" ? target.panel : target.before;
    const hit = findTreeNode(doc.tree.root, id);
    if (hit === null) return null;
    const first = treeLeaves(hit.node).find((leaf) => doc.panels[leaf.id] !== undefined);
    return first === undefined ? null : (doc.panels[first.id] as PanelRecord);
}

/** 整块面板移到外缘：同一块叶，id 不变，内容不重建。这也让“放回原处”自然是原对象。 */
export function movePanelToEdge(doc: LayoutDoc, input: {readonly panel: string; readonly target: LayoutEdgeTarget}, policy: LayoutPolicy): LayoutResult {
    const source = doc.panels[input.panel];
    const leaf = findTreeNode(doc.tree.root, input.panel)?.node;
    if (source === undefined || leaf === undefined || leaf.kind !== "leaf") return failure("not-found", `面板 ${input.panel}`);
    if (input.target.kind === "split" ? input.target.panel === input.panel : input.target.before === input.panel || input.target.after === input.panel) return {ok: true, doc};
    const anchor = edgeAnchorOf(doc, input.target);
    if (anchor === null) return failure("not-found", "目标已不存在");
    if (!policy.accepts(source.tabs, anchor, "edge")) return failure("rejected", "接受矩阵拒绝");
    const next = editable(doc);
    const aliases = new Map<string, string>();
    const root = detachNode(next.tree.root, input.panel, aliases);
    if (root === null) return failure("rejected", "不能摘掉整棵树");
    next.tree.root = root;
    if (!placeLeaf(next, input.target, {...leaf, size: {...leaf.size}}, aliases, () => policy.newId("branch"))) return failure("not-found", "目标已不存在");
    return finish(doc, next);
}

/**
 * 标签移到外缘。来源只有这一个标签时是同一块面板移动；否则拆出新面板，继承来源的角色。
 * 工具视图的内容项跟着 `key` 走、不重建；编辑器标签的视图由编辑器决定。
 */
export function moveTabToEdge(doc: LayoutDoc, input: {readonly tab: string; readonly target: LayoutEdgeTarget}, policy: LayoutPolicy): LayoutResult {
    const found = findTab(doc, input.tab);
    if (found === null) return failure("not-found", `标签 ${input.tab}`);
    const source = doc.panels[found.panel] as PanelRecord;
    if (source.tabs.length === 1) return movePanelToEdge(doc, {panel: found.panel, target: input.target}, policy);
    const anchor = edgeAnchorOf(doc, input.target);
    if (anchor === null) return failure("not-found", "目标已不存在");
    if (!policy.accepts([found.tab], anchor, "edge")) return failure("rejected", "接受矩阵拒绝");
    const next = editable(doc);
    takeTab(next, found.panel, found.index);
    const id = policy.newId("panel");
    next.panels[id] = {role: source.role, tabs: [found.tab], active: input.tab};
    const leaf: GridSnapshotLeaf = {kind: "leaf", id, ref: panelRef(id), size: {width: 0, height: 0}};
    if (!placeLeaf(next, input.target, leaf, new Map(), () => policy.newId("branch"))) return failure("not-found", "目标已不存在");
    if (source.role === "editor") next.currentEditor = id;
    return finish(doc, next);
}

/** 在外缘开一块新面板（`"side"` 打开、移动到“新面板”）。 */
export function openPanelAtEdge(doc: LayoutDoc, input: {readonly id: string; readonly panel: PanelRecord; readonly target: LayoutEdgeTarget}, policy: LayoutPolicy): LayoutResult {
    if (doc.panels[input.id] !== undefined || findTreeNode(doc.tree.root, input.id) !== null) return failure("rejected", `面板已存在 ${input.id}`);
    const next = editable(doc);
    next.panels[input.id] = input.panel;
    const leaf: GridSnapshotLeaf = {kind: "leaf", id: input.id, ref: panelRef(input.id), size: {width: 0, height: 0}};
    if (!placeLeaf(next, input.target, leaf, new Map(), () => policy.newId("branch"))) return failure("not-found", "目标已不存在");
    if (input.panel.role === "editor") next.currentEditor = input.id;
    return finish(doc, next);
}

// ── 显隐与收起 ──

export function setPanelHidden(doc: LayoutDoc, panelId: string, hidden: boolean): LayoutResult {
    const panel = doc.panels[panelId];
    if (panel === undefined) return failure("not-found", `面板 ${panelId}`);
    if (hidden && panel.name === undefined) return failure("rejected", "只有具名面板能隐藏");
    const next = editable(doc);
    const {hidden: _hidden, collapsed: _collapsed, ...rest} = panel;
    next.panels[panelId] = hidden ? {...panel, hidden: true} : rest;
    return finish(doc, next);
}

export function setPanelCollapsed(doc: LayoutDoc, panelId: string, collapsed: boolean): LayoutResult {
    const panel = doc.panels[panelId];
    if (panel === undefined) return failure("not-found", `面板 ${panelId}`);
    if (collapsed && panel.role === "editor") return failure("rejected", "编辑组不可收起");
    const next = editable(doc);
    const {collapsed: _collapsed, ...rest} = panel;
    next.panels[panelId] = collapsed ? {...panel, collapsed: true} : rest;
    return finish(doc, next);
}

export function setBarHidden(doc: LayoutDoc, bar: LayoutBar, hidden: boolean): LayoutResult {
    const next = editable(doc);
    const rest = next.hiddenBars.filter((candidate) => candidate !== bar);
    next.hiddenBars = hidden ? [...rest, bar] : rest;
    return finish(doc, next);
}

/** 预备区：一次写入显示面板并接收，不经过“显示了但还是空的”的中间态。 */
export function showPanelAndInsert(doc: LayoutDoc, input: {readonly panel: string; readonly source: LayoutSource}, policy: LayoutPolicy): LayoutResult {
    const shown = setPanelHidden(doc, input.panel, false);
    if (!shown.ok) return shown;
    const expanded = setPanelCollapsed(shown.doc, input.panel, false);
    if (!expanded.ok) return expanded;
    const target = expanded.doc.panels[input.panel] as PanelRecord;
    if (input.source.kind === "tab") return rebaseOriginal(doc, moveTabToStrip(expanded.doc, {tab: input.source.tab, panel: input.panel, index: target.tabs.length}, policy));
    return rebaseOriginal(doc, movePanelToStrip(expanded.doc, {panel: input.source.panel, target: input.panel}, policy));
}

/** 组合操作的结果和最开始一样时，返回最开始的对象。 */
function rebaseOriginal(original: LayoutDoc, result: LayoutResult): LayoutResult {
    return result.ok && sameLayoutShape(original, result.doc) ? {ok: true, doc: original} : result;
}

/** 存盘前去掉动态标签（未绑定项目的窗口与新项目的模板）：只留工具面板与一个空编辑组。 */
export function stripDynamicTabs(doc: LayoutDoc): LayoutDoc {
    const next = editable(doc);
    for (const [id, panel] of Object.entries(next.panels)) {
        const tabs = panel.tabs.filter((tab) => tab.kind === "view");
        if (tabs.length === panel.tabs.length) continue;
        const active = tabs.some((tab) => tabKey(tab) === panel.active) ? panel.active : (tabs[0] === undefined ? null : tabKey(tabs[0]));
        next.panels[id] = {...panel, tabs, active};
        settleEmptyPanel(next, id);
    }
    next.tree.root = normalizeTree(next.tree.root, (node) => countsInShare(next as unknown as LayoutDoc, node));
    return next as unknown as LayoutDoc;
}

// ── 校验 ──

export type LayoutDocValidation = {readonly ok: true; readonly doc: LayoutDoc} | {readonly ok: false; readonly code: "unsupported-version" | "invalid"; readonly detail: string};

const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const BAR_NAMES: ReadonlySet<string> = new Set<LayoutBar>(["activitybar", "statusbar"]);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteSize = (value: unknown): boolean => isObject(value) && typeof value.width === "number" && Number.isFinite(value.width) && value.width >= 0 && typeof value.height === "number" && Number.isFinite(value.height) && value.height >= 0;

function validateNode(value: unknown, seen: Set<string>, depth: number): string | null {
    if (!isObject(value)) return "节点不是对象";
    if (typeof value.id !== "string" || value.id === "" || FORBIDDEN_IDS.has(value.id)) return `非法 id：${String(value.id)}`;
    if (seen.has(value.id)) return `重复 id：${value.id}`;
    seen.add(value.id);
    if (seen.size > GRID_MAX_NODES) return "节点太多";
    if (depth > GRID_MAX_DEPTH) return "层数太深";
    if (!isFiniteSize(value.size)) return `节点 ${value.id} 的尺寸不合法`;
    if (value.kind === "leaf") return typeof value.ref === "string" ? null : `叶 ${value.id} 没有 ref`;
    if (value.kind !== "branch" || (value.orientation !== "horizontal" && value.orientation !== "vertical") || !Array.isArray(value.children)) return `节点 ${value.id} 不合法`;
    for (const child of value.children) {
        const problem = validateNode(child, seen, depth + 1);
        if (problem !== null) return problem;
    }
    return null;
}

const isTabRef = (value: unknown): value is TabRef => isObject(value)
    && ((value.kind === "view" && typeof value.viewId === "string") || (value.kind === "tab" && typeof value.type === "string" && typeof value.tabId === "string"));

/** 形状的唯一权威（读记录时调）。工作台的 TypeBox 只管外层版本与字节。 */
export function validateLayoutDoc(value: unknown): LayoutDocValidation {
    const invalid = (detail: string): LayoutDocValidation => ({ok: false, code: "invalid", detail});
    if (!isObject(value)) return invalid("文档不是对象");
    if (value.version !== LAYOUT_DOC_VERSION) return {ok: false, code: "unsupported-version", detail: `版本 ${String(value.version)}`};
    if (!isObject(value.tree) || value.tree.version !== GRID_SNAPSHOT_VERSION) return invalid("树的版本不对");
    const seen = new Set<string>();
    const nodeProblem = validateNode(value.tree.root, seen, 1);
    if (nodeProblem !== null) return invalid(nodeProblem);
    if (!isObject(value.panels) || !Array.isArray(value.floats) || value.floats.length !== 0 || !Array.isArray(value.hiddenBars)) return invalid("缺字段");
    if (!value.hiddenBars.every((bar) => BAR_NAMES.has(bar as string))) return invalid("hiddenBars 不合法");
    if (value.currentEditor !== null) {
        const current = typeof value.currentEditor === "string" ? value.panels[value.currentEditor] : undefined;
        if (!isObject(current) || current.role !== "editor") return invalid("currentEditor 不是编辑组");
    }

    const leaves = treeLeaves(value.tree.root as GridSnapshotNode);
    const refs = leaves.map((leaf) => leaf.ref);
    if (refs.filter((ref) => ref === barRef("activitybar")).length !== 1 || refs.filter((ref) => ref === barRef("statusbar")).length !== 1) return invalid("条要恰各一个");
    const inTree = new Set<string>();
    for (const leaf of leaves) {
        const bar = barOfRef(leaf.ref);
        if (bar !== null) {
            if (!BAR_NAMES.has(bar)) return invalid(`不认识的条：${bar}`);
            continue;
        }
        const panelId = panelOfRef(leaf.ref);
        if (panelId === null || panelId !== leaf.id) return invalid(`叶 ${leaf.id} 的引用不对`);
        if (inTree.has(panelId)) return invalid(`面板 ${panelId} 被引用两次`);
        inTree.add(panelId);
    }

    const panelIds = Object.keys(value.panels);
    const tabKeys = new Set<string>();
    const names = new Set<string>();
    let editors = 0;
    for (const id of panelIds) {
        if (FORBIDDEN_IDS.has(id)) return invalid(`非法面板 id：${id}`);
        if (!inTree.has(id)) return invalid(`面板 ${id} 不在树里`);
        const panel = value.panels[id];
        if (!isObject(panel) || (panel.role !== "tool" && panel.role !== "editor") || !Array.isArray(panel.tabs) || !panel.tabs.every(isTabRef)) return invalid(`面板 ${id} 不合法`);
        if (panel.role === "editor") editors += 1;
        if (panel.role === "editor" && (panel.name !== undefined || panel.hidden !== undefined || panel.collapsed !== undefined)) return invalid(`编辑组 ${id} 不能具名、隐藏或收起`);
        if (panel.hidden !== undefined && (panel.hidden !== true || panel.name === undefined)) return invalid(`面板 ${id} 的隐藏不合法：只有具名面板会隐藏`);
        if (panel.collapsed !== undefined && typeof panel.collapsed !== "boolean") return invalid(`面板 ${id} 的收起不合法`);
        if (panel.active !== null && typeof panel.active !== "string") return invalid(`面板 ${id} 的活动标签不合法`);
        if (panel.name !== undefined) {
            if ((panel.name !== "sidebar" && panel.name !== "auxiliarybar" && panel.name !== "panel") || names.has(panel.name)) return invalid(`面板名不合法：${String(panel.name)}`);
            names.add(panel.name);
        }
        const keys = (panel.tabs as TabRef[]).map(tabKey);
        for (const key of keys) {
            if (tabKeys.has(key)) return invalid(`标签重复：${key}`);
            tabKeys.add(key);
        }
        if (panel.active !== null && !keys.includes(panel.active as string)) return invalid(`面板 ${id} 的活动标签不在标签里`);
    }
    if (inTree.size !== panelIds.length) return invalid("树里有未登记的面板");
    if (editors === 0) return invalid("至少要有一个编辑组");
    return {ok: true, doc: value as unknown as LayoutDoc};
}
