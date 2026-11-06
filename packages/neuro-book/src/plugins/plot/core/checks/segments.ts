/**
 * 检查的单位：章里的一段线（docs/specs/plot/checks.md 输出 11）。一章按活页夹分段，段的身份是“这条线在本章里第几次出现”（`main#2`），
 * 只在本章段的线序变了时才变。候选读段的故事位置（输出 2）：普通章是章末，补叙段是声明的安放，与写手上下文同一个口径（`framesOf`）。
 */

import {paragraphsOf} from "@notnotype/nb-canon/schema";
import type {CanonReadView, EntryView, Mode, Placement, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import type {InstructionSnapshot} from "../../shared/instructions";
import {framesOf, type Frame} from "../brief/context";

export interface CheckSegment {
    /** 段的身份，例如 `main#2`。 */
    readonly id: string;
    readonly line: string;
    readonly view: CanonReadView;
    /** 段的第一段落与最后一段落（从 1 起，含）；这一段没有正文时 `to < from`。 */
    readonly from: number;
    readonly to: number;
    /** 这一段的正文，按段落。 */
    readonly paragraphs: readonly string[];
    /** 候选读有效知情的位置。 */
    readonly position: ReadPosition;
    /** 拼“写之前的集合”用的框架（章首或补叙的安放，按计划模式）。 */
    readonly frame: Frame;
}

/** 这一章的段。章或线读不到时给码。 */
export function segmentsOf(view: CanonReadView, chapter: string, instruction: InstructionSnapshot | undefined): CheckSegment[] | "chapter-not-found" | "line-not-found" {
    const frames = framesOf(view, chapter, instruction);
    if (typeof frames === "string") return frames;
    const told = view.chapterLines(chapter);
    const paragraphs = paragraphsOf(view.chapterText(chapter) ?? "").map((paragraph) => paragraph.text);
    const timeMode = instruction?.timeMode;
    const flashback = timeMode !== undefined && typeof timeMode !== "string" && "flashback" in timeMode;
    const seen = new Map<string, number>();
    return frames.map((frame, index) => {
        const nth = (seen.get(frame.line) ?? 0) + 1;
        seen.set(frame.line, nth);
        const from = told[index]!.from;
        const to = told[index + 1] === undefined ? paragraphs.length : told[index + 1]!.from - 1;
        return {
            id: `${frame.line}#${String(nth)}`,
            line: frame.line,
            view: frame.view,
            from,
            to,
            paragraphs: paragraphs.slice(from - 1, Math.max(to, from - 1)),
            position: flashback ? frame.position : {kind: "chapter", chapter, edge: "end"},
            frame,
        };
    });
}

/** 补叙的安放（依赖摘要要算到它那一章）；不是补叙时没有。 */
export function flashbackOf(instruction: InstructionSnapshot | undefined): Placement | undefined {
    const timeMode = instruction?.timeMode;
    return timeMode !== undefined && typeof timeMode !== "string" && "flashback" in timeMode ? (timeMode.flashback as Placement) : undefined;
}

/**
 * 读条目，没出场当没有。检查的路径上读条目都经它：出场晚于这一章的条目不影响题面，所以依赖摘要可以按出场分桶（`dependencies.ts`），
 * 之后才建的条目不会让这一章的记录过期。
 */
export function readAppeared(view: CanonReadView, id: string, position: ReadPosition, mode: Mode = "actual"): EntryView | null {
    const read = view.entry(id, position, mode);
    return read === null || read === "chapter-not-found" || read.deleted || !read.appeared ? null : read;
}

/** 一条引文落在这一段里吗（输出 6）：含换行的逐行核对，每行都要在同一段里。短于 `MIN_QUOTE` 个码点的不算有效。 */
export const MIN_QUOTE = 4;
export function quoteIn(paragraphs: readonly string[], quote: string): boolean {
    const lines = quote.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
    if (lines.length === 0 || [...lines.join("")].length < MIN_QUOTE) return false;
    return lines.every((line) => paragraphs.some((paragraph) => paragraph.includes(line)));
}

/** 这一段涉及的已写变更（输出 2）：讲述的发生点落在这一段的（包括安放在别处的补叙），加安放在本章、本章没有发生点的。 */
export function writtenIn(segment: CheckSegment, chapter: string): StoryChange[] {
    const view = segment.view;
    const told = new Map<string, number[]>();
    for (const item of view.tellings({from: chapter, to: chapter, effective: true})) {
        if (item.owner.kind !== "change" || item.located.kind !== "found" || item.located.occurrence.chapter !== chapter) continue;
        told.set(item.owner.id, [...(told.get(item.owner.id) ?? []), item.located.occurrence.paragraph]);
    }
    const counts = (change: StoryChange | undefined): change is StoryChange => change !== undefined && change.kind === "written" && change.status === "active" && change.nature !== "fork" && (change.patches.length === 0 || view.outcome(change.id)?.applied === true);
    const inHere = (paragraphs: readonly number[]) => paragraphs.some((paragraph) => paragraph >= segment.from && paragraph <= segment.to);
    const found = new Map<string, StoryChange>();
    for (const change of view.changes({chapter, kind: "written", status: "active"})) {
        if (!counts(change)) continue;
        const paragraphs = told.get(change.id);
        if (paragraphs === undefined || inHere(paragraphs)) found.set(change.id, change);
    }
    for (const [id, paragraphs] of told) {
        if (!inHere(paragraphs) || found.has(id)) continue;
        const change = view.object({kind: "change", id}) as StoryChange | undefined;
        if (counts(change)) found.set(id, change);
    }
    return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
