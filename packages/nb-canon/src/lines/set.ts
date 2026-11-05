/**
 * 线集（docs/specs/canon/worldlines.md）：一份世界上各条世界线的线视图，每条是这条线看到的记录与按这些记录算的引擎。
 *
 * 世界只经线集持有引擎：读取按读取位置的线取线视图，写入按记录所在的线校验。主线随每次推进增量更新；子线第一次读到时从头建
 * （父线先建），结果存在这一份线集的备忘里，推进到新数据时丢掉、再读时重建。按值比对的增量更新、常驻与淘汰在后续切片加进来
 * （w00039 t34 plan.md 阶段 D 的 D4）。
 *
 * 结果不可变、备忘可变：推进得到一份新的线集，旧的线集与它的引擎照旧可读（发布进行中的读取看到之前的完整版本，canon.project
 * 输出 5）；同一份线集上同一条线只建一次。
 */

import {placementRank} from "../core/position";
import type {Patch, StoryChange} from "../core/schema";
import {createIncrementalEngine, type ChangedRefs, type IncrementalEngine} from "../engine/incremental";
import type {EngineInputs, WorldData} from "../engine/types";
import {carryPatch} from "../model/apply";
import {compareOrder, lineOf, lineTable, MAIN_LINE, type OrderPoint} from "./table";

export {MAIN_LINE};

/**
 * 合成事件（带过去的值）的写入版本：比任何真实的版本都大，排在切口的安放键上所有继承来的记录之后（DS 2）。远小于 2^53，比较
 * 不丢精度。
 */
export const CARRY_VERSION = 2 ** 40;

export interface LineView {
    readonly line: string;
    /** 这条线视图里作者的记录（`WorldData` 形状；条目、决策、建议与世界共用）；不含合成事件。 */
    readonly records: WorldData;
    readonly engine: IncrementalEngine;
    /** 引擎输入里合成事件的 id（本线与看得到的祖先线的分叉 id）。 */
    readonly synthetic: ReadonlySet<string>;
}

export class LineSet {
    readonly #children = new Map<string, LineView | null>();

    private constructor(
        private readonly inputs: EngineInputs,
        readonly main: LineView,
    ) {}

    /** 从头建（重放、打开）。 */
    static build(inputs: EngineInputs): LineSet {
        const records = mainRecords(inputs.world);
        return new LineSet(inputs, {line: MAIN_LINE, records, engine: createIncrementalEngine({...inputs, world: records}), synthetic: new Set()});
    }

    /** 推进到新的输入。`changed` 是这次改到的对象；章序或登记变了时给 `{structural: true}`。 */
    advance(inputs: EngineInputs, changed: ChangedRefs): LineSet {
        const records = mainRecords(inputs.world);
        return new LineSet(inputs, {line: MAIN_LINE, records, engine: this.main.engine.update({...inputs, world: records}, changed), synthetic: new Set()});
    }

    /** 一条线的线视图：主线总在；子线存在且可建时第一次读到才建；不存在或不可建时为 undefined。 */
    get(line: string): LineView | undefined {
        if (line === MAIN_LINE) return this.main;
        if (this.#children.has(line)) return this.#children.get(line) ?? undefined;
        const built = this.#build(line);
        this.#children.set(line, built ?? null);
        return built;
    }

    #build(line: string): LineView | undefined {
        const {world, order} = this.inputs;
        const table = lineTable(world, order);
        const entry = table.lines.get(line);
        if (entry === undefined || entry.unbuildable !== null) return undefined;
        const parent = this.get(entry.parent);
        if (parent === undefined) return undefined;
        const {fork} = entry.fork;
        const cut = table.point(fork.cut)!;
        const changes = new Map([...world.changes].filter(([id]) => table.visible(line, id)));
        const checks = new Map([...world.checks].filter(([id]) => table.visible(line, id)));
        const records: WorldData = {...world, changes, checks};

        // 引擎输入：作者的记录，加父线引擎输入里全序不晚于切口的合成事件，再加本线的（输出 2、6）。
        const parentInput = parent.engine.inputs.world;
        const inputChanges = new Map(changes);
        const createdAt = new Map(world.createdAt);
        const synthetic = new Set<string>();
        for (const id of parent.synthetic) {
            const inherited = parentInput.changes.get(id)!;
            const rank = placementRank(order, inherited.at);
            const point: OrderPoint | null = rank === null ? null : {rank, version: CARRY_VERSION, id};
            if (point === null || compareOrder(point, cut) > 0) continue;
            inputChanges.set(id, inherited);
            createdAt.set(id, CARRY_VERSION);
            synthetic.add(id);
        }
        // 本线的：每个地址一个 carry 补丁，值取父线在触发处（没有时切口）那条变更套完之后；切口处不存在的地址跳过。
        const from = fork.trigger ?? fork.cut;
        const patches: Patch[] = [];
        for (const address of fork.carry ?? []) {
            const slot = parent.engine.slotAfter(from, address);
            if (slot !== null) patches.push(carryPatch(address, slot));
        }
        const {line: _line, ...at} = world.changes.get(fork.cut)!.at as StoryChange["at"] & {line?: string};
        const carried: StoryChange = {id: entry.fork.id, kind: "written", text: `从 ${entry.parent} 带过来`, at, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "system"}};
        inputChanges.set(carried.id, carried);
        createdAt.set(carried.id, CARRY_VERSION);
        synthetic.add(carried.id);
        const engine = createIncrementalEngine({...this.inputs, world: {...records, changes: inputChanges, createdAt}});
        return {line, records, engine, synthetic};
    }
}

/** 主线视图里的记录：安放在主线上的变更与核对点。没有一条记录带线时就是世界的数据本身（只有主线的作品不多一份表）。 */
function mainRecords(data: WorldData): WorldData {
    const onMain = (placement: {readonly line?: string}) => lineOf(placement as Parameters<typeof lineOf>[0]) === MAIN_LINE;
    let elsewhere = false;
    for (const change of data.changes.values()) if (!onMain(change.at)) elsewhere = true;
    for (const check of data.checks.values()) if (!onMain(check.place)) elsewhere = true;
    if (!elsewhere) return data;
    return {...data, changes: new Map([...data.changes].filter(([, change]) => onMain(change.at))), checks: new Map([...data.checks].filter(([, check]) => onMain(check.place)))};
}
