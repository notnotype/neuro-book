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
 * - 决策：能涉及这一章的（挂在这一章、这一章的变更、这一章涉及的条目上，或范围覆盖这一章），只取计划读的字段；
 * - 后面的揭示：这一章涉及的知识点里，最晚的明说揭示在这一章之后的。
 * - 这一章讲的不是主线时，再加全书的摘要：带过去的值读父线，那边的索引按最新一章读，判断不了前缀。
 *
 * 改了算法要加 `ALGORITHM`：旧记录的摘要对不上，重拼一次，仍有效就回写。
 */

import {canonicalJson} from "@notnotype/nb-canon/schema";
import type {CanonReadView, Placement, StoryChange} from "@notnotype/nb-canon/schema";

import {PLOT_LINE_TYPE} from "../decisions";
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

/** 全部线上的变更分桶：章下标到变更；`-1` 是全局那一桶。 */
function bucketsOfChanges(view: CanonReadView, changes: readonly StoryChange[]): Map<number, StoryChange[]> {
    const chapterIndex = new Map(view.chapters.map((chapter, index) => [chapter, index] as const));
    const buckets = new Map<string, number>();
    for (const change of changes) {
        // 未排章、前史、章不在章序里、分叉：全局。
        let bucket = change.nature === "fork" || change.at.kind !== "chapter" ? -1 : (chapterIndex.get(change.at.chapter) ?? -1);
        for (const telling of change.told) {
            const told = telling.chapter === undefined ? undefined : chapterIndex.get(telling.chapter);
            if (told !== undefined && told < bucket) bucket = told;
        }
        buckets.set(change.id, bucket);
    }
    const linked = changes.filter((change) => change.links.length > 0);
    // 链接要跑两遍才传得过一跳以上（计划被替代、替代它的又被兑现）。
    for (let pass = 0; pass < 2; pass += 1) {
        for (const change of linked) {
            for (const link of change.links) {
                if (!buckets.has(link.plan)) continue;
                const [own, other] = [buckets.get(change.id)!, buckets.get(link.plan)!];
                if (link.kind === "fulfills") buckets.set(link.plan, Math.min(other, own));
                else {
                    buckets.set(link.plan, Math.min(other, own));
                    buckets.set(change.id, Math.min(other, own));
                }
            }
        }
    }
    const out = new Map<number, StoryChange[]>();
    for (const change of changes) {
        const bucket = buckets.get(change.id)!;
        const list = out.get(bucket);
        if (list === undefined) out.set(bucket, [change]);
        else list.push(change);
    }
    return out;
}

/** 决策的摘要按它能涉及什么分开放（与 `involves` 同一个口径，只多不少）：写一条决策，只有它涉及的章要重拼。 */
interface DecisionFold {
    /** 判断不了涉及哪一章的（挂在剧情线上，或范围的章不在章序里）：每一章都算。 */
    readonly everywhere: readonly string[];
    readonly byChapter: ReadonlyMap<string, readonly string[]>;
    readonly byEntry: ReadonlyMap<string, readonly string[]>;
    readonly scoped: readonly {readonly from: number; readonly to: number; readonly digest: string}[];
}

interface WorldFold {
    /** 下标 `i + 1` 是第 i 章（含）以前的滚动摘要；下标 0 是全局那一桶。 */
    readonly prefix: readonly string[];
    readonly decisions: DecisionFold;
    /** 每个知识点最晚的明说揭示所在章。 */
    readonly reveals: ReadonlyMap<string, number>;
    readonly declarations: string;
}

const placementIndex = (view: CanonReadView, placement: Placement | undefined) => (placement === undefined || placement.kind !== "chapter" ? -1 : view.chapters.indexOf(placement.chapter));

function decisionFold(view: CanonReadView, digest: Digest): DecisionFold {
    const everywhere: string[] = [];
    const byChapter = new Map<string, string[]>();
    const byEntry = new Map<string, string[]>();
    const scoped: {from: number; to: number; digest: string}[] = [];
    const add = (map: Map<string, string[]>, key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);
    for (const decision of view.decisions()) {
        // 计划读的字段：涉及与否、规则项写进题面的文字与约束。
        const content = digest(canonicalJson({id: decision.id, status: decision.status, text: decision.text, constraints: decision.constraints ?? [], about: decision.about, scope: decision.scope ?? null}));
        if (decision.scope !== undefined) {
            const [from, to] = [decision.scope.from === undefined ? 0 : view.chapters.indexOf(decision.scope.from), decision.scope.to === undefined ? view.chapters.length - 1 : view.chapters.indexOf(decision.scope.to)];
            if (from === -1 || to === -1) everywhere.push(content);
            else scoped.push({from, to, digest: content});
        }
        for (const about of decision.about) {
            if (about.kind === "chapter") add(byChapter, about.id, content);
            else if (about.kind === "change") {
                const change = view.object({kind: "change", id: about.id}) as StoryChange | undefined;
                if (change?.at.kind === "chapter") add(byChapter, change.at.chapter, content);
            } else if (about.kind === "entry" || about.kind === "address") {
                const entry = about.kind === "entry" ? about.id : about.at.entry;
                if ((view.object({kind: "entry", id: entry}) as {type?: string} | undefined)?.type === PLOT_LINE_TYPE) everywhere.push(content);
                else add(byEntry, entry, content);
            }
            // 只挂诊断、挂别的决策的不涉及任何一章：作者处理检查结果这个主流程就在写这种决策，不能因此重拼全书。
        }
    }
    return {everywhere, byChapter, byEntry, scoped};
}

const folds = perViewCache<WorldFold>();
function worldFold(view: CanonReadView, digest: Digest): WorldFold {
    return folds(view, "", () => {
        const changeBuckets = bucketsOfChanges(view, view.allChanges());
        const entryBuckets = new Map<number, string[]>();
        for (const entry of view.entries()) {
            const bucket = placementIndex(view, entry.appears);
            const list = entryBuckets.get(bucket);
            if (list === undefined) entryBuckets.set(bucket, [objectDigest(entry, digest)]);
            else list.push(objectDigest(entry, digest));
        }
        const bucketDigest = (index: number) => {
            const ofChanges = (changeBuckets.get(index) ?? []).map((change) => objectDigest(change, digest)).sort();
            const ofEntries = (entryBuckets.get(index) ?? []).sort();
            return `${ofChanges.join("")}|${ofEntries.join("")}`;
        };
        const prefix: string[] = [digest(bucketDigest(-1))];
        for (const [index, chapter] of view.chapters.entries()) {
            prefix.push(digest(`${prefix[index]!}|${chapter}|${JSON.stringify(view.chapterLines(chapter))}|${view.chapterTextDigest(chapter) ?? ""}|${bucketDigest(index)}`));
        }
        return {prefix, decisions: decisionFold(view, digest), reveals: revealTable(view), declarations: view.declarationsDigest()};
    });
}

export interface DependencyInput {
    readonly view: CanonReadView;
    readonly chapter: string;
    readonly followUps: readonly string[];
    /** 记录里存的（或这次计划算出的）本章涉及的知识点与条目。 */
    readonly points: readonly string[];
    readonly concerns: readonly string[];
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
    const {everywhere, byChapter, byEntry, scoped} = fold.decisions;
    const decisions = new Set([...everywhere, ...(byChapter.get(chapter) ?? [])]);
    for (const entry of input.concerns) for (const content of byEntry.get(entry) ?? []) decisions.add(content);
    for (const range of scoped) if (range.from <= here && here <= range.to) decisions.add(range.digest);
    return digest(canonicalJson({
        algorithm: ALGORITHM,
        plugin: input.pluginVersion,
        declarations: fold.declarations,
        instruction: input.instruction?.digest ?? null,
        selfReport: input.selfReport ?? null,
        followUps: input.followUps,
        prefix: fold.prefix[bound + 1]!,
        whole: onMain ? null : fold.prefix[fold.prefix.length - 1]!,
        decisions: [...decisions].sort(),
        later: input.points.filter((point) => (fold.reveals.get(point) ?? -1) > here),
    }));
}
