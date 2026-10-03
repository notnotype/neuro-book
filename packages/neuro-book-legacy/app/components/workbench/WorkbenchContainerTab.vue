<script setup lang="ts">
/**
 * 容器的**选择单元**：Panel / 右栏的标签带里的一项（`tab`），或主侧栏（left）头部的可拖标题（`title`）。
 *
 * 两种形态共用同一份通道，不各写一套：
 * - **拖动**：整块选择单元就是容器的拖动面（`data-workbench-drag-kind="container"`），载荷是
 *   「哪个容器、当时生效的落位」；鼠标 / 笔移动 6px、触摸按住 200ms 起拖。拖动中的观感由页面唯一的
 *   `WorkbenchDragOverlay` 承担：本条目保持原位，不降不透明度、不位移、也不生成占位副本。
 * - **插入落点**（仅 `tab`）：前/后半决定容器插入位；View 在该位置新建容器，容器整体换序或跨区移动。
 * - **选择**：标签形态点击回传 `select`；标题形态没有第二个可选项，不做选择动作。
 *
 * 标题形态**不做落点**：left 的 Part 头只有这一块拖动面，空正文接收移动，
 * 容器插入归活动栏条目——两处都不经过标题。落点声明留空是给管理器的候选过滤看的：
 * 它连候选都不是，所以不会出现「按下能亮、松手落空」。
 *
 * 它不读存储、不认识命令、不排序也不过滤：标题与图标直接取容器切片里那对已求值字段（本组件不碰
 * 注册表、不按 DOM 重排），因此同一容器在任何入口都显示同一个名字。
 */
import {computed} from "vue";
import {CollisionPriority} from "@dnd-kit/abstract";
import {useDroppable} from "@dnd-kit/vue";
import WorkbenchPanelTab from "nbook/app/components/workbench/WorkbenchPanelTab.vue";
import {
    useWorkbenchDrag,
    workbenchSwitcherScope,
    workbenchSwitcherTargetId,
    WORKBENCH_CONTAINER_DRAG_TYPE,
    WORKBENCH_SWITCHER_TARGET_TYPE,
    WORKBENCH_VIEW_DRAG_TYPE,
    type WorkbenchSwitcherKind,
    type WorkbenchSwitcherDropData,
} from "nbook/app/composables/useWorkbenchDrag";
import type {ContainerViewPresentation} from "nbook/app/utils/workbench/product-catalog";
import {workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";

const props = withDefaults(defineProps<{
    /** 容器的求值切片：标题、图标、生效落位都在里面。 */
    container: ContainerViewPresentation;
    /** `tab` = 标签条里的一项（拖动 + 落点）；`title` = Part 头上的单容器标题（只拖动）。缺省 `tab`。 */
    variant?: "tab" | "title";
    /** 标签形态的选中态（Part 的活动容器）。 */
    active?: boolean;
    /** 是否允许移动容器（拖动源；明确 false 的容器不提供移动入口）。 */
    allowContainerMove?: boolean;
    /** 是否允许把 View 落到本容器（落点）；只在 `tab` 形态生效（标题形态不做落点）。 */
    allowViewMove?: boolean;
    /** 选择单元的可达名称（i18n 归页面）。 */
    label?: string;
    /** 会话上下文代际：容器拖动载荷冻结它，判定与记录层据此拒绝过期意图。 */
    contextKey?: string;
    /** 本条目属于哪一个切换器（同一 Part 的头部与主活动栏各一份）。 */
    switcherKind?: WorkbenchSwitcherKind;
}>(), {
    variant: "tab",
    contextKey: "",
    switcherKind: "head",
    active: false,
    allowContainerMove: false,
    allowViewMove: false,
    label: "",
});

const emit = defineEmits<{(e: "select", containerId: string): void}>();

/** 本条目所在的切换器作用域：拖动载荷与落点数据都用它，判定因此只读命中那个切换器的几何。 */
const switcherScope = computed(() => workbenchSwitcherScope(props.container.partId, props.switcherKind));

const drag = useWorkbenchDrag({
    kind: "container",
    payload: () => ({
        kind: "workbench-container" as const,
        containerId: props.container.containerId,
        location: props.container.location,
        // 整组并入按这份**完整成员快照**搬（含 hidden / collapsed），不在这里拼可见成员。
        viewIds: props.container.memberViewIds,
        contextKey: props.contextKey,
    }),
    disabled: () => !props.allowContainerMove,
});

const root = drag.element;

/**
 * 一个条目就是一个切换器插入落点：前/后半决定插到它之前还是后一个之前。
 * View 在插入位新建容器，整容器则移动到该位置。
 *
 * `tab` 形态的落点按**拖动源类型**分别收口：两个门压成一个总开关时，只开一门也会被另一种源命中
 * （判定层只校验源一侧的权限，不会替目标复核类型）。
 *
 * `title` 形态**不接收任何源**（`accept` 为空），它只保留拖动；正文与切换器分别提供目标。
 *
 * 拖动源是自己时容器源不参与（同一次移动里「插到自己之前」没有意义），View 源由判定层排除自己。
 */
useDroppable<WorkbenchSwitcherDropData>({
    id: computed(() => workbenchSwitcherTargetId(`${switcherScope.value}#${props.container.containerId}`)),
    type: WORKBENCH_SWITCHER_TARGET_TYPE,
    accept: computed(() => props.variant === "title" ? [] : [
        ...(props.allowContainerMove ? [WORKBENCH_CONTAINER_DRAG_TYPE] : []),
        ...(props.allowViewMove ? [WORKBENCH_VIEW_DRAG_TYPE] : []),
    ]),
    data: computed<WorkbenchSwitcherDropData>(() => ({
        kind: "workbench-switcher-target",
        partId: props.container.partId,
        location: props.container.location,
        switcherScope: switcherScope.value,
        viewContainerId: props.container.containerId,
    })),
    /**
     * 命中口径与几何读法同源（`tab` 形态）：条目此刻的**可见**矩形里有指针、且指针位置最上层的业务元素属于它。
     * 被裁掉、`hidden` / `inert`、被菜单或对话框盖住的条目都不接收。
     */
    collisionDetector: () => workbenchPointerCollision,
    /** 精确条目是最高的一档（`tab` 形态）：同一条目带上还有"带空白"的粗落点，指针压在条目上时由本落点接住。 */
    collisionPriority: CollisionPriority.High,
    element: root,
    disabled: computed(() => !props.allowContainerMove && !props.allowViewMove),
});
</script>

<template>
    <div
        ref="root"
        class="workbench-container-tab"
        :class="{'workbench-container-tab--active': active}"
        data-workbench-drag-kind="container"
        :data-container-tab="container.containerId"
        :data-container-location="container.location"
        @click.capture="drag.suppressClick"
        @pointerdown.capture="drag.resetSuppression"
    >
        <WorkbenchPanelTab
            v-if="variant === 'tab'"
            :id="container.containerId"
            :label="container.title"
            :icon="container.icon"
            :active="active"
            @click="emit('select', container.containerId)" />

        <template v-else>
            <span v-if="container.icon" :class="container.icon" class="workbench-container-tab__icon" aria-hidden="true"></span>
            <span class="workbench-container-tab__title" :title="label || container.title">{{ container.title }}</span>
        </template>
    </div>
</template>

<style scoped>
/* 拖动面自己不带观感：标签形态的视觉全在 `WorkbenchPanelTab` 里，标题形态才画标题。
   拖动中也不给源降不透明度 / 位移：跟着指针走的是页面唯一那个 `WorkbenchDragOverlay`，
   源条目保持原样（矩形与观感都不跳），松手后不需要"复原"一步。 */
.workbench-container-tab {
    display: flex;
    align-items: center;
    min-width: 0;
}

.workbench-container-tab__icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin-inline-end: var(--space-1);
    color: var(--text-muted);
}

.workbench-container-tab__title {
    overflow: hidden;
    font-size: 12px;
    font-weight: var(--weight-strong);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
}

.workbench-container-tab--active .workbench-container-tab__title,
.workbench-container-tab--active .workbench-container-tab__icon {
    color: var(--text-main);
}
</style>
