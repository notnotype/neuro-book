/**
 * 账号模块的组装：一条连接上的队列、库的装配、会话、哈希限额与限流、子应用与定时任务。`index.ts` 的 `createIdentityModule` 用它；
 * 包内测试也直接用它，好拿到库与会话做准备工作，并经 `IdentityOverrides` 换掉要注入的几样。
 */

import type {Context, Hono} from "hono";

import {createIdentityApp} from "./app";
import {createIdentityAuth, identityJwtOptions, type IdentityAuth} from "./auth";
import type {IdentityConfig} from "./config";
import type {IdentityConnection, IdentityTimers} from "./db/connection";
import {HashLimiter, type FailureFloorTiming} from "./hash-limiter";
import type {IdentityLog} from "./index";
import {dummyPasswordHash} from "./login";
import {type ConsentDecision} from "./oauth/consent-api";
import {resolveContinue, type ContinueResolver} from "./oauth/continue";
import {buildDiscoveryDocument, createWellKnownApp} from "./oauth/discovery";
import {createOAuthApp} from "./oauth/mount";
import {prepareSigningKey} from "./oauth/signing-key";
import {REAL_PASSWORD_FUNCTIONS, type PasswordFunctions} from "./password";
import {createIdentityRateLimits} from "./rate-limit";
import {Sessions} from "./session";
import {createSocialCallback} from "./social/callback";
import {openProviders} from "./social/providers";

/** 停止时等队列里当前持锁者的上限（`site.operations` 输出 9 的“每个模块至多 2 秒收尾”）。 */
const CLOSE_WAIT_MS = 2_000;

/** 清理任务的间隔（`site.accounts` 的定时任务一节）。 */
const PURGE_INTERVAL_MS = 600_000;

/**
 * 一个定时任务；适配器把入口的 `context.jobs` 传进来，形状与入口的 `JobDefinition` 相同。`initialDelayMs` 是开始调度之后第一次
 * 运行前的等待，缺省等一个间隔。
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
    /** 包一层确认页接口交库的那一步：用来在接口判完客户端、库还没判之间改客户端（`oauth/consent-api.ts`）。 */
    readonly wrapOAuthConsent?: (decide: ConsentDecision) => ConsentDecision;
}

export interface IdentityAssembly {
    readonly auth: IdentityAuth;
    readonly sessions: Sessions;
    /** 站点 API 前缀下的自家路由（`app.ts`）。 */
    readonly site: Hono;
    /** 库的对外端点（`oauth/mount.ts`），挂在 `LIB_BASE_PATH` 下。 */
    readonly oauth: Hono;
    /** 两份发现文档（`oauth/discovery.ts`），挂在 `WELL_KNOWN_PREFIX` 下。 */
    readonly wellKnown: Hono;
    close(): Promise<void>;
}

/**
 * 建模块。库的结构检查在库第一次被调用时才跑（表不对时 `create()` 照样成功、第一个请求才失败），所以这里主动触发一次：
 * 表少了列时以库的 `SCHEMA_MISMATCH` 失败，入口按 `start_failed` 收口（设计审查第 13 条；升级清单“内部接口”的 `checkSchema` 一行）。
 */
export async function assembleIdentity(conn: IdentityConnection, options: IdentityAssemblyOptions, overrides: IdentityOverrides = {}): Promise<IdentityAssembly> {
    const {config, clock, log} = options;
    const auth = createIdentityAuth({conn, siteUrl: options.siteUrl, secret: config.sessionSecret, sessionDays: config.sessionDays, termsVersion: config.termsVersion, clock, log, social: config.social});
    const context = await auth.$context;
    // 1.7.27 对自定义的 Kysely 方言也登记了结构检查；没有它时不能确认表能收下库写的东西，不启动。
    if (context.checkSchema === undefined) throw new Error("the library registered no schema check for the identity database");
    await context.checkSchema();
    // 签名钥在表结构确认之后备好：表里有别的算法的钥匙时启动失败；最新的活钥解不开时换一把（`oauth/signing-key.ts`）。
    await prepareSigningKey({context, conn, jwtOptions: identityJwtOptions(options.siteUrl), log});
    // 发现文档里的签名算法以上一步的检查为前提，所以在它之后生成。
    const wellKnown = createWellKnownApp(await buildDiscoveryDocument(auth), log);
    const siteOrigin = new URL(options.siteUrl).origin;
    // 续接令牌与确认标识是库签名的参数，验签用库上下文的 `secret`（`oauth/continue.ts`）；10 分钟按模块时钟。
    const {secret} = context;
    const continueResolver: ContinueResolver = (token, consumer) => resolveContinue(token, clock.now(), consumer, secret);
    const decide: ConsentDecision = async (accept, signedQuery, cookie) => {
        const headers = new Headers(cookie === null ? {} : {cookie});
        return (await auth.api.oauth2Consent({body: {accept, oauth_query: signedQuery}, headers})).url;
    };

    const sessions = new Sessions({auth, conn, clock, sessionDays: config.sessionDays, termsVersion: config.termsVersion, log});
    // 社交上游的开关由配置给（计划 3.12）：没开放的上游，发起回 `provider_disabled`、回调地址 404。
    const socialProviders = openProviders(config.social);
    const oauth = createOAuthApp({auth, conn, sessions, clock, siteOrigin, log, social: {providers: socialProviders, callback: createSocialCallback({auth, conn, clock, siteOrigin, log})}});
    const passwords = overrides.passwords ?? REAL_PASSWORD_FUNCTIONS;
    const hashLimiter = new HashLimiter({concurrency: config.hashConcurrency, queue: config.hashQueue, log, ...(overrides.hashTimers === undefined ? {} : {timers: overrides.hashTimers})});
    const rateLimits = createIdentityRateLimits({now: () => clock.now(), log});
    // 账号不存在或没有密码时拿它校验（`login.ts` 第 5 步）。启动时算一次，不经哈希限额：这时还没有请求。
    const dummyHash = await dummyPasswordHash(passwords);
    const issue: Sessions["issue"] = (userId, userAgent) => sessions.issue(userId, userAgent);
    const issueSession = overrides.wrapIssueSession?.(issue) ?? issue;
    const site = createIdentityApp({
        sessions,
        siteOrigin,
        termsVersion: config.termsVersion,
        registrationOpen: config.registrationOpen,
        socialProviders,
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
            resolveContinue: continueResolver,
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
            resolveContinue: continueResolver,
        },
        changePassword: {sessions, conn, hashLimiter, rateLimits, clock, log, passwords},
        me: {sessions, conn, clock, termsVersion: config.termsVersion, resolveContinue: continueResolver},
        mySessions: {sessions, conn, clock, log},
        inviteCodes: {sessions, conn, clock, rateLimits},
        registrationCodes: {sessions, conn, clock},
        adminUsers: {sessions, conn, clock, hashLimiter, passwords},
        adminInviteCodes: {sessions, conn, clock},
        audit: {sessions, conn},
        adminOAuthClients: {sessions, conn, clock, log, auth, adapter: context.adapter},
        oauthConsent: {sessions, conn, clock, log, siteOrigin, secret, decide: overrides.wrapOAuthConsent?.(decide) ?? decide},
        grants: {sessions, conn, clock},
        socialStart: {
            auth,
            conn,
            sessions,
            clock,
            providers: socialProviders,
            siteOrigin,
            hashLimiter,
            rateLimits,
            passwords,
            resolveContinue: continueResolver,
            registration: {clientAddress: options.clientAddress, termsVersion: config.termsVersion, registrationOpen: config.registrationOpen},
            log,
        },
        identities: {sessions, conn, clock},
    });
    // 清理任务顺带清掉已过去的限流窗口（`site.accounts` 的定时任务一节）。限流只在内存里，清它不碰库，放在删会话之前：库不可写时
    // 删会话失败、这次任务以失败结束，内存里的窗口照样清了。
    // 第一次不等间隔（`initialDelayMs: 0`，Spec：服务启动后先跑一次），与统计的两个任务同一个理由：重启比 10 分钟频繁时（部署、
    // 崩溃后重启），只等间隔的第一次永远轮不到，到期的会话就一直不删。
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
    return {auth, sessions, site, oauth, wellKnown, close: async () => void (await Promise.all([hashLimiter.close(CLOSE_WAIT_MS), conn.close(CLOSE_WAIT_MS)]))};
}
