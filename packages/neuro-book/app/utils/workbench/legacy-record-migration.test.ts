import {describe, expect, it, vi} from "vitest";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {
    createBrowserLegacyValueStore,
    migrateLegacyRecord,
    type LegacyValueReading,
    type LegacyValueStore,
} from "nbook/app/utils/workbench/legacy-record-migration";
import type {
    LayoutRecordCommitResult,
    LayoutRecordSession,
    LayoutRecordState,
} from "nbook/app/utils/workbench/layout-session";
import type {WorkbenchStorageOwnerHandle} from "nbook/app/utils/workbench/storage-context";

/**
 * 共享迁移原语的**保留分支**：`legacy-record-migration.ts` 的价值主张是「任何一步失败都保留旧键」，
 * 而三个会话测试用的替身只能产 `absent` / `value`、删除恒成功，失败路径在那里到不了。
 *
 * 这里直接对着原语摆出每条分支（会话、句柄、旧键访问器都是最小替身，形状照 `LayoutRecordSession`
 * 与 `WorkbenchStorageOwnerHandle` 收窄到本模块真正用到的部分），并覆盖 `createBrowserLegacyValueStore`
 * 的 SSR 与"访问存储本身抛错"两条路径。
 */

type FakeRecord = {paths?: readonly string[]; width?: number};

const LABEL = "旧测试记录";
const DEFINITION = {} as DefinedStorageState<FakeRecord>;

function credential(): StorageCredential {
    return {revision: "revision-1", partitionGeneration: 1};
}

type SessionStub = {
    readonly commits: FakeRecord[];
    readonly session: LayoutRecordSession<FakeRecord, readonly string[]>;
    setState(patch: Partial<LayoutRecordState<FakeRecord>>): void;
    setCommitResult(result: LayoutRecordCommitResult): void;
};

function sessionStub(initial: Partial<LayoutRecordState<FakeRecord>> = {}): SessionStub {
    const commits: FakeRecord[] = [];
    let state: LayoutRecordState<FakeRecord> = {
        phase: "ready",
        projection: null,
        confirmed: {paths: []},
        hasConfirmed: false,
        writable: true,
        blocked: null,
        pending: null,
        issues: [],
        ...initial,
    };
    let result: LayoutRecordCommitResult = {status: "saved", credential: credential()};
    const session = {
        scope: "user",
        state: () => state,
        display: () => state.confirmed,
        open: async () => state,
        commit: async (intent: readonly string[]) => {
            commits.push({paths: intent});
            return result;
        },
        retry: async () => result,
        abandon: () => undefined,
        release: async () => undefined,
    } as unknown as LayoutRecordSession<FakeRecord, readonly string[]>;
    return {
        commits,
        session,
        setState: (patch) => {
            state = {...state, ...patch};
        },
        setCommitResult: (next) => {
            result = next;
        },
    };
}

function handleStub(read: () => Promise<StorageReadResult<FakeRecord>>): WorkbenchStorageOwnerHandle {
    return {owner: "workbench.test", read} as unknown as WorkbenchStorageOwnerHandle;
}

function readValue(record: FakeRecord): StorageReadResult<FakeRecord> {
    return {kind: "value", value: record, schemaVersion: 1, credential: credential()};
}

/** 可控旧键：`read()` 可按用例切成 unavailable，`remove()` 可失败。 */
function legacyStub(options: {reading?: LegacyValueReading; removeFails?: boolean} = {}) {
    const calls = {removed: 0};
    const store: LegacyValueStore = {
        read: () => options.reading ?? {kind: "value", raw: JSON.stringify(["manuscript/"])},
        remove: () => {
            calls.removed += 1;
            return options.removeFails !== true;
        },
    };
    return {store, calls};
}

function migrate(options: {
    session: SessionStub;
    handle: WorkbenchStorageOwnerHandle;
    legacy: LegacyValueStore;
    isEmpty?: (value: readonly string[]) => boolean;
}) {
    return migrateLegacyRecord<FakeRecord, readonly string[]>({
        session: options.session.session,
        handle: options.handle,
        definition: DEFINITION,
        store: options.legacy,
        label: LABEL,
        parse: (raw) => {
            try {
                const parsed = JSON.parse(raw) as unknown;
                return Array.isArray(parsed)
                    ? {value: parsed as readonly string[], diagnosis: null}
                    : {value: null, diagnosis: "旧键内容不是路径数组"};
            } catch {
                return {value: null, diagnosis: "旧键内容不是合法 JSON"};
            }
        },
        isEmpty: options.isEmpty ?? ((value) => value.length === 0),
        same: (record, value) => JSON.stringify(record.paths ?? []) === JSON.stringify(value),
    });
}

describe("migrateLegacyRecord 的保留分支", () => {
    it("旧键不存在：按已结算处理，不碰存储", async () => {
        const session = sessionStub();
        const legacy = legacyStub({reading: {kind: "absent"}});

        const result = await migrate({session, handle: handleStub(async () => readValue({})), legacy: legacy.store});

        expect(result).toEqual({kind: "settled"});
        expect(legacy.calls.removed).toBe(0);
        expect(session.commits).toEqual([]);
    });

    it("旧键不可读（隐私模式/被禁用）：保留旧键，诊断可重试", async () => {
        const session = sessionStub();
        const legacy = legacyStub({reading: {kind: "unavailable", diagnosis: "存储被策略禁用"}});

        const result = await migrate({session, handle: handleStub(async () => readValue({})), legacy: legacy.store});

        expect(result).toMatchObject({kind: "notice", retryable: true});
        expect(result.kind === "notice" ? result.diagnosis : "").toContain("存储被策略禁用");
        expect(legacy.calls.removed).toBe(0);
        expect(session.commits).toEqual([]);
    });

    it("旧值不可解析：保留旧键，且不给「重试」（旧值本身不可迁移）", async () => {
        const session = sessionStub();
        const legacy = legacyStub({reading: {kind: "value", raw: "{not json"}});

        const result = await migrate({session, handle: handleStub(async () => readValue({})), legacy: legacy.store});

        expect(result).toMatchObject({kind: "notice", retryable: false});
        expect(legacy.calls.removed).toBe(0);
    });

    it("记录不可写：保留旧键，诊断可重试", async () => {
        const session = sessionStub({writable: false, blocked: "corrupt"});
        const legacy = legacyStub();

        const result = await migrate({session, handle: handleStub(async () => readValue({})), legacy: legacy.store});

        expect(result).toMatchObject({kind: "notice", retryable: true});
        expect(legacy.calls.removed).toBe(0);
        expect(session.commits).toEqual([]);
    });

    it("用户意图还在飞（pending）：本轮不碰旧键，交给调用方保留上一次诊断", async () => {
        const session = sessionStub({pending: {value: {paths: ["lorebook/"]}, diagnosis: "写入结果未确认", retryable: true}});
        const legacy = legacyStub();

        const result = await migrate({session, handle: handleStub(async () => readValue({})), legacy: legacy.store});

        expect(result).toEqual({kind: "deferred"});
        expect(legacy.calls.removed).toBe(0);
        expect(session.commits).toEqual([]);
    });

    it("记录已是权威：不写记录、只做一次性收尾；删除失败则保留旧键", async () => {
        const session = sessionStub({hasConfirmed: true, confirmed: {paths: ["world-engine/"]}});
        const ok = legacyStub();
        const failing = legacyStub({removeFails: true});

        const settled = await migrate({session, handle: handleStub(async () => readValue({})), legacy: ok.store});
        expect(settled).toEqual({kind: "settled"});
        expect(session.commits).toEqual([]);
        expect(ok.calls.removed).toBe(1);

        const notice = await migrate({session, handle: handleStub(async () => readValue({})), legacy: failing.store});
        expect(notice).toMatchObject({kind: "notice", retryable: true});
        expect(notice.kind === "notice" ? notice.diagnosis : "").toContain("删除失败");
    });

    it("空旧值：没有可迁移的信息，同样只做收尾删除", async () => {
        const session = sessionStub();
        const legacy = legacyStub({reading: {kind: "value", raw: "[]"}});

        const result = await migrate({session, handle: handleStub(async () => readValue({})), legacy: legacy.store});

        expect(result).toEqual({kind: "settled"});
        expect(session.commits).toEqual([]);
        expect(legacy.calls.removed).toBe(1);
    });

    it("迁移未确认（commit 失败）：保留旧键，诊断可重试，且不做回读", async () => {
        const session = sessionStub();
        session.setCommitResult({status: "unsaved", diagnosis: "写入结果未确认"});
        const legacy = legacyStub();
        const read = vi.fn(async () => readValue({paths: ["manuscript/"]}));

        const result = await migrate({session, handle: handleStub(read), legacy: legacy.store});

        expect(result).toMatchObject({kind: "notice", retryable: true});
        expect(result.kind === "notice" ? result.diagnosis : "").toContain("迁移未确认");
        expect(legacy.calls.removed).toBe(0);
        expect(session.commits).toEqual([{paths: ["manuscript/"]}]);
        expect(read).not.toHaveBeenCalled();
    });

    it("回读抛错：保留旧键，诊断可重试", async () => {
        const session = sessionStub();
        const legacy = legacyStub();

        const result = await migrate({
            session,
            handle: handleStub(async () => {
                throw new Error("回读失败（注入）");
            }),
            legacy: legacy.store,
        });

        expect(result).toMatchObject({kind: "notice", retryable: true});
        expect(result.kind === "notice" ? result.diagnosis : "").toContain("回读失败（注入）");
        expect(legacy.calls.removed).toBe(0);
    });

    it("回读不一致：保留旧键，诊断可重试", async () => {
        const session = sessionStub();
        const legacy = legacyStub();

        const result = await migrate({
            session,
            handle: handleStub(async () => readValue({paths: ["elsewhere/"]})),
            legacy: legacy.store,
        });

        expect(result).toMatchObject({kind: "notice", retryable: true});
        expect(result.kind === "notice" ? result.diagnosis : "").toContain("回读与写入不一致");
        expect(legacy.calls.removed).toBe(0);
    });

    it("回读一致：删除旧键后才报已结算；删除失败仍保留旧键", async () => {
        const session = sessionStub();
        const ok = legacyStub();
        const failing = legacyStub({removeFails: true});
        const read = async () => readValue({paths: ["manuscript/"]});

        expect(await migrate({session, handle: handleStub(read), legacy: ok.store})).toEqual({kind: "settled"});
        expect(ok.calls.removed).toBe(1);

        const notice = await migrate({session, handle: handleStub(read), legacy: failing.store});
        expect(notice).toMatchObject({kind: "notice", retryable: true});
    });
});

describe("createBrowserLegacyValueStore", () => {
    it("没有可用存储（SSR）：读作不存在，删除一律失败（不假装迁完）", () => {
        const store = createBrowserLegacyValueStore("nbook.test.key", () => null);

        expect(store.read()).toEqual({kind: "absent"});
        expect(store.remove()).toBe(false);
    });

    it("访问存储本身抛错（隐私模式/被策略禁用）：读作 unavailable，删除失败", () => {
        const store = createBrowserLegacyValueStore("nbook.test.key", () => {
            throw new Error("存储被策略禁用");
        });

        expect(store.read()).toMatchObject({kind: "unavailable", diagnosis: "存储被策略禁用"});
        expect(store.remove()).toBe(false);
    });

    it("有存储：读到原值、删除后确认不存在", () => {
        const values = new Map<string, string>([["nbook.test.key", "[\"manuscript/\"]"]]);
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            removeItem: (key: string) => {
                values.delete(key);
            },
        };
        const store = createBrowserLegacyValueStore("nbook.test.key", () => storage);

        expect(store.read()).toEqual({kind: "value", raw: "[\"manuscript/\"]"});
        expect(store.remove()).toBe(true);
        expect(store.read()).toEqual({kind: "absent"});
    });

    it("删除没有生效（存储拒绝）：remove 返回 false，调用方据此保留旧键", () => {
        const storage = {
            getItem: () => "[\"manuscript/\"]",
            removeItem: () => undefined,
        };
        const store = createBrowserLegacyValueStore("nbook.test.key", () => storage);

        expect(store.remove()).toBe(false);
    });
});
