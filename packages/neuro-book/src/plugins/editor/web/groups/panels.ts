/**
 * 编辑组的结构（docs/specs/ui/workbench-layout.md 输出 33）：哪块面板有哪些标签 id、活动标签是谁、面板怎么排。标签的地址、编辑器这些属性归编辑器，不在这里。
 *
 * 这是编辑器和布局持有者之间的接缝。现在是编辑区自己的一棵 grid（`createLocalPanels`）；合成一棵树之后由工作台的布局文档实现，所以方法的语义对齐 nb-layout 的领域操作
 * （`insertTab`、`replaceTab`、`removeTab`、`activateTab`、`moveTabToStrip`、`openPanelAtEdge`、`edgeTargetOf`），编辑器只经这两个接口改结构。
 */

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

// 只要 grid 的结构与快照，不要渲染器：`./grid` 不依赖 Vue 与 DOM，插件激活时就能用、Bun 里也能测。
import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridLeafInput, GridNode, GridSnapshot} from "@notnotype/nb-layout";

export interface PanelEntry {
    readonly id: string;
    readonly tabs: ReadonlyArray<string>;
    /** 活动标签的 id；空面板为 null。 */
    readonly active: string | null;
}

export type PanelEdge = "left" | "right" | "top" | "bottom";

export interface PanelTabs {
    readonly panels: Readonly<ShallowRef<ReadonlyArray<PanelEntry>>>;
    /** 插到 `index`，成为活动标签，面板成为活动面板。 */
    insert(panel: string, tabId: string, index: number): boolean;
    /** 就地换成另一个标签；原来的是活动标签时新的也是。 */
    replace(tabId: string, next: string): boolean;
    /** 拿掉：活动标签被拿掉时换到右边的（没有时左边）；面板空了且还有别的面板时面板随之移除，活动面板换到相邻的。 */
    remove(tabId: string): boolean;
    /** 成为活动标签，面板成为活动面板。 */
    activate(tabId: string): boolean;
    /**
     * 移到 `panel` 的 `index`（摘掉来源之前的插入位，和拖动时看到的位置一致）。缺省成为活动标签、面板成为活动面板；`activate: false` 只换位置。来源面板空了同 `remove`。
     * `canInsert` 不答应时不动。
     */
    move(tabId: string, panel: string, index: number, options?: {readonly activate?: boolean}): boolean;
}

export interface PanelTree {
    /** 活动面板：最近获得焦点或执行过打开的那块。 */
    readonly current: Readonly<ShallowRef<string>>;
    setCurrent(panel: string): boolean;
    /** 在 `panel` 的一边开一块空面板，返回它的 id。不改活动面板：打开时才切过去。 */
    openAtEdge(panel: string, edge: PanelEdge): string | null;
    /** 右侧相邻的面板：右边是一列时取最上面的。没有为 null；只查不建。 */
    rightOf(panel: string): string | null;
}

/** 编辑器回答：这个标签能插到这个位置吗（固定分区）。`at` 是摘掉来源之后的位置。 */
export type PanelCanInsert = (tabId: string, panel: PanelEntry, at: number) => boolean;

/**
 * 面板之间的分隔线占 1px（与工作台的分隔线相同）。nb-ui 把 0px 的分隔线当作不可交互的接缝：不画线、不能拖，所以这里不能取 0。
 */
const PANEL_SASH_PX = 1;
/** 编辑组的最小尺寸：再窄放不下一个截断的标签与标题动作的“⋯”。 */
const PANEL_MIN_SIZE = {width: 220, height: 120} as const;
const FIRST_PANEL = "g0";

const panelLeaf = (id: string): GridLeafInput<string> => ({kind: "leaf", id, ref: id, minimumSize: PANEL_MIN_SIZE});

/** 恢复布局：叶与 `ids` 一一对应才接受（渲染按叶的 id 找面板，叶的 id 与 ref 不一致的记录同样当作坏了）；否则返回 null。 */
export function restorePanelGrid(snapshot: GridSnapshot, ids: ReadonlySet<string>): Grid<string> | null {
    const grid = createGrid<string>(null, {sashSize: PANEL_SASH_PX});
    const restored = grid.restore(snapshot, (ref) => (ids.has(ref) ? {ref, minimumSize: PANEL_MIN_SIZE} : null));
    if (!restored.ok || restored.dropped.length > 0) return null;
    const leaves = leavesOf(grid.root());
    return leaves.length === ids.size && leaves.every((leaf) => leaf.id === leaf.ref && ids.has(leaf.ref)) ? grid : null;
}

function leavesOf(node: GridNode<string> | null): Array<{readonly id: string; readonly ref: string}> {
    if (node === null) return [];
    if (node.kind === "leaf") return [{id: node.id, ref: node.ref}];
    return node.children.flatMap(leavesOf);
}

/**
 * 叶 `id` 右侧相邻的叶：自下而上找第一个横向分支里它后面还有兄弟的祖先，再从那个兄弟里取最左（横向取第一个、纵向取第一个）的叶。
 */
function rightNeighbor(root: GridNode<string> | null, id: string): string | null {
    const path: GridNode<string>[] = [];
    const walk = (node: GridNode<string>): boolean => {
        path.push(node);
        if (node.kind === "leaf" ? node.id === id : node.children.some(walk)) return true;
        path.pop();
        return false;
    };
    if (root === null || !walk(root)) return null;
    for (let at = path.length - 2; at >= 0; at -= 1) {
        const branch = path[at] as GridNode<string>;
        if (branch.kind !== "branch" || branch.orientation !== "horizontal") continue;
        const index = branch.children.indexOf(path[at + 1] as GridNode<string>);
        let next = branch.children[index + 1];
        if (next === undefined) continue;
        while (next.kind === "branch") next = next.children[0] as GridNode<string>;
        return next.id;
    }
    return null;
}

export interface LocalPanelsSeed {
    readonly grid: Grid<string>;
    readonly panels: ReadonlyArray<PanelEntry>;
    readonly current: string;
}

export interface LocalPanels {
    readonly tabs: PanelTabs;
    readonly tree: PanelTree;
    /** 编辑区自己的 grid；合成一棵树之后没有这两项。 */
    readonly grid: Grid<string>;
    readonly layoutVersion: Readonly<ShallowRef<number>>;
}

/** 至少一块面板：`seed` 为 null 时从一块空面板开始。 */
export function createLocalPanels(seed: LocalPanelsSeed | null, canInsert?: PanelCanInsert): LocalPanels {
    const grid = seed?.grid ?? createGrid<string>(panelLeaf(FIRST_PANEL), {sashSize: PANEL_SASH_PX});
    const panels = shallowRef<ReadonlyArray<PanelEntry>>(seed?.panels ?? [{id: FIRST_PANEL, tabs: [], active: null}]);
    const current = shallowRef(seed?.current ?? FIRST_PANEL);
    const layoutVersion = shallowRef(0);

    let counter = 0;
    /** 新的面板与分支 id：跳过恢复出来的布局里已有的。 */
    const newId = (prefix: string): string => {
        for (;;) {
            counter += 1;
            const id = `${prefix}${String(counter)}`;
            if (grid.find(id) === null) return id;
        }
    };

    const entryOf = (id: string): PanelEntry | undefined => panels.value.find((panel) => panel.id === id);
    const write = (entry: PanelEntry): void => {
        panels.value = panels.value.map((panel) => (panel.id === entry.id ? entry : panel));
    };
    const locate = (tabId: string): {readonly entry: PanelEntry; readonly index: number} | null => {
        for (const entry of panels.value) {
            const index = entry.tabs.indexOf(tabId);
            if (index >= 0) return {entry, index};
        }
        return null;
    };

    /** 拿掉一个标签后的面板，不落库。活动标签被拿掉时换到右边的，没有时左边。 */
    const without = (entry: PanelEntry, index: number): PanelEntry => {
        const tabs = entry.tabs.filter((_, at) => at !== index);
        return {...entry, tabs, active: entry.active === entry.tabs[index] ? (tabs[index] ?? tabs[index - 1] ?? null) : entry.active};
    };

    const dropIfEmpty = (id: string): void => {
        const entry = entryOf(id);
        if (entry === undefined || entry.tabs.length > 0 || panels.value.length <= 1) return;
        const index = panels.value.indexOf(entry);
        if (!grid.removeLeaf(id).ok) return;
        panels.value = panels.value.filter((panel) => panel.id !== id);
        layoutVersion.value += 1;
        if (current.value === id) current.value = (panels.value[Math.min(index, panels.value.length - 1)] as PanelEntry).id;
    };

    const tabs: PanelTabs = {
        panels,
        insert: (panel, tabId, index) => {
            const entry = entryOf(panel);
            if (entry === undefined || locate(tabId) !== null) return false;
            const next = [...entry.tabs];
            next.splice(Math.min(index, next.length), 0, tabId);
            write({...entry, tabs: next, active: tabId});
            current.value = panel;
            return true;
        },
        replace: (tabId, next) => {
            const found = locate(tabId);
            if (found === null || locate(next) !== null) return false;
            write({...found.entry, tabs: found.entry.tabs.map((id) => (id === tabId ? next : id)), active: found.entry.active === tabId ? next : found.entry.active});
            return true;
        },
        remove: (tabId) => {
            const found = locate(tabId);
            if (found === null) return false;
            write(without(found.entry, found.index));
            dropIfEmpty(found.entry.id);
            return true;
        },
        activate: (tabId) => {
            const found = locate(tabId);
            if (found === null) return false;
            current.value = found.entry.id;
            if (found.entry.active !== tabId) write({...found.entry, active: tabId});
            return true;
        },
        move: (tabId, panel, index, options) => {
            const found = locate(tabId);
            const target = entryOf(panel);
            if (found === null || target === undefined) return false;
            const same = found.entry.id === panel;
            const at = Math.max(0, same && found.index < index ? index - 1 : index);
            if (canInsert?.(tabId, target, at) === false) return false;
            const activate = options?.activate !== false;
            // 先定活动面板：来源面板随后被移除时，活动面板已经不是它，不会换到相邻的。
            if (activate) current.value = panel;
            const base = same ? without(found.entry, found.index) : target;
            const next = [...base.tabs];
            next.splice(Math.min(at, next.length), 0, tabId);
            const active = activate ? tabId : (same ? found.entry.active : (target.active ?? tabId));
            if (!same) write(without(found.entry, found.index));
            write({...base, tabs: next, active});
            if (!same) dropIfEmpty(found.entry.id);
            return true;
        },
    };

    const tree: PanelTree = {
        current,
        setCurrent: (panel) => {
            if (entryOf(panel) === undefined) return false;
            current.value = panel;
            return true;
        },
        openAtEdge: (panel, edge) => {
            if (entryOf(panel) === undefined) return null;
            const id = newId("g");
            const before = edge === "left" || edge === "top";
            const result = grid.splitLeaf(panel, {branchId: newId("b"), orientation: edge === "left" || edge === "right" ? "horizontal" : "vertical", side: before ? "before" : "after", leaf: panelLeaf(id)});
            if (!result.ok) return null;
            const at = panels.value.findIndex((candidate) => candidate.id === panel);
            const next = [...panels.value];
            next.splice(before ? at : at + 1, 0, {id, tabs: [], active: null});
            panels.value = next;
            layoutVersion.value += 1;
            return id;
        },
        rightOf: (panel) => {
            const right = rightNeighbor(grid.root(), panel);
            return right !== null && entryOf(right) !== undefined ? right : null;
        },
    };

    return {tabs, tree, grid, layoutVersion};
}
