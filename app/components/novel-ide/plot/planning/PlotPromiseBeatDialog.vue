<script setup lang="ts">
// 承诺节拍(StoryPromiseBeat)对话框:在某个 Scene 上打 埋设/推进/反挫/兑现 节拍。
// PUT upsert 语义:同场同线仅一条,选中已有节拍的场景时保存即覆盖;kind=payoff 默认自动把承诺置为已兑现(autoFulfill)。
import {computed, reactive, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {PROMISE_BEAT_KIND_META} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {StoryPromiseBeatKindDto, StoryPromiseDetailDto} from "nbook/shared/dto/plot.dto";

// 节拍提交载荷:宿主 tab 映射到 PUT /promises/:id/beats;autoFulfill 仅在 kind=payoff 时随请求发送。
export type PlotPromiseBeatSave = {
    sceneId: string;
    kind: StoryPromiseBeatKindDto;
    // 为空表示本次推进没有单独指示(显式清空)。
    note: string | null;
    // kind=payoff 时生效:true=保存后承诺自动标记为已兑现;false=里程碑式兑现,线仍延续。
    autoFulfill: boolean;
};

const props = defineProps<{
    visible: boolean;
    // 目标承诺详情(含既有 beats,用于同场覆盖警示);为空表示宿主尚未选中承诺,对话框不应打开。
    promise: StoryPromiseDetailDto | null;
    // 场景选择器数据源:threads 提供分组语义(线名),scenes 提供场与挂章信息,chapters 提供章名。
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    chapters: PlotThreadPanelChapter[];
    saving?: boolean;
    // 为空表示宿主侧无保存错误。
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:visible", value: boolean): void;
    (e: "save", payload: PlotPromiseBeatSave): void;
}>();

// 表单草稿。
const draft = reactive({
    sceneId: "",
    kind: "plant" as StoryPromiseBeatKindDto,
    note: "",
    autoFulfill: true,
});
// 本地校验错误;为空表示当前无校验问题。
const validationError = ref("");

// kind 四选(META 声明序:埋设/推进/反挫/兑现)。
const kindEntries = Object.entries(PROMISE_BEAT_KIND_META) as Array<[StoryPromiseBeatKindDto, {label: string; iconClass: string}]>;

/**
 * 场景下拉:按 threads 声明序 → 场内 threadSortOrder 排序,label=「线名 · 场名」,description=挂章信息。
 */
const sceneOptions = computed<SelectOption[]>(() => {
    const chapterTitles = new Map(props.chapters.map((chapter) => [chapter.id, `${chapter.numberLabel} ${chapter.title}`]));
    return props.threads.flatMap((thread) => props.scenes
        .filter((scene) => scene.threadId === thread.id)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)
        .map((scene) => ({
            value: scene.id,
            label: `${thread.title || "未命名 Thread"} · ${scene.title || "未命名 Scene"}`,
            description: scene.chapterId ? (chapterTitles.get(scene.chapterId) ?? "挂章已删除") : "未挂章",
            iconClass: "i-lucide-clapperboard",
        })));
});

// 所选场景上已存在的节拍;为空表示该场尚无本承诺的节拍(保存即新增)。
const existingBeat = computed(() => {
    if (!draft.sceneId) {
        return null;
    }
    return props.promise?.beats.find((beat) => beat.sceneId === draft.sceneId) ?? null;
});

watch(() => props.visible, (visible) => {
    if (visible) {
        draft.sceneId = "";
        draft.kind = "plant";
        draft.note = "";
        draft.autoFulfill = true;
        validationError.value = "";
    }
});

// 切换落点场景 = 切换编辑目标:该场已有节拍时回填其 kind/note(PUT 覆盖所见即所得,
// 防止只想改 kind 时把既有推进指示静默清空);无节拍场景回到默认新增态。
// autoFulfill 是写时行为,DTO 不回读,恒回默认开。
watch(() => draft.sceneId, () => {
    const existing = existingBeat.value;
    draft.kind = existing?.kind ?? "plant";
    draft.note = existing?.note ?? "";
    draft.autoFulfill = true;
});

/** 关闭对话框(不提交)。 */
function closeDialog(): void {
    emit("update:visible", false);
}

/** 校验并提交;未选场景时写本地校验错误。 */
function submit(): void {
    if (!draft.sceneId) {
        validationError.value = "请选择节拍落在哪个场景";
        return;
    }

    validationError.value = "";
    const note = draft.note.trim();
    emit("save", {
        sceneId: draft.sceneId,
        kind: draft.kind,
        note: note.length > 0 ? note : null,
        autoFulfill: draft.autoFulfill,
    });
}
</script>

<template>
    <!-- 承诺节拍对话框 -->
    <Dialog
        :model-value="props.visible"
        title="添加节拍"
        width="560px"
        show-cancel
        overlay-type="opaque"
        :busy="props.saving"
        @request-close="closeDialog"
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
            <button class="inline-flex items-center justify-center h-8 min-w-[92px] px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="submit">
                <span v-if="props.saving" class="flex items-center gap-1">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    保存中
                </span>
                <span v-else>确定</span>
            </button>
        </template>

        <!-- 节拍表单主体 -->
        <div class="space-y-3 px-1 mt-1">
            <div v-if="validationError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-danger)]">{{ validationError }}</div>

            <div class="text-[12px] text-[var(--text-secondary)]">
                为承诺 <span class="font-semibold text-[var(--text-main)]">{{ props.promise?.title ?? "" }}</span> 打一处节拍。
            </div>

            <FormField label="落点场景">
                <FormSelect v-model="draft.sceneId" :options="sceneOptions" placeholder="选择场景(线名 · 场名)" />
                <!-- 同场覆盖警示:PUT upsert,同场同线仅一条;既有 kind/note 已回填进表单,所改即所存 -->
                <div v-if="existingBeat" class="mt-1 flex items-start gap-1.5 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[11px] text-[var(--status-warning)]">
                    <span class="i-lucide-triangle-alert mt-0.5 h-3 w-3 shrink-0"></span>
                    <span>该场已有节拍(当前为「{{ PROMISE_BEAT_KIND_META[existingBeat.kind].label }}」)，其类型与推进指示已回填到下方表单，保存将按表单内容覆盖(同场同线仅一条)。</span>
                </div>
            </FormField>

            <FormField label="节拍类型">
                <!-- kind 四选:埋设/推进/反挫/兑现 -->
                <div class="grid grid-cols-4 gap-1.5">
                    <button
                        v-for="[kind, meta] in kindEntries"
                        :key="kind"
                        type="button"
                        class="flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] transition-colors"
                        :class="draft.kind === kind
                            ? 'border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--accent-main)_12%,var(--bg-input))] font-semibold text-[var(--accent-text)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        @click="draft.kind = kind"
                    >
                        <span class="h-4 w-4" :class="meta.iconClass"></span>
                        <span>{{ meta.label }}</span>
                    </button>
                </div>
            </FormField>

            <FormField label="推进指示(note)">
                <FormTextarea v-model="draft.note" :rows="2" placeholder="给该场 writer 的具体指示,如范围限制(可空)" />
            </FormField>

            <!-- autoFulfill 开关:仅 kind=payoff 时出现,默认开 -->
            <div v-if="draft.kind === 'payoff'" class="flex items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                <div class="min-w-0">
                    <div class="text-[12px] font-medium text-[var(--text-main)]">自动兑现</div>
                    <div class="text-[11px] text-[var(--text-muted)]">{{ draft.autoFulfill ? "保存后承诺将自动标记为已兑现" : "仅记录兑现节拍,承诺保持进行中(里程碑式兑现)" }}</div>
                </div>
                <button
                    type="button"
                    role="switch"
                    :aria-checked="draft.autoFulfill"
                    class="relative h-5 w-9 shrink-0 rounded-full border transition-colors"
                    :class="draft.autoFulfill ? 'border-transparent bg-[var(--accent-main)]' : 'border-[var(--border-color)] bg-[var(--bg-hover)]'"
                    @click="draft.autoFulfill = !draft.autoFulfill"
                >
                    <span class="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-[var(--bg-panel)] shadow transition-all" :class="draft.autoFulfill ? 'left-[18px]' : 'left-[3px]'"></span>
                </button>
            </div>
        </div>
    </Dialog>
</template>
