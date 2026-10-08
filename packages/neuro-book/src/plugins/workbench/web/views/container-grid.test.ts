/**
 * 容器内的单轴网格（docs/specs/ui/workbench-shell.md 外壳二输出 16，验收 29）：真实的 nb-ui `createGrid`。手势按产品的
 * 落账顺序走：`resizeBranches` 落账 → `containerSizePatch` 算补丁；指针与键盘的会话由 e2e 在真实浏览器里覆盖。
 */

import {describe, expect, it} from "bun:test";

import type {GridBranchChange, GridGestureCommit} from "@notnotype/nb-ui/layout";

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {Customizations} from "../state/records";
import {applyIntent, applyPatch} from "./intents";
import {containerBranchId, containerSizePatch, createContainerGrid, VIEW_COLLAPSED_SIZE} from "./container-grid";
import {computePlacement} from "./placement";
import type {ViewCatalog} from "./placement";
import {buildPresentation} from "./presentation";
import type {ContainerPresentation} from "./presentation";

const view = (name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon: "i-lucide-square", location, layout: "scroll", ...extra});

/** 三个视图并进 `view:test.a`（侧栏）或 `view:test.c`（面板）后的呈现。 */
function containerOf(location: ViewLocation, extra: Customizations = {}): ContainerPresentation {
    const catalog: ViewCatalog = new Map([["test.a", view("A", location)], ["test.b", view("B", location)], ["test.c", view("C", location, {minimumSize: {width: 100, height: 100}})]]);
    let customizations: Customizations = extra;
    for (const viewId of ["test.b", "test.c"]) {
        const placement = computePlacement(catalog, customizations);
        const presentation = buildPresentation({catalog, placement, customizations});
        const result = applyIntent({catalog, placement, presentation, customizations}, {kind: "move-view", viewId, sourceContainerId: `view:${viewId}`, targetContainerId: "view:test.a"});
        if (result.kind !== "patch") throw new Error(`合并 ${viewId} 失败`);
        customizations = applyPatch(customizations, result.patch, catalog).value;
    }
    const placement = computePlacement(catalog, customizations);
    return buildPresentation({catalog, placement, customizations}).containers.get("view:test.a")!;
}

const EXTENT = {width: 300, height: 721};

function changeOf(container: ContainerPresentation, active: readonly string[], move: (baseline: Record<string, number>) => Record<string, number>): GridBranchChange {
    const grid = createContainerGrid(container)!;
    const layout = grid.layout(EXTENT);
    const axis = container.axis === "horizontal" ? "width" : "height";
    const baseline = Object.fromEntries(container.views.map((slot) => [slot.id, layout.sizes[slot.id]![axis]]));
    return {branchId: containerBranchId(container.id), axis, baseline, target: move(baseline), extent: EXTENT, active, compensated: [], collapsed: {}};
}

function commitOf(changes: readonly GridBranchChange[]): GridGestureCommit {
    return {sessionId: "s", contextKey: "c", source: "pointer", revision: 1, extent: EXTENT, changes};
}

describe("容器网格", () => {
    it("侧栏纵向、Panel 横向；没记录过的视图等分，记录过的按意图分配；收起的固定 32px", () => {
        const even = createContainerGrid(containerOf("sidebar"))!;
        const sizes = even.layout(EXTENT).sizes;
        // 721 减两根 1px 边界，三份等分。
        expect([sizes["test.a"]?.height, sizes["test.b"]?.height, sizes["test.c"]?.height]).toEqual([719 / 3, 719 / 3, 719 / 3]);
        expect(sizes["test.a"]?.width).toBe(300);
        expect(even.root()).toMatchObject({kind: "branch", orientation: "vertical"});
        expect(createContainerGrid(containerOf("panel"))!.root()).toMatchObject({kind: "branch", orientation: "horizontal"});

        const collapsed = containerOf("sidebar", {views: {"test.a": {collapsed: true}, "test.b": {height: 300}}});
        const laid = createContainerGrid(collapsed)!.layout(EXTENT).sizes;
        expect(laid["test.a"]?.height).toBe(VIEW_COLLAPSED_SIZE);
        // 余下 719 - 32 = 687 按 300 : 240 分给 B 与 C。
        expect(laid["test.b"]?.height).toBeCloseTo(687 * 300 / 540, 6);
    });

    it("补丁只取主动、真实变化、没有收起的视图的当前轴", () => {
        const container = containerOf("sidebar", {views: {"test.a": {collapsed: true}}});
        const grid = createContainerGrid(container)!;
        const change = changeOf(container, ["test.a", "test.b", "test.c"], (baseline) => ({...baseline, "test.b": baseline["test.b"]! + 40, "test.c": baseline["test.c"]! - 40}));
        expect(grid.resizeBranches([change]).ok).toBe(true);
        expect(containerSizePatch(container, commitOf([change]))).toEqual({"test.b": change.baseline["test.b"]! + 40, "test.c": change.baseline["test.c"]! - 40});
        // 被动补偿的叶不写。
        const passive = changeOf(container, ["test.b"], (baseline) => ({...baseline, "test.b": baseline["test.b"]! - 20, "test.c": baseline["test.c"]! + 20}));
        expect(containerSizePatch(container, commitOf([passive]))).toEqual({"test.b": passive.baseline["test.b"]! - 20});
        // 别的分支或别的轴的变化不算本容器的。
        expect(containerSizePatch(container, commitOf([{...passive, axis: "width"}]))).toEqual({});
        expect(containerSizePatch(container, commitOf([{...passive, branchId: "container:view:other"}]))).toEqual({});
    });

    it("没有可见视图时没有树", () => {
        expect(createContainerGrid({...containerOf("sidebar"), views: [], mode: "empty"})).toBeNull();
    });
});
