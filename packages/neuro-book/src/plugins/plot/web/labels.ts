/**
 * 剧情页面上“在哪”“什么程度”的写法（docs/specs/plot/author-ui.md 术语与输出 7、16）：章写成“第 N 章”（序号来自章表，不来自章 id），
 * 前史写“前史”，程度、怎么知道、来处、保密档、阶段、决策写文字。几张表与几个分页共用，拼接用的标点也来自目录（输出 22）。
 */

import {MAIN_LINE} from "nbook/plugins/canon/shared/contracts";
import type {LineOption} from "nbook/plugins/canon/shared/contracts";

import type {AuthorDecision, AuthorDegree, AuthorKnowing, KnowingOrigin} from "../core/author/knowing";
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
    if (degree === "unset") return text("degree.unset");
    return text(DEGREES[degree]);
}

/** 一组文字用目录里的分隔符连起来（“、”或“, ”）。 */
export function listOf(items: readonly string[], text: PlotText): string {
    return items.join(text("fmt.list"));
}

const HOW = {witnessed: "knowing.how.witnessed", read: "knowing.how.read", inferred: "knowing.how.inferred", other: "knowing.how.other"} as const;

/** 怎么知道或他以为的那句（输出 16、19）：信错了写他以为的那句，别人告诉的写“听某某说”。 */
export function knowingDetail(row: AuthorKnowing, nameOf: (id: string | null) => string, text: PlotText): string {
    if (row.degree === "misbelieves" && row.belief !== null) return row.belief;
    if (row.how === "told") return text("knowing.toldBy", {name: nameOf(row.from)});
    return row.how === null ? "" : text(HOW[row.how]);
}

/** 线的名字：主线写“主线”，别的取可选的线里的名字（不在了写原样 id）。 */
export function lineNameOf(id: string, options: readonly LineOption[], text: PlotText): string {
    return id === MAIN_LINE ? text("knowing.mainLine") : (options.find((option) => option.id === id)?.name ?? id);
}

/** 来处（plot/knowledge.md 输出 11）：初值、目标出场时、从某某线带过来、第 N 章第 M 段或前史。 */
export function originLabel(origin: KnowingOrigin | null, chapters: ChapterIndex, lineName: (id: string) => string, text: PlotText): string {
    if (origin === null) return "";
    if (origin.kind === "initial") return text("knowing.origin.initial");
    if (origin.kind === "goal") return text("knowing.origin.goal");
    if (origin.kind === "carried") return text("knowing.origin.carried", {line: lineName(origin.line)});
    return placeLabel(origin, chapters, text);
}

const SECRECY = {common: "secrecy.common", trade: "secrecy.trade", secret: "secrecy.secret", topSecret: "secrecy.topSecret"} as const;

/** 保密档；认不出的档按保密写（同读取的缺省）。 */
export function secrecyLabel(secrecy: string, text: PlotText): string {
    return text(SECRECY[secrecy as keyof typeof SECRECY] ?? "secrecy.secret");
}

const STAGES = {unplanted: "ledger.stage.unplanted", planted: "ledger.stage.planted", echoing: "ledger.stage.echoing", partial: "ledger.stage.partial", paidOff: "ledger.stage.paidOff"} as const;

/** 伏笔到哪一步；放弃的写“已放弃”。 */
export function stageLabel(stage: string, dropped: boolean, text: PlotText): string {
    return dropped ? text("ledger.stage.dropped") : text(STAGES[stage as keyof typeof STAGES] ?? "ledger.stage.planted");
}

/** 一条决策（输出 8、19）：已定写结论；待定写“还没定”，有到期章另写到期。 */
export function decisionLabel(item: Pick<AuthorDecision, "text" | "status" | "conclusion" | "due">, chapters: ChapterIndex, text: PlotText): string {
    if (item.status === "decided") return text("secrets.decision.decided", {text: item.text, conclusion: item.conclusion ?? ""});
    if (item.due === null) return text("secrets.decision.pending", {text: item.text});
    return text("secrets.decision.pendingDue", {text: item.text, chapter: chapterLabel(item.due, chapters, text)});
}
