/**
 * 编辑器一侧的条目语法模块（最小版，docs/specs/canon/rendering.md 输出 21）：词法、原子与转义规则直接用内核的 `entryLexing`
 * （`@notnotype/nb-canon/grammar`），所以编辑器认出的标签与落点与内核相同。每个完整的标签读成一个行内的原子节点，属性 `source`
 * 存它的原文，写回原样写出；`If` 的开闭与分支标签各是一个节点（配对由内核做）。
 *
 * 富文本编辑器（w00055 t03）在它上面加小块的样子与改法；本 Task 用它对照编辑器与内核的读法。
 */

import {Node, mergeAttributes} from "@tiptap/core";
import type {MarkdownSyntax} from "@notnotype/nb-markdown/language/types";
import {entryLexing} from "@notnotype/nb-canon/grammar";

export const ENTRY_TAG_NODE = "canonEntryTag";

const entryTagNode = Node.create({
    name: ENTRY_TAG_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => ({source: {default: ""}}),
    parseHTML: () => [{tag: "span[data-canon-entry-tag]", getAttrs: (element) => ({source: element.getAttribute("data-source") ?? ""})}],
    renderHTML: ({node, HTMLAttributes}) => ["span", mergeAttributes(HTMLAttributes, {"data-canon-entry-tag": "", "data-source": node.attrs.source as string}), node.attrs.source as string],
});

export const entrySyntax: MarkdownSyntax = {
    ...entryLexing,
    extensions: [entryTagNode],
    readInline: {entryTag: (token) => [{type: ENTRY_TAG_NODE, attrs: {source: token.raw}}]},
    writeInline: {[ENTRY_TAG_NODE]: (node) => node.attrs.source as string},
};
