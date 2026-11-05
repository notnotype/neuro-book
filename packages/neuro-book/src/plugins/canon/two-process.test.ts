/**
 * 两个 NeuroBook 进程写同一部作品的世界（docs/specs/canon/project.md 输出 8、17、22，场景 4）：两个真实的 Bun
 * 子进程各自用产品的世界宿主（`holdLock` 的跨进程锁、`./node` 的分段日志、目录监视）打开同一个项目目录，交替发布。
 * 子进程见 `testing/world-child.ts`；失败时也在 afterEach 里结束全部子进程。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {readdir, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {CanonEvent} from "./shared/contracts";

const CHILD = join(import.meta.dir, "testing", "world-child.ts");

interface Child {
    readonly events: CanonEvent[];
    send(op: string, body?: Record<string, unknown>): Promise<unknown>;
    kill(): void;
    readonly exited: Promise<number>;
}

let root = "";
let children: Child[] = [];

beforeEach(async () => {
    root = await createTestTmpRoot("neuro-book-canon", "two-process");
});

afterEach(async () => {
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exited));
    children = [];
    await rm(root, {recursive: true, force: true});
});

/** 起一个子进程，等它打印就绪行。 */
async function start(): Promise<Child> {
    // 在应用包目录里起，子进程按本包的 tsconfig 解析 `nbook/*`。
    const process = Bun.spawn(["bun", CHILD, root], {cwd: join(import.meta.dir, "..", "..", ".."), stdin: "pipe", stdout: "pipe", stderr: "inherit"});
    const events: CanonEvent[] = [];
    const waiting = new Map<number, (value: unknown) => void>();
    let ready!: (value: {ready: boolean}) => void;
    const readyLine = new Promise<{ready: boolean}>((resolve) => {
        ready = resolve;
    });
    void (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of process.stdout) {
            buffer += decoder.decode(chunk, {stream: true});
            for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
                const message = JSON.parse(buffer.slice(0, newline)) as {ready?: boolean; event?: CanonEvent; id?: number; result?: unknown};
                buffer = buffer.slice(newline + 1);
                if (message.ready !== undefined) ready({ready: message.ready});
                else if (message.event !== undefined) events.push(message.event);
                else if (message.id !== undefined) waiting.get(message.id)?.(message.result);
            }
        }
    })();
    let next = 0;
    const child: Child = {
        events,
        send: (op, body = {}) => {
            const id = ++next;
            const result = new Promise<unknown>((resolve) => waiting.set(id, resolve));
            process.stdin.write(`${JSON.stringify({id, op, ...body})}\n`);
            void process.stdin.flush();
            return result;
        },
        kill: () => process.kill("SIGKILL"),
        exited: process.exited,
    };
    children.push(child);
    expect(await readyLine).toEqual({ready: true});
    return child;
}

/** 等子进程推来的事件让条件成立（目录监视是异步的）；10 秒内不成立就失败。 */
async function until(condition: () => boolean): Promise<void> {
    await waitUntil("等待的条件成立", condition, {timeoutMs: 10_000, intervalMs: 20});
}

let sequence = 0;
function person(name: string, baseVersion: number, summary = ""): WriteRequest {
    const id = `tmp:${String(++sequence)}`;
    const entry: Entry = {id, type: "nbook.canon.person", parent: null, folder: "", order: 0, init: {name, aliases: [], summary, text: [], data: {}}};
    return {requestId: `req-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: name, baseVersion, puts: [{ref: {kind: "entry", id}, after: entry}]};
}

type Published = {ok: true; version: number; ids: Record<string, string>} | {ok: false; failure: {code: string}};

async function versions(): Promise<number[]> {
    const dir = join(root, ".nbook", "world", "log");
    const segments = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
    const lines = (await Promise.all(segments.map((name) => readFile(join(dir, name), "utf8")))).flatMap((text) => text.split("\n").filter((line) => line !== ""));
    return lines.map((line) => (JSON.parse(line) as {version: number}).version);
}

describe("canon.project 场景 4：两个进程", () => {
    it("交替发布、跨过段边界：版本连续、没有重号；一边改了星瑕，另一边先收到 changed，基于旧版本改星瑕得到 version-conflict，改星瑾正常发布", async () => {
        const a = await start();
        const b = await start();
        // 每条约 100 KB：几次之后跨过 256 KiB 的段边界。
        for (let round = 0; round < 6; round += 1) {
            const writer = round % 2 === 0 ? a : b;
            const status = (await writer.send("status")) as {version: number};
            const result = (await writer.send("publish", {request: person(`人${String(round)}`, status.version, "字".repeat(35_000))})) as Published;
            expect(result.ok).toBe(true);
        }
        expect(await versions()).toEqual([1, 2, 3, 4, 5, 6]);
        expect((await readdir(join(root, ".nbook", "world", "log"))).filter((name) => name.endsWith(".jsonl")).length).toBeGreaterThan(1);

        const star = (await a.send("publish", {request: person("星瑕", 6)})) as Published;
        const sister = (await a.send("publish", {request: person("星瑾", 7)})) as Published;
        if (!star.ok || !sister.ok) throw new Error("建条目失败");
        await until(() => b.events.some((event) => event.kind === "changed" && event.version === 8));
        const starId = Object.values(star.ids)[0]!;
        const sisterId = Object.values(sister.ids)[0]!;
        const starEntry = (await a.send("object", {ref: {kind: "entry", id: starId}})) as Entry;
        const sisterEntry = (await b.send("object", {ref: {kind: "entry", id: sisterId}})) as Entry;

        expect(((await a.send("publish", {request: {requestId: "a-edit", by: {kind: "author"}, what: "edit", title: "改星瑕", baseVersion: 8, puts: [{ref: {kind: "entry", id: starId}, after: {...starEntry, folder: "主角"}}]}})) as Published).ok).toBe(true);
        await until(() => b.events.some((event) => event.kind === "changed" && event.version === 9));
        const stale = (await b.send("publish", {request: {requestId: "b-edit", by: {kind: "author"}, what: "edit", title: "改星瑕", baseVersion: 8, puts: [{ref: {kind: "entry", id: starId}, after: {...starEntry, folder: "配角"}}]}})) as Published;
        expect(stale).toMatchObject({ok: false, failure: {code: "version-conflict"}});
        const other = (await b.send("publish", {request: {requestId: "b-edit-2", by: {kind: "author"}, what: "edit", title: "改星瑾", baseVersion: 8, puts: [{ref: {kind: "entry", id: sisterId}, after: {...sisterEntry, folder: "配角"}}]}})) as Published;
        expect(other).toMatchObject({ok: true, version: 10});
        expect(await versions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }, 60_000);

    it("输出 22：锁约 3 秒内拿不到时得到 world-locked、世界不变；持锁的进程崩溃后，锁最迟 10 秒后被接管", async () => {
        const a = await start();
        const holder = await start();
        expect(await holder.send("hold-lock")).toBe(true);

        const started = Date.now();
        expect(await a.send("publish", {request: person("星瑕", 0)})).toMatchObject({ok: false, failure: {code: "world-locked"}});
        expect(Date.now() - started).toBeGreaterThanOrEqual(2_000);
        expect(((await a.send("status")) as {version: number}).version).toBe(0);

        holder.kill();
        await holder.exited;
        const killed = Date.now();
        let result: Published = {ok: false, failure: {code: "world-locked"}};
        while (!result.ok && Date.now() - killed < 20_000) result = (await a.send("publish", {request: person("星瑕", 0)})) as Published;
        expect(result).toMatchObject({ok: true, version: 1});
        expect(Date.now() - killed).toBeLessThan(16_000);
    }, 60_000);
});
