/**
 * 注音（docs/specs/workspace/markdown-dialect.md 输出 12）：`<ruby text="注音">正文</ruby>`，也能读标准 HTML 的
 * `<ruby>正文<rt>注音</rt></ruby>`，写回保持原来的写法。没有注音的 `<ruby>正文</ruby>` 读成注音为空的注音，照原样写回。
 *
 * 注音的正文只能是纯文字：读进来的正文里有格式、换行或标签时不认领（整体为原样片段）。注音标记的优先级最低，写出时在最里层：
 * 盖住整段注音的格式写在 `<ruby>` 外面；只盖住一部分时注音在格式的边界处断开成两个同样的注音，读回来仍是一个（属性相同的
 * 相邻标记合成一段）。
 */

import {Mark, mergeAttributes} from "@tiptap/core";
import type {Mark as PMMark, MarkType, Node as PMNode} from "@tiptap/pm/model";
import type {MarkedExtension, Token, Tokens} from "marked";
import {decodeHTMLStrict} from "entities";

import {escapeAttribute} from "../../../markdown-dialect";

import {closeInline, openTagAt, openTagIndex} from "../tags";
import {CODE_EXCLUSIVE} from "../types";
import type {MarkdownSyntax, MarkWriter, TokenReader, WriteContext} from "../types";
import {wholeRubyPlugin} from "./whole-ruby";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownRuby: {
            setMarkdownRuby: (text: string) => ReturnType;
            unsetMarkdownRuby: () => ReturnType;
        };
    }
}

/**
 * 写法：`attr` 是 `text` 属性（记开标签原文与它表示的注音），`rt` 是 `<rt>` 子标签，`bare` 是没有注音。`rt` 与 `bare` 记开闭
 * 标签的原文（与 `<rt>` 的标签名），写回时大小写不变。
 */
type RubyStyle =
    | {readonly form: "attr"; readonly open: string; readonly text: string}
    | {readonly form: "rt"; readonly open: string; readonly close: string; readonly rt: string}
    | {readonly form: "bare"; readonly open: string; readonly close: string};

/** 范围里有没有能放注音的字：所在的块收这个标记，字上也没有排斥它的标记（行内代码）。同 Tiptap `setMark` 的判断。 */
function allowsRuby(doc: PMNode, from: number, to: number, type: MarkType): boolean {
    let allowed = false;
    doc.nodesBetween(from, to, (node, _pos, parent) => {
        if (allowed) return false;
        if (node.isInline) {
            allowed = (parent === null || parent.type.allowsMarkType(type)) && !node.marks.some((mark) => mark.type !== type && mark.type.excludes(type));
        }
        return !allowed;
    });
    return allowed;
}

export const MarkdownRuby = Mark.create({
    name: "markdownRuby",
    // 最低：写出时在最里层（见文件头）。
    priority: 50,
    group: CODE_EXCLUSIVE,
    inclusive: false,
    addAttributes() {
        return {
            text: {default: "", parseHTML: (element: HTMLElement) => element.getAttribute("text") ?? element.querySelector("rt")?.textContent ?? "", renderHTML: () => ({})},
            markdown: {default: null, rendered: false, keepOnSplit: false},
        };
    },
    parseHTML() {
        return [{tag: "ruby", contentElement: (dom) => (dom as HTMLElement).querySelector(".nb-ruby-base") ?? (dom as HTMLElement)}];
    },
    renderHTML({mark, HTMLAttributes}) {
        return ["ruby", mergeAttributes(HTMLAttributes, {class: "nb-ruby"}), ["span", {class: "nb-ruby-base"}, 0], ["rt", {class: "nb-ruby-text", contenteditable: "false"}, String(mark.attrs.text ?? "")]];
    },
    addCommands() {
        return {
            // 每次放一个新的注音，不用 `setMark`：它把选区里旧注音的属性（含记下的原文写法）合进来，盖住旧注音与旁边的字时
            // 成了两个属性不同的注音，写回是两个 `<ruby>`。
            setMarkdownRuby: (text: string) => ({tr, state, dispatch}) => {
                const {empty, ranges} = state.selection;
                if (empty || !ranges.some((range) => allowsRuby(state.doc, range.$from.pos, range.$to.pos, this.type))) return false;
                if (dispatch !== undefined) {
                    for (const range of ranges) tr.addMark(range.$from.pos, range.$to.pos, this.type.create({text}));
                }
                return true;
            },
            unsetMarkdownRuby: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
    addProseMirrorPlugins() {
        return [wholeRubyPlugin(this.type)];
    },
});

interface RubyToken extends Tokens.Generic {
    readonly text: string;
    readonly style: RubyStyle;
    readonly tokens: Token[];
}

const RT = /^([\s\S]*?)<(rt)>([^<]*)<\/rt>$/iu;

/** 纯文字：只有文字与转义，没有换行。 */
const plain = (tokens: ReadonlyArray<Token>): boolean =>
    tokens.every((token) => (token.type === "text" && ((token as Tokens.Text).tokens?.length ?? 0) === 0 && !token.raw.includes("\n")) || token.type === "escape");

const tokenizer: MarkedExtension = {
    extensions: [
        {
            name: "ruby",
            level: "inline",
            start: (src: string) => openTagIndex(src, ["ruby"]),
            tokenizer(src: string): RubyToken | undefined {
                const open = openTagAt(src, ["ruby"]);
                if (open === null || [...open.attributes.keys()].some((name) => name !== "text")) return undefined;
                const close = closeInline(src, "ruby", open.length);
                if (close === null) return undefined;
                const inner = src.slice(open.length, close.start);
                const closing = src.slice(close.start, close.end);
                let base = inner;
                let text = open.attributes.get("text");
                let style: RubyStyle;
                if (text !== undefined) {
                    style = {form: "attr", open: open.raw, text};
                } else {
                    const rt = RT.exec(inner);
                    if (rt !== null) {
                        base = rt[1] as string;
                        text = decodeHTMLStrict(rt[3] as string);
                        style = {form: "rt", open: open.raw, close: closing, rt: rt[2] as string};
                    } else {
                        text = "";
                        style = {form: "bare", open: open.raw, close: closing};
                    }
                }
                const tokens = this.lexer.inlineTokens(base);
                if (base === "" || !plain(tokens)) return undefined;
                return {type: "ruby", raw: src.slice(0, close.end), text, style, tokens};
            },
        },
    ],
};

const readInline: Readonly<Record<string, TokenReader>> = {
    ruby: (token, context) => {
        const value = token as RubyToken;
        return context.mark("markdownRuby", context.inline(value.tokens), {text: value.text, markdown: value.style});
    },
};

/** 这次按哪种写法写：记下的写法还对得上（`attr` 的注音没变）就按它，否则有注音写 `text` 属性、没有写 `bare`。 */
function formOf(mark: PMMark, context: WriteContext): RubyStyle {
    const text = String(mark.attrs.text ?? "");
    const kept = context.style<RubyStyle>(mark);
    if (kept?.form === "attr" && kept.text === text) return kept;
    if (kept?.form === "rt" && text !== "") return kept;
    if (kept?.form === "bare" && text === "") return kept;
    return text === "" ? {form: "bare", open: "<ruby>", close: "</ruby>"} : {form: "attr", open: `<ruby text="${escapeAttribute(text)}">`, text};
}

const writeMark: Readonly<Record<string, MarkWriter>> = {
    markdownRuby: {
        textOnly: true,
        open: (mark, context) => formOf(mark, context).open,
        close: (mark, context) => {
            const form = formOf(mark, context);
            if (form.form === "attr") return "</ruby>";
            if (form.form === "bare") return form.close;
            return `<${form.rt}>${String(mark.attrs.text ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;")}</${form.rt}>${form.close}`;
        },
    },
};

export const rubySyntax: MarkdownSyntax = {
    name: "ruby",
    extensions: [MarkdownRuby],
    marked: [tokenizer],
    readInline,
    writeMark,
    inlineTags: ["ruby"],
};
