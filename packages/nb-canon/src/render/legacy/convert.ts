/**
 * 旧写法（白名单 MDX 的花括号表达式）到标签写法的转换器（w00055 t02 计划“关键设计”第 4 节；ADR 0064）。只给一次性的迁移脚本用：
 * 改写样本与测试数据，迁移完连同旧解析器一起删掉。
 *
 * 用旧的 `parseBlock` 拿到每个表达式、`<Ref>`、`<Image>` 在原文里的精确起止，按偏移拼接，别的字逐字不动。转换完用新的写入检查再查一遍，
 * 过不了的交回问题，由人工改。
 */

import type {Node as EsNode} from "estree";

import {displayText} from "../../core/display";
import {checkEntryText, parseEntryText} from "../../grammar/index";
import {memberReference, parseBlock, type ExpressionSite} from "./syntax";

export type ConvertResult = {readonly ok: true; readonly source: string; readonly comments: number} | {readonly ok: false; readonly problem: string};

interface Splice {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

class Unconvertible extends Error {}

/** 写进属性值的式子：字符串字面量换成单引号（属性值里不能有 `"`）。字面量里有 `"` 时转不了，交人工。 */
function expressionText(site: ExpressionSite, node: EsNode, source: string): string {
    const range = node as unknown as {start: number; end: number};
    const literals: Array<{start: number; end: number; value: string}> = [];
    const walk = (value: unknown): void => {
        if (value === null || typeof value !== "object") return;
        const record = value as {type?: string; value?: unknown; start?: number; end?: number};
        if (record.type === "Literal" && typeof record.value === "string") literals.push({start: record.start as number, end: record.end as number, value: record.value});
        for (const [key, child] of Object.entries(value)) if (key !== "loc" && key !== "range") walk(child);
    };
    walk(node);
    literals.sort((left, right) => left.start - right.start);
    let text = "";
    let cursor = range.start;
    for (const literal of literals) {
        if (literal.value.includes("\"")) throw new Unconvertible(`string literal with a double quote in {${site.source.trim()}}`);
        text += source.slice(cursor, literal.start) + `'${literal.value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'")}'`;
        cursor = literal.end;
    }
    text += source.slice(cursor, range.end);
    if (/[\r\n]/u.test(text)) throw new Unconvertible(`expression spans lines in {${site.source.trim()}}`);
    return text;
}

/** 正文里的一段文字写成 Markdown：会被读成语法的标点加反斜杠（条件各支里的字面量，原来是 JS 字符串，不该被读成 Markdown）。 */
const proseText = (text: string): string => text.replace(/[\\`*_[\]<>|~!&$]/gu, (char) => `\\${char}`);

/** 一个取值或计算值：单个字段引用写成 `of`（别的条目的加 `entry`），别的写成 `expr`。 */
function valueTag(site: ExpressionSite, node: EsNode, source: string): string {
    if (node.type === "MemberExpression") {
        const reference = memberReference(node);
        if (reference !== null) return reference.entry === null ? `<V of="${reference.path}" />` : `<V entry="${reference.entry}" of="${reference.path}" />`;
    }
    return `<V expr="${expressionText(site, node, source)}" />`;
}

/** 条件的一支：字面量写成文字（显示的样子同旧的作者渲染），字段与式子写成标签。 */
function branchText(site: ExpressionSite, node: EsNode, source: string): string {
    if (node.type === "Literal") {
        const value = (node as {value: unknown}).value;
        return proseText(typeof value === "string" ? value : displayText(value));
    }
    return valueTag(site, node, source);
}

/** 顶层的三元式写成 `If`；else 支还是三元式的接成 `ElseIf`。运算里面的三元式不拆，整个写成 `expr`。 */
function conditionText(site: ExpressionSite, node: EsNode, source: string): string {
    let text = "";
    let current: EsNode = node;
    let head = "If";
    while (current.type === "ConditionalExpression") {
        const test = expressionText(site, current.test, source);
        text += head === "If" ? `<If test="${test}">` : `<ElseIf test="${test}" />`;
        text += branchText(site, current.consequent, source);
        head = "ElseIf";
        current = current.alternate;
    }
    return `${text}<Else />${branchText(site, current, source)}</If>`;
}

/** 转换一块旧写法的源文。 */
export function convertLegacyBlock(source: string): ConvertResult {
    const parsed = parseBlock(source);
    if (!parsed.ok) return {ok: false, problem: `legacy parse failed: ${parsed.problem.code} ${parsed.problem.message}`};
    const splices: Splice[] = [];
    let comments = 0;
    try {
        const inImage = (site: ExpressionSite) => parsed.block.images.some((image) => site.start >= image.start && site.end <= image.end);
        for (const site of parsed.block.expressions) {
            if (inImage(site)) continue;
            if (site.expression === null) {
                comments += 1;
                splices.push({start: site.start, end: site.end, text: ""});
                continue;
            }
            const node = site.expression as EsNode;
            splices.push({start: site.start, end: site.end, text: node.type === "ConditionalExpression" ? conditionText(site, node, source) : valueTag(site, node, source)});
        }
        for (const ref of parsed.block.refs) splices.push({start: ref.start, end: ref.end, text: `<Ref id="${ref.id}" />`});
        for (const image of parsed.block.images) {
            if (image.altExpression) throw new Unconvertible("<Image> with an alt expression");
            const raw = source.slice(image.start, image.end);
            const site = parsed.block.expressions.find((candidate) => inImage(candidate) && candidate.start >= image.start && candidate.end <= image.end);
            const alt = image.alt === null || image.alt === "" ? "" : ` alt="${image.alt}"`;
            if (site !== undefined) {
                const reference = site.reference;
                if (reference === null || reference.entry !== null) throw new Unconvertible("<Image src={…}> that is not an address of this entry");
                splices.push({start: image.start, end: image.end, text: `<Image of="${reference.path}"${alt} />`});
            } else {
                const src = /\bsrc=(?:"([^"]*)"|'([^']*)')/u.exec(raw);
                if (src === null) throw new Unconvertible("<Image> without src");
                splices.push({start: image.start, end: image.end, text: `<Image src="${src[1] ?? src[2] ?? ""}"${alt} />`});
            }
            if (image.alt?.includes("\"") === true) throw new Unconvertible("<Image> alt with a double quote");
        }
    } catch (error) {
        if (error instanceof Unconvertible) return {ok: false, problem: error.message};
        throw error;
    }
    splices.sort((left, right) => left.start - right.start);
    let text = "";
    let cursor = 0;
    for (const splice of splices) {
        text += source.slice(cursor, splice.start) + splice.text;
        cursor = splice.end;
    }
    text += source.slice(cursor);
    const problems = checkEntryText(parseEntryText(text));
    if (problems.length > 0) return {ok: false, problem: `converted text fails the new check: ${problems.map((problem) => `${problem.code} ${problem.message}`).join("; ")}`};
    return {ok: true, source: text, comments};
}
