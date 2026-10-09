<script setup lang="ts">
/**
 * 容器的内部排列（同名 .md）：单轴网格，每个可见视图一个分节；视图内容由宿主搬进分节里的落点，落点经 `target` 报出。
 */
import {GridRenderer} from "@notnotype/nb-ui/layout";
import {useGridLayout, useLayoutExtent} from "@notnotype/nb-ui/composables";
import {computed, defineComponent, h, onBeforeUnmount, onMounted, ref} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {containerSizePatch, createContainerGrid} from "../views/container-grid";
import type {ContainerPresentation} from "../views/presentation";
import WorkbenchViewSection from "./WorkbenchViewSection.vue";

defineOptions({name: "WorkbenchViewContainerHost"});

const props = withDefaults(defineProps<{
    container: ContainerPresentation;
    contextKey: string;
    disabled?: boolean;
    collapseLabel: string;
    expandLabel: string;
    /** 分节标题把手的可访问名称模板，`{title}` 换成视图标题。 */
    dragLabel: string;
    locale: DisplayLocale;
}>(), {disabled: false});

const emit = defineEmits<{
    (event: "resize", payload: {containerId: string; axis: "vertical" | "horizontal"; sizes: Record<string, number>}): void;
    (event: "toggle-collapsed", viewId: string, collapsed: boolean): void;
    (event: "target", viewId: string, element: HTMLElement | null): void;
}>();

defineSlots<{
    "view-actions"?(props: {viewId: string}): unknown;
    empty?(): unknown;
}>();

const rootEl = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(rootEl);
const grid = computed(() => createContainerGrid(props.container));
const views = computed(() => new Map(props.container.views.map((view) => [view.id, view])));

const host = useGridLayout({
    grid,
    extent,
    contextKey: () => props.contextKey,
    onApplied: (commit) => {
        const sizes = containerSizePatch(props.container, commit);
        if (Object.keys(sizes).length > 0) emit("resize", {containerId: props.container.id, axis: props.container.axis, sizes});
    },
});

/** 分节的标题行高度：multiple 才有。 */
const HEADER_PX = 32;

/**
 * 分节正文此刻有没有空间：网格降级把叶压到不足标题行时正文是 0px，这时不给落点，视图内容退回实例层的停放区
 * （不进 Tab 顺序、`visible` 为 false），而不是留在看不见的 0px 盒子里。
 */
function hasSpace(viewId: string): boolean {
    const size = host.layout.value.sizes[viewId];
    if (size === undefined) return false;
    const header = props.container.mode === "multiple" ? HEADER_PX : 0;
    const main = props.container.axis === "horizontal" ? size.width : size.height - header;
    const cross = props.container.axis === "horizontal" ? size.height - header : size.width;
    return main > 0 && cross > 0;
}

/**
 * 每个视图当前的落点元素。落点由一个小组件在挂上、卸下时各报一次自己的元素：分节重建时新旧落点的先后不定，卸下时
 * 只有卸下的正是当前落点才报 null，避免把新落点覆盖掉。
 */
const targets = new Map<string, HTMLElement>();
function mounted(viewId: string, element: HTMLElement): void {
    targets.set(viewId, element);
    emit("target", viewId, element);
}
function unmounted(viewId: string, element: HTMLElement): void {
    if (targets.get(viewId) !== element) return;
    targets.delete(viewId);
    emit("target", viewId, null);
}

const ViewTarget = defineComponent({
    name: "WorkbenchViewTarget",
    props: {viewId: {type: String, required: true}},
    setup(targetProps) {
        const element = ref<HTMLElement | null>(null);
        onMounted(() => {
            if (element.value !== null) mounted(targetProps.viewId, element.value);
        });
        onBeforeUnmount(() => {
            if (element.value !== null) unmounted(targetProps.viewId, element.value);
        });
        return () => h("div", {"ref": element, "class": "workbench-view-container-host__target", "data-view-target": targetProps.viewId});
    },
});
</script>

<template>
    <div
        ref="rootEl"
        class="workbench-view-container-host"
        :data-container-host="container.id"
        :data-container-mode="container.mode"
        :data-container-axis="container.axis"
    >
        <GridRenderer
            v-if="host.node.value !== null"
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="disabled || extent === null"
            :context-key="contextKey"
            :revision="host.revision.value"
            :on-gesture-commit="host.onGestureCommit"
        >
            <template #leaf="{node}">
                <WorkbenchViewSection
                    v-if="views.get(node.id) !== undefined"
                    :view-id="node.id"
                    :title="localize(views.get(node.id)!.title, locale)"
                    :icon="views.get(node.id)!.icon"
                    :axis="container.axis"
                    :chrome="container.mode === 'multiple'"
                    :collapsed="views.get(node.id)!.collapsed"
                    :collapse-label="collapseLabel"
                    :expand-label="expandLabel"
                    :drag-label="dragLabel.replace('{title}', localize(views.get(node.id)!.title, locale))"
                    @toggle-collapsed="(collapsed: boolean) => emit('toggle-collapsed', node.id, collapsed)"
                >
                    <template #actions>
                        <slot name="view-actions" :view-id="node.id"></slot>
                    </template>
                    <ViewTarget v-if="hasSpace(node.id)" :view-id="node.id" />
                </WorkbenchViewSection>
            </template>
        </GridRenderer>
        <slot v-else name="empty"></slot>
    </div>
</template>

<style scoped>
.workbench-view-container-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

:deep(.workbench-view-container-host__target) {
    width: 100%;
    height: 100%;
    min-height: 0;
}
</style>
