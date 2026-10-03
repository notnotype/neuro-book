<script setup lang="ts">
/**
 * 活动栏主入口组里的**容器条目**：与默认图标按钮同形，但额外是一个拖动源与一个切换器落点。
 *
 * 主侧栏的容器切换就发生在活动栏（Part 头只有当前容器的标题），所以容器在这里既能被拖走/重排，
 * 也能接收拖来的容器与 View：落点数据与 Part 头的切换器同一套词汇（`workbench-switcher-target`），
 * 只是作用域是 `…:activity`，几何按活动栏的竖排条目读。
 *
 * 拖动中本条目保持原位：跟指针走的是页面唯一的 `WorkbenchDragOverlay`，这里不降不透明度、不位移。
 */
import {computed} from "vue";
import {Tooltip, IconButton} from "@notnotype/nb-ui/components";
import {CollisionPriority} from "@dnd-kit/abstract";
import {useDroppable} from "@dnd-kit/vue";
import {
    useWorkbenchDrag,
    workbenchSwitcherScope,
    workbenchSwitcherTargetId,
    WORKBENCH_CONTAINER_DRAG_TYPE,
    WORKBENCH_SWITCHER_TARGET_TYPE,
    WORKBENCH_VIEW_DRAG_TYPE,
    type WorkbenchSwitcherDropData,
} from "nbook/app/composables/useWorkbenchDrag";
import type {ToolPartId, ToolPartLocation} from "nbook/app/utils/workbench/view-placements";
import {workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";

const props = withDefaults(defineProps<{
    containerId: string;
    title: string;
    icon: string;
    /** 面板状态串 / 首 View / 模板 / 代际的失效指纹（组件不解析，只透传给菜单键）。 */
    itemClass?: string;
    active?: boolean;
    disabled?: boolean;
    badge?: string;
    /** 容器此刻生效的落位与所属 Part：拖动载荷与落点数据都要它们。 */
    location: ToolPartLocation;
    partId: ToolPartId;
    /** 容器全部已登记生效成员的有序快照：整组并入按它搬（含 hidden / collapsed）。 */
    viewIds?: readonly string[];
    contextKey?: string;
    /** 是否允许移动容器（拖动源）；明确 false 的容器不提供移动入口。 */
    allowContainerMove?: boolean;
    /** 是否允许把 View 落到本条目（追加到它所属容器）。 */
    allowViewMove?: boolean;
}>(), {
    itemClass: "",
    active: false,
    disabled: false,
    badge: "",
    viewIds: () => [],
    contextKey: "",
    allowContainerMove: false,
    allowViewMove: false,
});

const emit = defineEmits<{
    (e: "invoke", id: string): void;
    (e: "contextmenu", event: MouseEvent): void;
}>();

const drag = useWorkbenchDrag({
    kind: "container",
    payload: () => ({
        kind: "workbench-container" as const,
        containerId: props.containerId,
        location: props.location,
        viewIds: props.viewIds,
        contextKey: props.contextKey,
    }),
    disabled: () => !props.allowContainerMove,
});

const switcherScope = computed(() => workbenchSwitcherScope(props.partId, "activity"));
const root = drag.element;

useDroppable<WorkbenchSwitcherDropData>({
    id: computed(() => workbenchSwitcherTargetId(`${switcherScope.value}#${props.containerId}`)),
    type: WORKBENCH_SWITCHER_TARGET_TYPE,
    /**
     * 落点按**拖动源类型**分别收口：两个门压成一个总开关时，只开一门也会被另一种源命中
     * （判定层只校验源一侧的权限，不会替目标复核类型）。
     */
    accept: computed(() => [
        ...(props.allowContainerMove ? [WORKBENCH_CONTAINER_DRAG_TYPE] : []),
        ...(props.allowViewMove ? [WORKBENCH_VIEW_DRAG_TYPE] : []),
    ]),
    data: computed<WorkbenchSwitcherDropData>(() => ({
        kind: "workbench-switcher-target",
        partId: props.partId,
        location: props.location,
        switcherScope: switcherScope.value,
        viewContainerId: props.containerId,
    })),
    /**
     * 命中口径与几何读法同源：条目此刻的**可见**矩形里有指针、且指针位置最上层的业务元素属于它。
     * 被裁掉、滚出可视区、`hidden` / `inert`、被浮层盖住的条目都不接收。
     */
    collisionDetector: () => workbenchPointerCollision,
    /** 精确条目是最高的一档：入口组本身还有一档"组空白"的粗落点，指针压在条目上时由本落点接住。 */
    collisionPriority: CollisionPriority.High,
    element: root,
    disabled: computed(() => !props.allowContainerMove && !props.allowViewMove),
});
</script>

<template>
    <Tooltip :text="title" placement="right">
        <span
            ref="root"
            class="workbench-activity-bar__item-wrap relative inline-flex"
            @contextmenu="emit('contextmenu', $event)"
        >
            <IconButton
                :icon-class="icon"
                :aria-label="title"
                :aria-pressed="active"
                :disabled="disabled"
                :data-activity-id="containerId"
                class="workbench-activity-bar__item relative mb-1 !h-10 !w-10 !rounded-[var(--radius-control)]"
                :class="itemClass"
                @click.capture="drag.suppressClick"
                @pointerdown.capture="drag.resetSuppression"
                @click="emit('invoke', containerId)"
            >

                <span v-if="badge !== ''" class="workbench-activity-bar__badge">{{ badge }}</span>
            </IconButton>
        </span>
    </Tooltip>
</template>

<style scoped>
/* 可拖动入口不能继承图标按钮的按压缩放，否则起拖会改变可见源与命中几何。 */
.workbench-activity-bar__item:not(:disabled):active {
    scale: 1;
}
</style>
