/**
 * 浏览器 console 出口：按级别写到 console，写入失败时诊断降级而记录调用照常成功（runtime.diagnostics 失败与恢复）。
 */

import {describe, expect, it} from "bun:test";

import {createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";

import {createConsoleExporterFactory, createConsoleFallback} from "./console-exporter";
import type {DiagnosticsConsole} from "./console-exporter";

const signal = new AbortController().signal;

async function attached(target: DiagnosticsConsole): Promise<DiagnosticsStore> {
    const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "console-test"}});
    await store.attach({outcome: await createConsoleExporterFactory(target)({signal}), fallback: createConsoleFallback(target)});
    return store;
}

/** 方法依赖 this 的 console：浏览器 console 的方法离开 console 对象调用会抛错。 */
class RecordingConsole implements DiagnosticsConsole {
    readonly lines: Array<[string, string]> = [];

    error(message: unknown): void {
        this.lines.push(["error", String(message)]);
    }

    warn(message: unknown): void {
        this.lines.push(["warn", String(message)]);
    }
}

describe("浏览器 console 出口", () => {
    it("按级别写到对应方法，console 没有的级别退到 error", async () => {
        const target = new RecordingConsole();
        const store = await attached(target);
        store.record({level: "warn", event: "test.warn", message: "注意"});
        store.record({level: "info", event: "test.info", message: "消息"});
        store.record({level: "fatal", event: "test.fatal", message: "致命"});
        await store.flush();
        expect(target.lines.map(([method, line]) => [method, line.slice(line.indexOf("["))])).toEqual([
            ["warn", "[warn] test.warn: 注意"],
            ["error", "[info] test.info: 消息"],
            ["error", "[fatal] test.fatal: 致命"],
        ]);
        await store.shutdown();
    });

    it("console 写入失败：诊断降级，记录调用仍被接受；兜底通道自己失败也不外泄", async () => {
        const store = await attached({
            error: () => {
                throw new Error("console 不可用");
            },
        });
        expect(store.record({level: "error", event: "test.error", message: "写不出去"}).status).toBe("accepted");
        await store.flush();
        expect(store.status().degraded?.reason).toBe("exporter-write-failed");
        expect(store.record({level: "error", event: "test.after", message: "降级之后"}).status).toBe("accepted");
        await store.shutdown();
    });
});
