/**
 * 受影响的线（docs/specs/canon/worldlines.md 输出 17）：一次写入可能改变哪些世界线上的实际结果。
 *
 * 只看线表与安放，不看哪些线已建、也不要引擎：缓存状态不能决定“这次让哪些记录套不上”记不记全。判得宽不判得窄：宁可多建
 * 一条线，也不漏记一条套不上的记录；线层差分对每一步断言“受影响的集合包含从头算出实际结果真变了的线”。
 *
 * 线 L 在祖先 A 上的依赖范围：A 的线视图里全序不晚于 L 的“触及点”的部分。对父线，触及点是 `max(切口, 触发处)`：继承到切口，
 * 带过去的值读到触发处。再往上一层：触及点晚于父线 P 自己的合成事件（P 的切口所在的键）时，L 读到了 P 带过去的值，所以
 * L 在 P 的父线 G 上的范围是 P 自己在 G 上的范围；否则 L 的触及点落在 P 继承来的部分里，与在 P 上的相同。
 */

import {compareRanks, type ChapterOrder} from "../core/position";
import {sameJson} from "../core/stable-json";
import type {Op} from "../core/schema";
import type {WorldData} from "../engine/types";
import {compareOrder, lineOf, lineTable, MAIN_LINE, type LineTable, type OrderPoint} from "./table";

/** 这次写入改到的对象。 */
export interface Touched {
    readonly changes: readonly string[];
    readonly checks: readonly string[];
    /** 改了条目的初值或墓碑；新建条目、改文件夹、次序、`appears`、`sameAs` 不算（不改变任何实际结果）。 */
    readonly entry: boolean;
    /** 章序或登记变了。 */
    readonly structural: boolean;
}

/** 从写入的操作算出 `Touched`。 */
export function touchedOf(ops: readonly Op[], structural: boolean): Touched {
    const changes: string[] = [];
    const checks: string[] = [];
    let entry = false;
    for (const op of ops) {
        if (op.kind === "chapters") {
            structural = true;
            continue;
        }
        if (op.ref.kind === "change") changes.push(op.ref.id);
        else if (op.ref.kind === "check") checks.push(op.ref.id);
        else if (op.ref.kind === "entry") {
            if (op.kind === "delete" || (op.kind === "modify" && op.fields.some((field) => /^(init|deleted)\b/u.test(field.path)))) entry = true;
        }
    }
    return {changes, checks, entry, structural};
}

interface Side {
    readonly data: WorldData;
    readonly table: LineTable;
}

/** 线 `line` 在它每个祖先上的依赖范围上界（祖先 id → 全序上的点）；线不存在或不可建时为 null。 */
function reach(table: LineTable, line: string): Map<string, OrderPoint> | null {
    const entry = table.lines.get(line);
    if (entry === undefined || entry.unbuildable !== null) return null;
    const result = new Map<string, OrderPoint>();
    let current = entry;
    const {fork} = current.fork;
    const touchedPoint = (id: string) => table.point(id)!;
    let bound = touchedPoint(fork.trigger ?? fork.cut);
    for (;;) {
        result.set(current.parent, bound);
        if (current.parent === MAIN_LINE) return result;
        const parent = table.lines.get(current.parent)!;
        const own = parent.fork.fork;
        const carry = touchedPoint(own.cut);
        // 触及点晚于父线切口所在的键：读到了父线带过去的值（它的合成事件排在该键上所有真实记录之后）。
        if (compareRanks(bound.rank, carry.rank) > 0) bound = touchedPoint(own.trigger ?? own.cut);
        current = parent;
    }
}

/** 定义里影响结果的部分：哪条分叉、父线、切口、触发处、带过去的地址、能不能建。线不存在时为 null。 */
export function definitionKey(table: LineTable, line: string): unknown {
    const entry = table.lines.get(line);
    if (entry === undefined) return null;
    const {fork} = entry.fork;
    // 切口与触发处的位置也算：它们被挪动，线的视图里谁在谁不在就跟着变，不只是被改到的那条记录。
    const place = (id: string | undefined) => {
        const point = id === undefined ? null : table.point(id);
        return point === null ? null : `${point.rank.join(",")}:${String(point.version)}:${point.id}`;
    };
    return {id: entry.fork.id, parent: fork.parent, cut: fork.cut, cutAt: place(fork.cut), trigger: fork.trigger ?? null, triggerAt: place(fork.trigger), carry: fork.carry ?? null, unbuildable: entry.unbuildable};
}

/**
 * 改前、改后两份数据上，这次写入可能改变实际结果的世界线（不含主线：主线总是更新）。线只要在其中一边受影响就算。
 */
export function affectedLines(before: {readonly data: WorldData; readonly order: ChapterOrder}, after: {readonly data: WorldData; readonly order: ChapterOrder}, touched: Touched): Set<string> {
    const old: Side = {data: before.data, table: lineTable(before.data, before.order)};
    const now: Side = {data: after.data, table: lineTable(after.data, after.order)};
    const ids = new Set([...old.table.lines.keys(), ...now.table.lines.keys()]);
    const affected = new Set<string>();
    if (touched.structural || touched.entry) return ids;

    // 只有已写的记录与核对点影响实际结果；计划不套进实际模式。
    const placed = (side: Side, id: string) => {
        const change = side.data.changes.get(id);
        if (change !== undefined) return change.kind === "written" && change.status !== "undone" ? change.at : undefined;
        return side.data.checks.get(id)?.place;
    };
    const records = [...touched.changes, ...touched.checks];
    for (const line of ids) {
        // 定义变了（含一边不存在、一边存在）：L 或祖先任何一环不同。
        const chain = new Set([line]);
        for (const side of [old, now]) for (const ancestor of side.table.ancestors(line)) if (ancestor !== MAIN_LINE) chain.add(ancestor);
        if ([...chain].some((member) => !sameJson(definitionKey(old.table, member), definitionKey(now.table, member)))) {
            affected.add(line);
            continue;
        }
        for (const side of [old, now]) {
            const range = reach(side.table, line);
            if (range === null) continue;
            if (records.some((id) => {
                const placement = placed(side, id);
                if (placement === undefined) return false;
                const on = lineOf(placement);
                if (on === line) return true;
                const bound = range.get(on);
                if (bound === undefined) return false;
                const point = side.table.point(id);
                return point !== null && compareOrder(point, bound) <= 0;
            })) {
                affected.add(line);
                break;
            }
        }
    }
    return affected;
}
