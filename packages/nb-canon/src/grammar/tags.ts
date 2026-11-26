/**
 * 条目标签的词法（docs/specs/canon/rendering.md 白名单下“标签的写法”、输出 17、18）：在原文上从左到右认出 `<` 加大写名字写成的
 * 一处处。词法不看登记表，凡是大写名都认，结果只取决于原文（解析结果可以按源文缓存）；名字认不认、属性对不对由写入检查判断。
 *
 * 这里也放标签的写出：规范写法（输出 18）与程序生成的属性值、值的转义（输出 8、9）。词法与写出放在一起，是因为写出的每样东西都要能
 * 被这里的词法原样读回（去值靠它，输出 22）。
 */

/** 一个属性：`名="值"`。 */
export interface TagAttribute {
    readonly name: string;
    readonly value: string;
    /** 值在原文里的起点（开引号之后），式子出错时据此算行列。 */
    readonly valueStart: number;
}

/**
 * - `self`：自闭合，`<V of="a" />`；
 * - `open`、`close`：开标签与闭标签，`<If test="…">`、`</If>`；
 * - `paired`：开标签到同名闭标签之间没有 `<` 与换行，整体算一个（带值的 `V`、带描述的登记标签：`<V of="a">3</V>`）；`If` 不这样配；
 * - `malformed`：`<` 加大写名字，后面却不成标签（少了收尾的 `>`、属性没加引号、跨了行）。
 */
export type TagKind = "self" | "open" | "close" | "paired" | "malformed";

export interface LexedTag {
    /** 在这段原文全部标签里的序号。 */
    readonly index: number;
    /** 起止（`end` 不含）：`paired` 含内容与闭标签；`malformed` 只到名字。 */
    readonly start: number;
    readonly end: number;
    readonly name: string;
    readonly kind: TagKind;
    /** 写成 `</名`：闭标签，或写坏的闭标签。 */
    readonly closing: boolean;
    readonly attributes: readonly TagAttribute[];
    /** `paired` 的内容（开闭标签之间）的起止。 */
    readonly content: {readonly start: number; readonly end: number} | null;
    /** `malformed` 的名字后面紧跟着 `名="`：像是写了属性、没写完（写入检查据此报 `tag-malformed`）。 */
    readonly attributeLike: boolean;
}

/** HTML 的强调与换行（核心语法读它们），不是标签名；不分大小写。 */
const HTML_NAMES: ReadonlySet<string> = new Set(["b", "br", "em", "i", "del", "s", "strong"]);

/** 候选：`<` 或 `</` 加大写开头的名字，后面紧跟空白、`/` 或 `>`；`Map<K, V>` 的 `<K,` 不是候选。 */
const CANDIDATE = /<(\/?)([A-Z][A-Za-z0-9]*)(?=[ \t\r\n/>])/gu;
const ATTRIBUTE = /[ \t]+([A-Za-z_][A-Za-z0-9_-]*)="([^"\r\n]*)"/uy;
const ATTRIBUTE_START = /[ \t]+[A-Za-z_][A-Za-z0-9_-]*="/uy;
const TAIL = /[ \t]*(\/?)>/uy;
const CLOSE_TAIL = /[ \t]*>/uy;

const stickyAt = (pattern: RegExp, source: string, at: number): RegExpExecArray | null => {
    pattern.lastIndex = at;
    return pattern.exec(source);
};

/** 认出全部标签，按起点排。认出一个完整的标签以后从它的结尾接着认（属性值里的 `<` 不另算）；写坏的只占到名字，从名字后面接着认。 */
export function lexTags(source: string): LexedTag[] {
    const tags: LexedTag[] = [];
    const candidate = new RegExp(CANDIDATE.source, CANDIDATE.flags);
    let at = 0;
    for (;;) {
        candidate.lastIndex = at;
        const matched = candidate.exec(source);
        if (matched === null) break;
        const start = matched.index;
        const closing = matched[1] === "/";
        const name = matched[2] as string;
        const nameEnd = start + matched[0].length;
        at = nameEnd;
        if (HTML_NAMES.has(name.toLowerCase())) continue;
        const attributes: TagAttribute[] = [];
        let cursor = nameEnd;
        if (!closing) {
            for (let attribute = stickyAt(ATTRIBUTE, source, cursor); attribute !== null; attribute = stickyAt(ATTRIBUTE, source, cursor)) {
                const valueStart = cursor + attribute[0].length - 1 - (attribute[2] as string).length;
                attributes.push({name: attribute[1] as string, value: attribute[2] as string, valueStart});
                cursor += attribute[0].length;
            }
        }
        const tail = stickyAt(closing ? CLOSE_TAIL : TAIL, source, cursor);
        if (tail === null) {
            tags.push({index: tags.length, start, end: nameEnd, name, kind: "malformed", closing, attributes: [], content: null, attributeLike: stickyAt(ATTRIBUTE_START, source, nameEnd) !== null});
            continue;
        }
        let end = cursor + tail[0].length;
        const selfClosing = !closing && tail[1] === "/";
        let kind: TagKind = closing ? "close" : selfClosing ? "self" : "open";
        let content: LexedTag["content"] = null;
        if (kind === "open" && name !== "If") {
            // 开标签后面到下一个 `<` 或换行之前没有别的标签：那个 `<` 正好是同名的闭标签时，连同中间的内容算一个。
            let next = end;
            while (next < source.length && source[next] !== "<" && source[next] !== "\n" && source[next] !== "\r") next += 1;
            const closeName = next + 2 + name.length;
            if (source.startsWith(`</${name}`, next)) {
                const closeTail = stickyAt(CLOSE_TAIL, source, closeName);
                if (closeTail !== null) {
                    content = {start: end, end: next};
                    kind = "paired";
                    end = closeName + closeTail[0].length;
                }
            }
        }
        tags.push({index: tags.length, start, end, name, kind, closing, attributes, content, attributeLike: false});
        at = end;
    }
    return tags;
}

/**
 * 标签作为原子的范围（nb-markdown 的 `MarkdownLexing.atoms`）：不含头尾的 `<`、`>`，它们留在原文里，旁边强调的左右侧判断照旧。
 * 写坏的标签只到名字。
 */
export function atomSpanOf(tag: LexedTag): {readonly from: number; readonly to: number} {
    if (tag.kind === "malformed") return {from: tag.start + 1, to: tag.end};
    return {from: tag.start + 1, to: tag.end - 1};
}

/** 一个标签的规范写法（输出 18）：属性照给的顺序、之间一个空格，自闭合写 ` />`。 */
export function tagText(name: string, attributes: ReadonlyArray<readonly [string, string]>, form: "self" | "open" | "close"): string {
    if (form === "close") return `</${name}>`;
    const written = attributes.map(([attribute, value]) => ` ${attribute}="${value}"`).join("");
    return form === "self" ? `<${name}${written} />` : `<${name}${written}>`;
}

/**
 * 程序生成的属性值与描述（输出 9）：来自作者的数据（名字、显示名、原因），其中的 `&`、`"`、`<`、`>` 写成实体、换行写成空格，
 * 带值写法因此总能按本文件的词法读回。去值时整段丢掉，不用解码。
 */
export function escapeDecoration(text: string): string {
    return text.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/\r\n|\r|\n/gu, " ");
}

/** `<` 的 JSON 转义：反斜杠、`u003c`。这样写是为了不在源码里留下会被工具改写的转义序列。 */
const ESCAPED_LESS_THAN = `${String.fromCharCode(92)}u003c`;

/** `V` 的值写成 JSON（输出 8）：其中的 `<` 写成 JSON 的转义，开标签到 `</V>` 之间就没有 `<`，词法把带值的 `V` 整体认成一个。 */
export function agentJson(value: unknown): string {
    return (JSON.stringify(value ?? null) ?? "null").replace(/</gu, ESCAPED_LESS_THAN);
}

/** 写入之前的规范化（输出 1）：去掉开头的 BOM，换行规范成 LF。 */
export function normalizeEntrySource(text: string): string {
    return (text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text).replace(/\r\n?/gu, "\n");
}

/** 原文偏移 → 行与列（都从 1 起，列按 UTF-16 码元）。 */
export function positionOf(source: string, offset: number): {readonly line: number; readonly column: number} {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < offset && index < source.length; index += 1) {
        if (source[index] === "\n") {
            line += 1;
            lineStart = index + 1;
        }
    }
    return {line, column: offset - lineStart + 1};
}
