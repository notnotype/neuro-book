/**
 * 伏笔（docs/specs/plot/foreshadowing.md 输出 1 到 8）：节点、计划的节点与继承、阶段、检查与账本。只读世界引擎的只读视图，
 * 不存东西。读者那一边按活页夹正文算（讲述的发生点），阶段 B 只有主线。
 *
 * - 节点：生效的正文讲述上的 `node` 标注；悬念的答案知识点上的 `reveal` 也算这个悬念的节点（暗示算呼应，明说算回收）。
 * - 计划的节点：讲述所在的对象是计划、讲述不是正文（细纲等）上的 `node`，按计划安放的章计。别的非正文讲述上的节点忽略。
 * - 继承：兑现计划的已写变更自己的讲述上（含失联的）没有同一个伏笔的节点时，继承计划的节点，位置是它第一处生效的正文讲述；
 *   它没有生效的正文讲述时，继承的节点没有位置、不算数（提示 `nodeWithoutTelling`）。
 */

import type {CanonReadView, DiagnosticCompute, Finding, Mark, Mode, Occurrence, ReadPosition, StoryChange, TellingItem, TellingPosition} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, FS_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {countedChanges} from "./knowledge";
import {perViewCache} from "./view-cache";

export type Role = "plant" | "echo" | "mislead" | "partial" | "payoff";
export type Stage = "unplanted" | "planted" | "echoing" | "partial" | "paidOff";

export interface ForeshadowNode {
    readonly foreshadow: string;
    readonly role: Role;
    readonly note?: string;
    /** 节点所在的讲述（继承的是已写变更的第一处正文讲述）。 */
    readonly telling: string;
    readonly occurrence: Occurrence;
    /** `node`：正文讲述上的节点标注；`reveal`：悬念答案上的揭示；`inherited`：从兑现的计划继承来的。 */
    readonly source: "node" | "reveal" | "inherited";
}

export interface PlannedNode {
    readonly foreshadow: string;
    readonly role: Role;
    readonly note?: string;
    readonly plan: string;
    readonly chapter: string;
    readonly telling: string;
}

/** 继承的节点没有位置（兑现的已写变更没有生效的正文讲述）。 */
export interface HomelessNode {
    readonly foreshadow: string;
    readonly written: string;
}

interface ForeshadowEntry {
    readonly id: string;
    readonly name: string;
    readonly kind: string | null;
    readonly importance: string | null;
    readonly intent: string | null;
    readonly answer: string | null;
    readonly objects: readonly string[];
    readonly interval: number | null;
}

const STAGE_OF: Readonly<Record<Role, {readonly stage: Stage; readonly level: number}>> = {
    plant: {stage: "planted", level: 1},
    echo: {stage: "echoing", level: 2},
    mislead: {stage: "echoing", level: 2},
    partial: {stage: "partial", level: 3},
    payoff: {stage: "paidOff", level: 4},
};

/** 没设参考间隔时按重要程度的缺省（章数；用样本书量过以后再定，foreshadowing.md 输出 7）。 */
const DEFAULT_INTERVAL: Readonly<Record<string, number>> = {main: 30, side: 20, minor: 10};

const nodeMarks = (marks: readonly Mark[] | undefined) =>
    (marks ?? []).filter((mark): mark is Mark & {foreshadow: string; role: Role; note?: string} => mark.kind === MARK_IDS.node && mark.version === 1 && typeof mark.foreshadow === "string" && typeof mark.role === "string");

/** 一份只读视图在一个读取位置上的伏笔索引。 */
export class ForeshadowIndex {
    readonly foreshadows: readonly ForeshadowEntry[];
    readonly nodes: readonly ForeshadowNode[];
    readonly planned: readonly PlannedNode[];
    readonly homeless: readonly HomelessNode[];
    /** 每个答案知识点被哪些悬念指向。 */
    readonly answeredBy: ReadonlyMap<string, readonly string[]>;
    readonly #reveals: readonly {readonly point: string; readonly mode: "hint" | "explicit"; readonly item: TellingItem}[];

    constructor(
        readonly view: CanonReadView,
        readonly position: ReadPosition,
        /** 伏笔条目自己的状态（意图、答案、物件……）按这个模式折叠；读者读到的节点按正文算，与模式无关。 */
        readonly mode: Mode,
    ) {
        this.foreshadows = view.entries().filter((entry) => entry.deleted !== true && entry.type === ENTRY_TYPES.foreshadow).flatMap((entry) => {
            const read = view.entry(entry.id, position, mode);
            if (read === null || read === "chapter-not-found" || read.deleted) return [];
            const fields = read.namespaces.fs?.fields ?? {};
            const text = (field: string) => (typeof fields[field]?.value === "string" ? (fields[field]!.value as string) : null);
            const answer = (fields.答案?.value as {ref?: unknown} | null | undefined)?.ref;
            const objects = Array.isArray(fields.物件?.value) ? (fields.物件!.value as Array<{id?: unknown}>).flatMap((item) => (typeof item.id === "string" ? [item.id] : [])) : [];
            const interval = typeof fields.参考间隔?.value === "number" ? (fields.参考间隔.value as number) : null;
            return [{id: entry.id, name: read.name, kind: text("种类"), importance: text("重要程度"), intent: text("意图"), answer: typeof answer === "string" ? answer : null, objects, interval}];
        });
        const answeredBy = new Map<string, string[]>();
        for (const foreshadow of this.foreshadows) if (foreshadow.kind === "mystery" && foreshadow.answer !== null) answeredBy.set(foreshadow.answer, [...(answeredBy.get(foreshadow.answer) ?? []), foreshadow.id]);
        this.answeredBy = answeredBy;

        const nodes: ForeshadowNode[] = [];
        const reveals: {point: string; mode: "hint" | "explicit"; item: TellingItem}[] = [];
        const effective = view.tellings({effective: true});
        for (const item of effective) {
            if (item.located.kind !== "found") continue;
            for (const mark of nodeMarks(item.telling.marks)) nodes.push({foreshadow: mark.foreshadow, role: mark.role, ...(mark.note === undefined ? {} : {note: mark.note}), telling: item.telling.id, occurrence: item.located.occurrence, source: "node"});
            for (const mark of item.telling.marks ?? []) {
                if (mark.kind !== MARK_IDS.reveal || mark.version !== 1 || typeof mark.point !== "string") continue;
                const mode = mark.mode === "explicit" ? "explicit" : "hint";
                reveals.push({point: mark.point, mode, item});
                for (const mystery of answeredBy.get(mark.point) ?? []) nodes.push({foreshadow: mystery, role: mode === "explicit" ? "payoff" : "echo", telling: item.telling.id, occurrence: item.located.occurrence, source: "reveal"});
            }
        }
        this.#reveals = reveals;

        // 计划的节点：计划的非正文讲述上的节点。
        const planned: PlannedNode[] = [];
        for (const plan of view.changes({kind: "plan", status: "active"})) {
            if (plan.at.kind !== "chapter") continue;
            for (const telling of plan.told) {
                if (telling.source === "chapter") continue;
                for (const mark of nodeMarks(telling.marks)) planned.push({foreshadow: mark.foreshadow, role: mark.role, ...(mark.note === undefined ? {} : {note: mark.note}), plan: plan.id, chapter: plan.at.chapter, telling: telling.id});
            }
        }
        this.planned = planned;

        // 继承：兑现计划的已写变更自己没有同一伏笔的节点时，继承到它第一处生效的正文讲述上。
        const homeless: HomelessNode[] = [];
        const byChange = new Map<string, TellingItem[]>();
        for (const item of effective) if (item.owner.kind === "change" && item.located.kind === "found") byChange.set(item.owner.id, [...(byChange.get(item.owner.id) ?? []), item]);
        for (const written of view.changes({kind: "written", status: "active"})) {
            const fulfilled = written.links.filter((link) => link.kind === "fulfills").map((link) => link.plan);
            if (fulfilled.length === 0) continue;
            // 兑现没有发生（套不上）就不继承：计划这时回到未兑现（model.md 输出 13）。
            if (written.patches.length > 0 && view.outcome(written.id)?.applied !== true) continue;
            // “自己的讲述上”按全部讲述算（含失联的）：作者自己标过的节点因改稿失联时，不拿计划的节点顶上。悬念答案上的揭示也是
            // 这个悬念的节点（输出 3）：作者把回收改成暗示时，不拿计划的回收顶上。
            const own = new Set(written.told.flatMap((telling) => [
                ...nodeMarks(telling.marks).map((mark) => mark.foreshadow),
                ...(telling.marks ?? []).flatMap((mark) => (mark.kind === MARK_IDS.reveal && mark.version === 1 && typeof mark.point === "string" ? (answeredBy.get(mark.point) ?? []) : [])),
            ]));
            const first = byChange.get(written.id)?.[0];
            for (const node of planned) {
                if (!fulfilled.includes(node.plan) || own.has(node.foreshadow)) continue;
                if (first === undefined || first.located.kind !== "found") {
                    homeless.push({foreshadow: node.foreshadow, written: written.id});
                    continue;
                }
                nodes.push({foreshadow: node.foreshadow, role: node.role, ...(node.note === undefined ? {} : {note: node.note}), telling: first.telling.id, occurrence: first.located.occurrence, source: "inherited"});
            }
        }
        this.homeless = homeless;
        // 同一发生点按讲述 id 的数值部分排（model.md 输出 27），不按节点是先加进来的还是继承来的。
        this.nodes = nodes.sort((a, b) => compareOccurrence(view, a.occurrence, b.occurrence) || compareTellingIds(a.telling, b.telling));
    }

    /** 读到讲述位置 P 为止的节点。 */
    nodesRead(foreshadow: string, until: TellingPosition | null): ForeshadowNode[] {
        if (until === null) return [];
        return this.nodes.filter((node) => node.foreshadow === foreshadow && readBy(this.view, node.occurrence, until));
    }

    /** 阶段（输出 2）：读过的节点里最高的一级；意图为放弃另显示。 */
    stage(foreshadow: string, until: TellingPosition | null): {readonly stage: Stage; readonly dropped: boolean} {
        let best: {stage: Stage; level: number} = {stage: "unplanted", level: 0};
        for (const node of this.nodesRead(foreshadow, until)) if (STAGE_OF[node.role].level > best.level) best = STAGE_OF[node.role];
        const entry = this.foreshadows.find((candidate) => candidate.id === foreshadow);
        return {stage: best.stage, dropped: entry?.intent === "dropped"};
    }

    reveals(): readonly {readonly point: string; readonly mode: "hint" | "explicit"; readonly item: TellingItem}[] {
        return this.#reveals;
    }
}

/** 讲述 id 的先后：按数值部分（`t9` 在 `t10` 之前）。 */
function compareTellingIds(a: string, b: string): number {
    return Number(a.replace(/\D/gu, "")) - Number(b.replace(/\D/gu, "")) || (a < b ? -1 : a > b ? 1 : 0);
}

function compareOccurrence(view: CanonReadView, a: Occurrence, b: Occurrence): number {
    const chapter = view.chapters.indexOf(a.chapter) - view.chapters.indexOf(b.chapter);
    return chapter !== 0 ? chapter : a.paragraph - b.paragraph || a.offset - b.offset;
}

function readBy(view: CanonReadView, occurrence: Occurrence, until: TellingPosition): boolean {
    const at = view.chapters.indexOf(until.chapter);
    const here = view.chapters.indexOf(occurrence.chapter);
    if (at < 0 || here < 0) return false;
    if (here !== at) return here < at;
    if ("edge" in until) return until.edge === "end";
    return occurrence.paragraph <= until.paragraph;
}

/** 读取位置换成讲述位置：初值时什么都没读。 */
export function tellingPositionOf(position: ReadPosition): TellingPosition | null {
    return position.kind === "initial" ? null : {chapter: position.chapter, edge: position.edge};
}

const foreshadowIndexes = perViewCache<ForeshadowIndex>();
/** 一份视图在一个读取位置上的伏笔索引：诊断与账本共用（缓存见 `view-cache.ts`）。 */
export function foreshadowIndex(view: CanonReadView, position: ReadPosition, mode: Mode): ForeshadowIndex {
    return foreshadowIndexes(view, `${mode}|${JSON.stringify(position)}`, () => new ForeshadowIndex(view, position, mode));
}

const ref = (kind: "entry" | "change", id: string) => ({kind, id}) as const;
const placementOfChange = (view: CanonReadView, id: string): Finding["at"] | undefined => {
    const change = view.object({kind: "change", id}) as StoryChange | undefined;
    return change === undefined ? undefined : {kind: "placement", placement: change.at};
};

/** 没埋就回收（输出 6）：一个伏笔的回收（或部分回收）节点之前没有埋下的节点。 */
const payoffBeforePlant: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    const findings: Finding[] = [];
    for (const foreshadow of index.foreshadows) {
        let planted = false;
        for (const node of index.nodesRead(foreshadow.id, until)) {
            if (node.role === "plant") planted = true;
            if ((node.role === "payoff" || node.role === "partial") && !planted) {
                findings.push({key: {objects: [ref("entry", foreshadow.id)], telling: node.telling}, at: {kind: "telling", telling: node.telling}, objects: [ref("entry", foreshadow.id)], params: {role: node.role}});
                break;
            }
        }
    }
    return findings;
};

/** 回收以后又埋（输出 6）：已回收以后又有埋下的节点，每个这样的埋下节点一条。 */
const replantAfterPayoff: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    const findings: Finding[] = [];
    for (const foreshadow of index.foreshadows) {
        let paid = false;
        for (const node of index.nodesRead(foreshadow.id, until)) {
            if (node.role === "payoff") paid = true;
            else if (node.role === "plant" && paid) findings.push({key: {objects: [ref("entry", foreshadow.id)], telling: node.telling}, at: {kind: "telling", telling: node.telling}, objects: [ref("entry", foreshadow.id)], params: {}});
        }
    }
    return findings;
};

/**
 * 计划的节点没写（输出 6）：带伏笔节点的计划安放在第 N 章，第 N 章已经有已写的剧情变更、读取位置到了第 N 章末尾，而这条计划
 * 在第 N 章末尾仍未兑现，或兑现了但第 N 章里没有这个伏笔的节点（继承的也算）。
 */
const plannedNodeMissing: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    const atKey = view.positionKey(at);
    const findings: Finding[] = [];
    for (const node of index.planned) {
        const endOfChapter: ReadPosition = {kind: "chapter", chapter: node.chapter, edge: "end"};
        const endKey = view.positionKey(endOfChapter);
        if (until === null || atKey === null || endKey === null || view.compareKeys(atKey, endKey) < 0) continue;
        if (view.changes({chapter: node.chapter, kind: "written", status: "active"}).length === 0) continue;
        const fulfilled = view.progress(node.plan, endOfChapter) === "fulfilled";
        const present = index.nodes.some((candidate) => candidate.foreshadow === node.foreshadow && candidate.occurrence.chapter === node.chapter);
        if (fulfilled && present) continue;
        findings.push({key: {objects: [ref("entry", node.foreshadow), ref("change", node.plan)], line: view.line}, ...withAt(placementOfChange(view, node.plan)), objects: [ref("entry", node.foreshadow), ref("change", node.plan)], params: {reason: fulfilled ? "no-node-in-chapter" : "plan-unfulfilled", chapter: node.chapter}});
    }
    return findings;
};

const withAt = (at: Finding["at"] | undefined) => (at === undefined ? {} : {at});

/** 已埋、没回收（读到这个位置为止）。 */
function plantedNotPaid(index: ForeshadowIndex, foreshadow: string, until: TellingPosition | null): boolean {
    const {stage} = index.stage(foreshadow, until);
    return stage !== "unplanted" && stage !== "paidOff";
}

/** 没排回收（输出 7）：已埋、没回收，也没有带回收节点的计划。 */
const noPayoffPlanned: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    return index.foreshadows.filter((foreshadow) => plantedNotPaid(index, foreshadow.id, until) && !index.planned.some((node) => node.foreshadow === foreshadow.id && node.role === "payoff"))
        .map((foreshadow) => ({key: {objects: [ref("entry", foreshadow.id)], line: view.line}, objects: [ref("entry", foreshadow.id)], params: {}}));
};

/** 太久没提（输出 7）：已埋、没回收，从最后一个节点到读取位置所在章超过参考间隔。 */
const longSilence: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    if (until === null) return [];
    const now = view.chapters.indexOf(until.chapter);
    const findings: Finding[] = [];
    for (const foreshadow of index.foreshadows) {
        if (!plantedNotPaid(index, foreshadow.id, until)) continue;
        const last = index.nodesRead(foreshadow.id, until).at(-1);
        if (last === undefined) continue;
        const interval = foreshadow.interval ?? DEFAULT_INTERVAL[foreshadow.importance ?? "side"] ?? DEFAULT_INTERVAL.side!;
        const silent = now - view.chapters.indexOf(last.occurrence.chapter);
        if (silent > interval) findings.push({key: {objects: [ref("entry", foreshadow.id)]}, objects: [ref("entry", foreshadow.id)], params: {chapters: silent, interval}});
    }
    return findings;
};

/** 放弃了还留着（输出 7）：意图为放弃，正文里还有生效的埋下节点。 */
const droppedButPlanted: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    return index.foreshadows.filter((foreshadow) => foreshadow.intent === "dropped" && index.nodesRead(foreshadow.id, until).some((node) => node.role === "plant"))
        .map((foreshadow) => ({key: {objects: [ref("entry", foreshadow.id)]}, objects: [ref("entry", foreshadow.id)], params: {}}));
};

/** 没有悬念认领的暗示（输出 7）：一处暗示的揭示指向的知识点，没有任何悬念的答案指向它。 */
const orphanHint: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    return index.reveals().filter((reveal) => reveal.mode === "hint" && !index.answeredBy.has(reveal.point) && until !== null && reveal.item.located.kind === "found" && readBy(view, reveal.item.located.occurrence, until))
        .map((reveal) => ({key: {objects: [ref("entry", reveal.point)], telling: reveal.item.telling.id}, at: {kind: "telling" as const, telling: reveal.item.telling.id}, objects: [ref("entry", reveal.point)], params: {}}));
};

/**
 * 物件在回收之前被动过（输出 7）：伏笔已埋、没回收期间——安放在最早的埋下节点所在章之后（同一章不算）、最后一次回收所在章之前
 * （还没回收就到读取位置为止）——有生效、套上的剧情变更的补丁改了物件条目的状态。
 */
const objectTouched: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    const findings: Finding[] = [];
    // 已写、生效、套上的才算“动过”（计划还没发生）。
    const counted = countedChanges(view, "actual", at);
    for (const foreshadow of index.foreshadows) {
        if (foreshadow.objects.length === 0) continue;
        const read = index.nodesRead(foreshadow.id, until);
        const plant = read.find((node) => node.role === "plant");
        if (plant === undefined) continue;
        const payoffs = read.filter((node) => node.role === "payoff");
        const from = view.chapters.indexOf(plant.occurrence.chapter);
        const to = payoffs.length === 0 ? Number.POSITIVE_INFINITY : view.chapters.indexOf(payoffs.at(-1)!.occurrence.chapter);
        for (const change of counted) {
            if (change.at.kind !== "chapter") continue;
            const chapter = view.chapters.indexOf(change.at.chapter);
            if (chapter <= from || chapter >= to) continue;
            for (const object of foreshadow.objects) {
                if (!change.patches.some((patch) => patch.at.entry === object)) continue;
                findings.push({key: {objects: [ref("entry", foreshadow.id), ref("entry", object), ref("change", change.id)], line: view.line}, at: {kind: "placement", placement: change.at}, objects: [ref("entry", foreshadow.id), ref("entry", object), ref("change", change.id)], params: {}});
            }
        }
    }
    return findings;
};

/** 几个悬念同一个答案（输出 3）。 */
const sharedAnswer: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    return [...index.answeredBy].filter(([, mysteries]) => mysteries.length > 1).map(([point, mysteries]) => ({key: {objects: [ref("entry", point)]}, objects: [ref("entry", point), ...mysteries.map((id) => ref("entry", id))], params: {count: mysteries.length}}));
};

/** 继承的节点没有位置（输出 4）。 */
const nodeWithoutTelling: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    // 只报读取位置之前安放的已写变更（之后写的还没发生）。
    const limit = view.positionKey(at);
    const before = (change: string) => {
        const key = view.eventKey(change, "actual");
        return limit !== null && key !== null && view.compareKeys(key, limit) < 0;
    };
    return index.homeless.filter((node) => before(node.written)).map((node) => ({key: {objects: [ref("entry", node.foreshadow), ref("change", node.written)], line: view.line}, ...withAt(placementOfChange(view, node.written)), objects: [ref("entry", node.foreshadow), ref("change", node.written)], params: {}}));
};

/** 悬念回收了却没揭示答案（输出 7）：悬念的回收节点（已写的或计划的）所在的那一章，没有对它答案的明说揭示。 */
const payoffWithoutReveal: DiagnosticCompute = (view, at, mode) => {
    const index = foreshadowIndex(view, at, mode);
    const until = tellingPositionOf(at);
    const findings: Finding[] = [];
    const explicitIn = (point: string, chapter: string) => index.reveals().some((reveal) => reveal.point === point && reveal.mode === "explicit" && reveal.item.located.kind === "found" && reveal.item.located.occurrence.chapter === chapter);
    for (const foreshadow of index.foreshadows) {
        if (foreshadow.kind !== "mystery" || foreshadow.answer === null) continue;
        const payoffs = [
            // 已写的回收按读到读取位置为止的算；计划的回收按计划本身查（它说了要在那一章回收）。
            ...index.nodesRead(foreshadow.id, until).filter((node) => node.role === "payoff" && node.source !== "reveal").map((node) => ({chapter: node.occurrence.chapter, telling: node.telling})),
            ...index.planned.filter((node) => node.foreshadow === foreshadow.id && node.role === "payoff").map((node) => ({chapter: node.chapter, telling: node.telling})),
        ];
        for (const payoff of payoffs) {
            if (explicitIn(foreshadow.answer, payoff.chapter)) continue;
            findings.push({key: {objects: [ref("entry", foreshadow.id)], telling: payoff.telling}, objects: [ref("entry", foreshadow.id), ref("entry", foreshadow.answer)], params: {chapter: payoff.chapter}});
        }
    }
    return findings;
};

/** 剧情插件登记给 canon 的伏笔诊断的计算，按诊断 id。 */
export function foreshadowDiagnostics(): Readonly<Record<string, DiagnosticCompute>> {
    return {
        [FS_DIAGNOSTIC_IDS.payoffBeforePlant]: payoffBeforePlant,
        [FS_DIAGNOSTIC_IDS.plannedNodeMissing]: plannedNodeMissing,
        [FS_DIAGNOSTIC_IDS.replantAfterPayoff]: replantAfterPayoff,
        [FS_DIAGNOSTIC_IDS.noPayoffPlanned]: noPayoffPlanned,
        [FS_DIAGNOSTIC_IDS.longSilence]: longSilence,
        [FS_DIAGNOSTIC_IDS.droppedButPlanted]: droppedButPlanted,
        [FS_DIAGNOSTIC_IDS.orphanHint]: orphanHint,
        [FS_DIAGNOSTIC_IDS.objectTouched]: objectTouched,
        [FS_DIAGNOSTIC_IDS.sharedAnswer]: sharedAnswer,
        [FS_DIAGNOSTIC_IDS.nodeWithoutTelling]: nodeWithoutTelling,
        [FS_DIAGNOSTIC_IDS.payoffWithoutReveal]: payoffWithoutReveal,
    };
}

export interface LedgerFilter {
    readonly stage?: Stage;
    readonly importance?: string;
    readonly intent?: string;
    readonly from?: string;
    readonly to?: string;
}

/** 账本（输出 8）：每个伏笔的阶段、节点、计划的节点、最后一次被提到的章、物件与它们最近一次被改的变更。 */
export function ledger(view: CanonReadView, position: ReadPosition, mode: Mode, filter: LedgerFilter = {}) {
    const index = foreshadowIndex(view, position, mode);
    const until = tellingPositionOf(position);
    const counted = countedChanges(view, mode, position);
    const inRange = (chapter: string) => {
        const at = view.chapters.indexOf(chapter);
        return (filter.from === undefined || at >= view.chapters.indexOf(filter.from)) && (filter.to === undefined || at <= view.chapters.indexOf(filter.to));
    };
    return index.foreshadows.flatMap((foreshadow) => {
        const stage = index.stage(foreshadow.id, until);
        const nodes = index.nodesRead(foreshadow.id, until);
        const planned = index.planned.filter((node) => node.foreshadow === foreshadow.id);
        if (filter.stage !== undefined && stage.stage !== filter.stage) return [];
        if (filter.importance !== undefined && foreshadow.importance !== filter.importance) return [];
        if (filter.intent !== undefined && foreshadow.intent !== filter.intent) return [];
        if ((filter.from !== undefined || filter.to !== undefined) && !nodes.some((node) => inRange(node.occurrence.chapter)) && !planned.some((node) => inRange(node.chapter))) return [];
        const objects = foreshadow.objects.map((object) => {
            const last = [...counted].reverse().find((change) => change.patches.some((patch) => patch.at.entry === object));
            return {id: object, ...(last === undefined ? {} : {lastChange: last.id})};
        });
        return [{
            id: foreshadow.id,
            name: foreshadow.name,
            kind: foreshadow.kind,
            importance: foreshadow.importance,
            intent: foreshadow.intent,
            stage: stage.stage,
            dropped: stage.dropped,
            nodes: nodes.map((node) => ({role: node.role, chapter: node.occurrence.chapter, paragraph: node.occurrence.paragraph, telling: node.telling, source: node.source, ...(node.note === undefined ? {} : {note: node.note})})),
            planned: planned.map((node) => ({role: node.role, chapter: node.chapter, plan: node.plan, ...(node.note === undefined ? {} : {note: node.note})})),
            lastMentioned: nodes.at(-1)?.occurrence.chapter ?? null,
            objects,
        }];
    });
}
