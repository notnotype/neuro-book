<script setup lang="ts">
/**
 * 状态栏：左侧计数，右侧布局摘要（收起的位置点一下即可展开）。
 */
import {computed} from "vue";
import {labelOf} from "./descriptors";
import {SPIKE_LOCATION_LABELS, SPIKE_LOCATIONS, type SpikeCatalog, type SpikeLayoutState} from "./layout";

const props = defineProps<{
    state: SpikeLayoutState;
    catalog: SpikeCatalog;
}>();

const emit = defineEmits<{
    (event: "toggle-collapse", leafId: string): void;
}>();

const layoutSummary = computed(() => SPIKE_LOCATIONS.map((location) => {
    const item = props.catalog.containers.find((entry) => entry.id === props.state.activeContainer[location]);
    const title = item ? labelOf(item.titleKey) : "没有容器";
    return {location, text: `${SPIKE_LOCATION_LABELS[location]}：${title}${props.state.collapsed.includes(location) ? "（已收起）" : ""}`, collapsed: props.state.collapsed.includes(location), title};
}));
</script>

<template>
    <div class="flex h-full items-center justify-between gap-[var(--space-4)] bg-[var(--bg-subtle)] px-[var(--space-3)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        <span class="shrink-0">{{ catalog.views.length }} 个视图 · {{ catalog.containers.length }} 个容器</span>
        <span class="flex min-w-0 items-center gap-[var(--space-2)]">
            <template v-for="item in layoutSummary" :key="item.location">
                <button
                    v-if="item.collapsed"
                    type="button"
                    class="nb-ui-focus-ring flex h-[var(--control-h-sm)] shrink-0 cursor-pointer items-center rounded-[var(--radius-control)] px-[var(--space-2)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :aria-label="'展开 ' + item.title"
                    @click="emit('toggle-collapse', item.location)"
                >
                    {{ item.text }}
                </button>
                <span v-else class="shrink-0">{{ item.text }}</span>
            </template>
        </span>
    </div>
</template>
