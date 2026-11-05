/**
 * 世界线的三种待处理（docs/specs/canon/worldlines.md 输出 1、3、18；model.md 输出 16）：
 * - 越界（`line-out-of-bounds`）：安放在这条线上、却不晚于切口的记录，只进它所在线的待处理；
 * - 线不存在（`line-missing`）：安放在两种模式下都不存在、或不可建的线上的记录，任何线的待处理里都列；
 * - 计划线上的已写记录（`line-planned`）：兑现计划分叉的已写分叉撤销或被替代以后留下的，两种模式下都列。
 * 不随读取位置截取（与“章已删除”一样，是记录放错了地方，不是故事里的事）。
 */

import type {ChapterOrder} from "../core/position";
import {compareIds} from "../core/ids";
import type {ObjectRef, Placement} from "../core/schema";
import type {WorldData} from "../engine/types";
import {lineOf, lineTable, MAIN_LINE} from "./table";

export type LinePendingItem =
    | {readonly kind: "line-out-of-bounds"; readonly ref: ObjectRef; readonly line: string; readonly cut: string}
    | {readonly kind: "line-missing"; readonly ref: ObjectRef; readonly line: string; readonly reason?: string}
    /** `root` 是让这条线变回计划线的那次修订（世界里补上，输出 1 的“根因是那次撤销或替代”）。 */
    | {readonly kind: "line-planned"; readonly ref: ObjectRef; readonly line: string; readonly root?: string};

/** 在线 `line` 上读待处理时，世界线的几种。 */
export function linePending(data: WorldData, order: ChapterOrder, line: string): LinePendingItem[] {
    const table = lineTable(data, order);
    const items: LinePendingItem[] = [];
    const visit = (ref: ObjectRef, placement: Placement, written: boolean) => {
        const on = lineOf(placement);
        if (on === MAIN_LINE) return;
        const entry = table.lines.get(on);
        if (entry === undefined || (!entry.exists.actual && !entry.exists.planned) || entry.unbuildable !== null) {
            items.push({kind: "line-missing", ref, line: on, ...(entry?.unbuildable === null || entry === undefined ? {} : {reason: entry.unbuildable})});
            return;
        }
        if (written && !entry.exists.actual) {
            items.push({kind: "line-planned", ref, line: on});
            return;
        }
        if (on === line && !table.visible(line, ref.id)) items.push({kind: "line-out-of-bounds", ref, line: on, cut: entry.fork.fork.cut});
    };
    for (const change of data.changes.values()) visit({kind: "change", id: change.id}, change.at, change.kind === "written" && change.status !== "undone");
    for (const check of data.checks.values()) visit({kind: "check", id: check.id}, check.place, true);
    return items.sort((a, b) => compareIds(a.ref.id, b.ref.id));
}
