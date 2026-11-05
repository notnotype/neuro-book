/**
 * 角色的目标（docs/specs/plot/goals.md 输出 1、2）：某人在一个位置上的目标，与冲突的对称读取。只读世界引擎的只读视图，
 * 不存东西。隐秘目标的知情在 `knowledge.ts`，按视角挡隐秘目标在 `viewpoint.ts`；三项检查与目标表随阶段 E。
 *
 * 目标和别的状态一样按安放折叠：一个目标在位置 P 上“在”，指它没删、在 P 上已出场。冲突两边都按这个算：A 的 `冲突` 写了 B，
 * 读 A 时 B 要在才列，读 B 时 A 要在才列；所以读到的冲突关系在任一位置上都是对称的。
 */

import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES} from "../shared/declarations";

export type GoalStatus = "active" | "blocked" | "achieved" | "abandoned";

/** 一个目标在一个位置上的读取结果（`goal` 命名空间折叠后的值）。 */
export interface GoalRead {
    readonly id: string;
    /** 持有者：条目树上的父条目（条目树不随位置变）。 */
    readonly holder: string;
    readonly name: string;
    readonly 状态: GoalStatus | null;
    readonly 轻重: "major" | "minor" | null;
    readonly 层次: "want" | "need" | null;
    readonly 为什么: string | null;
    readonly 基于: readonly string[];
    /** 这个目标自己的 `冲突` 里写下的目标（存下来的那一边，未按在不在筛）。 */
    readonly 冲突: readonly string[];
    readonly 后继: string | null;
    readonly 隐秘: string | null;
}

/** 冲突的一项：`writtenOn` 是这条冲突写在哪一边的 `冲突` 里（改它要去改那个目标）。 */
export interface GoalConflict {
    readonly id: string;
    readonly writtenOn: "this" | "other" | "both";
}

/** 一个目标在位置 P 上的读取；不是目标、已删或还没出场时为 null。 */
export function readGoal(view: CanonReadView, id: string, position: ReadPosition, mode: Mode): GoalRead | null {
    const stored = view.object({kind: "entry", id}) as {type?: string; parent?: string | null; deleted?: boolean} | undefined;
    if (stored === undefined || stored.type !== ENTRY_TYPES.goal || stored.deleted === true || typeof stored.parent !== "string") return null;
    const read = view.entry(id, position, mode);
    if (read === null || read === "chapter-not-found" || read.deleted || !read.appeared) return null;
    const fields = read.namespaces.goal?.fields ?? {};
    const text = (field: string) => (typeof fields[field]?.value === "string" ? (fields[field]!.value as string) : null);
    const ref = (field: string) => {
        const target = (fields[field]?.value as {ref?: unknown} | null | undefined)?.ref;
        return typeof target === "string" ? target : null;
    };
    const ids = (field: string) => (Array.isArray(fields[field]?.value) ? (fields[field]!.value as Array<{id?: unknown}>).flatMap((item) => (typeof item.id === "string" ? [item.id] : [])) : []);
    return {
        id,
        holder: stored.parent,
        name: read.name,
        状态: text("状态") as GoalStatus | null,
        轻重: text("轻重") as GoalRead["轻重"],
        层次: text("层次") as GoalRead["层次"],
        为什么: text("为什么"),
        基于: ids("基于"),
        冲突: ids("冲突"),
        后继: ref("后继"),
        隐秘: ref("隐秘"),
    };
}

/** 位置 P 上在的全部目标，按条目的创建先后。 */
function goalsAt(view: CanonReadView, position: ReadPosition, mode: Mode): GoalRead[] {
    return view.entries().flatMap((entry) => {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.goal) return [];
        const goal = readGoal(view, entry.id, position, mode);
        return goal === null ? [] : [goal];
    });
}

/** 某人在位置 P 上的目标（输出 1）：挂在他下面、已出场、状态为进行或受挫的。 */
export function goalsOf(view: CanonReadView, holder: string, position: ReadPosition, mode: Mode): GoalRead[] {
    return goalsAt(view, position, mode).filter((goal) => goal.holder === holder && (goal.状态 === "active" || goal.状态 === "blocked"));
}

/**
 * 一个目标在位置 P 上的冲突（输出 2）：它自己 `冲突` 里写的，加上 `冲突` 里写了它的别的目标；两边都只列在 P 上在的。
 * 先列自己写的（按写的顺序），再列别人写的（按条目的创建先后）。目标本身不在时为 null。
 */
export function conflictsOf(view: CanonReadView, id: string, position: ReadPosition, mode: Mode): GoalConflict[] | null {
    const all = goalsAt(view, position, mode);
    const self = all.find((goal) => goal.id === id);
    if (self === undefined) return null;
    const present = new Set(all.map((goal) => goal.id));
    const writtenByOthers = new Set(all.filter((goal) => goal.id !== id && goal.冲突.includes(id)).map((goal) => goal.id));
    const result: GoalConflict[] = [];
    for (const target of new Set(self.冲突)) {
        if (target === id || !present.has(target)) continue;
        result.push({id: target, writtenOn: writtenByOthers.has(target) ? "both" : "this"});
    }
    for (const other of writtenByOthers) if (!self.冲突.includes(other)) result.push({id: other, writtenOn: "other"});
    return result;
}
