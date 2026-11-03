/**
 * 世界服务的完整路径规模测量（docs/specs/canon/project.md 输出 14、场景 6）：在临时项目里用产品的世界宿主
 * （`holdLock` 的跨进程锁、`./node` 的分段日志、活页夹与章节文件）发布一部约 1000 章的模拟世界，关掉再打开，量：
 * 打开到可以读、随机读（实际与按计划模式）、在最新一章发布一次记账、改常出场条目的初值。项目进程里直接调用，不经远程。
 *
 * 形状同 nb-canon 的 `scripts/scale.ts`：开局 20 个条目（前 5 个常出场），每章 5 个计划（4 个本章兑现）、15 条已写变更
 * （常出场条目之间转账、每三条记一笔语义档）、2 个核对点，每两章一个新条目；每章一次写入。核对点写的是记录算出来的
 * 存款，对得上。`--diverge`：从中间那章起正文写的数一直比记录多 1,700、没人处理（漏记了一笔），之后的核对点全都对不上，
 * 每个的嫌疑区间都回到最后一个对得上的核对点，待处理随章数按平方变大。
 *
 * 用法（应用包目录）：bun scripts/perf/canon-scale.ts [章数=1000] [--diverge]
 * 测量前看 `uptime`：负载高时多跑几次按较低的一端判断，不与 omp 审查同时跑。
 */

import {mkdir, mkdtemp, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {Entry, ReadPosition, StoryChange, WriteRequest} from "@notnotype/nb-canon";
import type {WorldService} from "@notnotype/nb-canon/node";

import {createWorldHost} from "nbook/plugins/canon/backend/world-host";
import {BINDER_DIR} from "nbook/plugins/canon/backend/binder";
import {BUILTIN_COMPONENTS} from "nbook/plugins/canon/shared/components";

const chapters = Number(process.argv.find((arg) => /^\d+$/u.test(arg)) ?? 1000);
const divergeFrom = process.argv.includes("--diverge") ? Math.floor(chapters / 2) : Number.POSITIVE_INFINITY;
const PERSON = "nbook.canon.person";
const PANEL = "nbook.canon.panel";

function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
const rnd = seeded(7);
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const ms = (value: number): string => value.toFixed(value < 10 ? 2 : 0);

const root = await mkdtemp(join(tmpdir(), "nbook-canon-scale-"));
const chapterIds = Array.from({length: chapters}, (_, index) => String(index + 1));
await mkdir(join(root, BINDER_DIR), {recursive: true});
await writeFile(join(root, BINDER_DIR, "binder.xml"), `<binder nextId="${String(chapters + 1)}">\n${chapterIds.map((id) => `  <chapter id="${id}" title="第${id}章"/>`).join("\n")}\n</binder>\n`);
await Promise.all(chapterIds.map((id) => writeFile(join(root, BINDER_DIR, `${id.padStart(5, "0")}-第${id}章.md`), `第${id}章。原句。${"正文".repeat(1500)}\n`)));

const report = (input: {readonly level: string; readonly event: string; readonly message: string}) => {
    if (input.level !== "info") process.stderr.write(`[${input.level}] ${input.event} ${input.message}\n`);
};

async function open(): Promise<{service: WorldService; stop: () => Promise<void>}> {
    const host = createWorldHost(root, report);
    // 产品里由贡献点接收者在打开前交出内置类型。
    host.setComponents(BUILTIN_COMPONENTS);
    const service = await host.ready();
    if ("code" in service) throw new Error(`打开失败：${service.code}`);
    return {service, stop: () => host.stop()};
}

function person(temp: string, index: number, appears?: string): Entry {
    return {
        id: temp, type: PERSON, parent: null, folder: "人物", order: index,
        ...(appears === undefined ? {} : {appears: {kind: "chapter" as const, chapter: appears, key: 0}}),
        // Agent 写的数要有依据（canon.revisions 的写入校验）。
        initBasis: {"panel.存款": {kind: "estimate", note: "规模测量"}, "panel.魔力": {kind: "estimate", note: "规模测量"}},
        init: {
            name: `人物${String(index)}`, aliases: ["别名"], summary: "一句话描述",
            text: [{id: "b1", source: "平时戴着滤镜，存款还剩 {panel.存款}。"}],
            data: {
                panel: {type: PANEL, version: 1, enabled: true, fields: {存款: 1_000_000, 魔力: 3200}, declared: [{id: "存款", label: "存款", kind: "number", min: 0}, {id: "魔力", label: "魔力", kind: "number"}]},
                character: {type: PERSON, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: "冷淡"}},
            },
        },
    };
}

let sequence = 0;
/** 第一个常出场条目的存款：每次写入按本次的转账推进，核对点照它写。 */
let balance = 1_000_000;
/**
 * 一章的记账：5 个计划（前 4 个由本次的已写变更兑现）、15 条已写变更、2 个核对点，偶数章另建一个条目。
 * `base` 是本次记录的排序键起点：在最新一章反复补记时每次往后挪，新记录与核对点都在本章已有的之后。
 */
function bookkeeping(service: WorldService, chapter: string, hot: readonly string[], n: number, base = 0): WriteRequest {
    const puts: WriteRequest["puts"] = [];
    const plans: string[] = [];
    for (let i = 0; i < 5; i += 1) {
        const id = `tmp:p${String(++sequence)}`;
        plans.push(id);
        const plan: StoryChange = {id, kind: "plan", text: "计划", at: {kind: "chapter", chapter, key: base + i * 10}, told: [], involves: [hot[i % 5]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.魔力"}, value: -10, basis: {kind: "estimate", note: "计划"}}], status: "active", by: {kind: "author"}};
        puts.push({ref: {kind: "change", id}, after: plan});
    }
    for (let i = 0; i < 15; i += 1) {
        const id = `tmp:w${String(++sequence)}`;
        const from = hot[i % 5]!;
        const to = hot[(i + 1) % 5]!;
        const change: StoryChange = {
            id, kind: "written", text: "情节", at: {kind: "chapter", chapter, key: base + i * 10}, told: [{source: "chapter", chapter, quote: "原句"}], involves: [from, to], lines: [],
            links: i < 4 ? [{kind: "fulfills", plan: plans[i]!}] : [],
            patches: [
                {op: "add", at: {entry: from, path: "panel.存款"}, value: -(100 + i), basis: {kind: "estimate", note: "规模测量"}},
                {op: "add", at: {entry: to, path: "panel.存款"}, value: 100 + i, basis: {kind: "estimate", note: "规模测量"}},
                ...(i % 3 === 0 ? [{op: "note" as const, at: {entry: from, path: "character.态度"}, value: `第 ${String(n)} 章：软了一点`}] : []),
            ],
            status: "active", by: {kind: "agent", session: "记账"},
        };
        puts.push({ref: {kind: "change", id}, after: change});
    }
    // 第一个常出场条目在第 i 条变更里转出（i % 5 == 0）或转入（i % 5 == 4）100 + i。
    const delta = (i: number) => (i % 5 === 0 ? -(100 + i) : i % 5 === 4 ? 100 + i : 0);
    const written = (through: number) => balance + Array.from({length: 15}, (_, i) => i).filter((i) => i * 10 < through).reduce((sum, i) => sum + delta(i), 0) + (n >= divergeFrom ? 1_700 : 0);
    for (const key of [55, 155]) {
        const id = `tmp:k${String(++sequence)}`;
        puts.push({ref: {kind: "check", id}, after: {id, at: {entry: hot[0]!, path: "panel.存款"}, value: written(key), told: {source: "chapter", chapter, quote: "原句"}, place: {kind: "chapter", chapter, key: base + key}}});
    }
    balance = written(Number.POSITIVE_INFINITY) - (n >= divergeFrom ? 1_700 : 0);
    if (n % 2 === 0) {
        const id = `tmp:e${String(++sequence)}`;
        puts.push({ref: {kind: "entry", id}, after: person(id, 100 + n, chapter)});
    }
    return {requestId: `scale-${String(++sequence)}`, by: {kind: "agent", session: "记账"}, what: "bookkeeping", title: `第 ${chapter} 章记账`, chapter, baseVersion: service.status().version, puts};
}

async function publish(service: WorldService, request: WriteRequest): Promise<Readonly<Record<string, string>>> {
    const result = await service.publish(request);
    if (!result.ok) throw new Error(`${request.title} 发布失败：${JSON.stringify(result.failure).slice(0, 500)}`);
    return result.ids;
}

// ---------- 生成 ----------
let started = performance.now();
const first = await open();
const opening: WriteRequest["puts"] = Array.from({length: 20}, (_, index) => ({ref: {kind: "entry" as const, id: `tmp:o${String(index)}`}, after: person(`tmp:o${String(index)}`, index)}));
const openingIds = await publish(first.service, {requestId: "scale-opening", by: {kind: "agent", session: "开局"}, what: "opening", title: "开局", baseVersion: first.service.status().version, puts: opening});
const hot = Array.from({length: 5}, (_, index) => openingIds[`tmp:o${String(index)}`]!);
for (let n = 1; n <= chapters; n += 1) await publish(first.service, bookkeeping(first.service, chapterIds[n - 1]!, hot, n));
const generated = performance.now() - started;
const version = first.service.status().version;
await first.stop();

const logDir = join(root, ".nbook", "world", "log");
const segments = (await readdir(logDir)).filter((name) => name.endsWith(".jsonl"));
const logBytes = (await Promise.all(segments.map(async (name) => (await stat(join(logDir, name))).size))).reduce((sum, size) => sum + size, 0);

// ---------- 打开到可以读 ----------
started = performance.now();
const {service, stop} = await open();
const entryIds = [...service.world.data.entries.keys()];
service.entry(hot[0]!, {kind: "chapter", chapter: chapterIds.at(-1)!, edge: "end"}, "actual");
const openMs = performance.now() - started;

const randomPosition = (): ReadPosition => {
    const chapter = chapterIds[Math.floor(rnd() * chapterIds.length)]!;
    return {kind: "chapter", chapter, edge: rnd() < 0.5 ? "start" : "end"};
};
const timedReads = (mode: "actual" | "planned", positions: () => ReadPosition): number[] =>
    Array.from({length: 50}, () => {
        const id = rnd() < 0.5 ? hot[Math.floor(rnd() * hot.length)]! : entryIds[Math.floor(rnd() * entryIds.length)]!;
        const position = positions();
        const begin = performance.now();
        service.entry(id, position, mode);
        return performance.now() - begin;
    });

const actualReads = timedReads("actual", randomPosition);
// 按计划模式：每个读取位置计入的计划集合不同，第一次读要建这一组的覆盖层（输出 14 的“第一次读取”）；之后同一位置上
// 的读取复用它。先在 5 个随机位置各读一次，再在这 5 个位置上随机读 50 次。
const plannedPositions = Array.from({length: 5}, randomPosition);
const plannedFirsts = plannedPositions.map((position) => {
    const begin = performance.now();
    service.entry(hot[0]!, position, "planned");
    return performance.now() - begin;
});
const plannedFirst = Math.max(...plannedFirsts);
const plannedReads = timedReads("planned", () => plannedPositions[Math.floor(rnd() * plannedPositions.length)]!);

// ---------- 在最新一章发布一次记账（含校验、计算、写入落盘） ----------
const last = chapterIds.at(-1)!;
const publishes: number[] = [];
for (let round = 0; round < 10; round += 1) {
    const request = bookkeeping(service, last, hot, chapters + 1 + round * 2, 1_000 * (round + 1));
    const begin = performance.now();
    await publish(service, request);
    publishes.push(performance.now() - begin);
}

// ---------- 改常出场条目的初值（影响从第 1 章起） ----------
const initial: number[] = [];
for (let round = 0; round < 5; round += 1) {
    const entry = service.world.data.entries.get(hot[1]!)!;
    const panel = entry.init.data.panel!;
    const after = {...entry, init: {...entry.init, data: {...entry.init.data, panel: {...panel, fields: {...panel.fields, 魔力: 3200 + round + 1}}}}};
    const begin = performance.now();
    await publish(service, {requestId: `scale-init-${String(round)}`, by: {kind: "author"}, what: "edit", title: "改初值", baseVersion: service.status().version, puts: [{ref: {kind: "entry", id: hot[1]!}, after}]});
    initial.push(performance.now() - begin);
}

const pending = service.pending();
const pendingCount = pending === "chapter-not-found" ? 0 : pending.items.length;
const suspectCount = pending === "chapter-not-found" ? 0 : pending.items.reduce((sum, item) => sum + (item.kind === "check-mismatch" ? item.suspects.length : 0), 0);
Bun.gc(true);
const heap = process.memoryUsage().heapUsed / 1024 / 1024;
await stop();
// `CANON_SCALE_KEEP=1` 时留下临时项目（打印路径），用来看日志或交给 measure-project 量常驻内存。
if (process.env.CANON_SCALE_KEEP === "1") console.log(`留下临时项目：${root}`);
else await rm(root, {recursive: true, force: true});

const uptime = (await Bun.$`uptime`.text()).trim();
console.log(`canon 完整路径规模（${String(chapters)} 章${Number.isFinite(divergeFrom) ? `，第 ${String(divergeFrom)} 章起正文与记录差 1,700` : ""}，版本 ${String(version)}，${String(entryIds.length)} 个条目，日志 ${(logBytes / 1024 / 1024).toFixed(1)} MB / ${String(segments.length)} 段）`);
console.log(`负载：${uptime}`);
console.log(`生成（每章一次发布）：${ms(generated / 1000)} 秒`);
console.log(`打开到可以读：${ms(openMs)} 毫秒（预算 2000）`);
console.log(`随机读（实际）：中位 ${ms(median(actualReads))} 毫秒，最大 ${ms(Math.max(...actualReads))}（预算 20）`);
console.log(`按计划第一次读（5 个位置里最慢的）：${ms(plannedFirst)} 毫秒（预算 1000）；之后在这些位置上读，中位 ${ms(median(plannedReads))} 毫秒（预算 20）`);
console.log(`最新一章发布一次记账：中位 ${ms(median(publishes))} 毫秒，最大 ${ms(Math.max(...publishes))}（预算 100）`);
console.log(`改常出场条目的初值：中位 ${ms(median(initial))} 毫秒（预算 1000）`);
console.log(`待处理：${String(pendingCount)} 条，嫌疑记录共 ${String(suspectCount)} 条`);
console.log(`堆：${ms(heap)} MB`);
