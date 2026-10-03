import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {appendFile, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {PiRequestRecorder} from "nbook/server/agent/observability/pi-request-recorder";
import type {PiTraceDraft} from "nbook/server/agent/observability/pi-request-recorder";
import {PiTraceReader, isValidTraceBucket, isValidTraceId} from "nbook/server/agent/observability/pi-trace-reader";

/** 构造最小合法 draft；sessionId 缺省时落 _system bucket。 */
function draft(sessionId?: number): PiTraceDraft {
    return {
        status: "ok",
        correlation: {kind: "turn", ...(sessionId !== undefined ? {sessionId} : {})},
        request: {provider: "faux", api: "faux", model: "faux-model"},
        response: {stopReason: "end"},
        timing: {startedAt: new Date().toISOString()},
    };
}

describe("PiTraceReader", () => {
    let root: string;
    let recorder: PiRequestRecorder;
    let reader: PiTraceReader;

    beforeEach(() => {
        root = testHostPath("pi-trace-reader-test", randomUUID());
        const tracesRoot = join(root, ".nbook", "agent", "traces");
        recorder = new PiRequestRecorder({tracesRoot});
        reader = new PiTraceReader({tracesRoot});
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("traces 目录不存在时一律空态，不报错", async () => {
        expect(await reader.listBuckets()).toEqual([]);
        expect(await reader.listIndex("42")).toEqual([]);
        expect(await reader.readRecord("42", "1")).toBeNull();
    });

    it("与 recorder 落盘互通：listBuckets / listIndex 倒序 / readRecord", async () => {
        await recorder.record(draft(1), {maxRecords: 10});
        await recorder.record(draft(1), {maxRecords: 10});
        await recorder.record(draft(), {maxRecords: 10});

        const buckets = await reader.listBuckets();
        expect(buckets.map((b) => b.bucket).sort()).toEqual(["1", "_system"]);
        expect(buckets.find((b) => b.bucket === "1")?.count).toBe(2);

        const index = await reader.listIndex("1");
        expect(index).toHaveLength(2);
        expect(Number(index[0]!.id)).toBeGreaterThan(Number(index[1]!.id));

        const record = await reader.readRecord("1", index[0]!.id);
        expect(record?.request.model).toBe("faux-model");
        expect(record?.correlation.sessionId).toBe(1);
        expect(await reader.readRecord("1", "999999")).toBeNull();
    });

    it("非法 bucket / id 直接拒绝（防路径穿越）", async () => {
        expect(isValidTraceBucket("1")).toBe(true);
        expect(isValidTraceBucket("_system")).toBe(true);
        expect(isValidTraceBucket("../evil")).toBe(false);
        expect(isValidTraceBucket("")).toBe(false);
        expect(isValidTraceId("12")).toBe(true);
        expect(isValidTraceId("../../secret")).toBe(false);
        await expect(reader.listIndex("../evil")).rejects.toThrow();
        await expect(reader.readRecord("1", "../../secret")).rejects.toThrow();
    });

    it("index 坏行（崩溃截断）跳过，不影响其余条目", async () => {
        await recorder.record(draft(7), {maxRecords: 10});
        await appendFile(join(root, ".nbook", "agent", "traces", "7", "index.jsonl"), "{broken\n", "utf8");
        const index = await reader.listIndex("7");
        expect(index).toHaveLength(1);
    });

    it("listRecent 跨 bucket 聚合：bucket 标记正确、ts 倒序、limit 截断、空态返回空", async () => {
        expect(await reader.listRecent(50)).toEqual([]);

        await recorder.record(draft(1), {maxRecords: 10});
        await recorder.record(draft(1), {maxRecords: 10});
        await recorder.record(draft(), {maxRecords: 10});

        const recent = await reader.listRecent(50);
        expect(recent).toHaveLength(3);
        expect(recent.filter((entry) => entry.bucket === "1")).toHaveLength(2);
        expect(recent.filter((entry) => entry.bucket === "_system")).toHaveLength(1);
        // ts 非递增（同毫秒可能并列，不断言严格全序）。
        for (let i = 1; i < recent.length; i += 1) {
            expect(recent[i - 1]!.ts.localeCompare(recent[i]!.ts)).toBeGreaterThanOrEqual(0);
        }

        const limited = await reader.listRecent(2);
        expect(limited).toHaveLength(2);
    });
});
