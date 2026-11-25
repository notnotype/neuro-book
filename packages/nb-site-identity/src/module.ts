/**
 * 账号模块的组装：一条连接上的队列、库的装配、会话、子应用与定时任务。`index.ts` 的 `createIdentityModule` 用它；包内测试也直接
 * 用它，好拿到库与会话做准备工作（例如这一片还没有对外的登录，用例经 `sessions.issue` 发会话）。
 */

import type {Context, Hono} from "hono";

import {createIdentityApp} from "./app";
import {createIdentityAuth, type IdentityAuth} from "./auth";
import type {IdentityConfig} from "./config";
import type {IdentityConnection} from "./db/connection";
import type {IdentityLog} from "./index";
import {Sessions} from "./session";

/** 停止时等队列里当前持锁者的上限（`site.operations` 输出 9 的“每个模块至多 2 秒收尾”）。 */
const CLOSE_WAIT_MS = 2_000;

/** 清理任务的间隔（`site.accounts` 的定时任务一节）。 */
const PURGE_INTERVAL_MS = 600_000;

/**
 * 一个定时任务；适配器把入口的 `context.jobs` 传进来。`initialDelayMs` 是第一次运行前的等待：清理任务要“服务启动后先跑一次”，
 * 写 0。入口的任务调度认这个字段之前（它在统计的分支上加），第一次运行在一个间隔之后。
 */
export interface IdentityJob {
    readonly name: string;
    readonly intervalMs: number;
    readonly initialDelayMs?: number;
    run(): void | Promise<void>;
}

export interface IdentityAssemblyOptions {
    readonly config: IdentityConfig;
    /** 站点地址的 origin（`NB_SITE_URL`）。 */
    readonly siteUrl: string;
    readonly log: IdentityLog;
    /** 模块取时间只经它：合同测试经测试控制入口拨的是这只时钟。 */
    readonly clock: {now(): number};
    readonly jobs: {register(job: IdentityJob): void};
    /** 入口按 `site.operations` 的取法给的来源地址；限流（第 4 片）用，不写日志、不进库。 */
    readonly clientAddress: (c: Context) => string | null;
}

export interface IdentityAssembly {
    readonly auth: IdentityAuth;
    readonly sessions: Sessions;
    readonly site: Hono;
    close(): Promise<void>;
}

/**
 * 建模块。库的结构检查在库第一次被调用时才跑（表不对时 `create()` 照样成功、第一个请求才失败），所以这里主动触发一次：
 * 表少了列时以库的 `SCHEMA_MISMATCH` 失败，入口按 `start_failed` 收口（设计审查第 13 条；升级清单“库内行为”一行）。
 */
export async function assembleIdentity(conn: IdentityConnection, options: IdentityAssemblyOptions): Promise<IdentityAssembly> {
    const {config, clock, log} = options;
    const auth = createIdentityAuth({database: conn.libDatabase(), siteUrl: options.siteUrl, secret: config.sessionSecret, sessionDays: config.sessionDays, clock, log});
    const context = await auth.$context;
    // 1.7.27 对自定义的 Kysely 方言也登记了结构检查；没有它时不能确认表能收下库写的东西，不启动。
    if (context.checkSchema === undefined) throw new Error("the library registered no schema check for the identity database");
    await context.checkSchema();

    const sessions = new Sessions({auth, conn, clock, sessionDays: config.sessionDays, termsVersion: config.termsVersion, log});
    const site = createIdentityApp({sessions, siteOrigin: new URL(options.siteUrl).origin, termsVersion: config.termsVersion, registrationOpen: config.registrationOpen, log});
    options.jobs.register({name: "purge", intervalMs: PURGE_INTERVAL_MS, initialDelayMs: 0, run: () => sessions.purge()});
    return {auth, sessions, site, close: () => conn.close(CLOSE_WAIT_MS)};
}
