/**
 * 条目主文字的语言（docs/specs/canon/author-ui.md 输出 48）：给源文字的输入框着色用的 Monarch 规则，经编辑器的贡献点
 * `editor.languages` 登记（docs/specs/workbench/editor.md 输出 43）。
 *
 * 只管着色，不判对错：写法合不合规由内核在写入时查（canon.rendering 输出 1）。所以认不出的字一律照正文画，不标成错误。
 * 不用 Monaco 自带的 `mdx`：它把花括号里的内容交给 JavaScript 的分词，那份规则把认不出的字符标成错误，中文字段名
 * （`{character.外观}`）会被画成红色下划线。
 */

import type {LanguageDeclaration, LanguageDefinition} from "nbook/plugins/editor/shared/contracts";

/** 语言 id（也是贡献 id）。 */
export const ENTRY_LANGUAGE = "canon-entry";

export const ENTRY_LANGUAGE_DECLARATION: LanguageDeclaration = {aliases: ["Canon Entry", "canon-entry"]};

/** 名字的一个字：字母、数字、下划线、`$` 与 ASCII 以外的字（中文字段名）。不用 `\p{L}`：那要整份规则按 unicode 模式编译。 */
const NAME = "[A-Za-z_$\\u00A0-\\uFFFF][\\w$\\u00A0-\\uFFFF]*";

const language: LanguageDefinition["language"] = {
    defaultToken: "",
    tokenPostfix: ".canon-entry",
    // 行尾的换行也交给规则：标题要在行尾退出，行尾可能正好是一个表达式或标签的结束。
    includeLF: true,
    // 反斜杠转义的标点：`\{` 不开始表达式，`\<` 不开始标签。
    escapes: /\\[\\`*_{}[\]()#+\-.!<>|~]/u,
    tokenizer: {
        root: [
            [/^\s*`{3,}[^\n]*/u, {token: "string", next: "@fenceBacktick"}],
            [/^\s*~{3,}[^\n]*/u, {token: "string", next: "@fenceTilde"}],
            [/^(\s{0,3})(#{1,6})(?=\s)/u, ["", {token: "keyword", next: "@heading"}]],
            [/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u, "keyword"],
            [/^\s*>+/u, "comment"],
            [/^(\s*)([-*+]|\d{1,9}[.)])(?=\s)/u, ["", "keyword"]],
            {include: "@inline"},
        ],
        // 标题的一整行按关键字画，里面的表达式、标签照各自的画。
        heading: [
            [/\n/u, {token: "", next: "@pop"}],
            {include: "@inline"},
            [/[^\\{<`*[!\n]+/u, "keyword"],
            [/./u, "keyword"],
        ],
        inline: [
            [/@escapes/u, "string.escape"],
            [/\{\s*\/\*/u, {token: "comment", next: "@expressionComment"}],
            [/\{/u, {token: "delimiter.bracket", next: "@expression"}],
            [/<\/?[A-Za-z][\w.]*/u, {token: "tag", next: "@tag"}],
            [/`[^`\n]+`/u, "variable"],
            [/\*\*(?:[^\\*\n]|@escapes|\*(?!\*))+\*\*/u, "strong"],
            [/\*(?:[^\\*\n]|@escapes)+\*/u, "emphasis"],
            [/~~[^~\n]+~~/u, "comment"],
            [/(!?\[)((?:[^\]\\\n]|@escapes)*)(\]\([^)\n]*\))/u, ["string.link", "", "string.link"]],
        ],
        // `{` 到配对的 `}`：字段的路径、字符串、数与运算符。
        expression: [
            [/\}/u, {token: "delimiter.bracket", next: "@pop"}],
            [/\{/u, {token: "delimiter.bracket", next: "@push"}],
            [/\/\*/u, {token: "comment", next: "@blockComment"}],
            [/"(?:[^"\\\n]|\\.)*"/u, "string"],
            [/'(?:[^'\\\n]|\\.)*'/u, "string"],
            [/\d+(?:\.\d+)?/u, "number"],
            [/\b(?:true|false|null)\b/u, "keyword"],
            [/ref(?=\s*\()/u, "type"],
            [new RegExp(NAME, "u"), "variable"],
            [/[.,()[\]]/u, "delimiter"],
            [/[?:<>=!&|+\-*/%]+/u, "operator"],
        ],
        // `{/* … */}`：整个是注释。
        expressionComment: [
            [/\*\/\s*\}/u, {token: "comment", next: "@pop"}],
            [/[^*\n]+|\*|\n/u, "comment"],
        ],
        blockComment: [
            [/\*\//u, {token: "comment", next: "@pop"}],
            [/[^*\n]+|\*|\n/u, "comment"],
        ],
        // `<Ref id="…" />`、`<Image src={…} alt="…" />`：标签名、属性名、属性值。
        tag: [
            [/\/?>/u, {token: "tag", next: "@pop"}],
            [/[A-Za-z_][\w-]*/u, "attribute.name"],
            [/=/u, "delimiter"],
            [/"[^"\n]*"/u, "attribute.value"],
            [/'[^'\n]*'/u, "attribute.value"],
            [/\{/u, {token: "delimiter.bracket", next: "@expression"}],
        ],
        fenceBacktick: [
            [/^\s*`{3,}\s*$/u, {token: "string", next: "@pop"}],
            [/[^\n]+|\n/u, "variable.source"],
        ],
        fenceTilde: [
            [/^\s*~{3,}\s*$/u, {token: "string", next: "@pop"}],
            [/[^\n]+|\n/u, "variable.source"],
        ],
    },
};

const configuration: LanguageDefinition["configuration"] = {
    comments: {blockComment: ["{/*", "*/}"]},
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
        {open: "{", close: "}"},
        {open: "[", close: "]"},
        {open: "(", close: ")"},
        {open: "\"", close: "\"", notIn: ["string"]},
        {open: "`", close: "`"},
    ],
    surroundingPairs: [
        {open: "{", close: "}"},
        {open: "[", close: "]"},
        {open: "(", close: ")"},
        {open: "\"", close: "\""},
        {open: "`", close: "`"},
        {open: "*", close: "*"},
    ],
};

export const entryLanguageDefinition: LanguageDefinition = {format: "monarch", language, configuration};
