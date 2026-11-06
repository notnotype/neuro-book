/**
 * 决策在剧情插件里的读取与检查（docs/specs/plot/decisions.md 输出 5、7）：涉及本章的决策、到期没定、悬空。决策本身（状态、作者
 * 来源、挂的对象）由内核存。只读世界引擎给的只读视图，不存东西。
 */

import type {CanonReadView, Decision, DiagnosticCompute, Finding, Mark, Mode, ObjectRef, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {DECISION_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {checkAddressGuard} from "./guards";
import {perViewCache} from "./view-cache";

/** 一条涉及本章的决策：结论、理由（没给时“作者没说理由”）、约束与守卫标注。 */
export interface DecisionRead {
    readonly id: string;
    readonly text: string;
    readonly status: Decision["status"];
    readonly conclusion: string | null;
    readonly reason: string;
    readonly constraints: readonly string[];
    readonly due: string | null;
    readonly about: Decision["about"];
    /** 守卫标注（`nbook.plot.guard.*`）；别的标注不在这里。地址守卫没法检查时带 `unchecked`（Spec：记“无法检查”，不进待处理）。 */
    readonly guards: readonly {readonly mark: Mark; readonly unchecked?: "incomplete" | "line-unavailable"}[];
}

export const NO_REASON = "作者没说理由";

/** 地址守卫在这张视图（这条线、这个模式）上没法检查的原因：它写明的线不可用，或地址的值不完整。 */
function uncheckedReason(view: CanonReadView, mark: Mark, mode: Mode): "incomplete" | "line-unavailable" | undefined {
    if (mark.kind !== MARK_IDS.guardAddress) return undefined;
    const guard = mark as unknown as {at: {entry: string; path: string}; notIn: unknown[]; from?: string; to?: string; lines?: string[]};
    const known = view.lines();
    if (guard.lines?.some((line) => line !== "main" && !known.some((summary) => summary.id === line && summary.exists[mode] && summary.unbuildable === null)) === true) return "line-unavailable";
    return checkAddressGuard(view, mode, guard) === "unchecked" ? "incomplete" : undefined;
}

function readDecision(view: CanonReadView, decision: Decision, mode: Mode): DecisionRead {
    return {
        id: decision.id,
        text: decision.text,
        status: decision.status,
        conclusion: decision.conclusion ?? null,
        reason: decision.reason ?? NO_REASON,
        constraints: decision.constraints ?? [],
        due: decision.due ?? null,
        about: decision.about,
        guards: (decision.marks ?? []).filter((mark) => mark.kind.startsWith("nbook.plot.guard.")).map((mark) => {
            const unchecked = decision.status === "decided" ? uncheckedReason(view, mark, mode) : undefined;
            return {mark, ...(unchecked === undefined ? {} : {unchecked})};
        }),
    };
}

/** 章在章序里的下标；不在章序里为 -1。读取位置是初值时还没有章，为 -1（没有到期的）。 */
function chapterIndex(view: CanonReadView, position: ReadPosition): number {
    return position.kind === "chapter" ? view.chapters.indexOf(position.chapter) : -1;
}

/** 剧情线条目：变更的 `lines` 里挂着它（不是 `involves`），所以判章要用 `changes({line})`。 */
export const PLOT_LINE_TYPE = "剧情线";

const decisionLists = perViewCache<readonly Decision[]>();

/**
 * 这条决策涉及这一章吗：挂的对象与本章涉及的条目相交（`entry` 与 `address` 的条目）、挂在本章上（`chapter`，或 `change` 安放在
 * 本章）、范围（`scope`，只给一端时按章序比）包含本章；挂的是剧情线条目时，这条线上本章有剧情变更也算（输出 9）。
 * `decision`、`diagnostic` 两种挂点不参与。
 */
function involves(view: CanonReadView, decision: Decision, chapter: string, index: number, entries: ReadonlySet<string>, mode: Mode): boolean {
    const {from, to} = decision.scope ?? {};
    if (from !== undefined || to !== undefined) {
        const [low, high] = [from === undefined ? 0 : view.chapters.indexOf(from), to === undefined ? view.chapters.length - 1 : view.chapters.indexOf(to)];
        if (low !== -1 && high !== -1 && index >= low && index <= high) return true;
    }
    for (const about of decision.about) {
        switch (about.kind) {
            case "entry":
            case "address": {
                const entry = about.kind === "entry" ? about.id : about.at.entry;
                if (entries.has(entry)) return true;
                if (about.kind === "entry" && (view.object({kind: "entry", id: entry}) as {type?: string} | undefined)?.type === PLOT_LINE_TYPE && view.changes({line: entry, chapter, ...(mode === "planned" ? {} : {kind: "written" as const})}).some((change) => change.status === "active")) return true;
                break;
            }
            case "chapter":
                if (about.id === chapter) return true;
                break;
            case "change": {
                const change = view.object({kind: "change", id: about.id}) as StoryChange | undefined;
                if (change !== undefined && change.status !== "undone" && change.at.kind === "chapter" && change.at.chapter === chapter) return true;
                break;
            }
            default:
                break;
        }
    }
    return false;
}

/** 这条决策挂在这个知识点上吗：挂点是它或它的地址（与 `involves` 同一个口径），或者读者守卫指向它（输出 3、7）。 */
export function decisionHangsOn(decision: Decision, point: string): boolean {
    return decision.about.some((about) => (about.kind === "entry" && about.id === point) || (about.kind === "address" && about.at.entry === point)) || (decision.marks ?? []).some((mark) => mark.kind === MARK_IDS.guardReader && (mark as {point?: unknown}).point === point);
}

const aboutKey = (decision: Decision) => decision.about.map((about) => (about.kind === "address" ? `address:${about.at.entry}:${about.at.path}` : `${about.kind}:${"id" in about ? about.id : ""}`)).sort()[0] ?? "";

/**
 * 涉及本章的决策（输出 7）：已定的在前、待定的在后（被取代、放弃的不列），各按挂的对象再按 id 排。未写的章只有计划时按计划模式
 * 读（`chapterEntries` 的计划模式把计划的涉及条目算进本章，Spec 的补充）。
 */
export function involvedDecisions(view: CanonReadView, chapter: string, mode: Mode, extraEntries: Iterable<string> = []): DecisionRead[] {
    return involvedDecisionObjects(view, chapter, mode, extraEntries).map((decision) => readDecision(view, decision, mode));
}

const allDecisions = (view: CanonReadView, key: string) => decisionLists(view, key, () => view.decisions());

/** 同上，只给决策本身（不核对守卫，写完以后的检查只要文字与约束）。 */
export function involvedDecisionObjects(view: CanonReadView, chapter: string, mode: Mode, extraEntries: Iterable<string> = []): Decision[] {
    // `extraEntries`：简报把“本章涉及的知识点”也算作本章涉及的条目（挂在这些知识点上的决策是涉及本章的）。
    const entries = new Set([...view.chapterEntries(chapter, mode), ...extraEntries]);
    const order = (decision: Decision) => (decision.status === "decided" ? 0 : 1);
    const index = view.chapters.indexOf(chapter);
    return allDecisions(view, "")
        .filter((decision) => (decision.status === "decided" || decision.status === "pending") && involves(view, decision, chapter, index, entries, mode))
        .sort((a, b) => order(a) - order(b) || (aboutKey(a) < aboutKey(b) ? -1 : aboutKey(a) > aboutKey(b) ? 1 : 0) || (a.id < b.id ? -1 : 1));
}

/** 挂的对象死了吗（悬空用）：条目已删除、剧情变更已撤销、被取代或放弃的决策；`address` 看它的条目，`chapter` 不在章序里；`diagnostic` 不算。 */
function dead(view: CanonReadView, about: Decision["about"][number]): boolean {
    switch (about.kind) {
        case "entry":
        case "address": {
            const stored = view.object({kind: "entry", id: about.kind === "entry" ? about.id : about.at.entry}) as {deleted?: boolean} | undefined;
            return stored === undefined || stored.deleted === true;
        }
        case "change": {
            const stored = view.object({kind: "change", id: about.id}) as StoryChange | undefined;
            return stored === undefined || stored.status === "undone";
        }
        case "decision": {
            const stored = view.object({kind: "decision", id: about.id}) as Decision | undefined;
            return stored === undefined || stored.status === "superseded" || stored.status === "dropped";
        }
        case "chapter":
            return !view.chapters.includes(about.id);
        default:
            return false;
    }
}

const decisionRef = (id: string): ObjectRef => ({kind: "decision", id});

/**
 * 到期没定（输出 5，待处理）：待定的决策 `due` 是第 N 章，读取位置所在章不早于第 N 章（读最新一章末尾时就是 Spec 的“最新一章”）。
 * 到期章不在章序里的不报。
 */
export const overdue: DiagnosticCompute = (view, at) => {
    const now = chapterIndex(view, at);
    const findings: Finding[] = [];
    for (const decision of view.decisions({status: "pending"})) {
        if (decision.due === undefined) continue;
        const due = view.chapters.indexOf(decision.due);
        if (due !== -1 && due <= now) findings.push({key: {objects: [decisionRef(decision.id)]}, objects: [decisionRef(decision.id)], params: {due: decision.due}});
    }
    return findings;
};

/** 悬空（输出 5，提示）：已定的决策挂的对象不为空、且全部已死。 */
export const dangling: DiagnosticCompute = (view) => {
    const findings: Finding[] = [];
    for (const decision of view.decisions({status: "decided"})) {
        if (decision.about.length === 0 || !decision.about.every((about) => dead(view, about))) continue;
        findings.push({key: {objects: [decisionRef(decision.id)]}, objects: [decisionRef(decision.id)], params: {}});
    }
    return findings;
};

export function decisionDiagnostics(): Readonly<Record<string, DiagnosticCompute>> {
    return {[DECISION_DIAGNOSTIC_IDS.overdue]: overdue, [DECISION_DIAGNOSTIC_IDS.dangling]: dangling};
}
