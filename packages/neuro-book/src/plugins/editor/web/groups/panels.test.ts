/**
 * 编辑器和布局持有者之间的接缝（docs/specs/ui/workbench-layout.md 输出 33）：`PanelTabs`、`PanelTree` 的语义对齐 nb-layout 的领域操作，合成一棵树之后换实现时这些场景照样要成立。
 */
import {describe, expect, it} from "bun:test";

import {createLocalPanels, restorePanelGrid} from "./panels";
import type {PanelCanInsert} from "./panels";

function panels(canInsert?: PanelCanInsert) {
    const local = createLocalPanels(null, canInsert);
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
        expect(p.grid.find(middle)).toBeNull();
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

    it("编辑器不答应的位置不动；问的是摘掉来源之后的位置", () => {
        const asked: number[] = [];
        const p = panels((tabId, _panel, at) => {
            asked.push(at);
            return !(tabId === "c" && at === 0);
        });
        for (const [at, id] of ["a", "b", "c"].entries()) p.tabs.insert("g0", id, at);
        expect(p.tabs.move("c", "g0", 0)).toBe(false);
        expect(p.order("g0")).toEqual(["a", "b", "c"]);
        expect(p.tabs.move("a", "g0", 2)).toBe(true);
        expect(asked).toEqual([0, 1]);
        expect(p.order("g0")).toEqual(["b", "a", "c"]);
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

    it("恢复的布局：新面板的 id 不和已有的撞；叶和面板对不上时不接受", () => {
        const first = panels();
        const right = first.tree.openAtEdge("g0", "right") as string;
        const ids = new Set(["g0", right]);
        const grid = restorePanelGrid(first.grid.serialize(), ids);
        expect(grid).not.toBeNull();
        const restored = createLocalPanels({grid: grid!, panels: [{id: "g0", tabs: [], active: null}, {id: right, tabs: [], active: null}], current: right});
        const opened = restored.tree.openAtEdge(right, "right") as string;
        expect(ids.has(opened)).toBe(false);
        expect(restorePanelGrid(first.grid.serialize(), new Set(["g0"]))).toBeNull();
    });
});
