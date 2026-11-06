/**
 * 时间的待处理（docs/specs/canon/time.md 输出 2、3、5、14、17）：网络按整条线算一次（按数据对象、设置与模式缓存），读待处理时
 * 再按读取位置截取；发布时存下的“带来的变化”用不截取的那一份。
 *
 * 项的键按内容（不按说法在列表里的下标），这样在前面插一条说法不会让别的项“消失又出现”：
 * - 打架：环上说法的键（所在变更与说法的规范 JSON）排好序的列表。不按环上的先后：约束在网络里的下标随安放先后变，章序调整
 *   没碰到这个环时键也不能变；
 * - 不成立：所在变更、说法的键与原因；
 * - 对不上：安放得比时间晚的那件事。
 */

import {placementMismatches} from "@notnotype/nb-time";

import {compareIds} from "../core/ids";
import {placementRank, positionRank, rankBefore, type ChapterOrder} from "../core/position";
import type {ReadPosition} from "../core/schema";
import {canonicalJson} from "../core/stable-json";
import {buildNetwork, type BuiltNetwork, type TimeInput, type TimeSettings} from "./network";
import {ROLLBACK_POINT, type RollbackMismatch, type RollbackSpec} from "./rollback";

export type TimePendingItem =
    | {readonly kind: "time-conflict"; readonly statements: readonly string[]; readonly changes: readonly string[]}
    | {readonly kind: "time-invalid"; readonly change: string; readonly statement: string; readonly reason: string; readonly involves?: readonly string[]}
    | {readonly kind: "time-placement-mismatch"; readonly change: string; readonly partner: string; readonly count: number; readonly criterion: "range" | "statement"}
    /** 回溯分叉的时间对不上（输出 6）；`change` 是切口（子线视图里看得到、读取位置截取时按它的安放）。 */
    | {readonly kind: "fork-time-mismatch"; readonly line: string; readonly fork: string; readonly change: string; readonly reason: RollbackMismatch | "cut-after-back"};

export interface TimeState {
    readonly built: BuiltNetwork;
    /** 整条线上的时间待处理（不截取）。 */
    readonly items: readonly TimePendingItem[];
}

const states = new WeakMap<object, WeakMap<TimeSettings, Map<string, TimeState>>>();
const stateIds = new WeakMap<object, number>();
let stateCount = 0;
/** 子线的缓存键带父线状态对象的身份：父线变了（它的状态是新对象）、子线的记录没变时，子线的状态也要重算。 */
const idOfState = (state: object) => {
    let id = stateIds.get(state);
    if (id === undefined) {
        stateCount += 1;
        id = stateCount;
        stateIds.set(state, id);
    }
    return id;
};

/** 子线上的回溯分叉：父线的时间状态（同一模式）与分叉的 `back`、`trigger`。 */
export interface RollbackLine {
    readonly line: string;
    readonly fork: string;
    readonly cut: string;
    readonly trigger: string;
    readonly back: RollbackSpec["back"];
    readonly parent: TimeState;
}

/**
 * 一份数据在一份设置与一个模式上的时间状态。`data` 是缓存的身份：同一版本的世界（含只换了选项的）共用它；`plans` 是按计划模式
 * 加进来的计划，由调用方按全书当前进展算好（同一份数据上它也一样）。
 */
export function timeState(data: object, input: TimeInput, settings: TimeSettings, mode: "actual" | "planned", plans: readonly string[], rollback?: RollbackLine): TimeState {
    let bySettings = states.get(data);
    if (bySettings === undefined) {
        bySettings = new WeakMap();
        states.set(data, bySettings);
    }
    let byMode = bySettings.get(settings);
    if (byMode === undefined) {
        byMode = new Map();
        bySettings.set(settings, byMode);
    }
    // 对不上要看章序：章序调整以后数据没变、章序变了，键里带上章序。按计划模式的事件集还看计划的进展（引擎随登记重建时会变），
    // 键里带上计入的计划。
    const key = `${mode}|${input.order.ids.join("\u0000")}|${plans.join("\u0000")}${rollback === undefined ? "" : `|${rollback.line}|${rollback.fork}|${String(idOfState(rollback.parent))}|${canonicalJson(rollback.back)}`}`;
    let state = byMode.get(key);
    if (state === undefined) {
        const built = buildNetwork(input, settings, mode === "planned" ? plans : [], rollback === undefined ? undefined : {line: rollback.line, spec: {fork: rollback.fork, cut: rollback.cut, trigger: rollback.trigger, back: rollback.back, parent: rollback.parent.built.network}});
        const changeOf = (ref: string) => ref.slice(0, ref.indexOf("|"));
        const items: TimePendingItem[] = [
            // 所涉的事：说法所在的变更，加环经过的事（被 `of` 指到的事也在环上，截取要看它们，输出 14）。
            ...built.network.conflicts.map((conflict): TimePendingItem => ({kind: "time-conflict", statements: [...new Set(conflict.refs)].sort(), changes: [...new Set([...conflict.refs.map(changeOf), ...conflict.events.map((event) => (event === ROLLBACK_POINT && rollback !== undefined ? rollback.cut : event))])].sort(compareIds)})),
            ...built.assembled.invalid.map((invalid): TimePendingItem => ({kind: "time-invalid", change: invalid.event, statement: invalid.ref, reason: invalid.reason, ...(invalid.involves === undefined ? {} : {involves: invalid.involves})})),
            ...placementMismatches(built.network, built.assembled.constraints).map((item): TimePendingItem => ({kind: "time-placement-mismatch", change: item.event, partner: item.partner, count: item.count, criterion: item.criterion})),
        ];
        if (rollback !== undefined) {
            const item = (reason: RollbackMismatch | "cut-after-back"): TimePendingItem => ({kind: "fork-time-mismatch", line: rollback.line, fork: rollback.fork, change: rollback.cut, reason});
            if (built.mismatch !== null) items.push(item(built.mismatch));
            else if (built.network.component(ROLLBACK_POINT) !== undefined) {
                // 切口那件事一定晚于 R：R 到切口起点的差的范围全大于 0。
                const gap = built.network.between(ROLLBACK_POINT, rollback.cut);
                if (gap.state === "ok" && gap.lo > 0) items.push(item("cut-after-back"));
            }
        }
        state = {built, items};
        byMode.set(key, state);
    }
    return state;
}

/** 项涉及的变更。 */
export function timeItemChanges(item: TimePendingItem): readonly string[] {
    return item.kind === "time-conflict" ? item.changes : item.kind === "time-invalid" ? [item.change, ...(item.involves ?? [])] : item.kind === "fork-time-mismatch" ? [item.change] : [item.change, item.partner];
}

/** 项的键（带来的变化里记的那一份）。 */
export function timeItemKey(item: TimePendingItem): string {
    return item.kind === "time-conflict" ? `time-conflict:${canonicalJson(item.statements)}` : item.kind === "time-invalid" ? `time-invalid:${item.statement}|${item.reason}` : item.kind === "fork-time-mismatch" ? `fork-time-mismatch:${item.fork}|${item.reason}` : `time-mismatch:${item.change}`;
}

/** 随读取位置截取（输出 14）：所涉的事都安放在读取位置之前的才列。未排章的计划没有安放，不列。 */
export function truncateTime(items: readonly TimePendingItem[], placementOf: (change: string) => Parameters<typeof placementRank>[1] | undefined, order: ChapterOrder, position: ReadPosition): TimePendingItem[] {
    const limit = positionRank(order, position);
    if (limit === null) return [];
    return items.filter((item) => timeItemChanges(item).every((change) => {
        const at = placementOf(change);
        const rank = at === undefined ? null : placementRank(order, at);
        return rank !== null && rankBefore(rank, limit);
    }));
}
