import {describe, expect, it} from "vitest";
import {createGrid, type Grid, type GridNode} from "@notnotype/nb-ui/components";
import {
    SHELL_EDITOR_MAX_WIDTH,
    SHELL_MAIN_ID,
    SHELL_TITLEBAR_HEIGHT,
    clampLeafSize,
    clampLeafSizes,
    createDefaultShellGrid,
    createShellGrid,
    distributeShellHeights,
    recalcShellSizes,
    resizeShellBranch,
    shellLeafLimits,
} from "nbook/app/utils/workbench/layout";

const VIEWPORT = 1280;
const VIEWPORT_HEIGHT = 900;

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

/** 四个宽度叶的意图：外壳把尺寸模型写进树，渲染器再从树读回比例。 */
function leafIntents(grid: Grid<string>): number[] {
    return leafChildren(grid).map((child) => child.size.width);
}

/** 主区分支的意图：它在垂直根分支里的高度分配。 */
function mainIntent(grid: Grid<string>): number {
    const root = grid.root();
    const main = root?.kind === "branch" ? root.children.find((child) => child.id === SHELL_MAIN_ID) : null;
    return main ? main.size.height : -1;
}

describe("createDefaultShellGrid", () => {
    it("完整手势包含远端补偿时，只保存 active 侧栏的偏好", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const layout = grid.layout({width: VIEWPORT, height: VIEWPORT_HEIGHT});
        const baseline = Object.fromEntries(leafChildren(grid).map((child) => [child.id, layout.sizes[child.id]!.width]));
        const target = {...baseline, left: baseline.left! - 20, editor: baseline.editor! - 30, right: baseline.right! + 50};
        const result = resizeShellBranch(grid, "main", "width", baseline, target, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []}, ["editor", "right"]);
        expect(result).toEqual({ok: true, store: {leftPanelWidth: 340, agentPanelWidth: 450, hidden: []}});
        expect(grid.layout({width: VIEWPORT, height: VIEWPORT_HEIGHT}).sizes.left?.width).toBeCloseTo(320);
    });

    it("editor/right 手势保存右栏，左栏偏好不变，重建后的呈现不回弹", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const layout = grid.layout({width: VIEWPORT, height: VIEWPORT_HEIGHT});
        const baseline = Object.fromEntries(leafChildren(grid).map((child) => [child.id, layout.sizes[child.id]!.width]));
        const target = {...baseline, editor: baseline.editor! - 50, right: baseline.right! + 50};
        const result = resizeShellBranch(grid, "main", "width", baseline, target, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []}, ["editor", "right"]);
        expect(result).toEqual({ok: true, store: {leftPanelWidth: 340, agentPanelWidth: 450, hidden: []}});
        if (!result.ok) throw new Error(result.reason);
        const next = recalcShellSizes(grid, result.store, VIEWPORT - 2);
        const rendered = createShellGrid(VIEWPORT, {...next.sizes, titlebar: 36, main: 864}).layout({width: VIEWPORT, height: VIEWPORT_HEIGHT});
        expect(rendered.sizes.right?.width).toBe(450);
        expect(rendered.sizes.left?.width).toBe(340);
        expect(rendered.sizes.editor?.width).toBe(target.editor);
    });

    it("拓扑是 root(vertical){titlebar, main(horizontal){activity, left, editor, right}}，初始尺寸来自 store 初值", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const root = grid.root();
        expect(root?.kind).toBe("branch");
        expect(root?.kind === "branch" ? root.orientation : null).toBe("vertical");
        expect(root?.kind === "branch" ? root.children.map((child) => child.id) : []).toEqual(["titlebar", SHELL_MAIN_ID]);
        // 标题栏是 36/36 刚性叶：意图与约束都写在高度轴上
        expect(root?.kind === "branch" ? root.children[0] : null).toMatchObject({
            kind: "leaf",
            size: {width: 0, height: SHELL_TITLEBAR_HEIGHT},
            minimumSize: {width: 0, height: SHELL_TITLEBAR_HEIGHT},
            maximumSize: {width: Number.MAX_SAFE_INTEGER, height: SHELL_TITLEBAR_HEIGHT},
        });

        expect(leafChildren(grid).map((child) => child.id)).toEqual(["activity", "left", "editor", "right"]);
        expect(leafChildren(grid).every((child) => child.kind === "leaf")).toBe(true);

        // root 与 activity 后的 sash 不占流内空间，只扣 left|editor、editor|right 两条 1px sash。
        expect(leafIntents(grid)).toEqual([60, 340, 478, 400]);
        expect(mainIntent(grid)).toBe(VIEWPORT_HEIGHT - SHELL_TITLEBAR_HEIGHT);
    });

    it("右叶上限在建树时按视口定稿：1280 × 45% = 576", () => {
        const right = leafChildren(createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT)).find((child) => child.id === "right");

        expect(right).toMatchObject({minimumSize: {width: 320}, maximumSize: {width: 576}});
    });

    it("视口小到固定叶装不下时编辑器置 0，右栏同时被上限夹到兜底值", () => {
        const intents = leafIntents(createDefaultShellGrid(700, VIEWPORT_HEIGHT));

        expect(intents).toEqual([60, 340, 0, 360]); // max(360, 700 × 45% = 315)
    });
});

describe("distributeShellHeights", () => {
    it("titlebar 可见时刚性 36，隐藏的根 sash 不占空间，main 吸收余量", () => {
        expect(distributeShellHeights(900, true)).toEqual({titlebar: 36, main: 864});
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
        const result = clampLeafSizes(createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT), {left: 900, editor: 100, ghost: 50});

        expect(result.sizes).toEqual({left: 560, editor: 100});
        expect(result.issues).toEqual(["尺寸表引用了树里没有的叶：ghost"]);
    });
});

describe("recalcShellSizes", () => {
    it("avail 变化时编辑器吸收与让出，固定叶保持 store 值", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const store = {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []};

        expect(recalcShellSizes(grid, store, 1280).sizes).toEqual({activity: 60, left: 340, editor: 480, right: 400});
        expect(recalcShellSizes(grid, store, 1600).sizes.editor).toBe(800);
        expect(recalcShellSizes(grid, store, 1000).sizes.editor).toBe(200);
    });

    it("store 里的越界值被各自 min/max 夹掉，不写进布局", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 100, agentPanelWidth: 5000, hidden: []}, 2000);

        expect(result.sizes).toEqual({activity: 60, left: 280, editor: 1084, right: 576});
        expect(result.issues).toEqual([]);
    });

    it("固定叶总宽超过可用宽：固定叶不缩、编辑器置 0 并给可上报 issue", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 560, agentPanelWidth: 576, hidden: []}, 500);

        expect(result.sizes).toEqual({activity: 60, left: 560, editor: 0, right: 576});
        expect(result.issues).toHaveLength(1);
        expect(result.issues.join()).toContain("1196");
        expect(result.issues.join()).toContain("500");
    });

    it("隐藏左栏后重算：该叶 0 宽，编辑器吸收它原来的空间", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["left"]}, 1280);

        expect(result.sizes).toEqual({activity: 60, left: 0, editor: 820, right: 400});
        expect(result.issues).toEqual([]);
    });

    it("编辑器叶被隐藏：余量没有叶吸收，报 issue", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["editor"]}, 1280);

        expect(result.sizes.editor).toBe(0);
        expect(result.issues).toEqual(["编辑器叶不可见：剩余 480px 没有叶吸收"]);
    });

    it("隐藏列表里的未登记叶报 issue 而不是静默忽略", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: ["ghost"]}, 1280);

        expect(result.issues).toEqual(["隐藏列表引用了未登记的叶：ghost"]);
        expect(result.sizes.left).toBe(340);
    });

    it("标题栏是登记的隐藏项：隐藏它不报 issue，也不影响四个宽度叶", () => {
        const grid = createDefaultShellGrid(VIEWPORT, VIEWPORT_HEIGHT);
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
                {kind: "leaf", id: "activity", ref: "activity", size: {width: 48, height: 0}, minimumSize: {width: 48, height: 0}, maximumSize: {width: 48, height: 0}},
                {kind: "leaf", id: "left", ref: "left", size: {width: 340, height: 0}, minimumSize: {width: 280, height: 0}, maximumSize: {width: 560, height: 0}},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 500, height: 0}, minimumSize: {width: 0, height: 0}, maximumSize: {width: SHELL_EDITOR_MAX_WIDTH, height: 0}},
            ],
        });
        const result = recalcShellSizes(grid, {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []}, 1280);

        expect(result.sizes.right).toBe(0);
        expect(result.sizes.editor).toBe(1280 - 48 - 340);
        expect(result.issues).toEqual(["布局树缺少叶：right（按 0 宽处理）"]);
    });
});

describe("createShellGrid 可见几何", () => {
    const sizes = {activity: 60, left: 340, editor: 478, right: 400, titlebar: 36, main: 864};

    it("非管理轴共享容器空间，不被零上限压成零", () => {
        const result = createShellGrid(VIEWPORT, sizes).layout({width: VIEWPORT, height: VIEWPORT_HEIGHT});

        expect(result.sizes.main).toEqual({width: VIEWPORT, height: VIEWPORT_HEIGHT - SHELL_TITLEBAR_HEIGHT});
        expect(result.sizes.editor?.height).toBe(VIEWPORT_HEIGHT - SHELL_TITLEBAR_HEIGHT);
        expect(result.issues).toEqual([]);
    });

    it("隐藏叶从树和 sash 同时移除，重新展开仍使用原尺寸意图", () => {
        const hidden = createShellGrid(VIEWPORT, sizes, ["titlebar", "activity", "left", "right"]);
        const hiddenRoot = hidden.root();
        const hiddenMain = hiddenRoot?.kind === "branch" ? hiddenRoot.children[0] : null;
        const hiddenLayout = hidden.layout({width: VIEWPORT, height: VIEWPORT_HEIGHT});

        expect(hiddenRoot?.kind === "branch" ? hiddenRoot.children.map((child) => child.id) : []).toEqual(["main"]);
        expect(hiddenMain?.kind === "branch" ? hiddenMain.children.map((child) => child.id) : []).toEqual(["editor"]);
        expect(hiddenLayout.sizes.editor).toEqual({width: VIEWPORT, height: VIEWPORT_HEIGHT});
        expect(hiddenLayout.sashSizes.root).toEqual([]);
        expect(hiddenLayout.sashSizes.main).toEqual([]);

        const restored = createShellGrid(VIEWPORT, sizes).layout({width: VIEWPORT, height: VIEWPORT_HEIGHT});
        expect(restored.sizes.left?.width).toBe(340);
        expect(restored.sizes.right?.width).toBe(400);
    });
});
