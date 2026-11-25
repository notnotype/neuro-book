/**
 * 密码哈希的限额（`site.accounts` 输出 20；w00037 t07 计划 3.7 的“哈希限额”）。一个计数信号量：同时在算的至多 `concurrency` 个，
 * 排队的至多 `queue` 个，排队超过 5 秒的出队。登录、注册、改密码、管理员重置、创建管理员的命令、旧格式换新，所有哈希与校验都经它。
 *
 * 为什么要它：2 核上 argon2id 大约同时只算得了两个，再多只是在线程池里排队（计划探针 p5），每个排着的请求还占着一份 19 MiB 的
 * 内存与一个连接。不设上限时一阵登录就能让响应时间与内存一起涨上去；设了上限，多出来的请求立即或 5 秒后得到 `overloaded`。
 *
 * 排队的 5 秒是真实时间，不走模块时钟：它度量的是机器忙不忙，合同测试拨模块时钟不该让排队的请求超时。包内测试注入计时器。
 *
 * 失败的下限（`startFailureFloor`）也在这里：回 `invalid_credentials` 的登录从拿到名额算起至少要到下限才回应，见它的注释。
 */

import type {IdentityTimers} from "./db/connection";
import type {IdentityLog} from "./index";

/** 排队的上限，毫秒（输出 20）。 */
export const HASH_QUEUE_TIMEOUT_MS = 5_000;

/**
 * 拿不到名额：排队已满（`queue_full`）、排队超过 5 秒（`queue_timeout`），或限额已关闭（`closed`，停止时）。调用方一律回 503
 * `overloaded`；抛出它时这次哈希没有开始算。
 */
export class HashOverloadedError extends Error {
    override readonly name = "HashOverloadedError";
    constructor(readonly reason: "queue_full" | "queue_timeout" | "closed") {
        super(`password hashing is unavailable: ${reason}`);
    }
}

/** 一个名额。`release` 只生效一次：多放一次不会把别人的名额放掉。 */
export interface HashPermit {
    release(): void;
}

export interface HashLimiterOptions {
    /** 同时在算的个数（`NB_SITE_IDENTITY_HASH_CONCURRENCY`）。 */
    readonly concurrency: number;
    /** 排队的个数上限（`NB_SITE_IDENTITY_HASH_QUEUE`）；0 表示不排队。 */
    readonly queue: number;
    readonly log: Pick<IdentityLog, "warn">;
    /** 产品用全局的计时器；包内测试注入手动的。 */
    readonly timers?: IdentityTimers;
}

const REAL_TIMERS: IdentityTimers = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Waiter {
    readonly resolve: (permit: HashPermit) => void;
    readonly reject: (error: HashOverloadedError) => void;
    readonly timer: unknown;
}

/**
 * 先来先得：放名额时有人排队就直接交给队首（在算的个数不变），所以后来的插不到排队的前面，`tryAcquire` 也抢不走排着的人等的名额。
 *
 * 关闭与连接队列的 `close()`（`db/connection.ts`）同一种约定：之后新的取名额一律以 `closed` 失败，已在排队的也立即这样失败；
 * 在算的照常算完，`close` 等它们都放手，至多 `waitMs`，超了记一行 `identity.hash_close_timeout` 照样返回。
 */
export class HashLimiter {
    readonly #concurrency: number;
    readonly #queueLimit: number;
    readonly #timers: IdentityTimers;
    readonly #log: Pick<IdentityLog, "warn">;
    readonly #waiters: Waiter[] = [];
    #active = 0;
    #closed = false;
    /** `close` 在等的“在算的都放手”。 */
    #onIdle: (() => void) | undefined;

    constructor(options: HashLimiterOptions) {
        this.#concurrency = options.concurrency;
        this.#queueLimit = options.queue;
        this.#timers = options.timers ?? REAL_TIMERS;
        this.#log = options.log;
    }

    /** 取一个名额；满了就排队。排队已满、排队超过 5 秒、已关闭时以 `HashOverloadedError` reject。 */
    acquire(): Promise<HashPermit> {
        if (this.#closed) return Promise.reject(new HashOverloadedError("closed"));
        if (this.#active < this.#concurrency) {
            this.#active += 1;
            return Promise.resolve(this.#permit());
        }
        if (this.#waiters.length >= this.#queueLimit) return Promise.reject(new HashOverloadedError("queue_full"));
        return new Promise<HashPermit>((resolve, reject) => {
            const waiter: Waiter = {
                resolve,
                reject,
                timer: this.#timers.setTimeout(() => {
                    const index = this.#waiters.indexOf(waiter);
                    // 已被交到名额、或已因关闭被拒的不在队里，计时器只是没来得及清掉。
                    if (index === -1) return;
                    this.#waiters.splice(index, 1);
                    reject(new HashOverloadedError("queue_timeout"));
                }, HASH_QUEUE_TIMEOUT_MS),
            };
            this.#waiters.push(waiter);
        });
    }

    /**
     * 有空的名额就取、没有就回 null，不排队。旧格式换新用它（计划 3.7）：忙时跳过，下次登录再换，不让一次可有可无的换格式占着队里的
     * 位置。有人在排队时也回 null：空出来的名额先归排着的人。
     */
    tryAcquire(): HashPermit | null {
        if (this.#closed || this.#active >= this.#concurrency) return null;
        this.#active += 1;
        return this.#permit();
    }

    /** 取名额、算、放手；`work` 失败时同样放手。 */
    async run<T>(work: () => Promise<T>): Promise<T> {
        const permit = await this.acquire();
        try {
            return await work();
        } finally {
            permit.release();
        }
    }

    close(waitMs: number): Promise<void> {
        this.#closed = true;
        for (const waiter of this.#waiters.splice(0)) {
            this.#timers.clearTimeout(waiter.timer);
            waiter.reject(new HashOverloadedError("closed"));
        }
        if (this.#active === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const timer = this.#timers.setTimeout(() => {
                this.#onIdle = undefined;
                this.#log.warn("identity.hash_close_timeout", "password hashing was still running when the close wait ran out", {timeoutMs: waitMs, active: this.#active});
                resolve();
            }, waitMs);
            this.#onIdle = () => {
                this.#onIdle = undefined;
                this.#timers.clearTimeout(timer);
                resolve();
            };
        });
    }

    #permit(): HashPermit {
        let released = false;
        return {
            release: () => {
                if (released) return;
                released = true;
                const next = this.#waiters.shift();
                if (next !== undefined) {
                    this.#timers.clearTimeout(next.timer);
                    next.resolve(this.#permit());
                    return;
                }
                this.#active -= 1;
                if (this.#active === 0) this.#onIdle?.();
            },
        };
    }
}

/**
 * 失败的下限，毫秒（设计审查第 4 条、omp 设计审查第 12 条）。旧站格式的账号走 scrypt、其余走 argon2id，两种算法的耗时不同；
 * 不补齐时，“回 `invalid_credentials` 用了多久”能分辨出账号存不存在（`site.accounts` 输出 4）。下限要高于两种算法单次校验的 p99：
 * `scripts/measure-hash.ts` 在 `taskset -c 0,1`、并发 2 下两次各 200、600 个样本（2026-11-25，Bun 1.4.4，负载约 2 到 3）：argon2id
 * p50 44 到 46、p99 71 到 79、最大 110 毫秒；旧站 scrypt p50 42、p99 55 到 57、最大 76 毫秒。150 毫秒约是较高那个 p99 的两倍，
 * 给部署的机器比开发机慢、负载更高留出余量。机器比测量时慢很多、单次校验超过下限时，补齐不再起作用：那时耗时又能分辨算法，
 * 要重新测量再调高。
 */
export const FAILURE_FLOOR_MS = 150;

export interface FailureFloorTiming {
    /** 单调的毫秒数。缺省 `performance.now()`：下限是真实时间，与排队的 5 秒同理，不走模块时钟。 */
    readonly now?: () => number;
    /** 缺省 `Bun.sleep`；包内测试注入。 */
    readonly sleep?: (ms: number) => Promise<void>;
    /** 缺省 `FAILURE_FLOOR_MS`。 */
    readonly floorMs?: number;
}

export interface FailureFloor {
    /**
     * 这次登录有了结果、要回应之前调用。`ok` 为假（要回 `invalid_credentials`）时等到“起点加下限”再 resolve；为真时立即 resolve：
     * 成功的登录不补，它的耗时本来就不用藏（账号存在、密码也对）。
     */
    finish(ok: boolean): Promise<void>;
}

/**
 * 在拿到哈希名额、开始校验的那一刻调用（实现审查第 4、5 片第 2 条）。读库、排队与失败多次后“先等 2 秒”都不算进起点：起点在排队
 * 之前时，排队一超过下限补齐就成了空操作，回应耗时又只剩“排队加这次算法的耗时”，两种算法的差露出来；有了这个起点，失败的回应是
 * “排队加至少下限”，与排队长短无关，补齐的睡眠在放手名额之后，不占名额。一次登录里账号不存在、没有密码、密码错、哈希格式未知、
 * 发会话前复核没对上，所有回 `invalid_credentials` 的分支都用第一次校验定下的同一个起点 `finish(false)`。
 */
export function startFailureFloor(timing: FailureFloorTiming = {}): FailureFloor {
    const now = timing.now ?? (() => performance.now());
    const sleep = timing.sleep ?? ((ms: number) => Bun.sleep(ms));
    const floorMs = timing.floorMs ?? FAILURE_FLOOR_MS;
    const startedAt = now();
    return {
        finish: async (ok) => {
            if (ok) return;
            const remaining = startedAt + floorMs - now();
            if (remaining > 0) await sleep(remaining);
        },
    };
}
