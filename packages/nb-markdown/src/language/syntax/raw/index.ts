/**
 * 原样块与原样片段（docs/specs/workspace/markdown-dialect.md 输出 9）：NeuroBook 认不出、或编辑器表达不了的语法，读进来显示源码，
 * 可以整体删除、复制，写回时字节不变。节点只持有原文字节（`raw` 属性），读入时由调度器从原文切出，不用规范化后的文字。
 *
 * 认领的范围：方言之外的 HTML（块级片段、行内标签与残片；判据沿用旧的 HtmlFallback）、HTML 注释、引用定义、脚注的引用与定义、
 * 数学（`$…$` 按 Pandoc 的规则，`$$` 块）。分块时对不上任何词法单元的原文、不合 schema 的块也由调度器读成原样块。
 *
 * 分词规则最先登记、最后试（见 `language.ts`），方言标签的合法形态都由各自模块先认领；这里再用标签名单挡一道，
 * 登记顺序出错时也不会抢走方言标签。
 */

import {mergeAttributes, Node} from "@tiptap/core";

import {LONE_TAG, OPENS_HTML_BLOCK} from "../../../markdown-dialect";
import {createRawMarked} from "../../../marked/raw";

import {encodeRawBreaks} from "../../codec/render/escape";
import type {MarkdownSyntax, TokenReader} from "../types";
import {Unrepresentable} from "../types";

export const RawBlock = Node.create({
    name: "rawBlock",
    group: "block",
    atom: true,
    selectable: true,
    // 低于段落：空文档与空容器的默认填充必须是段落（ProseMirror 取 schema 里第一个能默认创建的块）。
    priority: 50,
    addAttributes() {
        return {raw: {default: "", rendered: false}};
    },
    parseHTML() {
        return [{tag: "pre[data-nb-raw-block]", getAttrs: (dom) => ({raw: (dom as HTMLElement).textContent ?? ""})}];
    },
    renderHTML({node}) {
        return ["pre", mergeAttributes({class: "nb-html-block", "data-nb-raw-block": "", contenteditable: "false"}), String(node.attrs.raw ?? "")];
    },
    renderText({node}) {
        return String(node.attrs.raw ?? "");
    },
});

export const RawInline = Node.create({
    name: "rawInline",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    priority: 50,
    addAttributes() {
        return {raw: {default: "", rendered: false}};
    },
    parseHTML() {
        return [{tag: "span[data-nb-raw-inline]", getAttrs: (dom) => ({raw: (dom as HTMLElement).getAttribute("data-nb-raw-inline") ?? ""})}];
    },
    renderHTML({node}) {
        const raw = String(node.attrs.raw ?? "");
        return ["span", mergeAttributes({class: "nb-raw-inline-html", "data-nb-raw-inline": raw, contenteditable: "false", title: raw}), raw];
    },
    renderText({node}) {
        return String(node.attrs.raw ?? "");
    },
});

/**
 * 原样语法。`blockTags`、`inlineTags` 是全部方言的标签名：它们的合法形态由各自模块认领，残片才落到这里。
 */
export function createRawSyntax(tags: {readonly blockTags: ReadonlyArray<string>; readonly inlineTags: ReadonlyArray<string>}): MarkdownSyntax {
    const block: TokenReader = (token, context) => [context.raw(token, false)];
    const inline: TokenReader = (token, context) => [context.raw(token, true)];
    return {
        name: "raw",
        extensions: [RawBlock, RawInline],
        marked: [createRawMarked(tags)],
        read: {
            rawHtmlBlock: block,
            footnoteDef: block,
            mathBlock: block,
            def: block,
            // 块级 HTML：注释与 `marked` 认出的各类 HTML 块。
            html: block,
        },
        readInline: {
            rawHtmlInline: inline,
            footnoteRef: inline,
            mathInline: inline,
            // 能读的行内 HTML 已由核心语法整体认领，落到这里的是 HTML 注释与配不上对的标签。
            html: inline,
        },
        joinedInline: {rawInline: "raw"},
        // 原样内容自带的换行带上标记写出（见 `codec/render/escape.ts` 的 `encodeRawBreaks`）。
        writeBlock: {rawBlock: (node) => encodeRawBreaks(String(node.attrs.raw ?? ""))},
        writeInline: {
            // 段首就是会开启 HTML 块的原样片段、或者整段只有一个完整标签时写不出（方言 Spec 输出 9）：它会被读成原样块。
            // 后面跟着换行的情况由换行的写法处理（写成 `<br>`，标签不独占一行）。
            rawInline: (node, _context, around) => {
                const raw = String(node.attrs.raw ?? "");
                if (around.previous === null && around.place.table !== true && (OPENS_HTML_BLOCK.test(raw) || (around.next === null && LONE_TAG.test(raw)))) throw new Unrepresentable("段首的 HTML 会被读成 HTML 块");
                return encodeRawBreaks(raw);
            },
        },
    };
}
