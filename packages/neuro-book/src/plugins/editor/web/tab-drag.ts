/**
 * 拖动编辑器标签（docs/specs/workbench/editor.md 输出 55）：手势与落点规则是工作台的（`workbench/web/layout-drag.ts`，docs/specs/ui/workbench-layout.md 输出 25 到 32），编辑器只回答它自己的
 * 标签条的问题：指针在标签条里算插入到哪（多行、固定分区）、放下要做什么。放下走编辑器区的动作，不直接改布局：要先结算活动视图的输入，同一标签要合并，固定与 preview 跟着落点变。
 */

import {resolveListInsertion} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, LayoutDropAction} from "@notnotype/nb-layout";

import type {TextResolver} from "nbook/shared/localized-text";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type {EditorTabDrag, EditorTabInsertion} from "nbook/plugins/workbench/web/contracts";

import type {EditorArea} from "./area";
import {nameOf} from "./documents/address";
import type {EditorPageSource} from "./pages";
import {pageIdOf} from "./pages";
import {tabLabel} from "./tab-label";

const rectOf = (element: Element): GridDropRect => {
    const box = element.getBoundingClientRect();
    return {left: box.left, top: box.top, right: box.right, bottom: box.bottom};
};

/** 标签条里一条看得见的行：属于哪一类（固定或普通）、行里的标签按呈现顺序、整个分区的完整顺序。 */
interface Line {
    readonly partition: "pinned" | "normal";
    readonly rect: GridDropRect;
    readonly members: ReadonlyArray<{readonly id: string; readonly rect: GridDropRect; readonly pinned: boolean}>;
}

/** 标签条的行：多行时普通标签那一行（一个元素）会折成几条，按标签的顶边分开。 */
function linesOf(strip: HTMLElement): Line[] {
    const lines: Line[] = [];
    const stripRect = rectOf(strip);
    for (const row of strip.querySelectorAll<HTMLElement>("[data-row]")) {
        const frames = [...row.querySelectorAll<HTMLElement>("[data-editor-tab]")].map((tab) => ({id: tab.dataset.editorTab as string, rect: rectOf(tab.parentElement as HTMLElement), pinned: tab.hasAttribute("data-editor-tab-pinned")}));
        const byTop = new Map<number, typeof frames>();
        for (const frame of frames) {
            const key = Math.round(frame.rect.top);
            byTop.set(key, [...(byTop.get(key) ?? []), frame]);
        }
        const rowRect = rectOf(row);
        for (const [, members] of [...byTop].sort(([a], [b]) => a - b)) {
            const top = Math.min(...members.map((member) => member.rect.top));
            const bottom = Math.max(...members.map((member) => member.rect.bottom));
            lines.push({partition: row.dataset.row === "pinned" ? "pinned" : "normal", rect: {left: Math.max(stripRect.left, rowRect.left), right: Math.min(stripRect.right, rowRect.right), top, bottom}, members});
        }
        // 空的行（多行时没有普通标签）：整行是一个插入位。
        if (frames.length === 0) lines.push({partition: row.dataset.row === "pinned" ? "pinned" : "normal", rect: rowRect, members: []});
    }
    return lines;
}

/** 指针在标签条里的插入位（纯读 DOM 的几何）。`index` 是这组全部标签的呈现顺序里、摘掉来源之前的位置。 */
export function resolveStripInsertion(strip: HTMLElement, point: GridDropPoint, tabId: string, sameGroup: boolean): EditorTabInsertion | null {
    const lines = linesOf(strip);
    if (lines.length === 0) return null;
    // 先按纵向距离选行（在行里的距离为 0），再在行里求插入位。
    const distance = (line: Line): number => (point.y < line.rect.top ? line.rect.top - point.y : point.y > line.rect.bottom ? point.y - line.rect.bottom : 0);
    const line = lines.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
    const containerRect = {...line.rect, left: Math.min(line.rect.left, point.x), right: Math.max(line.rect.right, point.x)};
    const insertion = resolveListInsertion({orientation: "horizontal", point: {x: point.x, y: (line.rect.top + line.rect.bottom) / 2}, containerRect, members: line.members.map(({id, rect}) => ({id, rect}))});
    if (insertion === null) return null;
    /** 完整顺序（含滚出视口的、折到别的行的），按呈现顺序。 */
    const all = [...strip.querySelectorAll<HTMLElement>("[data-editor-tab]")].map((tab) => ({id: tab.dataset.editorTab as string, pinned: tab.hasAttribute("data-editor-tab-pinned"), rect: rectOf(tab.parentElement as HTMLElement)}));
    let before = insertion.beforeId;
    let indicator = insertion.indicator;
    let partition: "pinned" | "normal";
    if (before !== null) {
        // 单行时固定与普通同在一行：插在固定标签前面才算进固定区。
        partition = line.partition === "pinned" || all.find((tab) => tab.id === before)?.pinned === true ? "pinned" : "normal";
    } else {
        // 行尾的插入位：共享算法只认这一行看得见的成员，`null` 只是“最后一个看得见的之后”。换算成完整顺序里它的后继
        // （滚出视口的、折到下一行的都算），后继看得见时线画在它前面（换行处归一到下一行行首）；没有后继才是分区末尾。
        const visible = line.members.filter((member) => member.rect.right > containerRect.left && member.rect.left < containerRect.right);
        const after = visible.at(-1);
        partition = line.partition === "pinned" || after?.pinned === true ? "pinned" : "normal";
        const inPartition = all.filter((tab) => tab.pinned === (partition === "pinned"));
        const successor = after === undefined ? undefined : inPartition[inPartition.findIndex((tab) => tab.id === after.id) + 1];
        if (successor !== undefined) {
            before = successor.id;
            const view = rectOf(strip);
            if (successor.rect.left >= view.left && successor.rect.right <= view.right && successor.rect.top >= view.top && successor.rect.bottom <= view.bottom) indicator = {left: successor.rect.left - 1, right: successor.rect.left + 1, top: successor.rect.top, bottom: successor.rect.bottom};
        }
    }
    // 放回原位：同组、同区，插入位就在它自己的前面或后面。
    const order = all.filter((tab) => tab.pinned === (partition === "pinned")).map((tab) => tab.id);
    const own = order.indexOf(tabId);
    const insertAt = before === null ? order.length : order.indexOf(before);
    const inPlace = sameGroup && own >= 0 && (insertAt === own || insertAt === own + 1);
    const index = before === null ? all.filter((tab) => tab.pinned || partition === "normal").length : all.findIndex((tab) => tab.id === before);
    return {index, part: partition, indicator, inPlace};
}

export interface EditorTabDragDeps {
    area(): EditorArea;
    pages(): EditorPageSource | null;
    wrapTabs(): boolean;
    readonly text: TextResolver;
}

export function createEditorTabDrag(deps: EditorTabDragDeps): EditorTabDrag {
    const tabOf = (tabId: string) => deps.area().groups.find(tabId);
    return {
        insertion: (panel, point, tabId) => {
            const strip = document.querySelector<HTMLElement>(`[data-panel-strip="${CSS.escape(panel)}"] [data-editor-tabs]`);
            return strip === null ? null : resolveStripInsertion(strip, point, tabId, tabOf(tabId)?.group.id === panel);
        },
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
