import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {PiRequestRecorder} from "nbook/server/agent/observability/pi-request-recorder";
import type {PiTraceDraft, PiTraceIndexEntry, PiTraceRecord} from "nbook/server/agent/observability/pi-request-recorder";

/** 造一个最小合法 draft，允许覆盖字段。 */
function draft(overrides: Partial<PiTraceDraft> = {}): PiTraceDraft {
    return {
        status: "ok",
        correlation: {kind: "turn", sessionId: 7, invocationId: "inv-1", profileKey: "leader.default", turnIndex: 0},
        request: {provider: "anthropic", api: "anthropic-messages", model: "claude-x", baseUrl: "https://api", context: {systemPrompt: "sp", messages: []}, payload: {model: "claude-x", messages: []}},
        response: {httpStatus: 200, stopReason: "stop", usage: {input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30}},
        timing: {startedAt: "2026-07-03T00:00:00.000Z", ttftMs: 120, durationMs: 800},
        ...overrides,
    };
}

async function readIndex(dir: string): Promise<PiTraceIndexEntry[]> {
    const raw = await readFile(join(dir, "index.jsonl"), "utf8").catch(() => "");
    return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as PiTraceIndexEntry);
}

describe("PiRequestRecorder", () => {
    let root: string;
    let tracesRoot: string;

    beforeEach(async () => {
        root = await mkdtemp(testHostPath("pi-trace-"));
        tracesRoot = join(root, ".nbook", "agent", "traces");
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("落一条记录到 traces/<sessionId>/<id>.json 并追加 index 汇总行", async () => {
        const recorder = new PiRequestRecorder({tracesRoot});
        await recorder.record(draft(), {maxRecords: 100});

        const bucketDir = join(root, ".nbook", "agent", "traces", "7");
        const files = (await readdir(bucketDir)).filter((n) => n.endsWith(".json"));
        expect(files).toHaveLength(1);

        const record = JSON.parse(await readFile(join(bucketDir, files[0]!), "utf8")) as PiTraceRecord;
        expect(record.id).toBe(files[0]!.slice(0, -5));
        expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(record.request.payload).toEqual({model: "claude-x", messages: []});
        expect(record.response.usage?.totalTokens).toBe(30);

        const index = await readIndex(bucketDir);
        expect(index).toHaveLength(1);
        expect(index[0]).toMatchObject({kind: "turn", provider: "anthropic", model: "claude-x", totalTokens: 30, ttftMs: 120});
        expect(index[0]!.bytes).toBeGreaterThan(0);
    });

    it("每 session 只保留最近 N 条，删最旧，index 同步收敛", async () => {
        const recorder = new PiRequestRecorder({tracesRoot});
        for (let i = 0; i < 5; i++) {
            await recorder.record(draft({correlation: {kind: "turn", sessionId: 7, turnIndex: i}}), {maxRecords: 3});
        }
        const bucketDir = join(root, ".nbook", "agent", "traces", "7");
        const files = (await readdir(bucketDir)).filter((n) => n.endsWith(".json")).map((n) => Number(n.slice(0, -5))).sort((a, b) => a - b);
        expect(files).toHaveLength(3);
        // 保留的是 seq 最大的 3 个（最新）。
        expect(files[0]!).toBeGreaterThan(1);
        const index = await readIndex(bucketDir);
        expect(index).toHaveLength(3);
    });

    it("无 sessionId 落 _system bucket", async () => {
        const recorder = new PiRequestRecorder({tracesRoot});
        await recorder.record(draft({correlation: {kind: "health-check"}}), {maxRecords: 100});
        const files = await readdir(join(root, ".nbook", "agent", "traces", "_system"));
        expect(files.filter((n) => n.endsWith(".json"))).toHaveLength(1);
    });

    it("并发 record 串行分配到不同 id，无丢失无撞号", async () => {
        const recorder = new PiRequestRecorder({tracesRoot});
        await Promise.all(Array.from({length: 6}, (_, i) => recorder.record(draft({correlation: {kind: "turn", sessionId: 9, turnIndex: i}}), {maxRecords: 100})));
        const bucketDir = join(root, ".nbook", "agent", "traces", "9");
        const ids = (await readdir(bucketDir)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
        expect(new Set(ids).size).toBe(6);
    });

    it("clearBucket 只清目标 bucket，seq 不复用，非法 bucket 拒绝", async () => {
        const recorder = new PiRequestRecorder({tracesRoot});
        await recorder.record(draft({correlation: {kind: "turn", sessionId: 7}}), {maxRecords: 100});
        await recorder.record(draft({correlation: {kind: "turn", sessionId: 8}}), {maxRecords: 100});
        await recorder.clearBucket("7");

        await expect(readdir(join(tracesRoot, "7"))).rejects.toThrow();
        expect((await readdir(join(tracesRoot, "8"))).filter((n) => n.endsWith(".json"))).toHaveLength(1);

        // 清空后再写：seq 继续递增，不回收已用编号。
        await recorder.record(draft({correlation: {kind: "turn", sessionId: 7}}), {maxRecords: 100});
        const ids = (await readdir(join(tracesRoot, "7"))).filter((n) => n.endsWith(".json")).map((n) => Number(n.slice(0, -5)));
        expect(ids[0]!).toBeGreaterThan(2);

        await expect(recorder.clearBucket("../evil")).rejects.toThrow();
    });

    it("clearBucket 与在途 record 串行：先入队的写先落盘再被清，不复活", async () => {
        const recorder = new PiRequestRecorder({tracesRoot});
        void recorder.record(draft({correlation: {kind: "turn", sessionId: 5}}), {maxRecords: 100});
        await recorder.clearBucket("5");
        const exists = await readdir(join(tracesRoot, "5")).then(() => true).catch(() => false);
        expect(exists).toBe(false);
    });
});
