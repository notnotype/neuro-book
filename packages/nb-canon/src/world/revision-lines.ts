/**
 * 修订与世界线的对应（docs/specs/canon/worldlines.md 输出 11）：还原依赖要知道一次修订碰了哪些线、新建了哪些线。
 * 都从修订的操作按顺序推出，不进日志；对象此刻在哪条线随扫描更新，所以改安放的线的修订两边的线都算碰到。
 */

import type {Op, Revision} from "../core/schema";
import {MAIN_LINE} from "../lines/table";

export interface RevisionLines {
    /** 第 i 次修订碰到的线（它写下、改过、删掉的剧情变更与核对点所在的线；分叉记录自己在父线上）。 */
    readonly touched: readonly ReadonlySet<string>[];
    /** 线 → 新建了定义它的分叉的修订的下标（从旧到新）。 */
    readonly created: ReadonlyMap<string, readonly number[]>;
}

const cache = new WeakMap<readonly Revision[], RevisionLines>();

export function revisionLines(revisions: readonly Revision[]): RevisionLines {
    const found = cache.get(revisions);
    if (found !== undefined) return found;
    const where = new Map<string, string>();
    const touched: Set<string>[] = [];
    const created = new Map<string, number[]>();
    for (const [index, revision] of revisions.entries()) {
        const lines = new Set<string>();
        touched.push(lines);
        for (const op of revision.ops) {
            if (op.kind === "chapters" || (op.ref.kind !== "change" && op.ref.kind !== "check")) continue;
            const key = `${op.ref.kind}:${op.ref.id}`;
            const before = where.get(key);
            if (before !== undefined) lines.add(before);
            const after = lineAfter(op, before ?? MAIN_LINE);
            where.set(key, after);
            lines.add(after);
            const line = forkLine(op);
            if (line !== undefined) created.set(line, [...(created.get(line) ?? []), index]);
        }
    }
    const result = {touched, created};
    cache.set(revisions, result);
    return result;
}

const placementPaths = new Set(["at", "place"]);

/** 操作之后对象所在的线：新建看它的安放，改动看安放的线字段，删除时不变。 */
function lineAfter(op: Exclude<Op, {kind: "chapters"}>, current: string): string {
    if (op.kind === "create") return placementLine(op.after) ?? MAIN_LINE;
    if (op.kind === "delete") return current;
    let line = current;
    for (const field of op.fields) {
        if (placementPaths.has(field.path)) line = (field.after !== null && typeof field.after === "object" ? (field.after as {line?: string}).line : undefined) ?? MAIN_LINE;
        else if (field.path === "at.line" || field.path === "place.line") line = typeof field.after === "string" ? field.after : MAIN_LINE;
    }
    return line;
}

function placementLine(value: unknown): string | undefined {
    if (value === null || typeof value !== "object") return undefined;
    const object = value as {at?: {line?: string}; place?: {line?: string}};
    return (object.at ?? object.place)?.line;
}

/** 这个操作新建了定义哪条线的分叉（新建变更，或把分叉写到已有变更上）。 */
function forkLine(op: Exclude<Op, {kind: "chapters"}>): string | undefined {
    if (op.ref.kind !== "change") return undefined;
    if (op.kind === "create") {
        const fork = (op.after as {fork?: {line?: unknown}} | null)?.fork;
        return typeof fork?.line === "string" ? fork.line : undefined;
    }
    if (op.kind === "modify") {
        for (const field of op.fields) {
            if (field.path === "fork" && field.after !== null && typeof field.after === "object") {
                const line = (field.after as {line?: unknown}).line;
                if (typeof line === "string") return line;
            }
            if (field.path === "fork.line" && typeof field.after === "string") return field.after;
        }
    }
    return undefined;
}
