/**
 * `EntryTextEditor` 的数据。放在单独的模块里：宿主（`EntryPageHost.vue`）与它的测试也用，而后端的类型检查看不懂 `.vue`。
 */

import type {EntryField} from "../../entry-chip";
import type {TextValueTable} from "../../text-values";
import type {EntryFind} from "../entries/entry-picker";

/** “插入”菜单“值”下面的一项：选了在光标处写入 `snippet`。 */
export interface InsertItem {
    readonly label: string;
    /** 写进源文字的写法，例如 `<V of="panel.魔力" />`；同一个菜单里不重复。 */
    readonly snippet: string;
}

/**
 * 富文本输入框要的东西（`EntryRichInput` 的属性，canon/author-ui.md 输出 48）。没有它时编辑视图只有源文字。
 *
 * 宿主每次按键都会重画：`fields`、`marks` 要是引用稳定的值（各自的 computed），换了引用输入框会把值整篇重新对一遍。
 */
export interface RichContext {
    /** 这个条目的 id。 */
    readonly self: string;
    readonly fields: readonly EntryField[];
    readonly marks: Readonly<Record<string, string>>;
    /** 最近一次算出的整篇与值表。 */
    readonly values: TextValueTable | null;
    /** 值正在算；为假（整篇太长、读不到）时没有值的小块是“没有算”。 */
    readonly computing: boolean;
    /** 找条目（`@` 与“插入”的条目）；没有时这两个入口不出现。 */
    readonly find: EntryFind | null;
    /** 存下的那一版主文字里没登记的标签（`../entry-check.ts` 的 `baselineOf`）：写入前的检查与源文字的检查放行它们。 */
    readonly baseline: ReadonlySet<string>;
}

/** 富文本的“插入”里另外三项（值以外）的源文字模板：源文字模式下照它写进去，作者接着填。 */
export const INSERT_TEMPLATES = {
    calc: '<V expr="" />',
    if: '<If test=""><Else /></If>',
    ref: '<Ref id="" />',
} as const;

/** 整篇源文里第 `line` 行第 `column` 列（从 1 起）的偏移。 */
export function offsetOf(text: string, line: number, column: number): number {
    let offset = 0;
    for (let at = 1; at < line; at += 1) {
        const next = text.indexOf("\n", offset);
        if (next < 0) return text.length;
        offset = next + 1;
    }
    return Math.min(offset + column - 1, text.length);
}
