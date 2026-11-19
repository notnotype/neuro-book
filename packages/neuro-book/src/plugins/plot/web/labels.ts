/**
 * 剧情页面上“在哪”“什么程度”的写法（docs/specs/plot/author-ui.md 术语与输出 7、16）：章写成“第 N 章”（序号来自章表，不来自章 id），
 * 前史写“前史”，程度写文字。
 */

import type {AuthorDegree} from "../core/author/knowing";
import type {usePlotText} from "./text";

type PlotText = ReturnType<typeof usePlotText>;

/** 章 id 到序号（从 1 起）。 */
export type ChapterIndex = ReadonlyMap<string, number>;

export function chapterIndex(chapters: readonly {readonly id: string; readonly index: number}[] | undefined): ChapterIndex {
    return new Map((chapters ?? []).map((chapter) => [chapter.id, chapter.index]));
}

/** 一章：null 是前史；不在章表里的写原样 id（不会出现在正常的界面上）。 */
export function chapterLabel(chapter: string | null, chapters: ChapterIndex, text: PlotText): string {
    if (chapter === null) return text("chapter.prehistory");
    const index = chapters.get(chapter);
    return index === undefined ? chapter : text("chapter.of", {index});
}

/** 一处：章与段；没有段只写章。 */
export function placeLabel(place: {readonly chapter: string | null; readonly paragraph: number | null}, chapters: ChapterIndex, text: PlotText): string {
    if (place.chapter === null) return text("chapter.prehistory");
    const index = chapters.get(place.chapter);
    if (index === undefined || place.paragraph === null) return chapterLabel(place.chapter, chapters, text);
    return text("chapter.paragraph", {index, paragraph: place.paragraph});
}

/** 程度：没有行的按保密档写“不知道”（保密以上）或“没有记录”。 */
const DEGREES = {knows: "degree.knows", misbelieves: "degree.misbelieves", suspects: "degree.suspects", forgot: "degree.forgot", unaware: "degree.unaware"} as const;

export function degreeLabel(degree: AuthorDegree, secret: boolean, text: PlotText): string {
    if (degree === "none") return text(secret ? "degree.unaware" : "degree.noRecord");
    return text(DEGREES[degree]);
}
