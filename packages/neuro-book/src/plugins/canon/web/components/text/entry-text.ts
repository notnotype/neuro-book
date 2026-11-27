/**
 * `EntryText` 的数据：世界服务给作者的渲染里的块（canon.rendering 输出 7）。每块是源文加值表；组件对源文跑与内核同一份条目文法
 * （`@notnotype/nb-canon/grammar`），按标签名与起点把值表的每一项对回活的标签，对不上的整块按出错显示（不按位置猜）。
 */

import type {AuthorValue} from "@notnotype/nb-canon";
import {MAX_NESTING_DEPTH, nestingDepth, parseEntryText} from "@notnotype/nb-canon/grammar";
import type {ParsedEntryText} from "@notnotype/nb-canon/grammar";

/** 值表的一项（nb-canon 的 `AuthorValue`）。 */
export type EntryTextValue = AuthorValue;

export type EntryTextBlock =
    | {readonly id: string; readonly source: string; readonly values: readonly EntryTextValue[]}
    | {readonly id: string; readonly error: {readonly message: string; readonly line?: number; readonly column?: number}; readonly text: string};

/** 词法单元里组件读的字段：marked 的单元，加条目文法的 `entryTag`（`tag` 是标签的序号）、`entryIf`（各支）与 HTML 形式的强调 `htmlMark`（`tag` 是小写的标签名）。 */
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
    readonly tag?: number | string;
    readonly branches?: ReadonlyArray<{readonly head: number; readonly tokens: readonly EntryTextToken[]}>;
}

/** 值是按钮的取值（`V` 写地址、读得到、不是图片）：点它展开来历。 */
export type PressableValue = Extract<EntryTextValue, {tag: "V"}> & {readonly path: string};

/**
 * 读好、对好的一块：词法单元，每个活的标签在值表里的项，画出来是按钮的取值（生效的支里的；
 * 来历画在含它的块后面）。
 */
export interface LaidOutBlock {
    readonly tokens: readonly EntryTextToken[];
    readonly valueOf: (tag: number) => EntryTextValue | undefined;
    readonly pressable: readonly PressableValue[];
}

/** 值表里有项的标签：`V`、`If`、`ElseIf`、`Ref`、`Image` 与没登记的；`Else`、闭标签、写坏的、字面的没有。 */
export const hasItem = (name: string, kind: string): boolean => kind !== "close" && kind !== "malformed" && name !== "Else";

/** 值表里的项画出来是不是按钮（与 `EntryText` 的画法一致：读不到的、算出来的、图片是文字）。 */
const isPressable = (value: EntryTextValue | undefined): value is PressableValue =>
    value !== undefined && value.tag === "V" && "path" in value && typeof value.path === "string" && value.unavailable === undefined && value.expr === undefined && value.image === undefined;

/**
 * 读一块并把值表对回标签。值表的每一项要对上一个活的标签（名字与起点都相同），每个该有项的活标签也要有一项；有一处对不上就
 * 交回原因，调用方整块按出错显示。嵌套过深的（内核按出错的块给，这里防前后端不是同一版）与读的时候栈溢出的也按对不上处理：
 * 画的时候按层递归，深的树会让整个阅读视图抛错。
 */
export function layoutBlock(source: string, values: readonly EntryTextValue[]): LaidOutBlock | {readonly mismatch: string} {
    let parsed: ReturnType<typeof parseEntryText>;
    try {
        parsed = parseEntryText(source);
    } catch (error) {
        if (error instanceof RangeError) return {mismatch: "nested too deeply to read"};
        throw error;
    }
    if (nestingDepth(parsed.tokens) > MAX_NESTING_DEPTH) return {mismatch: `nested more than ${String(MAX_NESTING_DEPTH)} levels deep`};
    const owned = pairValues(parsed, values);
    if ("mismatch" in owned) return owned;
    const tokens = parsed.tokens as unknown as readonly EntryTextToken[];
    return {tokens, valueOf: (tag) => owned.get(tag), pressable: pressableIn(tokens, owned)};
}

/**
 * 按标签名与起点把值表的每一项对回活的标签（canon.rendering 输出 7）：交回“标签序号 → 值”。每一项都要对上一个活的标签，每个该有项的
 * 活标签也要有一项；有一处对不上就交回原因，不按位置猜。阅读视图与富文本编辑器（`entry-values.ts`）共用。
 */
export function pairValues(parsed: ParsedEntryText, values: readonly EntryTextValue[]): Map<number, EntryTextValue> | {readonly mismatch: string} {
    const byStart = new Map(values.map((value) => [`${value.tag}@${String(value.start)}`, value]));
    const owned = new Map<number, EntryTextValue>();
    for (const [index, tag] of parsed.tags.entries()) {
        if (tag.place !== "live" || !hasItem(tag.name, tag.kind)) continue;
        const value = byStart.get(`${tag.name}@${String(tag.start)}`);
        if (value === undefined) return {mismatch: `no value for <${tag.name}> at ${String(tag.start)}`};
        owned.set(index, value);
    }
    if (owned.size !== values.length) return {mismatch: `${String(values.length - owned.size)} values match no tag`};
    return owned;
}


/** 画出来是按钮的取值，按出现的先后：条件只进生效的那一支。 */
function pressableIn(tokens: readonly EntryTextToken[], owned: ReadonlyMap<number, EntryTextValue>): PressableValue[] {
    const found: PressableValue[] = [];
    const visit = (list: readonly EntryTextToken[] | undefined): void => {
        for (const token of list ?? []) {
            if (token.type === "entryTag" && typeof token.tag === "number") {
                const value = owned.get(token.tag);
                if (isPressable(value)) found.push(value);
            } else if (token.type === "entryIf") {
                const head = owned.get(token.branches?.[0]?.head ?? -1) as {taken?: number | null} | undefined;
                const taken = head?.taken ?? null;
                if (taken !== null) visit(token.branches?.[taken]?.tokens);
            } else {
                visit(token.items);
                visit(token.tokens);
                for (const row of [token.header ?? [], ...(token.rows ?? [])]) for (const cell of row) visit(cell.tokens);
            }
        }
    };
    visit(tokens);
    return found;
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

/**
 * 正文里的“哪一处”值（author-ui 输出 11：同一个字段出现几次时只打开被点的那一个）：块 id、这个标签在块源文里的起点，加上它的地址
 * （来历按地址读）。写成一个字符串，存在标签状态里。
 */
export function placeKey(block: string, start: number, address: TextAddress): string {
    return `${block}@${String(start)}#${addressKey(address)}`;
}

/** 一处的地址。 */
export function placeAddress(place: string): TextAddress {
    const key = place.slice(place.indexOf("#") + 1);
    const split = key.indexOf("|");
    return {entry: key.slice(0, split), path: key.slice(split + 1)};
}
