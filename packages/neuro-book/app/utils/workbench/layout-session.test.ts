import {effectScope} from "vue";
import {describe, expect, it, vi} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {
    StorageAdapterError,
    type StorageValueTransport,
} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageProjectContextTarget} from "nbook/app/utils/storage/host-context-client";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import type {Grid, GridLayoutResult} from "@notnotype/nb-ui/components";
import {
    createLayoutRecordSession,
    createWorkbenchLayoutSession,
    useWorkbenchShelfMode,
    type LayoutRecordCommitResult,
    type WorkbenchLayoutSession,
    type WorkbenchShelfModeConsumer,
    type WorkbenchSurfaceSizesPatch,
} from "nbook/app/utils/workbench/layout-session";
import {createShellGrid} from "nbook/app/utils/workbench/layout";
import {shellRefResolver} from "nbook/app/utils/workbench/shell-layout";
import {
    WORKBENCH_LAYOUT_OWNER,
    WORKBENCH_SHELF_MODE_KEY,
    WORKBENCH_SURFACE_SIZES_KEY,
} from "nbook/shared/storage/workbench-state";
import type {WorkbenchSurfaceSizes} from "nbook/shared/storage/workbench-state";

const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);
const USER_OWNER = WORKBENCH_LAYOUT_OWNER;

type StoredRecord = {value: unknown; revision: string; schemaVersion: number};

type Harness = {
    readonly records: Map<string, StoredRecord>;
    readonly fixedReads: Map<string, StorageReadResult<unknown>>;
    readonly saves: string[];
    readonly adapters: WorkbenchStorageAdapters;
    readonly hook: {beforeSave: ((action: Extract<StorageActionRequest, {kind: "save"}>) => void) | null};
    key(scope: "user" | "project", owner: string, key: string, resource?: string): string;
    write(scope: "user" | "project", owner: string, key: string, value: unknown, resource?: string, schemaVersion?: number): void;
};

/**
 * 内存记录存储 + 真实 owner adapter 的注入传输。
 *
 * 沿用 t44 宿主测试的注入模式：句柄、条件写、读取分类与订阅都是真实实现，只有传输与身份是替身，
 * 因此本文件验证的是产品语义而不是 stub 调用次数。
 */
function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const fixedReads = new Map<string, StorageReadResult<unknown>>();
    const saves: string[] = [];
    const hook: Harness["hook"] = {beforeSave: null};
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});
    const key = (scope: "user" | "project", owner: string, recordKey: string, resource?: string): string =>
        `${scope}/${owner}/${recordKey}/${resource ?? ""}`;

    const write = (
        scope: "user" | "project",
        owner: string,
        recordKey: string,
        value: unknown,
        resource?: string,
        schemaVersion = 1,
    ): void => {
        records.set(key(scope, owner, recordKey, resource), {value, revision: `revision-${++sequence}`, schemaVersion});
    };

    const transportFor = (scope: "user" | "project"): StorageValueTransport => ({
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            const address = key(scope, action.owner, action.key, action.resource);
            if (action.kind === "read") {
                const fixed = fixedReads.get(address);
                if (fixed !== undefined) {
                    return {kind: "read", result: fixed};
                }
                const record = records.get(address);
                if (record === undefined) {
                    return {kind: "read", result: {kind: "missing", credential: credential(null)}};
                }
                if (record.schemaVersion < action.schemaVersion) {
                    return {
                        kind: "read",
                        result: {
                            kind: "legacy-value",
                            value: record.value,
                            schemaVersion: record.schemaVersion,
                            credential: credential(record.revision),
                        },
                    };
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
                return {
                    kind: "read",
                    result: {kind: "value", value: record.value, schemaVersion: record.schemaVersion, credential: credential(record.revision)},
                };
            }
            if (action.kind === "save") {
                hook.beforeSave?.(action);
                const record = records.get(address);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw new StorageAdapterError({
                        code: "STORAGE_REVISION_CONFLICT",
                        status: 409,
                        message: "记录已被其它窗口改写",
                        committed: false,
                    });
                }
                const revision = `revision-${++sequence}`;
                records.set(address, {value: action.value, revision, schemaVersion: action.schemaVersion});
                saves.push(address);
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
        // 订阅靠同一句柄内的 notify 触发；轮询放在测试时长之外，避免跨句柄的不确定刷新。
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport: transportFor(options.session.scope),
            subscribe: {intervalMs: 60_000, maxBackoffMs: 120_000},
        }),
        closeContext: async () => undefined,
    };

    return {records, fixedReads, saves, adapters, hook, key, write};
}

async function userHandle(harness: Harness, owner = USER_OWNER): Promise<WorkbenchStorageOwnerHandle> {
    const context = createWorkbenchStorageContext({adapters: harness.adapters});
    const result = await context.userOwner(owner);
    if (result.status !== "ready") {
        throw new Error(result.diagnosis);
    }
    return result.handle;
}

/** 与产品同形的主动字段合成：只改补丁里出现的字段，未知字段与非有限值原样保留。 */
function surfaceSizesDefinition(): DefinedStorageState<WorkbenchSurfaceSizes> {
    return {
        owner: USER_OWNER,
        key: WORKBENCH_SURFACE_SIZES_KEY,
        scope: "user",
        locality: "local",
        records: "identified",
        schemaVersion: 1,
        defaultValue: {leftPanelWidth: 340, agentPanelWidth: 400},
        validate: (value: unknown): value is WorkbenchSurfaceSizes => typeof value === "object" && value !== null,
        limits: {maxValueBytes: 64 * 1024, maxRecords: 1024, maxPartitionBytes: 16 * 1024 * 1024},
        address: `user/${USER_OWNER}/${WORKBENCH_SURFACE_SIZES_KEY}`,
    } as DefinedStorageState<WorkbenchSurfaceSizes>;
}

function surfaceSession(handle: WorkbenchStorageOwnerHandle, resource: string, onChange?: () => void) {
    return createLayoutRecordSession<WorkbenchSurfaceSizes, WorkbenchSurfaceSizesPatch>(
        {
            handle,
            definition: surfaceSizesDefinition(),
            resource,
            compose: (base, patch) => {
                // 与产品同形：没有已确认记录时只写本次主动字段，不把默认值写成"已确认值"。
                const value = base === null ? {...patch} : {...base, ...patch};
                const changed = base === null
                    || Object.entries(patch).some(([field, next]) => (base as Record<string, unknown>)[field] !== next);
                return changed ? {value, changed: true, diagnosis: ""} : {value, changed: false, diagnosis: "与已确认值相同"};
            },
            ...(onChange === undefined ? {} : {onChange}),
        },
    );
}

async function settled(result: Promise<LayoutRecordCommitResult>): Promise<LayoutRecordCommitResult> {
    return await result;
}

/** 等待会话的异步切换收口（队列里还有释放与打开）。 */
async function waitFor(predicate: () => boolean): Promise<void> {
    await vi.waitFor(() => {
        if (!predicate()) {
            throw new Error("条件尚未满足");
        }
    }, {timeout: 1000});
}

describe("布局记录会话（user/local 尺寸）", () => {
    it("首读门禁：读取完成前拒绝提交，缺失记录只显示默认值不落盘", async () => {
        const harness = storageHarness();
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");

        const beforeRead = await settled(session.commit({leftPanelWidth: 500}));
        expect(beforeRead.status).toBe("rejected");
        expect(harness.records.size).toBe(0);

        await session.open();

        expect(harness.saves).toHaveLength(0);
        expect(session.state().hasConfirmed).toBe(false);
        expect(session.display().leftPanelWidth).toBe(340);
        expect(session.state().writable).toBe(true);
    });

    it("只提交主动字段：读取时的未知字段与未主动字段一起保留", async () => {
        const harness = storageHarness();
        harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300, note: "keep"}, "idle");
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");
        await session.open();

        const result = await settled(session.commit({agentPanelWidth: 420}));

        expect(result.status).toBe("saved");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 300, note: "keep", agentPanelWidth: 420});
    });

    it("条件冲突后重读并只重放本次主动字段一次", async () => {
        const harness = storageHarness();
        harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300}, "idle");
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");
        await session.open();

        // 第一个标签页：提交前记录已被外部改写（含外部自己的字段）。
        let injected = false;
        harness.hook.beforeSave = () => {
            if (injected) return;
            injected = true;
            harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300, agentPanelWidth: 380}, "idle");
        };

        const result = await settled(session.commit({leftPanelWidth: 512}));

        expect(result.status).toBe("saved");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 512, agentPanelWidth: 380});
    });

    it("二次冲突保留未保存意图，重试成功后收口，放弃则回到已确认值", async () => {
        const harness = storageHarness();
        harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300}, "idle");
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");
        await session.open();

        harness.hook.beforeSave = () => {
            harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300, agentPanelWidth: 380}, "idle");
        };

        const conflicted = await settled(session.commit({leftPanelWidth: 512}));
        expect(conflicted.status).toBe("unsaved");
        const pending = session.state().pending;
        expect(pending?.retryable).toBe(true);
        // 当前显示保留本地意图，不因失败回退。
        expect(session.display().leftPanelWidth).toBe(512);

        harness.hook.beforeSave = null;
        const retried = await settled(session.retry());
        expect(retried.status).toBe("saved");
        expect(session.state().pending).toBeNull();
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 512, agentPanelWidth: 380});

        // 再次制造二次冲突后放弃：采用当前已确认值，不改动其它字段。
        harness.hook.beforeSave = () => {
            harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 640, agentPanelWidth: 380}, "idle");
        };
        await settled(session.commit({leftPanelWidth: 280}));
        expect(session.state().pending).not.toBeNull();
        session.abandon();

        expect(session.state().pending).toBeNull();
        expect(session.display().leftPanelWidth).toBe(640);
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 640, agentPanelWidth: 380});
    });

    it("保存结果未确认时重读核对：已落地按已保存收口，未落地保留意图等待显式重试", async () => {
        const harness = storageHarness();
        harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, {leftPanelWidth: 300}, "idle");
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");
        await session.open();

        // 未确认：传输抛错但记录其实已经写入（模拟响应丢失）。
        let injected = false;
        harness.hook.beforeSave = (action) => {
            if (injected) return;
            injected = true;
            harness.write("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, action.value, "idle");
            throw new StorageAdapterError({code: "STORAGE_IO", status: null, message: "响应丢失", committed: null});
        };

        const reconciled = await settled(session.commit({leftPanelWidth: 512}));
        expect(reconciled.status).toBe("saved");
        expect(session.state().pending).toBeNull();

        // 未确认且确实没落地：保留未保存意图，显式重试才写。
        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_IO", status: null, message: "响应丢失", committed: null});
        };
        const unresolved = await settled(session.commit({leftPanelWidth: 600}));
        expect(unresolved.status).toBe("unsaved");
        expect(session.state().pending?.diagnosis).toContain("等待显式重试");
        expect(session.display().leftPanelWidth).toBe(600);

        harness.hook.beforeSave = null;
        expect((await settled(session.retry())).status).toBe("saved");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 600});
    });

    it("损坏与未知高版本记录：报告阻断、保留原件、禁止普通保存", async () => {
        const harness = storageHarness();
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");
        harness.fixedReads.set(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"), {
            kind: "unsupported-version",
            wrapperVersion: 1,
            schemaVersion: 9,
            diagnosis: "记录版本高于当前支持版本",
            repair: {partitionGeneration: 1, contentFingerprint: "seed"},
        });

        await session.open();

        expect(session.state().blocked).toBe("unsupported-version");
        expect(session.state().writable).toBe(false);
        const result = await settled(session.commit({leftPanelWidth: 512}));
        expect(result.status).toBe("unsaved");
        expect(session.state().pending?.retryable).toBe(false);
        expect(harness.saves).toHaveLength(0);
    });

    it("释放后不再接受新提交", async () => {
        const harness = storageHarness();
        const handle = await userHandle(harness);
        const session = surfaceSession(handle, "idle");
        await session.open();
        await session.release();

        const result = await settled(session.commit({leftPanelWidth: 512}));
        expect(result.status).toBe("rejected");
        expect(harness.saves).toHaveLength(0);
    });
});

describe("书架模式（user/local 单例记录）", () => {
    it("加载前显示默认模式，提交写入 shelf-mode 记录，保存失败保留未保存意图", async () => {
        const harness = storageHarness();
        const scope = effectScope();
        const shelf = scope.run(() => useWorkbenchShelfMode({adapters: harness.adapters}))!;

        expect(shelf.mode.value).toBe("grid");
        await waitLoaded(shelf);
        expect(shelf.mode.value).toBe("grid");
        expect(harness.saves).toHaveLength(0);
        expect(shelf.unsaved.value).toBeNull();

        await shelf.commit("compact");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SHELF_MODE_KEY))?.value).toBe("compact");

        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_IO", status: 500, message: "后端不可达", committed: false});
        };
        await shelf.commit("editorial");

        expect(shelf.mode.value).toBe("editorial");
        expect(shelf.unsaved.value?.diagnosis).toContain("后端不可达");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SHELF_MODE_KEY))?.value).toBe("compact");

        shelf.abandon();
        expect(shelf.mode.value).toBe("compact");
        expect(shelf.unsaved.value).toBeNull();
        scope.stop();
    });

    it("另一个标签页改了同一记录：冲突后重读并只重放本次意图", async () => {
        const harness = storageHarness();
        harness.write("user", USER_OWNER, WORKBENCH_SHELF_MODE_KEY, "compact");
        const scope = effectScope();
        const shelf = scope.run(() => useWorkbenchShelfMode({adapters: harness.adapters}))!;
        await waitLoaded(shelf);
        expect(shelf.mode.value).toBe("compact");

        let injected = false;
        harness.hook.beforeSave = () => {
            if (injected) return;
            injected = true;
            harness.write("user", USER_OWNER, WORKBENCH_SHELF_MODE_KEY, "editorial");
        };
        await shelf.commit("grid");

        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SHELF_MODE_KEY))?.value).toBe("grid");
        expect(shelf.unsaved.value).toBeNull();
        scope.stop();
    });
});

/** 等首读落定：书架模式在建立时自动打开记录，用例只关心结果。 */
async function waitLoaded(shelf: WorkbenchShelfModeConsumer): Promise<void> {
    await vi.waitFor(() => {
        if (shelf.loading.value) {
            throw new Error("书架模式记录尚未完成首读");
        }
    }, {timeout: 1000});
}

/* -------------------------------------------------------------------------- */
/* 壳层会话                                                                    */
/* -------------------------------------------------------------------------- */

const VIEWPORT = {width: 1440, height: 900};

function shellGrid(): Grid<string> {
    return createShellGrid(VIEWPORT.width, {activity: 60, left: 340, editor: 638, right: 400, titlebar: 36, main: 864}, []);
}

/**
 * 一次侧栏手势的完整百分比：以当前呈现为基准，编辑器吸收差额。
 *
 * 刚性叶（活动栏 60）与目标必须逐值落在当前约束里，否则原语会拒绝整次手势——
 * 比例的分母是**分支子节点呈现之和**（不含 sash），不是随手给的 px 之和。
 */
function gesturePercents(layout: GridLayoutResult, next: {left?: number; right?: number}): number[] {
    const presented = {
        activity: layout.sizes.activity?.width ?? 0,
        left: layout.sizes.left?.width ?? 0,
        editor: layout.sizes.editor?.width ?? 0,
        right: layout.sizes.right?.width ?? 0,
    };
    const left = next.left ?? presented.left;
    const right = next.right ?? presented.right;
    const sizes = [presented.activity, left, presented.editor + (presented.left - left) + (presented.right - right), right];
    const total = sizes.reduce((sum, size) => sum + size, 0);
    return sizes.map((size) => size * 100 / total);
}

describe("壳层会话的工作面归属与手势提交", () => {
    it("Project 手势只提交主动字段，测量与程序布局不产生保存", async () => {
        const harness = storageHarness();
        const grid = shellGrid();
        const session = createShellSession(grid, harness);
        // 容器在宿主接手之前就测量过一次（壳层挂载即测量）：宿主必须继承它，否则手势全部被拒。
        session.setContainer({width: 1440, height: 864});
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        const before = session.preferences.value;
        const layoutBefore = grid.layout({width: 1440, height: 864});
        // 程序布局：只在容器里重算，不保存。
        session.setContainer({width: 1440, height: 864});
        expect(harness.saves).toHaveLength(0);

        const rightWidth = layoutBefore.sizes.right?.width ?? 0;
        const gestureSizes = gesturePercents(layoutBefore, {right: rightWidth + 20});
        const start = session.gestureStart({branchId: "main", sizes: gestureSizes});
        expect(start).toBe("started");
        const status = await session.gestureEnd({
            branchId: "main",
            active: ["editor", "right"],
            sizes: gestureSizes,
        });

        expect(status).toBe("saved");
        expect(harness.saves).toHaveLength(1);
        const saved = harness.records.get(harness.key("project", USER_OWNER, "layout"))?.value as
            | {root: {children: {id: string; children?: {id: string; size: {width: number}}[]}[]}}
            | undefined;
        const main = saved?.root.children.find((child) => child.id === "main");
        const left = main?.children?.find((child) => child.id === "left");
        const right = main?.children?.find((child) => child.id === "right");
        // 未主动改变的左栏保持记录里的意图（窄视口夹取与被动补偿都不进保存）。
        expect(left?.size.width).toBe(before.leftPanelWidth);
        expect(right?.size.width).toBeGreaterThan(before.agentPanelWidth);

        // 容器变化只重算呈现：保存次数不变。
        session.setContainer({width: 1400, height: 864});
        grid.layout({width: 1400, height: 864});
        expect(harness.saves).toHaveLength(1);
        await session.release();
    });

    it("用户资产与未开项目各自使用 user/local 记录，与 Project 尺寸独立", async () => {
        const harness = storageHarness();
        const grid = shellGrid();
        const session = createShellSession(grid, harness);

        await session.enterSurface({kind: "idle"});
        session.setContainer({width: 1440, height: 864});
        expect(session.preferences.value.leftPanelWidth).toBe(340);
        session.setContainer({width: 1440, height: 864});
        const idleSizes = gesturePercents(grid.layout({width: 1440, height: 864}), {left: 420});
        expect(session.gestureStart({branchId: "main", sizes: idleSizes})).toBe("started");
        expect(await session.gestureEnd({branchId: "main", active: ["left"], sizes: idleSizes})).toBe("saved");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 420});

        await session.enterSurface({kind: "user-assets"});
        // 用户资产是另一条记录：不继承未开项目的尺寸。
        expect(session.preferences.value.leftPanelWidth).toBe(340);

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        expect(session.preferences.value.leftPanelWidth).toBe(340);
        expect(harness.records.has(harness.key("project", USER_OWNER, "layout"))).toBe(false);
        await session.release();
    });

    it("切换工作面先提交旧目标意图再释放；失败时挡住切换并给出重试与放弃", async () => {
        const harness = storageHarness();
        const grid = shellGrid();
        const session = createShellSession(grid, harness);

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        const layout = grid.layout({width: 1440, height: 864});
        session.setContainer({width: 1440, height: 864});
        const gestureSizes = gesturePercents(layout, {right: (layout.sizes.right?.width ?? 0) + 20});
        session.gestureStart({branchId: "main", sizes: gestureSizes});
        await session.gestureEnd({branchId: "main", active: ["right"], sizes: gestureSizes});
        const afterOwn = harness.saves.length;

        // 让收口用的重放持续失败（明确拒绝：可重试，但自动重放已停止）。
        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_IO", status: 500, message: "后端不可达", committed: false});
        };
        const blockedSizes = gesturePercents(layout, {left: 520});
        session.gestureStart({branchId: "main", sizes: blockedSizes});
        const unsaved = await session.gestureEnd({branchId: "main", active: ["left"], sizes: blockedSizes});
        expect(unsaved).toBe("unsaved");
        expect(session.state.value.notice?.kind).toBe("unsaved");

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/b", publicId: "b-1"}});

        // 收口失败：切换被挡住，旧工作面仍然有效（记录没有被释放）。
        expect(session.state.value.pendingSurface).toBe("project");
        expect(session.state.value.notice?.kind).toBe("switch-blocked");
        expect(session.state.value.surface).toBe("project");

        // 明确放弃后离开：新工作面打开，且不再显示旧工作面的未保存状态。
        session.abandon();
        // 放弃立即清掉"切换被挡"的提示；随后排队释放旧工作面并打开新目标。
        expect(session.state.value.pendingSurface).toBeNull();
        expect(session.state.value.notice).toBeNull();
        // 放弃采用已确认值：旧工作面的记录仍是收口前那一次成功写入的内容。
        expect(harness.saves.length).toBe(afterOwn);
        await session.release();
    });

    it("旧工作面已失效（删除/断线）时不延迟切换，并把诊断归档到旧工作面名下", async () => {
        const harness = storageHarness();
        const grid = shellGrid();
        const session = createShellSession(grid, harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        // 授权撤销：宿主立即判定终止并停止接纳提交。
        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_UNAUTHORIZED", status: 401, message: "授权已撤销", committed: false});
        };
        session.setContainer({width: 1440, height: 864});
        const layout = grid.layout({width: 1440, height: 864});
        const sizes = gesturePercents(layout, {left: 520});
        session.gestureStart({branchId: "main", sizes});
        expect(await session.gestureEnd({branchId: "main", active: ["left"], sizes})).toBe("unsaved");

        await session.enterSurface({kind: "user-assets"});

        expect(session.state.value.surface).toBe("user-assets");
        expect(session.state.value.pendingSurface).toBeNull();
        expect(session.state.value.notice).toBeNull();
        expect(session.state.value.issues.join("\n")).toContain("旧工作面");
        await session.release();
    });
});

/** 壳层会话：真实 grid + 真实宿主，只有 Storage 适配器是替身。 */
function createShellSession(grid: Grid<string>, harness: Harness): WorkbenchLayoutSession {
    return createWorkbenchLayoutSession({
        grid,
        resolveRef: shellRefResolver(() => VIEWPORT.width),
        hidden: () => [],
        adapters: harness.adapters,
    });
}
