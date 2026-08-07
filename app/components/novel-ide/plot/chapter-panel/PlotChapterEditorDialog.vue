<script setup lang="ts">
// 承载树章节编辑器：创建 / 编辑 StoryChapter 与其 ChapterBrief 字段组。
// 章级 writer 指令(目标/POV/信息控制/开头收尾/禁写)是防全知的按章控制面,详见 reference/plot/writer-brief.md。
import {computed, reactive, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ChapterBriefInputDto, StoryActDto, StoryChapterDto} from "nbook/shared/dto/plot.dto";

// 关联正文节点:通过 frontmatter `chapter: <name>` 反指本章的 manuscript 内容节点。
type ChapterProseNode = {
    path: string;
    indexPath: string;
    title: string;
    chapterName: string;
    words: number;
};

// 编辑器提交载荷。父组件按 mode 映射到 Create/Update Chapter 请求。
export type PlotChapterEditorSave = {
    actId: string | null;
    name: string;
    title: string;
    note: string | null;
    brief: ChapterBriefInputDto;
};

const props = defineProps<{
    visible: boolean;
    mode: "create" | "edit";
    chapter: StoryChapterDto | null;
    acts: StoryActDto[];
    projectRoot: string;
    saving?: boolean;
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:visible", value: boolean): void;
    (e: "save", payload: PlotChapterEditorSave): void;
}>();

// brief 表单字段:全部自由文本,空串在提交时归一为 null(清空该维度)。
const draft = reactive({
    actId: "",
    name: "",
    title: "",
    note: "",
    goal: "",
    pov: "",
    tone: "",
    pacing: "",
    readerKnows: "",
    protagonistKnows: "",
    mustHide: "",
    hintOnly: "",
    opening: "",
    ending: "",
    doNotWrite: "",
});

const dialogTitle = computed(() => props.mode === "create" ? "新建章节" : "编辑章节");

// 关联正文列表(仅编辑态拉取);为空表示暂无 Prose frontmatter 反指本章。
const proseNodes = ref<ChapterProseNode[]>([]);
const loadingProse = ref(false);
const proseError = ref("");

// 卷下拉选项;空值表示未归卷。
const actOptions = computed<SelectOption[]>(() => [
    {value: "", label: "未归卷"},
    ...props.acts.map((act) => ({value: act.id, label: act.title || act.name})),
]);

/** 拉取通过 frontmatter 反指本章的正文节点。 */
async function loadProse(chapterId: string): Promise<void> {
    if (!props.projectRoot) {
        proseNodes.value = [];
        return;
    }
    loadingProse.value = true;
    proseError.value = "";
    try {
        proseNodes.value = await $fetch<ChapterProseNode[]>(`/api/projects/plot/chapters/${chapterId}/prose`, {
            query: {projectRoot: props.projectRoot},
        });
    } catch (error) {
        proseError.value = resolveApiErrorMessage(error, "加载关联正文失败");
        proseNodes.value = [];
    } finally {
        loadingProse.value = false;
    }
}

/** 把当前 chapter(或空)同步到本地草稿。 */
function syncDraft(): void {
    const chapter = props.chapter;
    draft.actId = chapter?.actId ?? "";
    draft.name = chapter?.name ?? "";
    draft.title = chapter?.title ?? "";
    draft.note = chapter?.note ?? "";
    const brief = chapter?.brief;
    draft.goal = brief?.goal ?? "";
    draft.pov = brief?.pov ?? "";
    draft.tone = brief?.tone ?? "";
    draft.pacing = brief?.pacing ?? "";
    draft.readerKnows = brief?.readerKnows ?? "";
    draft.protagonistKnows = brief?.protagonistKnows ?? "";
    draft.mustHide = brief?.mustHide ?? "";
    draft.hintOnly = brief?.hintOnly ?? "";
    draft.opening = brief?.opening ?? "";
    draft.ending = brief?.ending ?? "";
    draft.doNotWrite = brief?.doNotWrite ?? "";
}

watch(() => [props.visible, props.chapter] as const, ([visible, chapter]) => {
    if (visible) {
        syncDraft();
        proseNodes.value = [];
        proseError.value = "";
        if (chapter) {
            void loadProse(chapter.id);
        }
    }
}, {immediate: true});

/** 空串转 null(显式清空维度),否则 trim 后返回。 */
function toNullable(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function closeDialog(): void {
    emit("update:visible", false);
}

function submit(): void {
    emit("save", {
        actId: draft.actId.trim() || null,
        name: draft.name.trim(),
        title: draft.title.trim() || draft.name.trim() || "未命名章节",
        note: toNullable(draft.note),
        brief: {
            goal: toNullable(draft.goal),
            pov: toNullable(draft.pov),
            tone: toNullable(draft.tone),
            pacing: toNullable(draft.pacing),
            readerKnows: toNullable(draft.readerKnows),
            protagonistKnows: toNullable(draft.protagonistKnows),
            mustHide: toNullable(draft.mustHide),
            hintOnly: toNullable(draft.hintOnly),
            opening: toNullable(draft.opening),
            ending: toNullable(draft.ending),
            doNotWrite: toNullable(draft.doNotWrite),
        },
    });
}
</script>

<template>
    <!-- 章节 + ChapterBrief 编辑对话框 -->
    <Dialog
        :model-value="props.visible"
        :title="dialogTitle"
        width="720px"
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

        <!-- 章节基本信息 -->
        <div class="space-y-3 px-1 mt-1">
            <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <FormField label="标题">
                    <FormInput v-model="draft.title" placeholder="章节标题" />
                </FormField>
                <FormField label="所属卷">
                    <FormSelect v-model="draft.actId" :options="actOptions" placeholder="未归卷" />
                </FormField>
            </div>
            <FormField label="name(供 Prose frontmatter 反指)">
                <FormInput v-model="draft.name" placeholder="如 001-volume-001-chapter(小写字母/数字/连字符)" />
            </FormField>
            <FormField label="备注">
                <FormTextarea v-model="draft.note" :rows="2" placeholder="章节备注(可空)" />
            </FormField>

            <!-- ChapterBrief:章级 writer 指令 -->
            <div class="mt-1 border-t border-[var(--border-color)] pt-3">
                <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">章级写作指令(ChapterBrief)</div>

                <FormField label="本章目标 / 落点">
                    <FormTextarea v-model="draft.goal" :rows="2" placeholder="本章要达成什么、落在哪里(可空)" />
                </FormField>
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                    <FormField label="POV / 视角">
                        <FormTextarea v-model="draft.pov" :rows="2" placeholder="视角、叙述距离、切换限制(可空)" />
                    </FormField>
                    <FormField label="语气 / 风格">
                        <FormTextarea v-model="draft.tone" :rows="2" placeholder="情绪温度、风格约束(可空)" />
                    </FormField>
                </div>
                <FormField label="节奏 / 下一章牵引">
                    <FormTextarea v-model="draft.pacing" :rows="2" placeholder="节奏、悬念、下一章牵引(可空)" />
                </FormField>

                <!-- 信息控制:防全知的按章控制面,四项全空时 brief status 会停在 needs_chapter_brief -->
                <div class="mt-1 mb-1 text-[11px] font-medium text-[var(--text-muted)]">信息控制(至少填一项,防止 writer 越界泄露)</div>
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                    <FormField label="读者已知">
                        <FormTextarea v-model="draft.readerKnows" :rows="2" placeholder="读者此刻应知道什么(可空)" />
                    </FormField>
                    <FormField label="主角已知">
                        <FormTextarea v-model="draft.protagonistKnows" :rows="2" placeholder="主角此刻知道什么(可空)" />
                    </FormField>
                    <FormField label="必须隐藏">
                        <FormTextarea v-model="draft.mustHide" :rows="2" placeholder="本章绝不能泄露的事实(可空)" />
                    </FormField>
                    <FormField label="可暗示不可明说">
                        <FormTextarea v-model="draft.hintOnly" :rows="2" placeholder="可埋伏笔但不点破(可空)" />
                    </FormField>
                </div>

                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                    <FormField label="开场钩子">
                        <FormTextarea v-model="draft.opening" :rows="2" placeholder="本章如何开场(可空)" />
                    </FormField>
                    <FormField label="结尾定句 / 落点">
                        <FormTextarea v-model="draft.ending" :rows="2" placeholder="本章如何收尾(可空)" />
                    </FormField>
                </div>
                <FormField label="禁写事项">
                    <FormTextarea v-model="draft.doNotWrite" :rows="2" placeholder="不要写的内容(可空)" />
                </FormField>
            </div>

            <!-- 关联正文:通过 manuscript frontmatter `chapter: <name>` 反指本章的 Prose 节点(只读) -->
            <div v-if="props.mode === 'edit'" class="mt-1 border-t border-[var(--border-color)] pt-3">
                <div class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    <span>关联正文(frontmatter 反指)</span>
                    <span v-if="loadingProse" class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                </div>
                <div v-if="proseError" class="text-[11px] text-[var(--status-danger)]">{{ proseError }}</div>
                <div v-else-if="!loadingProse && proseNodes.length === 0" class="text-[11px] text-[var(--text-muted)]">
                    暂无正文反指本章。在 manuscript 正文 frontmatter 写 <code class="rounded bg-[var(--bg-input)] px-1">chapter: {{ draft.name || '&lt;name&gt;' }}</code> 即可关联。
                </div>
                <ul v-else class="space-y-1">
                    <li v-for="prose in proseNodes" :key="prose.indexPath" class="flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px]">
                        <span class="min-w-0 truncate text-[var(--text-secondary)]" :title="prose.path">{{ prose.title || prose.path }}</span>
                        <span class="shrink-0 text-[var(--text-muted)]">{{ prose.words }} 字</span>
                    </li>
                </ul>
            </div>
        </div>
    </Dialog>
</template>
