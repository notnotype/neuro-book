/**
 * 账号库的一条连接、一个队列（w00037 t07 计划 3.3，设计审查处理表第 3、9、17 条）。
 *
 * 为什么要它：入口交给模块的 `ModuleContext.db` 是一条连接，同一时刻只有一个事务；Better Auth 的事务会跨 `await` 开着（例如它在事务
 * 里调钩子）。把 `Database` 直接交给库时，别的请求的一句同步写会落进库正开着的事务、随它回滚（规划探针 p3）。所以这条连接上的全部
 * 访问（库的与模块自己的）排进同一把异步互斥锁，事务从开始到提交一直持锁。
 *
 * 谁持锁、谁排队、什么时候放：
 * - 库经 `libDatabase()` 给的 Kysely 方言访问库。库每条不在事务里的查询，Kysely 先 `acquireConnection`（取锁）、执行、再
 *   `releaseConnection`（放锁）。库的事务在 `acquireConnection` 时取锁，`BEGIN IMMEDIATE`（写锁在开头拿，不在中途升级时撞
 *   `SQLITE_BUSY`），回调里的查询都走这一个已取到的连接、不再取锁，`COMMIT` 或 `ROLLBACK` 之后 Kysely 才 `releaseConnection`。
 *   回调里的 `await` 期间锁一直被这个事务占着。
 * - 模块自己的读写只经 `read(fn)`（延迟事务）与 `write(fn)`（`BEGIN IMMEDIATE`）。`fn` 是同步函数：取锁、在一个事务里一次做完、
 *   提交、放锁，中间没有 `await`，别人插不进来。`fn` 拿到的是 `IdentityTx` 句柄，不是 `Database`：句柄只在这一次事务里有效，
 *   事务结束（提交、回滚、抛错）之后再用就抛 `IdentityQueueMisuseError`，所以从回调里漏出去的活儿写不进别人的事务、也不会以
 *   自动提交落库（实现审查第 1 条）。
 * - 排队的先来先得。等锁至多 `lockTimeoutMs`（缺省 10 秒）：超了这次访问以 `IdentityDbUnavailableError`（`queue_timeout`）失败并记
 *   一行 `identity.queue_timeout`，后面排着的不受影响。
 * - `close(waitMs)` 之后新的取锁一律以 `IdentityDbUnavailableError`（`closed`）失败，已在排队的也立即这样失败；当前持锁者照常做完，
 *   `close` 等它放锁，至多 `waitMs`，超了记一行 `identity.close_timeout` 照样返回。
 *
 * 重入：库的事务只经 `withLibTransaction(adapter, fn)` 开。方言每次 `beginTransaction` 把序号加一、记为“当前事务”，
 * `commit`、`rollback` 时清掉；`withLibTransaction` 在回调开头把当时的序号放进本模块自己的异步上下文。在这个回调里（同一个异步
 * 上下文）调 `read`、`write`，要求上下文里的序号等于当前事务的序号、且连接确实在事务里，才直接在这个事务里执行（`bun:sqlite`
 * 在已有事务里用保存点），不再取锁，随这个事务一起提交或回滚。不单信库自己的异步上下文：它会跟着 `setTimeout`、不等待的 Promise
 * 漏到事务之外，那时库仍以为在事务里（设计审查第 9 条）。
 * 另一个入口 `joinLibTransaction(fn)` 加入库自己开的事务：只给库在自己的事务里调到的钩子用（社交注册的建用户、建账号前钩子，
 * `social/hooks.ts`），模块的路由仍只经 `withLibTransaction` 开事务。它在本模块的上下文里放的序号同样经上面的核对。
 *
 * 调用方要守的约束，与守着每一条的东西：
 * 1. 事务里只做数据库的事：算哈希、等限流、读请求体都在事务之外，`withLibTransaction` 的回调里不 `await` 数据库以外的东西。
 *    这条运行时查不出来（等的是什么看不见），由各调用处的写法与审查守；守不住时的后果是别的请求多等，等满 10 秒以
 *    `queue_timeout` 失败（“等锁超时”的用例），不会死锁、不会把别人的写收进来。
 * 2. 不在事务的异步上下文里派生活儿（`setTimeout`、不等待的 Promise）：它们继承异步上下文。派生的活儿在事务结束之后、或在另一个
 *    事务开着时调 `read`、`write`，序号对不上，抛 `IdentityQueueMisuseError`、不写入（“事务里派生的 write”两条用例）；它经库
 *    访问时同样抛这个错误（下一条）。`read`、`write` 的 `fn` 返回 thenable 时（写成了 async）回滚并抛同一个错误：`await` 之前的
 *    语句随事务回滚；`await` 之后的语句用的句柄已经失效，抛错、不执行。那个 thenable 之后多半 reject，这里给它接上处理、记一行
 *    `identity.async_callback_rejected`，不让它成为没人接的 reject（入口把那当成致命错误停机）。
 * 3. 模块的其它代码不直接用 `ModuleContext.db`，只经本文件：`src/architecture.test.ts` 扫源码，只许本文件与模块入口出现它。
 * 另外，在自己的事务里又经方言来取连接（库里不取当前事务、直接用基础适配器的调用，已知 `internalAdapter.reserveVerificationValue`）
 * 必然等自己放锁、永远等不到。这种取法立即抛 `IdentityQueueMisuseError`，不挂起（“事务里经基础适配器取连接”的用例）。
 *
 * 错误分类见 `isDbUnavailable`。
 */

import {SQLiteError, type Changes, type Database, type SQLQueryBindings, type Statement} from "bun:sqlite";
import {AsyncLocalStorage} from "node:async_hooks";

import type {BetterAuthOptions} from "@better-auth/core";
import {getCurrentDBAdapterAsyncLocalStorage, runWithTransaction} from "@better-auth/core/context";
import type {DBAdapter} from "@better-auth/core/db/adapter";
import {
    CompiledQuery,
    SqliteAdapter,
    SqliteIntrospector,
    SqliteQueryCompiler,
    type DatabaseConnection,
    type Dialect,
    type Driver,
    type QueryResult,
} from "kysely";

import type {IdentityLog} from "../index";

/** 等锁的缺省上限（真实时间）。 */
export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

/**
 * 这条连接被用错了：违反了文件头的约束 2，在自己的事务里又来取连接，或在事务结束之后还用 `IdentityTx` 句柄。是程序错误，出口按
 * 500 `internal` 处理；不是“库不可用”。抛出它时这次调用没有写入（`read`、`write` 的事务已回滚，取连接还没执行任何语句，失效的
 * 句柄不执行语句）。
 */
export class IdentityQueueMisuseError extends Error {
    override readonly name = "IdentityQueueMisuseError";
}

/**
 * 队列给不出连接：等锁超时（`queue_timeout`），或连接正在关闭、已关闭（`closed`）。出口与 SQLite 的忙、只读、I/O 错误一样按
 * 503 `unavailable` 处理（`isDbUnavailable`）。抛出它时这次访问没有执行任何语句。
 */
export class IdentityDbUnavailableError extends Error {
    override readonly name = "IdentityDbUnavailableError";
    constructor(readonly reason: "queue_timeout" | "closed") {
        super(reason === "queue_timeout" ? "identity database queue wait timed out" : "identity database connection is closed");
    }
}

/**
 * 算“库不可用”的 SQLite 主结果码（扩展码的低 8 位）：BUSY 5、READONLY 8、IOERR 10、CORRUPT 11、FULL 13、CANTOPEN 14、NOTADB 26。
 * 与统计模块 `store.ts` 的口径相同，另加库损坏的两个（CORRUPT、NOTADB：文件坏了，与读不了同样是部署的人要处理的事）。
 * LOCKED 6 不算：它是同一条连接上语句之间的冲突，在这条连接只由本队列使用时只会是本模块自己的程序错误。
 */
const UNAVAILABLE_PRIMARY_CODES: ReadonlySet<number> = new Set([5, 8, 10, 11, 13, 14, 26]);

/** 沿 `cause` 链逐层看（库的 `getSession` 会把数据库错误包成 `APIError`，原错误在 `cause` 里，设计审查第 2 条）；有环时停下。 */
function* causeChain(error: unknown): Generator<unknown> {
    const seen = new Set<unknown>();
    let current = error;
    while (current !== undefined && current !== null && !seen.has(current)) {
        seen.add(current);
        yield current;
        current = current instanceof Error ? current.cause : undefined;
    }
}

/** 错误（或它 `cause` 链上的某一层）是不是“库不可用”：按 SQLite 的主结果码认，不看文字；另认本模块的 `IdentityDbUnavailableError`。 */
export function isDbUnavailable(error: unknown): boolean {
    for (const layer of causeChain(error)) {
        if (layer instanceof IdentityDbUnavailableError) return true;
        if (layer instanceof SQLiteError && UNAVAILABLE_PRIMARY_CODES.has(layer.errno & 0xff)) return true;
    }
    return false;
}

/** 错误（或它 `cause` 链上的某一层）是不是 SQLite 的外键约束失败：按扩展结果码的名字认，不看文字。 */
export function isForeignKeyViolation(error: unknown): boolean {
    for (const layer of causeChain(error)) if (layer instanceof SQLiteError && layer.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true;
    return false;
}

/**
 * 插入会话时撞上的是不是“被封禁的账号插不进会话”的触发器（`0004_session_ban_guard.sql`）：按扩展结果码
 * `SQLITE_CONSTRAINT_TRIGGER` 认，不看说明文字。只凭码认得出，是因为 `session` 表上只有这一个触发器（`schema.test.ts` 核对）；
 * 调用方要自己确定出错的就是插会话那一步（别的表上的触发器报同一个码）。
 */
export function isBannedSessionInsert(error: unknown): boolean {
    for (const layer of causeChain(error)) if (layer instanceof SQLiteError && layer.code === "SQLITE_CONSTRAINT_TRIGGER") return true;
    return false;
}

/** 错误（或它 `cause` 链上的某一层）是不是 `IdentityQueueMisuseError`：库在自己的调用里抛出时可能包一层。 */
export function isQueueMisuse(error: unknown): boolean {
    for (const layer of causeChain(error)) if (layer instanceof IdentityQueueMisuseError) return true;
    return false;
}

/** 等锁与 `close` 的时限用的计时器；产品用全局的，包内测试注入手动的。 */
export interface IdentityTimers {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: IdentityTimers = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `IdentityTx.query` 给的语句；形状是 `bun:sqlite` 的 `Statement` 里本模块用到的三个方法，同样只在那一次事务里有效。 */
export interface IdentityStatement<R, P extends SQLQueryBindings[]> {
    get(...params: P): R | null;
    all(...params: P): R[];
    run(...params: P): Changes;
}

/**
 * `read`、`write` 交给回调的句柄，代替原始的 `Database`。只在这一次事务里有效：事务结束之后，句柄与从它取出的语句一用就抛
 * `IdentityQueueMisuseError`，不执行语句（文件头约束 2）。
 */
export interface IdentityTx {
    query<R = unknown, P extends SQLQueryBindings[] = SQLQueryBindings[]>(sql: string): IdentityStatement<R, P>;
}

/** 一次事务的句柄；`#transact` 在事务结束时调 `end()`。 */
class TxHandle implements IdentityTx {
    #live = true;

    constructor(private readonly db: Database) {}

    end(): void {
        this.#live = false;
    }

    query<R = unknown, P extends SQLQueryBindings[] = SQLQueryBindings[]>(sql: string): IdentityStatement<R, P> {
        this.#check();
        // `P` 已限定为数组，`query` 返回类型里的 `P extends any[] ? P : [P]` 就是 `P`；泛型里 TypeScript 化简不了这个条件类型。
        const statement = this.db.query<R, P>(sql) as Statement<R, P>;
        return {
            get: (...params) => {
                this.#check();
                return statement.get(...params);
            },
            all: (...params) => {
                this.#check();
                return statement.all(...params);
            },
            run: (...params) => {
                this.#check();
                return statement.run(...params);
            },
        };
    }

    #check(): void {
        if (!this.#live) throw new IdentityQueueMisuseError("a read or write handle was used after its transaction ended");
    }
}

export interface IdentityConnectionOptions {
    readonly log: Pick<IdentityLog, "warn" | "error">;
    /** 等锁的上限，毫秒；缺省 `DEFAULT_LOCK_TIMEOUT_MS`。 */
    readonly lockTimeoutMs?: number;
    readonly timers?: IdentityTimers;
    /**
     * 给了就在这条连接上设 `PRAGMA busy_timeout`，盖掉入口打开连接时设的值。模块实例不给，沿用入口的设置（`nb-site-server` 的
     * `db/open.ts`）；创建管理员的命令给 0，撞上别的进程的写锁时立即回来，由它自己看停止信号的异步重试去等（`commands/create-admin.ts`）。
     */
    readonly busyTimeoutMs?: number;
}

/** 交给 `betterAuth({database})` 的配置：库经它的 Kysely 方言走本队列。 */
export interface LibDatabaseConfig {
    readonly dialect: Dialect;
    readonly type: "sqlite";
    readonly transaction: true;
}

/**
 * 本模块异步上下文里的标记。`module`：`read`、`write` 的 `fn` 正在执行（或是从那里漏出去的活儿）。`lib`：`withLibTransaction`
 * 的回调里，`seq` 是回调开始时方言的当前事务序号。
 */
type Frame = {readonly kind: "module"} | {readonly kind: "lib"; readonly seq: number};

type Release = () => void;

interface Waiter {
    readonly resolve: (release: Release) => void;
    readonly reject: (error: Error) => void;
    readonly timer: unknown;
}

/**
 * 先来先得的异步互斥锁，带等锁上限与关闭。放锁时有人排队就直接交给队首（不经“空闲”），所以不会有后来的插到排队的前面。
 */
class Queue {
    #held = false;
    readonly #waiters: Waiter[] = [];
    #closed = false;
    /** `close` 在等的“持锁者放锁”。 */
    #onIdle: (() => void) | undefined;

    constructor(
        private readonly timers: IdentityTimers,
        private readonly lockTimeoutMs: number,
        private readonly log: Pick<IdentityLog, "warn">,
    ) {}

    acquire(): Promise<Release> {
        if (this.#closed) return Promise.reject(new IdentityDbUnavailableError("closed"));
        if (!this.#held) {
            this.#held = true;
            return Promise.resolve(this.#releaser());
        }
        return new Promise<Release>((resolve, reject) => {
            const waiter: Waiter = {
                resolve,
                reject,
                timer: this.timers.setTimeout(() => {
                    const index = this.#waiters.indexOf(waiter);
                    // 已被交到锁、或已因关闭被拒的不在队里，计时器只是没来得及清掉。
                    if (index === -1) return;
                    this.#waiters.splice(index, 1);
                    this.log.warn("identity.queue_timeout", "identity database queue wait timed out", {timeoutMs: this.lockTimeoutMs});
                    reject(new IdentityDbUnavailableError("queue_timeout"));
                }, this.lockTimeoutMs),
            };
            this.#waiters.push(waiter);
        });
    }

    /** 每次交出的放锁函数只生效一次：Kysely 与 `read`、`write` 各自只放一次，多放一次不能把别人的锁放掉。 */
    #releaser(): Release {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.#waiters.shift();
            if (next !== undefined) {
                this.timers.clearTimeout(next.timer);
                next.resolve(this.#releaser());
                return;
            }
            this.#held = false;
            this.#onIdle?.();
        };
    }

    close(waitMs: number): Promise<void> {
        this.#closed = true;
        for (const waiter of this.#waiters.splice(0)) {
            this.timers.clearTimeout(waiter.timer);
            waiter.reject(new IdentityDbUnavailableError("closed"));
        }
        if (!this.#held) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const timer = this.timers.setTimeout(() => {
                this.#onIdle = undefined;
                this.log.warn("identity.close_timeout", "identity database was still in use when the close wait ran out", {timeoutMs: waitMs});
                resolve();
            }, waitMs);
            this.#onIdle = () => {
                this.#onIdle = undefined;
                this.timers.clearTimeout(timer);
                resolve();
            };
        });
    }
}

/**
 * Kysely 对 `supportsMultipleConnections` 为 false 的方言（SQLite 的缺省）在驱动外面再套一把它自己的互斥锁，每个 Kysely 实例一把、
 * 没有上限。本方言的驱动就是这条连接的队列，再套一把时：在自己的事务里又来取连接的请求会卡在 Kysely 的锁上永远等着，
 * 到不了驱动里的检查（实测 `reserveVerificationValue` 在事务里挂起、驱动没有收到请求），等锁上限也管不到它。所以对 Kysely
 * 说“支持多条连接”，排队只在驱动里做。别的 SQLite 行为（`RETURNING`、建表语法）照 `SqliteAdapter`。
 */
class QueuedSqliteAdapter extends SqliteAdapter {
    override get supportsMultipleConnections(): boolean {
        return true;
    }
}

/**
 * 库是不是说这次调用在它的事务里（库的异步上下文）。给库调到的钩子判断走哪条（w00037 t08 计划 3.3）：社交注册时库在自己的事务里调
 * 建账号前钩子，钩子要加入那个事务；社交关联时库不在事务里调它，钩子用普通的 `write`。只信库的上下文判“是不是”，加入时另有本模块
 * 的序号核对：库的上下文会漏到事务之外（文件头的“重入”）。
 */
export async function inLibraryTransaction(): Promise<boolean> {
    return (await getCurrentDBAdapterAsyncLocalStorage()).getStore()?.isTransactionActive === true;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as {then?: unknown}).then === "function";

/**
 * 账号库唯一的连接持有者。由模块入口用 `ModuleContext.db` 建一个；连接的打开与关闭归入口，本类不关它。
 */
export class IdentityConnection {
    readonly #db: Database;
    readonly #log: Pick<IdentityLog, "error">;
    readonly #queue: Queue;
    readonly #frames = new AsyncLocalStorage<Frame>();
    /** 方言开过的事务个数；`#activeTx` 是正开着的那一个的序号，没有时为 null。 */
    #seq = 0;
    #activeTx: number | null = null;
    #closing: Promise<void> | undefined;
    /**
     * 库的事务上下文对象（库每开一个事务建一个新的，`runWithTransaction`）到第一次经它加入时方言的事务序号。事务结束之后这个对象
     * 仍可能被漏出去的活儿带着、仍说在事务里，序号一比就认得出它不属于正开着的事务（`joinLibTransaction`）。
     */
    readonly #joinedContexts = new WeakMap<object, number>();

    constructor(db: Database, options: IdentityConnectionOptions) {
        this.#db = db;
        if (options.busyTimeoutMs !== undefined) {
            if (!Number.isInteger(options.busyTimeoutMs) || options.busyTimeoutMs < 0) throw new RangeError(`busyTimeoutMs must be a non-negative integer, got ${String(options.busyTimeoutMs)}`);
            db.exec(`PRAGMA busy_timeout = ${String(options.busyTimeoutMs)}`);
        }
        this.#log = options.log;
        this.#queue = new Queue(options.timers ?? REAL_TIMERS, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, options.log);
    }

    /**
     * 只读：在一个延迟事务里执行 `fn`。延迟事务开始时不拿写锁，所以别的进程持着写锁时照常能读（设计审查第 3 条）；
     * `fn` 里若写了，写到那一句才去拿写锁，那时可能以 `SQLITE_BUSY` 失败，所以要写的用 `write`。
     */
    read<T>(fn: (tx: IdentityTx) => T): Promise<T> {
        return this.#run("read", fn);
    }

    /** 读写：在一个 `BEGIN IMMEDIATE` 事务里执行 `fn`；别的进程持着写锁时在开头以 `SQLITE_BUSY` 失败，`fn` 不执行。 */
    write<T>(fn: (tx: IdentityTx) => T): Promise<T> {
        return this.#run("write", fn);
    }

    /**
     * 开一个库的事务（`adapter` 取 `(await auth.$context).adapter`）。回调里可以调库的内部接口（库自己取当前事务的那些）与本对象的
     * `read`、`write`，一起提交或回滚。已在一个合法的库事务里时直接加入它。库的“事务之后”钩子在提交以后、本模块的上下文之外执行。
     */
    async withLibTransaction<T, Options extends BetterAuthOptions>(adapter: DBAdapter<Options>, fn: () => Promise<T>): Promise<T> {
        const frame = this.#frames.getStore();
        if (frame !== undefined) {
            if (this.#inCurrentLibTransaction(frame)) return fn();
            throw new IdentityQueueMisuseError("withLibTransaction called outside the transaction its async context belongs to");
        }
        if ((await getCurrentDBAdapterAsyncLocalStorage()).getStore()?.isTransactionActive === true) {
            throw new IdentityQueueMisuseError("a library transaction is active that was not opened through withLibTransaction");
        }
        return runWithTransaction(adapter, () => {
            const seq = this.#activeTx;
            // 适配器不经本对象的方言、或没有真正开事务（`transaction: false`）时走到这里。
            if (seq === null || !this.#db.inTransaction) throw new IdentityQueueMisuseError("withLibTransaction did not get a transaction from the identity dialect");
            return this.#frames.run({kind: "lib", seq}, fn);
        });
    }

    /**
     * 加入库自己开着的事务：库在它的事务里调到的钩子用（文件头的“重入”）。回调里的 `read`、`write` 直接在那个事务里执行，随它
     * 提交或回滚。要求：没有本模块的标记（已在当前的库事务里时直接执行 `fn`）；库说在事务里；方言确有一个正开着的事务；库的这个
     * 事务上下文对象以前加入过的话，当时的序号与现在的相同。不满足时抛 `IdentityQueueMisuseError`，`fn` 不执行。
     *
     * 第一次加入时记下的序号就是“这个上下文属于哪个事务”的依据：钩子在库开事务之后、库的第一条写之前被调到，那时只可能是自己的
     * 事务开着。一个上下文第一次加入就是在事务结束之后（从没加入过的事务里漏出去的活儿）时认不出来，钩子没有这样的写法。
     */
    async joinLibTransaction<T>(fn: () => Promise<T>): Promise<T> {
        const frame = this.#frames.getStore();
        if (frame !== undefined) {
            if (this.#inCurrentLibTransaction(frame)) return fn();
            throw new IdentityQueueMisuseError("joinLibTransaction called outside the transaction its async context belongs to");
        }
        const context = (await getCurrentDBAdapterAsyncLocalStorage()).getStore();
        if (context?.isTransactionActive !== true) throw new IdentityQueueMisuseError("joinLibTransaction called outside a library transaction");
        // 上面的 await 之后同步判到 `#frames.run`：其间没有让出，事务的状态不会变。
        const seq = this.#activeTx;
        if (seq === null || !this.#db.inTransaction) throw new IdentityQueueMisuseError("joinLibTransaction found no open transaction on the identity dialect");
        const joined = this.#joinedContexts.get(context);
        if (joined === undefined) this.#joinedContexts.set(context, seq);
        else if (joined !== seq) throw new IdentityQueueMisuseError("joinLibTransaction called from a library transaction context that has already ended");
        return this.#frames.run({kind: "lib", seq}, fn);
    }

    /** 交给 `betterAuth({database})` 的配置。每次调用给一个新的方言对象，状态都在本对象上。 */
    libDatabase(): LibDatabaseConfig {
        const driver = this.#driver();
        return {
            dialect: {
                createDriver: () => driver,
                createQueryCompiler: () => new SqliteQueryCompiler(),
                createAdapter: () => new QueuedSqliteAdapter(),
                createIntrospector: (kysely) => new SqliteIntrospector(kysely),
            },
            type: "sqlite",
            transaction: true,
        };
    }

    /** 拒收新的取锁，再等当前持锁者放锁，至多 `waitMs`。重复调用得到同一个 Promise。不关连接（连接归入口）。 */
    close(waitMs: number): Promise<void> {
        this.#closing ??= this.#queue.close(waitMs);
        return this.#closing;
    }

    #inCurrentLibTransaction(frame: Frame): boolean {
        return frame.kind === "lib" && frame.seq === this.#activeTx && this.#db.inTransaction;
    }

    async #run<T>(mode: "read" | "write", fn: (tx: IdentityTx) => T): Promise<T> {
        // 先同步地判断：这之后的第一个 await 会让出，事务的状态可能就变了。
        const frame = this.#frames.getStore();
        if (frame !== undefined) {
            if (this.#inCurrentLibTransaction(frame)) return this.#transact(fn, "nested");
            throw new IdentityQueueMisuseError(`${mode} called outside the transaction its async context belongs to`);
        }
        // 没有本模块的标记、库却说在事务里：在库自己开的事务里（没经 withLibTransaction，取锁会等自己放锁、死锁），或是从那样的事务里
        // 漏出来的活儿（认不出它属于哪个事务）。都不执行。
        if ((await getCurrentDBAdapterAsyncLocalStorage()).getStore()?.isTransactionActive === true) {
            throw new IdentityQueueMisuseError(`${mode} called inside a library transaction that was not opened through withLibTransaction`);
        }
        const release = await this.#queue.acquire();
        try {
            return this.#frames.run({kind: "module"}, () => this.#transact(fn, mode));
        } finally {
            release();
        }
    }

    /**
     * `nested`：已在库的事务里，`bun:sqlite` 用保存点。thenable 在事务里抛出，事务（或保存点）随之回滚。句柄在 `finally` 里失效：
     * 不论提交、回滚还是抛错，`fn` 返回之后它都不能再用。
     */
    #transact<T>(fn: (tx: IdentityTx) => T, mode: "read" | "write" | "nested"): T {
        const handle = new TxHandle(this.#db);
        const transaction = this.#db.transaction(() => {
            const result = fn(handle);
            if (isThenable(result)) {
                this.#absorbLateRejection(result);
                throw new IdentityQueueMisuseError("read and write callbacks must be synchronous; the callback returned a thenable");
            }
            return result;
        });
        try {
            if (mode === "write") return transaction.immediate();
            if (mode === "read") return transaction.deferred();
            return transaction();
        } finally {
            handle.end();
        }
    }

    /**
     * 写成 async 的回调在 `await` 之后多半因句柄失效而 reject（也可能因为别的错误）。调用方拿到的是 `IdentityQueueMisuseError`，
     * 不会再去等这个 thenable，所以由这里接住它、记一行程序错误，免得它成为没人接的 reject。resolve 时没有要做的。
     */
    #absorbLateRejection(thenable: PromiseLike<unknown>): void {
        thenable.then(undefined, (error: unknown) => {
            this.#log.error("identity.async_callback_rejected", "a read or write callback written as async rejected after its transaction ended", {
                errorType: error instanceof Error ? error.name : typeof error,
            });
        });
    }

    #driver(): Driver {
        const self = this;
        const releases = new WeakMap<DatabaseConnection, Release>();
        return {
            async init() {},
            async acquireConnection() {
                // 自己的事务里（本模块的标记或库的事务标记还在）又来取连接：锁就在自己手里，等下去永远等不到。漏出事务的活儿
                // 也走到这里，同样不许。
                if (self.#frames.getStore() !== undefined || (await getCurrentDBAdapterAsyncLocalStorage()).getStore()?.isTransactionActive === true) {
                    throw new IdentityQueueMisuseError("a database connection was requested from inside an identity transaction");
                }
                const release = await self.#queue.acquire();
                const connection = self.#connection();
                releases.set(connection, release);
                return connection;
            },
            async beginTransaction(connection) {
                await connection.executeQuery(CompiledQuery.raw("BEGIN IMMEDIATE"));
                self.#seq += 1;
                self.#activeTx = self.#seq;
            },
            async commitTransaction(connection) {
                // COMMIT 失败时事务还开着，Kysely 接着调 rollbackTransaction，在那里清。
                await connection.executeQuery(CompiledQuery.raw("COMMIT"));
                self.#activeTx = null;
            },
            async rollbackTransaction(connection) {
                try {
                    // SQLite 遇到磁盘满一类错误时已经自己回滚了事务，这时再 ROLLBACK 会报错。
                    if (self.#db.inTransaction) await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
                } finally {
                    self.#activeTx = null;
                }
            },
            async releaseConnection(connection) {
                const release = releases.get(connection);
                releases.delete(connection);
                release?.();
            },
            async destroy() {},
        };
    }

    /** 一次取锁对应的连接对象。语句同步执行；`streamQuery` 库用不到。 */
    #connection(): DatabaseConnection {
        const db = this.#db;
        return {
            async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
                const statement = db.query(compiled.sql);
                const parameters = compiled.parameters as never[];
                if (statement.columnNames.length > 0) return {rows: statement.all(...parameters) as R[]};
                const {changes, lastInsertRowid} = statement.run(...parameters);
                return {rows: [], numAffectedRows: BigInt(changes), insertId: BigInt(lastInsertRowid)};
            },
            async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
                throw new IdentityQueueMisuseError("streaming queries are not supported on the identity connection");
            },
        };
    }
}
