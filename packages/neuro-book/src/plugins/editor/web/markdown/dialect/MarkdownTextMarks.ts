import {Mark, mergeAttributes} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";

interface HtmlMarkToken extends MarkdownToken {
    color?: string;
    text?: string;
    tokens?: MarkdownToken[];
}

type HtmlTagKind = "span-color" | "mark-highlight" | "superscript" | "subscript";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownTextColor: {
            setMarkdownTextColor: (color: string) => ReturnType;
            unsetMarkdownTextColor: () => ReturnType;
        };
        markdownHighlight: {
            setMarkdownHighlight: (color: string) => ReturnType;
            unsetMarkdownHighlight: () => ReturnType;
        };
        markdownSuperscript: {
            toggleMarkdownSuperscript: () => ReturnType;
            unsetMarkdownSuperscript: () => ReturnType;
        };
        markdownSubscript: {
            toggleMarkdownSubscript: () => ReturnType;
            unsetMarkdownSubscript: () => ReturnType;
        };
    }
}

/**
 * Text color mark, serialized as inline HTML to keep Markdown storage explicit.
 */
export const MarkdownTextColor = Mark.create({
    name: "markdownTextColor",
    priority: 760,

    addAttributes() {
        return {
            color: {
                default: null,
                parseHTML: (element: HTMLElement) => readCssValue(element.getAttribute("style") ?? "", "color"),
                renderHTML: (attributes) => attributes.color ? {style: `color: ${attributes.color}`} : {},
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[style]",
            getAttrs: (dom) => {
                const color = readCssValue((dom as HTMLElement).getAttribute("style") ?? "", "color");
                return color ? {color} : false;
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes), 0];
    },

    markdownTokenizer: createHtmlMarkTokenizer("markdownTextColor", "span-color"),

    parseMarkdown: (token, helpers) => {
        const htmlToken = token as HtmlMarkToken;
        return helpers.applyMark("markdownTextColor", helpers.parseInline(htmlToken.tokens ?? []), {
            color: htmlToken.color ?? null,
        });
    },

    renderMarkdown: (node, helpers) => {
        const color = String(node.attrs?.color ?? "").trim();
        return color ? `<span style="color: ${escapeHtmlAttribute(color)}">${helpers.renderChildren(node)}</span>` : helpers.renderChildren(node);
    },

    addCommands() {
        return {
            setMarkdownTextColor: (color: string) => ({commands}) => commands.setMark(this.name, {color}),
            unsetMarkdownTextColor: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
});

/**
 * Highlight mark, serialized as <mark> HTML.
 */
export const MarkdownHighlight = Mark.create({
    name: "markdownHighlight",
    priority: 755,
    inclusive: false,

    addAttributes() {
        return {
            color: {
                default: null,
                parseHTML: (element: HTMLElement) => readCssValue(element.getAttribute("style") ?? "", "background-color"),
                renderHTML: (attributes) => attributes.color ? {style: `background-color: ${attributes.color}`} : {},
            },
        };
    },

    parseHTML() {
        return [{
            tag: "mark",
            getAttrs: (dom) => {
                const color = readCssValue((dom as HTMLElement).getAttribute("style") ?? "", "background-color");
                return {color: color || null};
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["mark", mergeAttributes(HTMLAttributes), 0];
    },

    markdownTokenizer: createHtmlMarkTokenizer("markdownHighlight", "mark-highlight"),

    parseMarkdown: (token, helpers) => {
        const htmlToken = token as HtmlMarkToken;
        return helpers.applyMark("markdownHighlight", helpers.parseInline(htmlToken.tokens ?? []), {
            color: htmlToken.color ?? null,
        });
    },

    renderMarkdown: (node, helpers) => {
        const color = String(node.attrs?.color ?? "").trim();
        const style = color ? ` style="background-color: ${escapeHtmlAttribute(color)}"` : "";
        return `<mark${style}>${helpers.renderChildren(node)}</mark>`;
    },

    addCommands() {
        return {
            setMarkdownHighlight: (color: string) => ({commands}) => commands.setMark(this.name, {color}),
            unsetMarkdownHighlight: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
});

/**
 * Superscript mark, serialized as <sup>.
 */
export const MarkdownSuperscript = Mark.create({
    name: "markdownSuperscript",
    priority: 750,
    excludes: "markdownSubscript",

    parseHTML() {
        return [{tag: "sup"}];
    },

    renderHTML({HTMLAttributes}) {
        return ["sup", mergeAttributes(HTMLAttributes), 0];
    },

    markdownTokenizer: createHtmlMarkTokenizer("markdownSuperscript", "superscript"),

    parseMarkdown: (token, helpers) => {
        const htmlToken = token as HtmlMarkToken;
        return helpers.applyMark("markdownSuperscript", helpers.parseInline(htmlToken.tokens ?? []));
    },

    renderMarkdown: (node, helpers) => `<sup>${helpers.renderChildren(node)}</sup>`,

    addCommands() {
        return {
            toggleMarkdownSuperscript: () => ({commands}) => commands.toggleMark(this.name),
            unsetMarkdownSuperscript: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
});

/**
 * Subscript mark, serialized as <sub>.
 */
export const MarkdownSubscript = Mark.create({
    name: "markdownSubscript",
    priority: 750,
    excludes: "markdownSuperscript",

    parseHTML() {
        return [{tag: "sub"}];
    },

    renderHTML({HTMLAttributes}) {
        return ["sub", mergeAttributes(HTMLAttributes), 0];
    },

    markdownTokenizer: createHtmlMarkTokenizer("markdownSubscript", "subscript"),

    parseMarkdown: (token, helpers) => {
        const htmlToken = token as HtmlMarkToken;
        return helpers.applyMark("markdownSubscript", helpers.parseInline(htmlToken.tokens ?? []));
    },

    renderMarkdown: (node, helpers) => `<sub>${helpers.renderChildren(node)}</sub>`,

    addCommands() {
        return {
            toggleMarkdownSubscript: () => ({commands}) => commands.toggleMark(this.name),
            unsetMarkdownSubscript: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
});

function createHtmlMarkTokenizer(name: string, kind: HtmlTagKind) {
    return {
        name,
        level: "inline" as const,
        start(src: string) {
            if (kind === "span-color") {
                return src.indexOf("<span");
            }
            if (kind === "mark-highlight") {
                return src.indexOf("<mark");
            }
            return src.indexOf(kind === "superscript" ? "<sup" : "<sub");
        },
        tokenize(src: string, _tokens: unknown, lexer: {inlineTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseHtmlMark(src, kind);
            if (!parsed) {
                return undefined;
            }
            return {
                type: name,
                raw: parsed.raw,
                text: parsed.text,
                color: parsed.color,
                tokens: lexer.inlineTokens(parsed.text),
            };
        },
    };
}

function parseHtmlMark(src: string, kind: HtmlTagKind): {raw: string; text: string; color?: string | null} | null {
    if (kind === "span-color") {
        const matched = /^<span\b([^>]*)>([\s\S]*?)<\/span>/i.exec(src);
        const style = matched?.[1] ? readHtmlAttribute(matched[1], "style") : "";
        const color = readCssValue(style, "color");
        if (!matched || !color) {
            return null;
        }
        return {raw: matched[0], text: matched[2] ?? "", color};
    }
    if (kind === "mark-highlight") {
        const matched = /^<mark\b([^>]*)>([\s\S]*?)<\/mark>/i.exec(src);
        if (!matched) {
            return null;
        }
        const style = readHtmlAttribute(matched[1] ?? "", "style");
        return {raw: matched[0], text: matched[2] ?? "", color: readCssValue(style, "background-color")};
    }
    const tag = kind === "superscript" ? "sup" : "sub";
    const matched = new RegExp(`^<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(src);
    return matched ? {raw: matched[0], text: matched[1] ?? ""} : null;
}

function readHtmlAttribute(source: string, attribute: string): string {
    const matched = new RegExp(`${attribute}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(source);
    return matched?.[2] ?? matched?.[3] ?? "";
}

function readCssValue(style: string, property: string): string {
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`, "i").exec(style);
    return matched?.[1]?.trim() ?? "";
}

function escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
