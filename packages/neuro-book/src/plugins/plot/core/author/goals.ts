/**
 * 作者用的目标表与人物页的“目标与态度”（docs/specs/plot/goals.md 输出 6）：主要角色一组一组，目标带冲突、最近一次动过与没动过的
 * 章数（与停滞同一个算法，`goalQuiet`），组带态度（语义档未归纳的写明）。旧的 `goalTable`（输出 5）给 Agent 用，口径不变。
 */

import type {CanonReadView, Mode, ReadPosition} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES} from "../../shared/declarations";
import {goalQuiet, STALLED_AFTER_CHAPTERS} from "../goal-checks";
import {conflictsOf, readGoal} from "../goals";
import type {GoalConflict, GoalRead} from "../goals";
import {bodyOf} from "./knowing";
import {mainCharacters} from "./secrets";

export interface AuthorGoal extends GoalRead {
    /** 冲突的目标，另带它的持有者（本体）。 */
    readonly conflicts: readonly (GoalConflict & {readonly holder: string | null})[];
    /** 最近一次动过的章（前史为 null）；从没动过为 null。 */
    readonly last: {readonly chapter: string | null} | null;
    /** 没动过的章数（从最近一次，没有时从出场，到读取位置所在的章）。 */
    readonly quiet: number;
    /** 停滞（goals.md 输出 4）：进行的目标没动过的章数超过上限。 */
    readonly stalled: boolean;
}

export interface AuthorAttitude {
    readonly object: string;
    readonly 态度: string | null;
    /** 语义档在这个位置上还没归纳（界面写“还没归纳”）。 */
    readonly notReduced: boolean;
    readonly 起因: string | null;
    readonly 称呼: string | null;
}

export interface AuthorHolder {
    readonly holder: string;
    readonly goals: readonly AuthorGoal[];
    readonly attitudes: readonly AuthorAttitude[];
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const ref = (value: unknown): string | null => {
    const id = (value as {ref?: unknown} | null | undefined)?.ref;
    return typeof id === "string" ? id : null;
};

/** 一个人（本体）在这个位置上的全部目标（各状态），马甲名下的也算。 */
function goalsOfHolder(view: CanonReadView, holder: string, position: ReadPosition, mode: Mode): GoalRead[] {
    return view.entries().flatMap((entry) => {
        if (entry.type !== ENTRY_TYPES.goal || entry.deleted === true || entry.parent === null || bodyOf(view, entry.parent) !== holder) return [];
        const goal = readGoal(view, entry.id, position, mode);
        return goal === null ? [] : [goal];
    });
}

function authorGoal(view: CanonReadView, goal: GoalRead, position: ReadPosition, mode: Mode): AuthorGoal {
    const {last, quiet} = goalQuiet(view, goal.id, mode, position);
    const conflicts = (conflictsOf(view, goal.id, position, mode) ?? []).map((conflict) => {
        const parent = (view.object({kind: "entry", id: conflict.id}) as {readonly parent?: string | null} | undefined)?.parent;
        return {...conflict, holder: typeof parent === "string" ? bodyOf(view, parent) : null};
    });
    return {...goal, conflicts, last, quiet, stalled: goal.状态 === "active" && quiet > STALLED_AFTER_CHAPTERS};
}

/** 一个人的态度表（他身上 `att.态度` 的每一行）。 */
export function attitudesOf(view: CanonReadView, person: string, position: ReadPosition, mode: Mode): AuthorAttitude[] {
    const read = view.entry(person, position, mode);
    if (read === null || read === "chapter-not-found") return [];
    const field = read.namespaces.att?.fields.态度;
    const rows = Array.isArray(field?.value) ? (field.value as Array<Record<string, unknown>>) : [];
    return rows.map((row) => ({object: String(row.id), 态度: text(row.态度), notReduced: field?.notReduced === true, 起因: ref(row.起因), 称呼: text(row.称呼)}));
}

/** 人物页“目标与态度”：他的目标（各状态）与态度。 */
export function personGoals(view: CanonReadView, mode: Mode, position: ReadPosition, person: string): {readonly goals: readonly AuthorGoal[]; readonly attitudes: readonly AuthorAttitude[]} {
    const holder = bodyOf(view, person);
    return {goals: goalsOfHolder(view, holder, position, mode).map((goal) => authorGoal(view, goal, position, mode)), attitudes: attitudesOf(view, holder, position, mode)};
}

const ORDER: Readonly<Record<string, number>> = {active: 0, blocked: 1, achieved: 2, abandoned: 3};

/**
 * 目标表：主要角色（或筛出的那一个）各一组；缺省只列进行与受挫的目标，`finished` 时达成与放弃的另列在后面。
 */
export function authorGoals(view: CanonReadView, mode: Mode, position: ReadPosition, filter: {readonly holder?: string; readonly finished?: boolean} = {}): AuthorHolder[] {
    const holders = mainCharacters(view, position, mode).filter((holder) => filter.holder === undefined || holder === bodyOf(view, filter.holder));
    return holders.map((holder) => {
        const goals = goalsOfHolder(view, holder, position, mode)
            .filter((goal) => filter.finished === true || goal.状态 === "active" || goal.状态 === "blocked")
            .sort((a, b) => (ORDER[a.状态 ?? ""] ?? 9) - (ORDER[b.状态 ?? ""] ?? 9) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .map((goal) => authorGoal(view, goal, position, mode));
        return {holder, goals, attitudes: attitudesOf(view, holder, position, mode)};
    });
}
