/**
 * 增量引擎（docs/specs/canon/model.md；速度要求见 project.md 输出 14）。回答与参照实现（reference.ts）逐字相同，
 * 由 tests/differential.test.ts 守住。
 *
 * 做法：
 * - 一条变更套没套上只取决于它之前的状态（model.md 输出 7），所以整本前向遍历一次就得到每条变更的结果。遍历时
 *   给每个条目记一条**时间线**：按全序列出碰到它的事件（变更、语义档的核对点）与那条变更套没套上，每 8 个事件
 *   存一份这个条目的折叠结果。读第 N 章的一个条目：二分找到位置，从最近的一份往后回放最多 7 个事件。
 * - 发布：改到的对象让一些条目从某个位置起“变脏”。只重算碰到脏条目的事件；一条变更的结果与上一版不同时，
 *   它碰到的干净条目也从这里起变脏。干净条目在这一点之前的状态直接从上一版的时间线取。每次更新得到一份新的
 *   快照，整体换上，旧快照不改，所以读取总是看到某一个版本。
 * - 按计划模式（model.md 输出 5、13）：读取位置上计入的计划集合 S 随位置变。对一个 S，把这些计划当作插入的事件、
 *   以它们碰到的条目为脏条目，在实际模式的快照上跑同一个重算，得到一份覆盖层快照，按 S 缓存。
 * - 精确档的核对点不改状态，在快照上按时间线求值，结果按快照缓存。
 *
 * 章序或登记的 Component 类型变了时整本重建（project.md 输出 9，components.md 的登记变化）。
 */

import type {ComponentRegistry} from "../components/registry";
import {semanticText} from "../components/values";
import {addressKey, addressesOverlap} from "../core/address";
import {compareIds} from "../core/ids";
import {ENABLE_FIELD} from "../core/identifiers";
import {compareRanks, compareTie, placementRank, positionRank, rankBefore, type OrderTie, type Rank} from "../core/position";
import type {Address, Check, Entry, EntryState, FieldDeclaration, ReadPosition, StoryChange} from "../core/schema";
import {sameJson} from "../core/stable-json";
import {applyChange, incompleteAt, replayAnchor, replayChangeOnEntry, type ChangeResult, type FoldState, type IncompleteEvent} from "../model/apply";
import {fieldOf, reductionFieldId} from "./reference";
import {sortPending, type RankedPending} from "./pending";
import type {ChangeOutcome, Engine, EngineInputs, EntryView, Mode, OriginStep, PendingItem, PlanProgress, WorldData} from "./types";
import {buildEntryView, readEntryAddress, type EntryFold} from "./views";

const SNAPSHOT_EVERY = 8;

type Ev =
    | {readonly kind: "change"; readonly rank: Rank; readonly tie: OrderTie; readonly change: StoryChange; readonly entries: readonly string[]}
    | {readonly kind: "anchor"; readonly rank: Rank; readonly tie: OrderTie; readonly check: Check; readonly field: FieldDeclaration; readonly entries: readonly string[]};

interface Point {
    readonly rank: Rank;
    readonly tie: OrderTie;
    readonly inclusive: boolean;
}

interface MutableFold {
    state: EntryState;
    events: Map<string, string[]>;
}

/** 按计划模式的覆盖层最多留几份（每份是受影响条目的一套时间线）。 */
const OVERLAY_LIMIT = 8;

interface Item {
    readonly ev: Ev;
    readonly applied: boolean;
}

interface Timeline {
    readonly items: Item[];
    /** `snapshots[k]` 是套完第 `(k + 1) * 8 - 1` 个事件之后的折叠结果。 */
    readonly snapshots: MutableFold[];
    /** 不完整的标记与解除，带它发生在第几个事件。 */
    readonly incomplete: Array<{readonly item: number; readonly event: IncompleteEvent}>;
}

interface Snapshot {
    readonly events: readonly Ev[];
    readonly outcomes: ReadonlyMap<string, ChangeResult>;
    readonly timelines: ReadonlyMap<string, Timeline>;
}

/** 一次更新改到了哪些对象（按 id）；`structural` 为真时整本重建。 */
export interface ChangedRefs {
    readonly entries?: Iterable<string>;
    readonly changes?: Iterable<string>;
    readonly checks?: Iterable<string>;
    readonly structural?: boolean;
}

export interface IncrementalEngine extends Engine {
    readonly inputs: EngineInputs;
    /** 用新的世界与上一版的结果算出新引擎；本引擎不变。 */
    update(inputs: EngineInputs, changed: ChangedRefs): IncrementalEngine;
    /** 上一次构建或更新重算了几条事件（进 status 的诊断，project.md 方法表）。 */
    readonly recomputed: number;
    /** 实际模式下一条变更的详细结果（含每个补丁套上与否、不适用的原因）；写入时校验用。 */
    detail(change: string): ChangeResult | undefined;
    /** 实际模式下，一条变更之前那一刻某个地址的值（“由核对点推出的差额”的复算用）。 */
    valueBefore(change: string, at: Address): unknown;
}

const compareEvents = (a: {rank: Rank; tie: OrderTie}, b: {rank: Rank; tie: OrderTie}) => compareRanks(a.rank, b.rank) || compareTie(a.tie, b.tie);


export function createIncrementalEngine(inputs: EngineInputs): IncrementalEngine {
    const events = actualEvents(inputs);
    const {snapshot, recomputed} = recompute(inputs, null, events, null, new Set(inputs.world.entries.keys()));
    return engineFrom(inputs, snapshot, recomputed);
}

/**
 * 上一个版本的核对结果，交给新引擎沿用（只在非结构性的更新里给）。新引擎建好时就把还能用的逐条拷进自己的缓存，
 * 不留着对旧引擎的引用：否则每个版本都拉住上一个版本，世界的历史版本一直留在内存里。
 */
interface InheritedChecks {
    readonly results: ReadonlyMap<string, CheckResult | null>;
    readonly checks: WorldData["checks"];
    readonly dirtiedAt: ReadonlyMap<string, Point | null>;
}

type CheckResult = {readonly check: Check; readonly point: Point; readonly computed: unknown; readonly result: "ok" | "mismatch" | "skipped"};

function engineFrom(inputs: EngineInputs, actual: Snapshot, recomputed: number, inherited?: InheritedChecks): IncrementalEngine {
    const {world, order, registry} = inputs;
    const tieOf = (id: string): OrderTie => ({version: world.createdAt.get(id) ?? 0, id});
    const overlays = new Map<string, Snapshot>();
    const checkCache = new Map<string, CheckResult | null>();
    // 核对结果只取决于核对点本身与它所在条目在比较时点之前的时间线：核对点没换、没挂靠变更（挂靠的时点随那条变更变），
    // 条目没重算或只从比较时点之后重算的，结果不变（model.md 输出 11）。
    if (inherited !== undefined) {
        for (const [id, result] of inherited.results) {
            if (result === null || result === undefined) continue;
            const check = world.checks.get(id);
            if (check === undefined || check !== inherited.checks.get(id) || check.anchor !== undefined) continue;
            if (inherited.dirtiedAt.has(check.at.entry)) {
                const from = inherited.dirtiedAt.get(check.at.entry)!;
                if (from === null || compareEvents(result.point, from) >= 0) continue;
            }
            checkCache.set(id, result);
        }
    }
    /**
     * 待处理按读取位置缓存：引擎实例对应一个版本、不再变，同一位置的结果不变。发布时比较前后两份（revisions.md 输出 6）
     * 与读取都在同一个位置上反复算，核对点不符多时一次要几十毫秒。调用方不得改返回的数组。
     */
    const pendingCache = new Map<string, readonly PendingItem[]>();

    const writtenChapters = new Set<string>();
    for (const change of world.changes.values()) {
        if (change.kind === "written" && change.status === "active" && change.at.kind === "chapter" && order.has(change.at.chapter)) writtenChapters.add(change.at.chapter);
    }

    function checkPoint(check: Check): Point | null {
        if (check.anchor !== undefined) {
            const anchor = actual.events.find((event) => event.kind === "change" && event.change.id === check.anchor!.change);
            if (anchor !== undefined && actual.outcomes.get(check.anchor.change)?.applied === true) return {rank: anchor.rank, tie: anchor.tie, inclusive: check.anchor.side === "after"};
        }
        const rank = placementRank(order, check.place);
        return rank === null ? null : {rank, tie: tieOf(check.id), inclusive: false};
    }

    let exactChecksCache: Array<{check: Check; point: Point}> | undefined;
    function exactChecks(): Array<{check: Check; point: Point}> {
        if (exactChecksCache !== undefined) return exactChecksCache;
        const points: Array<{check: Check; point: Point}> = [];
        for (const check of world.checks.values()) {
            const owner = world.entries.get(check.at.entry);
            // 条目已删除时不比较（model.md 输出 11）。
            if (owner === undefined || owner.deleted === true) continue;
            const field = fieldOf(registry, owner, check.at);
            if (field === undefined || field.precision === "semantic") continue;
            const point = checkPoint(check);
            if (point !== null) points.push({check, point});
        }
        return (exactChecksCache = points.sort((a, b) => compareEvents(a.point, b.point)));
    }

    /** 按计划模式的覆盖层上的核对结果，按覆盖层各存一份（覆盖层本身按计入的计划集合缓存）。 */
    const overlayChecks = new WeakMap<Snapshot, Map<string, CheckResult>>();

    /** 核对点在一份快照上比较：实际模式的结果跨版本沿用（见上），覆盖层上的只在这个引擎实例里缓存。 */
    function evaluate(item: {check: Check; point: Point}, snapshot: Snapshot = actual): CheckResult {
        const cache = snapshot === actual ? checkCache : (overlayChecks.get(snapshot) ?? (overlayChecks.set(snapshot, new Map()), overlayChecks.get(snapshot)!));
        const cached = cache.get(item.check.id);
        if (cached !== undefined && cached !== null) return cached;
        const fold = foldAtPoint(snapshot, world, registry, item.check.at.entry, item.point);
        const computed = readEntryAddress(fold?.state, item.check.at.path);
        const skipped = fold !== undefined && incompleteAt(fold.incomplete, item.check.at.path) !== undefined;
        const result: CheckResult = {check: item.check, point: item.point, computed, result: skipped ? "skipped" : computed === item.check.value ? "ok" : "mismatch"};
        cache.set(item.check.id, result);
        return result;
    }

    const checksBefore = (rank: Rank, snapshot: Snapshot = actual) => exactChecks().filter((item) => rankBefore(item.point.rank, rank)).map((item) => evaluate(item, snapshot));

    function planRank(plan: StoryChange): Rank | null {
        const rank = placementRank(order, plan.at);
        if (rank === null || plan.at.kind !== "chapter" || !writtenChapters.has(plan.at.chapter)) return rank;
        return [1, rank[1] + 0.5, 0];
    }

    // 计划进展要的两份索引在建引擎时算一次：被生效的计划替代的计划，与每个计划的兑现变更（生效、在序里的已写变更）。
    const replaced = new Set<string>();
    const fulfillers = new Map<string, Array<{readonly id: string; readonly rank: Rank}>>();
    for (const other of world.changes.values()) {
        if (other.status !== "active") continue;
        for (const link of other.links) {
            if (other.kind === "plan" && link.kind === "replaces") replaced.add(link.plan);
            if (other.kind !== "written" || link.kind !== "fulfills") continue;
            const otherRank = placementRank(order, other.at);
            if (otherRank === null) continue;
            const list = fulfillers.get(link.plan) ?? [];
            list.push({id: other.id, rank: otherRank});
            fulfillers.set(link.plan, list);
        }
    }

    function progressAt(plan: StoryChange, rank: Rank): PlanProgress {
        if (plan.status === "undone") return "cancelled";
        if (replaced.has(plan.id)) return "replaced";
        for (const fulfiller of fulfillers.get(plan.id) ?? []) {
            if (rankBefore(fulfiller.rank, rank) && actual.outcomes.get(fulfiller.id)?.applied === true) return "fulfilled";
        }
        return "unfulfilled";
    }

    /** 按计划模式在这个位置计入的计划（model.md 输出 5），按先后排。 */
    function includedPlans(rank: Rank): Array<Extract<Ev, {kind: "change"}>> {
        const included: Array<Extract<Ev, {kind: "change"}>> = [];
        for (const plan of world.changes.values()) {
            if (plan.kind !== "plan" || plan.status !== "active") continue;
            const planRankValue = planRank(plan);
            if (planRankValue === null || !rankBefore(planRankValue, rank)) continue;
            if (progressAt(plan, rank) !== "unfulfilled") continue;
            const split = plan.links.find((link) => link.kind === "splitFrom");
            if (split !== undefined && split.kind === "splitFrom") {
                const by = world.changes.get(split.by);
                if (by === undefined || by.status !== "active" || actual.outcomes.get(split.by)?.applied !== true) continue;
            }
            included.push({kind: "change", rank: planRankValue, tie: tieOf(plan.id), change: plan, entries: patchEntries(plan)});
        }
        return included.sort(compareEvents);
    }

    /** 读取位置上的快照：实际模式就是 actual；按计划模式取（或建）计入计划集合对应的覆盖层。 */
    function snapshotFor(mode: Mode, rank: Rank): Snapshot {
        if (mode === "actual") return actual;
        const included = includedPlans(rank);
        if (included.length === 0) return actual;
        const key = included.map((event) => event.change.id).sort().join(",");
        const cached = overlays.get(key);
        if (cached !== undefined) {
            // 按最近使用的先后保留：重新放到末尾。
            overlays.delete(key);
            overlays.set(key, cached);
            return cached;
        }
        const merged = [...actual.events, ...included].sort(compareEvents);
        const dirty = new Set<string>();
        for (const event of included) for (const entry of event.entries) dirty.add(entry);
        const from = included.reduce((earliest, event) => (compareEvents(event, earliest) < 0 ? event : earliest));
        const {snapshot} = recompute(inputs, actual, merged, {rank: from.rank, tie: from.tie, inclusive: false}, dirty);
        overlays.set(key, snapshot);
        // 每个计入的计划集合一份覆盖层，随读取位置变；只留最近用过的几份，免得在随机位置读一遍就把内存占满。
        if (overlays.size > OVERLAY_LIMIT) overlays.delete(overlays.keys().next().value!);
        return snapshot;
    }

    function upcoming(entryId: string, namespace: string, rank: Rank) {
        const timeline = actual.timelines.get(entryId);
        if (timeline === undefined) return null;
        for (let index = 0; index < timeline.items.length; index += 1) {
            const item = timeline.items[index]!;
            if (item.ev.kind !== "change" || rankBefore(item.ev.rank, rank) || !item.applied) continue;
            const enables = item.ev.change.patches.some((patch) => patch.at.entry === entryId && patch.at.path === `${namespace}.${ENABLE_FIELD}` && patch.value === true);
            if (!enables) continue;
            const fold = foldThrough(timeline, world.entries.get(entryId)!, registry, index);
            const data = fold.state.data[namespace];
            return data === undefined ? null : {from: item.ev.change.at, fields: structuredClone(data.fields)};
        }
        return null;
    }

    let checksByAddress: Map<string, Array<{check: Check; point: Point}>> | undefined;
    /**
     * 这个位置之前对这个地址最近一次核对不符时正文写的数（model.md 输出 11）。只求这个地址自己的核对点：读一个条目时不必把全书的
     * 核对点都求一遍。`exactChecks` 按先后排好，按地址分出来的每一组也是有序的，排在位置之前的是一段前缀。
     */
    function textSaysAt(rank: Rank, at: Address): number | undefined {
        if (checksByAddress === undefined) {
            checksByAddress = new Map();
            for (const item of exactChecks()) {
                const key = addressKey(item.check.at);
                const list = checksByAddress.get(key);
                if (list === undefined) checksByAddress.set(key, [item]);
                else list.push(item);
            }
        }
        const list = checksByAddress.get(addressKey(at)) ?? [];
        for (let index = list.length - 1; index >= 0; index -= 1) {
            if (!rankBefore(list[index]!.point.rank, rank)) continue;
            return evaluate(list[index]!).result === "mismatch" ? list[index]!.check.value : undefined;
        }
        return undefined;
    }

    /** 时间线里第一个不早于 `point` 的位置（按事件先后二分）。 */
    function firstNotBefore(items: readonly Item[], point: Point): number {
        let low = 0;
        let high = items.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const compared = compareEvents(items[middle]!.ev, point);
            if (point.inclusive ? compared <= 0 : compared < 0) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    /** 每个地址上套上了的 `set`（路径不比地址深）在时间线里的位置，按先后；一次 `pending` 里按地址算一次。 */
    function setIndices(items: readonly Item[], at: Address): number[] {
        const found: number[] = [];
        for (const [index, item] of items.entries()) {
            if (item.ev.kind !== "change" || !item.applied) continue;
            if (item.ev.change.patches.some((patch) => patch.op === "set" && addressesOverlap(patch.at, at) && patch.at.path.length <= at.path.length)) found.push(index);
        }
        return found;
    }

    /**
     * 嫌疑区间（model.md 输出 12）：从“上一个比较过的核对点”与“最后一次赋值”中较晚的一个起，到这个核对点为止。
     * `previous` 由调用方按核对点的先后一遍算出；`sets` 是这个地址上赋值的位置。只扫区间本身，不从头扫时间线。
     */
    function suspects(result: CheckResult, previous: Point | undefined, sets: readonly number[], snapshot: Snapshot): string[] {
        const at = result.check.at;
        const items = snapshot.timelines.get(at.entry)?.items ?? [];
        const end = firstNotBefore(items, result.point);
        let lastSet = -1;
        for (let low = 0, high = sets.length; low < high;) {
            const middle = (low + high) >>> 1;
            if (sets[middle]! < end) {
                lastSet = sets[middle]!;
                low = middle + 1;
            } else high = middle;
        }
        // 区间起点：赋值那条本身在区间里；上一个核对点之前的记录（按它的比较时点算）不在区间里。
        let begin = lastSet;
        if (previous !== undefined) {
            const afterPrevious = firstNotBefore(items, previous);
            if (afterPrevious > begin) begin = afterPrevious;
        }
        const list: Array<{id: string; estimate: boolean}> = [];
        if (begin < 0) {
            list.push({id: "init", estimate: world.entries.get(at.entry)?.initBasis?.[at.path]?.kind === "estimate"});
            begin = 0;
        }
        for (let index = begin; index < end; index += 1) {
            const event = items[index]!.ev;
            if (event.kind !== "change") continue;
            const touching = event.change.patches.filter((patch) => addressesOverlap(patch.at, at));
            if (touching.length === 0) continue;
            list.push({id: event.change.id, estimate: touching.some((patch) => patch.basis?.kind === "estimate")});
        }
        return list.sort((a, b) => Number(b.estimate) - Number(a.estimate)).map((item) => item.id);
    }

    const resolve = (position: ReadPosition): Rank | "chapter-not-found" => positionRank(order, position) ?? "chapter-not-found";

    return {
        inputs,
        recomputed,

        update(next, changed) {
            const structural = changed.structural === true || next.registry.digest !== registry.digest || !sameJson(next.order.ids, order.ids);
            const nextEvents = actualEvents(next);
            if (structural) {
                const rebuilt = recompute(next, null, nextEvents, null, new Set(next.world.entries.keys()));
                return engineFrom(next, rebuilt.snapshot, rebuilt.recomputed);
            }
            const dirty = new Set<string>();
            let from: Point | null = null;
            const earlier = (point: Point) => {
                if (from === null || compareEvents(point, from) < 0) from = point;
            };
            const nextTie = (id: string): OrderTie => ({version: next.world.createdAt.get(id) ?? 0, id});
            // 没有补丁的变更不弄脏条目，但它的结果要记下或删掉（总是套上；不生效了就没有结果），所以也要走一遍重算。
            let outcomesOnly = false;
            for (const id of changed.entries ?? []) {
                dirty.add(id);
                earlier({rank: [-Infinity, 0, 0], tie: {version: 0, id: ""}, inclusive: false});
            }
            for (const id of changed.changes ?? []) {
                for (const [source, tie] of [[world.changes.get(id), tieOf(id)], [next.world.changes.get(id), nextTie(id)]] as const) {
                    if (source === undefined || source.kind !== "written" || source.status !== "active") continue;
                    const rank = placementRank(order, source.at);
                    if (rank === null) continue;
                    for (const entry of patchEntries(source)) dirty.add(entry);
                    if (source.patches.length === 0) outcomesOnly = true;
                    earlier({rank, tie, inclusive: false});
                }
            }
            for (const id of changed.checks ?? []) {
                for (const [check, worldOf, tie] of [[world.checks.get(id), world, tieOf(id)], [next.world.checks.get(id), next.world, nextTie(id)]] as const) {
                    if (check === undefined) continue;
                    if (fieldOf(next.registry, worldOf.entries.get(check.at.entry), check.at)?.precision !== "semantic") continue;
                    const rank = placementRank(next.order, check.place);
                    if (rank === null) continue;
                    dirty.add(check.at.entry);
                    earlier({rank, tie, inclusive: false});
                }
            }
            if (dirty.size === 0 && !outcomesOnly) return engineFrom(next, {...actual, events: nextEvents}, 0, {results: checkCache, checks: world.checks, dirtiedAt: new Map()});
            const result = recompute(next, actual, nextEvents, from, dirty);
            return engineFrom(next, result.snapshot, result.recomputed, {results: checkCache, checks: world.checks, dirtiedAt: result.dirtiedAt});
        },

        entry(id, position, mode): EntryView | null | "chapter-not-found" {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            const entry = world.entries.get(id);
            if (entry === undefined) return null;
            const snapshot = snapshotFor(mode, rank);
            const fold = foldAtPoint(snapshot, world, registry, id, {rank, tie: {version: -Infinity, id: ""}, inclusive: false});
            const point = {rank, tie: {version: -Infinity, id: ""}, inclusive: false};
            const nameOf = (other: string) => {
                const referenced = world.entries.get(other);
                if (referenced === undefined) return undefined;
                if (referenced.deleted === true) return {name: referenced.init.name, deleted: true};
                return {name: foldAtPoint(snapshot, world, registry, other, point)?.state.name ?? referenced.init.name, deleted: false};
            };
            return buildEntryView(entry, fold, rank, {order, registry, reductions: inputs.reductions, textSays: (at) => textSaysAt(rank, at), upcoming: (namespace) => upcoming(id, namespace, rank), nameOf});
        },

        origins(at, position, mode) {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            const entry = world.entries.get(at.entry);
            if (entry === undefined) return [];
            type Keyed = {rank: Rank; tie: OrderTie; step: OriginStep};
            const steps: Keyed[] = [];
            const fold: MutableFold = {state: structuredClone(entry.init), events: new Map()};
            const initValue = entry.deleted === true ? undefined : readEntryAddress(fold.state, at.path);
            const basis = entry.initBasis?.[at.path];
            const initStep: OriginStep = {kind: "init", value: initValue, ...(basis === undefined ? {} : {basis})};
            const timeline = snapshotFor(mode, rank).timelines.get(at.entry);
            for (const item of timeline?.items ?? []) {
                if (!rankBefore(item.ev.rank, rank)) break;
                if (item.ev.kind === "anchor") {
                    replayAnchor(fold.state, fold.events, item.ev.check.at.path, item.ev.check.value, item.ev.field);
                    if (item.ev.check.at.path === at.path) steps.push({rank: item.ev.rank, tie: item.ev.tie, step: {kind: "check", check: item.ev.check.id, written: item.ev.check.value, result: "anchor"}});
                    continue;
                }
                if (!item.applied) continue;
                replayChangeOnEntry(fold.state, fold.events, item.ev.change, at.entry, registry);
                const value = readEntryAddress(fold.state, at.path);
                for (const patch of item.ev.change.patches) {
                    if (!addressesOverlap(patch.at, at)) continue;
                    steps.push({rank: item.ev.rank, tie: item.ev.tie, step: {kind: "patch", change: item.ev.change.id, op: patch.op, result: structuredClone(value), ...(patch.basis === undefined ? {} : {basis: patch.basis})}});
                }
            }
            for (const result of checksBefore(rank)) {
                if (result.check.at.entry !== at.entry || result.check.at.path !== at.path) continue;
                steps.push({rank: result.point.rank, tie: result.point.tie, step: {kind: "check", check: result.check.id, written: result.check.value, result: result.result}});
            }
            steps.sort(compareEvents);
            const ordered = [initStep, ...steps.map((item) => item.step)];
            const field = fieldOf(registry, entry, at);
            if (field?.precision === "semantic") {
                const events = fold.events.get(at.path) ?? [];
                if (events.length > 0) {
                    const raw = readEntryAddress(fold.state, at.path);
                    const anchor = raw === null || raw === undefined ? null : semanticText(field, raw as string | number);
                    const namespace = at.path.split(".")[0]!;
                    const data = fold.state.data[namespace];
                    const reduced = data === undefined ? undefined : inputs.reductions({type: data.type, field: reductionFieldId(at), label: field.label, kind: field.kind, ...(field.unit === undefined ? {} : {unit: field.unit}), anchor, events});
                    ordered.push({kind: "reduce", anchor, events: [...events], cached: reduced !== undefined});
                }
            }
            return ordered;
        },

        detail: (id) => actual.outcomes.get(id),

        valueBefore(id, at) {
            const event = actual.events.find((candidate) => candidate.kind === "change" && candidate.change.id === id);
            if (event === undefined) return undefined;
            const fold = foldAtPoint(actual, world, registry, at.entry, {rank: event.rank, tie: event.tie, inclusive: false});
            return readEntryAddress(fold?.state, at.path);
        },

        outcome(id): ChangeOutcome | undefined {
            const result = actual.outcomes.get(id);
            if (result === undefined) return undefined;
            return result.applied ? {applied: true} : {applied: false, reason: result.reason, failedPatch: result.failedPatch};
        },

        progress(planId, position) {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            const plan = world.changes.get(planId);
            return plan === undefined || plan.kind !== "plan" ? "unfulfilled" : progressAt(plan, rank);
        },

        eventKey(changeId, mode) {
            const change = world.changes.get(changeId);
            if (change === undefined || change.status !== "active") return null;
            if (change.kind === "plan" && mode !== "planned") return null;
            const rank = change.kind === "plan" ? planRank(change) : placementRank(order, change.at);
            return rank === null ? null : {rank, tie: tieOf(change.id)};
        },

        plannedAt(position) {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            return includedPlans(rank).map((event) => event.change.id);
        },

        pending(position, mode = "actual") {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            const cacheKey = `${mode}:${rank.join(",")}`;
            const cached = pendingCache.get(cacheKey);
            if (cached !== undefined) return cached;
            // 按计划模式：核对点、套不上与嫌疑区间都在这个位置的覆盖层上算（model.md 输出 16）。
            const snapshot = snapshotFor(mode, rank);
            const items: RankedPending[] = [];
            // 核对点按先后排好：一遍走下来就知道每个核对点之前、同一地址上最后一个比较过的是哪个。
            // 比较时点相同的两个核对点（挂在同一条变更的同一侧）互不算“之前”，所以从后往前找第一个严格更早的。
            const compared = new Map<string, Point[]>();
            const sets = new Map<string, number[]>();
            for (const result of checksBefore(rank, snapshot)) {
                if (result.result === "skipped") continue;
                const key = addressKey(result.check.at);
                let earlier = compared.get(key);
                if (earlier === undefined) compared.set(key, (earlier = []));
                if (result.result === "mismatch") {
                    let previous: Point | undefined;
                    for (let index = earlier.length - 1; index >= 0 && previous === undefined; index -= 1) if (compareEvents(earlier[index]!, result.point) < 0) previous = earlier[index];
                    let addressSets = sets.get(key);
                    if (addressSets === undefined) sets.set(key, (addressSets = setIndices(snapshot.timelines.get(result.check.at.entry)?.items ?? [], result.check.at)));
                    items.push({rank: result.point.rank, id: result.check.id, item: {kind: "check-mismatch", check: result.check.id, at: result.check.at, computed: result.computed as number, written: result.check.value, suspects: suspects(result, previous, addressSets, snapshot)}});
                }
                earlier.push(result.point);
            }
            for (const event of snapshot.events) {
                if (!rankBefore(event.rank, rank)) break;
                if (event.kind !== "change") continue;
                const result = snapshot.outcomes.get(event.change.id);
                if (result === undefined || result.applied) continue;
                items.push({rank: event.rank, id: event.change.id, item: {kind: "cannot-apply", root: event.change.id, changes: [event.change.id]}});
            }
            for (const change of world.changes.values()) {
                if (change.status === "held") items.push({rank: placementRank(order, change.at), id: change.id, item: {kind: "held", change: change.id, reason: change.held?.reason ?? "unsure"}});
                if (change.status !== "undone" && change.at.kind === "chapter" && !order.has(change.at.chapter)) items.push({rank: null, id: change.id, item: {kind: "chapter-deleted", ref: {kind: "change", id: change.id}}});
            }
            for (const check of world.checks.values()) {
                if (check.place.kind === "chapter" && !order.has(check.place.chapter)) items.push({rank: null, id: check.id, item: {kind: "chapter-deleted", ref: {kind: "check", id: check.id}}});
            }
            const result = sortPending(items);
            pendingCache.set(cacheKey, result);
            return result;
        },

        chapterEntries(chapterId) {
            const ids = new Set<string>();
            for (const change of world.changes.values()) {
                if (change.kind !== "written" || change.status !== "active" || change.at.kind !== "chapter" || change.at.chapter !== chapterId) continue;
                for (const id of change.involves) ids.add(id);
                for (const member of change.cast ?? []) for (const id of [member.who, member.as]) if (id !== undefined) ids.add(id);
                for (const patch of change.patches) ids.add(patch.at.entry);
            }
            const index = order.index(chapterId);
            for (const item of exactChecks()) if (index !== undefined && item.point.rank[0] === 1 && item.point.rank[1] === index) ids.add(item.check.at.entry);
            return [...ids].sort(compareIds);
        },
    };
}

function patchEntries(change: StoryChange): string[] {
    return [...new Set(change.patches.map((patch) => patch.at.entry))];
}

/** 实际模式的事件：生效、在序里的已写变更，加语义档的核对点（作为起点），按全序排好。 */
function actualEvents(inputs: EngineInputs): Ev[] {
    const {world, order, registry} = inputs;
    const tieOf = (id: string): OrderTie => ({version: world.createdAt.get(id) ?? 0, id});
    const events: Ev[] = [];
    for (const change of world.changes.values()) {
        if (change.kind !== "written" || change.status !== "active") continue;
        const rank = placementRank(order, change.at);
        if (rank !== null) events.push({kind: "change", rank, tie: tieOf(change.id), change, entries: patchEntries(change)});
    }
    for (const check of world.checks.values()) {
        const field = fieldOf(registry, world.entries.get(check.at.entry), check.at);
        if (field?.precision !== "semantic") continue;
        const rank = placementRank(order, check.place);
        if (rank !== null) events.push({kind: "anchor", rank, tie: tieOf(check.id), check, field, entries: [check.at.entry]});
    }
    return events.sort(compareEvents);
}

function initialFold(entry: Entry): MutableFold {
    return {state: structuredClone(entry.init), events: new Map()};
}

function cloneFold(fold: MutableFold): MutableFold {
    return {state: structuredClone(fold.state), events: new Map([...fold.events].map(([path, list]) => [path, [...list]]))};
}

/** 时间线里前 `count` 个事件之后的折叠结果（`count` 为 0 是初值）。 */
function foldThrough(timeline: Timeline, entry: Entry, registry: ComponentRegistry, lastIndex: number): MutableFold {
    const snapshotIndex = Math.floor((lastIndex + 1) / SNAPSHOT_EVERY) - 1;
    let fold: MutableFold;
    let next: number;
    if (snapshotIndex >= 0 && timeline.snapshots[snapshotIndex] !== undefined) {
        fold = cloneFold(timeline.snapshots[snapshotIndex]!);
        next = (snapshotIndex + 1) * SNAPSHOT_EVERY;
    } else {
        fold = initialFold(entry);
        next = 0;
    }
    for (let index = next; index <= lastIndex; index += 1) replayItem(fold, timeline.items[index]!, entry.id, registry);
    return fold;
}

function replayItem(fold: MutableFold, item: Item, entryId: string, registry: ComponentRegistry): void {
    if (item.ev.kind === "anchor") replayAnchor(fold.state, fold.events, item.ev.check.at.path, item.ev.check.value, item.ev.field);
    else if (item.applied) replayChangeOnEntry(fold.state, fold.events, item.ev.change, entryId, registry);
}

/** 时间线里排在 `point` 之前（`inclusive` 时含它）的事件个数。 */
function countBefore(timeline: Timeline, point: Point): number {
    let low = 0;
    let high = timeline.items.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        const compared = compareEvents(timeline.items[middle]!.ev, point);
        if (point.inclusive ? compared <= 0 : compared < 0) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** 一个条目在 `point` 上的折叠结果；条目已删除或不存在时为 undefined。 */
function foldAtPoint(snapshot: Snapshot, world: EngineInputs["world"], registry: ComponentRegistry, entryId: string, point: Point): EntryFold | undefined {
    const entry = world.entries.get(entryId);
    const timeline = snapshot.timelines.get(entryId);
    if (entry === undefined || entry.deleted === true || timeline === undefined) return undefined;
    const count = countBefore(timeline, point);
    const fold = count === 0 ? initialFold(entry) : foldThrough(timeline, entry, registry, count - 1);
    const incomplete = timeline.incomplete.filter((mark) => mark.item < count).map((mark) => mark.event);
    return {state: fold.state, events: fold.events, incomplete};
}

/**
 * 从 `from` 起重算：`dirty` 里的条目从 `from` 的状态（取自 `base`，没有 base 时从初值）开始，按全序处理碰到脏条目的
 * 事件。一条变更的结果与 base 里的不同时，它碰到的干净条目也从这里起变脏。返回新快照；`base` 不变。
 */
function recompute(inputs: EngineInputs, base: Snapshot | null, events: readonly Ev[], from: Point | null, dirtyStart: ReadonlySet<string>): {snapshot: Snapshot; recomputed: number; dirtiedAt: ReadonlyMap<string, Point | null>} {
    const {world, registry} = inputs;
    const context = {registry, entry: (id: string) => world.entries.get(id)};
    const dirty = new Set<string>();
    /** 每个重算了的条目从哪一点起重算（null 是从头）：这一点之前的时间线与 base 的相同。 */
    const dirtiedAt = new Map<string, Point | null>();
    const running = new Map<string, MutableFold>();
    const timelines = new Map<string, Timeline>(base === null ? [] : [...base.timelines]);
    const outcomes = new Map<string, ChangeResult>(base?.outcomes ?? []);
    let recomputed = 0;

    /** 把一个条目接成脏条目：时间线截到 `point` 之前，状态取它在 `point` 上的样子。 */
    const makeDirty = (id: string, point: Point | null) => {
        if (dirty.has(id)) return;
        const entry = world.entries.get(id);
        if (entry === undefined || entry.deleted === true) {
            timelines.delete(id);
            return;
        }
        dirty.add(id);
        const old = base?.timelines.get(id);
        dirtiedAt.set(id, old === undefined || point === null || !Number.isFinite(point.rank[0]) ? null : point);
        if (old === undefined || point === null || !Number.isFinite(point.rank[0])) {
            timelines.set(id, {items: [], snapshots: [], incomplete: []});
            running.set(id, initialFold(entry));
            return;
        }
        const keep = countBefore(old, point);
        const keptSnapshots = Math.floor(keep / SNAPSHOT_EVERY);
        timelines.set(id, {
            items: old.items.slice(0, keep),
            snapshots: old.snapshots.slice(0, keptSnapshots),
            incomplete: old.incomplete.filter((mark) => mark.item < keep),
        });
        running.set(id, keep === 0 ? initialFold(entry) : foldThrough(old, entry, registry, keep - 1));
    };

    for (const id of dirtyStart) makeDirty(id, from);
    for (const id of [...timelines.keys()]) if (!world.entries.has(id) || world.entries.get(id)!.deleted === true) timelines.delete(id);

    const append = (id: string, item: Item, marks: readonly IncompleteEvent[]) => {
        const timeline = timelines.get(id)!;
        const index = timeline.items.length;
        timeline.items.push(item);
        for (const event of marks) timeline.incomplete.push({item: index, event});
        if ((index + 1) % SNAPSHOT_EVERY === 0) timeline.snapshots.push(cloneFold(running.get(id)!));
    };

    const live = new Set(events.filter((event) => event.kind === "change").map((event) => (event as {change: StoryChange}).change.id));
    for (const id of [...outcomes.keys()]) if (!live.has(id)) outcomes.delete(id);

    // 改到的条目即使已删除也要处理碰到它的事件：那些变更的结果会变成“条目不存在”。整本重建时每条变更都处理。
    const forced = new Set(dirtyStart);
    for (const event of events) {
        if (from !== null && compareEvents(event, from) < 0) continue;
        // 没有补丁的变更不碰任何条目，但它的结果（总是套上）要记下：计划进展与在场都按结果判断（model.md 输出 13、29）。
        const touchesNothing = event.kind === "change" && event.entries.length === 0;
        if (base !== null && !touchesNothing && !event.entries.some((id) => dirty.has(id) || forced.has(id))) continue;
        recomputed += 1;
        if (event.kind === "anchor") {
            const id = event.entries[0]!;
            const fold = running.get(id);
            if (fold === undefined) continue;
            replayAnchor(fold.state, fold.events, event.check.at.path, event.check.value, event.field);
            append(id, {ev: event, applied: true}, []);
            continue;
        }
        const point: Point = {rank: event.rank, tie: event.tie, inclusive: false};
        const clean = event.entries.filter((id) => !dirty.has(id) && world.entries.get(id)?.deleted !== true && world.entries.has(id));
        const state: FoldState = {entries: new Map(), events: new Map(), incomplete: new Map()};
        for (const id of event.entries) {
            const fold = dirty.has(id) ? running.get(id) : base === null ? undefined : foldBefore(base, world, registry, id, point);
            if (fold === undefined) continue;
            state.entries.set(id, fold.state);
            for (const [path, list] of fold.events) state.events.set(addressKey({entry: id, path}), [...list]);
        }
        const result = applyChange(state, event.change, context);
        const previous = base?.outcomes.get(event.change.id);
        if (clean.length > 0 && !sameJson(result, previous)) {
            // 结果变了：干净条目在这条变更之前的状态没变，从这里起把它们接成脏条目。
            for (const id of clean) makeDirty(id, point);
        }
        outcomes.set(event.change.id, result);
        for (const id of event.entries) {
            if (!dirty.has(id)) continue;
            const fold = running.get(id)!;
            const next = state.entries.get(id);
            if (next !== undefined) fold.state = next;
            const prefix = `${id}\u0000`;
            for (const [key, list] of state.events) if (key.startsWith(prefix)) fold.events.set(key.slice(prefix.length), list);
            append(id, {ev: event, applied: result.applied}, state.incomplete.get(id) ?? []);
        }
    }
    return {snapshot: {events, outcomes, timelines}, recomputed, dirtiedAt};
}

function foldBefore(snapshot: Snapshot, world: EngineInputs["world"], registry: ComponentRegistry, id: string, point: Point): MutableFold | undefined {
    const entry = world.entries.get(id);
    const timeline = snapshot.timelines.get(id);
    if (entry === undefined || entry.deleted === true) return undefined;
    if (timeline === undefined) return initialFold(entry);
    const count = countBefore(timeline, point);
    return count === 0 ? initialFold(entry) : foldThrough(timeline, entry, registry, count - 1);
}
