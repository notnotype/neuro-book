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
import type {Grid, GridLayoutResult} from "@notnotype/nb-ui/layout";
import {
    createLayoutRecordSession,
    createWorkbenchLayoutSession,
    useWorkbenchShelfMode,
    type LayoutRecordCommitResult,
    type WorkbenchLayoutSession,
    type WorkbenchShelfModeConsumer,
    type WorkbenchSurfaceSizesPatch,
} from "nbook/app/utils/workbench/layout-session";
import {createShellGrid, projectShell, SHELL_PANEL_DEFAULT_HEIGHT, SHELL_SIZE_DEFAULTS} from "nbook/app/utils/workbench/layout";
import {SHELL_PANEL_DEFAULTS} from "nbook/app/utils/workbench/panel-state";
import {shellRefResolver} from "nbook/app/utils/workbench/shell-layout";
import {
    WORKBENCH_PANEL_SIZE_KEY,
    WORKBENCH_SURFACE_PANEL_SIZE_KEY,
} from "nbook/shared/storage/workbench-panel-size";
import {
    WORKBENCH_SHELL_DEFAULT_LAYOUT,
    WORKBENCH_SHELL_LAYOUT_KEY,
} from "nbook/shared/storage/workbench-shell-layout";
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

/** 会话用例使用的记录树：默认拓扑（与 `WORKBENCH_SHELL_DEFAULT_LAYOUT` 同源）。 */
function shellGrid(): Grid<string> {
    return createShellGrid(projectShell({
        extent: VIEWPORT,
        preferences: SHELL_SIZE_DEFAULTS,
        panel: {...SHELL_PANEL_DEFAULTS, maximized: false},
        hiddenParts: [],
    }));
}

/** 快照里按 id 找节点：断言写入的是哪一片叶，不依赖它在记录里的深度。 */
function nodeOf(record: unknown, id: string): {readonly size: {readonly width: number; readonly height: number}} | null {
    const walk = (node: unknown): {readonly size: {readonly width: number; readonly height: number}} | null => {
        if (typeof node !== "object" || node === null) {
            return null;
        }
        const candidate = node as {readonly id?: unknown; readonly children?: unknown};
        if (candidate.id === id) {
            return candidate as {readonly size: {readonly width: number; readonly height: number}};
        }
        if (Array.isArray(candidate.children)) {
            for (const child of candidate.children) {
                const hit = walk(child);
                if (hit !== null) {
                    return hit;
                }
            }
        }
        return null;
    };
    const root = (record as {readonly root?: unknown} | undefined)?.root;
    return walk(root);
}

/** 面板尺寸记录里的值（记录缺失或形状不对时 undefined）。 */
function panelSizeOf(harness: Harness, scope: "project" | "user", key: string, resource?: string): {height?: number; width?: number} | undefined {
    const value = harness.records.get(harness.key(scope, USER_OWNER, key, resource))?.value;
    return typeof value === "object" && value !== null ? value as {height?: number; width?: number} : undefined;
}

/** 一次 Project 会话的公共装配：记录树 + 真实宿主 + 替身传输。 */
function createShellSession(grid: Grid<string>, harness: Harness): WorkbenchLayoutSession {
    return createWorkbenchLayoutSession({
        grid,
        resolveRef: shellRefResolver(() => VIEWPORT.width),
        adapters: harness.adapters,
    });
}

/** Project 记录（`workbench.layout/layout`）里的原始值。 */
function projectRecord(harness: Harness): unknown {
    return harness.records.get(harness.key("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY))?.value;
}

describe("壳层会话的尺寸路由与工作面带际", () => {
    it("Project 宽度提交只改原件里的主动叶：其它叶、结构与未知字段逐字保留", async () => {
        const harness = storageHarness();
        const grid = shellGrid();
        const session = createShellSession(grid, harness);
        // 先放一份带未知字段的已确认记录（原件才是合成底本）。
        harness.write("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY, {
            ...WORKBENCH_SHELL_DEFAULT_LAYOUT,
            futureTopLevel: "keep",
        }, undefined, 2);

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        // 恢复/测量/首读都不产生保存。
        expect(harness.saves).toEqual([]);
        expect(session.preferences.value.leftPanelWidth).toBe(340);

        const receipt = await session.commitSizes({
            contextKey: session.contextKey.value,
            patch: {leftPanelWidth: 420},
        });

        expect(receipt.status).toBe("saved");
        // 分项回执只列出本次真正写过的 owner：纯宽度补丁不虚构面板项。
        expect(receipt.records).toEqual({widths: "saved"});
        expect(harness.saves).toEqual([harness.key("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY)]);
        // 会话绝不把运行时的呈现树序列化回记录底本：记录树本身逐字不变（宽度靠本地呈现覆盖）。
        expect(JSON.stringify(grid.serialize())).toBe(JSON.stringify(shellGrid().serialize()));
        const saved = projectRecord(harness) as {readonly futureTopLevel?: unknown; readonly root: unknown};
        expect(saved.futureTopLevel).toBe("keep");
        expect(nodeOf(saved, "left")?.size.width).toBe(420);
        // 未主动改变的右栏保持原件意图；记录拓扑没有被运行时的呈现树覆盖。
        expect(nodeOf(saved, "right")?.size.width).toBe(400);
        expect(nodeOf(saved, "activity")?.size.width).toBe(60);
        expect(nodeOf(saved, "panel")).not.toBeNull();
        // 本窗口呈现立刻按新宽度走（不等回执也不回退）。
        expect(session.preferences.value).toMatchObject({leftPanelWidth: 420, agentPanelWidth: 400});
        await session.release();
    });

    it("面板两个轴各自独立记忆：高度不覆盖宽度，宽度不覆盖高度，且都不写 grid 记录", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {panelHeight: 320}})).status).toBe("saved");
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 320});
        expect(harness.records.has(harness.key("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY))).toBe(false);

        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {panelWidth: 260}})).status).toBe("saved");
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 320, width: 260});

        // 高度再改：宽度留在记录里，不被覆盖。
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {panelHeight: 400}})).status).toBe("saved");
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 400, width: 260});
        expect(session.panelSize.value).toEqual({height: 400, width: 260});

        // 只有面板尺寸记录被写过两次：grid 记录一次都没出现（宽度/高度都没有被当成 grid 字段写进去）。
        expect(harness.saves).toEqual([
            harness.key("project", USER_OWNER, WORKBENCH_PANEL_SIZE_KEY),
            harness.key("project", USER_OWNER, WORKBENCH_PANEL_SIZE_KEY),
            harness.key("project", USER_OWNER, WORKBENCH_PANEL_SIZE_KEY),
        ]);
        await session.release();
    });

    it("面板尺寸写入先按产品区间夹取：高度 80..600、宽度 160..600，未知字段与另一轴保留", async () => {
        const harness = storageHarness();
        // 预置一条带未知字段的面板尺寸记录（记录缺失时首读也不补写默认值）。
        harness.write("project", USER_OWNER, WORKBENCH_PANEL_SIZE_KEY, {height: 300, note: "keep"});
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        expect(session.panelSize.value).toEqual({height: 300, width: 320});

        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {panelHeight: 900}})).status).toBe("saved");
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 600, note: "keep"});
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {panelWidth: 100}})).status).toBe("saved");
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 600, width: 160, note: "keep"});

        // 本窗口呈现保留本次**接纳**的未夹取意图（几何层在投影里再夹）；记录才是落盘的那份。
        expect(session.panelSize.value).toEqual({height: 900, width: 100});

        // 换工作面再回来：记录是唯一事实，越界意图不会跨工作面存活。
        await session.enterSurface({kind: "idle"});
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        expect(session.panelSize.value).toEqual({height: 600, width: 160});
        await session.release();
    });

    it("一份补丁跨两条记录：宽度与面板各自写入，同一场地都落账", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        const receipt = await session.commitSizes({
            contextKey: session.contextKey.value,
            patch: {leftPanelWidth: 420, panelHeight: 300},
        });

        expect(receipt.status).toBe("saved");
        expect(receipt.records).toEqual({widths: "saved", panel: "saved"});
        expect(nodeOf(projectRecord(harness), "left")?.size.width).toBe(420);
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 300});
        expect(session.state.value.notice).toBeNull();
        await session.release();
    });

    it("一条记录写失败不回滚另一条：回执分项说明，成功项仍然有效", async () => {
        const harness = storageHarness();
        // 预置面板尺寸记录：失败必须停在这一条，不能顺带丢掉网格记录里的宽度。
        harness.write("project", USER_OWNER, WORKBENCH_PANEL_SIZE_KEY, {height: 260});
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        // 只让面板尺寸记录失败：宽度写入照常进行，且不被回滚。
        harness.hook.beforeSave = (action) => {
            if (action.key === WORKBENCH_PANEL_SIZE_KEY) {
                throw new StorageAdapterError({code: "STORAGE_IO", status: 500, message: "后端不可达", committed: false});
            }
        };
        const receipt = await session.commitSizes({
            contextKey: session.contextKey.value,
            patch: {leftPanelWidth: 420, panelHeight: 300},
        });

        expect(receipt.status).toBe("unsaved");
        expect(receipt.records).toEqual({widths: "saved", panel: "unsaved"});
        // 宽度那次写入已经生效；面板停在旧的已确认值上，呈现仍保留本次接纳的意图。
        expect(nodeOf(projectRecord(harness), "left")?.size.width).toBe(420);
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 260});
        expect(session.panelSize.value.height).toBe(300);
        expect(session.state.value.notice?.kind).toBe("unsaved");

        // 重试只补未确认的那一项：宽度不再写第二遍。
        harness.hook.beforeSave = null;
        await session.retry();
        expect(panelSizeOf(harness, "project", WORKBENCH_PANEL_SIZE_KEY)).toEqual({height: 300});
        expect(harness.saves).toEqual([
            harness.key("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY),
            harness.key("project", USER_OWNER, WORKBENCH_PANEL_SIZE_KEY),
        ]);
        await session.release();
    });

    it("工作面代际不匹配的尺寸补丁被拒绝：旧工作面的迟到手势不会写进新记录", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        const stale = session.contextKey.value;

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/b", publicId: "b-1"}});
        expect(session.contextKey.value).not.toBe(stale);

        const receipt = await session.commitSizes({contextKey: stale, patch: {leftPanelWidth: 500}});

        expect(receipt.status).toBe("rejected");
        expect(receipt.records).toEqual({widths: "rejected", panel: "rejected"});
        expect(harness.saves).toEqual([]);
        expect(session.state.value.issues.join("\n")).toContain("代际已过期");
        await session.release();
    });

    it("同字段的新意图覆盖旧本地意图：旧调用不写盘，也不把呈现改回去", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        const key = session.contextKey.value;

        const older = session.commitSizes({contextKey: key, patch: {leftPanelWidth: 420}});
        const newer = session.commitSizes({contextKey: key, patch: {leftPanelWidth: 460}});
        const [olderReceipt, newerReceipt] = await Promise.all([older, newer]);

        expect(newerReceipt.status).toBe("saved");
        expect(olderReceipt.status).toBe("unchanged");
        expect(harness.saves).toEqual([harness.key("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY)]);
        expect(nodeOf(projectRecord(harness), "left")?.size.width).toBe(460);
        expect(session.preferences.value.leftPanelWidth).toBe(460);
        expect(session.state.value.notice).toBeNull();
        await session.release();
    });

    it("失败保留本地意图与诊断，重试成功后收口，放弃回到已确认值", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        const key = session.contextKey.value;

        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_IO", status: 500, message: "后端不可达", committed: false});
        };
        const unsaved = await session.commitSizes({contextKey: key, patch: {leftPanelWidth: 520}});

        expect(unsaved.status).toBe("unsaved");
        expect(unsaved.records).toEqual({widths: "unsaved"});
        expect(session.state.value.notice).toMatchObject({kind: "unsaved", surface: "project"});
        // 失败不回退呈现：本地意图仍然生效。
        expect(session.preferences.value.leftPanelWidth).toBe(520);

        harness.hook.beforeSave = null;
        await session.retry();
        expect(nodeOf(projectRecord(harness), "left")?.size.width).toBe(520);
        expect(session.state.value.notice).toBeNull();

        // 再制造一次失败后放弃：呈现回到已确认值（520），未确认的 600 不再显示。
        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_IO", status: 500, message: "后端不可达", committed: false});
        };
        await session.commitSizes({contextKey: key, patch: {leftPanelWidth: 600}});
        expect(session.preferences.value.leftPanelWidth).toBe(600);

        session.abandon();
        expect(session.preferences.value.leftPanelWidth).toBe(520);
        expect(session.state.value.notice).toBeNull();
        await session.release();
    });

    it("旧 v2 记录（不同父链）读回左右偏好；首读与默认发布都不写盘", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        harness.write("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY, LEGACY_SHELL_LAYOUT, undefined, 2);

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        expect(session.preferences.value).toEqual({leftPanelWidth: 512, agentPanelWidth: 400});
        expect(harness.saves).toEqual([]);

        // 在旧记录上提交宽度：原件里的叶被改写，旧拓扑与未知字段都保留。
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {agentPanelWidth: 380}})).status).toBe("saved");
        const saved = projectRecord(harness) as {readonly note?: unknown};
        expect(saved.note).toBe("keep");
        expect(nodeOf(saved, "left")?.size.width).toBe(512);
        expect(nodeOf(saved, "right")?.size.width).toBe(380);
        await session.release();
    });

    it("user 面写自己的工作面记录：不碰 Project grid，也不跨工作面继承", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);

        await session.enterSurface({kind: "idle"});
        expect(session.preferences.value.leftPanelWidth).toBe(340);
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {leftPanelWidth: 420}})).status).toBe("saved");
        expect(harness.records.get(harness.key("user", USER_OWNER, WORKBENCH_SURFACE_SIZES_KEY, "idle"))?.value)
            .toEqual({leftPanelWidth: 420});
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {panelHeight: 230}})).status).toBe("saved");
        expect(panelSizeOf(harness, "user", WORKBENCH_SURFACE_PANEL_SIZE_KEY, "idle")).toEqual({height: 230});

        // 用户资产是另一条资源：不继承未开项目的尺寸与面板高度。
        await session.enterSurface({kind: "user-assets"});
        expect(session.preferences.value.leftPanelWidth).toBe(340);
        expect(session.panelSize.value.height).toBe(SHELL_PANEL_DEFAULT_HEIGHT);

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        expect(session.preferences.value.leftPanelWidth).toBe(340);
        expect(harness.records.has(harness.key("project", USER_OWNER, WORKBENCH_SHELL_LAYOUT_KEY))).toBe(false);
        await session.release();
    });

    it("切换工作面先提交已接纳的尺寸意图再释放；失败时挡住切换并给出重试与放弃", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {leftPanelWidth: 420}})).status).toBe("saved");
        const afterOwn = harness.saves.length;

        // 让收口用的重放持续失败（明确拒绝：可重试，但自动重放已停止）。
        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_IO", status: 500, message: "后端不可达", committed: false});
        };
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {leftPanelWidth: 520}})).status).toBe("unsaved");
        expect(session.state.value.notice?.kind).toBe("unsaved");

        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/b", publicId: "b-1"}});

        // 收口失败：切换被挡住，旧工作面仍然有效（记录没有被释放）。
        expect(session.state.value.pendingSurface).toBe("project");
        expect(session.state.value.notice?.kind).toBe("switch-blocked");
        expect(session.state.value.surface).toBe("project");

        // 明确放弃后离开：新工作面打开，且不再显示旧工作面的未保存状态。
        session.abandon();
        expect(session.state.value.pendingSurface).toBeNull();
        expect(session.state.value.notice).toBeNull();
        // 放弃采用已确认值：旧工作面的记录仍是收口前那一次成功写入的内容。
        expect(harness.saves.length).toBe(afterOwn);
        await session.release();
    });

    it("旧工作面已失效（删除/断线）时不延迟切换，并把诊断归档到旧工作面名下", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});

        // 授权撤销：宿主立即判定终止并停止接纳提交。
        harness.hook.beforeSave = () => {
            throw new StorageAdapterError({code: "STORAGE_UNAUTHORIZED", status: 401, message: "授权已撤销", committed: false});
        };
        expect((await session.commitSizes({contextKey: session.contextKey.value, patch: {leftPanelWidth: 520}})).status).toBe("unsaved");

        await session.enterSurface({kind: "user-assets"});

        expect(session.state.value.surface).toBe("user-assets");
        expect(session.state.value.pendingSurface).toBeNull();
        expect(session.state.value.notice).toBeNull();
        expect(session.state.value.issues.join("\n")).toContain("旧工作面");
        await session.release();
    });

    it("释放后不再接受尺寸提交", async () => {
        const harness = storageHarness();
        const session = createShellSession(shellGrid(), harness);
        await session.enterSurface({kind: "project", ready: {projectRoot: "/projects/a", publicId: "a-1"}});
        const key = session.contextKey.value;
        await session.release();

        expect((await session.commitSizes({contextKey: key, patch: {leftPanelWidth: 420}})).status).toBe("rejected");
        expect(harness.saves).toEqual([]);
    });
});

/**
 * 本增量之前的 v2 记录：`root V{titlebar, main H{activity, left, editor, right}, panel, statusbar}`。
 * left/right 直接挂在 main 下（新默认在 body 里），并且带一个未知顶层字段——
 * 恢复按叶 id 读宽度，合成时未知字段必须保留。
 */
const LEGACY_SHELL_LAYOUT = {
    version: 2,
    note: "keep",
    root: {
        kind: "branch",
        id: "root",
        orientation: "vertical",
        size: {width: 0, height: 0},
        children: [
            {kind: "leaf", id: "titlebar", ref: "titlebar", size: {width: 0, height: 36}},
            {
                kind: "branch",
                id: "main",
                orientation: "horizontal",
                size: {width: 0, height: 864},
                children: [
                    {kind: "leaf", id: "activity", ref: "activity", size: {width: 60, height: 0}},
                    {kind: "leaf", id: "left", ref: "left", size: {width: 512, height: 0}},
                    {kind: "leaf", id: "editor", ref: "editor", size: {width: 526, height: 0}},
                    {kind: "leaf", id: "right", ref: "right", size: {width: 400, height: 0}},
                ],
            },
        ],
    },
};
