/**
 * 打开与归约的测量（t20 第 3 片的出口；第 11 片扩成提案第 19 节的六项）：用存储直接写一份合成日志，再经 `openSession`
 * 走完整的打开（读、校验、装配、归约、恢复、装上），量耗时、堆上活数据与常驻增量。每组单独一个进程。
 *
 * 用法：bun tests/kernel/measure-open.ts <轮数> [每条回复的字数]
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {heapStats} from "bun:jsc";
import {closeSession, createJsonlStore, openSession} from "@notnotype/nb-harness/kernel";
import {syntheticEnv, writeSyntheticLog} from "./synthetic-log.js";

const turns = Number(process.argv[2] ?? "2000");
const replyChars = Number(process.argv[3] ?? "1500");
const root = await mkdtemp(join(tmpdir(), "nb-kernel-open-"));
const store = createJsonlStore({root});
await writeSyntheticLog(store, "measure", turns, replyChars);
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
console.log(JSON.stringify({turns, events: snapshot.head, replyChars, openMs: Math.round(openMs), openHeapMB: Math.round((heapAfter - heapBefore) / 1e6), openRssMB: Math.round((rssAfter - rssBefore) / 1e6)}));
await closeSession(opened.value);
await rm(root, {recursive: true, force: true});
