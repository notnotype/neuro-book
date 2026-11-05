/**
 * 差分测试（canon.model 输出 3、5、7–9、11–14、16、22；t29 计划“最重要的测试是差分”）：随机生成一串修改，
 * 每一步都比较“从上一版增量更新得到的引擎”与“从头建的参照实现”对全部问题的回答。
 *
 * 生成器刻意让变更常常套不上（数取小范围、存款有下限 0、会删条目、会挪章），否则大部分序列一路都能套上，
 * 走不到结果翻转与传染的路径；结尾断言整组里套不上的变更至少占 10%。种子固定，失败时打印种子、步数与操作。
 */

import {describe, expect, test} from "bun:test";

import {allPositions, buildRegistry, ChapterOrder, type Check, type ComponentDeclaration, type Entry, type Patch, type Placement, type ReadPosition, type StoryChange} from "../src/index";
import {createIncrementalEngine, type ChangedRefs, type IncrementalEngine} from "../src/engine/incremental";
import {createReferenceEngine} from "../src/engine/reference";
import type {Engine, EngineInputs, WorldData} from "../src/engine/types";
import {PANEL, PERSON} from "./fixtures/world";

const KNOWING: ComponentDeclaration = {id: "test.knowing", label: "认得", namespace: "know", version: 1, fields: [{id: "认得", label: "认得", kind: "list", keyedBy: "ref", item: [{id: "看法", label: "看法", kind: "text", precision: "semantic"}]}]};

function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class Sim {
    readonly entries = new Map<string, Entry>();
    readonly changes = new Map<string, StoryChange>();
    readonly checks = new Map<string, Check>();
    readonly createdAt = new Map<string, number>();
    chapters = ["ch1", "ch2", "ch3", "ch4", "ch5"];
    personVersion = 1;
    version = 0;
    #next = 0;
    readonly log: string[] = [];

    constructor(readonly rnd: () => number) {
        for (const id of ["e1", "e2", "e3", "e4"]) {
            this.entries.set(id, {
                id,
                type: "人物",
                parent: null,
                folder: "",
                order: 0,
                init: {
                    name: id,
                    aliases: [],
                    summary: "",
                    text: [],
                    data: {
                        panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: this.int(0, 4), 魔力上限: 5, 魔力: 2, 物品: []}},
                        character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: "银白", 状态: "在家", 态度: "冷淡"}},
                        know: {type: KNOWING.id, version: 1, enabled: true, fields: {认得: []}},
                    },
                },
            });
            this.createdAt.set(id, ++this.version);
        }
    }

    int(low: number, high: number): number {
        return low + Math.floor(this.rnd() * (high - low + 1));
    }

    pick<T>(items: readonly T[]): T {
        return items[Math.floor(this.rnd() * items.length)]!;
    }

    id(prefix: string): string {
        return `${prefix}${String(++this.#next)}`;
    }

    entryIds(): string[] {
        return [...this.entries.keys()];
    }

    placement(): Placement {
        const roll = this.rnd();
        if (roll < 0.1) return {kind: "prehistory", order: this.int(0, 3)};
        return {kind: "chapter", chapter: this.pick(this.chapters.length > 0 ? this.chapters : ["ch1"]), key: this.int(0, 4) * 10};
    }

    patch(): Patch {
        const entry = this.pick(this.entryIds());
        // 以引用为键的列表与改名：元素名读取时取被引用条目在同一位置的名字，两个引擎各自取（canon.components 输出 19）。
        const keyed = this.rnd();
        if (keyed < 0.12) {
            const other = this.pick(this.entryIds());
            if (keyed < 0.04) return {op: "listAdd", at: {entry, path: "know.认得"}, value: {id: other, 看法: "陌生"}};
            if (keyed < 0.06) return {op: "listRemove", at: {entry, path: "know.认得"}, value: other};
            if (keyed < 0.09) return {op: "note", at: {entry, path: `know.认得[${other}].看法`}, value: this.pick(["熟了点", "起疑", "信任"])};
            if (keyed < 0.1) return {op: "set", at: {entry, path: `know.认得[${other}].看法`}, value: "重新认识"};
            return {op: "set", at: {entry: other, path: "entry.name"}, value: this.pick(["甲", "乙", "丙"])};
        }
        const roll = this.rnd();
        if (roll < 0.45) return {op: "add", at: {entry, path: "panel.存款"}, value: this.int(-3, 3) || 1, ...(this.rnd() < 0.2 ? {basis: {kind: "estimate", note: "估"}} : {})};
        if (roll < 0.55) return {op: "set", at: {entry, path: "panel.存款"}, value: this.int(0, 4)};
        if (roll < 0.62) return {op: "add", at: {entry, path: "panel.魔力"}, value: this.int(-2, 3) || 1};
        if (roll < 0.7) return {op: "set", at: {entry, path: "character.状态"}, value: this.pick(["出门", "在家", "受伤"])};
        if (roll < 0.8) return {op: "note", at: {entry, path: "character.态度"}, value: this.pick(["软了一点", "又冷了", "叫了哥"])};
        if (roll < 0.86) return {op: "set", at: {entry, path: "panel.启用"}, value: this.rnd() < 0.6};
        if (roll < 0.93) return {op: "listAdd", at: {entry, path: "panel.物品"}, value: {id: this.pick(["i1", "i2"]), label: "药", 数量: 1}};
        return {op: "listRemove", at: {entry, path: "panel.物品"}, value: this.pick(["i1", "i2"])};
    }

    plans(): StoryChange[] {
        return [...this.changes.values()].filter((change) => change.kind === "plan");
    }

    written(): StoryChange[] {
        return [...this.changes.values()].filter((change) => change.kind === "written");
    }

    /** 做一步随机修改，返回改到了什么。 */
    step(): ChangedRefs {
        const roll = this.rnd();
        if (roll < 0.08) {
            const entry = this.entries.get(this.pick(this.entryIds()))!;
            const next = structuredClone(entry);
            next.init.data.panel!.fields.存款 = this.rnd() < 0.15 ? null : this.int(0, 4);
            this.entries.set(entry.id, next);
            this.log.push(`改初值 ${entry.id}`);
            return {entries: [entry.id]};
        }
        if (roll < 0.38) {
            const id = this.id("c");
            // 一成的已写变更没有补丁（只讲到、只记参与者）：它们总是套上，照样能兑现计划。
            const patches = this.rnd() < 0.1 ? [] : Array.from({length: this.int(1, 2)}, () => this.patch());
            const plans = this.plans();
            const links = plans.length > 0 && this.rnd() < 0.3 ? [{kind: "fulfills" as const, plan: this.pick(plans).id}] : [];
            // 一半的变更记了参与者：本章涉及的条目要把他们算进去。
            const cast = this.rnd() < 0.5 ? {cast: [{who: this.pick(this.entryIds()), role: "present" as const}]} : {};
            this.changes.set(id, {id, kind: "written", text: id, at: this.placement(), told: [], involves: [], lines: [], links, patches, status: "active", by: {kind: "author"}, ...cast});
            this.createdAt.set(id, ++this.version);
            this.log.push(`记变更 ${id}`);
            return {changes: [id]};
        }
        if (roll < 0.5) {
            const id = this.id("c");
            const patches = Array.from({length: this.int(1, 2)}, () => this.patch());
            const links: StoryChange["links"] = [];
            const plans = this.plans();
            const fulfilling = this.written().filter((change) => change.links.some((link) => link.kind === "fulfills"));
            if (fulfilling.length > 0 && this.rnd() < 0.3) {
                const by = this.pick(fulfilling);
                const plan = by.links.find((link) => link.kind === "fulfills")!.plan;
                links.push({kind: "splitFrom", plan, by: by.id});
            } else if (plans.length > 0 && this.rnd() < 0.2) links.push({kind: "replaces", plan: this.pick(plans).id});
            this.changes.set(id, {id, kind: "plan", text: id, at: this.rnd() < 0.1 ? {kind: "unscheduled"} : this.placement(), told: [], involves: [], lines: [], links, patches, status: "active", by: {kind: "author"}});
            this.createdAt.set(id, ++this.version);
            this.log.push(`记计划 ${id}`);
            return {changes: [id]};
        }
        if (roll < 0.62 && this.changes.size > 0) {
            const change = this.changes.get(this.pick([...this.changes.keys()]))!;
            const status = this.pick(["active", "held", "undone"] as const);
            this.changes.set(change.id, {...change, status, ...(status === "held" ? {held: {reason: "unsure" as const, note: "?"}} : {})});
            this.log.push(`改状态 ${change.id} → ${status}`);
            return {changes: [change.id]};
        }
        if (roll < 0.7 && this.changes.size > 0) {
            const change = this.changes.get(this.pick([...this.changes.keys()]))!;
            this.changes.set(change.id, {...change, at: this.placement()});
            this.log.push(`挪 ${change.id}`);
            return {changes: [change.id]};
        }
        if (roll < 0.75) {
            const entry = this.entries.get(this.pick(this.entryIds()))!;
            const next = {...entry, ...(entry.deleted === true ? {deleted: false} : {deleted: true})};
            this.entries.set(entry.id, next);
            this.log.push(`${next.deleted ? "删" : "恢复"} ${entry.id}`);
            return {entries: [entry.id]};
        }
        if (roll < 0.79) {
            const entry = this.entries.get(this.pick(this.entryIds()))!;
            const next: Entry = {...entry};
            if (this.rnd() < 0.5) delete (next as {appears?: Placement}).appears;
            else next.appears = this.placement();
            this.entries.set(entry.id, next);
            this.log.push(`出场 ${entry.id}`);
            return {entries: [entry.id]};
        }
        if (roll < 0.9) {
            const id = this.id("k");
            const entry = this.pick(this.entryIds());
            const semantic = this.rnd() < 0.25;
            const anchorable = this.written();
            const anchor = !semantic && anchorable.length > 0 && this.rnd() < 0.4 ? {change: this.pick(anchorable).id, side: this.pick(["before", "after"] as const)} : undefined;
            this.checks.set(id, {id, at: {entry, path: semantic ? "character.态度" : "panel.存款"}, value: this.int(0, 5), told: {id: `t${id}`, source: "chapter", quote: "x"}, place: this.placement(), ...(anchor === undefined ? {} : {anchor})});
            this.createdAt.set(id, ++this.version);
            this.log.push(`核对点 ${id}`);
            return {checks: [id]};
        }
        if (roll < 0.95) {
            const all = ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6"];
            const kept = all.filter(() => this.rnd() < 0.85);
            this.chapters = kept.sort(() => this.rnd() - 0.5);
            this.log.push(`章序 ${this.chapters.join(",")}`);
            return {structural: true};
        }
        this.personVersion = this.personVersion === 1 ? 2 : 1;
        this.log.push(`人物类型版本 ${String(this.personVersion)}`);
        return {structural: true};
    }

    inputs(): EngineInputs {
        const world: WorldData = {
            version: this.version,
            entries: new Map(this.entries),
            changes: new Map(this.changes),
            checks: new Map(this.checks),
            decisions: new Map(),
            suggestions: new Map(),
            createdAt: new Map(this.createdAt),
        };
        const declarations: ComponentDeclaration[] = [PANEL, {...PERSON, version: this.personVersion}, KNOWING];
        return {world, order: new ChapterOrder(this.chapters), registry: buildRegistry(declarations), reductions: (input) => (input.events.length === 2 ? `归纳：${input.anchor ?? "未知"}` : undefined)};
    }
}

function compareAll(inc: Engine, ref: Engine, inputs: EngineInputs, where: () => string): void {
    const positions: ReadPosition[] = [...allPositions(inputs.order), {kind: "chapter", chapter: "missing", edge: "start"}];
    for (const id of inputs.world.entries.keys()) {
        for (const position of positions) {
            for (const mode of ["actual", "planned"] as const) {
                expect(inc.entry(id, position, mode), `${where()} entry ${id} ${JSON.stringify(position)} ${mode}`).toEqual(ref.entry(id, position, mode));
            }
        }
        for (const path of ["panel.存款", "character.态度"]) {
            for (const position of positions.filter((_, index) => index % 3 === 0)) {
                expect(inc.origins({entry: id, path}, position, "actual"), `${where()} origins ${id} ${path}`).toEqual(ref.origins({entry: id, path}, position, "actual"));
            }
        }
    }
    for (const position of positions) for (const mode of ["actual", "planned"] as const) expect(inc.pending(position, mode), `${where()} pending ${JSON.stringify(position)} ${mode}`).toEqual(ref.pending(position, mode));
    for (const change of inputs.world.changes.values()) {
        expect(inc.outcome(change.id), `${where()} outcome ${change.id}`).toEqual(ref.outcome(change.id));
        if (change.kind === "plan") for (const position of positions) expect(inc.progress(change.id, position), `${where()} progress ${change.id}`).toEqual(ref.progress(change.id, position));
    }
    for (const position of positions) expect(inc.plannedAt(position), `${where()} plannedAt ${JSON.stringify(position)}`).toEqual(ref.plannedAt(position));
    for (const chapter of inputs.order.ids) expect(inc.chapterEntries(chapter)).toEqual(ref.chapterEntries(chapter));
}

describe("差分：增量更新与整本重算逐字相同", () => {
    const failures = {applied: 0, failed: 0};
    // 平时跑 6 个种子、每个 60 步；改引擎后可以用环境变量跑得更多（例如 CANON_DIFF_SEEDS=20 CANON_DIFF_STEPS=100）。
    const seeds = Array.from({length: Number(process.env.CANON_DIFF_SEEDS ?? 6)}, (_, index) => index + 1);
    const steps = Number(process.env.CANON_DIFF_STEPS ?? 60);
    test.each(seeds)(`种子 %d，${String(steps)} 步`, (seed) => {
        const sim = new Sim(random(seed));
        let incremental: IncrementalEngine = createIncrementalEngine(sim.inputs());
        for (let step = 1; step <= steps; step += 1) {
            const changed = sim.step();
            const inputs = sim.inputs();
            incremental = incremental.update(inputs, changed);
            const reference = createReferenceEngine(inputs);
            compareAll(incremental, reference, inputs, () => `种子 ${String(seed)} 第 ${String(step)} 步（${sim.log.join("；")}）`);
            for (const change of inputs.world.changes.values()) {
                const outcome = reference.outcome(change.id);
                if (outcome === undefined) continue;
                if (outcome.applied) failures.applied += 1;
                else failures.failed += 1;
            }
        }
    });

    test("序列里套不上的变更足够多（至少 10%），翻转与传染的路径走到了", () => {
        expect(failures.failed / (failures.applied + failures.failed)).toBeGreaterThanOrEqual(0.1);
    });
});
