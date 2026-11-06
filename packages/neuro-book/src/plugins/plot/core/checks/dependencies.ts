/**
 * 依赖的摘要（docs/specs/plot/checks.md 输出 7：实现可以先比各项依赖的摘要、不同时才重拼，结果必须与重拼相同）。全书都跑过检查时，每次读待处理都重拼要几分钟，所以比这个摘要：
 * 相同就直接用记录的结论，不同才 `planCheck`。
 *
 * **只能多算不能漏**：`planCheck` 读到的一切都要算进来。`B` 是这一章、补叙安放，以及这一章和它以前讲过的线（试读的材料读活页夹讲过的每条线）的分叉、切口、触发处所在章里最晚的一章，
 * 桶晚于 `B` 的东西计划读不到。
 *
 * | 计划读的 | 在哪 | 摘要里 |
 * |---|---|---|
 * | 章序、分段、线能不能建、线看得到什么（切口与触发处的位置） | `framesOf`、`segmentsOf`、`positionKey` | `order` |
 * | 本章与上一章正文 | `segmentsOf`、`pointsAfterWriting`、`buildTrial` | `own` |
 * | 本章的变更、计划、核对点，发生点，涉及的条目 | `writtenIn`、`plansOf`、`chapterEntries` | `own`（发生点由正文与引文决定；涉及的条目由这些对象决定；核对点比较时点的翻转由挂靠的变更决定，在它改的条目的历史里） |
 * | 变更里在场的人、马甲（讲述在本章的也算） | `presentPeople` | 本章的对象提到的条目进 `R` |
 * | 全部知识点的父条目、是否删除、出场、名字、`揭穿`，被引条目的名字 | `pointsAfterWriting`、`pointsBeforeWriting` | `identity` |
 * | 条目在位置上的值（实际模式：写完以后的集合不按计划模式读，knowledge 输出 10） | `readAppeared`、`secrecyOf` | `entries` |
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
 * **为什么认为不会漏**：计划是这些读取的纯函数。除 `entries` 以外的各项都没变，且 `R` 里每个条目都没变时，同样的读取得到同样的值，于是算出同样的 `points` 与 `concerns`，`R` 也不变（不动点，
 * 对“`R` 是当前计划的”成立；过期记录的备忘按重拼的计划算，见 `source.ts`）。跨条目的间接影响走“一条变更整条套上或整条不套”，项里放引擎算出的结论，不沿着共同提到走闭包，否则很快连成全书。
 * 这条路只在实际模式上成立：引擎不给按计划模式的覆盖层上的结论。所以计划的读取路径上**不能读按计划模式的值**（`pointsAfterWriting` 传 `actual`）；为了绕开这一点曾经在摘要里推理覆盖层，每一轮审查都漏，不要走回去。
 * 这是推理，不是证明：这张表漏过几次（`dependencies.test.ts` 的“跨条目”那一组都是真实的反例），改计划时要重新过一遍。
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

const ALGORITHM = 3;

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
    readonly identities: WeakMap<object, ItemValue>;
}
const perDigest = new WeakMap<Digest, Caches>();
function cachesOf(digest: Digest): Caches {
    let found = perDigest.get(digest);
    if (found === undefined) {
        found = {facts: new WeakMap(), projections: new WeakMap(), items: new WeakMap(), exact: new WeakMap(), identities: new WeakMap()};
        perDigest.set(digest, found);
    }
    return found;
}
/** 变更的说明文字与线名计划不读：改它们不用重拼。提到谁也不从这里取，说明文字里写的 id 不算读。 */
function readableChange(change: StoryChange): object {
    const {text: _text, fork, ...rest} = change;
    if (fork === undefined) return rest;
    const {name: _name, ...forkFields} = fork;
    return {...rest, fork: forkFields};
}
function factsOf(value: object, digest: Digest, caches: Caches, project: (value: never) => object = (same) => same): ObjectFacts {
    let found = caches.facts.get(value);
    if (found === undefined) {
        const text = canonicalJson(project(value as never));
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

/** 按桶累加的前缀：累加与顺序无关，项的键里已经有 `at`，桶也由内容决定。调用方按桶升序加（`worldFold` 的主循环），所以这里只是加法。 */
class Prefix {
    readonly #buckets: number[] = [];
    readonly #a: number[] = [];
    readonly #b: number[] = [];
    readonly #n: number[] = [];
    readonly #texts: (string | undefined)[] = [];

    add(bucket: number, value: {readonly a: number; readonly b: number}): void {
        const last = this.#buckets.length - 1;
        const [nextA, nextB] = [((this.#a[last] ?? 0) + value.a) % MODULUS, ((this.#b[last] ?? 0) + value.b) % MODULUS];
        if (this.#buckets[last] === bucket) {
            this.#a[last] = nextA;
            this.#b[last] = nextB;
            this.#n[last]! += 1;
            this.#texts[last] = undefined;
        } else {
            this.#buckets.push(bucket);
            this.#a.push(nextA);
            this.#b.push(nextB);
            this.#n.push((this.#n[last] ?? 0) + 1);
        }
    }

    #indexAt(bound: number): number {
        let [low, high] = [0, this.#buckets.length];
        while (low < high) {
            const middle = (low + high) >> 1;
            if (this.#buckets[middle]! <= bound) low = middle + 1;
            else high = middle;
        }
        return low - 1;
    }

    /** 到桶 `bound`（含）为止的累加。 */
    at(bound: number): string {
        const index = this.#indexAt(bound);
        if (index < 0) return "0";
        return (this.#texts[index] ??= `${String(this.#a[index]!)}.${String(this.#b[index]!)}.${String(this.#n[index]!)}`);
    }

    /** 把到桶 `bound`（含）为止的累加并进 `total`：一千章每次发布各并上百个条目，不拼字符串，也不用排序。 */
    addTo(total: {a: number; b: number; n: number}, bound: number): void {
        const index = this.#indexAt(bound);
        if (index < 0) return;
        total.a = (total.a + this.#a[index]!) % MODULUS;
        total.b = (total.b + this.#b[index]!) % MODULUS;
        total.n += this.#n[index]!;
    }
}

/** 带讲述的对象：剧情变更、核对点、一个条目上的全部重述。 */
interface Thing {
    /** 缓存用的身份，也是摘要的内容。 */
    readonly value: object;
    readonly change?: StoryChange;
    /** 核对点挂靠的变更：它套没套上决定比较时点在挂靠处还是在安放处（canon.model 输出 11）。 */
    readonly anchor?: StoryChange;
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

/**
 * 全部线上的变更分桶：讲述先于安放的按讲述算（读者读到的），被兑现的计划跟着兑现它的变更（已写变更继承计划的节点，foreshadowing.ts）；未排章的与分叉算全局（-1）。
 * 替代与拆分不用跟：它们只决定按计划模式计入哪些计划，计划的路径不读（`later` 用的 `revealTable` 是全局一张表）。
 */
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
    for (const change of changes) {
        for (const link of change.links) {
            if (link.kind !== "fulfills") continue;
            const plan = buckets.get(link.plan);
            if (plan !== undefined && buckets.get(change.id)! < plan) buckets.set(link.plan, buckets.get(change.id)!);
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
    /** 下标 `i + 1` 是第 i 章（含）以前的章序，从线与全部分叉（下标 0）滚动下来。 */
    readonly order: readonly string[];
    readonly identity: Prefix;
    readonly foreshadow: Prefix;
    readonly histories: ReadonlyMap<string, Prefix>;
    /** 知识点与目标，按父条目。 */
    readonly children: ReadonlyMap<string, readonly {readonly id: string; readonly bucket: number}[]>;
    /** 条目的桶：出场与重述取早的，没写出场的算全局。 */
    readonly entryBuckets: ReadonlyMap<string, number>;
    readonly identitySet: ReadonlySet<string>;
    readonly own: ReadonlyMap<string, OwnFold>;
    readonly material: ReadonlyMap<string, Prefix>;
    readonly decisions: DecisionFold;
    /** 每个知识点最晚的明说揭示所在章。 */
    readonly reveals: ReadonlyMap<string, number>;
    readonly declarations: string;
    /** 第 i 章的边界：这一章和它以前讲过的线的分叉、切口、触发处（连同祖先线）所在章里最晚的下标。 */
    readonly readBound: readonly number[];
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

const identityValue = (entry: Entry) => ({id: entry.id, type: entry.type, parent: entry.parent, deleted: entry.deleted ?? false, sameAs: entry.sameAs ?? null, appears: entry.appears ?? null, name: entry.init.name, aliases: entry.init.aliases, maskEnabled: entry.init.data.point?.enabled ?? null, mask: (entry.init.data.point?.fields as {揭穿?: unknown} | undefined)?.揭穿 ?? null});

/** 改身份的路径：名字、别名、`揭穿`（命名空间没启用时读不到它）。 */
const isNamePath = (path: string) => path === "entry.name" || path === "entry.aliases";
const isMaskPath = (path: string) => path === "point.揭穿" || path === "point.启用";

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
            mentions: factsOf(change, digest, caches, readableChange).mentions,
        }));
        for (const check of view.allChecks()) {
            const anchor = check.anchor === undefined ? undefined : (view.object({kind: "change", id: check.anchor.change}) as StoryChange | undefined);
            const anchorAt = anchor?.at;
            // 讲述算读者读过，所以讲述与安放取早的。比较时点决定那一章涉及的条目（canon.model 输出 20），挂靠了变更时在那条变更上：那一章算本章的对象（`placedIn`），不影响别的章。
            const known = [toldIndex(check.told), placementIndex(view, check.place)].filter((index) => index !== -1);
            things.push({value: check, ...(anchor === undefined ? {} : {anchor}), tellings: [check.told], placedIn: [check.place, anchorAt].flatMap((at) => (at?.kind === "chapter" ? [at.chapter] : [])), bucket: known.length === 0 ? -1 : Math.min(...known), mentions: factsOf(check as Check, digest, caches).mentions});
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

        // 兑现成组：组里任何一条提到 X，整组都算提到 X（已写变更继承计划的节点）。
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
            for (const link of change.links) if (link.kind === "fulfills") union(change.id, link.plan);
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
        const revealedAnswers = (thing: Thing) => {
            const found: string[] = [];
            for (const telling of thing.tellings) for (const mark of marksOf(telling)) if (mark.kind === MARK_IDS.reveal && mark.version === 1 && typeof mark.point === "string" && answeredBy.has(mark.point)) found.push(mark.point);
            return found;
        };
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
        // 结论按线一次取完：逐条问时线与线交替，超过常驻名额就要反复淘汰重建（canon.worldlines 输出 9）。
        const outcomes = new Map<string, boolean>();
        for (const [line, on] of lines) {
            if (on === null) continue;
            for (const change of changes) if (change.kind === "written" && lineOfChange(change) === line) outcomes.set(change.id, on.outcome(change.id)?.applied === true);
        }
        const appliedOf = (change: StoryChange | undefined): string => {
            if (change === undefined || change.kind !== "written" || change.patches.length === 0) return "";
            const line = lineOfChange(change);
            if (!lines.has(line)) return "";
            return lines.get(line) === null ? "no-line" : String(outcomes.get(change.id) === true);
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

        // 核对点放挂靠的变更算不算数：它决定比较时点在挂靠处还是在安放处。没有补丁的变更也算，撤销了就回到安放处。核对点是本章的对象，它改的条目在 `R` 里，这一项在那个条目的历史里。
        const anchorState = (anchor: StoryChange) => {
            const on = lines.get(lineOfChange(anchor));
            return on === undefined ? "" : on === null ? "no-line" : `${anchor.status}:${String(outcomes.get(anchor.id) === true)}`;
        };
        const itemKey = (thing: Thing) => `${factsOf(thing.value, digest, caches).digest}|${thing.anchor === undefined ? appliedOf(thing.change) : anchorState(thing.anchor)}|${coarse(thing)}`;
        const addItem = (thing: Thing) => {
            const objectDigest = factsOf(thing.value, digest, caches).digest;
            const value = valueOf(caches.items, thing.value, itemKey(thing), digest);
            for (const id of thing.mentions) historyOf(id).add(thing.bucket, value);
            if (inForeshadow(thing)) foreshadow.add(thing.bucket, value);
            if (isMaskChange(thing) || isNameChange(thing)) identity.add(thing.bucket, value);
            // 试读的材料：可能以 K 为答案的伏笔涉及的项（标它的节点、K 上的揭示、继承）里每处讲述的段落与那一段的文字。
            const answers = new Set(revealedAnswers(thing));
            for (const id of thing.mentions) for (const point of answersOfForeshadow.get(id) ?? []) answers.add(point);
            if (answers.size > 0) {
                const where = thing.tellings.map((telling) => {
                    const found = telling.id === undefined ? undefined : located.get(telling.id);
                    return found === undefined ? "-" : `${found.chapter}:${String(found.paragraph)}:${digest(paragraphText(found))}`;
                }).join(",");
                const exactValue = valueOf(caches.exact, thing.value, `${objectDigest}|${where}`, digest);
                for (const point of answers) materialOf(point).add(thing.bucket, exactValue);
            }
            // 本章的对象：只放对象本身，提到的条目进 `R`。发生点由本章正文与引文决定（都在摘要里）；套没套上在提到的条目的历史里。
            const chapters = new Set(thing.placedIn);
            for (const telling of thing.tellings) if (telling.chapter !== undefined) chapters.add(telling.chapter);
            for (const chapter of chapters) {
                const fold = ownOf(chapter);
                fold.digests.push(objectDigest);
                for (const id of thing.mentions) fold.mentions.add(id);
            }
        };

        // 条目本身：进它自己的历史（全局那一桶，改了条目本身读它的章都要重拼），身份集合里的进 `identity`，伏笔进 `foreshadow`。
        const entriesInBucket = new Map<number, Entry[]>();
        for (const entry of entries) {
            if (!identitySet.has(entry.id)) continue;
            const bucket = foreshadowIds.has(entry.id) ? -1 : entryBuckets.get(entry.id)!;
            const list = entriesInBucket.get(bucket);
            if (list === undefined) entriesInBucket.set(bucket, [entry]);
            else list.push(entry);
        }
        for (const entry of entries) {
            historyOf(entry.id).add(-1, valueOf(caches.items, entry, entryDigest(entry, digest, caches), digest));
            if (foreshadowIds.has(entry.id)) foreshadow.add(-1, valueOf(caches.items, entry, entryDigest(entry, digest, caches), digest));
        }

        // 按桶升序：累加要求升序。
        const byBucket = new Map<number, Thing[]>();
        for (const thing of things) {
            const list = byBucket.get(thing.bucket);
            if (list === undefined) byBucket.set(thing.bucket, [thing]);
            else list.push(thing);
        }
        for (const bucket of [...new Set([...byBucket.keys(), ...entriesInBucket.keys()])].sort((a, b) => a - b)) {
            for (const entry of entriesInBucket.get(bucket) ?? []) {
                let value = caches.identities.get(entry);
                if (value === undefined) {
                    const hex = digest(canonicalJson(identityValue(entry)));
                    value = {key: "", a: parseInt(hex.slice(0, 13), 16), b: parseInt(hex.slice(13, 26), 16)};
                    caches.identities.set(entry, value);
                }
                identity.add(bucket, value);
            }
            for (const thing of byBucket.get(bucket) ?? []) addItem(thing);
        }

        const children = new Map<string, {id: string; bucket: number}[]>();
        for (const entry of entries) {
            if (entry.parent === null || (entry.type !== ENTRY_TYPES.point && entry.type !== ENTRY_TYPES.goal)) continue;
            const list = children.get(entry.parent);
            if (list === undefined) children.set(entry.parent, [{id: entry.id, bucket: entryBuckets.get(entry.id)!}]);
            else list.push({id: entry.id, bucket: entryBuckets.get(entry.id)!});
        }

        // 章序、线、分叉。
        // 线看得到什么：看切口与触发处两条变更现在在哪、还算不算数（挪它们，子线看得到的前史就变了）；分叉自己除了线名都读。线名计划不读。
        const summaryOf = view.lines().map(({name: _name, ...rest}) => rest);
        const lineDigests = view.lines().map((line) => {
            const edge = (id: string | undefined) => {
                const stored = id === undefined ? undefined : (view.object({kind: "change", id}) as StoryChange | undefined);
                return stored === undefined ? null : {at: stored.at, status: stored.status, kind: stored.kind};
            };
            const fork = view.object({kind: "change", id: line.fork}) as StoryChange | undefined;
            const {name: _forkName, ...forkFields} = fork?.fork ?? {name: ""};
            return {cut: edge(line.cut), trigger: edge(line.trigger), fork: forkFields, at: fork?.at ?? null, status: fork?.status ?? null};
        });
        const order: string[] = [digest(canonicalJson({lines: summaryOf, lineDigests}))];
        for (const [index, chapter] of view.chapters.entries()) order.push(digest(`${order[index]!}|${chapter}|${JSON.stringify(chapterSegments.get(chapter))}`));

        const summaries = new Map(view.lines().map((summary) => [summary.id, summary]));
        const lineBound = new Map<string, number>();
        for (const summary of summaries.values()) {
            let bound = -1;
            // 带过去的值读到切口或触发处：分叉所在章删了以后，分叉没有位置，线仍可建（canon.worldlines 输出 18）。
            for (let line: typeof summary | undefined = summary; line !== undefined; line = summaries.get(line.parent)) {
                for (const id of [line.fork, line.cut, line.trigger]) {
                    if (id !== undefined) bound = Math.max(bound, placementIndex(view, (view.object({kind: "change", id}) as StoryChange | undefined)?.at));
                }
            }
            lineBound.set(summary.id, bound);
        }
        // 试读读活页夹讲过的每条线：第 N 章的边界要算上第 N 章和它以前讲过的线。
        const readBound: number[] = [];
        for (const chapter of view.chapters) {
            let bound = readBound.at(-1) ?? -1;
            for (const segment of chapterSegments.get(chapter) ?? []) bound = Math.max(bound, lineBound.get(segment.line) ?? -1);
            readBound.push(bound);
        }
        return {order, identity, foreshadow, histories, children, entryBuckets, identitySet, readBound, own, material, decisions: decisionFold(view, digest), reveals: revealTable(view), declarations: view.declarationsDigest()};
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
    const here = view.chapters.indexOf(chapter);
    return Math.max(here, flashback, fold.readBound[here] ?? -1);
}

/** 身份集合：摘要只覆盖它们的名字、别名、出场、是否删除、`揭穿`。 */
export function identityEntries(view: CanonReadView, digest: Digest): ReadonlySet<string> {
    return worldFold(view, digest).identitySet;
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
    const bound = boundOf(input, fold);
    const own = fold.own.get(chapter);
    const read = entriesRead(input);
    const {everywhere, byChapter, byEntry, scoped} = fold.decisions;
    const decisions = new Set([...everywhere, ...(byChapter.get(chapter) ?? [])]);
    for (const entry of read) for (const content of byEntry.get(entry) ?? []) decisions.add(content);
    for (const range of scoped) if (range.from <= here && here <= range.to) decisions.add(range.digest);
    const previous = view.chapters[here - 1];
    // 条目历史的累加里已经有条目本身（全局那一桶，内容带 id）。累加与顺序无关，一千章每次发布各算一遍，不用排序、拼字符串。
    const entries = {a: 0, b: 0, n: 0};
    for (const id of read) fold.histories.get(id)?.addTo(entries, bound);
    // 次序都是这里定死的，不用规范 JSON 排键。
    return digest(JSON.stringify([
        ALGORITHM,
        input.pluginVersion,
        fold.declarations,
        input.instruction?.digest ?? null,
        input.selfReport ?? null,
        input.followUps,
        fold.order[bound + 1]!,
        fold.identity.at(bound),
        fold.foreshadow.at(bound),
        view.chapterTextDigest(chapter) ?? null,
        previous === undefined ? null : (view.chapterTextDigest(previous) ?? null),
        [...(own?.digests ?? [])].sort(),
        entries.a,
        entries.b,
        entries.n,
        points.map((point) => [point, fold.material.get(point)?.at(bound) ?? "0"]),
        [...decisions].sort(),
        points.filter((point) => (fold.reveals.get(point) ?? -1) > here),
    ]));
}
