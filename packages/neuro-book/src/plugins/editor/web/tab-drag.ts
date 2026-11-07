/**
 * 拖动编辑器标签（docs/specs/workbench/editor.md 输出 55）：手势、落点规则与插入判定是工作台和 `TabStrip` 的（`workbench/web/layout-drag.ts`，docs/specs/ui/workbench-layout.md 输出 25 到 32），
 * 编辑器只回答放下要做什么。放下走编辑器区的动作，不直接改布局：要先结算活动视图的输入，同一标签要合并，固定与 preview 跟着落点变。
 */

import type {LayoutDropAction} from "@notnotype/nb-layout";

import type {TextResolver} from "nbook/shared/localized-text";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type {EditorTabDrag} from "nbook/plugins/workbench/web/contracts";

import type {EditorArea} from "./area";
import {nameOf} from "./documents/address";
import type {EditorPageSource} from "./pages";
import {pageIdOf} from "./pages";
import {tabLabel} from "./tab-label";

export interface EditorTabDragDeps {
    area(): EditorArea;
    pages(): EditorPageSource | null;
    wrapTabs(): boolean;
    readonly text: TextResolver;
}

export function createEditorTabDrag(deps: EditorTabDragDeps): EditorTabDrag {
    const tabOf = (tabId: string) => deps.area().groups.find(tabId);
    return {
        // 固定状态与多行设置变了，标签条的分区就变了：那一场拖动取消。
        structure: () => JSON.stringify([deps.wrapTabs(), deps.area().groups.groups.value.map((group) => group.tabs.flatMap((tab) => (tab.kind === "file" && tab.pinned === true ? [tab.id] : [])))]),
        ghost: (tabId) => {
            const tab = tabOf(tabId)?.tab;
            if (tab === undefined) return null;
            return {label: tabLabel(deps.area(), tab, deps.text, deps.pages()), fileIcon: pageIdOf(tab.address) === null ? fileIconForName(nameOf(tab.address)) : null};
        },
        previewable: (tabId, action) => {
            const area = deps.area();
            const target = action.kind === "strip" || action.kind === "center" ? action.panel : null;
            return !area.moveBlocked(tabId, target);
        },
        drop: (tabId, action, part, keyboard) => dropTab(deps.area(), tabId, action, part, keyboard),
        dropPanel: (panelId, action, _part, keyboard) => void dockGroup(deps.area(), panelId, action, keyboard),
    };
}

/**
 * 整个浮动的编辑组停靠（docs/specs/ui/workbench-layout.md 输出 39）：按标签顺序逐个走移动的结算、同文件合并与固定分区，中途被拒绝就停，剩下的留在窗里，提示照旧（`area.notice`）。一次性搬完会绕过这些规则。
 */
async function dockGroup(area: EditorArea, panelId: string, action: LayoutDropAction, keyboard: boolean): Promise<void> {
    const group = area.groups.groups.value.find((candidate) => candidate.id === panelId);
    if (group === undefined || group.tabs.length === 0) return;
    const active = group.active;
    const tabs = [...group.tabs];
    const pinned = (tab: (typeof tabs)[number]): boolean => tab.kind === "file" && tab.pinned === true;
    let target: string | null = null;
    let before: string | null = null;
    if (action.kind === "edge") {
        const first = tabs.shift();
        if (first === undefined || !area.moveToNewGroup(first.id, action.target, {focusView: false}).ok) return;
        target = area.groups.find(first.id)?.group.id ?? null;
    } else if (action.kind === "strip" || action.kind === "center" || action.kind === "reveal") {
        target = action.panel;
        if (action.kind === "strip") before = area.groups.groups.value.find((candidate) => candidate.id === action.panel)?.tabs[action.index]?.id ?? null;
    }
    if (target === null) return;
    for (const tab of tabs) {
        // 落点上的标签和它不在同一分区时，插到它自己那个分区的末尾。
        const next = before === null ? undefined : area.groups.find(before)?.tab;
        const inPartition = next !== undefined && (next.kind === "file" && next.pinned === true) === pinned(tab);
        const moved = await area.moveTab(tab.id, {group: target, partition: pinned(tab) ? "pinned" : "normal", before: inPartition ? next.id : null}, {focusView: false});
        if (!moved.ok) return;
    }
    if (active !== null && area.groups.find(active) !== null) area.activate(active, {focusView: !keyboard});
}

function dropTab(area: EditorArea, tabId: string, action: LayoutDropAction, part: string | undefined, keyboard: boolean): void {
    // 键盘放下时手势把焦点还给标签（docs/specs/ui/workbench-layout.md 输出 31），不交给视图。
    const focusView = !keyboard;
    switch (action.kind) {
        case "strip": {
            const partition = part === "pinned" ? "pinned" : "normal";
            const next = area.groups.groups.value.find((group) => group.id === action.panel)?.tabs[action.index];
            // 这个位置上的标签不在目标分区：插入位是分区末尾（固定行的行尾）。
            const inPartition = next !== undefined && (next.kind === "file" && next.pinned === true) === (partition === "pinned");
            void area.moveTab(tabId, {group: action.panel, partition, before: inPartition ? next.id : null}, {focusView});
            return;
        }
        case "center":
            void area.moveTab(tabId, {group: action.panel, partition: "normal", before: null}, {focusView});
            return;
        case "edge":
            area.moveToNewGroup(tabId, action.target, {focusView});
            return;
        case "reveal":
            // 接受矩阵：编辑器标签进不了工具面板，预备区不接收它（docs/specs/ui/workbench-layout.md 输出 26）。
            return;
        case "float":
            area.moveToFloat(tabId, action.rect, {focusView});
            return;
    }
}
