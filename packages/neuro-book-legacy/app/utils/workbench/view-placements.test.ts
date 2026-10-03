import {describe, expect, it} from "vitest";
import {
    comparePlacements,
    composeViewPlacements,
    containersOfPart,
    isContainerSuppressed,
    isPartDragCollapsed,
    isSidebarExplicitlyHidden,
    isToolPartId,
    isToolPartLocation,
    placementCatalogOf,
    placementCatalogWithContainers,
    placementsOfContainer,
    readContainerPlacements,
    readEffectiveContainerPlacements,
    readViewPlacements,
    resolveContainerMerge,
    resolveContainerMove,
    resolveViewMove,
    suppressedContainerIds,
    toolPartOfLocation,
    viewPlacementPostconditions,
    viewPlacementPostconditionsHold,
    type ContainerMergeRequest,
    type PlacementCatalog,
    type ViewPlacementReading,
    type ViewSplitPlacement,
} from "nbook/app/utils/workbench/view-placements";
import {
    createWorkbenchRegistry,
    type WorkbenchCatalog,
} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";
import {
    isWorkbenchViewCustomizationsRecord,
    WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT,
    type WorkbenchViewCustomizationsRecord,
    type WorkbenchViewPlacementRecord,
} from "nbook/shared/storage/workbench-views";

/**
 * 位置模型的纯行为：默认回落、覆盖过滤（默认指纹 / 未知目标 / 不可移动 / 未支持位置）、排序、
 * 移动意图的命令边界（含锚点）、插入序号与精度用尽时的重排，以及把补丁合成到最新底本时的
 * 字段范围、整批尺寸与重放幂等/冲突。
 *
 * 断言的是"读到的位置、报出的原因、写出的记录"，不是内部实现细节。
 */

const FILES = "nbook.files";
const OUTLINE = "nbook.outline";
const NOTES = "nbook.notes";
const AGENT = "nbook.agent";
const TERMINAL = "nbook.terminal";
const SEARCH = "nbook.search";
const TOC = "nbook.toc";
const TOOLS = "nbook.tools";
const PANEL = "nbook.panel";
const CUSTOM = "nbook.custom.1";

const CATALOG: PlacementCatalog = {
    views: {
        [FILES]: {containerId: TOOLS, order: 10, movable: true},
        [OUTLINE]: {containerId: TOOLS, order: 20, movable: true},
        [NOTES]: {containerId: TOOLS, order: 30, movable: true},
        [AGENT]: {containerId: "nbook.agent", order: 10, movable: false},
        [TERMINAL]: {containerId: PANEL, order: 10, movable: true},
    },
    containers: [TOOLS, "nbook.agent", PANEL],
    containerDefaults: {
        [TOOLS]: {location: "sidebar-left", order: 10, movable: true},
        "nbook.agent": {location: "sidebar-right", order: 20, movable: true},
        [PANEL]: {location: "panel", order: 30, movable: true},
    },
};

function placementOf(
    viewId: string,
    containerId: string,
    order: number,
    fingerprint?: {containerId: string; order: number},
): WorkbenchViewPlacementRecord {
    const basedOn = fingerprint ?? {containerId: CATALOG.views[viewId]!.containerId, order: CATALOG.views[viewId]!.order};
    return {
        containerId,
        order,
        defaultContainerId: basedOn.containerId,
        defaultOrder: basedOn.order,
    };
}

function recordOf(
    placements: Record<string, WorkbenchViewPlacementRecord>,
    extra: Partial<WorkbenchViewCustomizationsRecord> = {},
): WorkbenchViewCustomizationsRecord {
    return {version: 1, placements, ...extra};
}

describe("toolPart 与位置字面量", () => {
    it("三个工具 Part 是取值域；window 与未登记位置都不可落位", () => {
        expect(["left", "right", "panel"].map((value) => isToolPartId(value))).toEqual([true, true, true]);
        expect(isToolPartId("editor")).toBe(false);

        expect(["sidebar-left", "sidebar-right", "panel"].map(toolPartOfLocation)).toEqual(["left", "right", "panel"]);
        expect(toolPartOfLocation("window")).toBeNull();
        expect(toolPartOfLocation("sidebar-middle")).toBeNull();
        expect(isToolPartLocation("window")).toBe(false);
    });
});

describe("readViewPlacements", () => {
    it("没有覆盖时全部按产品默认：每个已登记视图一条结果", () => {
        const reading = readViewPlacements(CATALOG, undefined);

        expect(reading.problems).toEqual([]);
        expect(reading.placements).toEqual([
            {viewId: FILES, containerId: TOOLS, order: 10, source: "default"},
            {viewId: OUTLINE, containerId: TOOLS, order: 20, source: "default"},
            {viewId: NOTES, containerId: TOOLS, order: 30, source: "default"},
            {viewId: AGENT, containerId: "nbook.agent", order: 10, source: "default"},
            {viewId: TERMINAL, containerId: PANEL, order: 10, source: "default"},
        ]);
    });

    it("有效覆盖生效：位置换成目标容器，来源标记 record", () => {
        const reading = readViewPlacements(CATALOG, {[FILES]: placementOf(FILES, PANEL, 3)});

        expect(reading.problems).toEqual([]);
        expect(reading.placements.find((placement) => placement.viewId === FILES))
            .toEqual({viewId: FILES, containerId: PANEL, order: 3, source: "record"});
    });

    it("默认指纹不符：只过滤该覆盖、回新默认位置并报 issue，其它视图的覆盖照常生效", () => {
        const reading = readViewPlacements(CATALOG, {
            [FILES]: placementOf(FILES, PANEL, 3, {containerId: TOOLS, order: 99}),
            [OUTLINE]: placementOf(OUTLINE, PANEL, 4),
        });

        expect(reading.placements.find((placement) => placement.viewId === FILES))
            .toEqual({viewId: FILES, containerId: TOOLS, order: 10, source: "default"});
        expect(reading.placements.find((placement) => placement.viewId === OUTLINE))
            .toEqual({viewId: OUTLINE, containerId: PANEL, order: 4, source: "record"});
        expect(reading.problems.map((problem) => problem.viewId)).toEqual([FILES]);
        expect(reading.problems[0]!.diagnosis).toContain("默认位置已变");
    });

    it("覆盖指向未登记的容器：过滤该覆盖并报 issue，不改变其它位置", () => {
        const reading = readViewPlacements(CATALOG, {[FILES]: placementOf(FILES, "nbook.ghost", 3)});

        expect(reading.placements.find((placement) => placement.viewId === FILES)?.containerId).toBe(TOOLS);
        expect(reading.problems[0]!.diagnosis).toContain("不可落位的容器");
    });

    it("不可移动视图的覆盖不生效（产品声明优先），并报出原因", () => {
        const reading = readViewPlacements(CATALOG, {[AGENT]: placementOf(AGENT, TOOLS, 1)});

        expect(reading.placements.find((placement) => placement.viewId === AGENT)?.containerId).toBe("nbook.agent");
        expect(reading.problems[0]!.diagnosis).toContain("不可跨容器移动");
    });

    it("记录里的未登记视图只报 issue，已登记视图的位置不受影响", () => {
        const reading = readViewPlacements(CATALOG, {
            "nbook.ghost": placementOf(FILES, PANEL, 1),
            [FILES]: placementOf(FILES, PANEL, 3),
        });

        expect(reading.placements.filter((placement) => placement.viewId === FILES))
            .toEqual([{viewId: FILES, containerId: PANEL, order: 3, source: "record"}]);
        expect(reading.problems).toEqual([{viewId: "nbook.ghost", diagnosis: expect.stringContaining("未登记视图")}]);
    });

    it("容器内的顺序是 (order, id)：`order` 升序，同值按 id 稳定排序", () => {
        const reading = readViewPlacements(CATALOG, {
            [FILES]: placementOf(FILES, TOOLS, 30),
            [OUTLINE]: placementOf(OUTLINE, TOOLS, 10),
        });

        expect(placementsOfContainer(reading, TOOLS).map((placement) => placement.viewId)).toEqual([OUTLINE, FILES, NOTES]);
        expect(comparePlacements({viewId: "b", order: 5}, {viewId: "a", order: 5})).toBeGreaterThan(0);
    });
});

describe("readContainerPlacements", () => {
    it("没有覆盖时按 descriptor 默认落位；容器按 (order, id) 归到 Part 上", () => {
        const reading = readContainerPlacements(CATALOG, undefined);

        expect(reading.problems).toEqual([]);
        expect(reading.placements).toEqual([
            {containerId: TOOLS, location: "sidebar-left", order: 10, source: "default"},
            {containerId: "nbook.agent", location: "sidebar-right", order: 20, source: "default"},
            {containerId: PANEL, location: "panel", order: 30, source: "default"},
        ]);
        expect(containersOfPart(reading, "left").map((placement) => placement.containerId)).toEqual([TOOLS]);
        expect(containersOfPart(reading, "panel").map((placement) => placement.containerId)).toEqual([PANEL]);
        expect(containersOfPart(reading, "right").map((placement) => placement.containerId)).toEqual(["nbook.agent"]);
    });

    it("有效覆盖改变落位与顺序，并按 Part 重新归集", () => {
        const reading = readContainerPlacements(CATALOG, {
            [PANEL]: {location: "sidebar-left", order: 5, defaultLocation: "panel", defaultOrder: 30},
        });

        expect(containersOfPart(reading, "left").map((placement) => placement.containerId)).toEqual([PANEL, TOOLS]);
        expect(containersOfPart(reading, "panel")).toEqual([]);
    });

    it("默认落位指纹不符：只过滤该覆盖并报 issue，其它容器的覆盖照常生效", () => {
        const reading = readContainerPlacements(CATALOG, {
            [PANEL]: {location: "sidebar-left", order: 5, defaultLocation: "panel", defaultOrder: 99},
            [TOOLS]: {location: "panel", order: 1, defaultLocation: "sidebar-left", defaultOrder: 10},
        });

        expect(containersOfPart(reading, "panel").map((placement) => placement.containerId)).toEqual([TOOLS, PANEL]);
        // 指纹不符的覆盖被过滤：容器回到**新**默认落位，而不是停在记录里的位置。
        expect(containersOfPart(reading, "left")).toEqual([]);
        expect(reading.problems).toEqual([{containerId: PANEL, diagnosis: expect.stringContaining("默认落位已变")}]);
    });

    it("位置字面量未支持（预留的 window）：只过滤呈现，不清理未来数据", () => {
        const reading = readContainerPlacements(CATALOG, {
            [PANEL]: {location: "window", order: 5, defaultLocation: "panel", defaultOrder: 30},
        });

        expect(reading.placements.find((placement) => placement.containerId === PANEL))
            .toEqual({containerId: PANEL, location: "panel", order: 30, source: "default"});
        expect(reading.problems[0]!.diagnosis).toContain("不可落位的位置 window");
    });

    it("记录里的未登记容器只报 issue，原件由记录会话保留", () => {
        const reading = readContainerPlacements(CATALOG, {
            "nbook.ghost": {location: "panel", order: 1, defaultLocation: "panel", defaultOrder: 1},
        });

        expect(reading.problems).toEqual([{containerId: "nbook.ghost", diagnosis: expect.stringContaining("未登记容器")}]);
    });
});

describe("Part 显隐偏好：只消费认得的字段", () => {
    it("显式隐藏只有 left/right 会被消费，Panel 与未知键都不参与", () => {
        const record = recordOf({}, {hiddenSidebars: {left: true, right: false, panel: true, editor: true}});

        expect(isSidebarExplicitlyHidden(record, "left")).toBe(true);
        expect(isSidebarExplicitlyHidden(record, "right")).toBe(false);
        // Panel 的隐藏归 panelHidden：记录里就算有同名键也不在这里生效，更不会当边界用。
        expect(isSidebarExplicitlyHidden(record, "panel")).toBe(false);
        expect(isSidebarExplicitlyHidden(recordOf({}), "left")).toBe(false);
    });

    it("拖收起三个 Part 都认；未知键不参与", () => {
        const record = recordOf({}, {dragCollapsedParts: {left: true, panel: true, editor: true}});

        expect(["left", "right", "panel"].map((partId) => isPartDragCollapsed(record, partId as "left")))
            .toEqual([true, false, true]);
        expect(isPartDragCollapsed(recordOf({}), "panel")).toBe(false);
    });
});

describe("resolveViewMove", () => {
    const reading: ViewPlacementReading = readViewPlacements(CATALOG, undefined);
    const visible = [FILES, OUTLINE, NOTES, TERMINAL];

    it("合法移动产出意图；来源必须等于当前生效位置", () => {
        const decision = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL},
        });

        expect(decision).toEqual({kind: "move", viewId: FILES, targetContainerId: PANEL});
    });

    it("带锚点的移动把锚点带进意图", () => {
        const decision = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL, beforeViewId: TERMINAL},
        });

        expect(decision).toEqual({kind: "move", viewId: FILES, targetContainerId: PANEL, beforeViewId: TERMINAL});
    });

    it("越界来源被拒：来源不是视图当前所在容器时不产出任何变更", () => {
        const decision = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: FILES, sourceContainerId: PANEL, targetContainerId: "nbook.agent"},
        });

        expect(decision.kind).toBe("rejected");
        expect(decision.kind === "rejected" ? decision.diagnosis : "").toContain("来源容器");
    });

    it("未知视图 / 不可移动 / 当前上下文不可见 / 未登记目标都在命令边界拒绝", () => {
        const decisions = [
            resolveViewMove({catalog: CATALOG, reading, visibleViewIds: visible, request: {viewId: "nbook.ghost", sourceContainerId: TOOLS, targetContainerId: PANEL}}),
            resolveViewMove({catalog: CATALOG, reading, visibleViewIds: visible, request: {viewId: AGENT, sourceContainerId: "nbook.agent", targetContainerId: PANEL}}),
            resolveViewMove({catalog: CATALOG, reading, visibleViewIds: [OUTLINE], request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL}}),
            resolveViewMove({catalog: CATALOG, reading, visibleViewIds: visible, request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: "nbook.ghost"}}),
        ];

        expect(decisions.map((decision) => decision.kind)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    });

    it("锚点必须属于目标集合且不是自己：已变或指向自己都拒绝", () => {
        const stale = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL, beforeViewId: OUTLINE},
        });
        const self = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: FILES},
        });

        expect(stale.kind === "rejected" ? stale.diagnosis : "").toContain("锚点");
        expect(self.kind === "rejected" ? self.diagnosis : "").toContain("不能插到自己之前");
    });

    it("投到当前容器且已经在末尾才是无操作；换序不是无操作", () => {
        const same = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: NOTES, sourceContainerId: TOOLS, targetContainerId: TOOLS},
        });
        const reorder = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: NOTES, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: FILES},
        });
        const appended = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: FILES, sourceContainerId: TOOLS, targetContainerId: TOOLS},
        });

        expect(same.kind).toBe("noop");
        expect(reorder).toEqual({kind: "move", viewId: NOTES, targetContainerId: TOOLS, beforeViewId: FILES});
        // 已经在容器里但不是末尾：无锚点意味着"追加到末尾"，那是一次真实换序。
        expect(appended).toEqual({kind: "move", viewId: FILES, targetContainerId: TOOLS});
    });

    it("已经在目标容器且位置不变是无操作（同容器内插到自己原来那一位之前）", () => {
        const decision = resolveViewMove({
            catalog: CATALOG,
            reading,
            visibleViewIds: visible,
            request: {viewId: OUTLINE, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: NOTES},
        });

        expect(decision.kind).toBe("noop");
    });
});

describe("resolveContainerMerge", () => {
    const resolve = (
        request: ContainerMergeRequest,
        options: {record?: WorkbenchViewCustomizationsRecord; visible?: readonly string[]; contextKey?: string} = {},
    ) => {
        const record = options.record ?? recordOf({});
        return resolveContainerMerge({
            catalog: CATALOG,
            containers: readEffectiveContainerPlacements(CATALOG, record),
            views: readViewPlacements(CATALOG, record.placements),
            suppressed: suppressedContainerIds(CATALOG, record),
            request,
            currentContextKey: options.contextKey ?? "surface-1",
            visibleViewIds: options.visible ?? [FILES, OUTLINE, NOTES, TERMINAL],
        });
    };
    const request = (beforeViewId?: string): ContainerMergeRequest => ({
        sourceContainerId: TOOLS,
        sourceLocation: "sidebar-left",
        targetContainerId: PANEL,
        targetLocation: "panel",
        sourceViewIds: [FILES, OUTLINE, NOTES],
        contextKey: "surface-1",
        ...(beforeViewId === undefined ? {} : {beforeViewId}),
    });

    it("合法请求产出整组意图：成员取当前生效顺序，锚点原样带上", () => {
        expect(resolve(request())).toEqual({
            kind: "merge",
            sourceContainerId: TOOLS,
            targetContainerId: PANEL,
            sourceViewIds: [FILES, OUTLINE, NOTES],
        });
        expect(resolve(request(TERMINAL))).toEqual({
            kind: "merge",
            sourceContainerId: TOOLS,
            targetContainerId: PANEL,
            sourceViewIds: [FILES, OUTLINE, NOTES],
            beforeViewId: TERMINAL,
        });
    });

    it("同源同目标与空源都是无操作：不靠拖空容器删容器", () => {
        const emptied = recordOf({
            [FILES]: placementOf(FILES, PANEL, 11),
            [OUTLINE]: placementOf(OUTLINE, PANEL, 12),
            [NOTES]: placementOf(NOTES, PANEL, 13),
        });

        expect(resolve({...request(), targetContainerId: TOOLS}).kind).toBe("noop");
        const empty = resolve({...request(), sourceViewIds: []}, {record: emptied});
        expect(empty.kind).toBe("noop");
        if (empty.kind === "noop") {
            expect(empty.diagnosis).toContain("没有成员");
        }
    });

    it("工作面代际过期、两端被抑制、来源位置已变、成员快照不符都在命令边界拒绝", () => {
        const suppressedSource = recordOf({
            [FILES]: placementOf(FILES, PANEL, 11),
            [OUTLINE]: placementOf(OUTLINE, PANEL, 12),
            [NOTES]: placementOf(NOTES, PANEL, 13),
        }, {suppressedContainers: {[TOOLS]: true}});
        const suppressedTarget = recordOf({
            [TERMINAL]: placementOf(TERMINAL, TOOLS, 40),
        }, {suppressedContainers: {[PANEL]: true}});
        const movedSource = recordOf({}, {
            containerPlacements: {[TOOLS]: {location: "panel", order: 40, defaultLocation: "sidebar-left", defaultOrder: 10}},
        });

        expect(resolve(request(), {contextKey: "surface-2"})).toMatchObject({kind: "rejected"});
        expect(resolve(request(), {record: suppressedSource})).toMatchObject({kind: "rejected"});
        expect(resolve(request(), {record: suppressedTarget})).toMatchObject({kind: "rejected"});
        expect(resolve(request(), {record: movedSource})).toMatchObject({kind: "rejected"});
        expect(resolve({...request(), sourceViewIds: [FILES, OUTLINE]})).toMatchObject({kind: "rejected"});
    });

    it("锚点必须属于目标且当前可见：消失或不可见都整组拒绝，不降级成追加", () => {
        const notInTarget = resolve(request(AGENT));
        const hidden = resolve(request(TERMINAL), {visible: [FILES, OUTLINE, NOTES]});

        expect(notInTarget).toMatchObject({kind: "rejected"});
        if (notInTarget.kind === "rejected") {
            expect(notInTarget.diagnosis).toContain("不在目标容器");
        }
        expect(hidden).toMatchObject({kind: "rejected"});
        if (hidden.kind === "rejected") {
            expect(hidden.diagnosis).toContain("不可见");
        }
    });
});

describe("resolveContainerMove", () => {
    it("合法移动产出意图；目标必须是可落位的位置字面量", () => {
        const reading = readContainerPlacements(CATALOG, undefined);
        const move = resolveContainerMove({
            catalog: CATALOG,
            reading,
            request: {containerId: TOOLS, sourceLocation: "sidebar-left", targetLocation: "panel"},
        });
        const badTarget = resolveContainerMove({
            catalog: CATALOG,
            reading,
            request: {containerId: TOOLS, sourceLocation: "sidebar-left", targetLocation: "window" as never},
        });

        expect(move).toEqual({kind: "move", containerId: TOOLS, targetLocation: "panel"});
        expect(badTarget.kind === "rejected" ? badTarget.diagnosis : "").toContain("不可落位");
    });

    it("来源已变、未知容器、不可移动容器、锚点已变都在命令边界拒绝", () => {
        const reading = readContainerPlacements(CATALOG, undefined);
        const stale = resolveContainerMove({catalog: CATALOG, reading, request: {containerId: TOOLS, sourceLocation: "sidebar-right", targetLocation: "panel"}});
        const unknown = resolveContainerMove({catalog: CATALOG, reading, request: {containerId: "nbook.ghost", sourceLocation: "sidebar-left", targetLocation: "panel"}});
        const anchor = resolveContainerMove({catalog: CATALOG, reading, request: {containerId: TOOLS, sourceLocation: "sidebar-left", targetLocation: "panel", beforeContainerId: "nbook.ghost"}});

        expect(stale.kind === "rejected" ? stale.diagnosis : "").toContain("来源位置");
        expect(unknown.kind === "rejected" ? unknown.diagnosis : "").toContain("未登记的容器");
        expect(anchor.kind === "rejected" ? anchor.diagnosis : "").toContain("锚点容器");
    });

    it("目标落位里的换序与同位置同顺序无操作", () => {
        const reading = readContainerPlacements(CATALOG, {
            [PANEL]: {location: "sidebar-left", order: 20, defaultLocation: "panel", defaultOrder: 30},
        });
        const reorder = resolveContainerMove({
            catalog: CATALOG,
            reading,
            request: {containerId: PANEL, sourceLocation: "sidebar-left", targetLocation: "sidebar-left", beforeContainerId: TOOLS},
        });
        const same = resolveContainerMove({
            catalog: CATALOG,
            reading,
            request: {containerId: PANEL, sourceLocation: "sidebar-left", targetLocation: "sidebar-left"},
        });

        expect(reorder).toEqual({kind: "move", containerId: PANEL, targetLocation: "sidebar-left", beforeContainerId: TOOLS});
        expect(same.kind).toBe("noop");
    });
});

describe("composeViewPlacements：移动与换序", () => {
    it("跨容器移动同时写归属、目标 Part 的活动容器与默认指纹", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL},
        ]);

        expect(composed.changed).toBe(true);
        expect(composed.value.placements[FILES]).toEqual({
            containerId: PANEL,
            order: 11,
            defaultContainerId: TOOLS,
            defaultOrder: 10,
        });
        expect(composed.value.activeContainerByPart).toEqual({panel: PANEL});
        expect(composed.diagnosis).toBe("");
    });

    it("锚点插入取相邻中点；插到集合最前取第一项的一半", () => {
        const middle = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: NOTES},
        ]);
        const head = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "move-view", viewId: NOTES, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: FILES},
        ]);

        expect(middle.value.placements[FILES]!.order).toBe(25);
        expect(head.value.placements[NOTES]!.order).toBe(5);
        // 换序不该丢掉对象自己的高度意图：尺寸按 viewId 保存，与位置无关。
        expect(middle.value.viewSizes).toBeUndefined();
    });

    it("精度用尽：只把本次目标集合重排为 10 的倍数，其它容器的条目原样保留", () => {
        const base = recordOf({
            [FILES]: placementOf(FILES, TOOLS, 10),
            [OUTLINE]: placementOf(OUTLINE, TOOLS, 10),
            [TERMINAL]: placementOf(TERMINAL, PANEL, 7),
        });
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-view", viewId: NOTES, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: OUTLINE},
        ]);

        expect(composed.value.placements[FILES]!.order).toBe(10);
        expect(composed.value.placements[OUTLINE]!.order).toBe(20);
        expect(composed.value.placements[NOTES]!.order).toBe(15);
        expect(composed.value.placements[TERMINAL]).toEqual(placementOf(TERMINAL, PANEL, 7));

        const reading = readViewPlacements(CATALOG, composed.value.placements);
        expect(placementsOfContainer(reading, TOOLS).map((placement) => placement.viewId))
            .toEqual([FILES, NOTES, OUTLINE]);
    });

    it("追加序号越上界时同样只重排本次目标集合", () => {
        const base = recordOf({[TERMINAL]: placementOf(TERMINAL, PANEL, 1_000_000)});
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL},
        ]);

        expect(composed.value.placements[TERMINAL]!.order).toBe(10);
        expect(composed.value.placements[FILES]!.order).toBe(15);
        expect(composed.diagnosis).toBe("");
    });

    it("重排本身也要落账：被移动的那一条没变，集合里其它成员变了就不是无变更", () => {
        const base = recordOf({
            [FILES]: placementOf(FILES, TOOLS, 10),
            [OUTLINE]: placementOf(OUTLINE, TOOLS, 10),
            [NOTES]: placementOf(NOTES, TOOLS, 15),
        });
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-view", viewId: NOTES, sourceContainerId: TOOLS, targetContainerId: TOOLS, beforeViewId: OUTLINE},
        ]);

        expect(composed.changed).toBe(true);
        expect(composed.value.placements[NOTES]).toEqual(placementOf(NOTES, TOOLS, 15));
        expect(composed.value.placements[OUTLINE]!.order).toBe(20);
        expect(placementsOfContainer(readViewPlacements(CATALOG, composed.value.placements), TOOLS)
            .map((placement) => placement.viewId)).toEqual([FILES, NOTES, OUTLINE]);
    });

    it("重放同一条移动（视图已在目标容器且指纹相符）不重算序号，也没有变更", () => {
        // 无锚点的移动语义是"追加到目标容器末尾"，因此幂等的前提是它已经在末尾。
        const base = recordOf(
            {[FILES]: placementOf(FILES, PANEL, 11)},
            {activeContainerByPart: {panel: PANEL}},
        );
        const patch = {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL} as const;

        const composed = composeViewPlacements(CATALOG, base, [patch]);

        expect(composed.changed).toBe(false);
        expect(composed.value.placements[FILES]!.order).toBe(11);
        expect(composeViewPlacements(CATALOG, base, [patch]).conflicts).toEqual([]);
    });

    it("第三方已经把它挪到别处：跳过这条意图并报诊断，不盲覆本地较早的位置", () => {
        const base = recordOf({[FILES]: placementOf(FILES, "nbook.agent", 3)});
        const patch = {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL} as const;

        const composed = composeViewPlacements(CATALOG, base, [patch]);

        expect(composed.changed).toBe(false);
        expect(composed.value.placements[FILES]!.containerId).toBe("nbook.agent");
        expect(composed.diagnosis).toContain("已被移到");
        expect(composeViewPlacements(CATALOG, base, [patch]).conflicts).toHaveLength(1);
    });

    it("锚点已被第三方带走：跳过这条意图并报诊断", () => {
        const base = recordOf({[FILES]: placementOf(FILES, TOOLS, 10)});
        const patch = {
            kind: "move-view",
            viewId: FILES,
            sourceContainerId: TOOLS,
            targetContainerId: PANEL,
            beforeViewId: OUTLINE,
        } as const;

        const composed = composeViewPlacements(CATALOG, base, [patch]);

        expect(composed.changed).toBe(false);
        expect(composed.diagnosis).toContain("锚点视图");
        expect(composeViewPlacements(CATALOG, base, [patch]).conflicts).toHaveLength(1);
    });

    it("容器整体移动只改落位与顺序，视图归属与高度都不动", () => {
        const base = recordOf(
            {[FILES]: placementOf(FILES, TOOLS, 10)},
            {
                viewSizes: {[FILES]: {height: 320, collapsed: false}},
                activeContainerByPart: {left: TOOLS},
            },
        );
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-container", containerId: TOOLS, sourceLocation: "sidebar-left", targetLocation: "panel"},
        ]);

        expect(composed.changed).toBe(true);
        expect(composed.value.containerPlacements?.[TOOLS]).toEqual({
            location: "panel",
            order: 31,
            defaultLocation: "sidebar-left",
            defaultOrder: 10,
        });
        expect(composed.value.placements[FILES]).toEqual(placementOf(FILES, TOOLS, 10));
        expect(composed.value.viewSizes).toEqual({[FILES]: {height: 320, collapsed: false}});
        expect(composed.value.activeContainerByPart).toEqual({panel: TOOLS});
    });

    it("容器换序取目标落位上的相邻中点，并按 viewId 保留别的落位覆盖", () => {
        const base = recordOf({}, {
            containerPlacements: {
                [PANEL]: {location: "sidebar-left", order: 20, defaultLocation: "panel", defaultOrder: 30},
            },
        });
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-container", containerId: PANEL, sourceLocation: "sidebar-left", targetLocation: "sidebar-left", beforeContainerId: TOOLS},
        ]);

        expect(composed.value.containerPlacements?.[PANEL]!.location).toBe("sidebar-left");
        expect(composed.value.containerPlacements?.[PANEL]!.order).toBe(5);
        expect(containersOfPart(readContainerPlacements(CATALOG, composed.value.containerPlacements), "left")
            .map((placement) => placement.containerId)).toEqual([PANEL, TOOLS]);
    });

    it("容器移动已达到目标时幂等；被第三方挪走则冲突", () => {
        const patch = {
            kind: "move-container",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
        } as const;
        const landed = recordOf({}, {
            containerPlacements: {
                [TOOLS]: {location: "panel", order: 31, defaultLocation: "sidebar-left", defaultOrder: 10},
            },
            activeContainerByPart: {panel: TOOLS},
        });
        const taken = recordOf({}, {
            containerPlacements: {
                [TOOLS]: {location: "sidebar-right", order: 21, defaultLocation: "sidebar-left", defaultOrder: 10},
            },
        });

        const idempotent = composeViewPlacements(CATALOG, landed, [patch]);
        const conflicted = composeViewPlacements(CATALOG, taken, [patch]);

        expect(idempotent.changed).toBe(false);
        expect(composeViewPlacements(CATALOG, landed, [patch]).conflicts).toEqual([]);
        expect(conflicted.changed).toBe(false);
        expect(conflicted.value.containerPlacements?.[TOOLS]!.location).toBe("sidebar-right");
        expect(conflicted.diagnosis).toContain("已被移到");
    });
    it("移动来源 Part 的最后一个容器后删除旧活动选择并选中目标容器", () => {
        const base = recordOf({}, {
            activeContainerByPart: {left: TOOLS},
        });
        const composed = composeViewPlacements(CATALOG, base, [{
            kind: "move-container",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
        }]);

        expect(composed.value.activeContainerByPart).toEqual({panel: TOOLS});
        expect(composed.value.containerPlacements?.[TOOLS]?.location).toBe("panel");
    });
});

describe("composeViewPlacements：选择、恢复与显隐", () => {
    it("选择容器写活动容器，并显式打开该 Part：清显式隐藏与拖收起", () => {
        const base = recordOf({}, {
            activeContainerByPart: {left: "nbook.agent"},
            hiddenSidebars: {left: true, right: false},
            dragCollapsedParts: {left: true},
        });
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "select-container", partId: "left", containerId: TOOLS},
        ]);

        expect(composed.changed).toBe(true);
        expect(composed.value.activeContainerByPart).toEqual({left: TOOLS});
        expect(composed.value.hiddenSidebars).toEqual({left: false, right: false});
        expect(composed.value.dragCollapsedParts).toEqual({left: false});
    });

    it("选择已经生效的容器且 Part 已经打开是无变更（不重写同一批值）", () => {
        const base = recordOf({}, {
            activeContainerByPart: {left: TOOLS},
            hiddenSidebars: {left: false},
            dragCollapsedParts: {left: false},
        });
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "select-container", partId: "left", containerId: TOOLS},
        ]);

        expect(composed.changed).toBe(false);
    });

    it("选择容器不改 Panel 的 32px 收起（那是面板状态意图的事）", () => {
        const base = recordOf({}, {panelCollapsed: true});
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "select-container", partId: "panel", containerId: PANEL},
        ]);

        expect(composed.value.panelCollapsed).toBe(true);
    });

    it("显式隐藏只有 left/right：panel 的隐藏写不进去，只报冲突", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "set-part-visibility", partId: "panel", hidden: true},
        ]);

        expect(composed.value.hiddenSidebars).toBeUndefined();
        expect(composed.diagnosis).toContain("hiddenSidebars 只记 left/right");
    });

    it("侧栏显式隐藏与拖收起各写自己的字段，Panel 只接受拖收起", () => {
        const left = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "set-part-visibility", partId: "left", hidden: true, dragCollapsed: true},
        ]);
        const panel = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "set-part-visibility", partId: "panel", dragCollapsed: true},
        ]);

        expect(left.value.hiddenSidebars).toEqual({left: true});
        expect(left.value.dragCollapsedParts).toEqual({left: true});
        expect(panel.value.hiddenSidebars).toBeUndefined();
        expect(panel.value.dragCollapsedParts).toEqual({panel: true});
    });

    it("恢复视图默认位置只删该视图的覆盖，其它视图与容器落位保留", () => {
        const base = recordOf(
            {
                [FILES]: placementOf(FILES, PANEL, 7),
                [OUTLINE]: placementOf(OUTLINE, "nbook.agent", 2),
            },
            {
                containerPlacements: {
                    [TOOLS]: {location: "panel", order: 31, defaultLocation: "sidebar-left", defaultOrder: 10},
                },
                activeContainerByPart: {panel: PANEL},
            },
        );
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "restore-view-placement", viewId: FILES},
        ]);

        expect(composed.changed).toBe(true);
        expect(Object.keys(composed.value.placements)).toEqual([OUTLINE]);
        expect(composed.value.containerPlacements?.[TOOLS]!.location).toBe("panel");
        // 记录的选择**不**因恢复默认位置被清：呈现层按生效容器回落，不写回默认。
        expect(composed.value.activeContainerByPart).toEqual({panel: PANEL});
    });

    it("恢复容器默认落位只删该容器的覆盖；没有覆盖时是无变更", () => {
        const restored = composeViewPlacements(CATALOG, recordOf({}, {
            containerPlacements: {
                [TOOLS]: {location: "panel", order: 31, defaultLocation: "sidebar-left", defaultOrder: 10},
                [PANEL]: {location: "sidebar-left", order: 5, defaultLocation: "panel", defaultOrder: 30},
            },
        }), [{kind: "restore-container-placement", containerId: TOOLS}]);
        const nothing = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "restore-container-placement", containerId: TOOLS},
        ]);

        expect(Object.keys(restored.value.containerPlacements ?? {})).toEqual([PANEL]);
        expect(nothing.changed).toBe(false);
    });

    it("揭示视图：选中它的生效容器、打开目标 Part、清掉 View 与 Panel 的内容收起", () => {
        const base = recordOf(
            {[FILES]: placementOf(FILES, PANEL, 7)},
            {
                activeContainerByPart: {panel: TOOLS},
                dragCollapsedParts: {panel: true},
                panelHidden: true,
                panelCollapsed: true,
                viewSizes: {[FILES]: {height: 300, collapsed: true}},
            },
        );
        const composed = composeViewPlacements(CATALOG, base, [{kind: "reveal-view", viewId: FILES}]);

        expect(composed.value.activeContainerByPart).toEqual({panel: PANEL});
        expect(composed.value.dragCollapsedParts).toEqual({panel: false});
        expect(composed.value.panelHidden).toBe(false);
        expect(composed.value.panelCollapsed).toBe(false);
        expect(composed.value.viewSizes).toEqual({[FILES]: {height: 300, collapsed: false}});
    });
});

describe("composeViewPlacements：整组并入（源容器消失）", () => {
    const mergeIntent = (beforeViewId?: string) => ({
        kind: "merge-container" as const,
        sourceContainerId: TOOLS,
        sourceLocation: "sidebar-left" as const,
        targetContainerId: PANEL,
        targetLocation: "panel" as const,
        sourceViewIds: [FILES, OUTLINE, NOTES],
        ...(beforeViewId === undefined ? {} : {beforeViewId}),
    });
    const membersOf = (record: WorkbenchViewCustomizationsRecord, containerId: string) =>
        placementsOfContainer(readViewPlacements(CATALOG, record.placements), containerId).map((entry) => entry.viewId);

    it("一次合成把全部成员（含收起成员）按组内顺序并进目标，写源抑制并选中目标 Part", () => {
        const base = recordOf({}, {viewSizes: {[NOTES]: {height: 240, collapsed: true}}});
        const composed = composeViewPlacements(CATALOG, base, [mergeIntent()]);

        expect(composed.changed).toBe(true);
        expect(composed.conflicts).toEqual([]);
        expect(membersOf(composed.value, PANEL)).toEqual([TERMINAL, FILES, OUTLINE, NOTES]);
        expect([FILES, OUTLINE, NOTES].map((id) => composed.value.placements[id]?.containerId)).toEqual([PANEL, PANEL, PANEL]);
        // 源容器只写抑制标记：落位覆盖、尺寸与收起意图都不动，成员按 (order,id) 被逐个写清指纹。
        expect(composed.value.suppressedContainers).toEqual({[TOOLS]: true});
        expect(composed.value.viewSizes?.[NOTES]).toEqual({height: 240, collapsed: true});
        expect(composed.value.activeContainerByPart).toEqual({panel: PANEL});
        expect(composed.value.placements[FILES]).toEqual(placementOf(FILES, PANEL, 11));
        // 生效读集合里源容器不再出现（抑制生效），descriptor 与默认落位都还在。
        const effective = readEffectiveContainerPlacements(CATALOG, composed.value);
        expect(containersOfPart(effective, "left")).toEqual([]);
        expect(suppressedContainerIds(CATALOG, composed.value)).toEqual({[TOOLS]: true});
        expect(isContainerSuppressed(CATALOG, composed.value, TOOLS)).toBe(true);
    });

    it("锚点把整组插在它之前：组内顺序不变，锚点仍留在组之后", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [mergeIntent(TERMINAL)]);

        expect(membersOf(composed.value, PANEL)).toEqual([FILES, OUTLINE, NOTES, TERMINAL]);
        const orders = [FILES, OUTLINE, NOTES].map((id) => composed.value.placements[id]!.order);
        expect(orders[0]!).toBeLessThan(orders[1]!);
        expect(orders[1]!).toBeLessThan(orders[2]!);
        expect(orders[2]!).toBeLessThan(CATALOG.views[TERMINAL]!.order);
    });

    it("重放同一条意图（源已抑制且成员都在目标）：幂等，不重算序号也不报冲突", () => {
        const landed = composeViewPlacements(CATALOG, recordOf({}), [mergeIntent()]).value;
        const again = composeViewPlacements(CATALOG, landed, [mergeIntent()]);

        expect(again.changed).toBe(false);
        expect(again.conflicts).toEqual([]);
        expect(again.value.placements).toEqual(landed.placements);
        expect(again.value.suppressedContainers).toEqual({[TOOLS]: true});
    });

    it("只满足一半（源已消失但成员没全进目标）：冲突，不挪剩余成员补齐", () => {
        const half = recordOf(
            {
                [FILES]: placementOf(FILES, PANEL, 11),
                [OUTLINE]: placementOf(OUTLINE, "nbook.agent", 20),
                [NOTES]: placementOf(NOTES, PANEL, 12),
            },
            {suppressedContainers: {[TOOLS]: true}},
        );
        const composed = composeViewPlacements(CATALOG, half, [mergeIntent()]);

        expect(composed.changed).toBe(false);
        expect(composed.conflicts).not.toEqual([]);
        expect(composed.value.placements[OUTLINE]?.containerId).toBe("nbook.agent");
    });

    it("源成员快照已经变化：整组拒绝，一条都不写（成员换序同样算变化）", () => {
        const fewer = composeViewPlacements(CATALOG, recordOf({[NOTES]: placementOf(NOTES, "nbook.agent", 20)}), [mergeIntent()]);
        const reordered = composeViewPlacements(CATALOG, recordOf({}), [{
            ...mergeIntent(),
            sourceViewIds: [NOTES, FILES, OUTLINE],
        }]);

        expect(fewer.changed).toBe(false);
        expect(fewer.conflicts[0]).toContain("成员已经变化");
        expect(fewer.value.placements[FILES]).toBeUndefined();
        expect(fewer.value.suppressedContainers).toBeUndefined();
        expect(reordered.changed).toBe(false);
        expect(reordered.conflicts[0]).toContain("成员已经变化");
    });

    it("不可移动的成员让整组拒绝，并点名阻止它的那个 View", () => {
        const frozen: PlacementCatalog = {
            views: {
                [FILES]: {containerId: TOOLS, order: 10, movable: true},
                [OUTLINE]: {containerId: TOOLS, order: 20, movable: false},
            },
            containers: [TOOLS, PANEL],
            containerDefaults: {
                [TOOLS]: {location: "sidebar-left", order: 10, movable: true},
                [PANEL]: {location: "panel", order: 30, movable: true},
            },
        };
        const composed = composeViewPlacements(frozen, recordOf({}), [{
            kind: "merge-container",
            sourceContainerId: TOOLS,
            sourceLocation: "sidebar-left",
            targetContainerId: PANEL,
            targetLocation: "panel",
            sourceViewIds: [FILES, OUTLINE],
        }]);

        expect(composed.changed).toBe(false);
        expect(composed.conflicts[0]).toContain(OUTLINE);
        expect(composed.value.suppressedContainers).toBeUndefined();
    });

    it("锚点已经不在目标容器：整组拒绝，不降级成追加", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [mergeIntent(AGENT)]);

        expect(composed.changed).toBe(false);
        expect(composed.conflicts[0]).toContain("锚点视图");
    });

    it("源是另一个 Part 的当前容器：改选那个 Part 剩余列表第一项，没有则删掉选择键", () => {
        const agentMoved = {location: "sidebar-left", order: 20, defaultLocation: "sidebar-right", defaultOrder: 20};
        const withRemainder = recordOf({}, {
            containerPlacements: {"nbook.agent": agentMoved},
            activeContainerByPart: {left: TOOLS},
        });
        const withoutRemainder = recordOf({}, {activeContainerByPart: {left: TOOLS}});

        const kept = composeViewPlacements(CATALOG, withRemainder, [mergeIntent()]);
        const dropped = composeViewPlacements(CATALOG, withoutRemainder, [mergeIntent()]);

        expect(kept.value.activeContainerByPart).toEqual({left: "nbook.agent", panel: PANEL});
        // 没有剩余容器时删掉选择键，而不是隐藏那个 Part；Panel 则被同一次意图选中打开。
        expect(dropped.value.activeContainerByPart).toEqual({panel: PANEL});
    });

    it("源被抑制后不能再作为移动目标或活动容器：普通动作只报冲突", () => {
        const landed = composeViewPlacements(CATALOG, recordOf({}), [mergeIntent()]).value;
        const moved = composeViewPlacements(CATALOG, landed, [
            {kind: "move-view", viewId: TERMINAL, sourceContainerId: PANEL, targetContainerId: TOOLS},
        ]);
        const selected = composeViewPlacements(CATALOG, landed, [
            {kind: "select-container", partId: "left", containerId: TOOLS},
        ]);

        expect(moved.changed).toBe(false);
        expect(moved.conflicts[0]).toContain("已经被合并掉");
        expect(selected.changed).toBe(false);
        expect(selected.conflicts[0]).toContain("已经被合并掉");
    });
});

describe("源容器抑制的生效条件与恢复", () => {
    it("标记为真但容器还有成员时不生效；成员搬空后才生效；未知容器的标记不参与呈现", () => {
        const marked = recordOf({}, {suppressedContainers: {[TOOLS]: true, "nbook.ghost": true}});
        const emptied = recordOf({[FILES]: placementOf(FILES, PANEL, 11), [OUTLINE]: placementOf(OUTLINE, PANEL, 12), [NOTES]: placementOf(NOTES, PANEL, 13)}, {suppressedContainers: {[TOOLS]: true, "nbook.ghost": true}});

        // 还有成员：抑制不生效（容器照常呈现，标记留在原件里）。
        expect(isContainerSuppressed(CATALOG, marked, TOOLS)).toBe(false);
        expect(suppressedContainerIds(CATALOG, marked)).toEqual({});
        expect(marked.suppressedContainers?.[TOOLS]).toBe(true);
        // 成员都搬走：抑制生效；未知容器的标记保留在记录里，但不进读投影。
        expect(suppressedContainerIds(CATALOG, emptied)).toEqual({[TOOLS]: true});
        expect(containersOfPart(readEffectiveContainerPlacements(CATALOG, emptied), "left")).toEqual([]);
        expect(emptied.suppressedContainers?.["nbook.ghost"]).toBe(true);
    });

    it("重新打开：只清抑制，不把已经并走的 View 拉回来，也不给空容器开后门", () => {
        const landed = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "merge-container",
            sourceContainerId: TOOLS,
            sourceLocation: "sidebar-left",
            targetContainerId: PANEL,
            targetLocation: "panel",
            sourceViewIds: [FILES, OUTLINE, NOTES],
        }]).value;
        const reopened = composeViewPlacements(CATALOG, landed, [{kind: "reopen-container", containerId: TOOLS}]);

        expect(reopened.changed).toBe(true);
        expect(reopened.value.suppressedContainers).toBeUndefined();
        // 成员归属一个都没动：重新打开的是空容器，成员权重进来之前它不进导航。
        expect(reopened.value.placements).toEqual(landed.placements);
        expect(reopened.value.activeContainerByPart).toEqual({panel: PANEL});
        expect(containersOfPart(readEffectiveContainerPlacements(CATALOG, reopened.value), "left").map((entry) => entry.containerId))
            .toEqual([TOOLS]);
    });

    it("重新打开一个还有成员的容器：照旧选中并打开它的落位", () => {
        const marked = recordOf({}, {activeContainerByPart: {left: PANEL}, suppressedContainers: {[TOOLS]: true}});
        const reopened = composeViewPlacements(CATALOG, marked, [{kind: "reopen-container", containerId: TOOLS}]);

        expect(reopened.value.suppressedContainers).toBeUndefined();
        expect(reopened.value.activeContainerByPart).toEqual({left: TOOLS});
    });

    it("恢复默认落位会删落位覆盖并清抑制；恢复视图位置落在被抑制容器时同样清抑制", () => {
        const override = {location: "panel", order: 40, defaultLocation: "sidebar-left", defaultOrder: 10};
        const base = recordOf({[NOTES]: placementOf(NOTES, "nbook.agent", 20)}, {
            containerPlacements: {[TOOLS]: override},
            suppressedContainers: {[TOOLS]: true},
        });

        const containerRestored = composeViewPlacements(CATALOG, base, [{kind: "restore-container-placement", containerId: TOOLS}]);
        const viewRestored = composeViewPlacements(CATALOG, base, [{kind: "restore-view-placement", viewId: NOTES}]);
        const revealed = composeViewPlacements(CATALOG, base, [{kind: "reveal-view", viewId: FILES}]);

        expect(containerRestored.value.containerPlacements).toBeUndefined();
        expect(containerRestored.value.suppressedContainers).toBeUndefined();
        // NOTES 恢复默认位置后正好落回 TOOLS：同一次清掉抑制，避免它不可达。
        expect(viewRestored.value.placements[NOTES]).toBeUndefined();
        expect(viewRestored.value.suppressedContainers).toBeUndefined();
        expect(revealed.value.suppressedContainers).toBeUndefined();
    });
});

describe("viewPlacementPostconditions：丢应答后的核对口径", () => {
    it("写集是本批真正改写与删除的叶字段：重读后全部成立即视为已经达成", () => {
        const base = recordOf({[OUTLINE]: placementOf(OUTLINE, PANEL, 12)}, {panelCollapsed: true});
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL},
            {kind: "set-panel-state", collapsed: false},
            {kind: "restore-view-placement", viewId: OUTLINE},
        ]);
        const writes = viewPlacementPostconditions(base, composed.value);

        expect(writes).toContainEqual({table: "placements", id: FILES, value: composed.value.placements[FILES]});
        expect(writes).toContainEqual({table: "placements", id: OUTLINE, value: undefined});
        expect(writes).toContainEqual({field: "panelCollapsed", value: false});
        // 没有碰过的面板字段不进写集。
        expect(writes.some((write) => "field" in write && write.field === "panelPosition")).toBe(false);

        expect(viewPlacementPostconditionsHold(writes, composed.value)).toBe(true);
        // 少了任何一条（这里：文件树还没进目标容器）就不算达成，要在最新底本上重放。
        expect(viewPlacementPostconditionsHold(writes, base)).toBe(false);
        expect(viewPlacementPostconditionsHold(writes, null)).toBe(false);
    });

    it("没有写入的批次写集为空：空集合不能当成功（调用方要先确认本批真的写过）", () => {
        // 源容器已经被合并掉：这条选择意图整条被跳过，一次写入都没有。
        const base = recordOf({
            [FILES]: placementOf(FILES, PANEL, 11),
            [OUTLINE]: placementOf(OUTLINE, PANEL, 12),
            [NOTES]: placementOf(NOTES, PANEL, 13),
        }, {suppressedContainers: {[TOOLS]: true}});
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "select-container", partId: "left", containerId: TOOLS},
        ]);

        expect(composed.changed).toBe(false);
        expect(composed.conflicts).toHaveLength(1);
        expect(viewPlacementPostconditions(base, composed.value)).toEqual([]);
    });
});

describe("composeViewPlacements：View 尺寸整批语义", () => {
    it("一场手势里的高度与收起同次写进同一条记录", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "set-view-sizes",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, height: 320}, {viewId: OUTLINE, collapsed: true}],
        }]);

        expect(composed.changed).toBe(true);
        expect(composed.value.viewSizes).toEqual({
            [FILES]: {height: 320},
            [OUTLINE]: {collapsed: true},
        });
    });

    it("两轴各自独立：只改收起位不会丢掉另一轴与未知字段", () => {
        const base = recordOf({}, {viewSizes: {[FILES]: {width: 400, height: 320, futureAxis: "keep"}}});
        const collapsed = composeViewPlacements(CATALOG, base, [{
            kind: "set-view-sizes",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, collapsed: true}],
        }]);
        const widened = composeViewPlacements(CATALOG, collapsed.value, [{
            kind: "set-view-sizes",
            containerId: PANEL,
            sourceLocation: "panel",
            contextKey: "surface-1",
            patches: [{viewId: TERMINAL, width: 480}],
        }]);

        expect(collapsed.value.viewSizes).toEqual({[FILES]: {width: 400, height: 320, futureAxis: "keep", collapsed: true}});
        expect(widened.value.viewSizes?.[TERMINAL]).toEqual({width: 480});
        // 左右排的那一条只写 width：另一轴不是被换算出来的，是"没有意图"。
        expect("height" in (widened.value.viewSizes?.[TERMINAL] ?? {})).toBe(false);
    });

    it("只写真正变化的字段：同一轴的等价意图是无变更，不重写整条记录", () => {
        const base = recordOf({}, {viewSizes: {[FILES]: {width: 400, height: 320}}});
        const composed = composeViewPlacements(CATALOG, base, [{
            kind: "set-view-sizes",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, height: 320}],
        }]);

        expect(composed.changed).toBe(false);
        expect(composed.value.viewSizes).toEqual({[FILES]: {width: 400, height: 320}});
    });

    it("空批次不造记录：没有可写的字段就不写盘", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "set-view-sizes",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [],
        }]);

        expect(composed.changed).toBe(false);
        expect(composed.value.viewSizes).toBeUndefined();
    });

    it("尺寸按 viewId 保存，与位置顺序无关：换序后高度意图仍在", () => {
        const base = recordOf({}, {viewSizes: {[FILES]: {height: 320}}});
        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL},
        ]);

        expect(composed.value.viewSizes).toEqual({[FILES]: {height: 320}});
    });

    it("成员集合失效整批拒绝：一个 View 已经不在来源容器里，另一个也不写", () => {
        const patch = {
            kind: "set-view-sizes",
            containerId: PANEL,
            sourceLocation: "panel",
            contextKey: "surface-1",
            patches: [{viewId: TERMINAL, height: 300}, {viewId: FILES, height: 200}],
        } as const;
        const composed = composeViewPlacements(CATALOG, recordOf({}), [patch]);

        expect(composed.changed).toBe(false);
        expect(composed.value.viewSizes).toBeUndefined();
        expect(composeViewPlacements(CATALOG, recordOf({}), [patch]).conflicts[0]).toContain("已经不在容器");
    });

    it("发起之后容器换了落位（= 换轴）：迟到的尺寸批整批拒绝", () => {
        // 容器已经搬到主侧栏（上下排），这批基于 "panel"（左右排）的宽度意图不该落账。
        const moved = recordOf({}, {
            containerPlacements: {
                [PANEL]: {location: "sidebar-left", order: 40, defaultLocation: "panel", defaultOrder: 30},
            },
        });
        const patch = {
            kind: "set-view-sizes",
            containerId: PANEL,
            sourceLocation: "panel",
            contextKey: "surface-1",
            patches: [{viewId: TERMINAL, width: 480}],
        } as const;
        const composed = composeViewPlacements(CATALOG, moved, [patch]);

        expect(composed.changed).toBe(false);
        expect(composed.value.viewSizes).toBeUndefined();
        expect(composed.diagnosis).toContain("已经不在 panel");
    });

    it("坏宽度 / 坏高度 / 重复出现同一个 View：整批没有落账", () => {
        const badHeight = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "set-view-sizes",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, height: 0}, {viewId: OUTLINE, height: 200}],
        }]);
        const badWidth = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "set-view-sizes",
            containerId: PANEL,
            sourceLocation: "panel",
            contextKey: "surface-1",
            patches: [{viewId: TERMINAL, width: Number.NaN}],
        }]);
        const duplicated = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "set-view-sizes",
            containerId: TOOLS,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, height: 320}, {viewId: FILES, collapsed: true}],
        }]);

        expect(badHeight.changed).toBe(false);
        expect(badHeight.diagnosis).toContain("高度意图");
        expect(badWidth.changed).toBe(false);
        expect(badWidth.diagnosis).toContain("宽度意图");
        expect(duplicated.changed).toBe(false);
        expect(duplicated.diagnosis).toContain("重复出现");
    });

    it("同一批容量之外的容器：落点不可落位就不写", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [{
            kind: "set-view-sizes",
            containerId: "nbook.ghost",
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, height: 320}],
        }]);

        expect(composed.changed).toBe(false);
        expect(composed.diagnosis).toContain("未登记或不可落位");
    });
});

describe("composeViewPlacements：面板状态与原件保留", () => {
    it("面板状态只写真正改变的字段：默认值不补写，切到侧向位置同次清掉收起", () => {
        const collapsed = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "set-panel-state", collapsed: true},
        ]);
        const defaults = composeViewPlacements(CATALOG, recordOf({}), [
            {kind: "set-panel-state", position: "bottom", alignment: "center", hidden: false},
        ]);
        const sideways = composeViewPlacements(CATALOG, recordOf({}, {panelPosition: "bottom", panelCollapsed: true}), [
            {kind: "set-panel-state", position: "left"},
        ]);

        expect(collapsed.value.panelCollapsed).toBe(true);
        expect(defaults.changed).toBe(false);
        expect("panelPosition" in defaults.value).toBe(false);
        expect("panelHidden" in defaults.value).toBe(false);
        expect(sideways.value.panelPosition).toBe("left");
        expect(sideways.value.panelCollapsed).toBe(false);
    });

    it("没有已确认记录时只写本次主动字段，不伪造整条默认记录", () => {
        const composed = composeViewPlacements(CATALOG, null, [
            {kind: "move-view", viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL},
        ]);

        expect(composed.value.version).toBe(1);
        expect(Object.keys(composed.value.placements)).toEqual([FILES]);
        expect(composed.value.activeContainerByPart).toEqual({panel: PANEL});
        // 没有动作的新字段一个都不出现。
        expect(Object.keys(composed.value).sort()).toEqual([
            "activeContainerByPart",
            "placements",
            "version",
        ]);
    });

    it("退役字段与未知字段都留在原处：只通过 `...source` 透传，不参与变更判定", () => {
        const base: WorkbenchViewCustomizationsRecord = {
            version: 1,
            placements: {[FILES]: {...placementOf(FILES, TOOLS, 10), note: "why"}},
            activeViewByContainer: {[TOOLS]: FILES},
            futureTopLevel: "keep",
        };

        const composed = composeViewPlacements(CATALOG, base, [
            {kind: "set-panel-state", collapsed: true},
        ]);

        expect(composed.value.activeViewByContainer).toEqual({[TOOLS]: FILES});
        expect(composed.value.futureTopLevel).toBe("keep");
        expect(composed.value.placements[FILES]!.note).toBe("why");
    });
});

describe("placementCatalogOf", () => {
    it("从注册表摘出视图默认落位、容器默认落位与落点清单", () => {
        const catalog: WorkbenchCatalog = {
            parts: [],
            containers: [
                SHELL_RIGHT_CONTAINER,
                {...SHELL_PANEL_CONTAINER, canMoveContainer: false},
                SHELL_LEFT_CONTAINER,
            ],
            views: [{
                id: FILES,
                titleKey: "ide.toolPanel.files",
                icon: "i-lucide-files",
                container: SHELL_LEFT_CONTAINER.id,
                layout: "fill",
                order: 10,
                canToggleVisibility: false,
                canMoveView: true,
                factoryKey: "nbook.view.files",
                stateScope: "user",
            }],
        };
        const created = createWorkbenchRegistry(catalog);
        if (!created.ok) {
            throw new Error(created.reason);
        }

        const placed = placementCatalogOf(created.value);

        expect(placed.views[FILES]).toEqual({containerId: SHELL_LEFT_CONTAINER.id, order: 10, movable: true});
        expect(placed.containers).toEqual([
            SHELL_LEFT_CONTAINER.id,
            SHELL_RIGHT_CONTAINER.id,
            SHELL_PANEL_CONTAINER.id,
        ]);
        // 未声明按可移动处理；明确 false 的容器不出现在移动入口里。
        expect(placed.containerDefaults[SHELL_LEFT_CONTAINER.id]?.movable).toBe(true);
        expect(placed.containerDefaults[SHELL_PANEL_CONTAINER.id]?.movable).toBe(false);
    });
});

describe("customizations 记录形状（新字段与退役字段）", () => {
    it("缺省字段合法：没有新字段与退役字段的旧记录照旧可用，默认记录也不声明它们", () => {
        expect(isWorkbenchViewCustomizationsRecord({version: 1, placements: {}})).toBe(true);
        expect(isWorkbenchViewCustomizationsRecord({
            version: 1,
            placements: {},
            activeViewByContainer: {[TOOLS]: FILES},
        })).toBe(true);
        // 缺省的默认值不补写：空记录就是"全部按产品默认"。
        expect("activeViewByContainer" in WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT).toBe(false);
        expect("viewSizes" in WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT).toBe(false);
        expect("hiddenSidebars" in WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT).toBe(false);
    });

    it("新字段的合法形状通过", () => {
        expect(isWorkbenchViewCustomizationsRecord({
            version: 1,
            placements: {},
            containerPlacements: {[TOOLS]: {location: "panel", order: 10, defaultLocation: "sidebar-left", defaultOrder: 10}},
            activeContainerByPart: {left: TOOLS},
            viewSizes: {[FILES]: {width: 400, height: 320, collapsed: false}},
            dragCollapsedParts: {left: true, panel: false},
            hiddenSidebars: {left: true},
            suppressedContainers: {[TOOLS]: true},
            customContainers: {[CUSTOM]: {originViewId: FILES, location: "panel", order: 30, futureField: "keep"}},
        })).toBe(true);
    });

    it("自建容器：三个字段齐全即合法，位置与未知字段都按同一口径放行", () => {
        const base = {version: 1, placements: {}};

        // 位置只校验"非空字符串"：预留的 window 与未知字面量都留在记录里，支持与否归求值层。
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {originViewId: FILES, location: "window", order: 0}}})).toBe(true);
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {originViewId: FILES, location: "panel", order: 1_000_000}}})).toBe(true);
        // 空表合法（等于"没有自建容器"），它不该被判成坏字段。
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {}})).toBe(true);

        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {location: "panel", order: 1}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {originViewId: "", location: "panel", order: 1}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {originViewId: FILES, location: "", order: 1}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {originViewId: FILES, location: "panel", order: -1}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: {originViewId: FILES, location: "panel", order: Number.NaN}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, customContainers: {[CUSTOM]: "panel"}})).toBe(false);
    });

    it("坏扩展整条判为不可用（保留原件、阻断普通覆盖）", () => {
        const base = {version: 1, placements: {}};

        expect(isWorkbenchViewCustomizationsRecord({...base, containerPlacements: {[TOOLS]: {location: "", order: 1, defaultLocation: "sidebar-left", defaultOrder: 1}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, containerPlacements: {[TOOLS]: {location: "panel", order: Number.NaN, defaultLocation: "sidebar-left", defaultOrder: 1}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, activeContainerByPart: {"": TOOLS}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, activeContainerByPart: {left: ""}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, viewSizes: {[FILES]: {height: 0}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, viewSizes: {[FILES]: {width: 0}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, viewSizes: {[FILES]: {width: Number.NEGATIVE_INFINITY}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, viewSizes: {[FILES]: {height: Number.POSITIVE_INFINITY}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, viewSizes: {[FILES]: {width: 1_000_001}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, viewSizes: {[FILES]: {collapsed: "yes"}}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, dragCollapsedParts: {left: 1}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, hiddenSidebars: {left: "yes"}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, suppressedContainers: {[TOOLS]: "yes"}})).toBe(false);
        expect(isWorkbenchViewCustomizationsRecord({...base, suppressedContainers: {[TOOLS]: false}})).toBe(true);
        expect(isWorkbenchViewCustomizationsRecord({...base, placements: {[FILES]: {containerId: TOOLS}}})).toBe(false);
    });

    it("未知字段照旧保留：判定只看已知字段的形状", () => {
        expect(isWorkbenchViewCustomizationsRecord({
            version: 1,
            placements: {},
            activeViewByContainer: {[TOOLS]: FILES},
            futurePanel: "keep",
            panelHidden: true,
        })).toBe(true);
        expect(isWorkbenchViewCustomizationsRecord({version: 1, placements: {}, panelHidden: "yes"})).toBe(false);
    });
});

describe("placementCatalogWithContainers：把自建容器合进静态目录", () => {
    it("没有自建容器时返回**原对象**，调用方不必在热路径上判断", () => {
        expect(placementCatalogWithContainers(CATALOG, undefined)).toBe(CATALOG);
        expect(placementCatalogWithContainers(CATALOG, {})).toBe(CATALOG);
        // 撞上静态 id 的自建记录被忽略（静态优先），也不会凭空造出新表。
        expect(placementCatalogWithContainers(CATALOG, {[TOOLS]: {originViewId: FILES, location: "panel", order: 1}})).toBe(CATALOG);
    });

    it("自建容器按落位登记默认事实并进落点清单，视图的覆盖因此在它身上生效", () => {
        const catalog = placementCatalogWithContainers(CATALOG, {
            [CUSTOM]: {originViewId: FILES, location: "panel", order: 5},
        });
        const overrides = {[FILES]: placementOf(FILES, CUSTOM, 10)};

        expect(catalog).not.toBe(CATALOG);
        expect(catalog.containerDefaults[CUSTOM]).toEqual({location: "panel", order: 5, movable: true});
        // 落点清单按 (order, id) 排好：自建容器的 order 5 排在所有静态容器之前。
        expect(catalog.containers).toEqual([CUSTOM, TOOLS, "nbook.agent", PANEL]);
        // 静态部分不被改动：这是"合成一份新目录"，不是改注册表。
        expect(CATALOG.containers).toEqual([TOOLS, "nbook.agent", PANEL]);
        expect(catalog.views).toBe(CATALOG.views);
        // 没有这份合成，落在自建容器里的覆盖会被当成"不可落位的容器"过滤掉。
        expect(readViewPlacements(catalog, overrides).placements.find((entry) => entry.viewId === FILES))
            .toEqual({viewId: FILES, containerId: CUSTOM, order: 10, source: "record"});
        expect(readViewPlacements(CATALOG, overrides).problems).toHaveLength(1);
    });

    it("位置不可落位（预留的 window）的自建容器只登记默认事实，不进落点清单", () => {
        const catalog = placementCatalogWithContainers(CATALOG, {
            [CUSTOM]: {originViewId: FILES, location: "window", order: 5},
        });

        expect(catalog.containerDefaults[CUSTOM]).toEqual({location: "window", order: 5, movable: true});
        expect(catalog.containers).toEqual(CATALOG.containers);
        expect(containersOfPart(readContainerPlacements(catalog, undefined), "panel").some((entry) => entry.containerId === CUSTOM)).toBe(false);
    });

    it("抑制求值认自建容器：成员搬空后标记才生效", () => {
        const catalog = placementCatalogWithContainers(CATALOG, {
            [CUSTOM]: {originViewId: FILES, location: "panel", order: 5},
        });

        expect(suppressedContainerIds(catalog, {placements: {[FILES]: placementOf(FILES, CUSTOM, 10)}, suppressedContainers: {[CUSTOM]: true}})).toEqual({});
        expect(suppressedContainerIds(catalog, {placements: {[FILES]: placementOf(FILES, PANEL, 10)}, suppressedContainers: {[CUSTOM]: true}}))
            .toEqual({[CUSTOM]: true});
    });
});

describe("composeViewPlacements：拖出自建容器（detach-view）", () => {
    const detach = (viewId: string, sourceContainerId: string, containerId: string, targetLocation: "panel" | "sidebar-left" | "sidebar-right" = "panel") => ({
        kind: "detach-view" as const,
        viewId,
        sourceContainerId,
        targetLocation,
        containerId,
    });

    it("一次合成里建容器、搬成员、选中并打开目标 Part，默认指纹照旧指 descriptor", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [detach(FILES, TOOLS, CUSTOM)]);

        expect(composed.changed).toBe(true);
        expect(composed.conflicts).toEqual([]);
        expect(composed.value.customContainers).toEqual({[CUSTOM]: {originViewId: FILES, location: "panel", order: 31}});
        expect(composed.value.placements[FILES]).toEqual({
            containerId: CUSTOM,
            order: 10,
            defaultContainerId: TOOLS,
            defaultOrder: 10,
        });
        expect(composed.value.activeContainerByPart).toEqual({panel: CUSTOM});
        // 合进目录后：自建容器排在同落位已有容器之后，视图落在它身上的覆盖不被过滤。
        const catalog = placementCatalogWithContainers(CATALOG, composed.value.customContainers);
        expect(containersOfPart(readContainerPlacements(catalog, composed.value.containerPlacements), "panel")
            .map((entry) => entry.containerId)).toEqual([PANEL, CUSTOM]);
        expect(readViewPlacements(catalog, composed.value.placements).problems).toEqual([]);
    });

    it("重放同一条意图（视图已经在那个容器里）幂等：不重算序号、不报冲突", () => {
        const first = composeViewPlacements(CATALOG, recordOf({}), [detach(FILES, TOOLS, CUSTOM)]).value;
        const again = composeViewPlacements(CATALOG, first, [detach(FILES, TOOLS, CUSTOM)]);

        expect(again.changed).toBe(false);
        expect(again.conflicts).toEqual([]);
        expect(again.value).toEqual(first);
    });

    it("创建后被移到另一 Part 的容器不能被旧意图重新选中", () => {
        const intent = detach(FILES, TOOLS, CUSTOM);
        const first = composeViewPlacements(CATALOG, null, [intent]).value;
        const moved = composeViewPlacements(CATALOG, first, [{
            kind: "move-container", containerId: CUSTOM, sourceLocation: "panel", targetLocation: "sidebar-right",
        }]).value;
        const replayed = composeViewPlacements(CATALOG, moved, [intent]);
        expect(replayed.changed).toBe(false);
        expect(replayed.conflicts).not.toEqual([]);
        expect(replayed.value).toEqual(moved);
    });

    it("第三方已经把它挪到别处：跳过这条意图并报诊断，不盲覆", () => {
        const base = recordOf({[FILES]: placementOf(FILES, "nbook.agent", 3)});
        const composed = composeViewPlacements(CATALOG, base, [detach(FILES, TOOLS, CUSTOM)]);

        expect(composed.changed).toBe(false);
        expect(composed.value.customContainers).toBeUndefined();
        expect(composed.value.placements[FILES]!.containerId).toBe("nbook.agent");
        expect(composed.diagnosis).toContain("已被移到");
    });

    it("锚点必须已经在目标落位上；id 撞上别的容器、声明变了都整条不写", () => {
        const stale = composeViewPlacements(CATALOG, recordOf({}), [
            {...detach(FILES, TOOLS, CUSTOM), beforeContainerId: "nbook.ghost"},
        ]);
        const collided = composeViewPlacements(CATALOG, recordOf({}, {
            customContainers: {[CUSTOM]: {originViewId: NOTES, location: "panel", order: 1}},
        }), [detach(FILES, TOOLS, CUSTOM)]);
        const unknownView = composeViewPlacements(CATALOG, recordOf({}), [detach("nbook.ghost", TOOLS, CUSTOM)]);
        const unknownLocation = composeViewPlacements(CATALOG, recordOf({}), [
            {...detach(FILES, TOOLS, CUSTOM), targetLocation: "window" as never},
        ]);

        expect(stale.changed).toBe(false);
        expect(stale.diagnosis).toContain("锚点容器");
        expect(collided.changed).toBe(false);
        expect(collided.diagnosis).toContain("已经是别的容器");
        expect(unknownView.changed).toBe(false);
        expect(unknownView.conflicts).toEqual([]);
        expect(unknownLocation.changed).toBe(false);
    });

    it("锚点容器存在时新容器插在它之前", () => {
        const base = recordOf({}, {
            containerPlacements: {[PANEL]: {location: "panel", order: 30, defaultLocation: "panel", defaultOrder: 30}},
        });
        const composed = composeViewPlacements(CATALOG, base, [
            {...detach(FILES, TOOLS, CUSTOM), beforeContainerId: PANEL},
        ]);

        expect(composed.value.customContainers?.[CUSTOM]?.order).toBe(15);
        expect(containersOfPart(readContainerPlacements(
            placementCatalogWithContainers(CATALOG, composed.value.customContainers),
            composed.value.containerPlacements,
        ), "panel").map((entry) => entry.containerId)).toEqual([CUSTOM, PANEL]);
    });

    it("来源自建容器仍有成员时保留：只有真的搬空才收口", () => {
        const base = recordOf(
            {
                [FILES]: placementOf(FILES, CUSTOM, 10),
                [NOTES]: placementOf(NOTES, CUSTOM, 20),
            },
            {customContainers: {[CUSTOM]: {originViewId: FILES, location: "sidebar-left", order: 5}}},
        );
        const composed = composeViewPlacements(CATALOG, base, [detach(NOTES, CUSTOM, "nbook.custom.2")]);

        expect(composed.value.customContainers?.[CUSTOM]).toEqual({originViewId: FILES, location: "sidebar-left", order: 5});
        expect(composed.value.placements[FILES]!.containerId).toBe(CUSTOM);
    });

    it("来源自建容器被搬空：容器记录、落位覆盖、抑制标记与活动选择一起收口，不留孤儿", () => {
        const base = recordOf(
            {
                [FILES]: placementOf(FILES, CUSTOM, 10),
                [NOTES]: placementOf(NOTES, PANEL, 5),
            },
            {
                customContainers: {[CUSTOM]: {originViewId: FILES, location: "sidebar-left", order: 5}},
                containerPlacements: {[CUSTOM]: {location: "sidebar-left", order: 5, defaultLocation: "sidebar-left", defaultOrder: 5}},
                suppressedContainers: {[CUSTOM]: true},
                activeContainerByPart: {left: CUSTOM, panel: NOTES},
            },
        );
        const composed = composeViewPlacements(CATALOG, base, [detach(FILES, CUSTOM, "nbook.custom.2")]);

        expect(composed.changed).toBe(true);
        expect(composed.value.customContainers).toEqual({
            "nbook.custom.2": {originViewId: FILES, location: "panel", order: 31},
        });
        expect(composed.value.containerPlacements?.[CUSTOM]).toBeUndefined();
        expect(composed.value.suppressedContainers).toBeUndefined();
        // 指向已删容器的活动选择一起清掉：呈现层按 Part 的第一项回落，不留一个指向不存在容器的键。
        expect(composed.value.activeContainerByPart).toEqual({panel: "nbook.custom.2"});
        expect(composed.value.placements[FILES]).toEqual({
            containerId: "nbook.custom.2",
            order: 10,
            defaultContainerId: TOOLS,
            defaultOrder: 10,
        });
    });

    it("来源是静态容器：搬空也不删任何原件（静态容器只退出呈现，注册定义永远保留）", () => {
        const base = recordOf({[FILES]: placementOf(FILES, TOOLS, 10)});
        const composed = composeViewPlacements(CATALOG, base, [detach(FILES, TOOLS, CUSTOM)]);

        expect(composed.value.customContainers).toEqual({[CUSTOM]: {originViewId: FILES, location: "panel", order: 31}});
        expect(composed.value.suppressedContainers).toBeUndefined();
        expect(composed.value.containerPlacements).toBeUndefined();
        // TOOLS 现在没有成员了，但它的登记事实（descriptor / 目录）与记录原件都还在。
        expect(containersOfPart(readContainerPlacements(CATALOG, composed.value.containerPlacements), "left")
            .map((entry) => entry.containerId)).toEqual([TOOLS]);
    });

    it("恢复视图默认位置把自建容器搬空时同样收口", () => {
        const base = recordOf(
            {[FILES]: placementOf(FILES, CUSTOM, 10)},
            {customContainers: {[CUSTOM]: {originViewId: FILES, location: "panel", order: 5}}},
        );
        const composed = composeViewPlacements(CATALOG, base, [{kind: "restore-view-placement", viewId: FILES}]);

        expect(composed.changed).toBe(true);
        expect(composed.value.customContainers).toBeUndefined();
        expect(composed.value.placements[FILES]).toBeUndefined();
    });

    it("记录序列化后可恢复自建容器与 View 归属（schemaVersion 1 的可选扩展）", () => {
        const composed = composeViewPlacements(CATALOG, recordOf({}), [detach(FILES, TOOLS, CUSTOM)]);
        const restored: unknown = JSON.parse(JSON.stringify(composed.value));

        expect(isWorkbenchViewCustomizationsRecord(restored)).toBe(true);
        const record = restored as WorkbenchViewCustomizationsRecord;
        const catalog = placementCatalogWithContainers(CATALOG, record.customContainers);
        expect(record.customContainers).toEqual({[CUSTOM]: {originViewId: FILES, location: "panel", order: 31}});
        expect(readViewPlacements(catalog, record.placements).placements.find((entry) => entry.viewId === FILES))
            .toEqual({viewId: FILES, containerId: CUSTOM, order: 10, source: "record"});
        expect(record.activeContainerByPart).toEqual({panel: CUSTOM});
    });

    it("后置条件覆盖 customContainers：建容器与收口都进写集，重读后据此核对", () => {
        const base = recordOf(
            {[FILES]: placementOf(FILES, CUSTOM, 10)},
            {customContainers: {[CUSTOM]: {originViewId: FILES, location: "panel", order: 5}}},
        );
        const composed = composeViewPlacements(CATALOG, base, [detach(FILES, CUSTOM, "nbook.custom.2")]);
        const writes = viewPlacementPostconditions(base, composed.value);

        expect(writes).toContainEqual({table: "customContainers", id: CUSTOM, value: undefined});
        expect(writes).toContainEqual({
            table: "customContainers",
            id: "nbook.custom.2",
            value: {originViewId: FILES, location: "panel", order: 31},
        });
        expect(viewPlacementPostconditionsHold(writes, composed.value)).toBe(true);
        expect(viewPlacementPostconditionsHold(writes, base)).toBe(false);
    });
});

describe("composeViewPlacements：边缘并入的半区分配（split）", () => {
    it("跨容器半区移动重放不重复放大尺寸", () => {
        const patch = {
            kind: "move-view" as const, viewId: FILES, sourceContainerId: TOOLS, targetContainerId: PANEL,
            split: {targetViewId: TERMINAL, side: "before", axis: "width", targetSizes: {[TERMINAL]: 800}, sourceSizes: {[FILES]: 300}} satisfies ViewSplitPlacement,
        };
        const first = composeViewPlacements(SPLIT_CATALOG, null, [patch]);
        const replayed = composeViewPlacements(SPLIT_CATALOG, first.value, [patch]);
        expect(first.value.viewSizes?.[FILES]?.width).toBe(400);
        expect(replayed.conflicts).toEqual([]);
        expect(replayed.value.viewSizes).toEqual(first.value.viewSizes);
        expect(replayed.changed).toBe(false);
        const partial = {...first.value, viewSizes: {[TERMINAL]: {width: 800}}};
        const rejected = composeViewPlacements(SPLIT_CATALOG, partial, [patch]);
        expect(rejected.conflicts).not.toEqual([]);
        expect(rejected.changed).toBe(false);
        expect(rejected.value).toEqual(partial);
    });
    /** 左栏（上下排 = height）四个成员、面板（左右排 = width）三个成员；尺寸都是测试给的有效可见叶快照。 */
    const SPLIT_CATALOG: PlacementCatalog = {
        views: {
            [FILES]: {containerId: TOOLS, order: 10, movable: true},
            [OUTLINE]: {containerId: TOOLS, order: 20, movable: true},
            [NOTES]: {containerId: TOOLS, order: 30, movable: true},
            [AGENT]: {containerId: TOOLS, order: 40, movable: true},
            [TERMINAL]: {containerId: PANEL, order: 10, movable: true},
            [SEARCH]: {containerId: PANEL, order: 20, movable: true},
            [TOC]: {containerId: PANEL, order: 30, movable: true},
        },
        containers: [TOOLS, PANEL],
        containerDefaults: {
            [TOOLS]: {location: "sidebar-left", order: 10, movable: true},
            [PANEL]: {location: "panel", order: 30, movable: true},
        },
    };

    const mergeSplit: ViewSplitPlacement = {
        targetViewId: TERMINAL,
        side: "after",
        axis: "width",
        targetSizes: {[TERMINAL]: 400, [SEARCH]: 400},
        sourceSizes: {[OUTLINE]: 300, [NOTES]: 100},
    };
    const mergeIntent = (split: ViewSplitPlacement) => ({
        kind: "merge-container" as const,
        sourceContainerId: TOOLS,
        sourceLocation: "sidebar-left" as const,
        targetContainerId: PANEL,
        targetLocation: "panel" as const,
        sourceViewIds: [FILES, OUTLINE, NOTES, AGENT],
        split,
    });
    const sizesOf = (record: WorkbenchViewCustomizationsRecord) => record.viewSizes ?? {};

    it("跨容器：命中叶取一半，拖入的可见成员按 3:1 分另一半，其它成员快照不变", () => {
        const composed = composeViewPlacements(SPLIT_CATALOG, recordOf({}), [mergeIntent(mergeSplit)]);

        expect(composed.conflicts).toEqual([]);
        expect(composed.changed).toBe(true);
        // 400 的一半是 200：OUTLINE:NOTES = 3:1 拿走 150 / 50；SEARCH 保持 400 不被重置。
        expect(sizesOf(composed.value)).toEqual({
            [TERMINAL]: {width: 200},
            [SEARCH]: {width: 400},
            [OUTLINE]: {width: 150},
            [NOTES]: {width: 50},
        });
        // 隐藏成员（不在任何一张表里）照旧搬归属，但不凭空占几何。
        expect(composed.value.placements[FILES]!.containerId).toBe(PANEL);
        expect(sizesOf(composed.value)[FILES]).toBeUndefined();
        expect(sizesOf(composed.value)[AGENT]).toBeUndefined();
        // 整组按冻结顺序落在命中叶之后（side: "after"）。
        expect(placementsOfContainer(readViewPlacements(SPLIT_CATALOG, composed.value.placements), PANEL)
            .map((entry) => entry.viewId)).toEqual([TERMINAL, FILES, OUTLINE, NOTES, AGENT, SEARCH, TOC]);
    });

    it("整组重放核对方向和尺寸，第三方部分改动不被补写", () => {
        const intent = mergeIntent(mergeSplit);
        const first = composeViewPlacements(SPLIT_CATALOG, null, [intent]).value;
        expect(composeViewPlacements(SPLIT_CATALOG, first, [intent]).changed).toBe(false);
        const changedSize = {...first, viewSizes: {...first.viewSizes, [OUTLINE]: {width: 99}}};
        const wrongSide = {...first, placements: {...first.placements, [TERMINAL]: placementOf(TERMINAL, PANEL, 100)}};
        for (const base of [changedSize, wrongSide]) {
            const rejected = composeViewPlacements(SPLIT_CATALOG, base, [intent]);
            expect(rejected.conflicts).not.toEqual([]);
            expect(rejected.changed).toBe(false);
            expect(rejected.value).toEqual(base);
        }
    });

    it("自建源合并后收口，保存应答丢失的重放仍认完整落账", () => {
        const base = recordOf({[FILES]: placementOf(FILES, CUSTOM, 10)}, {
            customContainers: {[CUSTOM]: {originViewId: FILES, location: "sidebar-left", order: 5}},
        });
        const intent = {...mergeIntent(mergeSplit), sourceContainerId: CUSTOM, sourceViewIds: [FILES],
            split: {...mergeSplit, sourceSizes: {[FILES]: 300}}};
        const first = composeViewPlacements(SPLIT_CATALOG, base, [intent]);
        expect(first.conflicts).toEqual([]);
        expect(first.value.customContainers).toBeUndefined();
        const replayed = composeViewPlacements(SPLIT_CATALOG, first.value, [intent]);
        expect(replayed.conflicts).toEqual([]);
        expect(replayed.changed).toBe(false);
        expect(replayed.value).toEqual(first.value);
    });

    it("目标换到侧栏后按高度分配来源比例，另一轴不改写", () => {
        const vertical: ViewSplitPlacement = {
            targetViewId: TERMINAL,
            side: "before",
            axis: "height",
            targetSizes: {[TERMINAL]: 300, [SEARCH]: 300},
            sourceSizes: {[OUTLINE]: 300, [NOTES]: 100},
        };
        // 目标容器在侧栏（上下排）：轴的判据来自目标的生效落位，不是来源的。
        const composed = composeViewPlacements(SPLIT_CATALOG, recordOf({}, {
            containerPlacements: {[PANEL]: {location: "sidebar-left", order: 20, defaultLocation: "panel", defaultOrder: 30}},
        }), [{
            ...mergeIntent(vertical),
            targetLocation: "sidebar-left",
        }]);

        expect(composed.conflicts).toEqual([]);
        // 目标轴 height：来源 3:1 分 150，另一轴不因这次分屏被换算或补写。
        expect(sizesOf(composed.value)).toEqual({
            [TERMINAL]: {height: 150},
            [SEARCH]: {height: 300},
            [OUTLINE]: {height: 112.5},
            [NOTES]: {height: 37.5},
        });
    });

    it("同容器移动：只改变成员顺序，所有视图保留原尺寸", () => {
        const base = recordOf({
            [TERMINAL]: placementOf(TERMINAL, PANEL, 10, {containerId: PANEL, order: 10}),
            [SEARCH]: placementOf(SEARCH, PANEL, 20, {containerId: PANEL, order: 20}),
            [TOC]: placementOf(TOC, PANEL, 30, {containerId: PANEL, order: 30}),
        }, {activeContainerByPart: {panel: PANEL}, viewSizes: {[TERMINAL]: {width: 300}, [SEARCH]: {width: 100}, [TOC]: {width: 400}}});
        const split: ViewSplitPlacement = {
            targetViewId: TOC,
            side: "before",
            axis: "width",
            targetSizes: {[TERMINAL]: 300, [SEARCH]: 100, [TOC]: 400},
            sourceSizes: {[TERMINAL]: 300},
        };
        const composed = composeViewPlacements(SPLIT_CATALOG, base, [{
            kind: "move-view",
            viewId: TERMINAL,
            sourceContainerId: PANEL,
            targetContainerId: PANEL,
            split,
        }]);

        expect(composed.conflicts).toEqual([]);
        expect(sizesOf(composed.value)).toEqual({[TERMINAL]: {width: 300}, [SEARCH]: {width: 100}, [TOC]: {width: 400}});
        // 同容器的边缘落点不能被旧的"同位置无操作"吞掉：这是一次真实换序。
        expect(placementsOfContainer(readViewPlacements(SPLIT_CATALOG, composed.value.placements), PANEL)
            .map((entry) => entry.viewId)).toEqual([SEARCH, TERMINAL, TOC]);
    });

    it("重放已经落账的同容器边缘落点：位置不再重算，尺寸保持不变", () => {
        const base = recordOf({
            [TERMINAL]: placementOf(TERMINAL, PANEL, 10, {containerId: PANEL, order: 10}),
            [SEARCH]: placementOf(SEARCH, PANEL, 20, {containerId: PANEL, order: 20}),
        }, {viewSizes: {[TERMINAL]: {width: 400}, [SEARCH]: {width: 400}}});
        const patch = {
            kind: "move-view" as const,
            viewId: SEARCH,
            sourceContainerId: PANEL,
            targetContainerId: PANEL,
            split: {
                targetViewId: TERMINAL,
                side: "before",
                axis: "width",
                targetSizes: {[TERMINAL]: 400, [SEARCH]: 400},
                sourceSizes: {[SEARCH]: 400},
            } satisfies ViewSplitPlacement,
        };
        const first = composeViewPlacements(SPLIT_CATALOG, base, [patch]);
        const again = composeViewPlacements(SPLIT_CATALOG, first.value, [patch]);

        expect(placementsOfContainer(readViewPlacements(SPLIT_CATALOG, first.value.placements), PANEL)
            .map((entry) => entry.viewId)).toEqual([SEARCH, TERMINAL, TOC]);
        expect(first.value.viewSizes).toEqual(base.viewSizes);
        expect(again.changed).toBe(false);
        expect(again.conflicts).toEqual([]);
        expect(again.value.viewSizes).toEqual(base.viewSizes);
    });

    it("没有可见的拖入成员（全隐藏）：只搬归属，不切开命中叶也不写尺寸", () => {
        const composed = composeViewPlacements(SPLIT_CATALOG, recordOf({}), [mergeIntent({
            targetViewId: TERMINAL,
            side: "before",
            axis: "width",
            targetSizes: {[TERMINAL]: 400},
            sourceSizes: {},
        })]);

        expect(composed.changed).toBe(true);
        expect(composed.conflicts).toEqual([]);
        expect(composed.value.viewSizes).toBeUndefined();
        expect(placementsOfContainer(readViewPlacements(SPLIT_CATALOG, composed.value.placements), PANEL)
            .map((entry) => entry.viewId)).toEqual([FILES, OUTLINE, NOTES, AGENT, TERMINAL, SEARCH, TOC]);
    });

    it("轴不符 / 命中叶不是目标成员 / 命中叶就是被拖的 View / 尺寸或成员快照非法：整条不写", () => {
        const moveSplit = (split: ViewSplitPlacement) => ({
            kind: "move-view" as const,
            viewId: TERMINAL,
            sourceContainerId: PANEL,
            targetContainerId: PANEL,
            split,
        });
        const rejected = [
            // 轴不符：面板内部是左右排（width）。
            moveSplit({targetViewId: SEARCH, side: "before", axis: "height", targetSizes: {[TERMINAL]: 300, [SEARCH]: 300}, sourceSizes: {[TERMINAL]: 300}}),
            // 命中叶已经不在目标容器里。
            moveSplit({targetViewId: AGENT, side: "before", axis: "width", targetSizes: {[TERMINAL]: 300, [SEARCH]: 300}, sourceSizes: {[TERMINAL]: 300}}),
            // 命中叶就是被拖进来的那个 View。
            moveSplit({targetViewId: TERMINAL, side: "before", axis: "width", targetSizes: {[TERMINAL]: 300, [SEARCH]: 300}, sourceSizes: {[TERMINAL]: 300}}),
            // 尺寸不是正有限数。
            moveSplit({targetViewId: SEARCH, side: "before", axis: "width", targetSizes: {[TERMINAL]: 0, [SEARCH]: 300}, sourceSizes: {[TERMINAL]: 300}}),
            // 尺寸表里有不属于目标容器的视图。
            moveSplit({targetViewId: SEARCH, side: "before", axis: "width", targetSizes: {[TERMINAL]: 300, [NOTES]: 300}, sourceSizes: {[TERMINAL]: 300}}),
            // 命中叶没有几何（快照里缺它）。
            moveSplit({targetViewId: SEARCH, side: "before", axis: "width", targetSizes: {[TERMINAL]: 300}, sourceSizes: {[TERMINAL]: 300}}),
        ];

        for (const patch of rejected) {
            const composed = composeViewPlacements(SPLIT_CATALOG, recordOf({
                [TERMINAL]: placementOf(TERMINAL, PANEL, 10, {containerId: PANEL, order: 10}),
                [SEARCH]: placementOf(SEARCH, PANEL, 20, {containerId: PANEL, order: 20}),
            }), [patch]);

            expect(composed.changed).toBe(false);
            expect(composed.value.viewSizes).toBeUndefined();
            expect(composed.value.placements[TERMINAL]!.order).toBe(10);
            expect(composed.conflicts).toHaveLength(1);
        }
    });

    it("整组并入的 split 校验失败同样整条不写：成员归属一个都不动", () => {
        const composed = composeViewPlacements(SPLIT_CATALOG, recordOf({}), [mergeIntent({
            ...mergeSplit,
            axis: "height",
        })]);

        expect(composed.changed).toBe(false);
        expect(composed.conflicts[0]).toContain("轴");
        expect(composed.value.placements).toEqual({});
        expect(composed.value.viewSizes).toBeUndefined();
        expect(composed.value.suppressedContainers).toBeUndefined();
    });
});
