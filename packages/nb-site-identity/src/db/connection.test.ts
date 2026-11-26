/**
 * 一条连接、一个队列（`connection.ts` 文件头的规则与三条约束）。用真实的 Better Auth、Kysely 与 bun:sqlite，库建在临时目录的
 * 真文件上；等锁上限与 `close` 的时限用手动计时器，别的都等可观察的状态。
 *
 * 库写入用 `internalAdapter.createVerificationValue`：它经库的“当前适配器”写（在库的事务里就写进那个事务），是一次真实的库写入；
 * 写的是 `verification` 表，本 Task 不用这张表，用例的数据不与别的表纠缠。
 */

import type {Database} from "bun:sqlite";
import {SQLiteError} from "bun:sqlite";
import {runWithTransaction} from "@better-auth/core/context";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createTestDbRoot, type TestDbRoot} from "../testing/db";
import {createTestAuth, ManualTimers, recordingLog} from "../testing/library";
import {DEFAULT_LOCK_TIMEOUT_MS, IdentityConnection, IdentityDbUnavailableError, IdentityQueueMisuseError, isDbUnavailable, isQueueMisuse, type IdentityTx} from "./connection";

let root: TestDbRoot;
let timers: ManualTimers;
let log: ReturnType<typeof recordingLog>;
let conn: IdentityConnection;
let lib: Awaited<ReturnType<typeof createTestAuth>["$context"]>;
let adapter: typeof lib.adapter;

beforeEach(async () => {
    root = await createTestDbRoot("identity-connection");
    timers = new ManualTimers();
    log = recordingLog();
    conn = new IdentityConnection(root.open(), {log, timers});
    lib = await createTestAuth(conn).$context;
    adapter = lib.adapter;
});

afterEach(async () => {
    await root.cleanup();
});

/** 一个可以从外面 resolve 的 Promise。 */
function gate(): {promise: Promise<void>; open: () => void} {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return {promise, open};
}

const libWrite = (identifier: string) =>
    lib.internalAdapter.createVerificationValue({identifier, value: "v", expiresAt: new Date(Date.UTC(2100, 0, 1))});

/** 模块自己的一句写，写进同一张表，用来看它落在哪个事务里。 */
const moduleInsert = (identifier: string) => (tx: IdentityTx) =>
    tx.query(`INSERT INTO verification (identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, 'v', '2100-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run(identifier);

/** 另开一条连接直接读，不经队列：看提交了的结果。 */
function committedIdentifiers(): string[] {
    const other = root.openOther();
    try {
        return other.query<{identifier: string}, []>("SELECT identifier FROM verification ORDER BY id").all().map((row) => row.identifier);
    } finally {
        other.close();
    }
}

type Outcome<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly error: unknown};

/**
 * 等 `promise` 落定；它若卡在等锁上（手动计时器里登记了等锁的上限），就让上限到点，于是死锁以“等锁超时”的失败结束，
 * 不会拖成测试超时。
 */
async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
    let outcome: Outcome<T> | undefined;
    promise.then(
        (value) => (outcome = {ok: true, value}),
        (error: unknown) => (outcome = {ok: false, error}),
    );
    await waitUntil("落定或卡在等锁上", () => outcome !== undefined || timers.pending > 0);
    if (outcome === undefined) {
        timers.advance(DEFAULT_LOCK_TIMEOUT_MS);
        await waitUntil("让等锁上限到点之后落定", () => outcome !== undefined);
    }
    return outcome!;
}

/**
 * 落定为失败时取出错误，成功时让用例失败。不用 `toMatchObject({error: expect.any(…)})`：Bun 1.4 的 `toMatchObject` 会把收到的对象里
 * 匹配上的属性换成匹配器本身，之后再读 `outcome.error` 读到的是匹配器。
 */
function failure<T>(outcome: Outcome<T>): unknown {
    if (outcome.ok) throw new Error(`expected a failure, got ${JSON.stringify(outcome.value)}`);
    return outcome.error;
}

class Rollback extends Error {}

describe("库的事务跨 await 开着时", () => {
    it("别处的 write 排在它后面、不被收进去、不随它回滚", async () => {
        const inside = gate();
        const finish = gate();
        const libTx = conn.withLibTransaction(adapter, async () => {
            await libWrite("lib");
            inside.open();
            await finish.promise;
            throw new Rollback();
        });
        await inside.promise;
        let outsideDone = false;
        const outside = conn.write(moduleInsert("outside")).then(() => (outsideDone = true));
        // 等锁的上限计时器登记了，说明它在排队。
        await waitUntil("别处的 write 在排队", () => timers.pending === 1);
        expect(outsideDone).toBe(false);
        finish.open();
        // 不经 settle：别处的 write 还登记着等锁的上限，这里不能让它到点。
        expect(await libTx.then(() => null, (error: unknown) => error)).toBeInstanceOf(Rollback);
        await outside;
        expect(committedIdentifiers()).toEqual(["outside"]);
    });

    it("withLibTransaction 里调 write 不死锁，随它提交或回滚", async () => {
        const committed = conn.withLibTransaction(adapter, async () => {
            await libWrite("lib-1");
            await conn.write(moduleInsert("module-1"));
            return "done";
        });
        expect(await settle(committed)).toEqual({ok: true, value: "done"});

        const rolledBack = conn.withLibTransaction(adapter, async () => {
            await libWrite("lib-2");
            await conn.write(moduleInsert("module-2"));
            throw new Rollback();
        });
        expect(failure(await settle(rolledBack))).toBeInstanceOf(Rollback);
        expect(committedIdentifiers()).toEqual(["lib-1", "module-1"]);
    });
});

describe("用错了的立即失败，不挂起、不写入", () => {
    it("事务里经基础适配器取连接（reserveVerificationValue）得到程序错误，之后队列照常", async () => {
        const tx = conn.withLibTransaction(adapter, async () => {
            await libWrite("before");
            return lib.internalAdapter.reserveVerificationValue({identifier: "reserve", value: "v", expiresAt: new Date(Date.UTC(2100, 0, 1))});
        });
        const outcome = await settle(tx);
        expect(isQueueMisuse(failure(outcome))).toBe(true);
        expect(await conn.read((tx) => tx.query("SELECT count(*) AS n FROM verification").get())).toEqual({n: 0});
    });

    it("事务里用 setTimeout 派生的 write 在事务结束之后执行时抛错、不写入", async () => {
        const txEnded = gate();
        let late!: Promise<unknown>;
        await conn.withLibTransaction(adapter, async () => {
            await libWrite("in-tx");
            late = new Promise((resolve) => {
                // test-lint-allow fixed-wait: 不是等待，是用 setTimeout 把活儿派生出去（约束 2），它何时执行由下面的 gate 决定
                setTimeout(() => {
                    resolve(txEnded.promise.then(() => conn.write(moduleInsert("late"))));
                }, 0);
            });
        });
        txEnded.open();
        const outcome = await settle(late);
        expect(failure(outcome)).toBeInstanceOf(IdentityQueueMisuseError);
        expect(committedIdentifiers()).toEqual(["in-tx"]);
    });

    it("派生的 write 在另一个库事务开着时执行，抛错、不落进那个事务", async () => {
        const firstEnded = gate();
        let late!: Promise<unknown>;
        await conn.withLibTransaction(adapter, async () => {
            late = new Promise((resolve) => {
                // test-lint-allow fixed-wait: 不是等待，是用 setTimeout 把活儿派生出去（约束 2），它何时执行由下面的 gate 决定
                setTimeout(() => {
                    resolve(firstEnded.promise.then(() => conn.write(moduleInsert("late"))));
                }, 0);
            });
        });
        const inside = gate();
        const finish = gate();
        const second = conn.withLibTransaction(adapter, async () => {
            await libWrite("second");
            inside.open();
            await finish.promise;
        });
        await inside.promise;
        firstEnded.open();
        const outcome = await settle(late);
        expect(failure(outcome)).toBeInstanceOf(IdentityQueueMisuseError);
        finish.open();
        await second;
        expect(committedIdentifiers()).toEqual(["second"]);
    });

    it("回调写成 async：await 之前的写回滚，之后的写抛错、不落库；它的 reject 被接住记一行，进程里没有未处理的 reject", async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        try {
            let lateError: unknown;
            const outcome = await settle(
                conn.write(async (tx) => {
                    moduleInsert("before-await")(tx);
                    await null;
                    try {
                        moduleInsert("after-await")(tx);
                    } catch (error) {
                        lateError = error;
                        throw error;
                    }
                }),
            );
            expect(failure(outcome)).toBeInstanceOf(IdentityQueueMisuseError);
            expect(isDbUnavailable(failure(outcome))).toBe(false);
            await waitUntil("await 之后的那句写执行过", () => lateError !== undefined);
            expect(lateError).toBeInstanceOf(IdentityQueueMisuseError);
            await waitUntil("回调的 reject 被接住并记下", () => log.lines.some((line) => line.event === "identity.async_callback_rejected"));
            expect(log.lines.filter((line) => line.event === "identity.async_callback_rejected")).toEqual([
                {level: "error", event: "identity.async_callback_rejected", fields: {errorType: "IdentityQueueMisuseError"}},
            ]);
            expect(committedIdentifiers()).toEqual([]);
            expect(unhandled).toEqual([]);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });

    it("回调里取出的语句在事务结束之后再用也抛程序错误", async () => {
        let leaked!: ReturnType<IdentityTx["query"]>;
        await conn.write((tx) => {
            leaked = tx.query(`INSERT INTO verification (identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ('leaked', 'v', '2100-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
        });
        expect(() => leaked.run()).toThrow(IdentityQueueMisuseError);
        expect(committedIdentifiers()).toEqual([]);
    });

    // 判 thenable 按有没有 `then` 方法，不按是不是 Promise：不是 Promise 的 thenable 也一样拒绝。这里的 `then` 永不调回调，
    // 所以这种 thenable 不会 reject，也就没有要接的。
    it("回调返回不是 Promise 的 thenable 时同样回滚并抛程序错误", async () => {
        const outcome = await settle(
            conn.read((tx) => {
                tx.query("SELECT 1").get();
                return {then: () => undefined};
            }),
        );
        expect(failure(outcome)).toBeInstanceOf(IdentityQueueMisuseError);
        expect(log.lines.filter((line) => line.event === "identity.async_callback_rejected")).toEqual([]);
    });

    it("库自己开的事务里（不经 withLibTransaction）调 read、write 当场得到程序错误，库的事务随之回滚", async () => {
        for (const call of [() => conn.read((tx) => tx.query("SELECT 1").get()), () => conn.write(moduleInsert("module"))]) {
            const outcome = await settle(
                runWithTransaction(adapter, async () => {
                    await libWrite("lib");
                    return call();
                }),
            );
            expect(isQueueMisuse(failure(outcome))).toBe(true);
        }
        expect(timers.pending).toBe(0);
        expect(committedIdentifiers()).toEqual([]);
    });

    it("库自己开的事务里调 withLibTransaction 当场得到程序错误，不加入那个事务", async () => {
        let callbackRan = false;
        const outcome = await settle(
            runWithTransaction(adapter, async () => {
                await libWrite("lib");
                return conn.withLibTransaction(adapter, async () => {
                    callbackRan = true;
                    await conn.write(moduleInsert("module"));
                });
            }),
        );
        expect(isQueueMisuse(failure(outcome))).toBe(true);
        expect(callbackRan).toBe(false);
        expect(timers.pending).toBe(0);
        expect(committedIdentifiers()).toEqual([]);
    });
});

describe("加入库自己开的事务（joinLibTransaction）", () => {
    it("库在自己的事务里调到的代码经它 write：随库的事务提交或回滚", async () => {
        const committed = runWithTransaction(adapter, async () => {
            await libWrite("lib-1");
            await conn.joinLibTransaction(() => conn.write(moduleInsert("module-1")));
            // 同一个库事务里再加入一次（社交注册的两个钩子）。
            await conn.joinLibTransaction(() => conn.write(moduleInsert("module-1b")));
        });
        expect((await settle(committed)).ok).toBe(true);

        const rolledBack = runWithTransaction(adapter, async () => {
            await libWrite("lib-2");
            await conn.joinLibTransaction(() => conn.write(moduleInsert("module-2")));
            throw new Rollback();
        });
        expect(failure(await settle(rolledBack))).toBeInstanceOf(Rollback);
        expect(committedIdentifiers()).toEqual(["lib-1", "module-1", "module-1b"]);
    });

    it("已在 withLibTransaction 开的事务里时直接执行，随它提交", async () => {
        const outcome = await settle(conn.withLibTransaction(adapter, () => conn.joinLibTransaction(() => conn.write(moduleInsert("joined")))));
        expect(outcome.ok).toBe(true);
        expect(committedIdentifiers()).toEqual(["joined"]);
    });

    it("不在任何库事务里调：程序错误，回调不执行", async () => {
        let callbackRan = false;
        const outcome = await settle(
            conn.joinLibTransaction(async () => {
                callbackRan = true;
                await conn.write(moduleInsert("outside"));
            }),
        );
        expect(failure(outcome)).toBeInstanceOf(IdentityQueueMisuseError);
        expect(callbackRan).toBe(false);
        expect(committedIdentifiers()).toEqual([]);
    });

    it("库的事务结束之后漏出来的活儿经它加入另一个开着的库事务：程序错误，不落进那个事务", async () => {
        const firstEnded = gate();
        let late!: Promise<unknown>;
        await runWithTransaction(adapter, async () => {
            await conn.joinLibTransaction(() => conn.write(moduleInsert("first")));
            late = new Promise((resolve) => {
                // test-lint-allow fixed-wait: 不是等待，是用 setTimeout 把活儿派生出去（约束 2），它何时执行由下面的 gate 决定
                setTimeout(() => {
                    resolve(firstEnded.promise.then(() => conn.joinLibTransaction(() => conn.write(moduleInsert("late")))));
                }, 0);
            });
        });
        const inside = gate();
        const finish = gate();
        // 漏出来的活儿带着上一个事务的库上下文，库仍说“在事务里”；这时另一个库事务正开着，方言也确在事务里。
        const second = runWithTransaction(adapter, async () => {
            await libWrite("second");
            inside.open();
            await finish.promise;
        });
        await inside.promise;
        firstEnded.open();
        const outcome = await settle(late);
        expect(failure(outcome)).toBeInstanceOf(IdentityQueueMisuseError);
        finish.open();
        await second;
        expect(committedIdentifiers()).toEqual(["first", "second"]);
    });
});

describe("别的连接持着写锁时", () => {
    it("read 照常成功；write 与库的事务在开头就以“库不可用”失败，回调不执行", async () => {
        await conn.write(moduleInsert("existing"));
        const other = root.openOther();
        other.exec("BEGIN IMMEDIATE");
        try {
            expect(await conn.read((tx) => tx.query("SELECT count(*) AS n FROM verification").get())).toEqual({n: 1});

            let writeRan = false;
            const write = await settle(
                conn.write((tx) => {
                    writeRan = true;
                    moduleInsert("blocked")(tx);
                }),
            );
            expect(isDbUnavailable(failure(write))).toBe(true);
            expect(writeRan).toBe(false);

            let callbackRan = false;
            const libTx = await settle(
                conn.withLibTransaction(adapter, async () => {
                    callbackRan = true;
                    await libWrite("blocked");
                }),
            );
            expect(isDbUnavailable(failure(libTx))).toBe(true);
            expect(callbackRan).toBe(false);
        } finally {
            other.exec("ROLLBACK");
        }
        // 写锁放开以后队列照常。
        await conn.write(moduleInsert("after"));
        expect(committedIdentifiers()).toEqual(["existing", "after"]);
    });
});

describe("等锁上限与关闭", () => {
    it("等锁到 10 秒时以“库不可用”失败并记 identity.queue_timeout（差 1 毫秒时还在等），排在后面的与持锁者不受影响", async () => {
        const inside = gate();
        const finish = gate();
        const holder = conn.withLibTransaction(adapter, async () => {
            await libWrite("holder");
            inside.open();
            await finish.promise;
        });
        await inside.promise;
        let timedOutOutcome: Outcome<unknown> | undefined;
        conn.write(moduleInsert("timed-out")).then(
            (value) => (timedOutOutcome = {ok: true, value}),
            (error: unknown) => (timedOutOutcome = {ok: false, error}),
        );
        await waitUntil("第一个在排队", () => timers.pending === 1);
        timers.advance(9_999);
        // 上限的回调到期时先被摘掉再执行，所以计时器还登记着就说明它没触发、拒绝没发生。
        expect({outcome: timedOutOutcome, pending: timers.pending}).toEqual({outcome: undefined, pending: 1});
        timers.advance(1);
        await waitUntil("到点之后落定", () => timedOutOutcome !== undefined);
        const error = failure(timedOutOutcome!);
        expect(error).toBeInstanceOf(IdentityDbUnavailableError);
        expect((error as IdentityDbUnavailableError).reason).toBe("queue_timeout");
        expect(isDbUnavailable(error)).toBe(true);
        expect(log.lines.filter((line) => line.event === "identity.queue_timeout")).toHaveLength(1);

        const queued = conn.write(moduleInsert("queued"));
        await waitUntil("第二个在排队", () => timers.pending === 1);
        finish.open();
        await holder;
        await queued;
        expect(committedIdentifiers()).toEqual(["holder", "queued"]);
    });

    it("close 拒收新的取锁、等持锁者放锁；之后经队列与经库的访问都得“库不可用”", async () => {
        const inside = gate();
        const finish = gate();
        const holder = conn.withLibTransaction(adapter, async () => {
            await libWrite("holder");
            inside.open();
            await finish.promise;
            // 持锁者在关闭期间照常做完自己的事。
            await conn.write(moduleInsert("holder-module"));
        });
        await inside.promise;
        const queued = conn.write(moduleInsert("queued"));
        await waitUntil("有人在排队", () => timers.pending === 1);

        let closed = false;
        const closing = conn.close(2_000).then(() => (closed = true));
        const rejected = failure(await settle(queued));
        expect(rejected).toBeInstanceOf(IdentityDbUnavailableError);
        expect((rejected as IdentityDbUnavailableError).reason).toBe("closed");
        // 排队者被拒、它的计时器清掉；剩下的是 close 自己的时限。
        expect(timers.pending).toBe(1);
        expect(closed).toBe(false);

        finish.open();
        await holder;
        await closing;
        expect(log.lines.filter((line) => line.event === "identity.close_timeout")).toEqual([]);

        const read = failure(await settle(conn.read(() => 1)));
        expect(read).toBeInstanceOf(IdentityDbUnavailableError);
        expect((read as IdentityDbUnavailableError).reason).toBe("closed");
        const viaLib = await settle(lib.internalAdapter.findVerificationValue("holder"));
        expect(isDbUnavailable(failure(viaLib))).toBe(true);
        expect(committedIdentifiers()).toEqual(["holder", "holder-module"]);
    });

    it("持锁者到时限还没放锁时 close 照样返回（差 1 毫秒时还在等），记 identity.close_timeout", async () => {
        const inside = gate();
        const finish = gate();
        const holder = conn.withLibTransaction(adapter, async () => {
            inside.open();
            await finish.promise;
        });
        await inside.promise;
        let closed = false;
        const closing = conn.close(2_000).then(() => (closed = true));
        expect(timers.pending).toBe(1);
        timers.advance(1_999);
        expect({closed, pending: timers.pending}).toEqual({closed: false, pending: 1});
        timers.advance(1);
        await closing;
        expect(log.lines.filter((line) => line.event === "identity.close_timeout")).toHaveLength(1);
        finish.open();
        await holder;
    });
});

describe("错误分类", () => {
    /** 真实的 SQLITE_BUSY：另一条连接持着写锁时开 IMMEDIATE 事务。 */
    function realBusyError(): SQLiteError {
        const holder = root.openOther();
        const blocked = root.openOther();
        holder.exec("BEGIN IMMEDIATE");
        try {
            blocked.exec("BEGIN IMMEDIATE");
        } catch (error) {
            if (error instanceof SQLiteError) return error;
            throw error;
        } finally {
            holder.exec("ROLLBACK");
        }
        throw new Error("expected SQLITE_BUSY");
    }

    /** 真实的约束错误：唯一键冲突。 */
    function realConstraintError(db: Database): SQLiteError {
        db.run("INSERT INTO identity_registration_code (code, created_at) VALUES ('dup', '2026-01-01T00:00:00.000Z')");
        try {
            db.run("INSERT INTO identity_registration_code (code, created_at) VALUES ('dup', '2026-01-01T00:00:00.000Z')");
        } catch (error) {
            if (error instanceof SQLiteError) return error;
            throw error;
        }
        throw new Error("expected SQLITE_CONSTRAINT");
    }

    it("按主结果码认“库不可用”，沿 cause 链找，有环也停得下", () => {
        const busy = realBusyError();
        expect(busy.errno & 0xff).toBe(5);
        expect(isDbUnavailable(busy)).toBe(true);
        const wrapped = new Error("api error", {cause: new Error("middle", {cause: busy})});
        expect(isDbUnavailable(wrapped)).toBe(true);

        const constraint = realConstraintError(root.openOther());
        expect(isDbUnavailable(constraint)).toBe(false);
        expect(isDbUnavailable(new Error("api error", {cause: constraint}))).toBe(false);

        const cyclic = new Error("a");
        cyclic.cause = new Error("b", {cause: cyclic});
        expect(isDbUnavailable(cyclic)).toBe(false);

        expect(isDbUnavailable(new Error("api error", {cause: new IdentityDbUnavailableError("closed")}))).toBe(true);
        expect(isDbUnavailable(new IdentityQueueMisuseError("misuse"))).toBe(false);
        expect(isQueueMisuse(new Error("api error", {cause: new IdentityQueueMisuseError("misuse")}))).toBe(true);
    });
});
