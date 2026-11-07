/**
 * 树内拖动的来源与落点（docs/specs/workbench/files-explorer.md 的“拖动”）：只把按下处的行、指针下的行与它在行里的位置交出去。
 * 手势是 nb-layout 的拖动会话（docs/specs/ui/layout-drag.md），源的冻结、落点判定与提交归控制器。
 *
 * 落点有三类：树里的一行、树里行以外的空白、树外工作台给的落点（经外壳登记的 `WORKBENCH_FILE_DROP` 问，docs/specs/ui/workbench-layout.md 输出 39）。
 *
 * 树里的按下不进外壳的拖动会话：外壳只认视图标题与标签上的拖动源标记。
 */

import {dropTargetAt} from "@notnotype/nb-layout/vue";

import {WORKBENCH_FILE_DROP} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchFileDrop, WorkbenchFileDropHost} from "nbook/plugins/workbench/shared/contracts";

/** 指针下的落点：一行（行 id、指针相对行顶的比例 0 到 1 与相对行左边的像素）、树里行以外的空白，或树外工作台给的落点；`rect` 是树里那一块的视口矩形。 */
export type TreeDragTarget =
    | {readonly kind: "row"; readonly id: string; readonly offset: number; readonly x: number; readonly rect: DOMRect}
    | {readonly kind: "blank"; readonly rect: DOMRect}
    | {readonly kind: "editor"; readonly host: WorkbenchFileDropHost; readonly drop: WorkbenchFileDrop};

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

/** 指针下的落点。`top` 是指针处最上层的业务元素（会话给的，被菜单或对话框挡住时不是树也不是外壳；窗口外是 null）。 */
export function resolveTreeTarget(root: HTMLElement, top: Element | null, point: {readonly x: number; readonly y: number}): TreeDragTarget | null {
    const asRow = (element: HTMLElement): TreeDragTarget => {
        const rect = element.getBoundingClientRect();
        return {kind: "row", id: element.dataset.explorerRow as string, offset: rect.height > 0 ? (point.y - rect.top) / rect.height : 0.5, x: point.x - rect.left, rect};
    };
    if (top !== null) {
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
        // 还在树所在的那块面板里（树上下的横条、面板头、滚动条）：取消，不开窗。往树的下边缘自动滚动时过冲，指针就在这里。
        const leaf = root.closest("[data-content-leaf]")?.getAttribute("data-content-leaf");
        if (leaf != null) {
            const id = CSS.escape(leaf);
            if (top.closest(`[data-content-leaf="${id}"], [data-leaf="${id}"]`) !== null) return null;
        }
    }
    // 窗口外没有元素：从树自己往上找外壳。
    const host = dropTargetAt(top ?? root, WORKBENCH_FILE_DROP);
    if (host === null) return null;
    const drop = host.data.resolve(point, top);
    return drop === null ? null : {kind: "editor", host: host.data, drop};
}
