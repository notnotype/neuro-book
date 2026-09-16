import {describe, expect, it} from "vitest";
import {createGrid, type GridNode, type GridSnapshotNode} from "@notnotype/nb-ui/components";
import {createDefaultLayout, createSpikeGrid, liveLeafIds, resizeSpikeBranch, restoreLayout, serializeLayout, visibleGridTree, type SpikeCatalog} from "nbook/app/components/workbench-spike/layout";

const catalog: SpikeCatalog = {views: [], containers: []};

/** 只关心与 grid 快照有关的 issue：空 catalog 会让活动容器回落，那是另一条路径。 */
function gridIssues(issues: string[]): string[] {
    return issues.filter((issue) => issue.includes("布局快照"));
}

function findNode(root: GridSnapshotNode | GridNode<string>, id: string): GridSnapshotNode | GridNode<string> | undefined {
    if (root.id === id) return root;
    if (root.kind === "branch") {
        for (const child of root.children) {
            const found = findNode(child, id);
            if (found) return found;
        }
    }
}

describe("验证台布局快照", () => {
    it("默认树按当前快照格式生成，且能原样恢复", () => {
        const state = createDefaultLayout(catalog);
        const restored = restoreLayout(JSON.parse(serializeLayout(state)), catalog);

        expect(gridIssues(restored.issues)).toEqual([]);
        expect(liveLeafIds(restored.state.grid.root)).toEqual(liveLeafIds(state.grid.root));
        expect(state.grid.version).toBe(2);
    });

    it("未知引用被丢弃，所在分支的列宽意图保留", () => {
        const state = createDefaultLayout(catalog);
        const raw = JSON.parse(serializeLayout(state));
        const center = raw.grid.root.children[0].children[2];
        center.children.push({kind: "leaf", id: "ghost", ref: "ghost-ref", size: {width: 0, height: 120}});

        const result = restoreLayout(raw, catalog);

        expect(result.issues.join()).toContain("未知引用");
        expect(findNode(result.state.grid.root, "center")?.size.width).toBe(520);
    });

    it("版本 1 快照被拒绝并回退默认布局", () => {
        const state = createDefaultLayout(catalog);
        const result = restoreLayout({...state, grid: {version: 1, root: {kind: "leaf", id: "statusbar", ref: "statusbar", size: {width: 0, height: 40}}}}, catalog);

        expect(result.issues.join()).toContain("版本 1");
        expect(liveLeafIds(result.state.grid.root)).toEqual(liveLeafIds(state.grid.root));
    });

    it("白名单外的节点 id 整体拒绝", () => {
        const state = createDefaultLayout(catalog);
        const raw = JSON.parse(serializeLayout(state));
        raw.grid.root.children[0].children.push({kind: "leaf", id: "intruder", ref: "activity", size: {width: 10, height: 0}});

        const result = restoreLayout(raw, catalog);

        expect(result.issues.join()).toContain("非法或重复");
        expect(liveLeafIds(result.state.grid.root)).toEqual(liveLeafIds(state.grid.root));
    });

    it("折叠叶从当前呈现树移除，原快照尺寸意图保持不变", () => {
        const state = createDefaultLayout(catalog);
        const restored = restoreLayout(JSON.parse(serializeLayout(state)), catalog);
        const grid = visibleGridTree(createSpikeGrid(restored.state.grid).root(), ["sidebar-left", "panel"]);

        expect(liveLeafIds(grid)).toEqual(["activity", "editor", "sidebar-right", "statusbar"]);
        expect(serializeLayout(state)).toContain("sidebar-left");
        expect(serializeLayout(state)).toContain("panel");
    });

    it("恢复快照采用宿主当前约束，快照不需要存 min/max", () => {
        const state = createDefaultLayout(catalog);
        const grid = createSpikeGrid(state.grid);
        expect(findNode(grid.root()!, "sidebar-left")).toMatchObject({minimumSize: {width: 180}, maximumSize: {width: 520}});
        expect(grid.serialize()).toEqual(state.grid);
        expect(grid.layout({width: 390, height: 844}).sizes.root?.width).toBeLessThanOrEqual(390);
    });

    it("隐藏左叶后调整 center/right，回显命中目标且隐藏意图与内部高度不变", () => {
        const grid = createSpikeGrid(createDefaultLayout(catalog).grid);
        const before = grid.serialize();
        const hidden = ["sidebar-left"];
        const container = {width: 1200, height: 900};
        const visible = createGrid(visibleGridTree(grid.root(), hidden), {sashSize: 1});
        const layout = visible.layout(container);
        const baseline = Object.fromEntries(["activity", "center", "sidebar-right"].map((id) => [id, layout.sizes[id]!.width]));
        const target = {...baseline, center: baseline.center! - 20, "sidebar-right": baseline["sidebar-right"]! + 20};
        expect(resizeSpikeBranch(grid, hidden, "main", "width", baseline, target).ok).toBe(true);
        const after = grid.serialize();
        expect(findNode(after.root, "sidebar-left")).toEqual(findNode(before.root, "sidebar-left"));
        expect(findNode(after.root, "editor")).toEqual(findNode(before.root, "editor"));
        const presented = createGrid(visibleGridTree(grid.root(), hidden), {sashSize: 1}).layout(container);
        expect(presented.sizes.center?.width).toBeCloseTo(target.center);
        expect(presented.sizes["sidebar-right"]?.width).toBeCloseTo(target["sidebar-right"]);
    });
});
