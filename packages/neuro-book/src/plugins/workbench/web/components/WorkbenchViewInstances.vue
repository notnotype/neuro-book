<script setup lang="ts">
/**
 * 外壳的两层实例（同名 .md）：每个常驻容器一个稳定的宿主，Teleport 到所在 Part 的落点（未选中或没有落点时停放）；
 * 每个视图一个实例，Teleport 到容器里分节的落点。移动、换轴、切模式都只是换落点，不重建实例。
 *
 * 视图的加载与代际都在这里：第一次有效可见才 `load()`，每次加载与每次渲染重试代际加一；结果回来时代际已变或来源说作废，
 * 就丢掉这次结果。交付撤回时卸掉组件，等再次交付且可见时用新代际加载。
 */
import {computed, markRaw, nextTick, reactive, ref, watch, watchEffect} from "vue";
import type {Component, Ref} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ViewLocation} from "../../shared/views";
import type {ViewContext} from "../contracts";
import type {TeleportMemory} from "../shell/teleport-memory";
import type {ViewIntent} from "../views/intents";
import type {ContainerPresentation, Presentation} from "../views/presentation";
import type {ViewSource} from "../views/registry";
import WorkbenchViewContainerHost from "./WorkbenchViewContainerHost.vue";
import WorkbenchViewFrame from "./WorkbenchViewFrame.vue";
import type {ViewFrameStatus} from "./WorkbenchViewFrame.vue";

defineOptions({name: "WorkbenchViewInstances"});

const props = withDefaults(defineProps<{
    presentation: Presentation;
    source: ViewSource;
    partTargets: Partial<Record<ViewLocation, HTMLElement>>;
    shownParts: ReadonlyArray<ViewLocation>;
    memory: TeleportMemory;
    root: HTMLElement | null;
    locale: DisplayLocale;
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (event: "intent", intent: ViewIntent): void;
    /** 各视图实例当前的代际（变化时整表报一次）：宿主拿它拼“移动到”菜单的目标身份。 */
    (event: "generations", generations: ReadonlyMap<string, number>): void;
}>();

defineSlots<{
    "view-actions"?(props: {viewId: string; container: ContainerPresentation}): unknown;
    empty?(props: {container: ContainerPresentation}): unknown;
}>();

const TEXT = {
    collapse: {"zh-CN": "收起视图", "en-US": "Collapse View"},
    expand: {"zh-CN": "展开视图", "en-US": "Expand View"},
};

// ── 容器层 ──────────────────────────────────────────────────────────────────

const containers = computed(() => [...props.presentation.containers.values()]);

/** 容器的落点：所在 Part 的选中容器才有，其余停放。 */
const containerTargets = computed(() => new Map(containers.value.map((container) => {
    const selected = props.presentation.parts[container.part].selected === container.id;
    return [container.id, selected ? (props.partTargets[container.part] ?? null) : null] as const;
})));

// ── 视图层 ──────────────────────────────────────────────────────────────────

const viewTargets = reactive(new Map<string, HTMLElement>());

function onTarget(viewId: string, element: HTMLElement | null): void {
    if (element === null) viewTargets.delete(viewId);
    else viewTargets.set(viewId, element);
}

/** 视图此刻有效可见：在看得见的 Part 的选中容器里、没有收起、分节里有落点。 */
const visible = computed(() => {
    const ids = new Set<string>();
    for (const part of props.shownParts) {
        const selected = props.presentation.parts[part].selected;
        const container = selected === null ? undefined : props.presentation.containers.get(selected);
        for (const view of container?.views ?? []) if (!view.collapsed && viewTargets.has(view.id)) ids.add(view.id);
    }
    return ids;
});

/** 视图声明的内容布局：从呈现模型里它所在容器的成员取（隐藏的视图不在可见列表里，默认 scroll）。 */
const layoutOfView = computed(() => {
    const layouts = new Map<string, "scroll" | "fill">();
    for (const container of containers.value) for (const view of container.views) layouts.set(view.id, view.layout);
    return layouts;
});

const partOfView = computed(() => {
    const parts = new Map<string, ViewLocation>();
    for (const container of containers.value) for (const id of container.members) parts.set(id, container.part);
    return parts;
});

interface Instance {
    generation: number;
    status: ViewFrameStatus;
    component: Component | null;
    error: string | null;
    busy: boolean;
}

const instances = reactive(new Map<string, Instance>());
/**
 * 每个实例当前代际的上下文。放在响应式表之外：上下文里的 `visible`、`location` 是 ref，进了 reactive 会被解包；
 * 它只随实例状态一起换，渲染跟着状态更新。
 */
const contexts = new Map<string, ViewContext>();
/** 代际在工作台存活期内按视图 id 单调递增；实例删了再建也接着数。 */
const generations = new Map<string, number>();

function nextGeneration(viewId: string): number {
    const next = (generations.get(viewId) ?? 0) + 1;
    generations.set(viewId, next);
    return next;
}

function contextFor(viewId: string, generation: number): ViewContext {
    const visibleRef = computed(() => visible.value.has(viewId));
    const location = computed(() => partOfView.value.get(viewId) ?? "sidebar");
    return markRaw({id: viewId, generation, visible: visibleRef as Readonly<Ref<boolean>>, location: location as Readonly<Ref<ViewLocation>>});
}

async function load(viewId: string): Promise<void> {
    const instance = instances.get(viewId);
    if (instance === undefined) return;
    const generation = nextGeneration(viewId);
    contexts.delete(viewId);
    Object.assign(instance, {generation, status: "loading", component: null, error: null});
    const result = await props.source.load(viewId);
    const current = instances.get(viewId);
    // 等待期间又发起了新加载、交付被撤回、实例被删：这次结果作废。
    if (current === undefined || current.generation !== generation || current.status !== "loading") return;
    if (result.status === "stale") current.status = "waiting";
    else if (result.status === "failed") Object.assign(current, {status: "load-failed", error: result.error instanceof Error ? result.error.message : String(result.error)});
    else {
        contexts.set(viewId, contextFor(viewId, generation));
        Object.assign(current, {status: "ready", component: markRaw(result.component)});
    }
}

watch(() => [...instances].map(([id, instance]) => `${id}:${String(instance.generation)}`).join("|"), () => {
    emit("generations", new Map([...instances].map(([id, instance]) => [id, instance.generation])));
}, {immediate: true});

// 第一次有效可见才建实例。
watch(visible, (ids) => {
    for (const id of ids) if (!instances.has(id)) instances.set(id, {generation: generations.get(id) ?? 0, status: "waiting", component: null, error: null, busy: false});
}, {immediate: true});

// 视图的声明不在了（不再是任何容器的成员）：删掉实例。
watch(partOfView, (parts) => {
    for (const id of [...instances.keys()]) {
        if (parts.has(id)) continue;
        instances.delete(id);
        contexts.delete(id);
    }
});

// 交付撤回卸掉组件；交付在、实例在等、此刻可见就加载。
watchEffect(() => {
    for (const [id, instance] of instances) {
        const delivery = props.source.delivery(id);
        if (delivery.kind !== "available") {
            if (instance.status !== "waiting") {
                contexts.delete(id);
                Object.assign(instance, {status: "waiting", component: null, error: null});
            }
        } else if (instance.status === "waiting" && visible.value.has(id)) {
            void load(id);
        }
    }
});

function reload(viewId: string): void {
    if (instances.get(viewId)?.status === "load-failed") void load(viewId);
}

function retryRender(viewId: string): void {
    const instance = instances.get(viewId);
    if (instance?.status !== "render-failed" || instance.component === null) return;
    const generation = nextGeneration(viewId);
    contexts.set(viewId, contextFor(viewId, generation));
    Object.assign(instance, {generation, status: "ready", error: null});
}

function renderError(viewId: string, generation: number, message: string): void {
    const instance = instances.get(viewId);
    if (instance === undefined || instance.generation !== generation) return;
    Object.assign(instance, {status: "render-failed", error: message});
}

async function retryEntry(viewId: string): Promise<void> {
    const instance = instances.get(viewId);
    if (instance === undefined || instance.busy) return;
    instance.busy = true;
    try {
        await props.source.retry(viewId);
    } finally {
        instance.busy = false;
    }
}

// ── 停放区与滚动、焦点记忆 ────────────────────────────────────────────────

const containerParking = ref<HTMLElement | null>(null);
const viewParking = ref<HTMLElement | null>(null);
watch(containerParking, (element, previous) => props.memory.parking(element, previous), {immediate: true});
watch(viewParking, (element, previous) => props.memory.parking(element, previous), {immediate: true});
watch(() => props.root, (element, _previous, onCleanup) => {
    if (element !== null) onCleanup(props.memory.track(element));
}, {immediate: true});

/**
 * 视图收起再展开、所在 Part 隐藏再显示时内容没有搬动，但隐藏（`display: none`）同样清掉了滚动位置：可见集合一变就在
 * 渲染之后按记忆还原一次。
 */
watch(visible, () => {
    void nextTick(() => {
        void nextTick(() => props.memory.restore(null, props.root));
    });
});

/** 落点一变，下一轮 Teleport 就要搬内容：搬之前记下焦点，搬完（两轮之后）还原；原焦点被停放时交给外壳根。 */
watch([containerTargets, () => [...viewTargets.entries()]], () => {
    const focus = props.memory.capture(props.root);
    void nextTick(() => {
        void nextTick(() => {
            if (props.memory.restore(focus, props.root) === "lost") props.root?.focus({preventScroll: true});
        });
    });
}, {flush: "pre"});
</script>

<template>
    <div class="workbench-view-instances" data-view-instances>
        <div ref="containerParking" class="workbench-view-instances__parking" aria-hidden="true" inert data-container-parking>
            <Teleport v-for="container in containers" :key="container.id" :to="containerTargets.get(container.id) ?? undefined" :disabled="containerTargets.get(container.id) === null">
                <div class="workbench-view-instances__container" :data-container-instance="container.id">
                    <WorkbenchViewContainerHost
                        :container="container"
                        :context-key="`${container.id}|${container.part}`"
                        :disabled="disabled"
                        :collapse-label="localize(TEXT.collapse, locale)"
                        :expand-label="localize(TEXT.expand, locale)"
                        :locale="locale"
                        @target="onTarget"
                        @resize="(payload) => emit('intent', {kind: 'set-view-sizes', containerId: payload.containerId, axis: payload.axis, sizes: payload.sizes})"
                        @toggle-collapsed="(viewId, collapsed) => emit('intent', {kind: 'set-view-collapsed', viewId, collapsed})"
                    >
                        <template #view-actions="{viewId}">
                            <slot name="view-actions" :view-id="viewId" :container="container"></slot>
                        </template>
                        <template #empty>
                            <slot name="empty" :container="container"></slot>
                        </template>
                    </WorkbenchViewContainerHost>
                </div>
            </Teleport>
        </div>
        <div ref="viewParking" class="workbench-view-instances__parking" aria-hidden="true" inert data-view-parking>
            <Teleport v-for="[viewId, instance] in instances" :key="viewId" :to="viewTargets.get(viewId) ?? undefined" :disabled="!viewTargets.has(viewId)">
                <WorkbenchViewFrame
                    :view-id="viewId"
                    :locale="locale"
                    :layout="layoutOfView.get(viewId) ?? 'scroll'"
                    :delivery="source.delivery(viewId)"
                    :status="instance.status"
                    :error="instance.error"
                    :component="instance.component"
                    :context="contexts.get(viewId) ?? null"
                    :generation="instance.generation"
                    :busy="instance.busy"
                    @retry-entry="retryEntry(viewId)"
                    @reload="reload(viewId)"
                    @retry-render="retryRender(viewId)"
                    @render-error="(generation, message) => renderError(viewId, generation, message)"
                />
            </Teleport>
        </div>
    </div>
</template>

<style scoped>
.workbench-view-instances {
    display: contents;
}

.workbench-view-instances__parking {
    display: none;
}

.workbench-view-instances__container {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}
</style>
