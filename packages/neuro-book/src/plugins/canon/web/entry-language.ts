/**
 * 条目主文字的语言（docs/specs/canon/author-ui.md 输出 48）：给源文字的输入框着色用的 Monarch 规则，经编辑器的贡献点
 * `editor.languages` 登记（docs/specs/workbench/editor.md 输出 43）。
 *
 * 只管着色，不判对错：写法合不合规由内核在写入时查（canon.rendering 输出 1）。所以认不出的字一律照正文画，不标成错误。属性写成
 * 内核认的 `名="值"`（等号两边没有空格）才照标签画，免得写错的标签看着像写对了。已知不同：四个空格开头的缩进代码块里的标签照标签画
 * （内核按代码照原文显示），Monarch 按行分词，认不出缩进代码块的前后文。
 * 标签（`<V of="…" />`、`<If test="…">`）的名字、属性名、属性值各自着色，`of`、`expr`、`test` 的值里照式子画：字段名、字符串、
 * 数与运算符。
 */

import type {LanguageDeclaration, LanguageDefinition} from "nbook/plugins/editor/shared/contracts";

/** 语言 id（也是贡献 id）。 */
export const ENTRY_LANGUAGE = "canon-entry";

export const ENTRY_LANGUAGE_DECLARATION: LanguageDeclaration = {aliases: ["Canon Entry", "canon-entry"]};

/** 名字的一个字：字母、数字、下划线、`$` 与 ASCII 以外的字（中文字段名）。不用 `\p{L}`：那要整份规则按 unicode 模式编译。 */
const NAME = "[A-Za-z_$\\u00A0-\\uFFFF][\\w$\\u00A0-\\uFFFF]*";

type Rules = LanguageDefinition["language"]["tokenizer"][string];

/**
 * `of`、`expr`、`test` 的属性值（双引号里）：字段的路径、单引号的字符串、数与运算符。字段名归在 `type` 这一类：主题里 `variable` 与
 * 正文同色，看不出是引用。
 */
const expressionRules: Rules = [
    [/"/u, {token: "attribute.value", next: "@pop"}],
    [/'(?:[^'\\\n"]|\\.)*'/u, "string"],
    [/\d+(?:\.\d+)?/u, "number"],
    [/\b(?:true|false|null)\b/u, "keyword"],
    [/(?:ref|round|floor|ceil|min|max|abs|percent)(?=\s*\()/u, "keyword"],
    [new RegExp(NAME, "u"), "type.field"],
    [/[.,()[\]]/u, "delimiter"],
    [/[?:<>=!&|+\-*/%]+/u, "operator"],
    [/\n/u, {token: "", next: "@popall"}],
];

const language: LanguageDefinition["language"] = {
    defaultToken: "",
    tokenPostfix: ".canon-entry",
    // 行尾的换行也交给规则：标题要在行尾退出，行尾可能正好是一个表达式或标签的结束。
    includeLF: true,
    // 反斜杠转义的标点：`\<` 不开始标签。
    escapes: /\\[\\`*_{}[\]()#+\-.!<>|~]/u,
    tokenizer: {
        root: [
            [/^\s*`{3,}[^\n]*/u, {token: "string", next: "@fenceBacktick"}],
            [/^\s*~{3,}[^\n]*/u, {token: "string", next: "@fenceTilde"}],
            [/^(\s{0,3})(#{1,6})(?=\s)/u, ["", {token: "keyword.heading", next: "@heading"}]],
            [/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u, "keyword"],
            [/^\s*>+/u, "comment"],
            [/^(\s*)([-*+]|\d{1,9}[.)])(?=\s)/u, ["", "keyword"]],
            {include: "@inline"},
        ],
        // 标题的一整行按关键字的颜色画、加粗（编辑器主题里 `keyword.heading` 那一条），里面的表达式、标签照各自的画。
        heading: [
            [/\n/u, {token: "", next: "@pop"}],
            {include: "@inline"},
            [/[^\\<`*[!\n]+/u, "keyword.heading"],
            [/./u, "keyword.heading"],
        ],
        inline: [
            [/@escapes/u, "string.escape"],
            // 大写名字后面跟着属性或收尾才是标签：`评级 <A 级`、`a<b` 照正文画。
            [/<\/?[A-Z][\w]*(?=\s+[A-Za-z_][\w-]*="|\s*\/?>)/u, {token: "tag", next: "@tag"}],
            [/`[^`\n]+`/u, "string"],
            // 加粗与强调：记号里面一侧不能是空白（`2 * 3 * 4` 不是强调），里面有标签时不算（让给标签，字段名照样着色）。
            [/\*\*(?!\s)(?:[^\\*\n<]|@escapes)+?(?<!\s)\*\*/u, "strong"],
            [/\*(?![\s*])(?:[^\\*\n<]|@escapes)+?(?<!\s)\*/u, "emphasis"],
            [/~~[^~\n]+~~/u, "comment"],
            // 链接的文字与地址各限一个长度：不限时，一行里很多个没配对的 `[` 要回溯很久。文字里有标签时不当链接：让给标签着色（内核里
            // 链接文字里的标签是活的）。
            [/(!?\[)((?:[^\]\\\n<]|<(?![A-Z/])|@escapes){0,300})(\]\([^)\n]{0,2000}\))/u, ["string.link", "", "string.link"]],
        ],
        expression: expressionRules,
        // `<Ref id="…" />`、`<V of="…" />`：标签名、属性名、属性值；`of`、`expr`、`test` 的值照式子画。
        tag: [
            // 标签同样不能跨空行：没写完的 `<Ref` 只影响它这一段。
            [/^\s*\n/u, {token: "", next: "@popall"}],
            [/\/?>/u, {token: "tag", next: "@pop"}],
            [/(of|expr|test)(=)(")/u, ["attribute.name", "delimiter", {token: "attribute.value", next: "@expression"}]],
            [/[A-Za-z_][\w-]*/u, "attribute.name"],
            [/=/u, "delimiter"],
            [/"[^"\n]*"/u, "attribute.value"],
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
    brackets: [["[", "]"], ["(", ")"]],
    autoClosingPairs: [
        {open: "[", close: "]"},
        {open: "(", close: ")"},
        {open: "\"", close: "\"", notIn: ["string"]},
        {open: "`", close: "`"},
    ],
    surroundingPairs: [
        {open: "[", close: "]"},
        {open: "(", close: ")"},
        {open: "\"", close: "\""},
        {open: "`", close: "`"},
        {open: "*", close: "*"},
    ],
};

export const entryLanguageDefinition: LanguageDefinition = {format: "monarch", language, configuration};
