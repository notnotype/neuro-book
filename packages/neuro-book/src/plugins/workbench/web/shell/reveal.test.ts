/**
 * 预备区的矩形（docs/specs/ui/workbench-shell.md 外壳三输出 20）：真实的外壳投影与网格，没显示的 Part 显示出来会在
 * 哪里、多大。
 */

import {describe, expect, it} from "bun:test";

import type {GridExtent} from "@notnotype/nb-layout";

import {createShellGrid, projectShell, shellNodeRects} from "./layout";
import type {ShellNodeRect, ShellProjectionInput} from "./layout";
import type {PanelState} from "./panel-state";
import {hiddenRevealParts, revealZones} from "./reveal";
import {SHELL_SIZE_DEFAULTS} from "./sizes";

const VIEWPORT: GridExtent = {width: 1440, height: 900};
const PANEL: PanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};
const input = (overrides: Partial<ShellProjectionInput> = {}): ShellProjectionInput => ({extent: VIEWPORT, preferences: SHELL_SIZE_DEFAULTS, panel: PANEL, hiddenParts: [], ...overrides});

/** 全都显示时的叶矩形：预备区应当与它一致。 */
function shownRects(overrides: Partial<ShellProjectionInput> = {}): Record<string, ShellNodeRect> {
    const grid = createShellGrid(projectShell(input(overrides)));
    return shellNodeRects(grid, grid.layout(VIEWPORT));
}

const overlaps = (a: ShellNodeRect, b: ShellNodeRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("预备区", () => {
    it("都显示时没有预备区；面板收成标题头仍算显示", () => {
        expect(revealZones(input())).toEqual([]);
        expect(hiddenRevealParts(input({panel: {...PANEL, collapsed: true}}))).toEqual([]);
    });

    it("右栏隐藏、面板隐藏：两块预备区就是一起显示时它们的叶矩形，彼此不重叠", () => {
        const zones = revealZones(input({hiddenParts: ["auxiliarybar"], panel: {...PANEL, hidden: true}}));
        const expected = shownRects();
        expect(zones.map((zone) => zone.part)).toEqual(["auxiliarybar", "panel"]);
        expect(zones.map((zone) => zone.rect)).toEqual([expected.auxiliarybar, expected.panel]);
        expect(overlaps(zones[0]!.rect, zones[1]!.rect)).toBe(false);
    });

    it("侧栏拖到零：预备区按记住的宽度；面板收起又隐藏：按显示面板的样子（不收起）", () => {
        const [sidebar] = revealZones(input({dragCollapsedParts: {sidebar: true}}));
        expect(sidebar?.part).toBe("sidebar");
        expect(sidebar!.rect.right - sidebar!.rect.left).toBe(SHELL_SIZE_DEFAULTS.sidebarWidth);
        const [panel] = revealZones(input({panel: {...PANEL, hidden: true, collapsed: true}}));
        expect(panel?.rect).toEqual(shownRects().panel);
    });

    it("紧凑呈现不浮出预备区", () => {
        expect(revealZones(input({extent: {width: 390, height: 700}, hiddenParts: ["auxiliarybar"], panel: {...PANEL, hidden: true}}))).toEqual([]);
    });
});
