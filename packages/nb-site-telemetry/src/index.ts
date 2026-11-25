/**
 * 统计模块的公开入口。进程入口 `nb-site-server` 用这里的东西把模块包成它的 `SiteModule`：迁移清单、读配置、建实例，
 * 写入口挂在哪个前缀下，以及备份时怎样处理副本（`prepareTelemetryBackupCopy`）。
 *
 * 本包不导入进程入口的类型：入口依赖模块包，反过来导入就成了环（ADR 0059 决策 2 只许模块依赖自己的合同包与通用包）。
 * 所以选项与返回值的类型由本包自己声明，入口的适配器负责对上形状。要问账号模块的事（t07 以后的“问身份”）也由适配器作为参数传进来。
 */

import type {Database} from "bun:sqlite";
import {Hono, type Context} from "hono";

import {aggregateUntilCaughtUp, createAggregator} from "./aggregate";
import type {TelemetryConfig} from "./config";
import {createIngestApp} from "./ingest";
import type {TelemetryLog} from "./log";
import {createPurge, PURGE_INTERVAL_MS} from "./purge";
import {createRateLimiter} from "./rate-limit";
import {createTelemetryStore} from "./store";
import {validateReport} from "./validate";

export {telemetryMigrations, type TelemetryMigration} from "./migrations";
export {parseTelemetryConfig, type TelemetryConfig, type TelemetryConfigProblem, type TelemetryConfigResult} from "./config";
export {TELEMETRY_INGEST_PREFIX} from "./ingest";
export {prepareTelemetryBackupCopy} from "./backup";
export type {TelemetryLog} from "./log";

/**
 * 一个定时任务；适配器把入口的 `context.jobs` 直接传进来，两边形状对不上时类型检查报错。任务名写在
 * `site.telemetry-ingest` 的输入一节（测试控制入口按它找任务）。
 */
export interface TelemetryJob {
    readonly name: string;
    readonly intervalMs: number;
    /** 开始调度之后第一次等多久；缺省等一个间隔。两个任务都是 0：重启比间隔频繁时也照样跑（Spec：启动后立即先跑一次）。 */
    readonly initialDelayMs?: number;
    run(): void | Promise<void>;
}

export interface TelemetryModuleOptions {
    /** 本模块自己的库连接，迁移已全部执行；只有本模块写它（ADR 0061 决策 1）。连接参数在 `createTelemetryModule` 里再改两条。 */
    readonly db: Database;
    readonly config: TelemetryConfig;
    readonly log: TelemetryLog;
    /** 模块取时间只经它：合同测试经测试控制入口拨的是这只时钟。 */
    readonly clock: {now(): number};
    /** 定时任务经它登记（入口在开始监听之后才调度）。 */
    readonly jobs: {register(job: TelemetryJob): void};
    /** 入口按 `site.operations` 的取法给的来源地址；只在 `ingest.ts` 里交给限流器，不写日志、不进库。 */
    readonly clientAddress: (c: Context) => string | null;
}

export interface TelemetryModule {
    /** 站点地址上的子应用；入口把它挂在 `TELEMETRY_API_PREFIX` 下，子应用里的路由不再带前缀。 */
    readonly site: Hono;
    /** 写入口主机上的子应用：三个写入口，入口把它挂在 `TELEMETRY_INGEST_PREFIX` 下。 */
    readonly ingest: Hono;
    /**
     * 停止时由入口在定时任务停下之后、关库之前调用（`ModuleInstance.close`）：置“正在关闭”标志，正在跑的任务在下一批之前
     * 收手，等它们 settle。入口先等调度器停下（至多 2 秒）才调这里，积压很多时任务会一直跑到那 2 秒用完，
     * 入口记一行超时的 warn，再到这里收手。
     */
    close(): Promise<void>;
}

export function createTelemetryModule(options: TelemetryModuleOptions): TelemetryModule {
    const {db} = options;
    // 业务连接不等锁。入口给每个模块设的 250 毫秒对统计不合适：`bun:sqlite` 等锁时整个事件循环停着，库被进程外占着写时
    // 每个写入请求都让全站（连同账号模块的登录）停 250 毫秒，被刷的时候就一直停着；设成 0 时立即得到 SQLITE_BUSY、回 503
    // （`site.telemetry-ingest` 输出 10）。成立的前提：进程内没有别的写者与它争锁（就绪检查的探测连接与它在同一个线程上同步
    // 执行，不会交错），进程外只有偶发的写者（备份是只读的 `VACUUM INTO`，不撞写锁）。以后有别的进程常规地写这个库时
    // （例如本模块加了 `shared` 命令），要重新考虑这个值。
    db.exec("PRAGMA busy_timeout = 0");
    // 删掉的原始上报不留在库文件的空闲页里：原始上报只留短期（ADR 0062），删了就要从文件里也消失（`site.telemetry-ingest` 输出 3）。
    db.exec("PRAGMA secure_delete = ON");

    const store = createTelemetryStore(db);
    // 限流状态只在内存里，进程重启就清零（`rate-limit.ts`）。
    const limiter = createRateLimiter({limit: options.config.rateLimit, now: () => options.clock.now()});
    const ingest = createIngestApp({store, validate: validateReport, limiter, clock: options.clock, log: options.log, clientAddress: options.clientAddress});

    // 两个任务共用一个聚合器：一批自带读游标与推游标，在批与批之间交错也不会把同一批算两遍（`aggregate.ts`）。
    const aggregator = createAggregator(db);
    let closing = false;
    const isClosing = (): boolean => closing;
    const running = new Set<Promise<void>>();
    /** 记下正在跑的那一轮，`close()` 要等它。失败照原样交给调度器记 `job.failed`，这里只是旁观。 */
    const tracked = (run: () => Promise<void>) => (): Promise<void> => {
        const current = run();
        running.add(current);
        const settle = (): void => void running.delete(current);
        current.then(settle, settle);
        return current;
    };
    const purge = createPurge({db, aggregator, limiter, clock: options.clock, retentionDays: options.config.retentionDays, log: options.log, closing: isClosing});
    options.jobs.register({name: "aggregate", intervalMs: options.config.aggregateIntervalMs, initialDelayMs: 0, run: tracked(() => aggregateUntilCaughtUp(aggregator, isClosing))});
    options.jobs.register({name: "purge", intervalMs: PURGE_INTERVAL_MS, initialDelayMs: 0, run: tracked(purge)});

    return {
        site: new Hono(),
        ingest,
        close: async () => {
            closing = true;
            await Promise.allSettled([...running]);
        },
    };
}
