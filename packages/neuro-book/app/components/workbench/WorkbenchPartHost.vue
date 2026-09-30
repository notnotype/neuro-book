<script setup lang="ts">
/**
 * 工作台一个 Part 的宿主：容器选择器 + Part 落点 + 容器挂载目标 + **single 的 View 动作上提**。
 *
 * 一个 Part 只显示**一个活动容器**，所以本组件的几件事是一条链：
 * - **选择**：Panel 与右栏用标签带（只有一个容器也保留，容器标签本身是容器拖动源与落点），
 *   主侧栏（left）**不画**第二套标签带——那里由 Activity Bar 的主入口组选容器，Part 头只显示
 *   当前容器的可拖标题（不用容器数量推断要不要画 tab）；
 * - **落点**：Panel/右栏的标签带与左栏活动栏接收容器插入；空 Part 的正文接收 View/容器。
 *   主侧栏标题与动作区不接收投递。预览与提交复用同一份切换器几何。
 * - **挂载**：活动容器有一个挂载目标，容器实例层把它的 ViewHost Teleport 进来；非活动容器停在实例层的
 *   parking，不销毁也不留在旧元素里；
 * - **single 的动作上提**：容器只有一个可见 View 时，Section 标题不渲染（见 `WorkbenchViewSection`），
 *   那个 View 的贡献动作与「移动到」入口由这里投射到容器右上角，排列是
 *   View 贡献 → 容器管理 → Part 框架。动作仍是 **View** 的命令：回传同一个
 *   `{scope:"view", target:{viewId,generation}}`（沿用既有执行闸门，不复制 handler）。
 *
 * 容器标题动作（移动到其它落位 / 恢复默认位置）也在这里装配：移动子菜单由切片的
 * `containerMoveTargets` 生成，其它动作由页面以已求值项传入（组件不认识命令）。
 */
import {computed, inject, onBeforeUnmount, onMounted, ref} from "vue";
import {ContextMenu, IconButton, type ContextMenuItem} from "@notnotype/nb-ui/components";
import {CollisionPriority} from "@dnd-kit/abstract";
import {useDroppable} from "@dnd-kit/vue";
import type {GridDropRect, GridOrientation} from "@notnotype/nb-ui/layout";
import WorkbenchContainerTab from "nbook/app/components/workbench/WorkbenchContainerTab.vue";
import WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import {VIEW_MOVE_ITEM_PREFIX, viewMoveSubmenu} from "nbook/app/components/workbench/WorkbenchViewSection.vue";
import {CONTAINER_TARGET_REGISTRY} from "nbook/app/components/workbench/WorkbenchContainerInstances.vue";
import {
    workbenchSwitcherScope,
    workbenchSwitcherTargetId,
    WORKBENCH_CONTAINER_DRAG_TYPE,
    WORKBENCH_SWITCHER_TARGET_TYPE,
    WORKBENCH_VIEW_DRAG_TYPE,
    WORKBENCH_EMPTY_TARGET_TYPE,
    type WorkbenchEmptyDropData,
    type WorkbenchSwitcherDropData,
} from "nbook/app/composables/useWorkbenchDrag";
import {useWorkbenchDropGeometry} from "nbook/app/composables/useWorkbenchDrop";
import type {WorkbenchDropSwitcherRects} from "nbook/app/utils/workbench/workbench-drop";
import {readWorkbenchDropRect, workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";
import type {WorkbenchTitleActionItem} from "nbook/app/utils/workbench/view-title-actions";
import type {
    ContainerViewPresentation,
    PartContainerPresentation,
    WorkbenchViewEntry,
} from "nbook/app/utils/workbench/product-catalog";
import type {ContainerMoveRequest, ToolPartId, ToolPartLocation, ViewMoveRequest} from "nbook/app/utils/workbench/view-placements";
import {
    titleActionsSignature,
    type ViewActionTarget,
    type WorkbenchTitleActionEvent,
    type WorkbenchTitleActionItems,
    type WorkbenchTitleActionsByView,
} from "nbook/app/utils/workbench/view-title-actions";

/** 「移动到」子菜单的项 id 前缀：子项 id 自带目标落位，回传时按它反查切片里的落点（不猜字面量）。 */
const MOVE_ITEM_PREFIX = "move-container:";
/** 子菜单父项的 id 就是那条命令：父项只展开、不执行。 */
const MOVE_MENU_ITEM_ID = "nbook.view.move-container";

/** Part → 它的落位字面量：容器的落点数据要带上目标落位，页面据此交给 `moveContainer`。 */
const PART_TARGET_LOCATION: Record<ToolPartId, ToolPartLocation> = {
    left: "sidebar-left",
    right: "sidebar-right",
    panel: "panel",
};

const props = withDefaults(defineProps<{
    /** 本 Part 的容器切片（容器清单 + 活动容器 + 诊断）。 */
    presentation: PartContainerPresentation;
    /** Panel 的 32px 标题头收起偏好（只有 Panel Part 用它）。 */
    panelCollapsed?: boolean;
    /** 会话上下文代际：容器拖动载荷冻结它（与标题动作的 `actionsContextKey` 不是同一个值）。 */
    contextKey?: string;
    /** 标题动作菜单的失效指纹（面板状态 / 首 View / 模板 / 代际）。 */
    actionsContextKey?: string;
    /** 已求值的 View 标题动作（按 viewId 索引）：single 时把唯一 View 的动作上提到容器右上角。 */
    actionsByView?: WorkbenchTitleActionsByView;
    /** 上提的 View 动作组的无障碍名称（i18n 归页面）。 */
    viewActionsLabel?: string;
    /** 上提的「移动到」子菜单的可达名称；缺省用内置中文兜底（页面给了 i18n 名称就覆盖）。 */
    moveViewLabel?: string;
    /** 已求值的框架层标题动作（位置 / 对齐 / 收起 / 最大化 / 隐藏）。 */
    panelActions?: WorkbenchTitleActionItems;
    /** 框架动作的无障碍名称。 */
    panelActionsLabel?: string;
    /** Panel 收起按钮的可达名称。 */
    panelCollapseLabel?: string;
    /** 已求值的容器动作（恢复默认位置一类）；移动子菜单由本组件按切片补上。 */
    containerActions?: WorkbenchTitleActionItems;
    /** 容器动作的无障碍名称。 */
    containerActionsLabel?: string;
    /** 「移动到」子菜单的可达名称（i18n 归页面）。 */
    moveContainerLabel?: string;
    /** 是否允许移动容器（拖动源与落点共用这一条）。 */
    allowContainerMove?: boolean;
    /** 是否允许把 View 落到本 Part 的活动容器。 */
    allowViewMove?: boolean;
    /** 没有任何容器时的空态说明。 */
    emptyText?: string;
}>(), {
    panelCollapsed: false,
    contextKey: "",
    actionsContextKey: "",
    actionsByView: () => ({}),
    viewActionsLabel: "",
    moveViewLabel: "移动到",
    panelActions: () => ({primary: [], secondary: []}),
    panelActionsLabel: "",
    panelCollapseLabel: "",
    containerActions: () => ({primary: [], secondary: []}),
    containerActionsLabel: "",
    moveContainerLabel: "",
    allowContainerMove: false,
    allowViewMove: false,
    emptyText: "将视图拖动到此处显示",
});

const emit = defineEmits<{
    (e: "select-container", containerId: string): void;
    (e: "move-container", request: ContainerMoveRequest): void;
    (e: "move-view", request: ViewMoveRequest): void;
    (e: "title-action", payload: WorkbenchTitleActionEvent): void;
    (e: "panel-collapse", payload: {collapsed: boolean}): void;
}>();

const registry = inject(CONTAINER_TARGET_REGISTRY, null);
const partId = computed(() => props.presentation.partId);
const containers = computed(() => props.presentation.containers);
const activeContainer = computed<ContainerViewPresentation | null>(() => props.presentation.containers
    .find((candidate) => candidate.containerId === props.presentation.activeContainerId) ?? null);
const problems = computed(() => props.presentation.problems);
const isPanel = computed(() => partId.value === "panel");

/**
 * 选择器的形态：Panel 与右栏用标签带（只有一个容器也保留，容器标签本身还是拖动源与落点）；
 * 主侧栏（left）用可拖标题——那里由 Activity Bar 的主入口组切换容器，不再按容器数量决定要不要画第二套 tab。
 */
const showTabs = computed(() => partId.value !== "left");
const isEmptyPart = computed(() => containers.value.length === 0);
/** 标题不接收投递；只有 Panel/right 的标签条目带接收。 */
const acceptedSources = computed(() => [
    ...(props.allowContainerMove ? [WORKBENCH_CONTAINER_DRAG_TYPE] : []),
    ...(props.allowViewMove ? [WORKBENCH_VIEW_DRAG_TYPE] : []),
]);
const headAccept = computed(() => showTabs.value ? acceptedSources.value : []);

/** 实例通道缺失的诊断：Part 宿主必须在 `WorkbenchContainerInstances` 的子树里渲染。 */
const missingInstanceChannel = computed(() => registry === null);

// ── 挂载目标 ─────────────────────────────────────────────────────────────────

/** 本 Part 已登记的挂载目标：按 containerId 记，反登记比对元素身份。 */
const mountTargets = new Map<string, HTMLElement>();
/** `v-for` 用的单元素清单：闭包因此绑定当次的 containerId 与元素成对出现。 */
const activeMounts = computed(() => activeContainer.value === null ? [] : [activeContainer.value]);

function setMountTarget(containerId: string, element: unknown): void {
    const previous = mountTargets.get(containerId);
    if (element instanceof HTMLElement) {
        mountTargets.set(containerId, element);
        registry?.register(containerId, element);
        return;
    }
    mountTargets.delete(containerId);
    if (previous !== undefined) {
        registry?.unregister(containerId, previous);
    }
}

// ── 落点 ─────────────────────────────────────────────────────────────────────

const dropGeometry = useWorkbenchDropGeometry();
const headRef = ref<HTMLElement | null>(null);
const selectorRef = ref<HTMLElement | null>(null);
const emptyRef = ref<HTMLElement | null>(null);
let unregisterEmpty: (() => void) | null = null;
/** Panel/right 标签带作用域；主侧栏由活动栏提供。 */
const switcherScope = computed(() => workbenchSwitcherScope(partId.value, "head"));
let unregisterSwitcher: (() => void) | null = null;

/** 判定只覆盖标签带；标签矩形仍只取实际条目，空白落在最后一个条目标记之后。 */
const switcherGeometryRead = (): WorkbenchDropSwitcherRects | null => {
    const host = selectorRef.value;
    if (host === null || !showTabs.value) return null;
    const tabs = new Map<string, Element>();
    for (const element of host.querySelectorAll("[data-container-tab]")) {
        const containerId = element.getAttribute("data-container-tab");
        if (containerId !== null && !tabs.has(containerId)) {
            tabs.set(containerId, element);
        }
    }
    const band = readWorkbenchDropRect(host);
    if (band === null) return null;
    const entries: {containerId: string; rect: GridDropRect}[] = [];
    for (const container of containers.value) {
        const element = tabs.get(container.containerId);
        if (element === undefined) {
            continue;
        }
        const rect = readWorkbenchDropRect(element);
        if (rect === null) {
            continue;
        }
        entries.push({containerId: container.containerId, rect});
    }
    return {
        // 头部的容器单元一律横向排（标签带与单容器标题都是横排）。
        orientation: "horizontal" as GridOrientation,
        rect: band,
        entries,
    };
};

onMounted(() => {
    if (dropGeometry !== null) {
        unregisterSwitcher = dropGeometry.registerSwitcher(switcherScope.value, switcherGeometryRead);
        unregisterEmpty = dropGeometry.registerEmpty(partId.value, () => isEmptyPart.value ? readWorkbenchDropRect(emptyRef.value) : null);
    }
});
onBeforeUnmount(() => {
    unregisterSwitcher?.();
    unregisterEmpty?.();
});

/** 标签带与空正文分别登记，标题/动作从来不是投递目标。 */
useDroppable<WorkbenchSwitcherDropData>({
    id: computed(() => workbenchSwitcherTargetId(switcherScope.value)),
    type: WORKBENCH_SWITCHER_TARGET_TYPE,
    /**
     * 落点按**拖动源类型**分别收口：两个门压成一个总开关时，只开一门也会被另一种源命中
     * （判定层只校验源一侧的权限，不会替目标复核类型）。
     */
    accept: headAccept,
    data: computed<WorkbenchSwitcherDropData>(() => ({
        kind: "workbench-switcher-target",
        partId: partId.value,
        location: PART_TARGET_LOCATION[partId.value],
        switcherScope: switcherScope.value,
    })),
    /** 条目带是最粗的一档：精确条目（容器标签 / 活动栏条目）优先于它。 */
    collisionPriority: CollisionPriority.Low,
    element: headRef,
    disabled: computed(() => headAccept.value.length === 0),
});

useDroppable<WorkbenchEmptyDropData>({
    id: computed(() => `${WORKBENCH_EMPTY_TARGET_TYPE}:${partId.value}`),
    type: WORKBENCH_EMPTY_TARGET_TYPE,
    accept: acceptedSources,
    data: computed(() => ({kind: "workbench-part-empty-target", partId: partId.value, location: PART_TARGET_LOCATION[partId.value]})),
    collisionDetector: () => workbenchPointerCollision,
    collisionPriority: CollisionPriority.Low,
    element: emptyRef,
    disabled: computed(() => !isEmptyPart.value || acceptedSources.value.length === 0),
});


// ── 容器标题动作 ─────────────────────────────────────────────────────────────

/** 「移动到其它落位」子菜单：不可移动 / 没开移动 / 没有其它落位时整条不给。 */
const moveSubmenu = computed(() => {
    const container = activeContainer.value;
    if (!props.allowContainerMove || container === null || container.containerMoveTargets.length === 0) {
        return null;
    }
    return {
        id: MOVE_MENU_ITEM_ID,
        label: props.moveContainerLabel,
        icon: "i-lucide-corner-up-right",
        children: container.containerMoveTargets.map((target) => ({
            id: `${MOVE_ITEM_PREFIX}${target.location}`,
            label: target.title,
        })),
    };
});

/** 已求值的容器动作 + 本组件补上的移动子菜单；没有活动容器时整组不给。 */
const containerTitleActions = computed<WorkbenchTitleActionItems | null>(() => {
    if (activeContainer.value === null) {
        return null;
    }
    const move = moveSubmenu.value;
    return move === null
        ? props.containerActions
        : {...props.containerActions, secondary: [...props.containerActions.secondary, move]};
});

const containerActionsKey = computed(() => containerTitleActions.value === null
    ? ""
    : [
        props.actionsContextKey,
        "container",
        props.presentation.partId,
        activeContainer.value?.containerId ?? "",
        activeContainer.value?.mode ?? "",
        titleActionsSignature(containerTitleActions.value),
    ].join("|"));

function onContainerInvoke(actionId: string): void {
    const container = activeContainer.value;
    if (container === null) {
        return;
    }
    if (actionId.startsWith(MOVE_ITEM_PREFIX)) {
        const target = container.containerMoveTargets.find((candidate) => actionId === `${MOVE_ITEM_PREFIX}${candidate.location}`);
        if (target === undefined) {
            return;
        }
        emit("move-container", {
            containerId: container.containerId,
            sourceLocation: container.location,
            targetLocation: target.location,
        });
        return;
    }
    emit("title-action", {scope: "container", target: {containerId: container.containerId}, actionId});
}
const containerMenu = ref<Readonly<{x: number; y: number}> | null>(null);

function openContainerMenu(event: MouseEvent): void {
    if (containerTitleActions.value === null) {
        return;
    }
    event.preventDefault();
    containerMenu.value = {x: event.clientX, y: event.clientY};
}

function contextItemsOf(items: readonly WorkbenchTitleActionItem[]): ContextMenuItem[] {
    return items.map((item) => ({
        label: item.disabled === true && item.reason !== undefined ? `${item.label}（${item.reason}）` : item.label,
        iconClass: item.icon,
        disabled: item.disabled === true,
        ...(item.children === undefined ? {action: () => onContainerInvoke(item.id)} : {children: contextItemsOf(item.children)}),
    }));
}

const containerContextItems = computed(() => containerTitleActions.value === null
    ? []
    : contextItemsOf([...containerTitleActions.value.primary, ...containerTitleActions.value.secondary]));

// ── single 的 View 动作上提 ──────────────────────────────────────────────────

/**
 * 上提的动作属于容器里**唯一可见**的那个 View：`singleViewId` 由切片求值（本组件不自己数可见成员）。
 */
const singleView = computed<WorkbenchViewEntry | null>(() => {
    const container = activeContainer.value;
    if (container === null || container.singleViewId === null) {
        return null;
    }
    return container.views.find((entry) => entry.view.id === container.singleViewId) ?? null;
});

/** 执行闸门用的世代：与标题上那个 target 同源（`actionsByView`），取不到就不发 `title-action`。 */
const elevatedViewTarget = computed<ViewActionTarget | null>(() => {
    const entry = singleView.value;
    return entry === null ? null : props.actionsByView[entry.view.id]?.target ?? null;
});

/**
 * 上提的一组动作：View 贡献（primary 成按钮、secondary 进「更多」）+ 「移动到」子菜单
 * （移动是 View 自己的管理入口，仍然走 `move-view`）。
 *
 * 「可移动」两处同源：宿主没开移动或 View 声明不可移动时不出现这一条；贡献动作一个都没有、
 * 又不能移动时整组不给（不留空盒子）。
 */
const elevatedViewActions = computed<WorkbenchTitleActionItems | null>(() => {
    const entry = singleView.value;
    if (entry === null) {
        return null;
    }
    const resolved = props.actionsByView[entry.view.id] ?? null;
    const move = props.allowViewMove && entry.view.canMoveView === true
        ? viewMoveSubmenu({label: props.moveViewLabel, targets: activeContainer.value?.moveTargets ?? []})
        : null;
    if (resolved === null && move === null) {
        return null;
    }
    return {
        primary: resolved?.primary ?? [],
        secondary: [...(resolved?.secondary ?? []), ...(move === null ? [] : [move])],
    };
});

/** 上提动作菜单的失效指纹：工作面、Part、容器、模板、首 View 或代际一变就关掉旧菜单。 */
const viewActionsKey = computed(() => {
    const items = elevatedViewActions.value;
    const container = activeContainer.value;
    const target = elevatedViewTarget.value;
    return items === null || container === null
        ? ""
        : [
            props.actionsContextKey,
            "view",
            props.presentation.partId,
            container.containerId,
            container.mode,
            target === null ? "" : `${target.viewId}@${target.generation}`,
            titleActionsSignature(items),
        ].join("|");
});

function onElevatedViewInvoke(actionId: string): void {
    const entry = singleView.value;
    if (entry === null) {
        return;
    }
    if (actionId.startsWith(VIEW_MOVE_ITEM_PREFIX)) {
        emit("move-view", {
            viewId: entry.view.id,
            sourceContainerId: entry.containerId,
            targetContainerId: actionId.slice(VIEW_MOVE_ITEM_PREFIX.length),
        });
        return;
    }
    const target = elevatedViewTarget.value;
    if (target !== null) {
        emit("title-action", {scope: "view", target, actionId});
    }
}

/** 框架菜单的内容一变（进度 / 对齐 / 显隐 / 首 View）就关掉旧菜单，不让残留项继续指向旧状态。 */
const panelActionsKey = computed(() => [
    props.actionsContextKey,
    "panel",
    props.presentation.partId,
    activeContainer.value?.mode ?? "",
    titleActionsSignature(props.panelActions),
].join("|"));
</script>

<template>
    <div
        class="workbench-part"
        :data-workbench-part="partId"
        :data-part="partId"
    >
        <header
            v-if="showTabs || activeContainer?.mode !== 'multiple'"
            ref="headRef"
            class="workbench-part__head"
            :data-shell-focus-target="isPanel ? 'panel-title' : undefined"
            :data-part-switcher="partId"
            tabindex="-1"
        >
            <div v-if="showTabs" ref="selectorRef" class="workbench-part__selector" role="tablist" @contextmenu="openContainerMenu">
                <WorkbenchContainerTab
                    v-for="container in containers"
                    :key="container.containerId"
                    variant="tab"
                    :container="container"
                    :context-key="contextKey"
                    :active="container.containerId === presentation.activeContainerId"
                    :allow-container-move="allowContainerMove"
                    :allow-view-move="allowViewMove"
                    @select="(containerId: string) => emit('select-container', containerId)" />
            </div>
            <WorkbenchContainerTab
                v-else-if="activeContainer && activeContainer.mode !== 'multiple'"
                :key="activeContainer.containerId"
                class="workbench-part__title"
                variant="title"
                :container="activeContainer"
                :context-key="contextKey"
                :active="true"
                :allow-container-move="allowContainerMove"
                @contextmenu="openContainerMenu" />

            <div v-if="elevatedViewActions || isPanel" class="workbench-part__actions" data-no-drag>
                <!--
                  single 的 View 动作上提：容器里只有一个可见 View 时，它的 Section 标题不渲染，
                  贡献动作与「移动到」入口出现在容器右上角（排列：View 贡献 → 容器 → Part 框架）。
                  标记只声明这是 View 的动作组，不冒充内容的 `data-view-id`。
                -->
                <div
                    v-if="elevatedViewActions && singleView"
                    class="workbench-part__view-actions"
                    data-title-actions="view"
                    :data-action-view-id="singleView.view.id"
                    :data-action-generation="elevatedViewTarget?.generation"
                >
                    <WorkbenchTitleActions
                        scope="view"
                        :primary="elevatedViewActions.primary"
                        :secondary="elevatedViewActions.secondary"
                        :context-key="viewActionsKey"
                        :label="viewActionsLabel"
                        @invoke="onElevatedViewInvoke" />
                </div>



                <!-- 框架动作：空 Panel 也有。顺序是 更多 → 最大化/还原 → 隐藏（见 moreFirst）。 -->
                <WorkbenchTitleActions
                    v-if="isPanel"
                    scope="panel"
                    more-first
                    :primary="panelActions.primary"
                    :secondary="panelActions.secondary"
                    :context-key="panelActionsKey"
                    :label="panelActionsLabel"
                    @invoke="(actionId: string) => emit('title-action', {scope: 'panel', actionId})" />

                <!-- Panel 的收起按钮始终位于动作区最后。 -->
                <IconButton
                    v-if="isPanel"
                    data-panel-collapse-toggle
                    size="sm"
                    :icon-class="panelCollapsed ? 'i-lucide-chevrons-up-down' : 'i-lucide-chevrons-down-up'"
                    :title="panelCollapseLabel"
                    :aria-label="panelCollapseLabel"
                    :aria-expanded="!panelCollapsed"
                    @click="emit('panel-collapse', {collapsed: !panelCollapsed})" />
            </div>
        </header>
        <WorkbenchContainerTab
            v-if="!showTabs && activeContainer?.mode === 'multiple'"
            :key="activeContainer.containerId"
            class="workbench-part__drag-source"
            variant="title"
            :container="activeContainer"
            :context-key="contextKey"
            :active="true"
            :allow-container-move="allowContainerMove"
            @contextmenu="openContainerMenu" />
        <ContextMenu
            v-if="containerMenu"
            :visible="true"
            :x="containerMenu.x"
            :y="containerMenu.y"
            :items="containerContextItems"
            @close="containerMenu = null" />

        <p v-for="problem in problems" :key="problem" class="workbench-part__note" role="status">{{ problem }}</p>
        <p v-if="missingInstanceChannel" class="workbench-part__note" role="status" data-container-instance-channel="missing">
            容器实例层不在宿主上方：请把 Part 宿主渲染在 `WorkbenchContainerInstances` 的子树里，否则活动容器没有挂载目标。
        </p>

        <div class="workbench-part__body" :data-container-mounted="activeContainer?.containerId">
            <template v-for="container in activeMounts" :key="container.containerId">
                <div
                    class="workbench-part__mount"
                    :data-container-mount="container.containerId"
                    :ref="(element) => setMountTarget(container.containerId, element)"
                ></div>
            </template>

            <!-- 空态常驻，但只有实际无容器时接收投递。 -->
            <div
                ref="emptyRef"
                v-show="activeMounts.length === 0"
                class="workbench-part__empty"
                data-workbench-part-empty
            >
                <p class="workbench-part__empty-text">{{ emptyText }}</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Part 宿主：固定高度（由外壳叶决定），头部固定、内容吃满。 */
.workbench-part {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.workbench-part__head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    min-width: 0;
    height: var(--space-8);
    padding-inline: 0 var(--space-2);
}
.workbench-part__title {
    flex: 1 1 auto;
    min-width: 0;
}
.workbench-part__drag-source {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}
.workbench-part__head:focus {
    outline: none;
}

.workbench-part__selector {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-1);
    overflow-x: auto;
    min-height: 32px;
    min-width: 40px;
}

.workbench-part__empty-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    color: var(--text-muted);
}

/* 动作区只占图标内容宽度，并贴在标题行右侧。 */
.workbench-part__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-inline-start: auto;
    min-width: 0;
}

/* single 上提的 View 动作组：与容器/框架动作同一条基线，本身不参与折叠判定。 */
.workbench-part__view-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 0;
}

.workbench-part__note {
    flex: 0 0 auto;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--status-warning);
}

.workbench-part__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

/* 挂载目标吃满内容区：容器（ViewHost → 内部 Grid）在这里铺开。 */
.workbench-part__mount {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

.workbench-part__empty {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: var(--space-3);
    border: var(--border-w) dashed var(--divider);
    border-radius: var(--radius-panel);
}

.workbench-part__empty-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
    text-align: center;
}
</style>
