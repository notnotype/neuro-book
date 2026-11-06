/**
 * 依赖的摘要（docs/specs/plot/checks.md 输出 7：实现可以先比各项依赖的摘要、不同时才重拼，结果必须与重拼相同）。全书都跑过检查时，每次读待处理都重拼要几分钟，所以比这个摘要：
 * 相同就直接用记录的结论，不同才 `planCheck`。
 *
 * **只能多算不能漏**：`planCheck` 读到的一切都要算进来。`B` 是这一章、补叙安放、定义它讲的线的分叉所在章里最晚的一章，桶晚于 `B` 的东西计划读不到。
 *
 * | 计划读的 | 在哪 | 摘要里 |
 * |---|---|---|
 * | 章序、分段、线能不能建 | `framesOf`、`segmentsOf`、`positionKey` | `order` |
 * | 本章与上一章正文 | `segmentsOf`、`pointsAfterWriting`、`buildTrial` | `own` |
 * | 本章的变更、计划、核对点，发生点，涉及的条目 | `writtenIn`、`plansOf`、`chapterEntries` | `own`（发生点由正文与引文决定；涉及的条目由这些对象决定，核对点比较时点的翻转看挂靠的变更套没套上，在它提到的条目的历史里） |
 * | 变更里在场的人、马甲（讲述在本章的也算） | `presentPeople` | 本章的对象提到的条目进 `R` |
 * | 全部知识点的父条目、是否删除、出场、名字、`揭穿`，被引条目的名字 | `pointsAfterWriting`、`pointsBeforeWriting` | `identity` |
 * | 条目在位置上的值（含按计划模式） | `readAppeared`、`secrecyOf` | `entries` |
 * | 一个人的知情（显式、在场得知、带过去的） | `knowingIndex` | 这个人的历史 |
 * | 隐秘目标 | `goalsWithSecret` | 持有者的子条目进 `R` |
 * | 告诉他的人的名字、物件是否出现过 | `stateOf`、`seenBefore` | 计划把它们放进 `concerns` |
 * | 全部伏笔的名字、物件、阶段 | `foreshadowIndex` | `foreshadow` |
 * | 试读的材料 | `suspenseParagraphs`、`buildTrial` | `material`、`own` |
 * | 读者的程度 | `readerKnowing`、`readerBase` | 知识点的历史（标注提到它，粗定位含落在哪段线） |
 * | 后面的明说揭示 | `revealTable` | `later` |
 * | 决策 | `involvedDecisionObjects` | `decisions` |
 * | 写作指示、自陈、补问 | `planCheck` | 摘要的开头 |
 *
 * 改计划要同时改这张表，并在 `testing/random-edits.ts` 里加能走到新读取的操作；`dependencies.test.ts` 用记录视图核对读到的条目都有归属。
 *
 * **为什么不会漏**：计划是这些读取的纯函数。除 `entries` 以外的各项都没变，且 `R` 里每个条目都没变时，同样的读取得到同样的值，于是算出同样的 `points` 与 `concerns`，`R` 也不变（不动点，
 * 对“`R` 是当前计划的”成立；过期记录的备忘按重拼的计划算，见 `source.ts`）。跨条目的间接影响只有“套不套得上”这一条路：已写变更放引擎算出的结论，计划放联动戳，不沿着共同提到走闭包，
 * 否则很快连成全书。
 *
 * 改了算法要加 `ALGORITHM`：旧记录的摘要对不上，重拼一次，仍有效就回写。
 */

import {canonicalJson, paragraphsOf} from "@notnotype/nb-canon/schema";
import type {CanonReadView, Check, Entry, Mark, Placement, StoryChange, Telling} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, MARK_IDS} from "../../shared/declarations";
import {effectiveTellings} from "../change-index";
import {PLOT_LINE_TYPE} from "../decisions";
import type {Digest} from "../guards";
import {perViewCache} from "../view-cache";
import {flashbackOf} from "./segments";
import {revealTable} from "./trial";

const ALGORITHM = 2;

const MAIN_LINE = "main";
/** 一个条目被提到：规范 JSON 上取 id。路径、引用、标注都覆盖，以后加字段也不漏；误中（引文里恰好有 `e5`）只是多算。 */
const ENTRY_ID = /\be\d+\b/gu;
const MODULUS = 2 ** 52;

/** 对象的摘要、提到谁、项的值都按对象缓存：世界不可变，没改的对象还是同一个。按摘要函数分开（测试与产品各一个）。 */
interface ObjectFacts {
    readonly digest: string;
    readonly mentions: readonly string[];
}
interface ItemValue {
    readonly key: string;
    readonly a: number;
    readonly b: number;
}
interface Caches {
    readonly facts: WeakMap<object, ObjectFacts>;
    readonly projections: WeakMap<object, string>;
    readonly items: WeakMap<object, ItemValue>;
    readonly exact: WeakMap<object, ItemValue>;
}
const perDigest = new WeakMap<Digest, Caches>();
function cachesOf(digest: Digest): Caches {
    let found = perDigest.get(digest);
    if (found === undefined) {
        found = {facts: new WeakMap(), projections: new WeakMap(), items: new WeakMap(), exact: new WeakMap()};
        perDigest.set(digest, found);
    }
    return found;
}
function factsOf(value: object, digest: Digest, caches: Caches): ObjectFacts {
    let found = caches.facts.get(value);
    if (found === undefined) {
        const text = canonicalJson(value);
        found = {digest: digest(text), mentions: [...new Set(text.match(ENTRY_ID) ?? [])]};
        caches.facts.set(value, found);
    }
    return found;
}
/** 项的值：键的摘要取两段 52 位。键相同就不重算，所以每张新视图只是加法。 */
function valueOf(cache: WeakMap<object, ItemValue>, owner: object, key: string, digest: Digest): ItemValue {
    const known = cache.get(owner);
    if (known?.key === key) return known;
    const hex = digest(key);
    const made = {key, a: parseInt(hex.slice(0, 13), 16), b: parseInt(hex.slice(13, 26), 16)};
    cache.set(owner, made);
    return made;
}

/** 按桶累加的前缀：累加与顺序无关，项的键里已经有 `at`，桶也由内容决定。查询之前排一次序。 */
class Prefix {
    readonly #items: {readonly bucket: number; readonly a: number; readonly b: number}[] = [];
    #sorted: {readonly buckets: number[]; readonly a: number[]; readonly b: number[]; readonly n: number[]} | null = null;

    add(bucket: number, value: {readonly a: number; readonly b: number}): void {
        this.#items.push({bucket, a: value.a, b: value.b});
        this.#sorted = null;
    }

    #sort() {
        if (this.#sorted !== null) return this.#sorted;
        const [buckets, a, b, n]: [number[], number[], number[], number[]] = [[], [], [], []];
        for (const item of [...this.#items].sort((x, y) => x.bucket - y.bucket)) {
            const last = buckets.length - 1;
            const [nextA, nextB] = [((a[last] ?? 0) + item.a) % MODULUS, ((b[last] ?? 0) + item.b) % MODULUS];
            if (buckets[last] === item.bucket) {
                a[last] = nextA;
                b[last] = nextB;
                n[last]! += 1;
            } else {
                buckets.push(item.bucket);
                a.push(nextA);
                b.push(nextB);
                n.push((n[last] ?? 0) + 1);
            }
        }
        this.#sorted = {buckets, a, b, n};
        return this.#sorted;
    }

    /** 到桶 `bound`（含）为止的累加。 */
    at(bound: number): string {
        const {buckets, a, b, n} = this.#sort();
        let [low, high] = [0, buckets.length];
        while (low < high) {
            const middle = (low + high) >> 1;
            if (buckets[middle]! <= bound) low = middle + 1;
            else high = middle;
        }
        return low === 0 ? "0" : `${String(a[low - 1]!)}.${String(b[low - 1]!)}.${String(n[low - 1]!)}`;
    }
}

/** 带讲述的对象：剧情变更、核对点、一个条目上的全部重述。 */
interface Thing {
    /** 缓存用的身份，也是摘要的内容。 */
    readonly value: object;
    readonly change?: StoryChange;
    readonly tellings: readonly Telling[];
    /** 安放、比较时点所在的章（`own` 用）。 */
    readonly placedIn: readonly string[];
    bucket: number;
    /** 自己提到的，加链接成组的那几条提到的。 */
    mentions: readonly string[];
}

const placementIndex = (view: CanonReadView, placement: Placement | undefined) => (placement === undefined || placement.kind !== "chapter" ? -1 : view.chapters.indexOf(placement.chapter));
const lineOfChange = (change: StoryChange) => change.at.line ?? MAIN_LINE;
const marksOf = (telling: Telling): readonly Mark[] => telling.marks ?? [];

/** 全部线上的变更分桶：讲述先于安放的按讲述算（读者读到的），被兑现的计划跟着兑现它的变更，替代与拆分（连同 `by`）几头取早的；未排章的与分叉算全局（-1）。 */
function bucketsOfChanges(view: CanonReadView, changes: readonly StoryChange[]): Map<string, number> {
    const chapterIndex = new Map(view.chapters.map((chapter, index) => [chapter, index] as const));
    const buckets = new Map<string, number>();
    for (const change of changes) {
        let bucket = change.nature === "fork" || change.at.kind !== "chapter" ? -1 : (chapterIndex.get(change.at.chapter) ?? -1);
        for (const telling of change.told) {
            const told = telling.chapter === undefined ? undefined : chapterIndex.get(telling.chapter);
            if (told !== undefined && told < bucket) bucket = told;
        }
        buckets.set(change.id, bucket);
    }
    const linked = changes.filter((change) => change.links.length > 0);
    const lower = (id: string, bucket: number) => {
        const known = buckets.get(id);
        if (known === undefined || known <= bucket) return false;
        buckets.set(id, bucket);
        return true;
    };
    // 跑到不动点：链接是一张图，写入的先后不保证拓扑顺序，也没有长度上限。桶只降不升，所以一定收敛。
    for (let moved = true; moved; ) {
        moved = false;
        for (const change of linked) {
            for (const link of change.links) {
                const [own, other] = [buckets.get(change.id)!, buckets.get(link.plan)];
                if (other === undefined) continue;
                if (lower(link.plan, own)) moved = true;
                if (link.kind === "fulfills") continue;
                const early = Math.min(other, own);
                if (lower(change.id, early)) moved = true;
                // 拆出的计划计入与否看 `by` 那条兑现变更的状态（canon.model 输出 13），与位置无关：`by` 要跟着计划。
                if (link.kind === "splitFrom" && lower(link.by, early)) moved = true;
            }
        }
    }
    return buckets;
}

/** 决策的摘要按它能涉及什么分开放（与 `involves` 同一个口径，只多不少）：写一条决策，只有它涉及的章要重拼。 */
interface DecisionFold {
    /** 判断不了涉及哪一章的（挂在剧情线上，或范围的章不在章序里）：每一章都算。 */
    readonly everywhere: readonly string[];
    readonly byChapter: ReadonlyMap<string, readonly string[]>;
    readonly byEntry: ReadonlyMap<string, readonly string[]>;
    readonly scoped: readonly {readonly from: number; readonly to: number; readonly digest: string}[];
}

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

/** 活页夹讲到的线与它们的祖先。别的线计划读不到，也免得把所有线建出来、超过常驻名额反复淘汰。 */
function readableLines(view: CanonReadView): ReadonlyMap<string, CanonReadView | null> {
    const parents = new Map(view.lines().map((summary) => [summary.id, summary.parent] as const));
    const found = new Map<string, CanonReadView | null>();
    const visit = (line: string | undefined) => {
        for (let current = line; current !== undefined && !found.has(current); current = parents.get(current)) {
            const on = current === view.line ? view : view.onLine(current, "planned");
            found.set(current, "code" in on ? null : on);
        }
    };
    visit(MAIN_LINE);
    for (const chapter of view.chapters) for (const segment of view.chapterLines(chapter)) visit(segment.line);
    return found;
}

/** 一处讲述的发生点：找到的才有。 */
interface Found {
    readonly chapter: string;
    readonly paragraph: number;
}

interface OwnFold {
    readonly digests: string[];
    readonly mentions: Set<string>;
}

interface WorldFold {
    /** 下标 `i + 1` 是第 i 章（含）以前的章序；下标 0 是线与全部分叉。 */
    readonly order: readonly string[];
    readonly identity: Prefix;
    readonly foreshadow: Prefix;
    readonly histories: ReadonlyMap<string, Prefix>;
    /** 知识点与目标，按父条目。 */
    readonly children: ReadonlyMap<string, readonly {readonly id: string; readonly bucket: number}[]>;
    /** 条目的桶：出场与重述取早的，没写出场的算全局。 */
    readonly entryBuckets: ReadonlyMap<string, number>;
    readonly own: ReadonlyMap<string, OwnFold>;
    readonly material: ReadonlyMap<string, Prefix>;
    readonly decisions: DecisionFold;
    /** 每个知识点最晚的明说揭示所在章。 */
    readonly reveals: ReadonlyMap<string, number>;
    readonly declarations: string;
    /** 每条线到定义它与它的祖先线的分叉所在章里最晚的下标。 */
    readonly lineBound: ReadonlyMap<string, number>;
}

/** 条目本身：`folder`、`order` 只管在树里怎么摆，计划不读。 */
function entryDigest(entry: Entry, digest: Digest, caches: Caches): string {
    let found = caches.projections.get(entry);
    if (found === undefined) {
        const {folder: _folder, order: _order, ...rest} = entry;
        found = digest(canonicalJson(rest));
        caches.projections.set(entry, found);
    }
    return found;
}

const identityValue = (entry: Entry) => ({id: entry.id, type: entry.type, parent: entry.parent, deleted: entry.deleted ?? false, sameAs: entry.sameAs ?? null, appears: entry.appears ?? null, name: entry.init.name, aliases: entry.init.aliases, mask: (entry.init.data.point?.fields as {揭穿?: unknown} | undefined)?.揭穿 ?? null});

/** 改身份的路径：名字、别名、`揭穿`。 */
const isNamePath = (path: string) => path === "entry.name" || path === "entry.aliases";
const isMaskPath = (path: string) => path === "point" || path === "point.揭穿";

const folds = perViewCache<WorldFold>();
function worldFold(view: CanonReadView, digest: Digest): WorldFold {
    return folds(view, "", () => {
        const caches = cachesOf(digest);
        const entries = view.entries();
        const changes = view.allChanges();
        const chapterIndex = new Map(view.chapters.map((chapter, index) => [chapter, index] as const));
        const toldIndex = (telling: Telling) => (telling.chapter === undefined ? -1 : (chapterIndex.get(telling.chapter) ?? -1));

        // 对象：变更、核对点、条目上的重述，都走同一个“项”。
        const changeBuckets = bucketsOfChanges(view, changes);
        const things: Thing[] = changes.map((change) => ({
            value: change,
            change,
            tellings: change.told,
            placedIn: change.at.kind === "chapter" ? [change.at.chapter] : [],
            bucket: changeBuckets.get(change.id)!,
            mentions: factsOf(change, digest, caches).mentions,
        }));
        for (const check of view.allChecks()) {
            const anchorAt = check.anchor === undefined ? undefined : (view.object({kind: "change", id: check.anchor.change}) as StoryChange | undefined)?.at;
            // 讲述算读者读过，所以讲述与安放取早的。比较时点决定那一章涉及的条目（canon.model 输出 20），挂靠了变更时在那条变更上：那一章算本章的对象（`placedIn`），不影响别的章。
            const known = [toldIndex(check.told), placementIndex(view, check.place)].filter((index) => index !== -1);
            things.push({value: check, tellings: [check.told], placedIn: [check.place, anchorAt].flatMap((at) => (at?.kind === "chapter" ? [at.chapter] : [])), bucket: known.length === 0 ? -1 : Math.min(...known), mentions: factsOf(check as Check, digest, caches).mentions});
        }
        const entryBuckets = new Map<string, number>();
        for (const entry of entries) {
            const retold = Object.values(entry.retold ?? {}).flat();
            // 重述的讲述也是读者读到的：出场更晚的条目也可能在前面的章被讲到。
            const told = retold.map(toldIndex).filter((index) => index !== -1);
            const appears = placementIndex(view, entry.appears);
            entryBuckets.set(entry.id, entry.appears === undefined || appears === -1 ? -1 : Math.min(appears, ...told));
            if (retold.length > 0) things.push({value: entry.retold!, tellings: retold, placedIn: [], bucket: told.length === 0 ? -1 : Math.min(...told), mentions: factsOf(entry.retold!, digest, caches).mentions});
        }

        // 链接成组：组里任何一条提到 X，整组都算提到 X（计划的节点、进展与拆分都跨链接读）。
        const groups = new Map<string, string>();
        const rootOf = (id: string): string => {
            let root = id;
            while (groups.get(root) !== undefined && groups.get(root) !== root) root = groups.get(root)!;
            return root;
        };
        const union = (a: string, b: string) => {
            const [rootA, rootB] = [rootOf(a), rootOf(b)];
            // 根也要记下：下面按 `groups` 的键收组里每一条提到的。
            groups.set(rootB, rootB);
            groups.set(rootA, rootB);
        };
        for (const change of changes) {
            for (const link of change.links) {
                union(change.id, link.plan);
                if (link.kind === "splitFrom") union(change.id, link.by);
            }
        }
        if (groups.size > 0) {
            const byRoot = new Map<string, Set<string>>();
            const thingOf = new Map(things.flatMap((thing) => (thing.change === undefined ? [] : [[thing.change.id, thing] as const])));
            for (const id of groups.keys()) {
                const root = rootOf(id);
                const set = byRoot.get(root) ?? new Set<string>();
                for (const mention of thingOf.get(id)?.mentions ?? []) set.add(mention);
                byRoot.set(root, set);
            }
            for (const id of groups.keys()) {
                const thing = thingOf.get(id);
                if (thing !== undefined) thing.mentions = [...byRoot.get(rootOf(id))!];
            }
        }

        // 伏笔、可能的答案、身份集合。
        const foreshadowIds = new Set(entries.filter((entry) => entry.type === ENTRY_TYPES.foreshadow).map((entry) => entry.id));
        const pointIds = new Set(entries.filter((entry) => entry.type === ENTRY_TYPES.point).map((entry) => entry.id));
        /** 可能以这个知识点为答案的伏笔（伏笔的条目与改它的补丁里提到的知识点；答案随位置变，多算无妨）。 */
        const answeredBy = new Map<string, Set<string>>();
        const addAnswer = (point: string, foreshadow: string) => {
            if (!pointIds.has(point)) return;
            const set = answeredBy.get(point) ?? new Set<string>();
            set.add(foreshadow);
            answeredBy.set(point, set);
        };
        for (const entry of entries) if (foreshadowIds.has(entry.id)) for (const mention of factsOf(entry, digest, caches).mentions) addAnswer(mention, entry.id);
        for (const thing of things) for (const patch of thing.change?.patches ?? []) if (foreshadowIds.has(patch.at.entry)) for (const mention of factsOf(patch, digest, caches).mentions) addAnswer(mention, patch.at.entry);
        const answersOfForeshadow = new Map<string, string[]>();
        for (const [point, by] of answeredBy) for (const id of by) answersOfForeshadow.set(id, [...(answersOfForeshadow.get(id) ?? []), point]);
        const revealedAnswers = (thing: Thing) => thing.tellings.flatMap((telling) => marksOf(telling).flatMap((mark) => (mark.kind === MARK_IDS.reveal && mark.version === 1 && typeof mark.point === "string" && answeredBy.has(mark.point) ? [mark.point] : [])));
        const inForeshadow = (thing: Thing) => thing.mentions.some((id) => foreshadowIds.has(id)) || revealedAnswers(thing).length > 0;
        const isMaskChange = (thing: Thing) => (thing.change?.patches ?? []).some((patch) => isMaskPath(patch.at.path));
        const identitySet = new Set<string>([...pointIds, ...foreshadowIds]);
        for (const entry of entries) if (pointIds.has(entry.id) || foreshadowIds.has(entry.id)) for (const mention of factsOf(entry, digest, caches).mentions) identitySet.add(mention);
        for (const thing of things) if (inForeshadow(thing) || isMaskChange(thing)) for (const mention of thing.mentions) identitySet.add(mention);
        const isNameChange = (thing: Thing) => (thing.change?.patches ?? []).some((patch) => isNamePath(patch.at.path) && identitySet.has(patch.at.entry));

        // 项的两块：套没套上与发生点。
        const lines = readableLines(view);
        const chapterSegments = new Map(view.chapters.map((chapter) => [chapter, view.chapterLines(chapter)] as const));
        const located = new Map<string, Found>();
        for (const on of lines.values()) {
            if (on === null) continue;
            for (const item of effectiveTellings(on)) if (item.located.kind === "found") located.set(item.telling.id, {chapter: item.located.occurrence.chapter, paragraph: item.located.occurrence.paragraph});
        }
        const appliedOf = (change: StoryChange | undefined): string => {
            if (change === undefined || change.kind !== "written" || change.patches.length === 0) return "";
            const line = lineOfChange(change);
            if (!lines.has(line)) return "";
            const on = lines.get(line)!;
            return on === null ? "no-line" : String(on.outcome(change.id)?.applied === true);
        };
        /** 粗定位：找到没有、哪一章、落在该章第几段线。段落号只有 `own` 与 `material` 要。 */
        const coarse = (thing: Thing) => thing.tellings.map((telling) => {
            const found = telling.id === undefined ? undefined : located.get(telling.id);
            if (found === undefined) return "-";
            const segments = chapterSegments.get(found.chapter) ?? [];
            return `${found.chapter}:${String(segments.length <= 1 ? 0 : Math.max(segments.findLastIndex((segment) => segment.from <= found.paragraph), 0))}`;
        }).join(",");

        const histories = new Map<string, Prefix>();
        const historyOf = (id: string) => {
            let found = histories.get(id);
            if (found === undefined) {
                found = new Prefix();
                histories.set(id, found);
            }
            return found;
        };
        const identity = new Prefix();
        const foreshadow = new Prefix();
        const material = new Map<string, Prefix>();
        const materialOf = (id: string) => {
            let found = material.get(id);
            if (found === undefined) {
                found = new Prefix();
                material.set(id, found);
            }
            return found;
        };
        const own = new Map<string, OwnFold>();
        const ownOf = (chapter: string) => {
            let found = own.get(chapter);
            if (found === undefined) {
                found = {digests: [], mentions: new Set()};
                own.set(chapter, found);
            }
            return found;
        };
        const paragraphs = new Map<string, readonly {readonly text: string}[]>();
        const paragraphText = (found: Found) => {
            let list = paragraphs.get(found.chapter);
            if (list === undefined) {
                list = paragraphsOf(view.chapterText(found.chapter) ?? "");
                paragraphs.set(found.chapter, list);
            }
            return list[found.paragraph - 1]?.text ?? "";
        };

        const addItem = (thing: Thing, stamp: string) => {
            const objectDigest = factsOf(thing.value, digest, caches).digest;
            const applied = appliedOf(thing.change);
            const value = valueOf(caches.items, thing.value, `${objectDigest}|${applied}|${coarse(thing)}|${stamp}`, digest);
            for (const id of thing.mentions) historyOf(id).add(thing.bucket, value);
            if (inForeshadow(thing)) foreshadow.add(thing.bucket, value);
            if (isMaskChange(thing) || isNameChange(thing)) identity.add(thing.bucket, value);
            // 试读的材料：可能以 K 为答案的伏笔涉及的项（标它的节点、K 上的揭示、继承）里每处讲述的段落与那一段的文字。
            const answers = new Set([...revealedAnswers(thing), ...thing.mentions.flatMap((id) => answersOfForeshadow.get(id) ?? [])]);
            if (answers.size > 0) {
                const where = thing.tellings.map((telling) => {
                    const found = telling.id === undefined ? undefined : located.get(telling.id);
                    return found === undefined ? "-" : `${found.chapter}:${String(found.paragraph)}:${digest(paragraphText(found))}`;
                }).join(",");
                const exactValue = valueOf(caches.exact, thing.value, `${objectDigest}|${where}`, digest);
                for (const point of answers) materialOf(point).add(thing.bucket, exactValue);
            }
            // 本章的对象：只放对象本身，提到的条目进 `R`。发生点由本章正文与引文决定（都在摘要里）；套没套上、联动戳在提到的条目的历史里。
            const chapters = new Set([...thing.placedIn, ...thing.tellings.flatMap((telling) => (telling.chapter === undefined ? [] : [telling.chapter]))]);
            if (chapters.size > 0) {
                for (const chapter of chapters) {
                    const fold = ownOf(chapter);
                    fold.digests.push(objectDigest);
                    for (const id of thing.mentions) fold.mentions.add(id);
                }
            }
        };

        // 按桶升序：计划的联动戳只依赖更早的，加同一桶里的已写变更。
        const byBucket = new Map<number, Thing[]>();
        for (const thing of things) {
            const list = byBucket.get(thing.bucket);
            if (list === undefined) byBucket.set(thing.bucket, [thing]);
            else list.push(thing);
        }
        const targetsOf = (thing: Thing) => [...new Set((thing.change?.patches ?? []).map((patch) => patch.at.entry))];
        for (const bucket of [...byBucket.keys()].sort((a, b) => a - b)) {
            const inBucket = byBucket.get(bucket)!;
            // 改两个以上条目的计划：能不能整条套上取决于别的条目的历史，引擎又没有计划的结论（`outcome` 只有已写变更）。只改一个条目的，这个条目自己的历史已经覆盖。
            const linked = inBucket.filter((thing) => thing.change?.kind === "plan" && targetsOf(thing).length >= 2);
            for (const thing of inBucket) if (!linked.includes(thing)) addItem(thing, "");
            if (linked.length > 0) {
                const targets = [...new Set(linked.flatMap(targetsOf))].sort();
                const stamp = digest(canonicalJson({plans: linked.map((thing) => factsOf(thing.value, digest, caches).digest).sort(), targets: targets.map((id) => [id, histories.get(id)?.at(bucket) ?? "0"])}));
                for (const thing of linked) addItem(thing, stamp);
            }
        }

        // 身份与伏笔的条目。
        for (const entry of entries) {
            if (identitySet.has(entry.id)) {
                identity.add(foreshadowIds.has(entry.id) ? -1 : entryBuckets.get(entry.id)!, valueOf(caches.exact, entry, canonicalJson(identityValue(entry)), digest));
            }
            if (foreshadowIds.has(entry.id)) foreshadow.add(-1, valueOf(caches.items, entry, entryDigest(entry, digest, caches), digest));
        }

        const children = new Map<string, {id: string; bucket: number}[]>();
        for (const entry of entries) {
            if (entry.parent === null || (entry.type !== ENTRY_TYPES.point && entry.type !== ENTRY_TYPES.goal)) continue;
            children.set(entry.parent, [...(children.get(entry.parent) ?? []), {id: entry.id, bucket: entryBuckets.get(entry.id)!}]);
        }

        // 章序、线、分叉。
        const forks = changes.filter((change) => change.nature === "fork").map((change) => factsOf(change, digest, caches).digest).sort();
        const order: string[] = [digest(canonicalJson({lines: view.lines(), forks}))];
        for (const [index, chapter] of view.chapters.entries()) order.push(digest(`${order[index]!}|${chapter}|${JSON.stringify(chapterSegments.get(chapter))}`));

        const summaries = new Map(view.lines().map((summary) => [summary.id, summary]));
        const lineBound = new Map<string, number>();
        for (const summary of summaries.values()) {
            let bound = -1;
            for (let line: typeof summary | undefined = summary; line !== undefined; line = summaries.get(line.parent)) {
                bound = Math.max(bound, placementIndex(view, (view.object({kind: "change", id: line.fork}) as StoryChange | undefined)?.at));
            }
            lineBound.set(summary.id, bound);
        }
        return {order, identity, foreshadow, histories, children, entryBuckets, own, material, decisions: decisionFold(view, digest), reveals: revealTable(view), declarations: view.declarationsDigest(), lineBound};
    });
}

export interface DependencyInput {
    readonly view: CanonReadView;
    readonly chapter: string;
    readonly followUps: readonly string[];
    /** 存下的（或这次计划算出的）本章涉及的知识点与条目。 */
    readonly points: readonly string[];
    readonly concerns: readonly string[];
    readonly instruction?: {readonly snapshot: Parameters<typeof flashbackOf>[0]; readonly digest: string};
    readonly selfReport?: string;
    readonly pluginVersion: string;
    readonly digest: Digest;
}

function boundOf(input: DependencyInput, fold: WorldFold): number {
    const {view, chapter} = input;
    const flashback = placementIndex(view, flashbackOf(input.instruction?.snapshot));
    return Math.max(view.chapters.indexOf(chapter), flashback, ...view.chapterLines(chapter).map((segment) => fold.lineBound.get(segment.line) ?? -1));
}

/** `R`：摘要按条目本身与它的历史覆盖的条目。 */
export function entriesRead(input: DependencyInput): ReadonlySet<string> {
    const fold = worldFold(input.view, input.digest);
    const bound = boundOf(input, fold);
    // 视角人物还没出场时计划不读他（写作指示不经内核校验）。
    const pov = input.instruction?.snapshot?.pov?.id;
    const readsPov = pov !== undefined && (fold.entryBuckets.get(pov) ?? -1) <= bound;
    const direct = new Set([...input.points, ...input.concerns, ...(fold.own.get(input.chapter)?.mentions ?? []), ...(readsPov ? [pov] : [])]);
    const read = new Set(direct);
    for (const id of direct) for (const child of fold.children.get(id) ?? []) if (child.bucket <= bound) read.add(child.id);
    return read;
}

/** 这一章现在的依赖摘要。章不在章序里时为 null（计划也读不到它）。 */
export function dependenciesOf(input: DependencyInput): string | null {
    const {view, chapter, digest, points} = input;
    const here = view.chapters.indexOf(chapter);
    if (here === -1) return null;
    const fold = worldFold(view, digest);
    const caches = cachesOf(digest);
    const bound = boundOf(input, fold);
    const own = fold.own.get(chapter);
    const read = entriesRead(input);
    const {everywhere, byChapter, byEntry, scoped} = fold.decisions;
    const decisions = new Set([...everywhere, ...(byChapter.get(chapter) ?? [])]);
    for (const entry of read) for (const content of byEntry.get(entry) ?? []) decisions.add(content);
    for (const range of scoped) if (range.from <= here && here <= range.to) decisions.add(range.digest);
    const entries = [...read].sort().map((id) => {
        const stored = view.object({kind: "entry", id}) as Entry | undefined;
        return [id, stored === undefined ? null : entryDigest(stored, digest, caches), fold.histories.get(id)?.at(bound) ?? "0"];
    });
    const previous = view.chapters[here - 1];
    return digest(canonicalJson({
        algorithm: ALGORITHM,
        plugin: input.pluginVersion,
        declarations: fold.declarations,
        instruction: input.instruction?.digest ?? null,
        selfReport: input.selfReport ?? null,
        followUps: input.followUps,
        order: [fold.order[0]!, fold.order[bound + 1]!],
        identity: fold.identity.at(bound),
        foreshadow: fold.foreshadow.at(bound),
        text: [view.chapterTextDigest(chapter) ?? null, previous === undefined ? null : (view.chapterTextDigest(previous) ?? null)],
        own: [...(own?.digests ?? [])].sort(),
        entries,
        material: points.map((point) => [point, fold.material.get(point)?.at(bound) ?? "0"]),
        decisions: [...decisions].sort(),
        later: points.filter((point) => (fold.reveals.get(point) ?? -1) > here),
    }));
}
