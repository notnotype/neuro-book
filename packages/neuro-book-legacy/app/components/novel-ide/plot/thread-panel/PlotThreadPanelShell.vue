<script setup lang="ts">
import PlotThreadDetailPanel from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadDetailPanel.vue";
import PlotThreadScenePanel from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadScenePanel.vue";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelDetail,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
    PlotThreadQuickSceneUpdate,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

const props = defineProps<{
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    chapters: PlotThreadPanelChapter[];
    selectedThreadId: string | null;
    selectedSceneId: string | null;
    detail: PlotThreadPanelDetail | null;
    diagnostics: string;
}>();

const emit = defineEmits<{
    (e: "selectThread", threadId: string): void;
    (e: "selectScene", sceneId: string): void;
    (e: "closeDetail"): void;
    (e: "createScene"): void;
    (e: "editThread"): void;
    (e: "editScene", sceneId: string): void;
    (e: "quickUpdateScene", payload: PlotThreadQuickSceneUpdate): void;
    (e: "openThreadMenu", event: MouseEvent): void;
    (e: "openSceneMenu", payload: {sceneId: string; event: MouseEvent}): void;
    (e: "openRootMenu", event: MouseEvent): void;
    (e: "reorderScenes", sceneIds: string[]): void;
}>();
</script>

<template>
    <!-- 侧边栏外层壳，结构对齐 NovelIdeToolPanel -->
    <aside class="z-10 flex h-full min-h-0 w-[340px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)] shadow-[0_28px_70px_color-mix(in_srgb,var(--shadow-color)_10%,transparent)]">
        <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
            <span class="text-[11px] font-medium tracking-[0.24em] text-[var(--text-secondary)]">
                剧情大纲
            </span>

            <div class="flex items-center gap-0.5">
                <button
                    type="button"
                    class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    title="新增 Scene"
                    @click="emit('createScene')"
                >
                    <span class="i-lucide-plus h-4 w-4"></span>
                </button>
                <button
                    type="button"
                    class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    title="编辑 Thread"
                    @click="emit('editThread')"
                >
                    <span class="i-lucide-pencil-line h-4 w-4"></span>
                </button>
                <button
                    type="button"
                    class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    title="Thread 菜单"
                    @click="emit('openThreadMenu', $event)"
                >
                    <span class="i-lucide-ellipsis h-4 w-4"></span>
                </button>
            </div>
        </div>

        <PlotThreadScenePanel
            :threads="props.threads"
            :scenes="props.scenes"
            :chapters="props.chapters"
            :selected-thread-id="props.selectedThreadId"
            :selected-scene-id="props.selectedSceneId"
            @select-thread="emit('selectThread', $event)"
            @select-scene="emit('selectScene', $event)"
            @create-scene="emit('createScene')"
            @edit-thread="emit('editThread')"
            @edit-scene="emit('editScene', $event)"
            @open-thread-menu="emit('openThreadMenu', $event)"
            @open-scene-menu="emit('openSceneMenu', $event)"
            @open-root-menu="emit('openRootMenu', $event)"
            @reorder-scenes="emit('reorderScenes', $event)"
        />

        <PlotThreadDetailPanel
            :chapters="props.chapters"
            :detail="props.detail"
            :diagnostics="props.diagnostics"
            @close="emit('closeDetail')"
            @update-scene="emit('quickUpdateScene', $event)"
        />
    </aside>
</template>
