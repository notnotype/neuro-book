/**
 * 侧轨展开的预算（docs/specs/ui/workbench-layout.md 输出 50 的“预算”，验收 36）：预算的纯函数，以及按预算呈现时意图不漂移（验收 35）。
 */

import {describe, expect, it} from "bun:test";

import {createGrid} from "@notnotype/nb-layout";
import {projectLayoutDoc, rebaseForOperation} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutProjectionOptions} from "@notnotype/nb-workbench-layout";

import {BUSY_LAYOUT_CATALOG} from "../testing/layout-doc";
import {moveContainerTo, regionContainers} from "./containers";
import {defaultLayoutDoc} from "./default-tree";
import {createLayoutPolicy, layoutProjectionOptions, railBudget} from "./layout-constraints";

/** 消息视图声明的范围（conversation 输出 57）：缺省 260，200–420，展开时聊天区至少 320。 */
const MESSAGES = {minimum: 200, maximum: 420, chatMinimum: 320};

describe("预算", () => {
    it("编辑组让得出：编辑组让出全部差值，区域不动", () => {
        expect(railBudget({baseline: {editor: 600, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "done", width: 260});
    });

    it("编辑组压到最小仍差：区域这一次按压过的宽呈现，聊天区不小于下限", () => {
        // 差值 212，编辑组能让 100，区域再让 112：460 → 348。
        expect(railBudget({baseline: {editor: 320, editorMinimum: 220, region: 460, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "done", width: 260, regionWidth: 348});
    });

    it("聊天区也压到下限仍差：按能给的展开，能给的不小于视图段的下限", () => {
        // 编辑组让 80、区域让 80：能给 48 + 160 = 208，不小于 200。
        expect(railBudget({baseline: {editor: 300, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "done", width: 208, regionWidth: 320});
    });

    it("能给的比视图段的下限还窄：不展开，按收着的宽", () => {
        expect(railBudget({baseline: {editor: 270, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "too-narrow", width: 48});
    });

    it("请求宽先夹进视图段声明的范围；区域本来就比聊天区下限窄时区域不让", () => {
        expect(railBudget({baseline: {editor: 900, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 600, segment: MESSAGES})).toEqual({result: "done", width: 420});
        expect(railBudget({baseline: {editor: 900, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 120, segment: MESSAGES})).toEqual({result: "done", width: 200});
        expect(railBudget({baseline: {editor: 300, editorMinimum: 220, region: 300, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "too-narrow", width: 48});
    });

    it("区域的有效最小宽比聊天区下限还大（当前容器里的视图声明了更宽的最小）：区域只让到它，余下的不算进来", () => {
        // 右栏 400、有效最小 390：只让 10；编辑组让 122；能给 48 + 122 + 10 = 180，比下限 200 窄，不展开。
        expect(railBudget({baseline: {editor: 342, editorMinimum: 220, region: 400, regionMinimum: 390}, request: 260, segment: MESSAGES})).toEqual({result: "too-narrow", width: 48});
        // 编辑组让得多一些时按能给的展开，右栏只压到它的最小宽。
        expect(railBudget({baseline: {editor: 372, editorMinimum: 220, region: 400, regionMinimum: 390}, request: 260, segment: MESSAGES})).toEqual({result: "done", width: 210, regionWidth: 390});
    });

    it("验收 36 的数：窗口 1100、右栏 400、编辑组最小 220、请求 260", () => {
        // 侧栏 340 显示着：活动栏 48、右轨 48、缝 3，编辑组 261，只能让 41；右栏让到 320 再给 80，能给 169，比下限 200 窄，不展开。
        const withSidebar = 1100 - 48 - 340 - 400 - 48 - 3;
        expect(railBudget({baseline: {editor: withSidebar, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "too-narrow", width: 48});
        // 侧栏收到最小 160：编辑组 441，让得出 212，右栏不动。
        const narrowSidebar = 1100 - 48 - 160 - 400 - 48 - 3;
        expect(railBudget({baseline: {editor: narrowSidebar, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "done", width: 260});
        // 侧栏 250：编辑组 351，让 131，右栏再让 81、呈现成 319——比聊天区下限窄 1，所以按能给的 48 + 131 + 80 = 259 展开、右栏 320。
        const midSidebar = 1100 - 48 - 250 - 400 - 48 - 3;
        expect(railBudget({baseline: {editor: midSidebar, editorMinimum: 220, region: 400, regionMinimum: 160}, request: 260, segment: MESSAGES})).toEqual({result: "done", width: 259, regionWidth: 320});
    });
});

describe("按预算呈现时意图不漂移（验收 35）", () => {
    const extent = {width: 1440, height: 900};
    const policy = createLayoutPolicy();

    /** 用工作台真实的投影选项求解一次，返回编辑区与右栏的呈现宽。 */
    const widths = (doc: LayoutDoc, extra: Partial<LayoutProjectionOptions> = {}) => {
        const projection = projectLayoutDoc(doc, {...layoutProjectionOptions({doc, catalog: BUSY_LAYOUT_CATALOG, viewportWidth: extent.width}), ...extra});
        const sizes = createGrid<string>(projection.input, {sashSize: projection.sashSize}).layout(extent).sizes;
        // 区域在呈现树里的节点 id 随结构变（搬回来后是新的分支），按它的锚找。
        const regionNode = [...projection.regionAnchors].find(([, anchor]) => anchor === "auxiliarybar")?.[0] ?? "";
        return {projection, sizes, center: sizes.center?.width, region: sizes[regionNode]?.width};
    };

    /** 右栏的容器搬去底部面板再搬回来；每步之前像 store 一样按此刻的呈现回写意图。 */
    function roundTrip(doc: LayoutDoc, extra: Partial<LayoutProjectionOptions>): LayoutDoc {
        const container = regionContainers(doc, "auxiliarybar")[0]?.id as string;
        let current = doc;
        for (const region of ["panel", "auxiliarybar"] as const) {
            const {projection, sizes} = widths(current, extra);
            const moved = moveContainerTo(rebaseForOperation(current, projection, sizes), container, region, policy);
            if (!moved.ok) throw new Error(moved.message);
            current = moved.doc;
        }
        return current;
    }

    it("右栏按预算压着时做结构操作，压的那段不写进意图：解除之后编辑区与右栏回到压之前", () => {
        const doc = defaultLayoutDoc(BUSY_LAYOUT_CATALOG);
        const before = widths(doc);
        const squeezed = widths(doc, {regionWidth: {auxiliarybar: 300}});
        expect(squeezed.region).toBe(300);
        const after = widths(roundTrip(doc, {regionWidth: {auxiliarybar: 300}}));
        expect([after.center, after.region]).toEqual([before.center, before.region]);
    });
});
