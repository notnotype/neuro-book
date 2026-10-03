import {describe, expect, it, vi} from "vitest";
import {
    createGrid,
    type Grid,
    type GridAxis,
    type GridBranchChange,
    type GridExtent,
    type GridGestureCommit,
    type GridLeafInput,
    type GridNode,
    type GridRefResolver,
    type GridSnapshotNode,
} from "@notnotype/nb-ui/layout";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {defineStorageState} from "nbook/shared/storage/definition";
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
    type GridLayoutCommitResult,
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

/** 外部窗口改写结构后的记录：`outline` 已不存在（改名 `outline-v2`）。 */
function renamedRecordFixture(): GridLayoutRecord {
    return {
        version: 2,
        note: "renamed",
        root: {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            children: [
                {kind: "leaf", id: "outline-v2", ref: "outline-v2", size: {width: 300, height: 0}},
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

/** 当前呈现里该分支直接子节点沿主轴的 px：宿主消费的手势 `baseline` 就是这一份。 */
function baselinePx(host: GridLayoutHost<string>, branchId: string, axis: GridAxis = "width"): Record<string, number> {
    const node = findNode(host.grid.root(), branchId);
    const rendered = host.layout();
    if (node === null || node.kind !== "branch" || rendered === null) {
        throw new Error(`测试树里没有已测量的分支：${branchId}`);
    }
    return Object.fromEntries(node.children.map((child) => [child.id, rendered.sizes[child.id]?.[axis] ?? 0]));
}

/** 一次手势提交：显示层冻结的版本与根盒默认取宿主当前值，可显式覆盖以测失效路径。 */
function gestureOf(
    host: GridLayoutHost<string>,
    changes: readonly GridBranchChange[],
    overrides: {readonly revision?: number; readonly extent?: GridExtent} = {},
): GridGestureCommit {
    return {
        sessionId: "session-1",
        contextKey: "grid-test",
        source: "pointer",
        revision: overrides.revision ?? host.state.revision,
        extent: overrides.extent ?? {width: 1200, height: 800},
        changes,
    };
}

/** 根分支的一次单轴拖动：基线取当前呈现，目标显式给出。 */
function rootGesture(
    host: GridLayoutHost<string>,
    target: Record<string, number>,
    active: readonly string[],
    overrides: {readonly revision?: number; readonly extent?: GridExtent} = {},
): GridGestureCommit {
    return gestureOf(host, [{
        branchId: "root",
        axis: "width",
        baseline: baselinePx(host, "root"),
        target,
        active,
        compensated: [],
        collapsed: {},
        extent: overrides.extent ?? {width: 1200, height: 800},
    }], overrides);
}

/** 提交一次手势并等待合成保存；`{ok:false}` 是断言失败（拒绝不是被测结果），直接抛出。 */
async function commitGesture(host: GridLayoutHost<string>, commit: GridGestureCommit): Promise<GridLayoutCommitResult> {
    const accepted = host.gestureCommit(commit);
    if (!accepted.ok) {
        throw new Error(`手势提交被拒绝：${accepted.reason}`);
    }
    return await accepted.saved;
}

function widthsOf(record: unknown): Array<[string, number]> {
    const root = (record as {root: {children: GridSnapshotNode[]}}).root;
    return root.children.map((child) => [child.id, child.kind === "leaf" ? child.size.width : 0]);
}

/** 记录原件里各节点的尺寸（断言保存内容用）；未知节点也在其中，便于确认原件位置未丢。 */
function sizesInRecord(record: unknown): Record<string, GridExtent> {
    const sizes: Record<string, GridExtent> = {};
    if (typeof record !== "object" || record === null || !("root" in record)) {
        return sizes;
    }
    // 运行时确认过 `root` 存在；这里断言的是宿主写回的快照形状（v2 记录），不是外部输入。
    const root = record.root as GridSnapshotNode;
    const walk = (node: GridSnapshotNode): void => {
        sizes[node.id] = node.size;
        if (node.kind === "branch") {
            node.children.forEach(walk);
        }
    };
    walk(root);
    return sizes;
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
        const saved = await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]));

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
            const outcome = await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]));

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

    it("一次手势只提交一次且只写 active 字段；程序布局、no-op 与失效提交都不保存", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);
        host.setContainer({width: 1200, height: 800});
        expect(host.layout()).not.toBeNull();
        expect(saves(harness.sent)).toBe(0);

        // no-op 手势：目标与基线一致，不写盘。
        expect((await commitGesture(host, rootGesture(host, {outline: 240, editor: 660, console: 300}, ["outline"]))).status).toBe("unchanged");
        expect(saves(harness.sent)).toBe(0);

        // 失效提交：显示层冻结的外部版本已经过期，整次拒绝且树不动。
        const stale = host.gestureCommit(rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline", "editor"], {revision: host.state.revision - 1}));
        expect(stale).toMatchObject({ok: false, reason: expect.stringContaining("外部布局版本")});
        // 主动节点不属于该分支：同样整次拒绝，不写盘也不改树。
        const foreign = host.gestureCommit(rootGesture(host, {outline: 360, editor: 540, console: 300}, ["ghost"]));
        expect(foreign).toMatchObject({ok: false, reason: expect.stringContaining("不属于分支")});
        expect(sizeOf(host, "outline").width).toBe(240);
        expect(saves(harness.sent)).toBe(0);

        // 真实手势：只把 active 字段写进原件；未主动改变的节点保持原件值。
        const saved = await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline"]));

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

    it("一场手势的多分支提交整批落账：任一项不合法整批不改，根盒已变直接拒绝", async () => {
        const nested = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 800},
            children: [
                {kind: "leaf", id: "side", ref: "side", size: {width: 300, height: 0}, minimumSize: {width: 100, height: 0}, maximumSize: {width: 600, height: Number.MAX_SAFE_INTEGER}},
                {
                    kind: "branch",
                    id: "body",
                    orientation: "vertical",
                    size: {width: 900, height: 0},
                    children: [
                        {kind: "leaf", id: "top", ref: "top", size: {width: 0, height: 500}, minimumSize: {width: 0, height: 200}, maximumSize: {width: Number.MAX_SAFE_INTEGER, height: 900}},
                        {
                            kind: "leaf",
                            id: "bottom",
                            ref: "bottom",
                            size: {width: 0, height: 300},
                            minimumSize: {width: 0, height: 100},
                            maximumSize: {width: Number.MAX_SAFE_INTEGER, height: 700},
                            collapse: {collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
                        },
                    ],
                },
            ],
        }, {sashSize: 0});
        const harness = storageHarness();
        harness.records.set(harness.userKey(RESOURCE), {value: nested.serialize(), revision: "seed-1", schemaVersion: 2});
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createGridLayoutHost({
            grid: nested,
            handle: await userHandle(workbench),
            definition,
            resource: RESOURCE,
            resolveRef: (ref) => ({ref}),
        });
        await host.open();
        host.setContainer({width: 1200, height: 800});

        // 交汇处两根轴在同一次提交里落账：宽度轴与嵌套分支的高度轴各一项。
        const saved = await commitGesture(host, gestureOf(host, [
            {branchId: "root", axis: "width", baseline: {side: 300, body: 900}, target: {side: 200, body: 1000}, active: ["side", "body"], compensated: [], collapsed: {}, extent: {width: 1200, height: 800}},
            {branchId: "body", axis: "height", baseline: {top: 500, bottom: 300}, target: {top: 400, bottom: 400}, active: ["top", "bottom"], compensated: [], collapsed: {}, extent: {width: 1200, height: 800}},
        ]));

        expect(saved).toMatchObject({status: "saved"});
        expect(saves(harness.sent)).toBe(1);
        const stored = sizesInRecord(harness.records.get(harness.userKey(RESOURCE))?.value);
        expect(stored.side?.width).toBe(200);
        expect(stored.body?.width).toBe(1000);
        expect(stored.top?.height).toBe(400);
        expect(stored.bottom?.height).toBe(400);

        // 第二项不守恒：整批不落账，树与记录都保持上一批的结果。
        const before = JSON.stringify(host.grid.serialize());
        const atomic = host.gestureCommit(gestureOf(host, [
            {branchId: "root", axis: "width", baseline: {side: 200, body: 1000}, target: {side: 150, body: 1050}, active: ["side", "body"], compensated: [], collapsed: {}, extent: {width: 1200, height: 800}},
            {branchId: "body", axis: "height", baseline: {top: 400, bottom: 400}, target: {top: 450, bottom: 400}, active: ["top"], compensated: [], collapsed: {}, extent: {width: 1200, height: 800}},
        ]));

        expect(atomic).toMatchObject({ok: false, reason: expect.stringContaining("不守恒")});
        expect(JSON.stringify(host.grid.serialize())).toBe(before);
        expect(saves(harness.sent)).toBe(1);

        // 根盒已变（窗口在按下后被改尺寸）：旧基线的手势整次拒绝。
        const staleBox = host.gestureCommit(gestureOf(host, [
            {branchId: "root", axis: "width", baseline: {side: 200, body: 1000}, target: {side: 150, body: 1050}, active: ["side", "body"], compensated: [], collapsed: {}, extent: {width: 900, height: 800}},
        ], {extent: {width: 900, height: 800}}));

        expect(staleBox).toMatchObject({ok: false, reason: expect.stringContaining("根盒")});
        expect(JSON.stringify(host.grid.serialize())).toBe(before);

        // 收起：只发布运行期收起状态，记录里保留展开意图（绝不把 0 写进尺寸记录）。
        const accepted = host.gestureCommit(gestureOf(host, [
            {branchId: "body", axis: "height", baseline: {top: 400, bottom: 400}, target: {top: 800, bottom: 0}, active: ["top", "bottom"], compensated: [], collapsed: {bottom: true}, extent: {width: 1200, height: 800}},
        ]));

        expect(accepted.ok).toBe(true);
        expect(accepted.ok && accepted.collapsed).toEqual({bottom: true});
        const collapseResult = accepted.ok ? await accepted.saved : null;
        // `fields` 只存在于 saved/unsaved 两个分支：先按 status 收窄再读，别对联合类型直接取字段。
        expect(collapseResult?.status === "saved" ? collapseResult.fields : null).toEqual([{id: "top", axis: "height", value: 800}]);
        const collapsedRecord = sizesInRecord(harness.records.get(harness.userKey(RESOURCE))?.value);
        expect(collapsedRecord.bottom?.height).toBe(400);
        expect(collapsedRecord.top?.height).toBe(800);
        await workbench.release();
    });


    it("订阅只更新已确认基线：不重挂当前呈现，刷新后的凭据可直接续写", async () => {
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

            const savedA = await commitGesture(hostA, rootGesture(hostA, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]));
            expect(savedA.status).toBe("saved");
            const revisionA = savedA.status === "saved" ? savedA.credential.revision : null;

            await flushSubscription();

            expect(hostB.state.credential?.revision).toBe(revisionA);
            expect(sizeOf(hostB, "outline").width).toBe(240);

            const savedB = await commitGesture(hostB, rootGesture(hostB, {outline: 384, editor: 516, console: 300}, ["outline", "editor"]));

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
            expect((await commitGesture(hostB, rootGesture(hostB, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]))).status).toBe("saved");
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
        expect((await commitGesture(hostA, rootGesture(hostA, {outline: 240, editor: 600, console: 360}, ["editor", "console"]))).status).toBe("saved");

        // B 的基线仍是 seed-1：第一次提交冲突，重读后只重放它自己的主动字段。
        const savedB = await commitGesture(hostB, rootGesture(hostB, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]));

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

        const outcome = await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]));

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
        const landedOutcome = await commitGesture(hostLanded, rootGesture(hostLanded, {outline: 360, editor: 540, console: 300}, ["outline"]));

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
        const missingOutcome = await commitGesture(hostMissing, rootGesture(hostMissing, {outline: 360, editor: 540, console: 300}, ["outline"]));

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

        expect((await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline"]))).status).toBe("unsaved");
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

    it("重放后主动字段没有落点：不报已保存，保留未确认意图且重试/放弃可用", async () => {
        const harness = storageHarness();
        harness.records.set(harness.userKey(RESOURCE), {value: recordFixture(), revision: "seed-1", schemaVersion: 2});
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const host = createGridLayoutHost({
            grid: createTestGrid(),
            handle: await userHandle(workbench),
            definition,
            resource: RESOURCE,
            resolveRef: (ref) => (ref === "plugin" ? null : {ref}),
        });
        await host.open();
        host.setContainer({width: 1200, height: 800});
        // 另一个窗口改写结构后写入：本窗口手势的主动字段在新记录里已没有对应节点。
        harness.write(RESOURCE, renamedRecordFixture());
        const revision = harness.records.get(harness.userKey(RESOURCE))?.revision ?? "";

        const outcome = await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline"]));

        expect(outcome.status).toBe("unsaved");
        expect(host.state.pending).toMatchObject({retryable: true, fields: [{id: "outline", axis: "width", value: 360}]});
        expect(host.state.credential).toEqual(credential(revision));
        expect(harness.records.get(harness.userKey(RESOURCE))?.revision).toBe(revision);
        expect(host.state.issues.some((issue) => issue.kind === "save" && issue.message.includes("没有落点"))).toBe(true);

        // 显式重试仍然没有落点：不谎报保存，意图继续保留。
        expect((await host.retry()).status).toBe("unsaved");
        expect(host.state.pending).not.toBeNull();

        // 放弃采用当前已确认值（结构已改写的记录），不清记录。
        host.abandon();
        expect(host.state.pending).toBeNull();
        expect(idsOf(host.grid.root())).toEqual(["root", "outline-v2", "editor", "console"]);
        expect(harness.records.get(harness.userKey(RESOURCE))?.revision).toBe(revision);
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

        expect((await commitGesture(left, rootGesture(left, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]))).status).toBe("saved");

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
        expect((await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]))).status).toBe("saved");
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
        // 插件回归后根分支有四个叶：手势的基线取当前呈现（意图之和超过容器时会按比例降级）。
        const baseline = baselinePx(host, "root");
        expect(Object.keys(baseline)).toEqual(["outline", "plugin", "editor", "console"]);
        expect((await commitGesture(host, rootGesture(host, {...baseline, outline: baseline.outline! + 20, plugin: baseline.plugin! - 20}, ["outline", "plugin"]))).status).toBe("unsaved");
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
        // 保存被门控挂住：release 必须先等它收口，且不能再接纳新提交。
        const committing = commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline", "editor"]));
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

    it("release 后 open 不接受新动作：返回当前状态且不发起读取", async () => {
        const harness = storageHarness();
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const handle = await userHandle(workbench);
        const readsNow = (): number => harness.sent.filter((kind) => kind === "read").length;

        // 从未打开过的宿主：释放后 open() 不得发起读取。
        const neverOpened = createHost(handle);
        await neverOpened.release();
        const readsBeforeRelease = readsNow();
        expect((await neverOpened.open()).phase).toBe("released");
        expect(readsNow()).toBe(readsBeforeRelease);

        // 已打开过的宿主：释放后 open() 同样只返回当前状态。
        const opened = createHost(handle);
        await opened.open();
        await opened.release();
        const readsAfterOpen = readsNow();
        expect((await opened.open()).phase).toBe("released");
        expect(readsNow()).toBe(readsAfterOpen);
        await workbench.release();
    });

    it("构造期守卫拒绝不匹配的句柄、寻址与定义版本且不接触句柄", async () => {
        const harness = storageHarness();
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const handle = await userHandle(workbench);
        const otherOwner = defineGridLayoutState({
            owner: "nbook.other-owner",
            key: "layout",
            scope: "user",
            records: "identified",
            defaultLayout: createTestGrid().serialize(),
        });
        const singleRecord = defineGridLayoutState({
            owner: OWNER,
            key: "layout",
            scope: "user",
            records: "single",
            defaultLayout: createTestGrid().serialize(),
        });
        const wrongSchema = defineStorageState<GridLayoutRecord>({
            owner: OWNER,
            key: "layout",
            scope: "user",
            records: "identified",
            schemaVersion: 3,
            defaultValue: definition.defaultValue,
            validate: definition.validate,
        });
        const actionsBefore = harness.sent.length;

        expect(() => createGridLayoutHost({
            grid: createTestGrid(), handle, definition: otherOwner, resource: RESOURCE, resolveRef: resolver(),
        })).toThrow(TypeError);
        expect(() => createGridLayoutHost({
            grid: createTestGrid(), handle, definition, resolveRef: resolver(),
        })).toThrow(/稳定资源标识/);
        expect(() => createGridLayoutHost({
            grid: createTestGrid(), handle, definition: singleRecord, resource: RESOURCE, resolveRef: resolver(),
        })).toThrow(/single/);
        expect(() => createGridLayoutHost({
            grid: createTestGrid(), handle, definition, resource: "Main/Ref", resolveRef: resolver(),
        })).toThrow(/安全逻辑标识/);
        expect(() => createGridLayoutHost({
            grid: createTestGrid(), handle, definition: wrongSchema, resource: RESOURCE, resolveRef: resolver(),
        })).toThrow(/schemaVersion/);
        expect(harness.sent.length).toBe(actionsBefore);
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

        const outcome = await commitGesture(host, rootGesture(host, {outline: 360, editor: 540, console: 300}, ["outline"]));

        expect(outcome.status).toBe("unsaved");
        expect(host.state.phase).toBe("invalidated");
        expect(host.state.writable).toBe(false);
        expect(host.state.pending).toMatchObject({retryable: false});
        expect((await host.retry()).status).toBe("rejected");
        expect(attempts).toHaveLength(0);
    });
});

describe("commitFields（外壳的直接字段提交）", () => {
    it("只提交主动字段：未主动节点、不可解析引用与未知顶层字段都留在原件里", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);

        const saved = await host.commitFields([{id: "outline", axis: "width", value: 360}]);

        expect(saved).toMatchObject({status: "saved", fields: [{id: "outline", axis: "width", value: 360}]});
        expect(saves(harness.sent)).toBe(1);
        const record = harness.records.get(harness.userKey(RESOURCE))?.value as {note?: unknown};
        expect(record.note).toBe("unknown-field");
        expect(widthsOf(record)).toEqual([
            ["outline", 360],
            ["plugin", 180],
            ["editor", 660],
            ["console", 300],
        ]);
        await workbench.release();
    });

    it("形状不合法的调用整次拒绝：非法轴、非有限/负值、重复 (id, axis)、空 id", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);

        const outcomes = [
            await host.commitFields([{id: "outline", axis: "depth" as never, value: 300}]),
            await host.commitFields([{id: "outline", axis: "width", value: Number.POSITIVE_INFINITY}]),
            await host.commitFields([{id: "outline", axis: "width", value: -1}]),
            await host.commitFields([
                {id: "outline", axis: "width", value: 300},
                {id: "outline", axis: "width", value: 320},
            ]),
            await host.commitFields([{id: "", axis: "width", value: 300}]),
        ];

        expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
        expect(saves(harness.sent)).toBe(0);
        expect(host.state.pending).toBeNull();
        // 入口拒绝不产生未确认意图，也不改当前呈现。
        expect(sizeOf(host, "outline").width).toBe(240);
        await workbench.release();
    });

    it("空字段与同值字段是 unchanged：不新增记录，也不产生保存", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);

        expect((await host.commitFields([])).status).toBe("unchanged");
        expect((await host.commitFields([{id: "outline", axis: "width", value: 240}])).status).toBe("unchanged");
        expect(saves(harness.sent)).toBe(0);
        await workbench.release();
    });

    it("任一落点缺失就整次不保存：保留未确认意图、不新造节点，重试时整次一起落地", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);

        const outcome = await host.commitFields([
            {id: "outline", axis: "width", value: 360},
            {id: "ghost", axis: "width", value: 100},
        ]);

        expect(outcome.status).toBe("unsaved");
        expect(saves(harness.sent)).toBe(0);
        expect(host.state.pending).toMatchObject({
            retryable: true,
            fields: [
                {id: "outline", axis: "width", value: 360},
                {id: "ghost", axis: "width", value: 100},
            ],
        });
        // 没有部分保存：原件里既没有 outline 的 360，也没有新造出 ghost 节点。
        const untouched = harness.records.get(harness.userKey(RESOURCE))?.value as {root: {children: GridSnapshotNode[]}};
        expect(untouched.root.children.map((child) => child.id)).toEqual(["outline", "plugin", "editor", "console"]);
        expect(widthsOf(untouched)).toEqual([
            ["outline", 240],
            ["plugin", 180],
            ["editor", 660],
            ["console", 300],
        ]);

        // 外部把记录补成含 ghost 的结构后，显式重试整次落地（重试保持"每个字段都有落点"的语义）。
        const fixture = recordFixture();
        const fixtureRoot = fixture.root as {children: GridSnapshotNode[]};
        harness.write(RESOURCE, {
            ...fixture,
            root: {
                ...fixtureRoot,
                children: [...fixtureRoot.children, {kind: "leaf", id: "ghost", ref: "ghost", size: {width: 0, height: 0}}],
            },
        } as unknown as GridLayoutRecord);

        const retried = await host.retry();

        expect(retried.status).toBe("saved");
        expect(host.state.pending).toBeNull();
        expect(widthsOf(harness.records.get(harness.userKey(RESOURCE))?.value)).toEqual([
            ["outline", 360],
            ["plugin", 180],
            ["editor", 660],
            ["console", 300],
            ["ghost", 100],
        ]);
        await workbench.release();
    });

    it("冲突重读后落点消失：整次不保存，不先提交还存在的那些字段", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);
        // 第一次提交前外部把 outline 改名：条件写冲突 → 重读后的原件里已经没有落点。
        harness.hook.beforeSave = () => {
            harness.write(RESOURCE, renamedRecordFixture());
        };

        const outcome = await host.commitFields([
            {id: "outline", axis: "width", value: 360},
            {id: "editor", axis: "width", value: 540},
        ]);

        expect(outcome.status).toBe("unsaved");
        expect(saves(harness.sent)).toBe(1);
        expect(host.state.pending?.fields).toEqual([
            {id: "outline", axis: "width", value: 360},
            {id: "editor", axis: "width", value: 540},
        ]);
        await workbench.release();
    });

    it("release 之后拒绝：不再接受字段提交，也不向失效句柄补写", async () => {
        const harness = storageHarness();
        const {host, workbench} = await openedHost(harness);
        await host.release();

        const outcome = await host.commitFields([{id: "outline", axis: "width", value: 360}]);

        expect(outcome.status).toBe("rejected");
        expect(saves(harness.sent)).toBe(0);
        await workbench.release();
    });
});
