import {afterEach, describe, expect, it, vi} from "vitest";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StoragePartitionBinding, StorageReadResult} from "nbook/shared/storage/contract";
import {openStorageOwnerHandle, STORAGE_SUBSCRIBE_LIMIT} from "nbook/app/utils/storage/owner-handle";
import {isStorageAdapterError, StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import type {StorageProjectContextSession} from "nbook/app/utils/storage/host-context-client";

type LayoutState = {readonly width: number};

const OWNER = "test.adapter";
const BINDING: StoragePartitionBinding = {local: 1, shared: 1};

const layout: DefinedStorageState<LayoutState> = defineStorageState<LayoutState>({
    owner: OWNER,
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320},
    validate: (value): value is LayoutState => typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number",
});

const note: DefinedStorageState<LayoutState> = defineStorageState<LayoutState>({
    owner: OWNER,
    key: "note",
    scope: "user",
    locality: "local",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {width: 0},
    validate: (value): value is LayoutState => typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number",
});

const projectLayout: DefinedStorageState<LayoutState> = defineStorageState<LayoutState>({
    owner: OWNER,
    key: "project-layout",
    scope: "project",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320},
    validate: (value): value is LayoutState => typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number",
});

const session = {scope: "user", contextId: "f".repeat(64), clientCredential: "0123456789abcdef".repeat(4)} as const;

/** 记录每个动作的可观察替身；默认按合同回答，用例可以覆盖单个动作。 */
function fakeTransport(answer?: (action: StorageActionRequest, call: number) => StorageActionResponse | Promise<StorageActionResponse>) {
    const sent: StorageActionRequest[] = [];
    const transport: StorageValueTransport = {
        async send(action) {
            sent.push(action);
            return answer === undefined ? defaultAnswer(action) : await answer(action, sent.length);
        },
    };
    return {transport, sent};
}

function defaultAnswer(action: StorageActionRequest): StorageActionResponse {
    const credential = {revision: "rev-1", partitionGeneration: 1};
    switch (action.kind) {
        case "bind":
            return {kind: "bind", binding: BINDING};
        case "read":
            return {kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}};
        case "reclaim":
            return {kind: "reclaim", result: {partitionGeneration: 2, outcomes: []}};
        case "save":
            return {kind: "save", credential};
        case "remove":
            return {kind: "remove", credential};
        case "migrate":
            return {kind: "migrate", credential};
        case "repair":
            return {kind: "repair", credential};
    }
}

function adapterError(code: string, extra: {readonly status?: number | null; readonly committed?: boolean | null} = {}): StorageAdapterError {
    return new StorageAdapterError({
        code,
        status: extra.status ?? 409,
        message: `测试注入的 ${code}`,
        committed: extra.committed ?? false,
    });
}

const credential: StorageCredential = {revision: null, partitionGeneration: 1};

afterEach(() => {
    vi.useRealTimers();
});

describe("句柄绑定与调用边界", () => {
    it("先绑定分区代次，之后每个值动作都携带同一份绑定", async () => {
        const {transport, sent} = fakeTransport();
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        expect(sent.map((action) => action.kind)).toEqual(["bind"]);
        expect(handle.binding).toEqual(BINDING);

        await handle.read(layout);
        await handle.save(layout, {expected: credential, value: {width: 1}});
        await handle.remove(layout, {expected: credential});
        await handle.reclaim(note, {targets: [{resource: "one"}]});

        expect(sent.map((action) => action.kind)).toEqual(["bind", "read", "save", "remove", "reclaim"]);
        for (const action of sent.slice(1)) {
            expect(action).toMatchObject({binding: BINDING, schemaVersion: 1});
        }
        // 请求只提交逻辑地址；scope、locality、主体与磁盘路径都由服务端拥有。
        expect(sent[2]).not.toHaveProperty("scope");
        expect(sent[2]).not.toHaveProperty("locality");
        expect(sent[1]).toMatchObject({owner: OWNER, key: layout.key});
    });

    it("owner 不匹配的调用在本地拒绝，且不发出动作", async () => {
        const {transport, sent} = fakeTransport();
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        await expect(handle.read({...layout, owner: "test.other"} as DefinedStorageState<LayoutState>))
            .rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        expect(sent.map((action) => action.kind)).toEqual(["bind"]);
    });

    it("值在接纳边界捕获，调用方之后改写不影响已发送请求", async () => {
        const {transport, sent} = fakeTransport();
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});
        const value = {width: 1};
        const expected: {revision: string | null; partitionGeneration: number} = {...credential};

        const pending = handle.save(layout, {expected, value});
        value.width = 99;
        expected.revision = "changed";

        await pending;
        expect(sent[1]).toMatchObject({kind: "save", expected: {revision: null, partitionGeneration: 1}, value: {width: 1}});
    });

    it("非 JSON 与超限值在发送前拒绝", async () => {
        const {transport, sent} = fakeTransport();
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        await expect(handle.save(layout, {expected: credential, value: {width: Number.POSITIVE_INFINITY}}))
            .rejects.toMatchObject({code: "STORAGE_VALUE_INVALID"});
        const oversize = {width: 1, blob: "x".repeat(1024 * 1024 + 1)};
        await expect(handle.save(layout, {expected: credential, value: oversize}))
            .rejects.toMatchObject({code: "STORAGE_VALUE_TOO_LARGE"});
        expect(sent.map((action) => action.kind)).toEqual(["bind"]);
    });
});

describe("mutation 顺序与失败", () => {
    it("同一记录的 mutation 按调用顺序发送，前一个失败不堵塞后续意图", async () => {
        const order: string[] = [];
        let saves = 0;
        const {transport} = fakeTransport(async (action) => {
            order.push(`${action.kind}:${"resource" in action && action.resource !== undefined ? action.resource : "single"}`);
            if (action.kind === "save") {
                saves += 1;
                if (saves === 1) throw adapterError("STORAGE_REVISION_CONFLICT");
            }
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        const first = handle.save(note, {expected: credential, value: {width: 1}, resource: "one"});
        const second = handle.remove(note, {expected: credential, resource: "one"});
        const third = handle.save(note, {expected: credential, value: {width: 2}, resource: "one"});

        await expect(first).rejects.toMatchObject({code: "STORAGE_REVISION_CONFLICT"});
        await second;
        await third;
        expect(order).toEqual(["bind:single", "save:one", "remove:one", "save:one"]);
    });

    it("不同记录不互相阻塞", async () => {
        const released = Promise.withResolvers<void>();
        const {transport} = fakeTransport(async (action, call) => {
            if (call === 2) await released.promise;
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        const blocked = handle.save(note, {expected: credential, value: {width: 1}, resource: "one"});
        const other = handle.save(note, {expected: credential, value: {width: 2}, resource: "two"});
        await other;
        released.resolve();
        await blocked;
    });
});

describe("失败投影", () => {
    it("永久失效后不再发出动作，并保持同一失败", async () => {
        let calls = 0;
        const {transport, sent} = fakeTransport((action) => {
            calls += 1;
            if (action.kind === "read") throw adapterError("STORAGE_CREDENTIAL_STALE");
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        await expect(handle.read(layout)).rejects.toMatchObject({code: "STORAGE_CREDENTIAL_STALE"});
        const before = sent.length;
        await expect(handle.read(layout)).rejects.toMatchObject({code: "STORAGE_CREDENTIAL_STALE"});
        expect(sent).toHaveLength(before);
        expect(calls).toBe(2);
    });

    it("单次冲突不终止句柄，也不自动改写 revision 重试", async () => {
        let saves = 0;
        const {transport} = fakeTransport((action) => {
            if (action.kind !== "save") return defaultAnswer(action);
            saves += 1;
            if (saves === 1) throw adapterError("STORAGE_REVISION_CONFLICT");
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        await expect(handle.save(layout, {expected: credential, value: {width: 1}})).rejects.toMatchObject({code: "STORAGE_REVISION_CONFLICT"});
        expect(saves).toBe(1);
        await expect(handle.save(layout, {expected: {revision: "rev-1", partitionGeneration: 1}, value: {width: 2}}))
            .resolves.toMatchObject({revision: "rev-1"});
    });

    it("未确认与已提交分别可见", async () => {
        const {transport} = fakeTransport((action) => {
            if (action.kind === "read") throw new StorageAdapterError({code: null, status: null, message: "连接中断", committed: null});
            if (action.kind === "remove") throw adapterError("STORAGE_LOCK_UNAVAILABLE", {status: 503, committed: true});
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        const unconfirmed = await handle.read(layout).catch((error: unknown) => error);
        expect(isStorageAdapterError(unconfirmed)).toBe(true);
        expect(unconfirmed).toMatchObject({status: null, committed: null});

        const committed = await handle.remove(layout, {expected: credential}).catch((error: unknown) => error);
        expect(committed).toMatchObject({code: "STORAGE_LOCK_UNAVAILABLE", status: 503, committed: true});
    });
});

describe("订阅", () => {
    it("先给初始快照，再按修订报告变化", async () => {
        vi.useFakeTimers();
        let revision = 1;
        const {transport, sent} = fakeTransport((action) => {
            if (action.kind !== "read") return defaultAnswer(action);
            return {
                kind: "read",
                result: {
                    kind: "value",
                    value: {width: revision},
                    schemaVersion: 1,
                    credential: {revision: `rev-${String(revision)}`, partitionGeneration: 1},
                },
            };
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 50}});
        const updates: StorageReadResult<LayoutState>[] = [];
        const subscription = await handle.subscribe(layout, {onUpdate: (snapshot) => updates.push(snapshot as StorageReadResult<LayoutState>)});

        expect(subscription.snapshot).toMatchObject({kind: "value", value: {width: 1}});
        expect(updates).toHaveLength(0);

        // 相同修订不重复报告；外部提交由定期观察发现。
        await vi.advanceTimersByTimeAsync(120);
        expect(updates).toHaveLength(0);

        revision = 2;
        await vi.advanceTimersByTimeAsync(60);
        expect(updates.map((snapshot) => (snapshot as {readonly value?: unknown}).value)).toEqual([{width: 2}]);

        const readsBeforeRelease = sent.filter((action) => action.kind === "read").length;
        await subscription.close();
        await vi.advanceTimersByTimeAsync(300);
        expect(sent.filter((action) => action.kind === "read")).toHaveLength(readsBeforeRelease);
    });

    it("本进程提交立即触发重读，且始终只有一条串行读取链", async () => {
        vi.useFakeTimers();
        let revision = 1;
        let inFlight = 0;
        let maxInFlight = 0;
        const {transport, sent} = fakeTransport(async (action) => {
            if (action.kind !== "read") {
                if (action.kind === "save") revision += 1;
                return defaultAnswer(action);
            }
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            const current = revision;
            await Promise.resolve();
            inFlight -= 1;
            return {
                kind: "read",
                result: {
                    kind: "value",
                    value: {width: current},
                    schemaVersion: 1,
                    credential: {revision: `rev-${String(current)}`, partitionGeneration: 1},
                },
            };
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 500}});
        const updates: unknown[] = [];
        await handle.subscribe(layout, {onUpdate: (snapshot) => updates.push(snapshot)});

        await handle.save(layout, {expected: credential, value: {width: 2}});
        await vi.advanceTimersByTimeAsync(0);

        expect(updates).toEqual([expect.objectContaining({kind: "value", value: {width: 2}})]);
        expect(maxInFlight).toBe(1);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(maxInFlight).toBe(1);
        expect(sent.filter((action) => action.kind === "read")).toHaveLength(6);
    });

    it("读取网络故障退避且可见，恢复后重置间隔", async () => {
        vi.useFakeTimers();
        let reads = 0;
        const {transport, sent} = fakeTransport((action) => {
            if (action.kind !== "read") return defaultAnswer(action);
            reads += 1;
            if (reads === 2 || reads === 3) {
                throw new StorageAdapterError({code: null, status: null, message: "连接中断", committed: null});
            }
            return {kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}};
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 10, maxBackoffMs: 80}});
        const errors: unknown[] = [];
        await handle.subscribe(layout, {onError: (error) => errors.push(error)});

        await vi.advanceTimersByTimeAsync(11);
        expect(errors).toHaveLength(1);
        const afterFirstFailure = sent.length;
        // 退避不是立即重连：这段时间内不产生新的读取。
        await vi.advanceTimersByTimeAsync(11);
        expect(sent).toHaveLength(afterFirstFailure);

        // 第二次失败后第三次观察恢复，间隔重新回到基准值。
        await vi.advanceTimersByTimeAsync(2_000);
        expect(errors).toHaveLength(2);
        expect(reads).toBeGreaterThanOrEqual(4);
        expect(sent.filter((action) => action.kind === "read").length).toBe(reads);
    });

    it("访问失效终止该订阅并报告，句柄也不再发出动作", async () => {
        vi.useFakeTimers();
        let reads = 0;
        const {transport, sent} = fakeTransport((action) => {
            if (action.kind !== "read") return defaultAnswer(action);
            reads += 1;
            if (reads >= 2) throw adapterError("STORAGE_CONTEXT_INVALID", {status: 403});
            return {kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}};
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 10}});
        const errors: unknown[] = [];
        const subscription = await handle.subscribe(layout, {onError: (error) => errors.push(error)});

        await vi.advanceTimersByTimeAsync(11);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({code: "STORAGE_CONTEXT_INVALID"});

        const readsAfterFailure = sent.length;
        await vi.advanceTimersByTimeAsync(1_000);
        expect(sent).toHaveLength(readsAfterFailure);
        // 永久失效是句柄级的：后续调用不再尝试网络，调用方必须显式重新初始化。
        await expect(handle.read(layout)).rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        expect(sent).toHaveLength(readsAfterFailure);
        await subscription.close();
    });

    it("监听器抛错不影响后续更新与已提交事实", async () => {
        vi.useFakeTimers();
        let revision = 1;
        const {transport} = fakeTransport((action) => {
            if (action.kind !== "read") return defaultAnswer(action);
            return {
                kind: "read",
                result: {
                    kind: "value",
                    value: {width: revision},
                    schemaVersion: 1,
                    credential: {revision: `rev-${String(revision)}`, partitionGeneration: 1},
                },
            };
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 10}});
        const seen: unknown[] = [];
        const errors: unknown[] = [];
        await handle.subscribe(layout, {
            onUpdate: (snapshot) => {
                seen.push(snapshot);
                throw new Error("观察者自己的错误");
            },
            onError: (error) => errors.push(error),
        });

        revision = 2;
        await vi.advanceTimersByTimeAsync(20);
        revision = 3;
        await vi.advanceTimersByTimeAsync(20);

        expect(seen).toHaveLength(2);
        expect(errors).toHaveLength(2);
        // 保存仍然走完并得到确认值。
        await expect(handle.save(layout, {expected: credential, value: {width: 4}})).resolves.toMatchObject({revision: "rev-1"});
    });

    it("活动订阅达到上限时拒绝新订阅", async () => {
        const {transport} = fakeTransport();
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});
        for (let index = 0; index < STORAGE_SUBSCRIBE_LIMIT; index += 1) {
            await handle.subscribe(note, {resource: `item-${String(index)}`});
        }
        await expect(handle.subscribe(note, {resource: "overflow"}))
            .rejects.toMatchObject({code: "STORAGE_CONTEXT_LIMIT"});
        await handle.release();
    });
});

describe("release", () => {
    it("等待独立读取收口，重复释放共享同一个排空结果", async () => {
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        let readSignal: AbortSignal | undefined;
        const transport: StorageValueTransport = {
            async send(action, options) {
                if (action.kind === "read") {
                    readSignal = options?.signal;
                    started.resolve();
                    await gate.promise;
                }
                return defaultAnswer(action);
            },
        };
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});
        const pending = handle.read(layout);
        await started.promise;
        const closing = handle.release();
        expect(handle.release()).toBe(closing);
        expect(readSignal?.aborted).toBe(true);
        let closed = false;
        void closing.then(() => {closed = true;});
        await Promise.resolve();
        expect(closed).toBe(false);
        gate.resolve();
        await pending;
        await closing;
        expect(closed).toBe(true);
    });

    it("订阅初始化期间释放后，不交付可用订阅或快照", async () => {
        vi.useFakeTimers();
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        const {transport} = fakeTransport(async (action) => {
            if (action.kind === "read") {
                started.resolve();
                await gate.promise;
            }
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});
        const pending = handle.subscribe(layout);
        const rejected = expect(pending).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED"});
        await started.promise;
        const closing = handle.release();
        gate.resolve();
        await rejected;
        await closing;
        expect(vi.getTimerCount()).toBe(0);
    });

    it("排空已接纳请求、停止订阅并拒绝新调用", async () => {
        vi.useFakeTimers();
        const gate = Promise.withResolvers<void>();
        const {transport, sent} = fakeTransport(async (action) => {
            if (action.kind === "save") {
                // 已接纳的保存完成前，释放必须等待它收口。
                await gate.promise;
            }
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 10}});
        await handle.subscribe(layout);

        const pending = handle.save(layout, {expected: credential, value: {width: 1}});
        let released = false;
        const release = handle.release().then(() => { released = true; });
        await Promise.resolve();
        expect(released).toBe(false);

        gate.resolve();
        await pending;
        await release;
        expect(released).toBe(true);

        const readsBefore = sent.filter((action) => action.kind === "read").length;
        await vi.advanceTimersByTimeAsync(500);
        expect(sent.filter((action) => action.kind === "read")).toHaveLength(readsBefore);
        expect(vi.getTimerCount()).toBe(0);
        await expect(handle.read(layout)).rejects.toMatchObject({code: "STORAGE_HANDLE_CLOSED"});
        await expect(handle.release()).resolves.toBeUndefined();
    });
});

describe("不可变绑定与响应语义", () => {
    it("open 等待期间捕获 owner 和观察配置，绑定是独立冻结快照", async () => {
        const gate = Promise.withResolvers<void>();
        const sourceBinding = {local: 1, shared: 1};
        const {transport, sent} = fakeTransport(async (action) => {
            if (action.kind === "bind") {
                await gate.promise;
                return {kind: "bind", binding: sourceBinding};
            }
            return defaultAnswer(action);
        });
        const options = {session, owner: OWNER, transport, subscribe: {intervalMs: 50}};
        const pending = openStorageOwnerHandle(options);
        options.owner = "test.changed";
        options.subscribe.intervalMs = -1;
        gate.resolve();
        const handle = await pending;
        sourceBinding.local = 2;
        expect(handle.owner).toBe(OWNER);
        expect(handle.binding.local).toBe(1);
        expect(Object.isFrozen(handle.binding)).toBe(true);
        expect(Reflect.set(handle.binding, "local", 3)).toBe(false);
        await handle.read(layout);
        expect(sent[1]).toMatchObject({owner: OWNER, binding: {local: 1, shared: 1}});
        await handle.release();
    });

    it.each([
        {intervalMs: 0}, {intervalMs: Number.NaN}, {intervalMs: 10.5},
        {intervalMs: 50, maxBackoffMs: 49}, {maxBackoffMs: 2_147_483_648},
    ])("非法轮询间隔在网络调用前拒绝 %#", async (subscribe) => {
        const {transport, sent} = fakeTransport();
        await expect(openStorageOwnerHandle({session, owner: OWNER, transport, subscribe})).rejects.toMatchObject({code: "STORAGE_REQUEST_INVALID"});
        expect(sent).toHaveLength(0);
    });

    it.each([
        {schemaVersion: 2, value: {width: 3}, code: "STORAGE_SCHEMA_MISMATCH"},
        {schemaVersion: 1, value: {width: "bad"}, code: "STORAGE_VALUE_INVALID"},
    ])("不把版本或格式错误的响应强转成消费值 %#", async ({schemaVersion, value, code}) => {
        const {transport} = fakeTransport((action) => action.kind !== "read" ? defaultAnswer(action) : {
            kind: "read", result: {kind: "value", schemaVersion, value, credential},
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});
        await expect(handle.read(layout)).rejects.toMatchObject({code});
        await handle.release();
    });

    it("当前值按定义验证后捕获为独立冻结快照", async () => {
        const source = {width: 20};
        const {transport} = fakeTransport((action) => action.kind !== "read" ? defaultAnswer(action) : {
            kind: "read", result: {kind: "value", schemaVersion: 1, value: source, credential},
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});
        const result = await handle.read(layout);
        source.width = 30;
        expect(result).toMatchObject({kind: "value", value: {width: 20}});
        if (result.kind !== "value") throw new Error("expected current value");
        expect(Object.isFrozen(result.value)).toBe(true);
        await handle.release();
    });

    it.each([401, 403])("无 Storage code 的 HTTP %i 也终止访问与观察", async (status) => {
        vi.useFakeTimers();
        let reads = 0;
        const {transport, sent} = fakeTransport((action) => {
            if (action.kind === "read" && ++reads > 1) throw {statusCode: status};
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport, subscribe: {intervalMs: 10}});
        const errors: unknown[] = [];
        await handle.subscribe(layout, {onError: (error) => errors.push(error)});
        await vi.advanceTimersByTimeAsync(1000);
        expect(errors).toHaveLength(1);
        expect(reads).toBe(2);
        const count = sent.length;
        await expect(handle.read(layout)).rejects.toMatchObject({status});
        expect(sent).toHaveLength(count);
        await handle.release();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("scope 与 session 归属", () => {
    const projectSession: StorageProjectContextSession = {
        scope: "project",
        contextId: "e".repeat(64),
        clientCredential: "0123456789abcdef".repeat(4),
        projectRoot: "/workspace/A",
        publicId: "public-a",
    };

    it("user session 读写 project 归属定义时在本地拒绝，且不发出动作", async () => {
        const {transport, sent} = fakeTransport();
        const handle = await openStorageOwnerHandle({session, owner: OWNER, transport});

        await expect(handle.read(projectLayout)).rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        await expect(handle.save(projectLayout, {expected: credential, value: {width: 1}}))
            .rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        await expect(handle.subscribe(projectLayout)).rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        expect(sent.map((action) => action.kind)).toEqual(["bind"]);
        await handle.release();
    });

    it("project session 读写 user 归属定义时在本地拒绝", async () => {
        const {transport, sent} = fakeTransport();
        const handle = await openStorageOwnerHandle({session: projectSession, owner: OWNER, transport});

        await expect(handle.read(layout)).rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        expect(sent.map((action) => action.kind)).toEqual(["bind"]);
        await handle.release();
    });

    it("project 发布失效后句柄终止，不重新绑定也不按路径重取 ready", async () => {
        let reads = 0;
        const {transport, sent} = fakeTransport((action) => {
            if (action.kind === "read" && ++reads === 2) throw adapterError("STORAGE_CONTEXT_INVALID", {status: 403});
            return defaultAnswer(action);
        });
        const handle = await openStorageOwnerHandle({session: projectSession, owner: OWNER, transport});

        await expect(handle.read(projectLayout)).resolves.toMatchObject({kind: "missing"});
        await expect(handle.read(projectLayout)).rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});

        const before = sent.length;
        await expect(handle.read(projectLayout)).rejects.toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        expect(sent).toHaveLength(before);
        expect(sent.filter((action) => action.kind === "bind")).toHaveLength(1);
        await handle.release();
    });
});
