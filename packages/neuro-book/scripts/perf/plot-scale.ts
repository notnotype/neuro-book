/**
 * 剧情插件的规模测量（w00039 t34 计划阶段 B 的 B5）：在临时目录上打开进程内的世界服务（真实的分段日志，登记剧情插件的
 * Component、标注种类与诊断），发布一部剧情形状的模拟世界，量：
 * - 读待处理时剧情插件全部诊断的耗时（预算 200 毫秒：超过时 `status` 的 `diagnosticTimings` 本来就会标 `slow`）；
 * - 按视角的视图读一个挂了 20 个保密知识点的条目（预算 20 毫秒）：每次远程调用取一份快照，按“取快照、建视图、读”一起量；
 *   发布后的第一次（读取输入变了，知情索引要重建）与同一份输入上的再读（世界服务交出同一个视图对象，索引复用）分开记。
 *
 * 形状：200 个人、500 个知识点（第一个人下面挂 20 个保密的）、20 个伏笔；每章 3 条带 `presentLearns` 的在场变更（各 4 个
 * 人在场、各有一句正文讲述）、1 条给某人加一行“别人告诉的”知情行的变更；伏笔每隔 10 章埋一个，之后每 50 章呼应一次，偶数号
 * 的在埋下 400 章后回收。每章一次发布。
 *
 * 用法（应用包目录）：bun scripts/perf/plot-scale.ts [章数=1000]
 * 测量前看 `uptime`：负载高时多跑几次按较低的一端判断，不与 omp 审查同时跑。
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {Mark, ReadPosition, TellingDraft, WriteRequest} from "@notnotype/nb-canon";

import {foreshadowDiagnostics, ledger} from "nbook/plugins/plot/core/foreshadowing";
import {knowingDiagnostics} from "nbook/plugins/plot/core/knowledge-checks";
import {Viewpoint} from "nbook/plugins/plot/core/viewpoint";
import {MARK_IDS, PLOT_PLUGIN_ID} from "nbook/plugins/plot/shared/declarations";
import {PlotService} from "nbook/plugins/plot/testing/service";
import {addRow, drafts, learns, present} from "nbook/plugins/plot/testing/world";

const chapters = Number(process.argv.find((arg) => /^\d+$/u.test(arg)) ?? 1000);
const PEOPLE = 200;
const POINTS = 500;
const FORESHADOWS = 20;

function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
const rnd = seeded(11);
const pick = (count: number) => Math.floor(rnd() * count);
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const ms = (value: number): string => value.toFixed(value < 10 ? 2 : 0);

const root = await mkdtemp(join(tmpdir(), "nbook-plot-scale-"));
const chapterIds = Array.from({length: chapters}, (_, index) => `ch${String(index + 1)}`);
const plot = await PlotService.open(root, chapterIds);
const {service} = plot;
// 像宿主一样：正文表改了以后通知服务。
for (const [index, chapter] of chapterIds.entries()) {
    plot.texts.set(chapter, `${[0, 1, 2].map((i) => `第${String(index + 1)}章第${String(i)}句。`).join("\n")}\n${"正文".repeat(1500)}\n`);
    service.textChanged(chapter);
}

// ---------- 生成 ----------
let started = performance.now();
const people = await plot.publish(Array.from({length: PEOPLE}, (_, index) => ({ref: {kind: "entry" as const, id: `tmp:h${String(index)}`}, after: drafts.person(`tmp:h${String(index)}`, `人物${String(index)}`)})));
const person = (index: number) => people[`tmp:h${String(index % PEOPLE)}`]!;
// 前 20 个知识点挂在第一个人下面（视图那一项读它），其余散在别人下面；都是保密档。
const points = await plot.publish(Array.from({length: POINTS}, (_, index) => ({ref: {kind: "entry" as const, id: `tmp:k${String(index)}`}, after: drafts.point(`tmp:k${String(index)}`, `知识点${String(index)}`, index < 20 ? person(0) : person(1 + (index % (PEOPLE - 1))))})));
const point = (index: number) => points[`tmp:k${String(index % POINTS)}`]!;
const foreshadows = await plot.publish(Array.from({length: FORESHADOWS}, (_, index) => ({ref: {kind: "entry" as const, id: `tmp:f${String(index)}`}, after: drafts.foreshadow(`tmp:f${String(index)}`, `伏笔${String(index)}`, {重要程度: index % 3 === 0 ? "main" : "minor"})})));
const foreshadow = (index: number) => foreshadows[`tmp:f${String(index)}`]!;

/** 第 n 章（从 1 起）上伏笔的节点：每 10 章埋一个，之后每 50 章呼应，偶数号的在 400 章后回收。 */
function nodesAt(n: number): Mark[] {
    const marks: Mark[] = [];
    for (let f = 0; f < FORESHADOWS; f += 1) {
        const planted = 10 * f + 1;
        const role = n === planted ? "plant" : f % 2 === 0 && n === planted + 400 ? "payoff" : n > planted && (n - planted) % 50 === 0 && (f % 2 !== 0 || n < planted + 400) ? "echo" : null;
        if (role !== null) marks.push({kind: MARK_IDS.node, version: 1, foreshadow: foreshadow(f), role});
    }
    return marks;
}

let sequence = 0;
for (let n = 1; n <= chapters; n += 1) {
    const chapter = chapterIds[n - 1]!;
    const puts: WriteRequest["puts"] = [];
    for (let i = 0; i < 3; i += 1) {
        const id = `tmp:c${String(++sequence)}`;
        const cast = Array.from(new Set(Array.from({length: 4}, () => pick(PEOPLE)))).map((index) => present(person(index)));
        const nodes = i === 0 ? nodesAt(n) : [];
        const told: TellingDraft = {source: "chapter", chapter, quote: `第${String(n)}章第${String(i)}句`, ...(nodes.length === 0 ? {} : {marks: nodes})};
        puts.push({ref: {kind: "change", id}, after: drafts.change(id, {kind: "chapter", chapter, key: i * 10}, {text: `第 ${String(n)} 章的一场`, cast, marks: [learns(point(pick(POINTS)))], told: [told]})});
    }
    // (n mod 200, 7n mod 500) 在 1000 章内不重复：同一人对同一知识点只加一次行。
    const id = `tmp:c${String(++sequence)}`;
    puts.push({ref: {kind: "change", id}, after: drafts.change(id, {kind: "chapter", chapter, key: 40}, {patches: [addRow(person(n), point(7 * n), {程度: "knows", 怎么知道: "told", 谁告诉的: {ref: person(n + 1)}})]})});
    await plot.publish(puts);
}
const generated = performance.now() - started;
const version = service.status().version;

// ---------- 读待处理时剧情插件全部诊断 ----------
// 产品里剧情插件的项目入口经 canon 的项目内接口登记；这里直接在服务上登记同一组计算。
service.registerDiagnostics(PLOT_PLUGIN_ID, {compute: {...knowingDiagnostics(), ...foreshadowDiagnostics()}, dataVersion: "scale"});
const last = chapterIds.at(-1)!;
const pendingReads: number[] = [];
let timings: {readonly diagnostic: string; readonly ms: number}[] = [];
let counts: unknown = null;
for (let round = 0; round < 6; round += 1) {
    // 每轮先发布一条小变更：读取输入变了，待处理要重算。
    await plot.change({kind: "chapter", chapter: last, key: 1_000 + round}, {text: "补一句"});
    const begin = performance.now();
    const page = service.pending({}, undefined, 50);
    pendingReads.push(performance.now() - begin);
    if (typeof page === "string") throw new Error(page);
    counts = {...page.counts, complete: page.complete};
    timings = [...service.status().diagnosticTimings].slice(-Object.keys({...knowingDiagnostics(), ...foreshadowDiagnostics()}).length);
}

// ---------- 按视角读一个挂了 20 个保密知识点的条目 ----------
const until: ReadPosition = {kind: "chapter", chapter: last, edge: "end"};
const viewer = person(1);
const opened = service.openView({viewer, line: "main", until, purpose: "writer"});
if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
const audit = (method: string, blocked: readonly string[]) => void service.auditView(opened.token, {method, kind: "placeholder", blocked: blocked.map((id) => ({kind: "entry" as const, id}))});
const viewpointCall = () => {
    const begin = performance.now();
    const snapshot = service.snapshot();
    const viewpoint = new Viewpoint(snapshot.view, snapshot.viewed(opened.token), {viewer, until}, audit);
    const read = viewpoint.entry(person(0));
    const elapsed = performance.now() - begin;
    return {elapsed, read};
};
// 冷：每轮先发布一条小变更（读取输入变了，视图对象与剧情的索引都要重建），再读一次；热：同一份输入上接着读。
// 引擎在发布后的第一次读取时才追上新版本（任何读取都要付）：先单独量这一下，冷读量的是剧情插件自己的开销。
const coldReads: number[] = [];
const warmReads: number[] = [];
const catchUps: number[] = [];
let children = -1;
for (let round = 0; round < 10; round += 1) {
    const written = await plot.change({kind: "chapter", chapter: last, key: 2_000 + round}, {text: "又补一句"});
    const begin = performance.now();
    service.snapshot().view.outcome(written);
    catchUps.push(performance.now() - begin);
    const cold = viewpointCall();
    coldReads.push(cold.elapsed);
    if (typeof cold.read === "object" && cold.read.kind === "entry") children = cold.read.children.length;
    for (let again = 0; again < 5; again += 1) warmReads.push(viewpointCall().elapsed);
}

// ---------- 别的读取（只记录，不设预算） ----------
const snapshot = service.snapshot();
started = performance.now();
const items = ledger(snapshot.view, until, "actual");
const ledgerMs = performance.now() - started;

Bun.gc(true);
const heap = process.memoryUsage().heapUsed / 1024 / 1024;
service.closeView(opened.token);
await plot.stop();
await rm(root, {recursive: true, force: true});

const uptime = (await Bun.$`uptime`.text()).trim();
const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5).map((timing) => `${timing.diagnostic.replace(`${PLOT_PLUGIN_ID}.`, "")} ${ms(timing.ms)}`).join("，");
console.log(`剧情规模（${String(chapters)} 章，${String(PEOPLE)} 人，${String(POINTS)} 个知识点，${String(FORESHADOWS)} 个伏笔，版本 ${String(version)}）`);
console.log(`负载：${uptime}`);
console.log(`生成（每章一次发布）：${ms(generated / 1000)} 秒`);
console.log(`读待处理（含剧情插件全部诊断，发布后第一次读）：第一次 ${ms(pendingReads[0]!)} 毫秒，之后中位 ${ms(median(pendingReads.slice(1)))}，最大 ${ms(Math.max(...pendingReads.slice(1)))}（预算 200）；计数 ${JSON.stringify(counts)}`);
console.log(`诊断耗时（最后一轮，最慢的 5 个，毫秒）：${slowest}；合计 ${ms(timings.reduce((sum, timing) => sum + timing.ms, 0))}`);
console.log(`发布后引擎追上新版本（第一次读取）：中位 ${ms(median(catchUps))} 毫秒，最大 ${ms(Math.max(...catchUps))}`);
console.log(`按视角读挂了 20 个保密知识点的条目（取快照、建视图、读；预算 20）：引擎追上以后第一次中位 ${ms(median(coldReads))} 毫秒，最大 ${ms(Math.max(...coldReads))}；同一份输入上再读中位 ${ms(median(warmReads))}，最大 ${ms(Math.max(...warmReads))}；读到的子条目 ${String(children)} 个`);
console.log(`伏笔账本：${ms(ledgerMs)} 毫秒（${String(items.length)} 项）`);
console.log(`堆：${ms(heap)} MB`);
