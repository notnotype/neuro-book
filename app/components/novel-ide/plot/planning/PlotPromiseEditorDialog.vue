<script setup lang="ts">
// 承诺(StoryPromise)编辑对话框:新建 / 编辑共用。
// 字段语义来自 Task 93 规划层:summary=向读者许了什么;payoffExpectation=兑现时的预期戏剧效果(只给兑现场 writer);
// cadenceChapters=提示性参考节奏(非硬约束);deadlineChapterId=兑现期限章。可空字段空串提交时映射 null(显式清空)。
import {computed, reactive, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import TagInput from "nbook/app/components/common/form/TagInput.vue";
import {PROMISE_IMPORTANCE_META} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {PlotThreadPanelChapter} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {StoryPromiseDetailDto, StoryPromiseImportanceDto} from "nbook/shared/dto/plot.dto";

// 编辑器提交载荷:宿主 tab 按 mode 映射到 Create/Update 请求(PATCH 语义:null=显式清空)。
export type PlotPromiseEditorSave = {
    name: string;
    title: string;
    importance: StoryPromiseImportanceDto;
    summary: string;
    // 为空表示显式清空兑现预期。
    payoffExpectation: string | null;
    // 为空表示显式清空参考节奏。
    cadenceChapters: number | null;
    // 为空表示显式清空期限章。
    deadlineChapterId: string | null;
    tags: string[];
};

const props = defineProps<{
    visible: boolean;
    mode: "create" | "edit";
    // 编辑对象;mode=create 时为空。
    promise: StoryPromiseDetailDto | null;
    // 期限章下拉数据源。
    chapters: PlotThreadPanelChapter[];
    saving?: boolean;
    // 为空表示宿主侧无保存错误。
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:visible", value: boolean): void;
    (e: "save", payload: PlotPromiseEditorSave): void;
}>();

// 表单草稿:cadenceChapters 用字符串承载输入,提交时解析;可空字段空串=清空。
const draft = reactive({
    name: "",
    title: "",
    importance: "medium" as StoryPromiseImportanceDto,
    summary: "",
    payoffExpectation: "",
    cadenceChapters: "",
    deadlineChapterId: "",
    tags: [] as string[],
});
// 本地校验错误;为空表示当前无校验问题。
const validationError = ref("");

const dialogTitle = computed(() => props.mode === "create" ? "新建承诺" : "编辑承诺");

// importance 下拉(META 声明序:高/中/低)。
const importanceOptions: SelectOption[] = (Object.keys(PROMISE_IMPORTANCE_META) as StoryPromiseImportanceDto[])
    .map((value) => ({value, label: PROMISE_IMPORTANCE_META[value].label}));

// 期限章下拉;空值表示无期限。
const deadlineOptions = computed<SelectOption[]>(() => [
    {value: "", label: "无期限"},
    ...props.chapters.map((chapter) => ({value: chapter.id, label: `${chapter.numberLabel} ${chapter.title}`, description: chapter.volumeTitle})),
]);

// 编辑态改名警示:name 供文档/章节简报/Agent 指令按名引用,改名后这些引用不会自动更新(serves/dependsOn 互指按 id,不受影响)。
const nameChanged = computed(() => props.mode === "edit" && props.promise !== null && draft.name.trim() !== props.promise.name);

/** 把当前 promise(或空)同步到本地草稿。 */
function syncDraft(): void {
    const promise = props.promise;
    draft.name = promise?.name ?? "";
    draft.title = promise?.title ?? "";
    draft.importance = promise?.importance ?? "medium";
    draft.summary = promise?.summary ?? "";
    draft.payoffExpectation = promise?.payoffExpectation ?? "";
    draft.cadenceChapters = typeof promise?.cadenceChapters === "number" ? String(promise.cadenceChapters) : "";
    draft.deadlineChapterId = promise?.deadlineChapterId ?? "";
    draft.tags = [...(promise?.tags ?? [])];
    validationError.value = "";
}

watch(() => [props.visible, props.promise] as const, ([visible]) => {
    if (visible) {
        syncDraft();
    }
}, {immediate: true});

/** 空串转 null(显式清空),否则 trim 后返回。 */
function toNullable(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** 关闭对话框(不提交)。 */
function closeDialog(): void {
    emit("update:visible", false);
}

/** 客户端校验并提交;必填缺失或 cadence 非法时写本地校验错误,不发请求。 */
function submit(): void {
    const name = draft.name.trim();
    const title = draft.title.trim();
    if (!name) {
        validationError.value = "name 不能为空(小写字母/数字/连字符)";
        return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        validationError.value = "name 仅允许小写字母、数字和中划线";
        return;
    }
    if (!title) {
        validationError.value = "标题不能为空";
        return;
    }
    const cadenceRaw = draft.cadenceChapters.trim();
    let cadenceChapters: number | null = null;
    if (cadenceRaw) {
        const parsed = Number(cadenceRaw);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            validationError.value = "参考节奏必须是正整数章数";
            return;
        }
        cadenceChapters = parsed;
    }

    validationError.value = "";
    emit("save", {
        name,
        title,
        importance: draft.importance,
        summary: draft.summary.trim(),
        payoffExpectation: toNullable(draft.payoffExpectation),
        cadenceChapters,
        deadlineChapterId: draft.deadlineChapterId.trim() || null,
        tags: draft.tags,
    });
}
</script>

<template>
    <!-- 承诺编辑对话框 -->
    <Dialog
        :model-value="props.visible"
        :title="dialogTitle"
        width="640px"
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

        <!-- 承诺表单主体 -->
        <div class="space-y-3 px-1 mt-1">
            <div v-if="validationError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-danger)]">{{ validationError }}</div>

            <div class="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                <FormField label="标题">
                    <FormInput v-model="draft.title" placeholder="如 银钥匙之谜" />
                </FormField>
                <FormField label="重要性">
                    <FormSelect v-model="draft.importance" :options="importanceOptions" />
                </FormField>
            </div>

            <FormField :label="props.mode === 'create' ? 'name(必填,供互指引用)' : 'name(供互指引用)'">
                <FormInput v-model="draft.name" placeholder="如 silver-key-mystery(小写字母/数字/连字符)" />
                <!-- 改名破坏按名引用的行内警示,仅编辑态且已改动时出现;不举 promise:// 协议例(serves/dependsOn 互指按 id,不受改名影响) -->
                <div v-if="nameChanged" class="mt-1 flex items-start gap-1.5 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[11px] text-[var(--status-warning)]">
                    <span class="i-lucide-triangle-alert mt-0.5 h-3 w-3 shrink-0"></span>
                    <span>name 可能被文档、章节简报与 Agent 指令按名引用,改名后这些引用不会自动更新,保存前请确认。</span>
                </div>
            </FormField>

            <FormField label="承诺内容(向读者许了什么)">
                <FormTextarea v-model="draft.summary" :rows="3" placeholder="读者读到什么会形成期待,如「银钥匙能打开的东西终会揭晓」" />
            </FormField>

            <FormField label="兑现预期(只给兑现场的 writer)">
                <FormTextarea v-model="draft.payoffExpectation" :rows="2" placeholder="兑现时的预期戏剧效果(可空)" />
            </FormField>

            <div class="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
                <FormField label="参考节奏(每 N 章)">
                    <FormInput v-model="draft.cadenceChapters" type="number" min="1" step="1" placeholder="可空" />
                </FormField>
                <FormField label="兑现期限章">
                    <FormSelect v-model="draft.deadlineChapterId" :options="deadlineOptions" placeholder="无期限" />
                </FormField>
            </div>

            <FormField label="标签">
                <TagInput v-model="draft.tags" placeholder="伏笔四词表:setup_payoff / prophecy / motif / mirror,回车添加" />
            </FormField>
        </div>
    </Dialog>
</template>
