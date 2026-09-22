// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {computed, defineComponent, h, nextTick, ref, type Component, type Ref} from "vue";
import {mount, type VueWrapper} from "@vue/test-utils";
import {DragDropProvider, useDragDropManager} from "@dnd-kit/vue";
import {GRID_DROP_INDICATOR_PX, type GridDropRect} from "@notnotype/nb-ui/layout";
import type {DescriptorResult, WorkbenchCatalog, WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {
    resolveViewPresentation,
    SHELL_FILES_VIEW,
    type ContainerViewPresentation,
    type WorkbenchViewPresentation,
} from "nbook/app/utils/workbench/product-catalog";
import {SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER} from "nbook/app/utils/workbench/containers";
import {
    useWorkbenchDrop,
    useWorkbenchDropGeometry,
    type WorkbenchDropPorts,
} from "nbook/app/composables/useWorkbenchDrop";
import {
    WORKBENCH_CONTAINER_DRAG_TYPE,
    WORKBENCH_EMPTY_TARGET_TYPE,
    WORKBENCH_VIEW_DRAG_TYPE,
    workbenchSwitcherScope,
    workbenchSwitcherTargetId,
} from "nbook/app/composables/useWorkbenchDrag";
import {containerOrientation} from "nbook/app/utils/workbench/view-container-layout";
import {
    resolveWorkbenchDrop,
    type WorkbenchDropDecision,
    type WorkbenchDropSource,
    type WorkbenchDropSwitcherRects,
    type WorkbenchDropTarget,
} from "nbook/app/utils/workbench/workbench-drop";
import {placementCatalogOf, type ToolPartId, type ToolPartLocation} from "nbook/app/utils/workbench/view-placements";
import type {ViewPlacementsOutcome} from "nbook/app/utils/workbench/view-placements-session";
import type {WorkbenchTitleActionItems, WorkbenchTitleActionsByView} from "nbook/app/utils/workbench/view-title-actions";
import type {ContainerPlacementRecord} from "nbook/shared/storage/workbench-views";
import WorkbenchPartHost from "nbook/app/components/workbench/WorkbenchPartHost.vue";
import WorkbenchContainerInstances from "nbook/app/components/workbench/WorkbenchContainerInstances.vue";
import WorkbenchViewInstances from "nbook/app/components/workbench/WorkbenchViewInstances.vue";

vi.hoisted(() => {
    if (typeof (globalThis as {ResizeObserver?: unknown}).ResizeObserver === "undefined") {
        Object.assign(globalThis, {
            ResizeObserver: class {
                observe(): void {}
                unobserve(): void {}
                disconnect(): void {}
            },
        });
    }
});

/**
 * Part 宿主 + 容器实例层的接线：Part 头（选择器、落点、挂载目标）、ViewHost 被搬进活动容器的挂载目标、
 * 未活动容器停在 parking，容器动作与框架动作按 **emits** 交回宿主。
 *
 * 落点这一侧不止读属性：真实 `useWorkbenchDrop` 的几何登记由后代探针捕获，管理器的候选过滤、判定层的
 * 求值都跑真实实现，所以「哪个源能落到哪里、插线画在哪」是按行为断言的。jsdom 没有布局引擎，
 * 只补三块它缺的能力（矩形、client 盒、视口尺寸）；其余一律按真实浏览器里"量不出来"的零尺寸算。
 *
 * 三类入口按合同分工：左栏标题**任何时候**都不是落点（空容器的回收归空正文与 Activity Bar）；
 * Panel/right 的条目带常驻（空带照样有一个插入位），View 落条目带或空正文都是**新建容器**；
 * 空 Part 的正文是独立落点，两种源都接。切换器只画插入线：条目高亮按新合同删除。
 */

const FILES = SHELL_FILES_VIEW.id;
const TERMINAL = "nbook.terminal";
/** 工作面代际：拖动源冻结它，判定按它对照（不一致整条拒绝）。 */
const WORKSPACE = "workspace-1";
/** Panel 里的第二个容器：让「多容器用标签条」「未活动容器停在 parking」都有真实对象。 */
const SECOND_PANEL_CONTAINER = {
    id: "lab.panel-second",
    titleKey: "lab.container.second",
    icon: "i-lucide-box",
    location: "panel",
    order: 40,
} as const;

/** 左栏的第二个容器：主侧栏即使有多个容器也不该画第二套标签带（那由 Activity Bar 选）。 */
const SECOND_LEFT_CONTAINER = {
    id: "lab.left-second",
    titleKey: "lab.container.left-second",
    icon: "i-lucide-box",
    location: "sidebar-left",
    order: 50,
} as const;

/** `nbook.panel` 里的两个视图：让 Panel 容器成为 `multiple`（动作留在各 View 标题上的对照）。 */
const PANEL_EXTRA = "lab.panel-extra";
const PANEL_MORE = "lab.panel-more";

/**
 * 左栏第二个容器里的视图：呈现层**不呈现实际成员为 0 的容器**（也不给它们实例泊车），
 * 所以「左栏有两个容器、切换活动容器」这条场景要真有一个 View，而不是靠一个空容器凑数。
 */
const LEFT_EXTRA = "lab.left-extra";

/** 右侧 Part 故意**没有**容器：空 Part 的空态与容器的空容器是两种不同的状态。 */
const CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SECOND_PANEL_CONTAINER, SECOND_LEFT_CONTAINER],
    views: [
        {...SHELL_FILES_VIEW, factoryKey: `lab.view.${FILES}`},
        {...SHELL_FILES_VIEW, id: TERMINAL, titleKey: `lab.view.${TERMINAL}`, container: SECOND_PANEL_CONTAINER.id, order: 10, factoryKey: `lab.view.${TERMINAL}`, when: {requires: ["user-assets"]}},
        {...SHELL_FILES_VIEW, id: PANEL_EXTRA, titleKey: `lab.view.${PANEL_EXTRA}`, container: SHELL_PANEL_CONTAINER.id, order: 20, factoryKey: `lab.view.${FILES}`},
        {...SHELL_FILES_VIEW, id: PANEL_MORE, titleKey: `lab.view.${PANEL_MORE}`, container: SHELL_PANEL_CONTAINER.id, order: 30, factoryKey: `lab.view.${FILES}`},
        {...SHELL_FILES_VIEW, id: LEFT_EXTRA, titleKey: `lab.view.${LEFT_EXTRA}`, container: SECOND_LEFT_CONTAINER.id, order: 10, factoryKey: `lab.view.${FILES}`},
    ],
};

const Probe = defineComponent({
    name: "PartProbe",
    props: {label: {type: String, required: true}},
    setup(props) {
        return () => h("div", {"data-probe": props.label}, props.label);
    },
});

const FACTORIES: Record<string, Component> = {
    [`lab.view.${FILES}`]: defineComponent({name: "FilesProbe", setup: () => () => h("div", {"data-probe": FILES})}),
    [`lab.view.${TERMINAL}`]: defineComponent({name: "TerminalProbe", setup: () => () => h("div", {"data-probe": TERMINAL})}),
};

const REGISTRY = (() => {
    const created = createWorkbenchRegistry(CATALOG);
    if (!created.ok) {
        throw new Error(created.reason);
    }
    return created.value;
})();

function contextOf(): WorkbenchContext {
    return {
        project: true,
        selection: false,
        "user-assets": true,
        desktop: false,
        authorities: {project: true, session: false, job: false, files: true},
        projectRoot: "/workspace/demo",
    };
}

/**
 * 真实呈现求值 + 容器落位覆盖：默认呈现与「全部移走 / 搬回」两态都走它。
 *
 * 语料（标题、Part 标题）与页面同源，几何与判定因此跑在**真实切片**上，而不是手写的呈现替身。
 */
function presentationWith(
    containerPlacements: Readonly<Record<string, ContainerPlacementRecord>> = {},
    activeContainerByPart: Readonly<Record<string, string>> = {},
): WorkbenchViewPresentation {
    return resolveViewPresentation({
        registry: REGISTRY,
        context: contextOf(),
        containerOverrides: containerPlacements,
        activeContainerByPart,
        titleOf: (descriptor) => `t:${descriptor.titleKey}`,
        partTitleOf: (partId) => `t:part.${partId}`,
    });
}

/** 固定 Panel 的活动容器：多容器下的活动项由记录给出（呈现层不猜）。 */
function presentationOf(activePanel: string = SECOND_PANEL_CONTAINER.id): WorkbenchViewPresentation {
    return presentationWith({}, {panel: activePanel});
}

/**
 * 容器落位覆盖：默认指纹（保存时所基于的默认落位与序号）必须与当前 descriptor 一致，
 * 否则求值层把这条覆盖当失效过滤掉——指纹从真实目录取，不手写一份。
 */
function placementOf(containerId: string, location: ToolPartLocation, order: number): ContainerPlacementRecord {
    const defaults = placementCatalogOf(REGISTRY).containerDefaults[containerId];
    if (defaults === undefined) {
        throw new Error(`未登记容器 ${containerId}`);
    }
    return {location, order, defaultLocation: defaults.location, defaultOrder: defaults.order};
}

type HostEvents = {
    selectContainer: (containerId: string) => void;
    moveContainer: (request: {containerId: string; sourceLocation: string; targetLocation: string}) => void;
    moveView: (request: {viewId: string; sourceContainerId: string; targetContainerId: string}) => void;
    titleAction: (payload: {scope: string; actionId: string}) => void;
    panelCollapse: (payload: {collapsed: boolean}) => void;
};

/**
 * 侧写：安装版实体的 `id` / `disabled` / `accepts` 在抽象基类里是响应式访问器与实例方法，类型里没有；
 * 按结构读一次，不在调用点上撒断言。
 */
type RegisteredDropTarget = {
    readonly id: string;
    type?: string;
    data?: {
        kind?: string;
        partId?: ToolPartId;
        location?: ToolPartLocation;
        switcherScope?: string;
        beforeContainerId?: string;
        viewContainerId?: string;
    };
    disabled?: boolean;
    accepts(draggable: {type?: string; data?: unknown}): boolean;
};

/** 拖动源的侧写：`data` 是 `useWorkbenchDrag` 冻结的载荷，`element` 是它挂在哪个元素上。 */
type RegisteredDragSource = {
    readonly id: string;
    element?: Element | undefined;
    data?: {kind?: string; containerId?: string; viewId?: string};
    disabled?: boolean;
};

/** 管理器登记表：`get` 按 id 取一个，迭代按注册顺序给出全部（候选过滤要全表）。 */
type DropRegistry = {
    registry: {
        draggables: Iterable<RegisteredDragSource>;
        droppables: Iterable<RegisteredDropTarget> & {get(id: string): RegisteredDropTarget | undefined};
    };
};
let dropRegistry: DropRegistry | null = null;

const RegistryProbe = defineComponent({
    name: "RegistryProbe",
    setup() {
        dropRegistry = useDragDropManager().value as unknown as DropRegistry;
        return () => null;
    },
});

/** PartHost 登记给几何层的读法（按切换器作用域）：测试用它读「宿主自己声明的几何」。 */
type SwitcherRead = () => WorkbenchDropSwitcherRects | null;
const switcherReads = new Map<string, SwitcherRead>();

/** 空正文落点的读法（按 Part）：Part 里一旦有容器，宿主自己这条读法就给 `null`。 */
type EmptyRead = () => GridDropRect | null;
const emptyReads = new Map<ToolPartId, EmptyRead>();

/**
 * 几何探针：注入拿到 `useWorkbenchDrop` 提供的那份登记，对 `registerSwitcher` / `registerEmpty` 做
 * **保留原实现**的 spy，捕获 PartHost 挂载时登记的读法——登记表只有写入端，读法只能这样拿回来，
 * 不能从落点登记反推几何。
 */
const GeometryProbe = defineComponent({
    name: "DropGeometryProbe",
    setup() {
        const geometry = useWorkbenchDropGeometry();
        if (geometry === null) {
            throw new Error("几何探针必须在 useWorkbenchDrop 的子树里");
        }
        const register = geometry.registerSwitcher.bind(geometry);
        vi.spyOn(geometry, "registerSwitcher").mockImplementation((switcherScope, read) => {
            const unregister = register(switcherScope, read);
            switcherReads.set(switcherScope, read);
            return () => {
                unregister();
                if (switcherReads.get(switcherScope) === read) {
                    switcherReads.delete(switcherScope);
                }
            };
        });
        const registerEmpty = geometry.registerEmpty.bind(geometry);
        vi.spyOn(geometry, "registerEmpty").mockImplementation((partId, read) => {
            const unregister = registerEmpty(partId, read);
            emptyReads.set(partId, read);
            return () => {
                unregister();
                if (emptyReads.get(partId) === read) {
                    emptyReads.delete(partId);
                }
            };
        });
        return () => null;
    },
});

function switcherReadOf(switcherScope: string): SwitcherRead {
    const read = switcherReads.get(switcherScope);
    if (read === undefined) {
        throw new Error(`没有登记切换器 ${switcherScope} 的几何读法`);
    }
    return read;
}

function emptyReadOf(partId: ToolPartId): EmptyRead {
    const read = emptyReads.get(partId);
    if (read === undefined) {
        throw new Error(`没有登记 Part ${partId} 的空正文几何读法`);
    }
    return read;
}

// ── jsdom 缺的两块：布局矩形与视口尺寸 ────────────────────────────────────────

/** 视口：根元素的 client 盒（真实浏览器里有值，jsdom 里恒为 0，与视口求交会因此全空）。 */
const VIEWPORT = {width: 1600, height: 1300};
const ZERO_RECT: GridDropRect = {left: 0, top: 0, right: 0, bottom: 0};
/** 元素 → 本轮登记的矩形；**没登记的元素一律零尺寸**（＝真实浏览器里"量不出来"的那一档）。 */
const stubbedRects = new WeakMap<Element, GridDropRect>();

function domRectOf(rect: GridDropRect): DOMRect {
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    return {
        ...rect,
        width,
        height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({...rect, width, height, x: rect.left, y: rect.top}),
    } as unknown as DOMRect;
}

/** 每个用例都装：布局矩形、client 盒与视口尺寸正是 jsdom 缺的那三块（真实浏览器由布局引擎给）。 */
function installLayoutStubs(): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element): DOMRect {
        return domRectOf(stubbedRects.get(this) ?? ZERO_RECT);
    });
    // 登记过的元素按自己的矩形给 client 盒：`overflow` 祖先按它裁剪，量不出尺寸的裁剪祖先会把可见矩形裁空。
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element): number {
        const rect = stubbedRects.get(this);
        return rect === undefined ? 0 : rect.right - rect.left;
    });
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element): number {
        const rect = stubbedRects.get(this);
        return rect === undefined ? 0 : rect.bottom - rect.top;
    });
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(VIEWPORT.width);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(VIEWPORT.height);
}

// ── 候选过滤与真实判定 ───────────────────────────────────────────────────────

/** 管理器自己的候选过滤：库在 `computeCollisions` 里先丢 `disabled`、再丢「不接受当前拖动源」的落点。 */
function candidateIdsFor(source: {type: string; data: unknown}): string[] {
    const droppables = dropRegistry?.registry.droppables;
    if (droppables === undefined) {
        throw new Error("还没有拿到拖动管理器");
    }
    return [...droppables]
        .filter((entry) => entry.disabled !== true && entry.accepts(source))
        .map((entry) => entry.id);
}

/** 候选探针：只带库过滤真正读到的两个字段（拖动源类型 + 载荷），不伪造拖动会话。 */
function sourceProbe(kind: "view" | "container"): {type: string; data: unknown} {
    return kind === "container"
        ? {type: WORKBENCH_CONTAINER_DRAG_TYPE, data: {containerId: SHELL_PANEL_CONTAINER.id}}
        : {type: WORKBENCH_VIEW_DRAG_TYPE, data: {viewId: FILES}};
}

/** Part 头部条目带的落点 id：与宿主登记的几何键同源，不手写字符串。 */
function headBandTargetId(partId: ToolPartId): string {
    return workbenchSwitcherTargetId(workbenchSwitcherScope(partId, "head"));
}

/** 空正文落点的 id：宿主按「类型:Part」拼，这里按同一份词汇拼一次给候选过滤与判定用。 */
function emptyBodyTargetId(partId: ToolPartId): string {
    return `${WORKBENCH_EMPTY_TARGET_TYPE}:${partId}`;
}

/** 某个 Part 的这两类入口（条目带 / 空正文）此刻是否真的是候选：按管理器过滤结果给，按 id 排序（注册顺序不是这条断言的对象）。 */
function partTargetIdsOf(source: {type: string; data: unknown}, partId: ToolPartId): string[] {
    const known = new Set([headBandTargetId(partId), emptyBodyTargetId(partId)]);
    return candidateIdsFor(source).filter((id) => known.has(id)).sort();
}

/**
 * 容器的拖动源：整页按**载荷**认那一份拖动面（拖动 id 由 `useId()` 生成，不能拼字符串查），
 * 不是恰好一份就直接失败——标题形态的「只保留拖动」靠它证明，而不是靠 `disabled` 属性。
 */
function containerDragSourceOf(containerId: string): RegisteredDragSource {
    const sources = [...(dropRegistry?.registry.draggables ?? [])]
        .filter((entry) => entry.data?.kind === "workbench-container" && entry.data.containerId === containerId);
    if (sources.length !== 1) {
        throw new Error(`容器 ${containerId} 应当有且只有一份拖动源，实际 ${sources.length} 份`);
    }
    return sources[0]!;
}

/** 本文件用到的落点声明：Part 头部条目带与空正文（容器内容落点归容器宿主，这里是另一条路）。 */
type PartDropTarget = Extract<WorkbenchDropTarget, {kind: "workbench-switcher-target" | "workbench-part-empty-target"}>;

/** 落点载荷的自检：kind 与位置齐全才算本层认识的 Part 落点（与 `useWorkbenchDrop` 取用前自检同一口径）。 */
function isPartDropTarget(data: unknown): data is PartDropTarget {
    if (typeof data !== "object" || data === null) {
        return false;
    }
    const candidate = data as {kind?: unknown; partId?: unknown; location?: unknown; switcherScope?: unknown};
    if (typeof candidate.partId !== "string" || typeof candidate.location !== "string") {
        return false;
    }
    return candidate.kind === "workbench-switcher-target"
        ? typeof candidate.switcherScope === "string"
        : candidate.kind === "workbench-part-empty-target";
}

/** 落点的**声明**：从管理器登记里读回来（判定读的就是这一份），不是 Part 落点就当场失败。 */
function dropTargetOf(id: string): PartDropTarget {
    const data: unknown = dropRegistry?.registry.droppables.get(id)?.data;
    if (!isPartDropTarget(data)) {
        throw new Error(`落点 ${id} 不是 Part 落点：${JSON.stringify(data)}`);
    }
    return data;
}

/**
 * 真实判定：源取**真实切片**、目标取**落点登记**、几何取**宿主登记给几何层的读法**、呈现用同一次求值——
 * 预览与请求因此就是提交路径上那一份（完整闭环归浏览器 smoke，这里只跑求值）。
 */
function dropOnto(input: {
    source: WorkbenchDropSource;
    targetId: string;
    point: {x: number; y: number};
    presentation: WorkbenchViewPresentation;
    switcher?: WorkbenchDropSwitcherRects | null;
    empty?: GridDropRect | null;
}): WorkbenchDropDecision {
    return resolveWorkbenchDrop({
        source: input.source,
        target: dropTargetOf(input.targetId),
        point: input.point,
        rects: {content: null, switcher: input.switcher ?? null, empty: input.empty ?? null},
        presentation: input.presentation,
        contextKey: WORKSPACE,
    });
}

/** 源载荷：落位与成员快照都取真实切片，不手写一套。 */
function containerSourceOf(presentation: WorkbenchViewPresentation, containerId: string): WorkbenchDropSource {
    const slice = presentation.container(containerId);
    if (slice === null) {
        throw new Error(`容器 ${containerId} 没有呈现切片`);
    }
    return {
        kind: "workbench-container",
        containerId,
        location: slice.location,
        contextKey: WORKSPACE,
        viewIds: slice.memberViewIds,
    };
}

function viewSourceOf(presentation: WorkbenchViewPresentation, viewId: string): WorkbenchDropSource {
    const entry = presentation.entries.find((candidate) => candidate.view.id === viewId);
    const container = entry === undefined ? null : presentation.container(entry.containerId);
    if (entry === undefined || container === null) {
        throw new Error(`视图 ${viewId} 没有可用的呈现条目`);
    }
    return {kind: "workbench-view", viewId, containerId: entry.containerId, location: container.location, contextKey: WORKSPACE};
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

/**
 * 提供者端口：本文件的用例不提交任何移动（拖动闭环归浏览器 smoke），四个动作一律拒绝。
 * `detach-view`（View 落到条目带或空正文时新建容器）与另外三种同档：端口形状必须与 `WorkbenchDropPorts` 一致。
 */
const REFUSING_PORTS: WorkbenchDropPorts = {
    moveView: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
    detachView: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
    moveContainer: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
    mergeContainer: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
};

// ── Part 的确定几何 ──────────────────────────────────────────────────────────

const HEADER_RECT: GridDropRect = {left: 100, top: 200, right: 700, bottom: 232};
const SELECTOR_RECT: GridDropRect = {left: 108, top: 204, right: 420, bottom: 228};
/** Part 根：包住头部与条目带，`overflow: hidden` 的裁剪不会切掉落点。 */
const PART_RECT: GridDropRect = {left: 96, top: 196, right: 704, bottom: 560};
/** 空正文（`[data-workbench-part-empty]`）：头部之下、Part 内容区里的整块空态。 */
const EMPTY_RECT: GridDropRect = {left: 100, top: 236, right: 700, bottom: 556};

/** 条目：按渲染顺序从左往右排，互不相交，都落在条目带里。 */
function entryRectAt(index: number): GridDropRect {
    const left = 108 + index * 100;
    return {left, top: 204, right: left + 84, bottom: 228};
}

type PartGeometry = Readonly<{
    header: GridDropRect;
    selector: GridDropRect | null;
    entries: ReadonlyMap<string, GridDropRect>;
    /** 空正文盒子：没渲染出来（或量不出来）时是 `null`。 */
    empty: GridDropRect | null;
}>;

function partElementOf(wrapper: VueWrapper, partId: ToolPartId): HTMLElement {
    const element = wrapper.find(`[data-workbench-part="${partId}"]`).element;
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Part ${partId} 没有渲染出来`);
    }
    return element;
}

/**
 * 给一个 Part **此刻真实渲染**的头部 / 条目带 / 条目 / 空正文登记确定矩形。
 *
 * 这里只登记真正渲染出来的盒子，其余元素保持零尺寸（真实浏览器里"被裁掉""没内容"就是这一档）。
 * 头部与条目带量得出矩形**不等于**它们接收投递：那是落点声明与几何读法的事——左栏标题、非空 Part 的
 * 空正文都是"量得出但读法给 null"的那一档。空正文是 `v-show` 常驻节点，量得出也仍由宿主按有无容器收口。
 */
function stubPartGeometry(part: HTMLElement): PartGeometry {
    const header = part.querySelector<HTMLElement>("header.workbench-part__head");
    // Part 根是 `overflow: hidden` 的裁剪祖先：它自己也得有可量的 client 盒，否则里面的落点会被裁成空。
    stubbedRects.set(part, PART_RECT);
    if (header !== null) {
        stubbedRects.set(header, HEADER_RECT);
    }

    const selector = part.querySelector<HTMLElement>(".workbench-part__selector");
    if (selector !== null) {
        stubbedRects.set(selector, SELECTOR_RECT);
    }

    const empty = part.querySelector<HTMLElement>("[data-workbench-part-empty]");
    if (empty !== null) {
        stubbedRects.set(empty, EMPTY_RECT);
    }

    const entries = new Map<string, GridDropRect>();
    const elements = [...part.querySelectorAll<HTMLElement>("[data-container-tab]")];
    elements.forEach((element, index) => {
        const containerId = element.getAttribute("data-container-tab");
        if (containerId !== null) {
            const rect = entryRectAt(index);
            stubbedRects.set(element, rect);
            entries.set(containerId, rect);
        }
    });
    return {
        header: HEADER_RECT,
        selector: selector === null ? null : SELECTOR_RECT,
        entries,
        empty: empty === null ? null : EMPTY_RECT,
    };
}

const mounted: VueWrapper[] = [];

function mountPart(options: {
    partId?: ToolPartId;
    presentation?: Ref<WorkbenchViewPresentation>;
    allowContainerMove?: boolean;
    allowViewMove?: boolean;
    panelCollapsed?: boolean;
    panelActions?: WorkbenchTitleActionItems;
    containerActions?: WorkbenchTitleActionItems;
    actionsByView?: WorkbenchTitleActionsByView;
    emptyText?: string;
    events?: Partial<HostEvents>;
}) {
    const partId = options.partId ?? "left";
    const presentation = options.presentation ?? ref(presentationOf());
    // 实例层的容器清单：本该是 `presentation.residentContainers`，本语料里三个 Part 的并集与它逐项相同。
    const containers: ContainerViewPresentation[] = ["left", "right", "panel"]
        .flatMap((id) => [...presentation.value.part(id as ToolPartId).containers]);

    const Root = defineComponent({
        name: "PartHarness",
        setup() {
            // 真实几何登记：PartHost 通过注入拿到它、在挂载时登记切换器读法（探针就是在这里捕获的）。
            // 会话事件不在 jsdom 里驱动（完整拖动闭环归浏览器 smoke），因此只需装上提供者本身。
            useWorkbenchDrop({
                presentation: () => presentation.value,
                contextKey: () => WORKSPACE,
                ports: REFUSING_PORTS,
            });
            return () => h(DragDropProvider, {sensors: []}, {
                default: () => h("div", [
                    h(RegistryProbe),
                    h(GeometryProbe),
                    h(WorkbenchViewInstances, {
                        views: presentation.value.entries,
                        viewFactoryResolver: (factoryKey: string): DescriptorResult<Component> => {
                            const component = FACTORIES[factoryKey];
                            return component === undefined
                                ? {ok: false, reason: `未登记的内置 factoryKey：${factoryKey}`}
                                : {ok: true, value: component};
                        },
                    }, {
                        default: () => h(WorkbenchContainerInstances, {
                            containers,
                            actionsContextKey: "panel-state-1",
                            actionsByView: options.actionsByView ?? {},
                            allowViewMove: options.allowViewMove ?? false,
                        }, {
                            default: () => h("div", [
                                h(WorkbenchPartHost, {
                                    presentation: presentation.value.part(partId),
                                    panelCollapsed: options.panelCollapsed ?? false,
                                    actionsContextKey: "panel-state-1",
                                    actionsByView: options.actionsByView ?? {},
                                    viewActionsLabel: "视图操作",
                                    moveViewLabel: "移动到",
                                    allowContainerMove: options.allowContainerMove ?? false,
                                    allowViewMove: options.allowViewMove ?? false,
                                    panelActions: options.panelActions ?? {primary: [], secondary: []},
                                    panelActionsLabel: "面板操作",
                                    panelCollapseLabel: "收起面板",
                                    containerActions: options.containerActions ?? {primary: [], secondary: []},
                                    containerActionsLabel: "容器操作",
                                    moveContainerLabel: "移动到",
                                    emptyText: options.emptyText ?? "将视图拖动到此处显示",
                                    onSelectContainer: options.events?.selectContainer,
                                    onMoveContainer: options.events?.moveContainer,
                                    onMoveView: options.events?.moveView,
                                    onTitleAction: options.events?.titleAction,
                                    onPanelCollapse: options.events?.panelCollapse,
                                }),
                            ]),
                        }),
                    }),
                ]),
            });
        },
    });

    const wrapper = mount(Root, {attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

async function settle(): Promise<void> {
    for (let tick = 0; tick < 4; tick += 1) {
        await nextTick();
    }
}

function menuItem(text: string): HTMLElement | undefined {
    return [...document.body.querySelectorAll<HTMLElement>("[role=\"menuitem\"]")]
        .find((element) => element.textContent?.includes(text));
}

beforeEach(() => {
    switcherReads.clear();
    emptyReads.clear();
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
    vi.stubGlobal("IntersectionObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): [] { return []; }
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("WorkbenchPartHost", () => {
    it("主侧栏：即使有多个容器也用可拖标题（容器切换归 Activity Bar）", async () => {
        const wrapper = mountPart({partId: "left"});
        await settle();

        expect(wrapper.find("[data-workbench-part=\"left\"]").exists()).toBe(true);
        // 左栏有两个容器（nbook.tools 与 lab.left-second），但不画第二套标签带。
        expect(wrapper.findAll("[role=\"tab\"]")).toHaveLength(0);
        expect(wrapper.find("[data-container-tab=\"nbook.tools\"]").exists()).toBe(true);
        expect(wrapper.find("[data-container-tab=\"nbook.tools\"]").text()).toContain("t:ide.toolPanel.files");

        const mount = wrapper.find("[data-container-mount=\"nbook.tools\"]");
        expect(mount.exists()).toBe(true);
        // ViewHost 由实例层 Teleport 进挂载目标：容器内部真的在这个 Part 里。
        expect(mount.find(`[data-container-id="nbook.tools"]`).exists()).toBe(true);
        expect(mount.find(`[data-section="${FILES}"] [data-probe="${FILES}"]`).exists()).toBe(true);
    });

    it("多容器 Panel：同一标签部件按容器列出，点击回传 select-container", async () => {
        const selectContainer = vi.fn();
        const wrapper = mountPart({partId: "panel", events: {selectContainer}});
        await settle();

        const tabs = wrapper.findAll("[role=\"tab\"]");
        // 标签取每个容器**第一个可见 View** 的标题（容器 descriptor 只在空容器时才当标签）。
        expect(tabs.map((tab) => tab.text())).toEqual([`t:lab.view.${PANEL_EXTRA}`, `t:lab.view.${TERMINAL}`]);
        expect(tabs[1]!.attributes("aria-selected")).toBe("true");

        await tabs[0]!.trigger("click");
        expect(selectContainer).toHaveBeenCalledWith(SHELL_PANEL_CONTAINER.id);
    });

    it("未活动容器停在 parking：实例不销毁，也不留在 Part 里", async () => {
        const wrapper = mountPart({partId: "panel"});
        await settle();

        const parking = wrapper.find("[data-container-parking]");
        expect(parking.exists()).toBe(true);
        expect(parking.attributes("hidden")).toBeDefined();
        expect(parking.attributes("inert")).toBeDefined();
        expect(parking.attributes("aria-hidden")).toBe("true");

        // 活动的第二个容器在 Part 里；第一个容器的 ViewHost 停在 parking，实例仍在。
        expect(wrapper.find("[data-container-mount=\"lab.panel-second\"] [data-container-id=\"lab.panel-second\"]").exists()).toBe(true);
        expect(parking.find("[data-container-parking-target=\"nbook.panel\"]").exists()).toBe(true);
        expect(parking.find("[data-container-id=\"nbook.panel\"]").exists()).toBe(true);
        expect(wrapper.find(`[data-workbench-part="panel"] [data-container-id="nbook.panel"]`).exists()).toBe(false);
    });

    it("容器换活动容器后：新容器搬进挂载目标，旧容器退回 parking；切回来还是同一个宿主", async () => {
        const presentation = ref(presentationOf(SECOND_PANEL_CONTAINER.id));
        const wrapper = mountPart({partId: "panel", presentation});
        await settle();

        const second = wrapper.find("[data-container-id=\"lab.panel-second\"]");
        expect(second.exists()).toBe(true);
        const secondElement = second.element;

        presentation.value = presentationOf(SHELL_PANEL_CONTAINER.id);
        await settle();
        expect(wrapper.find("[data-container-mount=\"nbook.panel\"] [data-container-id=\"nbook.panel\"]").exists()).toBe(true);
        expect(wrapper.find("[data-container-parking] [data-container-id=\"lab.panel-second\"]").exists()).toBe(true);
        // 停到 parking 的是**同一个宿主元素**（没被销毁重建）。
        expect(wrapper.find("[data-container-parking] [data-container-id=\"lab.panel-second\"]").element).toBe(secondElement);

        presentation.value = presentationOf(SECOND_PANEL_CONTAINER.id);
        await settle();
        expect(wrapper.find("[data-container-mount=\"lab.panel-second\"] [data-container-id=\"lab.panel-second\"]").element).toBe(secondElement);
    });
    it("旧挂载目标断连时容器宿主退回 parking，不留在断开的元素上", async () => {
        const presentation = ref(presentationOf(SECOND_PANEL_CONTAINER.id));
        const wrapper = mountPart({partId: "panel", presentation});
        await settle();

        const mount = wrapper.find('[data-container-mount="lab.panel-second"]');
        expect(mount.exists()).toBe(true);
        mount.element.remove();
        presentation.value = presentationOf(SHELL_PANEL_CONTAINER.id);
        await settle();

        expect(wrapper.find('[data-container-parking] [data-container-id="lab.panel-second"]').exists()).toBe(true);
        expect(wrapper.find('[data-container-mount="lab.panel-second"] [data-container-id="lab.panel-second"]').exists()).toBe(false);
    });


    it("左栏：非空头部只有拖动面，标题与 header 空白都不接收任何源", async () => {
        installLayoutStubs();
        const presentation = presentationOf();
        const wrapper = mountPart({
            partId: "left",
            presentation: ref(presentation),
            allowContainerMove: true,
            allowViewMove: true,
        });
        await settle();

        const part = partElementOf(wrapper, "left");
        const title = stubPartGeometry(part).entries.get(SHELL_LEFT_CONTAINER.id);
        // 标题量得出矩形（不是"量不出来"那一档），它仍不进候选的原因只能是形态本身。
        expect(title).toBeDefined();
        const bandId = "workbench-switcher-target:left:head";
        const titleId = `${bandId}#${SHELL_LEFT_CONTAINER.id}`;

        // 拖动面仍在：整块标题就是当前容器的拖动源（回收与换序都不经过它，它不该连拖都拖不动）。
        const dragSource = containerDragSourceOf(SHELL_LEFT_CONTAINER.id);
        expect(dragSource.element).toBe(part.querySelector(`[data-container-tab="${SHELL_LEFT_CONTAINER.id}"]`));
        expect(dragSource.disabled).not.toBe(true);

        // 管理器候选过滤：标题与 header 空白对两种源都不是候选（不是"选得中但落不下"）。
        expect(candidateIdsFor(sourceProbe("container"))).not.toContain(titleId);
        expect(candidateIdsFor(sourceProbe("view"))).not.toContain(titleId);
        expect(candidateIdsFor(sourceProbe("container"))).not.toContain(bandId);
        expect(candidateIdsFor(sourceProbe("view"))).not.toContain(bandId);

        // 几何：非空 left 的头部没有任何落点，登记给判定层的读法直接给 null（判定层无从复核声明）。
        const read = switcherReadOf("left:head")();
        expect(read).toBeNull();

        // 判定层同样不接受：标题前半与后半两个点，容器与 View 都只给 noop（无预览、无提交）。
        const center = {x: (title!.left + title!.right) / 2, y: (title!.top + title!.bottom) / 2};
        for (const x of [title!.left + 4, center.x + 8]) {
            expect(dropOnto({
                source: containerSourceOf(presentation, SHELL_PANEL_CONTAINER.id),
                targetId: titleId,
                point: {x, y: center.y},
                presentation,
                switcher: read,
            }).kind).toBe("noop");
            expect(dropOnto({
                source: viewSourceOf(presentation, FILES),
                targetId: titleId,
                point: {x, y: center.y},
                presentation,
                switcher: read,
            }).kind).toBe("noop");
        }

        // 空白带也一样：就算拿着头部 band 的声明去送，判定层读到的还是同一份空几何。
        expect(dropOnto({
            source: containerSourceOf(presentation, SHELL_PANEL_CONTAINER.id),
            targetId: bandId,
            point: {x: 600, y: center.y},
            presentation,
            switcher: read,
        }).kind).toBe("noop");
        expect(dropOnto({
            source: viewSourceOf(presentation, FILES),
            targetId: bandId,
            point: {x: 600, y: center.y},
            presentation,
            switcher: read,
        }).kind).toBe("noop");
    });

    it("左栏切换活动容器后，两份标题都不接收（拖动的仍是当前那一个）", async () => {
        installLayoutStubs();
        const presentation = ref(presentationWith());
        const wrapper = mountPart({partId: "left", presentation, allowContainerMove: true, allowViewMove: true});
        await settle();
        for (const containerId of [SECOND_LEFT_CONTAINER.id, SHELL_LEFT_CONTAINER.id]) {
            presentation.value = presentationWith({}, {left: containerId});
            await settle();
            const part = partElementOf(wrapper, "left");
            const title = stubPartGeometry(part).entries.get(containerId)!;
            const titleId = `workbench-switcher-target:left:head#${containerId}`;

            // 拖动身份随活动容器走：整块新标题就是这份容器的拖动面（切换没有让注册键指向旧容器）。
            expect(containerDragSourceOf(containerId).element)
                .toBe(part.querySelector(`[data-container-tab="${containerId}"]`));

            // 接收侧一点没变：几何仍是空、标题仍不是候选、判定仍是 noop（前后半都一样）。
            const read = switcherReadOf("left:head")();
            expect(read).toBeNull();
            expect(candidateIdsFor(sourceProbe("container"))).not.toContain(titleId);
            expect(candidateIdsFor(sourceProbe("view"))).not.toContain(titleId);
            const center = {x: (title.left + title.right) / 2, y: (title.top + title.bottom) / 2};
            for (const x of [title.left + 4, center.x + 8]) {
                expect(dropOnto({
                    source: viewSourceOf(presentation.value, PANEL_EXTRA),
                    targetId: titleId,
                    point: {x, y: center.y},
                    presentation: presentation.value,
                    switcher: read,
                }).kind).toBe("noop");
                expect(dropOnto({
                    source: containerSourceOf(presentation.value, SHELL_PANEL_CONTAINER.id),
                    targetId: titleId,
                    point: {x, y: center.y},
                    presentation: presentation.value,
                    switcher: read,
                }).kind).toBe("noop");
            }
        }
    });

    it("左栏：标题任何时候都不接收（空态也一样），容器全部移走后由空正文接管两种源", async () => {
        installLayoutStubs();
        const placements = ref<Record<string, ContainerPlacementRecord>>({});
        const presentation = computed(() => presentationWith(placements.value));
        const wrapper = mountPart({
            partId: "left",
            presentation,
            allowContainerMove: true,
            allowViewMove: true,
            emptyText: "左栏空态",
        });
        await settle();
        const part = partElementOf(wrapper, "left");

        // 非空：标题量得出矩形，但头部一个落点都没有——几何是 null，而不是"退回整块头部"。
        const before = stubPartGeometry(part);
        expect(before.entries.get(SHELL_LEFT_CONTAINER.id)).toBeDefined();
        expect(switcherReadOf("left:head")()).toBeNull();
        expect(partTargetIdsOf(sourceProbe("container"), "left")).toEqual([]);
        expect(partTargetIdsOf(sourceProbe("view"), "left")).toEqual([]);
        // 空正文在非空 Part 里同样收口：宿主自己那条读法就给 null，候选里也没有它。
        expect(emptyReadOf("left")()).toBeNull();

        // 全部移走：这个 Part 真的一个容器都不剩（不是"没有可见 View"），标题位置换成空态说明。
        placements.value = {
            [SHELL_LEFT_CONTAINER.id]: placementOf(SHELL_LEFT_CONTAINER.id, "panel", 60),
            [SECOND_LEFT_CONTAINER.id]: placementOf(SECOND_LEFT_CONTAINER.id, "panel", 70),
        };
        await settle();
        expect(presentation.value.part("left").containers).toHaveLength(0);
        const empty = stubPartGeometry(part);
        expect(part.querySelector("[data-container-tab]")).toBeNull();

        // 头部仍是"一个源都不接"：几何还是 null，这个 Part 的候选里只剩空正文；判定层拿到旧声明也只给 noop。
        expect(switcherReadOf("left:head")()).toBeNull();
        expect(partTargetIdsOf(sourceProbe("container"), "left")).toEqual([emptyBodyTargetId("left")]);
        expect(partTargetIdsOf(sourceProbe("view"), "left")).toEqual([emptyBodyTargetId("left")]);
        const headY = (empty.header.top + empty.header.bottom) / 2;
        for (const x of [empty.header.left + 4, (empty.header.left + empty.header.right) / 2]) {
            expect(dropOnto({
                source: containerSourceOf(presentation.value, SHELL_PANEL_CONTAINER.id),
                targetId: headBandTargetId("left"),
                point: {x, y: headY},
                presentation: presentation.value,
            }).kind).toBe("noop");
            expect(dropOnto({
                source: viewSourceOf(presentation.value, FILES),
                targetId: headBandTargetId("left"),
                point: {x, y: headY},
                presentation: presentation.value,
            }).kind).toBe("noop");
        }

        // 空正文：整块内容区就是落点，容器与 View 都接（原来"空头部收容器、View 不接"的两条都归到这一处）。
        const body = emptyReadOf("left")();
        expect(body).toEqual(empty.empty);
        const moveIn = decisionOf(dropOnto({
            source: containerSourceOf(presentation.value, SHELL_PANEL_CONTAINER.id),
            targetId: emptyBodyTargetId("left"),
            point: {x: 400, y: 400},
            presentation: presentation.value,
            empty: body,
        }), "move-container");
        expect(moveIn.request).toEqual({
            containerId: SHELL_PANEL_CONTAINER.id,
            sourceLocation: "panel",
            targetLocation: "sidebar-left",
        });
        expect(moveIn.preview).toEqual({
            indicator: null,
            areaRect: body,
            entryRect: null,
            orientation: containerOrientation("left"),
            count: 1,
        });

        // View：在这个落位**新建容器**装它（detach-view），预览同样是整块正文。
        const detach = decisionOf(dropOnto({
            source: viewSourceOf(presentation.value, FILES),
            targetId: emptyBodyTargetId("left"),
            point: {x: 400, y: 400},
            presentation: presentation.value,
            empty: body,
        }), "detach-view");
        expect(detach.request).toEqual({
            viewId: FILES,
            sourceContainerId: SHELL_LEFT_CONTAINER.id,
            targetLocation: "sidebar-left",
            contextKey: WORKSPACE,
        });
        expect(detach.preview).toEqual({
            indicator: null,
            areaRect: body,
            entryRect: null,
            orientation: containerOrientation("left"),
            count: 1,
        });

        // 搬回：标题与挂载目标都回来，头部随即回到"只有拖动、不接收"，空正文读法再收口。
        placements.value = {};
        await settle();
        const back = stubPartGeometry(part);
        expect(back.entries.get(SHELL_LEFT_CONTAINER.id)).toBeDefined();
        expect(switcherReadOf("left:head")()).toBeNull();
        expect(partTargetIdsOf(sourceProbe("container"), "left")).toEqual([]);
        expect(emptyReadOf("left")()).toBeNull();
        expect(containerDragSourceOf(SHELL_LEFT_CONTAINER.id).element)
            .toBe(part.querySelector(`[data-container-tab="${SHELL_LEFT_CONTAINER.id}"]`));
        expect(wrapper.find(`[data-container-mount="${SHELL_LEFT_CONTAINER.id}"] [data-container-id="${SHELL_LEFT_CONTAINER.id}"]`).exists()).toBe(true);
    });

    it("Panel：条目带常驻（空带照样收容器与 View），View 落带上是新建容器", async () => {
        installLayoutStubs();
        const placements = ref<Record<string, ContainerPlacementRecord>>({});
        const presentation = computed(() => presentationWith(placements.value));
        const wrapper = mountPart({partId: "panel", presentation, allowContainerMove: true, allowViewMove: true});
        await settle();
        const part = partElementOf(wrapper, "panel");

        // 非空：band 是条目带，条目按容器清单顺序给出；带空白仍是容器与 View 的候选（既有语义保留）。
        const before = stubPartGeometry(part);
        const beforeRead = switcherReadOf("panel:head")();
        expect(beforeRead).not.toBeNull();
        expect(beforeRead!.rect).toEqual(before.selector);
        expect(beforeRead!.entries.map((entry) => entry.containerId))
            .toEqual([SHELL_PANEL_CONTAINER.id, SECOND_PANEL_CONTAINER.id]);
        expect(partTargetIdsOf(sourceProbe("container"), "panel")).toEqual([headBandTargetId("panel")]);
        expect(partTargetIdsOf(sourceProbe("view"), "panel")).toEqual([headBandTargetId("panel")]);

        // selector 之外的 header 不接收：指针在头部但不在条目带里，两种源都只给 noop。
        expect(dropOnto({
            source: containerSourceOf(presentation.value, SHELL_LEFT_CONTAINER.id),
            targetId: headBandTargetId("panel"),
            point: {x: 600, y: 216},
            presentation: presentation.value,
            switcher: beforeRead,
        }).kind).toBe("noop");
        expect(dropOnto({
            source: viewSourceOf(presentation.value, FILES),
            targetId: headBandTargetId("panel"),
            point: {x: 600, y: 216},
            presentation: presentation.value,
            switcher: beforeRead,
        }).kind).toBe("noop");

        // 带上的插入位：x=200 落在第二个条目的前缘带，两种源在这一处各有一个动作。
        const betweenEntries = {x: 200, y: 216};
        const viewOntoBand = decisionOf(dropOnto({
            source: viewSourceOf(presentation.value, FILES),
            targetId: headBandTargetId("panel"),
            point: betweenEntries,
            presentation: presentation.value,
            switcher: beforeRead,
        }), "detach-view");
        expect(viewOntoBand.request).toEqual({
            viewId: FILES,
            sourceContainerId: SHELL_LEFT_CONTAINER.id,
            targetLocation: "panel",
            contextKey: WORKSPACE,
            beforeContainerId: SECOND_PANEL_CONTAINER.id,
        });
        // 切换器只画线：没有区域、也没有条目高亮框（`entryRect` 按新合同恒为 null）。
        expect(viewOntoBand.preview.entryRect).toBeNull();
        expect(viewOntoBand.preview.areaRect).toBeNull();
        expect(viewOntoBand.preview.indicator).not.toBeNull();

        expect(decisionOf(dropOnto({
            source: containerSourceOf(presentation.value, SHELL_LEFT_CONTAINER.id),
            targetId: headBandTargetId("panel"),
            point: betweenEntries,
            presentation: presentation.value,
            switcher: beforeRead,
        }), "move-container").request).toEqual({
            containerId: SHELL_LEFT_CONTAINER.id,
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
            beforeContainerId: SECOND_PANEL_CONTAINER.id,
        });

        // 全部移走：条目带本身**常驻**（标签没了，带还在），空正文同时可达。
        placements.value = {
            [SHELL_PANEL_CONTAINER.id]: placementOf(SHELL_PANEL_CONTAINER.id, "sidebar-right", 60),
            [SECOND_PANEL_CONTAINER.id]: placementOf(SECOND_PANEL_CONTAINER.id, "sidebar-right", 70),
        };
        await settle();
        expect(presentation.value.part("panel").containers).toHaveLength(0);
        const empty = stubPartGeometry(part);
        expect(part.querySelector("[role=\"tablist\"]")).not.toBeNull();
        expect(part.querySelectorAll("[data-container-tab]")).toHaveLength(0);

        const emptyRead = switcherReadOf("panel:head")();
        expect(emptyRead).not.toBeNull();
        expect(emptyRead!.rect).toEqual(empty.selector);
        expect(emptyRead!.entries).toEqual([]);
        expect(partTargetIdsOf(sourceProbe("container"), "panel"))
            .toEqual([emptyBodyTargetId("panel"), headBandTargetId("panel")]);
        expect(partTargetIdsOf(sourceProbe("view"), "panel"))
            .toEqual([emptyBodyTargetId("panel"), headBandTargetId("panel")]);

        // 容器落空带：整容器搬进这个 Part，插线画在带起点（没有条目可贴时落到内容盒前缘）。
        const recovery = decisionOf(dropOnto({
            source: containerSourceOf(presentation.value, SHELL_LEFT_CONTAINER.id),
            targetId: headBandTargetId("panel"),
            point: {x: 400, y: 216},
            presentation: presentation.value,
            switcher: emptyRead,
        }), "move-container");
        expect(recovery.request).toEqual({
            containerId: SHELL_LEFT_CONTAINER.id,
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
        });
        const bandStartLine = {
            left: empty.selector!.left,
            right: empty.selector!.left + GRID_DROP_INDICATOR_PX,
            top: empty.selector!.top,
            bottom: empty.selector!.bottom,
        };
        expect(recovery.preview.indicator).toEqual(bandStartLine);

        // View 落空带：同样是**新建容器**（不再是"这个 Part 没有容器所以不接"），末尾追加不带锚点。
        const detachOntoBand = decisionOf(dropOnto({
            source: viewSourceOf(presentation.value, PANEL_EXTRA),
            targetId: headBandTargetId("panel"),
            point: {x: 400, y: 216},
            presentation: presentation.value,
            switcher: emptyRead,
        }), "detach-view");
        expect(detachOntoBand.request).toEqual({
            viewId: PANEL_EXTRA,
            sourceContainerId: SHELL_PANEL_CONTAINER.id,
            targetLocation: "panel",
            contextKey: WORKSPACE,
        });
        expect(detachOntoBand.preview.indicator).toEqual(bandStartLine);
        expect(detachOntoBand.preview.entryRect).toBeNull();
        expect(detachOntoBand.preview.areaRect).toBeNull();

        // 空正文也在：整块内容区接 View（Panel 是左右排），请求与落带时是同一个动作。
        const body = emptyReadOf("panel")();
        expect(body).toEqual(empty.empty);
        const bodyDrop = decisionOf(dropOnto({
            source: viewSourceOf(presentation.value, PANEL_EXTRA),
            targetId: emptyBodyTargetId("panel"),
            point: {x: 400, y: 400},
            presentation: presentation.value,
            empty: body,
        }), "detach-view");
        expect(bodyDrop.request).toEqual({
            viewId: PANEL_EXTRA,
            sourceContainerId: SHELL_PANEL_CONTAINER.id,
            targetLocation: "panel",
            contextKey: WORKSPACE,
        });
        expect(bodyDrop.preview).toEqual({
            indicator: null,
            areaRect: body,
            entryRect: null,
            orientation: containerOrientation("panel"),
            count: 1,
        });

        // 搬回：条目带里的条目与挂载目标都回来。
        placements.value = {};
        await settle();
        const back = stubPartGeometry(part);
        const backRead = switcherReadOf("panel:head")();
        expect(backRead).not.toBeNull();
        expect(backRead!.rect).toEqual(back.selector);
        expect(backRead!.entries.map((entry) => entry.containerId))
            .toEqual([SHELL_PANEL_CONTAINER.id, SECOND_PANEL_CONTAINER.id]);
        expect(emptyReadOf("panel")()).toBeNull();
        expect(wrapper.find(`[data-container-mount="${SHELL_PANEL_CONTAINER.id}"] [data-container-id="${SHELL_PANEL_CONTAINER.id}"]`).exists()).toBe(true);
    });

    it("容器移动菜单：列出生效落位之外的落点，选中后回传 move-container", async () => {
        const moveContainer = vi.fn();
        const wrapper = mountPart({partId: "panel", allowContainerMove: true, events: {moveContainer}});
        await settle();

        await wrapper.find("[role=\"tablist\"]").trigger("contextmenu", {clientX: 20, clientY: 30});
        await settle();
        const parent = menuItem("移动到");
        expect(parent).toBeTruthy();
        // 子菜单由父项聚焦展开；父项自己不执行。
        parent!.focus();
        await settle();
        expect(moveContainer).not.toHaveBeenCalled();
        const target = menuItem("t:part.right");
        expect(target).toBeTruthy();
        target!.click();
        await settle();

        expect(moveContainer).toHaveBeenCalledWith({
            containerId: SECOND_PANEL_CONTAINER.id,
            sourceLocation: "panel",
            targetLocation: "sidebar-right",
        });
    });

    it("容器动作回传带容器 target；Panel 框架动作仍按 panel scope 回传", async () => {
        const titleAction = vi.fn();
        const wrapper = mountPart({
            partId: "panel",
            containerActions: {primary: [], secondary: [{id: "nbook.view.restore-container-placement", label: "恢复默认位置", icon: "i-lucide-rotate-ccw"}]},
            panelActions: {primary: [{id: "nbook.view.toggle-panel-maximized", label: "最大化", icon: "i-lucide-maximize-2"}], secondary: []},
            events: {titleAction},
        });
        await settle();

        await wrapper.find("[role=\"tablist\"]").trigger("contextmenu", {clientX: 20, clientY: 30});
        await settle();
        menuItem("恢复默认位置")!.click();
        await settle();
        expect(titleAction).toHaveBeenCalledWith({
            scope: "container",
            target: {containerId: SECOND_PANEL_CONTAINER.id},
            actionId: "nbook.view.restore-container-placement",
        });

        await wrapper.find("[data-title-actions=\"panel\"] [data-title-action=\"nbook.view.toggle-panel-maximized\"]").trigger("click");
        expect(titleAction).toHaveBeenLastCalledWith({scope: "panel", actionId: "nbook.view.toggle-panel-maximized"});
    });

    it("Panel 的 32px 收起按钮回传 panel-collapse 的反值", async () => {
        const panelCollapse = vi.fn();
        const wrapper = mountPart({partId: "panel", panelCollapsed: false, events: {panelCollapse}});
        await settle();

        const toggle = wrapper.find("[data-panel-collapse-toggle]");
        expect(toggle.attributes("aria-expanded")).toBe("true");
        await toggle.trigger("click");

        expect(panelCollapse).toHaveBeenCalledWith({collapsed: true});
    });
    it("左栏不渲染容器标题，Panel 收起按钮位于动作区最后", async () => {
        const left = mountPart({partId: "left"});
        await settle();
        const source = left.get(".workbench-part__drag-source");
        expect(source.classes()).toContain("workbench-part__drag-source");
        expect(source.element.getBoundingClientRect().width).toBe(0);
        const panel = mountPart({partId: "panel"});
        await settle();
        const actions = [...panel.element.querySelectorAll(".workbench-part__actions > *")];
        expect(actions.at(-1)?.getAttribute("data-panel-collapse-toggle")).not.toBeNull();
    });

    it("右栏：条目带常驻，容器移走后空带与空正文都收两种源", async () => {
        installLayoutStubs();
        const placed = {[SHELL_PANEL_CONTAINER.id]: placementOf(SHELL_PANEL_CONTAINER.id, "sidebar-right", 10)};
        const placements = ref<Record<string, ContainerPlacementRecord>>({...placed});
        const presentation = computed(() => presentationWith(placements.value));
        const wrapper = mountPart({partId: "right", presentation, allowContainerMove: true, allowViewMove: true});
        await settle();
        const part = partElementOf(wrapper, "right");

        // 非空：带空白是容器与 View 的候选（既有语义），空正文这时不出现在候选里。
        const before = stubPartGeometry(part);
        const beforeRead = switcherReadOf("right:head")();
        expect(beforeRead).not.toBeNull();
        expect(beforeRead!.rect).toEqual(before.selector);
        expect(beforeRead!.entries.map((entry) => entry.containerId)).toEqual([SHELL_PANEL_CONTAINER.id]);
        expect(partTargetIdsOf(sourceProbe("view"), "right")).toEqual([headBandTargetId("right")]);
        expect(partTargetIdsOf(sourceProbe("container"), "right")).toEqual([headBandTargetId("right")]);
        expect(emptyReadOf("right")()).toBeNull();

        // 移走唯一容器：标签没了，条目带**常驻**（同一个几何入口，条目表为空），空正文出现。
        placements.value = {[SHELL_PANEL_CONTAINER.id]: placementOf(SHELL_PANEL_CONTAINER.id, "panel", 60)};
        await settle();
        expect(presentation.value.part("right").containers).toHaveLength(0);
        const empty = stubPartGeometry(part);
        expect(part.querySelector("[role=\"tablist\"]")).not.toBeNull();
        expect(part.querySelectorAll("[data-container-tab]")).toHaveLength(0);
        expect(wrapper.find("[data-workbench-part-empty]").exists()).toBe(true);
        expect(wrapper.find("[data-container-mount]").exists()).toBe(false);

        const emptyRead = switcherReadOf("right:head")();
        expect(emptyRead).not.toBeNull();
        expect(emptyRead!.rect).toEqual(empty.selector);
        expect(emptyRead!.entries).toEqual([]);
        // 两种源都在：空带收 View（新建容器）与整容器，空正文是同一个 Part 的第二个入口。
        expect(partTargetIdsOf(sourceProbe("container"), "right"))
            .toEqual([emptyBodyTargetId("right"), headBandTargetId("right")]);
        expect(partTargetIdsOf(sourceProbe("view"), "right"))
            .toEqual([emptyBodyTargetId("right"), headBandTargetId("right")]);

        const bandStartLine = {
            left: empty.selector!.left,
            right: empty.selector!.left + GRID_DROP_INDICATOR_PX,
            top: empty.selector!.top,
            bottom: empty.selector!.bottom,
        };
        const detachOntoBand = decisionOf(dropOnto({
            source: viewSourceOf(presentation.value, PANEL_EXTRA),
            targetId: headBandTargetId("right"),
            point: {x: 200, y: 216},
            presentation: presentation.value,
            switcher: emptyRead,
        }), "detach-view");
        expect(detachOntoBand.request).toEqual({
            viewId: PANEL_EXTRA,
            sourceContainerId: SHELL_PANEL_CONTAINER.id,
            targetLocation: "sidebar-right",
            contextKey: WORKSPACE,
        });
        // 只画线：条目框与区域都不给。
        expect(detachOntoBand.preview.indicator).toEqual(bandStartLine);
        expect(detachOntoBand.preview.entryRect).toBeNull();
        expect(detachOntoBand.preview.areaRect).toBeNull();

        expect(decisionOf(dropOnto({
            source: containerSourceOf(presentation.value, SHELL_LEFT_CONTAINER.id),
            targetId: headBandTargetId("right"),
            point: {x: 200, y: 216},
            presentation: presentation.value,
            switcher: emptyRead,
        }), "move-container").request).toEqual({
            containerId: SHELL_LEFT_CONTAINER.id,
            sourceLocation: "sidebar-left",
            targetLocation: "sidebar-right",
        });

        // 空正文：整块反馈（右栏上下排），请求与落带时是同一个动作。
        const body = emptyReadOf("right")();
        expect(body).toEqual(empty.empty);
        expect(decisionOf(dropOnto({
            source: viewSourceOf(presentation.value, PANEL_EXTRA),
            targetId: emptyBodyTargetId("right"),
            point: {x: 300, y: 400},
            presentation: presentation.value,
            empty: body,
        }), "detach-view").preview).toEqual({
            indicator: null,
            areaRect: body,
            entryRect: null,
            orientation: containerOrientation("right"),
            count: 1,
        });

        // 搬回：条目带里的条目与挂载目标都回来。
        placements.value = {...placed};
        await settle();
        const back = stubPartGeometry(part);
        const backRead = switcherReadOf("right:head")();
        expect(backRead).not.toBeNull();
        expect(backRead!.rect).toEqual(back.selector);
        expect(backRead!.entries.map((entry) => entry.containerId)).toEqual([SHELL_PANEL_CONTAINER.id]);
        expect(emptyReadOf("right")()).toBeNull();
        expect(wrapper.find(`[data-container-mount="${SHELL_PANEL_CONTAINER.id}"] [data-container-id="${SHELL_PANEL_CONTAINER.id}"]`).exists()).toBe(true);
    });

    it("空 Part：只开 View 移动时条目带与空正文都只接 View（新建容器），不接容器", async () => {
        installLayoutStubs();
        const presentation = presentationOf();
        const wrapper = mountPart({partId: "right", presentation: ref(presentation), allowViewMove: true});
        await settle();
        const rects = stubPartGeometry(partElementOf(wrapper, "right"));

        const read = switcherReadOf("right:head")();
        expect(read).not.toBeNull();
        expect(read!.rect).toEqual(rects.selector);
        expect(read!.entries).toEqual([]);
        // 只开 View 移动：两个入口都接 View，容器一个候选都不是（落点按源类型分别收口，不压成一个总开关）。
        expect(partTargetIdsOf(sourceProbe("container"), "right")).toEqual([]);
        expect(partTargetIdsOf(sourceProbe("view"), "right"))
            .toEqual([emptyBodyTargetId("right"), headBandTargetId("right")]);

        // 落空带：**新建容器**装这个 View，末尾追加（带里没有条目，不带锚点）。
        expect(decisionOf(dropOnto({
            source: viewSourceOf(presentation, FILES),
            targetId: headBandTargetId("right"),
            point: {x: 400, y: 216},
            presentation,
            switcher: read,
        }), "detach-view").request).toEqual({
            viewId: FILES,
            sourceContainerId: SHELL_LEFT_CONTAINER.id,
            targetLocation: "sidebar-right",
            contextKey: WORKSPACE,
        });

        // 落空正文：同一个动作，反馈是整块正文（右栏上下排）。
        const body = emptyReadOf("right")();
        expect(body).toEqual(rects.empty);
        const ontoBody = decisionOf(dropOnto({
            source: viewSourceOf(presentation, FILES),
            targetId: emptyBodyTargetId("right"),
            point: {x: 400, y: 400},
            presentation,
            empty: body,
        }), "detach-view");
        expect(ontoBody.request).toEqual({
            viewId: FILES,
            sourceContainerId: SHELL_LEFT_CONTAINER.id,
            targetLocation: "sidebar-right",
            contextKey: WORKSPACE,
        });
        expect(ontoBody.preview).toEqual({
            indicator: null,
            areaRect: body,
            entryRect: null,
            orientation: containerOrientation("right"),
            count: 1,
        });
    });

    it("非空 Part 的空正文已经失效：拿着量得出的旧几何送也拒绝", async () => {
        installLayoutStubs();
        const presentation = presentationOf();
        const wrapper = mountPart({
            partId: "panel",
            presentation: ref(presentation),
            allowContainerMove: true,
            allowViewMove: true,
        });
        await settle();
        const rects = stubPartGeometry(partElementOf(wrapper, "panel"));

        // 宿主自己收口：有容器的 Part 不声明空正文几何，这个落点也不是候选。
        expect(emptyReadOf("panel")()).toBeNull();
        expect(partTargetIdsOf(sourceProbe("view"), "panel")).toEqual([headBandTargetId("panel")]);

        // 就算拿着量得出的正文矩形去送，判定层按呈现复核后拒绝——绝不降级成"追加到第一个容器"。
        const stale = decisionOf(dropOnto({
            source: viewSourceOf(presentation, PANEL_EXTRA),
            targetId: emptyBodyTargetId("panel"),
            point: {x: 300, y: 400},
            presentation,
            empty: rects.empty,
        }), "rejected");
        expect(stale.reason).toContain("已经有");
    });

    it("实例层缺失时给出诊断，而不是静默空白", async () => {
        const presentation = presentationOf();
        const wrapper = mount(defineComponent({
            name: "PartWithoutInstances",
            setup() {
                return () => h(DragDropProvider, {sensors: []}, {
                    default: () => h(WorkbenchPartHost, {presentation: presentation.part("left")}),
                });
            },
        }));
        mounted.push(wrapper);
        await settle();

        expect(wrapper.find("[data-container-instance-channel=\"missing\"]").exists()).toBe(true);
        expect(wrapper.find("[data-container-mount=\"nbook.tools\"]").exists()).toBe(true);
    });

    it("Part 的容器清单变化后，挂载目标随之登记：新容器自己进来，旧容器退回 parking", async () => {
        const presentation = ref(presentationOf());
        const wrapper = mountPart({partId: "left", presentation});
        await settle();
        expect(wrapper.find("[data-container-id=\"nbook.tools\"]").attributes("data-container-location")).toBe("sidebar-left");

        expect(wrapper.find("[data-container-parking] [data-container-parking-target=\"nbook.tools\"]").exists()).toBe(true);
        // 容器清单里仍然包含左容器（它只是被搬到了 Part 目标里）。
        expect(wrapper.findAll("[data-container-id=\"nbook.tools\"]")).toHaveLength(1);
    });

    it("single：唯一 View 的动作上提到容器右上角，点击回传渲染时捕获的世代", async () => {
        const titleAction = vi.fn();
        const wrapper = mountPart({
            partId: "left",
            allowViewMove: true,
            actionsByView: {
                [FILES]: {
                    target: {viewId: FILES, generation: 5},
                    primary: [{id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"}],
                    secondary: [{id: "secondary-demo", label: "次要动作"}],
                },
            },
            events: {titleAction},
        });
        await settle();

        const group = wrapper.find("[data-title-actions=\"view\"]");
        expect(group.exists()).toBe(true);
        expect(group.attributes("data-action-view-id")).toBe(FILES);
        expect(group.attributes("data-action-generation")).toBe("5");
        // 上提的仍是 View 的命令（不是容器命令），动作组不冒充内容的落点标记。
        expect(group.attributes("data-view-id")).toBeUndefined();

        await group.find("[data-title-action=\"refresh\"]").trigger("click");
        expect(titleAction).toHaveBeenCalledWith({
            scope: "view",
            target: {viewId: FILES, generation: 5},
            actionId: "refresh",
        });
    });

    it("single：没有标题也搬得动这一个 View——上提的「更多」里有移动入口", async () => {
        const moveView = vi.fn();
        const wrapper = mountPart({partId: "left", allowViewMove: true, events: {moveView}});
        await settle();

        const group = wrapper.find("[data-title-actions=\"view\"]");
        expect(group.exists()).toBe(true);
        await group.find("[data-title-action=\"more\"]").trigger("click");
        await settle();

        const parent = menuItem("移动到");
        expect(parent).toBeTruthy();
        parent!.click();
        await settle();
        expect(moveView).not.toHaveBeenCalled();

        menuItem("t:ide.workbench.container.panel")!.click();
        await settle();
        expect(moveView).toHaveBeenCalledWith({
            viewId: FILES,
            sourceContainerId: SHELL_LEFT_CONTAINER.id,
            targetContainerId: SHELL_PANEL_CONTAINER.id,
        });
    });

    it("multiple：动作留在每个 View 的标题上，容器右上角没有 View 动作组", async () => {
        const actions = {
            [PANEL_EXTRA]: {
                target: {viewId: PANEL_EXTRA, generation: 2},
                primary: [{id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"}],
                secondary: [],
            },
        } satisfies WorkbenchTitleActionsByView;
        const wrapper = mountPart({
            partId: "panel",
            presentation: ref(presentationOf(SHELL_PANEL_CONTAINER.id)),
            allowViewMove: true,
            actionsByView: actions,
        });
        await settle();

        // 上提的动作组不出现（`data-action-view-id` 只有 Part 头那一个入口才有）。
        expect(wrapper.find("[data-action-view-id]").exists()).toBe(false);
        expect(wrapper.find(".workbench-part__view-actions").exists()).toBe(false);
        expect(wrapper.find(`[data-section="${PANEL_EXTRA}"] [data-title-action="refresh"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-section="${PANEL_MORE}"] [data-title-action="refresh"]`).exists()).toBe(false);
    });
});
