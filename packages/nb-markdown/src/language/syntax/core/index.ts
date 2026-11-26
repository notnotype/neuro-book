/**
 * 核心语法（docs/specs/workspace/markdown-dialect.md 输出 2、4–7、10、19、20、25、26）：CommonMark 与 GFM 的块与行内语法。
 *
 * schema 用 Tiptap 的扩展；读法全部自己写，不用扩展自带的 `parseMarkdown`：要从词法单元的 `raw` 记下原来的写法（`markdown`
 * 属性），要按自己的规则处理实体、段内换行与行内 HTML。
 *
 * 写法属性 `markdown` 不渲染到 DOM、不随拆分复制（`keepOnSplit: false`）；值的形状见各读法。新建的节点没有它，写出时用规范写法。
 */

import {Extension} from "@tiptap/core";
import {Code} from "@tiptap/extension-code";
import {Document} from "@tiptap/extension-document";
import type {AnyExtension, JSONContent} from "@tiptap/core";
import {Image} from "@tiptap/extension-image";
import {Link} from "@tiptap/extension-link";
import {TaskItem, TaskList} from "@tiptap/extension-list";
import {Paragraph} from "@tiptap/extension-paragraph";
import {TableCell, TableHeader, TableKit} from "@tiptap/extension-table";
import {StarterKit} from "@tiptap/starter-kit";
import {decodeHTMLStrict} from "entities";
import type {Token, Tokens} from "marked";

import {coreLexing, isBreakOnlyHtml} from "../../../marked/core";
import {CODE_EXCLUSIVE} from "../types";
import type {MarkdownSyntax, ReadContext, TokenReader} from "../types";
import {coreWriters} from "./write";


/** 需要记写法的节点与标记类型。 */
const STYLED_TYPES = [
    "heading", "bulletList", "orderedList", "taskItem", "codeBlock", "horizontalRule", "hardBreak", "image",
    "bold", "italic", "strike", "code", "link",
];

/** `markdown` 写法属性：不画到 DOM，不随拆分带到新节点。 */
const MarkdownStyle = Extension.create({
    name: "markdownStyle",
    addGlobalAttributes() {
        return [{types: STYLED_TYPES, attributes: {markdown: {default: null, rendered: false, keepOnSplit: false}}}];
    },
});

/**
 * 文档带着 frontmatter 的原文（方言 Spec 输出 22）：BOM 之后、正文之前的 `---` 块，原样一个字符串，没有时为 null。放在文档的
 * 属性上而不是做成第一个块：它不是正文，块菜单、全选删除、粘贴与位置都碰不到它；改它用 `setDocAttribute`，撤销照常。
 * 只放 `isWholeFrontmatter` 认可的原文（编解码器读出的都是），写回把它原样拼在正文前（`codec/write.ts`）。
 */
const MarkdownDocument = Document.extend({
    addAttributes() {
        return {frontmatter: {default: null, rendered: false}};
    },
});

/**
 * 段落的优先级压过所有块级节点：空文档、空容器的默认填充（ProseMirror 取 schema 里第一个能默认创建的块）必须是段落。
 * 新增块级节点的优先级不能超过它。
 */
const MarkdownParagraph = Paragraph.extend({priority: 1500});

/**
 * 行内代码只排斥自己与注音：Tiptap 自带的排斥一切别的标记，读入 `` [`代码`](地址) ``、`` **`代码`** `` 时外面的链接与粗体会被
 * 丢掉，改过这一块再写回就没了。别的标记盖住行内代码时写在反引号外面（写法里它在最里层，`textOnly`）；注音的正文只能是文字，
 * 两者不能同在。光标在行内代码末尾继续输入时不带它（`inclusive: false`，沿旧应用）。
 *
 * 排斥按标记组写（`CODE_EXCLUSIVE`，注音也在这一组）：注音是方言，可能不在语言里（docs/specs/workspace/markdown-syntaxes.md
 * 输出 8），写成类型名时缺了它 schema 就建不起来。组里至少有行内代码自己，所以组不会是空的。
 */
const MarkdownCode = Code.extend({group: CODE_EXCLUSIVE, excludes: CODE_EXCLUSIVE, inclusive: false});

/**
 * 链接（docs/specs/workbench/editor.md 输出 62）：光标在链接的开头或末尾时打的字不进链接，退格删到最后一个字、删光了再打也不进；
 * 打出的网址是文字，不自动变成链接（写回时按 docs/specs/workspace/markdown-dialect.md 输出 4 转义）。Tiptap 的链接默认开着自动
 * 链接，“包含边界”跟着它走，所以配置里关掉自动链接，这里再显式写 `inclusive`，不依赖那层联动。
 */
const MarkdownLink = Link.extend({inclusive: () => false});

/** 表格单元格只有一段（输出 20）：单元格里的 Enter 是换行，GFM 写不出多段。 */
const SingleParagraphCell = TableCell.extend({content: "paragraph"});
const SingleParagraphHeader = TableHeader.extend({content: "paragraph"});

const text = (value: string): JSONContent => ({type: "text", text: value});

/** 文字单元：实体按 HTML5 表解码一次（含数字实体）；段内的换行读成带写法的硬换行（输出 5）。 */
function readText(raw: string): JSONContent[] {
    const out: JSONContent[] = [];
    const lines = raw.split("\n");
    lines.forEach((line, index) => {
        if (index > 0) out.push({type: "hardBreak", attrs: {markdown: "newline"}});
        if (line !== "") out.push(text(decodeHTMLStrict(line)));
    });
    return out;
}

/**
 * 一组行内单元的纯文字（CommonMark 的图片说明）：转义去掉反斜杠、实体解码一次、强调与链接只取其中的文字，行内代码取代码，
 * 换行是空格，HTML 是原文。
 */
function plainText(tokens: ReadonlyArray<Token>): string {
    return tokens.map((token) => {
        switch (token.type) {
            case "escape":
                return (token as Tokens.Escape).text;
            case "codespan":
                return (token as Tokens.Codespan).text;
            case "br":
                return " ";
            case "text":
                return "tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0 ? plainText(token.tokens) : decodeHTMLStrict(token.raw);
            default:
                return "tokens" in token && Array.isArray(token.tokens) ? plainText(token.tokens) : token.raw;
        }
    }).join("");
}

/** 行内 HTML 能读的标签（输出 25）：标签名 → 标记类型。 */
const HTML_MARKS: Readonly<Record<string, string>> = {strong: "bold", b: "bold", em: "italic", i: "italic", del: "strike", s: "strike"};

/** 强调符号：`**`、`__`、`*`、`_` 的第一个字符。 */
const emphasisMarker = (raw: string): string => (raw.startsWith("_") ? "_" : "*");

/** 链接的写法：行内、引用式（含折叠 `[a][]` 与简写 `[a]`）、尖括号自动链接、裸网址。 */
function linkStyle(token: Tokens.Link): Record<string, unknown> {
    const raw = token.raw;
    if (raw.startsWith("<")) return {style: "angle"};
    if (!raw.startsWith("[") && !raw.startsWith("!")) return {style: "bare"};
    const body = raw.startsWith("!") ? raw.slice(1) : raw;
    const reference = /^\[(?:\\.|[^\]\\])*\](?:\[([^\]]*)\])?$/u.exec(body);
    if (reference !== null) {
        if (reference[1] === undefined) return {style: "shortcut"};
        return reference[1] === "" ? {style: "collapsed"} : {style: "reference", label: reference[1]};
    }
    return {style: "inline", angle: /\]\(\s*</u.test(body)};
}

const inlineReaders: Readonly<Record<string, TokenReader>> = {
    text: (token, context) => {
        const value = token as Tokens.Text;
        return value.tokens !== undefined && value.tokens.length > 0 ? context.inline(value.tokens) : readText(value.raw);
    },
    escape: (token) => [text((token as Tokens.Escape).text)],
    br: (token) => [{type: "hardBreak", attrs: {markdown: token.raw.startsWith("\\") ? "backslash" : "spaces"}}],
    strong: (token, context) => context.mark("bold", context.inline((token as Tokens.Strong).tokens), {markdown: emphasisMarker(token.raw).repeat(2)}),
    em: (token, context) => context.mark("italic", context.inline((token as Tokens.Em).tokens), {markdown: emphasisMarker(token.raw)}),
    del: (token, context) => context.mark("strike", context.inline((token as Tokens.Del).tokens), {markdown: "~~"}),
    codespan: (token, context) => {
        const ticks = /^`+/u.exec(token.raw)?.[0].length ?? 1;
        return context.mark("code", [text((token as Tokens.Codespan).text)], {markdown: ticks});
    },
    link: (token, context) => {
        const link = token as Tokens.Link;
        return context.mark("link", context.inline(link.tokens), {href: link.href, title: link.title ?? null, markdown: linkStyle(link)});
    },
    image: (token) => {
        const image = token as Tokens.Image & {tokens?: Token[]};
        const alt = image.tokens === undefined ? image.text : plainText(image.tokens);
        return [{type: "image", attrs: {src: image.href, alt, title: image.title ?? null, markdown: linkStyle(image as unknown as Tokens.Link)}}];
    },
    // 有序列表里的 `1. [ ] 事项` 不是任务项（输出 19）：复选框按文字读回。
    checkbox: (token) => [text(token.raw)],
    htmlMark: (token, context) => {
        const value = token as Tokens.Generic & {tag: string; tokens: Token[]};
        return context.mark(HTML_MARKS[value.tag] as string, context.inline(value.tokens), {markdown: value.raw.slice(1, 1 + value.tag.length)});
    },
    htmlBreak: () => [{type: "hardBreak", attrs: {markdown: "br"}}],
};

/** 标题的写法：`#` 式（含结尾的 `#`）或下划线式（`=`、`-`）。 */
function headingStyle(raw: string): Record<string, unknown> {
    const trimmed = raw.replace(/\n+$/u, "");
    if (/^ {0,3}#/u.test(trimmed)) {
        const closing = /[ \t]+(#+)[ \t]*$/u.exec(trimmed)?.[1];
        return closing === undefined ? {style: "atx"} : {style: "atx", closing};
    }
    return {style: "setext", char: trimmed.endsWith("=") ? "=" : "-"};
}

/**
 * 列表的写法：符号、有序分隔符与编号方式（全同一个数或按顺序）。松紧不记：编辑器里看不出差别，重新写出时只在一项里有几段时
 * 才写成松散列表。
 */
function listStyle(list: Tokens.List, items: ReadonlyArray<Tokens.ListItem>): Record<string, unknown> {
    const first = items[0]?.raw ?? "";
    if (!list.ordered) return {marker: /^\s*([-*+])/u.exec(first)?.[1] ?? "-"};
    const numbers = items.map((item) => Number(/^\s*(\d+)/u.exec(item.raw)?.[1] ?? "1"));
    const same = numbers.length > 1 && numbers.every((value) => value === numbers[0]);
    return {delimiter: /^\s*\d+([.)])/u.exec(first)?.[1] ?? ".", numbering: same ? "same" : "sequential"};
}

function readListItem(item: Tokens.ListItem, context: ReadContext): JSONContent[] {
    const content = context.blocks(item.tokens.filter((token) => token.type !== "checkbox"));
    return content.length > 0 ? content : [{type: "paragraph"}];
}

/**
 * 复选框后面没有文字的任务项（`- [ ]` 单独一行，例如刚建、还没写字的）：`marked` 不把它当任务项，项的第一个单元是文字 `[ ]`。
 * 返回复选框的字符，不是这种形态为 null。
 */
function emptyTaskBox(item: Tokens.ListItem): string | null {
    const first = item.tokens[0];
    if (first === undefined || (first.type !== "text" && first.type !== "paragraph")) return null;
    return /^\[([ xX])\][ \t]*$/u.exec(first.raw.split("\n")[0] ?? "")?.[1] ?? null;
}

/**
 * 任务项：复选框不是正文。紧凑列表里 `marked` 把它放在项的块层，松散列表里放进第一段的行内单元，两处都去掉。
 */
function readTaskItem(item: Tokens.ListItem, context: ReadContext): JSONContent[] {
    if (item.task !== true) {
        // `- [ ]` 后面没有文字：第一段为空，其余（下一行起的块）照常。
        const [first, ...rest] = item.tokens as [Tokens.Text, ...Token[]];
        // 第一个单元是 `[ ]` 那一行加上接着的几行文字：去掉 `[ ]` 那一行（它在行内单元里也是第一个文字单元的开头）。
        const box = /^\[[ xX]\][ \t]*(?:\n|$)/u;
        const inline = [...(first.tokens ?? [])];
        const head = inline[0];
        if (head?.type === "text") {
            const raw = head.raw.replace(box, "");
            if (raw === "") inline.shift();
            else inline[0] = {...head, raw, text: raw} as Token;
        }
        const tail = first.raw.replace(box, "").trim() === "" ? [] : context.blocks([{type: "paragraph", raw: first.raw.replace(box, ""), text: first.raw.replace(box, ""), tokens: inline} as Token]);
        return [{type: "paragraph"}, ...tail, ...context.blocks(rest)];
    }
    const [first, ...rest] = item.tokens.filter((token) => token.type !== "checkbox");
    if (first !== undefined && (first.type === "paragraph" || first.type === "text") && "tokens" in first && Array.isArray(first.tokens) && first.tokens[0]?.type === "checkbox") {
        const stripped = {...first, tokens: first.tokens.slice(1)} as Token;
        const content = context.blocks([stripped, ...rest]);
        return content.length > 0 ? content : [{type: "paragraph"}];
    }
    return readListItem(item, context);
}

/**
 * 有序列表里的 `1. [ ] 事项` 不是任务项（输出 19）：`marked` 仍把复选框拆成单独的单元，这里把它的文字放回第一段的开头。
 */
function readOrderedItem(item: Tokens.ListItem, context: ReadContext): JSONContent[] {
    const checkbox = item.tokens.find((token) => token.type === "checkbox");
    const content = readListItem(item, context);
    if (checkbox === undefined) return content;
    const [first, ...rest] = content;
    if (first?.type !== "paragraph") return [{type: "paragraph", content: [text(checkbox.raw)]}, ...content];
    return [{...first, content: [text(checkbox.raw), ...(first.content ?? [])]}, ...rest];
}

/** 列表：任务项与普通项混在一起时拆成相邻的任务列表与普通列表；有序列表里的任务项按文字读。 */
const readList: TokenReader = (token, context) => {
    const list = token as Tokens.List;
    if (list.ordered) {
        return [{
            type: "orderedList",
            attrs: {start: typeof list.start === "number" ? list.start : 1, markdown: listStyle(list, list.items)},
            content: list.items.map((item) => ({type: "listItem", content: readOrderedItem(item, context)})),
        }];
    }
    const groups: Array<{task: boolean; items: Tokens.ListItem[]}> = [];
    for (const item of list.items) {
        const task = item.task === true || emptyTaskBox(item) !== null;
        const last = groups.at(-1);
        if (last !== undefined && last.task === task) last.items.push(item);
        else groups.push({task, items: [item]});
    }
    return groups.map(({task, items}) => {
        if (!task) {
            return {type: "bulletList", attrs: {markdown: listStyle(list, items)}, content: items.map((item) => ({type: "listItem", content: readListItem(item, context)}))};
        }
        return {
            type: "taskList",
            content: items.map((item) => ({
                type: "taskItem",
                attrs: {checked: item.checked === true || /^[xX]$/u.test(emptyTaskBox(item) ?? ""), markdown: {marker: /^\s*([-*+])/u.exec(item.raw)?.[1] ?? "-", check: /\[([xX ])\]/u.exec(item.raw)?.[1] ?? " "}},
                content: readTaskItem(item, context),
            })),
        };
    });
};

const blockReaders: Readonly<Record<string, TokenReader>> = {
    html: (token) => {
        if (!isBreakOnlyHtml(token.raw)) return null;
        const count = token.raw.match(/<br/giu)?.length ?? 0;
        return [{type: "paragraph", content: Array.from({length: count}, () => ({type: "hardBreak", attrs: {markdown: "br"}}))}];
    },
    paragraph: (token, context) => [{type: "paragraph", content: context.inline((token as Tokens.Paragraph).tokens)}],
    heading: (token, context) => {
        const heading = token as Tokens.Heading;
        return [{type: "heading", attrs: {level: heading.depth, markdown: headingStyle(heading.raw)}, content: context.inline(heading.tokens)}];
    },
    blockquote: (token, context) => {
        const content = context.blocks((token as Tokens.Blockquote).tokens);
        return [{type: "blockquote", content: content.length > 0 ? content : [{type: "paragraph"}]}];
    },
    list: readList,
    code: (token) => {
        const code = token as Tokens.Code;
        const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(code.raw)?.[1];
        // 没闭合的围栏（读到文末）重新写出时总会补上闭合，所以不记它。
        const style = code.codeBlockStyle === "indented" || fence === undefined ? {indented: true} : {fence};
        return [{type: "codeBlock", attrs: {language: code.lang || null, markdown: style}, content: code.text === "" ? [] : [text(code.text)]}];
    },
    hr: (token) => [{type: "horizontalRule", attrs: {markdown: token.raw.trim()}}],
    table: (token, context) => {
        const table = token as Tokens.Table;
        // 某一行的单元格比表头多：GFM 丢掉多出的（包括行内代码里没转义的 `|` 切出来的），编辑器表达不了，整张表是原样块
        // （方言 Spec 输出 9），不然改过这张表，多出的字就从文件里没了。
        if (table.raw.split("\n").slice(2).some((line) => cellCount(line, context.atomSpans(line)) > table.header.length)) return [context.raw(token, false)];
        const cell = (type: string, value: Tokens.TableCell, align: string | null): JSONContent => ({type, attrs: {align}, content: [{type: "paragraph", content: context.inline(value.tokens)}]});
        return [{
            type: "table",
            content: [
                {type: "tableRow", content: table.header.map((value, index) => cell("tableHeader", value, table.align[index] ?? null))},
                ...table.rows.map((row) => ({type: "tableRow", content: row.map((value, index) => cell("tableCell", value, table.align[index] ?? null))})),
            ],
        }];
    },
    // 紧凑列表项里的文字（`marked` 在块层给 `text`）是一段。
    text: (token, context) => {
        const value = token as Tokens.Text;
        return [{type: "paragraph", content: value.tokens !== undefined && value.tokens.length > 0 ? context.inline(value.tokens) : readText(value.raw)}];
    },
};

/**
 * 表格一行的单元格数，按 GFM 的切法：没转义的 `|` 分隔，行首行尾的 `|` 不算。原子（`atoms`，按 `line` 里的位置）里的 `|` 不算：
 * 分词时原子换成了占位，`marked` 不在那里切。
 */
function cellCount(line: string, atoms: ReadonlyArray<{readonly from: number; readonly to: number}>): number {
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

/**
 * 页面上的链接元素保留哪些地址：Tiptap 默认只留 `http:` 这类常见方案与相对地址，别的写成空 `href`。作品里的文件
 * （`project://`）、用户资产、会话附件与旧应用的领域地址（`chapter://`）要留着，展示器按它画引用小块、交出点击的目标
 * （方言 Spec 输出 27）；能执行代码的方案照旧清掉。点击都由编辑器与展示器接管，不会自己跳转。只影响页面，写回用的是标记属性。
 */
const keepsHref = (url: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(url) && !/^(?:javascript|vbscript|data|file):/iu.test(url);

export const coreExtensions: ReadonlyArray<AnyExtension> = [
    StarterKit.configure({
        document: false,
        paragraph: false,
        link: false,
        code: false,
        // 没有下划线（输出 26）：`++` 是普通文字，Ctrl+U 不起作用。
        underline: false,
        trailingNode: false,
        // 列表由 `@tiptap/extension-list` 的同名扩展提供（与任务列表同一个包）。
    }),
    MarkdownDocument,
    MarkdownParagraph,
    MarkdownCode,
    TaskList,
    TaskItem.configure({nested: true}),
    // 展示器按 `renderHTML` 生成页面，要它也包一层 `tableWrapper`，宽表格才在自己里面横向滚动（编辑器的表格节点视图本来就包）。
    TableKit.configure({table: {renderWrapper: true}, tableCell: false, tableHeader: false}),
    SingleParagraphCell,
    SingleParagraphHeader,
    Image.configure({inline: true, allowBase64: false, HTMLAttributes: {class: "nb-markdown-image-node"}}),
    // 单击选中整条链接由编辑器的 `MarkdownLinkOpener` 做：Tiptap 自带的（`enableClickSelection`）在点击处理时读的是点击之前的选区，点到一条链接选中的是之前光标所在的那条。
    MarkdownLink.configure({openOnClick: false, enableClickSelection: false, linkOnPaste: false, autolink: false, isAllowedUri: (url, {defaultValidate}) => defaultValidate(url) || keepsHref(url)}),
    MarkdownStyle,
];

export const coreSyntax: MarkdownSyntax = {
    ...coreLexing,
    extensions: coreExtensions,
    read: blockReaders,
    readInline: inlineReaders,
    writeBlock: coreWriters.blocks,
    writeInline: coreWriters.inline,
    writeMark: coreWriters.marks,
    derivedAttrs: {tableCell: ["align"]},
    marklessInline: ["hardBreak"],
};
