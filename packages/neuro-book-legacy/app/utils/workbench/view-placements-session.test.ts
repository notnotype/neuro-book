import {effectScope} from "vue";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {StorageAdapterError, type StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import {
    useWorkbenchViewPlacements,
    type ViewPlacementsOutcome,
    type WorkbenchViewPlacementsConsumer,
} from "nbook/app/utils/workbench/view-placements-session";
import {
    containersOfPart,
    placementCatalogOf,
    readEffectiveContainerPlacements,
} from "nbook/app/utils/workbench/view-placements";
import {createWorkbenchRegistry, type WorkbenchCatalog, type WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import {resolveViewPresentation} from "nbook/app/utils/workbench/product-catalog";
import {
    WORKBENCH_VIEW_CUSTOMIZATIONS_KEY,
    WORKBENCH_VIEWS_OWNER,
    type WorkbenchViewCustomizationsRecord,
    type WorkbenchViewPlacementRecord,
} from "nbook/shared/storage/workbench-views";

/**
 * 位置记录会话的行为：首读门禁、一次合成多个字段、View 尺寸整批接纳/整批拒绝、
 * 失败回执不丢后续意图、外来订阅只推进合成底本、陈旧来源与锚点在动作边界被拒、
 * CAS 冲突重读后的幂等与冲突、损坏记录整条保护。
 *
 * 走真实记录会话（读取分类、条件写、订阅都来自产品实现），只把传输换成替身：
 * 断言的落点是**记录里的 JSON、本窗口呈现与命令回执**，不是 stub 的调用次数。
 */

const CLIENT_CREDENTIAL = "0123456789abcdef".repeat(4);
const RECORD_KEY = `${WORKBENCH_VIEWS_OWNER}/${WORKBENCH_VIEW_CUSTOMIZATIONS_KEY}/`;
const FILES = SHELL_FILES_VIEW.id;
const OUTLINE = "nbook.outline";
const TERMINAL = "nbook.terminal";
const LEFT = SHELL_LEFT_CONTAINER.id;
const RIGHT = SHELL_RIGHT_CONTAINER.id;
const PANEL = SHELL_PANEL_CONTAINER.id;

const CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER, SHELL_PANEL_CONTAINER],
    views: [
        SHELL_FILES_VIEW,
        {...SHELL_FILES_VIEW, id: OUTLINE, titleKey: "ide.toolPanel.outline", order: 20},
        {...SHELL_FILES_VIEW, id: TERMINAL, titleKey: "ide.toolPanel.terminal", container: PANEL, order: 10},
    ],
};

function registryOf(catalog: WorkbenchCatalog = CATALOG) {
    const created = createWorkbenchRegistry(catalog);
    if (!created.ok) {
        throw new Error(created.reason);
    }
    return created.value;
}

/** Project 开着、三个视图都可见的上下文：移动与尺寸命令的可见性判据用的是它。 */
const PROJECT_CONTEXT: WorkbenchContext = {
    project: true,
    selection: false,
    "user-assets": false,
    desktop: false,
    authorities: {project: true, session: false, job: false, files: true},
    projectRoot: "/workspace/demo",
};

type StoredRecord = {value: unknown; revision: string; schemaVersion: number};

/** 读取闸：首读门禁测试用它把读取停在"未分类"状态。 */
type ReadGate = {readonly reads: Promise<void>; readonly release: () => void};

function readGate(): ReadGate {
    const {promise, resolve} = Promise.withResolvers<void>();
    return {reads: promise, release: resolve};
}

type Harness = {
    readonly records: Map<string, StoredRecord>;
    readonly fixedReads: Map<string, StorageReadResult<unknown>>;
    readonly saves: string[];
    readonly hooks: {
        beforeSave: ((key: string) => void) | null;
        /** 请求已经在后端落盘、应答在回程丢了：客户端只知道"结果未确认"。 */
        loseSaveResponse: boolean;
    };
    readonly adapters: WorkbenchStorageAdapters;
    holdReads(): () => void;
    write(value: unknown, schemaVersion?: number): void;
};

/**
 * 最小的 Storage 替身：身份 + 条件读写 + 可注入的读取结果。
 *
 * `beforeSave` 让测试在"提交到达后端之前"插入另一个窗口的写入——这正是条件写冲突的成因，
 * 因此它既是故障注入点，也是最真实的多窗口竞争模拟。
 *
 * 观察间隔取 10ms（记录会话的订阅会按它轮询），订阅测试用假计时器推进——不等待真实时间。
 */
function storageHarness(): Harness {
    const records = new Map<string, StoredRecord>();
    const fixedReads = new Map<string, StorageReadResult<unknown>>();
    const saves: string[] = [];
    const hooks: Harness["hooks"] = {beforeSave: null, loseSaveResponse: false};
    const gate: {current: ReadGate} = {current: {reads: Promise.resolve(), release: () => undefined}};
    let sequence = 0;
    const credential = (revision: string | null): StorageCredential => ({revision, partitionGeneration: 1});

    const transport: StorageValueTransport = {
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") {
                return {kind: "bind", binding: {local: 1, shared: 1}};
            }
            const key = `${action.owner}/${action.key}/${action.resource ?? ""}`;
            if (action.kind === "read") {
                await gate.current.reads;
                const fixed = fixedReads.get(key);
                if (fixed !== undefined) {
                    return {kind: "read", result: fixed};
                }
                const record = records.get(key);
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
                return {
                    kind: "read",
                    result: {
                        kind: "value",
                        value: record.value,
                        schemaVersion: record.schemaVersion,
                        credential: credential(record.revision),
                    },
                };
            }
            if (action.kind === "save") {
                hooks.beforeSave?.(key);
                const record = records.get(key);
                if ((record?.revision ?? null) !== action.expected.revision) {
                    throw new StorageAdapterError({
                        code: "STORAGE_REVISION_CONFLICT",
                        status: 409,
                        message: "记录已被其它窗口改写",
                        committed: false,
                    });
                }
                records.set(key, {
                    value: action.value,
                    revision: `revision-${++sequence}`,
                    schemaVersion: action.schemaVersion,
                });
                saves.push(key);
                if (hooks.loseSaveResponse) {
                    throw new StorageAdapterError({
                        code: "STORAGE_UNAVAILABLE",
                        status: 504,
                        message: "应答在回程丢失",
                        committed: null,
                    });
                }
                return {kind: "save", credential: credential(`revision-${sequence}`)};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    };

    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({
            status: "ready",
            session: {scope: "user", contextId: "user".padEnd(64, "u"), clientCredential: CLIENT_CREDENTIAL},
        }),
        openProjectContext: async () => ({
            status: "unavailable",
            reason: "target-invalid",
            diagnosis: "本测试不涉及 Project Storage",
            code: null,
            statusCode: null,
        }),
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport,
            subscribe: {intervalMs: 10, maxBackoffMs: 50},
        }),
        closeContext: async () => undefined,
    };

    return {
        records,
        fixedReads,
        saves,
        hooks,
        adapters,
        holdReads(): () => void {
            gate.current = readGate();
            return gate.current.release;
        },
        write(value: unknown, schemaVersion = 1): void {
            records.set(RECORD_KEY, {value, revision: `revision-${++sequence}`, schemaVersion});
        },
    };
}

function openSession(
    harness: Harness,
    catalog: WorkbenchCatalog = CATALOG,
    context: () => WorkbenchContext = () => PROJECT_CONTEXT,
): {consumer: WorkbenchViewPlacementsConsumer; stop(): void} {
    const scope = effectScope();
    const consumer = scope.run(() => useWorkbenchViewPlacements({
        context,
        registry: registryOf(catalog),
        adapters: harness.adapters,
    }))!;
    return {
        consumer,
        stop: () => {
            scope.stop();
        },
    };
}

/**
 * 只推进微任务直到条件成立：被等待的链路全是 Promise（没有真实定时器参与），
 * 因此不需要真实时间，也不会因为机器负载产生假失败。
 */
async function flushUntil(condition: () => boolean): Promise<void> {
    for (let step = 0; step < 2000 && !condition(); step += 1) {
        await Promise.resolve();
    }
    if (!condition()) {
        throw new Error("等待条件成立失败（微任务已推进到底）");
    }
}

function storedRecord(harness: Harness): WorkbenchViewCustomizationsRecord | undefined {
    return harness.records.get(RECORD_KEY)?.value as WorkbenchViewCustomizationsRecord | undefined;
}

function placementOf(
    containerId: string,
    order: number,
    fingerprint: {containerId: string; order: number},
): WorkbenchViewPlacementRecord {
    return {
        containerId,
        order,
        defaultContainerId: fingerprint.containerId,
        defaultOrder: fingerprint.order,
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("useWorkbenchViewPlacements：移动与选择", () => {
    it("不可移动 View 拒绝独立容器创建，不保存孤儿容器或归属覆盖", async () => {
        const harness = storageHarness();
        const blocked = {...CATALOG, views: CATALOG.views.map((view) => ({...view, canMoveView: false}))};
        const opened = openSession(harness, blocked);
        await flushUntil(() => !opened.consumer.loading.value);
        const outcome = await opened.consumer.detachView({
            viewId: FILES, sourceContainerId: LEFT, targetLocation: "panel", contextKey: opened.consumer.contextKey(),
        });
        expect(outcome.status).toBe("rejected");
        expect(storedRecord(harness)).toBeUndefined();
        expect(opened.consumer.record.value.placements).toEqual({});
        opened.stop();
    });
    it("独立容器保存应答丢失不重复创建，重新打开会话仍能移动其中的视图", async () => {
        const harness = storageHarness();
        const first = openSession(harness);
        await flushUntil(() => !first.consumer.loading.value);
        harness.hooks.loseSaveResponse = true;
        const outcome = await first.consumer.detachView({
            viewId: FILES, sourceContainerId: LEFT, targetLocation: "panel",
            contextKey: first.consumer.contextKey(),
        });
        expect(outcome.status).toBe("unchanged");
        const saved = storedRecord(harness)!;
        const containerId = saved.placements[FILES]!.containerId;
        expect(Object.keys(saved.customContainers ?? {})).toEqual([containerId]);
        expect(harness.saves).toHaveLength(1);
        first.stop();
        harness.hooks.loseSaveResponse = false;
        const reopened = openSession(harness);
        await flushUntil(() => !reopened.consumer.loading.value);
        const record = reopened.consumer.record.value;
        const presentation = resolveViewPresentation({
            registry: registryOf(), context: PROJECT_CONTEXT, overrides: record.placements,
            customContainers: record.customContainers, containerOverrides: record.containerPlacements,
            activeContainerByPart: record.activeContainerByPart,
        });
        expect(presentation.part("panel").activeContainerId).toBe(containerId);
        expect(presentation.container(containerId)?.memberViewIds).toEqual([FILES]);
        expect((await reopened.consumer.moveView({viewId: FILES, sourceContainerId: containerId, targetContainerId: LEFT})).status).toBe("saved");
        expect(storedRecord(harness)?.customContainers?.[containerId]).toBeUndefined();
        expect(storedRecord(harness)?.placements[FILES]?.containerId ?? LEFT).toBe(LEFT);
        reopened.stop();
    });

    it("边缘并入同次保存目标半区与来源3比1份额，另一轴尺寸保留", async () => {
        const harness = storageHarness();
        harness.write({version: 1, placements: {}, viewSizes: {[FILES]: {height: 300}, [OUTLINE]: {height: 100}}});
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);
        const outcome = await opened.consumer.mergeContainer({
            sourceContainerId: LEFT, sourceLocation: "sidebar-left", targetContainerId: PANEL, targetLocation: "panel",
            sourceViewIds: [FILES, OUTLINE], beforeViewId: TERMINAL, contextKey: opened.consumer.contextKey(),
            split: {targetViewId: TERMINAL, side: "before", axis: "width", targetSizes: {[TERMINAL]: 800}, sourceSizes: {[FILES]: 300, [OUTLINE]: 100}},
        });
        expect(outcome.status).toBe("saved");
        const saved = storedRecord(harness)!;
        expect(saved.viewSizes?.[TERMINAL]?.width).toBe(400);
        expect(saved.viewSizes?.[FILES]).toMatchObject({width: 300, height: 300});
        expect(saved.viewSizes?.[OUTLINE]).toMatchObject({width: 100, height: 100});
        expect([FILES, OUTLINE].map((viewId) => saved.placements[viewId]?.containerId)).toEqual([PANEL, PANEL]);
        expect(harness.saves).toHaveLength(1);
        opened.stop();
    });
    it("首读门禁：读取未分类前移动被拒且不落盘；读完后一次移动写出归属、目标活动容器与指纹", async () => {
        const harness = storageHarness();
        const release = harness.holdReads();
        const opened = openSession(harness);

        await flushUntil(() => opened.consumer.loading.value);
        const rejected = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        expect(rejected.status).toBe("rejected");
        expect(rejected.diagnosis).toContain("没完成首次读取");
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.record.value.placements).toEqual({});

        release();
        await flushUntil(() => !opened.consumer.loading.value);
        // 首读完成不写默认记录：没有用户动作就没有新记录（缺失时按产品默认呈现）。
        expect(harness.saves).toEqual([]);
        const saved = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        expect(saved.status).toBe("saved");
        expect(harness.saves).toEqual([RECORD_KEY]);
        expect(storedRecord(harness)).toEqual({
            version: 1,
            placements: {
                [FILES]: {containerId: PANEL, order: 11, defaultContainerId: LEFT, defaultOrder: 10},
            },
            activeContainerByPart: {panel: PANEL},
        });
        expect(opened.consumer.record.value.placements[FILES]?.containerId).toBe(PANEL);
        opened.stop();
    });

    it("同容器换序：插到锚点之前，一次写入写归属与顺序", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const reordered = await opened.consumer.moveView({
            viewId: OUTLINE,
            sourceContainerId: LEFT,
            targetContainerId: LEFT,
            beforeViewId: FILES,
        });

        expect(reordered.status).toBe("saved");
        expect(storedRecord(harness)?.placements[OUTLINE]).toEqual({
            containerId: LEFT,
            order: 5,
            defaultContainerId: LEFT,
            defaultOrder: 20,
        });
        opened.stop();
    });

    it("陈旧来源与已变锚点都在动作边界拒绝，不落盘、本窗口呈现保持原样", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {[FILES]: placementOf(PANEL, 11, {containerId: LEFT, order: 10})},
            activeContainerByPart: {panel: PANEL},
        });
        const opened = openSession(harness);

        await flushUntil(() => !opened.consumer.loading.value);
        const staleSource = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: RIGHT});
        const staleAnchor = await opened.consumer.moveView({
            viewId: FILES,
            sourceContainerId: PANEL,
            targetContainerId: LEFT,
            beforeViewId: "nbook.ghost",
        });

        expect(staleSource.status).toBe("rejected");
        expect(staleSource.diagnosis).toContain("来源容器");
        expect(staleAnchor.status).toBe("rejected");
        expect(staleAnchor.diagnosis).toContain("锚点");
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.record.value.placements[FILES]?.containerId).toBe(PANEL);
        opened.stop();
    });

    it("容器整体移动写出落位覆盖并选中目标 Part；视图归属不动", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {[FILES]: placementOf(PANEL, 11, {containerId: LEFT, order: 10})},
            hiddenSidebars: {left: true},
            dragCollapsedParts: {panel: true},
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const moved = await opened.consumer.moveContainer({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
        });

        expect(moved.status).toBe("saved");
        const stored = storedRecord(harness);
        expect(stored?.containerPlacements?.[LEFT]).toEqual({
            location: "panel",
            order: 31,
            defaultLocation: "sidebar-left",
            defaultOrder: 10,
        });
        expect(stored?.placements[FILES]).toEqual(placementOf(PANEL, 11, {containerId: LEFT, order: 10}));
        expect(stored?.activeContainerByPart).toEqual({panel: LEFT});
        // 目标 Part 显式打开（清拖收起），源 Part 的显式隐藏不动。
        expect(stored?.dragCollapsedParts).toEqual({panel: false});
        expect(stored?.hiddenSidebars).toEqual({left: true});
        opened.stop();
    });

    it("选择容器写活动容器并清掉该 Part 的显式隐藏与拖收起", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {},
            activeContainerByPart: {left: RIGHT},
            hiddenSidebars: {left: true},
            dragCollapsedParts: {left: true},
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const selected = await opened.consumer.selectContainer("left", LEFT);

        expect(selected.status).toBe("saved");
        expect(storedRecord(harness)?.activeContainerByPart).toEqual({left: LEFT});
        expect(storedRecord(harness)?.hiddenSidebars).toEqual({left: false});
        expect(storedRecord(harness)?.dragCollapsedParts).toEqual({left: false});
        opened.stop();
    });

    it("未登记容器与容器不在该 Part 时选择被拒", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const unknown = await opened.consumer.selectContainer("left", "nbook.ghost");
        const wrongPart = await opened.consumer.selectContainer("left", PANEL);

        expect(unknown.status).toBe("rejected");
        expect(unknown.diagnosis).toContain("未登记或不可落位");
        expect(wrongPart.status).toBe("rejected");
        expect(wrongPart.diagnosis).toContain("当前不在 Part left 里");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("恢复视图位置与恢复容器落位各只删自己的覆盖", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {
                [FILES]: placementOf(PANEL, 11, {containerId: LEFT, order: 10}),
                [OUTLINE]: placementOf(RIGHT, 3, {containerId: LEFT, order: 20}),
            },
            containerPlacements: {
                [PANEL]: {location: "sidebar-left", order: 11, defaultLocation: "panel", defaultOrder: 30},
            },
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const viewRestored = await opened.consumer.restoreViewPlacement(FILES);
        const containerRestored = await opened.consumer.restoreContainerPlacement(PANEL);

        expect(viewRestored.status).toBe("saved");
        expect(containerRestored.status).toBe("saved");
        expect(Object.keys(storedRecord(harness)?.placements ?? {})).toEqual([OUTLINE]);
        expect(storedRecord(harness)?.containerPlacements).toBeUndefined();
        opened.stop();
    });

    it("没有覆盖时恢复是无变更（不写盘）", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        expect((await opened.consumer.restoreViewPlacement(FILES)).status).toBe("unchanged");
        expect((await opened.consumer.restoreContainerPlacement(PANEL)).status).toBe("unchanged");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("揭示视图：选中它的生效容器、打开目标 Part、清掉 View 与 Panel 的内容收起", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {[FILES]: placementOf(PANEL, 11, {containerId: LEFT, order: 10})},
            activeContainerByPart: {panel: LEFT},
            dragCollapsedParts: {panel: true},
            panelCollapsed: true,
            viewSizes: {[FILES]: {height: 300, collapsed: true}},
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const revealed = await opened.consumer.revealView(FILES);

        expect(revealed.status).toBe("saved");
        const stored = storedRecord(harness);
        expect(stored?.activeContainerByPart).toEqual({panel: PANEL});
        expect(stored?.dragCollapsedParts).toEqual({panel: false});
        expect(stored?.panelCollapsed).toBe(false);
        expect(stored?.viewSizes).toEqual({[FILES]: {height: 300, collapsed: false}});
        opened.stop();
    });

    it("揭示未登记的视图被拒：不落盘", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const revealed = await opened.consumer.revealView("nbook.ghost");

        expect(revealed.status).toBe("rejected");
        expect(revealed.diagnosis).toContain("未登记的视图");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });
});

describe("useWorkbenchViewPlacements：Part 显隐与 View 尺寸", () => {
    it("侧栏的显式隐藏与拖收起同次落盘", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setPartVisibility({partId: "left", hidden: true, dragCollapsed: true});

        expect(applied.status).toBe("saved");
        expect(storedRecord(harness)?.hiddenSidebars).toEqual({left: true});
        expect(storedRecord(harness)?.dragCollapsedParts).toEqual({left: true});
        opened.stop();
    });

    it("Panel + hidden 在动作边界明确拒绝：只写 dragCollapsed，绝不写 hiddenSidebars", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const rejected = await opened.consumer.setPartVisibility({partId: "panel", hidden: true});
        const dragOnly = await opened.consumer.setPartVisibility({partId: "panel", dragCollapsed: true});

        expect(rejected.status).toBe("rejected");
        expect(rejected.diagnosis).toContain("hiddenSidebars 只记 left/right");
        expect(dragOnly.status).toBe("saved");
        expect(harness.saves).toEqual([RECORD_KEY]);
        expect(storedRecord(harness)?.hiddenSidebars).toBeUndefined();
        expect(storedRecord(harness)?.dragCollapsedParts).toEqual({panel: true});
        opened.stop();
    });

    it("未登记 Part 与空字段都被拒绝，不写盘", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const badPart = await opened.consumer.setPartVisibility({partId: "editor" as never, hidden: true});
        const empty = await opened.consumer.setPartVisibility({partId: "left"});

        expect(badPart.status).toBe("rejected");
        expect(empty.status).toBe("rejected");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("一场尺寸手势一次写入：两轴与收起同次落盘", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, height: 320}, {viewId: OUTLINE, collapsed: true}],
        });

        expect(applied.status).toBe("saved");
        expect(harness.saves).toEqual([RECORD_KEY]);
        expect(storedRecord(harness)?.viewSizes).toEqual({
            [FILES]: {height: 320},
            [OUTLINE]: {collapsed: true},
        });
        opened.stop();
    });

    it("逐字段合成：收起批不丢掉另一轴与未知字段", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {},
            viewSizes: {[FILES]: {width: 420, height: 320, futureAxis: "keep"}},
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, collapsed: true}],
        });

        expect(applied.status).toBe("saved");
        expect(storedRecord(harness)?.viewSizes).toEqual({
            [FILES]: {width: 420, height: 320, futureAxis: "keep", collapsed: true},
        });
        opened.stop();
    });

    it("来源容器与成员集合失效整批拒绝：不保存一半", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const wrongContainer = await opened.consumer.setViewSizes({
            containerId: PANEL,
            sourceLocation: "panel",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: TERMINAL, height: 300}, {viewId: FILES, height: 200}],
        });
        const badHeight = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, height: 0}, {viewId: OUTLINE, height: 200}],
        });

        expect(wrongContainer.status).toBe("rejected");
        expect(wrongContainer.diagnosis).toContain("不在容器");
        expect(badHeight.status).toBe("rejected");
        expect(badHeight.diagnosis).toContain("高度意图");
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.record.value.viewSizes).toBeUndefined();
        opened.stop();
    });

    it("发起之后容器换了落位（= 换轴）：迟到的尺寸批整批拒绝", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const moved = await opened.consumer.moveContainer({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
        });
        const late = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, height: 320}],
        });

        expect(moved.status).toBe("saved");
        expect(late.status).toBe("rejected");
        expect(late.diagnosis).toContain("已经不在 sidebar-left");
        expect(storedRecord(harness)?.viewSizes).toBeUndefined();
        opened.stop();
    });

    it("上下文代际过期整批拒绝：工作面已经切换，这场手势不落账", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const stale = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: "stale-context",
            patches: [{viewId: FILES, height: 320}],
        });

        expect(stale.status).toBe("rejected");
        expect(stale.diagnosis).toContain("工作面已经切换");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("空批次是无变更：不写盘", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [],
        });

        expect(applied.status).toBe("unchanged");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });
});

describe("useWorkbenchViewPlacements：CAS 重放与失败恢复", () => {
    it("重放达到目标即幂等成功：第三方已经写入同一结果时不重复追加", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        // 提交到达后端前，另一个窗口把文件树放到了同一个容器的末尾（结果与我们一致）。
        harness.hooks.beforeSave = () => {
            harness.write({
                version: 1,
                placements: {[FILES]: placementOf(PANEL, 11, {containerId: LEFT, order: 10})},
                activeContainerByPart: {panel: PANEL},
            });
        };
        const moved = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        // 重读核对发现写集已经成立：按 unchanged 收口（本窗口这一次没有写盘），不冒充新保存。
        expect(moved.status).toBe("unchanged");
        expect(harness.saves).toEqual([]);
        expect(storedRecord(harness)?.placements[FILES]).toEqual(placementOf(PANEL, 11, {containerId: LEFT, order: 10}));
        opened.stop();
    });

    it("重放冲突：第三方已经把它挪到别处时不盲覆，回执报出冲突", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        harness.hooks.beforeSave = () => {
            harness.write({
                version: 1,
                placements: {[FILES]: placementOf(RIGHT, 4, {containerId: LEFT, order: 10})},
            });
        };
        const moved = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        expect(moved.status).toBe("rejected");
        expect(moved.diagnosis).toContain("已被移到");
        expect(harness.saves).toEqual([]);
        // 第三方写下的位置原样保留，也没有新的未确认意图挂着。
        expect(storedRecord(harness)?.placements[FILES]).toEqual(placementOf(RIGHT, 4, {containerId: LEFT, order: 10}));
        expect(opened.consumer.notice.value?.abandonable).not.toBe(true);
        opened.stop();
    });

    it("同一实体的连续意图：后一条取代前一条，两条回执都不误报冲突", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        // 第一场移动还在路上时就发起第二场（本窗口呈现已经按未确认意图更新，来源因此是 PANEL）。
        const first = opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});
        const second = opened.consumer.moveView({viewId: FILES, sourceContainerId: PANEL, targetContainerId: RIGHT});
        const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

        // 第一条提交把当时的**全部**未确认意图一起合成落盘，因此第二次调用没有额外要写的东西；
        // 关键是两条都不误报冲突，最终落点是用户最后要的那个位置。
        expect(firstOutcome.status).toBe("saved");
        expect(secondOutcome.status).toBe("unchanged");
        expect(firstOutcome.diagnosis).not.toContain("已被移到");
        expect(secondOutcome.diagnosis).not.toContain("已被移到");
        expect(storedRecord(harness)?.placements[FILES]?.containerId).toBe(RIGHT);
        expect(opened.consumer.notice.value?.abandonable).not.toBe(true);
        opened.stop();
    });

    it("失败回执不丢后续意图：保存失败后又一次收起，最终落盘包含两次意图", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        harness.hooks.beforeSave = () => {
            throw new StorageAdapterError({
                code: "STORAGE_UNAVAILABLE",
                status: 503,
                message: "后端暂不可达",
                committed: null,
            });
        };
        const moved = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        expect(moved.status).toBe("pending");
        expect(moved.diagnosis).toContain("后端暂不可达");
        expect(harness.saves).toEqual([]);
        // 未确认意图仍然呈现在本窗口里。
        expect(opened.consumer.record.value.placements[FILES]?.containerId).toBe(PANEL);
        expect(opened.consumer.notice.value?.abandonable).toBe(true);

        harness.hooks.beforeSave = null;
        const collapsed = await opened.consumer.setPanelState({collapsed: true});

        expect(collapsed.status).toBe("saved");
        expect(storedRecord(harness)).toEqual({
            version: 1,
            placements: {[FILES]: {containerId: PANEL, order: 11, defaultContainerId: LEFT, defaultOrder: 10}},
            activeContainerByPart: {panel: PANEL},
            panelCollapsed: true,
        });
        opened.stop();
    });

    it("外来订阅只推进合成底本，不替换本窗口呈现；下一次本地动作把这部分带进记录", async () => {
        vi.useFakeTimers();
        const harness = storageHarness();
        const opened = openSession(harness);

        await flushUntil(() => !opened.consumer.loading.value);
        // 另一个窗口把文件树移到右栏并保存（本窗口没有本地意图）。
        harness.write({
            version: 1,
            placements: {[FILES]: placementOf(RIGHT, 5, {containerId: LEFT, order: 10})},
            activeContainerByPart: {right: RIGHT},
        });
        await vi.advanceTimersByTimeAsync(50);

        // 外来订阅不替换本窗口呈现：这里仍然是"按默认位置"的呈现。
        expect(opened.consumer.record.value.placements).toEqual({});

        const collapsed = await opened.consumer.setPanelState({collapsed: true});

        expect(collapsed.status).toBe("saved");
        const stored = storedRecord(harness);
        expect(stored?.panelCollapsed).toBe(true);
        expect(stored?.placements[FILES]).toEqual(placementOf(RIGHT, 5, {containerId: LEFT, order: 10}));
        expect(stored?.activeContainerByPart).toEqual({right: RIGHT});
        opened.stop();
    });

    it("记录损坏：整条保护不普通覆盖，移动只在本窗口暂态并给出诊断", async () => {
        const harness = storageHarness();
        harness.fixedReads.set(RECORD_KEY, {
            kind: "corrupt",
            diagnosis: "记录不是合法 JSON",
            repair: {partitionGeneration: 1, contentFingerprint: "fingerprint-1"},
        });
        const opened = openSession(harness);

        await flushUntil(() => !opened.consumer.loading.value);
        expect(opened.consumer.notice.value?.diagnosis).toContain("记录损坏");
        const moved = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        expect(moved.status).toBe("pending");
        expect(moved.diagnosis).toContain("不可普通保存");
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.record.value.placements[FILES]?.containerId).toBe(PANEL);
        opened.stop();
    });

    it("坏扩展整条阻写：动作不落盘，原件一个字节都不动", async () => {
        const harness = storageHarness();
        const bad = {version: 1, placements: {}, viewSizes: {[FILES]: {height: 0}}};
        harness.write(bad);
        const opened = openSession(harness);
        await flushUntil(() => opened.consumer.notice.value !== null);

        const sizes = await opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, height: 300}],
        });
        const moved = await opened.consumer.moveView({viewId: FILES, sourceContainerId: LEFT, targetContainerId: PANEL});

        expect(sizes.status).toBe("pending");
        expect(sizes.diagnosis).toContain("不可普通保存");
        expect(moved.status).toBe("pending");
        expect(moved.diagnosis).toContain("不可普通保存");
        expect(harness.saves).toEqual([]);
        expect(harness.records.get(RECORD_KEY)?.value).toEqual(bad);
        opened.stop();
    });

    it("旧记录只带退役字段与未知字段时照常可用：新动作保留原件、不写退役字段", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {},
            activeViewByContainer: {[LEFT]: FILES},
            futureTopLevel: "keep",
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setPartVisibility({partId: "left", dragCollapsed: true});

        expect(applied.status).toBe("saved");
        const stored = storedRecord(harness) as WorkbenchViewCustomizationsRecord & {readonly activeViewByContainer?: unknown};
        expect(stored.activeViewByContainer).toEqual({[LEFT]: FILES});
        expect(stored.futureTopLevel).toBe("keep");
        expect(stored.dragCollapsedParts).toEqual({left: true});
        opened.stop();
    });
});

describe("面板状态：位置 / 对齐 / 显隐 / 收起", () => {
    it("缺字段的记录按产品默认呈现（bottom/center/false/false），首读不补写", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);

        await flushUntil(() => !opened.consumer.loading.value);

        expect(opened.consumer.panelState.value).toEqual({
            position: "bottom",
            alignment: "center",
            hidden: false,
            collapsed: false,
        });
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("位置 + 对齐 + 隐藏同次写进同一条记录，且只写 customizations", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setPanelState({position: "top", alignment: "justify", hidden: true});

        expect(applied.status).toBe("saved");
        expect(harness.saves).toEqual([RECORD_KEY]);
        expect(storedRecord(harness)).toEqual({
            version: 1,
            placements: {},
            panelPosition: "top",
            panelAlignment: "justify",
            panelHidden: true,
        });
        expect(opened.consumer.panelState.value).toMatchObject({position: "top", alignment: "justify", hidden: true});
        opened.stop();
    });

    it("切到侧向位置时同次清掉收起；把状态设回当前生效值是无变更", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {},
            panelPosition: "bottom",
            panelCollapsed: true,
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const applied = await opened.consumer.setPanelState({position: "left"});
        const noop = await opened.consumer.setPanelState({position: "left", hidden: false});

        expect(applied.status).toBe("saved");
        expect(storedRecord(harness)).toMatchObject({panelPosition: "left", panelCollapsed: false});
        expect(noop.status).toBe("unchanged");
        expect(harness.saves).toEqual([RECORD_KEY]);
        opened.stop();
    });

    it("非法枚举/非布尔整次拒绝：不落盘，呈现保持原样", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const badPosition = await opened.consumer.setPanelState({position: "diagonal" as never});
        const badHidden = await opened.consumer.setPanelState({hidden: "yes" as never});

        expect(badPosition.status).toBe("rejected");
        expect(badPosition.diagnosis).toContain("面板位置");
        expect(badHidden.status).toBe("rejected");
        expect(badHidden.diagnosis).toContain("隐藏标记");
        expect(harness.saves).toEqual([]);
        expect(opened.consumer.panelState.value.position).toBe("bottom");
        opened.stop();
    });
});

/** 位置读投影用的目录：断言"源容器还在不在生效清单里"用它。 */
const PLACEMENT_CATALOG = placementCatalogOf(registryOf());

function effectiveContainers(
    consumer: WorkbenchViewPlacementsConsumer,
    partId: "left" | "right" | "panel",
): readonly string[] {
    return containersOfPart(
        readEffectiveContainerPlacements(PLACEMENT_CATALOG, consumer.record.value),
        partId,
    ).map((entry) => entry.containerId);
}

/** 整组并入：左栏容器（FILES + OUTLINE）并进面板容器。 */
function mergeLeftIntoPanel(
    consumer: WorkbenchViewPlacementsConsumer,
    sourceViewIds: readonly string[] = [FILES, OUTLINE],
): Promise<ViewPlacementsOutcome> {
    return consumer.mergeContainer({
        sourceContainerId: LEFT,
        sourceLocation: "sidebar-left",
        targetContainerId: PANEL,
        targetLocation: "panel",
        sourceViewIds,
        contextKey: consumer.contextKey(),
    });
}

describe("useWorkbenchViewPlacements：整组并入与源容器消失", () => {
    it("一条意图一次保存：全部成员并进目标、写源抑制、选中目标 Part，源容器退出生效清单", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const outcome = await mergeLeftIntoPanel(opened.consumer);

        expect(outcome.status).toBe("saved");
        expect(harness.saves).toHaveLength(1);
        const stored = storedRecord(harness);
        expect(stored?.suppressedContainers).toEqual({[LEFT]: true});
        expect([FILES, OUTLINE].map((id) => stored?.placements[id]?.containerId)).toEqual([PANEL, PANEL]);
        expect(stored?.activeContainerByPart).toEqual({panel: PANEL});
        // descriptor、尺寸与业务状态都不动：消失的只有"还呈现的容器"这一件事。
        expect(stored?.placements[FILES]?.defaultContainerId).toBe(LEFT);
        expect(effectiveContainers(opened.consumer, "left")).toEqual([]);
        expect(effectiveContainers(opened.consumer, "panel")).toEqual([PANEL]);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("请求已保存但应答丢失：重读核对发现写集全部成立，按 unchanged 收口且不重复并入", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        harness.hooks.loseSaveResponse = true;
        const outcome = await mergeLeftIntoPanel(opened.consumer);

        expect(outcome.status).toBe("unchanged");
        // 写只发生过一次；重读核对没有把整组再并一遍（成员不会重复、序号不会重算）。
        expect(harness.saves).toHaveLength(1);
        expect(storedRecord(harness)?.suppressedContainers).toEqual({[LEFT]: true});
        expect(storedRecord(harness)?.placements[FILES]?.containerId).toBe(PANEL);
        expect(opened.consumer.notice.value?.abandonable).not.toBe(true);

        harness.hooks.loseSaveResponse = false;
        const retried = await opened.consumer.retry();
        expect(retried.status).toBe("unchanged");
        expect(harness.saves).toHaveLength(1);
        opened.stop();
    });

    it("源成员在保存前被第三方改走：整组拒绝、不部分生效，诊断保留到 dismiss", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        // 第三方把 OUTLINE 挪到面板：源容器成员快照不再匹配。
        harness.hooks.beforeSave = () => {
            harness.write({
                version: 1,
                placements: {[OUTLINE]: placementOf(PANEL, 11, {containerId: LEFT, order: 20})},
            });
        };
        const outcome = await mergeLeftIntoPanel(opened.consumer);

        expect(outcome.status).toBe("rejected");
        expect(outcome.diagnosis).toContain("成员已经变化");
        expect(harness.saves).toEqual([]);
        // 一条都没进去，源容器也还在（没有写抑制）。
        expect(storedRecord(harness)?.placements[FILES]).toBeUndefined();
        expect(storedRecord(harness)?.suppressedContainers).toBeUndefined();
        expect(effectiveContainers(opened.consumer, "left")).toEqual([LEFT]);

        // 确认冲突是终态：没有未确认批次可放弃，但用户仍看得到诊断，直到 dismiss。
        expect(opened.consumer.notice.value?.diagnosis).toContain("成员已经变化");
        expect(opened.consumer.notice.value?.abandonable).toBe(false);
        opened.consumer.dismissNotice();
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("记录里的未知视图与失效条目只报诊断、不阻断已登记成员的合并，原件保留", async () => {
        const harness = storageHarness();
        harness.write({
            version: 1,
            placements: {
                "nbook.ghost": placementOf(PANEL, 5, {containerId: LEFT, order: 2}),
                [OUTLINE]: placementOf(LEFT, 20, {containerId: LEFT, order: 20}),
            },
            futureTopLevel: "keep",
        });
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const outcome = await mergeLeftIntoPanel(opened.consumer);

        expect(outcome.status).toBe("saved");
        const stored = storedRecord(harness);
        expect(stored?.placements["nbook.ghost"]).toEqual(placementOf(PANEL, 5, {containerId: LEFT, order: 2}));
        expect(stored?.["futureTopLevel"]).toBe("keep");
        expect(stored?.placements[FILES]?.containerId).toBe(PANEL);
        expect(stored?.suppressedContainers).toEqual({[LEFT]: true});
        opened.stop();
    });

    it("被合并掉的容器不接收普通动作；reopen 清除抑制但不创建空标签", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        expect((await mergeLeftIntoPanel(opened.consumer)).status).toBe("saved");
        const selected = await opened.consumer.selectContainer("left", LEFT);
        const movedInto = await opened.consumer.moveView({viewId: FILES, sourceContainerId: PANEL, targetContainerId: LEFT});
        const merged = await mergeLeftIntoPanel(opened.consumer, []);

        expect(selected.status).toBe("rejected");
        expect(selected.diagnosis).toContain("已经被合并掉");
        expect(movedInto.status).toBe("rejected");
        expect(movedInto.diagnosis).toContain("已经被合并掉");
        expect(merged.status).toBe("rejected");

        const reopened = await opened.consumer.reopenContainer(LEFT);

        expect(reopened.status).toBe("saved");
        const stored = storedRecord(harness);
        expect(stored?.suppressedContainers).toBeUndefined();
        expect(stored?.activeContainerByPart).toEqual({panel: PANEL});
        // 成员不被拉回，清除抑制也不选中没有成员的容器。
        expect(stored?.placements[FILES]?.containerId).toBe(PANEL);
        expect(effectiveContainers(opened.consumer, "left")).toEqual([LEFT]);
        opened.stop();
    });
});

describe("useWorkbenchViewPlacements：回执、重试与连续队列", () => {
    it("二次冲突保留未确认批次：pending 带回真实诊断，retry 拿到真实回执并最终落盘", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        // 每次保存前第三方都写入一个新版本：条件写冲突 → 重读重放 → 再冲突。
        let rounds = 0;
        harness.hooks.beforeSave = () => {
            harness.write({version: 1, placements: {}, panelCollapsed: true, panelHidden: rounds === 0});
            rounds += 1;
        };
        const outcome = await mergeLeftIntoPanel(opened.consumer);

        expect(outcome.status).toBe("pending");
        expect(outcome.diagnosis).toContain("记录已被其它窗口改写");
        expect(opened.consumer.notice.value?.retryable).toBe(true);
        expect(opened.consumer.notice.value?.abandonable).toBe(true);
        // 未确认意图仍呈现在本窗口里（源容器不再出现），但一条都没落盘。
        expect(effectiveContainers(opened.consumer, "left")).toEqual([]);
        expect(storedRecord(harness)?.suppressedContainers).toBeUndefined();

        harness.hooks.beforeSave = null;
        const retried = await opened.consumer.retry();

        expect(retried.status).toBe("saved");
        expect(storedRecord(harness)?.suppressedContainers).toEqual({[LEFT]: true});
        expect(storedRecord(harness)?.placements[OUTLINE]?.containerId).toBe(PANEL);
        expect(opened.consumer.notice.value).toBeNull();
        opened.stop();
    });

    it("没有未确认意图时的 retry 不冒充成功：返回 unchanged 且不动记录", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const outcome = await opened.consumer.retry();

        expect(outcome.status).toBe("unchanged");
        expect(outcome.diagnosis).toContain("没有未确认");
        expect(harness.saves).toEqual([]);
        opened.stop();
    });

    it("连续队列：并入 → 目标尺寸 → 恢复视图位置，各自真实回执、互不误报冲突", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        const merged = await mergeLeftIntoPanel(opened.consumer);
        const sized = await opened.consumer.setViewSizes({
            containerId: PANEL,
            sourceLocation: "panel",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, width: 320}, {viewId: OUTLINE, width: 260}],
        });
        const restored = await opened.consumer.restoreViewPlacement(FILES);

        expect([merged.status, sized.status, restored.status]).toEqual(["saved", "saved", "saved"]);
        const stored = storedRecord(harness);
        expect(stored?.viewSizes).toEqual({[FILES]: {width: 320}, [OUTLINE]: {width: 260}});
        // FILES 回到默认位置（左栏），同一次清掉左栏的抑制：容器重新可用。
        expect(stored?.placements[FILES]).toBeUndefined();
        expect(stored?.suppressedContainers).toBeUndefined();
        expect(stored?.placements[OUTLINE]?.containerId).toBe(PANEL);
        expect(effectiveContainers(opened.consumer, "left")).toEqual([LEFT]);
        opened.stop();
    });

    it("未确认的传输失败与 composition 冲突同时出现：pending 保留重试入口，诊断两段都在", async () => {
        const harness = storageHarness();
        const opened = openSession(harness);
        await flushUntil(() => !opened.consumer.loading.value);

        // 另一个窗口先改了源成员（本次并入因此在重放时被跳过），随后本次保存的应答又在回程丢了。
        harness.hooks.beforeSave = () => {
            harness.write({
                version: 1,
                placements: {[OUTLINE]: placementOf(PANEL, 11, {containerId: LEFT, order: 20})},
            });
            throw new StorageAdapterError({
                code: "STORAGE_UNAVAILABLE",
                status: 503,
                message: "后端暂不可达",
                committed: null,
            });
        };
        // 同一批里：一条会被跳过的并入 + 一条独立的面板状态（后者写下了，前者没有）。
        const [merged, aligned] = await Promise.all([
            mergeLeftIntoPanel(opened.consumer),
            opened.consumer.setPanelState({alignment: "justify"}),
        ]);

        expect(merged.status).toBe("pending");
        expect(aligned.status).toBe("pending");
        const notice = opened.consumer.notice.value;
        expect(notice?.diagnosis).toContain("后端暂不可达");
        expect(notice?.diagnosis).toContain("成员已经变化");
        expect(notice?.retryable).toBe(true);
        expect(notice?.abandonable).toBe(true);
        // 冲突是终态、传输失败仍可重试：dismiss 只清冲突那一段，重试入口还在。
        opened.consumer.dismissNotice();
        expect(opened.consumer.notice.value?.diagnosis).toContain("后端暂不可达");
        expect(opened.consumer.notice.value?.diagnosis).not.toContain("成员已经变化");
        opened.stop();
    });

    it("排队执行前工作面已经切走：尺寸批次终态拒绝，不沿新工作面重放", async () => {
        const harness = storageHarness();
        const surface: {current: WorkbenchContext} = {current: PROJECT_CONTEXT};
        const opened = openSession(harness, CATALOG, () => surface.current);
        await flushUntil(() => !opened.consumer.loading.value);

        const sizing = opened.consumer.setViewSizes({
            containerId: LEFT,
            sourceLocation: "sidebar-left",
            contextKey: opened.consumer.contextKey(),
            patches: [{viewId: FILES, height: 320}],
        });
        // 手势发出后工作面切走（另一个 Project）：排队执行时复核发现批次属于旧工作面。
        surface.current = {...PROJECT_CONTEXT, projectRoot: "/workspace/other"};
        const outcome = await sizing;

        expect(outcome.status).toBe("rejected");
        expect(outcome.diagnosis).toContain("工作面");
        expect(harness.saves).toEqual([]);
        expect(storedRecord(harness)).toBeUndefined();
        expect(opened.consumer.record.value.viewSizes).toBeUndefined();
        opened.stop();
    });
});
