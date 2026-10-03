import {Mark, mergeAttributes} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {parseMarkdownRuby, renderMarkdownRuby} from "nbook/shared/markdown-workbench";

interface RubyToken extends MarkdownToken {
    text?: string;
    base?: string;
    tokens?: MarkdownToken[];
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownRuby: {
            setMarkdownRuby: (text: string) => ReturnType;
            unsetMarkdownRuby: () => ReturnType;
        };
    }
}

/**
 * 注音 mark，Markdown 序列化为属性式 <ruby text="hàn zì">汉字</ruby>。
 * 渲染用浏览器原生 ruby 排版：正文上方悬浮小字标注（拼音、假名、短译文），
 * 双语阅读时词语级对照就用它；解析兼容标准 HTML 形式 <ruby>汉字<rt>hàn zì</rt></ruby>。
 */
export const MarkdownRuby = Mark.create({
    name: "markdownRuby",
    priority: 770,
    inclusive: false,

    addAttributes() {
        return {
            text: {
                default: "",
                parseHTML: (element: HTMLElement) => element.getAttribute("text")
                    ?? element.querySelector("rt")?.textContent
                    ?? "",
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{
            tag: "ruby",
            contentElement: (dom) => (dom as HTMLElement).querySelector(".nb-ruby-base") ?? (dom as HTMLElement),
        }];
    },

    renderHTML({mark, HTMLAttributes}) {
        return ["ruby", mergeAttributes(HTMLAttributes, {class: "nb-ruby"}),
            ["span", {class: "nb-ruby-base"}, 0],
            ["rt", {class: "nb-ruby-text", contenteditable: "false"}, String(mark.attrs.text ?? "")],
        ];
    },

    markdownTokenizer: {
        name: "markdownRuby",
        level: "inline",
        start(src: string) {
            return src.indexOf("<ruby");
        },
        tokenize(src: string, _tokens: unknown, lexer: {inlineTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseMarkdownRuby(src);
            if (!parsed) {
                return undefined;
            }
            return {
                type: "markdownRuby",
                raw: parsed.raw,
                text: parsed.text,
                base: parsed.base,
                tokens: lexer.inlineTokens(parsed.base),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const rubyToken = token as RubyToken;
        return helpers.applyMark("markdownRuby", helpers.parseInline(rubyToken.tokens ?? []), {
            text: rubyToken.text ?? "",
        });
    },

    renderMarkdown: (node, helpers) => {
        const text = String(node.attrs?.text ?? "").trim();
        if (!text) {
            return helpers.renderChildren(node);
        }
        return renderMarkdownRuby(text, helpers.renderChildren(node));
    },

    addCommands() {
        return {
            setMarkdownRuby: (text: string) => ({commands}) => commands.setMark(this.name, {text}),
            unsetMarkdownRuby: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
});
