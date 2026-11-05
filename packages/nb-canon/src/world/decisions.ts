/**
 * 决策的状态表（docs/specs/canon/model.md “状态与转换”的决策部分、输出 31 到 33）：一次写入把一条决策从什么变成什么，
 * 算哪种转换、要不要作者来源。写入校验（`invalid-transition`、必有的字段）与授权的检查（revisions.md 输出 21）都按
 * 这一张表判断，不在两处各写一份条件。
 */

import type {Decision} from "../core/schema";
import {stableStringify} from "../core/stable-json";

export type DecisionStatus = Decision["status"];

/** 授权里写的转换（revisions.md 输出 21 的“转换的写法”）；`edit` 是已定的决策只改字段，`revert` 是还原。 */
export type Transition = "new→pending" | "new→decided" | "pending→decided" | "pending→dropped" | "decided→pending" | "dropped→pending" | "decided→superseded" | "edit" | "revert";

/** 各状态必有的字段（`source` 由内核在接受授权时写，所以在授权处理之后查）。 */
export const REQUIRED_FIELDS: Readonly<Record<DecisionStatus, readonly (keyof Decision)[]>> = {
    pending: ["text"],
    decided: ["text", "conclusion", "source"],
    superseded: ["text", "supersededBy", "source"],
    dropped: ["text", "source"],
};

/** 状态之间允许的转换与要不要作者来源；不在表里的拒收。 */
const STATUS_TRANSITIONS: ReadonlyMap<string, {readonly transition: Transition; readonly needsSource: boolean}> = new Map([
    ["new→pending", {transition: "new→pending", needsSource: false}],
    ["new→decided", {transition: "new→decided", needsSource: true}],
    ["pending→decided", {transition: "pending→decided", needsSource: true}],
    ["pending→dropped", {transition: "pending→dropped", needsSource: true}],
    ["decided→pending", {transition: "decided→pending", needsSource: true}],
    ["dropped→pending", {transition: "dropped→pending", needsSource: true}],
    ["decided→superseded", {transition: "decided→superseded", needsSource: true}],
]);

/** 状态不变时能改的字段：待定里不要来源的，已定里要来源的（`edit`）。别的状态、别的字段都不能单独改。 */
const FREE_IN_PENDING: ReadonlySet<string> = new Set(["text", "candidates", "due", "about", "suggestion", "hints", "quote"]);
const SOURCED_IN_DECIDED: ReadonlySet<string> = new Set(["conclusion", "reason", "risks", "constraints", "marks", "scope", "about"]);
/**
 * 新建的待定决策不能带的字段：读取时列在“重新打开前定下的”下面的那几项（`decisionView` 的 `earlier`，model.md“状态与转换”）。
 * 范围不在里面：它不进 `earlier`，新建时可以先写上。
 */
const DECIDED_ONLY = ["conclusion", "reason", "risks", "constraints", "marks"] as const;

/** 授权的 `fields` 摘要取的键（revisions.md 输出 21）。 */
export const AUTHORIZED_KEYS = ["status", "conclusion", "reason", "risks", "constraints", "marks", "scope", "about", "supersededBy"] as const;

export type Classified =
    | {readonly kind: "unchanged"}
    | {readonly kind: "free"}
    | {readonly kind: "sourced"; readonly transition: Transition}
    | {readonly kind: "invalid"; readonly message: string};

/**
 * 一次写入对一条决策是哪种转换。`before` 为 undefined 是新建。出处 `source` 不在比较之内：写入请求改它另报
 * `source-not-writable`。
 */
export function classifyDecisionWrite(before: Decision | undefined, after: Decision): Classified {
    if (before === undefined) {
        const row = STATUS_TRANSITIONS.get(`new→${after.status}`);
        if (row === undefined) return {kind: "invalid", message: `a new decision cannot start as ${after.status}`};
        // 新建的待定决策只能带待定里能改的字段：结论、理由这些只在已定时起作用、要作者来源，新建时带上会被读成
        // “重新打开前定下的”（decisionView 的 `earlier`），等于不带来源写出一段作者定过的历史。
        if (!row.needsSource) {
            const decidedOnly = DECIDED_ONLY.filter((key) => after[key] !== undefined);
            if (decidedOnly.length > 0) return {kind: "invalid", message: `a new pending decision cannot carry ${decidedOnly.join(", ")}`};
        }
        return row.needsSource ? {kind: "sourced", transition: row.transition} : {kind: "free"};
    }
    if (before.status !== after.status) {
        const row = STATUS_TRANSITIONS.get(`${before.status}→${after.status}`);
        if (row === undefined) return {kind: "invalid", message: `${before.status} cannot become ${after.status}`};
        return {kind: "sourced", transition: row.transition};
    }
    const changed = changedKeys(before, after);
    if (changed.length === 0) return {kind: "unchanged"};
    const allowed = after.status === "pending" ? FREE_IN_PENDING : after.status === "decided" ? SOURCED_IN_DECIDED : new Set<string>();
    const outside = changed.filter((key) => !allowed.has(key));
    if (outside.length > 0) return {kind: "invalid", message: `a ${after.status} decision cannot change ${outside.join(", ")}`};
    return after.status === "decided" ? {kind: "sourced", transition: "edit"} : {kind: "free"};
}

function changedKeys(before: Decision, after: Decision): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    keys.delete("source");
    keys.delete("id");
    keys.delete("status");
    return [...keys].filter((key) => stableStringify((before as Record<string, unknown>)[key]) !== stableStringify((after as Record<string, unknown>)[key])).sort();
}

/** 这个状态必有、却没有的字段。 */
export function missingFields(decision: Decision): string[] {
    return REQUIRED_FIELDS[decision.status].filter((key) => {
        const value = (decision as Record<string, unknown>)[key];
        return value === undefined || value === "";
    });
}

/** 还原时这条决策要不要作者授权：被补偿删掉，或状态、要来源的字段与改前不同（revisions.md 输出 21 的“还原”）。 */
export function revertNeedsSource(before: Decision | undefined, after: Decision | undefined): boolean {
    // 补偿建回一条被还原删掉的决策，或删掉一条决策，都与改前不同。
    if (before === undefined || after === undefined) return before !== after;
    return AUTHORIZED_KEYS.some((key) => stableStringify(before[key]) !== stableStringify(after[key]));
}

/** 读取时给决策的说明（model.md 输出 31 到 33）。 */
export interface DecisionView {
    readonly decision: Decision;
    /** 有建议时为 true：建议是作者没确认的（输出 32）。 */
    readonly unconfirmed?: true;
    /** 已定的决策的理由；没给时是“作者没说理由”，程序不补（输出 31）。 */
    readonly reason?: string;
    /** 不在已定状态时还存着的结论、理由、风险、约束、标注：重新打开前定下的，守卫与约束不再检查。 */
    readonly earlier?: Partial<Pick<Decision, "conclusion" | "reason" | "risks" | "constraints" | "marks">>;
    /** 挂的对象里删掉了的条目在 `about` 里的下标：显示“已删除的条目”（输出 33）。 */
    readonly deletedAbout?: readonly number[];
}

export const NO_REASON = "作者没说理由";

export function decisionView(decision: Decision, entryOf: (id: string) => {readonly deleted?: boolean} | undefined): DecisionView {
    const earlier: Record<string, unknown> = {};
    if (decision.status !== "decided") for (const key of ["conclusion", "reason", "risks", "constraints", "marks"] as const) if (decision[key] !== undefined) earlier[key] = decision[key];
    const deletedAbout = decision.about.flatMap((about, index) => {
        const id = about.kind === "entry" ? about.id : about.kind === "address" ? about.at.entry : undefined;
        return id !== undefined && entryOf(id)?.deleted === true ? [index] : [];
    });
    return {
        decision,
        ...(decision.suggestion === undefined ? {} : {unconfirmed: true as const}),
        ...(decision.status === "decided" ? {reason: decision.reason ?? NO_REASON} : {}),
        ...(Object.keys(earlier).length === 0 ? {} : {earlier}),
        ...(deletedAbout.length === 0 ? {} : {deletedAbout}),
    };
}

/** 决策挂的一项是不是筛选要的对象（地址按它的条目算）。 */
export function aboutMatches(about: Decision["about"][number], wanted: {readonly kind: string; readonly id: string}): boolean {
    if (about.kind === "address") return wanted.kind === "entry" && about.at.entry === wanted.id;
    if (about.kind === "diagnostic") return false;
    return about.kind === wanted.kind && about.id === wanted.id;
}
