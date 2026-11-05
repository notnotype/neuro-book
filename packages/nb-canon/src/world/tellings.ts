/**
 * 讲述的发生点与生效（docs/specs/canon/model.md 输出 24、26、27）：正文讲述在读取时按那一章的当前正文定位，不存。
 *
 * - 段：正文按换行切开，去掉首尾空白后仍不为空的行，从 1 起数；段内偏移按这一段（去掉首尾空白以后）的 UTF-16 码元算。
 * - 定位：每一段里按字面找原句，从段首往后找，下一处从上一处的末尾之后接着找；按段、再按段内的先后数第几处。
 * - 失联：原句找不到、`nth` 超出出现的次数、那一章不在章序里、宿主取不到那一章的正文。
 *
 * 定位的结果按章缓存，缓存记着它是按哪份正文算的：正文快照换了（`textChanged`），下一次用到这一章时按新正文重算。
 */

import type {ChapterOrder} from "../core/position";
import type {Telling} from "../core/schema";

export interface Occurrence {
    readonly chapter: string;
    readonly paragraph: number;
    readonly offset: number;
}

export type LostReason = "quote-not-found" | "nth-exceeds" | "chapter-missing" | "text-unavailable";

export type Located =
    /** 生效的正文讲述；`count` 是原句在这一章出现的次数，大于 1 而没给 `nth` 时给提示 `duplicate-quote`。 */
    | {readonly kind: "found"; readonly occurrence: Occurrence; readonly count: number}
    | {readonly kind: "lost"; readonly reason: LostReason}
    /** 正文以外的讲述：没有发生点，也不会失联。 */
    | {readonly kind: "elsewhere"};

/** 读者读到哪里（model.md 输出 27）：某一章读到第几段（含），或这一章还没读、已读完。 */
export type TellingPosition = {readonly chapter: string; readonly paragraph: number} | {readonly chapter: string; readonly edge: "start" | "end"};

interface Paragraph {
    readonly text: string;
}

/** 一章正文切成段：去掉首尾空白仍不为空的行，按出现的先后（model.md 术语“段”）。 */
export function paragraphsOf(text: string): readonly Paragraph[] {
    return text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "").map((line) => ({text: line}));
}

/** 原句在一章里每一处出现的位置，按段、再按段内的先后，不重叠。 */
function occurrencesIn(paragraphs: readonly Paragraph[], quote: string): {paragraph: number; offset: number}[] {
    const found: {paragraph: number; offset: number}[] = [];
    for (const [index, paragraph] of paragraphs.entries()) {
        for (let at = paragraph.text.indexOf(quote); at >= 0; at = paragraph.text.indexOf(quote, at + quote.length)) found.push({paragraph: index + 1, offset: at});
    }
    return found;
}

/** 原句在一章正文里出现几次，按与定位相同的切段与找法（写入时的校验用它，保证校验通过的讲述读取时能定位到）。 */
export function countOccurrences(text: string, quote: string): number {
    return quote === "" ? 0 : occurrencesIn(paragraphsOf(text), quote).length;
}

/** 讲述的定位器：按宿主当前给的章序与正文定位，结果按章与那一章的正文缓存。 */
export class TellingLocator {
    readonly #cache = new Map<string, {readonly text: string; readonly paragraphs: readonly Paragraph[]}>();

    constructor(
        private readonly chapterText: (chapter: string) => string | undefined,
        private readonly order: () => ChapterOrder,
    ) {}

    locate(telling: Telling): Located {
        if (telling.source !== "chapter") return {kind: "elsewhere"};
        const chapter = telling.chapter;
        if (chapter === undefined || !this.order().has(chapter)) return {kind: "lost", reason: "chapter-missing"};
        const paragraphs = this.#paragraphs(chapter);
        if (paragraphs === null) return {kind: "lost", reason: "text-unavailable"};
        if (telling.quote === undefined || telling.quote === "") return {kind: "lost", reason: "quote-not-found"};
        const all = occurrencesIn(paragraphs, telling.quote);
        if (all.length === 0) return {kind: "lost", reason: "quote-not-found"};
        const nth = telling.nth ?? 1;
        const chosen = all[nth - 1];
        if (chosen === undefined) return {kind: "lost", reason: "nth-exceeds"};
        return {kind: "found", occurrence: {chapter, ...chosen}, count: all.length};
    }

    #paragraphs(chapter: string): readonly Paragraph[] | null {
        const text = this.chapterText(chapter);
        if (text === undefined) return null;
        const cached = this.#cache.get(chapter);
        if (cached !== undefined && cached.text === text) return cached.paragraphs;
        const paragraphs = paragraphsOf(text);
        this.#cache.set(chapter, {text, paragraphs});
        return paragraphs;
    }
}

/**
 * 两个发生点的先后（model.md 输出 27）：先按章序，再按段、段内偏移；同一点上调用方再按讲述 id 比。章不在章序里的
 * 发生点不会出现（那样的讲述是失联的）。
 */
export function compareOccurrences(order: ChapterOrder, a: Occurrence, b: Occurrence): number {
    const chapter = (order.index(a.chapter) ?? 0) - (order.index(b.chapter) ?? 0);
    return chapter !== 0 ? chapter : a.paragraph - b.paragraph || a.offset - b.offset;
}

/** 发生点是否不晚于讲述位置（“读过”，model.md 输出 27）。讲述位置的章不在章序里时，什么都没读过。 */
export function readBy(order: ChapterOrder, occurrence: Occurrence, position: TellingPosition): boolean {
    const at = order.index(position.chapter);
    const here = order.index(occurrence.chapter);
    if (at === undefined || here === undefined) return false;
    if (here !== at) return here < at;
    if ("edge" in position) return position.edge === "end";
    return occurrence.paragraph <= position.paragraph;
}
