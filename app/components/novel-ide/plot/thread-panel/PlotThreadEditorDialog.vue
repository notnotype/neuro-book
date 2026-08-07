<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import TagInput from "nbook/app/components/common/form/TagInput.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import FormAnnotationDialog from "nbook/app/components/novel-ide/ai/FormAnnotationDialog.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {
    PLOT_SCENE_STATUS_LABELS,
    PLOT_THREAD_STATUS_LABELS,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {
    SCENE_OUTCOME_TYPE_OPTIONS,
    SCENE_PACING_ROLE_OPTIONS,
    THREAD_MICE_TYPE_OPTIONS,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {
    StorySceneOutcomeTypeDto,
    StoryScenePacingRoleDto,
    StoryThreadMiceTypeDto,
} from "nbook/shared/dto/plot.dto";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelRef,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {
    PlotThreadEditorSave,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {JsonObject} from "nbook/shared/dto/ai-form-annotation.dto";

const props = defineProps<{
    visible: boolean;
    target: "thread" | "scene";
    mode: "create" | "edit";
    thread: PlotThreadPanelThread | null;
    scene: PlotThreadPanelScene | null;
    chapters: PlotThreadPanelChapter[];
    sceneRefs: PlotThreadPanelRef[];
    saving?: boolean;
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:visible", value: boolean): void;
    (e: "save", payload: PlotThreadEditorSave): void;
}>();

const threadDraft = reactive({
    title: "",
    summary: "",
    status: "draft" as PlotThreadPanelThread["status"],
    isMainThread: false,
    // MICE 线型;空串表示未填写,提交映射 null。
    miceType: "" as StoryThreadMiceTypeDto | "",
    tagsText: "",
    writingTip: "",
});

const sceneDraft = reactive({
    title: "",
    summary: "",
    purpose: "",
    status: "draft" as PlotThreadPanelScene["status"],
    // 结果类型/张弛角色;空串表示未填写,提交映射 null。
    outcomeType: "" as StorySceneOutcomeTypeDto | "",
    pacingRole: "" as StoryScenePacingRoleDto | "",
    chapterId: "",
    writingTip: "",
});

const sceneRefsDraft = ref<PlotThreadPanelRef[]>([]);
const threadTags = ref<string[]>([]);
const aiDialogOpen = ref(false);
const initialThreadSnapshot = ref("");
const initialSceneSnapshot = ref("");
const {choose} = useDialog();
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

const threadStatusOptions: SelectOption[] = [
    {value: "draft", label: PLOT_THREAD_STATUS_LABELS.draft},
    {value: "active", label: PLOT_THREAD_STATUS_LABELS.active},
    {value: "paused", label: PLOT_THREAD_STATUS_LABELS.paused},
    {value: "done", label: PLOT_THREAD_STATUS_LABELS.done},
];

const sceneStatusOptions: SelectOption[] = [
    {value: "draft", label: PLOT_SCENE_STATUS_LABELS.draft},
    {value: "active", label: PLOT_SCENE_STATUS_LABELS.active},
    {value: "written", label: PLOT_SCENE_STATUS_LABELS.written},
    {value: "revised", label: PLOT_SCENE_STATUS_LABELS.revised},
];

const refVisibilityOptions: SelectOption[] = [
    {value: "author", label: "author"},
    {value: "reader", label: "reader"},
];

/**
 * 章节下拉选项。
 */
const chapterOptions = computed<SelectOption[]>(() => [
    {value: "", label: "未挂章"},
    ...props.chapters.map((chapter) => ({
        value: chapter.id,
        label: `${chapter.numberLabel} ${chapter.title}`,
    })),
]);

/**
 * 当前对话框标题。
 */
const dialogTitle = computed(() => {
    if (props.target === "thread") {
        return props.mode === "create" ? "新建 Thread" : "编辑 Thread";
    }

    return props.mode === "create" ? "新建 Scene" : "编辑 Scene";
});

const isDirty = computed(() => {
    if (props.target === "thread") {
        return JSON.stringify({
            title: threadDraft.title,
            summary: threadDraft.summary,
            status: threadDraft.status,
            isMainThread: threadDraft.isMainThread,
            miceType: threadDraft.miceType,
            tags: threadTags.value,
            writingTip: threadDraft.writingTip,
        }) !== initialThreadSnapshot.value;
    }

    return JSON.stringify({
        title: sceneDraft.title,
        summary: sceneDraft.summary,
        purpose: sceneDraft.purpose,
        status: sceneDraft.status,
        outcomeType: sceneDraft.outcomeType,
        pacingRole: sceneDraft.pacingRole,
        chapterId: sceneDraft.chapterId,
        writingTip: sceneDraft.writingTip,
        refs: sceneRefsDraft.value,
    }) !== initialSceneSnapshot.value;
});

/**
 * 重置 Thread 表单草稿。
 */
function resetThreadDraft(): void {
    threadDraft.title = props.thread?.title ?? "";
    threadDraft.summary = props.thread?.summary ?? "";
    threadDraft.status = props.thread?.status ?? "draft";
    threadDraft.isMainThread = props.thread?.isMainThread ?? false;
    threadDraft.miceType = props.thread?.miceType ?? "";
    threadDraft.tagsText = props.thread?.tags.join(" / ") ?? "";
    threadDraft.writingTip = props.thread?.writingTip ?? "";
    threadTags.value = [...(props.thread?.tags ?? [])];
    initialThreadSnapshot.value = JSON.stringify({
        title: threadDraft.title,
        summary: threadDraft.summary,
        status: threadDraft.status,
        isMainThread: threadDraft.isMainThread,
        miceType: threadDraft.miceType,
        tags: threadTags.value,
        writingTip: threadDraft.writingTip,
    });
}

/**
 * 重置 Scene 表单草稿。
 */
function resetSceneDraft(): void {
    sceneDraft.title = props.scene?.title ?? "";
    sceneDraft.summary = props.scene?.summary ?? "";
    sceneDraft.purpose = props.scene?.purpose ?? "";
    sceneDraft.status = props.scene?.status ?? "draft";
    sceneDraft.outcomeType = props.scene?.outcomeType ?? "";
    sceneDraft.pacingRole = props.scene?.pacingRole ?? "";
    sceneDraft.chapterId = props.scene?.chapterId ?? "";
    sceneDraft.writingTip = props.scene?.writingTip ?? "";
    sceneRefsDraft.value = props.sceneRefs.map((refItem) => ({...refItem}));
    initialSceneSnapshot.value = JSON.stringify({
        title: sceneDraft.title,
        summary: sceneDraft.summary,
        purpose: sceneDraft.purpose,
        status: sceneDraft.status,
        outcomeType: sceneDraft.outcomeType,
        pacingRole: sceneDraft.pacingRole,
        chapterId: sceneDraft.chapterId,
        writingTip: sceneDraft.writingTip,
        refs: sceneRefsDraft.value,
    });
}

/**
 * 关闭编辑对话框。
 */
function closeDialog(): void {
    emit("update:visible", false);
}

/**
 * 处理关闭请求，存在未保存修改时先提示。
 */
async function requestCloseDialog(): Promise<void> {
    if (!isDirty.value) {
        closeDialog();
        return;
    }

    const action = await choose("当前表单有未保存修改，是否先保存？", [
        {label: "保存", value: "save", tone: "primary"},
        {label: "放弃", value: "discard", tone: "danger"},
        {label: "取消", value: "cancel"},
    ], "未保存修改");

    if (action === "cancel") {
        return;
    }
    if (action === "save") {
        submit();
        return;
    }

    closeDialog();
}

/**
 * 统一处理 Dialog 的关闭请求。只有点击遮罩时才弹未保存提示。
 */
async function handleDialogRequestClose(reason: "overlay" | "cancel" | "close-button" | "esc"): Promise<void> {
    if (props.saving) {
        return;
    }

    if (reason === "overlay") {
        await requestCloseDialog();
        return;
    }

    closeDialog();
}

/**
 * 生成预览态本地 id。
 */
function createLocalId(prefix: "ref"): string {
    return `${prefix}-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 新增一条 Scene 引用。
 */
function addSceneRef(): void {
    sceneRefsDraft.value = [
        ...sceneRefsDraft.value,
        {
            id: createLocalId("ref"),
            relation: "",
            target: "",
            visibility: "author",
            note: null,
        },
    ];
}

/**
 * 更新一条 Scene 引用。
 */
function updateSceneRef(refId: string, patch: Partial<PlotThreadPanelRef>): void {
    sceneRefsDraft.value = sceneRefsDraft.value.map((refItem) => refItem.id === refId
        ? {
            ...refItem,
            ...patch,
        }
        : refItem);
}

/**
 * 删除一条 Scene 引用。
 */
function removeSceneRef(refId: string): void {
    sceneRefsDraft.value = sceneRefsDraft.value.filter((refItem) => refItem.id !== refId);
}


/**
 * 提交当前表单。
 */
function submit(): void {
    if (props.saving) {
        return;
    }

    if (props.target === "thread") {
        emit("save", {
            target: "thread",
            title: threadDraft.title.trim() || "未命名 Thread",
            summary: threadDraft.summary.trim(),
            status: threadDraft.status,
            isMainThread: threadDraft.isMainThread,
            miceType: threadDraft.miceType || null,
            tags: threadTags.value.map((tag) => tag.trim()).filter(Boolean),
            writingTip: threadDraft.writingTip.trim() || null,
        });
        return;
    }

    const refs = sceneRefsDraft.value
        .map((refItem) => ({
            ...refItem,
            relation: refItem.relation.trim(),
            target: refItem.target.trim(),
            note: refItem.note?.trim() || null,
        }))
        .filter((refItem) => refItem.relation.length > 0 || refItem.target.length > 0);

    emit("save", {
        target: "scene",
        title: sceneDraft.title.trim() || "未命名 Scene",
        summary: sceneDraft.summary.trim(),
        purpose: sceneDraft.purpose.trim() || null,
        status: sceneDraft.status,
        outcomeType: sceneDraft.outcomeType || null,
        pacingRole: sceneDraft.pacingRole || null,
        chapterId: sceneDraft.chapterId || null,
        writingTip: sceneDraft.writingTip.trim() || null,
        worldAnchor: props.scene?.worldAnchor ?? {
            startTime: null,
            endTime: null,
            startInstant: null,
            endInstant: null,
            subjectIds: [],
            locationSubjectId: null,
            subjects: [],
            locationSubject: null,
            unresolvedSubjectIds: [],
        },
        refs,
    });
}

/**
 * 打开 AI 批注对话框。
 */
function openAiDialog(): void {
    aiDialogOpen.value = true;
}

/**
 * 应用 AI 返回的 Thread 草稿。
 */
function applyThreadAiDraft(nextDraft: JsonObject): void {
    if (typeof nextDraft.title === "string") {
        threadDraft.title = nextDraft.title;
    }
    if (typeof nextDraft.summary === "string") {
        threadDraft.summary = nextDraft.summary;
    }
    if (typeof nextDraft.writingTip === "string") {
        threadDraft.writingTip = nextDraft.writingTip;
    }
    if (typeof nextDraft.status === "string") {
        threadDraft.status = nextDraft.status as PlotThreadPanelThread["status"];
    }
    if (typeof nextDraft.isMainThread === "boolean") {
        threadDraft.isMainThread = nextDraft.isMainThread;
    }
    if (typeof nextDraft.miceType === "string" || nextDraft.miceType === null) {
        threadDraft.miceType = (nextDraft.miceType ?? "") as StoryThreadMiceTypeDto | "";
    }
}

/**
 * 应用 AI 返回的 Scene 草稿。
 */
function applySceneAiDraft(nextDraft: JsonObject): void {
    if (typeof nextDraft.title === "string") {
        sceneDraft.title = nextDraft.title;
    }
    if (typeof nextDraft.summary === "string") {
        sceneDraft.summary = nextDraft.summary;
    }
    if (typeof nextDraft.purpose === "string") {
        sceneDraft.purpose = nextDraft.purpose;
    }
    if (typeof nextDraft.writingTip === "string") {
        sceneDraft.writingTip = nextDraft.writingTip;
    }
    if (typeof nextDraft.status === "string") {
        sceneDraft.status = nextDraft.status as PlotThreadPanelScene["status"];
    }
    if (typeof nextDraft.outcomeType === "string" || nextDraft.outcomeType === null) {
        sceneDraft.outcomeType = (nextDraft.outcomeType ?? "") as StorySceneOutcomeTypeDto | "";
    }
    if (typeof nextDraft.pacingRole === "string" || nextDraft.pacingRole === null) {
        sceneDraft.pacingRole = (nextDraft.pacingRole ?? "") as StoryScenePacingRoleDto | "";
    }
}

watch(() => [props.visible, props.target, props.mode, props.thread?.id, props.scene?.id], ([visible]) => {
    if (!visible) {
        return;
    }

    if (props.target === "thread") {
        resetThreadDraft();
        return;
    }

    resetSceneDraft();
}, {immediate: true});

watch(threadTags, (value) => {
    threadDraft.tagsText = value.join(" / ");
});
</script>

<template>
    <Dialog
        :model-value="props.visible"
        :title="dialogTitle"
        width="700px"
        show-cancel
        overlay-type="opaque"
        :busy="props.saving"
        @request-close="handleDialogRequestClose"
        @update:model-value="emit('update:visible', $event)"
    >
        <template #header-extra>
            <div v-if="props.saving || props.error" class="ml-2 flex items-center text-xs">
                <span v-if="props.saving" class="flex items-center gap-1 text-[var(--text-muted)]">
                    <span class="i-lucide-loader-circle animate-spin"></span>
                    保存中
                </span>
                <span v-else class="text-[var(--status-danger)]">{{ props.error }}</span>
            </div>
        </template>
        <template #footer>
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="closeDialog">取消</button>
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="openAiDialog">AI 批注</button>
            <button class="inline-flex items-center justify-center h-8 min-w-[92px] px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="submit">
                <span v-if="props.saving" class="flex items-center gap-1">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    保存中
                </span>
                <span v-else>确定</span>
            </button>
        </template>

        <!-- Thread 表单 -->
        <div v-if="props.target === 'thread'" class="space-y-3 px-1 mt-1">
            <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                <FormField label="标题">
                    <FormInput v-model="threadDraft.title" placeholder="Thread 标题" />
                </FormField>
                <FormField label="状态">
                    <FormSelect v-model="threadDraft.status" :options="threadStatusOptions" />
                </FormField>
            </div>

            <FormField label="线型(MICE)">
                <FormSelect v-model="threadDraft.miceType" :options="THREAD_MICE_TYPE_OPTIONS" placeholder="未填写" />
            </FormField>

            <FormField label="标签">
                <TagInput v-model="threadTags" placeholder="输入标签后回车" />
            </FormField>

            <FormField label="摘要">
                <StructuredTextEditor
                    v-model="threadDraft.summary"
                    :rows="5"
                    default-mode="rich"
                    placeholder="Thread 摘要"
                    :menu-refresh-key="menuRefreshKey"
                    :resolve-menu="resolveMenu"
                />
            </FormField>

            <FormField label="写作提示">
                <StructuredTextEditor
                    v-model="threadDraft.writingTip"
                    :rows="4"
                    default-mode="rich"
                    placeholder="写作提示"
                    :menu-refresh-key="menuRefreshKey"
                    :resolve-menu="resolveMenu"
                />
            </FormField>
        </div>

        <!-- Scene 表单 -->
        <div v-else class="space-y-3 px-1 mt-1">
            <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                <FormField label="标题">
                    <FormInput v-model="sceneDraft.title" placeholder="Scene 标题" />
                </FormField>
                <FormField label="状态">
                    <FormSelect v-model="sceneDraft.status" :options="sceneStatusOptions" />
                </FormField>
            </div>
            
            <FormField label="所属章节">
                <FormSelect v-model="sceneDraft.chapterId" :options="chapterOptions" placeholder="未挂章" />
            </FormField>

            <!-- 节奏字段:本场结果与张弛角色(Task 93 规划层,null=未填写) -->
            <div class="grid grid-cols-2 gap-2">
                <FormField label="结果类型">
                    <FormSelect v-model="sceneDraft.outcomeType" :options="SCENE_OUTCOME_TYPE_OPTIONS" placeholder="未填写" />
                </FormField>
                <FormField label="节奏角色">
                    <FormSelect v-model="sceneDraft.pacingRole" :options="SCENE_PACING_ROLE_OPTIONS" placeholder="未填写" />
                </FormField>
            </div>

            <FormField label="摘要">
                <StructuredTextEditor
                    v-model="sceneDraft.summary"
                    :rows="5"
                    default-mode="rich"
                    placeholder="Scene 摘要"
                    :menu-refresh-key="menuRefreshKey"
                    :resolve-menu="resolveMenu"
                />
            </FormField>

            <FormField label="目的">
                <StructuredTextEditor
                    v-model="sceneDraft.purpose"
                    :rows="4"
                    default-mode="rich"
                    placeholder="Scene 目的"
                    :menu-refresh-key="menuRefreshKey"
                    :resolve-menu="resolveMenu"
                />
            </FormField>

            <FormField label="写作提示">
                <StructuredTextEditor
                    v-model="sceneDraft.writingTip"
                    :rows="3"
                    default-mode="rich"
                    placeholder="写作提示"
                    :menu-refresh-key="menuRefreshKey"
                    :resolve-menu="resolveMenu"
                />
            </FormField>

            <!-- Refs -->
            <section class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Refs</div>
                    </div>
                    <button
                        type="button"
                        class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 text-[11px] text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        @click="addSceneRef"
                    >
                        <span class="i-lucide-plus h-3 w-3"></span>
                        <span>新增 Ref</span>
                    </button>
                </div>

                <div v-if="sceneRefsDraft.length" class="space-y-1.5">
                    <div v-for="refItem in sceneRefsDraft" :key="refItem.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2">
                        <div class="grid grid-cols-[110px_minmax(0,1fr)_96px_auto] items-center gap-1.5">
                            <FormInput
                                :model-value="refItem.relation"
                                placeholder="关系"
                                @update:model-value="updateSceneRef(refItem.id, { relation: $event })"
                            />
                            <FormInput
                                :model-value="refItem.target"
                                placeholder="目标"
                                @update:model-value="updateSceneRef(refItem.id, { target: $event })"
                            />
                            <FormSelect
                                :model-value="refItem.visibility"
                                :options="refVisibilityOptions"
                                @update:model-value="updateSceneRef(refItem.id, { visibility: $event as PlotThreadPanelRef['visibility'] })"
                            />
                            <button
                                type="button"
                                class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]"
                                title="删除 Ref"
                                @click="removeSceneRef(refItem.id)"
                            >
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                            </button>
                        </div>

                        <div class="mt-1.5">
                            <FormTextarea
                                :model-value="refItem.note ?? ''"
                                :rows="2"
                                placeholder="备注"
                                @update:model-value="updateSceneRef(refItem.id, { note: ($event || null) })"
                            />
                        </div>
                    </div>
                </div>

                <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
                    当前 Scene 还没有 Ref。
                </div>
            </section>
        </div>
        <FormAnnotationDialog
            v-model="aiDialogOpen"
            :title="props.target === 'thread' ? 'Thread AI 批注' : 'Scene AI 批注'"
            :form-kind="props.target === 'thread' ? 'story_thread' : 'story_scene'"
            :draft="props.target === 'thread'
                ? {
                    title: threadDraft.title,
                    summary: threadDraft.summary,
                    status: threadDraft.status,
                    isMainThread: threadDraft.isMainThread,
                    miceType: threadDraft.miceType || null,
                    tags: threadTags,
                    writingTip: threadDraft.writingTip,
                }
                : {
                    title: sceneDraft.title,
                    summary: sceneDraft.summary,
                    purpose: sceneDraft.purpose,
                    status: sceneDraft.status,
                    outcomeType: sceneDraft.outcomeType || null,
                    pacingRole: sceneDraft.pacingRole || null,
                    chapterId: sceneDraft.chapterId || null,
                    writingTip: sceneDraft.writingTip,
                    refs: sceneRefsDraft,
                }"
            :context="props.target === 'thread'
                ? { threadId: props.thread?.id ?? null }
                : { sceneId: props.scene?.id ?? null, threadId: props.scene?.threadId ?? props.thread?.id ?? null }"
            @applied="props.target === 'thread' ? applyThreadAiDraft($event) : applySceneAiDraft($event)"
        />
    </Dialog>
</template>
