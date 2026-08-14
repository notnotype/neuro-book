<script setup lang="ts">
import { DragDropProvider, KeyboardSensor, PointerSensor } from "@dnd-kit/vue";
import type { DragDropProviderEmits } from "@dnd-kit/vue";
import {isSortable} from "@dnd-kit/vue/sortable";
import DndTestVolumeCard from "nbook/app/components/dnd-test/DndTestVolumeCard.vue";
import { createDndTestVolumes } from "nbook/app/components/dnd-test/dnd-test.data";
import {
    applyChapterMove,
    applyVolumeMove,
    buildChapterOrder,
    cloneVolumes,
    ensureDragSelection,
    findChapterVolumeId,
    isChapterDragData,
    isVolumeDragData,
    resolveSelection,
} from "nbook/app/components/dnd-test/dnd-test.helpers";
import type { ChapterSelectionInput, TestVolume } from "nbook/app/components/dnd-test/dnd-test.types";

type DragStartPayload = DragDropProviderEmits["dragStart"][0];
type DragOverPayload = DragDropProviderEmits["dragOver"][0];
type DragEndPayload = DragDropProviderEmits["dragEnd"][0];

const volumes = ref<TestVolume[]>(createDndTestVolumes());
const selectedChapterIds = ref<string[]>([]);
const selectionAnchorId = ref("");
const volumeSnapshot = ref<TestVolume[] | null>(null);
const chapterSnapshot = ref<TestVolume[] | null>(null);
const activeChapterId = ref("");
const activeVolumeId = ref("");

const sensors = [
    PointerSensor.configure({
        activatorElements(source) {
            return [source.handle];
        },
    }),
    KeyboardSensor,
];

const dragDisabled = computed(() => false);
const chapterOrder = computed(() => buildChapterOrder(volumes.value));
const totalChapters = computed(() => volumes.value.reduce((sum, volume) => sum + volume.chapters.length, 0));
const expandedVolumeCount = computed(() => volumes.value.filter((volume) => volume.isExpanded).length);

/**
 * 计算选中章节在各篇中的分布。
 */
const selectedSummary = computed(() => {
    const selectionSet = new Set(selectedChapterIds.value);
    return volumes.value
        .map((volume) => ({
            volumeId: volume.id,
            title: volume.title,
            ids: volume.chapters.filter((chapter) => selectionSet.has(chapter.id)).map((chapter) => chapter.id),
        }))
        .filter((volume) => volume.ids.length > 0);
});

/**
 * 输出用于调试的简化树。
 */
const treePreview = computed(() => volumes.value.map((volume) => ({
    id: volume.id,
    title: volume.title,
    chapters: volume.chapters.map((chapter) => chapter.id),
})));

/**
 * 计算当前拖拽提示文案。
 */
const dragHint = computed(() => {
    if (activeChapterId.value) {
        const isBatchDrag = selectedChapterIds.value.includes(activeChapterId.value);
        const label = isBatchDrag ? `${selectedChapterIds.value.length} 个章节批量拖拽中` : `正在拖拽章节 ${activeChapterId.value}`;
        const currentVolumeId = findChapterVolumeId(volumes.value, activeChapterId.value);
        return `${label} · 当前所在篇 ${currentVolumeId || "-"}`;
    }

    if (activeVolumeId.value) {
        return `正在拖拽篇 ${activeVolumeId.value}`;
    }

    return "当前无拖拽操作";
});

/**
 * 切换篇展开状态。
 */
const toggleVolume = (volumeId: string): void => {
    volumes.value = volumes.value.map((volume) => volume.id === volumeId ? { ...volume, isExpanded: !volume.isExpanded } : volume);
};

/**
 * 重置预览数据。
 */
const resetData = (): void => {
    volumes.value = createDndTestVolumes();
    selectedChapterIds.value = [];
    selectionAnchorId.value = "";
    volumeSnapshot.value = null;
    chapterSnapshot.value = null;
    activeChapterId.value = "";
    activeVolumeId.value = "";
};

/**
 * 清空章节选区。
 */
const clearSelection = (): void => {
    selectedChapterIds.value = [];
    selectionAnchorId.value = "";
};

/**
 * 处理章节选择、多选与连选。
 */
const handleSelectChapter = (input: ChapterSelectionInput): void => {
    const nextSelection = resolveSelection(
        chapterOrder.value,
        selectedChapterIds.value,
        selectionAnchorId.value,
        input,
    );

    selectedChapterIds.value = nextSelection.selectedIds;
    selectionAnchorId.value = nextSelection.anchorId;
};

/**
 * 拖拽章节前，确保激活项已进入选区。
 */
const prepareChapterDrag = (chapterId: string): void => {
    selectedChapterIds.value = ensureDragSelection(chapterOrder.value, selectedChapterIds.value, chapterId);
    selectionAnchorId.value = chapterId;
};

/**
 * 在拖拽开始时记录回滚快照。
 */
const handleDragStart = (event: DragStartPayload): void => {
    const source = event.operation.source;

    if (!source || !isSortable(source)) {
        volumeSnapshot.value = null;
        chapterSnapshot.value = null;
        return;
    }

    if (isVolumeDragData(source.data)) {
        activeVolumeId.value = source.data.volumeId;
        activeChapterId.value = "";
        volumeSnapshot.value = cloneVolumes(volumes.value);
        chapterSnapshot.value = null;
        return;
    }

    if (isChapterDragData(source.data)) {
        prepareChapterDrag(source.data.chapterId);
        activeChapterId.value = source.data.chapterId;
        activeVolumeId.value = "";
        chapterSnapshot.value = cloneVolumes(volumes.value);
        volumeSnapshot.value = null;
        return;
    }

    volumeSnapshot.value = null;
    chapterSnapshot.value = null;
};

/**
 * 在 dragOver 阶段实时同步排序状态。
 */
const handleDragOver = (event: DragOverPayload): void => {
    const source = event.operation.source;
    const target = event.operation.target;

    if (dragDisabled.value || !source || !isSortable(source) || !target || !isSortable(target)) {
        event.preventDefault();
        return;
    }

    if (isVolumeDragData(source.data)) {
        if (!isVolumeDragData(target.data)) {
            event.preventDefault();
            return;
        }

        volumes.value = applyVolumeMove(volumes.value, event);
        return;
    }

    if (isChapterDragData(source.data)) {
        if (!isChapterDragData(target.data) && !isVolumeDragData(target.data)) {
            event.preventDefault();
            return;
        }

        volumes.value = applyChapterMove(
            volumes.value,
            source.data.chapterId,
            selectedChapterIds.value,
            target.data,
        );
        return;
    }

    event.preventDefault();
};

/**
 * 在拖拽结束时决定保留结果还是回滚。
 */
const handleDragEnd = (event: DragEndPayload): void => {
    const source = event.operation.source;
    const target = event.operation.target;

    if (!source || !isSortable(source)) {
        resetSnapshots();
        return;
    }

    if (isVolumeDragData(source.data)) {
        if (event.canceled || !target) {
            volumes.value = cloneVolumes(volumeSnapshot.value ?? volumes.value);
        }
        resetSnapshots();
        return;
    }

    if (isChapterDragData(source.data)) {
        if (event.canceled || !target) {
            volumes.value = cloneVolumes(chapterSnapshot.value ?? volumes.value);
        }
        resetSnapshots();
        return;
    }

    resetSnapshots();
};

/**
 * 清理拖拽过程中的状态快照。
 */
const resetSnapshots = (): void => {
    volumeSnapshot.value = null;
    chapterSnapshot.value = null;
    activeChapterId.value = "";
    activeVolumeId.value = "";
};
</script>

<template>
    <!-- DND 预览页根容器 -->
    <div class="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)] text-slate-900">
        <!-- 页面头部 -->
        <header class="mx-auto max-w-[1440px] px-6 pb-4 pt-8 lg:px-8">
            <div class="rounded-[36px] border border-white/80 bg-white/78 px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div class="max-w-[760px]">
                        <div class="text-[11px] font-semibold uppercase tracking-[0.36em] text-sky-700">dnd preview playground</div>
                        <h1 class="mt-3 font-serif text-3xl font-bold tracking-[0.04em] text-slate-950">篇章管理拖拽预览页</h1>
                        <p class="mt-3 text-sm leading-7 text-slate-600">
                            这里直接复用真实的拖拽组件与排序逻辑，用来独立预览篇排序、跨篇章节移动、批量选择和拖拽反馈。适合在不进入完整 IDE 的情况下快速检查交互细节。
                        </p>
                        <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span class="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-semibold text-sky-700">Route /dnd.preview</span>
                            <span class="rounded-full border border-slate-200 bg-white px-3 py-1">真实组件预览</span>
                            <span class="rounded-full border border-slate-200 bg-white px-3 py-1">支持多选与批量拖拽</span>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-3">
                        <button class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50" @click="clearSelection">
                            清空选区
                        </button>
                        <button class="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-88" @click="resetData">
                            重置预览数据
                        </button>
                    </div>
                </div>

                <div class="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-4">
                    <div class="rounded-[22px] border border-slate-200/80 bg-white/90 px-4 py-3">
                        <div class="text-[11px] uppercase tracking-[0.24em] text-slate-400">模块规模</div>
                        <div class="mt-2 text-lg font-semibold text-slate-950">{{ volumes.length }} 篇 / {{ totalChapters }} 章</div>
                    </div>
                    <div class="rounded-[22px] border border-slate-200/80 bg-white/90 px-4 py-3">
                        <div class="text-[11px] uppercase tracking-[0.24em] text-slate-400">展开状态</div>
                        <div class="mt-2 text-lg font-semibold text-slate-950">{{ expandedVolumeCount }} / {{ volumes.length }} 已展开</div>
                    </div>
                    <div class="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                        <div class="text-[11px] uppercase tracking-[0.24em] text-slate-400">选择规则</div>
                        <div class="mt-2 leading-6">点击单选，`Ctrl/Cmd` 增减选中，`Shift` 按当前可见顺序连选。</div>
                    </div>
                    <div class="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                        <div class="text-[11px] uppercase tracking-[0.24em] text-slate-400">拖拽规则</div>
                        <div class="mt-2 leading-6">若拖拽的章节已在选区内，则整组选中章节一起移动；否则仅拖动当前章节。</div>
                    </div>
                </div>
            </div>
        </header>

        <!-- 页面主体 -->
        <main class="mx-auto grid max-w-[1440px] gap-6 px-6 pb-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
            <!-- 左侧拖拽预览面板 -->
            <section class="rounded-[36px] border border-white/80 bg-white/70 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                <div class="flex items-center justify-between gap-3 border-b border-slate-200/80 px-2 pb-4">
                    <div>
                        <div class="text-lg font-bold text-slate-950">拖拽预览面板</div>
                        <div class="mt-1 text-sm text-slate-500">{{ volumes.length }} 篇 / {{ totalChapters }} 章 / 已选 {{ selectedChapterIds.length }} 章</div>
                    </div>
                    <div class="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                        {{ dragHint }}
                    </div>
                </div>

                <DragDropProvider
                    :sensors="sensors"
                    @drag-start="handleDragStart"
                    @drag-over="handleDragOver"
                    @drag-end="handleDragEnd"
                >
                    <!-- 可滚动篇列表 -->
                    <div class="mt-4 max-h-[calc(100vh-260px)] space-y-4 overflow-y-auto pr-1">
                        <DndTestVolumeCard
                            v-for="(volume, index) in volumes"
                            :key="volume.id"
                            :volume="volume"
                            :index="index"
                            :selected-chapter-ids="selectedChapterIds"
                            :drag-disabled="dragDisabled"
                            @toggle="toggleVolume"
                            @select-chapter="handleSelectChapter"
                            @prepare-chapter-drag="prepareChapterDrag"
                        />
                    </div>
                </DragDropProvider>
            </section>

            <!-- 右侧调试面板 -->
            <aside class="space-y-4">
                <section class="rounded-[32px] border border-white/80 bg-white/72 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">预览目标</div>
                    <div class="mt-4 grid gap-3 sm:grid-cols-2">
                        <div class="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                            验证批量选择、跨篇移动和回滚是否符合预期。
                        </div>
                        <div class="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                            观察拖拽中的提示文案、空篇落点和排序结果快照。
                        </div>
                    </div>
                </section>

                <section class="rounded-[32px] border border-white/80 bg-slate-950 p-5 text-slate-50 shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.3em] text-sky-300">selection</div>
                    <div class="mt-3 text-2xl font-bold">{{ selectedChapterIds.length }}</div>
                    <div class="mt-1 text-sm text-slate-300">当前选中章节数</div>
                    <div class="mt-4 rounded-[20px] bg-white/6 p-3 text-xs leading-6 text-slate-200">
                        {{ selectedChapterIds.length > 0 ? selectedChapterIds.join("、") : "暂无选中章节" }}
                    </div>
                </section>

                <section class="rounded-[32px] border border-white/80 bg-white/72 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">选区分布</div>
                    <div v-if="selectedSummary.length > 0" class="mt-4 space-y-3">
                        <div v-for="item in selectedSummary" :key="item.volumeId" class="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                            <div class="text-sm font-semibold text-slate-900">{{ item.title }}</div>
                            <div class="mt-1 text-xs leading-6 text-slate-500">{{ item.ids.join("、") }}</div>
                        </div>
                    </div>
                    <div v-else class="mt-4 rounded-[20px] border border-dashed border-slate-300 px-4 py-6 text-sm leading-6 text-slate-500">
                        还没有选区。先点击章节，或使用 `Shift` / `Ctrl(Cmd)` 组合进行多选测试。
                    </div>
                </section>

                <section class="rounded-[32px] border border-white/80 bg-white/72 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">树结构预览</div>
                    <pre class="mt-4 overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">{{ JSON.stringify(treePreview, null, 2) }}</pre>
                </section>
            </aside>
        </main>
    </div>
</template>
