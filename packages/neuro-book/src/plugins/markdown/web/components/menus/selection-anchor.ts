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
