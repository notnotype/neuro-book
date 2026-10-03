<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import SideDetailPanel from "nbook/app/components/common/SideDetailPanel.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import FormAnnotationDialog from "nbook/app/components/novel-ide/ai/FormAnnotationDialog.vue";
import {useDetailSession} from "nbook/app/composables/useDetailSession";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {
    PLOT_SCENE_STATUS_LABELS,
    PLOT_THREAD_TONE_STYLES,
    type PlotThreadPanelChapter,
    type PlotThreadPanelScene,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {
    SCENE_OUTCOME_TYPE_OPTIONS,
    SCENE_PACING_ROLE_OPTIONS,
    PLANNING_TONE_CLASSES,
    PROMISE_BEAT_KIND_META,
    PROMISE_BEAT_STATE_META,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {
    PlotThreadPanelDetail,
    PlotThreadQuickSceneUpdate,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {JsonObject} from "nbook/shared/dto/ai-form-annotation.dto";

type PlotThreadDraftSnapshot = {
    title: string;
    summary: string;
    purpose: string;
    writingTip: string;
    status: PlotThreadPanelScene["status"];
    chapterId: string;
};

const props = defineProps<{
    chapters: PlotThreadPanelChapter[];
    detail: PlotThreadPanelDetail | null;
    diagnostics: string;
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "edit"): void;
    (e: "updateScene", payload: PlotThreadQuickSceneUpdate): void;
    (e: "focusPromise", promiseId: string): void;
}>();

const panelHeight = ref(0);
const aiDialogOpen = ref(false);
const ideStore = useNovelIdeStore();
const {
    currentProjectRoot,
    selectedStoryThreadId,
    selectedStorySceneId,
} = storeToRefs(ideStore);
const {resolveMenu, menuRefreshKey} = useStructuredReferenceMenu({
    novelId: currentProjectRoot,
    selectedStoryThreadId,
    selectedStorySceneId,
});
const draft = reactive<PlotThreadDraftSnapshot>({
    title: "",
    summary: "",
    purpose: "",
    writingTip: "",
    status: "draft",
    chapterId: "",
});

const hasActivePanel = computed(() => Boolean(props.detail?.scene));
const toneClass = computed(() => {
    const thread = props.detail?.thread;
    if (!thread) {
        return "border-[var(--border-color)]";
    }

    return thread.isMainThread
        ? "border-[var(--border-accent)]"
        : PLOT_THREAD_TONE_STYLES[thread.tone].borderClass;
});
const refCount = computed(() => props.detail?.effectiveRefs.length ?? 0);
const chapterLabel = computed(() => {
    if (!props.detail?.chapter) {
        return "未挂章";
    }

    return `${props.detail.chapter.numberLabel} ${props.detail.chapter.title}`;
});
const detailHistoryKey = computed(() => props.detail?.scene ? `plot-scene:${props.detail.scene.id}` : "");
// 节奏字段只读标签(编辑走完整编辑器);为空表示未填写,不显示 chip。
const outcomeTypeLabel = computed(() => {
    const value = props.detail?.scene.outcomeType;
    return value ? (SCENE_OUTCOME_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value) : null;
});
const pacingRoleLabel = computed(() => {
    const value = props.detail?.scene.pacingRole;
    return value ? (SCENE_PACING_ROLE_OPTIONS.find((option) => option.value === value)?.label ?? value) : null;
});
const {
    isDirty,
    canUndo: canRollback,
    applyServerValue,
    resetSession,
    pushUndo,
    markSaved,
    undo,
} = useDetailSession({
    historyKey: detailHistoryKey,
    createSnapshot: createDraftSnapshot,
    applySnapshot: (snapshot) => {
        const previousDraft = JSON.parse(snapshot) as PlotThreadDraftSnapshot;
        draft.title = previousDraft.title;
        draft.summary = previousDraft.summary;
        draft.purpose = previousDraft.purpose;
        draft.writingTip = previousDraft.writingTip;
        draft.status = previousDraft.status;
        draft.chapterId = previousDraft.chapterId;
    },
});
const annotationDraft = computed<JsonObject>(() => ({
    title: draft.title,
    status: draft.status,
    chapterId: draft.chapterId || null,
    summary: draft.summary,
    purpose: draft.purpose || null,
    writingTip: draft.writingTip || null,
}));

/**
 * 构造本地草稿快照。
 */
function createDraftSnapshot(): string {
    return JSON.stringify({
        title: draft.title,
        summary: draft.summary,
        purpose: draft.purpose,
        writingTip: draft.writingTip,
        status: draft.status,
        chapterId: draft.chapterId,
    } satisfies PlotThreadDraftSnapshot);
}

/**
 * 把 Scene 同步到本地草稿。
 */
function syncDraft(): void {
    const scene = props.detail?.scene;
    if (!scene) {
        draft.title = "";
        draft.summary = "";
        draft.purpose = "";
        draft.writingTip = "";
        draft.status = "draft";
        draft.chapterId = "";
        resetSession();
        return;
    }

    draft.title = scene.title;
    draft.summary = scene.summary;
    draft.purpose = scene.purpose ?? "";
    draft.writingTip = scene.writingTip ?? "";
    draft.status = scene.status;
    draft.chapterId = scene.chapterId ?? "";
    applyServerValue(createDraftSnapshot());
}

/**
 * 生成提交 payload。
 */
function buildPayload(): PlotThreadQuickSceneUpdate | null {
    const scene = props.detail?.scene;
    if (!scene) {
        return null;
    }

    return {
        sceneId: scene.id,
        title: draft.title.trim() || "未命名 Scene",
        summary: draft.summary.trim(),
        purpose: draft.purpose.trim() || null,
        writingTip: draft.writingTip.trim() || null,
        status: draft.status,
        chapterId: draft.chapterId || null,
        worldAnchor: scene.worldAnchor,
    };
}

/**
 * 提交当前草稿。
 */
function commitDraft(): void {
    const payload = buildPayload();
    if (!payload || !isDirty.value) {
        return;
    }

    pushUndo();
    emit("updateScene", payload);
}

/**
 * 强制保存当前草稿。
 */
async function flushNow(
    saveScene: (payload: PlotThreadQuickSceneUpdate) => Promise<void>,
): Promise<boolean> {
    const payload = buildPayload();
    if (!payload || !isDirty.value) {
        return true;
    }

    pushUndo();

    try {
        await saveScene(payload);
        markSaved();
        return true;
    } catch {
        return false;
    }
}

/**
 * 回退到上一条本地草稿。
 */
function rollbackDraft(): void {
    undo();
}

/**
 * 打开 AI 批注对话框。
 */
function openAiDialog(): void {
    aiDialogOpen.value = true;
}

/**
 * 应用 AI 返回的新草稿。
 */
function applyAiDraft(nextDraft: JsonObject): void {
    pushUndo();

    if (typeof nextDraft.title === "string") {
        draft.title = nextDraft.title;
    }
    if (typeof nextDraft.summary === "string") {
        draft.summary = nextDraft.summary;
    }
    if (typeof nextDraft.purpose === "string" || nextDraft.purpose === null) {
        draft.purpose = typeof nextDraft.purpose === "string" ? nextDraft.purpose : "";
    }
    if (typeof nextDraft.writingTip === "string" || nextDraft.writingTip === null) {
        draft.writingTip = typeof nextDraft.writingTip === "string" ? nextDraft.writingTip : "";
    }
    if (typeof nextDraft.status === "string") {
        draft.status = nextDraft.status as PlotThreadPanelScene["status"];
    }
    if (typeof nextDraft.chapterId === "string" || nextDraft.chapterId === null) {
        draft.chapterId = typeof nextDraft.chapterId === "string" ? nextDraft.chapterId : "";
    }
}

defineExpose({
    flushNow,
});

watch(() => props.detail, () => {
    syncDraft();
    panelHeight.value = 0;
}, {immediate: true});
</script>

<template>
    <!-- Plot detail 面板 -->
    <SideDetailPanel
        :visible="hasActivePanel"
        :height="panelHeight"
        :panel-class="toneClass"
        body-class="p-3"
        @update:height="panelHeight = $event"
        @close="emit('close')"
    >
        <template #header>
            <template v-if="props.detail?.scene">
                <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-[11px]"
                    :class="props.detail?.thread.isMainThread ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]'"
                >
                    <span class="i-lucide-clapperboard h-3.5 w-3.5"></span>
                </span>
                <span
                    v-if="isDirty"
                    class="h-2 w-2 shrink-0 rounded-full bg-[var(--status-warning)]"
                    title="有未保存修改"
                ></span>
                <span class="truncate font-serif text-sm font-bold tracking-wide text-[var(--text-main)]">
                    {{ props.detail.scene.title }}
                </span>
            </template>
        </template>

        <template #actions>
            <button
                v-if="panelHeight > 44 && hasActivePanel"
                type="button"
                class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!canRollback"
                title="回退"
                @click="rollbackDraft"
            >
                <span class="i-lucide-rotate-ccw h-3 w-3"></span>
            </button>
            <button
                v-if="panelHeight > 44 && hasActivePanel"
                type="button"
                class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="AI 批注"
                @click="openAiDialog"
            >
                <span class="i-lucide-sparkles h-3 w-3"></span>
            </button>
            <button
                v-if="panelHeight > 44 && hasActivePanel"
                type="button"
                class="inline-flex h-6 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="编辑"
                @click="emit('edit')"
            >编辑</button>
        </template>

        <template #default>
            <!-- 紧凑详情表单 -->
            <div v-if="props.detail?.scene" class="space-y-3 text-[11px]">
                <div v-if="props.diagnostics" class="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--status-warning)]">
                    {{ props.diagnostics }}
                </div>

                <div class="grid grid-cols-2 gap-2 text-[10px] text-[var(--text-muted)]">
                    <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1">{{ chapterLabel }}</span>
                    <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-right">#{{ props.detail.scene.threadSortOrder + 1 }}</span>
                    <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1">Scene</span>
                    <span class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-right">R {{ refCount }}</span>
                    <!-- 节奏字段只读 chip:有值才显示 -->
                    <span v-if="outcomeTypeLabel" class="truncate rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1" :title="outcomeTypeLabel">{{ outcomeTypeLabel }}</span>
                    <span v-if="pacingRoleLabel" class="truncate rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-right" :title="pacingRoleLabel">{{ pacingRoleLabel }}</span>
                </div>

                <!-- 本场服务的承诺线(promise beats):只读芯片,点击跳承诺账本聚焦该 Promise -->
                <div v-if="props.detail.promiseBeats.length" class="space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">服务承诺</span>
                    <div class="flex flex-wrap gap-1.5">
                        <button
                            v-for="beat in props.detail.promiseBeats"
                            :key="beat.id"
                            type="button"
                            data-testid="plot-detail-promise-beat-chip"
                            class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] transition-opacity hover:opacity-80"
                            :class="PLANNING_TONE_CLASSES[PROMISE_BEAT_STATE_META[beat.state].tone].chip"
                            :title="`${PROMISE_BEAT_KIND_META[beat.kind].label} · ${PROMISE_BEAT_STATE_META[beat.state].label}${beat.note ? ` · ${beat.note}` : ''}`"
                            @click="emit('focusPromise', beat.promiseId)"
                        >
                            <span class="h-3 w-3 shrink-0" :class="PROMISE_BEAT_KIND_META[beat.kind].iconClass"></span>
                            <span class="max-w-[140px] truncate">{{ beat.promiseTitle }}</span>
                        </button>
                    </div>
                </div>

                <label class="block space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">标题</span>
                    <input
                        v-model="draft.title"
                        type="text"
                        class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                        @blur="commitDraft"
                    >
                </label>

                <div class="grid grid-cols-2 gap-2">
                    <label class="block space-y-1">
                        <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">状态</span>
                        <select
                            v-model="draft.status"
                            class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                            @change="commitDraft"
                        >
                            <option value="draft">{{ PLOT_SCENE_STATUS_LABELS.draft }}</option>
                            <option value="active">{{ PLOT_SCENE_STATUS_LABELS.active }}</option>
                            <option value="written">{{ PLOT_SCENE_STATUS_LABELS.written }}</option>
                            <option value="revised">{{ PLOT_SCENE_STATUS_LABELS.revised }}</option>
                        </select>
                    </label>

                    <label class="block space-y-1">
                        <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">章节</span>
                        <select
                            v-model="draft.chapterId"
                            class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                            @change="commitDraft"
                        >
                            <option value="">未挂章</option>
                            <option v-for="chapter in props.chapters" :key="chapter.id" :value="chapter.id">
                                {{ chapter.numberLabel }}
                            </option>
                        </select>
                    </label>
                </div>

                <div class="space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">摘要</span>
                    <StructuredTextEditor
                        v-model="draft.summary"
                        :rows="4"
                        default-mode="rich"
                        placeholder="概括当前 Scene..."
                        :menu-refresh-key="menuRefreshKey"
                        :resolve-menu="resolveMenu"
                        @blur="commitDraft"
                    />
                </div>

                <div class="space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">目的</span>
                    <StructuredTextEditor
                        v-model="draft.purpose"
                        :rows="3"
                        default-mode="rich"
                        placeholder="说明场景目的..."
                        :menu-refresh-key="menuRefreshKey"
                        :resolve-menu="resolveMenu"
                        @blur="commitDraft"
                    />
                </div>

                <div class="space-y-1">
                    <span class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">写作提示</span>
                    <StructuredTextEditor
                        v-model="draft.writingTip"
                        :rows="3"
                        default-mode="rich"
                        placeholder="记录写作提示..."
                        :menu-refresh-key="menuRefreshKey"
                        :resolve-menu="resolveMenu"
                        @blur="commitDraft"
                    />
                </div>
            </div>

            <FormAnnotationDialog
                v-if="props.detail?.scene"
                v-model="aiDialogOpen"
                title="Scene AI 批注"
                form-kind="story_scene"
                :draft="annotationDraft"
                :context="{sceneId: props.detail.scene.id, threadId: props.detail.thread.id}"
                @applied="applyAiDraft"
            />
        </template>
    </SideDetailPanel>
</template>
