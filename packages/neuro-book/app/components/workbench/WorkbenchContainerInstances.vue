<script lang="ts">
import type {InjectionKey} from "vue";

/**
 * 容器挂载目标登记通道：Part 宿主把「本 Part 当前显示哪个容器」的挂载元素登记进来，
 * 容器实例层把**每个容器唯一**的 ViewHost 用 Teleport 搬进去。
 *
 * 与 View 实例层同构：登记走 provide/inject（页面把容器实例层渲染成外壳的祖先，三个 Part 宿主在它的
 * 子树里），页面因此不需要自己维护 containerId → Element 的表，也不会出现「两个 Part 各建一份实例」。
 */
export type ContainerTargetRegistry = {
    /** 登记某个容器的挂载目标。 */
    register(containerId: string, element: HTMLElement): void;
    /** 反登记**自己登记过的那个**元素：旧宿主清理不得删掉新宿主刚登记的目标。 */
    unregister(containerId: string, element: HTMLElement): void;
};

export const CONTAINER_TARGET_REGISTRY: InjectionKey<ContainerTargetRegistry> = Symbol("nbook.workbench.container-target-registry");
</script>

<script setup lang="ts">
/**
 * 容器实例层：**每个容器恰好一个 ViewHost**，靠 Teleport 在 Part 之间搬 DOM，搬不动时停在 parking。
 *
 * 它解决的是「Part 只显示一个活动容器」带来的重挂问题：活动容器一换，另一个容器的宿主如果挂在 Part 里
 * 就会跟着销毁——View 的实例虽然由 View 实例层独占，容器自己的 Grid 尺寸意图、折叠状态与手势基线都会丢。
 * 所以容器宿主活在 Part 之外，只把那段 DOM 搬进去。
 *
 * Part 宿主登记/反登记挂载目标时同步发布目标；`nextTick` 再合并渲染后最终状态；
 * 只有仍连接文档的目标才承载实例，目标缺失/脱离时发布**常驻 parking 目标**；
 * 容器从求值结果里消失时才释放实例与目标。
 *
 * parking 是共享的一块 `hidden inert` 宿主（不占尺寸、不进键盘与可访问树），里面每个 containerId
 * 一个稳定目标元素。两层 parking（容器与 View）都不重复挂业务实例。
 */
import {computed, nextTick, provide, reactive, ref, shallowRef, watch} from "vue";
import WorkbenchViewHost, {
    type WorkbenchViewSizesEvent,
    type WorkbenchViewTitleActionEvent,
} from "nbook/app/components/workbench/WorkbenchViewHost.vue";
import type {ContainerViewPresentation} from "nbook/app/utils/workbench/product-catalog";
import type {ViewMoveRequest} from "nbook/app/utils/workbench/view-placements";
import type {WorkbenchTitleActionsByView} from "nbook/app/utils/workbench/view-title-actions";

const props = withDefaults(defineProps<{
    /**
     * **常驻**容器的求值切片（`presentation.residentContainers`）：每个容器一个 ViewHost。
     *
     * 全部可落位且实际有成员的容器；隐藏成员仍计入、未活动容器停在 parking。
     * 实际搬空后容器退出 resident，上层 View 实例不销毁。本层不自行过滤。
     */
    containers: readonly ContainerViewPresentation[];
    /** 全部 View 的两轴尺寸意图与收起位（user/local 共用：跨 Project 同一份）。 */
    viewSizes?: Readonly<Record<string, {readonly width?: number; readonly height?: number; readonly collapsed?: boolean}>>;
    /** 会话与几何键：随移动作一起交给会话，也是 ViewHost 内部 Grid 的上下文。 */
    contextKey?: string;
    /** 标题动作菜单的失效指纹（面板状态 / 首 View / 代际）；与 `contextKey` 分开传。 */
    actionsContextKey?: string;
    /** 已求值的 View 标题动作，按 viewId 索引。 */
    actionsByView?: WorkbenchTitleActionsByView;
    /** 是否允许把 View 移动到别的容器（拖动与「移动到」菜单共用这一条）。 */
    allowViewMove?: boolean;
    /** 是否允许把容器整组合并到本层的容器（透传给 `WorkbenchViewHost` 的内容落点）。 */
    allowContainerMove?: boolean;
    /** 「移动到」子菜单的可达名称（i18n 归页面）。 */
    moveLabel?: string;
    /** View 动作组的无障碍名称。 */
    viewActionsLabel?: string;
}>(), {
    viewSizes: () => ({}),
    contextKey: "",
    actionsContextKey: "",
    actionsByView: () => ({}),
    allowViewMove: false,
    allowContainerMove: false,
    moveLabel: "",
    viewActionsLabel: "",
});

const emit = defineEmits<{
    (e: "move-view", request: ViewMoveRequest): void;
    (e: "view-sizes", payload: WorkbenchViewSizesEvent): void;
    (e: "title-action", payload: WorkbenchViewTitleActionEvent): void;
}>();

/** Part 宿主登记过的挂载目标：按 containerId 记，反登记比对元素身份。 */
const targets = new Map<string, HTMLElement>();
/** 常驻 parking 目标：每个 containerId 一个，随本组件常驻，不随 Part 重排。 */
const parking = reactive(new Map<string, HTMLElement>());
/** 真正交给 Teleport 的目标；登记变化要等下一次 `nextTick` 才替换它。 */
const published = shallowRef<Readonly<Record<string, HTMLElement>>>({});
let publishScheduled = false;

const containerIds = computed(() => props.containers.map((container) => container.containerId));

function schedulePublish(): void {
    if (publishScheduled) {
        return;
    }
    publishScheduled = true;
    void nextTick(() => {
        publishScheduled = false;
        publishTargets();
    });
}

function publishTargets(): void {
    const next: Record<string, HTMLElement> = {...published.value};
    let changed = false;
    const known: Record<string, true> = {};
    for (const container of props.containers) {
        known[container.containerId] = true;
        const target = targets.get(container.containerId);
        const element = target?.isConnected === true
            ? target
            : parking.get(container.containerId);
        if (element === undefined) {
            if (Object.hasOwn(next, container.containerId)) {
                delete next[container.containerId];
                changed = true;
            }
            continue;
        }
        if (next[container.containerId] !== element) {
            next[container.containerId] = element;
            changed = true;
        }
    }
    for (const containerId of Object.keys(next)) {
        if (known[containerId] !== true) {
            delete next[containerId];
            changed = true;
        }
    }
    if (changed) {
        published.value = next;
    }
}

watch(containerIds, () => schedulePublish(), {immediate: true});

/** parking 目标元素的登记/反登记：parking 常驻，但容器进出求值结果时元素会跟着增删。 */
function setParkingElement(containerId: string, element: unknown): void {
    const previous = parking.get(containerId);
    if (element instanceof HTMLElement) {
        parking.set(containerId, element);
        schedulePublish();
        return;
    }
    if (previous !== undefined) {
        parking.delete(containerId);
        schedulePublish();
    }
}

function publishImmediate(containerId: string, element: HTMLElement | undefined): void {
    const target = element?.isConnected === true
        ? element
        : parking.get(containerId);
    const previous = published.value[containerId];
    if (target === undefined) {
        if (previous === undefined || previous.isConnected) {
            return;
        }
        const next = {...published.value};
        delete next[containerId];
        published.value = next;
        return;
    }
    if (previous !== target) {
        published.value = {...published.value, [containerId]: target};
    }
}

provide(CONTAINER_TARGET_REGISTRY, {
    register(containerId: string, element: HTMLElement): void {
        if (targets.get(containerId) === element) {
            return;
        }
        targets.set(containerId, element);
        publishImmediate(containerId, element);
        schedulePublish();
    },
    unregister(containerId: string, element: HTMLElement): void {
        if (targets.get(containerId) !== element) {
            return;
        }
        targets.delete(containerId);
        publishImmediate(containerId, parking.get(containerId));
        schedulePublish();
    },
});
</script>

<template>
    <template v-for="container in containers" :key="container.containerId">
        <Teleport v-if="published[container.containerId]" :to="published[container.containerId]">
            <WorkbenchViewHost
                :presentation="container"
                :view-sizes="viewSizes"
                :context-key="contextKey"
                :actions-context-key="actionsContextKey"
                :allow-container-move="allowContainerMove"
                :actions-by-view="actionsByView"
                :allow-view-move="allowViewMove"
                :move-label="moveLabel"
                :view-actions-label="viewActionsLabel"
                @move-view="(request: ViewMoveRequest) => emit('move-view', request)"
                @view-sizes="(payload: WorkbenchViewSizesEvent) => emit('view-sizes', payload)"
                @title-action="(payload: WorkbenchViewTitleActionEvent) => emit('title-action', payload)" />
        </Teleport>
    </template>

    <!--
      共享 parking：`hidden` 不占尺寸、`inert` 不进键盘与可访问树。它是本组件的常驻渲染，
      不位于任何可能隐藏的 Part 中，因此 Part 目标注销后实例仍有地方可停。
    -->
    <div
        class="workbench-container-instances__parking"
        data-container-parking
        hidden
        inert
        aria-hidden="true"
    >
        <div
            v-for="container in containers"
            :key="container.containerId"
            :data-container-parking-target="container.containerId"
            :ref="(element) => setParkingElement(container.containerId, element)"
        ></div>
    </div>

    <!-- 默认插槽：Part 宿主是实例层的子树（挂载目标登记走它 provide 的通道）。 -->
    <slot />
</template>

<style scoped>
/* parking 不占尺寸：`hidden` 已经让它 `display: none`，这里只是不额外引入盒子。 */
.workbench-container-instances__parking {
    display: none;
}
</style>
