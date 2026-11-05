/**
 * 章的写作指示的三项检查（docs/specs/plot/decisions.md 输出 8，提示）：视角人物不在场、补叙的安放对不上、写作指示反复出现。
 * 读写作指示快照表（`backend/instructions.ts`，宿主推进来的）。表是空的时没有东西可查，返回没有发现：没用写作指示的项目不该
 * 因此每次读待处理都标“不完整”。代价是快照不存盘，重启以后在宿主再推一次之前这三项提示会消失（存处随阶段 F）。
 *
 * 逐章的两项（视角人物、补叙）只在这一章讲的那条线的视图上报：快照是章的，别的线的视图里算出同一条发现没有意义。
 * 相关的已定决策（挂在本章或视角人物上）追加进发现的对象里（输出 7 的后半句）。
 */

import type {CanonReadView, DiagnosticCompute, Finding, Mode, ObjectRef, Placement, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {INSTRUCTION_DIAGNOSTIC_IDS} from "../shared/declarations";
import type {InstructionSnapshot} from "../shared/instructions";
import {changeIndex} from "./change-index";

/** 快照的来源（项目实例里的表）。 */
export interface InstructionSource {
    readonly empty: boolean;
    all(): readonly InstructionSnapshot[];
}

export function instructionDiagnostics(source: InstructionSource): Readonly<Record<string, DiagnosticCompute>> {
    return {
        [INSTRUCTION_DIAGNOSTIC_IDS.povAbsent]: (view, at, mode) => perChapter(view, at, mode, source, povAbsent),
        [INSTRUCTION_DIAGNOSTIC_IDS.flashbackMismatch]: (view, at, mode) => perChapter(view, at, mode, source, flashbackMismatch),
        [INSTRUCTION_DIAGNOSTIC_IDS.repeated]: (view, at) => repeated(view, at, source),
    };
}

/** 读取位置所在章的下标（初值是 -1：还没有章）。 */
const chapterIndexOf = (view: CanonReadView, position: ReadPosition) => (position.kind === "chapter" ? view.chapters.indexOf(position.chapter) : -1);

/** 对每个已有快照、不晚于读取位置所在章、而且是这条线讲的章，各算一次。 */
function perChapter(view: CanonReadView, at: ReadPosition, mode: Mode, source: InstructionSource, check: (view: CanonReadView, snapshot: InstructionSnapshot, mode: Mode) => Finding[]): Finding[] {
    const now = chapterIndexOf(view, at);
    return source.all().flatMap((snapshot) => {
        const index = view.chapters.indexOf(snapshot.chapter);
        if (index === -1 || index > now) return [];
        if (view.positionLine({kind: "chapter", chapter: snapshot.chapter, edge: "start"}, mode) !== view.line) return [];
        return check(view, snapshot, mode);
    });
}

/** 这一章讲的各条线的视图（分段讲几条线的章取各段的线；线读不到的跳过）。 */
function segmentViews(view: CanonReadView, chapter: string): CanonReadView[] {
    const lines = [...new Set(view.chapterLines(chapter).map((segment) => segment.line))];
    return lines.flatMap((line) => {
        const on = line === view.line ? view : view.onLine(line, "planned");
        return "code" in on ? [] : [on];
    });
}

/** 本章生效的剧情变更（实际模式只算已写的，按计划模式再加计划）：安放在本章的，或在本章讲述的（补叙的事安放在别处）；各段的线合起来。 */
function chapterChanges(view: CanonReadView, chapter: string, mode: Mode, tellings = false): StoryChange[] {
    const found = new Map<string, StoryChange>();
    for (const on of segmentViews(view, chapter)) {
        const index = changeIndex(on);
        for (const change of [...(index.byChapter.get(chapter) ?? []), ...(tellings ? (index.byTold.get(chapter) ?? []) : [])]) if (mode === "planned" || change.kind === "written") found.set(change.id, change);
    }
    return [...found.values()];
}

/** 挂在本章或这些条目上的已定决策，追加进发现的对象里。 */
function relatedDecisions(view: CanonReadView, chapter: string, entries: readonly string[]): ObjectRef[] {
    return view.decisions({status: "decided"})
        .filter((decision) => decision.about.some((about) => (about.kind === "chapter" && about.id === chapter) || (about.kind === "entry" && entries.includes(about.id)) || (about.kind === "address" && entries.includes(about.at.entry))))
        .map((decision) => ({kind: "decision" as const, id: decision.id}));
}

/** 视角人物不在场：本章有变更而视角人物在这些变更里都不在场；有没记参与者的变更（`uncast`）时不知道，不报。 */
function povAbsent(view: CanonReadView, snapshot: InstructionSnapshot, mode: Mode): Finding[] {
    if (snapshot.pov === undefined) return [];
    const changes = chapterChanges(view, snapshot.chapter, mode);
    if (changes.length === 0) return [];
    // 本章的在场（同 `presence` 的取法，但从按章分组的变更里取，不为每一章把全部变更扫一遍）：已写、生效、套上的变更；按计划模式再加计划。
    const counted = changes.filter((change) => change.kind === "plan" || change.patches.length === 0 || segmentViews(view, snapshot.chapter).some((on) => on.outcome(change.id)?.applied === true));
    const pov = snapshot.pov.id;
    const present = counted.some((change) => (change.cast ?? []).some((member) => member.role === "present" && (member.who === pov || member.as === pov)));
    if (present || counted.some((change) => change.cast === undefined)) return [];
    return [{
        key: {objects: [{kind: "entry", id: snapshot.pov.id}], range: {from: snapshot.chapter, to: snapshot.chapter}},
        objects: [{kind: "entry", id: snapshot.pov.id}, ...relatedDecisions(view, snapshot.chapter, [snapshot.pov.id])],
        params: {chapter: snapshot.chapter},
    }];
}

/**
 * 补叙的安放对不上：时间方式是补叙某处安放，而本章安放的剧情变更没有一条在那处附近：同一章；或者（补叙的是前史）前史里它前后各
 * 一条。安放在章内时“附近”只指同一章。本章没有变更不报。
 */
function flashbackMismatch(view: CanonReadView, snapshot: InstructionSnapshot, mode: Mode): Finding[] {
    const timeMode = snapshot.timeMode;
    if (timeMode === undefined || typeof timeMode === "string" || !("flashback" in timeMode)) return [];
    const target = timeMode.flashback as Placement;
    const changes = chapterChanges(view, snapshot.chapter, mode, true);
    if (changes.length === 0) return [];
    const neighbours = new Set<string>();
    if (target.kind === "prehistory") {
        // 前史里它前后各一处（同一处上的几条变更都算）：前史的先后就是 `order`。
        const prehistory = view.changes({...(mode === "planned" ? {} : {kind: "written" as const})}).filter((change): change is StoryChange & {at: {kind: "prehistory"; order: number}} => change.status === "active" && change.at.kind === "prehistory");
        const before = Math.max(...prehistory.filter((change) => change.at.order <= target.order).map((change) => change.at.order), Number.NEGATIVE_INFINITY);
        const after = Math.min(...prehistory.filter((change) => change.at.order > target.order).map((change) => change.at.order), Number.POSITIVE_INFINITY);
        for (const change of prehistory) if (change.at.order === before || change.at.order === after) neighbours.add(change.id);
    }
    const near = changes.some((change) => (target.kind === "chapter" && change.at.kind === "chapter" && change.at.chapter === target.chapter) || neighbours.has(change.id) || (target.kind === "prehistory" && change.at.kind === "prehistory" && neighbours.has(change.id)));
    if (near) return [];
    return [{
        key: {range: {from: snapshot.chapter, to: snapshot.chapter}},
        objects: relatedDecisions(view, snapshot.chapter, []),
        params: {chapter: snapshot.chapter},
    }];
}

/**
 * 写作指示反复出现：同一句“不写的”（`avoid` 的每一项）或“其他”（整段文字相等）连续出现在 3 章以上相邻的快照里（中间隔着没有
 * 快照的章就断开；读取位置之后的章不算），建议升成决策。同一段区间里的几句合成一条发现。
 */
function repeated(view: CanonReadView, at: ReadPosition, source: InstructionSource): Finding[] {
    const now = chapterIndexOf(view, at);
    const byIndex = new Map(source.all().map((snapshot) => [view.chapters.indexOf(snapshot.chapter), snapshot] as const).filter(([index]) => index !== -1 && index <= now));
    const sentences = new Map<string, number[]>();
    for (const [index, snapshot] of byIndex) {
        for (const text of new Set([...(snapshot.avoid ?? []).map((item) => `avoid|${item}`), ...(snapshot.other === undefined ? [] : [`other|${snapshot.other}`])])) sentences.set(text, [...(sentences.get(text) ?? []), index]);
    }
    const ranges = new Map<string, {from: string; to: string; count: number}>();
    for (const indexes of sentences.values()) {
        const sorted = [...indexes].sort((a, b) => a - b);
        let runStart = 0;
        for (let i = 1; i <= sorted.length; i += 1) {
            if (i < sorted.length && sorted[i] === sorted[i - 1]! + 1) continue;
            if (i - runStart >= 3) {
                const [from, to] = [view.chapters[sorted[runStart]!]!, view.chapters[sorted[i - 1]!]!];
                const key = `${from}|${to}`;
                ranges.set(key, {from, to, count: (ranges.get(key)?.count ?? 0) + 1});
            }
            runStart = i;
        }
    }
    return [...ranges.values()].sort((a, b) => view.chapters.indexOf(a.from) - view.chapters.indexOf(b.from) || view.chapters.indexOf(a.to) - view.chapters.indexOf(b.to)).map((range) => ({key: {range: {from: range.from, to: range.to}}, objects: [], params: {sentences: range.count}}));
}
