/**
 * 按标签改写原文：规范写法（docs/specs/canon/rendering.md 输出 18）、带值写法的装饰（输出 8、9）与去值（输出 22）。只动活的标签，
 * 别的字逐字保留，所以对规范写法的源文“去值(装饰(源文))”逐字等于源文。
 */

import {parseExpression} from "./expression";
import {parseEntryText, type EntryTag, type ParsedEntryText} from "./parse";
import {escapeDecoration, tagText} from "./tags";

/** 给一个活的标签加的装饰：属性（值是作者的数据，这里转义）与开闭标签之间的内容（调用方已写成 JSON 或转义过的描述）。 */
export interface Decoration {
    readonly attributes?: ReadonlyArray<readonly [string, string]>;
    readonly content?: string;
}

/** 程序加的属性（输出 9），去值时去掉。 */
const DECORATION_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
    V: new Set(["label", "incomplete", "unavailable"]),
    If: new Set(["value"]),
    ElseIf: new Set(["value"]),
    Ref: new Set(["name"]),
    Image: new Set(["path"]),
};

/** 把每个活的标签换成 `write` 给的写法；返回 null 的照原文。 */
function rewrite(parsed: ParsedEntryText, write: (tag: EntryTag) => string | null): string {
    let text = "";
    let cursor = 0;
    for (const tag of parsed.tags) {
        if (tag.place !== "live") continue;
        const written = write(tag);
        if (written === null) continue;
        text += parsed.source.slice(cursor, tag.start) + written;
        cursor = tag.end;
    }
    return text + parsed.source.slice(cursor);
}

const formOf = (tag: EntryTag): "self" | "open" | "close" => (tag.kind === "close" ? "close" : tag.kind === "open" ? "open" : "self");
const attributesOf = (tag: EntryTag): Array<readonly [string, string]> => tag.attributes.map((attribute) => [attribute.name, attribute.value] as const);

/** 活的标签写成规范写法（属性顺序不变、之间一个空格，自闭合写 ` />`）；带内容的与写坏的不动。 */
export function canonicalEntryText(parsed: ParsedEntryText): string {
    return rewrite(parsed, (tag) => (tag.kind === "paired" || tag.kind === "malformed" ? null : tagText(tag.name, attributesOf(tag), formOf(tag))));
}

/**
 * 带值写法（输出 8）：给活的标签加上装饰，写成规范写法；`decorationOf` 返回 null 的照原文（没登记的标签 Agent 看到原样的，输出 19；
 * 装饰以外的字与源文逐字相同）。
 */
export function decorateEntryText(parsed: ParsedEntryText, decorationOf: (tag: EntryTag) => Decoration | null): string {
    return rewrite(parsed, (tag) => {
        if (tag.kind === "paired" || tag.kind === "malformed") return null;
        const decoration = decorationOf(tag);
        if (decoration === null) return null;
        const attributes = [...attributesOf(tag), ...(decoration?.attributes ?? []).map(([name, value]) => [name, escapeDecoration(value)] as const)];
        if (decoration?.content !== undefined && tag.kind === "self") return `${tagText(tag.name, attributes, "open")}${decoration.content}</${tag.name}>`;
        return tagText(tag.name, attributes, formOf(tag));
    });
}

/**
 * 去值（输出 22）：带值的 `V` 与带描述的登记标签换回自闭合，去掉程序加的属性；活的标签写成规范写法。`registered` 是登记的标签名：
 * 只有 `V` 与它们开闭之间的内容去掉，别的带内容的标签照原样留下（写入检查会拒收）。
 */
export function stripEntryText(text: string, registered: ReadonlySet<string> = new Set()): string {
    const parsed = parseEntryText(text);
    return rewrite(parsed, (tag) => {
        if (tag.kind === "malformed") return null;
        if (tag.kind === "paired" && tag.name !== "V" && !registered.has(tag.name)) return null;
        const dropped = DECORATION_ATTRIBUTES[tag.name] ?? new Set<string>();
        const attributes = attributesOf(tag).filter(([name]) => !dropped.has(name));
        return tagText(tag.name, attributes, tag.kind === "paired" ? "self" : formOf(tag));
    });
}

/** 式子里 `ref('…')` 的参数换掉：按语法树找调用（`ref ( 'e2' )` 也算，字符串里写着的 `ref('e2')` 不算）。读不了的式子照原文。 */
function rewriteRefs(expression: string, map: (id: string) => string): string {
    const parsed = parseExpression(expression);
    if (!parsed.ok) return expression;
    const spans: Array<{readonly start: number; readonly end: number; readonly id: string}> = [];
    const visit = (value: unknown): void => {
        if (value === null || typeof value !== "object") return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const node = value as {type?: unknown; callee?: {type?: unknown; name?: unknown}; arguments?: Array<{type?: unknown; value?: unknown; start: number; end: number}>};
        const argument = node.arguments?.[0];
        if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "ref" && argument?.type === "Literal" && typeof argument.value === "string") spans.push({start: argument.start, end: argument.end, id: argument.value});
        for (const [key, child] of Object.entries(value)) if (key !== "loc") visit(child);
    };
    visit(parsed.expression.node);
    let text = "";
    let cursor = 0;
    for (const span of spans.sort((left, right) => left.start - right.start)) {
        text += `${expression.slice(cursor, span.start)}'${map(span.id)}'`;
        cursor = span.end;
    }
    return text + expression.slice(cursor);
}

/**
 * 换掉主文字里指向条目的 id：`V` 的 `entry`、`Ref` 的 `id`，与 `expr`、`test` 里的 `ref('…')`。只动活的标签：代码里、转义的照原文
 * （样本的迁移把原型 id 换成世界 id 时用，不碰别的字符串）。
 */
export function rewriteEntryIds(text: string, map: (id: string) => string): string {
    const parsed = parseEntryText(text);
    return rewrite(parsed, (tag) => {
        if (tag.kind === "malformed" || tag.kind === "close") return null;
        let changed = false;
        const attributes = tag.attributes.map((attribute): readonly [string, string] => {
            let value = attribute.value;
            if ((tag.name === "V" && attribute.name === "entry") || (tag.name === "Ref" && attribute.name === "id")) value = map(value);
            else if (attribute.name === "expr" || attribute.name === "test") value = rewriteRefs(value, map);
            changed ||= value !== attribute.value;
            return [attribute.name, value];
        });
        if (!changed) return null;
        const written = tagText(tag.name, attributes, tag.kind === "open" ? "open" : "self");
        return tag.kind === "paired" && tag.content !== null ? `${written.slice(0, -3)}>${parsed.source.slice(tag.content.start, tag.content.end)}</${tag.name}>` : written;
    });
}
