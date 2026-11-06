/**
 * 一次检查的计划（docs/specs/plot/checks.md 输出 1 到 5、7、11）：圈候选、排预算、拼出每一次模型调用的输入。同步、不碰存储与模型。
 *
 * **运行与校验有效性共用它**：记录有效，当且仅当按现在的世界与正文重新算一遍，调用集合与每个输入的摘要都与记录相同。所以这里读的一切
 * 都要按第 N 章的位置取，不能读“之后的世界”，否则之后的改动会让这一章的记录平白过期；`dependencies.ts` 的依赖摘要要覆盖这里读的一切。
 *
 * 写手上下文不在这里重拼：写完以后按计划模式读，本章计划的字段变化已经读不到（canon.model 输出 5），拼出来的不是写手当时那份，所以用
 * 随自陈存下的文字（checks.md 输入）。
 */

import {canonicalJson} from "@notnotype/nb-canon/schema";
import type {CanonReadView, Decision, ReadPosition} from "@notnotype/nb-canon/schema";

import type {AnswerKind, CheckRequest, CheckRole, SelfReport} from "../../shared/checks";
import type {InstructionSnapshot} from "../../shared/instructions";
import {involvedDecisionObjects} from "../decisions";
import type {Digest} from "../guards";
import {knowingIndex} from "../knowledge";
import {budgeted, candidatesOf, type Candidate} from "./candidates";
import {pointsAfterWriting} from "./points";
import {fixedRequest, narrowRequest, stemOf, type RuleItem} from "./questions";
import {readAppeared, segmentsOf, writtenIn, type CheckSegment} from "./segments";
import {trialsOf, type MaterialItem} from "./trial";

export type CallLayer = "presence" | "narration" | "object" | "time" | "fixed" | "reader";

export interface PlannedCall {
    readonly id: string;
    readonly layer: CallLayer;
    readonly role: CheckRole;
    /** 题面（进记录）；材料不进记录。 */
    readonly question: string;
    readonly request: CheckRequest;
    readonly digest: string;
    readonly segment?: string;
    readonly point?: string;
    readonly person?: string;
    readonly personName?: string;
    readonly object?: string;
    /** 物件层：依赖这个物件、已埋未回收的伏笔（题面写明了它们，诊断只读记录，不重新推导）。 */
    readonly foreshadows?: readonly string[];
    readonly contradicts?: boolean;
    /** 引文在这里核对：窄问题是这一段，试读是给它的材料；固定调用按段核对，见 `CheckPlan.segments`。 */
    readonly paragraphs: readonly string[];
}

export interface PlannedSegment {
    readonly id: string;
    readonly line: string;
    readonly from: number;
    readonly to: number;
    readonly paragraphs: readonly string[];
}

export interface UnaskedCandidate {
    readonly id: string;
    readonly layer: CallLayer;
}

export interface PlannedTrial {
    readonly point: string;
    readonly truth: string;
    readonly materialKind: "suspense" | "twoChapters";
    readonly material: readonly MaterialItem[];
}

export interface CheckPlan {
    readonly chapter: string;
    readonly segments: readonly PlannedSegment[];
    readonly calls: readonly PlannedCall[];
    readonly rules: readonly RuleItem[];
    readonly trials: readonly PlannedTrial[];
    readonly unasked: readonly UnaskedCandidate[];
    /** 没记 `cast` 的已写变更条数：它们不提供候选（输出 2）。 */
    readonly uncast: number;
    readonly noSuspense: readonly string[];
    readonly noReaderQuestion: readonly string[];
    /** 本章涉及的知识点（各段的并集）：依赖摘要只看它们后面有没有明说揭示。 */
    readonly points: readonly string[];
    /** 本章涉及的条目（各段的 `chapterEntries` 加知识点）：依赖摘要只看挂在它们上的决策。 */
    readonly concerns: readonly string[];
}

export interface PlanInput {
    readonly view: CanonReadView;
    readonly chapter: string;
    readonly instruction?: InstructionSnapshot;
    readonly selfReport?: SelfReport;
    readonly followUps: readonly string[];
    readonly digest: Digest;
}

/** 一次调用输入的摘要（输出 7）。`maxTokens` 不算：加大重试不是输入变了。 */
export function inputDigest(request: {readonly system: string; readonly user: string; readonly answer: AnswerKind}, digest: Digest): string {
    return digest(canonicalJson({system: request.system, user: request.user, answer: request.answer}));
}

/**
 * 各段线上已出场的条目的名字与别名：新事实带 `name` 时按它查“世界里有没有”（输出 3）。只有跑检查时要，校验有效性时不要：读全部条目要几十毫秒，不放进 `planCheck`。
 * 同样要在第一次 `await` 之前算完。
 */
export function namesOfSegments(view: CanonReadView, chapter: string, instruction: InstructionSnapshot | undefined): ReadonlyMap<string, ReadonlySet<string>> {
    const segments = segmentsOf(view, chapter, instruction);
    if (typeof segments === "string") return new Map();
    const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
    return new Map(segments.map((segment) => {
        const names = new Set<string>();
        for (const entry of segment.view.entries()) {
            if (entry.deleted === true) continue;
            const read = readAppeared(segment.view, entry.id, end);
            if (read === null) continue;
            names.add(read.name);
            for (const alias of read.aliases) names.add(alias);
        }
        return [segment.id, names];
    }));
}

/** 写作指示写成给模型看的几行。 */
function instructionLines(segment: CheckSegment, instruction: InstructionSnapshot | undefined, end: ReadPosition): string[] {
    if (instruction === undefined) return [];
    return [
        ...(instruction.pov === undefined ? [] : [`视角人物：${readAppeared(segment.view, instruction.pov.id, end)?.name ?? instruction.pov.id}`]),
        ...(instruction.povMode === undefined ? [] : [`视角方式：${{first: "第一人称", limited: "有限视角", omniscient: "全知"}[instruction.povMode]}`]),
        ...(instruction.readerChange === undefined ? [] : [`读完这一章读者该有什么变化：${instruction.readerChange}`]),
        ...(instruction.tone === undefined ? [] : [`语气：${instruction.tone}`]),
        ...(instruction.opening === undefined ? [] : [`开场：${instruction.opening}`]),
        ...(instruction.ending === undefined ? [] : [`结尾：${instruction.ending}`]),
        ...(instruction.avoid === undefined || instruction.avoid.length === 0 ? [] : [`不写的：${instruction.avoid.join("；")}`]),
        ...(instruction.other === undefined ? [] : [`其他：${instruction.other}`]),
    ];
}

/** 固定调用的规则项（输出 3）。 */
function ruleItems(input: PlanInput, segments: readonly CheckSegment[], pointsBySegment: ReadonlyMap<string, readonly string[]>): RuleItem[] {
    const {instruction, chapter, digest} = input;
    const rules: RuleItem[] = [];
    if (instruction?.pov !== undefined && (instruction.povMode === "first" || instruction.povMode === "limited")) {
        const pov = instruction.pov.id;
        const end: ReadPosition = {kind: "chapter", chapter, edge: "end"};
        for (const segment of segments) {
            // 视角人物还没出场时不读他（写作指示不经内核校验）。
            const read = readAppeared(segment.view, pov, end);
            const knowing = knowingIndex(segment.view, "actual", segment.position);
            const rows = read === null ? [] : (pointsBySegment.get(segment.id) ?? []).flatMap((point) => {
                const row = knowing.effective(pov, point);
                const known = readAppeared(segment.view, point, end);
                return known === null ? [] : [`${known.name}：${row?.程度 ?? "没有记录"}`];
            });
            rules.push({item: `pov:${segment.id}`, segment: segment.id, text: `段 ${segment.id} 里，叙述有没有越出视角人物${read?.name ?? pov}能知道、能看到的范围？他的知情：${rows.join("；") || "没有记录"}`});
        }
    }
    if (instruction?.ending !== undefined) rules.push({item: "ending", text: `写作指示要结尾停在“${instruction.ending}”。整章末尾有没有没停住（写过了头，或没写到）？`});
    for (const text of instruction?.avoid ?? []) rules.push({item: `avoid:${digest(text).slice(0, 16)}`, text: `写作指示说不写：${text}。正文有没有写了？`});
    // 决策取各段的线的并集，按 id 去重：同一条决策挂在两条线的条目上也只问一次。
    const decisions = new Map<string, Decision>();
    for (const segment of segments) {
        for (const decision of involvedDecisionObjects(segment.view, chapter, "actual", pointsBySegment.get(segment.id) ?? [])) decisions.set(decision.id, decision);
    }
    for (const [id, decision] of [...decisions].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (decision.status === "decided") for (const [index, constraint] of (decision.constraints ?? []).entries()) rules.push({item: `constraint:${id}:${String(index)}`, decision: id, text: `作者定下的约束：${constraint}。正文有没有违反？`});
        if (decision.status === "pending") rules.push({item: `pending:${id}`, decision: id, text: `这件事作者还没定：${decision.text}。正文有没有把它写死？`});
    }
    return rules;
}

function narrowCall(candidate: Candidate, segment: CheckSegment, view: CanonReadView, chapter: string, digest: Digest): PlannedCall {
    const stem = stemOf(view, candidate, {kind: "chapter", chapter, edge: "end"});
    const request = narrowRequest(segment.paragraphs, stem, candidate.layer === "object" ? "object" : "yesNo");
    return {
        id: candidate.id,
        layer: candidate.layer,
        role: "ledger",
        question: stem,
        request,
        digest: inputDigest(request, digest),
        segment: candidate.segment,
        ...(candidate.layer === "presence" || candidate.layer === "narration" ? {point: candidate.point, personName: candidate.personName, ...(candidate.person === undefined ? {} : {person: candidate.person})} : {}),
        ...(candidate.layer === "presence" ? {contradicts: candidate.contradicts} : {}),
        ...(candidate.layer === "object" ? {object: candidate.object, foreshadows: candidate.stages.map((stage) => stage.foreshadow)} : {}),
        paragraphs: segment.paragraphs,
    };
}

export function planCheck(input: PlanInput): CheckPlan | {readonly code: "chapter-not-found" | "line-not-found"} {
    const {view, chapter, instruction, selfReport, followUps, digest} = input;
    const segments = segmentsOf(view, chapter, instruction);
    if (typeof segments === "string") return {code: segments};
    const text = view.chapterText(chapter) ?? "";
    const pointsBySegment = new Map<string, readonly string[]>();
    const candidates: Candidate[] = [];
    const uncast = new Set<string>();
    for (const segment of segments) {
        const written = writtenIn(segment, chapter);
        for (const change of written) if (change.cast === undefined) uncast.add(change.id);
        const points = pointsAfterWriting(segment, chapter, written, text);
        pointsBySegment.set(segment.id, points);
        candidates.push(...candidatesOf({segment, chapter, points, written, instruction}));
    }
    const {asked, unasked} = budgeted(candidates, followUps);
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    const narrow = asked.map((candidate) => narrowCall(candidate, byId.get(candidate.segment)!, byId.get(candidate.segment)!.view, chapter, digest));

    const rules = ruleItems(input, segments, pointsBySegment);
    const fixed = fixedRequest({
        brief: selfReport?.brief ?? null,
        report: selfReport?.report ?? null,
        instructionLines: instructionLines(segments[0]!, instruction, {kind: "chapter", chapter, edge: "end"}),
        segments,
        rules,
    });
    const fixedCall: PlannedCall = {id: "fixed", layer: "fixed", role: "ledger", question: rules.map((rule) => `${rule.item}：${rule.text}`).join("\n"), request: fixed, digest: inputDigest(fixed, digest), paragraphs: segments.flatMap((segment) => segment.paragraphs)};

    // 试读按整章做；知识点的字段按第一段的线读：结果与调用时拿的是哪条线的视图无关（诊断的计算可能拿着别的线）。
    const trial = trialsOf(segments[0]!.view, chapter, [...pointsBySegment.values()].flat());
    const trialCalls: PlannedCall[] = trial.trials.map((item) => ({id: `reader:${item.point}`, layer: "reader", role: "reader", question: item.question, request: item.request, digest: inputDigest(item.request, digest), point: item.point, paragraphs: item.paragraphs}));

    const points = [...new Set([...pointsBySegment.values()].flat())].sort();
    const concerns = [...new Set([...points, ...segments.flatMap((segment) => segment.view.chapterEntries(chapter, "actual"))])].sort();
    return {
        chapter,
        segments: segments.map(({id, line, from, to, paragraphs}) => ({id, line, from, to, paragraphs})),
        calls: [...narrow, fixedCall, ...trialCalls],
        rules,
        trials: trial.trials.map(({point, truth, materialKind, material}) => ({point, truth, materialKind, material})),
        unasked: [...unasked.map((candidate) => ({id: candidate.id, layer: candidate.layer})), ...trial.unasked.map((point) => ({id: `reader:${point}`, layer: "reader" as const}))],
        uncast: uncast.size,
        noSuspense: trial.noSuspense,
        noReaderQuestion: trial.noReaderQuestion,
        points,
        concerns,
    };
}
