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
        drop: (tabId, action, part) => dropTab(deps.area(), tabId, action, part),
    };
}

function dropTab(area: EditorArea, tabId: string, action: LayoutDropAction, part: string | undefined): void {
    switch (action.kind) {
        case "strip": {
            const partition = part === "pinned" ? "pinned" : "normal";
            const next = area.groups.groups.value.find((group) => group.id === action.panel)?.tabs[action.index];
            // 这个位置上的标签不在目标分区：插入位是分区末尾（固定行的行尾）。
            const inPartition = next !== undefined && (next.kind === "file" && next.pinned === true) === (partition === "pinned");
            void area.moveTab(tabId, {group: action.panel, partition, before: inPartition ? next.id : null});
            return;
        }
        case "center":
            void area.moveTab(tabId, {group: action.panel, partition: "normal", before: null});
            return;
        case "edge":
            area.moveToNewGroup(tabId, action.target);
            return;
        case "reveal":
            // 接受矩阵：编辑器标签进不了工具面板，预备区不接收它（docs/specs/ui/workbench-layout.md 输出 26）。
            return;
    }
}
