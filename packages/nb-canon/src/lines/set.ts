/**
 * 线集（docs/specs/canon/worldlines.md）：一份世界上各条世界线的线视图，每条是这条线看到的记录与按这些记录算的引擎。
 *
 * 世界只经线集持有引擎：读取按读取位置的线取线视图，写入按记录所在的线校验。主线随每次推进增量更新；子线第一次读到时从头建
 * （父线先建），建好的随推进增量更新：改到的记录进这条线的视图、带过去的值变了、条目变了，才对这条线的引擎 `update`，都没有就
 * 沿用旧的；分叉的定义、章序或登记变了就丢掉，再读时从头建（输出 8）。常驻与淘汰照输出 9。
 *
 * 结果不可变、备忘可变：推进得到一份新的线集，旧的线集与它的引擎照旧可读（发布进行中的读取看到之前的完整版本，canon.project
 * 输出 5）；同一份线集上同一条线只建一次。“最近使用”是跨版本共用的小对象，只决定留谁，不影响结果。
 */

import {placementRank} from "../core/position";
import type {Patch, StoryChange} from "../core/schema";
import {createIncrementalEngine, type ChangedRefs, type IncrementalEngine} from "../engine/incremental";
import type {EngineInputs, WorldData} from "../engine/types";
import {carryPatch} from "../model/apply";
import {sameJson} from "../core/stable-json";
import {definitionKey} from "./affected";
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

/** 常驻的名额：祖先线不占（输出 9）。 */
export const DEFAULT_RESIDENT_LINES = 3;

/** 一条线这次推进里为什么更新（project.md 输出 26）：全部适用的原因。 */
export type UpdateReason = "records" | "carry" | "entries" | "structural" | "built";
export interface LineUpdate {
    readonly line: string;
    readonly reasons: readonly UpdateReason[];
}

/** 各版本线集共用的“最近使用”与当前线：只决定淘汰谁，不影响任何读取结果。 */
interface LineUse {
    tick: number;
    readonly used: Map<string, number>;
    current: string;
    readonly limit: number;
}

export class LineSet {
    readonly #children: Map<string, LineView | null>;
    /** 这份线集上当场建的线（发布时为算 `brokenOn` 建的，输出 17）。 */
    readonly #onTheSpot = new Set<string>();

    private constructor(
        private readonly inputs: EngineInputs,
        readonly main: LineView,
        private readonly use: LineUse,
        children: ReadonlyMap<string, LineView | null> = new Map(),
        private readonly updated: readonly LineUpdate[] = [],
    ) {
        this.#children = new Map(children);
    }

    /** 从头建（重放、打开）。 */
    static build(inputs: EngineInputs, residentLines = DEFAULT_RESIDENT_LINES): LineSet {
        const records = mainRecords(inputs.world);
        return new LineSet(inputs, {line: MAIN_LINE, records, engine: createIncrementalEngine({...inputs, world: records}), synthetic: new Set()}, {tick: 0, used: new Map(), current: MAIN_LINE, limit: residentLines});
    }

    /**
     * 推进到新的输入。`changed` 是这次改到的对象；章序或登记变了时给 `{structural: true}`。已建的子线按父到子的顺序处理：
     * 定义变了或有结构性变化的丢掉，其余只在改到的记录进了它的视图、带过去的值变了或条目变了时更新，不然沿用旧的。
     */
    advance(inputs: EngineInputs, changed: ChangedRefs): LineSet {
        const records = this.#mainRecordsFor(inputs.world, changed);
        const main: LineView = {line: MAIN_LINE, records, engine: this.main.engine.update({...inputs, world: records}, changed), synthetic: new Set()};
        const structural = changed.structural === true || inputs.registry.digest !== this.inputs.registry.digest || !sameOrder(inputs.order.ids, this.inputs.order.ids);
        const next = new LineSet(inputs, main, this.use);
        if (structural) {
            const dropped = [...this.#children].filter(([, view]) => view !== null).map(([line]) => ({line, reasons: ["structural"] as const}));
            return new LineSet(inputs, main, this.use, new Map(), dropped);
        }
        const [oldTable, table] = [lineTable(this.inputs.world, this.inputs.order), lineTable(inputs.world, inputs.order)];
        const updates: LineUpdate[] = [];
        // 父线先于子线：按祖先线的个数排。
        const built = [...this.#children].filter((entry): entry is [string, LineView] => entry[1] !== null).sort((a, b) => oldTable.ancestors(a[0]).length - oldTable.ancestors(b[0]).length);
        for (const [line, previous] of built) {
            const entry = table.lines.get(line);
            const parent = entry === undefined || entry.unbuildable !== null ? undefined : next.#children.get(entry.parent) ?? (entry.parent === MAIN_LINE ? main : undefined);
            if (entry === undefined || parent === undefined || parent === null) {
                updates.push({line, reasons: ["structural"]});
                continue;
            }
            if (!sameJson(definitionKey(oldTable, line), definitionKey(table, line))) {
                updates.push({line, reasons: ["structural"]});
                continue;
            }
            const result = next.#advanceLine(line, previous, parent, table, changed);
            next.#children.set(line, result.view);
            if (result.reasons.length > 0) updates.push({line, reasons: result.reasons});
        }
        return new LineSet(inputs, main, this.use, next.#children, updates);
    }

    /**
     * 新数据上主线视图的记录。上一份已经是滤过的（世界上有别的线的记录）时，只按这次改到的记录增减，不重扫全部；上一份就是世界
     * 的数据本身（没有别的线）时重算，因为这次可能是第一条别的线的记录。
     */
    #mainRecordsFor(data: WorldData, changed: ChangedRefs): WorldData {
        if (data === this.inputs.world) return this.main.records;
        if (this.main.records === this.inputs.world) return mainRecords(data);
        const previous = this.main.records;
        let changes = previous.changes;
        let checks = previous.checks;
        for (const id of changed.changes ?? []) {
            const now = data.changes.get(id);
            const keep = now !== undefined && lineOf(now.at) === MAIN_LINE ? now : undefined;
            if (changes.get(id) === keep) continue;
            if (changes === previous.changes) changes = new Map(changes);
            if (keep === undefined) (changes as Map<string, StoryChange>).delete(id);
            else (changes as Map<string, StoryChange>).set(id, keep);
        }
        for (const id of changed.checks ?? []) {
            const now = data.checks.get(id);
            const keep = now !== undefined && lineOf(now.place) === MAIN_LINE ? now : undefined;
            if (checks.get(id) === keep) continue;
            if (checks === previous.checks) checks = new Map(checks);
            if (keep === undefined) (checks as Map<string, import("../core/schema").Check>).delete(id);
            else (checks as Map<string, import("../core/schema").Check>).set(id, keep);
        }
        return {...data, changes, checks};
    }

    /** 一条建好的线推进到新输入；返回新的视图（没变时就是旧的）与原因。 */
    #advanceLine(line: string, previous: LineView, parent: LineView, table: ReturnType<typeof lineTable>, changed: ChangedRefs): {view: LineView; reasons: UpdateReason[]} {
        const {world} = this.inputs;
        const entry = table.lines.get(line)!;
        const reasons: UpdateReason[] = [];
        // 改到的记录是否进了（或离开了）这条线的视图：只看改到的对象，不重扫全部记录。
        let changes = previous.records.changes;
        let checks = previous.records.checks;
        const changedChanges: string[] = [];
        const changedChecks: string[] = [];
        for (const id of changed.changes ?? []) {
            const was = previous.records.changes.get(id);
            const now = table.visible(line, id) ? world.changes.get(id) : undefined;
            if (was === now) continue;
            if (changes === previous.records.changes) changes = new Map(changes);
            if (now === undefined) (changes as Map<string, StoryChange>).delete(id);
            else (changes as Map<string, StoryChange>).set(id, now);
            changedChanges.push(id);
        }
        for (const id of changed.checks ?? []) {
            const was = previous.records.checks.get(id);
            const now = table.visible(line, id) ? world.checks.get(id) : undefined;
            if (was === now) continue;
            if (checks === previous.records.checks) checks = new Map(checks);
            if (now === undefined) (checks as Map<string, import("../core/schema").Check>).delete(id);
            else (checks as Map<string, import("../core/schema").Check>).set(id, now);
            changedChecks.push(id);
        }
        const records: WorldData = {...world, changes, checks};
        const before = previous.engine.inputs.world;
        // 合成事件里换了的：带过去的值变了，或继承来的祖线合成事件换了。先只算合成事件（几条），都没变时不复制整张表。
        const synthetic = this.#syntheticEvents(entry, parent, before.changes.get(entry.fork.id));
        const inputChanges: string[] = [];
        for (const id of new Set([...previous.synthetic, ...synthetic.keys()])) {
            if (before.changes.get(id) !== synthetic.get(id)) inputChanges.push(id);
        }
        if (changedChanges.length > 0 || changedChecks.length > 0) reasons.push("records");
        if (inputChanges.length > 0) reasons.push("carry");
        const entries = [...(changed.entries ?? [])];
        if (entries.length > 0) reasons.push("entries");
        if (reasons.length === 0) return {view: previous, reasons};
        // 只有条目变了：记录与合成事件都沿用，引擎输入的表不用重新复制。
        const input: WorldData = reasons.length === 1 && reasons[0] === "entries" ? {...records, changes: before.changes, createdAt: before.createdAt} : this.#inputWorld(records, synthetic);
        const engine = previous.engine.update({...this.inputs, world: input}, {entries, changes: [...changedChanges, ...inputChanges], checks: changedChecks});
        return {view: {line, records, engine, synthetic: new Set(synthetic.keys())}, reasons};
    }

    /**
     * 一条线引擎输入里的合成事件（输出 2、6）：父线引擎输入里全序不晚于切口的合成事件，加本线的（每个地址一个 carry 补丁，值取父线在
     * 触发处、没有时切口那条变更套完之后；切口处不存在的地址跳过）。`previous` 是上一次的本线合成事件，带过去的值没变时沿用它
     * （同一个对象，更新时据此知道它没变）。
     */
    #syntheticEvents(entry: NonNullable<ReturnType<ReturnType<typeof lineTable>["lines"]["get"]>>, parent: LineView, previous?: StoryChange): Map<string, StoryChange> {
        const {world, order} = this.inputs;
        const {fork} = entry.fork;
        const cut = lineTable(world, order).point(fork.cut)!;
        const parentInput = parent.engine.inputs.world;
        const found = new Map<string, StoryChange>();
        for (const id of parent.synthetic) {
            const inherited = parentInput.changes.get(id)!;
            const rank = placementRank(order, inherited.at);
            const point: OrderPoint | null = rank === null ? null : {rank, version: CARRY_VERSION, id};
            if (point === null || compareOrder(point, cut) > 0) continue;
            found.set(id, inherited);
        }
        const from = fork.trigger ?? fork.cut;
        const patches: Patch[] = [];
        for (const address of fork.carry ?? []) {
            const slot = parent.engine.slotAfter(from, address);
            if (slot !== null) patches.push(carryPatch(address, slot));
        }
        const {line: _line, ...at} = world.changes.get(fork.cut)!.at as StoryChange["at"] & {line?: string};
        const carried: StoryChange = previous !== undefined && sameJson(previous.patches, patches) && sameJson(previous.at, at) ? previous : {id: entry.fork.id, kind: "written", text: `从 ${entry.parent} 带过来`, at, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "system"}};
        found.set(carried.id, carried);
        return found;
    }

    /** 作者的记录加合成事件，合成事件的写入版本是 `CARRY_VERSION`。 */
    #inputWorld(records: WorldData, synthetic: ReadonlyMap<string, StoryChange>): WorldData {
        const changes = new Map(records.changes);
        const createdAt = new Map(this.inputs.world.createdAt);
        for (const [id, change] of synthetic) {
            changes.set(id, change);
            createdAt.set(id, CARRY_VERSION);
        }
        return {...records, changes, createdAt};
    }

    /** 一条线的线视图：主线总在；子线存在且可建时第一次读到才建；不存在或不可建时为 undefined。读到一次就算用过一次（输出 9）。 */
    get(line: string): LineView | undefined {
        if (line === MAIN_LINE) return this.main;
        this.use.used.set(line, ++this.use.tick);
        if (this.#children.has(line)) return this.#children.get(line) ?? undefined;
        const built = this.#build(line);
        this.#children.set(line, built ?? null);
        if (built !== undefined) this.#evict(line);
        return built;
    }

    /** 同 `get`，但要建的话记成“当场建”（发布为算 `brokenOn` 而建，project.md 输出 26 的 `built`）。 */
    ensure(line: string): LineView | undefined {
        const wasBuilt = line === MAIN_LINE || this.#children.get(line) != null;
        const view = this.get(line);
        if (!wasBuilt && view !== undefined) this.#onTheSpot.add(line);
        return view;
    }

    /** 当前线（活页夹最新一章的最后一段讲的线）与它的祖先线常驻；换了当前线以后再按名额淘汰（输出 9）。 */
    setCurrent(line: string): void {
        this.use.current = line;
        this.#evict(null);
    }

    /** 最近一次推进更新了哪些线、各自为什么，加上当场建的（project.md 输出 26）。 */
    get updates(): readonly LineUpdate[] {
        return [...this.updated, ...[...this.#onTheSpot].map((line) => ({line, reasons: ["built"] as const}))];
    }

    /** 各条已建的线的状态：是否常驻（当前线与它的祖先线）。 */
    get builtLines(): readonly {readonly line: string; readonly resident: boolean}[] {
        const resident = this.#resident();
        return [...this.#children].filter(([, view]) => view !== null).map(([line]) => ({line, resident: resident.has(line)})).sort((a, b) => (a.line < b.line ? -1 : 1));
    }

    #resident(): Set<string> {
        const table = lineTable(this.inputs.world, this.inputs.order);
        return new Set([this.use.current, ...table.ancestors(this.use.current)]);
    }

    /**
     * 超过名额时淘汰最近使用最早的线连同它已建的后代（输出 9）。一条线的最近使用按它与已建的后代里最近的一次算，所以淘汰
     * 不会留下祖先线没建的线。`keep` 是刚读到的线，名额为 0 时也让这次的调用拿到它，只是不留在备忘里。
     */
    #evict(keep: string | null): void {
        const table = lineTable(this.inputs.world, this.inputs.order);
        const resident = this.#resident();
        for (;;) {
            const candidates = [...this.#children].filter(([line, view]) => view !== null && !resident.has(line)).map(([line]) => line);
            if (candidates.length <= this.use.limit) return;
            const recency = (line: string) => Math.max(this.use.used.get(line) ?? 0, ...candidates.filter((other) => table.ancestors(other).includes(line)).map((other) => this.use.used.get(other) ?? 0));
            const victim = candidates.filter((line) => line !== keep || this.use.limit === 0).sort((a, b) => recency(a) - recency(b) || (a < b ? -1 : 1))[0];
            if (victim === undefined) return;
            for (const line of candidates) if (line === victim || table.ancestors(line).includes(victim)) this.#children.delete(line);
        }
    }

    #build(line: string): LineView | undefined {
        const {world, order} = this.inputs;
        const table = lineTable(world, order);
        const entry = table.lines.get(line);
        if (entry === undefined || entry.unbuildable !== null) return undefined;
        const parent = this.get(entry.parent);
        if (parent === undefined) return undefined;
        const changes = new Map([...world.changes].filter(([id]) => table.visible(line, id)));
        const checks = new Map([...world.checks].filter(([id]) => table.visible(line, id)));
        const records: WorldData = {...world, changes, checks};
        const synthetic = this.#syntheticEvents(entry, parent);
        return {line, records, engine: createIncrementalEngine({...this.inputs, world: this.#inputWorld(records, synthetic)}), synthetic: new Set(synthetic.keys())};
    }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
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
