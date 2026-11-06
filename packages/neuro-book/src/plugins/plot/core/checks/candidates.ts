/**
 * 窄问题的候选与预算（docs/specs/plot/checks.md 输出 2、5）。候选由程序圈出，每个候选一个窄问题；读者层（试读）另算，见 `trial.ts`。
 *
 * 有效知情用段的位置自己的索引，不共用最新一章的：隐秘目标推出的知情按索引的位置读，共用会让第 N 章的候选被之后的世界改变（输出 7）。
 */

import type {CanonReadView, EntryView, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {DEFAULT_SECRECY, type Secrecy} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {foreshadowIndex, type Stage} from "../foreshadowing";
import {knowingIndex, type KnowingRow} from "../knowledge";
import {readAppeared, type CheckSegment} from "./segments";

export type NarrowLayer = "presence" | "narration" | "object" | "time";

interface Base {
    readonly id: string;
    readonly layer: NarrowLayer;
    readonly segment: string;
}

export interface PresenceCandidate extends Base {
    readonly layer: "presence";
    readonly point: string;
    readonly truth: string;
    readonly secrecy: "secret" | "topSecret";
    /** 条目 id；只有 label 的人没有。 */
    readonly person?: string;
    readonly personName: string;
    readonly row: KnowingRow | null;
    /** 误信的另问：有没有与他的误信矛盾的言行。 */
    readonly contradicts: boolean;
}

export interface NarrationCandidate extends Base {
    readonly layer: "narration";
    readonly point: string;
    readonly truth: string;
    readonly secrecy: "secret" | "topSecret";
    readonly person: string;
    readonly personName: string;
    readonly row: KnowingRow | null;
}

export interface ObjectCandidate extends Base {
    readonly layer: "object";
    readonly object: string;
    readonly objectName: string;
    /** 依赖这个物件、已埋未回收的伏笔在本章开头的阶段。 */
    readonly stages: readonly {readonly foreshadow: string; readonly name: string; readonly stage: Stage}[];
    /** 读者在本章之前见没见过这个物件。 */
    readonly seenBefore: boolean;
}

export interface TimeCandidate extends Base {
    readonly layer: "time";
}

export type Candidate = PresenceCandidate | NarrationCandidate | ObjectCandidate | TimeCandidate;

/** 候选的条件里算“不知道”的程度（输出 2）。 */
const UNKNOWING = new Set(["unaware", "suspects", "forgot", "misbelieves"]);

const secrecyOf = (read: EntryView): Secrecy => {
    const value = read.namespaces.point?.fields.保密?.value;
    return typeof value === "string" ? (value as Secrecy) : DEFAULT_SECRECY;
};

/** 知识点的命题：名字，简介与名字不同时再加简介。 */
export function truthOf(read: EntryView): string {
    return read.summary === "" || read.summary === read.name ? read.name : `${read.name}（${read.summary}）`;
}

/** 这一段的知识点里保密以上的。 */
function secretPoints(view: CanonReadView, points: readonly string[], position: ReadPosition, end: ReadPosition) {
    return points.flatMap((point) => {
        // 补叙段的位置可能早于知识点出场；保密档与名字一律按章末读，题面不因补叙读不到名字。
        const read = readAppeared(view, point, position) ?? readAppeared(view, point, end);
        if (read === null) return [];
        const secrecy = secrecyOf(read);
        return secrecy === "secret" || secrecy === "topSecret" ? [{point, truth: truthOf(read), secrecy}] : [];
    });
}

/** 变更里在场的人（去重）：`who` 的按条目，只有 `label` 的按名字。 */
function presentPeople(view: CanonReadView, written: readonly StoryChange[], position: ReadPosition): {readonly person?: string; readonly name: string}[] {
    const found = new Map<string, {person?: string; name: string}>();
    for (const change of written) {
        for (const member of change.cast ?? []) {
            if (member.role !== "present") continue;
            if (member.who !== undefined) {
                const read = readAppeared(view, member.who, position);
                const mask = member.as === undefined ? null : readAppeared(view, member.as, position);
                const name = read?.name ?? member.label ?? member.who;
                found.set(member.who, {person: member.who, name: mask === null ? name : `${mask.name}（${name}）`});
            } else if (member.label !== undefined) found.set(`label:${member.label}`, {name: member.label});
        }
    }
    return [...found.values()];
}

export interface CandidateInput {
    readonly segment: CheckSegment;
    readonly chapter: string;
    readonly points: readonly string[];
    readonly written: readonly StoryChange[];
    readonly instruction: InstructionSnapshot | undefined;
}

export function candidatesOf(input: CandidateInput): Candidate[] {
    const {segment, chapter, points, written, instruction} = input;
    const {view, position, id: seg} = segment;
    const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    const knowing = knowingIndex(view, "actual", position);
    const secrets = secretPoints(view, points, position, end);
    const found: Candidate[] = [];

    for (const {point, truth, secrecy} of secrets) {
        for (const person of presentPeople(view, written, end)) {
            const row = person.person === undefined ? null : knowing.effective(person.person, point);
            if (row !== null && (row.程度 === null || !UNKNOWING.has(row.程度))) continue;
            const who = person.person ?? `label:${person.name}`;
            found.push({id: `presence:${seg}:${point}:${who}`, layer: "presence", segment: seg, point, truth, secrecy, ...(person.person === undefined ? {} : {person: person.person}), personName: person.name, row, contradicts: false});
            if (row?.程度 === "misbelieves") found.push({id: `presence-misbelief:${seg}:${point}:${who}`, layer: "presence", segment: seg, point, truth, secrecy, ...(person.person === undefined ? {} : {person: person.person}), personName: person.name, row, contradicts: true});
        }
    }

    if (instruction?.pov !== undefined && (instruction.povMode === "first" || instruction.povMode === "limited")) {
        const pov = instruction.pov.id;
        const read = readAppeared(view, pov, end);
        for (const {point, truth, secrecy} of secrets) {
            const row = knowing.effective(pov, point);
            if (row !== null && row.程度 !== "unaware" && row.程度 !== "misbelieves" && row.程度 !== "forgot") continue;
            found.push({id: `narration:${seg}:${point}`, layer: "narration", segment: seg, point, truth, secrecy, person: pov, personName: read?.name ?? pov, row});
        }
    }

    found.push(...objectCandidates(input));
    found.push({id: `time:${seg}`, layer: "time", segment: seg});
    return found;
}

/** 伏笔物件层：本章已写变更涉及、或这一段正文里出现了某个已埋未回收伏笔的物件时，每个物件一问。 */
function objectCandidates(input: CandidateInput): ObjectCandidate[] {
    const {segment, chapter, written} = input;
    const {view, id: seg} = segment;
    const start: ReadPosition = {kind: "chapter", chapter, edge: "start"};
    const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    const index = foreshadowIndex(view, start, "actual");
    const until = {chapter, edge: "start"} as const;
    const involved = new Set(written.flatMap((change) => [...change.involves, ...change.patches.map((patch) => patch.at.entry), ...(change.cast ?? []).flatMap((member) => [member.who, member.as].filter((id) => id !== undefined))]));
    const text = segment.paragraphs.join("\n");
    const here = view.chapters.indexOf(chapter);
    const byObject = new Map<string, {foreshadow: string; name: string; stage: Stage}[]>();
    for (const foreshadow of index.foreshadows) {
        if (readAppeared(view, foreshadow.id, start) === null) continue;
        const {stage} = index.stage(foreshadow.id, until);
        if (stage === "unplanted" || stage === "paidOff") continue;
        for (const object of foreshadow.objects) byObject.set(object, [...(byObject.get(object) ?? []), {foreshadow: foreshadow.id, name: foreshadow.name, stage}]);
    }
    const found: ObjectCandidate[] = [];
    for (const [object, stages] of byObject) {
        const read = readAppeared(view, object, end);
        if (read === null) continue;
        if (!involved.has(object) && ![read.name, ...read.aliases].some((name) => name !== "" && text.includes(name))) continue;
        const seenBefore = view.changes({entry: object, kind: "written", status: "active"}).some((change) => change.at.kind === "chapter" && view.chapters.indexOf(change.at.chapter) < here && view.chapters.indexOf(change.at.chapter) !== -1);
        found.push({id: `object:${seg}:${object}`, layer: "object", segment: seg, object, objectName: read.name, stages: stages.sort((a, b) => (a.foreshadow < b.foreshadow ? -1 : 1)), seenBefore});
    }
    return found;
}

/** 输出 5 的价值：叙述层、在场层（绝密）、在场层（保密）、伏笔物件层、时间层。读者层在试读那边排。 */
function rankOf(candidate: Candidate): number {
    switch (candidate.layer) {
        case "narration":
            return 0;
        case "presence":
            return candidate.secrecy === "topSecret" ? 1 : 2;
        case "object":
            return 3;
        case "time":
            return 4;
    }
}

/** 同一层按知识点、人的 id（输出 5），再按候选 id 定死。 */
function compareCandidates(a: Candidate, b: Candidate): number {
    const key = (candidate: Candidate): readonly string[] => (candidate.layer === "presence" ? [candidate.point, candidate.person ?? candidate.personName, candidate.id] : candidate.layer === "narration" ? [candidate.point, candidate.id] : [candidate.id]);
    const [ka, kb] = [key(a), key(b)];
    for (let index = 0; index < ka.length; index += 1) {
        if (ka[index]! !== kb[index]!) return ka[index]! < kb[index]! ? -1 : 1;
    }
    return 0;
}

export const NARROW_BUDGET = 20;

export interface Budgeted {
    readonly asked: readonly Candidate[];
    readonly unasked: readonly Candidate[];
}

/** 预算：按价值排，取前 `budget` 个，再加补问清单里仍是候选的（不占预算）；其余不合并，记成没问的。 */
export function budgeted(candidates: readonly Candidate[], followUps: readonly string[], budget = NARROW_BUDGET): Budgeted {
    const sorted = [...candidates].sort((a, b) => rankOf(a) - rankOf(b) || compareCandidates(a, b));
    const wanted = new Set(followUps);
    const within = sorted.slice(0, budget);
    const inside = new Set(within.map((candidate) => candidate.id));
    const extra = sorted.slice(budget).filter((candidate) => wanted.has(candidate.id));
    for (const candidate of extra) inside.add(candidate.id);
    return {asked: [...within, ...extra], unasked: sorted.filter((candidate) => !inside.has(candidate.id))};
}
