<script setup lang="ts">
/**
 * ComfyUI 工作流管理区块（设置页 comfyui 面板内嵌）：
 * 列出内置模板与用户导入的工作流、选择默认工作流（写回父面板的 activeWorkflowId 草稿）、
 * 导入 ComfyUI「导出 API」JSON、编辑注入点 mapping、删除。
 * 列表与 mapping 的增删改即时生效（独立于父面板的保存按钮）；仅默认工作流选择随父面板保存。
 */
import {useNotification} from "nbook/app/composables/useNotification";
import {useDialog} from "nbook/app/composables/useDialog";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ComfyUiNodeFieldRefDto, ComfyUiWorkflowMappingDto, ComfyUiWorkflowSummaryDto} from "nbook/shared/dto/comfyui.dto";

const props = defineProps<{
    activeWorkflowId: string | null;
}>();

const emit = defineEmits<{
    (e: "update:activeWorkflowId", value: string | null): void;
}>();

const notification = useNotification();
const dialog = useDialog();
const {t} = useI18n();

const loading = ref(false);
const importing = ref(false);
const workflows = ref<ComfyUiWorkflowSummaryDto[]>([]);
const importInputRef = ref<HTMLInputElement | null>(null);
/** 当前展开 mapping 编辑的工作流 id；null 表示都收起。 */
const expandedId = ref<string | null>(null);
/** mapping 编辑草稿：7 项 → "nodeId.field" 文本（空串 = 不注入）。 */
const mappingDraft = ref<Record<MappingKey, string>>(emptyMappingDraft());
const savingMapping = ref(false);

const MAPPING_KEYS = ["positive", "negative", "width", "height", "seed", "steps", "cfg"] as const;
type MappingKey = typeof MAPPING_KEYS[number];

function emptyMappingDraft(): Record<MappingKey, string> {
    return {positive: "", negative: "", width: "", height: "", seed: "", steps: "", cfg: ""};
}

function refToText(ref: ComfyUiNodeFieldRefDto | null): string {
    return ref ? `${ref.nodeId}.${ref.field}` : "";
}

/** 解析 "nodeId.field" 文本；空串 → null；无点号视为非法返回 undefined。 */
function textToRef(text: string): ComfyUiNodeFieldRefDto | null | undefined {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    const dotIndex = trimmed.indexOf(".");
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
        return undefined;
    }
    return {nodeId: trimmed.slice(0, dotIndex), field: trimmed.slice(dotIndex + 1)};
}

async function loadWorkflows(): Promise<void> {
    loading.value = true;
    try {
        const response = await $fetch<{items: ComfyUiWorkflowSummaryDto[]}>("/api/comfyui/workflows");
        workflows.value = response.items;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.comfyui.workflowLoadFailed")));
    } finally {
        loading.value = false;
    }
}

/** 展开某个自定义工作流的 mapping 编辑，并把当前 mapping 填入草稿。 */
function toggleExpand(workflow: ComfyUiWorkflowSummaryDto): void {
    if (expandedId.value === workflow.id) {
        expandedId.value = null;
        return;
    }
    expandedId.value = workflow.id;
    const draft = emptyMappingDraft();
    for (const key of MAPPING_KEYS) {
        draft[key] = refToText(workflow.mapping[key]);
    }
    mappingDraft.value = draft;
}

async function saveMapping(workflow: ComfyUiWorkflowSummaryDto): Promise<void> {
    const mapping = {} as ComfyUiWorkflowMappingDto;
    for (const key of MAPPING_KEYS) {
        const parsed = textToRef(mappingDraft.value[key]);
        if (parsed === undefined) {
            notification.error(t("settings.panels.comfyui.mappingInvalid", {key, value: mappingDraft.value[key]}));
            return;
        }
        mapping[key] = parsed;
    }
    savingMapping.value = true;
    try {
        const updated = await $fetch<ComfyUiWorkflowSummaryDto>(`/api/comfyui/workflows/${encodeURIComponent(workflow.id)}`, {
            method: "PUT",
            body: {mapping},
        });
        workflows.value = workflows.value.map((item) => item.id === updated.id ? updated : item);
        notification.success(t("settings.panels.comfyui.mappingSaved"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.comfyui.mappingSaveFailed")));
    } finally {
        savingMapping.value = false;
    }
}

async function removeWorkflow(workflow: ComfyUiWorkflowSummaryDto): Promise<void> {
    const confirmed = await dialog.confirm(t("settings.panels.comfyui.workflowDeleteConfirm", {name: workflow.name}), t("settings.panels.comfyui.workflowDeleteTitle"));
    if (!confirmed) {
        return;
    }
    try {
        await $fetch(`/api/comfyui/workflows/${encodeURIComponent(workflow.id)}`, {method: "DELETE"});
        workflows.value = workflows.value.filter((item) => item.id !== workflow.id);
        if (props.activeWorkflowId === workflow.id) {
            emit("update:activeWorkflowId", null);
        }
        if (expandedId.value === workflow.id) {
            expandedId.value = null;
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.comfyui.workflowDeleteFailed")));
    }
}

/** 触发文件选择导入。 */
function pickImportFile(): void {
    importInputRef.value?.click();
}

async function handleImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
        return;
    }
    importing.value = true;
    try {
        const text = await file.text();
        let workflow: unknown;
        try {
            workflow = JSON.parse(text);
        } catch {
            notification.error(t("settings.panels.comfyui.importNotJson"));
            return;
        }
        if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
            notification.error(t("settings.panels.comfyui.importNotWorkflow"));
            return;
        }
        const name = file.name.replace(/\.json$/iu, "") || t("settings.panels.comfyui.importedWorkflowName");
        const imported = await $fetch<ComfyUiWorkflowSummaryDto>("/api/comfyui/workflows", {
            method: "POST",
            body: {name, workflow},
        });
        workflows.value = [workflows.value[0]!, imported, ...workflows.value.slice(1)];
        notification.success(imported.issues.length > 0
            ? t("settings.panels.comfyui.importSuccessWithIssues", {count: imported.issues.length})
            : t("settings.panels.comfyui.importSuccess"));
        toggleExpand(imported);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.comfyui.importFailed")));
    } finally {
        importing.value = false;
    }
}

onMounted(() => {
    void loadWorkflows();
});
</script>

<template>
    <!-- ComfyUI 工作流管理区块 -->
    <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.panels.comfyui.workflowsTitle") }}</div>
                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.workflowsDescription") }}</div>
            </div>
            <button type="button" class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" :disabled="importing" @click="pickImportFile">
                <span v-if="importing" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                <span v-else class="i-lucide-file-up h-3.5 w-3.5"></span>
                {{ t("settings.panels.comfyui.importWorkflow") }}
            </button>
            <input ref="importInputRef" type="file" accept=".json,application/json" class="hidden" @change="void handleImportFile($event)">
        </div>

        <div v-if="loading" class="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>{{ t("common.loading") }}
        </div>

        <div v-else class="mt-3 grid gap-2">
            <!-- 单个工作流条目 -->
            <div v-for="workflow in workflows" :key="workflow.id" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] bg-opacity-40">
                <div class="flex items-center gap-3 px-3 py-2.5">
                    <!-- 默认工作流单选 -->
                    <button type="button" class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors" :class="(props.activeWorkflowId ?? null) === (workflow.builtin ? null : workflow.id) ? 'border-[var(--accent-main)]' : 'border-[var(--border-color)]'" :title="t('settings.panels.comfyui.setDefaultWorkflow')" @click="emit('update:activeWorkflowId', workflow.builtin ? null : workflow.id)">
                        <span v-if="(props.activeWorkflowId ?? null) === (workflow.builtin ? null : workflow.id)" class="h-2 w-2 rounded-full bg-[var(--accent-main)]"></span>
                    </button>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm text-[var(--text-main)]">{{ workflow.name }}</span>
                            <span v-if="workflow.builtin" class="shrink-0 rounded bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.builtinBadge") }}</span>
                            <span v-if="workflow.issues.length > 0" class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]" :title="workflow.issues.join('\n')">{{ t("settings.panels.comfyui.issuesBadge", {count: workflow.issues.length}) }}</span>
                        </div>
                    </div>
                    <template v-if="!workflow.builtin">
                        <button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.panels.comfyui.editMapping')" @click="toggleExpand(workflow)">
                            <span class="i-lucide-settings-2 h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--status-danger)]" :title="t('common.delete')" @click="void removeWorkflow(workflow)">
                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                        </button>
                    </template>
                </div>

                <!-- mapping 编辑区（仅自定义工作流可展开） -->
                <div v-if="expandedId === workflow.id" class="border-t border-[var(--border-color)] px-3 py-3">
                    <div v-if="workflow.issues.length > 0" class="mb-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[11px] leading-4 text-[var(--status-warning)]">
                        <div v-for="issue in workflow.issues" :key="issue">{{ issue }}</div>
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)]">{{ t("settings.panels.comfyui.mappingHint") }}</div>
                    <div class="mt-2 grid gap-1.5">
                        <label v-for="key in MAPPING_KEYS" :key="key" class="flex items-center gap-2">
                            <span class="w-16 shrink-0 text-xs text-[var(--text-secondary)]">{{ key }}</span>
                            <input v-model="mappingDraft[key]" type="text" class="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 font-mono text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" :placeholder="t('settings.panels.comfyui.mappingPlaceholder')" spellcheck="false">
                        </label>
                    </div>
                    <div class="mt-2.5 flex justify-end">
                        <button type="button" class="flex h-7 items-center gap-1.5 rounded-md border border-[var(--accent-main)] bg-[var(--accent-main)] px-3 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50" :disabled="savingMapping" @click="void saveMapping(workflow)">
                            <span v-if="savingMapping" class="i-lucide-loader-2 h-3 w-3 animate-spin"></span>
                            {{ t("settings.panels.comfyui.saveMapping") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
