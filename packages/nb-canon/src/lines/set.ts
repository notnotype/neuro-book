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

/** 主线的 id（worldlines 术语：根线，总是存在）。 */
export const MAIN_LINE = "main";

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
        return new LineSet({line: MAIN_LINE, records: inputs.world, engine: createIncrementalEngine(inputs)});
    }

    /** 推进到新的输入。`changed` 是这次改到的对象；章序或登记变了时给 `{structural: true}`。 */
    advance(inputs: EngineInputs, changed: ChangedRefs): LineSet {
        return new LineSet({line: MAIN_LINE, records: inputs.world, engine: this.main.engine.update(inputs, changed)});
    }

    /** 一条线的线视图；线不存在时为 undefined。 */
    get(line: string): LineView | undefined {
        return line === MAIN_LINE ? this.main : undefined;
    }
}
