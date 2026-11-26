/**
 * 账号模块的限流（`site.accounts` 输出 19；w00037 t07 计划 3.8，以及设计审查第 6 条、omp 设计审查第 3、19 条）。
 *
 * 照统计模块的限流器（`nb-site-telemetry/src/rate-limit.ts`）的做法另写一份，不共用：两个模块包互不依赖，口径也不全一样（这里六个
 * 计数器、两种窗长、多了失败计数与多键一起判，键满了以后共用溢出额度而不是一律拒绝）。计划 3.8 的“各做一份还是共用”。
 *
 * 状态只在本进程的内存里，重启清零（`site.accounts` 时序一节）。来源地址与用户名的摘要只作为表的键存在，不写日志、不进库；窗口一过
 * 整张表清掉（判的时候发现换了窗口，或没有新请求时由 `sweep`），所以已经过去的窗口的键不占名额。
 *
 * 时间取自调用方给的 `now`（模块的 `clock.now()`）：合同测试拨时间就能跨窗口。窗口按 `now` 对齐（`Math.floor(now / windowMs)`），
 * 不是滑动的，跨过边界的一个窗长里可以到两倍（输出 19 原文）。
 */

import {createHash} from "node:crypto";

import type {IdentityLog} from "./index";

/** 每个计数器至多这么多个键（输出 19）。 */
export const RATE_LIMIT_MAX_KEYS = 100_000;

/** 键满了以后，窗口内新出现的键共用一份溢出额度，为该计数上限的这么多倍（输出 19）。 */
export const OVERFLOW_LIMIT_FACTOR = 10;

/** IPv6 的 /48 合计的额度是单个来源的这么多倍（输出 19）。 */
export const PREFIX48_LIMIT_FACTOR = 16;

/** `identity.rate_limit_full` 同一个计数器至多每这么多毫秒记一行：满着的时候每个新键都会碰到，不节流会刷满日志。 */
const FULL_LOG_INTERVAL_MS = 60_000;

export type RateLimitDecision = {readonly ok: true} | {readonly ok: false; readonly retryAfterSeconds: number};

/** 判一个键的结果。过了的带着 `commit`：调用方决定计不计入（多键一起判时，先判完全部再计）。 */
export type RateLimitCheck = {readonly ok: true; commit(): void} | {readonly ok: false; readonly retryAfterSeconds: number};

export interface RateLimitCounterOptions {
    /** 计数器的名字，只进 `identity.rate_limit_full` 那一行日志，例如 `login_source`。 */
    readonly name: string;
    /** 每个键每个窗口的次数。 */
    readonly limit: number;
    readonly windowMs: number;
    readonly now: () => number;
    readonly log: Pick<IdentityLog, "warn">;
    /** 缺省 `RATE_LIMIT_MAX_KEYS`；包内测试给小一点的值。 */
    readonly maxKeys?: number;
}

/**
 * 一个对齐窗口的计数器，键是任意字符串。`check` 只判不计，`commit` 才计；`check` 与它给的 `commit` 之间不能有别的 `check`、
 * `commit`（多键一起判的 `takeAll` 是同步的，满足这一条）。
 */
export class RateLimitCounter {
    readonly #options: RateLimitCounterOptions;
    readonly #maxKeys: number;
    readonly #overflowLimit: number;
    readonly #counts = new Map<string, number>();
    /** 键满了以后新键共用的计数，随窗口清零。 */
    #overflow = 0;
    #window = Number.NaN;
    #lastFullLogAt = Number.NEGATIVE_INFINITY;

    constructor(options: RateLimitCounterOptions) {
        this.#options = options;
        this.#maxKeys = options.maxKeys ?? RATE_LIMIT_MAX_KEYS;
        this.#overflowLimit = options.limit * OVERFLOW_LIMIT_FACTOR;
    }

    check(key: string): RateLimitCheck {
        const now = this.#options.now();
        this.#roll(now);
        const rejected: RateLimitCheck = {ok: false, retryAfterSeconds: retryAfterSeconds(this.#window, this.#options.windowMs, now)};
        const count = this.#counts.get(key);
        if (count === undefined && this.#counts.size >= this.#maxKeys) {
            this.#logFull(now);
            if (this.#overflow >= this.#overflowLimit) return rejected;
            return {ok: true, commit: () => void (this.#overflow += 1)};
        }
        if ((count ?? 0) >= this.#options.limit) return rejected;
        return {ok: true, commit: () => void this.#counts.set(key, (count ?? 0) + 1)};
    }

    /** 判一个键，过了就计入。 */
    take(key: string): RateLimitDecision {
        const result = this.check(key);
        if (!result.ok) return result;
        result.commit();
        return {ok: true};
    }

    /** 换了窗口就清空：没有新请求时，上一个窗口的键也按时离开内存。由清理任务调用。 */
    sweep(): void {
        this.#roll(this.#options.now());
    }

    /** 内存里记着的键数（上一次判或 `sweep` 时的窗口），不含共用溢出额度的那些。 */
    keys(): number {
        return this.#counts.size;
    }

    #roll(now: number): void {
        const current = Math.floor(now / this.#options.windowMs);
        if (current === this.#window) return;
        this.#window = current;
        this.#counts.clear();
        this.#overflow = 0;
    }

    #logFull(now: number): void {
        if (now - this.#lastFullLogAt < FULL_LOG_INTERVAL_MS) return;
        this.#lastFullLogAt = now;
        this.#options.log.warn("identity.rate_limit_full", "a rate limit counter is full; new keys share the overflow quota", {counter: this.#options.name, maxKeys: this.#maxKeys});
    }
}

function retryAfterSeconds(window: number, windowMs: number, now: number): number {
    return Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000));
}

/**
 * 多个键一起判（omp 设计审查第 3、19 条；输出 19“在哪个键上被限流拒绝，那一次就不计入哪个键”）：每个键都判；没超限的都计入，
 * 超限的不计入；任一个超限就整体拒绝，`Retry-After` 取超限的键里最晚恢复的那个。
 */
export function takeAll(checks: readonly RateLimitCheck[]): RateLimitDecision {
    let retryAfter = 0;
    for (const check of checks) {
        if (check.ok) check.commit();
        else retryAfter = Math.max(retryAfter, check.retryAfterSeconds);
    }
    return retryAfter === 0 ? {ok: true} : {ok: false, retryAfterSeconds: retryAfter};
}

/**
 * IPv6 字面量展开成 8 个 16 位的组；不是 IPv6 的十六进制写法时为 null。末尾写成点分 IPv4 的写法不收：入口的规范写法是 WHATWG
 * `URL` 的序列化，不会出现它（映射地址已当作 IPv4）。与统计模块的同名函数是同一个写法。
 */
function ipv6Groups(address: string): number[] | null {
    const halves = address.split("::");
    if (halves.length > 2) return null;
    const parse = (part: string): number[] | null => {
        if (part === "") return [];
        const groups = part.split(":");
        if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/u.test(group))) return null;
        return groups.map((group) => Number.parseInt(group, 16));
    };
    const head = parse(halves[0]!);
    const tail = halves.length === 2 ? parse(halves[1]!) : [];
    if (head === null || tail === null) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    // `::` 至少代表一组零。
    const zeros = 8 - head.length - tail.length;
    return zeros >= 1 ? [...head, ...new Array<number>(zeros).fill(0), ...tail] : null;
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;

/**
 * 来源地址的键：IPv4 是地址本身；IPv6 是 /64，另给 /48 的合计键。来源地址由入口写成了唯一的一种写法（`site.operations` 的输入一节
 * “来源地址”），这里不再规范化写法，只按解析出的地址值取前缀：压缩写法里 `::` 的位置会变，按字符串截前几组会截错。`address` 不是
 * IP 字面量时抛 `TypeError`：那是入口的程序错误，不能悄悄把它当成一个来源。
 */
function sourceKeysOf(address: string): {readonly source: string; readonly prefix48: string | null} {
    if (IPV4.test(address)) return {source: address, prefix48: null};
    const groups = ipv6Groups(address);
    if (groups === null) throw new TypeError("rate limiter source is not an IP literal");
    const hex = (count: number): string => groups.slice(0, count).map((group) => group.toString(16)).join(":");
    return {source: `${hex(4)}::/64`, prefix48: `${hex(3)}::/48`};
}

/**
 * 按来源地址计的计数器：单个来源一个计数器，IPv6 的 /48 另一个（额度 16 倍）。两个合起来当作一个键判：先判 /48，被它挡下的不再看
 * /64，也不为它建条目（一个人换着 /64 刷，条目数跟着 /48 的额度封顶）；两个都过了才一起计入。
 */
export class SourceRateLimitCounter {
    readonly #sources: RateLimitCounter;
    readonly #prefix48: RateLimitCounter;

    constructor(options: RateLimitCounterOptions) {
        this.#sources = new RateLimitCounter(options);
        this.#prefix48 = new RateLimitCounter({...options, name: `${options.name}_prefix48`, limit: options.limit * PREFIX48_LIMIT_FACTOR});
    }

    check(address: string): RateLimitCheck {
        const keys = sourceKeysOf(address);
        const prefix = keys.prefix48 === null ? null : this.#prefix48.check(keys.prefix48);
        if (prefix !== null && !prefix.ok) return prefix;
        const source = this.#sources.check(keys.source);
        if (!source.ok) return source;
        return {
            ok: true,
            commit: () => {
                source.commit();
                prefix?.commit();
            },
        };
    }

    take(address: string): RateLimitDecision {
        return takeAll([this.check(address)]);
    }

    sweep(): void {
        this.#sources.sweep();
        this.#prefix48.sweep();
    }

    /** 记着的来源数（IPv4 地址与 IPv6 的 /64），不含 /48 的合计。 */
    keys(): number {
        return this.#sources.keys();
    }
}

export interface FailureCounterOptions {
    readonly name: string;
    /** 一个窗口里失败到这么多次，之后每次登录先等（输出 19：20 次）。 */
    readonly threshold: number;
    readonly windowMs: number;
    readonly now: () => number;
    readonly log: Pick<IdentityLog, "warn">;
    readonly maxKeys?: number;
}

/**
 * 失败计数：只加不判，不拒绝，只回答“要不要先等”。键满了以后不再建新键，窗口内新出现的键一律当作已过阈值（宁可让没失败过的人
 * 多等 2 秒，也不让内存无限长，也不让刷满键的人把别人的失败计数挤掉）。
 */
export class FailureCounter {
    readonly #options: FailureCounterOptions;
    readonly #maxKeys: number;
    readonly #counts = new Map<string, number>();
    #window = Number.NaN;
    #lastFullLogAt = Number.NEGATIVE_INFINITY;

    constructor(options: FailureCounterOptions) {
        this.#options = options;
        this.#maxKeys = options.maxKeys ?? RATE_LIMIT_MAX_KEYS;
    }

    add(key: string): void {
        const now = this.#options.now();
        this.#roll(now);
        const count = this.#counts.get(key);
        if (count !== undefined) this.#counts.set(key, count + 1);
        else if (this.#counts.size < this.#maxKeys) this.#counts.set(key, 1);
        else this.#logFull(now);
    }

    overThreshold(key: string): boolean {
        const now = this.#options.now();
        this.#roll(now);
        const count = this.#counts.get(key);
        if (count !== undefined) return count >= this.#options.threshold;
        if (this.#counts.size < this.#maxKeys) return false;
        this.#logFull(now);
        return true;
    }

    sweep(): void {
        this.#roll(this.#options.now());
    }

    keys(): number {
        return this.#counts.size;
    }

    #roll(now: number): void {
        const current = Math.floor(now / this.#options.windowMs);
        if (current === this.#window) return;
        this.#window = current;
        this.#counts.clear();
    }

    #logFull(now: number): void {
        if (now - this.#lastFullLogAt < FULL_LOG_INTERVAL_MS) return;
        this.#lastFullLogAt = now;
        this.#options.log.warn("identity.rate_limit_full", "a rate limit counter is full; new keys count as over the threshold", {counter: this.#options.name, maxKeys: this.#maxKeys});
    }
}

/**
 * 用户名在键里的写法：规范化（转小写，输出 19）之后 SHA-256 的前 16 字节。不用原文：用户名或邮箱至多 254 个字符，原文做键时
 * 10 万个键能占几十 MB，摘要定长（计划 3.8）。调用方给的已是规范化后的登录名，这里再转一次小写只是保证同一个人落在同一个键上。
 */
function usernameKey(username: string): string {
    return createHash("sha256").update(username.toLowerCase(), "utf8").digest().subarray(0, 16).toString("hex");
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** 输出 19 的数。 */
const LOGIN_WINDOW_MS = 5 * MINUTE_MS;
const LOGIN_SOURCE_LIMIT = 30;
const LOGIN_SOURCE_USER_LIMIT = 10;
const LOGIN_FAILURE_THRESHOLD = 20;
const REGISTER_LIMIT = 5;
const CHANGE_PASSWORD_LIMIT = 5;
const INVITE_CODE_LIMIT = 10;

export interface IdentityRateLimitsOptions {
    readonly now: () => number;
    readonly log: Pick<IdentityLog, "warn">;
    /** 缺省 `RATE_LIMIT_MAX_KEYS`；包内测试给小一点的值。 */
    readonly maxKeys?: number;
}

/**
 * 账号模块的六个计数器（计划 3.8 的表，另加生成邀请码的一个，`site.accounts` 输出 18、19）。`address` 是 `clientAddress(c)` 的
 * 返回值：取不到时调用方先回 `forbidden_origin`，不调这里（输出 19“不与别的请求合并计数”）。
 */
export interface IdentityRateLimits {
    /**
     * 登录的两个键：来源（每 5 分钟 30 次）、来源加用户名（每 5 分钟 10 次）；每次尝试都调。来源过了时两个一起判；来源被拒时只回来源的
     * 结果，来源加用户名不判也不计。
     */
    login(address: string, username: string): RateLimitDecision;
    /** 这个用户名这一小时里失败到 20 次了没有：到了，这次登录先等 2 秒。 */
    loginNeedsDelay(username: string): boolean;
    /** 校验失败时调。 */
    recordLoginFailure(username: string): void;
    /**
     * 社交登录的发起：只计登录的来源键（与密码登录共用键与额度，输出 19）。发起时还没有用户名，来源加用户名、失败计数都不涉及。
     * 不计时一个来源能以请求速率让发起往库里写行（库的 state 行与流程行各一行，到期后才被清理）。
     */
    socialLoginStart(address: string): RateLimitDecision;
    /** 注册：来源每小时 5 次。 */
    register(address: string): RateLimitDecision;
    /** 改密码：账号每小时 5 次。 */
    changePassword(accountId: string | number): RateLimitDecision;
    /** 生成邀请码：账号每小时 10 次。停用了再生成也计：只数“同时有效”的上限挡不住生成、停用的循环。 */
    generateInviteCode(accountId: string | number): RateLimitDecision;
    /** 清掉已过去的窗口；清理任务调用。 */
    sweep(): void;
}

export function createIdentityRateLimits(options: IdentityRateLimitsOptions): IdentityRateLimits {
    const base = {now: options.now, log: options.log, ...(options.maxKeys === undefined ? {} : {maxKeys: options.maxKeys})};
    const loginSource = new SourceRateLimitCounter({...base, name: "login_source", limit: LOGIN_SOURCE_LIMIT, windowMs: LOGIN_WINDOW_MS});
    const loginSourceUser = new RateLimitCounter({...base, name: "login_source_user", limit: LOGIN_SOURCE_USER_LIMIT, windowMs: LOGIN_WINDOW_MS});
    const loginFailures = new FailureCounter({...base, name: "login_failures", threshold: LOGIN_FAILURE_THRESHOLD, windowMs: HOUR_MS});
    const register = new SourceRateLimitCounter({...base, name: "register_source", limit: REGISTER_LIMIT, windowMs: HOUR_MS});
    const changePassword = new RateLimitCounter({...base, name: "change_password", limit: CHANGE_PASSWORD_LIMIT, windowMs: HOUR_MS});
    const generateInviteCode = new RateLimitCounter({...base, name: "invite_code", limit: INVITE_CODE_LIMIT, windowMs: HOUR_MS});
    return {
        login: (address, username) => {
            const sourceCheck = loginSource.check(address);
            // 来源被拒时不再判来源加用户名，也就不计入、不新建它的条目（输出 19；实现审查第 4、5 片第 1 条）：不然一个已被 429 的来源
            // 每换一个用户名就往这张表里添一个键，以请求速率把它占满、再用完溢出额度，这一窗里所有第一次出现的组合都得 429。
            // 两个计数器窗长相同、都按 `now` 对齐，只看来源的 `Retry-After` 不会比两个一起判时早。
            if (!sourceCheck.ok) return sourceCheck;
            // 来源加用户名的键里，来源取与来源计数器相同的写法（IPv6 的 /64），所以换着 /64 里的地址也落在同一个键上。
            const userCheck = loginSourceUser.check(`${sourceKeysOf(address).source}|${usernameKey(username)}`);
            return takeAll([sourceCheck, userCheck]);
        },
        loginNeedsDelay: (username) => loginFailures.overThreshold(usernameKey(username)),
        recordLoginFailure: (username) => loginFailures.add(usernameKey(username)),
        socialLoginStart: (address) => loginSource.take(address),
        register: (address) => register.take(address),
        changePassword: (accountId) => changePassword.take(String(accountId)),
        generateInviteCode: (accountId) => generateInviteCode.take(String(accountId)),
        sweep: () => {
            loginSource.sweep();
            loginSourceUser.sweep();
            loginFailures.sweep();
            register.sweep();
            changePassword.sweep();
            generateInviteCode.sweep();
        },
    };
}
