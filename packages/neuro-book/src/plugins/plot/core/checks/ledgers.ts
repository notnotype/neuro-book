/**
 * 账本视图（docs/specs/plot/checks.md 输出 9）：保密账本、读者现在知道什么、改揭晓章的依赖。纯读，不调模型。
 */

import type {CanonReadView, Mode, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {DEFAULT_SECRECY, ENTRY_TYPES, MARK_IDS, type Secrecy} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {foreshadowIndex} from "../foreshadowing";
import {firstReveal, knowingIndex, readerKnowing, type KnowingRow} from "../knowledge";
import {readAppeared} from "./segments";

const secretPlus = (secrecy: unknown) => {
    const value = (typeof secrecy === "string" ? secrecy : DEFAULT_SECRECY) as Secrecy;
    return value === "secret" || value === "topSecret";
};

export interface SecretRow {
    readonly point: string;
    readonly name: string;
    readonly secrecy: string;
    readonly knows: readonly string[];
    readonly misbelieves: readonly {readonly person: string; readonly thinks: string | null}[];
    readonly suspects: readonly string[];
    readonly reader: ReturnType<typeof firstReveal>;
}

/** 保密账本：每个保密以上的知识点，在这条线、这个位置上谁知道、误信、怀疑；读者从哪一段起怀疑、知道。 */
export function secretLedger(view: CanonReadView, position: ReadPosition, mode: Mode): SecretRow[] {
    const index = knowingIndex(view, mode, position);
    const people = view.entries().filter((entry) => entry.deleted !== true && entry.type !== ENTRY_TYPES.point && entry.type !== ENTRY_TYPES.foreshadow && entry.type !== ENTRY_TYPES.goal);
    const rows = new Map<string, Map<string, KnowingRow>>();
    for (const person of people) {
        for (const row of index.all(person.id)) {
            const byPerson = rows.get(row.point) ?? new Map<string, KnowingRow>();
            byPerson.set(person.id, row);
            rows.set(row.point, byPerson);
        }
    }
    return view.entries().flatMap((entry) => {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.point) return [];
        const read = readAppeared(view, entry.id, position, mode);
        if (read === null) return [];
        const secrecy = read.namespaces.point?.fields.保密?.value;
        if (!secretPlus(secrecy)) return [];
        const held = [...(rows.get(entry.id) ?? [])].sort(([a], [b]) => (a < b ? -1 : 1));
        const who = (degree: string) => held.filter(([, row]) => row.程度 === degree).map(([person]) => person);
        return [{
            point: entry.id,
            name: read.name,
            secrecy: typeof secrecy === "string" ? secrecy : DEFAULT_SECRECY,
            knows: who("knows"),
            misbelieves: held.filter(([, row]) => row.程度 === "misbelieves").map(([person, row]) => ({person, thinks: row.他以为的 ?? null})),
            suspects: who("suspects"),
            reader: firstReveal(view, entry.id),
        }];
    }).sort((a, b) => (a.point < b.point ? -1 : 1));
}

/** 读者现在知道什么：最新一章末尾读者的程度不是 `unaware` 的知识点。 */
export function readerKnown(view: CanonReadView): {readonly point: string; readonly name: string; readonly degree: "knows" | "suspects"}[] {
    const last = view.chapters.at(-1);
    if (last === undefined) return [];
    const position: ReadPosition = {kind: "chapter", chapter: last, edge: "end"};
    return view.entries().flatMap((entry) => {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.point) return [];
        const read = readAppeared(view, entry.id, position);
        if (read === null) return [];
        const degree = readerKnowing(view, entry.id, {chapter: last, edge: "end"});
        return degree === "unaware" ? [] : [{point: entry.id, name: read.name, degree}];
    }).sort((a, b) => (a.point < b.point ? -1 : 1));
}

export interface RevealDependencies {
    readonly plans: readonly {readonly plan: string; readonly chapter: string | null; readonly mode: string}[];
    readonly foreshadows: readonly {readonly foreshadow: string; readonly name: string; readonly nodes: readonly {readonly role: string; readonly chapter: string; readonly paragraph: number}[]}[];
    readonly decisions: readonly string[];
    readonly instructions: readonly string[];
}

/** 改揭晓章的依赖：对知识点 K，哪些计划带指向 K 的揭示、哪些悬念以 K 为答案（连同节点）、哪些决策挂在 K 上（含读者守卫）、哪些章的写作指示文字里出现了 K 的名字。 */
export function revealDependencies(view: CanonReadView, point: string, instructions: readonly InstructionSnapshot[]): RevealDependencies {
    const last = view.chapters.at(-1);
    const position: ReadPosition = last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last, edge: "end"};
    const plans = (view.changes({kind: "plan", status: "active"}) as readonly StoryChange[]).flatMap((plan) => plan.told.flatMap((telling) => (telling.marks ?? []).filter((mark) => mark.kind === MARK_IDS.reveal && mark.version === 1 && mark.point === point).map((mark) => ({plan: plan.id, chapter: plan.at.kind === "chapter" ? plan.at.chapter : null, mode: String(mark.mode)}))));
    const index = foreshadowIndex(view, position, "actual");
    const until = last === undefined ? null : ({chapter: last, edge: "end"} as const);
    const foreshadows = (index.answeredBy.get(point) ?? []).map((foreshadow) => ({
        foreshadow,
        name: index.foreshadows.find((candidate) => candidate.id === foreshadow)?.name ?? foreshadow,
        nodes: index.nodesRead(foreshadow, until).map((node) => ({role: node.role, chapter: node.occurrence.chapter, paragraph: node.occurrence.paragraph})),
    }));
    const decisions = view.decisions().filter((decision) => decision.about.some((about) => about.kind === "entry" && about.id === point) || (decision.marks ?? []).some((mark) => mark.kind === MARK_IDS.guardReader && mark.point === point)).map((decision) => decision.id);
    const read = view.entry(point, position, "actual");
    const name = read === null || read === "chapter-not-found" ? null : read.name;
    const inText = (snapshot: InstructionSnapshot) => name !== null && [snapshot.readerChange, snapshot.tone, snapshot.opening, snapshot.ending, snapshot.other, ...(snapshot.avoid ?? [])].some((text) => text?.includes(name) === true);
    return {plans, foreshadows, decisions, instructions: instructions.filter(inText).map((snapshot) => snapshot.chapter)};
}
