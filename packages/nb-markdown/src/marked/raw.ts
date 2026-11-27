/**
 * 原样语法在 `marked` 一侧的分词规则（docs/specs/workspace/markdown-dialect.md 输出 9）：方言之外的 HTML、重复的引用定义、脚注、
 * 数学。原样语法模块（`language/syntax/raw`）与不带编辑器的词法用同一份；读法与写法留在原样语法模块里。
 */

import type {MarkedExtension, Token, Tokens} from "marked";

import {FOOTNOTE_REF_SOURCE, MATH_INLINE_SOURCE, READABLE_INLINE_HTML, VOID_HTML_TAGS} from "../markdown-dialect";
import {lastMatch, nextMatch, paragraphEnd} from "../language/syntax/tags";

// 标签名后面紧跟空白、`/` 或 `>`：`<https://例子>`、`<a@b.cn>` 是自动链接，不是标签。
const OPEN_TAG = /^<([a-zA-Z][\w-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>/u;
const SELF_CLOSING = /^<([a-zA-Z][\w-]*)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^>"'])*\/>/u;
const CLOSE_TAG = /^<\/([a-zA-Z][\w-]*)\s*>/u;

/** 同名标签嵌套计数下，从 `from` 起找配对的闭标签，返回它的结束位置；没有返回 -1。 */
function matchingCloseEnd(src: string, tag: string, from: number): number {
    // 后面根本没有这个名字的闭标签时直接返回（原生搜索）：一段里成千上万个没闭合的 `<a>` 不至于每个都逐个数到段末。
    if (lastMatch(src, new RegExp(`</${tag}\\s*>`, "giu")) < from) return -1;
    const pattern = new RegExp(`<(/?)${tag}(?=[\\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "giu");
    pattern.lastIndex = from;
    let depth = 1;
    for (let matched = pattern.exec(src); matched !== null; matched = pattern.exec(src)) {
        if ((matched[2] ?? "").endsWith("/")) continue;
        depth += matched[1] === "/" ? -1 : 1;
        if (depth === 0) return matched.index + matched[0].length;
    }
    return -1;
}

/** 从开头捕获一段完整的、不在 `known` 里的 HTML 片段；`lineEnd` 要求片段后面紧跟行尾（块级形态）。 */
function completeHtml(src: string, known: ReadonlySet<string>, lineEnd: boolean): string | null {
    let captured: string | null = null;
    const selfClosing = SELF_CLOSING.exec(src);
    if (selfClosing !== null) {
        captured = known.has((selfClosing[1] as string).toLowerCase()) ? null : selfClosing[0];
    } else {
        const open = OPEN_TAG.exec(src);
        if (open === null) return null;
        const tag = (open[1] as string).toLowerCase();
        if (known.has(tag)) return null;
        if (VOID_HTML_TAGS.has(tag)) captured = open[0];
        else {
            const end = matchingCloseEnd(src, tag, open[0].length);
            captured = end < 0 ? null : src.slice(0, end);
        }
    }
    if (captured === null) return null;
    if (lineEnd && !/^[ \t]*(?:\n|$)/u.test(src.slice(captured.length))) return null;
    return captured;
}

/** 行内残片：孤立的闭标签或没闭合的开标签本身（`Vec<String>` 这类伪标签也在这里保住）。 */
function htmlFragment(src: string, known: ReadonlySet<string>): string | null {
    const close = CLOSE_TAG.exec(src);
    if (close !== null) return known.has((close[1] as string).toLowerCase()) ? null : close[0];
    const open = OPEN_TAG.exec(src);
    if (open !== null && !known.has((open[1] as string).toLowerCase())) return open[0];
    return null;
}

/** 脚注定义：`[^标签]: 文字`，后面缩进的行是它的续行。 */
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:[^\n]*(?:\n(?:[ \t]+[^\n]*|[ \t]*(?=\n[ \t]+\S)))*/u;
const FOOTNOTE_REF = new RegExp(`^${FOOTNOTE_REF_SOURCE}`, "u");
const MATH_INLINE = new RegExp(`^(?:${MATH_INLINE_SOURCE})`, "u");
const MATH_BLOCK = /^\$\$[^\n]*\$\$[ \t]*(?=\n|$)|^\$\$[ \t]*\n[\s\S]*?\n[ \t]*\$\$[ \t]*(?=\n|$)/u;

/**
 * 原样语法的分词规则。`blockTags`、`inlineTags` 是全部方言的标签名：它们的合法形态由各自模块认领，残片才落到这里。
 */
export function createRawMarked(tags: {readonly blockTags: ReadonlyArray<string>; readonly inlineTags: ReadonlyArray<string>}): MarkedExtension {
    const readableInline = new Set<string>(READABLE_INLINE_HTML);
    // 块级兜底不抢：块级方言、能读的行内 HTML、行内方言（`<ruby text="x">汉</ruby>` 单独成段时不能被整段吃成源码块）。
    const blockKnown = new Set<string>([...tags.blockTags, ...READABLE_INLINE_HTML, ...tags.inlineTags]);
    return {
        extensions: [
            {
                // `marked` 遇到标签已在定义表里的定义（同名的第二条，或读法另作分词时整篇的定义表里已经有它）既不产出单元，
                // 也不并进别的单元，原文就丢了。这里在它之前把这种定义作为定义单元产出（读成原样块）。紧跟在段落后面的定义
                // 由 `marked` 并进段落，不管。
                name: "duplicateDefinition",
                level: "block",
                tokenizer(src: string, tokens: Token[]) {
                    const last = tokens.at(-1);
                    if (last?.type === "paragraph" || last?.type === "text") return undefined;
                    const definition = (this.lexer as unknown as {tokenizer: {def(src: string): Tokens.Def | undefined}}).tokenizer.def(src);
                    if (definition === undefined || this.lexer.tokens.links[definition.tag] === undefined) return undefined;
                    return {...definition, type: "def"};
                },
            },
            {
                name: "rawHtmlBlock",
                level: "block",
                // 只认“换行后的行首标签”：`marked` 判段落中断时传入 `src.slice(1)`，匹配开头会把段内的行内标签误当成断点。
                start(src: string) {
                    // 只在这一段里找（正则 `exec` 找不到时会一直扫到文末）。
                    const paragraph = src.slice(0, paragraphEnd(src));
                    const pattern = /\n<([a-zA-Z][\w-]*)/gu;
                    for (let matched = pattern.exec(paragraph); matched !== null; matched = pattern.exec(paragraph)) {
                        if (!blockKnown.has((matched[1] as string).toLowerCase())) return matched.index + 1;
                    }
                    return -1;
                },
                tokenizer(src: string) {
                    const raw = completeHtml(src, blockKnown, true);
                    return raw === null ? undefined : {type: "rawHtmlBlock", raw};
                },
            },
            {
                name: "footnoteDef",
                level: "block",
                start: (src: string) => {
                    const at = src.slice(0, paragraphEnd(src)).search(/\n\[\^[^\]\s]+\]:/u);
                    return at < 0 ? -1 : at + 1;
                },
                tokenizer(src: string) {
                    const matched = FOOTNOTE_DEF.exec(src);
                    return matched === null ? undefined : {type: "footnoteDef", raw: matched[0]};
                },
            },
            {
                name: "mathBlock",
                level: "block",
                start: (src: string) => {
                    const at = src.slice(0, paragraphEnd(src)).search(/\n\$\$/u);
                    return at < 0 ? -1 : at + 1;
                },
                tokenizer(src: string) {
                    const matched = MATH_BLOCK.exec(src);
                    return matched === null ? undefined : {type: "mathBlock", raw: matched[0]};
                },
            },
            {
                name: "rawHtmlInline",
                level: "inline",
                start: (src: string) => nextMatch(src, /<\/?[a-zA-Z]/gu),
                tokenizer(src: string) {
                    const raw = completeHtml(src, readableInline, false) ?? htmlFragment(src, readableInline);
                    return raw === null ? undefined : {type: "rawHtmlInline", raw};
                },
            },
            {
                name: "footnoteRef",
                level: "inline",
                start: (src: string) => nextMatch(src, /\[\^/gu),
                tokenizer(src: string) {
                    const matched = FOOTNOTE_REF.exec(src);
                    return matched === null ? undefined : {type: "footnoteRef", raw: matched[0]};
                },
            },
            {
                name: "mathInline",
                level: "inline",
                start: (src: string) => nextMatch(src, /\$/gu),
                tokenizer(src: string) {
                    const matched = MATH_INLINE.exec(src);
                    return matched === null ? undefined : {type: "mathInline", raw: matched[0]};
                },
            },
        ],
    };
}
