<script setup lang="ts">
/**
 * 活动栏主入口组的**切换器落点**：条目之间的空白落下＝追加到本 Part 末尾。
 *
 * 它自己不产出任何可用 DOM（只渲染一个隐藏标记），落点与几何都挂在调用方给的**主入口组元素**上：
 * 主入口组本来就是竖排容器条目，几何读法因此与 `WorkbenchPartHost` 的头部同一套形状，
 * 只是作用域是 `…:activity`。只有显式开启拖放的调用方才会渲染它——普通活动栏（例如组件测试里
 * 没有 `DragDropProvider` 的场景）不实例化任何 dnd 钩子。
 */
import {computed, onBeforeUnmount, watch} from "vue";
import {CollisionPriority} from "@dnd-kit/abstract";
import {useDroppable} from "@dnd-kit/vue";
import type {GridDropRect, GridOrientation} from "@notnotype/nb-ui/layout";
import {
    workbenchSwitcherScope,
    workbenchSwitcherTargetId,
    WORKBENCH_CONTAINER_DRAG_TYPE,
    WORKBENCH_SWITCHER_TARGET_TYPE,
    WORKBENCH_VIEW_DRAG_TYPE,
    type WorkbenchSwitcherDropData,
} from "nbook/app/composables/useWorkbenchDrag";
import {useWorkbenchDropGeometry} from "nbook/app/composables/useWorkbenchDrop";
import type {WorkbenchDropSwitcherRects} from "nbook/app/utils/workbench/workbench-drop";
import {readWorkbenchDropRect, workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";
import type {WorkbenchActivityContainerInfo} from "nbook/app/components/workbench/WorkbenchActivityBar.vue";

const props = defineProps<{
    /** 主入口组元素：条目带矩形与条目清单都从它读。 */
    element: HTMLElement | null;
    /** 本组里的容器条目（顺序即渲染顺序）。 */
    containers: readonly WorkbenchActivityContainerInfo[];
    allowContainerMove: boolean;
    allowViewMove: boolean;
}>();

const switcherScope = computed(() => workbenchSwitcherScope(props.containers[0]?.partId ?? "left", "activity"));

const geometry = useWorkbenchDropGeometry();

/** 条目出现/消失（例如容器被搬走、活动栏被压到滚动区之外）时重新登记：读法本身是幂等的。 */
const geometryRead = (): WorkbenchDropSwitcherRects | null => {
    const group = props.element;
    const scope = switcherScope.value;
    if (group === null || scope === null) {
        return null;
    }
    const band = readWorkbenchDropRect(group);
    if (band === null) {
        return null;
    }
    // 条目只在**当前**入口组里按 `data-activity-id` 属性值建映射（不拼字符串选择器），
    // 再按容器清单取：只有此刻真实可见的条目参与几何，被裁掉或在滚动区之外的不列。
    const items = new Map<string, Element>();
    for (const element of group.querySelectorAll("[data-activity-id]")) {
        const containerId = element.getAttribute("data-activity-id");
        if (containerId !== null && !items.has(containerId)) {
            items.set(containerId, element);
        }
    }
    const entries: {containerId: string; rect: GridDropRect}[] = [];
    for (const container of props.containers) {
        const element = items.get(container.containerId);
        if (element === undefined) {
            continue;
        }
        const rect = readWorkbenchDropRect(element);
        if (rect === null) {
            continue;
        }
        entries.push({containerId: container.containerId, rect});
    }
    return {orientation: "vertical" as GridOrientation, rect: band, entries};
};

const elementRef = computed(() => props.element);
useDroppable<WorkbenchSwitcherDropData>({
    id: computed(() => workbenchSwitcherTargetId(`${switcherScope.value ?? "activity"}:band`)),
    type: WORKBENCH_SWITCHER_TARGET_TYPE,
    accept: computed(() => [
        ...(props.allowContainerMove ? [WORKBENCH_CONTAINER_DRAG_TYPE] : []),
        ...(props.allowViewMove ? [WORKBENCH_VIEW_DRAG_TYPE] : []),
    ]),
    data: computed<WorkbenchSwitcherDropData>(() => {
        const first = props.containers[0];
        return {
            kind: "workbench-switcher-target",
            partId: first?.partId ?? "left",
            location: first?.location ?? "sidebar-left",
            switcherScope: switcherScope.value,
        };
    }),
    collisionDetector: () => workbenchPointerCollision,
    collisionPriority: CollisionPriority.Low,
    element: elementRef,
    disabled: computed(() => props.element === null || (!props.allowContainerMove && !props.allowViewMove)),
});

// 几何登记与落点同一生命周期：作用域变化时先撤销旧登记，避免留下过期坐标。
let unregisterSwitcher: (() => void) | null = null;
watch(switcherScope, (scope) => {
    unregisterSwitcher?.();
    unregisterSwitcher = null;
    if (scope !== null && geometry !== null) {
        unregisterSwitcher = geometry.registerSwitcher(scope, geometryRead);
    }
}, {immediate: true});

onBeforeUnmount(() => {
    unregisterSwitcher?.();
    unregisterSwitcher = null;
});
</script>

<template>
    <span v-if="false" data-activity-switcher-band aria-hidden="true"></span>
</template>
