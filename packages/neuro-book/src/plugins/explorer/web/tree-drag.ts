/**
 * 树内拖动的来源与落点（docs/specs/workbench/files-explorer.md 的“拖动”）：只把按下处的行、指针下的行与它在行里的位置交出去。
 * 手势是 nb-layout 的拖动会话（docs/specs/ui/layout-drag.md），源的冻结、落点判定与提交归控制器。
 *
 * 落点有三类：树里的一行、树里行以外的空白、树外的编辑组（经落点登记查到，docs/specs/workbench/editor.md 输出 35）。
 *
 * 树里的按下不进外壳的拖动会话：外壳只认视图标题与标签上的拖动源标记。
 */

import {dropTargetAt} from "@notnotype/nb-layout/vue";

import {EDITOR_GROUP_FILE} from "nbook/plugins/editor/shared/contracts";

/** 指针下的落点：一行（行 id、指针相对行顶的比例 0 到 1 与相对行左边的像素）、树里行以外的空白，或树外的一个编辑组；`rect` 是它的视口矩形。 */
export type TreeDragTarget =
    | {readonly kind: "row"; readonly id: string; readonly offset: number; readonly x: number; readonly rect: DOMRect}
    | {readonly kind: "blank"; readonly rect: DOMRect}
    | {readonly kind: "editor"; readonly group: string; readonly rect: DOMRect};

const ROW_SELECTOR = "[data-explorer-row]";
/** 装行的容器：它的底边之下才是“树里行以外的空白”。 */
const ROWS_SELECTOR = "[data-explorer-rows]";
/** 行里的输入框与按钮自己处理指针。 */
const BLOCKING_SELECTOR = "input, textarea, button, [contenteditable='true'], [contenteditable='']";

/** 按下处的行；按在输入框、按钮上或行外时为 null。`root` 是树的滚动元素。 */
export function treeSourceAt(root: HTMLElement, target: Element): string | null {
    if (target.closest(BLOCKING_SELECTOR) !== null) return null;
    const row = target.closest<HTMLElement>(ROW_SELECTOR);
    return row !== null && root.contains(row) ? (row.dataset.explorerRow as string) : null;
}

/** 指针下的落点。`top` 是指针处最上层的业务元素（会话给的，被菜单或对话框挡住时不是树也不是编辑组）。 */
export function resolveTreeTarget(root: HTMLElement, top: Element | null, point: {readonly x: number; readonly y: number}): TreeDragTarget | null {
    if (top === null) return null;
    const asRow = (element: HTMLElement): TreeDragTarget => {
        const rect = element.getBoundingClientRect();
        return {kind: "row", id: element.dataset.explorerRow as string, offset: rect.height > 0 ? (point.y - rect.top) / rect.height : 0.5, x: point.x - rect.left, rect};
    };
    const row = top.closest<HTMLElement>(ROW_SELECTOR);
    if (row !== null && root.contains(row)) return asRow(row);
    if (root.contains(top)) {
        // 只有最后一行之下才是空白；行左右的内边距与滚动条那一条按同一高度的行算（取树中线上的那一行）。
        const tree = root.getBoundingClientRect();
        const rowsBottom = root.querySelector<HTMLElement>(ROWS_SELECTOR)?.getBoundingClientRect().bottom ?? tree.top;
        if (point.y >= rowsBottom) return {kind: "blank", rect: tree};
        const beside = root.ownerDocument.elementFromPoint(tree.left + tree.width / 2, point.y)?.closest<HTMLElement>(ROW_SELECTOR);
        return beside != null && root.contains(beside) ? asRow(beside) : null;
    }
    const group = dropTargetAt(top, EDITOR_GROUP_FILE);
    return group === null ? null : {kind: "editor", group: group.data.group, rect: group.element.getBoundingClientRect()};
}
