/**
 * 账号模块的组装：一条连接上的队列、库的装配、会话、哈希限额与限流、子应用与定时任务。`index.ts` 的 `createIdentityModule` 用它；
 * 包内测试也直接用它，好拿到库与会话做准备工作，并经 `IdentityOverrides` 换掉要注入的几样。
 */

import type {Context, Hono} from "hono";

import {createIdentityApp} from "./app";
import {createIdentityAuth, type IdentityAuth} from "./auth";
import type {IdentityConfig} from "./config";
import type {IdentityConnection, IdentityTimers} from "./db/connection";
import {HashLimiter, type FailureFloorTiming} from "./hash-limiter";
import type {IdentityLog} from "./index";
import {dummyPasswordHash} from "./login";
import {REAL_PASSWORD_FUNCTIONS, type PasswordFunctions} from "./password";
import {createIdentityRateLimits} from "./rate-limit";
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

/**
 * 包内测试换掉的几样，产品不给（都用真的）。只换时间与“在两步之间插入动作”的口子，不换判断：哈希与校验的包装要调真的函数。
 */
export interface IdentityOverrides {
    /** 哈希与校验；包装用来数调用次数，或在校验完、发会话之前插入改密码或封禁（计划第 6 节）。 */
    readonly passwords?: PasswordFunctions;
    /** 登录“先等 2 秒”的睡眠。 */
    readonly loginDelay?: (ms: number) => Promise<void>;
    /** 失败下限的时间来源。 */
    readonly failureFloor?: FailureFloorTiming;
    /** 哈希排队 5 秒与关闭等待用的计时器。 */
    readonly hashTimers?: IdentityTimers;
    /** 包一层发会话：用来在库的事务开着时插入动作。 */
    readonly wrapIssueSession?: (issue: Sessions["issue"]) => Sessions["issue"];
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
export async function assembleIdentity(conn: IdentityConnection, options: IdentityAssemblyOptions, overrides: IdentityOverrides = {}): Promise<IdentityAssembly> {
    const {config, clock, log} = options;
    const auth = createIdentityAuth({database: conn.libDatabase(), siteUrl: options.siteUrl, secret: config.sessionSecret, sessionDays: config.sessionDays, clock, log});
    const context = await auth.$context;
    // 1.7.27 对自定义的 Kysely 方言也登记了结构检查；没有它时不能确认表能收下库写的东西，不启动。
    if (context.checkSchema === undefined) throw new Error("the library registered no schema check for the identity database");
    await context.checkSchema();

    const sessions = new Sessions({auth, conn, clock, sessionDays: config.sessionDays, termsVersion: config.termsVersion, log});
    const passwords = overrides.passwords ?? REAL_PASSWORD_FUNCTIONS;
    const hashLimiter = new HashLimiter({concurrency: config.hashConcurrency, queue: config.hashQueue, log, ...(overrides.hashTimers === undefined ? {} : {timers: overrides.hashTimers})});
    const rateLimits = createIdentityRateLimits({now: () => clock.now(), log});
    // 账号不存在或没有密码时拿它校验（`login.ts` 第 5 步）。启动时算一次，不经哈希限额：这时还没有请求。
    const dummyHash = await dummyPasswordHash(passwords);
    const issue: Sessions["issue"] = (userId, userAgent) => sessions.issue(userId, userAgent);
    const issueSession = overrides.wrapIssueSession?.(issue) ?? issue;
    const site = createIdentityApp({
        sessions,
        siteOrigin: new URL(options.siteUrl).origin,
        termsVersion: config.termsVersion,
        registrationOpen: config.registrationOpen,
        log,
        login: {
            conn,
            adapter: context.adapter,
            issueSession,
            hashLimiter,
            rateLimits,
            clientAddress: options.clientAddress,
            clock,
            log,
            passwords,
            dummyHash,
            delay: overrides.loginDelay ?? ((ms) => Bun.sleep(ms)),
            failureFloor: overrides.failureFloor ?? {},
        },
        register: {
            conn,
            adapter: context.adapter,
            issueSession,
            hashLimiter,
            rateLimits,
            clientAddress: options.clientAddress,
            clock,
            passwords,
            termsVersion: config.termsVersion,
            registrationOpen: config.registrationOpen,
        },
        changePassword: {sessions, conn, hashLimiter, rateLimits, clock, log, passwords},
        me: {sessions, conn, clock, termsVersion: config.termsVersion},
        mySessions: {sessions, conn, clock, log},
        inviteCodes: {sessions, conn, clock},
        registrationCodes: {sessions, conn, clock},
    });
    // 清理任务顺带清掉已过去的限流窗口（`site.accounts` 的定时任务一节）。限流只在内存里，清它不碰库，放在删会话之前：库不可写时
    // 删会话失败、这次任务以失败结束，内存里的窗口照样清了。
    options.jobs.register({
        name: "purge",
        intervalMs: PURGE_INTERVAL_MS,
        initialDelayMs: 0,
        run: () => {
            rateLimits.sweep();
            return sessions.purge();
        },
    });
    // 哈希限额与连接的队列一起收：都拒收新的、等在算的与持锁的做完，各自至多 2 秒，同时等（`site.operations` 输出 9 的“每个模块至多
    // 2 秒收尾”）。
    return {auth, sessions, site, close: async () => void (await Promise.all([hashLimiter.close(CLOSE_WAIT_MS), conn.close(CLOSE_WAIT_MS)]))};
}
