/**
 * Composer 的文字写法（docs/specs/ui/prompt-editor.md 的“输入与前置条件”与输出 1、2、5、7）：读入、写回、插入、编号、触发、
 * 粘贴分档。由旧应用的同名测试移植（分支 `archive/legacy-ui-tuning`，`865c9f593`），引用目标的识别按 Markdown 链接的规则
 * 改写，“Markdown 链接的写法”一组是新加的。
 */

import {describe, expect, it} from "bun:test";
import type {Token} from "marked";

import {findInlineLinks} from "../link-syntax";
import {defaultMarkdownLanguage as markdownLanguage} from "../language/syntax";

import {schemeTargets} from "../targets";
import type {MarkdownTargets} from "../targets";

import {
    DEFAULT_PASTE_POLICY,
    PROMPT_ATOM_CHAR,
    classifyPaste,
    countPromptLines,
    findCompletedWriting,
    findPromptTrigger,
    maxPromptNumbers,
    parsePromptInsertion,
    parsePromptText,
    promptNodeText,
    promptReferenceText,
    promptTokenFromAttrs,
    renumberInsertion,
    serializeFileToken,
    serializeImageToken,
    usedPromptNumbers,
    type PromptNodeJSON,
    type PromptTokenAttrs,
} from "./prompt-text";

const COMMANDS = ["plan", "compact"];
const IMAGE_TARGET = "workspace/.nbook/agent/attachments/sha256/ab/cdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const FILE_TARGET = "workspace/.nbook/agent/attachments/sha256/12/3456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

function tokensOf(doc: PromptNodeJSON): PromptTokenAttrs[] {
    const result: PromptTokenAttrs[] = [];
    const walk = (node: PromptNodeJSON): void => {
        if (node.type === "promptToken") {
            result.push(node.attrs as unknown as PromptTokenAttrs);
        }
        node.content?.forEach(walk);
    };
    walk(doc);
    return result;
}

describe("prompt-text 读入与写回", () => {
    const corpus = [
        "",
        "\n",
        "\n\n",
        "a\n",
        "\na",
        "普通的一句话",
        "第一行\n\n第三行\n",
        "看 [第一章](chapter://c1) 和 [设定](lorebook/world.md) 里的 $writer 与 ${long-skill}",
        "a$notskill (${skill}) [[manuscript/ch1.md#L3-L9]]",
        `/plan 先列大纲\n${serializeImageToken(1, IMAGE_TARGET)} 然后 ${serializeFileToken(1, "notes.pdf", FILE_TARGET)}`,
        `![旧图片](${IMAGE_TARGET})![image #3](${IMAGE_TARGET})`,
        "<paste id=\"2\">\nconst a = 1;\n\n</paste>",
        "开头\n<paste id=\"1\">\nx\n</paste>\n<paste id=\"2\">\ny\n</paste>\n\n结尾",
        "[paste #1] 说明\n<paste id=\"1\">\n内容\n</paste>",
        "[paste #4] 没有对应的粘贴块",
        "<paste id=\"1\">\n没有结束",
        "<paste id=\"01\">\n前导零不算\n</paste>",
        "```\n![代码里](x.png)\n```",
        "[跨\n行](chapter://c1)",
        "a\r\nb",
        "/unknown 不是命令",
        " /plan 前面有空格",
        "[file #1 · a.txt](workspace/x) [file #2 · 名称](not a target)",
        "会话附件：![image #1](session://attachments/草图.png) 与 [file #2 · 采访记录.pdf](session://attachments/采访记录.pdf)",
        "看，$reviewer、${long-skill}。用$writer 不算",
    ];

    it.each(corpus)("逐字往返：%j", (text) => {
        expect(promptNodeText(parsePromptText(text, {commands: COMMANDS}))).toBe(text);
    });

    it("空文字与只有换行的文字是空段落", () => {
        expect(parsePromptText("", {commands: []})).toEqual({type: "doc", content: [{type: "paragraph"}]});
        expect(parsePromptText("\n", {commands: []}).content).toHaveLength(2);
    });

    it("识别各类标签，raw 保持原文", () => {
        const text = `/plan [第一章](chapter://c1) $writer [[a.md#L1-L2]] ${serializeImageToken(2, IMAGE_TARGET)} ${serializeFileToken(5, "a.pdf", FILE_TARGET)}`;
        const tokens = tokensOf(parsePromptText(text, {commands: COMMANDS}));
        expect(tokens.map((token) => token.kind)).toEqual(["command", "reference", "skill", "selection", "image", "file"]);
        expect(tokens[0]).toMatchObject({label: "plan", raw: "/plan"});
        expect(tokens[1]).toMatchObject({label: "第一章", target: "chapter://c1"});
        expect(tokens[2]).toMatchObject({label: "writer"});
        expect(tokens[4]).toMatchObject({number: 2, target: IMAGE_TARGET});
        expect(tokens[5]).toMatchObject({number: 5, label: "a.pdf", target: FILE_TARGET});
    });

    it("图片写法是 ![image #N](目标)", () => {
        expect(serializeImageToken(3, IMAGE_TARGET)).toBe(`![image #3](${IMAGE_TARGET})`);
        expect(serializeImageToken(1, "session://attachments/草图.png")).toBe("![image #1](session://attachments/草图.png)");
    });

    it("会话附件的图片与文件识别为标签", () => {
        const tokens = tokensOf(parsePromptText("![image #1](session://attachments/草图.png) [file #2 · 采访记录.pdf](session://attachments/采访记录.pdf)", {commands: []}));
        expect(tokens.map((token) => [token.kind, token.number, token.target])).toEqual([["image", 1, "session://attachments/草图.png"], ["file", 2, "session://attachments/采访记录.pdf"]]);
    });

    it("技能写法前面可以是中文标点，不能是文字", () => {
        expect(tokensOf(parsePromptText("看，$reviewer。（$writer）", {commands: []})).map((token) => token.label)).toEqual(["reviewer", "writer"]);
        expect(tokensOf(parsePromptText("用$writer", {commands: []}))).toEqual([]);
    });

    it("文件写法先于工作区引用识别", () => {
        const [token] = tokensOf(parsePromptText(serializeFileToken(1, "a.txt", FILE_TARGET), {commands: []}));
        expect(token?.kind).toBe("file");
    });

    it("文件名里的方括号与换行写回时被替换", () => {
        expect(serializeFileToken(1, "a [b]\nc.txt", FILE_TARGET)).toBe(`[file #1 · a (b) c.txt](${FILE_TARGET})`);
    });

    it("命令只在正文开头且在命令表里", () => {
        expect(tokensOf(parsePromptText("/plan x", {commands: COMMANDS})).map((token) => token.kind)).toEqual(["command"]);
        expect(tokensOf(parsePromptText("/plan x", {commands: []}))).toEqual([]);
        expect(tokensOf(parsePromptText("x /plan", {commands: COMMANDS}))).toEqual([]);
        expect(tokensOf(parsePromptText("/planx", {commands: COMMANDS}))).toEqual([]);
        expect(tokensOf(parsePromptText("<paste id=\"1\">\nx\n</paste>\n/plan", {commands: COMMANDS}))).toEqual([]);
    });

    it("位置标记只在有同号粘贴块时识别", () => {
        expect(tokensOf(parsePromptText("[paste #1]\n<paste id=\"1\">\nx\n</paste>", {commands: []})).map((token) => token.kind)).toEqual(["paste"]);
        expect(tokensOf(parsePromptText("[paste #2]\n<paste id=\"1\">\nx\n</paste>", {commands: []}))).toEqual([]);
    });

    it("技能写法前面必须是开头、空白或括号，位置标记与文件标签后面的不算", () => {
        expect(tokensOf(parsePromptText("a$b", {commands: []}))).toEqual([]);
        expect(tokensOf(parsePromptText(`${serializeFileToken(1, "a", FILE_TARGET)}$b`, {commands: []})).map((token) => token.kind)).toEqual(["file"]);
    });

    it("粘贴块切出整行，内容原样保留", () => {
        const doc = parsePromptText("前\n<paste id=\"7\">\n  缩进\n\n</paste>\n后", {commands: []});
        expect(doc.content?.map((node) => node.type)).toEqual(["paragraph", "pasteBlock", "paragraph"]);
        expect(doc.content?.[1]?.attrs).toEqual({number: 7, content: "  缩进\n"});
    });

    it("没有编号的旧图片接着已有的最大号编号", () => {
        const text = `![a](${IMAGE_TARGET}) ![image #4](${IMAGE_TARGET}) ![b](${IMAGE_TARGET})`;
        expect(tokensOf(parsePromptText(text, {commands: []})).map((token) => token.number)).toEqual([5, 4, 6]);
    });

    it("跨行的写法退回文字", () => {
        expect(tokensOf(parsePromptText("[跨\n行](chapter://c1)", {commands: []}))).toEqual([]);
    });
});

describe("prompt-text Markdown 链接的写法", () => {
    const one = (text: string): PromptTokenAttrs | undefined => {
        const tokens = tokensOf(parsePromptText(text, {commands: []}));
        expect(tokens.length).toBeLessThanOrEqual(1);
        return tokens[0];
    };

    it("目标按 Markdown 链接读：尖括号里可以有空格，括号配对时可以不加尖括号，可以带标题", () => {
        expect(one("[林雪](</设定/林 雪.md>)")).toMatchObject({kind: "reference", label: "林雪", target: "/设定/林 雪.md"});
        expect(one("[注](/资料/a(1).md)")).toMatchObject({target: "/资料/a(1).md"});
        expect(one("[林雪](/设定/林雪.md \"人物\")")).toMatchObject({target: "/设定/林雪.md", raw: "[林雪](/设定/林雪.md \"人物\")"});
    });

    it("不是链接的写法照常是文字：目标里有空格、转义的方括号、没有文字或目标", () => {
        for (const text of ["[a](b c)", "\\[a\\](b.md)", "[](b.md)", "[a]()", "[a] (b.md)"]) expect(one(text)).toBeUndefined();
    });

    it("作品里的文件、用户资产、外部链接与旧应用的领域地址都是引用小块，原文不变", () => {
        const text = "[甲](/设定/甲.md) [乙](user://b.md) [丙](https://example.com) [丁](chapter://c1)";
        expect(tokensOf(parsePromptText(text, {commands: []})).map((token) => [token.kind, token.target])).toEqual([["reference", "/设定/甲.md"], ["reference", "user://b.md"], ["reference", "https://example.com"], ["reference", "chapter://c1"]]);
        expect(promptNodeText(parsePromptText(text, {commands: []}))).toBe(text);
    });

    it("链接里的 `$` 不是技能", () => {
        expect(one("[$writer](/a.md)")).toMatchObject({kind: "reference", label: "$writer"});
    });

    it("场景 4：`@` 菜单插入的引用是以 `/` 开头的作品根地址；含空格时加尖括号；文字里的方括号转义", () => {
        expect(promptReferenceText("林雪", "/设定/林雪.md", schemeTargets)).toBe("[林雪](/设定/林雪.md)");
        expect(promptReferenceText("林 雪", "/设定/林 雪.md", schemeTargets)).toBe("[林 雪](</设定/林 雪.md>)");
        expect(one(promptReferenceText("a[1]", "/a.md", schemeTargets))).toMatchObject({kind: "reference", label: "a[1]", target: "/a.md"});
    });
});

describe("prompt-text 插入", () => {
    const base = {commands: COMMANDS, before: "", after: "", firstLine: false, structure: false};

    it("单行插入是一个段落", () => {
        expect(parsePromptInsertion("hi $skill", base)).toEqual([
            {type: "paragraph", content: [{type: "text", text: "hi "}, expect.objectContaining({type: "promptToken"})]},
        ]);
    });

    it("左边是非空白时技能写法保持文字", () => {
        expect(tokensOf({type: "doc", content: parsePromptInsertion("$skill", {...base, before: "abc"})})).toEqual([]);
        expect(tokensOf({type: "doc", content: parsePromptInsertion("$skill", {...base, before: "abc "})})).toHaveLength(1);
    });

    it("与右边原文连成一体的写法保持文字", () => {
        expect(tokensOf({type: "doc", content: parsePromptInsertion("$ski", {...base, after: "ll"})})).toEqual([]);
        expect(tokensOf({type: "doc", content: parsePromptInsertion("$ski", {...base, after: " ll"})})).toHaveLength(1);
    });

    it("命令只在第一行开头", () => {
        expect(tokensOf({type: "doc", content: parsePromptInsertion("/plan ", {...base, firstLine: true})})).toHaveLength(1);
        expect(tokensOf({type: "doc", content: parsePromptInsertion("/plan ", base)})).toEqual([]);
        expect(tokensOf({type: "doc", content: parsePromptInsertion("/plan ", {...base, firstLine: true, before: "x"})})).toEqual([]);
    });

    it("外部文字不识别粘贴块与位置标记", () => {
        const text = "[paste #1]\n<paste id=\"1\">\nx\n</paste>";
        const blocks = parsePromptInsertion(text, base);
        expect(blocks.every((block) => block.type === "paragraph")).toBe(true);
        expect(tokensOf({type: "doc", content: blocks})).toEqual([]);
    });

    it("结构模式识别粘贴块与位置标记，写回与原文相同", () => {
        const text = "[paste #1] a\n<paste id=\"1\">\nx\n</paste>\nb";
        const blocks = parsePromptInsertion(text, {...base, structure: true});
        expect(blocks.map((block) => block.type)).toEqual(["paragraph", "pasteBlock", "paragraph"]);
        expect(promptNodeText({type: "doc", content: blocks})).toBe(text);
    });
});

describe("prompt-text 编号", () => {
    const image = (number: number): PromptNodeJSON => ({type: "promptToken", attrs: {kind: "image", raw: serializeImageToken(number, IMAGE_TARGET), number, label: `image #${number}`, target: IMAGE_TARGET}});
    const paste = (number: number): PromptNodeJSON => ({type: "pasteBlock", attrs: {number, content: "x"}});
    const marker = (number: number): PromptNodeJSON => ({type: "promptToken", attrs: {kind: "paste", raw: `[paste #${number}]`, number, label: "", target: ""}});

    it("两套编号分开统计", () => {
        const nodes = [{type: "paragraph", content: [image(2)]}, paste(5), {type: "pendingAttachment", attrs: {localId: "l", kind: "file", name: "a", number: 6}}];
        expect(maxPromptNumbers(nodes)).toEqual({image: 2, file: 6});
        expect([...usedPromptNumbers(nodes).file]).toEqual([5, 6]);
    });

    it("撞号的副本换新号并改写原文，粘贴块与位置标记一起换", () => {
        const inserted = [{type: "paragraph", content: [image(1), marker(2)]}, paste(2)];
        const result = renumberInsertion(inserted, {image: new Set([1]), file: new Set([2])}, {image: 3, file: 2});
        const [paragraph, block] = result.nodes;
        expect(paragraph?.content?.[0]?.attrs).toMatchObject({number: 4, raw: serializeImageToken(4, IMAGE_TARGET), label: "image #4"});
        expect(paragraph?.content?.[1]?.attrs).toMatchObject({number: 3, raw: "[paste #3]"});
        expect(block?.attrs).toEqual({number: 3, content: "x"});
        expect(result.highWater).toEqual({image: 4, file: 3});
    });

    it("没撞号的保留，新号避开插入内容自带的号", () => {
        const inserted = [{type: "paragraph", content: [image(9), image(1)]}];
        const result = renumberInsertion(inserted, {image: new Set([1]), file: new Set()}, {image: 1, file: 0});
        expect(result.nodes[0]?.content?.map((node) => node.attrs?.number)).toEqual([9, 10]);
    });

    it("旧图片补号但原文不变", () => {
        const legacy: PromptNodeJSON = {type: "promptToken", attrs: {kind: "image", raw: `![a](${IMAGE_TARGET})`, number: null, label: "a", target: IMAGE_TARGET}};
        const result = renumberInsertion([{type: "paragraph", content: [legacy]}], {image: new Set(), file: new Set()}, {image: 2, file: 0});
        expect(result.nodes[0]?.content?.[0]?.attrs).toMatchObject({number: 3, raw: `![a](${IMAGE_TARGET})`});
    });

    it("文件标签换号时文件名保留", () => {
        const file: PromptNodeJSON = {type: "promptToken", attrs: {kind: "file", raw: serializeFileToken(1, "a.pdf", FILE_TARGET), number: 1, label: "a.pdf", target: FILE_TARGET}};
        const result = renumberInsertion([{type: "paragraph", content: [file]}], {image: new Set(), file: new Set([1])}, {image: 0, file: 1});
        expect(result.nodes[0]?.content?.[0]?.attrs).toMatchObject({number: 2, raw: serializeFileToken(2, "a.pdf", FILE_TARGET)});
    });
});

describe("prompt-text 触发匹配", () => {
    const triggers = ["@", "$", "/"];

    it.each([
        ["@", {trigger: "@", query: "", offset: 0}],
        ["看 @章", {trigger: "@", query: "章", offset: 2}],
        ["(@chapter://c", {trigger: "@", query: "chapter://c", offset: 1}],
        ["/pl", {trigger: "/", query: "pl", offset: 0}],
        ["a $sk", {trigger: "$", query: "sk", offset: 2}],
        ["看，@章", {trigger: "@", query: "章", offset: 2}],
    ])("%j 构成触发", (before, expected) => {
        expect(findPromptTrigger(before, triggers)).toEqual(expected);
    });

    it.each([
        "a@b",
        "@a b",
        `${PROMPT_ATOM_CHAR}@a`,
        `@a${PROMPT_ATOM_CHAR}`,
        "",
        "plain",
    ])("%j 不构成触发", (before) => {
        expect(findPromptTrigger(before, triggers)).toBeNull();
    });

    it("没有触发字符时永不触发", () => {
        expect(findPromptTrigger("@a", [])).toBeNull();
    });
});

describe("prompt-text 粘贴分档", () => {
    const lines = (count: number): string => Array.from({length: count}, (_, index) => `line ${index}`).join("\n");

    it("按行数与字符数分三档", () => {
        expect(classifyPaste(lines(10), DEFAULT_PASTE_POLICY, true)).toBe("inline");
        expect(classifyPaste(`${lines(10)}\n`, DEFAULT_PASTE_POLICY, true)).toBe("inline");
        expect(classifyPaste(lines(11), DEFAULT_PASTE_POLICY, true)).toBe("block");
        expect(classifyPaste("x".repeat(1001), DEFAULT_PASTE_POLICY, true)).toBe("block");
        expect(classifyPaste(lines(100), DEFAULT_PASTE_POLICY, true)).toBe("attach");
        expect(classifyPaste("x".repeat(20000), DEFAULT_PASTE_POLICY, true)).toBe("attach");
    });

    it("不接受文件时大段按中等处理", () => {
        expect(classifyPaste(lines(100), DEFAULT_PASTE_POLICY, false)).toBe("block");
    });

    it("含结束标签整行的文字放不进粘贴块", () => {
        const text = `${lines(11)}\n</paste>`;
        expect(classifyPaste(text, DEFAULT_PASTE_POLICY, true)).toBe("attach");
        expect(classifyPaste(text, DEFAULT_PASTE_POLICY, false)).toBe("inline");
        expect(classifyPaste(`${lines(11)}\na</paste>`, DEFAULT_PASTE_POLICY, false)).toBe("block");
    });

    it("行数不计末尾换行", () => {
        expect(countPromptLines("")).toBe(0);
        expect(countPromptLines("a\n")).toBe(1);
        expect(countPromptLines("a\n\n")).toBe(2);
    });
});

describe("prompt-text 写完的写法", () => {
    const options = {commands: COMMANDS, firstLine: true};

    it("技能写法在后面打了空白或标点时写完，还在打名称时没写完", () => {
        expect(findCompletedWriting("$reviewer ", 9, 10, options)).toMatchObject({start: 0, end: 9, attrs: {kind: "skill", label: "reviewer"}});
        expect(findCompletedWriting("看，$reviewer，", 11, 12, options)).toMatchObject({start: 2, end: 11});
        expect(findCompletedWriting("$reviewer", 8, 9, options)).toBeNull();
    });

    it("以括号收尾的写法在打出收尾括号时写完", () => {
        expect(findCompletedWriting("看 [第一章](chapter://c1)", 20, 21, options)).toMatchObject({start: 2, end: 21, attrs: {kind: "reference"}});
        expect(findCompletedWriting("${long-skill}", 12, 13, options)).toMatchObject({attrs: {kind: "skill", label: "long-skill"}});
    });

    it("开头的命令在后面打空白时写完，只认命令表与第一行", () => {
        expect(findCompletedWriting("/plan ", 5, 6, options)).toMatchObject({attrs: {kind: "command"}});
        expect(findCompletedWriting("/plan ", 5, 6, {...options, firstLine: false})).toBeNull();
        expect(findCompletedWriting("/nope ", 5, 6, options)).toBeNull();
    });

    it("含行内标签或整个落在输入里的写法不算", () => {
        expect(findCompletedWriting(`[a${PROMPT_ATOM_CHAR}b](chapter://c1)`, 18, 19, options)).toBeNull();
        expect(findCompletedWriting("$ab ", 0, 4, options)).toBeNull();
    });
});

describe("prompt-text 点击标签", () => {
    it("选区带行号，没有行号时为 null", () => {
        expect(promptTokenFromAttrs({kind: "selection", raw: "[[a.md#L3-L9]]", number: null, label: "a.md#L3-L9", target: "a.md"}))
            .toEqual({kind: "selection", path: "a.md", startLine: 3, endLine: 9});
        expect(promptTokenFromAttrs({kind: "selection", raw: "[[a.md]]", number: null, label: "a.md", target: "a.md"}))
            .toEqual({kind: "selection", path: "a.md", startLine: null, endLine: null});
    });
});

describe("prompt-text 链接与代码", () => {
    const tokens = (text: string): Array<[string, string]> => tokensOf(parsePromptText(text, {commands: []})).map((token) => [token.kind, token.raw]);

    /** 编解码器用的 `marked` 是否把这段文字（整段）读出一个链接或图片。 */
    function markedSeesLink(text: string): boolean {
        const has = (list: ReadonlyArray<Token>): boolean => list.some((token) => token.type === "link" || token.type === "image" || has(("tokens" in token && Array.isArray(token.tokens) ? token.tokens : []) as Token[]));
        return has(markdownLanguage().lexer().lex(text));
    }

    it.each([
        ["[a](b.md)", true],
        ["[`a]b`](x.md)", true],
        ["[x](a\\ b)", false],
        ["`[a](b.md)`", false],
        ["[a](设定/林　雪.md)", true],
        ["[a](设定/林\u00a0雪.md)", true],
        ["[a](b c)", false],
        ["\\[a](b.md)", false],
        ["[a](<b c.md>)", true],
        ["[a](b(c).md)", true],
        ["[a](b.md \"t\")", true],
        ["[![图](a.png)](b.md)", true],
    ] as const)("与编解码器对 %j 是不是链接的判断一致", (text, expected) => {
        expect(markedSeesLink(text)).toBe(expected);
        expect(findInlineLinks(text).length > 0).toBe(expected);
    });

    it("反斜杠只转义 ASCII 标点：转义后的换行不让写法跨行", () => {
        const text = "[a](<b\\\nc>)";
        expect(tokens(text)).toEqual([]);
        expect(promptNodeText(parsePromptText(text, {commands: []}))).toBe(text);
    });

    it("代码片段与围栏代码块里的写法都是文字（不生出图片附件与引用），原样写回", () => {
        expect(tokens("用 `![logo](/资料/logo.png)` 这种写法")).toEqual([]);
        const fenced = "看这段：\n```ts\nconst img = \"![x](a.png)\";\nhandlers[key](event) $writer\n```\n然后 $writer";
        expect(tokens(fenced)).toEqual([["skill", "$writer"]]);
        expect(promptNodeText(parsePromptText(fenced, {commands: []}))).toBe(fenced);
    });

    it("不带方案的相对地址不是引用（代码里的 `handlers[key](event)`），旧应用的工作区路径与带方案的旧地址照常是", () => {
        expect(tokens("handlers[key](event) 与 arr[0](x)")).toEqual([]);
        expect(tokens("[设定](lorebook/world.md) [旧](chapter://c1) [根](/设定/a.md)").map(([kind]) => kind)).toEqual(["reference", "reference", "reference"]);
    });

    it("场景 4：`promptReferenceText` 按宿主的 `encodeFile` 写地址，写出的引用读回的地址就是它；不认文件方案的宿主原样写", () => {
        const targets: MarkdownTargets = {classify: () => ({kind: "file", name: ""}), encodeFile: (target) => target.replace(/#/gu, "%23")};
        const [token] = tokensOf(parsePromptText(promptReferenceText("名", "/设定/第1章#草稿.md", targets), {commands: []}));
        expect(token?.target).toBe("/设定/第1章%23草稿.md");
        expect(promptReferenceText("名", "/设定/a#b.md", schemeTargets)).toBe("[名](/设定/a#b.md)");
    });

    it("没闭合的方括号、反引号与引号很多时仍是线性的（几万字的草稿每打一个字都要重新识别一行）", () => {
        for (const unit of ["[a", "[[a", "`a ", "[a](b \"", "[a](<b "]) {
            const text = unit.repeat(Math.ceil(120_000 / unit.length));
            const started = performance.now();
            parsePromptText(text, {commands: []});
            expect(performance.now() - started).toBeLessThan(2000);
        }
    });
});

describe("prompt-text 选区写法沿用旧版", () => {
    const selection = (text: string) => tokensOf(parsePromptText(text, {commands: []})).filter((token) => token.kind === "selection").map((token) => promptTokenFromAttrs(token));

    it("短写法、行号前小写的 `l`、开头的 `./` 与旧版读出同样的路径与行号；行号 0 不算范围", () => {
        expect(selection("看 manuscript/ch1.md#L3-L9。")).toEqual([{kind: "selection", path: "manuscript/ch1.md", startLine: 3, endLine: 9}]);
        expect(selection("[[manuscript/ch1.md#l3-l9]]")).toEqual([{kind: "selection", path: "manuscript/ch1.md", startLine: 3, endLine: 9}]);
        expect(selection("[[./manuscript/ch1.md#L3]]")).toEqual([{kind: "selection", path: "manuscript/ch1.md", startLine: 3, endLine: 3}]);
        expect(selection("[[a.md#L0]]")).toEqual([{kind: "selection", path: "a.md", startLine: null, endLine: null}]);
    });

    it("像网址的、绝对路径、带 `..` 的不是选区", () => {
        for (const text of ["example.com/a.md#1-2", "https://x.com/a.md#1-2", "[[/etc/a.md#L1]]", "[[a/../b.md#L1]]", "词abc/def.md#1"]) expect(selection(text)).toEqual([]);
    });

    it("链接的地址里的短写法属于链接；方括号写法的选区后面跟着括号时仍是选区", () => {
        expect(tokensOf(parsePromptText("[a](manuscript/ch1.md#1-2)", {commands: []})).map((token) => token.kind)).toEqual(["reference"]);
        expect(tokensOf(parsePromptText("[[a.md#L1]](b.md)", {commands: []})).map((token) => token.kind)).toEqual(["selection"]);
    });
});