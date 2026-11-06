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
 * 阶段 E 另加：30 个主要角色（每人 1 到 3 个目标，`基于` 各 2 个知识点）、200 条决策（50 条已定带地址守卫、20 条已定带读者守卫、
 * 30 条待定带到期章、100 条已定不带守卫）、3 条回溯分叉线、100 章的写作指示快照；读待处理的预算按全部剧情诊断合计判。
 *
 * 用法（应用包目录）：bun scripts/perf/plot-scale.ts [章数=1000]
 * 测量前看 `uptime`：负载高时多跑几次按较低的一端判断，不与 omp 审查同时跑。
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {Mark, ReadPosition, TellingDraft, WriteRequest} from "@notnotype/nb-canon";

import type {InstructionSnapshot} from "nbook/plugins/plot/shared/instructions";
import {beforeWriting} from "nbook/plugins/plot/core/before-writing";
import {composeBrief} from "nbook/plugins/plot/core/brief";
import {decisionDiagnostics} from "nbook/plugins/plot/core/decisions";
import {foreshadowDiagnostics, ledger} from "nbook/plugins/plot/core/foreshadowing";
import {goalDiagnostics} from "nbook/plugins/plot/core/goal-checks";
import {guardDiagnostics} from "nbook/plugins/plot/core/guards";
import {instructionDiagnostics} from "nbook/plugins/plot/core/instruction-checks";
import {knowingDiagnostics} from "nbook/plugins/plot/core/knowledge-checks";
import {Viewpoint} from "nbook/plugins/plot/core/viewpoint";
import {MARK_IDS, PLOT_PLUGIN_ID} from "nbook/plugins/plot/shared/declarations";
import {PlotStore} from "nbook/plugins/plot/backend/store";
import {checkDiagnostics} from "nbook/plugins/plot/core/checks/diagnostics";
import {namesOfSegments, planCheck} from "nbook/plugins/plot/core/checks/plan";
import {createLimiter, runCheck, type CheckModels} from "nbook/plugins/plot/core/checks/run";
import {createCheckSource} from "nbook/plugins/plot/core/checks/source";
import {CheckDependenciesSchema, type CheckDependencies, type CheckRecord} from "nbook/plugins/plot/shared/checks";
import {createPartitionOwner} from "nbook/plugins/storage/backend/owner";
import {createPartition} from "nbook/plugins/storage/backend/partition";
import {createStorageFacade} from "nbook/plugins/storage/shared/facade";
import {Type} from "typebox";
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
const forkCuts: string[] = [];
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
    const written = await plot.publish(puts);
    if (n === Math.floor(chapters / 4) || n === Math.floor(chapters / 2) || n === Math.floor((3 * chapters) / 4)) forkCuts.push(written[puts[0]!.ref.id]!);
}
const generated = performance.now() - started;
const version = service.status().version;

// ---------- 阶段 E：目标、决策、守卫、分叉、写作指示 ----------
const HOLDERS = 30;
const goalIds: string[] = [];
const goalPuts: WriteRequest["puts"] = [];
for (let h = 0; h < HOLDERS; h += 1) {
    for (let g = 0; g <= h % 3; g += 1) {
        const id = `tmp:g${String(h)}-${String(g)}`;
        goalIds.push(id);
        goalPuts.push({ref: {kind: "entry", id}, after: drafts.goal(id, `目标${String(h)}-${String(g)}`, person(h), {基于: [{id: point(h * 7 + g)}, {id: point(h * 7 + g + 1)}]})});
    }
}
const goals = await plot.publish(goalPuts);
const middle = chapterIds[Math.floor(chapters / 2)]!;
const guardAddress = (goal: string) => ({kind: MARK_IDS.guardAddress, version: 1, at: {entry: goal, path: "goal.状态"}, notIn: ["abandoned"], to: middle});
for (let i = 0; i < 50; i += 1) await plot.decision(`地址守卫 ${String(i)}`, {about: [], conclusion: "不放弃", marks: [guardAddress(goals[goalIds[i % goalIds.length]!]!)]});
for (let i = 0; i < 20; i += 1) await plot.decision(`读者守卫 ${String(i)}`, {about: [], conclusion: "不明说", marks: [{kind: MARK_IDS.guardReader, version: 1, point: point(i), atMost: "suspects", until: middle}]});
for (let i = 0; i < 30; i += 1) await plot.decision(`待定 ${String(i)}`, {about: [{kind: "entry", id: person(i)}], due: chapterIds[Math.min(chapters - 1, 100 + i * 20)]!});
for (let i = 0; i < 100; i += 1) await plot.decision(`已定 ${String(i)}`, {about: [{kind: "entry", id: person(i)}], conclusion: "照此写", reason: "作者定的"});
const forkPuts: WriteRequest["puts"] = forkCuts.map((cut, index) => ({ref: {kind: "change" as const, id: `tmp:fork${String(index)}`}, after: {...drafts.change(`tmp:fork${String(index)}`, {kind: "chapter", chapter: chapterIds.at(-1)!, key: 500 + index}), nature: "fork" as const, fork: {line: `tmp:line${String(index)}`, name: `分叉${String(index)}`, parent: "main", cut, type: "branch" as const}}}));
await plot.publish(forkPuts);
const instructions = new Map<string, InstructionSnapshot>();
for (let n = 1; n <= Math.min(100, chapters); n += 1) instructions.set(chapterIds[n - 1]!, {chapter: chapterIds[n - 1]!, version: "v1", pov: {kind: "entry", id: person(n)}, avoid: ["别写天气"], other: n % 2 === 0 ? "语气冷一点" : "语气暖一点"});
const allCompute = {...knowingDiagnostics(), ...foreshadowDiagnostics(), ...goalDiagnostics(), ...decisionDiagnostics(), ...guardDiagnostics((text) => new Bun.CryptoHasher("sha256").update(text).digest("hex")), ...instructionDiagnostics({all: () => [...instructions.values()]})};

// ---------- 读待处理时剧情插件全部诊断 ----------
// 产品里剧情插件的项目入口经 canon 的项目内接口登记；这里直接在服务上登记同一组计算。
service.registerDiagnostics(PLOT_PLUGIN_ID, {compute: allCompute, dataVersion: "scale"});
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
    timings = [...service.status().diagnosticTimings].slice(-Object.keys(allCompute).length);
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

// 开写前的视图与写手的上下文（只记录，不设预算）。
const digest = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
started = performance.now();
const before = beforeWriting(snapshot.view, last, digest);
const beforeMs = performance.now() - started;
started = performance.now();
const brief = composeBrief({view: snapshot.view, chapter: last, outline: "细纲", targetWords: 2000, pluginVersion: "scale", digest, ...(instructions.get(last) === undefined ? {} : {instruction: instructions.get(last)!})});
const briefMs = performance.now() - started;

Bun.gc(true);
const heap = process.memoryUsage().heapUsed / 1024 / 1024;
service.closeView(opened.token);

// ---------- 阶段 F：写完以后的检查（1000 章都有检查记录） ----------
// 模型是立刻回答的替身：这里量的是圈候选、拼输入、校验有效性，不是模型。Spec 没给校验定预算（只要求按这个规模量），下面的参考数是作者定的。
const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
// 让检查的路径都走到：带答案与物件的悬念、未兑现的与改两个条目的计划、活页夹里讲到的子线。没有这些，试读的材料、按线取结论都量不到。
const THINGS = 10;
const reveal = (id: string): Mark => ({kind: MARK_IDS.reveal, version: 1, point: id, mode: "explicit"});
const thingIds = await plot.publish(Array.from({length: THINGS}, (_, index) => ({ref: {kind: "entry" as const, id: `tmp:thing${String(index)}`}, after: drafts.thing(`tmp:thing${String(index)}`, `物件${String(index)}`)})));
const thing = (index: number) => thingIds[`tmp:thing${String(index % THINGS)}`]!;
const mysteryIds = await plot.publish(Array.from({length: THINGS}, (_, index) => ({ref: {kind: "entry" as const, id: `tmp:mystery${String(index)}`}, after: drafts.foreshadow(`tmp:mystery${String(index)}`, `悬念${String(index)}`, {种类: "mystery", 答案: {ref: point(index)}, 物件: [{id: thing(index)}]})})));
const mystery = (index: number) => mysteryIds[`tmp:mystery${String(index % THINGS)}`]!;
const richPuts: WriteRequest["puts"] = [];
for (let n = 1; n <= chapters; n += 1) {
    const chapter = chapterIds[n - 1]!;
    if (n % 3 === 0) {
        const id = `tmp:plan${String(n)}`;
        richPuts.push({ref: {kind: "change", id}, after: drafts.change(id, {kind: "chapter", chapter, key: 600}, {kind: "plan", told: [{source: "outline", chapter, anchor: "细纲", marks: [reveal(point(n))]}]})});
    }
    if (n % 50 === 0) {
        const id = `tmp:linked${String(n)}`;
        richPuts.push({ref: {kind: "change", id}, after: drafts.change(id, {kind: "chapter", chapter, key: 610}, {kind: "plan", patches: [{op: "set", at: {entry: point(n + 1), path: "point.保密"}, value: "topSecret"}, {op: "set", at: {entry: thing(n), path: "character.状态"}, value: "变了"}]})});
    }
    if (n % 40 === 0) {
        const id = `tmp:node${String(n)}`;
        richPuts.push({ref: {kind: "change", id}, after: drafts.change(id, {kind: "chapter", chapter, key: 620}, {told: [{source: "chapter", chapter, quote: `第${String(n)}章第2句`, marks: [{kind: MARK_IDS.node, version: 1, foreshadow: mystery(n / 40), role: "echo"}]}]})});
    }
}
await plot.publish(richPuts);
const toldForkChapter = chapterIds[Math.floor(chapters * 0.3)]!;
const toldFork = await plot.publish([{ref: {kind: "change", id: "tmp:toldFork"}, after: {...drafts.change("tmp:toldFork", {kind: "chapter", chapter: toldForkChapter, key: 700}), nature: "fork" as const, fork: {line: "tmp:toldLine", name: "讲到的子线", parent: "main", cut: forkCuts[0]!, type: "branch" as const}}}]);
const toldLine = toldFork["tmp:toldLine"]!;
const binderLines = new Map<string, {line: string; from: number}[]>();
for (let n = Math.floor(chapters * 0.3) + 2; n <= Math.floor(chapters * 0.3) + 11; n += 1) {
    const chapter = chapterIds[n - 1]!;
    binderLines.set(chapter, n % 2 === 0 ? [{line: toldLine, from: 1}] : [{line: "main", from: 1}, {line: toldLine, from: 2}]);
    await plot.change({kind: "chapter", chapter, key: 0, line: toldLine}, {cast: [present(person(n)), present(person(n + 1))]});
}
// 再讲四条子线，每条两章：超过常驻名额（3 条）时，逐条问结论会让线反复淘汰重建，依赖摘要要按线一次取完。
for (let extra = 0; extra < 4; extra += 1) {
    const at = Math.floor(chapters * 0.76) + extra * 10;
    const forkId = `tmp:toldFork${String(extra)}`;
    const line = (await plot.publish([{ref: {kind: "change", id: forkId}, after: {...drafts.change(forkId, {kind: "chapter", chapter: chapterIds[at]!, key: 700}), nature: "fork" as const, fork: {line: `tmp:toldLine${String(extra)}`, name: `讲到的子线${String(extra)}`, parent: "main", cut: forkCuts[2]!, type: "branch" as const}}}]))[`tmp:toldLine${String(extra)}`]!;
    for (const offset of [2, 3]) {
        const chapter = chapterIds[at + offset]!;
        binderLines.set(chapter, [{line, from: 1}]);
        await plot.change({kind: "chapter", chapter, key: 0, line}, {patches: [addRow(person(at + offset + 100), point(at + offset + 300), {程度: "knows"})], cast: [present(person(at + offset))]});
    }
}
await service.setChapters(chapterIds, binderLines);
const padding = Array.from({length: 30}, (_, index) => `这是第 ${String(index)} 段铺陈的文字，让一章有接近真实的长度，大约一百个字上下，写的都是些不相干的日常。`.repeat(1)).join("\n");
for (const id of chapterIds) plot.texts.set(id, `${plot.texts.get(id) ?? ""}${padding}\n`);
service.textChanged();
const instantModels: CheckModels = {
    available: () => Promise.resolve(null),
    ask: (_role, request) => Promise.resolve({ok: true, answer: request.answer === "yesNo" ? {answer: "no", quotes: []} : request.answer === "object" ? {moved: "no", quotes: [], before: "", after: "", who: ""} : request.answer === "fixed" ? {items: [], newFacts: []} : request.answer === "trial" ? {guess: "", confidence: "none", quotes: []} : {verdict: "inconsistent"}, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null}}),
};
const recordsByChapter = new Map<string, CheckRecord>();
const emptySelf = {get: () => undefined, digestOf: () => undefined};
const checkInstructions = {get: (chapter: string) => instructions.get(chapter), digestOf: (chapter: string) => (instructions.has(chapter) ? sha(JSON.stringify(instructions.get(chapter))) : undefined)};
/** 记录的内容摘要：产品里按行存着（`ChapterTable.digestOf`），这里同样不把整条记录重算一遍。 */
const recordDigests = new Map<CheckRecord, string>();
const recordDigest = (record: CheckRecord) => {
    const known = recordDigests.get(record);
    if (known !== undefined) return known;
    const made = sha(JSON.stringify(record));
    recordDigests.set(record, made);
    return made;
};
const dependenciesByChapter = new Map<string, CheckDependencies>();
const checkSource = createCheckSource({records: {all: () => [...recordsByChapter.values()]}, recordDigest, dependencies: {get: (chapter) => dependenciesByChapter.get(chapter)}, instructions: checkInstructions, selfReports: emptySelf, pluginVersion: "scale", digest: sha, warn: (event, detail) => { throw new Error(`${event} ${detail}`); }, writeBack: (updated) => {
    dependenciesByChapter.set(updated.chapter, updated);
}});
const planned: number[] = [];
const beforeRecords = process.memoryUsage().heapUsed;
const startedChecks = performance.now();
const limiter = createLimiter(4);
for (const id of chapterIds) {
    const snap = service.snapshot();
    const instruction = instructions.get(id);
    const begin = performance.now();
    const plan = planCheck({view: snap.view, chapter: id, followUps: [], digest: sha, ...(instruction === undefined ? {} : {instruction})});
    planned.push(performance.now() - begin);
    if ("code" in plan) throw new Error(plan.code);
    const dependencies = checkSource.dependencies(snap.view, id, [], plan) ?? "";
    const names = namesOfSegments(snap.view, id, instruction);
    const result = await runCheck({plan, models: instantModels, limiter, signal: new AbortController().signal, digest: sha, followUps: [], names, start: {worldVersion: snap.view.version, textDigest: null, pluginVersion: "scale"}});
    if (!result.ok) throw new Error(result.code);
    recordsByChapter.set(id, result.record);
    dependenciesByChapter.set(id, {chapter: id, of: recordDigest(result.record), dependencies, points: [...plan.points], concerns: [...plan.concerns]});
}
const checksGenerated = performance.now() - startedChecks;
Bun.gc(true);
const recordsHeap = (process.memoryUsage().heapUsed - beforeRecords) / 1024 / 1024;
const recordBytes = [...recordsByChapter.values()].reduce((sum, record) => sum + JSON.stringify(record).length, 0);
// 这个世界上不算检查诊断的基线：(a) 要和它比，和前面那个没有计划与子线的世界比不出来。
const baselineReads: number[] = [];
for (let round = 0; round < 3; round += 1) {
    await plot.change({kind: "chapter", chapter: last, key: 4_900 + round}, {text: "基线"});
    const begin = performance.now();
    if (typeof service.pending({}, undefined, 50) === "string") throw new Error("pending");
    baselineReads.push(performance.now() - begin);
}
service.registerDiagnostics(PLOT_PLUGIN_ID, {compute: {...allCompute, ...checkDiagnostics(checkSource, sha)}, dataVersion: "scale-f"});
const readPending = () => {
    const begin = performance.now();
    const page = service.pending({}, undefined, 50);
    if (typeof page === "string") throw new Error(page);
    return {ms: performance.now() - begin, stale: page.counts};
};
readPending();
const CHECK_IDS = new Set(Object.keys(checkDiagnostics(checkSource, sha)));
/** 最近一次读待处理里检查这几个诊断的耗时。 */
const checkTiming = () => service.status().diagnosticTimings.slice(-(Object.keys(allCompute).length + CHECK_IDS.size)).filter((timing) => CHECK_IDS.has(timing.diagnostic)).reduce((sum, timing) => sum + timing.ms, 0);
const scenario = async (name: string, edit: () => Promise<unknown>): Promise<string> => {
    // 重拼的章数：摘要对不上的都重拼，重拼后过期的不回写，所以不能数回写。
    const rows = [...dependenciesByChapter.values()];
    await edit();
    const first = readPending();
    const view = service.snapshot().view;
    const replanned = rows.filter((row) => checkSource.dependencies(view, row.chapter, [], row) !== row.dependencies).length;
    return `${name}：读待处理 ${ms(first.ms)} 毫秒（其中检查的诊断 ${ms(checkTiming())}），重拼 ${String(replanned)} 章`;
};
const checkReports: string[] = [];
checkReports.push(await scenario("(a) 在最新一章发布一次", () => plot.change({kind: "chapter", chapter: last, key: 5_000}, {text: "补一句"})));
checkReports.push(await scenario("(a2) 再发布一次", () => plot.change({kind: "chapter", chapter: last, key: 5_001}, {text: "补一句"})));
{
    // 别的会话占着 CPU 时单次不可信：多跑几轮取最小的。
    const [folds, sweeps]: [number[], number[]] = [[], []];
    const stored = [...dependenciesByChapter.values()];
    for (let round = 0; round < 6; round += 1) {
        await plot.change({kind: "chapter", chapter: last, key: 5_010 + round}, {text: "补一句"});
        const view = service.snapshot().view;
        const foldBegin = performance.now();
        checkSource.dependencies(view, stored[0]!.chapter, [], stored[0]!);
        folds.push(performance.now() - foldBegin);
        const sweepBegin = performance.now();
        for (const row of stored) checkSource.dependencies(view, row.chapter, [], row);
        sweeps.push(performance.now() - sweepBegin);
    }
    checkReports.push(`（发布以后摘要的开销，六轮取最小：建折叠 ${ms(Math.min(...folds))} 毫秒，${String(stored.length)} 章各算一次 ${ms(Math.min(...sweeps))} 毫秒；不算检查诊断的基线读待处理 ${baselineReads.map(ms).join("、")} 毫秒）`);
    readPending();
}
checkReports.push(await scenario("(c) 改第 500 章的一条变更", () => plot.change({kind: "chapter", chapter: chapterIds[Math.floor(chapterIds.length / 2)]!, key: 5_002}, {text: "中间补一句"})));
checkReports.push(await scenario("(c2) 这之后再在最新一章发布一次", () => plot.change({kind: "chapter", chapter: last, key: 5_003}, {text: "补一句"})));
const frequent = person(1);
const storedPerson = service.world.data.entries.get(frequent)!;
checkReports.push(await scenario("(b) 改一个条目的 folder（计划不读）", () => plot.publish([{ref: {kind: "entry", id: frequent}, after: {...storedPerson, folder: "改过的"}}])));
const editInit = (id: string, fields: Partial<typeof storedPerson.init>) => {
    const stored = service.world.data.entries.get(id)!;
    return plot.publish([{ref: {kind: "entry", id}, after: {...stored, init: {...stored.init, ...fields}}}]);
};
checkReports.push(await scenario("(e) 改一个常出场条目的简介", () => editInit(frequent, {summary: "改过的简介"})));
const fifth = chapterIds[Math.floor(chapterIds.length / 2)]!;
checkReports.push(await scenario("(f) 改第 500 章的正文（段落与引文都没动）", async () => {
    plot.texts.set(fifth, plot.texts.get(fifth)!.replace("不相干的日常", "不相干的琐事"));
    service.textChanged(fifth);
}));
checkReports.push(await scenario("(g) 第 500 章加一条变更，两个人在场", () => plot.change({kind: "chapter", chapter: fifth, key: 5_004}, {cast: [present(person(3)), present(person(4))]})));
checkReports.push(await scenario("(h) 第 500 章加一个伏笔节点", () => plot.change({kind: "chapter", chapter: fifth, key: 5_005}, {told: [{source: "chapter", chapter: fifth, quote: `第${String(Math.floor(chapterIds.length / 2) + 1)}章第0句`, marks: [{kind: MARK_IDS.node, version: 1, foreshadow: mystery(1), role: "echo"}]}]})));
checkReports.push(await scenario("(i) 新建一个知识点，没写出场", () => plot.point("新的秘密", person(5), {保密: "secret"})));
checkReports.push(await scenario("(j) 新建一个知识点，出场在最新一章", () => plot.entry({...drafts.point("tmp:latest", "最新的秘密", person(5), {保密: "secret"}), appears: {kind: "chapter", chapter: last, key: 0}})));
// (d) 重启后第一次读：对象摘要的缓存是空的（换一个摘要函数），结论的缓存也是空的。
const coldDigest = (text: string) => sha(text);
const coldSource = createCheckSource({records: {all: () => [...recordsByChapter.values()]}, recordDigest, dependencies: {get: (chapter) => dependenciesByChapter.get(chapter)}, instructions: checkInstructions, selfReports: emptySelf, pluginVersion: "scale", digest: coldDigest, warn: (event, detail) => { throw new Error(`${event} ${detail}`); }, writeBack: () => undefined});
const coldBegin = performance.now();
const coldFold = coldSource.dependencies(service.snapshot().view, last, [], {points: [], concerns: []});
const coldMs = performance.now() - coldBegin;
const restWarm = performance.now();
for (const record of recordsByChapter.values()) coldSource.valid(service.snapshot().view, record);
const coldAll = performance.now() - restWarm;
checkReports.push(`(d) 重启后第一次读：算全书的滚动摘要 ${ms(coldMs)} 毫秒（${coldFold === null ? "无" : "有"}），1000 章各比一次 ${ms(coldAll)} 毫秒（摘要都对得上就不重拼）`);
// 激活时读回：真实的分区库。
const storeRoot = await mkdtemp(join(tmpdir(), "plot-scale-store-"));
const loadReports: string[] = [];
const consumer = {plugin: "nbook.plot", instanceId: "project-1", entry: "project", client: null, location: "project"} as never;
for (const [count, bytes] of [[100, 1024], [1000, 1024], [100, 64 * 1024], [1000, 64 * 1024]] as const) {
    const path = join(storeRoot, `${String(count)}-${String(bytes)}.sqlite`);
    const open = () => {
        const owner = createPartitionOwner(createPartition({path}), "project", () => undefined);
        return {owner, service: createStorageFacade(consumer, {user: () => ({ok: false, code: "no-project", detail: ""}), project: () => owner.route(consumer)}).service};
    };
    const first = open();
    const writer = new PlotStore(first.service, () => undefined);
    const tables = ["plot-a", "plot-b", "plot-c"].map((key) => writer.table<{chapter: string; body: string}>({key, shape: 1, schema: Type.Object({chapter: Type.String(), body: Type.String()})}));
    const failed = await writer.load();
    if (failed !== null) throw new Error(failed.detail);
    const body = "字".repeat(Math.floor(bytes / 3));
    for (let index = 0; index < count; index += 1) {
        const chapter = `c${String(index)}`;
        for (const table of tables) await writer.queued(() => writer.write(table, chapter, {chapter, body}));
    }
    first.owner.close();
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    const second = open();
    const reader = new PlotStore(second.service, () => undefined);
    for (const key of ["plot-a", "plot-b", "plot-c"]) reader.table<{chapter: string; body: string}>({key, shape: 1, schema: Type.Object({chapter: Type.String(), body: Type.String()})});
    const begin = performance.now();
    const loadFailed = await reader.load();
    const took = performance.now() - begin;
    if (loadFailed !== null) throw new Error(loadFailed.detail);
    Bun.gc(true);
    loadReports.push(`${String(count)} 章、每张表每章 ${String(bytes / 1024)} KiB：读回 ${ms(took)} 毫秒，堆增加 ${ms((process.memoryUsage().heapUsed - before) / 1024 / 1024)} MB`);
    second.owner.close();
}
// 回写的存储：只写摘要表，1000 章（一行约 1 KiB），真实的分区库。
{
    const path = join(storeRoot, "dependencies.sqlite");
    const owner = createPartitionOwner(createPartition({path}), "project", () => undefined);
    const writer = new PlotStore(createStorageFacade(consumer, {user: () => ({ok: false, code: "no-project", detail: ""}), project: () => owner.route(consumer)}).service, () => undefined);
    const table = writer.table<CheckDependencies>({key: "plot-check-deps", shape: 1, schema: CheckDependenciesSchema, cache: true});
    if ((await writer.load()) !== null) throw new Error("load");
    const rows = [...dependenciesByChapter.values()];
    for (const row of rows) await writer.queued(() => writer.write(table, row.chapter, row));
    const begin = performance.now();
    for (const row of rows) await writer.queued(() => writer.write(table, row.chapter, {...row, dependencies: `${row.dependencies}x`}));
    const took = performance.now() - begin;
    loadReports.push(`回写 ${String(rows.length)} 章的摘要（一行平均 ${ms(rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0) / rows.length / 1024)} KiB）：${ms(took)} 毫秒`);
    owner.close();
}
await rm(storeRoot, {recursive: true, force: true});
await plot.stop();
await rm(root, {recursive: true, force: true});

const uptime = (await Bun.$`uptime`.text()).trim();
const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5).map((timing) => `${timing.diagnostic.replace(`${PLOT_PLUGIN_ID}.`, "")} ${ms(timing.ms)}`).join("，");
console.log(`剧情规模（${String(chapters)} 章，${String(PEOPLE)} 人，${String(POINTS)} 个知识点，${String(FORESHADOWS)} 个伏笔，${String(goalIds.length)} 个目标，200 条决策，3 条分叉线，版本 ${String(version)}）`);
console.log(`负载：${uptime}`);
console.log(`生成（每章一次发布）：${ms(generated / 1000)} 秒`);
console.log(`读待处理（含剧情插件全部诊断，发布后第一次读）：第一次 ${ms(pendingReads[0]!)} 毫秒，之后中位 ${ms(median(pendingReads.slice(1)))}，最大 ${ms(Math.max(...pendingReads.slice(1)))}（预算 200）；计数 ${JSON.stringify(counts)}`);
console.log(`诊断耗时（最后一轮，最慢的 5 个，毫秒）：${slowest}；合计 ${ms(timings.reduce((sum, timing) => sum + timing.ms, 0))}`);
console.log(`发布后引擎追上新版本（第一次读取）：中位 ${ms(median(catchUps))} 毫秒，最大 ${ms(Math.max(...catchUps))}`);
console.log(`按视角读挂了 20 个保密知识点的条目（取快照、建视图、读；预算 20）：引擎追上以后第一次中位 ${ms(median(coldReads))} 毫秒，最大 ${ms(Math.max(...coldReads))}；同一份输入上再读中位 ${ms(median(warmReads))}，最大 ${ms(Math.max(...warmReads))}；读到的子条目 ${String(children)} 个`);
console.log(`伏笔账本：${ms(ledgerMs)} 毫秒（${String(items.length)} 项）`);
console.log(`开写前的视图 ${ms(beforeMs)} 毫秒（${typeof before === "string" ? before : String(before.lines.length)} 条线）；写手的上下文 ${ms(briefMs)} 毫秒（${typeof brief === "string" ? brief : String(brief.text.length)} 字）`);
console.log(`堆：${ms(heap)} MB`);
console.log(`\n阶段 F：planCheck 一章中位 ${ms(median(planned))} 毫秒，最大 ${ms(Math.max(...planned))}；生成 ${String(recordsByChapter.size)} 章的记录 ${ms(checksGenerated / 1000)} 秒；记录合计 ${ms(recordBytes / 1024 / 1024)} MB JSON，堆增加 ${ms(recordsHeap)} MB`);
for (const line of checkReports) console.log(line);
console.log("激活时读回：");
for (const line of loadReports) console.log(`  ${line}`);
