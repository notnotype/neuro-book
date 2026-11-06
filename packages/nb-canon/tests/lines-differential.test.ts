/**
 * 线层的差分（canon.worldlines 输出 8、9、17）：在 `World` 上经真实的发布路径随机写入（含分叉、子线上的记录、改与挪记录、撤销与
 * 恢复、条目的初值、章序调整、还原），每一步之后：
 * 1. 每条线上的读取结果与从日志重放出的世界逐字相同（增量更新、当场建与淘汰都不改结果）；
 * 2. 存下的 `broken` 与 `brokenOn` 与“改前、改后各自从头算出的结果逐条线比较”的参照相同——这也断言了受影响的线的集合没有漏掉
 *    实际结果变了的线（`brokenOn` 只在受影响的线上算）。
 * 同一串操作在几种淘汰参数下结果与日志都相同。种子固定，失败时打印种子、步数与操作。
 */

import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type ComponentDeclaration, type Entry, type Fork, type Patch, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {compareIds} from "../src/core/ids";
import {lineTable} from "../src/lines/table";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {PANEL, PERSON} from "./fixtures/world";

const ROLLBACK: ComponentDeclaration = {id: "test.rollback", label: "回溯", namespace: "rb", version: 1, fields: [{id: "次数", label: "次数", kind: "number", carry: true}, {id: "别的", label: "别的", kind: "number"}]};
const CHAPTERS = ["ch1", "ch2", "ch3", "ch4"];

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

function options(residentLines: number): WorldOptions {
    return {order: new ChapterOrder(CHAPTERS), registry: buildRegistry([PANEL, PERSON, ROLLBACK]), reductions: () => undefined, chapterText: () => "", digest: (text) => createHash("sha256").update(text).digest("hex"), residentLines};
}

const person = (id: string): Entry => ({id, type: "人物", parent: null, folder: "人物", order: 0, init: {name: "星瑕", aliases: [], summary: "", text: [], data: {panel: {type: "canon.panel", version: 1, enabled: true, fields: {存款: 20000, 魔力上限: null, 魔力: null, 物品: []}}, rb: {type: "test.rollback", version: 1, enabled: true, fields: {次数: 1, 别的: 0}}}}});

interface Stats {
    steps: number;
    accepted: number;
    forks: number;
    childRecords: number;
    brokenOn: number;
    plannedForks: number;
    reasons: Set<string>;
}

/** 一个世界上各条线的读取结果：两种模式、每章开头与末尾、待处理、每条记录套没套上。 */
function snapshot(world: World, lines: readonly string[]): string[] {
    return lines.map((line) => {
        const view = world.line(line);
        if (view === undefined) return "absent";
        const out: unknown[] = [];
        for (const entry of world.data.entries.keys()) {
            for (const chapter of world.options.order.ids) {
                for (const edge of ["start", "end"] as const) {
                    for (const mode of ["actual", "planned"] as const) out.push(view.engine.entry(entry, {kind: "chapter", chapter, edge, line}, mode));
                }
            }
        }
        const last = world.options.order.ids.at(-1)!;
        out.push(view.engine.pending({kind: "chapter", chapter: last, edge: "end", line}));
        // 世界层的待处理（线的三种待处理与根因）与这条线的时间项，两种模式。
        for (const mode of ["actual", "planned"] as const) out.push(world.pending({kind: "chapter", chapter: last, edge: "end", line}, mode), world.time(mode, line).items);
        for (const id of [...view.records.changes.keys()].sort()) out.push([id, view.engine.outcome(id)]);
        return JSON.stringify(out);
    });
}

/** 参照：这次让哪些记录套不上，按改前、改后各自从头重放出的世界逐线逐条比。 */
function brokenReference(before: World, after: World): {broken: string[]; brokenOn: {line: string; change: string}[]} {
    const [old, now] = [World.replay(before.revisions, before.options), World.replay(after.revisions, after.options)];
    const broken: string[] = [];
    for (const change of after.data.changes.values()) {
        if (old.line().engine.outcome(change.id)?.applied === true && now.line().engine.outcome(change.id)?.applied === false) broken.push(change.id);
    }
    const brokenOn: {line: string; change: string}[] = [];
    // 只比改前改后都在实际模式下存在的线：只由计划分叉定义的线没有实际结果（worldlines 输出 17）。
    const [oldTable, newTable] = [lineTable(before.data, before.options.order), lineTable(after.data, after.options.order)];
    for (const line of newTable.lines.keys()) {
        if (oldTable.lines.get(line)?.exists.actual !== true || newTable.lines.get(line)?.exists.actual !== true) continue;
        const [was, is] = [old.line(line), now.line(line)];
        if (was === undefined || is === undefined) continue;
        for (const change of is.records.changes.keys()) if (was.engine.outcome(change)?.applied === true && is.engine.outcome(change)?.applied === false) brokenOn.push({line, change});
    }
    return {broken: broken.sort(compareIds), brokenOn: brokenOn.sort((a, b) => compareIds(a.line, b.line) || compareIds(a.change, b.change))};
}

function run(seed: number, steps: number, residentLines: number, stats?: Stats): {log: string; trace: string[]} {
    const rng = random(seed);
    const int = (low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
    const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
    const trace: string[] = [];
    let counter = 0;
    const request = (puts: WriteRequest["puts"], world: World, what: WriteRequest["what"] = "edit"): WriteRequest => ({requestId: `ld-${String(seed)}-${String(++counter)}`, by: {kind: "author"}, what, title: "线", baseVersion: world.version, puts});
    const written = (id: string, at: StoryChangeDraft["at"], patches: Patch[], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id, kind: "written", text: id, at, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra});
    const patchOf = (xia: string): Patch[] => {
        const roll = rng();
        if (roll < 0.3) return [];
        if (roll < 0.75) return [{op: "add", at: {entry: xia, path: "panel.存款"}, value: -pick([100, 500, 1500, 4000, 9000, 14000])}];
        return [{op: "set", at: {entry: xia, path: "rb.次数"}, value: int(0, 3)}];
    };

    let world = World.empty(options(residentLines));
    const opened = world.publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia")}], world), "t");
    if (!opened.ok) throw new Error("opening failed");
    world = opened.world;
    const xia = opened.ids["tmp:xia"]!;
    const lines: string[] = ["main"];

    for (let step = 1; step <= steps; step += 1) {
        if (stats) stats.steps += 1;
        const before = world;
        let result: WriteResult | {readonly ok: false} | null = null;
        let label = "";
        const roll = rng();
        const changes = [...world.data.changes.values()];
        if (roll < 0.34) {
            // 新记录：落在随机一条线上，章与键常常取在切口之后。
            const line = pick(lines);
            const view = world.line(line);
            const cut = line === "main" ? undefined : lineTable(world.data, world.options.order).lines.get(line)?.fork.fork.cut;
            const cutAt = cut === undefined ? undefined : world.data.changes.get(cut)?.at;
            const floor = cutAt?.kind === "chapter" ? Math.max(0, world.options.order.ids.indexOf(cutAt.chapter)) : 0;
            const chapter = view === undefined ? pick(CHAPTERS) : world.options.order.ids[int(floor, world.options.order.ids.length - 1)]!;
            const placement = {kind: "chapter" as const, chapter, key: int(0, 9) * 10 + int(1, 9), ...(line === "main" ? {} : {line})};
            const kind = rng() < 0.15 ? "plan" : "written";
            label = `record ${line} ${chapter}:${String(placement.key)} ${kind}`;
            result = world.publish(request([{ref: {kind: "change", id: "tmp:n"}, after: {...written("tmp:n", placement, kind === "plan" ? [] : patchOf(xia)), kind}}], world), "t");
            if (result.ok && line !== "main" && stats) stats.childRecords += 1;
        } else if (roll < 0.5) {
            // 改一条已有的变更：换补丁、挪位置或撤销与恢复。
            // 常常去动某条回溯线的触发处：带过去的值变了，而子线的记录没变（“carry”这种更新原因）。
            const triggers = [...lineTable(world.data, world.options.order).lines.values()].flatMap((entry) => (entry.fork.fork.trigger === undefined ? [] : [entry.fork.fork.trigger]));
            const tweak = triggers.length > 0 && rng() < 0.4 ? world.data.changes.get(pick(triggers)) : undefined;
            const target = tweak ?? (changes.length === 0 ? undefined : pick(changes));
            if (target !== undefined) {
                const next = structuredClone(target);
                const how = tweak === undefined ? rng() : 0;
                if (tweak !== undefined) next.patches = [{op: "set", at: {entry: xia, path: "rb.次数"}, value: int(0, 5)}];
                else if (how < 0.4) next.patches = patchOf(xia);
                else if (how < 0.75) {
                    const chapter = pick(CHAPTERS);
                    next.at = {...next.at, kind: "chapter", chapter, key: int(0, 9) * 10 + int(1, 9)} as typeof next.at;
                } else next.status = next.status === "undone" ? "active" : "undone";
                label = `edit ${target.id} ${how < 0.4 ? "patches" : how < 0.75 ? "move" : "status"}${tweak === undefined ? "" : " trigger"}`;
                result = world.publish(request([{ref: {kind: "change", id: target.id}, after: next}], world), "t");
            }
        } else if (roll < 0.66) {
            // 分叉：父线随机，切口是父线视图里一条已写的变更；有更晚的已写变更时一半开回溯。
            const parent = pick(lines);
            const view = world.line(parent);
            if (view !== undefined) {
                const order = world.options.order;
                const keyOf = (change: {at: {kind: string; chapter?: string; key?: number}}) => (change.at.kind === "chapter" ? order.ids.indexOf(change.at.chapter!) * 1000 + change.at.key! : Infinity);
                const candidates = [...view.records.changes.values()].filter((change) => change.kind === "written" && change.status === "active" && change.nature !== "fork" && change.at.kind === "chapter");
                if (candidates.length > 0) {
                    const cut = pick(candidates);
                    const later = candidates.filter((change) => keyOf(change) > keyOf(cut));
                    const rollback = later.length > 0 && rng() < 0.5;
                    const trigger = rollback ? pick(later) : undefined;
                    const fork = {line: "tmp:l", name: `线${String(step)}`, parent, cut: cut.id, type: rollback ? "rollback" : "branch", ...(trigger === undefined ? {} : {trigger: trigger.id}), ...(rollback ? {who: xia} : {})} as Fork;
                    label = `fork ${parent} cut ${cut.id}${trigger === undefined ? "" : ` trigger ${trigger.id}`}`;
                    result = world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", {kind: "chapter", chapter: CHAPTERS.at(-1)!, key: 95, ...(parent === "main" ? {} : {line: parent})}, [], {nature: "fork", fork})}], world), "t");
                    if (result.ok) {
                        lines.push(result.ids["tmp:l"]!);
                        if (stats) stats.forks += 1;
                    }
                }
            }
        } else if (roll < 0.74) {
            const entry = structuredClone(world.data.entries.get(xia)!);
            if (rng() < 0.5) entry.init.data.panel!.fields.存款 = pick([200, 3000, 6000, 12000, 20000, 30000]);
            else entry.init.summary = `摘要${String(step)}`;
            label = "entry init";
            result = world.publish(request([{ref: {kind: "entry", id: xia}, after: entry}], world), "t");
        } else if (roll < 0.8) {
            const order = [...world.options.order.ids].sort(() => rng() - 0.5);
            label = `reorder ${order.join(",")}`;
            result = world.reorder(new ChapterOrder(order), "t", `ro-${String(seed)}-${String(++counter)}`);
        } else if (roll < 0.88) {
            // 开头那次修订建了条目，不还原它（后面的写入都要用这个条目）。
            const target = world.revisions.length <= 1 ? undefined : pick(world.revisions.slice(1));
            if (target !== undefined) {
                label = `revert ${target.id}`;
                try {
                    result = world.revert(target.id, true, {requestId: `rv-${String(seed)}-${String(++counter)}`, by: {kind: "author"}}, "t");
                } catch (caught) {
                    throw new Error(`${String(caught)}\ndependents ${JSON.stringify(world.dependents(target.id))}\n${caught instanceof Error ? caught.stack : ""}\nrevert ${target.id}: ${JSON.stringify(world.revisions.map((revision) => [revision.id, revision.what, revision.ops.map((op) => (op.kind === "chapters" ? "chapters" : `${op.kind}:${op.ref.id}`))]))}`);
                }
            }
        } else if (roll < 0.91) {
            // 核对点：落在随机一条线上，值常常对不上（进待处理），也可能是对得上的读数。
            const line = pick(lines);
            const chapter = pick(CHAPTERS);
            label = `check ${line} ${chapter}`;
            const check = {id: "tmp:k", at: {entry: xia, path: "panel.存款"}, value: pick([200, 3000, 6000, 12000, 14000, 20000]), told: {source: "none" as const}, place: {kind: "chapter" as const, chapter, key: int(0, 9) * 10 + int(1, 9), ...(line === "main" ? {} : {line})}};
            result = world.publish(request([{ref: {kind: "check", id: "tmp:k"}, after: check as never}], world), "t");
        } else if (roll < 0.94) {
            // 把一条记录挪到另一条线上再（下次）挪回去：记录换线。
            const target = changes.length === 0 ? undefined : pick(changes.filter((change) => change.nature !== "fork"));
            if (target !== undefined) {
                const line = pick(lines);
                const next = structuredClone(target);
                next.at = {...next.at, ...(line === "main" ? {} : {line})} as typeof next.at;
                if (line === "main") delete (next.at as {line?: string}).line;
                label = `relocate ${target.id} to ${line}`;
                result = world.publish(request([{ref: {kind: "change", id: target.id}, after: next}], world), "t");
            }
        } else if (roll < 0.96) {
            // 改分叉本身：切口换成父线视图里另一条已写变更，或去掉、补上带过去的列表。
            const forks = changes.filter((change) => change.fork !== undefined);
            if (forks.length > 0) {
                const target = pick(forks);
                const next = structuredClone(target);
                const parentView = world.line(next.fork!.parent);
                const options_ = [...(parentView?.records.changes.values() ?? [])].filter((change) => change.kind === "written" && change.nature !== "fork" && change.at.kind === "chapter");
                if (rng() < 0.6 && options_.length > 0) next.fork!.cut = pick(options_).id;
                else next.fork!.carry = rng() < 0.5 ? [] : [{at: {entry: xia, path: "panel.存款"}}] as never;
                label = `edit fork ${target.id}`;
                result = world.publish(request([{ref: {kind: "change", id: target.id}, after: next}], world), "t");
            }
        } else if (roll < 0.98) {
            // 计划分叉，下一次有机会被已写分叉兑现（同一个线 id）。
            const plans = changes.filter((change) => change.kind === "plan" && change.fork !== undefined && change.status === "active");
            const view = world.line("main");
            const cuts = [...(view?.records.changes.values() ?? [])].filter((change) => change.kind === "written" && change.nature !== "fork" && change.at.kind === "chapter" && change.status === "active");
            if (plans.length > 0 && rng() < 0.6) {
                const plan = pick(plans);
                label = `fulfill ${plan.id}`;
                result = world.publish(request([{ref: {kind: "change", id: "tmp:g"}, after: written("tmp:g", {kind: "chapter", chapter: CHAPTERS.at(-1)!, key: 96}, [], {nature: "fork", fork: {...structuredClone(plan.fork!)}, links: [{kind: "fulfills", plan: plan.id}]})}], world), "t");
                if (result.ok) lines.push(plan.fork!.line);
            } else if (cuts.length > 0) {
                label = "plan fork";
                result = world.publish(request([{ref: {kind: "change", id: "tmp:q"}, after: {...written("tmp:q", {kind: "chapter", chapter: CHAPTERS.at(-1)!, key: 97}, [], {nature: "fork", fork: {line: "tmp:pl", name: `计划${String(step)}`, parent: "main", cut: pick(cuts).id, type: "if"} as Fork}), kind: "plan"}}], world), "t");
                if (result.ok) {
                    lines.push(result.ids["tmp:pl"]!);
                    if (stats) stats.plannedForks += 1;
                }
            }
        } else {
            // 只读：读一条线，让它建起来（或被淘汰）。
            const line = pick(lines);
            label = `read ${line}`;
            world.line(line);
        }
        trace.push(`${String(step)} ${label}`);
        if (result === null || !result.ok) continue;
        world = result.world;
        if (stats) stats.accepted += 1;
        for (const update of world.lines.updates) for (const reason of update.reasons) stats?.reasons.add(reason);
        const known = [...new Set([...lines, ...lineTable(world.data, world.options.order).lines.keys()])];
        const [live, replayed] = [snapshot(world, known), snapshot(World.replay(world.revisions, world.options), known)];
        const differing = known.filter((_, index) => live[index] !== replayed[index]);
        expect(differing, `种子 ${String(seed)} 第 ${String(step)} 步 ${label}（线与重放不同）\n${trace.join("\n")}`).toEqual([]);
        const impact = world.revisions.at(-1)!.impact;
        const expected = brokenReference(before, world);
        expect({broken: impact.broken, brokenOn: impact.brokenOn ?? []}, `种子 ${String(seed)} 第 ${String(step)} 步 ${label}\n${trace.join("\n")}`).toEqual(expected);
        if (stats) stats.brokenOn += expected.brokenOn.length;
    }
    return {log: JSON.stringify(world.revisions), trace};
}

/** 一个种子平时两三秒；别的进程占着 CPU 时能超过缺省的 5 秒（这条用例在负载 19 时失败过，单独跑通过）。 */
const BUSY_MACHINE_TIMEOUT = 30_000;

describe("线层的差分：写入以后与从头重放一致，受影响的线不漏", () => {
    const seeds = Array.from({length: Number(process.env.CANON_LINE_SEEDS ?? 16)}, (_, index) => index + 1);
    const steps = Number(process.env.CANON_LINE_STEPS ?? 60);
    const stats: Stats = {steps: 0, accepted: 0, forks: 0, childRecords: 0, brokenOn: 0, plannedForks: 0, reasons: new Set()};
    test.each(seeds)(`种子 %d，${String(steps)} 步，常驻 3 条`, (seed) => {
        run(seed, steps, 3, stats);
    }, BUSY_MACHINE_TIMEOUT);
    test.each(seeds.slice(0, 3))(`种子 %d：常驻 1 条、全部淘汰时结果与日志与常驻 3 条的相同`, (seed) => {
        const reference = run(seed, steps, 3);
        for (const limit of [1, 0]) expect(run(seed, steps, limit).log).toBe(reference.log);
    }, BUSY_MACHINE_TIMEOUT);
    test("各类情形都走到：分叉、子线上的记录、子线上套不上的、几种更新原因", () => {
        expect(stats.forks).toBeGreaterThanOrEqual(seeds.length);
        expect(stats.childRecords).toBeGreaterThanOrEqual(seeds.length);
        expect(stats.brokenOn).toBeGreaterThan(0);
        expect(stats.plannedForks).toBeGreaterThan(0);
        expect([...stats.reasons].sort()).toEqual(["built", "carry", "entries", "records", "structural"]);
    });
});
