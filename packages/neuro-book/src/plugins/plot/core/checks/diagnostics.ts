/**
 * 检查结果成为待处理（docs/specs/plot/checks.md 输出 8、decisions.md 输出 4、foreshadowing.md 输出 7）。读检查记录算：记录有效才报，过期只报
 * `stale`。
 *
 * 带 `line` 的发现只在那条线的视图上报；只按章的在这一章讲的任何一条线的视图上都报（键里没有线，一次读取只用一张视图，不会重复）。都不晚于读取
 * 位置所在章。同一个键的几条合成一条，合并项进 `params`（输出 8），否则内核会多报 `diagnostic-duplicate-key`，还丢内容。
 */

import type {CanonReadView, DiagnosticCompute, Finding, ObjectRef, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import type {CheckRecord, FixedAnswer, JudgeAnswer, ObjectAnswer, TrialAnswer, YesNoAnswer} from "../../shared/checks";
import {CHECK_DIAGNOSTIC_IDS, DECISION_DIAGNOSTIC_IDS, FS_DIAGNOSTIC_IDS, MARK_IDS} from "../../shared/declarations";
import type {Digest} from "../guards";
import {perViewCache} from "../view-cache";

export interface CheckSource {
    all(): readonly CheckRecord[];
    /** 这条记录在这张视图上有效吗。 */
    valid(view: CanonReadView, record: CheckRecord): boolean;
}

const entry = (id: string): ObjectRef => ({kind: "entry", id});
const range = (chapter: string) => ({from: chapter, to: chapter});
const joined = (items: readonly string[]) => [...new Set(items)].join("、");

type Findings = Map<string, Finding[]>;

/** 按键合并：同键的几条交给 `merge` 合成一条。 */
class Collector {
    readonly #byKey = new Map<string, {id: string; finding: Finding}>();
    add(id: string, finding: Finding): void {
        const key = `${id}\u0000${JSON.stringify(finding.key)}`;
        const existing = this.#byKey.get(key);
        if (existing === undefined) {
            this.#byKey.set(key, {id, finding});
            return;
        }
        const params: Record<string, string | number> = {...existing.finding.params};
        for (const [name, value] of Object.entries(finding.params)) {
            const earlier = params[name];
            if (earlier === undefined) params[name] = value;
            else if (typeof value === "number" && typeof earlier === "number") params[name] = earlier === value ? earlier : earlier + value;
            else if (!String(earlier).split("、").includes(String(value))) params[name] = `${String(earlier)}、${String(value)}`;
        }
        const objects = [...existing.finding.objects];
        for (const object of finding.objects) if (!objects.some((other) => other.kind === object.kind && other.id === object.id)) objects.push(object);
        existing.finding = {...existing.finding, objects, params};
    }
    done(): Findings {
        const out: Findings = new Map();
        for (const {id, finding} of this.#byKey.values()) out.set(id, [...(out.get(id) ?? []), finding]);
        return out;
    }
}

/** 挂在这个知识点上的决策（含读者守卫）：泄底时一并给作者看（decisions.md 输出 3、7）。 */
function decisionsOn(view: CanonReadView, point: string): ObjectRef[] {
    return view.decisions()
        .filter((decision) => decision.status === "decided" || decision.status === "pending")
        .filter((decision) => decision.about.some((about) => about.kind === "entry" && about.id === point) || (decision.marks ?? []).some((mark) => mark.kind === MARK_IDS.guardReader && (mark as {point?: unknown}).point === point))
        .map((decision) => ({kind: "decision" as const, id: decision.id}));
}

/** 本章有没有分叉（时间层答“有”，而本章没有分叉，才算疑似回溯没记）。 */
const hasFork = (view: CanonReadView, chapter: string) => view.changes({chapter}).some((change: StoryChange) => change.nature === "fork" && change.status === "active");

/** 本章有没有改了这个物件的已写变更（有就是 `objectTouched` 的事，不算“世界里没记”）。 */
const touchedInWorld = (view: CanonReadView, chapter: string, object: string) => view.changes({chapter, kind: "written", status: "active"}).some((change: StoryChange) => change.patches.some((patch) => patch.at.entry === object));

function validFindings(view: CanonReadView, record: CheckRecord, digest: Digest, out: Collector): void {
    const {chapter} = record;
    const segments = new Map(record.segments.map((segment) => [segment.id, segment]));
    const onHere = (segment: string | undefined) => segment !== undefined && segments.get(segment)?.line === view.line;

    for (const call of record.calls) {
        switch (call.layer) {
            case "presence":
            case "narration": {
                const answer = call.answer as YesNoAnswer;
                if (answer.answer !== "yes" || !onHere(call.segment)) break;
                out.add(CHECK_DIAGNOSTIC_IDS.possibleSlip, {
                    key: {objects: [entry(call.point!)], line: view.line, range: range(chapter), detail: call.segment!},
                    objects: [entry(call.point!), ...(call.person === undefined ? [] : [entry(call.person)])],
                    params: {chapter, layers: call.layer === "presence" ? "在场层" : "叙述层", people: call.personName ?? "", quotes: joined(answer.quotes), fromParagraph: segments.get(call.segment!)!.from},
                });
                break;
            }
            case "time": {
                const answer = call.answer as YesNoAnswer;
                if (answer.answer !== "yes" || !onHere(call.segment) || hasFork(view, chapter)) break;
                out.add(CHECK_DIAGNOSTIC_IDS.forkSuspected, {key: {line: view.line, range: range(chapter), detail: call.segment!}, objects: [], params: {chapter, quotes: joined(answer.quotes), fromParagraph: segments.get(call.segment!)!.from}});
                break;
            }
            case "object": {
                const answer = call.answer as ObjectAnswer;
                if (answer.moved !== "yes" || !onHere(call.segment) || touchedInWorld(view, chapter, call.object!)) break;
                // 依赖这个物件的每个伏笔各一条；键里的伏笔从视图读（题面写明了它们，所以它们变了记录就过期）。
                const foreshadows = view.entries().filter((candidate) => candidate.deleted !== true && candidate.type === "伏笔").filter((candidate) => {
                    const read = view.entry(candidate.id, {kind: "chapter", chapter, edge: "start"}, "actual");
                    const objects = read === null || read === "chapter-not-found" ? undefined : read.namespaces.fs?.fields.物件?.value;
                    return Array.isArray(objects) && objects.some((item: {id?: unknown}) => item.id === call.object);
                });
                for (const foreshadow of foreshadows) {
                    out.add(FS_DIAGNOSTIC_IDS.objectTouchedInText, {key: {objects: [entry(foreshadow.id), entry(call.object!)], line: view.line, range: range(chapter), detail: digest(answer.quotes[0] ?? "")}, objects: [entry(foreshadow.id), entry(call.object!)], params: {chapter, before: answer.before, after: answer.after, who: answer.who, quotes: joined(answer.quotes)}});
                }
                break;
            }
            case "reader": {
                const trial = call.answer as TrialAnswer;
                const judged = record.calls.find((other) => other.id === `judge:${call.point!}`)?.answer as JudgeAnswer | undefined;
                if (judged === undefined || judged.verdict === "inconsistent") break;
                if (trial.confidence !== "certain" && trial.confidence !== "strong") break;
                out.add(CHECK_DIAGNOSTIC_IDS.earlyReveal, {key: {objects: [entry(call.point!)], range: range(chapter)}, objects: [entry(call.point!), ...decisionsOn(view, call.point!)], params: {chapter, guess: trial.guess, confidence: trial.confidence, verdict: judged.verdict, quotes: joined(trial.quotes)}});
                break;
            }
            case "fixed": {
                for (const item of (call.answer as Pick<FixedAnswer, "items">).items) {
                    if (item.answer !== "yes") continue;
                    const rule = record.rules.find((candidate) => candidate.item === item.item);
                    if (rule === undefined) continue;
                    const params = {chapter, rule: rule.text, quotes: joined(item.quotes)};
                    if (rule.decision !== undefined) {
                        const id = rule.item.startsWith("pending:") ? DECISION_DIAGNOSTIC_IDS.decidedInText : DECISION_DIAGNOSTIC_IDS.constraintViolated;
                        out.add(id, {key: {objects: [{kind: "decision", id: rule.decision}], range: range(chapter)}, objects: [{kind: "decision", id: rule.decision}], params});
                    } else out.add(CHECK_DIAGNOSTIC_IDS.instructionViolated, {key: {range: range(chapter), detail: rule.item}, objects: [], params});
                }
                break;
            }
            default:
                break;
        }
    }

    for (const fact of record.newFacts) {
        if (fact.line !== view.line) continue;
        const id = fact.kind === "knowing" ? CHECK_DIAGNOSTIC_IDS.unrecordedKnowing : CHECK_DIAGNOSTIC_IDS.unreportedInvention;
        out.add(id, {key: {line: view.line, range: range(chapter), detail: digest(fact.quotes[0] ?? fact.text)}, objects: [], params: {chapter, text: fact.text, quotes: joined(fact.quotes), segment: fact.segment}});
    }

    const unasked = record.unasked.length;
    if (unasked + record.unlisted + record.uncast + record.incomplete.length > 0) out.add(CHECK_DIAGNOSTIC_IDS.unasked, {key: {range: range(chapter)}, objects: [], params: {chapter, unasked, unlisted: record.unlisted, uncast: record.uncast, incomplete: record.incomplete.join("、")}});
    if (record.badQuotes > 0) out.add(CHECK_DIAGNOSTIC_IDS.badQuote, {key: {range: range(chapter)}, objects: [], params: {chapter, count: record.badQuotes}});
    for (const point of record.noSuspense) out.add(CHECK_DIAGNOSTIC_IDS.noSuspense, {key: {objects: [entry(point)]}, objects: [entry(point)], params: {chapters: chapter}});
    for (const point of record.noReaderQuestion) out.add(CHECK_DIAGNOSTIC_IDS.noReaderQuestion, {key: {objects: [entry(point)]}, objects: [entry(point)], params: {chapters: chapter}});
}

const results = perViewCache<Findings>();

function findingsAt(view: CanonReadView, at: ReadPosition, source: CheckSource, digest: Digest): Findings {
    return results(view, JSON.stringify(at), () => {
        const out = new Collector();
        const now = at.kind === "chapter" ? view.chapters.indexOf(at.chapter) : -1;
        for (const record of source.all()) {
            const index = view.chapters.indexOf(record.chapter);
            if (index === -1 || index > now) continue;
            if (!view.chapterLines(record.chapter).some((segment) => segment.line === view.line)) continue;
            if (source.valid(view, record)) validFindings(view, record, digest, out);
            else out.add(CHECK_DIAGNOSTIC_IDS.stale, {key: {range: range(record.chapter)}, objects: [], params: {chapter: record.chapter}});
        }
        return out.done();
    });
}

export function checkDiagnostics(source: CheckSource, digest: Digest): Readonly<Record<string, DiagnosticCompute>> {
    const ids = [...Object.values(CHECK_DIAGNOSTIC_IDS), DECISION_DIAGNOSTIC_IDS.constraintViolated, DECISION_DIAGNOSTIC_IDS.decidedInText, FS_DIAGNOSTIC_IDS.objectTouchedInText];
    return Object.fromEntries(ids.map((id): [string, DiagnosticCompute] => [id, (view, at) => findingsAt(view, at, source, digest).get(id) ?? []]));
}
