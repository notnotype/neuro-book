/**
 * 表情（docs/specs/agent/stickers.md 的“表情写法”与输出 21–24）：`:名字:`、`:包/名字:` 读成一个整体的行内节点 `sticker`，原文记
 * 在 `raw`、原样写回。认不认得出不影响读：同一份原文任何时候读出同一棵树，认得出与否在显示时经宿主端口查（`view.ts`）。
 *
 * 写成文字的写法（退格还原的、纯文字粘贴的）由正文的转义把开头的冒号写成 `\:`（`codec/render/escape.ts`）。
 */

import {InputRule, Node} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import type {MarkedExtension, Tokens} from "marked";

import {stickerAt, stickerEndingAt} from "../../../stickers";
import type {MarkdownSyntax} from "../types";

export const STICKER_NODE = "sticker";
/** 文本块里只有表情时至多这么多个显示成大图（输出 11）。 */
export const LARGE_STICKERS_MAX = 3;

export const rawOf = (node: PMNode): string => String(node.attrs.raw ?? "");

export const MarkdownSticker = Node.create({
    name: STICKER_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
        return {raw: {default: "", rendered: false}};
    },
    parseHTML() {
        // 表情元素整个认成这个叶子节点，里面的 `<img>` 不再解析：粘贴回来是表情，不会被核心的 Image 认成图片（输出 24）。
        return [{tag: "span[data-sticker]", getAttrs: (dom) => ({raw: (dom as HTMLElement).dataset.sticker ?? ""})}];
    },
    // 剪贴板的 HTML 与没有视图时的样子：带原文，别处粘贴得到文字。
    renderHTML({node}) {
        return ["span", {"class": "nb-sticker", "data-sticker": rawOf(node)}, rawOf(node)];
    },
    renderText: ({node}) => rawOf(node),
    addInputRules() {
        const type = this.type;
        // 打出结尾的冒号时，前面是一个完整写法就换成节点；Tiptap 的退格还原（`undoInputRule`）把它变回打出的文字（输出 22）。
        return [new InputRule({
            find: (text) => {
                const ref = stickerEndingAt(text);
                return ref === null ? null : {index: text.length - ref.raw.length, text: ref.raw};
            },
            handler: ({state, range, match}) => {
                state.tr.replaceWith(range.from, range.to, type.create({raw: match[0]}));
            },
        })];
    },
});

const tokenizers: MarkedExtension = {
    extensions: [{
        name: STICKER_NODE,
        level: "inline",
        start: (src: string) => {
            const index = src.indexOf(":");
            return index < 0 ? undefined : index;
        },
        tokenizer(src: string): Tokens.Generic | undefined {
            const ref = stickerAt(src, 0);
            return ref === null ? undefined : {type: STICKER_NODE, raw: ref.raw};
        },
    }],
};

export const stickerSyntax: MarkdownSyntax = {
    name: "sticker",
    extensions: [MarkdownSticker],
    marked: [tokenizers],
    readInline: {[STICKER_NODE]: (token) => [{type: STICKER_NODE, attrs: {raw: token.raw}}]},
    writeInline: {[STICKER_NODE]: (node) => rawOf(node)},
};

/** 一个文本块里只有表情与空白、表情 1 到 3 个（输出 11）：这些表情显示成大图。编辑器的装饰与展示器共用这一个判断。 */
export function isLargeStickerBlock(block: PMNode): boolean {
    if (!block.isTextblock) return false;
    let stickers = 0;
    let other = false;
    block.forEach((child) => {
        if (child.type.name === STICKER_NODE) stickers += 1;
        else if (!(child.isText && (child.text ?? "").trim() === "")) other = true;
    });
    return !other && stickers > 0 && stickers <= LARGE_STICKERS_MAX;
}

/** 大图的文本块带的类名。 */
export const LARGE_STICKER_CLASS = "nb-sticker-block";
