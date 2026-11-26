/**
 * 按标签改写原文：规范写法（docs/specs/canon/rendering.md 输出 18）、带值写法的装饰（输出 8、9）与去值（输出 22）。只动活的标签，
 * 别的字逐字保留，所以对规范写法的源文“去值(装饰(源文))”逐字等于源文。
 */

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

/** 带值写法（输出 8）：给活的标签加上装饰；`decorationOf` 返回 null 的写成规范写法。 */
export function decorateEntryText(parsed: ParsedEntryText, decorationOf: (tag: EntryTag) => Decoration | null): string {
    return rewrite(parsed, (tag) => {
        if (tag.kind === "paired" || tag.kind === "malformed") return null;
        const decoration = decorationOf(tag);
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
