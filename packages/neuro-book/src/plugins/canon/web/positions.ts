/**
 * 条目页上“在哪”的几种写法（docs/specs/canon/author-ui.md 输出 7、10、11、15）：位置选择的选项、安放写成“第 N 章”“前史”、
 * 字段最近一次改动写成“第 N 章改过”。章的序号来自章表（`chapters`），不来自章 id。
 */

import type {ChangedAt, Placement, ReadPosition} from "@notnotype/nb-canon";

import type {BoundText} from "nbook/shared/use-plugin-text";

import type zhCN from "../locales/zh-CN.json";
import {MAIN_LINE} from "../shared/reads";

export type CanonBoundText = BoundText<typeof zhCN>;

/** 章表里的一章；`index` 从 1 起；`lines` 是这一章各段讲的线（从第几段起），没给时按主线。 */
export interface ChapterRef {
    readonly id: string;
    readonly index: number;
    readonly title: string | null;
    readonly lines?: readonly {readonly from: number; readonly line: string}[];
}


/**
 * 一个读取位置实际读的线（canon.worldlines 输出 12）：写了线就是它；没写时初值读主线，章的开头读第一段讲的线，末尾读最后一段的。
 * 活页夹的一段讲计划线时，实际模式里服务按它最近的实际祖先线读，这里不追（页头只用来写“此刻：线名”，认不出的线写主线）。
 */
export function chapterLine(position: ReadPosition, chapters: readonly ChapterRef[]): string {
    if (position.line !== undefined) return position.line;
    if (position.kind === "initial") return MAIN_LINE;
    const lines = chapters.find((chapter) => chapter.id === position.chapter)?.lines ?? [];
    const segment = position.edge === "start" ? lines[0] : lines.at(-1);
    return segment?.line ?? MAIN_LINE;
}

/** 把一次安放写成“第 N 章”“前史”；条目页按章表给，数据分页界面经 context 拿到同一个。 */
export type PlaceLabel = (at: Placement) => string;

export interface PositionOption {
    readonly value: string;
    readonly label: string;
}

const INITIAL = "initial";

/** 位置选择的值：“初值”是 `initial`，章的开头、末尾是 `<章 id>:start`、`<章 id>:end`。 */
export function positionValue(position: ReadPosition): string {
    return position.kind === "initial" ? INITIAL : `${position.chapter}:${position.edge}`;
}

/** `positionValue` 的反面；认不出的值得 null。 */
export function positionFromValue(value: string): ReadPosition | null {
    if (value === INITIAL) return {kind: "initial"};
    const split = value.lastIndexOf(":");
    const edge = value.slice(split + 1);
    if (split <= 0 || (edge !== "start" && edge !== "end")) return null;
    return {kind: "chapter", chapter: value.slice(0, split), edge};
}

/** 缺省的读取位置：最新一章末尾，没有章时是初值（canon.model 输出 21）。 */
export function defaultPosition(chapters: readonly {readonly id: string}[] | undefined): ReadPosition {
    const last = chapters?.at(-1);
    return last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last.id, edge: "end"};
}

/** 位置还在章表里吗：选着的那一章被删掉以后，条目页回到缺省位置（输出 7）。 */
export function positionExists(position: ReadPosition, chapters: readonly ChapterRef[]): boolean {
    return position.kind === "initial" || chapters.some((chapter) => chapter.id === position.chapter);
}

/** 依次是“初值”，然后每一章的开头、末尾。 */
export function positionOptions(chapters: readonly ChapterRef[], text: CanonBoundText): PositionOption[] {
    const options: PositionOption[] = [{value: INITIAL, label: text("position.initial")}];
    for (const chapter of chapters) {
        for (const edge of ["start", "end"] as const) {
            const label = chapter.title === null || chapter.title === ""
                ? text(edge === "start" ? "position.start" : "position.end", {index: chapter.index})
                : text(edge === "start" ? "position.startTitled" : "position.endTitled", {index: chapter.index, title: chapter.title});
            options.push({value: `${chapter.id}:${edge}`, label});
        }
    }
    return options;
}

/** 选项的文字；章已经不在章表里时退回“初值”以外的原样 id，不会发生在正常的界面上。 */
export function positionLabel(position: ReadPosition, chapters: readonly ChapterRef[], text: CanonBoundText): string {
    const value = positionValue(position);
    return positionOptions(chapters, text).find((option) => option.value === value)?.label ?? value;
}

/** 一次安放写在界面上：“第 N 章”“前史”；没安放的写“未安放”。安放的章不在章表里时同样写“未安放”。 */
export function placementLabel(at: Placement, chapters: readonly ChapterRef[], text: CanonBoundText): string {
    if (at.kind === "prehistory") return text("place.prehistory");
    return at.kind === "chapter" ? chapterLabel(at.chapter, chapters, text) : text("place.unscheduled");
}

/** 一章写在界面上：“第 N 章”；不在章表里时写“未安放”。 */
export function chapterLabel(id: string, chapters: readonly ChapterRef[], text: CanonBoundText): string {
    const chapter = chapters.find((item) => item.id === id);
    return chapter === undefined ? text("place.unscheduled") : text("place.chapter", {index: chapter.index});
}

/** 字段旁的“第 N 章改过”“前史改过”“第 N 章核对过”（输出 10）。没有最近一次改动（只有初值）时为 null。 */
export function changedMark(changedAt: ChangedAt | undefined, place: PlaceLabel, text: CanonBoundText): string | null {
    if (changedAt === undefined) return null;
    return text(changedAt.by === "check" ? "mark.checked" : "mark.changed", {place: place(changedAt.at)});
}
