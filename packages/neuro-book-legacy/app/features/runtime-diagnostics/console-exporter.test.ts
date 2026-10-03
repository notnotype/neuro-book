/**
 * 浏览器诊断出口：只写 console、不读不落盘；有界记录与查询由 store 自己拥有（验收 8）。
 */

import {describe, expect, it, vi} from "vitest";

import {createDiagnosticsStore} from "../../../runtime/diagnostics/diagnostics";

import {createConsoleExporterFactory, createConsoleFallback} from "./console-exporter";
import type {DiagnosticsConsole} from "./console-exporter";

describe("console 出口", () => {
    it("按级别分派到 console 方法，缺省方法退到 error；查询只来自 store 的有界缓冲并淘汰最旧项", async () => {
        const target = {info: vi.fn(), warn: vi.fn(), error: vi.fn()} satisfies DiagnosticsConsole;
        const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "tab-1"}, budget: {maxRecords: 2}});
        store.record({level: "debug", event: "early", message: "buffered"});
        const outcome = await createConsoleExporterFactory(target)({signal: new AbortController().signal});
        await store.attach({outcome, fallback: createConsoleFallback(target)});
        store.record({level: "warn", event: "w", message: "careful"});
        store.record({level: "fatal", event: "f", message: "boom"});
        await store.flush();
        expect(target.error.mock.calls.map(([line]) => line)).toEqual([
            expect.stringContaining("[debug] early: buffered"),
            expect.stringContaining("[fatal] f: boom"),
        ]);
        expect(target.warn).toHaveBeenCalledTimes(1);
        expect(store.query()).toMatchObject({records: [{event: "w"}, {event: "f"}], evicted: 1});
        expect(store.query({minLevel: "error"}).records.map((record) => record.origin)).toEqual([expect.objectContaining({location: "browser", instanceId: "tab-1"})]);
        await store.shutdown();
        expect(store.status().phase).toBe("closed");
    });

    it("兜底通道自身抛错不外泄；console 写失败让 store 降级而记录调用仍成功", async () => {
        const broken: DiagnosticsConsole = {error: () => {
            throw new Error("console detached");
        }};
        expect(() => createConsoleFallback(broken)({} as never)).not.toThrow();
        const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "tab-2"}});
        await store.attach({outcome: await createConsoleExporterFactory(broken)({signal: new AbortController().signal}), fallback: createConsoleFallback(broken)});
        expect(store.record({level: "error", event: "e", message: "m"}).status).toBe("accepted");
        await store.flush();
        expect(store.status().degraded?.reason).toBe("exporter-write-failed");
        expect(store.record({level: "error", event: "e2", message: "m"}).status).toBe("accepted");
    });
});
