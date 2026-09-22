/**
 * 工作台拖放的宿主层：一份几何登记 + 一次判定 + 一条提交路径。
 *
 * 三层分工，谁都不许多算一遍：
 * - **渲染层**（`WorkbenchPartHost` / `WorkbenchContainerTab` / `WorkbenchActivitySwitcherBand` /
 *   `WorkbenchViewHost`）只登记落点与几何：dnd-kit 的 `data` 就是落点声明，几何按容器 / 切换器读成
 *   resolver 的 rect 形状；命中由 DOM 适配层的「可见矩形 + 指针遮挡」检测器判定，不用库的 bounding rect；
 * - **本层**负责 dnd-kit 的会话：冻结拖动源与源容器的结构事实、每个显示帧用**当下**坐标同步算一次命中与判定、
 *   把预览原样交出去，并在松手时只提交「已经显示过的那一个动作」；
 * - **状态层**（`view-placements-session`）仍是唯一写者：本层只转发请求，读它给出的 `status` 显示结果。
 *
 * 坐标只有两个来源：指针拖动用捕获相位 tracker 记下的最新 `clientX / clientY`（含 `pointerup` 那一刻的），
 * 键盘拖动用库的 `dragOperation.position.current`（方向键移动被拖元素，命中目标随之变化）。
 * 「被拖元素中心」这种猜测已经删掉：猜出来的坐标一样会走进提交路径。
 *
 * 命中也不读 `operation.target`：那个字段由库在 microtask 里更新，指针常常与它差一步。每次求值都用
 * `manager.collisionObserver.computeCollisions(undefined, 本次坐标的detector)` **同步**算一遍，
 * 取优先级最高的那个落点（库自己的 `disabled` / `accept` 过滤与落点的 `collisionPriority` 照常生效）。
 */
import {computed, inject, onBeforeUnmount, provide, ref, shallowRef, type ComputedRef, type InjectionKey, type Ref} from "vue";
import {KeyboardSensor, PointerSensor, type DragDropProviderEmits, type DragDropProviderProps} from "@dnd-kit/vue";
import type {CollisionDetector} from "@dnd-kit/abstract";
import type {GridDropPoint, GridDropRect, GridOrientation} from "@notnotype/nb-ui/layout";
import {
    isSameWorkbenchDropAction,
    resolveWorkbenchDrop,
    type WorkbenchDropContainer,
    type WorkbenchDropContentRects,
    type WorkbenchDropDecision,
    type WorkbenchDropPresentation,
    type WorkbenchDropPreview,
    type WorkbenchDropSource,
    type WorkbenchDropSwitcherRects,
    type WorkbenchDropTarget,
    type WorkbenchDropRects,
    type WorkbenchContainerMergeRequest,
} from "nbook/app/utils/workbench/workbench-drop";
import {workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";
import {
    workbenchActivationConstraints,
    workbenchDragBlocksTarget,
} from "nbook/app/composables/useWorkbenchDrag";
import {
    isToolPartId,
    isToolPartLocation,
    type ContainerMoveRequest,
    type ToolPartId,
    type ToolPartLocation,
    type ViewDetachRequest,
    type ViewMoveRequest,
} from "nbook/app/utils/workbench/view-placements";
import type {ViewPlacementsOutcome} from "nbook/app/utils/workbench/view-placements-session";

/** 会话端口：页面与 Lab 都直接传唯一写者的方法，本层不持有记录副本。 */
export type WorkbenchDropPorts = {
    moveView(request: ViewMoveRequest): Promise<ViewPlacementsOutcome>;
    detachView(request: ViewDetachRequest): Promise<ViewPlacementsOutcome>;
    moveContainer(request: ContainerMoveRequest): Promise<ViewPlacementsOutcome>;
    mergeContainer(request: WorkbenchContainerMergeRequest): Promise<ViewPlacementsOutcome>;
};

/** 一次成功提交的结果，交给调用方决定怎么提示（notice / aria-live / 日志）。 */
export type WorkbenchDropOutcome = {
    readonly kind: WorkbenchDropDecision["kind"];
    readonly status: ViewPlacementsOutcome["status"];
    readonly diagnosis: string;
};

/**
 * 几何登记：渲染层挂载时登记读法，卸载时撤销。
 *
 * 内容目标按 `containerId`、切换器按 `partId` 各一份（一个 Part 只有一个切换器：左栏的活动栏、
 * 右栏与 Panel 的标签带）。读法返回 `null` 表示这一刻量不出来（未挂载 / 零尺寸），判定会拒绝而不是猜。
 */
export type WorkbenchDropGeometryRegistry = {
    registerContent(containerId: string, read: () => WorkbenchDropContentRects | null): () => void;
    /** 切换器按**作用域**登记（`workbenchSwitcherScope`）：同一 Part 的头部与活动栏各一份。 */
    registerSwitcher(switcherScope: string, read: () => WorkbenchDropSwitcherRects | null): () => void;
    registerEmpty(partId: ToolPartId, read: () => GridDropRect | null): () => void;
};

const GEOMETRY_KEY: InjectionKey<WorkbenchDropGeometryRegistry> = Symbol("nbook.workbench.dropGeometry");

/** 在提供者子树里登记几何读法；不在子树里（没调用 `useWorkbenchDrop`）时返回 `null`，宿主安静跳过。 */
export function useWorkbenchDropGeometry(): WorkbenchDropGeometryRegistry | null {
    return inject(GEOMETRY_KEY, null);
}

export type WorkbenchDropOptions = {
    /** 呈现求值结果（`resolveViewPresentation` 的返回值结构子集）；未就绪时返回 `null`。 */
    presentation: () => WorkbenchDropPresentation | null;
    /** 当前工作面代际：与拖动源冻结的那一份比较，不一致整条拒绝。 */
    contextKey: () => string;
    ports: WorkbenchDropPorts;
    /** 每次提交尝试的结果（含 `rejected` 的原始诊断）。 */
    onOutcome?: (outcome: WorkbenchDropOutcome) => void;
};

export type WorkbenchDropHandle = {
    /** 提供者自身的几何登记（渲染层通过注入拿到同一个）。 */
    geometry: WorkbenchDropGeometryRegistry;
    sensors: NonNullable<DragDropProviderProps["sensors"]>;
    /**
     * 提供者四个事件的处理入口：签名就是库的 emit 元组（`[event, manager]`），页面 / Lab 直接
     * `@drag-start="handlers.onDragStart"` 绑定，参数一个都不丢。
     */
    handlers: {
        onDragStart: (...event: DragDropProviderEmits["dragStart"]) => void;
        onDragMove: (...event: DragDropProviderEmits["dragMove"]) => void;
        onDragOver: (...event: DragDropProviderEmits["dragOver"]) => void;
        onDragEnd: (...event: DragDropProviderEmits["dragEnd"]) => void;
    };
    /** 当前预览：接收半区 / 插入线 / 要高亮的条目（`noop` 的 render-only 预览也从这里来）；没有有效目标时 `null`。 */
    preview: Readonly<Ref<WorkbenchDropPreview | null>>;
    /** 这次拖动要执行的动作（用于界面文案与 aria-live）。 */
    decision: Readonly<Ref<WorkbenchDropDecision["kind"] | null>>;
    /**
     * 这次拖动的**冻结源载荷**（`useWorkbenchDrag` 在按下那一刻冻结的那一份）；没有拖动时为 `null`。
     *
     * 只给唯一 Custom Overlay 呈现「正在拖谁」用：载荷本来就已经是冻结副本，宿主别再自己复制一份状态。
     */
    source: Readonly<Ref<WorkbenchDropSource | null>>;
    dragging: ComputedRef<boolean>;
};

// ── 库与落点的类型 ───────────────────────────────────────────────────────────

/** 提供者事件里的 `manager`（emit 元组的第二项）：帧里算命中用的那一份引用。 */
type WorkbenchDropManager = DragDropProviderEmits["dragStart"][1];

/** 内容落点的声明（库的 droppable `data`）。 */
type ContentTargetData = Extract<WorkbenchDropTarget, {readonly kind: "workbench-container-content-target"}>;

/**
 * 切换器落点的声明：resolver 的那一份，外加宿主在 `data` 上声明的**作用域**——
 * 同一 Part 的头部标题与主活动栏各有一份几何登记，取哪一份由它决定。
 */
type SwitcherTargetData = Extract<WorkbenchDropTarget, {readonly kind: "workbench-switcher-target"}>
    & Readonly<{readonly switcherScope?: string}>;

/** 库的 droppable `data` 取用前要自检成的两类落点。 */
type WorkbenchDropData = ContentTargetData | SwitcherTargetData | Extract<WorkbenchDropTarget, {readonly kind: "workbench-part-empty-target"}>;

/** 命中：落点 id（droppable id，会话按它认身份）与它的声明。 */
type DropHit = Readonly<{readonly id: string; readonly data: WorkbenchDropData}>;

/** 会写记录的那三种 decision：预览与请求成对出现，本层的提交路径只认它们。 */
type WorkbenchDropAction = Extract<WorkbenchDropDecision, {readonly kind: "move-view" | "detach-view" | "move-container" | "merge-container"}>;

// ── 会话事实 ─────────────────────────────────────────────────────────────────

/**
 * 一个容器此刻的结构事实：落位、内容轴与两种成员顺序（全部 / 可见）。
 *
 * 这些是**动作语义**的输入，不是像素：落位或轴变了，同一根指针下的动作就换了一个；成员顺序变了，
 * 插入位与「是不是原位置」的结论也跟着变。像素变化（指针移动、滚动、resize）不在其中。
 */
type ContainerFacts = Readonly<{
    readonly location: ToolPartLocation;
    readonly orientation: GridOrientation;
    readonly memberViewIds: readonly string[];
    readonly viewIds: readonly string[];
}>;

/** 落点几何登记（内容 / 切换器两种形状）：会冻结进会话，之后只做同一性对照。 */
type DropGeometryRead =
    | (() => WorkbenchDropContentRects | null)
    | (() => WorkbenchDropSwitcherRects | null);

/** 源容器的冻结：结构事实 + 当时那份几何登记（没登记时为 `null`，之后出现也算换过登记）。 */
type SourceSnapshot = Readonly<{
    readonly facts: ContainerFacts;
    readonly read: DropGeometryRead | null;
}>;

/**
 * 已经遇到过的落点的冻结事实：**第一次**遇到时记下，之后重访只对照、绝不刷新——
 * 失效的基线被刷新成新的，就会把「回到刚才那个位置」变成另一个动作。
 */
type TargetSnapshot =
    | Readonly<{
        readonly kind: "empty";
        readonly partId: ToolPartId;
        readonly read: () => GridDropRect | null;
    }>
    | Readonly<{
        readonly kind: "content";
        readonly containerId: string;
        readonly read: DropGeometryRead;
        /** 目标容器冻结时的结构事实：轴在 `container.orientation` 里。 */
        readonly container: ContainerFacts;
    }>
    | Readonly<{
        readonly kind: "switcher";
        readonly partId: ToolPartId;
        readonly switcherScope: string;
        /** 精确条目声明的容器；条目带空白为 `null`。 */
        readonly containerId: string | null;
        readonly location: ToolPartLocation;
        readonly orientation: GridOrientation;
        readonly read: DropGeometryRead;
        /** 这个 Part 里容器的呈现顺序：容器换序的位次按它算。 */
        readonly containerOrder: readonly string[];
        /** 冻结活动内容，切换期间不把旧手势投到新的上下文。 */
        readonly blank: Readonly<{readonly activeContainerId: string | null}> | null;
    }>;

/** 一场拖动里冻结下来的事实：结束后整份丢弃，不跨会话复用。 */
type DropSession = {
    /** 拖动源载荷（`useWorkbenchDrag` 开始时冻结的那一份）。 */
    readonly source: WorkbenchDropSource;
    /** 键盘拖动：坐标取库的实时 `position`，指针 tracker 不参与。 */
    readonly keyboard: boolean;
    /** 源容器冻结；开始那一刻呈现还不可读时为 `null`，由第一次可读的求值补上。 */
    sourceSnapshot: SourceSnapshot | null;
    /** 已访问的落点：键是 droppable id。 */
    readonly targets: Map<string, TargetSnapshot>;
    /** 最后一次**发布过接受预览**的动作；没有接受预览时为 `null`。 */
    accepted: WorkbenchDropAction | null;
};

/** 一次求值的结果：可发布的判定、整场取消（带诊断）、或这一刻判不出来。 */
type DropEvaluation =
    | Readonly<{readonly kind: "decision"; readonly decision: WorkbenchDropDecision | null}>
    | Readonly<{readonly kind: "cancelled"; readonly reason: string}>
    | Readonly<{readonly kind: "unavailable"}>;

// ── 小工具 ───────────────────────────────────────────────────────────────────

/**
 * 成员列表的顺序比较口径：长度先比、再逐位比。冻结快照与当前呈现的成员列表比较都走它，
 * 免得同一个「顺序一样」在不同地方有不同理解。
 */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** 容器的结构事实：顺序原样拷贝，冻结之后不再跟随呈现变化。 */
function containerFactsOf(slice: WorkbenchDropContainer): ContainerFacts {
    return {
        location: slice.location,
        orientation: slice.orientation,
        memberViewIds: [...slice.memberViewIds],
        viewIds: slice.views.map((entry) => entry.view.id),
    };
}

function sameContainerFacts(frozen: ContainerFacts, live: ContainerFacts): boolean {
    return frozen.location === live.location
        && frozen.orientation === live.orientation
        && sameOrder(frozen.memberViewIds, live.memberViewIds)
        && sameOrder(frozen.viewIds, live.viewIds);
}

/**
 * 切换器落点用哪一份几何登记：宿主声明的作用域；没声明时退回 Part 自己那一份。
 * 同一个 Part 的头部标题与主活动栏各有一份几何，冻结与读取必须按同一份来。
 */
function switcherScopeOf(target: SwitcherTargetData): string {
    return target.switcherScope ?? target.partId;
}

/** 拖动源载荷：`useWorkbenchDrag` 的两种载荷之一；页面上别的 DnD 区域不接。 */
function isWorkbenchDropSource(data: unknown): data is WorkbenchDropSource {
    if (data === null || typeof data !== "object") {
        return false;
    }
    const value = data as Record<string, unknown>;
    if (typeof value.containerId !== "string" || typeof value.contextKey !== "string" || !isToolPartLocation(value.location)) {
        return false;
    }
    if (value.kind === "workbench-view") {
        return typeof value.viewId === "string";
    }
    if (value.kind === "workbench-container") {
        return Array.isArray(value.viewIds) && value.viewIds.every((id) => typeof id === "string");
    }
    return false;
}

/** 库的 droppable `data` 是 `Record<string, any>`：取用前自检成**本层认识的两类落点**。 */
function isWorkbenchDropData(data: unknown): data is WorkbenchDropData {
    if (data === null || typeof data !== "object") {
        return false;
    }
    const value = data as Record<string, unknown>;
    if (value.kind === "workbench-container-content-target") {
        return typeof value.containerId === "string" && isToolPartLocation(value.location);
    }
    if (value.kind === "workbench-part-empty-target") {
        return isToolPartId(value.partId) && isToolPartLocation(value.location);
    }
    if (value.kind === "workbench-switcher-target") {
        return isToolPartId(value.partId)
            && isToolPartLocation(value.location)
            && (value.switcherScope === undefined || typeof value.switcherScope === "string")
            && (value.viewContainerId === undefined || typeof value.viewContainerId === "string")
            && (value.beforeContainerId === undefined || typeof value.beforeContainerId === "string");
    }
    return false;
}

/**
 * 会话期间的指针坐标：`pointermove` 与 `pointerup` 都按**捕获相位**写进同一份坐标，
 * 所以松手时用的是松手事件自己的 `clientX / clientY`，不是上一帧的位置。
 *
 * `onMove` 只负责安排一次重算（同一帧里的多次移动会合并）；坐标本身每次移动都更新。
 */
function usePointerTracker(onMove: () => void): {point: Ref<GridDropPoint | null>; install(): void; release(): void} {
    const point = ref<GridDropPoint | null>(null);
    let installed = false;
    const track = (event: PointerEvent): void => {
        point.value = {x: event.clientX, y: event.clientY};
        onMove();
    };
    function install(): void {
        if (installed) {
            return;
        }
        installed = true;
        window.addEventListener("pointermove", track, true);
        window.addEventListener("pointerup", track, true);
    }
    function release(): void {
        if (!installed) {
            return;
        }
        installed = false;
        window.removeEventListener("pointermove", track, true);
        window.removeEventListener("pointerup", track, true);
    }
    return {point, install, release};
}

export function useWorkbenchDrop(options: WorkbenchDropOptions): WorkbenchDropHandle {
    const contentReaders = new Map<string, () => WorkbenchDropContentRects | null>();
    const switcherReaders = new Map<string, () => WorkbenchDropSwitcherRects | null>();
    const emptyReaders = new Map<ToolPartId, () => GridDropRect | null>();
    const geometry: WorkbenchDropGeometryRegistry = {
        registerEmpty(partId, read) {
            emptyReaders.set(partId, read);
            return () => {
                if (emptyReaders.get(partId) === read) emptyReaders.delete(partId);
            };
        },
        registerContent(containerId, read) {
            contentReaders.set(containerId, read);
            return () => {
                if (contentReaders.get(containerId) === read) {
                    contentReaders.delete(containerId);
                }
            };
        },
        registerSwitcher(switcherScope, read) {
            switcherReaders.set(switcherScope, read);
            return () => {
                if (switcherReaders.get(switcherScope) === read) {
                    switcherReaders.delete(switcherScope);
                }
            };
        },
    };
    provide(GEOMETRY_KEY, geometry);

    const pointer = usePointerTracker(scheduleEvaluation);
    const preview = ref<WorkbenchDropPreview | null>(null);
    const decision = ref<WorkbenchDropDecision["kind"] | null>(null);
    const session = shallowRef<DropSession | null>(null);
    /** 冻结源载荷的只读视图：Overlay 标题只读它，不碰会话内部。 */
    const source = computed<WorkbenchDropSource | null>(() => session.value?.source ?? null);
    const dragging = computed(() => session.value !== null);
    const ports = options.ports;

    /** 这场会话的 manager：帧里用它同步算命中；会话结束时一起清掉。 */
    let activeManager: WorkbenchDropManager | null = null;
    /** 待执行的重算帧（0 = 没有）。move / over / scroll / resize / pointermove 共用这一个。 */
    let frame = 0;
    /** 这次会话装上的监听：拆的时候一起拆。 */
    let listenerCleanup: (() => void) | null = null;
    /**
     * 会话**已经**被取消时留下的诊断。
     *
     * 结构失效这类取消在松手时仍要说清原因（用户看到的高亮为什么没了、为什么没保存）；
     * 用户自己中止（Escape / `pointercancel` / 失焦 / 文档隐藏）传 `null`：静默收场。
     */
    let cancellation: string | null = null;

    // ── 几何登记：只读这一次命中目标那一份 ────────────────────────────────────

    /** 内容容器的几何登记（按容器 id）。 */
    function contentRead(containerId: string): DropGeometryRead | null {
        return contentReaders.get(containerId) ?? null;
    }

    /** 切换器的几何登记（按作用域）。 */
    function switcherRead(switcherScope: string): DropGeometryRead | null {
        return switcherReaders.get(switcherScope) ?? null;
    }

    // ── 会话事实：冻结、对照、失效 ────────────────────────────────────────────

    /** 一个内容容器还是不是冻结时的样子：登记同一、可呈现、落位 / 轴 / 成员同一。 */
    function containerInvalidation(
        label: string,
        containerId: string,
        frozen: ContainerFacts,
        read: DropGeometryRead | null,
        presentation: WorkbenchDropPresentation,
    ): string | null {
        if (contentRead(containerId) !== read) {
            return `${label} ${containerId} 的落点几何在拖动期间重新登记过，这次拖动不再有效`;
        }
        const slice = presentation.container(containerId);
        if (slice === null) {
            return `${label} ${containerId} 当前不可呈现（未登记或已经被并入别处），这次拖动不再有效`;
        }
        if (!sameContainerFacts(frozen, containerFactsOf(slice))) {
            return `${label} ${containerId} 的落位、轴或成员在拖动期间变了，这次拖动不再有效`;
        }
        return null;
    }

    /** 已经遇到过的落点还是不是冻结时的样子：登记同一、落位同一、结构同一。 */
    function targetInvalidation(frozen: TargetSnapshot, presentation: WorkbenchDropPresentation): string | null {
        if (frozen.kind === "empty") {
            return emptyReaders.get(frozen.partId) !== frozen.read || presentation.part(frozen.partId)?.containers.length !== 0
                ? `Part ${frozen.partId} 的空白区域在拖动期间变了，这次拖动不再有效`
                : null;
        }
        if (frozen.kind === "content") {
            return containerInvalidation("目标容器", frozen.containerId, frozen.container, frozen.read, presentation);
        }
        if (switcherRead(frozen.switcherScope) !== frozen.read) {
            return `切换器 ${frozen.switcherScope} 的落点几何在拖动期间重新登记过，这次拖动不再有效`;
        }
        const part = presentation.part(frozen.partId);
        if (part === null) {
            return `Part ${frozen.partId} 当前没有呈现切片，这次拖动不再有效`;
        }
        // 容器换序的位次按 Part 里的呈现顺序算：顺序变了，同一个锚点会落到位次不同的地方。
        if (frozen.containerOrder.length !== part.containers.length
            || !frozen.containerOrder.every((id, index) => id === part.containers[index]?.containerId)) {
            return `Part ${frozen.partId} 的容器顺序在拖动期间变了，这次拖动不再有效`;
        }
        if (frozen.blank !== null && frozen.blank.activeContainerId !== part.activeContainerId) {
            return `Part ${frozen.partId} 的活动容器在拖动期间变了，这次拖动不再有效`;
        }
        if (frozen.containerId !== null) {
            const slice = presentation.container(frozen.containerId);
            if (slice === null || slice.location !== frozen.location) {
                return `切换器条目 ${frozen.containerId} 的落位在拖动期间变了，这次拖动不再有效`;
            }
        }
        return null;
    }

    /**
     * 每次求值都检查**已经触及**的对象：工作面代际、源容器，以及一路上遇到过的落点。
     *
     * 结构、轴、成员或登记变了就取消（原因带回去当诊断）；指针换目标、像素移动、滚动与 resize 都不是
     * 取消的理由——那些只是重新测量、重新命中。
     */
    function invalidationOf(current: DropSession, presentation: WorkbenchDropPresentation): string | null {
        if (options.contextKey() !== current.source.contextKey) {
            return `工作面已经从 ${current.source.contextKey} 切换，这次拖动不再有效`;
        }
        const frozen = current.sourceSnapshot;
        if (frozen !== null) {
            const reason = containerInvalidation("来源容器", current.source.containerId, frozen.facts, frozen.read, presentation);
            if (reason !== null) {
                return reason;
            }
        }
        for (const target of current.targets.values()) {
            const reason = targetInvalidation(target, presentation);
            if (reason !== null) {
                return reason;
            }
        }
        return null;
    }

    /**
     * 第一次遇到某个落点时冻结它的事实；之后重访只对照，绝不刷新。
     *
     * 这一刻读不出结构与几何（容器不可呈现 / 登记不在 / 切换器量不出来）就不冻：那时也没有发布过
     * 接受预览，没有「显示过的动作」需要保护，下一次遇到再冻。
     */
    function freezeTarget(target: WorkbenchDropData, presentation: WorkbenchDropPresentation): TargetSnapshot | null {
        if (target.kind === "workbench-part-empty-target") {
            const read = emptyReaders.get(target.partId);
            return read === undefined || read() === null || presentation.part(target.partId)?.containers.length !== 0
                ? null
                : {kind: "empty", partId: target.partId, read};
        }
        // 几何登记按**同一性**冻结：宿主卸载或重挂都会换一份读数，那就不再是同一次拖动里的那个落点。
        if (target.kind === "workbench-container-content-target") {
            const read = contentRead(target.containerId);
            if (read === null) {
                return null;
            }
            const slice = presentation.container(target.containerId);
            return slice === null
                ? null
                : {
                    kind: "content",
                    containerId: target.containerId,
                    read,
                    container: containerFactsOf(slice),
                };
        }
        // 切换器登记按作用域**直接**取自 `switcherReaders`：那份读数只有切换器形状，调用结果不是联合。
        const switcherScope = switcherScopeOf(target);
        const read = switcherReaders.get(switcherScope) ?? null;
        if (read === null) {
            return null;
        }
        const part = presentation.part(target.partId);
        const rects = read();
        if (part === null || rects === null) {
            return null;
        }
        return {
            kind: "switcher",
            partId: target.partId,
            switcherScope,
            containerId: target.viewContainerId ?? null,
            location: target.location,
            orientation: rects.orientation,
            read,
            containerOrder: part.containers.map((entry) => entry.containerId),
            blank: target.viewContainerId === undefined ? {activeContainerId: part.activeContainerId} : null,
        };
    }

    // ── 命中与求值 ───────────────────────────────────────────────────────────

    /**
     * 本次求值的命中检测器：在这一次**只读**输入上把 `position.current` 换成会话当前坐标。
     *
     * 为什么必须换：`move()` 同步派发 `dragmove`，而库的 `position` 到随后一个 microtask 才更新；
     * 拿旧坐标配对新的指针会亮错落点。覆盖只发生在这一次调用的输入视图上（其它字段原样透传实时对象），
     * 库的 `position`、sensor 与状态一个都不改；适配层的可见性与遮挡口径原样复用。
     */
    function detectorAt(point: GridDropPoint): CollisionDetector {
        return (input) => workbenchPointerCollision({
            ...input,
            dragOperation: new Proxy(input.dragOperation, {
                get: (target, key) => key === "position" ? {...target.position, current: point} : Reflect.get(target, key),
            }),
        });
    }

    /**
     * 命中的落点：把库登记的**全部** droppable 交给适配层的检测器，同步取回按优先级排序的碰撞，
     * 取第一个本层认识的落点（不认识的和被库过滤掉的都不算命中）。
     */
    function hitTarget(manager: WorkbenchDropManager, point: GridDropPoint): DropHit | null {
        const collisions = manager.collisionObserver.computeCollisions(undefined, detectorAt(point));
        for (const collision of collisions) {
            if (typeof collision.id !== "string") {
                continue;
            }
            const data = manager.registry.droppables.get(collision.id)?.data;
            if (isWorkbenchDropData(data)) {
                return {id: collision.id, data};
            }
        }
        return null;
    }

    /**
     * 这一刻的判定坐标：指针拖动用 tracker 记下的最新 client 坐标（含 `pointerup`），
     * 键盘拖动用库的实时 `position.current`——键盘传感器把它维持在被拖元素中心，方向键一移动它就跟上。
     *
     * 两边都量不出来时返回 `null`：宁可没有预览，也不拿别的坐标提交。
     */
    function sessionPoint(current: DropSession, manager: WorkbenchDropManager): GridDropPoint | null {
        if (!current.keyboard) {
            const tracked = pointer.point.value;
            if (tracked !== null) {
                return tracked;
            }
        }
        const lead = manager.dragOperation.position.current;
        if (Number.isFinite(lead.x) && Number.isFinite(lead.y)) {
            return {x: lead.x, y: lead.y};
        }
        return pointer.point.value;
    }

    /**
     * 求值一次：先检查冻结事实，再用**当下**坐标同步算命中，最后交给 resolver。
     *
     * 不发布任何东西（发布由 `runEvaluation` 与松手路径决定）：松手时要在同一份状态上再判一次，
     * 那次求值不能顺手改掉「最后一次显示过的动作」。
     */
    function evaluate(current: DropSession, manager: WorkbenchDropManager): DropEvaluation {
        const presentation = options.presentation();
        if (presentation === null) {
            // 呈现还没就绪：既没有可判定的目标，也没有可对照的结构。
            return {kind: "decision", decision: null};
        }
        if (current.sourceSnapshot === null) {
            const slice = presentation.container(current.source.containerId);
            if (slice !== null) {
                current.sourceSnapshot = {facts: containerFactsOf(slice), read: contentRead(current.source.containerId)};
            }
        }
        const invalidation = invalidationOf(current, presentation);
        if (invalidation !== null) {
            return {kind: "cancelled", reason: invalidation};
        }
        const point = sessionPoint(current, manager);
        if (point === null) {
            return {kind: "unavailable"};
        }
        const hit = hitTarget(manager, point);
        if (hit === null) {
            return {kind: "decision", decision: null};
        }
        const sourceContent = contentReaders.get(current.source.containerId)?.() ?? null;
        const rects: WorkbenchDropRects = {
            sourceContent,
            ...(hit.data.kind === "workbench-container-content-target"
                ? {content: hit.data.containerId === current.source.containerId
                    ? sourceContent : contentReaders.get(hit.data.containerId)?.() ?? null}
                : hit.data.kind === "workbench-part-empty-target"
                    ? {empty: emptyReaders.get(hit.data.partId)?.() ?? null}
                    : {switcher: switcherReaders.get(switcherScopeOf(hit.data))?.() ?? null}),
        };
        const frozen = current.targets.get(hit.id);
        if (frozen === undefined) {
            const snapshot = freezeTarget(hit.data, presentation);
            if (snapshot === null) {
                // 这一刻读不出这个落点的结构与几何：没有可显示的落点，不冻也不提交。
                return {kind: "decision", decision: null};
            }
            current.targets.set(hit.id, snapshot);
        } else if (frozen.kind === "switcher" && frozen.orientation !== (rects.switcher?.orientation ?? frozen.orientation)) {
            // 命中目标的轴变了：同一个位置上的插入线会换方向，这不是显示过的那一个动作。
            return {kind: "cancelled", reason: `切换器 ${frozen.switcherScope} 的轴在拖动期间变了，这次拖动不再有效`};
        }
        return {
            kind: "decision",
            decision: resolveWorkbenchDrop({
                source: current.source,
                target: hit.data,
                point,
                rects,
                presentation,
                contextKey: options.contextKey(),
            }),
        };
    }

    // ── 发布与提交 ───────────────────────────────────────────────────────────

    /**
     * 发布一次判定：预览与动作名都从 decision 来，界面不再自己算几何。
     *
     * `noop` 只在原位插入锚点带 render-only 线；非空内容中央没有反馈。释放均不提交。
     * `rejected` 只有原因，其余动作的 preview 与提交请求成对发布。
     */
    function publish(current: DropSession, next: WorkbenchDropDecision | null): void {
        if (next === null) {
            current.accepted = null;
            preview.value = null;
            decision.value = null;
            return;
        }
        current.accepted = next.kind === "move-view" || next.kind === "detach-view" || next.kind === "move-container" || next.kind === "merge-container"
            ? next
            : null;
        const previous = preview.value;
        const holdArea = next.kind === "noop" && next.preview === undefined && previous?.areaRect !== null && previous?.areaRect !== undefined;
        preview.value = next.kind === "rejected"
            ? null
            : holdArea
                ? {...previous, indicator: null, entryRect: null, armed: false}
                : next.preview === undefined ? null : {...next.preview, armed: true};
        decision.value = next.kind;
    }

    /**
     * 提交一次请求：本层唯一的写路径。动作校验仍由状态层（唯一写者）做，本层不复制一套。
     *
     * 结果是**异步**回来的：它只交给调用方显示，不回写本层任何状态——下一场拖动的预览不会被
     * 上一场那笔保存的结果改掉。
     */
    function submit(action: WorkbenchDropAction): void {
        const report = options.onOutcome;
        const call = action.kind === "move-view"
            ? ports.moveView(action.request)
            : action.kind === "detach-view"
                ? ports.detachView(action.request)
                : action.kind === "move-container"
                    ? ports.moveContainer(action.request)
                    : ports.mergeContainer(action.request);
        void call.then((outcome: ViewPlacementsOutcome) => {
            report?.({kind: action.kind, status: outcome.status, diagnosis: outcome.diagnosis});
        });
    }

    /** 拒绝诊断：本层只把它交给调用方显示（notice / aria-live），不自己决定怎么呈现。 */
    function reportRejection(diagnosis: string): void {
        options.onOutcome?.({kind: "rejected", status: "rejected", diagnosis});
    }

    // ── 帧与生命周期 ─────────────────────────────────────────────────────────

    /** 会话帧：读**当下**状态求值并发布；结构失效就整场取消。 */
    function runEvaluation(): void {
        const current = session.value;
        const manager = activeManager;
        if (current === null || manager === null) {
            return;
        }
        const evaluation = evaluate(current, manager);
        if (evaluation.kind === "cancelled") {
            endSession(evaluation.reason);
            return;
        }
        if (evaluation.kind === "unavailable") {
            return;
        }
        publish(current, evaluation.decision);
    }

    /**
     * 安排一次重算：`dragmove` / `dragover` / `pointermove` / scroll / resize 共用**一个**待执行帧，
     * 一帧里来多少次都只算一次；帧里读当下状态，所以最多只落后一个显示帧。
     *
     * 没有活动拖动时不留逐帧循环；非浏览器运行时没有 rAF，就直接算。
     */
    function scheduleEvaluation(): void {
        if (session.value === null || frame !== 0) {
            return;
        }
        if (typeof requestAnimationFrame !== "function") {
            runEvaluation();
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            runEvaluation();
        });
    }

    /** 取消待执行帧：松手与取消都先做这一步，免得旧帧把已经结束的会话又发布一次。 */
    function cancelFrame(): void {
        if (frame === 0) {
            return;
        }
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(frame);
        }
        frame = 0;
    }

    /**
     * 会话级监听：Escape / `pointercancel` / 窗口失焦 / 文档隐藏都幂等地取消这场拖动；
     * scroll / resize / 落点盒尺寸变化只安排一次重新测量，复用同一待执行帧。
     *
     * `blur` **不加捕获**：加了会把子元素的失焦一起收进来（点一下别处就等于取消拖动），
     * 这里只要窗口自己失焦那一种。
     */
    function installSessionListeners(): void {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                endSession(null);
            }
        };
        const onPointerCancel = (): void => endSession(null);
        const onWindowBlur = (): void => endSession(null);
        const onVisibilityChange = (): void => {
            if (document.visibilityState === "hidden") {
                endSession(null);
            }
        };
        const onViewportChange = (): void => scheduleEvaluation();
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("pointercancel", onPointerCancel, true);
        window.addEventListener("blur", onWindowBlur);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("scroll", onViewportChange, {capture: true, passive: true});
        window.addEventListener("resize", onViewportChange);
        // 画布/父布局调整不会派发 window.resize；只在本次拖动期间观察现有落点盒。
        // 任一盒变化都重算当前指针命中，结构或轴变化仍由既有冻结校验取消。
        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onViewportChange);
        if (resizeObserver !== null && activeManager !== null) {
            for (const droppable of activeManager.registry.droppables) {
                const {element} = droppable as {element?: unknown};
                if (element instanceof Element) {
                    resizeObserver.observe(element);
                }
            }
        }
        listenerCleanup = () => {
            resizeObserver?.disconnect();
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("pointercancel", onPointerCancel, true);
            window.removeEventListener("blur", onWindowBlur);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("scroll", onViewportChange, {capture: true});
            window.removeEventListener("resize", onViewportChange);
        };
    }

    /**
     * 拆掉这场会话：清帧、拆监听、清预览与冻结事实，并释放 manager 引用。
     *
     * 幂等：已经拆过就什么都不做（第一份诊断说话）。`diagnosis` 只给「结构失效」这类取消用；
     * 用户自己中止（Escape / `pointercancel` / 失焦 / 文档隐藏）传 `null`——静默收场，不打扰用户。
     */
    function endSession(diagnosis: string | null): void {
        if (session.value === null && listenerCleanup === null) {
            return;
        }
        cancellation = cancellation ?? diagnosis;
        cancelFrame();
        listenerCleanup?.();
        listenerCleanup = null;
        pointer.release();
        pointer.point.value = null;
        activeManager = null;
        session.value = null;
        preview.value = null;
        decision.value = null;
    }

    // ── 事件入口 ─────────────────────────────────────────────────────────────

    /** 开始拖动：冻结拖动源，装好这一场的监听与第一帧。 */
    function onDragStart(event: DragDropProviderEmits["dragStart"][0], manager: DragDropProviderEmits["dragStart"][1]): void {
        // 上一场（如果还挂着）先干净拆掉：不留旧监听、旧预览与旧冻结事实。
        endSession(null);
        cancellation = null;
        const payload = event.operation.source?.data;
        if (!isWorkbenchDropSource(payload)) {
            return; // 不是本层的拖动源（页面上别的 DnD 区域）：不接，也就不冻任何东西
        }
        // 键盘传感器的激活事件是 `keydown`，指针传感器是 `pointerdown`：认出来才决定坐标来源。
        const activator = manager.dragOperation.activatorEvent;
        session.value = {
            source: payload,
            keyboard: activator !== null && activator.type.startsWith("key"),
            sourceSnapshot: null,
            targets: new Map(),
            accepted: null,
        };
        activeManager = manager;
        pointer.point.value = null;
        pointer.install();
        installSessionListeners();
        preview.value = null;
        decision.value = null;
        // 起手先算一帧：指针压在某个落点上就直接亮起来，不必等第一次移动。
        scheduleEvaluation();
    }

    /** `dragmove` / `dragover` 都只是「该重算了」的信号：事件里的 manager 就是这场会话的那一份。 */
    function reschedule(manager: WorkbenchDropManager): void {
        if (session.value === null) {
            return;
        }
        activeManager = manager;
        scheduleEvaluation();
    }

    function onDragMove(_event: DragDropProviderEmits["dragMove"][0], manager: DragDropProviderEmits["dragMove"][1]): void {
        reschedule(manager);
    }

    function onDragOver(_event: DragDropProviderEmits["dragOver"][0], manager: DragDropProviderEmits["dragOver"][1]): void {
        reschedule(manager);
    }

    /**
     * 松手：只提交**已经显示过**的那一个动作。
     *
     * 顺序是合同的一部分：先取消待执行帧、用最后坐标与可见几何再判一次，再拆会话，最后才走端口——
     * 保存引发的结构变化不该反过来取消这次已经成立的手势。
     */
    function onDragEnd(event: DragDropProviderEmits["dragEnd"][0], manager: DragDropProviderEmits["dragEnd"][1]): void {
        cancelFrame();
        const current = session.value;
        if (current === null) {
            // 会话在途中就被取消了：结构失效的原因照报，用户自己中止则连诊断一起丢掉。
            consumeCancellation(event.canceled !== true);
            return;
        }
        if (event.canceled === true) {
            endSession(null);
            cancellation = null;
            return;
        }
        const evaluation = evaluate(current, manager);
        const accepted = current.accepted;
        endSession(null);
        if (evaluation.kind === "unavailable") {
            // 最后这一刻判不出来（坐标 / 呈现读不到）：不提交，也不编一个理由。
            return;
        }
        if (evaluation.kind === "cancelled") {
            reportRejection(evaluation.reason);
            return;
        }
        const final = evaluation.decision;
        if (final === null || final.kind === "noop") {
            return;
        }
        if (final.kind === "rejected") {
            reportRejection(final.reason);
            return;
        }
        if (accepted === null || !isSameWorkbenchDropAction(accepted, final)) {
            // 没有发布过接受预览，或显示过的是**另一个**动作（换了目标 / 换了锚点）：都不写。
            return;
        }
        submit(final);
    }

    /**
     * 会话已经被取消时，把留下的诊断报给调用方；报完就作废（诊断只属于那一场拖动）。
     * `reportable` 为 `false`（库把这次拖动标记成 canceled）时直接丢掉。
     */
    function consumeCancellation(reportable: boolean): void {
        const reason = cancellation;
        cancellation = null;
        if (reportable && reason !== null) {
            reportRejection(reason);
        }
    }

    onBeforeUnmount(() => {
        endSession(null);
        cancelFrame();
        pointer.release();
        contentReaders.clear();
        switcherReaders.clear();
        emptyReaders.clear();
    });

    return {
        geometry,
        sensors: workbenchDropSensors(),
        handlers: {onDragStart, onDragMove, onDragOver, onDragEnd},
        preview,
        decision,
        source,
        dragging,
    };
}

/**
 * 提供者级传感器：指针按被拖元素的激活元素判定，键盘给非拖动操作者一条等价入口。
 *
 * 激活门槛与交互排除从 `useWorkbenchDrag` 取同一份常量：页面不再各写一条 `PointerSensor.configure(...)`，
 * 也不会出现「拖动源一套门槛、提供者另一套」。
 */
export function workbenchDropSensors(): NonNullable<DragDropProviderProps["sensors"]> {
    return [
        PointerSensor.configure({
            activatorElements: (source) => [source.handle ?? source.element],
            activationConstraints: workbenchActivationConstraints,
            preventActivation: (event) => workbenchDragBlocksTarget(event.target),
        }),
        KeyboardSensor,
    ];
}
