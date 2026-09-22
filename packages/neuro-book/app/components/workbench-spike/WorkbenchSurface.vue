<script setup lang="ts">
/**
 * 工作台表面的**组装层**：按 `leafId` 分派到四个单根表面组件，并把 props / emit 原样透传。
 *
 * - `activity`：两条活动栏（WorkbenchActivityBar）；
 * - `sidebar-left` / `sidebar-right` / `panel`：当前活动容器（WorkbenchContainerSurface）；
 * - `editor`：标签条 + 空白页（WorkbenchEditorSurface）；`statusbar`：计数 + 布局摘要（WorkbenchStatusBar）。
 *
 * 本层不持有界面状态、不做落点判定：容器与视图清单由组装根（WorkbenchSpike.vue）以 `catalog` 注入，
 * 状态改动一律 emit 出去由父组件落账。
 */
import {computed} from "vue";
import type {SpikeContainerDescriptor} from "./descriptors";
import type {SpikeCatalog, SpikeLayoutState, SpikeLocation} from "./layout";
import type {FactoryResolution} from "./factories";
import WorkbenchActivityBar from "./WorkbenchActivityBar.vue";
import WorkbenchContainerSurface from "./WorkbenchContainerSurface.vue";
import WorkbenchEditorSurface from "./WorkbenchEditorSurface.vue";
import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";

const props = defineProps<{
    leafId: string;
    state: SpikeLayoutState;
    catalog: SpikeCatalog;
    factoryStates: Record<string, FactoryResolution>;
    authority: Record<string, {actionable: boolean; reason?: string}>;
    visibility: Record<string, {visible: boolean; reason?: string}>;
}>();

const emit = defineEmits<{
    (event: "toggle-collapse", leafId: string): void;
    (event: "set-active-container", location: SpikeLocation, containerId: string): void;
    (event: "drag-view", viewId: string, containerId: string, index: number): void;
}>();

const container = computed<SpikeContainerDescriptor | null>(
    () => props.catalog.containers.find((item) => item.id === props.state.activeContainer[props.leafId as SpikeLocation]) ?? null,
);

function onToggleCollapse(leafId: string) {
    emit("toggle-collapse", leafId);
}

function onSetActiveContainer(location: SpikeLocation, containerId: string) {
    emit("set-active-container", location, containerId);
}

function onDragView(viewId: string, containerId: string, index: number) {
    emit("drag-view", viewId, containerId, index);
}
</script>

<template>
    <!-- 单根包装：多根组件的 class / attrs 会被静默丢弃；各表面组件各占这个列容器的一格 -->
    <div class="flex h-full min-h-0 min-w-0 flex-col">
        <WorkbenchActivityBar
            v-if="leafId === 'activity'"
            :state="state"
            :catalog="catalog"
            @toggle-collapse="onToggleCollapse"
            @set-active-container="onSetActiveContainer"
        />

        <div v-else class="min-h-0 min-w-0 flex-1">
            <WorkbenchContainerSurface
                v-if="container"
                :leaf-id="leafId"
                :container="container"
                :state="state"
                :catalog="catalog"
                :factory-states="factoryStates"
                :authority="authority"
                :visibility="visibility"
                @toggle-collapse="onToggleCollapse"
                @drag-view="onDragView"
            />

            <WorkbenchEditorSurface v-else-if="leafId === 'editor'" />

            <WorkbenchStatusBar v-else-if="leafId === 'statusbar'" :state="state" :catalog="catalog" @toggle-collapse="onToggleCollapse" />

            <p v-else class="p-[var(--space-4)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">这个位置没有可显示的容器：{{ leafId }}</p>
        </div>
    </div>
</template>
