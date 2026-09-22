import {describe, expect, it} from "vitest";
import {GRID_DROP_INDICATOR_PX, type GridDropRect, type GridOrientation} from "@notnotype/nb-ui/layout";
import {
    isSameWorkbenchDropAction,
    resolveWorkbenchDrop,
    type WorkbenchDropContainer,
    type WorkbenchDropContentRects,
    type WorkbenchDropDecision,
    type WorkbenchDropInput,
    type WorkbenchDropPresentation,
    type WorkbenchDropPreview,
    type WorkbenchDropSwitcherRects,
    type WorkbenchDropTarget,
    type WorkbenchDropSource,
} from "nbook/app/utils/workbench/workbench-drop";
import type {ToolPartId, ToolPartLocation} from "nbook/app/utils/workbench/view-placements";

/**
 * 拖放判定的纯行为：三类目标 × 两种源、前后各 50% 命中与半区反馈同源、非法方向禁投、空 Part 整区接收、
 * 切换器单线（含视图 detach 建容器）、geometry 过期与非法输入、失效声明不退化、动作一致性（含 split 冻结尺寸）。
 *
 * 断言的是"要不要写记录、写什么请求、看到的是哪种形状"——记录层自己的边界（`resolveViewMove` / `detachView` 等）
 * 不在这里复述，也不把 dnd-kit 的命中算法搬进来。预览只锁不变量（半区归属、线有厚度且在带内），不复述
 * nb-ui 插入函数内部的夹紧算式：那是它自己的回归。
 */

const LEFT: ToolPartLocation = "sidebar-left";
const PANEL: ToolPartLocation = "panel";
const WORKSPACE = "workspace-1";

const A = "nbook.a";
const B = "nbook.b";
const C = "nbook.c";
const PANEL_CONTAINER = "nbook.panel";
const FILES = "nbook.files";
const OUTLINE = "nbook.outline";
const TOOLS = "nbook.tools";
const SEARCH = "nbook.search";

/** 侧栏容器内容盒：300×400，上下排的叶 rect 由用例按呈现顺序给出。 */
const CONTENT_BOX = {left: 0, top: 0, right: 300, bottom: 400};

/** Panel 容器内容盒：400×200，左右排的叶 rect 由用例按呈现顺序给出。 */
const PANEL_BOX = {left: 0, top: 0, right: 400, bottom: 200};

function containerOf(options: {
    containerId: string;
    location?: ToolPartLocation;
    partId?: ToolPartId;
    canMoveContainer?: boolean;
    /** 全部已登记生效成员（含 hidden / collapsed）。 */
    memberViewIds?: readonly string[];
    /** 可见成员；缺省与 `memberViewIds` 相同（即没有 hidden）。 */
    visibleViewIds?: readonly string[];
    /** 呈现层给的展开主轴尺寸意图（源轴 px）：内容几何量不出来时的来源比例。 */
    sizeIntents?: Readonly<Record<string, number>>;
    /** 收成细条的可见成员。 */
    collapsedViewIds?: readonly string[];
    /** 该容器里 View 可投递到的其它容器。 */
    moveTargets?: readonly string[];
    /** 容器内部编排方向；缺省上下排（sidebar-left / sidebar-right）。 */
    orientation?: GridOrientation;
}): WorkbenchDropContainer {
    const visible = options.visibleViewIds ?? options.memberViewIds ?? [];
    return {
        containerId: options.containerId,
        location: options.location ?? LEFT,
        partId: options.partId ?? "left",
        canMoveContainer: options.canMoveContainer ?? true,
        orientation: options.orientation ?? "vertical",
        memberViewIds: options.memberViewIds ?? [],
        views: visible.map((id) => ({view: {id}})),
        ...(options.sizeIntents === undefined ? {} : {sizeIntents: options.sizeIntents}),
        ...(options.collapsedViewIds === undefined ? {} : {collapsedViewIds: options.collapsedViewIds}),
        moveTargets: (options.moveTargets ?? []).map((containerId) => ({containerId})),
    };
}

function presentationOf(
    containers: readonly WorkbenchDropContainer[],
    active: Partial<Record<ToolPartId, string | null>> = {},
): WorkbenchDropPresentation {
    return {
        container: (containerId) => containers.find((slice) => slice.containerId === containerId) ?? null,
        part: (partId) => {
            const own = containers.filter((slice) => slice.partId === partId);
            const declared = active[partId];
            return {
                partId,
                containers: own,
                activeContainerId: declared === undefined ? own[0]?.containerId ?? null : declared,
            };
        },
    };
}

/** 上下排（vertical）内容区的叶：按呈现顺序给上下边界。 */
function row(id: string, top: number, bottom: number) {
    return {id, rect: {left: 0, top, right: 300, bottom}};
}

/** 左右排（horizontal）内容区的叶：按呈现顺序给左右边界。 */
function column(id: string, left: number, right: number) {
    return {id, rect: {left, top: 0, right, bottom: 200}};
}

/** 标签带（horizontal）条目：按切换器顺序给左右边界。 */
function tab(containerId: string, left: number, right: number) {
    return {containerId, rect: {left, top: 0, right, bottom: 30}};
}

/** Activity Bar（vertical）条目：按切换器顺序给上下边界。 */
function slot(containerId: string, top: number, bottom: number) {
    return {containerId, rect: {left: 0, top, right: 40, bottom}};
}

function drop(input: {
    source: WorkbenchDropSource;
    target: WorkbenchDropTarget;
    point: {x: number; y: number};
    presentation: WorkbenchDropPresentation;
    content?: WorkbenchDropContentRects | null;
    sourceContent?: WorkbenchDropContentRects | null;
    switcher?: WorkbenchDropSwitcherRects | null;
    empty?: GridDropRect | null;
    contextKey?: string;
}): WorkbenchDropDecision {
    const full: WorkbenchDropInput = {
        source: input.source,
        target: input.target,
        point: input.point,
        rects: {
            content: input.content ?? null,
            sourceContent: input.sourceContent ?? null,
            switcher: input.switcher ?? null,
            empty: input.empty ?? null,
        },
        presentation: input.presentation,
        contextKey: input.contextKey ?? WORKSPACE,
    };
    return resolveWorkbenchDrop(full);
}

/** 取出"一定是这个 kind"的决策；不是就直接失败，免得每个用例自己写类型收窄。 */
function decisionOf<K extends WorkbenchDropDecision["kind"]>(
    decision: WorkbenchDropDecision,
    kind: K,
): Extract<WorkbenchDropDecision, {kind: K}> {
    if (decision.kind !== kind) {
        throw new Error(`期望 ${kind}，实际是 ${JSON.stringify(decision)}`);
    }
    return decision as Extract<WorkbenchDropDecision, {kind: K}>;
}

function rejectionReason(decision: WorkbenchDropDecision): string {
    return decisionOf(decision, "rejected").reason;
}

/**
 * 带预览的 render-only noop：释放不提交，但反馈照画（切换器的原位插入位就是这一档）。
 * 预览必须逐字匹配——它就是共享求值当场给出的那一份，界面不再自己算一遍。
 */
function noopPreview(decision: WorkbenchDropDecision): WorkbenchDropPreview {
    const noop = decisionOf(decision, "noop");
    if (noop.preview === undefined) {
        throw new Error("这个 noop 应当带 render-only 预览");
    }
    return noop.preview;
}

/**
 * 边缘并入的半区不变量：命中叶沿目标轴的前/后一半（前缘带取前一半、后缘带与追加取后一半），
 * 交叉轴仍是那一叶的可见跨度、整块夹在内容盒里；这种落点**没有**插入线，也没有条目高亮。
 */
function expectHalfArea(
    preview: WorkbenchDropPreview,
    expected: {member: GridDropRect; side: "before" | "after"; box: GridDropRect; orientation: GridOrientation},
): void {
    const {member, side, box, orientation} = expected;
    const half = preview.areaRect;
    if (half === null) {
        throw new Error("边缘并入的预览应当给命中半区");
    }
    const horizontal = orientation === "horizontal";
    const start = horizontal ? member.left : member.top;
    const end = horizontal ? member.right : member.bottom;
    const mid = (start + end) / 2;
    expect(horizontal ? [half.left, half.right] : [half.top, half.bottom])
        .toEqual(side === "before" ? [start, mid] : [mid, end]);
    expect(horizontal ? [half.top, half.bottom] : [half.left, half.right])
        .toEqual(horizontal ? [member.top, member.bottom] : [member.left, member.right]);
    expect(half.left).toBeGreaterThanOrEqual(box.left);
    expect(half.top).toBeGreaterThanOrEqual(box.top);
    expect(half.right).toBeLessThanOrEqual(box.right);
    expect(half.bottom).toBeLessThanOrEqual(box.bottom);
    expect(preview.indicator).toBeNull();
    expect(preview.entryRect).toBeNull();
    expect(preview.orientation).toBe(orientation);
}

/**
 * 插入线的不变量：有厚度、贴着给定边界（夹紧允许 ≤2px 位移）、整条落在条目带里。
 * 不复述夹紧算式本身。
 */
function expectLine(
    preview: WorkbenchDropPreview,
    expected: {orientation: GridOrientation; boundary: number; band: GridDropRect},
): void {
    const line = preview.indicator;
    if (line === null) {
        throw new Error("这个落点应当给插入线");
    }
    const horizontal = expected.orientation === "horizontal";
    const [start, end] = horizontal ? [line.left, line.right] : [line.top, line.bottom];
    const [bandStart, bandEnd] = horizontal ? [expected.band.left, expected.band.right] : [expected.band.top, expected.band.bottom];
    expect(end - start).toBeGreaterThan(0);
    expect(end - start).toBeLessThanOrEqual(GRID_DROP_INDICATOR_PX);
    expect(start).toBeGreaterThanOrEqual(bandStart);
    expect(end).toBeLessThanOrEqual(bandEnd);
    expect(Math.abs(start - expected.boundary)).toBeLessThanOrEqual(GRID_DROP_INDICATOR_PX);
    expect(horizontal ? [line.top, line.bottom] : [line.left, line.right])
        .toEqual(horizontal ? [expected.band.top, expected.band.bottom] : [expected.band.left, expected.band.right]);
    // 新合同：切换器只有那一条线，没有区域、也没有条目高亮。
    expect(preview.areaRect).toBeNull();
    expect(preview.entryRect).toBeNull();
}

describe("视图源 → 容器内容区（半区并入）", () => {
    const source: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: A, location: LEFT, contextKey: WORKSPACE};

    it("跨容器命中前缘带：一条带 split 的 move-view，反馈是命中叶的前半", () => {
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 30},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
                containerOf({containerId: B, memberViewIds: [TOOLS]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        });
        const move = decisionOf(decision, "move-view");
        // 侧向由 side 表达，锚点不再重复写一遍（记录层不读带 split 的 `beforeViewId`）。
        expect(move.request).toEqual({
            viewId: FILES,
            sourceContainerId: A,
            targetContainerId: B,
            split: {
                targetViewId: TOOLS,
                side: "before",
                axis: "height",
                targetSizes: {[TOOLS]: 200},
                sourceSizes: {[FILES]: 400},
            },
        });
        expect(Object.hasOwn(move.request, "beforeViewId")).toBe(false);
        expect(move.preview).toEqual({
            indicator: null,
            areaRect: {left: 0, top: 0, right: 300, bottom: 100},
            entryRect: null,
            orientation: "vertical",
            count: 1,
        });
        expectHalfArea(move.preview, {member: row(TOOLS, 0, 200).rect, side: "before", box: CONTENT_BOX, orientation: "vertical"});
    });

    it("命中后缘带：插入位归命中叶自己、侧向是 after，目标尺寸带走全部可见叶", () => {
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 190},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
                containerOf({containerId: B, memberViewIds: [TOOLS, SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200), row(SEARCH, 200, 300)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        });
        const move = decisionOf(decision, "move-view");
        expect(move.request.split).toEqual({
            targetViewId: TOOLS,
            side: "after",
            axis: "height",
            targetSizes: {[TOOLS]: 200, [SEARCH]: 100},
            sourceSizes: {[FILES]: 400},
        });
        // 反馈是命中叶 TOOLS 的后半 [100,200]，不是下一叶 SEARCH 的前缘带（按中点找叶会在这里跳叶）。
        expectHalfArea(move.preview, {member: row(TOOLS, 0, 200).rect, side: "after", box: CONTENT_BOX, orientation: "vertical"});
    });

    it("越过末叶末端仍是命中末叶的后半（追加位置由 side 表达）", () => {
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 350},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
                containerOf({containerId: B, memberViewIds: [TOOLS, SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200), row(SEARCH, 200, 300)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        });
        const move = decisionOf(decision, "move-view");
        expect(move.request.split).toEqual({
            targetViewId: SEARCH,
            side: "after",
            axis: "height",
            targetSizes: {[TOOLS]: 200, [SEARCH]: 100},
            sourceSizes: {[FILES]: 400},
        });
        expectHalfArea(move.preview, {member: row(SEARCH, 200, 300).rect, side: "after", box: CONTENT_BOX, orientation: "vertical"});
    });

    it("中点归后半，前后两半都提交对应半区", () => {
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
            containerOf({containerId: B, memberViewIds: [TOOLS]}),
        ]);
        const content = {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 100, 300)]};
        const at = (y: number) => decisionOf(drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y},
            presentation,
            content,
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        }), "move-view");
        expect(at(150).request.split?.side).toBe("before");
        expect(at(200).request.split?.side).toBe("after");
        expect(at(250).request.split?.side).toBe("after");
    });
    it("可见成员全部收成细条时，落点覆盖细条后的剩余区域且不拆半", () => {
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
            containerOf({
                containerId: B,
                memberViewIds: [TOOLS, SEARCH],
                collapsedViewIds: [TOOLS, SEARCH],
                orientation: "horizontal",
            }),
        ]);
        const decision = decisionOf(drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 200, y: 100},
            presentation,
            content: {
                containerId: B,
                rect: PANEL_BOX,
                members: [
                    {id: TOOLS, rect: {left: 0, top: 0, right: 32, bottom: 200}},
                    {id: SEARCH, rect: {left: 32, top: 0, right: 64, bottom: 200}},
                ],
            },
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        }), "move-view");
        expect(decision.request.split).toBeUndefined();
        expect(decision.preview.areaRect).toEqual({left: 64, top: 0, right: 400, bottom: 200});
    });

    it("命中叶就是被拖的那个 View：整片叶都是原位，连预览都不给", () => {
        const presentation = presentationOf([containerOf({containerId: A, memberViewIds: [FILES]})]);
        const content = {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]};
        const at = (y: number) => drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: A, location: LEFT},
            point: {x: 150, y},
            presentation,
            content,
            sourceContent: content,
        });
        for (const y of [30, 200, 380]) {
            expect(at(y)).toEqual({kind: "noop"});
        }
    });

    it("同容器的别的叶是真正的局部半区并入：顺序不变也照样提交 split", () => {
        const geometry = {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 100), row(TOOLS, 100, 200)]};
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: A, location: LEFT},
            point: {x: 150, y: 110},
            presentation: presentationOf([containerOf({containerId: A, memberViewIds: [FILES, TOOLS]})]),
            content: geometry,
            sourceContent: geometry,
        });
        const move = decisionOf(decision, "move-view");
        expect(move.request).toEqual({
            viewId: FILES,
            sourceContainerId: A,
            targetContainerId: A,
            split: {
                targetViewId: TOOLS,
                side: "before",
                axis: "height",
                targetSizes: {[FILES]: 100, [TOOLS]: 100},
                sourceSizes: {[FILES]: 100},
            },
        });
        expectHalfArea(move.preview, {member: row(TOOLS, 100, 200).rect, side: "before", box: CONTENT_BOX, orientation: "vertical"});
    });

    it("左右排的 Panel 沿 x 求命中叶与半区，轴是 width", () => {
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: PANEL_CONTAINER, location: PANEL},
            point: {x: 220, y: 100},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [PANEL_CONTAINER]}),
                containerOf({containerId: PANEL_CONTAINER, location: PANEL, partId: "panel", orientation: "horizontal", memberViewIds: [TOOLS, SEARCH]}),
            ]),
            content: {containerId: PANEL_CONTAINER, rect: PANEL_BOX, members: [column(TOOLS, 0, 200), column(SEARCH, 200, 400)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        });
        const move = decisionOf(decision, "move-view");
        expect(move.request.split).toEqual({
            targetViewId: SEARCH,
            side: "before",
            axis: "width",
            targetSizes: {[TOOLS]: 200, [SEARCH]: 200},
            // 跨轴并入：来源按**自己的轴**量（这里是高度 400），记录层只把它当相对比例用。
            sourceSizes: {[FILES]: 400},
        });
        expectHalfArea(move.preview, {member: column(SEARCH, 200, 400).rect, side: "before", box: PANEL_BOX, orientation: "horizontal"});
    });

    it("来源几何量不出来时单 View 用比例 1；几何来自别的容器则拒绝", () => {
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
            containerOf({containerId: B, memberViewIds: [TOOLS]}),
        ]);
        const content = {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200)]};
        const single = decisionOf(drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 30},
            presentation,
            content,
        }), "move-view");
        // 只有一个可见成员时比例唯一，几何缺一份也不影响另一半的分配。
        expect(single.request.split?.sourceSizes).toEqual({[FILES]: 1});
        expect(rejectionReason(drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 30},
            presentation,
            content,
            sourceContent: {containerId: C, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
        }))).toContain("不一致");
    });

    it("内容盒量不出来、坐标非法、指针在盒外或没有可用叶都不给落点", () => {
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
            containerOf({containerId: B, memberViewIds: [TOOLS]}),
        ]);
        const target: WorkbenchDropTarget = {kind: "workbench-container-content-target", containerId: B, location: LEFT};
        const sourceContent = {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]};
        const members = [row(TOOLS, 0, 200)];
        expect(drop({source, target, point: {x: 10, y: 10}, presentation, sourceContent})).toEqual({kind: "noop"});
        expect(drop({source, target, point: {x: 10, y: 10}, presentation, sourceContent, content: {containerId: B, rect: {left: 0, top: 0, right: 0, bottom: 0}, members}}))
            .toEqual({kind: "noop"});
        expect(drop({source, target, point: {x: Number.NaN, y: 10}, presentation, sourceContent, content: {containerId: B, rect: CONTENT_BOX, members}}))
            .toEqual({kind: "noop"});
        expect(drop({source, target, point: {x: 999, y: 10}, presentation, sourceContent, content: {containerId: B, rect: CONTENT_BOX, members}}))
            .toEqual({kind: "noop"});
        // 目标一片可见叶都没有（成员可能全 hidden）：没有半区可并入，也**不**退化成追加。
        expect(drop({source, target, point: {x: 150, y: 100}, presentation, sourceContent, content: {containerId: B, rect: CONTENT_BOX, members: []}}))
            .toEqual({kind: "noop"});
    });

    it("几何里的成员不是该容器的可见成员、或出现重复成员时拒绝", () => {
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
            containerOf({containerId: B, memberViewIds: [TOOLS]}),
        ]);
        const target: WorkbenchDropTarget = {kind: "workbench-container-content-target", containerId: B, location: LEFT};
        const sourceContent = {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]};
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 50},
            presentation,
            sourceContent,
            content: {containerId: B, rect: CONTENT_BOX, members: [row(SEARCH, 0, 200)]},
        }))).toContain(SEARCH);
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 50},
            presentation,
            sourceContent,
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200), row(TOOLS, 200, 400)]},
        }))).toContain("重复成员");
    });

    it("视图不可见、目标不在 moveTargets、目标容器不可呈现时拒绝（权限先于几何）", () => {
        const hidden: WorkbenchDropSource = {kind: "workbench-view", viewId: OUTLINE, containerId: A, location: LEFT, contextKey: WORKSPACE};
        const target: WorkbenchDropTarget = {kind: "workbench-container-content-target", containerId: B, location: LEFT};
        // y=100 位于 TOOLS 前半：权限先于几何，禁投也不替一个不允许的落点背书。
        const content = {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200)]};
        expect(rejectionReason(drop({
            source: hidden,
            target,
            point: {x: 150, y: 100},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES, OUTLINE], visibleViewIds: [FILES], moveTargets: [B]}),
                containerOf({containerId: B, memberViewIds: [TOOLS]}),
            ]),
            content,
        }))).toContain("不可见");
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 100},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [C]}),
                containerOf({containerId: B, memberViewIds: [TOOLS]}),
            ]),
            content,
        }))).toContain("可移动目标");
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 100},
            presentation: presentationOf([containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]})]),
            content,
        }))).toContain("不可呈现");
    });
});

describe("容器源 → 容器内容区（整组并入带 split）", () => {
    it("整组并入是一条 merge-container，成员快照含 hidden、来源比例只含可见成员", () => {
        const source: WorkbenchDropSource = {
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey: WORKSPACE,
            viewIds: [FILES, OUTLINE, TOOLS],
        };
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 20},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES, OUTLINE, TOOLS], visibleViewIds: [FILES, TOOLS]}),
                containerOf({containerId: B, memberViewIds: [SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(SEARCH, 0, 100)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 200), row(TOOLS, 200, 400)]},
        });
        const merge = decisionOf(decision, "merge-container");
        expect(merge.request).toEqual({
            sourceContainerId: A,
            sourceLocation: LEFT,
            targetContainerId: B,
            targetLocation: LEFT,
            sourceViewIds: [FILES, OUTLINE, TOOLS],
            contextKey: WORKSPACE,
            split: {
                targetViewId: SEARCH,
                side: "before",
                axis: "height",
                targetSizes: {[SEARCH]: 100},
                sourceSizes: {[FILES]: 200, [TOOLS]: 200},
            },
        });
        expect(Object.hasOwn(merge.request, "beforeViewId")).toBe(false);
        expect(merge.preview).toEqual({
            indicator: null,
            areaRect: {left: 0, top: 0, right: 300, bottom: 50},
            entryRect: null,
            orientation: "vertical",
            count: 3,
        });
        expectHalfArea(merge.preview, {member: row(SEARCH, 0, 100).rect, side: "before", box: CONTENT_BOX, orientation: "vertical"});
    });

    it("内容停在 hidden parking（几何为 null）时按尺寸意图比例，不把 null 当拒绝", () => {
        const source: WorkbenchDropSource = {
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey: WORKSPACE,
            viewIds: [FILES, OUTLINE, TOOLS],
        };
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 190},
            presentation: presentationOf([
                containerOf({
                    containerId: A,
                    memberViewIds: [FILES, OUTLINE, TOOLS],
                    visibleViewIds: [FILES, TOOLS],
                    sizeIntents: {[FILES]: 300, [TOOLS]: 100},
                }),
                containerOf({containerId: B, memberViewIds: [TOOLS, SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200), row(SEARCH, 200, 300)]},
        });
        const merge = decisionOf(decision, "merge-container");
        // 比例来自展开意图（3:1），hidden 的 OUTLINE 不进任何一张表。
        expect(merge.request.split).toEqual({
            targetViewId: TOOLS,
            side: "after",
            axis: "height",
            targetSizes: {[TOOLS]: 200, [SEARCH]: 100},
            sourceSizes: {[FILES]: 300, [TOOLS]: 100},
        });
    });

    it("几何与尺寸意图都缺一个要搬的可见成员时整条拒绝，不降级成追加", () => {
        const source: WorkbenchDropSource = {
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey: WORKSPACE,
            viewIds: [FILES, TOOLS],
        };
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 20},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES, TOOLS], sizeIntents: {[FILES]: 300}}),
                containerOf({containerId: B, memberViewIds: [SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(SEARCH, 0, 100)]},
        });
        const reason = rejectionReason(decision);
        expect(reason).toContain(TOOLS);
        expect(reason).toContain("来源比例");
    });

    it("整容器只剩 hidden 成员：成员照搬但两张表都不给尺寸", () => {
        const source: WorkbenchDropSource = {
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey: WORKSPACE,
            viewIds: [OUTLINE],
        };
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 20},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [OUTLINE], visibleViewIds: []}),
                containerOf({containerId: B, memberViewIds: [SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(SEARCH, 0, 100)]},
        });
        const merge = decisionOf(decision, "merge-container");
        expect(merge.request.sourceViewIds).toEqual([OUTLINE]);
        expect(merge.request.split?.sourceSizes).toEqual({});
        expect(merge.preview.count).toBe(1);
    });

    it("载荷漏掉 hidden 成员时整组拒绝，不做只搬可见部分的半状态", () => {
        const source: WorkbenchDropSource = {
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey: WORKSPACE,
            viewIds: [FILES, TOOLS],
        };
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 20},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES, OUTLINE, TOOLS], visibleViewIds: [FILES, TOOLS]}),
                containerOf({containerId: B, memberViewIds: [SEARCH]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(SEARCH, 0, 100)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 200), row(TOOLS, 200, 400)]},
        });
        expect(rejectionReason(decision)).toContain("成员在拖动期间已经变化");
    });

    it("同源同目标、空源都是 noop（整容器不落进自己）", () => {
        const same: WorkbenchDropSource = {kind: "workbench-container", containerId: A, location: LEFT, contextKey: WORKSPACE, viewIds: [FILES]};
        const empty: WorkbenchDropSource = {kind: "workbench-container", containerId: B, location: LEFT, contextKey: WORKSPACE, viewIds: []};
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES]}),
            containerOf({containerId: B, memberViewIds: []}),
        ]);
        const content = {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 100)]};
        expect(drop({
            source: same,
            target: {kind: "workbench-container-content-target", containerId: A, location: LEFT},
            point: {x: 150, y: 20},
            presentation,
            content,
            sourceContent: content,
        })).toEqual({kind: "noop"});
        expect(drop({
            source: empty,
            target: {kind: "workbench-container-content-target", containerId: A, location: LEFT},
            point: {x: 150, y: 20},
            presentation,
            content,
        })).toEqual({kind: "noop"});
    });

    it("源容器不可移动、来源落位变了、目标被抑制时整组拒绝", () => {
        const source: WorkbenchDropSource = {
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey: WORKSPACE,
            viewIds: [FILES],
        };
        const target: WorkbenchDropTarget = {kind: "workbench-container-content-target", containerId: B, location: LEFT};
        const content = {containerId: B, rect: CONTENT_BOX, members: [row(SEARCH, 0, 100)]};
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 20},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], canMoveContainer: false}),
                containerOf({containerId: B, memberViewIds: [SEARCH]}),
            ]),
            content,
        }))).toContain("不可移动");
        expect(rejectionReason(drop({
            source: {...source, location: PANEL},
            target,
            point: {x: 150, y: 20},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES]}),
                containerOf({containerId: B, memberViewIds: [SEARCH]}),
            ]),
            content,
        }))).toContain("当前落位");
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 20},
            presentation: presentationOf([containerOf({containerId: A, memberViewIds: [FILES]})]),
            content,
        }))).toContain("不可呈现");
    });
});

describe("空 Part 的整区落点", () => {
    const EMPTY_BODY: GridDropRect = {left: 0, top: 0, right: 280, bottom: 600};
    const emptyPart = presentationOf([
        containerOf({containerId: PANEL_CONTAINER, location: PANEL, partId: "panel", memberViewIds: [FILES], orientation: "horizontal"}),
    ]);
    const panelSource: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: PANEL_CONTAINER, location: PANEL, contextKey: WORKSPACE};

    it("视图落到空 Part：detach 到该落位，反馈是整个区域", () => {
        const decision = drop({
            source: panelSource,
            target: {kind: "workbench-part-empty-target", partId: "left", location: LEFT},
            point: {x: 140, y: 300},
            presentation: emptyPart,
            empty: EMPTY_BODY,
        });
        const detach = decisionOf(decision, "detach-view");
        // 空 Part 没有可插入的条目：落位就是全部信息；源容器不在 moveTargets 里也照样成立（新建容器不是并入）。
        expect(detach.request).toEqual({
            viewId: FILES,
            sourceContainerId: PANEL_CONTAINER,
            targetLocation: LEFT,
            contextKey: WORKSPACE,
        });
        expect(Object.hasOwn(detach.request, "beforeContainerId")).toBe(false);
        expect(detach.preview).toEqual({
            indicator: null,
            areaRect: EMPTY_BODY,
            entryRect: null,
            orientation: "vertical",
            count: 1,
        });
    });

    it("容器落到空 Part：搬到该落位、不套第二层容器", () => {
        const decision = drop({
            source: {kind: "workbench-container", containerId: PANEL_CONTAINER, location: PANEL, contextKey: WORKSPACE, viewIds: [FILES]},
            target: {kind: "workbench-part-empty-target", partId: "left", location: LEFT},
            point: {x: 140, y: 300},
            presentation: emptyPart,
            empty: EMPTY_BODY,
        });
        const move = decisionOf(decision, "move-container");
        expect(move.request).toEqual({containerId: PANEL_CONTAINER, sourceLocation: PANEL, targetLocation: LEFT});
        expect(move.preview.areaRect).toEqual(EMPTY_BODY);
        expect(move.preview.orientation).toBe("vertical");
    });

    it("空 Panel 的整区反馈按左右排给出轴", () => {
        const decision = drop({
            source: {kind: "workbench-view", viewId: TOOLS, containerId: A, location: LEFT, contextKey: WORKSPACE},
            target: {kind: "workbench-part-empty-target", partId: "panel", location: PANEL},
            point: {x: 200, y: 100},
            presentation: presentationOf([containerOf({containerId: A, memberViewIds: [TOOLS]})]),
            empty: PANEL_BOX,
        });
        expect(decisionOf(decision, "detach-view").preview.orientation).toBe("horizontal");
    });

    it("Part 已经有容器、落位与 Part 不匹配、整区量不出来都不落点", () => {
        const presentation = presentationOf([containerOf({containerId: A, memberViewIds: [FILES]})]);
        const source: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: A, location: LEFT, contextKey: WORKSPACE};
        expect(rejectionReason(drop({
            source,
            target: {kind: "workbench-part-empty-target", partId: "left", location: LEFT},
            point: {x: 10, y: 10},
            presentation,
            empty: EMPTY_BODY,
        }))).toContain("已经有");
        expect(rejectionReason(drop({
            source,
            target: {kind: "workbench-part-empty-target", partId: "left", location: PANEL},
            point: {x: 10, y: 10},
            presentation,
            empty: EMPTY_BODY,
        }))).toContain("不属于");
        expect(drop({
            source,
            target: {kind: "workbench-part-empty-target", partId: "right", location: "sidebar-right"},
            point: {x: 10, y: 10},
            presentation,
            empty: {left: 0, top: 0, right: 0, bottom: 0},
        })).toEqual({kind: "noop"});
    });
});

describe("视图源 → 切换器（单线 + detach 建容器）", () => {
    const source: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: A, location: LEFT, contextKey: WORKSPACE};
    const band = {left: 0, top: 0, right: 400, bottom: 30};
    const switcher: WorkbenchDropSwitcherRects = {
        orientation: "horizontal",
        rect: band,
        entries: [tab(A, 0, 100), tab(B, 100, 200)],
    };
    const presentation = presentationOf([
        containerOf({containerId: A, memberViewIds: [FILES, OUTLINE], moveTargets: [B]}),
        containerOf({containerId: B, memberViewIds: [TOOLS, SEARCH]}),
    ]);
    const target = (extra: Partial<Extract<WorkbenchDropTarget, {kind: "workbench-switcher-target"}>> = {}): WorkbenchDropTarget =>
        ({kind: "workbench-switcher-target", partId: "left", location: LEFT, ...extra});

    it("条目上的插入位就是锚点：前一半插到它之前、后一半是追加", () => {
        const leading = decisionOf(drop({source, target: target({viewContainerId: B}), point: {x: 110, y: 15}, presentation, switcher}), "detach-view");
        expect(leading.request).toEqual({
            viewId: FILES,
            sourceContainerId: A,
            targetLocation: LEFT,
            contextKey: WORKSPACE,
            beforeContainerId: B,
        });
        expect(leading.preview).toEqual({
            indicator: {left: 100, top: 0, right: 100 + GRID_DROP_INDICATOR_PX, bottom: 30},
            areaRect: null,
            entryRect: null,
            orientation: "horizontal",
            count: 1,
        });
        expectLine(leading.preview, {orientation: "horizontal", boundary: 100, band});

        // 同一条目后半：锚点变成它的下一条目（这里是末尾追加），声明不再决定归属。
        const trailing = decisionOf(drop({source, target: target({viewContainerId: B}), point: {x: 190, y: 15}, presentation, switcher}), "detach-view");
        expect(trailing.request).toEqual({viewId: FILES, sourceContainerId: A, targetLocation: LEFT, contextKey: WORKSPACE});
        expect(Object.hasOwn(trailing.request, "beforeContainerId")).toBe(false);
        expectLine(trailing.preview, {orientation: "horizontal", boundary: 204, band});
    });

    it("已经在容器末尾不再是 noop：detach 本身就是变更", () => {
        const alreadyLast: WorkbenchDropSource = {kind: "workbench-view", viewId: OUTLINE, containerId: A, location: LEFT, contextKey: WORKSPACE};
        // 条目带空白（没有条目命中声明）：锚点是末尾追加，照样 detach 成新容器，不再是旧语义的"已在末尾 noop"。
        const tail = decisionOf(drop({
            source: alreadyLast,
            target: target(),
            point: {x: 290, y: 15},
            presentation,
            switcher,
        }), "detach-view");
        expect(tail.request).toEqual({viewId: OUTLINE, sourceContainerId: A, targetLocation: LEFT, contextKey: WORKSPACE});
        expect(Object.hasOwn(tail.request, "beforeContainerId")).toBe(false);
        // 落在自己条目的后半也不是 noop：锚点是下一条目，照样 detach 成新容器。
        const beforeB = decisionOf(drop({
            source: alreadyLast,
            target: target({viewContainerId: A}),
            point: {x: 90, y: 15},
            presentation,
            switcher,
        }), "detach-view");
        expect(beforeB.request.beforeContainerId).toBe(B);
    });

    it("Activity Bar 的竖条目按条目顺序求锚点与线", () => {
        const activity: WorkbenchDropSwitcherRects = {
            orientation: "vertical",
            rect: {left: 0, top: 0, right: 40, bottom: 120},
            entries: [slot(A, 0, 40), slot(B, 40, 80)],
        };
        const decision = decisionOf(drop({source, target: target({viewContainerId: B}), point: {x: 20, y: 45}, presentation, switcher: activity}), "detach-view");
        expect(decision.request.beforeContainerId).toBe(B);
        expect(decision.preview).toEqual({
            indicator: {left: 0, top: 40, right: 40, bottom: 40 + GRID_DROP_INDICATOR_PX},
            areaRect: null,
            entryRect: null,
            orientation: "vertical",
            count: 1,
        });
    });

    it("不可移动的容器照样能当插入位锚点（它不参与换序）", () => {
        const fixed = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], canMoveContainer: false}),
            containerOf({containerId: B, memberViewIds: [TOOLS], moveTargets: [A]}),
        ]);
        const decision = decisionOf(drop({
            source: {kind: "workbench-view", viewId: TOOLS, containerId: B, location: LEFT, contextKey: WORKSPACE},
            target: target({viewContainerId: A}),
            point: {x: 10, y: 15},
            presentation: fixed,
            switcher: {orientation: "horizontal", rect: band, entries: [tab(A, 0, 100), tab(B, 100, 200)]},
        }), "detach-view");
        expect(decision.request.beforeContainerId).toBe(A);
    });

    it("条目带空白可追加，但非空切换器缺失全部条目几何时不提交", () => {
        const blank = decisionOf(drop({source, target: target(), point: {x: 350, y: 15}, presentation, switcher}), "detach-view");
        expect(Object.hasOwn(blank.request, "beforeContainerId")).toBe(false);
        expectLine(blank.preview, {orientation: "horizontal", boundary: 204, band});

        const noEntries = drop({
            source,
            target: target(),
            point: {x: 350, y: 15},
            presentation,
            switcher: {orientation: "horizontal", rect: band, entries: []},
        });
        expect(noEntries).toEqual({kind: "noop"});
    });

    it("声明的锚点与几何不一致、锚点不在本 Part、落位不匹配时拒绝", () => {
        expect(rejectionReason(drop({
            source,
            target: target({beforeContainerId: C}),
            point: {x: 110, y: 15},
            presentation,
            switcher,
        }))).toContain("不一致");
        expect(rejectionReason(drop({
            source,
            target: target({location: PANEL}),
            point: {x: 110, y: 15},
            presentation,
            switcher,
        }))).toContain("不属于");
        // 条目表里留着别的 Part 的容器：锚点必须属于本 Part 的容器序列，否则不给落点。
        const foreign = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [C]}),
            containerOf({containerId: C, location: PANEL, partId: "panel", memberViewIds: [TOOLS]}),
        ]);
        expect(rejectionReason(drop({
            source,
            target: target(),
            point: {x: 110, y: 15},
            presentation: foreign,
            switcher: {orientation: "horizontal", rect: band, entries: [tab(A, 0, 100), tab(C, 100, 200)]},
        }))).toContain("容器序列");
    });

    it("声明的条目命中失效（条目不在几何里 / 指针不在交集内）时拒绝，不退回成追加", () => {
        const at = (entries: WorkbenchDropSwitcherRects["entries"], point: {x: number; y: number}, viewContainerId: string) => drop({
            source,
            target: target({viewContainerId}),
            point,
            presentation,
            switcher: {orientation: "horizontal", rect: band, entries},
        });
        // ① 声明了 B，但 B 已经不在条目表里（标签被裁掉 / 列表刷新）：拒绝，不当作"末尾追加"。
        expect(rejectionReason(at([tab(A, 0, 100)], {x: 10, y: 15}, B))).toContain(B);
        // ② 声明了 B，指针却已滑到条目带空白处：声明与可见几何不一致，同样拒绝。
        expect(rejectionReason(at([tab(A, 0, 100), tab(B, 100, 200)], {x: 350, y: 15}, B))).toContain("可见交集");
        // ③ 条目矩形零尺寸（量不出来）：拒绝，不拿它当落点。
        expect(rejectionReason(at([tab(A, 0, 100), tab(B, 100, 100)], {x: 150, y: 15}, B))).toContain("可见交集");
        // 容器源共用同一份复核：声明了 A 却指着带尾，同样拒绝。
        expect(rejectionReason(drop({
            source: {kind: "workbench-container", containerId: B, location: LEFT, contextKey: WORKSPACE, viewIds: []},
            target: target({viewContainerId: A}),
            point: {x: 350, y: 15},
            presentation,
            switcher,
        }))).toContain("可见交集");
    });

    it("条目带量不出来、指针不在带里、没有呈现切片都不给落点", () => {
        expect(drop({source, target: target({viewContainerId: B}), point: {x: 900, y: 15}, presentation, switcher})).toEqual({kind: "noop"});
        expect(drop({
            source,
            target: target({viewContainerId: B}),
            point: {x: 10, y: 15},
            presentation,
            switcher: {orientation: "horizontal", rect: {left: 0, top: 0, right: 0, bottom: 0}, entries: [tab(B, 100, 200)]},
        })).toEqual({kind: "noop"});
        expect(rejectionReason(drop({
            source,
            target: target({viewContainerId: B}),
            point: {x: 10, y: 15},
            presentation: {...presentation, part: () => null},
            switcher,
        }))).toContain("没有呈现切片");
    });
});

describe("容器源 → 切换器（整容器换序/迁移）", () => {
    const leftPart = presentationOf([
        containerOf({containerId: A, memberViewIds: [FILES]}),
        containerOf({containerId: B, memberViewIds: []}),
        containerOf({containerId: C, memberViewIds: []}),
    ]);
    const switcher: WorkbenchDropSwitcherRects = {
        orientation: "horizontal",
        rect: {left: 0, top: 0, right: 400, bottom: 30},
        entries: [tab(A, 0, 100), tab(B, 100, 200), tab(C, 200, 300)],
    };
    const containerSource = (containerId: string, viewIds: readonly string[] = []): WorkbenchDropSource => ({
        kind: "workbench-container",
        containerId,
        location: LEFT,
        contextKey: WORKSPACE,
        viewIds,
    });
    const target = (extra: Partial<Extract<WorkbenchDropTarget, {kind: "workbench-switcher-target"}>> = {}): WorkbenchDropTarget =>
        ({kind: "workbench-switcher-target", partId: "left", location: LEFT, ...extra});

    it("前缘带插到该条目前、后缘带锚到后续条目、越过末条是追加（线贴末条后缘 + edgeGap）", () => {
        const band = switcher.rect;
        const first = decisionOf(drop({
            source: containerSource(B),
            target: target({viewContainerId: A}),
            point: {x: 10, y: 15},
            presentation: leftPart,
            switcher,
        }), "move-container");
        expect(first.request).toEqual({containerId: B, sourceLocation: LEFT, targetLocation: LEFT, beforeContainerId: A});
        expect(first.preview).toEqual({
            indicator: {left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 30},
            areaRect: null,
            entryRect: null,
            orientation: "horizontal",
            count: 1,
        });

        const second = decisionOf(drop({
            source: containerSource(C),
            target: target({viewContainerId: A}),
            point: {x: 90, y: 15},
            presentation: leftPart,
            switcher,
        }), "move-container");
        expect(second.request).toEqual({containerId: C, sourceLocation: LEFT, targetLocation: LEFT, beforeContainerId: B});
        // 共边条目之间放不下居中留白：线贴后一条前缘。
        expectLine(second.preview, {orientation: "horizontal", boundary: 100, band});

        const appended = decisionOf(drop({
            source: containerSource(A),
            target: target({viewContainerId: C}),
            point: {x: 290, y: 15},
            presentation: leftPart,
            switcher,
        }), "move-container");
        expect(appended.request).toEqual({containerId: A, sourceLocation: LEFT, targetLocation: LEFT});
        expect(Object.hasOwn(appended.request, "beforeContainerId")).toBe(false);
        // 追加：线贴末个可用条目的后缘再退一个 edgeGap（4）。
        expectLine(appended.preview, {orientation: "horizontal", boundary: 304, band});
    });

    it("容器锚点与插入线同出一次共享求值：前一条后半、间隙、后一条前半归到同一个位", () => {
        const gapped: WorkbenchDropSwitcherRects = {
            orientation: "horizontal",
            rect: {left: 0, top: 0, right: 400, bottom: 30},
            entries: [tab(A, 0, 100), tab(C, 200, 300)],
        };
        const at = (x: number) => decisionOf(drop({
            source: containerSource(A),
            target: target(),
            point: {x, y: 15},
            presentation: leftPart,
            switcher: gapped,
        }), "move-container");
        const line = {left: (100 + 200 - GRID_DROP_INDICATOR_PX) / 2, top: 0, right: (100 + 200 + GRID_DROP_INDICATOR_PX) / 2, bottom: 30};
        for (const move of [at(90), at(150), at(210)]) {
            expect(move.request).toEqual({containerId: A, sourceLocation: LEFT, targetLocation: LEFT, beforeContainerId: C});
            expect(move.preview.indicator).toEqual(line);
        }
    });

    it("条目带比插入线还窄时，线按可用长度变细且不越出条目带", () => {
        const band = {left: 0, top: 0, right: 1, bottom: 30};
        const decision = decisionOf(drop({
            source: containerSource(A),
            target: {kind: "workbench-switcher-target", partId: "right", location: "sidebar-right"},
            point: {x: 0.5, y: 15},
            presentation: leftPart,
            switcher: {orientation: "horizontal", rect: band, entries: []},
        }), "move-container");
        expect(decision.preview.indicator).toEqual({left: 0, right: 1, top: 0, bottom: 30});
        // 空条目表只剩一个插入位：线贴条目带前缘（不是带尾），宽度退化成整条带。
        expectLine(decision.preview, {orientation: "horizontal", boundary: band.left, band});
    });

    it("落自己的条目上、或已经在锚点之前：原位带线 noop，不写记录", () => {
        expect(noopPreview(drop({
            source: containerSource(A),
            target: target({viewContainerId: A}),
            point: {x: 10, y: 15},
            presentation: leftPart,
            switcher,
        }))).toEqual({
            indicator: {left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 30},
            areaRect: null,
            entryRect: null,
            orientation: "horizontal",
            count: 1,
        });
        // 锚点是 B、而 A 本来就在 B 前面：去掉自己后序位不变，同样是带线 noop。
        expect(noopPreview(drop({
            source: containerSource(A),
            target: target({viewContainerId: B}),
            point: {x: 110, y: 15},
            presentation: leftPart,
            switcher,
        }))).toEqual({
            indicator: {left: 100, top: 0, right: 100 + GRID_DROP_INDICATOR_PX, bottom: 30},
            areaRect: null,
            entryRect: null,
            orientation: "horizontal",
            count: 1,
        });
    });

    it("不可移动的容器不能当重排锚点，但仍能接收视图（detach 到它之前）", () => {
        const fixed = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], canMoveContainer: false}),
            containerOf({containerId: B, memberViewIds: [TOOLS], moveTargets: [A]}),
        ]);
        const fixedSwitcher: WorkbenchDropSwitcherRects = {
            orientation: "horizontal",
            rect: {left: 0, top: 0, right: 400, bottom: 30},
            entries: [tab(A, 0, 100), tab(B, 100, 200)],
        };
        expect(rejectionReason(drop({
            source: containerSource(B, [TOOLS]),
            target: target({viewContainerId: A}),
            point: {x: 10, y: 15},
            presentation: fixed,
            switcher: fixedSwitcher,
        }))).toContain("不能作为容器重排的锚点");

        const view: WorkbenchDropSource = {kind: "workbench-view", viewId: TOOLS, containerId: B, location: LEFT, contextKey: WORKSPACE};
        const accepted = decisionOf(drop({
            source: view,
            target: target({viewContainerId: A}),
            point: {x: 10, y: 15},
            presentation: fixed,
            switcher: fixedSwitcher,
        }), "detach-view");
        expect(accepted.request.beforeContainerId).toBe(A);
    });

    it("条目带空白区追加，空 Part 的条目带可以接收容器", () => {
        const blank = decisionOf(drop({
            source: containerSource(A),
            target: target(),
            point: {x: 350, y: 15},
            presentation: leftPart,
            switcher,
        }), "move-container");
        expect(blank.request).toEqual({containerId: A, sourceLocation: LEFT, targetLocation: LEFT});

        const emptyPart = presentationOf([containerOf({containerId: A, memberViewIds: [FILES], location: PANEL, partId: "panel"})]);
        const intoEmpty = decisionOf(drop({
            source: {...containerSource(A), location: PANEL},
            target: {kind: "workbench-switcher-target", partId: "right", location: "sidebar-right"},
            point: {x: 350, y: 15},
            presentation: emptyPart,
            switcher: {orientation: "horizontal", rect: {left: 0, top: 0, right: 400, bottom: 30}, entries: []},
        }), "move-container");
        expect(intoEmpty.request).toEqual({containerId: A, sourceLocation: PANEL, targetLocation: "sidebar-right"});
        // 空条目表只剩一个插入位：线贴条目带前缘、跨度取整条带。
        expectLine(intoEmpty.preview, {orientation: "horizontal", boundary: 0, band: {left: 0, top: 0, right: 400, bottom: 30}});
    });
});

describe("通用守卫", () => {
    it("工作面代际不同就整条拒绝（迟到的拖放不沿新工作面重放）", () => {
        const source: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: A, location: LEFT, contextKey: WORKSPACE};
        const decision = drop({
            source,
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 30},
            presentation: presentationOf([
                containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
                containerOf({containerId: B, memberViewIds: [TOOLS]}),
            ]),
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200)]},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, 400)]},
            contextKey: "workspace-2",
        });
        expect(rejectionReason(decision)).toContain("工作面");
    });

    it("源在拖动期间换了落位、内容几何与命中容器不一致时拒绝", () => {
        const source: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: A, location: PANEL, contextKey: WORKSPACE};
        const presentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B]}),
            containerOf({containerId: B, memberViewIds: [TOOLS]}),
        ]);
        const target: WorkbenchDropTarget = {kind: "workbench-container-content-target", containerId: B, location: LEFT};
        expect(rejectionReason(drop({
            source,
            target,
            point: {x: 150, y: 30},
            presentation,
            content: {containerId: B, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200)]},
        }))).toContain("当前落位");
        expect(rejectionReason(drop({
            source: {...source, location: LEFT},
            target,
            point: {x: 150, y: 30},
            presentation,
            content: {containerId: C, rect: CONTENT_BOX, members: [row(TOOLS, 0, 200)]},
        }))).toContain("不一致");
    });
});

describe("动作一致性：松手只提交已显示过的那次", () => {
    const presentation = presentationOf([
        containerOf({containerId: A, memberViewIds: [FILES], moveTargets: [B, C]}),
        containerOf({containerId: B, memberViewIds: [OUTLINE, TOOLS, SEARCH]}),
        containerOf({containerId: C, memberViewIds: []}),
    ]);
    const rows = [row(OUTLINE, 0, 100), row(TOOLS, 100, 200), row(SEARCH, 200, 300)];
    const viewSource: WorkbenchDropSource = {kind: "workbench-view", viewId: FILES, containerId: A, location: LEFT, contextKey: WORKSPACE};

    const viewInto = (y: number, members = rows, sourceSizes = {[FILES]: 400}) => drop({
        source: viewSource,
        target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
        point: {x: 150, y},
        presentation,
        content: {containerId: B, rect: CONTENT_BOX, members},
        sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, sourceSizes[FILES] ?? 400)]},
    });

    it("同一个动作、指针挪几像素：一致（不比像素）", () => {
        const before = viewInto(110);
        const after = viewInto(115);
        expect(decisionOf(before, "move-view").request).toEqual(decisionOf(after, "move-view").request);
        expect(isSameWorkbenchDropAction(before, after)).toBe(true);
    });

    it("预览矩形变了但请求没变：仍是同一个动作（只比语义）", () => {
        const base = decisionOf(viewInto(110), "move-view");
        const nudged: WorkbenchDropDecision = {
            ...base,
            preview: {
                ...base.preview,
                indicator: {left: 7, right: 9, top: 7, bottom: 9},
                areaRect: {left: 7, top: 7, right: 20, bottom: 20},
            },
        };
        expect(isSameWorkbenchDropAction(base, nudged)).toBe(true);
    });

    it("换了命中叶、侧向或冻结尺寸：不是同一个动作", () => {
        const leading = viewInto(110);
        const trailing = viewInto(190);
        expect(decisionOf(leading, "move-view").request).toEqual({
            viewId: FILES,
            sourceContainerId: A,
            targetContainerId: B,
            split: {targetViewId: TOOLS, side: "before", axis: "height", targetSizes: {[OUTLINE]: 100, [TOOLS]: 100, [SEARCH]: 100}, sourceSizes: {[FILES]: 400}},
        });
        expect(isSameWorkbenchDropAction(leading, trailing)).toBe(false);
        // 同一个命中叶与侧向，但目标叶在拖动期间被改过尺寸：冻结的那一半已经不是同一份。
        const resized = viewInto(110, [row(OUTLINE, 0, 100), row(TOOLS, 100, 220), row(SEARCH, 220, 300)]);
        expect(isSameWorkbenchDropAction(leading, resized)).toBe(false);
        // 来源份额变了（源叶被拖大 / 拖小）同样换动作。
        const resizedSource = viewInto(110, rows, {[FILES]: 260});
        expect(isSameWorkbenchDropAction(leading, resizedSource)).toBe(false);
        // 中点归后半：与前半是不同动作，但仍然可提交。
        expect(decisionOf(viewInto(150), "move-view").request.split?.side).toBe("after");
        expect(isSameWorkbenchDropAction(leading, viewInto(150))).toBe(false);
    });

    it("换了插入轴、换了 kind、或任一侧不是接受 decision：都不是同一个动作", () => {
        const base = decisionOf(viewInto(110), "move-view");
        expect(isSameWorkbenchDropAction({...base, preview: {...base.preview, orientation: "horizontal"}}, base)).toBe(false);
        expect(isSameWorkbenchDropAction(base, {kind: "noop"})).toBe(false);
        expect(isSameWorkbenchDropAction({kind: "noop"}, base)).toBe(false);
        expect(isSameWorkbenchDropAction({kind: "rejected", reason: "几何过期"}, base)).toBe(false);
        expect(isSameWorkbenchDropAction(null, base)).toBe(false);
    });

    it("merge 的成员快照按序比较，split 与工作面代际都要一致", () => {
        const mergeSource = (viewIds: readonly string[], contextKey = WORKSPACE): WorkbenchDropSource => ({
            kind: "workbench-container",
            containerId: A,
            location: LEFT,
            contextKey,
            viewIds,
        });
        const mergeInto = (contextKey = WORKSPACE, extra: readonly string[] = [], members = {[FILES]: 400}) => drop({
            source: mergeSource([...extra, FILES], contextKey),
            target: {kind: "workbench-container-content-target", containerId: B, location: LEFT},
            point: {x: 150, y: 110},
            presentation,
            content: {containerId: B, rect: CONTENT_BOX, members: rows},
            sourceContent: {containerId: A, rect: CONTENT_BOX, members: [row(FILES, 0, members[FILES] ?? 400)]},
            contextKey,
        });
        const base = decisionOf(mergeInto(), "merge-container");
        expect(decisionOf(mergeInto(), "merge-container").request).toEqual(base.request);
        expect(isSameWorkbenchDropAction(base, mergeInto())).toBe(true);
        expect(isSameWorkbenchDropAction(base, {...base, request: {...base.request, sourceViewIds: [FILES, OUTLINE]}})).toBe(false);
        expect(isSameWorkbenchDropAction(base, {...base, request: {...base.request, sourceViewIds: [FILES], contextKey: "workspace-2"}})).toBe(false);
        expect(isSameWorkbenchDropAction(base, {
            ...base,
            request: {...base.request, split: {...base.request.split!, sourceSizes: {[FILES]: 320}}},
        })).toBe(false);
        expect(isSameWorkbenchDropAction(base, {kind: "noop"})).toBe(false);
    });

    it("detach 比视图、来源、落位、锚点与工作面代际", () => {
        const detachPresentation = presentationOf([
            containerOf({containerId: A, memberViewIds: [FILES], moveTargets: []}),
            containerOf({containerId: B, memberViewIds: [TOOLS], moveTargets: []}),
        ]);
        const detachSwitcher: WorkbenchDropSwitcherRects = {
            orientation: "horizontal",
            rect: {left: 0, top: 0, right: 400, bottom: 30},
            entries: [tab(A, 0, 100), tab(B, 100, 200)],
        };
        const detach = (point: {x: number; y: number}, contextKey = WORKSPACE) => drop({
            source: {kind: "workbench-view", viewId: FILES, containerId: A, location: LEFT, contextKey},
            target: {kind: "workbench-switcher-target", partId: "left", location: LEFT},
            point,
            presentation: detachPresentation,
            switcher: detachSwitcher,
            contextKey,
        });
        const base = decisionOf(detach({x: 110, y: 15}), "detach-view");
        expect(isSameWorkbenchDropAction(base, decisionOf(detach({x: 115, y: 15}), "detach-view"))).toBe(true);
        expect(isSameWorkbenchDropAction(base, decisionOf(detach({x: 190, y: 15}), "detach-view"))).toBe(false);
        expect(isSameWorkbenchDropAction(base, decisionOf(detach({x: 110, y: 15}, "workspace-2"), "detach-view"))).toBe(false);
        expect(isSameWorkbenchDropAction(base, {kind: "noop"})).toBe(false);
    });
});
