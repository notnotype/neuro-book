<script setup lang="ts">
import {useSortable} from "@dnd-kit/vue/sortable";
import {
    PLOT_SCENE_STATUS_LABELS,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelScene,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

const props = defineProps<{
    scene: PlotThreadPanelScene;
    index: number;
    threadId: string;
    selected: boolean;
    dragDisabled: boolean;
    chapter: PlotThreadPanelChapter | null;
}>();

const emit = defineEmits<{
    (e: "select", sceneId: string): void;
    (e: "openEditor", sceneId: string): void;
    (e: "openMenu", payload: {sceneId: string; event: MouseEvent}): void;
}>();

const elementRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);

/**
 * 注册 Scene 排序能力。
 */
const {isDragging, isDropTarget} = useSortable({
    id: computed(() => props.scene.id),
    index: computed(() => props.index),
    group: computed(() => props.threadId),
    type: "scene",
    accept: "scene",
    data: computed(() => ({
        kind: "scene" as const,
        sceneId: props.scene.id,
        threadId: props.threadId,
    })),
    element: elementRef,
    handle: handleRef,
    disabled: computed(() => props.dragDisabled),
});

const hasWorldAnchor = computed(() => {
    const anchor = props.scene.worldAnchor;
    return Boolean(
        anchor.startTime ||
        anchor.endTime ||
        anchor.startInstant ||
        anchor.endInstant ||
        anchor.subjectIds.length ||
        anchor.locationSubjectId,
    );
});
</script>

<template>
    <!-- 可拖拽 Scene 行 -->
    <div
        ref="elementRef"
        :data-scene-id="scene.id"
        :data-dragging="isDragging || undefined"
        :data-drop-target="isDropTarget || undefined"
        class="plot-thread-scene-row flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors"
        :class="selected
            ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]'
            : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)]'"
        @click="emit('select', scene.id)"
        @contextmenu.prevent.stop="emit('openMenu', { sceneId: scene.id, event: $event })"
    >
        <button
            ref="handleRef"
            type="button"
            class="mt-0.5 inline-flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--text-muted)] opacity-55 transition-colors hover:bg-[var(--bg-hover)] hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
            :disabled="dragDisabled"
            title="拖拽排序 Scene"
            @click.stop
        >
            <span class="i-lucide-grip-vertical h-3 w-3"></span>
        </button>

        <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="truncate text-[12px] font-semibold leading-5 text-[var(--text-main)]">{{ scene.title }}</div>
                    <div class="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">{{ scene.summary }}</div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <span class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                        #{{ scene.threadSortOrder + 1 }}
                    </span>
                    <button
                        type="button"
                        class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                        title="编辑 Scene"
                        @click.stop="emit('openEditor', scene.id)"
                    >
                        <span class="i-lucide-pencil-line h-3 w-3"></span>
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                        title="Scene 菜单"
                        @click.stop="emit('openMenu', { sceneId: scene.id, event: $event })"
                    >
                        <span class="i-lucide-ellipsis h-3 w-3"></span>
                    </button>
                </div>
            </div>

            <div class="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <span class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5">{{ PLOT_SCENE_STATUS_LABELS[scene.status] }}</span>
                <span v-if="chapter" class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5">{{ chapter.numberLabel }}</span>
                <span v-else class="rounded-full border border-dashed border-[var(--border-color)] px-1.5 py-0.5">未挂章</span>
                <span v-if="scene.purpose" class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5">目的</span>
                <span class="rounded-full border px-1.5 py-0.5" :class="hasWorldAnchor ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-dashed border-[var(--border-color)]'">
                    {{ hasWorldAnchor ? "World" : "未连接 World" }}
                </span>
                <span class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5">R {{ scene.refs.length }}</span>
                <span class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5">
                    C {{ scene.chapterSortOrder === null ? "-" : scene.chapterSortOrder + 1 }}
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.plot-thread-scene-row[data-dragging="true"] {
    transform: rotate(0.35deg);
}

.plot-thread-scene-row[data-drop-target="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 45%, transparent);
}
</style>
