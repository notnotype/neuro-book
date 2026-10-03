/**
 * 诊断文件出口的真实 I/O 验证：真实日志目录、真实 proper-lockfile 授予、真实轮转与保留。
 * 覆盖 runtime.diagnostics 验收 1（读回与位置冲突）、2（出口里的脱敏）、4（降级）、5（关闭不复活）、
 * 6（轮转与保留不越位置）。时间只注入到轮转命名与保留期，不 mock 文件系统。
 */

import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {afterEach, describe, expect, it, vi} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createDiagnosticsStore} from "nbook/runtime/diagnostics/diagnostics";
import type {DiagnosticsStore} from "nbook/runtime/diagnostics/diagnostics";

import {LOG_LOCATION_LOCK_NAME, createJsonlExporterFactory} from "./jsonl-exporter";
import type {JsonlExporterOptions} from "./jsonl-exporter";

const ROOTS: string[] = [];
const STORES: DiagnosticsStore[] = [];

afterEach(async () => {
    for (const store of STORES.splice(0)) {
        await store.shutdown().catch(() => undefined);
    }
    for (const root of ROOTS.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

async function tempRoot(): Promise<string> {
    const root = await createTestTmpRoot("nbook-diagnostics", "runtime-diagnostics");
    ROOTS.push(root);
    return root;
}

async function openStore(instanceId: string, options: JsonlExporterOptions, fallback = vi.fn()): Promise<DiagnosticsStore> {
    const store = createDiagnosticsStore({identity: {location: "server", instanceId}});
    STORES.push(store);
    const outcome = await createJsonlExporterFactory(options)({signal: new AbortController().signal});
    await store.attach({outcome, fallback});
    return store;
}

async function readLines(file: string): Promise<Array<Record<string, unknown>>> {
    const text = await readFile(file, "utf8");
    return text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("无遥测（验收 7）", () => {
    it("文件出口与浏览器 console 出口不导入任何网络模块，也不调用 fetch/WebSocket", async () => {
        const sources = [
            fileURLToPath(new URL("./jsonl-exporter.ts", import.meta.url)),
            fileURLToPath(new URL("../../app-logs/jsonl-log-writer.ts", import.meta.url)),
            fileURLToPath(new URL("../../../app/features/runtime-diagnostics/console-exporter.ts", import.meta.url)),
        ];
        for (const source of sources) {
            const code = await readFile(source, "utf8");
            const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]!);
            for (const specifier of specifiers) {
                expect(specifier, `${path.basename(source)} 导入了 ${specifier}`).not.toMatch(/^(?:node:)?(?:http|https|http2|net|tls|dgram|dns)$|undici|axios|ws$/u);
            }
            expect(code, `${path.basename(source)} 不得发起网络调用`).not.toMatch(/\bfetch\(|\bWebSocket\b|sendBeacon|XMLHttpRequest/u);
        }
    });
});

describe("文件出口：读回与位置授予", () => {
    it("A 写入后关闭可从文件读回，来源身份在 data.$source；B 同时请求同一位置降级且不写 A 的文件；A 释放后新实例可获同一位置", async () => {
        const directory = path.join(await tempRoot(), "logs");
        const a = await openStore("inst-a", {directory});
        expect(a.status()).toMatchObject({degraded: null, exporter: {kind: "jsonl", state: "open"}});
        a.record({level: "info", event: "a.hello", message: "from a", data: {n: 1}});
        await a.flush();

        const bFallback = vi.fn();
        const b = await openStore("inst-b", {directory}, bFallback);
        expect(b.status()).toMatchObject({degraded: {reason: "location-conflict"}});
        b.record({level: "error", event: "b.hello", message: "from b"});
        expect(b.query().records.map((record) => record.event)).toEqual(["b.hello"]);
        expect(bFallback).toHaveBeenCalledTimes(1);

        await a.shutdown();
        const lines = await readLines(path.join(directory, "server-current.jsonl"));
        expect(lines.map((line) => line.event)).toEqual(["a.hello"]);
        expect(lines[0]).toMatchObject({level: "info", message: "from a", data: {n: 1, $source: {location: "server", instanceId: "inst-a"}}});
        expect(existsSync(path.join(directory, LOG_LOCATION_LOCK_NAME))).toBe(false);

        const c = await openStore("inst-c", {directory});
        expect(c.status().degraded).toBeNull();
        c.record({level: "info", event: "c.hello", message: "from c"});
        await c.shutdown();
        // 新实例只查询自身缓冲，不重建 A 的历史。
        expect(c.query().records.map((record) => record.event)).toEqual(["c.hello"]);
        expect((await readLines(path.join(directory, "server-current.jsonl"))).map((line) => line.event)).toEqual(["a.hello", "c.hello"]);
    });

    it("写入落盘内容已脱敏：token/password/cookie/恢复码在文件中只剩占位符", async () => {
        const directory = path.join(await tempRoot(), "logs");
        const store = await openStore("inst-redact", {directory});
        const recovery = `NBK1-${"b".repeat(43)}-89abcdef`;
        store.record({
            level: "error",
            event: "leak",
            message: `token=abc.def.ghi cookie: sid=secret-cookie`,
            data: {password: "hunter2", recovery},
            error: new Error(`Bearer eyJsecret ${recovery}`),
        });
        await store.shutdown();
        const text = await readFile(path.join(directory, "server-current.jsonl"), "utf8");
        for (const secret of ["abc.def.ghi", "secret-cookie", "hunter2", "eyJsecret", recovery]) {
            expect(text).not.toContain(secret);
        }
        expect(text).toContain("[REDACTED]");
    });
});

describe("文件出口：降级与关闭", () => {
    it("父路径被普通文件占据：降级原因可查询，记录仍接受，error 走兜底，不创建任何文件", async () => {
        const root = await tempRoot();
        const blocker = path.join(root, "blocked");
        await writeFile(blocker, "not a directory");
        const fallback = vi.fn();
        const store = await openStore("inst-degraded", {directory: path.join(blocker, "logs")}, fallback);
        expect(store.status()).toMatchObject({phase: "available", degraded: {reason: "location-unavailable"}});
        expect(store.record({level: "info", event: "i", message: "m"}).status).toBe("accepted");
        expect(store.record({level: "fatal", event: "startup.failed", message: "gate"}).status).toBe("accepted");
        expect(fallback.mock.calls.map(([record]) => record.event)).toEqual(["startup.failed"]);
        // 临时根自带测试支持的所有权标记；出口不得在根里新增任何条目，被占据的普通文件原样保留。
        expect((await readdir(root)).filter((name) => name !== ".nbook-tmp.json")).toEqual(["blocked"]);
        expect(await readFile(blocker, "utf8")).toBe("not a directory");
    });

    it("关闭后迟到记录被拒绝且不重建日志文件；重复关闭共享结果并已释放授予", async () => {
        const directory = path.join(await tempRoot(), "logs");
        const store = await openStore("inst-close", {directory});
        store.record({level: "info", event: "before", message: "m"});
        const first = store.shutdown();
        expect(store.shutdown()).toBe(first);
        await first;
        await rm(path.join(directory, "server-current.jsonl"));
        expect(store.record({level: "fatal", event: "late", message: "m"})).toEqual({status: "rejected", reason: "closed"});
        await store.flush();
        expect(await readdir(directory)).toEqual([]);
    });

    it("授予被外部接管：关闭不删除接管者的锁目录", async () => {
        const directory = path.join(await tempRoot(), "logs");
        const store = await openStore("inst-takeover", {directory});
        const lockDir = path.join(directory, LOG_LOCATION_LOCK_NAME);
        // 外部参与者删除并重建锁目录（模拟 stale 接管）：身份变化。
        await rm(lockDir, {recursive: true});
        await mkdir(lockDir);
        await store.shutdown();
        expect(existsSync(lockDir)).toBe(true);
        expect(store.status().phase).toBe("closed");
    });
});

describe("文件出口：轮转与保留", () => {
    it("超过单文件上限即轮转，历史按保留数回收；只回收自己的 server-* 文件，launcher 与其它文件不动", async () => {
        const directory = path.join(await tempRoot(), "logs");
        await mkdir(directory, {recursive: true});
        await writeFile(path.join(directory, "launcher-current.jsonl"), "{}\n");
        await writeFile(path.join(directory, "notes.txt"), "keep");
        let tick = 0;
        const now = () => new Date(Date.UTC(2026, 8, 24, 0, 0, tick++));
        const store = await openStore("inst-rotate", {directory, maxFileBytes: 400, retention: 3, now});
        for (let index = 0; index < 30; index += 1) {
            store.record({level: "info", event: "rotate", message: `line-${index}-${"x".repeat(60)}`});
        }
        await store.shutdown();
        const names = (await readdir(directory)).sort();
        const owned = names.filter((name) => name.startsWith("server-"));
        expect(owned).toContain("server-current.jsonl");
        // retention=3：current + 至多 2 份历史。
        expect(owned.length).toBeLessThanOrEqual(3);
        expect(owned.length).toBeGreaterThan(1);
        expect(names).toEqual(expect.arrayContaining(["launcher-current.jsonl", "notes.txt"]));
        expect(names).not.toContain(LOG_LOCATION_LOCK_NAME);
    });

    it("位置冲突的第二实例不触发回收：A 持有期间 B 降级，A 的历史文件原样保留", async () => {
        const directory = path.join(await tempRoot(), "logs");
        await mkdir(directory, {recursive: true});
        const history = path.join(directory, "server-20260101-000000-1-abcdef01.jsonl");
        await writeFile(history, "{}\n");
        const a = await openStore("inst-owner", {directory, retention: 8});
        const b = await openStore("inst-intruder", {directory, retention: 1, maxTotalBytes: 1});
        expect(b.status().degraded?.reason).toBe("location-conflict");
        b.record({level: "info", event: "b", message: "m"});
        await b.flush();
        expect(existsSync(history)).toBe(true);
        await a.shutdown();
    });
});
