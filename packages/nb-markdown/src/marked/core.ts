/**
 * 核心语法在 `marked` 一侧的配置（docs/specs/workspace/markdown-dialect.md 输出 7、25）：CJK 友好的强调、只认 `~~` 的删除线、
 * HTML 形式的强调与换行。核心语法模块（`language/syntax/core`）与不带编辑器的词法（世界引擎内核读条目的主文字）用的是这同一份
 * 对象，两边的读法不会分叉。
 */

import type {MarkedExtension, Tokens} from "marked";
import markedCjkFriendly from "marked-cjk-friendly";

import {closeInline, nextMatch} from "../language/syntax/tags";
import type {MarkdownLexing} from "./lexing";

/** 删除线只认两个波浪线（输出 7）：单个 `~` 交回成普通文字。 */
const doubleTildeOnly: MarkedExtension = {
    tokenizer: {
        del(src: string) {
            if (src.startsWith("~") && !src.startsWith("~~")) return {type: "text", raw: "~", text: "~"} as unknown as Tokens.Del;
            return false;
        },
    },
};

const HTML_MARK_OPEN = /^<(strong|b|em|i|del|s)\s*>/iu;
const HTML_BREAK = /^<br\s*\/?>/iu;

/**
 * HTML 形式的强调与换行（输出 25）整体认领成一个单元：`<strong>…</strong>` 连同里面的行内内容，`<br>`。配不上对的标签不认领，
 * 交给原样语法读成原样片段。行内内容用 `inlineTokens`：行内分词发生在全篇块分词之后，这时引用定义已经收齐。
 */
const htmlInline: MarkedExtension = {
    extensions: [
        {
            name: "htmlMark",
            level: "inline",
            start: (src: string) => nextMatch(src, /<(?:strong|b|em|i|del|s)\s*>/giu),
            tokenizer(src: string) {
                const open = HTML_MARK_OPEN.exec(src);
                if (open === null) return undefined;
                const tag = (open[1] as string).toLowerCase();
                // 配对与方言标签用同一个扫描（跳过转义、行内代码与别的标签）；里面是空的不认领（没有文字可以带这个标记，读成原样
                // 片段保住原文）。
                const close = closeInline(src, tag, open[0].length);
                if (close === null || close.start === open[0].length) return undefined;
                return {type: "htmlMark", raw: src.slice(0, close.end), tag, tokens: this.lexer.inlineTokens(src.slice(open[0].length, close.start))};
            },
        },
        {
            name: "htmlBreak",
            level: "inline",
            start: (src: string) => nextMatch(src, /<br\s*\/?>/giu),
            tokenizer(src: string) {
                const matched = HTML_BREAK.exec(src);
                return matched === null ? undefined : {type: "htmlBreak", raw: matched[0]};
            },
        },
    ],
};

/** 核心语法的分词配置。 */
export const coreLexing: MarkdownLexing = {name: "core", marked: [markedCjkFriendly(), doubleTildeOnly, htmlInline]};

/** 一行里只有 `<br>`：`marked` 把它当成 HTML 块，其实是只有换行的一段（只有硬换行的段落就这样写出）。 */
const ONLY_BREAKS = /^(?:[ \t]*<br\s*\/?>)+[ \t]*\n*$/iu;

/** 块级 `html` 单元是不是只有 `<br>`（核心语法读成只有换行的段落；条目的写入检查按同一个判断放行）。 */
export const isBreakOnlyHtml = (raw: string): boolean => ONLY_BREAKS.test(raw);

/**
 * 表格一行的单元格数，按 GFM 的切法：没转义的 `|` 分隔，行首行尾的 `|` 不算。原子（`atoms`，按 `line` 里的位置）里的 `|` 不算：
 * 分词时原子换成了占位，`marked` 不在那里切。
 */
export function cellCount(line: string, atoms: ReadonlyArray<{readonly from: number; readonly to: number}>): number {
    const lead = line.length - line.trimStart().length;
    const row = line.trim();
    if (row === "") return 0;
    const inAtom = (index: number): boolean => atoms.some((atom) => index + lead >= atom.from && index + lead < atom.to);
    let count = 1;
    for (let index = 0; index < row.length; index += 1) {
        if (row[index] === "\\") index += 1;
        else if (row[index] === "|" && index !== 0 && index !== row.length - 1 && !inAtom(index)) count += 1;
    }
    return count;
}
