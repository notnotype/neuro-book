/**
 * 线集（docs/specs/canon/worldlines.md）：一份世界上各条世界线的线视图，每条是这条线看到的记录与按这些记录算的引擎。
 *
 * 世界只经线集持有引擎：读取按读取位置的线取线视图，写入按记录所在的线校验。现在只有主线，主线的记录就是世界的数据本身；子线、
 * 按值比对的增量更新、常驻与淘汰随世界线的后续切片加进来（w00039 t34 plan.md 阶段 D）。
 *
 * 结果不可变：推进得到一份新的线集，旧的线集与它的引擎照旧可读（发布进行中的读取看到之前的完整版本，canon.project 输出 5）。
 */

import {createIncrementalEngine, type ChangedRefs, type IncrementalEngine} from "../engine/incremental";
import type {EngineInputs, WorldData} from "../engine/types";
import {lineOf, MAIN_LINE} from "./table";

export {MAIN_LINE};

export interface LineView {
    readonly line: string;
    /** 这条线视图里的记录（`WorldData` 形状；条目、决策、建议与世界共用）。 */
    readonly records: WorldData;
    readonly engine: IncrementalEngine;
}

export class LineSet {
    private constructor(readonly main: LineView) {}

    /** 从头建（重放、打开）。 */
    static build(inputs: EngineInputs): LineSet {
        const records = mainRecords(inputs.world);
        return new LineSet({line: MAIN_LINE, records, engine: createIncrementalEngine({...inputs, world: records})});
    }

    /** 推进到新的输入。`changed` 是这次改到的对象；章序或登记变了时给 `{structural: true}`。 */
    advance(inputs: EngineInputs, changed: ChangedRefs): LineSet {
        const records = mainRecords(inputs.world);
        return new LineSet({line: MAIN_LINE, records, engine: this.main.engine.update({...inputs, world: records}, changed)});
    }

    /** 一条线的线视图；线不存在时为 undefined。 */
    get(line: string): LineView | undefined {
        return line === MAIN_LINE ? this.main : undefined;
    }
}

/**
 * 主线视图里的记录：安放在主线上的变更与核对点。没有一条记录带线时就是世界的数据本身（只有主线的作品不多一份表）；子线的线视图
 * 随后续切片加进来。
 */
function mainRecords(data: WorldData): WorldData {
    const onMain = (placement: {readonly line?: string}) => lineOf(placement as Parameters<typeof lineOf>[0]) === MAIN_LINE;
    let elsewhere = false;
    for (const change of data.changes.values()) if (!onMain(change.at)) elsewhere = true;
    for (const check of data.checks.values()) if (!onMain(check.place)) elsewhere = true;
    if (!elsewhere) return data;
    return {...data, changes: new Map([...data.changes].filter(([, change]) => onMain(change.at))), checks: new Map([...data.checks].filter(([, check]) => onMain(check.place)))};
}
