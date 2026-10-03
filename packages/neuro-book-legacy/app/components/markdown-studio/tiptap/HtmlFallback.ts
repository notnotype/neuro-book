import {Extension, mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {MARKDOWN_BLOCK_DIALECT_TAGS} from "nbook/shared/markdown-workbench";

/**
 * HTML 兜底层：防止方言之外的 HTML / XML 标签被静默丢弃。
 *
 * 背景：未被任何 tokenizer 认领的标签会变成 marked 的 html token，
 * 再经 DOM 解析被剥掉标签只留文字——保存时标签永久消失（数据丢失）。
 *
 * 兜底只负责「保数据」，一律显示为源码，不渲染——
 * 需要真正渲染的 HTML 用显式 <html> 方言块（见 HtmlEmbed.ts）。
 *
 * 兜底职责矩阵：
 * - 方言标签合法形态 → 各自 tokenizer（priority 更低、先执行）接管，兜底不碰；
 * - 真 HTML 行内标签（<b>/<br> 等）→ 交回 DOM 解析路径还原为语义 mark；
 * - 方言标签失配残片（无闭合开标签、孤立闭标签、跨段截断）→ chip / 源码块保数据；
 * - 未知标签 → 完整形态保 chip / 源码块；无闭合残片同样保 chip（含 Vec<String> 类伪标签）。
 *
 * 本文件三件套：
 * - HtmlBlock：块级未知 HTML 完整保留原文，显示为低调源码块。
 * - HtmlBlockBridge：接管 marked 原生块级 html token（截断形态兜底）；
 *   已知行内标签（如 <br> 单独成行）与完整闭合的可 DOM 解析方言标签交回 DOM 路径。
 * - RawInlineHtml：行内未知标签与方言残片原样保留为 chip，序列化原样输出。
 *
 * ⚠️ marked 的 extension tokenizer 是「后注册的先执行」，且先执行者直接胜出；
 * MarkdownManager 按 TipTap priority 降序注册扩展。因此这两个兜底 tokenizer 的
 * priority 必须高于所有带 markdownTokenizer 的方言扩展（先注册 → 最后执行 → 真兜底）。
 * 同时 tokenize 内部用标签名单做第二道保险，即使注册顺序出错也不会抢走已知标签。
 */

/** DOM 解析路径能正确还原语义的真 HTML 行内标签：合法形态与残片都交回 DOM（浏览器语义） */
const DOM_HANDLED_INLINE_TAGS = new Set([
    "a", "b", "strong", "i", "em", "u", "s", "del", "strike", "code", "br", "img",
    "sup", "sub", "mark",
]);

/**
 * 方言行内标签：合法形态由各自 tokenizer（priority 更低、先执行）接管，
 * 能流到行内兜底的必然是失配残片——保 chip，绝不能交给 DOM 剥标签丢数据。
 */
const DIALECT_INLINE_TAGS = new Set([
    "comment", "inline-comment", "bilingual", "align", "ruby", "rt",
]);

/** 有 DOM parseHTML 规则、完整闭合时可交回 DOM 自愈的方言标签（bilingual 无 DOM 规则，不在内） */
const DOM_PARSEABLE_DIALECT_TAGS = new Set(["comment", "inline-comment", "ruby", "align"]);

/**
 * 块级兜底的完整排除名单。
 * ⚠️ 不变量：必须保持「块级方言 ∪ DOM 行内 ∪ 方言行内」全量并集——
 * 若把方言行内组漏掉，<ruby text="x">汉</ruby> 单独成段会被块级兜底整段吃成
 * 源码块（ruby 是 inline tokenizer，块级抢走后它永远轮不到）。
 */
const KNOWN_BLOCK_EXCLUDED_TAGS = new Set([...MARKDOWN_BLOCK_DIALECT_TAGS, ...DOM_HANDLED_INLINE_TAGS, ...DIALECT_INLINE_TAGS]);

/** 无闭合标签的 void 元素 */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const OPEN_TAG_PATTERN = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/;
const SELF_CLOSING_PATTERN = /^<([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^>"'])*\/>/;

interface HtmlFallbackToken extends MarkdownToken {
    html?: string;
}

/**
 * 在同名标签嵌套计数下查找匹配闭合标签，返回闭合标签结束位置；找不到返回 -1。
 */
function findMatchingCloseEnd(src: string, tag: string, searchFrom: number): number {
    const tagPattern = new RegExp(`<(/?)${tag}(?=[\\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "gi");
    tagPattern.lastIndex = searchFrom;
    let depth = 1;
    let matched: RegExpExecArray | null;
    while ((matched = tagPattern.exec(src)) !== null) {
        if ((matched[2] ?? "").endsWith("/")) {
            continue;
        }
        depth += matched[1] === "/" ? -1 : 1;
        if (depth === 0) {
            return matched.index + matched[0].length;
        }
    }
    return -1;
}

/**
 * 尝试从 src 开头捕获一段完整的未知 HTML 片段。
 * requireLineEnd=true（块级）时要求片段之后紧跟行尾——段落以行内标签开头
 * （如 "<mark>x</mark>和…"）不属于块级形态，交回行内解析。
 * 返回 null 表示不是可捕获形态（交还给后续 tokenizer / marked 原生处理）。
 */
function captureUnknownHtml(src: string, knownTags: Set<string>, requireLineEnd: boolean): string | null {
    let captured: string | null = null;
    const selfClosing = SELF_CLOSING_PATTERN.exec(src);
    if (selfClosing) {
        captured = knownTags.has(selfClosing[1]!.toLowerCase()) ? null : selfClosing[0];
    } else {
        const open = OPEN_TAG_PATTERN.exec(src);
        if (!open) {
            return null;
        }
        const tag = open[1]!.toLowerCase();
        if (knownTags.has(tag)) {
            return null;
        }
        if (VOID_TAGS.has(tag)) {
            captured = open[0];
        } else {
            const closeEnd = findMatchingCloseEnd(src, tag, open[0].length);
            captured = closeEnd < 0 ? null : src.slice(0, closeEnd);
        }
    }
    if (!captured) {
        return null;
    }
    if (requireLineEnd && !/^[ \t]*(?:\r?\n|$)/.test(src.slice(captured.length))) {
        return null;
    }
    return captured;
}

/**
 * 残片捕获（⚠️ 仅行内兜底使用，块级路径不走这里——块级截断形态由 marked 原生
 * html token + HtmlBlockBridge 兜住，在这里捕单标签会让块级语义漂移）。
 * 完整片段捕获失败后，把孤立的闭标签或无闭合的开标签本身保为 chip：
 * 方言标签失配残片（多段混合形态拆出的 <comment> / </comment>）、
 * 正文里的伪标签（Vec<String>）此前都会被 DOM 解析剥掉造成静默数据丢失。
 * 真 HTML 行内标签（excludedTags）维持浏览器语义：残片被 DOM 忽略，不出 chip。
 */
function captureHtmlTagFragment(src: string, excludedTags: Set<string>): string | null {
    const closeTag = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(src);
    if (closeTag) {
        return excludedTags.has(closeTag[1]!.toLowerCase()) ? null : closeTag[0];
    }
    const openTag = OPEN_TAG_PATTERN.exec(src);
    if (openTag && !excludedTags.has(openTag[1]!.toLowerCase())) {
        return openTag[0];
    }
    return null;
}

/**
 * 块级未知 HTML 节点。attrs.html 保留完整原文；序列化原样写回，绝不丢数据。
 * 只显示源码，不提供渲染——渲染是显式 <html> 方言块（HtmlEmbed）的能力。
 */
export const HtmlBlock = Node.create({
    name: "htmlBlock",
    group: "block",
    atom: true,
    selectable: true,
    priority: 1400,

    addAttributes() {
        return {
            html: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "pre[data-nb-html-block]",
            getAttrs: (dom) => ({
                html: (dom as HTMLElement).textContent ?? "",
            }),
        }];
    },

    renderHTML({node}) {
        return ["pre", mergeAttributes({
            class: "nb-html-block",
            "data-nb-html-block": "true",
            contenteditable: "false",
        }), String(node.attrs.html ?? "")];
    },

    renderText({node}) {
        return String(node.attrs.html ?? "");
    },

    markdownTokenizer: {
        name: "htmlBlock",
        level: "block",
        start(src: string) {
            // ⚠️ 只认「换行后的行首标签」：marked 段落中断检测会传入 src.slice(1)，
            // 匹配 ^ 开头形态会把段内行内标签误判成截断点。真块首由 tokenize 直接兜住。
            const pattern = /\n<([a-zA-Z][\w-]*)/g;
            let matched: RegExpExecArray | null;
            while ((matched = pattern.exec(src)) !== null) {
                if (!KNOWN_BLOCK_EXCLUDED_TAGS.has(matched[1]!.toLowerCase())) {
                    return matched.index + 1;
                }
            }
            return -1;
        },
        tokenize(src: string) {
            const html = captureUnknownHtml(src, KNOWN_BLOCK_EXCLUDED_TAGS, true);
            if (!html) {
                return undefined;
            }
            return {
                type: "htmlBlock",
                raw: html,
                html,
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const htmlToken = token as HtmlFallbackToken;
        const html = String(htmlToken.html ?? htmlToken.raw ?? "").trim();
        if (!html) {
            // 空数组 = 未认领，MarkdownManager 会继续尝试其他 handler / fallback
            return [];
        }
        return helpers.createNode("htmlBlock", {html});
    },

    renderMarkdown: (node) => {
        return String(node.attrs?.html ?? "");
    },
});

/**
 * 接管 marked 原生块级 html token（自定义 tokenizer 没接住的截断形态），
 * 保留原文进 HtmlBlock 节点。三类交回默认 DOM 解析路径：
 * 行内 html token；以真 HTML 行内标签开头的块级 token（如 <br> 单独成行 → hardBreak）；
 * 完整闭合且有 DOM parseHTML 规则的方言标签（如 <comment>␊内容</comment> 闭标签黏行
 * 的单段形态 → DOM 自愈为行内评论 mark，下次保存写回规范形态）。
 */
export const HtmlBlockBridge = Extension.create({
    name: "htmlBlockBridge",
    markdownTokenName: "html",

    parseMarkdown: (token, helpers) => {
        if (!token.block) {
            // 空数组 = 未认领，行内 html token 交回默认 DOM 解析路径
            return [];
        }
        const html = String(token.raw ?? token.text ?? "").trim();
        if (!html) {
            return [];
        }
        const firstTag = /^<([a-zA-Z][\w-]*)/.exec(html)?.[1]?.toLowerCase() ?? "";
        if (firstTag && DOM_HANDLED_INLINE_TAGS.has(firstTag)) {
            // <br> 等真 HTML 行内标签独占一行时按行内语义 DOM 解析，不变源码块
            return [];
        }
        const openTagEnd = OPEN_TAG_PATTERN.exec(html)?.[0].length ?? 0;
        if (
            firstTag && DOM_PARSEABLE_DIALECT_TAGS.has(firstTag) && openTagEnd > 0
            && findMatchingCloseEnd(html, firstTag, openTagEnd) === html.length
        ) {
            // 配对闭合恰好覆盖到结尾的方言标签交回 DOM 自愈；中途闭合（结尾还挂着
            // 残片，如 <comment>a</comment>x</comment>）保源码块，防 DOM 静默丢残片
            return [];
        }
        return helpers.createNode("htmlBlock", {html});
    },
});

/**
 * 行内未知标签兜底节点：原样保留源码，展示为 code 风格 chip，序列化原样输出。
 * 完整片段（有配对闭合 / 自闭合 / void）整体成 chip；失配残片（无闭合的开标签、
 * 孤立闭标签）退化为单标签 chip——两者都优于 DOM 解析剥标签造成的静默数据丢失。
 */
export const RawInlineHtml = Node.create({
    name: "rawInlineHtml",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    priority: 1390,

    addAttributes() {
        return {
            html: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-nb-raw-html]",
            getAttrs: (dom) => ({
                html: (dom as HTMLElement).getAttribute("data-nb-raw-html") ?? "",
            }),
        }];
    },

    renderHTML({node}) {
        const html = String(node.attrs.html ?? "");
        return ["span", mergeAttributes({
            class: "nb-raw-inline-html",
            "data-nb-raw-html": html,
            contenteditable: "false",
            title: html,
        }), html];
    },

    renderText({node}) {
        return String(node.attrs.html ?? "");
    },

    markdownTokenizer: {
        name: "rawInlineHtml",
        level: "inline",
        start(src: string) {
            // 也要认闭标签起始（</tag>），否则孤立闭标签残片轮不到本 tokenizer
            const matched = /<\/?[a-zA-Z]/.exec(src);
            return matched ? matched.index : -1;
        },
        tokenize(src: string) {
            const html = captureUnknownHtml(src, DOM_HANDLED_INLINE_TAGS, false)
                ?? captureHtmlTagFragment(src, DOM_HANDLED_INLINE_TAGS);
            if (!html) {
                return undefined;
            }
            return {
                type: "rawInlineHtml",
                raw: html,
                html,
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const htmlToken = token as HtmlFallbackToken;
        const html = String(htmlToken.html ?? htmlToken.raw ?? "");
        if (!html) {
            // 空数组 = 未认领，MarkdownManager 会继续尝试其他 handler / fallback
            return [];
        }
        return helpers.createNode("rawInlineHtml", {html});
    },

    renderMarkdown: (node) => {
        return String(node.attrs?.html ?? "");
    },
});
