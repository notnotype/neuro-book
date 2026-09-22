/**
 * 工作台标题的拖动源：容器标签 / 容器标题 / View 的 Section 标题**整块**都是拖动面。
 *
 * 这里只做三件事，别的都在别处：
 * - **登记拖动源**：`useDraggable` 的 `element` 与 `handle` 都指向调用方给的标题元素，`id` 用每实例
 *   稳定的 `useId()`——拿 viewId / containerId 拼 id 会让注册表留下删不掉的死条目（见
 *   `WorkbenchViewSection.md` 的实现注记）；
 * - **载荷在开始时捕获**：拖动一旦激活就把当次的载荷冻结进 `data`，松手时交给页面的 `drag-end`
 *   门禁（命令层）。拖动途中 props 变化不改这次拖动的含义，而**没有**拖动时 `data` 仍是当前事实；
 * - **激活门槛与交互排除**：鼠标 / 笔移动 6 CSS px、触摸按住 200ms（容差 6px）才激活；标题里的动作组、
 *   菜单、表单控件、链接、contenteditable 与 `data-no-drag` 区域不参与拖动，而**标题自身的按钮**
 *   （Section 折叠、容器标签）仍然可拖——整标题拖动正是本次合同本身。
 *
 * 拖动中的**观感**不在这里：源标题保持原位（不降不透明度、不位移、不生成占位副本），跟着指针走的是
 * 页面唯一的 `WorkbenchDragOverlay`；`isDragging` 只报告这一份拖动源的状态。
 *
 * 手势求解器在 dnd-kit 里：本文件没有落点判定、没有指针跟踪、不读存储、不认识命令。
 */
import {computed, ref, shallowRef, useId, watch, type ComputedRef, type Ref} from "vue";
import {PointerActivationConstraints, PointerSensor} from "@dnd-kit/dom";
import type {ActivationConstraints} from "@dnd-kit/abstract";
import {useDraggable} from "@dnd-kit/vue";
import type {ToolPartId, ToolPartLocation} from "nbook/app/utils/workbench/view-placements";

/** 拖的是什么。`kind` 同时是 dnd-kit 的拖动源 type，落点按它过滤。 */
export type WorkbenchDragKind = "view" | "container";

/**
 * 标题的拖动载荷：`kind: "view"` 的是 View，`kind: "container"` 的是整个容器。
 *
 * 两种载荷都带**开始拖动时冻结的工作面代际**：落点判定与记录层用它拒绝过期意图，
 * 而不是拿当前页面状态猜「这是不是同一面」。
 */
export type WorkbenchViewDragPayload = {
    readonly kind: "workbench-view";
    readonly viewId: string;
    readonly containerId: string;
    readonly location: ToolPartLocation;
    readonly contextKey: string;
};

export type WorkbenchContainerDragPayload = {
    readonly kind: "workbench-container";
    readonly containerId: string;
    readonly location: ToolPartLocation;
    /**
     * 源容器**全部已登记生效成员**（含 hidden 与 collapsed）的有序快照：整组并入按它搬，
     * 只带可见成员会让 hidden 的 View 掉在源容器里。空容器拖动的快照是空数组。
     */
    readonly viewIds: readonly string[];
    readonly contextKey: string;
};

export type WorkbenchDragPayload = WorkbenchViewDragPayload | WorkbenchContainerDragPayload;

/** dnd-kit 的拖动源 / 落点 type：落点的 `accept` 与它同源，不各写一份字面量。 */
export const WORKBENCH_VIEW_DRAG_TYPE = "workbench-view";
export const WORKBENCH_CONTAINER_DRAG_TYPE = "workbench-container";
/** 切换器落点：条目标签 / 条目带空白 / 空 Part 的空位。 */
export const WORKBENCH_SWITCHER_TARGET_TYPE = "workbench-switcher-target";
/** 容器内容落点：一个容器只有一个，插入位由几何求值决定。 */
export const WORKBENCH_CONTENT_TARGET_TYPE = "workbench-container-content-target";
/** 没有容器的 Part 内容区，接收 View 或整个容器。 */
export const WORKBENCH_EMPTY_TARGET_TYPE = "workbench-part-empty-target";

/** 鼠标 / 笔的激活距离（CSS px）。 */
export const WORKBENCH_DRAG_DISTANCE_PX = 6;
/** 触摸的按住时长（ms）与容差（CSS px）：触摸要能滚动内容，不能一碰就起拖。 */
export const WORKBENCH_DRAG_TOUCH_DELAY_MS = 200;
export const WORKBENCH_DRAG_TOUCH_TOLERANCE_PX = 6;

/**
 * 不参与拖动的区域：标题里的动作组、菜单浮层、表单控件、链接与可编辑区。
 *
 * **不含泛化的 `button` / `[role="button"]`**：Section 的标题按钮与容器标签本身就是标题的按钮，
 * 按下去的应当是拖动；把它们按标签名一律排除会让整标题拖动在最常见的落点上失效。要排除一个按钮，
 * 把它放进 `data-no-drag` 区域（动作组就是这么做的）。
 */
const BLOCKING_SELECTOR = [
    "[data-no-drag]",
    "input",
    "select",
    "textarea",
    "a[href]",
    "[contenteditable]:not([contenteditable=\"false\"])",
    "[role=\"menu\"]",
    "[role=\"menuitem\"]",
    "[role=\"menuitemcheckbox\"]",
    "[role=\"menuitemradio\"]",
    "[role=\"listbox\"]",
    "[role=\"option\"]",
    "[role=\"separator\"]",
].join(", ");

/** 这个事件目标是否属于「交互子节点」：是则这次按下不启动拖动。 */
export function workbenchDragBlocksTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(BLOCKING_SELECTOR) !== null;
}

/**
 * 工作台的指针传感器：只接主键（由 dnd-kit 判定），鼠标 / 笔按距离、触摸按延迟激活。
 *
 * 逐个拖动源自带这份配置（`useDraggable({sensors})`），因此不管页面配了什么传感器，
 * 标题的激活门槛都是同一套。
 */
/** 激活门槛（提供者级与拖动源级共用同一份）：鼠标 / 笔按距离、触摸按延迟。 */
export const workbenchActivationConstraints = (event: PointerEvent): ActivationConstraints<PointerEvent> => event.pointerType === "touch"
    ? [new PointerActivationConstraints.Delay({value: WORKBENCH_DRAG_TOUCH_DELAY_MS, tolerance: WORKBENCH_DRAG_TOUCH_TOLERANCE_PX})]
    : [new PointerActivationConstraints.Distance({value: WORKBENCH_DRAG_DISTANCE_PX})];

export const workbenchDragSensor = PointerSensor.configure({
    activationConstraints: workbenchActivationConstraints,
    preventActivation: (event) => workbenchDragBlocksTarget(event.target),
});

export type WorkbenchDragHandle = {
    /** 绑到标题元素上的模板 ref：它同时是拖动源与激活元素。 */
    element: Ref<HTMLElement | null>;
    /** 这一份拖动源是否正在被拖：拖动中的观感归页面唯一的 `WorkbenchDragOverlay`，这里只报告状态。 */
    isDragging: ComputedRef<boolean>;
    /** 挂到标题的 `@click.capture`：拖动激活后抑制同一次手势末尾的 click。 */
    suppressClick: (event: MouseEvent) => void;
    /** 挂到标题的 `@pointerdown.capture`：新的按下序列重置抑制位。 */
    resetSuppression: () => void;
};

/**
 * 登记一个「整标题」拖动源。
 *
 * @param input.kind 拖的是 View（`workbench-view`）还是整个容器（`workbench-container`）。
 * @param input.payload 当前载荷；拖动开始时取一次冻结，没有拖动时作为 dnd-kit 的事实。
 * @param input.disabled 不可移动时为真：拖动源不登记（不出现「按住有反馈但落不下去」）。
 */
export function useWorkbenchDrag(input: {
    kind: WorkbenchDragKind;
    payload: () => WorkbenchDragPayload;
    disabled?: () => boolean;
}): WorkbenchDragHandle {
    const element = ref<HTMLElement | null>(null);
    const captured = shallowRef<WorkbenchDragPayload | null>(null);
    const suppress = ref(false);
    const dragId = `workbench-drag:${input.kind}:${useId()}`;

    const {isDragging} = useDraggable({
        id: dragId,
        type: input.kind === "view" ? WORKBENCH_VIEW_DRAG_TYPE : WORKBENCH_CONTAINER_DRAG_TYPE,
        data: computed<WorkbenchDragPayload>(() => captured.value ?? input.payload()),
        element,
        // 激活元素就是元素本身：宿主按 `source.handle ?? source.element` 决定监听谁，
        // 只给 `element` 会让按钮上的那一下被判成「按在交互元素上」而拒绝激活。
        handle: element,
        disabled: computed(() => input.disabled?.() === true),
    });

    watch(isDragging, (dragging) => {
        if (!dragging) {
            // 拖动结束清掉冻结载荷：否则**下一场**拖动在 drag-start 的同步路径上会读到上一场的那个人/那个容器
            // （dnd-kit 同步派发 dragstart，Vue 的 watch 回调晚一个微任务，来不及覆盖它）。
            captured.value = null;
            return;
        }
        suppress.value = true;
    });

    function suppressClick(event: MouseEvent): void {
        if (!suppress.value) {
            return;
        }
        suppress.value = false;
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * 挂到标题的 `@pointerdown.capture`：新的按下序列重置抑制位，并**同步**冻结本场载荷。
     *
     * 冻结必须发生在按下这一拍：拖动传感器的激活判定晚于按下（鼠标 6px / 触摸 200ms），
     * 等 `isDragging` 变化再取载荷时，dnd-kit 已经用 `data` 开了那一场。
     */
    function resetSuppression(): void {
        suppress.value = false;
        captured.value = input.payload();
    }

    return {
        element,
        isDragging: computed(() => isDragging.value === true),
        suppressClick,
        resetSuppression,
    };
}

/**
 * 落点 id：同一页面上条目、条目带空白、空 Part、容器内容互不重名。
 *
 * id 只服务调试与 dnd-kit 的唯一性；判定读的是 `data`（见下面的两类载荷），不靠解析 id。
 */
export function workbenchSwitcherTargetId(scope: string): string {
    return `workbench-switcher-target:${scope}`;
}

/** 容器内容落点 id：一个容器只有一个内容目标。 */
export function workbenchContentTargetId(containerId: string): string {
    return `workbench-container-content-target:${containerId}`;
}

/**
 * 切换器的作用域：一个 Part 可能有不止一个切换器（左栏的头部标题、主活动栏的容器入口），
 * 几何按它登记，落点数据带上它是哪一个——判定因此永远用命中那个切换器的尺子。
 */
export type WorkbenchSwitcherKind = "head" | "activity";

export function workbenchSwitcherScope(partId: ToolPartId, kind: WorkbenchSwitcherKind): string {
    return `${partId}:${kind}`;
}

/** 切换器落点的载荷：条目标签 / 条目带空白 / 空 Part 空位共用一种形状，页面只写一条分支。 */
export type WorkbenchSwitcherDropData = {
    readonly kind: "workbench-switcher-target";
    readonly partId: ToolPartId;
    readonly location: ToolPartLocation;
    /** 命中哪个切换器（几何登记键）；同一 Part 有多个切换器时靠它区分。 */
    readonly switcherScope: string;
    /** 命中某个容器条目时是它的容器 id；条目带空白与空 Part 空位缺席。 */
    readonly viewContainerId?: string;
    /** DOM 层已经算出的容器插入锚点；缺省让几何求值决定（内容区不用它）。 */
    readonly beforeContainerId?: string;
};

/** 容器内容落点的载荷：命中容器内容区（含空态与收起竖条）。 */
export type WorkbenchContentDropData = {
    readonly kind: "workbench-container-content-target";
    readonly containerId: string;
    readonly location: ToolPartLocation;
};

export type WorkbenchEmptyDropData = {
    readonly kind: "workbench-part-empty-target";
    readonly partId: ToolPartId;
    readonly location: ToolPartLocation;
};

/** 页面在 `drag-end` 上读到的落点载荷：两类落点的联合。 */
export type WorkbenchDropData = WorkbenchSwitcherDropData | WorkbenchContentDropData | WorkbenchEmptyDropData;

