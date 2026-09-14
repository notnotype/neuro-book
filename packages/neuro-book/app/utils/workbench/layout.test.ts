import {describe, expect, it} from "vitest";
import {createGrid, type Grid, type GridNode} from "@notnotype/nb-ui/components";
import {
    SHELL_EDITOR_MAX_WIDTH,
    SHELL_MAIN_ID,
    SHELL_TITLEBAR_HEIGHT,
    clampLeafSize,
    clampLeafSizes,
    createDefaultShellGrid,
    distributeShellHeights,
    recalcShellSizes,
    shellLeafLimits,
} from "nbook/app/utils/workbench/layout";

const VIEWPORT = 1280;

/** 步骤 4 起拓扑为 root(vertical){titlebar, main(horizontal){四个宽度叶}}；本文件关心 main 下的四个叶。 */
function leafChildren(grid: Grid<string>): GridNode<string>[] {
    const root = grid.root();
    if (!root || root.kind !== "branch") {
        throw new Error("外壳树的根必须是分支");
    }
    const main = root.children.find((child) => child.id === SHELL_MAIN_ID);
    if (!main || main.kind !== "branch") {
        throw new Error("外壳树的主区分支缺失");
    }
    return main.children;
}

describe("createDefaultShellGrid", () => {
    it("拓扑是 root(vertical){titlebar, main(horizontal){activity, left, editor, right}}，初始宽来自 store 初值", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const root = grid.root();
        expect(root?.kind).toBe("branch");
        expect(root?.kind === "branch" ? root.orientation : null).toBe("vertical");
        expect(root?.kind === "branch" ? root.children.map((child) => child.id) : []).toEqual(["titlebar", SHELL_MAIN_ID]);
        expect(root?.kind === "branch" ? root.children[0] : null).toMatchObject({kind: "leaf", size: SHELL_TITLEBAR_HEIGHT, minimumSize: 36, maximumSize: 36});

        expect(leafChildren(grid).map((child) => child.id)).toEqual(["activity", "left", "editor", "right"]);
        expect(leafChildren(grid).every((child) => child.kind === "leaf")).toBe(true);

        const sizes = grid.layout().sizes;
        // 活动栏叶宽 = 卡片 48 + 两侧留白 6（layout.ts 一处给出）
        expect(sizes["activity"]).toBe(60);
        expect(sizes["left"]).toBe(340);
        expect(sizes["right"]).toBe(400);
        // 编辑器吸收余量：1280 − 3 条 1px sash − 60 − 340 − 400
        expect(sizes["editor"]).toBe(477);
    });

    it("右叶上限在建树时按视口定稿：1280 × 45% = 576", () => {
        const right = leafChildren(createDefaultShellGrid(VIEWPORT)).find((child) => child.id === "right");

        expect(right).toMatchObject({minimumSize: 320, maximumSize: 576});
    });

    it("视口小到固定叶装不下时编辑器置 0，右栏同时被上限夹到兜底值", () => {
        const sizes = createDefaultShellGrid(700).layout().sizes;

        expect(sizes["right"]).toBe(360); // max(360, 700 × 45% = 315)
        expect(sizes["editor"]).toBe(0);
        expect(sizes["left"]).toBe(340);
    });
});

describe("distributeShellHeights", () => {
    it("titlebar 可见时刚性 36 + 1px sash，main 吸收余量", () => {
        expect(distributeShellHeights(900, true)).toEqual({titlebar: 36, main: 863});
    });

    it("titlebar 不可见时不占高度、不留 sash，main 占满", () => {
        expect(distributeShellHeights(900, false)).toEqual({titlebar: 0, main: 900});
    });

    it("外壳高度不足 36 时不产生负数（main 置 0）", () => {
        expect(distributeShellHeights(20, true)).toEqual({titlebar: 20, main: 0});
        expect(distributeShellHeights(0, true)).toEqual({titlebar: 0, main: 0});
        expect(distributeShellHeights(Number.NaN, true)).toEqual({titlebar: 0, main: 0});
    });
});

describe("shellLeafLimits", () => {
    it("固定叶 min/max：活动栏刚性 60（卡片 48 + 两侧留白 6）、左 280..560、右 320..max(360, 45% 视口)", () => {
        expect(shellLeafLimits("activity", VIEWPORT)).toEqual({minimumSize: 60, maximumSize: 60});
        expect(shellLeafLimits("left", VIEWPORT)).toEqual({minimumSize: 280, maximumSize: 560});
        expect(shellLeafLimits("right", VIEWPORT)).toEqual({minimumSize: 320, maximumSize: 576});
        // 视口小到比例值不足兜底时取下限。
        expect(shellLeafLimits("right", 700)).toEqual({minimumSize: 320, maximumSize: 360});
        expect(shellLeafLimits("editor", VIEWPORT)).toEqual({minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH});
    });
});

describe("clampLeafSize", () => {
    it("每对 min/max 各夹一例：越界回边界、区间内原样、非有限值按 min", () => {
        expect(clampLeafSize(47, {minimumSize: 48, maximumSize: 48})).toBe(48);
        expect(clampLeafSize(49, {minimumSize: 48, maximumSize: 48})).toBe(48);
        expect(clampLeafSize(200, {minimumSize: 280, maximumSize: 560})).toBe(280);
        expect(clampLeafSize(900, {minimumSize: 280, maximumSize: 560})).toBe(560);
        expect(clampLeafSize(340, {minimumSize: 280, maximumSize: 560})).toBe(340);
        expect(clampLeafSize(300, {minimumSize: 320, maximumSize: 576})).toBe(320);
        expect(clampLeafSize(5000, {minimumSize: 320, maximumSize: 576})).toBe(576);
        expect(clampLeafSize(-10, {minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH})).toBe(0);
        expect(clampLeafSize(1e16, {minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH})).toBe(SHELL_EDITOR_MAX_WIDTH);
        expect(clampLeafSize(Number.NaN, {minimumSize: 280, maximumSize: 560})).toBe(280);
    });
});

describe("clampLeafSizes", () => {
    it("以树的 min/max 为准；树里没有的 id 报 issue 并丢弃", () => {
        const result = clampLeafSizes(createDefaultShellGrid(VIEWPORT), {left: 900, editor: 100, ghost: 50});

        expect(result.sizes).toEqual({left: 560, editor: 100});
        expect(result.issues).toEqual(["尺寸表引用了树里没有的叶：ghost"]);
    });
});

describe("recalcShellSizes", () => {
    it("avail 变化时编辑器吸收与让出，固定叶保持 store 值", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const store = {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []};

        expect(recalcShellSizes(grid, store, 1280).sizes).toEqual({activity: 60, left: 340, editor: 480, right: 400});
        expect(recalcShellSizes(grid, store, 1600).sizes.editor).toBe(800);
        expect(recalcShellSizes(grid, store, 1000).sizes.editor).toBe(200);
    });

    it("store 里的越界值被各自 min/max 夹掉，不写进布局", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 100, agentPanelWidth: 5000, hidden: []}, 2000);

        expect(result.sizes).toEqual({activity: 60, left: 280, editor: 1084, right: 576});
        expect(result.issues).toEqual([]);
    });

    it("固定叶总宽超过可用宽：固定叶不缩、编辑器置 0 并给可上报 issue", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 560, agentPanelWidth: 576, hidden: []}, 500);

        expect(result.sizes).toEqual({activity: 60, left: 560, editor: 0, right: 576});
        expect(result.issues).toHaveLength(1);
        expect(result.issues.join()).toContain("1196");
        expect(result.issues.join()).toContain("500");
    });

    it("隐藏左栏后重算：该叶 0 宽，编辑器吸收它原来的空间", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["left"]}, 1280);

        expect(result.sizes).toEqual({activity: 60, left: 0, editor: 820, right: 400});
        expect(result.issues).toEqual([]);
    });

    it("编辑器叶被隐藏：余量没有叶吸收，报 issue", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["editor"]}, 1280);

        expect(result.sizes.editor).toBe(0);
        expect(result.issues).toEqual(["编辑器叶不可见：剩余 480px 没有叶吸收"]);
    });

    it("隐藏列表里的未登记叶报 issue 而不是静默忽略", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["ghost"]}, 1280);

        expect(result.issues).toEqual(["隐藏列表引用了未登记的叶：ghost"]);
        expect(result.sizes.left).toBe(340);
    });

    it("标题栏是登记的隐藏项：隐藏它不报 issue，也不影响四个宽度叶", () => {
        const grid = createDefaultShellGrid(VIEWPORT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["titlebar"]}, 1280);

        expect(result.issues).toEqual([]);
        // 调用方传入的 avail 已扣掉 sash：1280 − 800 = 480。
        expect(result.sizes).toEqual({activity: 60, left: 340, editor: 480, right: 400});
    });

    it("树里缺叶时按 0 宽处理并报 issue，而不是给 NaN", () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "activity", ref: "activity", minimumSize: 48, maximumSize: 48, size: 48},
                {kind: "leaf", id: "left", ref: "left", minimumSize: 280, maximumSize: 560, size: 340},
                {kind: "leaf", id: "editor", ref: "editor", minimumSize: 0, maximumSize: SHELL_EDITOR_MAX_WIDTH, size: 500},
            ],
        });
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []}, 1280);

        expect(result.sizes.right).toBe(0);
        expect(result.sizes.editor).toBe(1280 - 48 - 340);
        expect(result.issues).toEqual(["布局树缺少叶：right（按 0 宽处理）"]);
    });
});
