/**
 * 编辑器和布局持有者之间的接缝（docs/specs/ui/workbench-layout.md 输出 33）：`PanelTabs`、`PanelTree` 的语义，操作是真实的 nb-layout 领域操作。
 */
import {describe, expect, it} from "bun:test";

import {barRef, findTreeNode, GRID_SNAPSHOT_VERSION, LAYOUT_DOC_VERSION, panelRef, treeLeaves} from "@notnotype/nb-layout";
import type {LayoutDoc} from "@notnotype/nb-layout";

import {createMemoryEditorPanels} from "./editor-panels";

function panels(seed?: LayoutDoc) {
    const local = createMemoryEditorPanels(seed);
    const order = (id: string): ReadonlyArray<string> => local.tabs.panels.value.find((panel) => panel.id === id)?.tabs ?? [];
    const active = (id: string): string | null => local.tabs.panels.value.find((panel) => panel.id === id)?.active ?? null;
    const ids = (): ReadonlyArray<string> => local.tabs.panels.value.map((panel) => panel.id);
    return {...local, order, active, ids};
}

describe("PanelTabs", () => {
    it("插入：放到给定位置，成为活动标签，面板成为活动面板；已有的 id 不插；位置超出放末尾", () => {
        const p = panels();
        const right = p.tree.openAtEdge("g0", "right") as string;
        expect(p.tree.current.value).toBe("g0");
        expect(p.tabs.insert(right, "a", 0)).toBe(true);
        expect(p.tree.current.value).toBe(right);
        expect(p.tabs.insert(right, "b", 0)).toBe(true);
        expect(p.tabs.insert(right, "c", 99)).toBe(true);
        expect(p.order(right)).toEqual(["b", "a", "c"]);
        expect(p.active(right)).toBe("c");
        expect(p.tabs.insert("g0", "a", 0)).toBe(false);
        expect(p.tabs.insert("nope", "z", 0)).toBe(false);
    });

    it("替换：就地，活动标签跟着换；不是活动标签时活动不变", () => {
        const p = panels();
        p.tabs.insert("g0", "a", 0);
        p.tabs.insert("g0", "b", 1);
        expect(p.tabs.replace("b", "b2")).toBe(true);
        expect(p.order("g0")).toEqual(["a", "b2"]);
        expect(p.active("g0")).toBe("b2");
        expect(p.tabs.replace("a", "a2")).toBe(true);
        expect(p.active("g0")).toBe("b2");
        expect(p.tabs.replace("b2", "a2")).toBe(false);
        expect(p.tabs.replace("nope", "x")).toBe(false);
    });

    it("拿掉：活动的换到右边，没有时左边；不是活动的不影响活动", () => {
        const p = panels();
        for (const [at, id] of ["a", "b", "c"].entries()) p.tabs.insert("g0", id, at);
        p.tabs.activate("b");
        p.tabs.remove("b");
        expect(p.active("g0")).toBe("c");
        p.tabs.remove("c");
        expect(p.active("g0")).toBe("a");
        p.tabs.insert("g0", "d", 0);
        p.tabs.remove("a");
        expect(p.active("g0")).toBe("d");
        expect(p.tabs.remove("nope")).toBe(false);
    });

    it("面板拿空：还有别的面板时移除，活动面板换到相邻的；最后一块留着", () => {
        const p = panels();
        const middle = p.tree.openAtEdge("g0", "right") as string;
        const last = p.tree.openAtEdge(middle, "right") as string;
        p.tabs.insert(last, "c", 0);
        p.tabs.insert(middle, "b", 0);
        p.tabs.remove("b");
        expect(p.ids()).toEqual(["g0", last]);
        expect(p.tree.current.value).toBe(last);
        expect(findTreeNode(p.document().tree.root, middle)).toBeNull();
        p.tabs.remove("c");
        expect(p.ids()).toEqual(["g0"]);
        expect(p.tree.current.value).toBe("g0");
        p.tabs.insert("g0", "a", 0);
        p.tabs.remove("a");
        expect(p.ids()).toEqual(["g0"]);
        expect(p.active("g0")).toBeNull();
    });

    it("移动的位置是摘掉来源之前的插入位，和拖动时看到的一致", () => {
        const p = panels();
        for (const [at, id] of ["a", "b", "c", "d"].entries()) p.tabs.insert("g0", id, at);
        p.tabs.move("a", "g0", 3);
        expect(p.order("g0")).toEqual(["b", "c", "a", "d"]);
        p.tabs.move("d", "g0", 0);
        expect(p.order("g0")).toEqual(["d", "b", "c", "a"]);
    });

    it("移动缺省成为活动标签、面板成为活动面板；只换位置时都不变", () => {
        const p = panels();
        const right = p.tree.openAtEdge("g0", "right") as string;
        for (const [at, id] of ["a", "b"].entries()) p.tabs.insert("g0", id, at);
        p.tabs.insert(right, "c", 0);
        p.tabs.activate("b");

        p.tabs.move("a", "g0", 2, {activate: false});
        expect(p.order("g0")).toEqual(["b", "a"]);
        expect(p.active("g0")).toBe("b");
        expect(p.tree.current.value).toBe("g0");

        p.tabs.move("b", right, 0, {activate: false});
        expect(p.active(right)).toBe("c");
        expect(p.tree.current.value).toBe("g0");

        p.tabs.move("c", "g0", 0);
        expect(p.active("g0")).toBe("c");
        expect(p.tree.current.value).toBe("g0");
        expect(p.active(right)).toBe("b");
    });

    it("跨面板移动：来源拿空时随之移除，活动面板是目标", () => {
        const p = panels();
        const right = p.tree.openAtEdge("g0", "right") as string;
        p.tabs.insert("g0", "a", 0);
        p.tabs.insert(right, "b", 0);
        expect(p.tree.current.value).toBe(right);
        p.tabs.move("b", "g0", 1);
        expect(p.ids()).toEqual(["g0"]);
        expect(p.order("g0")).toEqual(["a", "b"]);
        expect(p.tree.current.value).toBe("g0");
    });

    it("移到外缘：多标签拆出新面板，不改活动面板；只有一个标签时是同一块面板，返回它自己；和现在一样时是 null", () => {
        const p = panels();
        for (const [at, id] of ["a", "b"].entries()) p.tabs.insert("g0", id, at);
        const split = p.tabs.moveToEdge("b", {kind: "split", panel: "g0", edge: "right"}) as string;
        expect(p.ids()).toEqual(["g0", split]);
        expect(p.order(split)).toEqual(["b"]);
        expect(p.tabs.moveToEdge("b", {kind: "split", panel: split, edge: "left"})).toBeNull();
        expect(p.tabs.moveToEdge("b", {kind: "split", panel: "g0", edge: "left"})).toBe(split);
        expect(p.ids()).toEqual([split, "g0"]);
    });
});

describe("PanelTree", () => {
    it("在一边开空面板：列表顺序和方向跟着边，不改活动面板", () => {
        const p = panels();
        const right = p.tree.openAtEdge("g0", "right") as string;
        const left = p.tree.openAtEdge("g0", "left") as string;
        expect(p.ids()).toEqual([left, "g0", right]);
        const below = p.tree.openAtEdge(right, "bottom") as string;
        const above = p.tree.openAtEdge(right, "top") as string;
        expect(p.ids()).toEqual([left, "g0", above, right, below]);
        expect(p.tree.current.value).toBe("g0");
        expect(p.tree.openAtEdge("nope", "right")).toBeNull();
    });

    it("右侧相邻：取一列最上面的；最右边没有", () => {
        const p = panels();
        const right = p.tree.openAtEdge("g0", "right") as string;
        const below = p.tree.openAtEdge(right, "bottom") as string;
        expect(p.tree.rightOf("g0")).toBe(right);
        expect(p.tree.rightOf(right)).toBeNull();
        expect(p.tree.rightOf(below)).toBeNull();
    });

    it("活动面板：只接受存在的面板", () => {
        const p = panels();
        const right = p.tree.openAtEdge("g0", "right") as string;
        expect(p.tree.setCurrent(right)).toBe(true);
        expect(p.tree.current.value).toBe(right);
        expect(p.tree.setCurrent("nope")).toBe(false);
        expect(p.tree.current.value).toBe(right);
    });

    it("恢复的文档：新面板的 id 不和已有的撞", () => {
        const first = panels();
        const right = first.tree.openAtEdge("g0", "right") as string;
        const restored = panels(first.document());
        const opened = restored.tree.openAtEdge(right, "right") as string;
        expect(["g0", right]).not.toContain(opened);
        expect(treeLeaves(restored.document().tree.root).map((leaf) => leaf.id)).toEqual(["g0", right, opened]);
    });

    it("工具面板不算：列表、活动面板、右侧相邻都只认编辑组，结构操作进不了工具面板", () => {
        const leaf = (id: string) => ({kind: "leaf" as const, id, ref: panelRef(id), size: {width: 100, height: 100}});
        const doc: LayoutDoc = {
            version: LAYOUT_DOC_VERSION,
            tree: {version: GRID_SNAPSHOT_VERSION, root: {kind: "branch", id: "root", orientation: "horizontal", size: {width: 500, height: 100}, children: [
                {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size: {width: 48, height: 100}},
                leaf("sidebar"), leaf("g0"), leaf("tool"), leaf("g1"), leaf("aux"),
            ]}},
            panels: {
                sidebar: {role: "tool", name: "sidebar", tabs: [{kind: "view", viewId: "x"}], active: "view:x"},
                g0: {role: "editor", tabs: [], active: null},
                tool: {role: "tool", tabs: [{kind: "view", viewId: "y"}], active: "view:y"},
                g1: {role: "editor", tabs: [], active: null},
                aux: {role: "tool", name: "auxiliarybar", tabs: [{kind: "view", viewId: "z"}], active: "view:z"},
            },
            floats: [],
            hiddenBars: [],
            currentEditor: null,
        };
        const p = panels(doc);
        expect(p.ids()).toEqual(["g0", "g1"]);
        expect(p.tree.current.value).toBe("g0");
        expect(p.tree.rightOf("g0")).toBe("g1");
        expect(p.tree.rightOf("g1")).toBeNull();
        expect(p.tree.setCurrent("sidebar")).toBe(false);
        expect(p.tabs.insert("tool", "a", 0)).toBe(false);
        expect(p.tree.openAtEdge("tool", "right")).toBeNull();
    });
});
