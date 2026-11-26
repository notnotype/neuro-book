/**
 * `EntryText` 的数据：世界服务给作者的渲染里的块（canon.rendering 输出 7）。每块是源文加值表；组件对源文跑与内核同一份条目文法
 * （`@notnotype/nb-canon/grammar`），按标签名与起点把值表的每一项对回活的标签，对不上的整块按出错显示（不按位置猜）。
 */

import type {AuthorValue} from "@notnotype/nb-canon";
import {parseEntryText, positionOf} from "@notnotype/nb-canon/grammar";

/** 值表的一项（nb-canon 的 `AuthorValue`）。 */
export type EntryTextValue = AuthorValue;

export type EntryTextBlock =
    | {readonly id: string; readonly source: string; readonly values: readonly EntryTextValue[]}
    | {readonly id: string; readonly error: {readonly message: string; readonly line?: number; readonly column?: number}; readonly text: string};

/** 词法单元里组件读的字段：marked 的单元，加条目文法的 `entryTag`（`tag` 是标签的序号）与 `entryIf`（各支）。 */
export interface EntryTextToken {
    readonly type: string;
    readonly raw: string;
    readonly text?: string;
    readonly tokens?: readonly EntryTextToken[];
    readonly items?: readonly EntryTextToken[];
    readonly depth?: number;
    readonly ordered?: boolean;
    readonly header?: ReadonlyArray<{readonly tokens: readonly EntryTextToken[]}>;
    readonly rows?: ReadonlyArray<ReadonlyArray<{readonly tokens: readonly EntryTextToken[]}>>;
    readonly tag?: number;
    readonly branches?: ReadonlyArray<{readonly head: number; readonly tokens: readonly EntryTextToken[]}>;
}

/** 读好、对好的一块：词法单元，每个活的标签的名字与值表的项，块一级的单元在源文里的行（从 1 起）。 */
export interface LaidOutBlock {
    readonly tokens: readonly EntryTextToken[];
    readonly tagName: (tag: number) => string;
    readonly valueOf: (tag: number) => EntryTextValue | undefined;
    readonly lineOf: (token: EntryTextToken) => number | undefined;
}

/** 值表里有项的标签：`V`、`If`、`ElseIf`、`Ref`、`Image` 与没登记的；`Else`、闭标签、写坏的、字面的没有。 */
const hasItem = (name: string, kind: string): boolean => kind !== "close" && kind !== "malformed" && name !== "Else";

/** 块一级、带行号的单元（编辑时的预览跟着光标滚到对应的段落，canon.author-ui 输出 48）。 */
const LINED = new Set(["paragraph", "heading", "list_item", "blockquote", "code", "hr", "table"]);

/**
 * 读一块并把值表对回标签。值表的每一项要对上一个活的标签（名字与起点都相同），每个该有项的活标签也要有一项；有一处对不上就
 * 交回原因，调用方整块按出错显示。
 */
export function layoutBlock(source: string, values: readonly EntryTextValue[]): LaidOutBlock | {readonly mismatch: string} {
    const parsed = parseEntryText(source);
    const byStart = new Map(values.map((value) => [`${value.tag}@${String(value.start)}`, value]));
    const owned = new Map<number, EntryTextValue>();
    for (const [index, tag] of parsed.tags.entries()) {
        if (tag.place !== "live" || !hasItem(tag.name, tag.kind)) continue;
        const value = byStart.get(`${tag.name}@${String(tag.start)}`);
        if (value === undefined) return {mismatch: `no value for <${tag.name}> at ${String(tag.start)}`};
        owned.set(index, value);
    }
    if (owned.size !== values.length) return {mismatch: `${String(values.length - owned.size)} values match no tag`};
    const tokens = parsed.tokens as unknown as readonly EntryTextToken[];
    // 单元不带偏移：按它的原文在父单元的范围里往后找（与内核切块的找法相同）；找不到的不写行号。
    const lines = new WeakMap<EntryTextToken, number>();
    const place = (list: readonly EntryTextToken[], from: number, to: number): void => {
        let cursor = from;
        for (const token of list) {
            const raw = token.raw.replace(/\s+$/u, "");
            const at = raw === "" ? -1 : source.indexOf(raw, cursor);
            if (at < 0 || at + raw.length > to) continue;
            if (LINED.has(token.type)) lines.set(token, positionOf(source, at).line);
            const end = at + token.raw.length;
            place(token.items ?? [], at, Math.min(end, to));
            place(token.tokens ?? [], at, Math.min(end, to));
            cursor = at + raw.length;
        }
    };
    place(tokens, 0, source.length);
    return {
        tokens,
        tagName: (tag) => parsed.tags[tag]?.name ?? "",
        valueOf: (tag) => owned.get(tag),
        lineOf: (token) => lines.get(token),
    };
}

/** 文字里一个值指向的地址。 */
export interface TextAddress {
    readonly entry: string;
    readonly path: string;
}

/** 地址的键：条目 id 不含“|”（内核的 id 只有字母、数字与冒号）。 */
export function addressKey(address: TextAddress): string {
    return `${address.entry}|${address.path}`;
}
