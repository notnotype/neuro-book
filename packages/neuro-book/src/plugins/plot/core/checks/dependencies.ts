/**
 * 依赖的摘要（docs/specs/plot/checks.md 输出 7：实现可以先比各项依赖的摘要、不同时才重拼，结果必须与重拼相同）。全书都跑过检查时，每次读待处理都重拼
 * 要几分钟，所以比这个摘要：相同就直接用记录的结论，不同才 `planCheck`。
 *
 * **只能多算不能漏**：`planCheck` 读到的一切都要算进来。`N` 是这一章与补叙安放所在章里较晚的那一章：
 * - 写作指示、自陈的内容，补问清单，插件版本，算法版本，登记与历法；
 * - 章序：不晚于 N 的章 id 与各章讲的线，滚动；
 * - 正文：不晚于 N 的全部章，滚动（讲述的定位读全书，试读的材料也在其中）；
 * - 世界的前缀：**全部线**的变更按“最早的章”分桶。讲述先于安放的按讲述算（读者读到的），被某条已写变更 `fulfills` 的计划跟着那条变更（继承节点），
 *   `replaces`、`splitFrom` 两头取早的，未排章的与全部分叉算全局；每条的摘要按对象缓存（世界不可变），按章滚动；
 * - 条目：按出场分桶（没写出场的算全局），靠 `readAppeared` 成立：计划的路径上读不到出场晚于 N 的条目；
 * - 决策：会影响计划的挂点与字段。只挂诊断的不算：作者处理检查结果这个主流程就在写这种决策；
 * - 后面的揭示：`revealTable` 里最晚的明说揭示在 N 之后的知识点集合；
 * - 这一章讲的不是主线时，再加全书的摘要：带过去的值读父线，那边的索引按最新一章读，判断不了前缀。
 *
 * 改了算法要加 `ALGORITHM`：旧记录的摘要对不上，重拼一次，仍有效就回写。
 */

import {canonicalJson} from "@notnotype/nb-canon/schema";
import type {CanonReadView, Decision, Placement, StoryChange} from "@notnotype/nb-canon/schema";

import type {Digest} from "../guards";
import {perViewCache} from "../view-cache";
import {flashbackOf} from "./segments";
import {revealTable} from "./trial";

const ALGORITHM = 1;

/** 对象的摘要按对象缓存：世界不可变，没改的对象还是同一个。按摘要函数分开（测试与产品各一个）。 */
const perDigest = new WeakMap<Digest, WeakMap<object, string>>();
function objectDigest(value: object, digest: Digest): string {
    let cache = perDigest.get(digest);
    if (cache === undefined) {
        cache = new WeakMap();
        perDigest.set(digest, cache);
    }
    let found = cache.get(value);
    if (found === undefined) {
        found = digest(canonicalJson(value));
        cache.set(value, found);
    }
    return found;
}

/** 全部线上的变更（去重）：读者读的是活页夹，别的线上的讲述也算依赖。 */
function allChanges(view: CanonReadView): StoryChange[] {
    const found = new Map<string, StoryChange>();
    for (const change of view.changes()) found.set(change.id, change);
    for (const summary of view.lines()) {
        const on = view.onLine(summary.id, "planned");
        if ("code" in on) continue;
        for (const change of on.changes()) found.set(change.id, change);
    }
    return [...found.values()];
}

/** 全部的不可变部分：章下标到这一桶的摘要；`-1` 是全局那一桶。 */
function bucketsOfChanges(view: CanonReadView): Map<number, string[]> {
    const indexOf = (chapter: string) => view.chapters.indexOf(chapter);
    const changes = allChanges(view);
    const buckets = new Map<string, number>();
    for (const change of changes) {
        const told = change.told.flatMap((telling) => (telling.chapter === undefined ? [] : [indexOf(telling.chapter)])).filter((index) => index !== -1);
        // 未排章、前史、章不在章序里、分叉：全局。
        const placed = change.nature === "fork" || change.at.kind !== "chapter" ? -1 : indexOf(change.at.chapter);
        buckets.set(change.id, Math.min(placed, ...told));
    }
    // 链接要跑两遍才传得过一跳以上（计划被替代、替代它的又被兑现）。
    for (let pass = 0; pass < 2; pass += 1) {
        for (const change of changes) {
            for (const link of change.links) {
                const target = "plan" in link && typeof link.plan === "string" ? link.plan : undefined;
                if (target === undefined || !buckets.has(target)) continue;
                const [own, other] = [buckets.get(change.id)!, buckets.get(target)!];
                if (link.kind === "fulfills") buckets.set(target, Math.min(other, own));
                else {
                    buckets.set(target, Math.min(other, own));
                    buckets.set(change.id, Math.min(other, own));
                }
            }
        }
    }
    const out = new Map<number, string[]>();
    for (const change of changes) {
        const bucket = buckets.get(change.id)!;
        out.set(bucket, [...(out.get(bucket) ?? []), change.id]);
    }
    return out;
}

interface WorldFold {
    /** 下标 `i + 1` 是第 i 章（含）以前的滚动摘要；下标 0 是全局那一桶。 */
    readonly prefix: readonly string[];
    readonly decisions: string;
    /** 知识点按 id 排好，带最晚的明说揭示所在章。 */
    readonly reveals: readonly (readonly [string, number])[];
}

const placementIndex = (view: CanonReadView, placement: Placement | undefined) => (placement === undefined || placement.kind !== "chapter" ? -1 : view.chapters.indexOf(placement.chapter));

/** 决策里会影响计划的字段（`involvedDecisions` 读的、规则项写进题面的）。只挂诊断的决策不影响计划，不算。 */
function decisionContent(decision: Decision) {
    const concerns = decision.scope !== undefined || decision.about.some((about) => about.kind === "entry" || about.kind === "address" || about.kind === "chapter" || about.kind === "change");
    if (!concerns) return null;
    return {id: decision.id, status: decision.status, text: decision.text, conclusion: decision.conclusion ?? null, reason: decision.reason ?? null, constraints: decision.constraints ?? [], about: decision.about, scope: decision.scope ?? null, due: decision.due ?? null, marks: decision.marks ?? []};
}

const folds = perViewCache<WorldFold>();
function worldFold(view: CanonReadView, digest: Digest): WorldFold {
    return folds(view, "", () => {
        const changes = new Map(allChanges(view).map((change) => [change.id, change]));
        const changeBuckets = bucketsOfChanges(view);
        const entryBuckets = new Map<number, string[]>();
        for (const entry of view.entries()) {
            const bucket = placementIndex(view, entry.appears);
            entryBuckets.set(bucket, [...(entryBuckets.get(bucket) ?? []), objectDigest(entry, digest)]);
        }
        const bucketDigest = (index: number) => {
            const ofChanges = (changeBuckets.get(index) ?? []).sort().map((id) => objectDigest(changes.get(id)!, digest));
            const ofEntries = (entryBuckets.get(index) ?? []).sort();
            return `${ofChanges.join("")}|${ofEntries.join("")}`;
        };
        const prefix: string[] = [digest(bucketDigest(-1))];
        for (const [index, chapter] of view.chapters.entries()) {
            prefix.push(digest(`${prefix[index]!}|${chapter}|${JSON.stringify(view.chapterLines(chapter))}|${view.chapterTextDigest(chapter) ?? ""}|${bucketDigest(index)}`));
        }
        const decisions = digest(canonicalJson(view.decisions().map(decisionContent).filter((content) => content !== null).sort((a, b) => (a.id < b.id ? -1 : 1))));
        const reveals = [...revealTable(view)].sort(([a], [b]) => (a < b ? -1 : 1));
        return {prefix, decisions, reveals};
    });
}

export interface DependencyInput {
    readonly view: CanonReadView;
    readonly chapter: string;
    readonly followUps: readonly string[];
    readonly instruction?: {readonly snapshot: Parameters<typeof flashbackOf>[0]; readonly digest: string};
    readonly selfReport?: string;
    readonly pluginVersion: string;
    readonly digest: Digest;
}

/** 这一章现在的依赖摘要。章不在章序里时为 null（计划也读不到它）。 */
export function dependenciesOf(input: DependencyInput): string | null {
    const {view, chapter, digest} = input;
    const here = view.chapters.indexOf(chapter);
    if (here === -1) return null;
    const fold = worldFold(view, digest);
    const flashback = placementIndex(view, flashbackOf(input.instruction?.snapshot));
    const bound = Math.max(here, flashback);
    const onMain = view.chapterLines(chapter).every((segment) => segment.line === "main");
    return digest(canonicalJson({
        algorithm: ALGORITHM,
        plugin: input.pluginVersion,
        declarations: view.declarationsDigest(),
        instruction: input.instruction?.digest ?? null,
        selfReport: input.selfReport ?? null,
        followUps: input.followUps,
        prefix: fold.prefix[bound + 1]!,
        whole: onMain ? null : fold.prefix[fold.prefix.length - 1]!,
        decisions: fold.decisions,
        later: fold.reveals.filter(([, index]) => index > here).map(([point]) => point),
    }));
}
