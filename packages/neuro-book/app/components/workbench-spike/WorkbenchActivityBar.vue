<script setup lang="ts">
/**
 * 活动栏：一个叶子装两条，主侧栏那条管主侧栏容器、右侧栏那条管右侧栏容器；选中态即「该位置当前显示的容器」。
 * 点击非活动项 → 该位置切换到该容器；点击活动项 → 切换该位置的收起（与容器头的收起按钮同一行为）。
 */
import {computed} from "vue";
import {labelOf} from "./descriptors";
import {SIDEBAR_LOCATIONS, SPIKE_LOCATION_LABELS, type SpikeCatalog, type SpikeLayoutState, type SpikeLocation} from "./layout";

const props = defineProps<{
    state: SpikeLayoutState;
    catalog: SpikeCatalog;
}>();

const emit = defineEmits<{
    (event: "toggle-collapse", leafId: string): void;
    (event: "set-active-container", location: SpikeLocation, containerId: string): void;
}>();

/** 活动栏的两条：容器按 descriptor 的默认位置分组，面板容器不在这里（走面板标签条）。 */
const activityGroups = computed(() => SIDEBAR_LOCATIONS.map((location) => ({
    location,
    label: SPIKE_LOCATION_LABELS[location],
    containers: props.catalog.containers.filter((item) => item.location === location),
})));

function onActivityClick(location: SpikeLocation, containerId: string) {
    if (props.state.activeContainer[location] === containerId) {
        emit("toggle-collapse", location);
        return;
    }
    emit("set-active-container", location, containerId);
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col items-center bg-[var(--bg-subtle)] py-[var(--space-4)]">
        <div
            v-for="(group, groupIndex) in activityGroups"
            :key="group.location"
            class="flex flex-col items-center gap-[var(--space-2)]"
            :class="groupIndex > 0 ? 'mt-auto border-t-[length:var(--border-w)] border-[var(--divider)] pt-[var(--space-4)]' : ''"
            role="group"
            :aria-label="group.label"
            :data-activity-group="group.location"
        >
            <button
                v-for="item in group.containers"
                :key="item.id"
                type="button"
                class="nb-ui-focus-ring flex h-[var(--control-h-md)] w-[var(--control-h-md)] cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :class="state.activeContainer[group.location] === item.id ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : ''"
                :title="labelOf(item.titleKey)"
                :aria-pressed="state.activeContainer[group.location] === item.id"
                :data-activity-item="item.id"
                @click="onActivityClick(group.location, item.id)"
            >
                <span :class="item.icon" class="h-4 w-4" aria-hidden="true"></span>
            </button>
        </div>
    </div>
</template>
