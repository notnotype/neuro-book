<script lang="ts">
import type {InjectionKey} from "vue";

/**
 * 视图实例层的对外通道：宿主把渲染出的落点元素登记进来，实例层把**每个视图唯一**的组件实例
 * 用 Teleport 搬进那个元素。
 *
 * 落点登记走 provide/inject（页面把实例层作为外壳的祖先渲染一次，三个宿主在它的子树里），
 * 因此页面不需要自己维护一张 viewId → Element 的表，也不会出现"三处各建一份实例"。
 */
export type ViewTargetRegistry = {
    /** 登记某个视图的落点元素。 */
    register(viewId: string, element: HTMLElement): void;
    /** 反登记**自己登记过的那个**元素：旧宿主清理不得删掉新宿主刚登记的目标，实例改停 parking。 */
    unregister(viewId: string, element: HTMLElement): void;
};

export const VIEW_TARGET_REGISTRY: InjectionKey<ViewTargetRegistry> = Symbol("nbook.workbench.view-target-registry");
</script>

<script setup lang="ts">
/**
 * 工具视图实例层：**每个视图恰好一个组件实例**，靠 Teleport 在左栏 / 右栏 / 底部之间搬 DOM。
 *
 * 为什么要在宿主之外单开一层：视图实例必须活在"可能重排的叶子"外面。左右叶显隐、底部尺寸变化
 * 都可能让容器宿主重挂，实例若挂在宿主里就会跟着销毁——文件树的搜索词、展开节点、局部滚动都会清零。
 * Teleport 只改变 DOM 层级、不改变逻辑组件树（Vue 官方语义），所以实例的响应式状态、provide 链
 * 与主题宿主通道都留在原处，只有那段 DOM 被搬走。
 *
 * 落点发布的时序：
 * - 宿主登记落点时**只更新登记表**，真正的目标在 `nextTick` 之后统一发布——同一次渲染里旧容器已卸载、
 *   新容器还没登记的那个窗口，不能把 Teleport 指向不存在的节点；不用 `defer` 掩盖跨 tick 缺失目标；
 * - 新目标还没登记（框架拓扑重排造成的落点短暂撤销）时**保留旧目标**：实例不销毁，等重新登记后再搬；
 * - 上下文真的不可见（`when` 不满足）或视图从求值结果里消失时才释放实例，目标一并清掉。
 *
 * `requiredAuthority` 缺失**不释放**视图：它是"动作不可用"而不是"看不见"，实例照常挂着，
 * 受限原因以一条状态说明显示在视图内容上方（可见性不是权限，权限也不决定实例生死）。
 */

import {computed, nextTick, provide, shallowRef, ref, watch, type Component} from "vue";
import type {DescriptorResult} from "nbook/app/utils/workbench/descriptors";
import type {WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import type {
    ViewActionTarget,
    ViewTitleActionState,
    WorkbenchViewActionHandle,
} from "nbook/app/utils/workbench/view-title-actions";

const props = defineProps<{
    /** 统一求值后的视图模型（全量条目；只有 `visible` 的会渲染成实例）。 */
    views: readonly WorkbenchViewEntry[];
    /**
     * factory 解析器（**必填**）：产品页面传 `resolveWorkbenchViewFactory`，Lab 与测试传本地白名单。
     *
     * 这里不再内建产品白名单回退：实例层 import 产品叶（`WorkspaceFilePanel` → Pinia store / API）
     * 会让「不加载业务内容的骨架」变成一句空话——谁装配谁提供那份映射。
     */
    viewFactoryResolver: (factoryKey: string) => DescriptorResult<Component>;
}>();

const emit = defineEmits<{
    (e: "view-actions", target: ViewActionTarget, states: readonly ViewTitleActionState[]): void;
    (e: "view-handle-ready", target: ViewActionTarget, handle: WorkbenchViewActionHandle | null): void;
}>();

/**
 * 每个**真实实例**一个代际：实例第一次拿到落点时分配，跨位置搬 DOM 不变，真释放（不可见）才作废。
 *
 * 代际是「迟到的回调 / 迟到的点击」唯一的判据：宿主按它认实例，不对着新实例执行旧动作。
 * 释放后把最后一个代际记进 `retired`：实例卸载时上报的 `null` 要带上**自己那一次**的代际，
 * 否则宿主只能看到 0，既认不出是谁在交还句柄，也可能被误当成「更新的实例」。
 */
const generations = shallowRef<Readonly<Record<string, number>>>({});
const retired = new Map<string, number>();
let lastGeneration = 0;

function allocateGenerations(current: readonly WorkbenchViewEntry[]): void {
    const next: Record<string, number> = {};
    for (const entry of current) {
        const known = generations.value[entry.view.id];
        if (known !== undefined) {
            next[entry.view.id] = known;
            continue;
        }
        lastGeneration += 1;
        next[entry.view.id] = lastGeneration;
    }
    for (const [viewId, generation] of Object.entries(generations.value)) {
        if (next[viewId] === undefined) {
            retired.set(viewId, generation);
        }
    }
    generations.value = next;
}

function targetOf(viewId: string): ViewActionTarget {
    return {viewId, generation: generations.value[viewId] ?? retired.get(viewId) ?? 0};
}

function isHandle(value: unknown): value is WorkbenchViewActionHandle {
    return typeof value === "object" && value !== null && typeof (value as {runAction?: unknown}).runAction === "function";
}

function forwardStates(viewId: string, states: unknown): void {
    emit("view-actions", targetOf(viewId), Array.isArray(states) ? states as readonly ViewTitleActionState[] : []);
}

function forwardHandle(viewId: string, handle: unknown): void {
    emit("view-handle-ready", targetOf(viewId), isHandle(handle) ? handle : null);
}

/** 宿主登记过的落点：反登记按**元素身份**比对，旧宿主清理不删新宿主目标。 */
const targets = new Map<string, HTMLElement>();
/** 常驻 parking 目标：每个可见视图一个，随本组件常驻（`hidden inert`，不占尺寸、不进可访问树）。 */
const parking = new Map<string, HTMLElement>();
/** 曾经拿到过落点的视图：只有**暂失目标**的才停到 parking，没落点过的照旧不实例化（懒实例化不变）。 */
const everTargeted = new Set<string>();
/** 真正交给 Teleport 的目标；外来登记要等下一次 `nextTick` 才可能替换它。 */
const published = shallowRef<Readonly<Record<string, HTMLElement>>>({});
let publishScheduled = false;

const visibleEntries = computed(() => props.views.filter((entry) => entry.visible));

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

/**
 * parking 目标元素的登记/反登记：per-id 元素只由本组件的这次渲染登记，`null` 就是它自己离场。
 */
function setParkingElement(viewId: string, element: unknown): void {
    if (element instanceof HTMLElement) {
        parking.set(viewId, element);
        schedulePublish();
        return;
    }
    parking.delete(viewId);
    schedulePublish();
}

/**
 * 目标发布：登记过的新目标优先，**暂失目标**（宿主卸载、容器停到 parking）时退回本层的 parking，
 * 实例因此既不销毁，也不留在已经断开的旧元素里。
 */
function publishTargets(): void {
    const next: Record<string, HTMLElement> = {...published.value};
    let changed = false;
    const visible: Record<string, true> = {};
    for (const entry of visibleEntries.value) {
        visible[entry.view.id] = true;
        const element = targets.get(entry.view.id)
            ?? (everTargeted.has(entry.view.id) ? parking.get(entry.view.id) : undefined);
        if (element !== undefined && next[entry.view.id] !== element) {
            next[entry.view.id] = element;
            changed = true;
        }
    }
    for (const viewId of Object.keys(next)) {
        if (visible[viewId] !== true) {
            delete next[viewId];
            changed = true;
        }
    }
    if (changed) {
        published.value = next;
    }
}

/** 视图 id → 组件；重新求值时复用同一批引用，避免已挂载的视图被换身份重建。 */
const components = shallowRef<Readonly<Record<string, Component>>>({});
const factoryProblems = ref<Readonly<Record<string, string>>>({});

watch(visibleEntries, (current) => {
    allocateGenerations(current);
    const nextComponents: Record<string, Component> = {};
    const nextProblems: Record<string, string> = {};
    for (const entry of current) {
        const known = components.value[entry.view.id];
        if (known !== undefined) {
            nextComponents[entry.view.id] = known;
            continue;
        }
        const factory = props.viewFactoryResolver(entry.view.factoryKey);
        if (factory.ok) {
            nextComponents[entry.view.id] = factory.value;
        } else {
            nextProblems[entry.view.id] = factory.reason;
        }
    }
    components.value = nextComponents;
    factoryProblems.value = nextProblems;
    // 视图（重新）可见：它可能已经有登记好的落点，发布一次就能挂上实例。
    schedulePublish();
}, {immediate: true});

provide(VIEW_TARGET_REGISTRY, {
    register(viewId: string, element: HTMLElement): void {
        if (targets.get(viewId) === element) {
            return;
        }
        targets.set(viewId, element);
        everTargeted.add(viewId);
        schedulePublish();
    },
    unregister(viewId: string, element: HTMLElement): void {
        if (targets.get(viewId) !== element) {
            return;
        }
        targets.delete(viewId);
        schedulePublish();
    },
});
</script>

<template>
    <template v-for="entry in visibleEntries" :key="entry.view.id">
        <Teleport v-if="published[entry.view.id]" :to="published[entry.view.id]">
            <p
                v-if="!entry.actionable && entry.authorityReasons.length > 0"
                class="workbench-view-instances__note"
                role="status"
                data-view-authority-note
            >{{ entry.authorityReasons.join("；") }}</p>

            <div class="workbench-view-instances__content">
                <component
                    :is="components[entry.view.id]"
                    v-if="components[entry.view.id]"
                    @actions-change="forwardStates(entry.view.id, $event)"
                    @action-handle-ready="forwardHandle(entry.view.id, $event)"
                />
                <p v-else class="workbench-view-instances__note" role="status">{{ factoryProblems[entry.view.id] }}</p>
            </div>
        </Teleport>
    </template>

    <!--
      常驻 parking：`hidden` 不占尺寸、`inert` 不进键盘与可访问树。宿主卸载（容器搬走、Part 重排）
      后实例停在这里而不是留在已断开的旧元素里；新目标登记后自动搬回去。
    -->
    <div
        class="workbench-view-instances__parking"
        data-view-parking
        hidden
        inert
        aria-hidden="true"
    >
        <div
            v-for="entry in visibleEntries"
            :key="entry.view.id"
            :data-view-parking-target="entry.view.id"
            :ref="(element) => setParkingElement(entry.view.id, element)"
        ></div>
    </div>

    <!-- 默认插槽：宿主与外壳都是实例层的子树（落点登记走它 provide 的通道）。 -->
    <slot />
</template>

<style scoped>
/* parking 不占尺寸：`hidden` 已经让它 `display: none`，这里只是不额外引入盒子。 */
.workbench-view-instances__parking {
    display: none;
}

/* 视图自己占满落点（`layout: fill` 的合同）：容器不给留白、不代管滚动。 */
.workbench-view-instances__content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

.workbench-view-instances__note {
    flex: 0 0 auto;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--status-warning);
}
</style>
