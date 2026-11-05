/**
 * 回溯到的那一刻 R（docs/specs/canon/time.md 输出 6）：回溯分叉有 `back` 时，子线的网络里多一个只作节点的点 R，用父线（同一模式）
 * 算好的范围作常量约束，不把触发处本身并进子线。
 *
 * - 父线上“触发处起点减切口起点”的范围是 [d⁻, d⁺]：`R - 切口.s ∈ [d⁻ - back.max, d⁺ - back.min]`；
 * - 触发处起点连到元年、范围是 [a, b]：`R ∈ [a - back.max, b - back.min]`；
 * - 子线自己的事件都不早于 R。
 * 父线上触发处所在的分量“不可确定”、或 `back` 的词不在模糊词表里时，R 不加约束，给一条 `fork-time-mismatch`（原因写明）。
 */

import {gapRange, type GapSpec, type NetworkConstraint, type TimeNetwork} from "@notnotype/nb-time";

import {compiledOf, type TimeSettings} from "./network";

/** R 在网络里的节点名：不会与变更 id 撞（id 没有 `~`）。 */
export const ROLLBACK_POINT = "~R";

/** 一条回溯线接上父线的时间所要的东西。 */
export interface RollbackSpec {
    readonly fork: string;
    readonly cut: string;
    readonly trigger: string;
    readonly back: GapSpec;
    /** 父线（同一模式）的网络。 */
    readonly parent: TimeNetwork;
}

export type RollbackMismatch = "parent-undetermined" | "word-missing";

/** R 的约束；R 不能约束时给原因。`own` 是子线自己的事件（安放在这条线上、在网络里的）。 */
export function rollbackConstraints(spec: RollbackSpec, settings: TimeSettings, own: readonly string[]): {readonly constraints: readonly NetworkConstraint[]; readonly mismatch: RollbackMismatch | null} {
    const back = gapRange(compiledOf(settings.calendar), settings.fuzzy, spec.back);
    if ("invalid" in back) return {constraints: [], mismatch: "word-missing"};
    // 键里带切口：改前面的约束时，待处理的 `statements` 仍指到子线视图里看得到的那件事。
    const ref = (suffix: string) => `${spec.cut}|fork ${spec.fork} ${suffix}`;
    const constraints: NetworkConstraint[] = [];
    const between = spec.parent.between(spec.cut, spec.trigger);
    const trigger = spec.parent.bounds(spec.trigger);
    if (between.state === "conflict" || trigger.state === "conflict") return {constraints: [], mismatch: "parent-undetermined"};
    const node = {kind: "event" as const, id: ROLLBACK_POINT, edge: "start" as const};
    if (between.state === "ok") constraints.push({from: {kind: "event", id: spec.cut, edge: "start"}, to: node, lo: between.lo - back.hi, hi: between.hi - back.lo, ref: ref("back")});
    if (trigger.state === "ok" && trigger.anchored) constraints.push({from: {kind: "origin"}, to: node, lo: trigger.lo - back.hi, hi: trigger.hi - back.lo, ref: ref("anchor")});
    if (constraints.length === 0) return {constraints, mismatch: null};
    for (const id of own) constraints.push({from: node, to: {kind: "event", id, edge: "start"}, lo: 0, hi: Number.POSITIVE_INFINITY, ref: ref(`before ${id}`)});
    return {constraints, mismatch: null};
}
