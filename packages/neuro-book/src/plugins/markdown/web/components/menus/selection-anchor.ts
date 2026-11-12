/** 菜单贴选区、贴一行文字用的虚拟锚点：每次定位都重新量，选区随正文滚动时跟得上。 */

import {posToDOMRect} from "@tiptap/core";
import type {Editor} from "@tiptap/core";

export type PopoverAnchor = {getBoundingClientRect: () => DOMRect; contextElement?: Element};

const withContext = (contextElement: Element | null): {contextElement?: Element} => (contextElement === null ? {} : {contextElement});

export function selectionAnchor(editor: Editor, contextElement: Element | null): PopoverAnchor {
    return {
        getBoundingClientRect: () => {
            const {from, to} = editor.state.selection;
            return posToDOMRect(editor.view, from, to);
        },
        ...withContext(contextElement),
    };
}

/**
 * `from`–`to` 这段文字在垂直位置 `y` 那一行上最靠左的位置；这一行上没有这段文字、或取不到盒子（没有布局）时为 null。比一行高得多的盒子（块的外框）
 * 不算：它的左边是版心的左缘，不是这段文字在这一行的起点。
 */
function leftOnLine(editor: Editor, from: number, to: number, y: number, lineHeight: number): number | null {
    const {view} = editor;
    const max = view.state.doc.content.size;
    const start = view.domAtPos(Math.max(0, Math.min(from, max)));
    const end = view.domAtPos(Math.max(0, Math.min(to, max)));
    const range = document.createRange();
    try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
    } catch {
        return null;
    }
    let left: number | null = null;
    for (const rect of Array.from(range.getClientRects())) {
        if (rect.width === 0 || rect.top > y || rect.bottom < y || rect.height > lineHeight * 1.6) continue;
        left = left === null ? rect.left : Math.min(left, rect.left);
    }
    return left;
}

/**
 * 批注卡片贴的那一行（docs/specs/workbench/markdown-editing.md 输出 30）：上下沿是 `pos` 所在的那一行，左边是这条批注（`ranges` 是它的各截，
 * 重叠的几条一起给）的文字在这一行的起点，配合 `AnchoredPopover` 的 `align="start"`，卡片的左边缘对着被批注的字，不居中于光标或指针。
 * 取不到批注在这一行的盒子时用 `pos` 自己的位置。每次定位重新量，所以滚动、光标移动都跟得上。
 */
export function commentLineAnchor(editor: Editor, contextElement: Element | null, pos: () => number, ranges: () => ReadonlyArray<{readonly from: number; readonly to: number}>): PopoverAnchor {
    return {
        getBoundingClientRect: () => {
            const at = pos();
            const caret = posToDOMRect(editor.view, at, at);
            const middle = (caret.top + caret.bottom) / 2;
            let left = caret.left;
            for (const range of ranges()) left = Math.min(left, leftOnLine(editor, range.from, range.to, middle, caret.height) ?? left);
            return new DOMRect(left, caret.top, 0, caret.height);
        },
        ...withContext(contextElement),
    };
}

/** 整块批注的“写”卡片贴的位置：这一块第一行的上下沿、块的左缘；原子块与表格取块顶上一行高的地方，不贴到整块的底下。 */
export function blockAnchor(editor: Editor, contextElement: Element | null, pos: () => number): PopoverAnchor {
    return {
        getBoundingClientRect: () => {
            const dom = editor.view.nodeDOM(pos());
            if (!(dom instanceof Element)) return new DOMRect(0, 0, 0, 0);
            const box = dom.getBoundingClientRect();
            const line = Number.parseFloat(getComputedStyle(dom).lineHeight);
            return new DOMRect(box.left, box.top, 0, Math.min(box.height, Number.isFinite(line) ? line : 24));
        },
        ...withContext(contextElement),
    };
}
