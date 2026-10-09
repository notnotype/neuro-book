import {Lexer} from "marked";
import type {MarkdownToken} from "@tiptap/core";

export type AlignValue = "left" | "center" | "right" | "justify";

export interface MarkdownCommentToken {
    raw: string;
    id: string | null;
    body: string;
    text: string;
    tokens: MarkdownToken[];
}

export interface MarkdownCommentBlockToken {
    raw: string;
    id: string | null;
    body: string;
    text: string;
}

export interface MarkdownRubyToken {
    raw: string;
    /** 注音 / 对照标注文本 */
    text: string;
    /** 被标注的正文 */
    base: string;
    tokens: MarkdownToken[];
}

export interface MarkdownBilingualBlockToken {
    raw: string;
    /** 对照译文 */
    text: string;
    /** 原文块内容 */
    body: string;
}

export interface MarkdownAlignToken {
    raw: string;
    align: AlignValue;
    text: string;
    tokens: MarkdownToken[];
}

// 行内评论：<comment ...>...</comment>，兼容读旧 <inline-comment>；开闭标签名必须一致
const COMMENT_INLINE_PATTERN = /^<(comment|inline-comment)(?:\s+([^>]*))?>([\s\S]*?)<\/\1>/;
// 块级评论：开标签独占一行，闭标签独立成行，中间可跨任意段落
const COMMENT_BLOCK_PATTERN = /^<comment(?:\s+([^>\n]*))?>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/comment>[ \t]*(?=\r?\n|$)/;
// 注音：<ruby text="...">正文</ruby>，兼容读标准 HTML 形式 <ruby>正文<rt>注音</rt></ruby>
const RUBY_PATTERN = /^<ruby\b(?:\s+([^>]*))?>([\s\S]*?)<\/ruby>/;
const RUBY_RT_PATTERN = /^([\s\S]*?)<rt(?:\s[^>]*)?>([\s\S]*?)<\/rt>/;
// 段落级双语对照：结构同块级评论
const BILINGUAL_BLOCK_PATTERN = /^<bilingual(?:\s+([^>\n]*))?>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/bilingual>[ \t]*(?=\r?\n|$)/;
const ALIGN_PATTERN = /^<align\s+value="(left|center|right|justify)">\n?([\s\S]*?)\n?<\/align>/;

/**
 * 具备「开闭标签独立成行」块级形态的方言标签名单。
 * 块级兜底（HtmlFallback）的排除名单与读时规范化（normalizeMarkdownDialectBlocks）
 * 共用此单一来源；新增块级方言标签时在这里登记。
 */
export const MARKDOWN_BLOCK_DIALECT_TAGS = ["comment", "bilingual", "align", "html"] as const;

// 行中块级方言开标签且紧跟行尾。⚠️ 各标签的属性形态必须与本文件对应块级 pattern 同构
// （comment/bilingual 宽松属性、align 必须带合法 value、html 只认裸标签），否则会出现
// 「规范化拆了段、块 tokenizer 却不认领」的孤立源码块中间态。
const DIALECT_OPEN_TAG_AT_LINE_END_PATTERN = new RegExp([
    "<(?:",
    "comment(?:\\s[^>\\n]*)?",          // 同 COMMENT_BLOCK_PATTERN
    "|bilingual(?:\\s[^>\\n]*)?",       // 同 BILINGUAL_BLOCK_PATTERN
    "|align\\s+value=\"(?:left|center|right|justify)\"", // 同 ALIGN_PATTERN
    "|html",                             // 同 HTML_EMBED_PATTERN（HtmlEmbed.ts，裸标签）
    ")>[ \\t]*$",
].join(""));
// 快速预检：文档里连方言开标签的影子都没有时跳过整个规范化扫描（宽松匹配，命中才走全逻辑）
const DIALECT_OPEN_TAG_HINT_PATTERN = new RegExp(`<(?:${MARKDOWN_BLOCK_DIALECT_TAGS.join("|")})[\\s>]`);
// 开标签前缀仅由空白与容器标记（引用 >、列表 -*+、有序列表 1. / 1)）组成 = 逻辑行首
const CONTAINER_ONLY_PREFIX_PATTERN = /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*$/;
// fenced code 开栏：最多 3 空格缩进 + ``` 或 ~~~（info string 任意）
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 在 src 中查找块级标签的段落中断点。
 * ⚠️ 只认「换行后的行首开标签且开标签后紧跟换行」：marked 检测段落中断时会把
 * src.slice(1) 传进来（段中位置伪装成开头），因此这里绝不能匹配 ^ 开头形态，
 * 否则段内行内用法（如 <comment>x</comment>）会把一句话拆成两个段落。
 * 真正位于块首的标签不需要 start 命中——marked 对每个块起点会直接调用 tokenize。
 * 返回 -1 表示没有需要中断的块级形态。
 */
export function findMarkdownBlockTagStart(src: string, tag: string): number {
    const pattern = new RegExp(`\\n<${tag}(?:\\s[^>\\n]*)?>[ \\t]*\\r?\\n`);
    const matched = pattern.exec(src);
    if (!matched) {
        return -1;
    }
    return matched.index + 1;
}

/**
 * 读时规范化：把「正文<comment>␊ … ␊</comment>」这种开标签黏在正文后、内容跨行的
 * 宽容形态整形为标准块级形态（开标签前补空行拆段）。人和 AI 都容易写出这种形态，
 * 而块级 tokenizer 因 marked 段落中断陷阱（见 findMarkdownBlockTagStart）不能从
 * 段中接管，ProseMirror 块节点也不能从段落中间开始——规范化是支持它的唯一位置。
 *
 * ⚠️ 陷阱四（判据边界，改动前必读）：
 * - 只在「开标签紧跟行尾 + 向下存在独立成行的闭标签」时才拆——无闭合的悬尾开标签
 *   （粘贴片段、AI 流式 chunk）拆开后会被 marked type 7 吞成连正文一起冻结的源码块，
 *   比不拆（行内兜底出 chip）更差。
 * - 开标签前缀仅由空白/容器标记组成（"> <comment>"、"- <comment>"）视为逻辑行首，
 *   不拆——这些嵌套块级形态今天由 marked 容器内层解析正常工作，拆了是纯回归。
 * - 行首 ≥4 空格 / tab 是缩进代码块，不拆。
 * - fenced code（```/~~~）内不规范化，闭标签搜索同样跳过围栏内容。
 * - 原文不以换行结尾时最后一行不算「行尾」（流式 chunk 悬尾不被抢拆）。
 * - 调用入口：TipTap 编辑器的初始 content / update() / insertMarkdown（粘贴）三处；
 *   Monaco 源码编辑器与 replaceSelection / appendMarkdown（流式 chunk 语义）故意不调。
 */
export function normalizeMarkdownDialectBlocks(markdown: string): string {
    if (!DIALECT_OPEN_TAG_HINT_PATTERN.test(markdown)) {
        return markdown;
    }
    const endsWithNewline = markdown.endsWith("\n");
    const lines = markdown.split("\n");
    const isFenceLine = createFenceLineFilter();
    let changed = false;

    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index]!;
        const hasCarriageReturn = rawLine.endsWith("\r");
        const line = hasCarriageReturn ? rawLine.slice(0, -1) : rawLine;

        if (isFenceLine(line)) {
            continue;
        }

        if (index === lines.length - 1 && !endsWithNewline) {
            continue;
        }
        if (/^(?: {4}|\t)/.test(line)) {
            continue;
        }
        const tagMatched = DIALECT_OPEN_TAG_AT_LINE_END_PATTERN.exec(line);
        if (!tagMatched || tagMatched.index === 0) {
            continue;
        }
        const prefix = line.slice(0, tagMatched.index);
        if (CONTAINER_ONLY_PREFIX_PATTERN.test(prefix)) {
            continue;
        }
        const tagName = /^<([a-zA-Z-]+)/.exec(tagMatched[0])![1]!;
        if (!hasClosingDialectTagBelow(lines, index + 1, tagName)) {
            continue;
        }

        const lineEnding = hasCarriageReturn ? "\r" : "";
        lines.splice(index, 1, prefix + lineEnding, lineEnding, line.slice(tagMatched.index) + lineEnding);
        changed = true;
        // 插入的开标签行已是行首标准形态，跳过它继续
        index += 2;
    }

    return changed ? lines.join("\n") : markdown;
}

/**
 * 创建 fenced code 围栏行过滤器：逐行喂入（须已剥 \r），返回 true 表示该行属于
 * 围栏（开栏 / 栏内 / 闭栏），调用方应跳过。闭包持有围栏状态，一次遍历用一个实例。
 */
function createFenceLineFilter(): (line: string) => boolean {
    let fence: {marker: string; length: number} | null = null;
    return (line: string): boolean => {
        const fenceMatched = FENCE_OPEN_PATTERN.exec(line);
        if (fence) {
            // 闭栏：同字符、长度不小于开栏、行内容仅围栏
            if (fenceMatched && fenceMatched[1]!.startsWith(fence.marker) && fenceMatched[1]!.length >= fence.length && !line.slice(fenceMatched[0].length).trim()) {
                fence = null;
            }
            return true;
        }
        if (fenceMatched) {
            fence = {marker: fenceMatched[1]![0]!, length: fenceMatched[1]!.length};
            return true;
        }
        return false;
    };
}

/**
 * 从 fromIndex 起向下查找独立成行的 </tag> 闭标签（fence 感知，围栏内不算数）。
 */
function hasClosingDialectTagBelow(lines: string[], fromIndex: number, tag: string): boolean {
    const closePattern = new RegExp(`^[ \\t]*</${tag}>[ \\t]*$`);
    const isFenceLine = createFenceLineFilter();
    for (let index = fromIndex; index < lines.length; index += 1) {
        const rawLine = lines[index]!;
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (isFenceLine(line)) {
            continue;
        }
        if (closePattern.test(line)) {
            return true;
        }
    }
    return false;
}

/**
 * 解析行内评论语法，body 属性承载评论正文。
 * 同时接受 <comment> 与旧版 <inline-comment>；序列化统一输出 <comment>。
 */
export function parseMarkdownCommentInline(src: string): MarkdownCommentToken | null {
    const matched = COMMENT_INLINE_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const attrs = parseAttributes(matched[2] ?? "");
    const text = matched[3] ?? "";
    return {
        raw: matched[0],
        id: attrs.id ?? null,
        body: attrs.body ?? "",
        text,
        tokens: Lexer.lexInline(text) as MarkdownToken[],
    };
}

/**
 * 渲染行内评论语法，属性值会做 HTML attribute 转义。
 */
export function renderMarkdownCommentInline(attrs: {id?: string | null; body?: string | null}, innerMarkdown: string): string {
    const id = attrs.id?.trim() ?? "";
    const body = attrs.body ?? "";
    const idAttribute = id ? ` id="${escapeAttribute(id)}"` : "";
    const bodyAttribute = body ? ` body="${escapeAttribute(body)}"` : "";
    return `<comment${idAttribute}${bodyAttribute}>${innerMarkdown}</comment>`;
}

/**
 * 解析块级评论语法。开标签独占一行、闭标签独立成行，内容可跨多个段落。
 */
export function parseMarkdownCommentBlock(src: string): MarkdownCommentBlockToken | null {
    const matched = COMMENT_BLOCK_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const attrs = parseAttributes(matched[1] ?? "");
    return {
        raw: matched[0],
        id: attrs.id ?? null,
        body: attrs.body ?? "",
        text: matched[2] ?? "",
    };
}

/**
 * 渲染块级评论语法。
 */
export function renderMarkdownCommentBlock(attrs: {id?: string | null; body?: string | null}, innerMarkdown: string): string {
    const id = attrs.id?.trim() ?? "";
    const body = attrs.body ?? "";
    const idAttribute = id ? ` id="${escapeAttribute(id)}"` : "";
    const bodyAttribute = body ? ` body="${escapeAttribute(body)}"` : "";
    return `<comment${idAttribute}${bodyAttribute}>\n${innerMarkdown}\n</comment>`;
}

/**
 * 解析注音语法。属性式 text="..." 优先；无属性时兼容标准 <rt> 子标签形式。
 */
export function parseMarkdownRuby(src: string): MarkdownRubyToken | null {
    const matched = RUBY_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const attrs = parseAttributes(matched[1] ?? "");
    let base = matched[2] ?? "";
    let text = attrs.text ?? "";
    if (!text) {
        const rtMatched = RUBY_RT_PATTERN.exec(base);
        if (rtMatched) {
            base = rtMatched[1] ?? "";
            text = rtMatched[2] ?? "";
        }
        // 无 <rt> 也无 text 属性：按空注音接管（序列化侧对空 text 退化为纯正文，roundtrip 无损）。
        // 返回 null 会让残片兜底把整段捕成不可编辑 chip，比「可编辑纯文本」更差。
    }
    if (!base) {
        return null;
    }
    return {
        raw: matched[0],
        text,
        base,
        tokens: Lexer.lexInline(base) as MarkdownToken[],
    };
}

/**
 * 渲染注音语法，统一输出属性式。
 */
export function renderMarkdownRuby(text: string, baseMarkdown: string): string {
    return `<ruby text="${escapeAttribute(text)}">${baseMarkdown}</ruby>`;
}

/**
 * 解析段落级双语对照语法。text 属性承载对照译文，块内容是原文。
 */
export function parseMarkdownBilingualBlock(src: string): MarkdownBilingualBlockToken | null {
    const matched = BILINGUAL_BLOCK_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const attrs = parseAttributes(matched[1] ?? "");
    return {
        raw: matched[0],
        text: attrs.text ?? "",
        body: matched[2] ?? "",
    };
}

/**
 * 渲染段落级双语对照语法。
 */
export function renderMarkdownBilingualBlock(text: string, innerMarkdown: string): string {
    return `<bilingual text="${escapeAttribute(text)}">\n${innerMarkdown}\n</bilingual>`;
}

/**
 * 解析块级对齐语法。
 */
export function parseMarkdownAlign(src: string): MarkdownAlignToken | null {
    const matched = ALIGN_PATTERN.exec(src);
    if (!matched) {
        return null;
    }
    const text = matched[2] ?? "";
    return {
        raw: matched[0],
        align: normalizeAlign(matched[1]),
        text,
        tokens: [],
    };
}

/**
 * 渲染块级对齐语法。
 */
export function renderMarkdownAlign(align: unknown, innerMarkdown: string): string {
    return `<align value="${normalizeAlign(align)}">\n${innerMarkdown}\n</align>`;
}

/**
 * 归一化对齐值；非法值按 left 处理。
 */
export function normalizeAlign(value: unknown): AlignValue {
    return value === "center" || value === "right" || value === "justify" ? value : "left";
}

/**
 * 转义 HTML 属性值。
 */
export function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * 还原 HTML 属性值。
 */
export function unescapeAttribute(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

/**
 * 解析标签属性串为键值对，属性值做反转义。
 */
export function parseAttributes(rawValue: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const matched of rawValue.matchAll(/([\w-]+)="([^"]*)"/g)) {
        const key = matched[1] ?? "";
        if (!key) {
            continue;
        }
        attrs[key] = unescapeAttribute(matched[2] ?? "");
    }
    return attrs;
}
