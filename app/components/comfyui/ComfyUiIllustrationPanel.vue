<script setup lang="ts">
/**
 * ComfyUI 生图悬浮面板（非模态 DialogWindow）：
 * 展示引用原文 → 蒸馏为英文提示词（可手改）→ 调参数生成 → 进度 → 缩略图 → 插入正文。
 * 任务状态由全局 SSE（useComfyUiJobEvents）写入 comfy-ui store，本组件只读展示；
 * 插入动作通过 emit("insert") 交给宿主（index.vue / RP 面板宿主）执行。
 */
import DialogWindow from "nbook/app/components/common/DialogWindow.vue";
import {useComfyUiStore} from "nbook/app/stores/comfy-ui";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useComfyUiJobEvents} from "nbook/app/composables/useComfyUiJobEvents";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {workspaceImageUrl} from "nbook/app/utils/workspace-image-url";
import type {ComfyUiDistillResponseDto, ComfyUiJobDto, ComfyUiWorkflowSummaryDto} from "nbook/shared/dto/comfyui.dto";
import {storeToRefs} from "pinia";

const emit = defineEmits<{
    /** 请求把图片插入正文；宿主按 comfyUiStore.insertTarget 分发到编辑器或 RP prose。 */
    (e: "insert", payload: {imagePath: string; alt: string}): void;
}>();

const comfyUiStore = useComfyUiStore();
const novelIdeStore = useNovelIdeStore();
const configApi = useConfigApi();
const notification = useNotification();
const jobEvents = useComfyUiJobEvents();
const {t} = useI18n();
const {params, sourceText, insertTarget, projectPath, activeJob, activeJobId, jobs} = storeToRefs(comfyUiStore);

const open = computed({
    get: () => novelIdeStore.comfyUiPanelOpen,
    set: (value: boolean) => {
        novelIdeStore.comfyUiPanelOpen = value;
    },
});

const distilling = ref(false);
const submitting = ref(false);
const inserting = ref(false);
/** 面板内可恢复错误（蒸馏/提交失败），内联展示；新动作开始时清空。 */
const panelError = ref("");
const workflows = ref<ComfyUiWorkflowSummaryDto[]>([]);
const sourceExpanded = ref(false);
let distillAbort: AbortController | null = null;

/** 生成中锁住关闭（DialogWindow busy）。 */
const generationActive = computed(() => {
    const status = activeJob.value?.status;
    return status === "pending" || status === "running" || status === "downloading";
});

const progressPercent = computed(() => {
    const job = activeJob.value;
    if (!job) {
        return 0;
    }
    if (job.status === "downloading" || job.status === "completed") {
        return 100;
    }
    return Math.round((job.progress ?? 0) * 100);
});

/** 面板底部最近任务（不含当前追踪任务），供回看历史结果。 */
const recentJobs = computed(() => jobs.value.filter((job) => job.jobId !== activeJobId.value).slice(0, 5));

const effectiveProjectPath = computed(() => projectPath.value || novelIdeStore.currentNovelId || null);

/** 首次打开：填充参数默认值 + 拉工作流列表 + 启动 SSE；有引用文字且提示词为空时自动蒸馏。 */
watch(open, (isOpen) => {
    if (!isOpen) {
        return;
    }
    jobEvents.start();
    void prepareDefaults();
    void loadWorkflows();
}, {immediate: true});

async function prepareDefaults(): Promise<void> {
    if (comfyUiStore.defaultsLoaded) {
        maybeAutoDistill();
        return;
    }
    try {
        const snapshot = await configApi.editorSnapshot();
        const config = snapshot.global.comfyui ?? {};
        const defaults = config.defaults ?? {};
        params.value = {
            ...params.value,
            negative: params.value.negative || (config.negativeDefault ?? ""),
            width: defaults.width ?? params.value.width,
            height: defaults.height ?? params.value.height,
            steps: defaults.steps ?? params.value.steps,
            cfg: defaults.cfg ?? params.value.cfg,
            workflowId: params.value.workflowId ?? (config.activeWorkflowId ?? null),
        };
        comfyUiStore.defaultsLoaded = true;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("comfyui.panel.loadDefaultsFailed")));
    }
    maybeAutoDistill();
}

async function loadWorkflows(): Promise<void> {
    try {
        const response = await $fetch<{items: ComfyUiWorkflowSummaryDto[]}>("/api/comfyui/workflows");
        workflows.value = response.items;
    } catch {
        // 工作流列表失败不阻塞面板；下拉保留内置项。
    }
}

/** 有引用文字且正向提示词为空时自动蒸馏一次。 */
function maybeAutoDistill(): void {
    if (sourceText.value.trim() && !params.value.positive.trim() && !distilling.value) {
        void distill();
    }
}

/**
 * 提示词蒸馏：引用文字 → 英文 Anima 提示词，填入正/负向输入框（可手改）。
 */
async function distill(): Promise<void> {
    const text = sourceText.value.trim();
    const targetProject = effectiveProjectPath.value;
    if (!text || !targetProject || distilling.value) {
        return;
    }
    distilling.value = true;
    panelError.value = "";
    distillAbort = new AbortController();
    try {
        const response = await $fetch<ComfyUiDistillResponseDto>("/api/projects/comfyui/distill", {
            method: "POST",
            query: {projectPath: targetProject},
            body: {text},
            signal: distillAbort.signal,
        });
        params.value = {
            ...params.value,
            positive: response.positive,
            negative: params.value.negative || response.negative,
        };
    } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
            panelError.value = resolveApiErrorMessage(error, t("comfyui.panel.distillFailed"));
        }
    } finally {
        distilling.value = false;
        distillAbort = null;
    }
}

/**
 * 提交生图任务。任务进度经 SSE 写回 store，本函数只负责创建并追踪。
 */
async function generate(): Promise<void> {
    const targetProject = effectiveProjectPath.value;
    if (!targetProject) {
        notification.warning(t("comfyui.panel.noProject"));
        return;
    }
    if (!params.value.positive.trim()) {
        notification.warning(t("comfyui.panel.positiveRequired"));
        return;
    }
    submitting.value = true;
    panelError.value = "";
    try {
        const job = await $fetch<ComfyUiJobDto>("/api/projects/comfyui/jobs", {
            method: "POST",
            query: {projectPath: targetProject},
            body: {
                positive: params.value.positive.trim(),
                negative: params.value.negative.trim(),
                width: params.value.width,
                height: params.value.height,
                steps: params.value.steps,
                cfg: params.value.cfg,
                seed: params.value.seed,
                workflowId: params.value.workflowId,
            },
        });
        comfyUiStore.applyJobUpdate(job);
        activeJobId.value = job.jobId;
    } catch (error) {
        panelError.value = resolveApiErrorMessage(error, t("comfyui.panel.submitFailed"));
    } finally {
        submitting.value = false;
    }
}

async function cancelActiveJob(): Promise<void> {
    const job = activeJob.value;
    const targetProject = effectiveProjectPath.value;
    if (!job || !targetProject) {
        return;
    }
    try {
        const cancelled = await $fetch<ComfyUiJobDto>(`/api/projects/comfyui/jobs/${encodeURIComponent(job.jobId)}/cancel`, {
            method: "POST",
            query: {projectPath: targetProject},
        });
        comfyUiStore.applyJobUpdate(cancelled);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("comfyui.panel.cancelFailed")));
    }
}

/** 请求宿主把图片插入正文。alt 取引用文字前 40 字。 */
function requestInsert(imagePath: string): void {
    if (inserting.value) {
        return;
    }
    inserting.value = true;
    try {
        emit("insert", {imagePath, alt: sourceText.value.trim().slice(0, 40)});
    } finally {
        inserting.value = false;
    }
}

/** 追踪历史任务（切换面板当前展示的任务）。 */
function trackJob(jobId: string): void {
    activeJobId.value = jobId;
}

/** 缩略图 URL：图片路径归属任务自己的项目。 */
function thumbnailUrl(job: ComfyUiJobDto, imagePath: string): string {
    return workspaceImageUrl(imagePath, job.projectPath);
}

const statusLabel = computed(() => {
    const job = activeJob.value;
    if (!job) {
        return "";
    }
    return t(`comfyui.panel.status.${job.status}`);
});

onBeforeUnmount(() => {
    distillAbort?.abort();
});
</script>

<template>
    <!-- ComfyUI 生图悬浮面板 -->
    <DialogWindow v-model="open" :title="t('comfyui.panel.title')" :width="480" :busy="generationActive" max-height="calc(100vh - 48px)">
        <div class="grid gap-3 text-sm">
            <!-- 引用原文 -->
            <div v-if="sourceText" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] bg-opacity-40 px-3 py-2">
                <button type="button" class="flex w-full items-center justify-between gap-2 text-xs text-[var(--text-secondary)]" @click="sourceExpanded = !sourceExpanded">
                    <span class="flex items-center gap-1.5"><span class="i-lucide-text-quote h-3.5 w-3.5"></span>{{ t("comfyui.panel.sourceText") }}</span>
                    <span :class="sourceExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>
                <p class="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--text-main)]" :class="sourceExpanded ? '' : 'line-clamp-2'">{{ sourceText }}</p>
            </div>

            <!-- 提示词 -->
            <div class="grid gap-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-[var(--text-secondary)]">{{ t("comfyui.panel.positive") }}</span>
                    <button v-if="sourceText" type="button" class="flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :disabled="distilling" @click="void distill()">
                        <span :class="distilling ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-sparkles'" class="h-3 w-3"></span>
                        {{ distilling ? t("comfyui.panel.distilling") : t("comfyui.panel.redistill") }}
                    </button>
                </div>
                <textarea v-model="params.positive" class="min-h-[72px] w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :placeholder="t('comfyui.panel.positivePlaceholder')" spellcheck="false"></textarea>
                <span class="text-xs font-medium text-[var(--text-secondary)]">{{ t("comfyui.panel.negative") }}</span>
                <textarea v-model="params.negative" class="min-h-[48px] w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" spellcheck="false"></textarea>
            </div>

            <!-- 参数行 -->
            <div class="grid grid-cols-3 gap-2">
                <label class="block">
                    <span class="text-[11px] text-[var(--text-secondary)]">{{ t("comfyui.panel.width") }}</span>
                    <input v-model.number="params.width" type="number" min="64" max="4096" step="64" class="mt-0.5 h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]">
                </label>
                <label class="block">
                    <span class="text-[11px] text-[var(--text-secondary)]">{{ t("comfyui.panel.height") }}</span>
                    <input v-model.number="params.height" type="number" min="64" max="4096" step="64" class="mt-0.5 h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]">
                </label>
                <label class="block">
                    <span class="text-[11px] text-[var(--text-secondary)]">{{ t("comfyui.panel.steps") }}</span>
                    <input v-model.number="params.steps" type="number" min="1" max="150" step="1" class="mt-0.5 h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]">
                </label>
                <label class="block">
                    <span class="text-[11px] text-[var(--text-secondary)]">CFG</span>
                    <input v-model.number="params.cfg" type="number" min="0" max="30" step="0.5" class="mt-0.5 h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]">
                </label>
                <label class="block">
                    <span class="text-[11px] text-[var(--text-secondary)]">{{ t("comfyui.panel.seed") }}</span>
                    <input :value="params.seed ?? ''" type="number" min="0" :placeholder="t('comfyui.panel.seedRandom')" class="mt-0.5 h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" @input="params.seed = ($event.target as HTMLInputElement).value === '' ? null : Math.max(0, Math.floor(Number(($event.target as HTMLInputElement).value)))">
                </label>
                <label class="block">
                    <span class="text-[11px] text-[var(--text-secondary)]">{{ t("comfyui.panel.workflow") }}</span>
                    <select v-model="params.workflowId" class="mt-0.5 h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]">
                        <option :value="null">{{ t("comfyui.panel.builtinWorkflow") }}</option>
                        <option v-for="workflow in workflows.filter((item) => !item.builtin)" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option>
                    </select>
                </label>
            </div>

            <!-- 面板内错误（蒸馏/提交失败） -->
            <div v-if="panelError" class="flex items-start gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-2 text-xs leading-4 text-[var(--status-danger)]">
                <span class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                <span class="break-all">{{ panelError }}</span>
            </div>

            <!-- 生成 / 取消 -->
            <div class="flex items-center gap-2">
                <button type="button" class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--accent-main)] text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50" :disabled="submitting || generationActive || distilling" @click="void generate()">
                    <span :class="submitting ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-image-plus'" class="h-3.5 w-3.5"></span>
                    {{ t("comfyui.panel.generate") }}
                </button>
                <button v-if="generationActive" type="button" class="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--status-danger)]" @click="void cancelActiveJob()">
                    <span class="i-lucide-square h-3 w-3"></span>{{ t("comfyui.panel.cancel") }}
                </button>
            </div>

            <!-- 当前任务进度 -->
            <div v-if="activeJob" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] bg-opacity-40 px-3 py-2.5">
                <div class="flex items-center justify-between text-xs">
                    <span class="flex items-center gap-1.5 text-[var(--text-main)]">
                        <span v-if="generationActive" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin text-[var(--status-info)]"></span>
                        <span v-else-if="activeJob.status === 'completed'" class="i-lucide-check-circle-2 h-3.5 w-3.5 text-[var(--status-success)]"></span>
                        <span v-else class="i-lucide-alert-circle h-3.5 w-3.5 text-[var(--status-danger)]"></span>
                        {{ statusLabel }}
                        <span v-if="activeJob.progressNode" class="text-[var(--text-muted)]">· {{ activeJob.progressNode }}</span>
                    </span>
                    <span class="text-[var(--text-secondary)]">{{ progressPercent }}%</span>
                </div>
                <!-- 进度条 -->
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-panel)]">
                    <div class="h-full rounded-full bg-[var(--accent-main)] transition-all duration-300" :style="{width: `${progressPercent}%`}"></div>
                </div>
                <div v-if="activeJob.error" class="mt-1.5 text-xs leading-4 text-[var(--status-danger)]">{{ activeJob.error }}</div>
                <div class="mt-1 text-[11px] text-[var(--text-muted)]">seed: {{ activeJob.resolvedSeed }}</div>

                <!-- 完成后缩略图 + 插入 -->
                <div v-if="activeJob.status === 'completed' && activeJob.images.length > 0" class="mt-2 grid gap-2">
                    <div v-for="image in activeJob.images" :key="image.path" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1.5">
                        <img :src="thumbnailUrl(activeJob, image.path)" :alt="image.path" class="max-h-[240px] w-full rounded object-contain" loading="lazy">
                        <div class="mt-1.5 flex items-center justify-between gap-2">
                            <span class="min-w-0 truncate text-[10px] text-[var(--text-muted)]">{{ image.path }}</span>
                            <button v-if="insertTarget" type="button" class="flex h-6 shrink-0 items-center gap-1 rounded-md bg-[var(--accent-main)] px-2 text-[11px] text-white transition-opacity hover:opacity-90" @click="requestInsert(image.path)">
                                <span class="i-lucide-corner-down-left h-3 w-3"></span>{{ t("comfyui.panel.insert") }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 最近任务 -->
            <div v-if="recentJobs.length > 0" class="grid gap-1">
                <span class="text-[11px] text-[var(--text-muted)]">{{ t("comfyui.panel.recentJobs") }}</span>
                <button v-for="job in recentJobs" :key="job.jobId" type="button" class="flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] bg-opacity-30 px-2 py-1 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" @click="trackJob(job.jobId)">
                    <span class="min-w-0 truncate">{{ job.params.positive }}</span>
                    <span class="shrink-0" :class="job.status === 'completed' ? 'text-[var(--status-success)]' : job.status === 'failed' ? 'text-[var(--status-danger)]' : ''">{{ t(`comfyui.panel.status.${job.status}`) }}</span>
                </button>
            </div>
        </div>
    </DialogWindow>
</template>
