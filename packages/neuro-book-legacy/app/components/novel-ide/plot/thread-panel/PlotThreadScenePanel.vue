<script setup lang="ts">
import type {Data} from "@dnd-kit/abstract";
import {move} from "@dnd-kit/helpers";
import {DragDropProvider, KeyboardSensor, PointerSensor} from "@dnd-kit/vue";
import type {DragDropProviderEmits} from "@dnd-kit/vue";
import {isSortable} from "@dnd-kit/vue/sortable";
import {computed, ref, watch} from "vue";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import {
    PLOT_THREAD_STATUS_LABELS,
    PLOT_THREAD_TONE_STYLES,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import PlotThreadSortableSceneRow from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadSortableSceneRow.vue";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

type DragStartPayload = DragDropProviderEmits["dragStart"][0];
type DragOverPayload = DragDropProviderEmits["dragOver"][0];
type DragEndPayload = DragDropProviderEmits["dragEnd"][0];

type SceneDragData = {
    kind: "scene";
    sceneId: string;
    threadId: string;
};

const props = defineProps<{
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    chapters: PlotThreadPanelChapter[];
    selectedThreadId: string | null;
    selectedSceneId: string | null;
}>();

const emit = defineEmits<{
    (e: "selectThread", threadId: string): void;
    (e: "selectScene", sceneId: string): void;
    (e: "createScene"): void;
    (e: "editThread"): void;
    (e: "editScene", sceneId: string): void;
    (e: "openThreadMenu", event: MouseEvent): void;
    (e: "openSceneMenu", payload: {sceneId: string; event: MouseEvent}): void;
    (e: "openRootMenu", event: MouseEvent): void;
    (e: "reorderScenes", sceneIds: string[]): void;
}>();

const dragScenes = ref<PlotThreadPanelScene[] | null>(null);
const dndSensors = [
    PointerSensor.configure({
        activatorElements(source) {
            return [source.handle];
        },
    }),
    KeyboardSensor,
];

/**
 * 当前选中的 Thread。
 */
const selectedThread = computed(() => {
    return props.threads.find((thread) => thread.id === props.selectedThreadId) ?? null;
});

/**
 * Thread 下拉菜单项。
 */
const threadItems = computed<DropdownItem[]>(() => {
    return props.threads.map((thread) => ({
        value: thread.id,
        label: thread.title,
        active: props.selectedThreadId === thread.id,
        iconClass: thread.isMainThread ? "i-lucide-star" : "i-lucide-waypoints",
        rightIconClass: thread.isMainThread ? "i-lucide-badge-check" : undefined,
    }));
});

/**
 * 章节索引。
 */
const chapterMap = computed(() => {
    return new Map(props.chapters.map((chapter) => [chapter.id, chapter]));
});

/**
 * 当前线程下按顺序显示的 Scene 列表。
 */
const visibleScenes = computed(() => {
    if (!props.selectedThreadId) {
        return [];
    }

    return props.scenes
        .filter((scene) => scene.threadId === props.selectedThreadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder);
});

/**
 * 当前是否禁用拖拽。
 */
const dragDisabled = computed(() => !props.selectedThreadId);

/**
 * 当前渲染的 Scene 列表。
 * 拖拽中使用本地乐观排序，平时直接使用 props。
 */
const renderedScenes = computed(() => dragScenes.value ?? visibleScenes.value);

/**
 * 判断是否为 Scene 拖拽数据。
 */
function isSceneDragData(data: Data | undefined): data is SceneDragData {
    return data?.kind === "scene"
        && typeof data.sceneId === "string"
        && typeof data.threadId === "string";
}

/**
 * 拖拽开始时记录当前列表快照。
 */
function handleDragStart(event: DragStartPayload): void {
    const source = event.operation.source;

    if (dragDisabled.value || !source || !isSortable(source) || !isSceneDragData(source.data)) {
        dragScenes.value = null;
        return;
    }

    dragScenes.value = [...visibleScenes.value];
}

/**
 * 拖拽经过时实时更新本地排序结果。
 */
function handleDragOver(event: DragOverPayload): void {
    const source = event.operation.source;
    const target = event.operation.target;

    if (dragDisabled.value || !source || !isSortable(source) || !isSceneDragData(source.data)) {
        event.preventDefault();
        return;
    }

    if (!target || !isSortable(target) || !isSceneDragData(target.data)) {
        event.preventDefault();
        return;
    }

    if (!dragScenes.value) {
        dragScenes.value = [...visibleScenes.value];
    }

    dragScenes.value = move(dragScenes.value, event) as PlotThreadPanelScene[];
}

/**
 * 拖拽结束后提交新的 Scene 顺序。
 */
function handleDragEnd(event: DragEndPayload): void {
    const source = event.operation.source;
    const nextScenes = dragScenes.value;
    dragScenes.value = null;

    if (dragDisabled.value || !source || !isSortable(source) || !isSceneDragData(source.data) || !nextScenes) {
        return;
    }

    if (event.canceled) {
        return;
    }

    const previousIds = visibleScenes.value.map((scene) => scene.id);
    const nextIds = nextScenes.map((scene) => scene.id);

    if (previousIds.length === nextIds.length && previousIds.every((sceneId, index) => sceneId === nextIds[index])) {
        return;
    }

    emit("reorderScenes", nextIds);
}

watch(() => [props.selectedThreadId, props.scenes], () => {
    dragScenes.value = null;
});
</script>

<template>
    <!-- 单 Thread 主列表区 -->
    <div class="min-h-0 flex flex-1 flex-col">
        <!-- 工具区 -->
        <div class="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-2">
            <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] font-medium tracking-[0.18em] text-[var(--text-secondary)]">THREAD</span>
                    <div class="flex items-center gap-1">
                        <button
                            type="button"
                            class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            title="新增 Scene"
                            @click="emit('createScene')"
                        >
                            <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                            :disabled="!selectedThread"
                            title="编辑 Thread"
                            @click="emit('editThread')"
                        >
                            <span class="i-lucide-pencil-line h-3.5 w-3.5"></span>
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            title="Thread 菜单"
                            @click="emit('openThreadMenu', $event)"
                        >
                            <span class="i-lucide-ellipsis h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>

                <Dropdown :items="threadItems" menu-class="left-0 top-full mt-1.5 w-full" @select="emit('selectThread', $event)">
                    <button
                        type="button"
                        class="flex w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    >
                        <span class="min-w-0">
                            <span class="block truncate text-[12px] font-semibold text-[var(--text-main)]">{{ selectedThread?.title ?? "选择 Thread" }}</span>
                            <span class="mt-0.5 block text-[10px] leading-none text-[var(--text-muted)]">
                                {{ selectedThread ? PLOT_THREAD_STATUS_LABELS[selectedThread.status] : "未选择" }}
                            </span>
                        </span>
                        <span class="ml-2 flex items-center gap-1.5">
                            <span
                                v-if="selectedThread"
                                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                                :class="selectedThread.isMainThread ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : PLOT_THREAD_TONE_STYLES[selectedThread.tone].chipClass"
                            >
                                {{ selectedThread.isMainThread ? "主线" : "支线" }}
                            </span>
                            <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                        </span>
                    </button>
                </Dropdown>

                <div v-if="selectedThread" class="flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <span
                        class="rounded-full px-1.5 py-0.5"
                        :class="selectedThread.isMainThread ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : PLOT_THREAD_TONE_STYLES[selectedThread.tone].chipClass"
                    >
                        {{ selectedThread.isMainThread ? "主线" : "支线" }}
                    </span>
                    <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                        {{ visibleScenes.length }} / {{ props.scenes.filter((scene) => scene.threadId === selectedThread?.id).length }} Scene
                    </span>
                    <span
                        v-for="tag in selectedThread.tags.slice(0, 2)"
                        :key="tag"
                        class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5"
                    >
                        {{ tag }}
                    </span>
                </div>

                <div v-if="selectedThread" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/55 px-2.5 py-2">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                                {{ selectedThread.summary || "当前 Thread 还没有摘要。" }}
                            </div>
                        </div>
                        <button
                            type="button"
                            class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            title="编辑 Thread"
                            @click="emit('editThread')"
                        >
                            <span class="i-lucide-square-pen h-3 w-3"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Scene 列表 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-1.5 custom-scrollbar" @contextmenu.prevent="emit('openRootMenu', $event)">
            <DragDropProvider
                v-if="renderedScenes.length"
                :sensors="dndSensors"
                @drag-start="handleDragStart"
                @drag-over="handleDragOver"
                @drag-end="handleDragEnd"
            >
                <div class="space-y-1.5">
                    <PlotThreadSortableSceneRow
                        v-for="(scene, index) in renderedScenes"
                        :key="scene.id"
                        :scene="scene"
                        :index="index"
                        :thread-id="props.selectedThreadId ?? 'thread-empty'"
                        :selected="props.selectedSceneId === scene.id"
                        :drag-disabled="dragDisabled"
                        :chapter="scene.chapterId ? (chapterMap.get(scene.chapterId) ?? null) : null"
                        @select="emit('selectScene', $event)"
                        @open-editor="emit('editScene', $event)"
                        @open-menu="emit('openSceneMenu', $event)"
                    />
                </div>
            </DragDropProvider>

            <div v-else-if="visibleScenes.length" class="space-y-1.5">
                <PlotThreadSortableSceneRow
                    v-for="(scene, index) in visibleScenes"
                    :key="scene.id"
                    :scene="scene"
                    :index="index"
                    :thread-id="props.selectedThreadId ?? 'thread-empty'"
                    :selected="props.selectedSceneId === scene.id"
                    :drag-disabled="true"
                    :chapter="scene.chapterId ? (chapterMap.get(scene.chapterId) ?? null) : null"
                    @select="emit('selectScene', $event)"
                    @open-editor="emit('editScene', $event)"
                    @open-menu="emit('openSceneMenu', $event)"
                />
            </div>

            <div v-else class="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/20 px-5 text-center">
                <span class="i-lucide-waypoints h-6 w-6 text-[var(--text-muted)]"></span>
                <div class="text-[12px] font-medium text-[var(--text-main)]">当前 Thread 还没有 Scene</div>
                <div class="text-[11px] leading-5 text-[var(--text-muted)]">可以先新增一个 Scene，或者切换到其他 Thread。</div>
            </div>
        </div>
    </div>
</template>
