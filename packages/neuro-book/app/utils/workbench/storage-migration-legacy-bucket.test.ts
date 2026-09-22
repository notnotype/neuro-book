import {afterEach, describe, expect, it} from "vitest";
import {
    LEGACY_BUCKET_KEY,
    LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES,
    createIndexedDbLegacyBucketStaging,
    installLegacyBucketWriterPolicy,
    legacyBucketSerializer,
    legacyBucketStorage,
    legacyBucketWriterPolicy,
    measureLegacyOriginal,
    readLegacyBucketFieldValues,
    splitLegacyOriginalChunks,
    type LegacyBucketStorage,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

type FakeSeed = {
    stored?: unknown;
    openFailure?: "throw" | "error" | "blocked";
    transactionFailure?: "throw";
    putFailure?: boolean;
    /** 第二次读取（回读核验）时截断已存原文：模拟写入成功但回读不一致。 */
    truncateOnSecondGet?: boolean;
};

type FakeHandler = (() => void) | null;

type FakeRequest = {result: unknown; error: unknown; onsuccess: FakeHandler; onerror: FakeHandler};

type FakeTransaction = {
    error: unknown;
    oncomplete: FakeHandler;
    onerror: FakeHandler;
    onabort: FakeHandler;
    objectStore: (name: string) => {
        get: (key: string) => FakeRequest;
        put: (value: unknown, key: string) => FakeRequest;
    };
};

type FakeState = {
    stored: unknown;
    putCount: number;
    getCount: number;
    readonly seed: FakeSeed;
};

function createFakeIndexedDb(seed: FakeSeed = {}): {readonly indexedDB: IDBFactory; readonly state: FakeState} {
    const state: FakeState = {stored: seed.stored, putCount: 0, getCount: 0, seed};
    const createRequest = (): FakeRequest => ({result: undefined, error: null, onsuccess: null, onerror: null});
    const createTransaction = (): FakeTransaction => {
        if (seed.transactionFailure === "throw") throw new Error("fake transaction denied");
        let aborted = false;
        let abortedError: unknown = null;
        const transaction: FakeTransaction = {
            error: null,
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: () => ({
                get(key: string): FakeRequest {
                    state.getCount += 1;
                    const request = createRequest();
                    queueMicrotask(() => {
                        if (seed.truncateOnSecondGet === true && state.getCount > 1 && typeof state.stored === "object" && state.stored !== null) {
                            const record = (state.stored as Record<string, {raw?: unknown}>)[key];
                            if (record !== undefined && typeof record.raw === "string") {
                                record.raw = record.raw.slice(0, 4);
                            }
                        }
                        const source = state.stored;
                        request.result = source === undefined || source === null
                            ? undefined
                            : typeof source === "object" && source !== null
                                ? (source as Record<string, unknown>)[key]
                                : undefined;
                        request.onsuccess?.();
                        queueMicrotask(() => {
                            if (aborted) transaction.onabort?.();
                            else transaction.oncomplete?.();
                        });
                    });
                    return request;
                },
                put(value: unknown, key: string): FakeRequest {
                    state.putCount += 1;
                    const request = createRequest();
                    if (seed.putFailure === true) {
                        throw new Error("fake put denied");
                    }
                    queueMicrotask(() => {
                        state.stored = {[key]: value};
                        request.onsuccess?.();
                        queueMicrotask(() => {
                            if (aborted) transaction.onabort?.();
                            else transaction.oncomplete?.();
                        });
                    });
                    return request;
                },
            }),
        };
        const originalAbort = (): void => {
            aborted = true;
            abortedError = new Error("fake transaction aborted");
            transaction.error = abortedError;
        };
        // 被测代码只调用 transaction.abort()；这里把它记下来，由事务驱动回调阶段报告。
        (transaction as {abort?: () => void}).abort = originalAbort;
        return transaction;
    };
    const factory = {
        open(): IDBOpenDBRequest {
            if (seed.openFailure === "throw") throw new Error("fake open denied");
            const request = {
                result: undefined as unknown,
                error: null as unknown,
                onupgradeneeded: null as FakeHandler,
                onsuccess: null as FakeHandler,
                onerror: null as FakeHandler,
                onblocked: null as FakeHandler,
            };
            const connection = {
                closed: false,
                onversionchange: null as (() => void) | null,
                objectStoreNames: {contains: () => true},
                createObjectStore: () => undefined,
                close(): void {
                    connection.closed = true;
                },
                transaction: () => createTransaction(),
            };
            request.result = connection;
            queueMicrotask(() => {
                if (seed.openFailure === "blocked") {
                    request.onblocked?.();
                    return;
                }
                if (seed.openFailure === "error") {
                    request.error = new Error("fake open failed");
                    request.onerror?.();
                    return;
                }
                request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request as unknown as IDBOpenDBRequest;
        },
    };
    return {indexedDB: factory as unknown as IDBFactory, state};
}

function storageWith(raw: string | null): LegacyBucketStorage & {readonly writes: string[]} {
    const writes: string[] = [];
    return {
        writes,
        getItem: (key) => (key === LEGACY_BUCKET_KEY ? raw : null),
        setItem: (key, value) => {
            writes.push(`${key}=${value}`);
        },
    };
}

const BUCKET = JSON.stringify({
    leftPanelWidth: 427,
    agentPanelWidth: 488,
    projectPickerLayoutMode: "compact",
    activeLeftTab: "outline",
});

afterEach(() => {
    installLegacyBucketWriterPolicy({mode: "inactive"});
});

describe("旧桶原件暂存", () => {
    it("首次暂存固化完整原件并回读核验", async () => {
        const fake = createFakeIndexedDb();
        const reads: string[] = [];
        const staging = createIndexedDbLegacyBucketStaging({
            indexedDB: fake.indexedDB,
            readBucket: () => {
                reads.push(BUCKET);
                return BUCKET;
            },
            now: () => "2026-09-16T00:00:00.000Z",
        });

        const result = await staging.ensure();

        expect(result.status).toBe("original");
        if (result.status !== "original" || result.original === null) throw new Error("暂存未返回原件");
        expect(result.original.raw).toBe(BUCKET);
        expect(result.original.capturedAt).toBe("2026-09-16T00:00:00.000Z");
        expect(result.original.digest).toBe(measureLegacyOriginal(BUCKET).digest);
        expect(result.original.byteLength).toBe(measureLegacyOriginal(BUCKET).byteLength);
        expect(reads).toHaveLength(1);
        expect(fake.state.putCount).toBe(1);
    });

    it("已有原件时不再读旧桶、不覆盖", async () => {
        const first = createFakeIndexedDb();
        const staging = createIndexedDbLegacyBucketStaging({indexedDB: first.indexedDB, readBucket: () => BUCKET});
        const created = await staging.ensure();
        if (created.status !== "original" || created.original === null) throw new Error("首次暂存失败");

        // 第二个标签页：旧桶在这期间已被旧 writer 改写，但暂存里的原件不能被后续旧桶覆盖。
        const secondRead = JSON.stringify({leftPanelWidth: 111});
        const second = createIndexedDbLegacyBucketStaging({
            indexedDB: first.indexedDB,
            readBucket: () => secondRead,
        });
        const reused = await second.ensure();

        expect(reused.status).toBe("original");
        if (reused.status !== "original" || reused.original === null) throw new Error("复用暂存失败");
        expect(reused.original.raw).toBe(BUCKET);
        expect(first.state.putCount).toBe(1);
    });

    it("旧桶不存在或为空时不制造原件记录", async () => {
        for (const raw of [null, ""]) {
            const fake = createFakeIndexedDb();
            const staging = createIndexedDbLegacyBucketStaging({indexedDB: fake.indexedDB, readBucket: () => raw});
            const result = await staging.ensure();
            expect(result).toEqual({status: "original", original: null});
            expect(fake.state.putCount).toBe(0);
        }
    });

    it("超过 8 MiB 上限按 oversize 拒绝", async () => {
        const fake = createFakeIndexedDb();
        const oversize = `{"filler":"${"x".repeat(LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES)}"}`;
        const staging = createIndexedDbLegacyBucketStaging({indexedDB: fake.indexedDB, readBucket: () => oversize});

        const result = await staging.ensure();

        expect(result).toMatchObject({status: "failed", reason: "oversize"});
        expect(fake.state.putCount).toBe(0);
    });

    it("回读核验失败时报告 readback-mismatch 而不是成功", async () => {
        const fake = createFakeIndexedDb({truncateOnSecondGet: true});
        const staging = createIndexedDbLegacyBucketStaging({indexedDB: fake.indexedDB, readBucket: () => BUCKET});

        const result = await staging.ensure();

        expect(result).toMatchObject({status: "failed", reason: "readback-mismatch"});
    });

    it("宿主没有 IndexedDB 或数据库被阻塞时给出可区分的失败分类", async () => {
        const unavailable = createIndexedDbLegacyBucketStaging({indexedDB: null, readBucket: () => BUCKET});
        expect(await unavailable.ensure()).toMatchObject({status: "failed", reason: "unavailable"});

        const blocked = createIndexedDbLegacyBucketStaging({
            indexedDB: createFakeIndexedDb({openFailure: "blocked"}).indexedDB,
            readBucket: () => BUCKET,
        });
        expect(await blocked.ensure()).toMatchObject({status: "failed", reason: "blocked"});

        const denied = createIndexedDbLegacyBucketStaging({
            indexedDB: createFakeIndexedDb({transactionFailure: "throw"}).indexedDB,
            readBucket: () => BUCKET,
        });
        expect(await denied.ensure()).toMatchObject({status: "failed", reason: "read-failed"});
    });

    it("写入被拒绝时报告 write-failed 并保留旧桶", async () => {
        const fake = createFakeIndexedDb({putFailure: true});
        const staging = createIndexedDbLegacyBucketStaging({indexedDB: fake.indexedDB, readBucket: () => BUCKET});

        expect(await staging.ensure()).toMatchObject({status: "failed", reason: "write-failed"});
        expect(fake.state.stored).toBeUndefined();
    });

    it("暂存属于其它迁移版本时按 conflict 报告，不覆盖也不复用", async () => {
        const fake = createFakeIndexedDb({
            stored: {"legacy-original": {
                source: "novel.ide.local",
                version: 99,
                capturedAt: "2026-01-01T00:00:00.000Z",
                byteLength: measureLegacyOriginal("{}").byteLength,
                digest: measureLegacyOriginal("{}").digest,
                raw: "{}",
            }},
        });
        const staging = createIndexedDbLegacyBucketStaging({indexedDB: fake.indexedDB, readBucket: () => BUCKET});

        expect(await staging.ensure()).toMatchObject({status: "failed", reason: "conflict"});
        expect(fake.state.putCount).toBe(0);
    });
});

describe("迁移期写回门禁", () => {
    it("固定三个源字段为捕获值，原本缺失的保持缺失", () => {
        installLegacyBucketWriterPolicy({
            mode: "pinned",
            fields: {leftPanelWidth: 427, projectPickerLayoutMode: "compact"},
        });

        const raw = legacyBucketSerializer.serialize({
            leftPanelWidth: 999,
            agentPanelWidth: 488,
            projectPickerLayoutMode: "editorial",
            agentSessionPanelWidth: 300,
        });

        expect(JSON.parse(raw)).toEqual({
            agentSessionPanelWidth: 300,
            leftPanelWidth: 427,
            projectPickerLayoutMode: "compact",
        });
        expect(raw).not.toContain("agentPanelWidth");
    });

    it("退役的 activeLeftTab 按原件保留：读到什么就原样合成什么，原件没有就不制造", () => {
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});

        // 原件里有这个键（值不在运行期词表里也照样保留）。
        legacyBucketSerializer.deserialize(JSON.stringify({activeLeftTab: "rag", agentSessionPanelWidth: 300}));
        expect(JSON.parse(legacyBucketSerializer.serialize({agentSessionPanelWidth: 300}))).toEqual({
            activeLeftTab: "rag",
            agentSessionPanelWidth: 300,
            leftPanelWidth: 427,
        });

        // 原件里没有这个键：整键重写也不会多出一个缺省值。
        legacyBucketSerializer.deserialize(JSON.stringify({agentSessionPanelWidth: 300}));
        expect(JSON.parse(legacyBucketSerializer.serialize({agentSessionPanelWidth: 300}))).toEqual({
            agentSessionPanelWidth: 300,
            leftPanelWidth: 427,
        });
        legacyBucketSerializer.deserialize("{}");
    });

    it("水合结果里不再带退役字段：它只被序列化器留在桶里", () => {
        expect(legacyBucketSerializer.deserialize(JSON.stringify({activeLeftTab: "outline", agentSessionPanelWidth: 300})))
            .toEqual({agentSessionPanelWidth: 300});
        legacyBucketSerializer.deserialize("{}");
    });

    it("未安装门禁时保持旧 writer 原行为", () => {
        expect(legacyBucketWriterPolicy()).toEqual({mode: "inactive"});
        const raw = legacyBucketSerializer.serialize({leftPanelWidth: 999, agentSessionPanelWidth: 300});
        expect(JSON.parse(raw)).toEqual({leftPanelWidth: 999, agentSessionPanelWidth: 300});
    });

    it("整桶冻结时拒绝写回但继续可读", () => {
        const storage = storageWith("original");
        installLegacyBucketWriterPolicy({mode: "locked", reason: "暂存失败"});
        const gated = legacyBucketStorage({storage});

        expect(() => gated.setItem(LEGACY_BUCKET_KEY, "{}")).toThrow(/已冻结/u);
        expect(gated.getItem(LEGACY_BUCKET_KEY)).toBe("original");
        expect(storage.writes).toHaveLength(0);
    });

    it("核验成功后未迁字段与三字段一起写回", () => {
        const storage = storageWith("original");
        installLegacyBucketWriterPolicy({mode: "pinned", fields: {leftPanelWidth: 427}});
        const gated = legacyBucketStorage({storage});

        gated.setItem(LEGACY_BUCKET_KEY, "written");

        expect(storage.writes).toEqual([`${LEGACY_BUCKET_KEY}=written`]);
    });
});

describe("原件度量与分块", () => {
    it("分块拼回后与原文逐字符相同，且每块不超过字节预算", () => {
        const raw = JSON.stringify({text: "面板宽度 with emoji 😀 和中文".repeat(2000)});
        const chunks = splitLegacyOriginalChunks(raw, 1024);

        expect(chunks.join("")).toBe(raw);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(measureLegacyOriginal(chunk).byteLength).toBeLessThanOrEqual(1024);
        }
    });

    it("8 MiB 原件按 384 KiB 预算分块后在条数与单条上限内", () => {
        const raw = "x".repeat(LEGACY_BUCKET_ORIGINAL_LIMIT_BYTES);
        const chunks = splitLegacyOriginalChunks(raw);

        expect(chunks.join("")).toBe(raw);
        expect(chunks.length).toBeLessThanOrEqual(64);
        // 单条序列化后仍在 1 MiB 硬上限内：块原文预算 384 KiB，最坏逐字符转义也不会翻倍到 1 MiB。
        for (const chunk of chunks) {
            expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(1024 * 1024);
        }
    });

    it("损坏或非对象 JSON 一律按三字段都缺失处理", () => {
        expect(readLegacyBucketFieldValues("{not json")).toEqual({});
        expect(readLegacyBucketFieldValues("[1,2]")).toEqual({});
        expect(readLegacyBucketFieldValues(null)).toEqual({});
        expect(readLegacyBucketFieldValues(JSON.stringify({activeLeftTab: "outline"}))).toEqual({});
        expect(readLegacyBucketFieldValues(JSON.stringify({leftPanelWidth: null})))
            .toEqual({leftPanelWidth: null});
    });
});
