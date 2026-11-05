/**
 * 分叉的校验与缺省带什么（docs/specs/canon/worldlines.md 输出 7、14、18）。
 *
 * 校验只查这次新写或改过的分叉，另查这次改动有没有让已有的线变得不可建（挪动、取消排章、换线让切口或触发处不合规定）。带过去的
 * 地址在切口处存不存在，要父线的引擎回答：调用方传 `slotAfter`，父线没有引擎可问时返回 undefined，这一项不查。
 */

import {gapProblem, type Calendar} from "@notnotype/nb-time";

import type {ComponentRegistry} from "../components/registry";
import {addressKey, parsePath} from "../core/address";
import type {Address, Fork, ObjectRef, StoryChange} from "../core/schema";
import type {CarrySlot, WorldData} from "../engine/types";
import {compareOrder, lineOf, lineTable, MAIN_LINE, type LineTable} from "../lines/table";
import type {ChapterOrder} from "../core/position";
import {fieldsOf} from "./references";
import type {Problem} from "./world";

export interface ForkCheckInput {
    readonly before: WorldData;
    readonly after: WorldData;
    readonly order: ChapterOrder;
    readonly registry: ComponentRegistry;
    readonly calendar: Calendar;
    /** 这次新写或改过的剧情变更。 */
    readonly changed: readonly string[];
    /** 这次请求新发的线 id（临时线 id 换成的）。 */
    readonly issuedLines: ReadonlySet<string>;
    /** 父线 `line` 上，全序不晚于 `change` 那一刻一个地址的原始状态；那条线没有引擎可问时为 undefined。 */
    readonly slotAfter: (line: string, change: string, at: Address) => CarrySlot | null | undefined;
}

export function forkProblems(input: ForkCheckInput): Problem[] {
    const {before, after, order} = input;
    const table = lineTable(after, order);
    const earlier = lineTable(before, order);
    const problems: Problem[] = [];
    for (const id of input.changed) {
        const change = after.changes.get(id);
        if (change === undefined) continue;
        const ref: ObjectRef = {kind: "change", id};
        // `line-taken` 是 validation-failed 里单独的码（worldlines 失败表），其余是 invalid-fork。
        const fail = (path: string, message: string, code = "invalid-fork") => problems.push({code, ref, path, message});
        if (change.nature !== "fork" && change.fork === undefined) continue;
        if (change.nature !== "fork" || change.fork === undefined) {
            fail(change.fork === undefined ? "fork" : "nature", "a fork is a story change with nature \"fork\" and a fork record");
            continue;
        }
        if (change.patches.length > 0) fail("patches", "a fork has no patches");
        forkRecordProblems(change as StoryChange & {fork: Fork}, input, table, earlier, fail);
    }
    // 让已有的线变得不可建的改动（输出 18）：这次之前可建、之后不可建，报在定义它的分叉上。
    for (const [line, entry] of table.lines) {
        if (entry.unbuildable === null || earlier.lines.get(line)?.unbuildable !== null) continue;
        if (earlier.lines.get(line) === undefined) continue;
        problems.push({code: "invalid-fork", ref: {kind: "change", id: entry.fork.id}, path: "fork", message: `this write makes world line "${line}" unbuildable (${entry.unbuildable})`});
    }
    // 结束点改成未排章（输出 14）。
    for (const entry of table.lines.values()) {
        const endAt = entry.fork.fork.endAt;
        if (endAt !== undefined && input.changed.includes(endAt) && table.point(endAt) === null) problems.push({code: "invalid-fork", ref: {kind: "change", id: endAt}, path: "at", message: `the end of world line "${entry.id}" must stay scheduled`});
    }
    return problems;
}

function forkRecordProblems(change: StoryChange & {fork: Fork}, input: ForkCheckInput, table: LineTable, earlier: LineTable, fail: (path: string, message: string, code?: string) => void): void {
    const {fork} = change;
    const {after} = input;
    // 父线要存在，分叉安放在父线上。
    if (fork.parent !== MAIN_LINE && !table.exists(fork.parent, "planned")) fail("fork.parent", `parent line "${fork.parent}" does not exist`);
    if (lineOf(change.at) !== fork.parent) fail("at.line", "a fork is placed on its parent line");
    // 线 id：这次新发的；或者原来就是这条分叉的；或者兑现一条用同一个线 id、同一个父线的计划分叉（输出 14）。
    const previous = input.before.changes.get(change.id)?.fork;
    if (fork.line === MAIN_LINE) fail("fork.line", "the main line is not defined by a fork");
    else if (!input.issuedLines.has(fork.line) && previous?.line !== fork.line) {
        const fulfilled = change.kind === "written" && change.links.some((link) => {
            const plan = after.changes.get(link.kind === "fulfills" ? link.plan : "");
            return plan !== undefined && plan.kind === "plan" && plan.fork?.line === fork.line && plan.fork.parent === fork.parent;
        });
        if (!fulfilled) {
            if (earlier.lines.has(fork.line)) fail("fork.line", `world line "${fork.line}" is taken`, "line-taken");
            else fail("fork.line", "a new world line needs a tmp: id");
        }
    }
    // 切口与触发处：父线视图里已排章的已写剧情变更；触发处只有回溯能有、按全序晚于切口（输出 14、DS 3）。
    const written = (id: string) => after.changes.get(id)?.kind === "written";
    const cut = table.point(fork.cut);
    if (!written(fork.cut) || cut === null || !table.visible(fork.parent, fork.cut)) fail("fork.cut", "the cut must be a scheduled written story change in the parent line's view");
    if (fork.trigger !== undefined) {
        const trigger = table.point(fork.trigger);
        if (fork.type !== "rollback") fail("fork.trigger", "only a rollback has a trigger");
        else if (!written(fork.trigger) || trigger === null || !table.visible(fork.parent, fork.trigger)) fail("fork.trigger", "the trigger must be a scheduled written story change in the parent line's view");
        else if (cut !== null && compareOrder(trigger, cut) <= 0) fail("fork.trigger", "the trigger must come after the cut");
    }
    if (fork.back !== undefined) {
        if (fork.trigger === undefined) fail("fork.back", "back needs a trigger");
        const problem = gapProblem(fork.back, input.calendar);
        if (problem !== null) fail("fork.back", problem);
    }
    // 分叉安放的位置：回溯不早于触发处，其余晚于切口。
    const self = table.point(change.id);
    const rollback = fork.type === "rollback" && fork.trigger !== undefined;
    const bound = rollback ? table.point(fork.trigger!) : cut;
    if (self !== null && bound !== null && (rollback ? compareOrder(self, bound) < 0 : compareOrder(self, bound) <= 0)) fail("at", rollback ? "a rollback is placed no earlier than its trigger" : "a fork is placed after its cut");
    // 结束点。
    if ((fork.end === "return" || fork.end === "stop") && fork.endAt === undefined) fail("fork.endAt", "a line that returns or stops needs endAt");
    if (fork.endAt !== undefined) {
        const end = after.changes.get(fork.endAt);
        if (end === undefined || lineOf(end.at) !== fork.line || table.point(fork.endAt) === null) fail("fork.endAt", "endAt must be a scheduled record on this line");
    }
    // 带过去的地址：在切口处存在的条目上声明过的字段或列表，不重复（输出 14）。
    const seen = new Set<string>();
    for (const [index, address] of (fork.carry ?? []).entries()) {
        const path = `fork.carry[${String(index)}]`;
        const key = addressKey(address);
        if (seen.has(key)) fail(path, "carry lists an address twice");
        seen.add(key);
        const parsed = parsePath(address.path);
        const entry = after.entries.get(address.entry);
        if (parsed === null || parsed.root !== "namespace" || parsed.element !== undefined || parsed.sub !== undefined) {
            fail(path, "carry names a field or a list, not an element or its sub-field");
            continue;
        }
        if (entry === undefined || fieldsOf(input.registry, entry, parsed.namespace)?.some((field) => field.id === parsed.field) !== true) {
            fail(path, "carry names a declared field of an existing entry");
            continue;
        }
        if (cut !== null && input.slotAfter(fork.parent, fork.cut, address) === null) fail(path, "the carried entry does not exist at the cut");
    }
}

/**
 * 写入回溯分叉时没给 `carry` 的缺省（输出 7）：`who` 身上各命名空间里声明了 `carry: true` 的字段与列表，在切口处存在的才补；
 * 父线没有引擎可问时不补。别的种类、没有 `who` 时为空。
 */
export function defaultCarry(fork: Fork, data: WorldData, registry: ComponentRegistry, slotAfter: ForkCheckInput["slotAfter"]): Address[] {
    if (fork.type !== "rollback" || fork.who === undefined) return [];
    const who = data.entries.get(fork.who);
    if (who === undefined) return [];
    const carried: Address[] = [];
    for (const namespace of Object.keys(who.init.data).sort()) {
        for (const field of fieldsOf(registry, who, namespace) ?? []) {
            if (field.carry !== true) continue;
            const address = {entry: who.id, path: `${namespace}.${field.id}`};
            const slot = slotAfter(fork.parent, fork.cut, address);
            if (slot !== null && slot !== undefined) carried.push(address);
        }
    }
    return carried;
}
