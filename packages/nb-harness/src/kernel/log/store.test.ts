/**
 * 日志存储（docs/specs/harness/session.md）：会话目录上的 JSONL 存储与内存存储。
 * 测试名里的编号是 Spec 的输出条目与验收场景。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, rm, truncate, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {LogEvent, LogStore, SessionHeader} from "../api/index.js";
import {nodeFiles, type FilePort} from "./files.js";
import {jsonProblem} from "./json.js";
import {createJsonlStore} from "./jsonl-store.js";
import {createMemoryStore} from "./memory-store.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-log");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let counter = 0;
const nextId = () => `s${(counter += 1)}`;
const header = (id: string): SessionHeader => ({format: 1, id, createdAt: 1_000, profile: "builtin.test", questions: "user"});

/** 一串合法的事件：session 事件没有父节点，path 事件接在上一条 path 事件下。 */
function eventsFrom(startSeq: number, specs: readonly {type: string; data?: unknown; scope?: "path" | "session"; kind?: "conv" | "ext" | "ctrl"; source?: string}[], parentOf: {last: string | null}): LogEvent[] {
    return specs.map((spec, index) => {
        const scope = spec.scope ?? "path";
        const seq = startSeq + index;
        const event: LogEvent = {
            id: `e${seq}`,
            seq,
            at: 2_000 + seq,
            parent: scope === "path" ? parentOf.last : null,
            scope,
            kind: spec.kind ?? "ctrl",
            type: spec.type,
            version: 1,
            source: spec.source ?? "kernel",
            data: spec.data ?? {},
        };
        if (scope === "path") parentOf.last = event.id;
        return event;
    });
}

/** 三个批：开轮、一条回复、收口。 */
function threeBatches(): LogEvent[][] {
    const parent = {last: null as string | null};
    return [
        eventsFrom(1, [{type: "runStarted", data: {runId: "r1", kind: "chat"}}, {type: "turnStarted", data: {turnId: "t1", inputId: null}}], parent),
        eventsFrom(3, [{type: "titleChanged", scope: "session", data: {title: "第一章", by: "user"}}], parent),
        eventsFrom(4, [{type: "turnEnded", data: {turnId: "t1", reason: "completed"}}, {type: "runEnded", data: {runId: "r1", reason: "completed"}}], parent),
    ];
}

async function writeSession(store: LogStore, id: string, batches: readonly LogEvent[][]): Promise<void> {
    const created = await store.create(header(id));
    if (!created.ok) throw new Error(created.code);
    for (const batch of batches) expect(await store.append(created.value, batch)).toEqual({ok: true, value: undefined});
    await store.close(created.value);
}

const stores: [string, () => LogStore][] = [
    ["JSONL", () => createJsonlStore({root, now: () => 9_000})],
    ["内存", createMemoryStore],
];

describe.each(stores)("%s 存储", (_name, makeStore) => {
    test("输出 1、2、13：新建、追加、重开读回同样的事件；目录已存在得 session-exists", async () => {
        const store = makeStore();
        const id = nextId();
        const batches = threeBatches();
        await writeSession(store, id, batches);
        expect((await store.create(header(id))).ok ? "created" : "exists").toBe("exists");
        const opened = await store.open(id);
        if (!opened.ok) throw new Error(opened.code);
        expect(opened.value.header).toEqual(header(id));
        expect(opened.value.events).toEqual(batches.flat());
        await store.close(opened.value);
    });

    test("输出 11：同一会话不能同时打开两次；关闭后能再打开", async () => {
        const store = makeStore();
        const id = nextId();
        await writeSession(store, id, []);
        const first = await store.open(id);
        if (!first.ok) throw new Error(first.code);
        const second = await store.open(id);
        expect(second.ok ? "opened" : second.code).toBe("session-busy");
        await store.close(first.value);
        const third = await store.open(id);
        expect(third.ok).toBe(true);
        if (third.ok) await store.close(third.value);
    });

    test("输出 9：超过 16 KB 的字符串另存为大块内容，读回原样；相同内容只存一份", async () => {
        const store = makeStore();
        const id = nextId();
        const big = "长".repeat(6_000);
        const parent = {last: null as string | null};
        const batch = eventsFrom(1, [
            {type: "toolResult", kind: "conv", data: {callId: "c1", tool: "builtin.read", text: big, status: "ok"}},
            {type: "toolResult", kind: "conv", data: {callId: "c2", tool: "builtin.read", text: big, status: "ok", details: {copy: big}}},
        ], parent);
        await writeSession(store, id, [batch]);
        const opened = await store.open(id);
        if (!opened.ok) throw new Error(opened.code);
        expect(opened.value.events).toEqual(batch);
        await store.close(opened.value);
    });

    test("输出 19：list 读索引，按最后活动时刻排，能按归档筛", async () => {
        const store = makeStore();
        const first = nextId();
        const second = nextId();
        await writeSession(store, first, threeBatches());
        const parent = {last: null as string | null};
        await writeSession(store, second, [eventsFrom(1, [{type: "archived", scope: "session", data: {archived: true}}], parent)]);
        const listed = await store.list();
        if (!listed.ok) throw new Error(`${listed.code} ${JSON.stringify(listed.detail)}`);
        const mine = listed.value.filter((entry) => entry.id === first || entry.id === second);
        expect(mine.map((entry) => [entry.id, entry.title, entry.turns, entry.archived])).toEqual([
            [first, "第一章", 1, false],
            [second, null, 0, true],
        ]);
        const archived = await store.list({archived: true});
        expect(archived.ok && archived.value.some((entry) => entry.id === first)).toBe(false);
    });
});

describe("JSONL 存储的文件", () => {
    const store = () => createJsonlStore({root, now: () => 9_000});

    test("输出 2、3：每条事件一行，同批的行连续、带同一个批标记", async () => {
        const id = nextId();
        await writeSession(store(), id, threeBatches());
        const lines = (await readFile(join(root, id, "session.jsonl"), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
        expect(lines[0]).toEqual(header(id));
        expect(lines.slice(1).map((line) => [line.seq, line.batch.n, line.batch.of])).toEqual([[1, 1, 2], [2, 2, 2], [3, 1, 1], [4, 1, 2], [5, 2, 2]]);
        expect(new Set(lines.slice(1, 3).map((line) => line.batch.id)).size).toBe(1);
    });

    test("输出 9：大块内容在 blobs/ 下按哈希存，日志里只留引用", async () => {
        const id = nextId();
        const big = "x".repeat(16 * 1024 + 1);
        const parent = {last: null as string | null};
        await writeSession(store(), id, [eventsFrom(1, [{type: "toolResult", kind: "conv", data: {callId: "c", tool: "t", text: big, status: "ok"}}], parent)]);
        const line = JSON.parse((await readFile(join(root, id, "session.jsonl"), "utf8")).trimEnd().split("\n")[1]!);
        expect(line.data.text).toEqual({$blob: expect.stringMatching(/^[0-9a-f]{64}$/u), size: big.length});
        expect(await readFile(join(root, id, "blobs", line.data.text.$blob), "utf8")).toBe(big);
        // 刚好 16 KB 的不另存。
        const exact = nextId();
        await writeSession(store(), exact, [eventsFrom(1, [{type: "toolResult", kind: "conv", data: {callId: "c", tool: "t", text: "y".repeat(16 * 1024), status: "ok"}}], {last: null})]);
        expect(await readdir(join(root, exact, "blobs"))).toEqual([]);
    });

    test("输出 7：大块内容缺失或被改动得 log-corrupt", async () => {
        const id = nextId();
        await writeSession(store(), id, [eventsFrom(1, [{type: "toolResult", kind: "conv", data: {callId: "c", tool: "t", text: "z".repeat(20_000), status: "ok"}}], {last: null})]);
        const [hash] = await readdir(join(root, id, "blobs"));
        await writeFile(join(root, id, "blobs", hash!), "被改过");
        const opened = await store().open(id);
        expect(opened.ok ? "opened" : opened.code).toBe("log-corrupt");
    });

    test("场景 1、输出 6：最后一批截在任何一个字节处，打开都丢掉这一批、另存截下的字节，之后能接着写", async () => {
        const id = nextId();
        const batches = threeBatches();
        await writeSession(store(), id, batches);
        const full = await readFile(join(root, id, "session.jsonl"));
        const lastBatchStart = full.length - Buffer.byteLength(`${full.toString("utf8").trimEnd().split("\n").slice(-2).join("\n")}\n`);
        for (let cut = lastBatchStart + 1; cut < full.length; cut += 1) {
            const copy = nextId();
            await mkdir(join(root, copy, "blobs"), {recursive: true});
            await writeFile(join(root, copy, "session.jsonl"), Buffer.concat([Buffer.from(`${JSON.stringify(header(copy))}\n`), full.subarray(full.indexOf(0x0a) + 1, cut)]));
            const headerShift = Buffer.byteLength(`${JSON.stringify(header(copy))}\n`) - (full.indexOf(0x0a) + 1);
            const opened = await store().open(copy);
            if (!opened.ok) throw new Error(`cut at ${cut}: ${opened.code}`);
            expect(opened.value.events).toEqual(batches.slice(0, 2).flat());
            expect(opened.value.notices[0]).toEqual({code: "log-tail-truncated", detail: {bytes: cut - lastBatchStart, savedAs: "session.jsonl.tail-9000"}});
            expect(await readFile(join(root, copy, "session.jsonl.tail-9000"))).toEqual(full.subarray(lastBatchStart, cut));
            expect((await readFile(join(root, copy, "session.jsonl"))).length).toBe(lastBatchStart + headerShift);
            expect(await store().append(opened.value, batches[2]!)).toEqual({ok: true, value: undefined});
            await store().close(opened.value);
            const reopened = await store().open(copy);
            expect(reopened.ok && reopened.value.events).toEqual(batches.flat());
            if (reopened.ok) await store().close(reopened.value);
        }
    });

    test("输出 6：末尾一整行不是合法 JSON，或不完整的批后面还有行，得 log-corrupt", async () => {
        const id = nextId();
        await writeSession(store(), id, threeBatches());
        const path = join(root, id, "session.jsonl");
        const original = await readFile(path, "utf8");
        await writeFile(path, `${original}{not json}\n`);
        expect(await store().open(id).then((result) => (result.ok ? "opened" : result.code))).toBe("log-corrupt");
        // 去掉第一批的第二行：中间出现不完整的批。
        const lines = original.trimEnd().split("\n");
        await writeFile(path, `${[lines[0], lines[1], ...lines.slice(3)].join("\n")}\n`);
        expect(await store().open(id).then((result) => (result.ok ? "opened" : result.code))).toBe("log-corrupt");
    });

    test("输出 7、8：校验不过得 log-corrupt，不认识的格式得 needs-migration，文件都不改", async () => {
        const cases: [string, (lines: Record<string, unknown>[]) => void, string][] = [
            ["重复的事件 id", (lines) => (lines[2]!.id = lines[1]!.id), "log-corrupt"],
            ["seq 不递增", (lines) => (lines[2]!.seq = 1), "log-corrupt"],
            ["不认识的内核事件", (lines) => (lines[1]!.type = "runStartd"), "log-corrupt"],
            ["内核事件不是内核写的", (lines) => (lines[1]!.source = "nbook.x"), "log-corrupt"],
            ["扩展事件不是拥有者写的", (lines) => Object.assign(lines[1]!, {type: "nbook.a/x", kind: "ext", source: "nbook.b"}), "log-corrupt"],
            ["父节点没有先出现", (lines) => (lines[2]!.parent = "nowhere"), "log-corrupt"],
            ["格式版本", (lines) => (lines[0]!.format = 2), "needs-migration"],
        ];
        for (const [label, mutate, code] of cases) {
            const id = nextId();
            await writeSession(store(), id, threeBatches());
            const path = join(root, id, "session.jsonl");
            const lines = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
            mutate(lines);
            const text = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
            await writeFile(path, text);
            const opened = await store().open(id);
            expect([label, opened.ok ? "opened" : opened.code]).toEqual([label, code]);
            expect(await readFile(path, "utf8")).toBe(text);
        }
    });

    test("输出 12：写失败后句柄损坏、之后的写都得 log-broken；关闭释放锁；重开以文件为准", async () => {
        const id = nextId();
        const batches = threeBatches();
        let failNextWrite = false;
        const failing: FilePort = {
            ...nodeFiles,
            async openAppend(path) {
                const file = await nodeFiles.openAppend(path);
                return {
                    ...file,
                    async write(data, position) {
                        if (failNextWrite) throw Object.assign(new Error("ENOSPC: no space left on device"), {code: "ENOSPC"});
                        await file.write(data, position);
                    },
                };
            },
        };
        const broken = createJsonlStore({root, files: failing});
        const created = await broken.create(header(id));
        if (!created.ok) throw new Error(created.code);
        expect(await broken.append(created.value, batches[0]!)).toEqual({ok: true, value: undefined});
        failNextWrite = true;
        expect(await broken.append(created.value, batches[1]!)).toMatchObject({ok: false, code: "log-broken"});
        failNextWrite = false;
        expect(await broken.append(created.value, batches[1]!)).toMatchObject({ok: false, code: "log-broken"});
        expect(created.value.broken).toBe(true);
        await broken.close(created.value);
        const reopened = await store().open(id);
        expect(reopened.ok && reopened.value.events).toEqual(batches[0]);
        if (reopened.ok) await store().close(reopened.value);
    });

    test("输出 12：同步到盘失败时这一批的结果不确定，重开以文件为准", async () => {
        const id = nextId();
        const batches = threeBatches();
        let failSync = false;
        const failing: FilePort = {
            ...nodeFiles,
            async openAppend(path) {
                const file = await nodeFiles.openAppend(path);
                return {
                    ...file,
                    async sync() {
                        if (failSync) throw Object.assign(new Error("EIO: i/o error"), {code: "EIO"});
                        await file.sync();
                    },
                };
            },
        };
        const flaky = createJsonlStore({root, files: failing});
        const created = await flaky.create(header(id));
        if (!created.ok) throw new Error(created.code);
        failSync = true;
        expect(await flaky.append(created.value, batches[0]!)).toMatchObject({ok: false, code: "log-broken"});
        await flaky.close(created.value);
        // 写已经进了文件、只是没确认同步：重开时它在文件里，就算已提交。
        const reopened = await store().open(id);
        expect(reopened.ok && reopened.value.events).toEqual(batches[0]);
        if (reopened.ok) await store().close(reopened.value);
    });

    test("输出 19：索引与日志对不上时打开会重建，并留下通知", async () => {
        const id = nextId();
        await writeSession(store(), id, threeBatches());
        await truncate(join(root, id, "index.json"), 0);
        const opened = await store().open(id);
        if (!opened.ok) throw new Error(opened.code);
        expect(opened.value.notices).toEqual([{code: "index-rebuilt", detail: {from: -1, to: 5}}]);
        expect(JSON.parse(await readFile(join(root, id, "index.json"), "utf8"))).toMatchObject({title: "第一章", throughSeq: 5});
        await store().close(opened.value);
    });

    test("场景 3、输出 11：别的进程持有时得 session-busy（带持有者）；持有者被 kill -9 后立即能打开", async () => {
        const id = nextId();
        await writeSession(store(), id, []);
        const child = Bun.spawn(["bun", join(import.meta.dir, "../../../tests/kernel/fixtures/hold-session.ts"), root, id], {stdout: "pipe", stderr: "inherit"});
        try {
            const reader = child.stdout.getReader();
            const {value} = await reader.read();
            expect(new TextDecoder().decode(value).trim()).toBe("held");
            const busy = await store().open(id);
            expect(busy).toEqual({ok: false, code: "session-busy", detail: {pid: child.pid, since: expect.any(Number)}});
            child.kill(9);
            await child.exited;
            const opened = await store().open(id);
            expect(opened.ok).toBe(true);
            if (opened.ok) await store().close(opened.value);
        } finally {
            child.kill(9);
            await child.exited;
        }
    });

    test("场景 3：两个进程同时打开同一会话，恰好一个成功", async () => {
        const id = nextId();
        await writeSession(store(), id, []);
        const fixture = join(import.meta.dir, "../../../tests/kernel/fixtures/hold-session.ts");
        const children = [0, 1].map(() => Bun.spawn(["bun", fixture, root, id], {stdout: "pipe", stderr: "inherit"}));
        try {
            const outputs = await Promise.all(children.map(async (child) => new TextDecoder().decode((await child.stdout.getReader().read()).value).trim()));
            expect(outputs.sort()).toEqual(["held", "session-busy"]);
        } finally {
            for (const child of children) child.kill(9);
            await Promise.all(children.map((child) => child.exited));
        }
    });
});

describe("日志里的值", () => {
    test("能被 JSON 如实表示，键 $blob 留给大块内容", () => {
        expect(jsonProblem({a: [1, "x", null, {b: true}]})).toBeNull();
        expect(jsonProblem({a: undefined})).toContain("/a");
        expect(jsonProblem({at: new Date(0)})).toContain("Date");
        expect(jsonProblem({n: Number.NaN})).toContain("/n");
        expect(jsonProblem({m: new Map()})).toContain("Map");
        expect(jsonProblem({nested: {$blob: "x"}})).toContain("reserved");
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(jsonProblem(cyclic)).toContain("circular");
        const shared = {x: 1};
        expect(jsonProblem({a: shared, b: shared})).toBeNull();
    });
});
