/**
 * 书架的显示规则（docs/proposals/bookshelf.md）：字数与时间的写法、书脊的厚度与色档、排序、继续写作选哪一部。
 * 纯函数，组件与测试共用。
 */

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../shared/shelf";
import type {ShelfItem} from "../shared/shelf";

export type ShelfSort = "recent" | "title" | "words";

/** 书脊厚度的上下限（px）：最薄也要放得下一列竖排的字，最厚不让一部长篇占掉半个书架。 */
export const SPINE_WIDTH = {min: 30, max: 64} as const;
/** 到这个字数书脊就到最厚；按对数增长，几千字与几万字之间也看得出差别。 */
const SPINE_FULL_WORDS = 1_000_000;
/** 书脊色板的档数：色相从主题强调色起等距转开，明暗与彩度由组件按配色定。 */
export const SPINE_HUES = 8;
/** 书脊高度的几档（px）：真书高矮不一，一排同高的书脊像色卡。最高一档决定每层搁板的高度。 */
export const SPINE_HEIGHTS = [200, 208, 214, 220] as const;

const TEXT = {
    words: {"zh-CN": "{count} 字", "en-US": "{count} words"},
    wordsTenThousand: {"zh-CN": "{count} 万字", "en-US": "{count}k words"},
    files: {"zh-CN": "{count} 篇", "en-US": "{count} files"},
    today: {"zh-CN": "今天 {count} 字", "en-US": "{count} today"},
    todayAt: {"zh-CN": "今天 {time}", "en-US": "Today {time}"},
    yesterdayAt: {"zh-CN": "昨天 {time}", "en-US": "Yesterday {time}"},
} satisfies Record<string, LocalizedText>;

function grouped(count: number, locale: DisplayLocale): string {
    return new Intl.NumberFormat(locale).format(count);
}

/** 字数：中文一万以上写“万字”，英文一千以上写“k”，都留一位小数并去掉 `.0`。 */
export function formatWords(count: number, locale: DisplayLocale): string {
    const unit = locale === "zh-CN" ? 10_000 : 1_000;
    if (count < unit) return localize(formatText(TEXT.words, {count: grouped(count, locale)}), locale);
    const scaled = (Math.round((count / unit) * 10) / 10).toString();
    return localize(formatText(TEXT.wordsTenThousand, {count: scaled}), locale);
}

export function formatFiles(count: number, locale: DisplayLocale): string {
    return localize(formatText(TEXT.files, {count: grouped(count, locale)}), locale);
}

/** 今天净增的字数；减少时带负号（U+2212），不显示为 0。 */
export function formatToday(count: number, locale: DisplayLocale): string {
    const value = count < 0 ? `−${grouped(-count, locale)}` : grouped(count, locale);
    return localize(formatText(TEXT.today, {count: value}), locale);
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 某个时刻相对 `now` 的写法：今天、昨天带时分，今年只写月日，更早带年份。按浏览器的本地时区。 */
export function formatWhen(at: string, now: string, locale: DisplayLocale): string {
    const date = new Date(at);
    const today = new Date(now);
    const time = new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", hour12: false}).format(date);
    if (sameDay(date, today)) return localize(formatText(TEXT.todayAt, {time}), locale);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (sameDay(date, yesterday)) return localize(formatText(TEXT.yesterdayAt, {time}), locale);
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === today.getFullYear()
        ? {month: "long", day: "numeric"}
        : {year: "numeric", month: "long", day: "numeric"};
    return new Intl.DateTimeFormat(locale, options).format(date);
}

/** 书脊厚度：按字数的对数插值，夹在上下限之间。 */
export function spineWidth(words: number): number {
    const ratio = Math.min(1, Math.log10(Math.max(0, words) + 1) / Math.log10(SPINE_FULL_WORDS + 1));
    return Math.round(SPINE_WIDTH.min + (SPINE_WIDTH.max - SPINE_WIDTH.min) * ratio);
}

/** 没有指定颜色的作品按 id 取一档色相：同一部作品在任何窗口、任何时候都是同一档。 */
export function spineHue(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % SPINE_HUES;
}

/** 书脊高度：按 id 取一档，与色档用不同的位，同色的两本不总是一样高。 */
export function spineHeight(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 131 + char.charCodeAt(0)) >>> 0;
    return SPINE_HEIGHTS[hash % SPINE_HEIGHTS.length] as number;
}

/** 挂在 `.shelf-spine-color` 元素上的样式变量（见 components/shelf-colors.css）。 */
export function spineStyle(item: {readonly id: string; readonly color: string | null}): Record<string, string> {
    return {"--spine-hue": String(spineHue(item.id)), ...(item.color === null ? {} : {"--spine-color": item.color})};
}

function lastAt(item: ShelfItem): number {
    return item.stats.last === null ? Number.NEGATIVE_INFINITY : Date.parse(item.stats.last.at);
}

/** 排序。比较相等时按显示名，再按 id，结果稳定。 */
export function sortShelf(items: ReadonlyArray<ShelfItem>, sort: ShelfSort, locale: DisplayLocale): ShelfItem[] {
    const collator = new Intl.Collator(locale, {numeric: true, sensitivity: "base"});
    const byName = (a: ShelfItem, b: ShelfItem): number => collator.compare(projectDisplayName(a), projectDisplayName(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const primary: Record<ShelfSort, (a: ShelfItem, b: ShelfItem) => number> = {
        recent: (a, b) => lastAt(b) - lastAt(a),
        title: () => 0,
        words: (a, b) => b.stats.words - a.stats.words,
    };
    return [...items].sort((a, b) => primary[sort](a, b) || byName(a, b));
}

/** 继续写作的那一部：最近编辑时间最晚的；都没有编辑记录时为 null。 */
export function continueTarget(items: ReadonlyArray<ShelfItem>): ShelfItem | null {
    let best: ShelfItem | null = null;
    for (const item of items) {
        if (item.stats.last !== null && (best === null || lastAt(item) > lastAt(best))) best = item;
    }
    return best;
}
