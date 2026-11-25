/**
 * 包内测试用的模块实例：真的 `createTelemetryModule`（连接参数、两个任务、`close()` 都是产品的），定时任务不进调度器，
 * 由测试直接调它登记的 `run()`；时钟由测试拨，日志记进数组。不含断言。
 */

import type {Database} from "bun:sqlite";

import {createTelemetryModule, type TelemetryJob, type TelemetryModule} from "../index";
import type {TelemetryLog} from "../log";
import {NOW} from "./reports";

export interface LogLine {
    readonly level: "info" | "warn" | "error";
    readonly event: string;
    readonly fields: Readonly<Record<string, unknown>>;
}

export interface TestModule {
    readonly module: TelemetryModule;
    readonly jobs: ReadonlyMap<string, TelemetryJob>;
    readonly logs: LogLine[];
    /** 模块看到的当前时间；测试直接改。 */
    readonly clock: {now(): number; set(ms: number): void};
    /** 跑一次登记的任务，等它 settle。 */
    run(job: "aggregate" | "purge"): Promise<void>;
}

export function createTestModule(db: Database, options: {retentionDays?: number} = {}): TestModule {
    let now = NOW;
    const clock = {now: () => now, set: (ms: number) => void (now = ms)};
    const logs: LogLine[] = [];
    const line =
        (level: LogLine["level"]) =>
        (event: string, _message: string, fields: Readonly<Record<string, unknown>> = {}): void =>
            void logs.push({level, event, fields});
    const log: TelemetryLog = {info: line("info"), warn: line("warn"), error: line("error")};
    const jobs = new Map<string, TelemetryJob>();
    const module = createTelemetryModule({
        db,
        config: {retentionDays: options.retentionDays ?? 7, rateLimit: 600, aggregateIntervalMs: 600_000},
        log,
        clock,
        jobs: {register: (job) => void jobs.set(job.name, job)},
        clientAddress: () => null,
    });
    return {
        module,
        jobs,
        logs,
        clock,
        run: async (name) => {
            const job = jobs.get(name);
            if (job === undefined) throw new Error(`job ${name} is not registered`);
            await job.run();
        },
    };
}
