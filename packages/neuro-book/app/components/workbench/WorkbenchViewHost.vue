<script setup lang="ts">
/**
 * 视图宿主：把**容器的声明**渲染成界面（L1 内置注册路径的渲染端）。
 *
 * - 视图清单来自注册表（`product-catalog.ts`），可见性由 descriptor 的 `when` 求值；
 * - 内容由 `factoryKey` 经第一方白名单解析（`view-factories.ts`）——descriptor 里没有组件；
 * - 懒实例化：只有可见视图才解析并渲染（不可见的视图没有实例，也没有解析结果）；
 * - 求值失败与 factory 解析失败都在容器内可见地报出来，不静默变成空白；
 * - 内容区合同取第一个可见视图的 `layout`（容器部件只认合同，不认 mode）。
 * - 两处测试缝隙：注册表与 factory 解析器可由 props 注入（缺省即产品路径），产品页面一个都不传。
 *
 * 本组件不读 store、不读 Storage、不做 i18n：环境事实与已解析的标题由页面填（谁能填谁填）。
 */
import {computed, ref, shallowRef, watch, type Component} from "vue";
import WorkbenchContainerSurface from "nbook/app/components/workbench/WorkbenchContainerSurface.vue";
import type {
    ContainerDescriptor,
    DescriptorResult,
    ViewDescriptor,
    WorkbenchContext,
    WorkbenchRegistry,
} from "nbook/app/utils/workbench/descriptors";
import {
    layoutContractOfViews,
    productWorkbenchRegistry,
    resolveContainerViews,
    type ContainerViewResolution,
} from "nbook/app/utils/workbench/product-catalog";
import {resolveWorkbenchViewFactory} from "nbook/app/utils/workbench/view-factories";

const props = defineProps<{
    container: ContainerDescriptor;
    /** 已解析的容器标题：注册表只存 key，解析归宿主（容器部件的合同）。 */
    containerTitle: string;
    context: WorkbenchContext;
    /** 测试注入的注册表；缺省用产品注册表。 */
    registry?: WorkbenchRegistry;
    /** 测试注入的 factory 解析器；缺省用产品白名单（`view-factories.ts`）。 */
    viewFactoryResolver?: (factoryKey: string) => DescriptorResult<Component>;
}>();

function failedResolution(problem: string): ContainerViewResolution {
    return {views: [], problems: [problem], hidden: []};
}

const resolution = computed<ContainerViewResolution>(() => {
    if (props.registry !== undefined) {
        return resolveContainerViews(props.registry, props.container.id, props.context);
    }
    const registry = productWorkbenchRegistry();
    return registry.ok
        ? resolveContainerViews(registry.value, props.container.id, props.context)
        : failedResolution(registry.reason);
});

const views = computed<readonly ViewDescriptor[]>(() => resolution.value.views);
const problems = computed<readonly string[]>(() => resolution.value.problems);
const layoutMode = computed(() => layoutContractOfViews(views.value).mode);

/** 视图 id → 组件。重新求值时复用同一批引用，避免已挂载的视图被换身份重建。 */
const components = shallowRef<Readonly<Record<string, Component>>>({});
const factoryProblems = ref<Readonly<Record<string, string>>>({});

watch(resolution, (current) => {
    const resolveFactory = props.viewFactoryResolver ?? resolveWorkbenchViewFactory;
    const nextComponents: Record<string, Component> = {};
    const nextProblems: Record<string, string> = {};
    for (const view of current.views) {
        const known = components.value[view.id];
        if (known !== undefined) {
            nextComponents[view.id] = known;
            continue;
        }
        const factory = resolveFactory(view.factoryKey);
        if (factory.ok) {
            nextComponents[view.id] = factory.value;
        } else {
            nextProblems[view.id] = factory.reason;
        }
    }
    components.value = nextComponents;
    factoryProblems.value = nextProblems;
}, {immediate: true});

/** 没有可见视图时的说明：直接用 `when` 求值给出的原因（可见性不是权限，也不会被说成权限）。 */
const emptyText = computed(() => {
    const reasons = resolution.value.hidden.flatMap((entry) => entry.reasons);
    return [...new Set(reasons)].join("；");
});
</script>

<template>
    <WorkbenchContainerSurface :container="container" :title="containerTitle" :layout="layoutMode">
        <div class="workbench-view-host" data-view-host>
            <p v-for="problem in problems" :key="problem" class="workbench-view-host__note" role="status">{{ problem }}</p>

            <div v-for="view in views" :key="view.id" class="workbench-view-host__view" :data-view="view.id">
                <component :is="components[view.id]" v-if="components[view.id]" />
                <p v-else class="workbench-view-host__note" role="status">{{ factoryProblems[view.id] }}</p>
            </div>

            <p v-if="views.length === 0 && problems.length === 0" class="workbench-view-host__empty">{{ emptyText }}</p>
        </div>
    </WorkbenchContainerSurface>
</template>

<style scoped>
.workbench-view-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
}

/* 视图自己占满内容区（`layout: fill` 的合同）：外壳不给留白、不代管滚动。 */
.workbench-view-host__view {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

.workbench-view-host__note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--status-warning);
}

.workbench-view-host__empty {
    margin: 0;
    padding: var(--space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
}
</style>
