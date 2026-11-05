import type {DefaultTreeAdapterMap} from "parse5";
import {cssReferences, scriptImports, srcsetUrls, type TextReference} from "./references.js";
import {controlCharProblem} from "./text-rules.js";

/**
 * 提问：题的定义、页面里的提问标记（`data-nbdev-*`）与答复取值的校验。格式见 docs/file-formats.md 的“提问标记”。
 * parse5 只在 `parseQuestionMarkup` 里按需导入：`status` 等读取路径不解析页面，不该为它多付加载时间。
 */

export const QUESTION_TYPES = ["single", "multi", "text", "confirm"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QuestionOption = {value: string; label: string};
export type QuestionDefinition = {id: string; type: QuestionType; label: string; options: QuestionOption[]; required: boolean; recommend: string[]};

/**
 * 之前几版的题：来自页面、已经答过、后来的页面里没有了。发新版时这种题留在题表里（`page` 记成 `null`，见 docs/file-formats.md
 * 的“新版本的题表”），只为答案还查得到；它不属于这一版，不再收答复，界面只读显示。`ask` 登记的题本来就不在页面里，不算。
 */
export function isEarlierPageQuestion(question: {origin: "markup" | "ask"; page: string | null}): boolean {
    return question.origin === "markup" && question.page === null;
}

/** 题号与选项值的写法；题意变了就换题号。 */
export const QUESTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
export const MAX_LABEL_LENGTH = 200;
export const MAX_OPTION_LABEL_LENGTH = 80;
export const MAX_TEXT_ANSWER_LENGTH = 10_000;
/** 审查报告的每条意见：改、不改、要讨论。 */
export const REVIEW_OPTIONS: readonly QuestionOption[] = [
    {value: "fix", label: "改"},
    {value: "skip", label: "不改"},
    {value: "discuss", label: "要讨论"},
];

/** 提问标记的属性名。前缀不用 `data-nb-`：nb-ui 已经用了十几种，从 Lab 存下来的静态稿会撞名。 */
export const MARKUP = {
    question: "data-nbdev-question",
    type: "data-nbdev-type",
    label: "data-nbdev-label",
    option: "data-nbdev-option",
    options: "data-nbdev-options",
    required: "data-nbdev-required",
    recommend: "data-nbdev-recommend",
    skip: "data-nbdev-skip",
} as const;

export type DefinitionProblem = {code: string; message: string};

function isQuestionType(value: unknown): value is QuestionType {
    return typeof value === "string" && (QUESTION_TYPES as readonly string[]).includes(value);
}

/** 校验一道题的定义（页面标记与 `nbdev ask` 共用）；返回全部问题，空数组表示合规。 */
export function validateQuestionDefinition(definition: {id: string; type: string; label: string; options: readonly QuestionOption[]; recommend: readonly string[]}): DefinitionProblem[] {
    const problems: DefinitionProblem[] = [];
    const add = (code: string, message: string) => problems.push({code, message});
    if (!QUESTION_ID_PATTERN.test(definition.id)) add("invalid_question_id", `题号只能用小写字母、数字与连字符，以字母或数字开头，最长 63 个字符：${definition.id}`);
    if (!isQuestionType(definition.type)) add("invalid_question_type", `题的类型只能是 ${QUESTION_TYPES.join("、")}：${definition.type}`);
    if (definition.label === "") add("label_missing", "题没有题目：写 data-nbdev-label，或在范围里放一个标题");
    else if (definition.label.length > MAX_LABEL_LENGTH) add("label_too_long", `题目超过 ${MAX_LABEL_LENGTH} 字，写一个简短的 data-nbdev-label`);
    const choice = definition.type === "single" || definition.type === "multi";
    if (choice && definition.options.length < 2) add("options_missing", `${definition.type} 题至少要两个选项`);
    if (!choice && definition.options.length > 0) add("options_not_allowed", `${definition.type} 题不能有选项`);
    const seen = new Set<string>();
    const labels = new Set<string>();
    for (const option of definition.options) {
        if (!QUESTION_ID_PATTERN.test(option.value)) add("invalid_option_value", `选项值只能用小写字母、数字与连字符：${option.value}`);
        if (seen.has(option.value)) add("duplicate_option", `选项值重复：${option.value}`);
        // 同名的选项在面板上分不清；选项名取自选项里的文字时，常常两个都取到“打开”这样的按钮字。
        else if (option.label !== "" && labels.has(option.label)) add("duplicate_option_label", `选项名重复：${option.label}；给选项写不同的 data-nbdev-label，按钮加 data-nbdev-skip`);
        seen.add(option.value);
        labels.add(option.label);
        if (option.label === "") add("option_label_missing", `选项 ${option.value} 没有名称`);
        else if (option.label.length > MAX_OPTION_LABEL_LENGTH) add("option_label_too_long", `选项 ${option.value} 的名称超过 ${MAX_OPTION_LABEL_LENGTH} 字，给它写 data-nbdev-label`);
    }
    for (const value of definition.recommend) {
        if (!choice || !seen.has(value)) add("invalid_recommend", `推荐的选项不在选项里：${value}`);
    }
    return problems;
}

/** 校验一个答复取值；合法返回 null，否则返回原因。`confirm` 的取值是布尔值。 */
export function validateAnswerValue(question: Pick<QuestionDefinition, "type" | "options">, value: unknown): string | null {
    const allowed = new Set(question.options.map((option) => option.value));
    switch (question.type) {
    case "single":
        return typeof value === "string" && allowed.has(value) ? null : `只能是选项之一：${[...allowed].join("、")}`;
    case "multi":
        if (!Array.isArray(value) || value.length === 0) return "要选至少一个选项";
        if (new Set(value).size !== value.length) return "选项重复";
        return value.every((entry) => typeof entry === "string" && allowed.has(entry)) ? null : `只能从选项里选：${[...allowed].join("、")}`;
    case "text":
        if (typeof value !== "string" || value.trim() === "") return "要填非空的文字";
        if (value.length > MAX_TEXT_ANSWER_LENGTH) return `文字超过 ${MAX_TEXT_ANSWER_LENGTH} 字`;
        return controlCharProblem(value, true);
    case "confirm":
        return typeof value === "boolean" ? null : "只能是 true 或 false";
    }
}

/** 解析 `data-nbdev-options` 的一行写法：`@review`，或 `值:名称|值:名称`（没有名称时名称就是值）。 */
export function parseOptionsShorthand(text: string): QuestionOption[] {
    if (text.trim() === "@review") return REVIEW_OPTIONS.map((option) => ({...option}));
    return text.split("|").map((part) => part.trim()).filter((part) => part !== "").map((part) => {
        const separator = part.indexOf(":");
        return separator < 0 ? {value: part, label: part} : {value: part.slice(0, separator).trim(), label: part.slice(separator + 1).trim()};
    });
}

export type MarkupQuestion = QuestionDefinition & {page: string; line: number | null};
export type MarkupProblem = {page: string; line: number | null; column: number | null; questionId: string | null; code: string; message: string};
export type MarkupReference = {page: string; line: number | null; target: string};
export type ParsedMarkup = {
    questions: MarkupQuestion[];
    /**
     * 页面引用的地址（原样，未归一化）：元素的 `src`、`href`、`poster`、`srcset`（脚本、样式、模板元素自己的也算，
     * `<template>` 的内容与 `<noscript>` 里的元素也算），内联 `<style>` 与 `style` 属性里的 `url(...)`、`@import`，
     * 内联 `<script type="module">` 里字面量的 import。
     */
    references: MarkupReference[];
    problems: MarkupProblem[];
    /** 内联 `<script>`、`<template>`、`<noscript>` 里写了提问标记（属性写法）：渲染出来的题解析不到。 */
    scriptMarkers: boolean;
    /** 页面的 `<title>`。 */
    title: string | null;
};

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const NON_TEXT = new Set(["script", "style", "template", "noscript"]);
/** 取文字时两边补空格的元素（块级与 `br`）；行内元素直接拼接，`用<code>nbdev</code>发布` 不能变成“用 nbdev 发布”。 */
const SPACED = new Set([
    "address", "article", "aside", "blockquote", "br", "caption", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);
/**
 * 脚本、模板与 `noscript` 里的提问标记只认属性写法（`data-nbdev-question=`）：脚本里按属性查询（`[data-nbdev-question]`）做页面增强是正常用法，
 * 不该报“渲染出来的题解析不到”。
 */
const MARKER_ATTRIBUTE = /data-nbdev-question\s*=/u;

/** 脚本文字（内联脚本或产物目录里的 `.js`、`.mjs`）里是否写了提问标记。 */
export function scriptWritesQuestionMarkup(text: string): boolean {
    return MARKER_ATTRIBUTE.test(text);
}
const REFERENCE_ATTRIBUTES = ["src", "href", "poster", "srcset"];

function isElement(node: Node): node is Element {
    return "tagName" in node;
}

function attribute(element: Element, name: string): string | null {
    return element.attrs.find((entry) => entry.name === name)?.value ?? null;
}

function hasAttribute(element: Element, name: string): boolean {
    return element.attrs.some((entry) => entry.name === name);
}

function collapse(text: string): string {
    return text.replace(/\s+/gu, " ").trim();
}

/** 元素的文字；跳过带 `data-nbdev-skip` 的元素与脚本、样式。调用方再把空白折叠成一个空格。 */
function textOf(node: Node): string {
    if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
    if (!isElement(node)) return "";
    if (hasAttribute(node, MARKUP.skip) || NON_TEXT.has(node.tagName)) return "";
    const inner = node.childNodes.map(textOf).join("");
    return SPACED.has(node.tagName) ? ` ${inner} ` : inner;
}

/** 范围内第一个标题；`skipOptions` 时不进入选项元素（题目不能取到选项里的标题）。 */
function firstHeading(element: Element, skipOptions: boolean): Element | null {
    for (const child of element.childNodes) {
        if (!isElement(child) || hasAttribute(child, MARKUP.skip) || NON_TEXT.has(child.tagName)) continue;
        if (skipOptions && hasAttribute(child, MARKUP.option)) continue;
        if (HEADINGS.has(child.tagName)) return child;
        const nested = firstHeading(child, skipOptions);
        if (nested) return nested;
    }
    return null;
}

function containsMarker(node: Node): boolean {
    if (node.nodeName === "#text") return scriptWritesQuestionMarkup((node as DefaultTreeAdapterMap["textNode"]).value);
    if (!isElement(node) || node.tagName === "style") return false;
    if (hasAttribute(node, MARKUP.question)) return true;
    const children = node.tagName === "template" ? (node as DefaultTreeAdapterMap["template"]).content.childNodes : node.childNodes;
    return children.some(containsMarker);
}

type QuestionScope = {element: Element; id: string; options: Array<{element: Element; value: string}>};

/**
 * 解析一个页面里的提问标记。不合规之处全部收进 `problems`（带页面与行列），调用方决定是否整体拒绝。
 * parse5 按规范补全 HTML：题的范围元素被隐式闭合时它不报错，只是 `endTag` 缺失，所以这里据此报 `question_not_closed`。
 */
export async function parseQuestionMarkup(html: string, page: string): Promise<ParsedMarkup> {
    const {parse, parseFragment} = await import("parse5");
    const document = parse(html, {sourceCodeLocationInfo: true});
    const result: ParsedMarkup = {questions: [], references: [], problems: [], scriptMarkers: false, title: null};
    const problem = (element: Element | null, questionId: string | null, code: string, message: string) => {
        result.problems.push({page, line: element?.sourceCodeLocation?.startLine ?? null, column: element?.sourceCodeLocation?.startCol ?? null, questionId, code, message});
    };
    const seenIds = new Set<string>();
    const reference = (target: string, line: number | null) => {
        if (target !== "") result.references.push({page, line, target});
    };
    /** `lineShift` 加在 parse5 给的行号上：`<noscript>` 的正文另行解析，那里的行号从正文开头算起。为 null 时不知道行号。 */
    const lineOf = (node: Node, lineShift: number | null) => {
        const line = node.sourceCodeLocation?.startLine;
        return line === undefined || lineShift === null ? null : line + lineShift;
    };
    const collectAttributes = (element: Element, lineShift: number | null) => {
        const line = lineOf(element, lineShift);
        for (const name of REFERENCE_ATTRIBUTES) {
            const value = attribute(element, name);
            if (value === null) continue;
            for (const target of name === "srcset" ? srcsetUrls(value) : [value.trim()]) reference(target, line);
        }
        const style = attribute(element, "style");
        if (style !== null) for (const {target} of cssReferences(style)) reference(target, line);
    };
    /** 内联样式、内联模块脚本的正文；行号从正文的第一行算起。 */
    const collectInline = (element: Element, extract: (text: string) => TextReference[], lineShift: number | null) => {
        const texts = element.childNodes.filter((child): child is DefaultTreeAdapterMap["textNode"] => child.nodeName === "#text");
        const firstLine = texts[0] ? lineOf(texts[0], lineShift) : lineOf(element, lineShift);
        for (const {target, lineOffset} of extract(texts.map((text) => text.value).join(""))) reference(target, firstLine === null ? null : firstLine + lineOffset);
    };
    /**
     * 资源引用的遍历，与找题的遍历分开：`<template>` 的内容与 `<noscript>` 里的元素不登记题（渲染出来的题解析不到），
     * 但写在里面的资源照样会被用到（模板被脚本克隆进页面，关掉脚本时显示 noscript），要进文件集。
     */
    const collectResources = (node: Node, lineShift: number | null) => {
        if (!isElement(node)) return;
        // 脚本、样式、模板元素自己的属性（`<script src>`、`<link href>`）照样是引用。
        collectAttributes(node, lineShift);
        if (node.tagName === "style") {
            collectInline(node, cssReferences, lineShift);
            return;
        }
        if (node.tagName === "script") {
            if (attribute(node, "src") === null && (attribute(node, "type") ?? "").trim().toLowerCase() === "module") collectInline(node, scriptImports, lineShift);
            return;
        }
        if (node.tagName === "template") {
            for (const child of (node as DefaultTreeAdapterMap["template"]).content.childNodes) collectResources(child, lineShift);
            return;
        }
        for (const child of node.childNodes) {
            // parse5 默认按开着脚本解析，`<noscript>` 的内容是一段文字；把它当 HTML 片段再解析一遍，取里面的元素。
            if (node.tagName === "noscript" && child.nodeName === "#text") {
                const textLine = lineOf(child, lineShift);
                const fragment = parseFragment((child as DefaultTreeAdapterMap["textNode"]).value, {sourceCodeLocationInfo: true});
                for (const inner of fragment.childNodes) collectResources(inner, textLine === null ? null : textLine - 1);
            } else collectResources(child, lineShift);
        }
    };

    const finishQuestion = (scope: QuestionScope) => {
        const {element, id} = scope;
        const type = attribute(element, MARKUP.type) ?? "";
        const explicitLabel = attribute(element, MARKUP.label);
        const heading = explicitLabel === null ? firstHeading(element, true) : null;
        const label = collapse(explicitLabel ?? (heading ? textOf(heading) : ""));
        const shorthand = attribute(element, MARKUP.options);
        if (shorthand !== null && scope.options.length > 0) problem(element, id, "options_conflict", `题 ${id} 同时用了 ${MARKUP.options} 与 ${MARKUP.option}，只能用一种`);
        const options = shorthand !== null ? parseOptionsShorthand(shorthand) : scope.options.map(({element: optionElement, value}) => {
            const optionLabel = attribute(optionElement, MARKUP.label);
            const optionHeading = optionLabel === null ? firstHeading(optionElement, false) : null;
            return {value, label: collapse(optionLabel ?? (optionHeading ? textOf(optionHeading) : textOf(optionElement)))};
        });
        const recommend = (attribute(element, MARKUP.recommend) ?? "").split(",").map((value) => value.trim()).filter((value) => value !== "");
        if (seenIds.has(id)) problem(element, id, "duplicate_question", `题号重复：${id}`);
        seenIds.add(id);
        for (const entry of validateQuestionDefinition({id, type, label, options, recommend})) problem(element, id, entry.code, `题 ${id}：${entry.message}`);
        if (isQuestionType(type)) {
            result.questions.push({id, type, label, options, required: hasAttribute(element, MARKUP.required), recommend, page, line: element.sourceCodeLocation?.startLine ?? null});
        }
    };

    const walk = (node: Node, scope: QuestionScope | null) => {
        if (!isElement(node)) return;
        if (node.tagName === "title" && result.title === null) result.title = collapse(textOf(node)) || null;
        // 不进入脚本、样式、模板与 noscript 找题；里面的资源由 collectResources 收。
        if (NON_TEXT.has(node.tagName)) {
            if (containsMarker(node)) result.scriptMarkers = true;
            return;
        }
        const questionId = attribute(node, MARKUP.question);
        if (questionId !== null) {
            if (scope) {
                problem(node, questionId, "nested_question", `题 ${questionId} 写在题 ${scope.id} 里面；题不能嵌套`);
            } else {
                if (node.sourceCodeLocation && !node.sourceCodeLocation.endTag) {
                    problem(node, questionId, "question_not_closed", `题 ${questionId} 的 <${node.tagName}> 没有显式的结束标签；HTML 会自动闭合它，范围可能比你写的小，补上 </${node.tagName}>`);
                }
                const own: QuestionScope = {element: node, id: questionId, options: []};
                for (const child of node.childNodes) walk(child, own);
                finishQuestion(own);
                return;
            }
        }
        const optionValue = attribute(node, MARKUP.option);
        if (optionValue !== null) {
            if (!scope) problem(node, null, "option_outside_question", `选项 ${optionValue} 不在任何题里；如果它看起来写在题里，多半是 HTML 自动闭合造成的（例如 <p> 里放了块级元素，<p> 被提前结束）`);
            else scope.options.push({element: node, value: optionValue});
        }
        for (const child of node.childNodes) walk(child, scope);
    };
    for (const child of document.childNodes) walk(child, null);
    for (const child of document.childNodes) collectResources(child, 0);
    return result;
}
