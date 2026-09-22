/**
 * 拖放落点判定（纯函数）：把「拖动源 + 命中目标 + 几何 + 呈现」换算成一次可提交的请求、明确拒绝或无操作。
 *
 * 三条边界：
 * - **纯输入**：不读记录 / Storage / Vue 上下文，不碰 DOM 类型与 dnd-kit；坐标一律是 CSS client 像素。
 * - **一份判定**：预览就在 decision 的 `preview` 里，与将要提交的请求同源，不会出现"有高亮但提交去另一个容器"。
 * - **保守**：几何过期、锚点消失、目标量不出来时拒绝或 noop 并给可读原因，绝不猜目标；量不出半区尺寸时
 *   **整条拒绝**，绝不把算不出来的半区并入降级成"追加进去"（`noop` 只用于成立但不产生变更的落点）。
 *
 * 内容落点复用 nb-ui `resolveGridInsertion`：每个可见叶沿目标轴前后各 50%，没有中央禁投区，中点归后半。
 * 命中边缘后动作是**半区并入**——`move-view` / `merge-container` 带上 `ViewSplitPlacement`（命中叶、侧向、
 * 轴、命中叶当前的份额、来源比例），反馈是命中叶对应的那一半（`areaRect`），不叠加插入线。两张尺寸表：目标以
 * 目标容器内容盒里的可见叶为准；来源优先用来源容器的内容几何（`rects.sourceContent`），量不出来时（非活动条目
 * 的内容停在 hidden parking）退到呈现层给的展开尺寸意图（`sizeIntents`），单 View 源的比例恒为 1。三档都拿不到
 * 某个要搬可见成员的尺寸时整条拒绝——绝不把算不出来的半区并入降级成"追加进去"。非法方向、被遮挡或量不出来的目标只给**没有预览**的
 * `noop`：保留拖影，不给区域、不给"保持布局"提示，也不写记录。轴取容器切片的 `orientation`（左右侧栏上下排、
 * Panel 左右排），所以侧栏只认上/下、Panel 只认左/右。同一容器内的边缘落点只改变成员顺序，不重算尺寸。
 *
 * 切换器（标签带 / Activity Bar 条目带）只有插入位：两种源都吃同一份共享列表几何
 * `resolveListInsertion({edgeGap: 4})`，预览只有那一条插入线——按新合同删除条目高亮，`entryRect` 始终 `null`。
 * 视图落切换器**创建新容器**（`detach-view`：在插入位出现新 Tab；源容器实际成员归零就由记录层收掉），
 * 不再有"并入悬停条目那个容器"这条旧语义；容器落切换器仍是整容器换序/迁移（`move-container`，原位带线不提交）。
 *
 * 空 Part（`part.containers.length === 0`）另有整区落点 `workbench-part-empty-target`：视图 detach 到该落位、
 * 容器搬到该落位，反馈是整个空区域；Part 一旦有容器，这个落点就失效并拒绝（不猜一个新目标）。
 *
 * `view-placements` 的 `resolveViewMove` / `resolveContainerMove` / `resolveContainerMerge` / `detachView` 仍是
 * 最终写入边界：本模块只保证送进去的意图就是用户在屏幕上看到的那个；`isSameWorkbenchDropAction` 给会话层一把
 * "松手时提交的还是不是已显示过的那次"的尺子（含 split 的命中叶、侧向、轴与两张冻结尺寸表）。
 */
import {
    isGridDropRect,
    resolveGridInsertion,
    resolveListInsertion,
    type GridDropMember,
    type GridDropPoint,
    type GridDropRect,
    type GridInsertion,
    type GridOrientation,
} from "@notnotype/nb-ui/layout";
import {containerOrientation} from "nbook/app/utils/workbench/view-container-layout";
import {
    toolPartOfLocation,
    type ContainerMergeRequest,
    type ContainerMoveRequest,
    type ToolPartId,
    type ToolPartLocation,
    type ViewDetachRequest,
    type ViewMoveRequest,
    type ViewSplitPlacement,
} from "nbook/app/utils/workbench/view-placements";

/** Workbench 内容区前后各占 50%，没有中央禁投区；中点归后半，预览范围也是对应 50%。 */
const WORKBENCH_CONTENT_EDGE_RATIO = 0.5;

// ── 输入：两种源 ─────────────────────────────────────────────────────────────

/** 拖动源。`contextKey` 是开始拖动时的工作面代际：与当前不一致就整条拒绝。 */
export type WorkbenchDropSource =
    | Readonly<{
        readonly kind: "workbench-view";
        readonly viewId: string;
        readonly containerId: string;
        readonly location: ToolPartLocation;
        readonly contextKey: string;
    }>
    | Readonly<{
        readonly kind: "workbench-container";
        readonly containerId: string;
        readonly location: ToolPartLocation;
        readonly contextKey: string;
        /**
         * 开始拖动时源容器**全部已登记生效成员**（含 hidden 与 collapsed）按 `(order, id)` 的快照。
         *
         * 只带可见成员会让整组并入漏搬 hidden 的 View；与呈现切片对不上时这里直接拒绝，不补也不猜。
         */
        readonly viewIds: readonly string[];
    }>;

// ── 输入：三类命中目标 ───────────────────────────────────────────────────────

/**
 * 命中的落点目标：与 dnd-kit 的 droppable id 一一对应。三种目标的 `location` 都必须与 `partId` 对得上
 * （`toolPartOfLocation`），对不上就拒绝——未知落位没有可提交的动作，也不猜一个回来。
 *
 * `beforeContainerId` 是**插入锚点的声明**，不是事实：无论条目命中还是条目带空白命中，锚点都由共享列表几何
 * 给出，声明只与它逐字对照，不一致就拒绝——绝不退化成"条目带空白追加"。`viewContainerId` 是调用方的条目命中
 * 声明（拖动会话用它冻结"指针当时在哪个条目上"）：它**不决定归属与插入位**，但照样复核（条目仍在几何里、
 * 指针落在条目与条目带的可见交集内），失效就拒绝，同样不退化成条目带空白追加。
 */
export type WorkbenchDropTarget =
    | Readonly<{
        readonly kind: "workbench-switcher-target";
        readonly partId: ToolPartId;
        readonly location: ToolPartLocation;
        readonly beforeContainerId?: string;
        readonly viewContainerId?: string;
    }>
    | Readonly<{
        readonly kind: "workbench-container-content-target";
        readonly containerId: string;
        readonly location: ToolPartLocation;
    }>
    | Readonly<{
        readonly kind: "workbench-part-empty-target";
        readonly partId: ToolPartId;
        readonly location: ToolPartLocation;
    }>;

// ── 输入：呈现切片 ───────────────────────────────────────────────────────────

/**
 * 一个容器的只读呈现切片：`ContainerViewPresentation` 的**结构子集**（多出来的字段不影响赋值）。
 *
 * 只声明本模块真正读取的事实，避免把 catalog 的求值结果复制一遍；`memberViewIds` / `views` 的顺序
 * 就是生效顺序，本模块不再排序。
 */
export type WorkbenchDropContainer = Readonly<{
    readonly containerId: string;
    readonly location: ToolPartLocation;
    readonly partId: ToolPartId;
    /** `canMoveContainer !== false`：不可移动的容器既不能作为拖动源，也不能作为容器重排锚点。 */
    readonly canMoveContainer: boolean;
    /** 容器内部编排方向：left/right 上下排、panel 左右排（内容落点的命中轴与半区轴）。 */
    readonly orientation: GridOrientation;
    /** 全部已登记生效成员（含 hidden / collapsed），按 `(order, id)`。 */
    readonly memberViewIds: readonly string[];
    /** 该容器的**可见**视图（内容落点几何必须与它一致），按 `(order, id)`。 */
    readonly views: readonly Readonly<{readonly view: Readonly<{readonly id: string}>}>[];
    /**
     * 可见成员的**展开主轴尺寸意图**（px，源轴）：呈现层给的那一份，只在内容几何量不出来时当来源比例用
     * （非活动 Switcher 条目的内容停在 hidden parking，没有 client 矩形但它照样要能整组并入）。
     * 缺省或少于本次要搬的可见成员时退回下一档，不猜。
     */
    readonly sizeIntents?: Readonly<Record<string, number>>;
    /** 当前主轴上收成细条的可见成员；全部可见成员都在其中时，剩余内容区才是落点。 */
    readonly collapsedViewIds?: readonly string[];
    /** View 可投递的容器（不含自己）；跨容器移动按它复核。 */
    readonly moveTargets: readonly Readonly<{readonly containerId: string}>[];
}>;

/** 一个 Part 的只读呈现切片：`PartContainerPresentation` 的结构子集。 */
export type WorkbenchDropPart = Readonly<{
    readonly partId: ToolPartId;
    /** 这个 Part 里的容器，按切换器顺序；空数组＝这个 Part 是空态（空内容落点只在这里成立）。 */
    readonly containers: readonly WorkbenchDropContainer[];
    /** 记录的当前容器：调用方的命中冻结读它；本模块只看 `containers` 是否为空。 */
    readonly activeContainerId: string | null;
}>;

export type WorkbenchDropPresentation = Readonly<{
    /** 未登记或被抑制的容器返回 `null`。 */
    container(containerId: string): WorkbenchDropContainer | null;
    part(partId: ToolPartId): WorkbenchDropPart | null;
}>;

// ── 输入：几何 ───────────────────────────────────────────────────────────────

/** 内容落点几何：容器内容盒 + 按呈现顺序的可见成员 rect。被拖的 View **不剔除**：源保持原位，几何就是实际布局。 */
export type WorkbenchDropContentRects = Readonly<{
    readonly containerId: string;
    readonly rect: GridDropRect;
    readonly members: readonly GridDropMember[];
}>;

export type WorkbenchDropSwitcherEntry = Readonly<{
    readonly containerId: string;
    readonly rect: GridDropRect;
    /** 条目自己的朝向；缺省用条目带的朝向。 */
    readonly orientation?: GridOrientation;
}>;

/** 切换器落点几何：条目带矩形 + 朝向（标签带水平、Activity Bar 垂直）+ 条目 rect（按切换器顺序）。 */
export type WorkbenchDropSwitcherRects = Readonly<{
    readonly orientation: GridOrientation;
    readonly rect: GridDropRect;
    readonly entries: readonly WorkbenchDropSwitcherEntry[];
}>;

export type WorkbenchDropRects = Readonly<{
    /** 命中内容目标时给；缺省表示这个目标量不出内容盒（＝不可命中）。 */
    readonly content?: WorkbenchDropContentRects | null;
    /** 命中切换器目标时给。 */
    readonly switcher?: WorkbenchDropSwitcherRects | null;
    /** 命中空 Part 目标时给（整个 Part 内容区的可见矩形）；缺省表示量不出整区（＝不可命中）。 */
    readonly empty?: GridDropRect | null;
    /**
     * **来源**容器的内容几何：边缘并入的 `sourceSizes` 优先从这里取。
     *
     * 与 `content` 同一份读数（同容器落点就是同一份）；量不出来时来源比例退到切片上的 `sizeIntents`
     * （非活动条目的内容停在 hidden parking），两档都不完整才拒绝——整容器并入不把"没有几何"当拒绝理由。
     */
    readonly sourceContent?: WorkbenchDropContentRects | null;
}>;

export type WorkbenchDropInput = Readonly<{
    readonly source: WorkbenchDropSource;
    readonly target: WorkbenchDropTarget;
    /** 指针的 CSS client 坐标，与传入 rect 同一坐标系。 */
    readonly point: GridDropPoint;
    readonly rects: WorkbenchDropRects;
    readonly presentation: WorkbenchDropPresentation;
    /** 当前工作面代际。 */
    readonly contextKey: string;
}>;

// ── 输出 ─────────────────────────────────────────────────────────────────────

/**
 * 一次整组并入请求：与 `view-placements.ts` 的 `ContainerMergeRequest` **就是同一个类型**（字段名、可选性、
 * 字面量类型都只有一份定义），可以原样交给会话的 `mergeContainer`。
 *
 * 这里保留这个名字是因为本模块与它的消费者（`useWorkbenchDrop` 的端口）一直按"请求形状"这份合同对接；
 * 形状本身归 `view-placements` 拥有，字段增删只在那边发生。
 */
export type WorkbenchContainerMergeRequest = ContainerMergeRequest;

/**
 * 一次拖放的可见预览。中央禁投与量不出来的目标**不给预览**（没有落点形状可画），
 * 因此只有真的会画出形状的落点才会带上它——包括切换器原位插入位那条 render-only 的线。
 */
export type WorkbenchDropPreview = Readonly<{
    /** 插入线：只有切换器的列表插入位会画（边缘并入改成半区 `areaRect`，不叠加线）。 */
    readonly indicator: GridDropRect | null;
    /** 接收区域：边缘并入的命中半区 / 空 Part 的整个内容区。 */
    readonly areaRect: GridDropRect | null;
    /** 切换器条目高亮；按新合同删除，始终 `null`。 */
    readonly entryRect: GridDropRect | null;
    readonly orientation: GridOrientation;
    readonly count: number;
    /**
     * 中央禁投时保留上一份半区，只降低透明度、不提交。
     * 缺省表示当前落点可提交或是普通 render-only 反馈。
     */
    readonly armed?: boolean;
}>;

/**
 * 判定结果。`noop` 表示这次拖放成立但不产生变更（中央禁投、空态、量不出来的目标、切换器的原位插入位），
 * 可选 `preview` 只用于 render-only 反馈——切换器原位照样画那一条线，中央与量不出来的目标什么都不画；
 * `rejected` 表示看懂了但不允许（或缺少可提交的尺寸）。
 */
export type WorkbenchDropDecision =
    | Readonly<{readonly kind: "move-view"; readonly request: ViewMoveRequest; readonly preview: WorkbenchDropPreview}>
    | Readonly<{readonly kind: "move-container"; readonly request: ContainerMoveRequest; readonly preview: WorkbenchDropPreview}>
    | Readonly<{readonly kind: "merge-container"; readonly request: WorkbenchContainerMergeRequest; readonly preview: WorkbenchDropPreview}>
    | Readonly<{readonly kind: "detach-view"; readonly request: ViewDetachRequest; readonly preview: WorkbenchDropPreview}>
    | Readonly<{readonly kind: "noop"; readonly preview?: WorkbenchDropPreview}>
    | Readonly<{readonly kind: "rejected"; readonly reason: string}>;


// ── 动作一致性 ───────────────────────────────────────────────────────────────

/** 两张尺寸表逐项相同：键集合与每个值都要一样（顺序不参与比较）。 */
function sameSizes(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key]);
}

/**
 * 半区语义是不是同一份：命中叶、侧向、轴与两张冻结尺寸表都要逐项相同。
 *
 * 尺寸进比较是因为它就是**冻结的几何快照**：容器在拖动期间挪了几像素，同一个锚点上的半区份额已经不同，
 * 松手时提交的就不再是显示过的那一次并入。
 */
function sameSplit(left: ViewSplitPlacement | undefined, right: ViewSplitPlacement | undefined): boolean {
    if (left === undefined || right === undefined) {
        return left === undefined && right === undefined;
    }
    return left.targetViewId === right.targetViewId
        && left.side === right.side
        && left.axis === right.axis
        && sameSizes(left.targetSizes, right.targetSizes)
        && sameSizes(left.sourceSizes, right.sourceSizes);
}

/**
 * 两次判定是不是**同一个动作**：只有双方都是可提交的 decision、`kind` 与预览朝向一致，且请求里的每个
 * 语义字段（含并入的**有序**成员快照、split 的命中叶/侧向/轴/冻结尺寸、工作面代际）全都相同，才是 `true`。
 *
 * 只比语义、不比像素：同一个落点上指针挪了几像素、半区矩形跟着变，仍是同一个动作；而"同 kind 但换了
 * 源/目标、换了命中叶或侧向、换了并入成员"必须算换动作——否则松手时会提交用户没看见的那一个。
 * `null`（没有发布过接受预览）与 `noop` / `rejected` 一律 `false`。源/目标 `location` 与全局 contextKey
 * 的冻结校验由会话在开始拖动时完成，这里只在请求已经带上它们时逐字比较。
 */
export function isSameWorkbenchDropAction(previous: WorkbenchDropDecision | null, next: WorkbenchDropDecision): boolean {
    if (previous === null) {
        return false;
    }
    if (previous.kind === "move-view" && next.kind === "move-view") {
        const [a, b] = [previous.request, next.request];
        return previous.preview.orientation === next.preview.orientation
            && a.viewId === b.viewId
            && a.sourceContainerId === b.sourceContainerId
            && a.targetContainerId === b.targetContainerId
            && a.beforeViewId === b.beforeViewId
            && sameSplit(a.split, b.split);
    }
    if (previous.kind === "move-container" && next.kind === "move-container") {
        const [a, b] = [previous.request, next.request];
        return previous.preview.orientation === next.preview.orientation
            && a.containerId === b.containerId
            && a.sourceLocation === b.sourceLocation
            && a.targetLocation === b.targetLocation
            && a.beforeContainerId === b.beforeContainerId;
    }
    if (previous.kind === "merge-container" && next.kind === "merge-container") {
        const [a, b] = [previous.request, next.request];
        return previous.preview.orientation === next.preview.orientation
            && a.sourceContainerId === b.sourceContainerId
            && a.sourceLocation === b.sourceLocation
            && a.targetContainerId === b.targetContainerId
            && a.targetLocation === b.targetLocation
            && a.contextKey === b.contextKey
            && a.beforeViewId === b.beforeViewId
            && a.sourceViewIds.length === b.sourceViewIds.length
            && a.sourceViewIds.every((id, index) => id === b.sourceViewIds[index])
            && sameSplit(a.split, b.split);
    }
    if (previous.kind === "detach-view" && next.kind === "detach-view") {
        const [a, b] = [previous.request, next.request];
        return previous.preview.orientation === next.preview.orientation
            && a.viewId === b.viewId
            && a.sourceContainerId === b.sourceContainerId
            && a.targetLocation === b.targetLocation
            && a.beforeContainerId === b.beforeContainerId
            && a.contextKey === b.contextKey;
    }
    return false;
}

// ── 内部小工具 ───────────────────────────────────────────────────────────────

type Resolved<T> =
    | Readonly<{readonly ok: true; readonly value: T}>
    | Readonly<{readonly ok: false; readonly decision: WorkbenchDropDecision}>;

function noop(preview?: WorkbenchDropPreview): WorkbenchDropDecision {
    return preview === undefined ? {kind: "noop"} : {kind: "noop", preview};
}

function rejection(reason: string): WorkbenchDropDecision {
    return {kind: "rejected", reason};
}

/** 零尺寸矩形按合同不可命中：所有落点几何先过这一关，避免把量不出来的盒子当成有效目标。 */
function validRectOrNull(rect: GridDropRect | null | undefined): GridDropRect | null {
    return rect != null && isGridDropRect(rect) ? rect : null;
}

/**
 * 指针是否落在矩形内：与 nb-ui 的命中口径一致（**含边界**）。两处口径必须同步——这里放宽一寸，
 * 解析就会为一个几何层认为在盒外的点发出预览。
 */
function rectContainsPoint(rect: GridDropRect, point: GridDropPoint): boolean {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** 两个矩形的可见交集；空交集（任一轴不为正）返回 `null`。 */
function intersectRect(a: GridDropRect, b: GridDropRect): GridDropRect | null {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? {left, top, right, bottom} : null;
}

// ── 源容器核对 ───────────────────────────────────────────────────────────────

/** 内容落点几何的成员清单：可见成员自检后的候选叶（顺序保持呈现顺序）。 */
type ContentGeometry = Readonly<{readonly rect: GridDropRect; readonly members: readonly GridDropMember[]}>;

/** 内容落点几何的自检：成员必须是该容器的可见成员、不能重复；rect 有效性交给 nb-ui 插入函数跳过。 */
function contentGeometryOf(slice: WorkbenchDropContainer, geometry: WorkbenchDropContentRects): Resolved<ContentGeometry> {
    if (geometry.containerId !== slice.containerId) {
        return {
            ok: false,
            decision: rejection(`内容落点几何来自容器 ${geometry.containerId}，与命中的 ${slice.containerId} 不一致，拒绝这次拖放`),
        };
    }
    const visible = new Set(slice.views.map((entry) => entry.view.id));
    const seen = new Set<string>();
    for (const member of geometry.members) {
        if (seen.has(member.id)) {
            return {ok: false, decision: rejection(`内容落点几何里出现重复成员 ${member.id}，拒绝这次拖放`)};
        }
        seen.add(member.id);
        if (!visible.has(member.id)) {
            return {
                ok: false,
                decision: rejection(`内容落点几何里的 ${member.id} 不是容器 ${slice.containerId} 的可见成员，几何过期，拒绝这次拖放`),
            };
        }
    }
    return {ok: true, value: {rect: geometry.rect, members: geometry.members}};
}

/** 视图源的来源容器：必须已登记、落位未变、视图仍是它的（可见）成员。 */
function viewSourceSliceOf(
    input: WorkbenchDropInput,
    source: WorkbenchDropSource & {kind: "workbench-view"},
): Resolved<WorkbenchDropContainer> {
    const slice = input.presentation.container(source.containerId);
    if (slice === null) {
        return {ok: false, decision: rejection(`来源容器 ${source.containerId} 当前不可呈现（未登记或已经被并入别处），拒绝这次拖动`)};
    }
    if (slice.location !== source.location) {
        return {
            ok: false,
            decision: rejection(`来源位置 ${source.location} 与容器 ${source.containerId} 的当前落位 ${slice.location} 不一致，拒绝这次拖动`),
        };
    }
    if (!slice.memberViewIds.includes(source.viewId)) {
        return {ok: false, decision: rejection(`视图 ${source.viewId} 不在来源容器 ${source.containerId} 的成员里，这次拖动已经过期，拒绝`)};
    }
    if (!slice.views.some((entry) => entry.view.id === source.viewId)) {
        return {ok: false, decision: rejection(`视图 ${source.viewId} 当前不可见，拒绝这次拖动`)};
    }
    return {ok: true, value: slice};
}

/** 容器源的来源容器：必须已登记、落位未变、声明可移动。 */
function containerSourceSliceOf(
    input: WorkbenchDropInput,
    source: WorkbenchDropSource & {kind: "workbench-container"},
): Resolved<WorkbenchDropContainer> {
    const slice = input.presentation.container(source.containerId);
    if (slice === null) {
        return {ok: false, decision: rejection(`来源容器 ${source.containerId} 当前不可呈现（未登记或已经被并入别处），拒绝这次拖动`)};
    }
    if (slice.location !== source.location) {
        return {
            ok: false,
            decision: rejection(`来源位置 ${source.location} 与容器 ${source.containerId} 的当前落位 ${slice.location} 不一致，拒绝这次拖动`),
        };
    }
    if (!slice.canMoveContainer) {
        return {ok: false, decision: rejection(`容器 ${source.containerId} 声明不可移动，拒绝搬动它`)};
    }
    return {ok: true, value: slice};
}

/**
 * 视图落内容区前的位置边界：跨容器时目标必须在来源的 `moveTargets` 里（同容器落点不受它限制，
 * 因为 `moveTargets` 按合同不含自己）。视图 detach 到切换器/空 Part 不经过这里：它不在落进任何现有
 * 容器的归属里，新建容器的权限由记录层按同一份视图可移动性求值。
 */
function viewTargetAllowed(sourceSlice: WorkbenchDropContainer, targetSlice: WorkbenchDropContainer): WorkbenchDropDecision | null {
    if (sourceSlice.containerId === targetSlice.containerId) {
        return null;
    }
    return sourceSlice.moveTargets.some((entry) => entry.containerId === targetSlice.containerId)
        ? null
        : rejection(`目标容器 ${targetSlice.containerId} 不在容器 ${sourceSlice.containerId} 的可移动目标里，拒绝这次移动`);
}

// ── 半区并入：尺寸与反馈 ─────────────────────────────────────────────────────
/** 全部可见成员都收成细条时的落点：末条细条之后、内容盒之内的连续区域。 */
type RemainderHit = Readonly<{readonly kind: "remainder"; readonly areaRect: GridDropRect}>;

function collapsedRemainderOf(slice: WorkbenchDropContainer, geometry: ContentGeometry): GridDropRect | null {
    const collapsed = new Set(slice.collapsedViewIds ?? []);
    if (geometry.members.length === 0 || !geometry.members.every((member) => collapsed.has(member.id))) {
        return null;
    }
    const horizontal = slice.orientation === "horizontal";
    const boundary = geometry.members.reduce((end, member) => Math.max(
        end,
        horizontal ? member.rect.right : member.rect.bottom,
    ), horizontal ? geometry.rect.left : geometry.rect.top);
    const area = horizontal
        ? {...geometry.rect, left: boundary}
        : {...geometry.rect, top: boundary};
    return isGridDropRect(area) ? area : null;
}
/** 边缘并入的命中：命中叶、插到它哪一侧、以及它对应那一半的反馈范围。三者同出一次 `resolveGridInsertion`。 */
type EdgeHit = Readonly<{readonly targetViewId: string; readonly side: "before" | "after"; readonly halfRect: GridDropRect}>;

/**
 * 命中叶与半区：内容区前后各 50%（叶间空隙归后一叶，中点归后半）。非法方向在上游拒绝。
 * 成员表里一片可用叶都没有（都量不出来）时没有命中叶，也就没有半区可并入——不猜、不追加。
 *
 * `side` 从 `beforeId` 与命中叶的同一性推出：插入位就是命中叶自己＝它的前缘带，否则是它的后缘带（含追加）。
 */
function edgeHitOf(insertion: Exclude<GridInsertion, {kind: "keep"}>): EdgeHit | null {
    const {targetId, halfRect, beforeId} = insertion;
    if (targetId === null || halfRect === null) {
        return null;
    }
    return {targetViewId: targetId, side: beforeId === targetId ? "before" : "after", halfRect};
}

/**
 * 半区并入的共同部分：命中叶、侧向、轴、两张冻结尺寸表和反馈半区。全部收起时没有半区，
 * `split` 为空，拖入成员使用自己的展开尺寸，反馈覆盖细条后的剩余区域。
 */
function halfSplitOf(options: {
    input: WorkbenchDropInput;
    slice: WorkbenchDropContainer;
    geometry: ContentGeometry;
    hit: EdgeHit | RemainderHit;
    sourceSlice: WorkbenchDropContainer;
    draggedViewIds: readonly string[];
    count: number;
}): Resolved<Readonly<{readonly split?: ViewSplitPlacement; readonly preview: WorkbenchDropPreview}>> {
    const {input, slice, geometry, hit, sourceSlice, draggedViewIds, count} = options;
    if (hit.kind === "remainder") {
        return {
            ok: true,
            value: {
                preview: {indicator: null, areaRect: hit.areaRect, entryRect: null, orientation: slice.orientation, count},
            },
        };
    }
    const sourceSizes = sourceSizesOf(input, sourceSlice, draggedViewIds);
    if (!sourceSizes.ok) {
        return {ok: false, decision: sourceSizes.decision};
    }
    return {
        ok: true,
        value: {
            split: {
                targetViewId: hit.targetViewId,
                side: hit.side,
                axis: slice.orientation === "horizontal" ? "width" : "height",
                targetSizes: sizesAlong(slice.orientation, geometry.members),
                sourceSizes: sourceSizes.value,
            },
            preview: {indicator: null, areaRect: hit.halfRect, entryRect: null, orientation: slice.orientation, count},
        },
    };
}

/**
 * 一批可见叶的主轴尺寸表：与命中判定同一份口径——零尺寸 / NaN / 不正面叶没有尺寸可言，跳过。
 * 表里只放**可见**成员：hidden 成员在归属上照搬，但不新造当前几何。
 */
function sizesAlong(orientation: GridOrientation, members: readonly GridDropMember[]): Record<string, number> {
    const horizontal = orientation === "horizontal";
    const sizes: Record<string, number> = {};
    for (const member of members) {
        if (!isGridDropRect(member.rect)) {
            continue;
        }
        sizes[member.id] = horizontal ? member.rect.right - member.rect.left : member.rect.bottom - member.rect.top;
    }
    return sizes;
}

/**
 * 来源比例，按三档取值，越靠前越接近屏幕上的事实：
 *
 * 1. **来源容器的内容几何**（`rects.sourceContent`）：真实主轴 px，覆盖了本次要搬的全部可见成员就用它
 *    （表里只留被搬的那几项：比例是拖入成员之间的比）；
 * 2. **展开尺寸意图**（`sizeIntents`）：内容停在 hidden parking / 未挂载的容器没有 client 矩形，但它的成员
 *    照样要能整组并入，此时按呈现层给的同一根源轴意图取比例；
 * 3. **单 View 的比例唯一**：一个可见成员的相对份额恒为 1，几何与意图都没有也不影响结果。
 *
 * 三档都拿不到某个要搬成员的尺寸时整条拒绝——半区并入要按来源比例分配另一半，缺一份都没有可提交的动作，
 * 也**不许**把这次落点降级成"追加进目标容器"。hidden 成员不进任何一张表：它们随归属迁移，不新造几何。
 */
function sourceSizesOf(
    input: WorkbenchDropInput,
    sourceSlice: WorkbenchDropContainer,
    draggedViewIds: readonly string[],
): Resolved<Readonly<Record<string, number>>> {
    if (draggedViewIds.length === 0) {
        // 要搬的可见成员一个都没有（例如整容器只剩 hidden 成员）：没有比例可算，也没有新几何要造。
        return {ok: true, value: {}};
    }
    const geometry = input.rects.sourceContent;
    if (geometry != null) {
        const content = contentGeometryOf(sourceSlice, geometry);
        if (!content.ok) {
            return content;
        }
        const measured = sizesAlong(sourceSlice.orientation, content.value.members);
        if (draggedViewIds.every((viewId) => Object.hasOwn(measured, viewId))) {
            return {ok: true, value: pickSizes(measured, draggedViewIds)};
        }
    }
    const intents = intentSizesOf(sourceSlice, draggedViewIds);
    if (intents !== null) {
        return {ok: true, value: intents};
    }
    if (draggedViewIds.length === 1) {
        return {ok: true, value: {[draggedViewIds[0]!]: 1}};
    }
    return {
        ok: false,
        decision: rejection(`来源容器 ${sourceSlice.containerId} 的可见成员 ${draggedViewIds.join("、")} 量不出尺寸（几何与尺寸意图都没有），来源比例不完整，拒绝这次并入`),
    };
}

/** 只留本次要搬的那几项：来源比例是**拖入成员之间**的比，没被拖走的兄弟份额不参与另一半的分配。 */
function pickSizes(sizes: Readonly<Record<string, number>>, viewIds: readonly string[]): Record<string, number> {
    const picked: Record<string, number> = {};
    for (const viewId of viewIds) {
        picked[viewId] = sizes[viewId]!;
    }
    return picked;
}

/** 展开尺寸意图里本次要搬的那几项：缺项或非正有限值一律当这一档没有（不混算两份来源）。 */
function intentSizesOf(
    sourceSlice: WorkbenchDropContainer,
    draggedViewIds: readonly string[],
): Record<string, number> | null {
    const intents = sourceSlice.sizeIntents;
    if (intents === undefined) {
        return null;
    }
    const sizes: Record<string, number> = {};
    for (const viewId of draggedViewIds) {
        const size = intents[viewId];
        if (size === undefined || !Number.isFinite(size) || size <= 0) {
            return null;
        }
        sizes[viewId] = size;
    }
    return sizes;
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

export function resolveWorkbenchDrop(input: WorkbenchDropInput): WorkbenchDropDecision {
    if (input.source.contextKey !== input.contextKey) {
        return rejection(`工作面已经从 ${input.source.contextKey} 切到 ${input.contextKey}，这次拖放不再有效`);
    }
    if (input.target.kind === "workbench-container-content-target") {
        return resolveContentDrop(input, input.target);
    }
    return input.target.kind === "workbench-part-empty-target"
        ? resolvePartEmptyDrop(input, input.target)
        : resolveSwitcherDrop(input, input.target);
}

// ── 容器内容区 ───────────────────────────────────────────────────────────────

function resolveContentDrop(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-container-content-target"},
): WorkbenchDropDecision {
    const geometry = input.rects.content;
    if (geometry == null) {
        // 量不出内容盒（零尺寸 / 未挂载）的目标按合同不可命中：没有落点可算，也不写记录。
        return noop();
    }
    const slice = input.presentation.container(target.containerId);
    if (slice === null) {
        return rejection(`内容落点容器 ${target.containerId} 当前不可呈现（未登记或已经被并入别处），拒绝这次拖放`);
    }
    if (slice.location !== target.location) {
        return rejection(`容器 ${target.containerId} 的落位已经从 ${target.location} 变成 ${slice.location}，内容落点过期，拒绝这次拖放`);
    }
    const content = contentGeometryOf(slice, geometry);
    if (!content.ok) {
        return content.decision;
    }
    return input.source.kind === "workbench-view"
        ? viewOntoContent(input, target, slice, content.value)
        : containerOntoContent(input, target, slice, content.value);
}
/**
 * 视图落到内容区：先复核源与跨容器权限，再用一次 `resolveGridInsertion` 求命中叶、侧向与半区反馈，
 * 最后把两张冻结尺寸表凑成 `move-view` 的 `split`——**一次** `moveView`，不追加、不换序第二遍。
 *
 * 源叶仍留在成员几何里，抓到的就是屏幕上那一片；非法方向与"命中叶就是自己"都只 `noop`（连预览都不给，
 * 因为这两种情况下没有任何东西会动）。
 */
function viewOntoContent(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-container-content-target"},
    slice: WorkbenchDropContainer,
    geometry: ContentGeometry,
): WorkbenchDropDecision {
    const source = input.source as WorkbenchDropSource & {kind: "workbench-view"};
    const sourceSlice = viewSourceSliceOf(input, source);
    if (!sourceSlice.ok) {
        return sourceSlice.decision;
    }
    if (source.containerId !== target.containerId) {
        // 权限先于几何：中央禁投也不该为一个不允许的落点背书。
        const allowed = viewTargetAllowed(sourceSlice.value, slice);
        if (allowed !== null) {
            return allowed;
        }
    }
    const remainder = collapsedRemainderOf(slice, geometry);
    const hit = remainder === null ? null : {kind: "remainder" as const, areaRect: remainder};
    const insertion = hit === null ? resolveGridInsertion({
        orientation: slice.orientation,
        point: input.point,
        containerRect: geometry.rect,
        members: geometry.members,
        edgeRatio: WORKBENCH_CONTENT_EDGE_RATIO,
    }) : null;
    if (hit === null && (insertion === null || insertion.kind === "keep")) {
        return noop();
    }
    const resolved = hit ?? edgeHitOf(insertion!);
    if (resolved === null) {
        return noop();
    }
    if (resolved.kind !== "remainder" && source.containerId === target.containerId && resolved.targetViewId === source.viewId) {
        return noop();
    }
    const half = halfSplitOf({input, slice, geometry, hit: resolved, sourceSlice: sourceSlice.value, draggedViewIds: [source.viewId], count: 1});
    if (!half.ok) {
        return half.decision;
    }
    const request: ViewMoveRequest = {
        viewId: source.viewId,
        sourceContainerId: source.containerId,
        targetContainerId: target.containerId,
        split: half.value.split,
    };
    return {kind: "move-view", request, preview: half.value.preview};
}

/**
 * 容器整组落到内容区：**一次** `merge-container`，携带冻结的全部成员快照（含 hidden / collapsed）与半区
 * `split`（命中叶留一半，另一半按来源可见成员的比例分给搬进来的 View）。源容器与目标相同时是原位 noop：
 * 整容器不能落进自己。
 */
function containerOntoContent(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-container-content-target"},
    slice: WorkbenchDropContainer,
    geometry: ContentGeometry,
): WorkbenchDropDecision {
    const source = input.source as WorkbenchDropSource & {kind: "workbench-container"};
    const sourceSlice = containerSourceSliceOf(input, source);
    if (!sourceSlice.ok) {
        return sourceSlice.decision;
    }
    if (source.containerId === target.containerId) {
        return noop();
    }
    const frozen = sourceSlice.value.memberViewIds;
    if (frozen.length !== source.viewIds.length || !frozen.every((id, index) => id === source.viewIds[index])) {
        return rejection(
            `容器 ${source.containerId} 的成员在拖动期间已经变化（拖动时 ${source.viewIds.length} 个，现在 ${frozen.length} 个），拒绝整组并入`,
        );
    }
    if (frozen.length === 0) {
        return noop();
    }
    const remainder = collapsedRemainderOf(slice, geometry);
    const hit = remainder === null ? null : {kind: "remainder" as const, areaRect: remainder};
    const insertion = hit === null ? resolveGridInsertion({
        orientation: slice.orientation,
        point: input.point,
        containerRect: geometry.rect,
        members: geometry.members,
        edgeRatio: WORKBENCH_CONTENT_EDGE_RATIO,
    }) : null;
    if (hit === null && (insertion === null || insertion.kind === "keep")) {
        return noop();
    }
    const resolved = hit ?? edgeHitOf(insertion!);
    if (resolved === null) {
        return noop();
    }
    // 整组搬的就是这个容器的**全部可见成员**（hidden 只随归属迁移）：来源比例要覆盖它们每一个。
    const half = halfSplitOf({
        input,
        slice,
        geometry,
        hit: resolved,
        sourceSlice: sourceSlice.value,
        draggedViewIds: sourceSlice.value.views.map((entry) => entry.view.id),
        count: frozen.length,
    });
    if (!half.ok) {
        return half.decision;
    }
    const request: WorkbenchContainerMergeRequest = {
        sourceContainerId: source.containerId,
        sourceLocation: source.location,
        targetContainerId: target.containerId,
        targetLocation: target.location,
        sourceViewIds: source.viewIds,
        contextKey: input.contextKey,
        split: half.value.split,
    };
    return {kind: "merge-container", request, preview: half.value.preview};
}

// ── 空 Part ──────────────────────────────────────────────────────────────────

/**
 * 空 Part 的整个内容区：只有一个落点，反馈就是这个区域本身。
 *
 * 入口条件由**呈现**给出：`part.containers.length === 0`。一旦有了容器，这个落点就失效并拒绝——
 * 那说明命中的几何是过期的那一份，绝不把它当成"追加到第一个容器"。
 */
function resolvePartEmptyDrop(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-part-empty-target"},
): WorkbenchDropDecision {
    if (toolPartOfLocation(target.location) !== target.partId) {
        return rejection(`空内容落位 ${target.location} 不属于 Part ${target.partId}，拒绝这次拖放`);
    }
    const rect = validRectOrNull(input.rects.empty);
    if (rect === null) {
        // 整个区域量不出来（未挂载 / 零尺寸）：没有可承诺的落点，也不写记录。
        return noop();
    }
    const part = input.presentation.part(target.partId);
    if (part === null) {
        return rejection(`Part ${target.partId} 当前没有呈现切片，拒绝这次拖放`);
    }
    if (part.containers.length !== 0) {
        return rejection(`Part ${target.partId} 已经有 ${part.containers.length} 个容器，空内容落点已经失效，拒绝这次拖放`);
    }
    const preview: WorkbenchDropPreview = {
        indicator: null,
        areaRect: rect,
        entryRect: null,
        orientation: containerOrientation(target.partId),
        count: 1,
    };
    if (input.source.kind === "workbench-view") {
        const sourceSlice = viewSourceSliceOf(input, input.source);
        if (!sourceSlice.ok) {
            return sourceSlice.decision;
        }
        // 视图 detach 成自己的容器并填满这个 Part：没有可插入的条目，落位就是全部信息。
        const request: ViewDetachRequest = {
            viewId: input.source.viewId,
            sourceContainerId: input.source.containerId,
            targetLocation: target.location,
            contextKey: input.contextKey,
        };
        return {kind: "detach-view", request, preview};
    }
    const sourceSlice = containerSourceSliceOf(input, input.source);
    if (!sourceSlice.ok) {
        return sourceSlice.decision;
    }
    // 空 Part 里没有任何容器，落位末尾就是唯一位置：不额外套一层，也不指定锚点。
    const request: ContainerMoveRequest = {
        containerId: input.source.containerId,
        sourceLocation: input.source.location,
        targetLocation: target.location,
    };
    return {kind: "move-container", request, preview};
}

// ── 切换器 ───────────────────────────────────────────────────────────────────

/**
 * 声明的条目命中复核：调用方说"指针在这个容器条目上"（`viewContainerId`），这里只复核这句话还成不成立——
 * 条目仍在几何里、矩形有效、指针落在「条目 ∩ 条目带」的可见交集内（被裁掉或浮层盖住的条目因此复核不过）。
 *
 * 任一条不成立都拒绝：声明的落点已经失效，绝不退回成"条目带空白追加"（那会把新容器停在用户没指的插入位上）。
 * 复核通过也不改变锚点：插入位永远来自同一份列表几何（`resolveListInsertion`），悬停哪个条目从不决定归属。
 */
function declaredEntryFailure(
    point: GridDropPoint,
    declared: string | undefined,
    rects: WorkbenchDropSwitcherRects,
    band: GridDropRect,
): WorkbenchDropDecision | null {
    if (declared === undefined) {
        return null;
    }
    const entry = rects.entries.find((candidate) => candidate.containerId === declared);
    if (entry === undefined) {
        return rejection(`切换器里已经找不到条目 ${declared}，声明的落点已失效，拒绝这次拖放`);
    }
    const rect = validRectOrNull(entry.rect);
    const visible = rect === null ? null : intersectRect(rect, band);
    return rect === null || visible === null || !rectContainsPoint(visible, point)
        ? rejection(`指针不在条目 ${declared} 与条目带的可见交集内，声明的落点已失效，拒绝这次拖放`)
        : null;
}

/**
 * 切换器落点：两种源共用同一份共享列表几何 `resolveListInsertion({edgeGap: 4})`——条目是列表成员，
 * 锚点（`beforeId`）与插入线同出这一次求值。视图与容器在同一个插入位上只有动作不同：
 * 视图 detach 成新容器，容器整体换序/迁移。
 *
 * 预览只有那一条插入线：条目高亮按新合同删除，`entryRect` 始终 `null`。声明的锚点与几何不一致时拒绝，
 * 未知落位与空量不出来的条目带一律不给落点——都不猜、都不降级成追加。
 */
function resolveSwitcherDrop(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-switcher-target"},
): WorkbenchDropDecision {
    if (toolPartOfLocation(target.location) !== target.partId) {
        return rejection(`切换器落位 ${target.location} 不属于 Part ${target.partId}，拒绝这次拖放`);
    }
    const rects = input.rects.switcher;
    if (rects == null) {
        return noop();
    }
    const part = input.presentation.part(target.partId);
    if (part === null) {
        return rejection(`Part ${target.partId} 当前没有呈现切片，拒绝这次拖放`);
    }
    const band = validRectOrNull(rects.rect);
    if (band === null) {
        // 条目带量不出来（零尺寸 / 被裁掉 / 未挂载）：没有可画的插入位，不提交。
        return noop();
    }
    if (rects.entries.length === 0 && part.containers.some((entry) => entry.location === target.location)) {
        return noop();
    }
    const insertion = resolveListInsertion({
        orientation: rects.orientation,
        point: input.point,
        containerRect: band,
        members: rects.entries.map((entry) => ({id: entry.containerId, rect: entry.rect})),
        edgeGap: 4,
    });
    if (insertion === null) {
        // 条目带里没有一个可用条目、或指针不在带里：同样没有落点。
        return noop();
    }
    const anchor = insertion.beforeId ?? undefined;
    if (target.beforeContainerId !== undefined && target.beforeContainerId !== anchor) {
        return rejection(`目标声明的锚点容器 ${target.beforeContainerId} 与几何求出的 ${anchor ?? "末尾追加"} 不一致，拒绝这次拖放`);
    }
    if (anchor !== undefined && !part.containers.some((entry) => entry.containerId === anchor)) {
        return rejection(`锚点容器 ${anchor} 不在 ${target.location} 的容器序列里，拒绝这次拖放`);
    }
    const declaredFailure = declaredEntryFailure(input.point, target.viewContainerId, rects, band);
    if (declaredFailure !== null) {
        return declaredFailure;
    }
    const preview: WorkbenchDropPreview = {
        indicator: insertion.indicator,
        areaRect: null,
        entryRect: null,
        orientation: rects.orientation,
        count: 1,
    };
    return input.source.kind === "workbench-view"
        ? viewOntoSwitcher(input, target, anchor, preview)
        : containerOntoSwitcher(input, target, part, anchor, preview);
}

/**
 * 视图落切换器：在该插入位**创建一个新容器**并把这个 View 移进去（`detach-view`），不并入任何现有容器。
 *
 * 源容器实际成员归零时由记录层与同一次移动一起收掉；这里不做顺序 noop——"已经是末尾"不再是"不产生变更"，
 * 新建容器与 Tab 本身就是变更。不可移动的容器照样能当这个插入位的锚点：它不参与换序。
 */
function viewOntoSwitcher(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-switcher-target"},
    anchor: string | undefined,
    preview: WorkbenchDropPreview,
): WorkbenchDropDecision {
    const source = input.source as WorkbenchDropSource & {kind: "workbench-view"};
    const sourceSlice = viewSourceSliceOf(input, source);
    if (!sourceSlice.ok) {
        return sourceSlice.decision;
    }
    const request: ViewDetachRequest = {
        viewId: source.viewId,
        sourceContainerId: source.containerId,
        targetLocation: target.location,
        contextKey: input.contextKey,
        ...(anchor === undefined ? {} : {beforeContainerId: anchor}),
    };
    return {kind: "detach-view", request, preview};
}

/**
 * 容器落切换器：按切换器顺序移动/重排整个容器。锚点与插入线同出一次共享求值；落自己条目前的插入位、
 * 以及去掉自己后序位不变，都返回带插入线的 noop（反馈照画，释放不提交）。
 */
function containerOntoSwitcher(
    input: WorkbenchDropInput,
    target: WorkbenchDropTarget & {kind: "workbench-switcher-target"},
    part: WorkbenchDropPart,
    anchor: string | undefined,
    preview: WorkbenchDropPreview,
): WorkbenchDropDecision {
    const source = input.source as WorkbenchDropSource & {kind: "workbench-container"};
    const sourceSlice = containerSourceSliceOf(input, source);
    if (!sourceSlice.ok) {
        return sourceSlice.decision;
    }
    if (anchor === source.containerId) {
        // 拖到自己条目前的那个插入位：顺序不会变，但原位线照画，释放不写记录。
        return noop(preview);
    }
    if (anchor !== undefined) {
        const anchorSlice = input.presentation.container(anchor);
        if (anchorSlice === null) {
            return rejection(`锚点容器 ${anchor} 当前不可呈现（未登记或已经被并入别处），拒绝这次拖放`);
        }
        if (anchorSlice.location !== target.location) {
            return rejection(`锚点容器 ${anchor} 不在 ${target.location}，拒绝这次拖放`);
        }
        if (!anchorSlice.canMoveContainer) {
            return rejection(`锚点容器 ${anchor} 声明不可移动，不能作为容器重排的锚点，拒绝这次拖放`);
        }
    }
    if (source.location === target.location) {
        const order = part.containers.filter((entry) => entry.location === target.location).map((entry) => entry.containerId);
        const others = order.filter((containerId) => containerId !== source.containerId);
        const at = anchor === undefined ? others.length : others.indexOf(anchor);
        if (order.indexOf(source.containerId) === at) {
            // 顺序本来就不变（例如从末位拖到带尾）：同样是带线不提交。
            return noop(preview);
        }
    }
    const request: ContainerMoveRequest = {
        containerId: source.containerId,
        sourceLocation: source.location,
        targetLocation: target.location,
        ...(anchor === undefined ? {} : {beforeContainerId: anchor}),
    };
    return {kind: "move-container", request, preview};
}
