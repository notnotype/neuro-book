/**
 * 打开与归约的测量（t20 第 3 片的出口；第 11 片扩成提案第 19 节的六项）：用存储直接写一份合成日志，再经 `openSession`
 * 走完整的打开（读、校验、装配、归约、恢复、装上），量耗时、堆上活数据与常驻增量。每组单独一个进程。
 *
 * 用法：bun tests/kernel/measure-open.ts <轮数> [每条回复的字数] [--unsettled]
 * `--unsettled`：最后一轮停在工具执行中，打开时要写恢复的结算（量“打开与恢复”）；不加时是完整收口的会话（冷打开）。
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {heapStats} from "bun:jsc";
import {closeSession, createJsonlStore, openSession, type LogEvent} from "@notnotype/nb-harness/kernel";
import {syntheticEnv, writeSyntheticLog} from "./synthetic-log.js";

const turns = Number(process.argv[2] ?? "2000");
const replyChars = Number(process.argv[3] ?? "1500");
const unsettled = process.argv.includes("--unsettled");
const root = await mkdtemp(join(tmpdir(), "nb-kernel-open-"));
const store = createJsonlStore({root});
await writeSyntheticLog(store, "measure", turns, replyChars, {unsettled});
const env = syntheticEnv(store);

Bun.gc(true);
const rssBefore = process.memoryUsage().rss;
const heapBefore = heapStats().heapSize;
const start = performance.now();
const opened = await openSession(env, "measure");
const openMs = performance.now() - start;
if (!opened.ok) throw new Error(opened.code);
Bun.gc(true);
const heapAfter = heapStats().heapSize;
const rssAfter = process.memoryUsage().rss;
const snapshot = await opened.value.snapshot();
// log 每页最多 2,000 条：按页读完。
const all: LogEvent[] = [];
for (let afterSeq = 0, more = true; more;) {
    const page = await opened.value.log({afterSeq, limit: 2000});
    all.push(...page.events);
    ({through: afterSeq, more} = page);
}
const tools = all.filter((event) => event.type === "toolResult").length;
console.log(JSON.stringify({turns, events: snapshot.head, replyChars, unsettled, toolResults: tools, recovered: all.at(-1)?.type === "runEnded" && (all.at(-1)!.data as {reason: string}).reason === "interrupted", openMs: Math.round(openMs), openHeapMB: Math.round((heapAfter - heapBefore) / 1e6), openRssMB: Math.round((rssAfter - rssBefore) / 1e6)}));
await closeSession(opened.value);
await rm(root, {recursive: true, force: true});
