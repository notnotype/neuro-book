import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {describe, expect, it, vi} from "bun:test";

import {createRuntimeInstance, LifecycleStateError} from "./lifecycle";
import type {
    BorrowHandle,
    BorrowResult,
    LifecycleFailure,
    LifecycleObserver,
    PhaseChange,
    RegisterResult,
    ReleaseResource,
    ResourceHandle,
    ResourceSpec,
    RuntimeLocation,
    Scope,
    ScopePhase,
} from "./lifecycle";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** 机制源码文件：同目录下排除测试的全部 TS 文件。 */
async function listMechanismSources(): Promise<string[]> {
    const entries = await readdir(moduleDir);
    return entries.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
}

interface TestValue {
    readonly label: string;
}

function resourceSpec(label: string, release: ReleaseResource<TestValue> = vi.fn()): ResourceSpec<TestValue> {
    return {kind: "test", label, value: {label}, release};
}

function registered<T>(result: RegisterResult<T>): ResourceHandle<T> {
    if (result.status !== "registered") {
        throw new Error(`期望登记成功，实际为 ${result.status}`);
    }
    return result.handle;
}

function borrowed<T>(result: BorrowResult<T>): BorrowHandle<T> {
    if (result.status !== "borrowed") {
        throw new Error(`期望借用成功，实际为 ${result.reason}`);
    }
    return result.handle;
}

function createRoot(location: RuntimeLocation = "server", observer?: LifecycleObserver): Scope {
    return createRuntimeInstance({location, instanceId: `${location}-1`}, {observer}).root;
}

function openedRoot(location: RuntimeLocation = "server"): Scope {
    const root = createRoot(location);
    root.open();
    return root;
}

/** 让一个宏任务过去，足以冲刷机制内部全部 microtask 链。 */
function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function isSettled(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    const mark = (): void => {
        settled = true;
    };
    void promise.then(mark, mark);
    await tick();
    return settled;
}

function expectStateError(action: () => unknown, expected: {readonly phase: ScopePhase; readonly action: string}): void {
    let caught: unknown;
    try {
        action();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(LifecycleStateError);
    expect(caught).toMatchObject({name: "LifecycleStateError", ...expected});
}

/** 在停止信号触发前一直挂起、触发后以信号原因拒绝的获取。 */
function acquireUntilAborted(): (context: {readonly signal: AbortSignal}) => Promise<never> {
    return ({signal}) =>
        new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        });
}

describe("runtime.lifecycle 机制边界", () => {
    it("机制源码只使用同目录相对导入，不 import 框架、驱动或产品领域", async () => {
        const sources = await listMechanismSources();
        expect(sources).toContain("lifecycle.ts");
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const fromSpecifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)]
                .map((match) => match[1]);
            const sideEffectSpecifiers = [...code.matchAll(/^\s*import\s+["']([^"']+)["']/gmu)]
                .map((match) => match[1]);
            for (const specifier of [...fromSpecifiers, ...sideEffectSpecifiers]) {
                expect(specifier, `${name} 导入了 ${specifier}`).toMatch(/^\.\/[^/]+$/u);
            }
            expect(code, `${name} 不得使用动态 import`).not.toMatch(/\bimport\s*\(/u);
        }
    });

    it("运行实例必须有非空 instanceId", () => {
        expect(() => createRuntimeInstance({location: "server", instanceId: " "})).toThrow(TypeError);
    });

    it("运行位置由宿主声明：任意非空字符串都可以，空串被拒", () => {
        expect(createRuntimeInstance({location: "tui", instanceId: "tui-1"}).identity.location).toBe("tui");
        expect(() => createRuntimeInstance({location: " ", instanceId: "x-1"})).toThrow(TypeError);
    });
});

describe("阶段与转换", () => {
    it("阶段转换与非法转换", async () => {
        const changes: PhaseChange[] = [];
        const root = createRoot("server", {phaseChanged: (change) => changes.push(change)});
        expect(root.phase).toBe("creating");
        expect(root.parentId).toBeNull();
        expectStateError(() => root.accept({label: "early", run: () => 1}), {phase: "creating", action: "接纳操作"});

        const child = root.createChild("child");
        expect(child.phase).toBe("creating");
        expect(child.parentId).toBe(root.id);

        root.open();
        expect(root.phase).toBe("available");
        expectStateError(() => root.open(), {phase: "available", action: "进入可用"});

        const pending = Promise.withResolvers<void>();
        const release = vi.fn(() => pending.promise);
        registered(root.register(resourceSpec("slow", release)));

        const closing = root.close();
        expect(root.phase).toBe("stopping");
        expect(root.stopSignal.aborted).toBe(true);
        expectStateError(() => root.createChild("late"), {phase: "stopping", action: "创建子作用域"});
        expectStateError(() => root.accept({label: "late", run: () => 1}), {phase: "stopping", action: "接纳操作"});
        expectStateError(
            () => root.acquire({kind: "test", label: "late", acquire: () => ({label: "late"}), release: vi.fn()}),
            {phase: "stopping", action: "发起受管获取"},
        );
        expect(await isSettled(closing)).toBe(false);

        pending.resolve();
        await expect(closing).resolves.toEqual({status: "closed", scopeId: root.id, attempt: 1});
        expect(root.phase).toBe("closed");
        // creating 的子作用域随父关闭：creating → stopping → closed，从未可用。
        expect(child.phase).toBe("closed");
        expect(changes.map((change) => `${change.scopeId}:${change.from}>${change.to}`)).toEqual([
            `${root.id}:creating>available`,
            `${root.id}:available>stopping`,
            `${child.id}:creating>stopping`,
            `${child.id}:stopping>closed`,
            `${root.id}:stopping>closed`,
        ]);
        const sequences = changes.map((change) => change.sequence);
        expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
        expect(new Set(sequences).size).toBe(sequences.length);
    });

    it("可选获取失败不阻止可用，必需获取待返回时不能 open", async () => {
        const root = createRoot();
        const optional = await root.acquire({
            kind: "test",
            label: "telemetry",
            required: false,
            acquire: () => {
                throw new Error("遥测不可用");
            },
            release: vi.fn(),
        });
        expect(optional).toMatchObject({status: "failed", required: false});
        expect(root.snapshot().failures).toEqual([
            expect.objectContaining({
                stage: "acquire",
                phase: "creating",
                attempt: null,
                resourceId: null,
                error: {name: "Error", message: "遥测不可用"},
            }),
        ]);

        const pending = Promise.withResolvers<TestValue>();
        const acquiring = root.acquire({kind: "test", label: "db", acquire: () => pending.promise, release: vi.fn()});
        expectStateError(() => root.open(), {phase: "creating", action: "进入可用"});
        pending.resolve({label: "db"});
        await expect(acquiring).resolves.toMatchObject({status: "acquired"});
        root.open();
        expect(root.phase).toBe("available");
    });

    it("观察者异常不影响机制，失败记录仍送达", async () => {
        const failures: LifecycleFailure[] = [];
        const root = createRoot("server", {
            phaseChanged: () => {
                throw new Error("观察者故障");
            },
            failureRecorded: (failure) => failures.push(failure),
        });
        registered(
            root.register(
                resourceSpec("broken", () => {
                    throw new Error("释放失败");
                }),
            ),
        );
        root.open();
        await expect(root.close()).resolves.toMatchObject({status: "incomplete", reason: "release-failed"});
        expect(failures).toEqual([expect.objectContaining({stage: "release", error: {name: "Error", message: "释放失败"}})]);
    });
});

describe("Spec 验收 1：创建中途失败收口", () => {
    it("创建中第二个获取失败时收口第一个资源且不报可用", async () => {
        const changes: PhaseChange[] = [];
        const root = createRoot("server", {phaseChanged: (change) => changes.push(change)});
        const releaseFirst = vi.fn();
        const acquireSecond = vi.fn(() => Promise.reject(new Error("磁盘不可用")));

        const first = await root.acquire({kind: "test", label: "first", acquire: () => ({label: "first"}), release: releaseFirst});
        expect(first).toMatchObject({status: "acquired"});
        const second = await root.acquire({kind: "test", label: "second", acquire: acquireSecond, release: vi.fn()});
        expect(second).toMatchObject({status: "failed", required: true, error: expect.objectContaining({message: "磁盘不可用"})});

        expectStateError(() => root.open(), {phase: "creating", action: "进入可用"});
        expect(root.phase).toBe("creating");
        expect(root.snapshot().failures).toEqual([
            expect.objectContaining({stage: "acquire", phase: "creating", error: {name: "Error", message: "磁盘不可用"}}),
        ]);

        await expect(root.close()).resolves.toMatchObject({status: "closed"});
        expect(releaseFirst).toHaveBeenCalledTimes(1);
        expect(acquireSecond).toHaveBeenCalledTimes(1);
        expect(root.snapshot().resources).toEqual([expect.objectContaining({label: "first", status: "released"})]);
        expect(changes.map((change) => change.to)).toEqual(["stopping", "closed"]);
    });
});

describe("Spec 验收 2：唯一 owner 与借用", () => {
    it("借用者关闭不释放共享资源，只有 owner 关闭才释放", async () => {
        const root = openedRoot();
        const release = vi.fn();
        const shared = registered(root.register(resourceSpec("shared", release)));
        const windowA = root.createChild("window-a");
        windowA.open();
        const windowB = root.createChild("window-b");
        windowB.open();
        const borrowA = borrowed(windowA.borrow(shared));
        const borrowB = borrowed(windowB.borrow(shared));
        expect(borrowA.ownerScopeId).toBe(root.id);
        expect(borrowA.borrowerScopeId).toBe(windowA.id);

        await expect(windowA.close()).resolves.toMatchObject({status: "closed"});
        expect(release).not.toHaveBeenCalled();
        expect(shared.status).toBe("registered");
        expect(borrowA.released).toBe(true);
        expect(borrowB.released).toBe(false);
        expect(borrowB.value).toBe(shared.value);
        expect(root.snapshot().resources).toEqual([expect.objectContaining({id: shared.id, borrowerScopeIds: [windowB.id]})]);

        await expect(root.close()).resolves.toMatchObject({status: "closed"});
        expect(windowB.phase).toBe("closed");
        expect(borrowB.released).toBe(true);
        expect(release).toHaveBeenCalledTimes(1);
        expect(shared.status).toBe("released");
    });

    it("owner 关闭时被活跃借用的资源等待借用结束", async () => {
        const root = openedRoot();
        const owner = root.createChild("owner");
        owner.open();
        const borrower = root.createChild("borrower");
        borrower.open();
        const release = vi.fn();
        const shared = registered(owner.register(resourceSpec("shared", release)));
        const borrow = borrowed(borrower.borrow(shared));

        const closing = owner.close();
        expect(await isSettled(closing)).toBe(false);
        expect(owner.phase).toBe("stopping");
        expect(shared.status).toBe("registered");
        expect(release).not.toHaveBeenCalled();
        expect(borrow.ownerStopSignal.aborted).toBe(true);

        borrow.release();
        await expect(closing).resolves.toMatchObject({status: "closed", attempt: 1});
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("截止触发时 owner 报告被借用资源与借用者，借用结束后恢复关闭", async () => {
        const root = openedRoot();
        const owner = root.createChild("owner");
        owner.open();
        const borrower = root.createChild("borrower");
        borrower.open();
        const release = vi.fn();
        const shared = registered(owner.register(resourceSpec("shared", release)));
        const borrow = borrowed(borrower.borrow(shared));

        const deadline = new AbortController();
        const closing = owner.close({deadline: deadline.signal});
        await tick();
        deadline.abort();
        const result = await closing;
        expect(result).toMatchObject({
            status: "incomplete",
            reason: "deadline",
            attempt: 1,
            borrowedResources: [{resourceId: shared.id, borrowerScopeIds: [borrower.id]}],
            failedResources: [],
            failures: [expect.objectContaining({stage: "close", attempt: 1, error: expect.objectContaining({name: "DeadlineExceeded"})})],
        });
        expect(release).not.toHaveBeenCalled();
        expect(owner.phase).toBe("stopping");

        borrow.release();
        await expect(owner.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("借用者停滞时 owner 报告被阻塞而不是挂起，借用者恢复后 owner 才能关闭", async () => {
        const root = openedRoot();
        const owner = root.createChild("owner");
        owner.open();
        const borrower = root.createChild("borrower");
        borrower.open();
        const releaseShared = vi.fn();
        const shared = registered(owner.register(resourceSpec("shared", releaseShared)));
        const borrow = borrowed(borrower.borrow(shared));
        let cursorAttempts = 0;
        const releaseCursor = vi.fn(() => {
            cursorAttempts += 1;
            if (cursorAttempts === 1) {
                throw new Error("游标未能关闭");
            }
        });
        const cursor = registered(
            borrower.register({kind: "test", label: "cursor", value: {label: "cursor"}, release: releaseCursor, dependsOn: [borrow]}),
        );

        const borrowerResult = await borrower.close();
        expect(borrowerResult).toMatchObject({
            status: "incomplete",
            reason: "release-failed",
            failedResources: [cursor.id],
            unreleasedBorrows: [borrow.id],
            blockedReleases: [{target: borrow.id, blockedBy: [cursor.id], blockedByBorrowers: []}],
        });
        expect(borrow.released).toBe(false);

        const ownerResult = await owner.close();
        expect(ownerResult).toMatchObject({
            status: "incomplete",
            reason: "blocked",
            failedResources: [],
            blockedReleases: [{target: shared.id, blockedBy: [], blockedByBorrowers: [borrower.id]}],
            borrowedResources: [{resourceId: shared.id, borrowerScopeIds: [borrower.id]}],
        });
        expect(releaseShared).not.toHaveBeenCalled();

        await expect(borrower.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(borrow.released).toBe(true);
        expect(releaseCursor).toHaveBeenCalledTimes(2);
        await expect(owner.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(releaseShared).toHaveBeenCalledTimes(1);
    });

    it("跨运行实例借用、借用自有资源与借用后代资源被拒绝，跨作用域依赖必须先借用", () => {
        const instanceA = createRuntimeInstance({location: "server", instanceId: "a"});
        const instanceB = createRuntimeInstance({location: "server", instanceId: "b"});
        instanceA.root.open();
        instanceB.root.open();
        const resource = registered(instanceA.root.register(resourceSpec("shared")));
        expect(() => instanceB.root.borrow(resource)).toThrow(TypeError);
        expect(() => instanceA.root.borrow(resource)).toThrow(TypeError);

        const child = instanceA.root.createChild("child");
        child.open();
        const shortLived = registered(child.register(resourceSpec("short")));
        expect(() => instanceA.root.borrow(shortLived)).toThrow(TypeError);
        expect(child.borrow(resource)).toMatchObject({status: "borrowed"});

        const fake: ResourceHandle<TestValue> = {...resource};
        expect(() => child.borrow(fake)).toThrow(TypeError);
        expect(() =>
            child.register({kind: "test", label: "cursor", value: {label: "cursor"}, release: vi.fn(), dependsOn: [resource]}),
        ).toThrow(TypeError);
    });
});

describe("Spec 验收 3：取消与终止分离、非回滚", () => {
    it("取消只结束等待方，执行方终止前资源不释放、作用域不 closed", async () => {
        const root = openedRoot();
        const release = vi.fn();
        registered(root.register(resourceSpec("db", release)));
        const gate = Promise.withResolvers<void>();
        const operation = root.accept({
            label: "long-write",
            run: async () => {
                await gate.promise;
                return "written";
            },
        });

        operation.cancel();
        await expect(operation.outcome).resolves.toEqual({status: "cancelled", reason: "cancel-requested"});
        expect(operation.terminated).toBe(false);

        const closing = root.close();
        expect(await isSettled(closing)).toBe(false);
        expect(release).not.toHaveBeenCalled();
        expect(root.snapshot()).toMatchObject({
            phase: "stopping",
            inFlightOperations: [{id: operation.id, label: "long-write", waiterSettled: true}],
        });

        gate.resolve();
        await expect(operation.termination).resolves.toEqual({status: "completed"});
        expect(operation.terminated).toBe(true);
        await expect(closing).resolves.toMatchObject({status: "closed"});
        expect(release).toHaveBeenCalledTimes(1);
        expect(root.snapshot().inFlightOperations).toEqual([]);
    });

    it("取消竞态中执行方成功结果有效不改记，已发生副作用不回滚", async () => {
        const root = openedRoot();
        let sideEffects = 0;
        const gate = Promise.withResolvers<void>();
        const racing = root.accept({
            label: "commit",
            run: async ({signal}) => {
                sideEffects += 1;
                await gate.promise;
                return {committed: true, sawAbort: signal.aborted};
            },
        });
        racing.cancel();
        gate.resolve();
        await expect(racing.termination).resolves.toEqual({status: "completed"});
        await expect(racing.outcome).resolves.toEqual({status: "cancelled", reason: "cancel-requested"});
        expect(sideEffects).toBe(1);

        const finished = root.accept({label: "fast", run: () => 42});
        await expect(finished.outcome).resolves.toEqual({status: "completed", value: 42});
        finished.cancel();
        await expect(finished.outcome).resolves.toEqual({status: "completed", value: 42});
        expect(finished.terminated).toBe(true);

        const failing = root.accept({
            label: "failing",
            run: () => Promise.reject(new Error("提交失败")),
        });
        await expect(failing.outcome).resolves.toMatchObject({status: "failed", error: expect.objectContaining({message: "提交失败"})});
        await expect(failing.termination).resolves.toMatchObject({status: "failed"});
        expect(root.snapshot().failures).toEqual([]);
    });

    it("作用域停止让在途操作的等待方得到 scope-stopping，执行方收到 AbortError 信号", async () => {
        const root = openedRoot();
        const reasons: string[] = [];
        const operation = root.accept({
            label: "poll",
            run: ({signal}) =>
                new Promise<string>((resolve) => {
                    signal.addEventListener(
                        "abort",
                        () => {
                            const reason: unknown = signal.reason;
                            reasons.push(typeof reason === "object" && reason !== null && "name" in reason ? String(reason.name) : "?");
                            resolve("stopped");
                        },
                        {once: true},
                    );
                }),
        });
        const closing = root.close();
        await expect(operation.outcome).resolves.toEqual({status: "cancelled", reason: "scope-stopping"});
        await expect(operation.termination).resolves.toEqual({status: "completed"});
        await expect(closing).resolves.toMatchObject({status: "closed"});
        expect(reasons).toEqual(["AbortError"]);
    });
});

describe("Spec 验收 4：收口失败与超时", () => {
    it("一个资源释放失败时作用域保持停止中并只释放成功的；重复关闭返回同一次结果且不重复副作用；显式恢复才关闭", async () => {
        const root = openedRoot();
        const releaseOk = vi.fn();
        const releaseBad = vi.fn<ReleaseResource<TestValue>>(() => {
            throw new Error("句柄仍被占用");
        });
        const ok = registered(root.register(resourceSpec("ok", releaseOk)));
        const bad = registered(root.register(resourceSpec("bad", releaseBad)));

        const result = await root.close();
        expect(result).toMatchObject({
            status: "incomplete",
            reason: "release-failed",
            attempt: 1,
            failedResources: [bad.id],
            pendingReleases: [],
        });
        expect(root.phase).toBe("stopping");
        expect(ok.status).toBe("released");
        expect(bad.status).toBe("release-failed");
        expect(root.snapshot().failures).toEqual([
            expect.objectContaining({
                stage: "release",
                phase: "stopping",
                attempt: 1,
                resourceId: bad.id,
                error: {name: "Error", message: "句柄仍被占用"},
            }),
        ]);

        await expect(root.close()).resolves.toBe(result);
        await expect(root.close({deadline: AbortSignal.abort()})).resolves.toBe(result);
        expect(releaseOk).toHaveBeenCalledTimes(1);
        expect(releaseBad).toHaveBeenCalledTimes(1);
        expect(root.snapshot().closeAttempts).toBe(1);

        releaseBad.mockImplementation(() => undefined);
        await expect(root.recover()).resolves.toEqual({status: "closed", scopeId: root.id, attempt: 2});
        expect(releaseOk).toHaveBeenCalledTimes(1);
        expect(releaseBad).toHaveBeenCalledTimes(2);
        expect(root.phase).toBe("closed");
    });

    it("显式恢复不与 pending 清理重入，结算后重试成功才 closed", async () => {
        const root = openedRoot();
        const firstRelease = Promise.withResolvers<void>();
        const release = vi.fn<ReleaseResource<TestValue>>().mockReturnValueOnce(firstRelease.promise).mockReturnValue(undefined);
        const slow = registered(root.register(resourceSpec("slow", release)));

        const deadline = new AbortController();
        const closing = root.close({deadline: deadline.signal});
        await tick();
        expect(release).toHaveBeenCalledTimes(1);
        deadline.abort();
        const result = await closing;
        expect(result).toMatchObject({status: "incomplete", reason: "deadline", pendingReleases: [slow.id], failedResources: []});
        expect(slow.status).toBe("releasing");

        const recovering = root.recover();
        expect(await isSettled(recovering)).toBe(false);
        expect(release).toHaveBeenCalledTimes(1);
        expect(root.snapshot().closeAttempts).toBe(2);

        firstRelease.reject(new Error("第一次释放失败"));
        await expect(recovering).resolves.toEqual({status: "closed", scopeId: root.id, attempt: 2});
        expect(release).toHaveBeenCalledTimes(2);
        expect(root.snapshot().failures).toEqual([
            expect.objectContaining({stage: "close", attempt: 1, error: expect.objectContaining({name: "DeadlineExceeded"})}),
            expect.objectContaining({stage: "release", attempt: 1, resourceId: slow.id, error: {name: "Error", message: "第一次释放失败"}}),
        ]);
    });

    it("恢复只对停止中的作用域有意义，在途尝试未结算时恢复返回同一尝试", async () => {
        const root = openedRoot();
        expectStateError(() => root.recover(), {phase: "available", action: "恢复关闭"});
        const gate = Promise.withResolvers<void>();
        registered(root.register(resourceSpec("slow", () => gate.promise)));
        const closing = root.close();
        const recovering = root.recover();
        expect(recovering).toBe(closing);
        gate.resolve();
        await expect(closing).resolves.toMatchObject({status: "closed", attempt: 1});
    });
});

describe("Spec 验收 5：关闭门禁与迟到发布阻断", () => {
    it("关闭后迟到的获取被登记收口且不发布，停止中的 owner 不再出借", async () => {
        const root = openedRoot();
        const owner = root.createChild("owner");
        owner.open();
        const borrower = root.createChild("borrower");
        borrower.open();
        const releaseEarly = vi.fn();
        const releaseLate = vi.fn();
        const early = registered(owner.register(resourceSpec("early", releaseEarly)));
        const pending = Promise.withResolvers<TestValue>();
        const acquiring = owner.acquire({kind: "test", label: "late", acquire: () => pending.promise, release: releaseLate});

        const closing = owner.close();
        expect(await isSettled(closing)).toBe(false);
        expect(owner.snapshot().pendingAcquisitions).toEqual([{id: expect.any(String), kind: "test", label: "late", required: true}]);
        expect(borrower.borrow(early)).toEqual({status: "unavailable", reason: "owner-stopping"});
        expect(releaseEarly).not.toHaveBeenCalled();

        pending.resolve({label: "late"});
        const acquired = await acquiring;
        expect(acquired).toMatchObject({status: "late"});
        expect(acquired).not.toHaveProperty("handle");
        await expect(closing).resolves.toMatchObject({status: "closed"});
        expect(releaseLate).toHaveBeenCalledTimes(1);
        expect(releaseEarly).toHaveBeenCalledTimes(1);
        expect(owner.snapshot().resources).toEqual([
            expect.objectContaining({label: "early", late: false, status: "released"}),
            expect.objectContaining({label: "late", late: true, status: "released"}),
        ]);
        expect(borrower.borrow(early)).toEqual({status: "unavailable", reason: "owner-closed"});
    });

    it("停止中的同步登记也是迟到资源：只收口不发布句柄", async () => {
        const root = openedRoot();
        const releaseLate = vi.fn();
        const gate = Promise.withResolvers<void>();
        registered(root.register(resourceSpec("slow", () => gate.promise)));
        const closing = root.close();
        const late = root.register(resourceSpec("late", releaseLate));
        expect(late).toMatchObject({status: "late"});
        expect(late).not.toHaveProperty("handle");
        gate.resolve();
        await expect(closing).resolves.toMatchObject({status: "closed"});
        expect(releaseLate).toHaveBeenCalledTimes(1);
    });

    it("作用域停止时未完成的获取收到取消信号且不留资源、不记失败", async () => {
        const root = openedRoot();
        const release = vi.fn();
        const acquiring = root.acquire({kind: "test", label: "socket", acquire: acquireUntilAborted(), release});
        await expect(root.close()).resolves.toMatchObject({status: "closed"});
        await expect(acquiring).resolves.toMatchObject({status: "cancelled", required: true});
        expect(release).not.toHaveBeenCalled();
        expect(root.snapshot()).toMatchObject({resources: [], failures: [], pendingAcquisitions: []});
    });

    it("截止触发时结算为未完成并列出在途操作与待返回获取，显式恢复后才收口迟到资源", async () => {
        const root = openedRoot();
        const releaseLate = vi.fn();
        const pending = Promise.withResolvers<TestValue>();
        const acquiring = root.acquire({kind: "test", label: "connection", acquire: () => pending.promise, release: releaseLate});
        const gate = Promise.withResolvers<void>();
        const operation = root.accept({label: "sync", run: () => gate.promise});

        const deadline = new AbortController();
        const closing = root.close({deadline: deadline.signal});
        await tick();
        deadline.abort();
        const result = await closing;
        expect(result).toMatchObject({
            status: "incomplete",
            reason: "deadline",
            pendingAcquisitions: [{label: "connection", required: true}],
            inFlightOperations: [{id: operation.id, label: "sync", waiterSettled: true}],
        });
        expect(root.phase).toBe("stopping");

        pending.resolve({label: "connection"});
        gate.resolve();
        await expect(acquiring).resolves.toMatchObject({status: "late"});
        await expect(operation.termination).resolves.toEqual({status: "completed"});
        expect(releaseLate).not.toHaveBeenCalled();
        expect(root.snapshot().resources).toEqual([expect.objectContaining({label: "connection", late: true, status: "registered"})]);

        await expect(root.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(releaseLate).toHaveBeenCalledTimes(1);
    });

    it("已关闭作用域拒绝一切新登记且不复活", async () => {
        const root = openedRoot();
        const shared = registered(root.register(resourceSpec("shared")));
        const child = root.createChild("child");
        child.open();
        const result = await child.close();
        expect(result).toMatchObject({status: "closed"});

        expectStateError(() => child.register(resourceSpec("x")), {phase: "closed", action: "登记资源"});
        expectStateError(
            () => child.acquire({kind: "test", label: "x", acquire: () => ({label: "x"}), release: vi.fn()}),
            {phase: "closed", action: "发起受管获取"},
        );
        expectStateError(() => child.accept({label: "x", run: () => 1}), {phase: "closed", action: "接纳操作"});
        expectStateError(() => child.createChild("grandchild"), {phase: "closed", action: "创建子作用域"});
        expectStateError(() => child.borrow(shared), {phase: "closed", action: "借用资源"});
        expectStateError(() => child.open(), {phase: "closed", action: "进入可用"});
        await expect(child.close()).resolves.toBe(result);
        await expect(child.recover()).resolves.toBe(result);
        expect(child.phase).toBe("closed");
        expect(child.snapshot()).toMatchObject({closeAttempts: 1, lastClose: result});
        expect(root.snapshot().children).toEqual([]);
    });
});

describe("关闭顺序与失败聚合", () => {
    it("消费者先于提供者释放，无依赖资源并行释放", async () => {
        const root = openedRoot();
        const order: string[] = [];
        const gates = {
            provider: Promise.withResolvers<void>(),
            consumer: Promise.withResolvers<void>(),
            independent: Promise.withResolvers<void>(),
        };
        const release = (name: keyof typeof gates): ReleaseResource<TestValue> => () => {
            order.push(`${name}:start`);
            return gates[name].promise.then(() => {
                order.push(`${name}:end`);
            });
        };
        const provider = registered(root.register(resourceSpec("provider", release("provider"))));
        registered(
            root.register({kind: "test", label: "consumer", value: {label: "consumer"}, release: release("consumer"), dependsOn: [provider]}),
        );
        registered(root.register(resourceSpec("independent", release("independent"))));

        const closing = root.close();
        await tick();
        expect(order).toEqual(["consumer:start", "independent:start"]);
        expect(provider.status).toBe("registered");

        gates.consumer.resolve();
        await tick();
        expect(order).toEqual(["consumer:start", "independent:start", "consumer:end", "provider:start"]);

        gates.independent.resolve();
        gates.provider.resolve();
        await expect(closing).resolves.toMatchObject({status: "closed"});
        expect(order).toEqual([
            "consumer:start",
            "independent:start",
            "consumer:end",
            "provider:start",
            "independent:end",
            "provider:end",
        ]);
    });

    it("消费者释放失败时其提供者不提前释放，恢复成功后才释放", async () => {
        const root = openedRoot();
        const releaseProvider = vi.fn();
        let consumerAttempts = 0;
        const releaseConsumer = vi.fn(async () => {
            consumerAttempts += 1;
            if (consumerAttempts === 1) {
                throw new Error("消费者未能释放");
            }
        });
        const provider = registered(root.register(resourceSpec("provider", releaseProvider)));
        const consumer = registered(
            root.register({kind: "test", label: "consumer", value: {label: "consumer"}, release: releaseConsumer, dependsOn: [provider]}),
        );

        const result = await root.close();
        expect(result).toMatchObject({
            status: "incomplete",
            reason: "release-failed",
            failedResources: [consumer.id],
            blockedReleases: [{target: provider.id, blockedBy: [consumer.id], blockedByBorrowers: []}],
        });
        expect(releaseProvider).not.toHaveBeenCalled();
        expect(provider.status).toBe("registered");

        await expect(root.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(releaseConsumer).toHaveBeenCalledTimes(2);
        expect(releaseProvider).toHaveBeenCalledTimes(1);
    });

    it("跨子树借用者释放失败后，一次根恢复完成提供方与消费者整条级联", async () => {
        const root = openedRoot();
        const providerScope = root.createChild("provider");
        providerScope.open();
        const consumerScope = root.createChild("consumer");
        consumerScope.open();
        const releaseProvider = vi.fn();
        const provider = registered(providerScope.register(resourceSpec("provider", releaseProvider)));
        const borrow = borrowed(consumerScope.borrow(provider));
        let consumerAttempts = 0;
        const releaseConsumer = vi.fn(() => {
            consumerAttempts += 1;
            if (consumerAttempts === 1) {
                throw new Error("消费者释放失败");
            }
        });
        registered(
            consumerScope.register({
                kind: "test",
                label: "consumer",
                value: {label: "consumer"},
                release: releaseConsumer,
                dependsOn: [borrow],
            }),
        );

        const first = await root.close();
        expect(first).toMatchObject({
            status: "incomplete",
            reason: "blocked",
            blockedReleases: [],
            unclosedChildren: [providerScope.id, consumerScope.id],
        });
        expect(releaseProvider).not.toHaveBeenCalled();
        expect(releaseConsumer).toHaveBeenCalledTimes(1);

        await expect(root.recover()).resolves.toMatchObject({status: "closed", attempt: 2});
        expect(providerScope.phase).toBe("closed");
        expect(consumerScope.phase).toBe("closed");
        expect(releaseProvider).toHaveBeenCalledTimes(1);
        expect(releaseConsumer).toHaveBeenCalledTimes(2);
    });
    it("借用者恢复仍真实失败时提供方保持 blocked，级联不等待或重试提供方", async () => {
        const root = openedRoot();
        const providerScope = root.createChild("provider");
        providerScope.open();
        const borrowerScope = root.createChild("borrower");
        borrowerScope.open();
        const releaseProvider = vi.fn();
        const provider = registered(providerScope.register(resourceSpec("provider", releaseProvider)));
        const borrow = borrowed(borrowerScope.borrow(provider));
        const releaseBorrower = vi.fn(() => {
            throw new Error("借用者始终无法释放");
        });
        registered(
            borrowerScope.register({
                kind: "test",
                label: "borrower",
                value: {label: "borrower"},
                release: releaseBorrower,
                dependsOn: [borrow],
            }),
        );

        await expect(root.close()).resolves.toMatchObject({status: "incomplete", reason: "blocked"});
        await expect(root.recover()).resolves.toMatchObject({status: "incomplete", reason: "blocked"});
        expect(releaseBorrower).toHaveBeenCalledTimes(2);
        expect(releaseProvider).not.toHaveBeenCalled();
        expect(providerScope.phase).toBe("stopping");
        expect(borrowerScope.phase).toBe("stopping");
    });


    it("失败记录不携带资源值", async () => {
        const secret = "sk-live-do-not-leak";
        const recorded: LifecycleFailure[] = [];
        const root = createRoot("server", {failureRecorded: (failure) => recorded.push(failure)});
        root.register({
            kind: "credential",
            label: "provider-key",
            value: {token: secret},
            release: () => {
                throw new Error("释放失败");
            },
        });
        root.open();
        const result = await root.close();
        expect(result).toMatchObject({status: "incomplete"});
        const serialized = JSON.stringify({result, snapshot: root.snapshot(), recorded});
        expect(serialized).not.toContain(secret);
        expect(recorded).toHaveLength(1);
    });
});

describe("隔离与复用", () => {
    it("两个运行实例与父子作用域互不串状态", async () => {
        const server = createRuntimeInstance({location: "server", instanceId: "server-1"});
        const browser = createRuntimeInstance({location: "browser", instanceId: "browser-1"});
        server.root.open();
        browser.root.open();
        const serverRelease = vi.fn();
        const browserRelease = vi.fn();
        const serverResource = registered(server.root.register(resourceSpec("db", serverRelease)));
        registered(browser.root.register(resourceSpec("ui", browserRelease)));
        const operation = server.root.createChild("operation");
        operation.open();
        const operationRelease = vi.fn();
        registered(operation.register(resourceSpec("temp", operationRelease)));

        await expect(operation.close()).resolves.toMatchObject({status: "closed"});
        expect(operationRelease).toHaveBeenCalledTimes(1);
        expect(serverRelease).not.toHaveBeenCalled();
        expect(server.root.phase).toBe("available");
        expect(server.root.snapshot().children).toEqual([]);

        await expect(browser.root.close()).resolves.toMatchObject({status: "closed"});
        expect(browserRelease).toHaveBeenCalledTimes(1);
        expect(serverRelease).not.toHaveBeenCalled();
        expect(server.root.phase).toBe("available");
        expect(serverResource.instanceId).toBe("server-1");
        expect(browser.identity).toEqual({location: "browser", instanceId: "browser-1"});
    });

    it("同一装配在 server 与 browser 位置得到相同可观察结果", async () => {
        async function assemble(location: RuntimeLocation) {
            const root = createRoot(location);
            const shared = registered(root.register(resourceSpec("shared")));
            root.open();
            const operation = root.createChild("operation");
            operation.open();
            const borrow = borrowed(operation.borrow(shared));
            registered(
                operation.register({kind: "test", label: "cursor", value: {label: "cursor"}, release: vi.fn(), dependsOn: [borrow]}),
            );
            const closedOperation = await operation.close();
            const beforeRootClose = root.snapshot();
            const closedRoot = await root.close();
            return {
                closedOperation,
                beforeRootClose: {phase: beforeRootClose.phase, resources: beforeRootClose.resources.map((entry) => entry.status)},
                closedRoot,
                afterRootClose: root.snapshot().resources.map((entry) => entry.status),
            };
        }
        const [server, browser] = await Promise.all([assemble("server"), assemble("browser")]);
        expect(browser).toEqual(server);
        expect(server.beforeRootClose).toEqual({phase: "available", resources: ["registered"]});
        expect(server.afterRootClose).toEqual(["released"]);
    });
});

describe("Spec 验收 7：强制终止", () => {
    it("无清理回调的终止不产生正常关闭报告", () => {
        const release = vi.fn();
        const first = createRuntimeInstance({location: "server", instanceId: "boot-1"});
        first.root.register(resourceSpec("lease", release));
        first.root.open();

        // 模拟进程被强制终止：不调用 close，直接丢弃实例。
        expect(first.root.snapshot()).toMatchObject({phase: "available", lastClose: null, closeAttempts: 0});
        expect(release).not.toHaveBeenCalled();

        const second = createRuntimeInstance({location: "server", instanceId: "boot-2"});
        expect(second.identity.instanceId).not.toBe(first.identity.instanceId);
        expect(second.root.snapshot()).toMatchObject({phase: "creating", resources: [], lastClose: null});
    });
});
