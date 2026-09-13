import {describe, expect, it} from "vitest";
import {
    createGrid,
    GRID_SNAPSHOT_VERSION,
    type GridBranch,
    type GridLeaf,
    type GridNode,
    type GridSnapshot,
} from "./grid";

/** 两列 + 中列上下分层：root(horizontal){ left, center(vertical){ editor, panel } } */
function fixture(): GridNode<string> {
    const leaf = (id: string, size: number, minimumSize = 100, maximumSize = 800): GridLeaf<string> => ({
        kind: "leaf",
        id,
        ref: id,
        minimumSize,
        maximumSize,
        size,
    });
    const center: GridBranch<string> = {
        kind: "branch",
        id: "center",
        orientation: "vertical",
        children: [leaf("editor", 400), leaf("panel", 200)],
    };
    return {
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [leaf("left", 300), center],
    };
}

function leafSize(node: GridNode<string> | null, id: string): number | null {
    if (!node) {
        return null;
    }
    if (node.kind === "leaf") {
        return node.id === id ? node.size : null;
    }
    for (const child of node.children) {
        const hit = leafSize(child, id);
        if (hit !== null) {
            return hit;
        }
    }
    return null;
}

function parentOf(node: GridNode<string> | null, id: string, parent = ""): string | null {
    if (!node) {
        return null;
    }
    if (node.id === id) {
        return parent;
    }
    if (node.kind === "branch") {
        for (const child of node.children) {
            const hit = parentOf(child, id, node.id);
            if (hit !== null) {
                return hit;
            }
        }
    }
    return null;
}

describe("拆分树原语：尺寸边界", () => {
    it("叶子尺寸越界会被夹取到 min/max", () => {
        const grid = createGrid(fixture());
        grid.resize("editor", -10000);
        expect(leafSize(grid.root(), "editor")).toBe(100);
        grid.resize("editor", 10000);
        expect(leafSize(grid.root(), "editor")).toBe(800);
    });

    it("resize 越过上限时停在 max，同分支兄弟按比例吸收", () => {
        const grid = createGrid(fixture());
        const before = leafSize(grid.root(), "panel")!;
        grid.resize("editor", 50);
        expect(leafSize(grid.root(), "editor")).toBe(450);
        const after = leafSize(grid.root(), "panel")!;
        expect(after).toBeLessThan(before);
        expect(after + 450).toBeCloseTo(before + 400, 5);
    });

    it("父链多点同时触界时逐级夹取，不产生负值", () => {
        const grid = createGrid(fixture());
        grid.resize("panel", -10000);
        const panel = leafSize(grid.root(), "panel")!;
        const editor = leafSize(grid.root(), "editor")!;
        expect(panel).toBeGreaterThanOrEqual(100);
        expect(editor).toBeGreaterThanOrEqual(100);
    });
});

describe("拆分树原语：结构", () => {
    it("addLeaf 到未知父返回失败而不是抛异常", () => {
        const grid = createGrid(fixture());
        const result = grid.addLeaf("nope", 0, {kind: "leaf", id: "extra", ref: "extra", minimumSize: 10, maximumSize: 100, size: 50});
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toContain("未知父节点");
    });

    it("moveLeaf 到自身（或自身子树）返回失败", () => {
        const grid = createGrid(fixture());
        // 叶子不可能包含子树，因此可实现的真实用例是把叶子移到它自己
        const self = grid.moveLeaf("editor", "editor", 0);
        expect(self.ok).toBe(false);
        expect(self.ok === false && self.reason).toContain("自身子树");
        // 分支节点不走移动路径（本期只移动叶子）
        const branch = grid.moveLeaf("center", "editor", 0);
        expect(branch.ok).toBe(false);
    });

    it("removeLeaf 删掉分支最后一个子节点时空分支塌陷", () => {
        const grid = createGrid(fixture());
        expect(grid.removeLeaf("panel").ok).toBe(true);
        // center 只剩一个子节点 → 分支塌陷，child 顶替分支自身
        const afterCollapse = grid.root() as GridBranch<string>;
        expect(afterCollapse.children.map((child) => child.id)).toEqual(["left", "editor"]);
        expect(grid.removeLeaf("editor").ok).toBe(true);
        // 根只剩一个子节点 → 整棵树收敛为单叶根
        const root = grid.root();
        expect(root?.kind).toBe("leaf");
        expect(root?.id).toBe("left");
    });

    it("空树合法：可以往空根加叶子", () => {
        const grid = createGrid<string>(null);
        const empty = grid.serialize();
        expect(empty.root.kind).toBe("branch");
        expect((empty.root as GridBranch<string>).children).toHaveLength(0);
        grid.restore({version: GRID_SNAPSHOT_VERSION, root: {kind: "branch", id: "root", orientation: "horizontal", children: []}}, (ref) => ref);
        const result = grid.addLeaf("root", 0, {kind: "leaf", id: "only", ref: "only", minimumSize: 10, maximumSize: 100, size: 50});
        expect(result.ok).toBe(true);
        expect(leafSize(grid.root(), "only")).toBe(50);
    });

    it("单叶根合法：删掉它之后树为空", () => {
        const grid = createGrid<string>({kind: "leaf", id: "only", ref: "only", minimumSize: 10, maximumSize: 100, size: 50});
        expect(grid.removeLeaf("only").ok).toBe(true);
        expect(grid.root()).toBeNull();
    });

    it("删叶后同分支兄弟按现有尺寸比例吸收，分支总和不变", () => {
        // 只有同分支的兄弟参与吸收：跨分支的另一列不动
        const pair: GridBranch<string> = {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", minimumSize: 10, maximumSize: 1000, size: 300},
                {
                    kind: "branch",
                    id: "pair",
                    orientation: "vertical",
                    children: [
                        {kind: "leaf", id: "alpha", ref: "alpha", minimumSize: 10, maximumSize: 1000, size: 100},
                        {kind: "leaf", id: "beta", ref: "beta", minimumSize: 10, maximumSize: 1000, size: 300},
                    ],
                },
            ],
        };
        const grid = createGrid(pair);
        expect(grid.removeLeaf("alpha").ok).toBe(true);
        expect(leafSize(grid.root(), "beta")).toBeCloseTo(400, 0);
        expect(leafSize(grid.root(), "left")).toBe(300);
    });
});

describe("拆分树原语：快照", () => {
    it("恢复遇到未知 ref 时丢弃该叶并产出 dropped 条目", () => {
        const grid = createGrid<string>(null);
        const snapshot = fixture();
        const result = grid.restore(
            {version: GRID_SNAPSHOT_VERSION, root: snapshot},
            (ref) => (ref === "panel" ? null : ref),
        );
        expect(result.ok).toBe(true);
        expect(result.dropped).toEqual([{ref: "panel", reason: "未知 ref"}]);
        expect(leafSize(grid.root(), "panel")).toBeNull();
        expect(leafSize(grid.root(), "editor")).toBe(400);
    });

    it("恢复遇到不认识的版本号时拒绝并给出原因", () => {
        const grid = createGrid(fixture());
        const result = grid.restore({version: 99, root: fixture()}, (ref) => ref);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("版本 99");
        // 拒绝时保持原树不动
        expect(leafSize(grid.root(), "panel")).toBe(200);
    });

    it("恢复遇到重复 ref 时整体拒绝并报告", () => {
        const grid = createGrid<string>(null);
        const duplicated: GridSnapshot = {
            version: GRID_SNAPSHOT_VERSION,
            root: {
                kind: "branch",
                id: "root",
                orientation: "horizontal",
                children: [
                    {kind: "leaf", id: "a", ref: "same", minimumSize: 10, maximumSize: 100, size: 50},
                    {kind: "leaf", id: "b", ref: "same", minimumSize: 10, maximumSize: 100, size: 50},
                ],
            },
        };
        const result = grid.restore(duplicated, (ref) => ref);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("重复 ref");
    });

    it("序列化结果只含 ref 字符串与尺寸，不出现组件/函数字段", () => {
        const grid = createGrid(fixture());
        const keys = new Set<string>();
        const walk = (value: unknown) => {
            if (Array.isArray(value)) {
                value.forEach(walk);
            } else if (value && typeof value === "object") {
                for (const [key, child] of Object.entries(value)) {
                    keys.add(key);
                    walk(child);
                }
            }
        };
        walk(grid.serialize());
        expect([...keys].sort()).toEqual(["children", "id", "kind", "maximumSize", "minimumSize", "orientation", "ref", "root", "size", "version"]);
    });
});
