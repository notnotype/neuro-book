/**
 * 富文本编辑器里小块的值从哪来（w00055 t03 计划“值怎么到小块上”）：世界服务按某一版整篇源文给作者的值表（canon.rendering 输出 16），
 * 先按标签名与起点对回那一版的活标签（与阅读视图同一段逻辑，`pairValues`），再按标签原文与文档里此刻的标签对齐。
 *
 * 对齐用最长公共子序列：作者在别处打字、小块原文没变的照样换上新值；新插的、改过的小块对不上，等下一次。同一个原文出现几次时
 * 值也相同（值只由标签自己与世界决定），对到哪一个都不会显示错。
 */

import {lexTags, parseEntryText} from "@notnotype/nb-canon/grammar";

import {hasItem, pairValues} from "./components/text/entry-text";
import type {EntryTextValue} from "./components/text/entry-text";

/** 一个该有值的活标签：原文与值。 */
export interface TagValue {
    readonly source: string;
    readonly value: EntryTextValue;
}

/** 一版源文里该有值的活标签与它们的值，按先后；值表对不上这一版源文时交回原因（这一批值不用）。 */
export function valueSequence(source: string, values: readonly EntryTextValue[]): readonly TagValue[] | {readonly mismatch: string} {
    const parsed = parseEntryText(source);
    const owned = pairValues(parsed, values);
    if ("mismatch" in owned) return owned;
    return [...owned.entries()].sort(([a], [b]) => a - b).map(([index, value]) => {
        const tag = parsed.tags[index]!;
        return {source: source.slice(tag.start, tag.end), value};
    });
}

/** 一个标签原文该不该有值（`Else`、闭标签、写坏的没有），与 `pairValues` 同一条规则。 */
export function tagHasValue(source: string): boolean {
    const tag = lexTags(source)[0];
    return tag !== undefined && hasItem(tag.name, tag.kind);
}

/**
 * 文档里该有值的标签（按先后的原文）对上值：交回同样长的数组，对不上的是 undefined。两头相同的部分直接对（改动通常在一处），
 * 中间按最长公共子序列对。
 */
export function alignValues(tags: readonly string[], sequence: readonly TagValue[]): ReadonlyArray<EntryTextValue | undefined> {
    const result: Array<EntryTextValue | undefined> = new Array<EntryTextValue | undefined>(tags.length).fill(undefined);
    let head = 0;
    while (head < tags.length && head < sequence.length && tags[head] === sequence[head]!.source) {
        result[head] = sequence[head]!.value;
        head += 1;
    }
    let tailTags = tags.length;
    let tailSequence = sequence.length;
    while (tailTags > head && tailSequence > head && tags[tailTags - 1] === sequence[tailSequence - 1]!.source) {
        tailTags -= 1;
        tailSequence -= 1;
        result[tailTags] = sequence[tailSequence]!.value;
    }
    const rows = tailTags - head;
    const columns = tailSequence - head;
    if (rows === 0 || columns === 0) return result;
    // 中间段的最长公共子序列：表从后往前填，再从前往后走出对应。
    const width = columns + 1;
    const table = new Uint32Array((rows + 1) * width);
    for (let row = rows - 1; row >= 0; row -= 1) {
        for (let column = columns - 1; column >= 0; column -= 1) {
            table[row * width + column] = tags[head + row] === sequence[head + column]!.source ? table[(row + 1) * width + column + 1]! + 1 : Math.max(table[(row + 1) * width + column]!, table[row * width + column + 1]!);
        }
    }
    let row = 0;
    let column = 0;
    while (row < rows && column < columns) {
        if (tags[head + row] === sequence[head + column]!.source) {
            result[head + row] = sequence[head + column]!.value;
            row += 1;
            column += 1;
        } else if (table[(row + 1) * width + column]! >= table[row * width + column + 1]!) row += 1;
        else column += 1;
    }
    return result;
}
