/**
 * 整本重算的参照实现（docs/specs/canon/model.md）：每次查询都从初值按全序重新折叠，不缓存。它是差分测试的
 * 参照答案，所以写法以“照 Spec 逐条”为准，不考虑速度；增量引擎对同一输入的每个回答都必须与它逐字相同。
 *
 * 几个先后上的约定：
 * - 一条变更套没套上只取决于它之前的状态（输出 7），所以“实际模式整本折叠一次”得到的结果就是每条变更的结果；
 *   计划进展与按计划模式都按这份结果判定（输出 13）。
 * - 精确档的核对点不改状态，只比较：比较时点是挂靠的变更（套上了时）的前后，否则是 `place`（输出 11）；
 *   语义档的核对点是起点，作为事件按 `place` 进折叠（输出 9）。
 * - 安放在已写章节（这一章有生效的已写变更）上的计划，按计划模式从下一章开头起才算“之前”（输出 5）。
 */

import type {ComponentRegistry} from "../components/registry";
import {semanticText} from "../components/values";
import {addressKey, addressesOverlap, parsePath} from "../core/address";
import {compareIds} from "../core/ids";
import {ENABLE_FIELD} from "../core/identifiers";
import {compareRanks, compareTie, placementRank, positionRank, rankBefore, type OrderTie, type Rank} from "../core/position";
import type {Address, Check, Entry, FieldDeclaration, ReadPosition, StoryChange} from "../core/schema";
import {applyChange, incompleteAt, initialFoldState, isCarry, namespaceFields, type ChangeResult, type FoldState} from "../model/apply";
import {buildEntryView, carrySlotOf, readEntryAddress, type EntryFold} from "./views";
import {sortPending, type RankedPending} from "./pending";
import type {ChangeOutcome, Engine, EngineInputs, EntryView, Mode, OriginStep, PendingItem, PlanProgress} from "./types";

type FoldEvent =
    | {readonly kind: "change"; readonly rank: Rank; readonly tie: OrderTie; readonly change: StoryChange}
    | {readonly kind: "anchor"; readonly rank: Rank; readonly tie: OrderTie; readonly check: Check; readonly field: FieldDeclaration};

interface Point {
    readonly rank: Rank;
    readonly tie: OrderTie;
    /** 为真时比较点在这个事件之后（含它），否则在它之前。 */
    readonly inclusive: boolean;
}

/** 核对点的比较时点与它挂没挂上（输出 11）。 */
interface CheckPoint {
    readonly check: Check;
    readonly point: Point;
}


export function createReferenceEngine(inputs: EngineInputs): Engine {
    const {world, order, registry} = inputs;
    const context = {registry, entry: (id: string) => world.entries.get(id)};
    const tieOf = (id: string): OrderTie => ({version: world.createdAt.get(id) ?? 0, id});
    const compareEvents = (a: {rank: Rank; tie: OrderTie}, b: {rank: Rank; tie: OrderTie}) => compareRanks(a.rank, b.rank) || compareTie(a.tie, b.tie);

    const writtenChapters = new Set<string>();
    for (const change of world.changes.values()) {
        if (change.kind === "written" && change.status === "active" && change.at.kind === "chapter" && order.has(change.at.chapter)) writtenChapters.add(change.at.chapter);
    }

    const actualEvents: FoldEvent[] = [];
    for (const change of world.changes.values()) {
        if (change.kind !== "written" || change.status !== "active") continue;
        const rank = placementRank(order, change.at);
        if (rank !== null) actualEvents.push({kind: "change", rank, tie: tieOf(change.id), change});
    }
    for (const check of world.checks.values()) {
        const field = fieldOf(registry, world.entries.get(check.at.entry), check.at);
        if (field?.precision !== "semantic") continue;
        const rank = placementRank(order, check.place);
        if (rank !== null) actualEvents.push({kind: "anchor", rank, tie: tieOf(check.id), check, field});
    }
    actualEvents.sort(compareEvents);

    let outcomes: Map<string, ChangeResult> | undefined;
    const allOutcomes = (): Map<string, ChangeResult> => {
        if (outcomes !== undefined) return outcomes;
        outcomes = new Map();
        fold(actualEvents, () => true, outcomes);
        return outcomes;
    };

    function fold(events: readonly FoldEvent[], include: (event: FoldEvent) => boolean, record?: Map<string, ChangeResult>): FoldState {
        const state = initialFoldState(world.entries.values());
        for (const event of events) {
            if (!include(event)) break;
            if (event.kind === "change") {
                const result = applyChange(state, event.change, context);
                record?.set(event.change.id, result);
            } else applyAnchor(state, event.check, event.field);
        }
        return state;
    }

    const changeEvent = (id: string): FoldEvent | undefined => actualEvents.find((event) => event.kind === "change" && event.change.id === id);

    function checkPoint(check: Check): CheckPoint | null {
        if (check.anchor !== undefined) {
            const anchor = changeEvent(check.anchor.change);
            if (anchor !== undefined && allOutcomes().get(check.anchor.change)?.applied === true) {
                return {check, point: {rank: anchor.rank, tie: anchor.tie, inclusive: check.anchor.side === "after"}};
            }
        }
        const rank = placementRank(order, check.place);
        return rank === null ? null : {check, point: {rank, tie: tieOf(check.id), inclusive: false}};
    }

    const beforePoint = (point: Point) => (event: FoldEvent) => {
        const compared = compareEvents(event, point);
        return point.inclusive ? compared <= 0 : compared < 0;
    };

    function exactChecks(): CheckPoint[] {
        const points: CheckPoint[] = [];
        for (const check of world.checks.values()) {
            const owner = world.entries.get(check.at.entry);
            // 条目已删除时不比较（model.md 输出 11）。
            if (owner === undefined || owner.deleted === true) continue;
            const field = fieldOf(registry, owner, check.at);
            if (field === undefined || field.precision === "semantic") continue;
            const point = checkPoint(check);
            if (point !== null) points.push(point);
        }
        return points.sort((a, b) => compareEvents(a.point, b.point));
    }

    type CheckResult = {readonly point: CheckPoint; readonly computed: unknown; readonly result: "ok" | "mismatch" | "skipped"};
    /** 核对点在给定的事件序列（实际模式的，或按计划模式加了计划的）上比较。 */
    function evaluate(point: CheckPoint, events: readonly FoldEvent[] = actualEvents): CheckResult {
        const state = fold(events, beforePoint(point.point));
        const computed = readAddress(state, point.check.at);
        if (incompleteAt(state.incomplete.get(point.check.at.entry), point.check.at.path) !== undefined) return {point, computed, result: "skipped"};
        return {point, computed, result: computed === point.check.value ? "ok" : "mismatch"};
    }

    /** 安放在已写章节上的计划，按计划模式从下一章开头起算（输出 5）。 */
    function planRank(plan: StoryChange): Rank | null {
        const rank = placementRank(order, plan.at);
        if (rank === null || plan.at.kind !== "chapter" || !writtenChapters.has(plan.at.chapter)) return rank;
        // 同一章的计划保留键：先后不随这一章有没有已写变更翻转。
        return [1, rank[1] + 0.5, rank[2]];
    }

    function progressAt(plan: StoryChange, positionRankValue: Rank): PlanProgress {
        if (plan.status === "undone") return "cancelled";
        for (const other of world.changes.values()) {
            if (other.kind === "plan" && other.status === "active" && other.links.some((link) => link.kind === "replaces" && link.plan === plan.id)) return "replaced";
        }
        for (const other of world.changes.values()) {
            if (other.kind !== "written" || other.status !== "active") continue;
            if (!other.links.some((link) => link.kind === "fulfills" && link.plan === plan.id)) continue;
            const rank = placementRank(order, other.at);
            if (rank !== null && rankBefore(rank, positionRankValue) && allOutcomes().get(other.id)?.applied === true) return "fulfilled";
        }
        return "unfulfilled";
    }

    /** 按计划模式在这个位置计入的计划（输出 5），连同它们在先后里的位置。 */
    function includedPlans(positionRankValue: Rank): Array<Extract<FoldEvent, {kind: "change"}>> {
        const included: Array<Extract<FoldEvent, {kind: "change"}>> = [];
        for (const plan of world.changes.values()) {
            if (plan.kind !== "plan" || plan.status !== "active") continue;
            const rank = planRank(plan);
            if (rank === null || !rankBefore(rank, positionRankValue)) continue;
            if (progressAt(plan, positionRankValue) !== "unfulfilled") continue;
            const split = plan.links.find((link) => link.kind === "splitFrom");
            if (split !== undefined && split.kind === "splitFrom") {
                const by = world.changes.get(split.by);
                if (by === undefined || by.status !== "active" || allOutcomes().get(split.by)?.applied !== true) continue;
            }
            included.push({kind: "change", rank, tie: tieOf(plan.id), change: plan});
        }
        return included.sort(compareEvents);
    }

    function eventsFor(mode: Mode, positionRankValue: Rank): FoldEvent[] {
        if (mode === "actual") return actualEvents;
        return [...actualEvents, ...includedPlans(positionRankValue)].sort(compareEvents);
    }

    function view(entry: Entry, state: FoldState, positionRankValue: Rank, checks: readonly CheckResult[]): EntryView {
        return buildEntryView(entry, entryFold(state, entry.id), positionRankValue, {
            order,
            registry,
            reductions: inputs.reductions,
            textSays: (at) => latestMismatch(checks, at),
            upcoming: (namespace) => upcomingNamespace(entry.id, namespace, positionRankValue),
            nameOf: (other) => {
                const referenced = inputs.world.entries.get(other);
                if (referenced === undefined) return undefined;
                if (referenced.deleted === true) return {name: referenced.init.name, deleted: true};
                return {name: state.entries.get(other)?.name ?? referenced.init.name, deleted: false};
            },
        });
    }

    function latestMismatch(checks: readonly CheckResult[], at: Address): number | undefined {
        let latest: CheckResult | undefined;
        for (const result of checks) if (result.point.check.at.entry === at.entry && result.point.check.at.path === at.path) latest = result;
        return latest?.result === "mismatch" ? latest.point.check.value : undefined;
    }

    function upcomingNamespace(entryId: string, namespace: string, positionRankValue: Rank): {from: StoryChange["at"]; fields: Record<string, unknown>} | null {
        for (const event of actualEvents) {
            if (event.kind !== "change" || rankBefore(event.rank, positionRankValue)) continue;
            const enables = event.change.patches.some((patch) => patch.at.entry === entryId && patch.at.path === `${namespace}.${ENABLE_FIELD}` && patch.value === true);
            if (!enables || allOutcomes().get(event.change.id)?.applied !== true) continue;
            const state = fold(actualEvents, beforePoint({rank: event.rank, tie: event.tie, inclusive: true}));
            const data = state.entries.get(entryId)?.data[namespace];
            if (data === undefined) return null;
            return {from: event.change.at, fields: structuredClone(data.fields)};
        }
        return null;
    }

    function checksBefore(positionRankValue: Rank, events: readonly FoldEvent[] = actualEvents): CheckResult[] {
        return exactChecks().filter((point) => rankBefore(point.point.rank, positionRankValue)).map((point) => evaluate(point, events));
    }

    function suspects(result: CheckResult, events: readonly FoldEvent[], outcomes: ReadonlyMap<string, ChangeResult>): string[] {
        const at = result.point.check.at;
        const before = beforePoint(result.point.point);
        const previous = exactChecks()
            .filter((other) => other.check.id !== result.point.check.id && other.check.at.entry === at.entry && other.check.at.path === at.path && compareEvents(other.point, result.point.point) < 0)
            .map((other) => evaluate(other, events))
            .filter((other) => other.result !== "skipped")
            .at(-1);
        // 起点是上一个比较过的核对点时，按它的比较时点排除它之前的记录（挂在某条变更之后的核对点，那条变更也在它之前）；
        // 起点是最后一次赋值时，那条赋值本身在区间里。
        let start: {rank: Rank; tie: OrderTie} | null = previous === undefined ? null : previous.point.point;
        let startExcluded = previous !== undefined && previous.point.point.inclusive;
        for (const event of events) {
            if (!before(event)) break;
            if (event.kind !== "change") continue;
            if (!event.change.patches.some((patch) => patch.op === "set" && addressesOverlap(patch.at, at) && patch.at.path.length <= at.path.length)) continue;
            if (outcomes.get(event.change.id)?.applied !== true) continue;
            if (start === null || compareEvents(event, start) > 0) {
                start = event;
                startExcluded = false;
            }
        }
        const list: Array<{id: string; estimate: boolean}> = [];
        if (start === null) list.push({id: "init", estimate: world.entries.get(at.entry)?.initBasis?.[at.path]?.kind === "estimate"});
        for (const event of events) {
            if (!before(event)) break;
            if (event.kind !== "change") continue;
            if (start !== null && (startExcluded ? compareEvents(event, start) <= 0 : compareEvents(event, start) < 0)) continue;
            const touching = event.change.patches.filter((patch) => addressesOverlap(patch.at, at));
            if (touching.length === 0) continue;
            list.push({id: event.change.id, estimate: touching.some((patch) => patch.basis?.kind === "estimate")});
        }
        return list.sort((a, b) => Number(b.estimate) - Number(a.estimate)).map((item) => item.id);
    }

    function resolve(position: ReadPosition): Rank | "chapter-not-found" {
        return positionRank(order, position) ?? "chapter-not-found";
    }

    /** 一个地址到某一刻为止的来历：`include` 按全序给出这一刻之前（含）的事件，`checks` 是这一刻之前的精确档核对点。 */
    function originsUpTo(at: Address, events: readonly FoldEvent[], include: (event: FoldEvent) => boolean, checks: readonly CheckResult[]): readonly OriginStep[] {
        const entry = world.entries.get(at.entry);
        if (entry === undefined) return [];
        type Keyed = {rank: Rank; tie: OrderTie; step: OriginStep};
        const steps: Keyed[] = [];
        const state = initialFoldState(world.entries.values());
        const initValue = readAddress(state, at);
        const basis = entry.initBasis?.[at.path];
        const initStep: OriginStep = {kind: "init", value: initValue, ...(basis === undefined ? {} : {basis})};
        for (const event of events) {
            if (!include(event)) break;
            if (event.kind === "anchor") {
                applyAnchor(state, event.check, event.field);
                if (state.entries.has(at.entry) && event.check.at.entry === at.entry && event.check.at.path === at.path) {
                    steps.push({rank: event.rank, tie: event.tie, step: {kind: "check", check: event.check.id, written: event.check.value, result: "anchor"}});
                }
                continue;
            }
            const result = applyChange(state, event.change, context);
            if (!result.applied) continue;
            const value = readAddress(state, at);
            for (const patch of event.change.patches) {
                if (!addressesOverlap(patch.at, at)) continue;
                steps.push({rank: event.rank, tie: event.tie, step: {kind: "patch", change: event.change.id, op: patch.op, result: structuredClone(value), ...(patch.basis === undefined ? {} : {basis: patch.basis})}});
            }
        }
        for (const result of checks) {
            if (result.point.check.at.entry !== at.entry || result.point.check.at.path !== at.path) continue;
            steps.push({rank: result.point.point.rank, tie: result.point.point.tie, step: {kind: "check", check: result.point.check.id, written: result.point.check.value, result: result.result}});
        }
        steps.sort(compareEvents);
        const ordered = [initStep, ...steps.map((item) => item.step)];
        const field = fieldOf(registry, entry, at);
        if (field?.precision === "semantic") {
            const events = state.events.get(addressKey(at)) ?? [];
            if (events.length > 0) {
                const parsed = parsePath(at.path);
                const data = parsed?.root === "namespace" ? state.entries.get(at.entry)?.data[parsed.namespace] : undefined;
                const raw = readAddress(state, at);
                const anchor = raw === null || raw === undefined ? null : semanticText(field, raw as string | number);
                const reduced = data === undefined ? undefined : inputs.reductions({type: data.type, field: reductionFieldId(at), label: field.label, kind: field.kind, ...(field.unit === undefined ? {} : {unit: field.unit}), anchor, events});
                ordered.push({kind: "reduce", anchor, events: [...events], cached: reduced !== undefined});
            }
        }
        return ordered;
    }

    return {
        slotAfter(id, at) {
            const change = world.changes.get(id);
            const rank = change === undefined ? null : placementRank(order, change.at);
            if (rank === null) return null;
            const state = fold(actualEvents, beforePoint({rank, tie: tieOf(id), inclusive: true}));
            return carrySlotOf(entryFold(state, at.entry), at);
        },

        entry(id, position, mode) {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            const entry = world.entries.get(id);
            if (entry === undefined) return null;
            const state = fold(eventsFor(mode, rank), (event) => rankBefore(event.rank, rank));
            return view(entry, state, rank, checksBefore(rank));
        },

        origins(at, position, mode) {
            const rank = resolve(position);
            if (rank === "chapter-not-found") return rank;
            return originsUpTo(at, eventsFor(mode, rank), (event) => rankBefore(event.rank, rank), checksBefore(rank));
        },

        originsAfter(change, at) {
            const placed = world.changes.get(change);
            const rank = placed === undefined ? null : placementRank(order, placed.at);
            if (rank === null) return null;
            const point = {rank, tie: tieOf(change), inclusive: true};
            return originsUpTo(at, actualEvents, beforePoint(point), exactChecks().filter((item) => compareEvents(item.point, point) <= 0).map((item) => evaluate(item, actualEvents)));
        },

        outcome(id): ChangeOutcome | undefined {
            const result = allOutcomes().get(id);
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
            // 按计划模式：核对点、套不上与嫌疑区间都在加了计划的事件序列上算（输出 16）。
            const events = eventsFor(mode, rank);
            const outcomes = mode === "actual" ? allOutcomes() : new Map<string, ChangeResult>();
            if (mode !== "actual") fold(events, () => true, outcomes);
            const items: RankedPending[] = [];
            for (const result of checksBefore(rank, events)) {
                if (result.result !== "mismatch") continue;
                const check = result.point.check;
                items.push({rank: result.point.point.rank, id: check.id, item: {kind: "check-mismatch", check: check.id, at: check.at, computed: result.computed as number, written: check.value, suspects: suspects(result, events, outcomes)}});
            }
            for (const event of events) {
                if (!rankBefore(event.rank, rank)) break;
                if (event.kind !== "change") continue;
                const result = outcomes.get(event.change.id);
                if (result === undefined || result.applied) continue;
                items.push({rank: event.rank, id: event.change.id, item: {kind: "cannot-apply", root: event.change.id, changes: [event.change.id]}});
            }
            for (const change of world.changes.values()) {
                if (change.status === "held") items.push({rank: placementRank(order, change.at), id: change.id, item: {kind: "held", change: change.id, reason: change.held?.reason ?? "unsure"}});
                if (change.status !== "undone" && change.at.kind === "chapter" && !order.has(change.at.chapter)) {
                    items.push({rank: null, id: change.id, item: {kind: "chapter-deleted", ref: {kind: "change", id: change.id}}});
                }
            }
            for (const check of world.checks.values()) {
                if (check.place.kind === "chapter" && !order.has(check.place.chapter)) items.push({rank: null, id: check.id, item: {kind: "chapter-deleted", ref: {kind: "check", id: check.id}}});
            }
            return sortPending(items);
        },

        chapterEntries(chapter, mode = "actual") {
            const ids = new Set<string>();
            for (const change of world.changes.values()) {
                // 按计划模式再收计划：同一条线的视图里只有这条线看得到的记录，计划是否生效（不是已撤销）看 `status`。
                const counted = change.kind === "written" || (mode === "planned" && change.kind === "plan");
                if (!counted || change.status !== "active" || change.at.kind !== "chapter" || change.at.chapter !== chapter) continue;
                for (const id of change.involves) ids.add(id);
                for (const member of change.cast ?? []) for (const id of [member.who, member.as]) if (id !== undefined) ids.add(id);
                for (const patch of change.patches) if (!isCarry(patch)) ids.add(patch.at.entry);
            }
            for (const point of exactChecks()) {
                const rank = point.point.rank;
                const index = order.index(chapter);
                if (index !== undefined && rank[0] === 1 && rank[1] === index) ids.add(point.check.at.entry);
            }
            return [...ids].sort(compareIds);
        },
    };
}

/** 语义档的核对点：在 `place` 上成为新的起点（输出 9、11）。 */
function applyAnchor(state: FoldState, check: Check, field: FieldDeclaration): void {
    const entry = state.entries.get(check.at.entry);
    const parsed = parsePath(check.at.path);
    if (entry === undefined || parsed?.root !== "namespace" || parsed.element !== undefined) return;
    const data = entry.data[parsed.namespace];
    if (data === undefined) return;
    const next = structuredClone(entry);
    next.data[parsed.namespace]!.fields[parsed.field] = semanticText(field, check.value);
    state.entries.set(check.at.entry, next);
    state.events.set(addressKey(check.at), []);
}

/** 字段声明：条目初值里的命名空间按当前登记取；不是命名空间里的字段时为 undefined。 */
/**
 * 地址指到的叶子的声明：字段，或列表元素的子字段（components.md 的值表：地址只能指到字段、列表元素、元素的子字段）。
 * 指到整个列表元素时为 undefined：它不是可以比较、归纳的单个值。
 */
export function fieldOf(registry: ComponentRegistry, entry: Entry | undefined, at: Address): FieldDeclaration | undefined {
    if (entry === undefined) return undefined;
    const parsed = parsePath(at.path);
    if (parsed?.root !== "namespace") return undefined;
    const data = entry.init.data[parsed.namespace];
    if (data === undefined) return undefined;
    const field = namespaceFields(registry, parsed.namespace, data).find((candidate) => candidate.id === parsed.field);
    if (parsed.element === undefined) return field;
    if (parsed.sub === undefined || field?.kind !== "list") return undefined;
    return field.item?.find((sub) => sub.id === parsed.sub);
}

/** 归纳缓存的输入里“字段”那一项：字段 id，列表元素的子字段写成 `列表.子字段`（同一列表各元素的同一子字段共用一种归纳）。 */
export function reductionFieldId(at: Address): string {
    const parsed = parsePath(at.path);
    if (parsed?.root !== "namespace") return at.path;
    return parsed.sub === undefined ? parsed.field : `${parsed.field}.${parsed.sub}`;
}

/** 折叠状态里一个地址的值；不存在时为 undefined。 */
export function readAddress(state: FoldState, at: Address): unknown {
    return readEntryAddress(state.entries.get(at.entry), at.path);
}

/** 从整本的折叠状态里取出一个条目的那一份。 */
function entryFold(state: FoldState, id: string): EntryFold | undefined {
    const current = state.entries.get(id);
    if (current === undefined) return undefined;
    const prefix = `${id}\u0000`;
    const events = new Map<string, readonly string[]>();
    for (const [key, list] of state.events) if (key.startsWith(prefix)) events.set(key.slice(prefix.length), list);
    return {state: current, events, incomplete: state.incomplete.get(id) ?? []};
}
