/**
 * 默认树与视图的第一次落位（docs/specs/ui/workbench-layout.md 输出 1、4）。纯函数。
 */

import {barRef, GRID_SNAPSHOT_VERSION, insertTab, panelRef, tabKey} from "@notnotype/nb-layout";
import type {LayoutDoc, PanelName, PanelRecord} from "@notnotype/nb-layout";

import type {ViewCatalog} from "../views/placement";
import {SHELL_ACTIVITYBAR_WIDTH, SHELL_SIZE_DEFAULTS, SHELL_STATUSBAR_HEIGHT} from "../shell/sizes";

/** 第一个编辑组的面板 id。 */
export const INITIAL_EDITOR_PANEL = "g0";

/** 尺寸意图是 CSS px；窗口不是这么大时按 `fixed`、`weight` 分配，不用在这里量。 */
const BASE = {width: 1440, height: 900};

function emptyPanels(): Record<string, PanelRecord> {
    const named = (name: PanelName): PanelRecord => ({role: "tool", name, tabs: [], active: null, hidden: true});
    return {
        sidebar: named("sidebar"),
        auxiliarybar: named("auxiliarybar"),
        panel: named("panel"),
        [INITIAL_EDITOR_PANEL]: {role: "editor", tabs: [], active: null},
    };
}

function emptyTree(): LayoutDoc["tree"] {
    const {sidebarWidth, auxiliarybarWidth, panelHeight} = SHELL_SIZE_DEFAULTS;
    const bodyHeight = BASE.height - SHELL_STATUSBAR_HEIGHT;
    const centerWidth = BASE.width - SHELL_ACTIVITYBAR_WIDTH - sidebarWidth - auxiliarybarWidth;
    const leaf = (id: string, width: number, height: number) => ({kind: "leaf" as const, id, ref: panelRef(id), size: {width, height}});
    return {
        version: GRID_SNAPSHOT_VERSION,
        root: {kind: "branch", id: "root", orientation: "vertical", size: BASE, children: [
            {kind: "branch", id: "body", orientation: "horizontal", size: {width: BASE.width, height: bodyHeight}, children: [
                {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size: {width: SHELL_ACTIVITYBAR_WIDTH, height: bodyHeight}},
                leaf("sidebar", sidebarWidth, bodyHeight),
                {kind: "branch", id: "center", orientation: "vertical", size: {width: centerWidth, height: bodyHeight}, children: [
                    leaf(INITIAL_EDITOR_PANEL, centerWidth, bodyHeight - panelHeight),
                    leaf("panel", centerWidth, panelHeight),
                ]},
                leaf("auxiliarybar", auxiliarybarWidth, bodyHeight),
            ]},
            {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size: {width: BASE.width, height: SHELL_STATUSBAR_HEIGHT}},
        ]},
    };
}

/** 目录里有、文档里还没有的视图，按 (order, id) 加到声明的具名面板标签末尾。面板隐藏着就保持隐藏；没有改动时返回原对象。 */
export function reconcileViews(doc: LayoutDoc, catalog: ViewCatalog): LayoutDoc {
    const present = new Set(Object.values(doc.panels).flatMap((panel) => panel.tabs.map(tabKey)));
    const missing = [...catalog.entries()]
        .filter(([id]) => !present.has(`view:${id}`))
        .sort(([leftId, left], [rightId, right]) => (left.order ?? 0) - (right.order ?? 0) || (leftId < rightId ? -1 : 1));
    let next = doc;
    for (const [viewId, declaration] of missing) {
        const panel = Object.entries(next.panels).find(([, record]) => record.name === declaration.location)?.[0];
        if (panel === undefined) continue;
        const result = insertTab(next, {panel, tab: {kind: "view", viewId}, activate: false});
        if (result.ok) next = result.doc;
    }
    return next;
}

/** 第一次生成文档：有视图的具名面板显示，空的隐藏。 */
export function defaultLayoutDoc(catalog: ViewCatalog): LayoutDoc {
    const empty: LayoutDoc = {version: 1, tree: emptyTree(), panels: emptyPanels(), floats: [], hiddenBars: [], currentEditor: INITIAL_EDITOR_PANEL};
    const filled = reconcileViews(empty, catalog);
    const panels = Object.fromEntries(Object.entries(filled.panels).map(([id, panel]) => {
        if (panel.name === undefined || panel.tabs.length === 0) return [id, panel];
        const {hidden: _hidden, ...shown} = panel;
        return [id, shown];
    }));
    return {...filled, panels};
}
