/**
 * 改动记录视图（docs/specs/canon/author-ui.md 输出 24）的一行与筛选项：把 `revisions` 读到的一项折成 `RevisionsView` 的行。
 * 还原按钮旁的原因同回执页（输出 20）：章序调整写原因、按钮不可用；有依赖的写“后面有 N 次改动依赖它”、按钮照常（对话框里列出
 * 依赖）。世界写不了（断开、只读、别人在独占写）是整个视图的事，由宿主另给，不在这里。纯函数。
 */

import type {CanonOutputs} from "../shared/contracts";
import {impactSummary} from "./impact";
import type {CanonBoundText, ChapterRef} from "./positions";
import {actorText, timeText} from "./receipt";

export type RevisionListItem = CanonOutputs["revisions"]["items"][number];
export type RevisionWriter = RevisionListItem["by"]["kind"];

/** 写入者筛选的几种，按这个顺序列（`revisions` 的筛选 `by`）。 */
export const REVISION_WRITERS: readonly RevisionWriter[] = ["author", "agent", "task", "system"];

/** 筛选“全部”的值：nb-ui 的 `Select` 不收空串作选项的值。 */
export const ALL = "all";

/** 筛选的一项（交给 nb-ui 的 `Select`）。 */
export interface FilterOption {
    readonly value: string;
    readonly label: string;
}

export interface RevisionRow {
    readonly id: string;
    readonly title: string;
    /** “作者 · 2026-11-13 14:03”。 */
    readonly meta: string;
    /** 带来的变化的一句摘要。 */
    readonly summary: string;
    /** 章序调整：还原不可用。 */
    readonly notRevertable: boolean;
    /** 还原按钮旁的一句；没有时为空。 */
    readonly note: string;
}

export function revisionRow(item: RevisionListItem, text: CanonBoundText): RevisionRow {
    const revertable = item.revertable;
    const notRevertable = !revertable.ok && revertable.reason === "not-revertable";
    const note = revertable.ok ? "" : revertable.reason === "not-revertable" ? text("revert.notRevertable") : text("receipt.dependents", {count: revertable.dependents.length});
    return {
        id: item.id,
        title: item.title,
        meta: text("revisions.meta", {by: actorText(item.by, text), time: timeText(item.time)}),
        summary: impactSummary(item.impact, text),
        notRevertable,
        note,
    };
}

/** 按章筛的选项：“全部章”，再是章表里的每一章。 */
export function chapterFilterOptions(chapters: readonly ChapterRef[], text: CanonBoundText): FilterOption[] {
    return [
        {value: ALL, label: text("revisions.allChapters")},
        ...chapters.map((chapter) => ({
            value: chapter.id,
            label: chapter.title === null || chapter.title === "" ? text("place.chapter", {index: chapter.index}) : text("receipt.chapterTitled", {index: chapter.index, title: chapter.title}),
        })),
    ];
}

/** 按写入者筛的选项。 */
export function writerFilterOptions(text: CanonBoundText): FilterOption[] {
    return [{value: ALL, label: text("revisions.allWriters")}, ...REVISION_WRITERS.map((writer) => ({value: writer, label: text(`revisions.writers.${writer}`)}))];
}

/** 两个筛选折成 `revisions` 的 `filter`；都是“全部”时不写。 */
export function revisionsFilter(chapter: string, writer: string): {readonly chapter?: string; readonly by?: RevisionWriter} {
    return {
        ...(chapter === ALL ? {} : {chapter}),
        ...((REVISION_WRITERS as readonly string[]).includes(writer) ? {by: writer as RevisionWriter} : {}),
    };
}
