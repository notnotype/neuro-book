/**
 * t41 复核临时探针（不入库，跑完移回 Task evidences）。
 * 只调用被审文件导出的真实函数；缺失的只有 WorkbenchShell / WorkbenchBranch 内部那段胶水，
 * 胶水按源码逐行复演并在注释里标注。输出写入仓库 `.tmp/`（vitest 默认只回显失败用例 stdout）。
 */
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import type {Grid, GridLayoutResult, GridNode} from "@notnotype/nb-ui/components";
import {
    SHELL_LEAF_IDS,
    SHELL_MAIN_ID,
    SHELL_TITLEBAR_ID,
    SASH_PX,
    SHELL_TITLEBAR_HEIGHT,
    createDefaultShellGrid,
    createShellGrid,
    distributeShellHeights,
    recalcShellSizes,
    type ShellSizes,
} from "nbook/app/utils/workbench/layout";

const VIEWPORT = 1280;
const SHELL_HEIGHT = 900;
const UNBOUNDED = Number.MAX_SAFE_INTEGER;
type Store = {leftPanelWidth: number; agentPanelWidth: number; hidden: string[]};

const lines: string[] = [];
function say(...parts: unknown[]): void {
    lines.push(parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}

/** main 分支叶的宽度意图。 */
function intentsOf(grid: Grid<string>): number[] {
    const root = grid.root();
    const main = root?.kind === "branch" ? root.children.find((child) => child.id === SHELL_MAIN_ID) : null;
    return main?.kind === "branch" ? main.children.map((child) => Math.round(child.size.width)) : [];
}

/** WorkbenchShell 的 `ShellLayoutSizes`：四个宽度叶 + 垂直方向 titlebar / main。 */
function layoutModelOf(grid: Grid<string>, store: Store): ShellSizes & {titlebar: number; main: number} {
    const visible = SHELL_LEAF_IDS.filter((id) => !store.hidden.includes(id));
    // WorkbenchShell.availableWidth：根 sash 与 activity 后的 sash 被 CSS 隐藏，不计流内占用
    const activityAdjustment = visible[0] === "activity" ? 1 : 0;
    const avail = Math.max(0, VIEWPORT - SASH_PX * Math.max(0, visible.length - 1 - activityAdjustment));
    const heights = distributeShellHeights(SHELL_HEIGHT, !store.hidden.includes(SHELL_TITLEBAR_ID));
    return {...recalcShellSizes(grid, store, avail).sizes, ...heights};
}

/** WorkbenchShell.syncTree：模型 → 建树 → 用外壳实测尺寸发布呈现（root 是垂直分支）。 */
function treeAndLayout(store: Store): {grid: Grid<string>; layout: GridLayoutResult} {
    const sizes = layoutModelOf(createDefaultShellGrid(VIEWPORT, SHELL_HEIGHT), store);
    const grid = createShellGrid(VIEWPORT, sizes);
    return {grid, layout: grid.layout({width: VIEWPORT, height: SHELL_HEIGHT})};
}

/**
 * 对照树：只把「该节点没在被管理的那根轴」的上限改成不限（与 `grid.test.ts` / spike `leaf()` 的口径一致），
 * 其余（主轴 min/max、意图、拓扑）保持 createShellGrid 的原样。
 */
function withCrossUnbounded(tree: GridNode<string>, crossAxis: "width" | "height" | null): void {
    if (crossAxis) {
        tree.maximumSize[crossAxis] = UNBOUNDED;
    }
    if (tree.kind === "branch") {
        const next = tree.orientation === "horizontal" ? "height" : "width";
        tree.children.forEach((child) => withCrossUnbounded(child, next));
    }
}

/** WorkbenchBranch.buildPanels + 模板：可见叶归一化成百分比，容器再减去可见 sash。 */
function renderedPx(layout: GridLayoutResult, hidden: string[]): Record<string, number> {
    const visible = SHELL_LEAF_IDS.filter((id) => !hidden.includes(id));
    const total = visible.reduce((sum, id) => sum + layout.sizes[id]!.width, 0);
    const space = VIEWPORT - SASH_PX * Math.max(0, visible.length - 1);
    return Object.fromEntries(visible.map((id) => [id, Number(((layout.sizes[id]!.width / total) * space).toFixed(1))]));
}

function widthMap(sizes: Record<string, {width: number}>): Record<string, number> {
    return Object.fromEntries(Object.entries(sizes).map(([id, extent]) => [id, Number(extent.width.toFixed(1))]));
}

function report(name: string, store: Store, fixCrossAxis: boolean): void {
    const {grid, layout} = treeAndLayout(store);
    const root = grid.root();
    if (fixCrossAxis && root) {
        withCrossUnbounded(root, "width");
        layout.sizes = grid.layout({width: VIEWPORT, height: SHELL_HEIGHT}).sizes;
    }
    say(`### ${name}`);
    say("- hidden =", store.hidden, fixCrossAxis ? "（对照：交叉轴上限改为不限）" : "");
    say("- 模型（recalcShellSizes/distributeShellHeights）=", layoutModelOf(createDefaultShellGrid(VIEWPORT, SHELL_HEIGHT), store));
    say("- 树意图（createShellGrid）= [activity,left,editor,right] ", intentsOf(grid));
    say("- layout.sizes = ", widthMap(layout.sizes));
    say("- root 约束 = ", layout.constraints.root);
    say("- layout.sashSizes = ", layout.sashSizes);
    say("- 渲染像素（归一化 × 容器）= ", renderedPx(layout, store.hidden));
    say("- issues = ", layout.issues);
    say("");
}

describe("复核探针：外壳几何（只读真实函数）", () => {
    it("交叉轴上限把整棵树的呈现宽度压到最小合计", () => {
        const reviewed = [
            "../../../../../packages/nb-ui/src/components/layout/grid.ts",
            "../../../../../packages/nb-ui/src/components/layout/grid-geometry.ts",
            "../../../../../packages/nb-ui/src/components/layout/grid-types.ts",
            "../../../../../packages/nb-ui/src/components/layout/grid-snapshot.ts",
            "../../../../../packages/neuro-book/app/utils/workbench/layout.ts",
            "../../../../../packages/neuro-book/app/components/workbench/WorkbenchBranch.vue",
            "../../../../../packages/neuro-book/app/components/workbench/WorkbenchShell.vue",
        ];
        say("# 被审 revision（sha1）");
        for (const file of reviewed) {
            say("-", file, createHash("sha1").update(readFileSync(new URL(file, import.meta.url))).digest("hex"));
        }
        say("");
        for (const hidden of [[], ["right"], ["left"], ["left", "right"]]) {
            report(`真实树 hidden=${JSON.stringify(hidden)}`, {leftPanelWidth: 340, agentPanelWidth: 400, hidden}, false);
        }
        for (const hidden of [[], ["right"], ["left", "right"]]) {
            report(`对照树 hidden=${JSON.stringify(hidden)}`, {leftPanelWidth: 340, agentPanelWidth: 400, hidden}, true);
        }
        writeFileSync("../../.tmp/t41-probe-hide.md", lines.join("\n"), "utf8");
        expect(true).toBe(true);
    });

    it("editor~right 手势不会落账", () => {
        const store: Store = {leftPanelWidth: 340, agentPanelWidth: 400, hidden: []};
        const grid = createDefaultShellGrid(VIEWPORT, SHELL_HEIGHT);
        const before = layoutModelOf(grid, store);
        // WorkbenchShell.onLeafResize：id 来自 WorkbenchBranch 的 active[0] = editor
        const resized = grid.resize("editor", "width", -100);
        const after = layoutModelOf(grid, store);
        const rebuilt = createShellGrid(VIEWPORT, after);

        writeFileSync("../../.tmp/t41-probe-drag.md", [
            "# editor~right 手势（tracker active = [editor, right]，消费者取 active[0] = editor）",
            `- grid.resize('editor','width',-100) = ${JSON.stringify(resized)}`,
            `- store = ${JSON.stringify(store)}（未写回）`,
            `- 模型拖前 = ${JSON.stringify(before)}`,
            `- 模型拖后 = ${JSON.stringify(after)}`,
            `- 重建后的树意图 = ${JSON.stringify(intentsOf(rebuilt))}`,
            "- 结论：模型与树都回到拖前，store 不变；reka 在 DOM 里保留已拖动的百分比，下一次重挂（显隐/视口/store 外部改写）回弹。",
        ].join("\n"), "utf8");

        expect(after).toEqual(before);
    });

    it("SHELL_TITLEBAR_HEIGHT 与 titlebar 叶的交叉轴上限", () => {
        const {grid} = treeAndLayout({leftPanelWidth: 340, agentPanelWidth: 400, hidden: []});
        const root = grid.root();
        say("[titlebar]", root?.kind === "branch" ? root.children[0] : null);
        writeFileSync("../../.tmp/t41-probe-titlebar.md", lines.join("\n"), "utf8");
        expect(SHELL_TITLEBAR_HEIGHT).toBe(36);
    });
});
