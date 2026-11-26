/**
 * 正文文字的转义（docs/specs/workspace/markdown-dialect.md 输出 4）。
 *
 * `minimal` 只转义按局部规则判断会被读成语法的字符；规则判断不准的情况由写回的读回校验发现，再换 `full`：转义全部 ASCII 标点，
 * 每个插进去的反斜杠前放一个哨兵字符，写回据此从后往前逐个试撤（`stripSentinels` 去掉剩下的哨兵）。
 */

import type {InlinePlace} from "../../syntax/types";
import {decodeHTMLStrict} from "entities";

import {stickerColonEscapes} from "../../../stickers";
import {leftFlanking, rightFlanking} from "../../syntax/flanking";
import {normalizeLabel} from "../../syntax/types";

/** 任意一个完整的开标签或闭标签（与 `syntax/tags.ts` 的写法相同）。 */
const TAG = /<\/?[A-Za-z][\w-]*(?:"[^"]*"|'[^']*'|[^>"'])*>/uy;

/**
 * 原样内容（原样块、原样片段）自带的换行写出时带上标记：裸 LF 前放 `RAW_LF`，CRLF 写成 `RAW_CR` 加 LF，单独的 CR 写成 `RAW_CR`。
 * 编解码器把写出的文字换成原文的主换行符时跳过带标记的换行（`codec/write.ts` 的 `withEol`），最后去掉标记：原样内容里的换行字节
 * 不随父块重新写出而变（输出 9）。换行本身留着，容器（引用、列表项）照常给每一行加前缀。正文里的这两个控制字符写成实体。
 */
export const RAW_LF = "\u0001";
export const RAW_CR = "\u0002";

export const encodeRawBreaks = (raw: string): string => raw.replace(/\r\n|\r|\n/gu, (eol) => (eol === "\n" ? `${RAW_LF}\n` : eol === "\r\n" ? `${RAW_CR}\n` : RAW_CR));
export const decodeRawBreaks = (text: string): string => text.replace(/\u0001/gu, "").replace(/\u0002/gu, "\r");

/**
 * `full` 模式插入的转义前放的哨兵（读回前与写回前都要去掉）。用 NUL：读入时 `marked` 把它换成 U+FFFD，从文件读进来的文档里
 * 没有它；编辑器里真有时，写回跳过完全转义这一级（`codec/write.ts`）。私用区字符不行，网文站复制来的正文常带。
 */
export const SENTINEL = "\u0000";

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/u;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /[ \t]/u;

/** 不可见、会被读成别的东西或被丢掉的字符写成实体。 */
function entityOf(char: string): string | null {
    switch (char) {
        case " ":
            return "&nbsp;";
        case "\n":
            return "&#10;";
        // 列表项里 `marked` 把制表符展开成空格（段落里不展开）：一律写成实体，读回仍是制表符。
        case "\t":
            return "&#9;";
        // 原样内容的换行标记（`RAW_LF`、`RAW_CR`）：正文里真有这两个控制字符时写成实体，不与标记混淆。
        case "\u0001":
            return "&#1;";
        case "\u0002":
            return "&#2;";
        case "​":
        case "‌":
        case "‍":
        case "⁠":
        case "﻿":
            return `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`;
        default:
            return null;
    }
}

export interface EscapeAround {
    /** 这段文字从一行的开头起（块首或换行之后）。 */
    readonly lineStart: boolean;
    /** 这段文字一直到这一行的结尾（块尾或换行之前）。 */
    readonly lineEnd: boolean;
    /** 前后紧挨的字符（已写出的最后一个、下一个节点的第一个），没有为空串。 */
    readonly before: string;
    readonly after: string;
    readonly place: InlinePlace;
    readonly full: boolean;
    readonly definitions: ReadonlyMap<string, string>;
    /** 语言的原子转义规则：文字里会被认成原子开头的写法前面加反斜杠（条目的标签）。 */
    readonly atomEscape?: ((text: string, index: number) => boolean) | null;
}

/** 行首会被读成块语法的写法：返回要在第几个字符前加反斜杠（相对去掉前导空白后的位置），不需要为 -1。 */
function lineStartEscape(line: string): number {
    if (/^#{1,6}(?:[ \t]|$)/u.test(line)) return 0;
    if (/^>/u.test(line)) return 0;
    if (/^[-+*](?:[ \t]|$)/u.test(line)) return 0;
    if (/^(?:[-*_][ \t]*){3,}$/u.test(line)) return 0;
    if (/^(?:=+|-+)[ \t]*$/u.test(line)) return 0;
    if (/^(?:`{3,}|~{3,})/u.test(line)) return 0;
    const ordered = /^\d{1,9}([.)])(?:[ \t]|$)/u.exec(line);
    if (ordered !== null) return ordered[0].indexOf(ordered[1] as string);
    return -1;
}


/** `[` 会不会开一个链接：后面有配对的 `]` 且紧跟 `(`、`[`，或括起来的文字是全篇定义过的标签，或是脚注 `[^`。 */
function opensLink(text: string, index: number, after: string, definitions: ReadonlyMap<string, string>): boolean {
    if (text[index + 1] === "^") return true;
    const close = text.indexOf("]", index + 1);
    if (close < 0) return false;
    const next = text[close + 1] ?? after;
    if (next === "(" || next === "[" || next === ":") return true;
    return definitions.has(normalizeLabel(text.slice(index + 1, close)));
}

/**
 * 转义一段正文文字。返回写出的文字（`full` 模式里带哨兵）。
 */
export function escapeText(text: string, around: EscapeAround): string {
    const out: string[] = [];
    const computed = new Map<string, ReadonlySet<number>>();
    const lastGreater = text.lastIndexOf(">");
    const escapes: Escapes = (char, compute) => {
        let positions = computed.get(char);
        if (positions === undefined) {
            positions = compute();
            computed.set(char, positions);
        }
        return positions;
    };
    const escape = (char: string): string => (around.full ? `${SENTINEL}\\${char}` : `\\${char}`);
    // 行首的前导空白会被吃掉（四个以上还会变成代码块）：第一个写成实体。标题与表格单元格的内容被 `trim()`，全角空格这类
    // Unicode 空白也会被去掉。
    const trimmed = around.place.heading === true || around.place.table === true;
    // 整行只有 Unicode 空白（全角空格）时，marked 判空行用 `\s`，也会把它当成空行（列表项因此断开）：同样按会被吃掉处理。
    const wholeLine = around.lineStart && around.lineEnd && /^\s+$/u.test(text);
    const blank = trimmed || wholeLine ? /^\s+/u : /^[ \t]+/u;
    let start = 0;
    if (around.lineStart) {
        const lead = blank.exec(text)?.[0] ?? "";
        if (lead !== "" && entityOf(lead[0] as string) === null) {
            const hex = (char: string): string => `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`;
            // 整段都是空白又到行尾：两头都会被吃掉，每个都写成实体。
            out.push(hex(lead[0] as string), lead.length === text.length && around.lineEnd ? [...lead.slice(1)].map(hex).join("") : lead.slice(1));
            start = lead.length;
        }
    }
    const lineEscape = around.lineStart ? lineStartEscape(text.slice(start)) : -1;
    // 行尾的空白也会被吃掉（两个以上的空格还会变成硬换行）：最后一个写成实体。列表项末尾的全角空格这类 Unicode 空白也会被
    // 去掉（marked 收列表项时按 `\s` 去尾），最小转义不知道所在的块是不是列表项，完全转义时一并写成实体。
    const trailingAt = around.lineEnd && (trimmed || around.full ? /\s$/u : /[ \t]$/u).test(text) && text.length > start ? text.length - 1 : -1;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index] as string;
        const previous = index === 0 ? around.before : (text[index - 1] as string);
        const next = index === text.length - 1 ? around.after : (text[index + 1] as string);
        const entity = entityOf(char);
        if (entity !== null) {
            out.push(entity);
            continue;
        }
        // 紧跟在 `$` 后面的数字：行内数学的闭合 `$` 后面是数字时不算数学（Pandoc 的规则），写成实体。
        if (index === 0 && around.before === "$" && /[0-9]/u.test(char)) {
            out.push(`&#${char.charCodeAt(0)};`);
            continue;
        }
        if (index === trailingAt) {
            out.push(`&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`);
            continue;
        }
        // 会被认成原子开头的写法（条目的 `<` 加大写字母）：转义不带哨兵，完全转义一级的试撤撤不掉它。编辑器读回时写坏的标签照样是
        // 文字，撤掉反斜杠读回不变，但不带编辑器的词法（内核）会把它当成写坏的标签拒收（w00055 t02 S3 审查第 1 条）。
        if (around.atomEscape?.(text, index) === true) {
            out.push(`\\${char}`);
            continue;
        }
        if (around.full && ASCII_PUNCTUATION.test(char)) {
            out.push(escape(char));
            continue;
        }
        if (index - start === lineEscape) {
            out.push(escape(char));
            continue;
        }
        out.push(needsEscape(text, index, previous, next, around, escapes, lastGreater) ? escape(char) : char);
    }
    return out.join("");
}

/** 能读成 HTML 或自动链接的 `<`：完整的标签、注释、处理指令、声明，或 `<网址>`、`<邮箱>`。没有 `>` 的 `<b c` 只是文字。 */
function opensHtml(text: string, index: number): boolean {
    return matchesAt(TAG, text, index) || matchesAt(/<(?:!--|\?|![A-Za-z]|!\[CDATA\[)/uy, text, index) || matchesAt(/<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^\s<>]*>/uy, text, index) || matchesAt(/<[^\s<>@]+@[^\s<>]+>/uy, text, index);
}

/**
 * `~~`、`==` 要不要转义：恰好两个的一串，能开（左侧翼）且后面有能闭的，或能闭（右侧翼）且前面有能开的，才转义它的第一个
 * 字符（输出 6、24 的侧翼规则，CJK 友好）。三个以上的一串、两侧都是空白的一串都不是。跨节点的配对由读回校验兜底。
 */
function pairEscapes(text: string, char: string, around: EscapeAround): ReadonlySet<number> {
    const runs: Array<{at: number; opens: boolean; closes: boolean}> = [];
    for (let at = 0; at < text.length; at += 1) {
        if (text[at] !== char) continue;
        let end = at;
        while (end < text.length && text[end] === char) end += 1;
        if (end - at === 2) {
            const before = at === 0 ? around.before : (text[at - 1] as string);
            const after = end === text.length ? around.after : (text[end] as string);
            runs.push({at, opens: leftFlanking(before, after), closes: rightFlanking(before, after)});
        }
        at = end - 1;
    }
    // 从前往后记“前面有没有能开的”，从后往前记“后面有没有能闭的”，一遍得出全部要转义的位置。
    const escaped = new Set<number>();
    const closesLater: boolean[] = [];
    let later = false;
    for (let position = runs.length - 1; position >= 0; position -= 1) {
        closesLater[position] = later;
        later ||= (runs[position] as {closes: boolean}).closes;
    }
    let earlier = false;
    runs.forEach((run, position) => {
        if ((run.opens && closesLater[position] === true) || (run.closes && earlier)) escaped.add(run.at);
        earlier ||= run.opens;
    });
    return escaped;
}

/** 一串同样的强调符号能不能开闭强调：两侧都是空白的不能；`_` 的一串两侧都是字（含汉字）时也不能（CJK 友好规则对 `_` 不放宽）。 */
function delimiterRunInert(text: string, start: number, end: number, char: string, around: EscapeAround): boolean {
    const before = start === 0 ? around.before : (text[start - 1] as string);
    const after = end === text.length ? around.after : (text[end] as string);
    if ((before === "" || SPACE.test(before)) && (after === "" || SPACE.test(after))) return true;
    return char === "_" && WORD.test(before) && WORD.test(after);
}

/**
 * `*`、`_` 要不要转义：按一串同样的符号判断能不能开闭；能开闭的符号除最后一个外都转义，剩下的一个没法配对
 * （`5*3*2=30` 写成 `5\*3*2=30`）。跨节点的配对由读回校验兜底。
 */
function delimiterEscapes(text: string, char: string, around: EscapeAround): ReadonlySet<number> {
    const active: number[] = [];
    for (let at = 0; at < text.length; at += 1) {
        if (text[at] !== char) continue;
        let end = at;
        while (end < text.length && text[end] === char) end += 1;
        if (!delimiterRunInert(text, at, end, char, around)) for (let position = at; position < end; position += 1) active.push(position);
        at = end - 1;
    }
    return new Set(active.length >= 2 ? active.slice(0, -1) : []);
}

/** 一段文字里某个符号要转义的位置，按符号算一次（每个符号都扫一遍整段，一段很长、符号很多时是平方级）。 */
type Escapes = (char: string, compute: () => ReadonlySet<number>) => ReadonlySet<number>;

/** 在 `text` 的 `index` 处匹配（`y` 标志的正则）：不切出余下的文字，一段里很多个同样的符号时不至于每个都复制一遍。 */
function matchesAt(pattern: RegExp, text: string, index: number): boolean {
    pattern.lastIndex = index;
    return pattern.test(text);
}

const ENTITY = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/uy;
const MATH = /\$(?=\S)(?:\\.|[^$\\\n])*?\S\$(?!\d)|\$[^\s$]\$(?!\d)|\$\$/uy;
const HEADING_CLOSE = /#+[ \t]*$/uy;
/** 裸网址（GFM 自动链接）：协议后的冒号、`www` 后的点、邮箱的 `@`。 */
const URL_COLON = /(?<=(?:^|[^A-Za-z])https?):(?=\/\/)/uy;
const WWW_DOT = /(?<=(?:^|[^\w.-])www)\./uy;
const EMAIL_AT = /(?<=[\w.+-])@[\w-]+\.[\w.-]*\w/uy;

function needsEscape(text: string, index: number, previous: string, next: string, around: EscapeAround, escapes: Escapes, lastGreater: number): boolean {
    const char = text[index] as string;
    switch (char) {
        case "\\":
            return ASCII_PUNCTUATION.test(next) || next === "" || next === "\n";
        case "`":
            // 有两个以上的反引号就可能配成行内代码：都转义。
            return escapes(char, () => {
                const positions = [...text.matchAll(/`/gu)].map((matched) => matched.index);
                return new Set(positions.length >= 2 ? positions : []);
            }).has(index);
        case "*":
        case "_":
            return escapes(char, () => delimiterEscapes(text, char, around)).has(index);
        case "~":
        case "=":
            return escapes(char, () => pairEscapes(text, char, around)).has(index);
        case "[":
            return opensLink(text, index, around.after, around.definitions);
        case "<":
            // 后面没有 `>` 就组不成标签或自动链接（先比最后一个 `>` 的位置，不对每个 `<` 都往后扫）。
            return lastGreater > index && opensHtml(text, index);
        case "&": {
            // 只有读得成实体的才转义（`&unknown;` 读回还是它自己）。
            ENTITY.lastIndex = index;
            const entity = ENTITY.exec(text)?.[0];
            return entity !== undefined && decodeHTMLStrict(entity) !== entity;
        }
        case "$":
            return matchesAt(MATH, text, index);
        case "|":
            return around.place.table === true;
        case "#":
            return around.place.heading === true && matchesAt(HEADING_CLOSE, text, index) && (previous === " " || previous === "\t");
        case ":":
            // 表情写法（stickers.md 的输出 23）：会读成写法的开头冒号转义，免得读回对不上、整块落到规范写法。连上后面紧挨的字一起
            // 判断：文字以 `:名字` 结尾、后面是表情时，结尾的冒号来自表情写法。
            return matchesAt(URL_COLON, text, index) || escapes(char, () => stickerColonEscapes(text + around.after)).has(index);
        case ".":
            return matchesAt(WWW_DOT, text, index);
        case "@":
            return matchesAt(EMAIL_AT, text, index);
        default:
            return false;
    }
}

/** 去掉 `full` 模式留下的哨兵。 */
export const stripSentinels = (text: string): string => text.split(SENTINEL).join("");
