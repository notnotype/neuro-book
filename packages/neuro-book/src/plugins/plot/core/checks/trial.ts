/**
 * 试读（docs/specs/plot/checks.md 输出 4）：只给与问题有关的原文、不给真相，问读者会怎么猜。
 *
 * 读者读的是活页夹的正文，回溯段里子线上的讲述也算读过：节点与揭示都按活页夹跨线取（同 `readerTellings`），不能只在一张视图上读。
 *
 * 程序往材料里加的文字只有“第几节”这样的序号：不给章 id、章标题、线名、段的身份，它们都可能带着真相（线名可以叫“管家线”）。
 * 原文写明了命题就照给：读者读到的就是这样，读出来报提前泄底正是这项检查要查的。
 */

import {paragraphsOf} from "@notnotype/nb-canon/schema";
import type {CanonReadView, ReadPosition, TellingPosition} from "@notnotype/nb-canon/schema";

import type {CheckRequest, TrialAnswer} from "../../shared/checks";
import {MARK_IDS} from "../../shared/declarations";
import {foreshadowIndex} from "../foreshadowing";
import {readerKnowing, readerTellings} from "../knowledge";
import {perViewCache} from "../view-cache";
import {truthOf} from "./candidates";
import {readAppeared} from "./segments";

export const TRIAL_BUDGET = 3;
export const TRIAL_MAX_TOKENS = 2000;
export const JUDGE_MAX_TOKENS = 1000;

const READER_SYSTEM = [
    "你是第一次读这本小说的普通读者。下面是你读过的一些片段和你想弄清楚的一个问题。",
    "只按这些文字猜，说出你觉得是谁（是什么）、有多确定（certain 确定、strong 强烈倾向、slight 有点怀疑、none 看不出）、哪几句让你这样想（一字不差地引在 quotes 里）。",
    "用 answer 工具交回结构化的答案。",
].join("\n");

const JUDGE_SYSTEM = "下面是一件事的真相和一个读者的猜测。判断这个猜测与真相是一致（consistent）、部分一致（partial）还是不一致（inconsistent）。用 answer 工具交回。";

/** 活页夹用到的各条线的视图（读不到的跳过）。 */
function binderLines(view: CanonReadView): CanonReadView[] {
    const lines = new Set(view.chapters.flatMap((chapter) => view.chapterLines(chapter).map((segment) => segment.line)));
    return [...lines].flatMap((line) => {
        const on = line === view.line ? view : view.onLine(line, "planned");
        return "code" in on ? [] : [on];
    });
}

const revealTables = perViewCache<ReadonlyMap<string, number>>();
/**
 * 每个知识点最晚的明说揭示所在章的下标：生效的计划按安放（兑现与否都算），已写的按读者读到的讲述。试读的前提（输出 4）只看它在第 N 章之后
 * 有没有，依赖摘要也读这一张。
 */
export function revealTable(view: CanonReadView): ReadonlyMap<string, number> {
    return revealTables(view, "", () => {
        const table = new Map<string, number>();
        const note = (point: unknown, index: number) => {
            if (typeof point === "string" && index >= (table.get(point) ?? -1)) table.set(point, index);
        };
        for (const on of binderLines(view)) {
            const plans = on.changes({kind: "plan", status: "active"});
            // 被替代的计划不进任何模式（canon.model 输出 5）。
            const replaced = new Set(plans.flatMap((plan) => plan.links.flatMap((link) => (link.kind === "replaces" ? [link.plan] : []))));
            for (const plan of plans) {
                if (plan.at.kind !== "chapter" || replaced.has(plan.id)) continue;
                const index = view.chapters.indexOf(plan.at.chapter);
                if (index !== -1) for (const telling of plan.told) for (const mark of telling.marks ?? []) if (mark.kind === MARK_IDS.reveal && mark.version === 1 && mark.mode === "explicit") note(mark.point, index);
            }
        }
        for (const item of readerTellings(view, {effective: true, mark: MARK_IDS.reveal})) {
            if (item.located.kind !== "found") continue;
            const index = view.chapters.indexOf(item.located.occurrence.chapter);
            for (const mark of item.telling.marks ?? []) if (mark.kind === MARK_IDS.reveal && mark.version === 1 && mark.mode === "explicit") note(mark.point, index);
        }
        return table;
    });
}

/** 一个知识点作为答案的悬念的节点所在的段，到第 N 章为止，按活页夹章序（跨线，只取读者读到的那条线上的）。 */
function suspenseParagraphs(view: CanonReadView, point: string, chapter: string): {readonly chapter: string; readonly paragraph: number}[] | null {
    const until: TellingPosition = {chapter, edge: "end"};
    const position: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    const found = new Map<string, {chapter: string; paragraph: number}>();
    let hasSuspense = false;
    for (const on of binderLines(view)) {
        const index = foreshadowIndex(on, position, "actual");
        for (const foreshadow of index.answeredBy.get(point) ?? []) {
            if (readAppeared(on, foreshadow, position) === null) continue;
            hasSuspense = true;
            for (const node of index.nodesRead(foreshadow, until)) {
                const {chapter: at, paragraph} = node.occurrence;
                const segments = view.chapterLines(at);
                const told = segments[Math.max(segments.findLastIndex((segment) => segment.from <= paragraph), 0)]?.line;
                if (told === on.line) found.set(`${at}\u0000${String(paragraph)}`, {chapter: at, paragraph});
            }
        }
    }
    if (!hasSuspense) return null;
    const order = (at: string) => view.chapters.indexOf(at);
    return [...found.values()].sort((a, b) => order(a.chapter) - order(b.chapter) || a.paragraph - b.paragraph);
}

export interface MaterialItem {
    readonly chapter: string;
    /** 取整章时没有。 */
    readonly paragraph?: number;
}

export interface TrialPlan {
    readonly point: string;
    readonly truth: string;
    readonly secrecy: "secret" | "topSecret";
    readonly question: string;
    readonly materialKind: "suspense" | "twoChapters";
    readonly material: readonly MaterialItem[];
    /** 给它的材料的正文：引文在这里核对。 */
    readonly paragraphs: readonly string[];
    readonly request: CheckRequest;
}

export interface TrialCandidates {
    readonly trials: readonly TrialPlan[];
    readonly unasked: readonly string[];
    readonly noSuspense: readonly string[];
    readonly noReaderQuestion: readonly string[];
}

/** 一次试读的调用 id；未问清单与补问清单都用它。 */
export const readerCallId = (point: string) => `reader:${point}`;

/** 涉及本章、保密以上、读者上一章末尾还没知道、本章之后有明说揭示（计划或已写）的知识点：做试读的，或给提示的。 */
export function trialsOf(view: CanonReadView, chapter: string, points: readonly string[], followUps: readonly string[]): TrialCandidates {
    const here = view.chapters.indexOf(chapter);
    const previous = view.chapters[here - 1];
    const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    const table = revealTable(view);
    const noSuspense: string[] = [];
    const noReaderQuestion: string[] = [];
    const planned: TrialPlan[] = [];
    for (const point of [...new Set(points)].sort()) {
        // 这条最便宜，放在最前：大多数知识点之后没有明说揭示。
        if ((table.get(point) ?? -1) <= here) continue;
        const read = readAppeared(view, point, end);
        if (read === null) continue;
        const secrecyValue = read.namespaces.point?.fields.保密?.value ?? "secret";
        if (secrecyValue !== "secret" && secrecyValue !== "topSecret") continue;
        if (previous !== undefined && readerKnowing(view, point, {chapter: previous, edge: "end"}) === "knows") continue;
        const question = read.namespaces.point?.fields.读者问题?.value;
        // 读者问题里写了命题（简介、名字或别名）：题面就泄底了，不做。比 Spec 的下限多查名字与别名。
        const leaks = typeof question === "string" && [read.summary, read.name, ...read.aliases].some((text) => text !== "" && question.includes(text));
        if (typeof question !== "string" || question.trim() === "" || leaks) {
            noReaderQuestion.push(point);
            continue;
        }
        const suspense = suspenseParagraphs(view, point, chapter);
        if (suspense === null) noSuspense.push(point);
        planned.push(buildTrial(view, chapter, previous, point, truthOf(read), secrecyValue, question, suspense));
    }
    const rank = (trial: TrialPlan) => (trial.secrecy === "topSecret" ? 0 : 1);
    const sorted = planned.sort((a, b) => rank(a) - rank(b) || (a.point < b.point ? -1 : 1));
    // 补问清单里仍是候选的，预算之外再加（输出 5）。
    const wanted = new Set(followUps);
    const beyond = sorted.slice(TRIAL_BUDGET);
    const extra = beyond.filter((trial) => wanted.has(readerCallId(trial.point)));
    return {trials: [...sorted.slice(0, TRIAL_BUDGET), ...extra], unasked: beyond.filter((trial) => !extra.includes(trial)).map((trial) => trial.point), noSuspense, noReaderQuestion};
}

function buildTrial(view: CanonReadView, chapter: string, previous: string | undefined, point: string, truth: string, secrecy: "secret" | "topSecret", question: string, suspense: readonly {readonly chapter: string; readonly paragraph: number}[] | null): TrialPlan {
    const whole = new Set([previous, chapter].filter((id) => id !== undefined));
    const sections: string[] = [];
    const material: MaterialItem[] = [];
    const paragraphs: string[] = [];
    const add = (text: string) => {
        sections.push(`第 ${String(sections.length + 1)} 节\n${text}`);
    };
    for (const node of suspense ?? []) {
        if (whole.has(node.chapter)) continue;
        const text = paragraphsOf(view.chapterText(node.chapter) ?? "")[node.paragraph - 1]?.text;
        if (text === undefined) continue;
        add(text);
        material.push({chapter: node.chapter, paragraph: node.paragraph});
        paragraphs.push(text);
    }
    for (const id of whole) {
        const lines = paragraphsOf(view.chapterText(id) ?? "").map((paragraph) => paragraph.text);
        add(lines.join("\n"));
        material.push({chapter: id});
        paragraphs.push(...lines);
    }
    return {
        point,
        truth,
        secrecy,
        question,
        materialKind: suspense === null ? "twoChapters" : "suspense",
        material,
        paragraphs,
        request: {system: READER_SYSTEM, user: `${sections.join("\n\n")}\n\n你想弄清楚的问题：${question}`, answer: "trial", maxTokens: TRIAL_MAX_TOKENS},
    };
}

/** 判一致的请求（输出 4）：输入只有试读的结构化答案与命题，结果不回给试读。 */
export function judgeRequest(truth: string, answer: TrialAnswer): CheckRequest {
    return {system: JUDGE_SYSTEM, user: `真相：${truth}\n\n读者的猜测：${answer.guess}\n确定程度：${answer.confidence}`, answer: "judge", maxTokens: JUDGE_MAX_TOKENS};
}
