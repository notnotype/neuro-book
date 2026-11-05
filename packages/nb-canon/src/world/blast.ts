/**
 * 预览的波及面（docs/specs/canon/worldlines.md 输出 10）：改分叉的参数、或改一条记录安放的线，是线的结构变更。预览另给出：
 * 哪些已存的子线记录因此越界、哪些计划在哪些线上变得看得到或看不到、哪些线上的计划进展变了、这些记录上有正文讲述的章。
 * 不存进修订：它只回答“这次改下去会怎样”，发布以后这些事实自己在待处理与读取里。
 */

import {defaultPosition} from "../core/position";
import type {ObjectRef, Op} from "../core/schema";
import type {PlanProgress} from "../engine/types";
import {definitionKey} from "../lines/affected";
import {linePending} from "../lines/pending";
import {lineOf, lineTable} from "../lines/table";
import {sameJson} from "../core/stable-json";
import type {World} from "./world";

export interface Blast {
    /** 这次让越界的已存记录（改前不越界）。 */
    readonly outOfBounds: readonly {readonly line: string; readonly ref: ObjectRef}[];
    /** 看不看得到的计划在哪些线上变了（`visible` 是改后）。 */
    readonly plans: readonly {readonly plan: string; readonly line: string; readonly visible: boolean}[];
    /** 全书当前进展上计划进展变了的：线、计划、改前与改后（线上看不到时为 null）。 */
    readonly progress: readonly {readonly line: string; readonly plan: string; readonly before: PlanProgress | null; readonly after: PlanProgress | null}[];
    /** 越界的记录上有正文讲述的章。 */
    readonly chapters: readonly string[];
}

/** 这次写入动了线的结构吗：哪条线的定义（含切口与触发处的位置）变了，或某条记录换了线。 */
function touchesLines(before: World, after: World, ops: readonly Op[]): boolean {
    const [old, now] = [lineTable(before.data, before.options.order), lineTable(after.data, after.options.order)];
    for (const id of new Set([...old.lines.keys(), ...now.lines.keys()])) if (!sameJson(definitionKey(old, id), definitionKey(now, id))) return true;
    return ops.some((op) => {
        if (op.kind === "chapters" || (op.ref.kind !== "change" && op.ref.kind !== "check")) return false;
        const [was, is] = op.ref.kind === "change" ? [before.data.changes.get(op.ref.id)?.at, after.data.changes.get(op.ref.id)?.at] : [before.data.checks.get(op.ref.id)?.place, after.data.checks.get(op.ref.id)?.place];
        // 新建与删除不换线；只有已有的记录改了安放的线才算。
        return was !== undefined && is !== undefined && lineOf(was) !== lineOf(is);
    });
}

export function blastRadius(before: World, after: World, ops: readonly Op[]): Blast | null {
    if (!touchesLines(before, after, ops)) return null;
    const order = after.options.order;
    const [old, now] = [lineTable(before.data, before.options.order), lineTable(after.data, order)];
    const lineIds = [...new Set([...old.lines.keys(), ...now.lines.keys()])].sort();

    const outBefore = new Set<string>();
    for (const line of lineIds) for (const item of linePending(before.data, before.options.order, line)) if (item.kind === "line-out-of-bounds") outBefore.add(`${item.line}|${item.ref.kind}:${item.ref.id}`);
    const outOfBounds: {line: string; ref: ObjectRef}[] = [];
    for (const line of lineIds) {
        for (const item of linePending(after.data, order, line)) if (item.kind === "line-out-of-bounds" && !outBefore.has(`${item.line}|${item.ref.kind}:${item.ref.id}`) && !outOfBounds.some((seen) => seen.line === item.line && seen.ref.id === item.ref.id)) outOfBounds.push({line: item.line, ref: item.ref});
    }

    const plans: {plan: string; line: string; visible: boolean}[] = [];
    const progress: {line: string; plan: string; before: PlanProgress | null; after: PlanProgress | null}[] = [];
    const [latestBefore, latestAfter] = [defaultPosition(before.options.order), defaultPosition(order)];
    const planIds = new Set<string>();
    for (const data of [before.data, after.data]) for (const change of data.changes.values()) if (change.kind === "plan" && change.status === "active") planIds.add(change.id);
    for (const line of ["main", ...lineIds]) {
        for (const plan of [...planIds].sort()) {
            const [was, is] = [line === "main" || (old.lines.get(line)?.unbuildable === null && old.visible(line, plan)), line === "main" || (now.lines.get(line)?.unbuildable === null && now.visible(line, plan))];
            if (was !== is) plans.push({plan, line, visible: is});
            if (!was && !is) continue;
            const read = (world: World, visible: boolean, at: typeof latestBefore): PlanProgress | null => {
                const value = visible ? world.line(line)?.engine.progress(plan, at) : undefined;
                return value === undefined || value === "chapter-not-found" ? null : value;
            };
            const [pb, pa] = [read(before, was, latestBefore), read(after, is, latestAfter)];
            if (pb !== pa) progress.push({line, plan, before: pb, after: pa});
        }
    }

    const chapters = new Set<string>();
    for (const {ref} of outOfBounds) {
        const told = ref.kind === "change" ? after.data.changes.get(ref.id)?.told : ref.kind === "check" ? [after.data.checks.get(ref.id)!.told] : [];
        for (const telling of told ?? []) if (telling.source === "chapter" && telling.chapter !== undefined) chapters.add(telling.chapter);
    }
    return {outOfBounds, plans, progress, chapters: [...chapters].sort()};
}
