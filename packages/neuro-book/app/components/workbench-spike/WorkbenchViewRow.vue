<script setup lang="ts">
/**
 * 视图行：标题区（图标 / 标题 / layout 徽标 / 动作占位）+ 正文区。
 * 三态由调用方判定，本组件只负责呈现；拖拽只负责起手（落点判定在容器正文那一侧）。
 */
import {ref} from "vue";
import {labelOf, type SpikeViewDescriptor} from "./descriptors";

const props = defineProps<{
    view: SpikeViewDescriptor;
    state: "ok" | "error" | "unavailable";
    detail: string;
    draggable: boolean;
}>();

const emit = defineEmits<{
    (event: "drag-start", viewId: string): void;
}>();

const dragging = ref(false);

function onDragStart(event: DragEvent) {
    if (!event.dataTransfer) {
        return;
    }
    event.dataTransfer.setData("text/x-nb-view", props.view.id);
    event.dataTransfer.effectAllowed = "move";
    dragging.value = true;
    emit("drag-start", props.view.id);
}
</script>

<template>
    <div
        class="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[var(--divider)] bg-[var(--bg-subtle)] transition-opacity [transition-duration:var(--motion-fast)]"
        :class="dragging ? 'opacity-60' : ''"
        :draggable="draggable"
        role="listitem"
        :data-view-row="view.id"
        @dragstart="onDragStart"
        @dragend="dragging = false"
    >
        <div class="flex shrink-0 items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-2)]">
            <span :class="view.icon" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
            <span class="truncate text-[length:var(--text-xs)] text-[var(--text-main)]">{{ labelOf(view.titleKey) }}</span>
            <span class="shrink-0 rounded-[var(--radius-pill)] bg-[var(--bg-hover)] px-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ view.layout }}</span>
            <button
                type="button"
                class="nb-ui-focus-ring ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :aria-label="labelOf(view.titleKey)"
            >
                <span class="i-lucide-ellipsis-vertical h-3.5 w-3.5" aria-hidden="true"></span>
            </button>
        </div>

        <p v-if="state === 'error'" class="px-[var(--space-2)] pb-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--status-danger)]">{{ detail }}</p>
        <p v-else-if="state === 'unavailable'" class="px-[var(--space-2)] pb-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--status-warning)]">动作不可用：{{ detail }}</p>
        <p v-else class="px-[var(--space-2)] pb-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--text-secondary)]">{{ detail }}</p>

        <div class="flex min-h-0 flex-1 flex-col px-[var(--space-2)] pb-[var(--space-2)]" :aria-disabled="state === 'unavailable'">
            <div
                v-if="view.layout === 'scroll'"
                class="flex flex-col gap-[var(--space-2)] overflow-y-auto p-[var(--space-2)]"
                :class="state === 'unavailable' ? 'opacity-40' : ''"
            >
                <p v-for="index in 3" :key="index" class="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">占位条目 {{ index }}</p>
            </div>
            <div
                v-else
                class="flex min-h-0 flex-1 flex-col gap-[var(--space-2)] overflow-y-auto rounded-[var(--radius-control)] border-[length:var(--border-w)] border-[var(--divider)] bg-[var(--bg-panel)] p-[var(--space-3)]"
                :class="state === 'unavailable' ? 'opacity-40' : ''"
            >
                <p v-for="index in 8" :key="index" class="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">占位条目 {{ index }}</p>
            </div>
        </div>
    </div>
</template>
