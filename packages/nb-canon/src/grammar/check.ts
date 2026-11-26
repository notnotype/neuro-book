/**
 * 写入时的检查（docs/specs/canon/rendering.md 输出 1、19）：白名单里的 Markdown、内置标签的名字与属性、式子与地址。只看原文本身；
 * “没登记的标签在这个条目的主文字里已经有了”这条例外要看条目，由调用方用问题里的标签序号判断（`unknown-tag` 带 `excusable`）。
 */

import {isBreakOnlyHtml} from "@notnotype/nb-markdown/marked";
import type {Token} from "marked";

import {hasField, parseAddress, parseExpression} from "./expression";
import {childLists, type EntryTag, type GrammarProblem, type ParsedEntryText} from "./parse";

export interface CheckOptions {
    /** 登记的标签名（属性表在 t04 加）：这些名字的活的标签放行，写坏的报 `tag-malformed`。 */
    readonly registered?: ReadonlySet<string>;
}

/** 一处问题；`excusable` 的是没登记的标签，条目当前的主文字里已有规范写法相同的这个标签时放行（输出 19）。 */
export interface CheckProblem extends GrammarProblem {
    readonly excusable?: true;
}

export const BUILTIN_TAGS: ReadonlySet<string> = new Set(["V", "If", "ElseIf", "Else", "Ref", "Image"]);

/** 内置标签可写的属性；`decorations` 是程序加的（输出 9），写进源文拒收。 */
const RULES: Readonly<Record<string, {readonly attributes: ReadonlySet<string>; readonly decorations: ReadonlySet<string>}>> = {
    V: {attributes: new Set(["of", "entry", "expr"]), decorations: new Set(["label", "incomplete", "unavailable"])},
    If: {attributes: new Set(["test"]), decorations: new Set(["value"])},
    ElseIf: {attributes: new Set(["test"]), decorations: new Set(["value"])},
    Else: {attributes: new Set(), decorations: new Set()},
    Ref: {attributes: new Set(["id"]), decorations: new Set(["name"])},
    Image: {attributes: new Set(["src", "of", "alt"]), decorations: new Set(["path"])},
};

/** 放行的词法单元（核心语法读写的全部写法加条目标签）；以后加进语言、不在名单里的单元拒收。 */
const ALLOWED_TOKENS: ReadonlySet<string> = new Set([
    "paragraph", "heading", "list", "list_item", "checkbox", "blockquote", "code", "codespan", "hr", "table", "strong", "em", "del",
    "link", "image", "def", "escape", "text", "space", "br", "htmlMark", "htmlBreak", "entryTag", "entryIf",
]);

/**
 * 白名单以外的单元与它们在原文里的起点：顶层按 `raw` 依次累加（拼起来等于原文），里层在外层的起点之后找自己的 `raw`，找不到就用
 * 外层的起点（尽力而为：列表、引用去了前缀的行找不到）。条件的单元在 `tokens` 与 `branches` 里各出现一次，按单元去重。
 */
function unsupportedTokens(parsed: ParsedEntryText): Array<{token: Token; offset: number}> {
    const found: Array<{token: Token; offset: number}> = [];
    const seen = new Set<Token>();
    const visit = (tokens: readonly Token[], from: number, top: boolean): void => {
        let cursor = from;
        for (const token of tokens) {
            const at = top ? cursor : parsed.source.indexOf(token.raw, cursor);
            const offset = at < 0 ? cursor : at;
            if (!seen.has(token) && !ALLOWED_TOKENS.has(token.type) && !(token.type === "html" && isBreakOnlyHtml(token.raw))) found.push({token, offset});
            seen.add(token);
            for (const child of childLists(token)) visit(child, offset, false);
            if (at >= 0) cursor = offset + token.raw.length;
        }
    };
    visit(parsed.tokens, 0, true);
    return found;
}

/** 一个活的标签的问题（名字、种类、属性、式子）。 */
function tagProblems(tag: EntryTag, registered: ReadonlySet<string>): CheckProblem[] {
    const at = (code: CheckProblem["code"], message: string, offset = tag.start): CheckProblem => ({code, offset, message, tag: tag.index});
    const rule = RULES[tag.name];
    if (rule === undefined) {
        if (registered.has(tag.name)) return tag.kind === "self" ? [] : [at("unknown-tag", `<${tag.name}> must be self-closing`)];
        return [{...at("unknown-tag", `<${tag.name}> is not a known tag; it needs its plugin`), excusable: true}];
    }
    const conditional = tag.name === "If";
    if (conditional ? tag.kind !== "open" && tag.kind !== "close" : tag.kind !== "self") {
        if (tag.kind === "paired") return [at("unknown-tag", `<${tag.name}> takes no content; values are added by the program and removed when written`)];
        return [at("unknown-tag", conditional ? "<If> wraps its branches: <If test=\"…\">…</If>" : `<${tag.name}> must be self-closing: <${tag.name} … />`)];
    }
    if (tag.kind === "close") return [];
    const problems: CheckProblem[] = [];
    const seen = new Set<string>();
    for (const attribute of tag.attributes) {
        if (seen.has(attribute.name)) problems.push(at("unknown-tag", `attribute ${attribute.name} is written twice`));
        seen.add(attribute.name);
        if (rule.decorations.has(attribute.name)) problems.push(at("unknown-tag", `attribute ${attribute.name} is added by the program when read; leave it out`));
        else if (!rule.attributes.has(attribute.name)) problems.push(at("unknown-tag", `attribute ${attribute.name} is not allowed on <${tag.name}>`));
    }
    if (problems.length > 0) return problems;
    const value = (name: string) => tag.attributes.find((attribute) => attribute.name === name);
    const expressionAt = (name: string, needsField: boolean): void => {
        const attribute = value(name);
        if (attribute === undefined) return;
        const parsed = parseExpression(attribute.value);
        if (!parsed.ok) problems.push(at("forbidden-syntax", parsed.error.message, attribute.valueStart + parsed.error.offset));
        else if (needsField && !hasField(parsed.expression)) problems.push(at("no-field-expression", "expr references no field; write plain numbers and words as text", attribute.valueStart));
    };
    const addressAt = (name: string): void => {
        const attribute = value(name);
        if (attribute === undefined) return;
        const parsed = parseAddress(attribute.value);
        if (!parsed.ok) problems.push(at("forbidden-syntax", parsed.error.message, attribute.valueStart + parsed.error.offset));
    };
    const nonEmpty = (name: string): void => {
        const attribute = value(name);
        if (attribute !== undefined && attribute.value.trim() === "") problems.push(at("unknown-tag", `${name} must not be empty`, attribute.valueStart));
    };
    switch (tag.name) {
        case "V":
            if ((value("of") === undefined) === (value("expr") === undefined)) problems.push(at("unknown-tag", "<V> takes either of=\"address\" or expr=\"…\""));
            else if (value("entry") !== undefined && value("of") === undefined) problems.push(at("unknown-tag", "entry goes with of: <V entry=\"…\" of=\"…\" />"));
            nonEmpty("entry");
            addressAt("of");
            expressionAt("expr", true);
            break;
        case "If":
        case "ElseIf":
            if (value("test") === undefined) problems.push(at("unknown-tag", `<${tag.name}> needs test="…"`));
            expressionAt("test", false);
            break;
        case "Ref":
            if (value("id") === undefined) problems.push(at("unknown-tag", "<Ref> needs id=\"entry id\""));
            nonEmpty("id");
            break;
        case "Image":
            if ((value("src") === undefined) === (value("of") === undefined)) problems.push(at("unknown-tag", "<Image> takes either src=\"path\" or of=\"address\""));
            addressAt("of");
            break;
        default:
            break;
    }
    return problems;
}

/** 检查一块（已规范化）：全部问题按偏移排；调用方取第一个（去掉能免的 `unknown-tag` 之后）。 */
export function checkEntryText(parsed: ParsedEntryText, options: CheckOptions = {}): CheckProblem[] {
    const registered = options.registered ?? new Set<string>();
    const problems: CheckProblem[] = [...parsed.problems];
    if (parsed.tokens.length > 0 || parsed.problems.length === 0) {
        for (const {token, offset} of unsupportedTokens(parsed)) problems.push({code: "unsupported-markdown", offset, message: `${token.type === "html" ? "raw HTML or an HTML comment" : token.type} is not supported in entry text`});
    }
    for (const tag of parsed.tags) {
        if (tag.place === "live") problems.push(...tagProblems(tag, registered));
        else if (tag.place === "prose" && (BUILTIN_TAGS.has(tag.name) || registered.has(tag.name)) && (tag.attributeLike || tag.closing)) {
            problems.push({code: "tag-malformed", offset: tag.start, message: `<${tag.closing ? "/" : ""}${tag.name} is not a complete tag; finish it, or write \\< to keep it as text`, tag: tag.index});
        }
    }
    return problems.sort((left, right) => left.offset - right.offset);
}
