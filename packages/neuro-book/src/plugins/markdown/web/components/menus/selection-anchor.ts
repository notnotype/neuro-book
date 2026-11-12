/** 菜单贴选区、贴光标用的虚拟锚点：每次定位都重新量，选区随正文滚动时跟得上。 */

import {posToDOMRect} from "@tiptap/core";
import type {Editor} from "@tiptap/core";

export type PopoverAnchor = {getBoundingClientRect: () => DOMRect; contextElement?: Element};

export function selectionAnchor(editor: Editor, contextElement: Element | null): PopoverAnchor {
    return {
        getBoundingClientRect: () => {
            const {from, to} = editor.state.selection;
            return posToDOMRect(editor.view, from, to);
        },
        ...(contextElement === null ? {} : {contextElement}),
    };
}

/**
 * 光标所在行的虚拟锚点（批注卡片贴在这一行下面，docs/specs/workbench/markdown-editing.md 输出 30）。`at` 给了就用那个位置
 * （块批注贴在块里第一个文字处）；每次定位都重新量，所以光标移动、滚动都跟得上。
 */
export function caretAnchor(editor: Editor, contextElement: Element | null, at?: number): PopoverAnchor {
    return {
        getBoundingClientRect: () => {
            const pos = at ?? editor.state.selection.head;
            return posToDOMRect(editor.view, pos, pos);
        },
        ...(contextElement === null ? {} : {contextElement}),
    };
}
