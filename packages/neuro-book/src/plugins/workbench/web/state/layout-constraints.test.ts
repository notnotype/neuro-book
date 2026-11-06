/**
 * 面板的约束（docs/specs/ui/workbench-layout.md 输出 6、26）。
 */
import {describe, expect, it} from "bun:test";

import {layoutAccepts, panelConstraints} from "./layout-constraints";
import type {ViewCatalog} from "../views/placement";

const VIEW = (over: object = {}) => ({title: {"zh-CN": "甲", "en-US": "A"}, icon: "i", location: "sidebar" as const, layout: "scroll" as const, ...over});

describe("约束", () => {
    it("具名面板与编辑组按表", () => {
        expect(panelConstraints({role: "tool", name: "sidebar", tabs: [], active: null}, new Map(), 1440)).toMatchObject({minimumSize: {width: 160, height: 80}, maximumSize: {width: 560}});
        expect(panelConstraints({role: "tool", name: "auxiliarybar", tabs: [], active: null}, new Map(), 1440).maximumSize.width).toBe(648);
        expect(panelConstraints({role: "tool", name: "auxiliarybar", tabs: [], active: null}, new Map(), 400).maximumSize.width).toBe(360);
        expect(panelConstraints({role: "editor", tabs: [], active: null}, new Map(), 1440).minimumSize).toEqual({width: 220, height: 120});
    });

    it("视图声明的最小最大取所有标签的并：切标签不改布局", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW({minimumSize: {width: 300}})], ["b", VIEW({minimumSize: {height: 200}, maximumSize: {width: 400}})]]);
        const result = panelConstraints({role: "tool", tabs: [{kind: "view", viewId: "a"}, {kind: "view", viewId: "b"}], active: "view:a"}, catalog, 1440);
        expect(result.minimumSize).toEqual({width: 300, height: 200});
        expect(result.maximumSize.width).toBe(400);
    });

    it("最大值不低于最小值", () => {
        const catalog: ViewCatalog = new Map([["a", VIEW({minimumSize: {width: 500}})], ["b", VIEW({maximumSize: {width: 300}})]]);
        expect(panelConstraints({role: "tool", tabs: [{kind: "view", viewId: "a"}, {kind: "view", viewId: "b"}], active: "view:a"}, catalog, 1440).maximumSize.width).toBe(500);
    });

    it("接受矩阵：两者不进同一组标签，外缘都接受", () => {
        const tool = {role: "tool" as const, tabs: [], active: null};
        const editor = {role: "editor" as const, tabs: [], active: null};
        const view = {kind: "view" as const, viewId: "a"};
        const tab = {kind: "tab" as const, type: "nbook.editor", tabId: "t"};
        expect(layoutAccepts([view], tool, "strip")).toBe(true);
        expect(layoutAccepts([view], editor, "center")).toBe(false);
        expect(layoutAccepts([tab], editor, "strip")).toBe(true);
        expect(layoutAccepts([tab], tool, "center")).toBe(false);
        expect(layoutAccepts([tab], tool, "edge")).toBe(true);
        expect(layoutAccepts([view], editor, "edge")).toBe(true);
    });
});
