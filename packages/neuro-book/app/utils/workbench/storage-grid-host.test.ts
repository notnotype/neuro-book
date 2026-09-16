import {describe, expect, it, vi} from "vitest";
import {
    createGrid,
    type Grid,
    type GridExtent,
    type GridLeafInput,
    type GridNode,
    type GridRefResolver,
    type GridSnapshotNode,
} from "@notnotype/nb-ui/components";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageProjectContextTarget} from "nbook/app/utils/storage/host-context-client";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageContext,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import {
    composeGridLayoutRecord,
    createGridLayoutHost,
    defineGridLayoutState,
    type GridLayoutHost,
    type GridLayoutRecord,
} from "nbook/app/utils/workbench/storage-grid-host";

const OWNER = "nbook.grid-test";
const RESOURCE = "main";
const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);

const definition = defineGridLayoutState({
    owner: OWNER,
    key: "layout",
    scope: "user",
    records: "identified",
    defaultLayout: createTestGrid().serialize(),
});

/** 插件样例拓扑：三个已知叶；记录里还可能带一个由外部插件提供的叶（默认不可解析）。 */
function leaf(id: string, width: number, minimumSize: number, maximumSize: number): GridLeafInput<string> {
    return {
        kind: "leaf",
        id,
        ref: id,
        size: {width, height: 800},
        minimumSize: {width: minimumSize, height: 0},
        maximumSize: {width: maximumSize, height: 800},
    };
}

function createTestGrid(): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        size: {width: 0, height: 800},
        children: [
            leaf("outline", 240, 100, 400),
            leaf("editor", 660, 200, 2000),
            leaf("console", 300, 100, 600),
        ],
    }, {sashSize: 0});
}

/** `pluginLoaded` 为 false 时 `plugin` 叶不可解析：模拟插件暂时缺席。 */
function resolver(pluginLoaded = false): GridRefResolver<string> {
    const known: Record<string, true> = {outline: true, editor: true, console: true, plugin: true};
    return (ref) => (known[ref] === true && (ref !== "plugin" || pluginLoaded) ? {ref} : null);
}

/** 读取时保留的原始记录：含未知顶层字段与一个当前不可解析的引用。 */
function recordFixture(outlineWidth = 240): GridLayoutRecord {
    return {
        version: 2,
        note: "unknown-field",
        root: {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            children: [
                {kind: "leaf", id: "outline", ref: "outline", size: {width: outlineWidth, height: 0}},
                {kind: "leaf", id: "plugin", ref: "plugin", size: {width: 180, height: 0}},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 660, height: 0}},
                {kind: "leaf", id: "console", ref: "console", size: {width: 300, height: 0}},
            ],
        },
    } as unknown as GridLayoutRecord;
}

function credential(revision: string | null): StorageCredential {
    return {revision, partitionGeneration: 1};
}

function valueSnapshot(record: GridLayoutRecord, revision: string): StorageReadResult<GridLayoutRecord> {
    return {kind: "value", value: record, schemaVersion: 2, credential: credential(revision)};
}

type StoredRecord = {value: unknown; revision: string; schemaVersion: number};

type StorageHarness = {
    readonly records: Map<string, StoredRecord>;
    readonly fixedReads: Map<string, StorageReadResult<unknown>>;
    readonly sent: string[];
    readonly hook: {beforeSave: ((action: Extract<StorageActionRequest, {kind: "save"}>) => void) | null};
    readonly adapters: WorkbenchStorageAdapters;
    userKey(resource: string): string;
    write(resource: string, value: unknown): void;
};

/** 内存记录存储 + 真实 owner adapter 的注入传输；save 用 revision 做条件写。 */
function storageHarness(override: {readonly transport?: StorageValueTransport} = {}): StorageHarness {
    const records = new Map<string, StoredRecord>();
    const fixedReads = new Map<string, StorageReadResult<unknown>>();
    const sent: string[] = [];
    const hook: StorageHarness["hook"] = {beforeSave: null};
    let sequence = 0;
    const keyOf = (scope: string, address: {owner: string; key: string; resource?: string}): string =>
        `${scope}/${address.owner}/${address.key}/${address.resource ?? ""}`;
    const userKey = (resource: string): string => `user/${OWNER}/layout/${resource}`;

    const write = (resource: string, value: unknown): void => {
        records.set(userKey(resource), {value, revision: `revision-${++sequence}`, schemaVersion: 2});
    };

    const transportFor = (scope: "user" | "project"): StorageValueTransport => ({
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            sent.push(action.kind);
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            if (action.kind === "read") {
                const key = keyOf(scope, action);
                const fixed = fixedReads.get(key);
                if (fixed !== undefined) {
                    return {kind: "read", result: fixed};
                }
                const record = records.get(key);
                if (record === undefined) {
                    return {kind: "read", result: {kind: "missing", credential: credential(null)}};
                }
                if (record.schemaVersion < action.schemaVersion) {
                    return {kind: "read", result: {kind: "legacy-value", value: record.value, schemaVersion: record.schemaVersion, credential: credential(record.revision)}};
                }
                if (record.schemaVersion > action.schemaVersion) {
                    return {
                        kind: "read",
                        result: {
                            kind: "unsupported-version",
                            wrapperVersion: null,
                            schemaVersion: record.schemaVersion,
                            diagnosis: "记录版本高于当前支持版本",
                            repair: {partitionGeneration: 1, contentFingerprint: "seed-fingerprint"},
                        },
                    };
                }
                return {kind: "read", result: valueSnapshot(record.value as GridLayoutRecord, record.revision)};
            }
            if (action.kind === "save") {
                hook.beforeSave?.(action);
                const key = keyOf(scope, action);
                const record = records.get(key);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw new StorageAdapterError({
                        code: "STORAGE_REVISION_CONFLICT",
                        status: 409,
                        message: "记录已被其它窗口改写",
                        committed: false,
                    });
                }
                const revision = `revision-${++sequence}`;
                records.set(key, {value: action.value, revision, schemaVersion: action.schemaVersion});
                return {kind: "save", credential: credential(revision)};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    });

    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({
            status: "ready",
            session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
        }),
        openProjectContext: async (target: StorageProjectContextTarget) => ({
            status: "ready",
            session: {
                scope: "project",
                contextId: "project".padEnd(64, "p"),
                clientCredential: CLIENT_CREDENTIAL,
                projectRoot: target.projectRoot,
                publicId: target.publicId,
            },
        }),
        // 订阅只靠同一句柄内的 notify 触发；轮询间隔放在测试时长之外，避免跨句柄的不确定刷新。
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport: override.transport ?? transportFor(options.session.scope),
            subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
        }),
        closeContext: async () => undefined,
    };

    return {records, fixedReads, sent, hook, adapters, userKey, write};
}

async function userHandle(workbench: WorkbenchStorageContext): Promise<WorkbenchStorageOwnerHandle> {
    const result = await workbench.userOwner(OWNER);
    if (result.status !== "ready") {
        throw new Error(result.diagnosis);
    }
    return result.handle;
}

function createHost(
    handle: WorkbenchStorageOwnerHandle,
    overrides: {readonly resource?: string; readonly pluginLoaded?: boolean; readonly grid?: Grid<string>} = {},
): GridLayoutHost<string> {
    return createGridLayoutHost({
        grid: overrides.grid ?? createTestGrid(),
        handle,
        definition,
        resource: overrides.resource ?? RESOURCE,
        resolveRef: resolver(overrides.pluginLoaded ?? false),
    });
}

function findNode(node: GridNode<string> | null, id: string): GridNode<string> | null {
    if (node === null) {
        return null;
    }
    if (node.id === id) {
        return node;
    }
    if (node.kind === "leaf") {
        return null;
    }
    for (const child of node.children) {
        const hit = findNode(child, id);
        if (hit !== null) {
            return hit;
        }
    }
    return null;
}

function sizeOf(host: GridLayoutHost<string>, id: string): GridExtent {
    const node = findNode(host.grid.root(), id);
    if (node === null) {
        throw new Error(`测试树里没有节点：${id}`);
    }
    return node.size;
}

function widthsOf(record: unknown): Array<[string, number]> {
    const root = (record as {root: {children: GridSnapshotNode[]}}).root;
    return root.children.map((child) => [child.id, child.kind === "leaf" ? child.size.width : 0]);
}

function idsOf(node: GridNode<string> | null): string[] {
    if (node === null) {
        return [];
    }
    return node.kind === "leaf" ? [node.id] : [node.id, ...node.children.flatMap(idsOf)];
}

function saves(sent: readonly string[]): number {
    return sent.filter((kind) => kind === "save").length;
}

type TransportScript = {
    /** 读取结果；缺省返回插件样例记录（outline 240）。 */
    readonly onRead?: (resource: string | undefined) => StorageReadResult<unknown>;
    /** 提交：抛错表示失败；缺省成功并返回一个新 revision。 */
    readonly onSave?: (value: GridLayoutRecord) => Promise<StorageCredential>;
    /** 记录每次真正到达传输的提交值，供断言"只提交一次"或"不再补写"。 */
    readonly attempts?: GridLayoutRecord[];
};

/** 脚本化传输：句柄、订阅与失效语义仍由真实 owner adapter 提供。 */
function scriptedTransport(script: TransportScript = {}): StorageValueTransport {
    return {
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            if (action.kind === "read") {
                return {kind: "read", result: script.onRead?.(action.resource) ?? valueSnapshot(recordFixture(), "seed-1")};
            }
            if (action.kind === "save") {
                const value = action.value as GridLayoutRecord;
                script.attempts?.push(value);
                const next = script.onSave === undefined ? credential("revision-1") : await script.onSave(value);
                return {kind: "save", credential: next};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    };
}

async function openedHost(harness: StorageHarness, resource = RESOURCE): Promise<{host: GridLayoutHost<string>; workbench: WorkbenchStorageContext}> {
    harness.records.set(harness.userKey(resource), {value: recordFixture(), revision: "seed-1", schemaVersion: 2});
    const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
    const host = createHost(await userHandle(workbench), {resource});
    await host.open();
    host.setContainer({width: 1200, height: 800});
    return {host, workbench};
}

/** 假计时器下把同一句柄 notify 触发的立即重读跑完，避免真实等待。 */
async function flushSubscription(): Promise<void> {
    for (let tick = 0; tick < 4; tick += 1) {
        await vi.advanceTimersByTimeAsync(0);
    }
}

describe("插件 grid 持久化宿主", () => {
    it("value 记录经原语一次发布：未知引用只过滤呈现，读取不写盘", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);

        expect(host.state.phase).toBe("ready");
        expect(host.state.projection?.status).toBe("confirmed");
        expect(host.state.writable).toBe(true);
        expect(host.state.credential).toEqual(credential("seed-1"));
        expect(idsOf(host.grid.root())).toEqual(["root", "outline", "editor", "console"]);
        expect(findNode(host.grid.root(), "plugin")).toBeNull();
        expect(sizeOf(host, "outline").width).toBe(240);
        expect(harness.sent).not.toContain("save");
        expect(host.state.issues.some((issue) => issue.kind === "dropped-ref")).toBe(true);

        await workbench.release();
    });

    it("missing 记录保持产品默认布局、不落盘，首存使用缺失凭据", async () => {
        const harness = storageHarness();
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createHost(await userHandle(workbench));
        await host.open();

        expect(host.state.projection?.status).toBe("default");
        expect(host.state.writable).toBe(true);
        expect(host.state.credential).toEqual(credential(null));
        expect(idsOf(host.grid.root())).toEqual(["root", "outline", "editor", "console"]);
        expect(harness.records.size).toBe(0);

        host.setContainer({width: 1200, height: 800});
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const saved = await host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});

        expect(saved.status).toBe("saved");
        expect(widthsOf(harness.records.get(harness.userKey(RESOURCE))?.value)).toEqual([
            ["outline", 360],
            ["editor", 540],
            ["console", 300],
        ]);
        await workbench.release();
    });

    it("legacy/不支持版本/损坏/结构非法分别诊断，禁止普通保存且不抛异常", async () => {
        const duplicates: GridLayoutRecord = {
            version: 2,
            root: {
                kind: "branch",
                id: "root",
                orientation: "horizontal",
                size: {width: 0, height: 0},
                children: [
                    {kind: "leaf", id: "outline", ref: "outline", size: {width: 240, height: 0}},
                    {kind: "leaf", id: "outline", ref: "editor", size: {width: 660, height: 0}},
                ],
            },
        };
        const cases = [
            {name: "legacy", seed: {value: {version: 1, root: {}}, revision: "legacy-1", schemaVersion: 1}, blocked: "legacy-value"},
            {name: "unsupported", seed: {value: {version: 3, root: {}}, revision: "future-1", schemaVersion: 3}, blocked: "unsupported-version"},
            {
                name: "corrupt",
                fixed: {kind: "corrupt", diagnosis: "值记录缺少合法 schemaVersion", repair: {partitionGeneration: 1, contentFingerprint: "x"}},
                blocked: "corrupt",
            },
            {name: "invalid", seed: {value: duplicates, revision: "dup-1", schemaVersion: 2}, blocked: "invalid-record"},
        ] as const;

        for (const testCase of cases) {
            const harness = storageHarness();
            if ("seed" in testCase) {
                harness.records.set(harness.userKey(RESOURCE), {...testCase.seed});
            }
            if ("fixed" in testCase) {
                harness.fixedReads.set(harness.userKey(RESOURCE), testCase.fixed);
            }
            const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
            const host = createHost(await userHandle(workbench));
            await host.open();

            expect(host.state.writable, testCase.name).toBe(false);
            expect(host.state.blocked, testCase.name).toBe(testCase.blocked);
            expect(host.state.credential, testCase.name).toBeNull();
            // 可用状态：呈现回落到产品默认布局，而不是半棵树。
            expect(idsOf(host.grid.root()), testCase.name).toEqual(["root", "outline", "editor", "console"]);
            expect(sizeOf(host, "outline").width, testCase.name).toBe(240);

            host.setContainer({width: 1200, height: 800});
            expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]}), testCase.name).toEqual({ok: true});
            const outcome = await host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});

            expect(outcome.status, testCase.name).toBe("unsaved");
            expect(host.state.pending?.retryable, testCase.name).toBe(false);
            expect(saves(harness.sent), testCase.name).toBe(0);
            expect(harness.records.get(harness.userKey(RESOURCE))?.revision, testCase.name).toBe(
                "seed" in testCase ? testCase.seed.revision : undefined,
            );
            await workbench.release();
        }
    });

    it("原件合成保留未知字段与未知引用，只写入真正变化的字段", () => {
        const base = recordFixture();
        const composed = composeGridLayoutRecord(base, [
            {id: "outline", axis: "width", value: 360},
            {id: "ghost", axis: "width", value: 50},
            {id: "editor", axis: "width", value: Number.NaN},
            {id: "console", axis: "width", value: 300},
        ]);

        expect(composed.applied).toEqual([{id: "outline", axis: "width", value: 360}]);
        expect(composed.skipped).toEqual([
            {field: {id: "ghost", axis: "width", value: 50}, reason: "unknown-node"},
            {field: {id: "editor", axis: "width", value: Number.NaN}, reason: "invalid-value"},
        ]);
        expect(composed.value.note).toBe("unknown-field");
        // 未知引用节点留在原件位置，已知兄弟被改写。
        expect(widthsOf(composed.value)).toEqual([
            ["outline", 360],
            ["plugin", 180],
            ["editor", 660],
            ["console", 300],
        ]);
        expect(widthsOf(base)).toEqual([
            ["outline", 240],
            ["plugin", 180],
            ["editor", 660],
            ["console", 300],
        ]);
    });

    it("一次手势只提交一次且只写 active 字段；程序布局、取消与 no-op 不保存", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);
        host.setContainer({width: 1200, height: 800});
        expect(host.layout()).not.toBeNull();
        expect(saves(harness.sent)).toBe(0);

        // 取消：不产生保存意图。
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        host.gestureCancel();
        expect(host.state.gesture).toBe(false);
        expect(saves(harness.sent)).toBe(0);
        expect((await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]})).status).toBe("rejected");

        // no-op 手势：目标与基线一致，不写盘。
        expect(host.gestureStart({branchId: "root", sizes: [20, 55, 25]})).toEqual({ok: true});
        expect((await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [20, 55, 25]})).status).toBe("unchanged");
        expect(saves(harness.sent)).toBe(0);

        // 真实手势：只把 active 字段写进原件；未主动改变的节点保持原件值。
        expect(host.gestureStart({branchId: "root", sizes: [20, 55, 25]})).toEqual({ok: true});
        const saved = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});

        expect(saved).toMatchObject({status: "saved", fields: [{id: "outline", axis: "width", value: 360}]});
        expect(saves(harness.sent)).toBe(1);
        const stored = harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown};
        expect(stored.note).toBe("unknown-field");
        expect(widthsOf(stored)).toEqual([
            ["outline", 360],
            ["plugin", 180],
            ["editor", 660],
            ["console", 300],
        ]);
        // 当前呈现确实结算了补偿，但补偿不被当作主动偏好写盘。
        expect(sizeOf(host, "editor").width).toBe(540);
        await workbench.release();
    });

    it("订阅只更新已确认基线：不重挂呈现、不打断手势、刷新后的凭据可直接续写", async () => {
        vi.useFakeTimers();
        try {
            const harness = storageHarness();
            harness.records.set(harness.userKey(RESOURCE), {value: recordFixture(), revision: "seed-1", schemaVersion: 2});
            const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
            const handle = await userHandle(workbench);
            const hostA = createHost(handle);
            const hostB = createHost(handle);
            await hostA.open();
            await hostB.open();
            hostA.setContainer({width: 1200, height: 800});
            hostB.setContainer({width: 1200, height: 800});

            expect(hostB.gestureStart({branchId: "root", sizes: [32, 43, 25]})).toEqual({ok: true});
            expect(hostA.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
            const savedA = await hostA.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});
            expect(savedA.status).toBe("saved");
            const revisionA = savedA.status === "saved" ? savedA.credential.revision : null;

            await flushSubscription();

            expect(hostB.state.credential?.revision).toBe(revisionA);
            expect(hostB.state.gesture).toBe(true);
            expect(sizeOf(hostB, "outline").width).toBe(240);

            const savedB = await hostB.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [32, 43, 25]});

            expect(savedB.status).toBe("saved");
            expect(widthsOf(harness.records.get(harness.userKey(RESOURCE))?.value)).toEqual([
                ["outline", 384],
                ["plugin", 180],
                ["editor", 516],
                ["console", 300],
            ]);

            // 释放权各自持有：一个宿主释放后另一个继续提交，不互相牵连。
            await hostA.release();
            expect((await hostA.retry()).status).toBe("rejected");
            expect(hostB.gestureStart({branchId: "root", sizes: [32, 43, 25]})).toEqual({ok: true});
            expect((await hostB.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]})).status).toBe("saved");
            expect(widthsOf(harness.records.get(harness.userKey(RESOURCE))?.value)).toEqual([
                ["outline", 360],
                ["plugin", 180],
                ["editor", 540],
                ["console", 300],
            ]);
            await workbench.release();
        } finally {
            vi.useRealTimers();
        }
    });

    it("冲突后重读只重放本次主动字段，另一个窗口写过的字段不丢", async () => {
        const harness = storageHarness();
        harness.records.set(harness.userKey(RESOURCE), {value: recordFixture(), revision: "seed-1", schemaVersion: 2});
        const first = createWorkbenchStorageContext({adapters: harness.adapters});
        const second = createWorkbenchStorageContext({adapters: harness.adapters});
        const hostA = createHost(await userHandle(first));
        const hostB = createHost(await userHandle(second));
        await hostA.open();
        await hostB.open();
        hostA.setContainer({width: 1200, height: 800});
        hostB.setContainer({width: 1200, height: 800});

        // A 改编辑器与面板：outline 保持 240。
        expect(hostA.gestureStart({branchId: "root", sizes: [20, 50, 30]})).toEqual({ok: true});
        expect((await hostA.gestureEnd({branchId: "root", active: ["editor", "console"], sizes: [20, 50, 30]})).status).toBe("saved");

        // B 的基线仍是 seed-1：第一次提交冲突，重读后只重放它自己的主动字段。
        expect(hostB.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const savedB = await hostB.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});

        expect(savedB.status).toBe("saved");
        expect(hostB.state.pending).toBeNull();
        expect(saves(harness.sent)).toBe(3);
        expect(widthsOf(harness.records.get(harness.userKey(RESOURCE))?.value)).toEqual([
            ["outline", 360],
            ["plugin", 180],
            ["editor", 540],
            ["console", 360],
        ]);
        expect((harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown}).note).toBe("unknown-field");
        await first.release();
        await second.release();
    });

    it("二次冲突保留未确认意图并停止自动重试，显式重试可再提交一次", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);
        host.setContainer({width: 1200, height: 800});
        harness.write(RESOURCE, recordFixture());
        let attempts = 0;
        harness.hook.beforeSave = () => {
            attempts += 1;
            if (attempts === 2) {
                // 第二次提交前再插一次外部写入：模拟另一个窗口再次抢先。
                harness.write(RESOURCE, {...recordFixture(), note: "foreign"});
            }
        };

        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});

        expect(outcome.status).toBe("unsaved");
        expect(host.state.pending).toMatchObject({
            autoReplayed: true,
            retryable: true,
            fields: [{id: "outline", axis: "width", value: 360}, {id: "editor", axis: "width", value: 540}],
        });
        expect(saves(harness.sent)).toBe(2);
        expect((harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown}).note).toBe("foreign");
        expect(host.state.issues.some((issue) => issue.kind === "save")).toBe(true);

        const retried = await host.retry();

        expect(retried.status).toBe("saved");
        expect(host.state.pending).toBeNull();
        expect(widthsOf(harness.records.get(harness.userKey(RESOURCE))?.value)).toEqual([
            ["outline", 360],
            ["plugin", 180],
            ["editor", 540],
            ["console", 300],
        ]);
        expect((harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown}).note).toBe("foreign");
        await workbench.release();
    });

    it("结果未确认时不谎报结果：核对已落地视为保存，未落地保留未确认意图", async () => {
        const seed = recordFixture();
        // 已落地：文件其实已经写入，只是回执丢了；重读必须看到本次意图已经生效。
        const landedAttempts: GridLayoutRecord[] = [];
        const landedHarness = storageHarness({
            transport: scriptedTransport({
                attempts: landedAttempts,
                onRead: () => valueSnapshot(landedAttempts.length === 0 ? seed : landedAttempts[0]!, "landed-1"),
                onSave: async () => {
                    throw new StorageAdapterError({code: null, status: null, message: "Storage 请求超时", committed: null});
                },
            }),
        });
        const landedWorkbench = createWorkbenchStorageContext({adapters: landedHarness.adapters});
        const hostLanded = createHost(await userHandle(landedWorkbench));
        await hostLanded.open();
        hostLanded.setContainer({width: 1200, height: 800});
        expect(hostLanded.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const landedOutcome = await hostLanded.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});

        expect(landedOutcome).toMatchObject({status: "saved", credential: credential("landed-1")});
        expect(hostLanded.state.pending).toBeNull();

        // 未落地：重读仍是旧值，既不报已保存也不报未写入，且不自动重发。
        const missingAttempts: GridLayoutRecord[] = [];
        const missingHarness = storageHarness({
            transport: scriptedTransport({
                attempts: missingAttempts,
                onRead: () => valueSnapshot(seed, "seed-1"),
                onSave: async () => {
                    throw new StorageAdapterError({code: null, status: null, message: "Storage 请求超时", committed: null});
                },
            }),
        });
        const missingWorkbench = createWorkbenchStorageContext({adapters: missingHarness.adapters});
        const hostMissing = createHost(await userHandle(missingWorkbench));
        await hostMissing.open();
        hostMissing.setContainer({width: 1200, height: 800});
        expect(hostMissing.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const missingOutcome = await hostMissing.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});

        expect(missingOutcome).toMatchObject({status: "unsaved", diagnosis: expect.stringContaining("未确认")});
        expect(missingAttempts).toHaveLength(1);
        expect(hostMissing.state.pending).toMatchObject({autoReplayed: true, retryable: true});
        expect(sizeOf(hostMissing, "outline").width).toBe(360);
        await landedWorkbench.release();
        await missingWorkbench.release();
    });

    it("放弃未确认意图采用当前已确认值，不删除或清空其它记录", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);
        harness.records.set("user/nbook.other/layout/other", {value: {keep: true}, revision: "other-1", schemaVersion: 2});
        host.setContainer({width: 1200, height: 800});
        harness.write(RESOURCE, {...recordFixture(), note: "foreign"});
        harness.hook.beforeSave = () => {
            harness.write(RESOURCE, {...recordFixture(), note: "foreign"});
        };

        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        expect((await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]})).status).toBe("unsaved");
        expect(sizeOf(host, "outline").width).toBe(360);

        host.abandon();

        expect(host.state.pending).toBeNull();
        // 采用当前已确认值：显示回到基线记录的意图，不是被丢弃的 360。
        expect(sizeOf(host, "outline").width).toBe(240);
        expect(harness.sent).not.toContain("remove");
        expect(harness.records.get("user/nbook.other/layout/other")?.value).toEqual({keep: true});
        expect((harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown}).note).toBe("foreign");
        await workbench.release();
    });

    it("读取失败不被当作缺失：保持默认呈现、拿到基线前禁止保存，重开或显式恢复才应用", async () => {
        let reads = 0;
        const harness = storageHarness({
            transport: scriptedTransport({
                onRead: () => {
                    reads += 1;
                    // 前两次读取（首次读取与订阅初始快照）都失败：既不落默认值，也不当缺失写入。
                    if (reads <= 2) {
                        throw new StorageAdapterError({code: null, status: null, message: "Storage 读取失败", committed: null});
                    }
                    return valueSnapshot(recordFixture(320), "seed-1");
                },
            }),
        });
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createHost(await userHandle(workbench));
        await host.open();

        expect(host.state.projection).toBeNull();
        expect(host.state.blocked).toBe("unavailable");
        expect(host.state.writable).toBe(false);
        expect(sizeOf(host, "outline").width).toBe(240);
        expect(host.state.issues.some((issue) => issue.kind === "subscription")).toBe(true);

        // 显式重开：读取与订阅都拿到分类，记录一次发布。
        await host.open();

        expect(host.state.projection?.status).toBe("confirmed");
        expect(host.state.writable).toBe(true);
        expect(host.state.credential).toEqual(credential("seed-1"));
        expect(sizeOf(host, "outline").width).toBe(320);
        // 订阅已补齐：再次调用只返回当前状态，不重复读取或发布。
        const readsBefore = reads;
        await host.open();
        expect(reads).toBe(readsBefore);
        await workbench.release();
    });

    it("订阅补齐基线但不重挂呈现，显式恢复才应用记录", async () => {
        let reads = 0;
        const harness = storageHarness({
            transport: scriptedTransport({
                onRead: () => {
                    reads += 1;
                    if (reads === 1) {
                        throw new StorageAdapterError({code: null, status: null, message: "Storage 读取失败", committed: null});
                    }
                    return valueSnapshot(recordFixture(320), "seed-1");
                },
            }),
        });
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createHost(await userHandle(workbench));
        await host.open();

        expect(host.state.projection?.status).toBe("confirmed");
        expect(host.state.writable).toBe(true);
        expect(sizeOf(host, "outline").width).toBe(240);

        expect(host.restoreFromBaseline()).toMatchObject({status: "published"});
        expect(sizeOf(host, "outline").width).toBe(320);
        await workbench.release();
    });

    it("两个 resource 记录独立：同名叶不串记录", async () => {
        const harness = storageHarness();
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const handle = await userHandle(workbench);
        const left = createHost(handle, {resource: "left"});
        const right = createHost(handle, {resource: "right"});
        await left.open();
        await right.open();
        left.setContainer({width: 1200, height: 800});
        right.setContainer({width: 1200, height: 800});

        expect(left.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        expect((await left.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]})).status).toBe("saved");

        expect(harness.records.has(harness.userKey("right"))).toBe(false);
        expect(sizeOf(right, "outline").width).toBe(240);
        expect(widthsOf(harness.records.get(harness.userKey("left"))?.value)[0]).toEqual(["outline", 360]);
        await workbench.release();
    });

    it("真实 adapter 往返：read → 手势保存 → 重新打开 → 原件合成与未知引用恢复", async () => {
        const harness = storageHarness();
        harness.records.set(harness.userKey(RESOURCE), {value: recordFixture(), revision: "seed-1", schemaVersion: 2});
        const first = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createHost(await userHandle(first));
        await host.open();
        host.setContainer({width: 1200, height: 800});
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        expect((await host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]})).status).toBe("saved");
        await first.release();

        // 重新打开：新工作台、新句柄；插件已回归（未知引用重新出现）。
        const second = createWorkbenchStorageContext({adapters: harness.adapters});
        const reopened = createHost(await userHandle(second), {pluginLoaded: true});
        await reopened.open();
        reopened.setContainer({width: 1200, height: 800});

        expect(reopened.state.projection?.status).toBe("confirmed");
        expect(reopened.state.issues.some((issue) => issue.kind === "dropped-ref")).toBe(false);
        expect(idsOf(reopened.grid.root())).toEqual(["root", "outline", "plugin", "editor", "console"]);
        expect(sizeOf(reopened, "outline").width).toBe(360);
        expect(sizeOf(reopened, "plugin").width).toBe(180);
        expect(sizeOf(reopened, "editor").width).toBe(540);
        expect((harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown}).note).toBe("unknown-field");
        await second.release();
    });

    it("从未确认基线重新发布：未知引用重新出现可恢复，有未确认意图时拒绝", async () => {
        const harness = storageHarness();
        let pluginLoaded = false;
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createGridLayoutHost({
            grid: createTestGrid(),
            handle: await userHandle(workbench),
            definition,
            resource: RESOURCE,
            resolveRef: (ref) => ((ref === "plugin" && !pluginLoaded) ? null : resolver(true)(ref)),
        });
        harness.records.set(harness.userKey(RESOURCE), {value: recordFixture(), revision: "seed-1", schemaVersion: 2});
        await host.open();
        host.setContainer({width: 1200, height: 800});
        expect(idsOf(host.grid.root())).toEqual(["root", "outline", "editor", "console"]);

        pluginLoaded = true;
        const restored = host.restoreFromBaseline();

        expect(restored.status).toBe("published");
        expect(restored.dropped).toEqual([]);
        expect(idsOf(host.grid.root())).toEqual(["root", "outline", "plugin", "editor", "console"]);
        expect(sizeOf(host, "plugin").width).toBe(180);

        harness.write(RESOURCE, recordFixture());
        harness.hook.beforeSave = () => {
            harness.write(RESOURCE, recordFixture());
        };
        // 插件回归后根分支有四个叶：手势尺寸必须与该分支直接子节点同序。
        expect(host.gestureStart({branchId: "root", sizes: [20, 15, 40, 25]})).toEqual({ok: true});
        expect((await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [20, 15, 40, 25]})).status).toBe("unsaved");
        expect(host.restoreFromBaseline()).toMatchObject({status: "blocked"});
        await workbench.release();
    });

    it("release 先停止接纳再等在途提交收口", async () => {
        const gate = Promise.withResolvers<StorageCredential>();
        const attempts: GridLayoutRecord[] = [];
        const harness = storageHarness({
            transport: scriptedTransport({
                attempts,
                onSave: async () => await gate.promise,
            }),
        });
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createHost(await userHandle(workbench));
        await host.open();
        host.setContainer({width: 1200, height: 800});
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const committing = host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});
        const releasing = host.release();
        let settled = false;
        void releasing.then(() => {
            settled = true;
        });
        await Promise.resolve();

        expect(host.state.phase).toBe("released");
        expect((await host.retry()).status).toBe("rejected");
        expect(settled).toBe(false);

        gate.resolve(credential("revision-2"));
        await releasing;

        expect(settled).toBe(true);
        expect(await committing).toMatchObject({status: "saved"});
        expect(attempts).toHaveLength(1);
        await workbench.release();
    });

    it("上下文失效后不向失效句柄补写", async () => {
        const attempts: GridLayoutRecord[] = [];
        const harness = storageHarness({transport: scriptedTransport({attempts})});
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createHost(await userHandle(workbench));
        await host.open();
        host.setContainer({width: 1200, height: 800});
        // 撤销工作台上下文：已借用句柄立即拒绝新动作，旧引用不复活。
        await workbench.release();

        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});

        expect(outcome.status).toBe("unsaved");
        expect(host.state.phase).toBe("invalidated");
        expect(host.state.writable).toBe(false);
        expect(host.state.pending).toMatchObject({retryable: false});
        expect((await host.retry()).status).toBe("rejected");
        expect(attempts).toHaveLength(0);
    });
});
