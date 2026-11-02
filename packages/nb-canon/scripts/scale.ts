/**
 * nb-canon 纯计算部分的规模测量（docs/specs/canon/project.md 输出 14 的形状；t29 计划“第 3 片起每片重跑”）。
 *
 * 只量引擎：不读日志、不写盘、不经远程调用。完整路径（真实的锁与分段日志、项目进程里的世界服务）由 canon 插件的
 * 规模脚本量（第 8 片）。形状：每章 5 个计划（4 个本章兑现、1 个不兑现）、15 条已写变更（两个常出场条目之间的
 * 转账与描述）、2 个核对点，每两章一个新条目，开局 20 个条目。第二组形状（`--planned-spread`）让计划在之后
 * 1 到 5 章里随机兑现，按计划模式在随机位置读，量“计入的计划随位置变”的代价。
 *
 * 用法（本包目录）：bun scripts/scale.ts [章数=1000] [--planned-spread]
 * 测量前看 `uptime`，负载高时多跑几次按较低的一端判断。
 */

import {buildRegistry, ChapterOrder, chapterEnd, chapterStart, type Check, type Entry, type ReadPosition, type StoryChange} from "../src/index";
import {createIncrementalEngine} from "../src/engine/incremental";
import type {EngineInputs, WorldData} from "../src/engine/types";

const chapters = Number(process.argv.find((arg) => /^\d+$/u.test(arg)) ?? 1000);
const spread = process.argv.includes("--planned-spread");

const PANEL = {id: "canon.panel", label: "面板", namespace: "panel", version: 1, fields: [{id: "存款", label: "存款", kind: "number" as const, min: 0}, {id: "魔力", label: "魔力", kind: "number" as const}]};
const PERSON = {id: "canon.person", label: "人物", namespace: "character", version: 1, fields: [{id: "样子", label: "样子", kind: "text" as const}, {id: "态度", label: "态度", kind: "text" as const, precision: "semantic" as const}]};

function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
const rnd = seeded(7);

function build(): {inputs: EngineInputs; hot: string[]; chapterIds: string[]} {
    const entries = new Map<string, Entry>();
    const changes = new Map<string, StoryChange>();
    const checks = new Map<string, Check>();
    const createdAt = new Map<string, number>();
    let version = 0;
    let entrySeq = 0;
    let changeSeq = 0;
    let checkSeq = 0;
    const newEntry = (chapter: string | undefined) => {
        const id = `e${String(++entrySeq)}`;
        entries.set(id, {
            id, type: "人物", parent: null, folder: "人物", order: entrySeq,
            ...(chapter === undefined ? {} : {appears: {kind: "chapter" as const, chapter, key: 0}}),
            init: {
                name: `人物${String(entrySeq)}`, aliases: ["别名"], summary: "一句话描述",
                text: [{id: "b1", source: "星瑕平时戴着滤镜，存款还剩 {panel.存款}。"}],
                data: {
                    panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 1_000_000, 魔力: 3200}},
                    character: {type: PERSON.id, version: 1, enabled: true, fields: {样子: "哥哥", 态度: "冷淡"}},
                },
            },
        });
        createdAt.set(id, ++version);
        return id;
    };
    const hot = Array.from({length: 20}, () => newEntry(undefined)).slice(0, 5);
    const chapterIds = Array.from({length: chapters}, (_, index) => `ch${String(index + 1)}`);
    const pendingFulfill: Array<{plan: string; at: number}> = [];
    for (let n = 1; n <= chapters; n += 1) {
        const chapter = `ch${String(n)}`;
        version += 1;
        const plans: string[] = [];
        for (let i = 0; i < 5; i += 1) {
            const id = `c${String(++changeSeq)}`;
            changes.set(id, {id, kind: "plan", text: "计划", at: {kind: "chapter", chapter, key: i * 10}, told: [], involves: [hot[i % 5]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.魔力"}, value: -10}], status: "active", by: {kind: "author"}});
            createdAt.set(id, version);
            plans.push(id);
            if (spread && i < 4) pendingFulfill.push({plan: id, at: n + 1 + Math.floor(rnd() * 5)});
        }
        version += 1;
        if (n % 2 === 0) newEntry(chapter);
        const fulfilledHere = spread ? pendingFulfill.filter((item) => item.at === n).map((item) => item.plan) : plans.slice(0, 4);
        for (let i = 0; i < 15; i += 1) {
            const id = `c${String(++changeSeq)}`;
            const from = hot[i % 5]!;
            const to = hot[(i + 1) % 5]!;
            const amount = 100 + i;
            const links = i < fulfilledHere.length ? [{kind: "fulfills" as const, plan: fulfilledHere[i]!}] : [];
            changes.set(id, {
                id, kind: "written", text: "情节", at: {kind: "chapter", chapter, key: i * 10}, told: [{source: "chapter", chapter, quote: "原句"}], involves: [from, to], lines: [], links,
                patches: [
                    {op: "add", at: {entry: from, path: "panel.存款"}, value: -amount},
                    {op: "add", at: {entry: to, path: "panel.存款"}, value: amount},
                    ...(i % 3 === 0 ? [{op: "note" as const, at: {entry: from, path: "character.态度"}, value: `第 ${String(n)} 章：软了一点`}] : []),
                ],
                status: "active", by: {kind: "agent", session: "记账"},
            });
            createdAt.set(id, version);
        }
        for (let i = 0; i < 2; i += 1) {
            const id = `k${String(++checkSeq)}`;
            checks.set(id, {id, at: {entry: hot[0]!, path: "panel.存款"}, value: 1_000_000, told: {source: "chapter", chapter, quote: "原句"}, place: {kind: "chapter", chapter, key: 55 + i * 100}});
            createdAt.set(id, version);
        }
    }
    const world: WorldData = {version, entries, changes, checks, questions: new Map(), suggestions: new Map(), createdAt};
    return {inputs: {world, order: new ChapterOrder(chapterIds), registry: buildRegistry([PANEL, PERSON]), reductions: () => undefined}, hot, chapterIds};
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
}

const ms = (value: number) => value.toFixed(value < 10 ? 2 : 0);

const {inputs, hot, chapterIds} = build();
const entryIds = [...inputs.world.entries.keys()];
let start = performance.now();
const engine = createIncrementalEngine(inputs);
const buildMs = performance.now() - start;
Bun.gc(true);
const heapAfterBuild = process.memoryUsage().heapUsed / 1024 / 1024;

const randomPosition = (): ReadPosition => {
    const chapter = chapterIds[Math.floor(rnd() * chapterIds.length)]!;
    return rnd() < 0.5 ? chapterStart(chapter) : chapterEnd(chapter);
};

const reads: number[] = [];
for (let i = 0; i < 50; i += 1) {
    const id = rnd() < 0.5 ? hot[Math.floor(rnd() * hot.length)]! : entryIds[Math.floor(rnd() * entryIds.length)]!;
    const position = randomPosition();
    start = performance.now();
    engine.entry(id, position, "actual");
    reads.push(performance.now() - start);
}

/** 在最新一章补记 15 条变更与 2 个核对点（一次记账），只量引擎的更新。 */
const last = chapterIds.at(-1)!;
const publishLatest: number[] = [];
let current = engine;
for (let round = 0; round < 10; round += 1) {
    const changes = new Map(current.inputs.world.changes);
    const checks = new Map(current.inputs.world.checks);
    const createdAt = new Map(current.inputs.world.createdAt);
    const version = current.inputs.world.version + 1;
    const added: string[] = [];
    for (let i = 0; i < 15; i += 1) {
        const id = `n${String(round)}-${String(i)}`;
        changes.set(id, {id, kind: "written", text: "补记", at: {kind: "chapter", chapter: last, key: 200 + i}, told: [], involves: [hot[i % 5]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.存款"}, value: i % 2 === 0 ? -1 : 1}], status: "active", by: {kind: "agent", session: "记账"}});
        createdAt.set(id, version);
        added.push(id);
    }
    const checkIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
        const id = `nk${String(round)}-${String(i)}`;
        checks.set(id, {id, at: {entry: hot[0]!, path: "panel.存款"}, value: 0, told: {source: "chapter", chapter: last, quote: "原句"}, place: {kind: "chapter", chapter: last, key: 300 + i}});
        createdAt.set(id, version);
        checkIds.push(id);
    }
    const next = {...current.inputs, world: {...current.inputs.world, version, changes, checks, createdAt}};
    start = performance.now();
    current = current.update(next, {changes: added, checks: checkIds});
    publishLatest.push(performance.now() - start);
}

/** 改一个常出场条目的初值：从第 1 章起受影响。 */
const publishFirst: number[] = [];
for (let round = 0; round < 5; round += 1) {
    const entries = new Map(current.inputs.world.entries);
    const entry = structuredClone(entries.get(hot[0]!)!);
    entry.init.data.panel!.fields.存款 = 1_000_000 + round + 1;
    entries.set(entry.id, entry);
    const next = {...current.inputs, world: {...current.inputs.world, version: current.inputs.world.version + 1, entries}};
    start = performance.now();
    current = current.update(next, {entries: [entry.id]});
    publishFirst.push(performance.now() - start);
}

const plannedFirst: number[] = [];
const plannedAgain: number[] = [];
for (let i = 0; i < 20; i += 1) {
    const position = randomPosition();
    const id = hot[Math.floor(rnd() * hot.length)]!;
    start = performance.now();
    current.entry(id, position, "planned");
    plannedFirst.push(performance.now() - start);
    start = performance.now();
    current.entry(id, position, "planned");
    plannedAgain.push(performance.now() - start);
}

console.log(
    `${String(chapters)} 章${spread ? "（计划在之后 1 到 5 章随机兑现）" : ""}：条目 ${String(inputs.world.entries.size)}、变更 ${String(inputs.world.changes.size)}、核对点 ${String(inputs.world.checks.size)}\n` +
        `  建引擎（打开时的首次计算）${ms(buildMs)} ms，重算 ${String(engine.recomputed)} 个事件；建好后回收垃圾，堆 ${heapAfterBuild.toFixed(0)} MB（含模拟世界本身）\n` +
        `  随机读一个条目（实际模式）50 次中位 ${ms(median(reads))} ms，最慢 ${ms(Math.max(...reads))} ms\n` +
        `  最新一章补记一次（15 条变更、2 个核对点）10 次中位 ${ms(median(publishLatest))} ms\n` +
        `  改常出场条目的初值 5 次中位 ${ms(median(publishFirst))} ms\n` +
        `  按计划模式随机读：第一次 20 次中位 ${ms(median(plannedFirst))} ms、最慢 ${ms(Math.max(...plannedFirst))} ms；同位置再读中位 ${ms(median(plannedAgain))} ms`,
);
