/**
 * 线表（docs/specs/canon/worldlines.md 输出 1、2、3、14、18）：从变更对象算出每条世界线的定义、两种模式下存不存在、能不能建、线树，
 * 以及一条记录在一条线的视图里看不看得到。不看引擎：线集按它建线视图，写入路径按它校验。按数据对象与章序缓存。
 *
 * 先后一律按安放的全序（model.md 输出 2：安放的键，再写入的版本，再 id）。继承“不晚于切口”按全序；子线自己的记录要“晚于切口、同一
 * 位置也不行”，只比安放的键。
 */

import {compareRanks, compareTie, placementRank, type ChapterOrder, type Rank} from "../core/position";
import type {Fork, Placement, StoryChange} from "../core/schema";
import type {WorldData} from "../engine/types";

/** 主线的 id（worldlines 术语：根线，总是存在）。 */
export const MAIN_LINE = "main";

/** 安放所在的线；不写是主线。 */
export function lineOf(placement: Placement): string {
    return placement.line ?? MAIN_LINE;
}

/** 全序上的一点；未排章的（与所在章不在章序里的）没有。 */
export interface OrderPoint {
    readonly rank: Rank;
    readonly version: number;
    readonly id: string;
}

export function compareOrder(a: OrderPoint, b: OrderPoint): number {
    return compareRanks(a.rank, b.rank) || compareTie(a, b);
}

/** 线不可建的原因（输出 18）。 */
export type Unbuildable = "cut-unplaced" | "cut-not-visible" | "trigger-unplaced" | "trigger-not-visible" | "trigger-not-after-cut" | "fork-before-trigger" | "cycle";

export interface LineEntry {
    readonly id: string;
    /** 定义它的分叉：有生效的已写分叉时是它（几条时取最早写下的），否则是生效、没被替代的计划分叉。 */
    readonly fork: StoryChange & {readonly fork: Fork};
    /** 只由计划分叉定义（计划线）。 */
    readonly planned: boolean;
    readonly parent: string;
    /** 两种模式下各自存不存在（输出 1；DS 14：定义在这个模式下有效、父线在这个模式下存在）。 */
    readonly exists: {readonly actual: boolean; readonly planned: boolean};
    /** 存在却不可建的原因；可建时为 null。 */
    readonly unbuildable: Unbuildable | null;
}

export interface LineTable {
    /** 主线以外的线（主线不在里面）。 */
    readonly lines: ReadonlyMap<string, LineEntry>;
    /** 线在这个模式下存不存在；主线总是存在。 */
    exists(line: string, mode: "actual" | "planned"): boolean;
    /** 从父线到主线的祖先线（主线自己是空列表）。 */
    ancestors(line: string): readonly string[];
    /** 一条变更或核对点的全序上的点。 */
    point(id: string): OrderPoint | null;
    /**
     * 一条记录在线 `line` 的视图里看不看得到（输出 2、3）：安放在这条线上、没越界的；或在父线视图里、按全序不晚于切口的；或在父线
     * 视图里、在定义这条线的分叉写下之前就有的计划。线不存在或不可建时为 false。
     */
    visible(line: string, id: string): boolean;
}

const tables = new WeakMap<WorldData, WeakMap<ChapterOrder, LineTable>>();

export function lineTable(data: WorldData, order: ChapterOrder): LineTable {
    let byOrder = tables.get(data);
    if (byOrder === undefined) {
        byOrder = new WeakMap();
        tables.set(data, byOrder);
    }
    let table = byOrder.get(order);
    if (table === undefined) {
        table = buildTable(data, order);
        byOrder.set(order, table);
    }
    return table;
}

function buildTable(data: WorldData, order: ChapterOrder): LineTable {
    const versionOf = (id: string) => data.createdAt.get(id) ?? 0;
    const placementOf = (id: string): Placement | undefined => data.changes.get(id)?.at ?? data.checks.get(id)?.place;
    const point = (id: string): OrderPoint | null => {
        const placement = placementOf(id);
        const rank = placement === undefined ? null : placementRank(order, placement);
        return rank === null ? null : {rank, version: versionOf(id), id};
    };

    // 定义：生效的已写分叉优先（几条时取最早写下的），否则是生效、没被生效计划替代的计划分叉。
    const replaced = new Set<string>();
    for (const change of data.changes.values()) {
        if (change.kind !== "plan" || change.status !== "active") continue;
        for (const link of change.links) if (link.kind === "replaces") replaced.add(link.plan);
    }
    const written = new Map<string, StoryChange & {fork: Fork}>();
    const planned = new Map<string, StoryChange & {fork: Fork}>();
    for (const change of data.changes.values()) {
        if (change.nature !== "fork" || change.fork === undefined || change.status !== "active") continue;
        const fork = change as StoryChange & {fork: Fork};
        const into = change.kind === "written" ? written : replaced.has(change.id) ? null : planned;
        if (into === null) continue;
        const existing = into.get(fork.fork.line);
        if (existing === undefined || versionOf(fork.id) < versionOf(existing.id)) into.set(fork.fork.line, fork);
    }
    const definitions = new Map<string, {fork: StoryChange & {fork: Fork}; planned: boolean}>();
    for (const [line, fork] of planned) definitions.set(line, {fork, planned: true});
    for (const [line, fork] of written) definitions.set(line, {fork, planned: false});
    definitions.delete(MAIN_LINE);

    // 父线链有环的线（改父线造成的），环上的都不可建、两种模式下都不存在。
    const inCycle = new Set<string>();
    for (const start of definitions.keys()) {
        const seen = new Set<string>();
        let line: string | undefined = start;
        while (line !== undefined && line !== MAIN_LINE && !seen.has(line)) {
            seen.add(line);
            line = definitions.get(line)?.fork.fork.parent;
        }
        if (line !== undefined && line !== MAIN_LINE && seen.has(line)) inCycle.add(start);
    }

    const existsMemo = new Map<string, {actual: boolean; planned: boolean}>();
    const existsOf = (line: string): {actual: boolean; planned: boolean} => {
        if (line === MAIN_LINE) return {actual: true, planned: true};
        const memo = existsMemo.get(line);
        if (memo !== undefined) return memo;
        const definition = definitions.get(line);
        let result = {actual: false, planned: false};
        if (definition !== undefined && !inCycle.has(line)) {
            const parent = existsOf(definition.fork.fork.parent);
            result = {actual: !definition.planned && parent.actual, planned: parent.planned};
        }
        existsMemo.set(line, result);
        return result;
    };

    const ancestorsOf = (line: string): string[] => {
        const found: string[] = [];
        let current = definitions.get(line)?.fork.fork.parent;
        while (current !== undefined && !found.includes(current)) {
            found.push(current);
            if (current === MAIN_LINE) break;
            current = definitions.get(current)?.fork.fork.parent;
        }
        return found;
    };

    // 看不看得到：按线递归，不可建的线什么都看不到。
    const unbuildableMemo = new Map<string, Unbuildable | null>();
    const visible = (line: string, id: string): boolean => {
        const placement = placementOf(id);
        if (placement === undefined) return false;
        if (line === MAIN_LINE) return lineOf(placement) === MAIN_LINE;
        const definition = definitions.get(line);
        if (definition === undefined || unbuildableOf(line) !== null) return false;
        const {fork} = definition.fork;
        const cut = point(fork.cut)!;
        if (lineOf(placement) === line) {
            // 自己的记录：键严格晚于切口才进视图；未排章的照收（输出 3）。
            const rank = placementRank(order, placement);
            return rank === null || compareRanks(rank, cut.rank) > 0;
        }
        if (!visible(fork.parent, id)) return false;
        const at = point(id);
        if (at !== null && compareOrder(at, cut) <= 0) return true;
        // 分叉之前写下的计划（含未排章的）随子线走（输出 2）。
        const change = data.changes.get(id);
        return change !== undefined && change.kind === "plan" && versionOf(id) < versionOf(definition.fork.id);
    };
    const unbuildableOf = (line: string): Unbuildable | null => {
        if (line === MAIN_LINE) return null;
        if (unbuildableMemo.has(line)) return unbuildableMemo.get(line)!;
        const definition = definitions.get(line);
        let reason: Unbuildable | null = null;
        if (definition === undefined) reason = null;
        else if (inCycle.has(line)) reason = "cycle";
        else {
            const {fork} = definition.fork;
            const parentReason = unbuildableOf(fork.parent);
            const cut = point(fork.cut);
            const trigger = fork.trigger === undefined ? null : point(fork.trigger);
            const self = point(definition.fork.id);
            if (parentReason !== null) reason = parentReason;
            else if (cut === null) reason = "cut-unplaced";
            else if (!visible(fork.parent, fork.cut)) reason = "cut-not-visible";
            else if (fork.trigger !== undefined && trigger === null) reason = "trigger-unplaced";
            else if (fork.trigger !== undefined && !visible(fork.parent, fork.trigger)) reason = "trigger-not-visible";
            else if (trigger !== null && compareOrder(trigger, cut) <= 0) reason = "trigger-not-after-cut";
            else if (fork.type === "rollback" && trigger !== null && self !== null && compareOrder(self, trigger) < 0) reason = "fork-before-trigger";
        }
        unbuildableMemo.set(line, reason);
        return reason;
    };

    const lines = new Map<string, LineEntry>();
    for (const [id, definition] of definitions) {
        lines.set(id, {id, fork: definition.fork, planned: definition.planned, parent: definition.fork.fork.parent, exists: existsOf(id), unbuildable: unbuildableOf(id)});
    }
    return {
        lines,
        exists: (line, mode) => existsOf(line)[mode],
        ancestors: (line) => (line === MAIN_LINE ? [] : ancestorsOf(line)),
        point,
        visible,
    };
}
