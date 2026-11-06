/**
 * 布局文档测试用的小语言：`H(["sidebar", V(["e", "panel"])])` 写一棵树，叶的尺寸默认均分一个 1000×600 的窗口。只给测试用。
 */

import {GRID_SNAPSHOT_VERSION} from "./grid-types";
import type {GridExtent, GridOrientation, GridSnapshotNode} from "./grid-types";
import {barOfRef, barRef, panelRef, tabKey} from "./layout-doc";
import type {LayoutBar, LayoutDoc, LayoutPolicy, PanelName, PanelRecord, TabRef} from "./layout-doc";

type Shape = string | {readonly orientation: GridOrientation; readonly children: ReadonlyArray<Shape>; readonly id?: string};

export const H = (children: ReadonlyArray<Shape>, id?: string): Shape => ({orientation: "horizontal", children, ...(id === undefined ? {} : {id})});
export const V = (children: ReadonlyArray<Shape>, id?: string): Shape => ({orientation: "vertical", children, ...(id === undefined ? {} : {id})});

const BARS = new Set<string>(["activitybar", "statusbar"]);

function build(shape: Shape, size: GridExtent, counter: {value: number}): GridSnapshotNode {
    if (typeof shape === "string") {
        return {kind: "leaf", id: shape, ref: BARS.has(shape) ? barRef(shape as LayoutBar) : panelRef(shape), size};
    }
    counter.value += 1;
    const id = shape.id ?? `b${String(counter.value)}`;
    const main = shape.orientation === "horizontal" ? "width" : "height";
    const share = size[main] / shape.children.length;
    return {kind: "branch", id, orientation: shape.orientation, size, children: shape.children.map((child) => build(child, {...size, [main]: share}, counter))};
}

export const view = (viewId: string): TabRef => ({kind: "view", viewId});
export const tab = (tabId: string): TabRef => ({kind: "tab", type: "nbook.editor", tabId});

/** 叶名以 `e` 开头的是编辑组，其余是工具面板；`sidebar`、`auxiliarybar`、`panel` 是具名面板。每块一个同名标签，除非 `tabs` 里另给。 */
export function docOf(shape: Shape, overrides: Readonly<Record<string, Partial<PanelRecord>>> = {}): LayoutDoc {
    const root = build(shape, {width: 1000, height: 600}, {value: 0});
    const panels: Record<string, PanelRecord> = {};
    const walk = (node: GridSnapshotNode): void => {
        if (node.kind === "branch") {
            node.children.forEach(walk);
            return;
        }
        if (barOfRef(node.ref) !== null) return;
        const isEditor = node.id.startsWith("e");
        const named = node.id === "sidebar" || node.id === "auxiliarybar" || node.id === "panel";
        const tabs = overrides[node.id]?.tabs ?? [isEditor ? tab(node.id) : view(node.id)];
        panels[node.id] = {role: isEditor ? "editor" : "tool", ...(named ? {name: node.id as PanelName} : {}), tabs, active: tabs[0] === undefined ? null : tabKey(tabs[0]), ...overrides[node.id]};
    };
    walk(root);
    return {version: 1, tree: {version: GRID_SNAPSHOT_VERSION, root}, panels, floats: [], hiddenBars: [], currentEditor: Object.keys(panels).find((id) => panels[id]?.role === "editor") ?? null};
}

/** 树的形状，写成和 `H`、`V` 对应的字符串，方便断言。 */
export function shapeOf(node: GridSnapshotNode): string {
    if (node.kind === "leaf") return node.id;
    return `${node.orientation === "horizontal" ? "H" : "V"}[${node.children.map(shapeOf).join(",")}]`;
}

export function sizeOf(root: GridSnapshotNode, id: string): GridExtent {
    const find = (node: GridSnapshotNode): GridSnapshotNode | null => {
        if (node.id === id) return node;
        if (node.kind === "leaf") return null;
        for (const child of node.children) {
            const found = find(child);
            if (found !== null) return found;
        }
        return null;
    };
    const found = find(root);
    if (found === null) throw new Error(`树里没有 ${id}`);
    return found.size;
}

/** 接受矩阵（docs/specs/ui/workbench-layout.md 输出 26）。 */
export function testPolicy(overrides: Partial<LayoutPolicy> = {}): LayoutPolicy {
    let counter = 0;
    return {
        accepts: (tabs, target, region) => region === "edge" || tabs.every((candidate) => (candidate.kind === "view" ? target.role === "tool" : target.role === "editor")),
        newId: (kind) => {
            counter += 1;
            return `${kind === "panel" ? "n" : "nb"}${String(counter)}`;
        },
        ...overrides,
    };
}
