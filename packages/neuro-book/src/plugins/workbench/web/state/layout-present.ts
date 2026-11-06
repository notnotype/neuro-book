/**
 * 由文档算出这一刻怎么呈现（docs/specs/ui/workbench-layout.md“渲染”“面板头与活动栏”）：内容项、有效可见、活动栏条目点了做什么。纯模块，不碰 DOM 与记录。
 */

import {tabKey} from "@notnotype/nb-layout";
import type {GridContentInput, GridExtent, LayoutDoc, PanelRecord} from "@notnotype/nb-layout";

import {PANEL_HEAD_HEIGHT} from "./layout-constraints";

/**
 * 内容项：工具视图一个标签一项，`key` 就是标签键，所以视图换面板时内容跟着走。编辑组一块面板一项：一个组现在还是一个控件（每标签一实例见 w00026 t17）。
 * 工具面板的头在外框里，内容从头下面开始；编辑组的标签条还在自己的内容里。
 */
export function layoutContents(doc: LayoutDoc): GridContentInput[] {
    return Object.entries(doc.panels).flatMap(([id, panel]): GridContentInput[] => {
        if (panel.role === "editor") return [{key: `editor:${id}`, leaf: id, insetTop: 0, active: true}];
        return panel.tabs.map((tab) => ({key: tabKey(tab), leaf: id, insetTop: PANEL_HEAD_HEIGHT, active: panel.active === tabKey(tab)}));
    });
}

export interface VisibilityFacts {
    /** 已提交的呈现尺寸。 */
    readonly sizes: Readonly<Record<string, GridExtent>>;
    /** 手势进行中的预览尺寸；没有手势时是 null。 */
    readonly preview: Readonly<Record<string, GridExtent>> | null;
    /** 放不下被收走的面板。 */
    readonly removed: ReadonlySet<string>;
    readonly maximized: string | null;
}

function hasRoom(panel: PanelRecord, size: GridExtent | undefined): boolean {
    if (size === undefined) return false;
    return size.width > 0 && size.height > (panel.role === "tool" ? PANEL_HEAD_HEIGHT : 0);
}

/**
 * 有效可见的标签键（输出 17）。手势预览不改已经可见的面板：往零拖过阈值又拖回来，视图不闪；只有从零拉回时才按拖动中的几何算，内容在拖动中就出现（输出 12）。
 */
export function effectiveVisibleTabs(doc: LayoutDoc, facts: VisibilityFacts): ReadonlySet<string> {
    const visible = new Set<string>();
    for (const [id, panel] of Object.entries(doc.panels)) {
        if (panel.active === null || panel.hidden === true || facts.removed.has(id)) continue;
        if (facts.maximized !== null && facts.maximized !== id) continue;
        const committed = panel.collapsed !== true && hasRoom(panel, facts.sizes[id]);
        const pulledOut = facts.preview !== null && hasRoom(panel, facts.preview[id]);
        // 最大化盖在上面，矩形不来自布局结果。
        if (committed || pulledOut || facts.maximized === id) visible.add(panel.active);
    }
    return visible;
}

/** 活动栏条目点了做什么（输出 22）：不可见就显示，可见但焦点不在里面就聚焦，已经聚焦就隐藏；无名面板没有隐藏，是收起。 */
export type ToolEntryIntent =
    | {readonly kind: "reveal" | "focus" | "hide" | "collapse"; readonly panel: string}
    | {readonly kind: "none"};

export function toolEntryIntent(doc: LayoutDoc, viewId: string, facts: {readonly visible: ReadonlySet<string>; readonly focusedPanel: string | null}): ToolEntryIntent {
    const key = tabKey({kind: "view", viewId});
    for (const [id, panel] of Object.entries(doc.panels)) {
        if (!panel.tabs.some((tab) => tabKey(tab) === key)) continue;
        if (!facts.visible.has(key)) return {kind: "reveal", panel: id};
        if (facts.focusedPanel !== id) return {kind: "focus", panel: id};
        return {kind: panel.name === undefined ? "collapse" : "hide", panel: id};
    }
    return {kind: "none"};
}

/** 标签与它控制的内容互相引用的 DOM id：标签在面板头（外框里），内容在内容层，两边各算出同一个。 */
export const panelTabDomId = (prefix: string, key: string): string => `${prefix}-tab-${key}`;
export const panelTabpanelDomId = (prefix: string, key: string): string => `${prefix}-tabpanel-${key}`;
