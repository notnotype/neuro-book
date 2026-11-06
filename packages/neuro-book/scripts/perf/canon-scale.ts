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
 * 时间说法（canon.time 输出 11）：三成的已写变更带一到两条说法——每章算一天（从 2000 年 1 月 1 日起），按变更轮到的位置给日期（到日）、
 * “在本章上一件之后 0 到 1 天”、日期加“持续 1 到 5 小时”或常出场的第一个人的年龄（前史里有他 1980 年的出生）。另量打开后第一次
 * 时间查询（冷建网，预算 1 秒）、之后的查询（20 毫秒）与读待处理；“发布一次记账”含为新数据建网。
 *
 * 世界线（canon.worldlines 输出 15，`--fork`）：在中间那章开一条回溯分叉，子线上另有后半部分各章的记账（形状同主线、不带核对点与新条目），
 * 再量：建子线的视图并第一次读（预算 2 秒）、在已建好的线上随机读（同读取预算）、主线最新一章发布一次记账而子线已建（不在子线的依赖范围里，
 * 子线不更新）、改常出场条目的初值（所有线都受影响）；最后重新打开（子线没建）写一条落在继承区间里的记录，量预览与发布（当场建改前改后两份）。
 *
 * 日志分段（场景 6）：除了独占一段的超长行，段大小都不超过 256 KiB 加一行；不满足时脚本以非零码退出。
 *
 * 用法（应用包目录）：bun scripts/perf/canon-scale.ts [章数=1000] [--diverge] [--fork]
 * 测量前看 `uptime`：负载高时多跑几次按较低的一端判断，不与 omp 审查同时跑。
 */

import {mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import type {Entry, ReadPosition, StoryChangeDraft, WriteRequest} from "@notnotype/nb-canon";
import {SEGMENT_LIMIT, type WorldService} from "@notnotype/nb-canon/node";

import {createWorldHost} from "nbook/plugins/canon/backend/world-host";
import {BINDER_DIR} from "nbook/plugins/canon/backend/binder";
import {BUILTIN_COMPONENTS} from "nbook/plugins/canon/shared/components";

const chapters = Number(process.argv.find((arg) => /^\d+$/u.test(arg)) ?? 1000);
const divergeFrom = process.argv.includes("--diverge") ? Math.floor(chapters / 2) : Number.POSITIVE_INFINITY;
const fork = process.argv.includes("--fork");
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
/** 带说法的变更的临时 id（发布后换成正式 id，查询时挑着用）。 */
let dated: string[] = [];
const datedIds: string[] = [];
const author = {kind: "author"} as const;
/** 第 n 章那一天（从 2000 年 1 月 1 日起每章一天）的公历年月日。 */
function dayOf(n: number): {year: number; month: string; day: number} {
    const date = new Date(Date.UTC(2000, 0, 1) + (n - 1) * 86_400_000);
    return {year: date.getUTCFullYear(), month: `m${String(date.getUTCMonth() + 1)}`, day: date.getUTCDate()};
}
/** 第 n 章第 i 条已写变更的说法：三成带，形状见文件头。 */
function timeOf(n: number, i: number, previous: string, person: string): {when?: StoryChangeDraft["when"]} {
    const r = (n * 15 + i) % 10;
    if (r > 2) return {};
    const date = {kind: "date" as const, ...dayOf(n), basis: author};
    if (r === 0) return {when: [date]};
    if (r === 1) return i === 0 ? {when: [date]} : {when: [{kind: "after", of: previous, gap: {min: 0, max: 1, unit: "day"}, basis: author}]};
    const year = dayOf(n).year;
    return {when: [date, (n + i) % 2 === 0 ? {kind: "lasts", lasts: {min: 1, max: 5, unit: "hour"}, basis: author} : {kind: "age", who: person, years: {min: year - 1981, max: year - 1980}, basis: author}]};
}
/** 第一个常出场条目的存款：每次写入按本次的转账推进，核对点照它写。 */
let balance = 1_000_000;
/**
 * 一章的记账：5 个计划（前 4 个由本次的已写变更兑现）、15 条已写变更、2 个核对点，偶数章另建一个条目。
 * `base` 是本次记录的排序键起点：在最新一章反复补记时每次往后挪，新记录与核对点都在本章已有的之后。
 */
function bookkeeping(service: WorldService, chapter: string, hot: readonly string[], n: number, base = 0, line?: string): WriteRequest {
    const puts: WriteRequest["puts"] = [];
    // 子线上的记账：记录安放在这条线上，不带核对点与新条目（核对点写的是主线的存款）。
    const placed = (key: number) => ({kind: "chapter" as const, chapter, key, ...(line === undefined ? {} : {line})});
    const plans: string[] = [];
    for (let i = 0; i < 5; i += 1) {
        const id = `tmp:p${String(++sequence)}`;
        plans.push(id);
        const plan: StoryChangeDraft = {id, kind: "plan", text: "计划", at: placed(base + i * 10), told: [], involves: [hot[i % 5]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.魔力"}, value: -10, basis: {kind: "estimate", note: "计划"}}], status: "active", by: {kind: "author"}};
        puts.push({ref: {kind: "change", id}, after: plan});
    }
    for (let i = 0; i < 15; i += 1) {
        const id = `tmp:w${String(++sequence)}`;
        const from = hot[i % 5]!;
        const to = hot[(i + 1) % 5]!;
        const change: StoryChangeDraft = {
            id, kind: "written", text: "情节", at: placed(base + i * 10), told: [{source: "chapter", chapter, quote: "原句"}], involves: [from, to], lines: [],
            links: i < 4 ? [{kind: "fulfills", plan: plans[i]!}] : [],
            patches: [
                {op: "add", at: {entry: from, path: "panel.存款"}, value: -(100 + i), basis: {kind: "estimate", note: "规模测量"}},
                {op: "add", at: {entry: to, path: "panel.存款"}, value: 100 + i, basis: {kind: "estimate", note: "规模测量"}},
                ...(i % 3 === 0 ? [{op: "note" as const, at: {entry: from, path: "character.态度"}, value: `第 ${String(n)} 章：软了一点`}] : []),
            ],
            status: "active", by: {kind: "agent", session: "记账"},
            ...timeOf(n, i, `tmp:w${String(sequence - 1)}`, hot[0]!),
        };
        puts.push({ref: {kind: "change", id}, after: change});
        if (timeOf(n, i, "", "").when !== undefined) dated.push(id);
    }
    // 第一个常出场条目在第 i 条变更里转出（i % 5 == 0）或转入（i % 5 == 4）100 + i。
    const delta = (i: number) => (i % 5 === 0 ? -(100 + i) : i % 5 === 4 ? 100 + i : 0);
    const written = (through: number) => balance + Array.from({length: 15}, (_, i) => i).filter((i) => i * 10 < through).reduce((sum, i) => sum + delta(i), 0) + (n >= divergeFrom ? 1_700 : 0);
    for (const key of line === undefined ? [55, 155] : []) {
        const id = `tmp:k${String(++sequence)}`;
        puts.push({ref: {kind: "check", id}, after: {id, at: {entry: hot[0]!, path: "panel.存款"}, value: written(key), told: {source: "chapter", chapter, quote: "原句"}, place: {kind: "chapter", chapter, key: base + key}}});
    }
    if (line === undefined) balance = written(Number.POSITIVE_INFINITY) - (n >= divergeFrom ? 1_700 : 0);
    if (line === undefined && n % 2 === 0) {
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
// 常出场的第一个人 1980 年出生（前史），年龄说法连到它。
await publish(first.service, {requestId: "scale-birth", by: author, what: "edit", title: "出生", baseVersion: first.service.status().version, puts: [{ref: {kind: "change", id: "tmp:birth"}, after: {id: "tmp:birth", kind: "written", text: "出生", at: {kind: "prehistory", order: 0}, told: [], involves: [hot[0]!], lines: [], links: [], patches: [], status: "active", by: author, when: [{kind: "birth", who: hot[0]!, basis: author}, {kind: "date", year: 1980, month: "m1", day: 1, basis: author}]}}]});
for (let n = 1; n <= chapters; n += 1) {
    dated = [];
    const ids = await publish(first.service, bookkeeping(first.service, chapterIds[n - 1]!, hot, n));
    for (const temp of dated) datedIds.push(ids[temp]!);
}
// 世界线：中间那章第 1 条已写变更为切口、第 5 条为触发处的回溯分叉，子线上记后半部分各章。
let forkLine = "";
if (fork) {
    const mid = Math.floor(chapters / 2);
    const inChapter = first.service.changes({chapter: chapterIds[mid - 1]!, kind: "written"}, undefined, 20);
    if (typeof inChapter === "string") throw new Error(inChapter);
    const [cut, trigger] = [inChapter.items[0]!.change.id, inChapter.items[4]!.change.id];
    const forkChange: StoryChangeDraft = {id: "tmp:fork", kind: "written", text: "回溯", at: {kind: "chapter", chapter: chapterIds[mid - 1]!, key: 9_999}, told: [], involves: [hot[0]!], lines: [], links: [], patches: [], status: "active", by: author, nature: "fork", fork: {line: "tmp:line", name: "回溯", parent: "main", cut, trigger, type: "rollback", who: hot[0]!}};
    const forkIds = await publish(first.service, {requestId: "scale-fork", by: author, what: "edit", title: "回溯分叉", baseVersion: first.service.status().version, puts: [{ref: {kind: "change", id: "tmp:fork"}, after: forkChange}]});
    forkLine = forkIds["tmp:line"]!;
    for (let n = mid + 1; n <= chapters; n += 1) await publish(first.service, bookkeeping(first.service, chapterIds[n - 1]!, hot, n, 0, forkLine));
}
const generated = performance.now() - started;
const version = first.service.status().version;
await first.stop();

const logDir = join(root, ".nbook", "world", "log");
const segments = (await readdir(logDir)).filter((name) => name.endsWith(".jsonl"));
const logBytes = (await Promise.all(segments.map(async (name) => (await stat(join(logDir, name))).size))).reduce((sum, size) => sum + size, 0);
// 场景 6：除了独占一段的超长行，段大小都不超过 256 KiB 加一行（project.md 输出 3）。不满足时脚本以非零码退出。
const oversizedSegments: string[] = [];
for (const name of segments) {
    const lines = (await readFile(join(logDir, name))).toString("utf8").split("\n").filter((line) => line !== "");
    if (lines.length <= 1) continue;
    const size = (await stat(join(logDir, name))).size;
    const longest = Math.max(...lines.map((line) => Buffer.byteLength(line) + 1));
    if (size > SEGMENT_LIMIT + longest) oversizedSegments.push(`${name}：${String(size)} 字节，最长一行 ${String(longest)} 字节`);
}

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

// ---------- 讲述（canon.model 输出 24 到 27） ----------
// 不带筛选的第一页要定位全部讲述（每章 17 条）再排序；第一次读要把每章正文切成段，之后按章缓存。
const tellingsPage = (filter: Parameters<WorldService["tellings"]>[0] = {}): number => {
    const begin = performance.now();
    if (service.tellings(filter) === "cursor-stale") throw new Error("cursor-stale");
    return performance.now() - begin;
};
const tellingsFirst = tellingsPage();
const tellingsAll = Array.from({length: 10}, () => tellingsPage());
const tellingsOneChapter = Array.from({length: 10}, () => {
    const chapter = chapterIds[Math.floor(rnd() * chapterIds.length)]!;
    return tellingsPage({from: chapter, to: chapter});
});
// 宿主通知一章正文变了：重读这一章、重算正文快照的摘要；下一次读取只重新切这一章。
const edited = chapterIds[0]!;
await writeFile(join(root, BINDER_DIR, `${edited.padStart(5, "0")}-第${edited}章.md`), `第${edited}章。改过了。原句。${"正文".repeat(1500)}\n`);
const editBegin = performance.now();
service.textChanged(edited);
const textChangedMs = performance.now() - editBegin;
const tellingsAfterEdit = tellingsPage();

// ---------- 时间（canon.time 输出 11） ----------
started = performance.now();
const firstTime = service.time({kind: "event", change: datedIds[Math.floor(datedIds.length / 2)]!});
const timeColdMs = performance.now() - started;
if (firstTime === "cursor-stale") throw new Error("cursor-stale");
const timeReads = Array.from({length: 20}, () => {
    const begin = performance.now();
    service.time({kind: "event", change: datedIds[Math.floor(rnd() * datedIds.length)]!});
    return performance.now() - begin;
});
const ageBegin = performance.now();
const age = service.time({kind: "age", who: hot[0]!, at: datedIds.at(-1)!});
const ageMs = performance.now() - ageBegin;
const pendingBegin = performance.now();
const timePending = service.pending({}, undefined, 50);
const pendingMs = performance.now() - pendingBegin;
const timeItemCount = typeof timePending === "string" ? -1 : timePending.items.filter((item) => item.kind === "canon" && item.item.kind.startsWith("time-")).length;

// ---------- 世界线：建子线的视图并第一次读，之后在已建的线上随机读（`--fork`） ----------
let lineBuildMs = 0;
let lineReads: number[] = [];
if (fork) {
    const lastChapter = chapterIds.at(-1)!;
    const begin = performance.now();
    service.entry(hot[0]!, {kind: "chapter", chapter: lastChapter, edge: "end", line: forkLine}, "actual");
    lineBuildMs = performance.now() - begin;
    const half = Math.floor(chapters / 2);
    lineReads = Array.from({length: 50}, () => {
        const chapter = chapterIds[half + Math.floor(rnd() * (chapters - half))]!;
        const at = performance.now();
        service.entry(hot[Math.floor(rnd() * hot.length)]!, {kind: "chapter", chapter, edge: "end", line: forkLine}, "actual");
        return performance.now() - at;
    });
}

// ---------- 在最新一章发布一次记账（含校验、计算、写入落盘） ----------
const last = chapterIds.at(-1)!;
const publishes: number[] = [];
// `CANON_SCALE_PROFILE=publish`：只对这一段发布取调用栈采样，打印按文件与函数的自身耗时前几名（找发布慢在哪）。
const profiling = process.env.CANON_SCALE_PROFILE === "publish" ? await import("bun:jsc") : null;
profiling?.startSamplingProfiler();
for (let round = 0; round < 10; round += 1) {
    const request = bookkeeping(service, last, hot, chapters + 1 + round * 2, 1_000 * (round + 1));
    const begin = performance.now();
    await publish(service, request);
    publishes.push(performance.now() - begin);
    // 子线已建时：主线最新一章的记账不在子线的依赖范围里，子线不更新（输出 8、17）。
    if (fork && service.status().lines.updated.length > 0) throw new Error(`子线被更新了：${JSON.stringify(service.status().lines.updated)}`);
}

// 当前线是子线时（回溯以后的后半本）：在子线上发布一次记账（输出 15），子线要增量更新，不是整份重建。
const childPublishes: number[] = [];
if (fork) {
    for (let round = 0; round < 10; round += 1) {
        const request = bookkeeping(service, last, hot, chapters + 500 + round * 2, 50_000 * (round + 1), forkLine);
        const begin = performance.now();
        await publish(service, request);
        childPublishes.push(performance.now() - begin);
    }
}

if (profiling !== null) {
    const traces = (profiling as unknown as {samplingProfilerStackTraces: () => {traces?: unknown}}).samplingProfilerStackTraces();
    const counts = new Map<string, number>();
    for (const trace of (traces.traces ?? []) as Array<{frames?: Array<{name?: string; sourceID?: string; location?: string}>}>) {
        const top = trace.frames?.[0];
        if (top !== undefined) counts.set(`${top.name ?? "?"} ${top.location ?? ""}`, (counts.get(`${top.name ?? "?"} ${top.location ?? ""}`) ?? 0) + 1);
    }
    console.log([...counts].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([key, n]) => `${String(n)} ${key}`).join("\n"));
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

const pending = service.pending({}, undefined, Number.MAX_SAFE_INTEGER);
const pendingCount = typeof pending === "string" ? 0 : pending.counts.pending;
const suspectCount = typeof pending === "string" ? 0 : pending.items.reduce((sum, item) => sum + (item.kind === "canon" && item.item.kind === "check-mismatch" ? item.item.suspects.length : 0), 0);
Bun.gc(true);
const heap = process.memoryUsage().heapUsed / 1024 / 1024;
await stop();
// ---------- 世界线：改初值已量过（子线已建，要更新）；重新打开（子线没建）写一条落在继承区间里的记录，量预览与发布 ----------
let rangePreviewMs = 0;
let rangePublishMs = 0;
if (fork) {
    const reopened = await open();
    const inRange = chapterIds[Math.floor(chapters / 2) - 5]!;
    const request = (id: string): WriteRequest => ({requestId: `scale-range-${id}`, by: author, what: "edit", title: "写在继承区间里", baseVersion: reopened.service.status().version, puts: [{ref: {kind: "change", id: `tmp:${id}`}, after: {id: `tmp:${id}`, kind: "written", text: "补一笔", at: {kind: "chapter", chapter: inRange, key: 5_000}, told: [], involves: [hot[1]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[1]!, path: "panel.存款"}, value: -1, basis: author as never}], status: "active", by: author}}]});
    let began = performance.now();
    const preview = reopened.service.preview(request("a"));
    rangePreviewMs = performance.now() - began;
    if (!preview.ok) throw new Error(JSON.stringify(preview.failure));
    began = performance.now();
    await publish(reopened.service, request("b"));
    rangePublishMs = performance.now() - began;
    await reopened.stop();
}


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
console.log(`讲述（${String(chapters * 17)} 条）：不带筛选的第一页，第一次 ${ms(tellingsFirst)} 毫秒，之后中位 ${ms(median(tellingsAll))}；只读一章，中位 ${ms(median(tellingsOneChapter))}；改一章正文后通知 ${ms(textChangedMs)} 毫秒，接着读第一页 ${ms(tellingsAfterEdit)} 毫秒`);
console.log(`最新一章发布一次记账：中位 ${ms(median(publishes))} 毫秒，最大 ${ms(Math.max(...publishes))}（预算 100）`);
console.log(`改常出场条目的初值：中位 ${ms(median(initial))} 毫秒（预算 1000）`);
console.log(`待处理：${String(pendingCount)} 条，嫌疑记录共 ${String(suspectCount)} 条`);
console.log(`时间（${String(datedIds.length)} 条带说法的变更）：打开后第一次查询（冷建网）${ms(timeColdMs)} 毫秒（预算 1000），之后中位 ${ms(median(timeReads))}、最大 ${ms(Math.max(...timeReads))}（预算 20）；年龄 ${ms(ageMs)} 毫秒（${JSON.stringify((age as {answer: {text?: string}}).answer.text)}）；读待处理 ${ms(pendingMs)} 毫秒，时间的项 ${String(timeItemCount)} 条（第一页里）`);
if (fork) {
    console.log(`世界线（中间那章开回溯分叉，子线上另有 ${String(chapters - Math.floor(chapters / 2))} 章的记账）：建子线的视图并第一次读 ${ms(lineBuildMs)} 毫秒（预算 2000）；在已建的线上随机读，中位 ${ms(median(lineReads))}、最大 ${ms(Math.max(...lineReads))}（预算 20）`);
    console.log(`世界线：在子线上发布一次记账（子线已建、增量更新）：中位 ${ms(median(childPublishes))} 毫秒，最大 ${ms(Math.max(...childPublishes))}（预算 100）`);
    console.log(`世界线：主线最新一章发布记账、子线已建时子线不更新（见上面的断言）；写一条落在继承区间里的记录（子线没建，当场建改前改后各一份）：预览 ${ms(rangePreviewMs)} 毫秒，发布 ${ms(rangePublishMs)} 毫秒`);
}
console.log(`堆：${ms(heap)} MB`);
if (oversizedSegments.length > 0) {
    console.error(`日志分段超出上限（256 KiB 加一行）：${oversizedSegments.join("；")}`);
    process.exitCode = 1;
}
