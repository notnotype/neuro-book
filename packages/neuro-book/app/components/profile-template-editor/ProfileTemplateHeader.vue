<script setup lang="ts">
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import Tooltip from "nbook/app/components/common/Tooltip.vue";
import type {SelectOption} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";

const props = defineProps<{
    title?: string;
    subtitle?: string;
    selectedTemplate: string;
    templateOptions: SelectOption[];
    editorStatusText: string;
    canUndo: boolean;
    canRedo: boolean;
    previewing: boolean;
    validating: boolean;
    saving: boolean;
    parsingSource: boolean;
    sourceText: string;
    issueCount: number;
    restoreEnabled?: boolean;
    createEnabled?: boolean;
    runEnabled?: boolean;
    compileEnabled?: boolean;
    compileAllEnabled?: boolean;
    allowSaveWithIssues?: boolean;
    validateLabel?: string;
    runDisabled?: boolean;
    restoring?: boolean;
    compiling?: boolean;
    compilingAll?: boolean;
    closable?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:selectedTemplate", value: string): void;
    (e: "undo"): void;
    (e: "redo"): void;
    (e: "preview"): void;
    (e: "validate"): void;
    (e: "compile"): void;
    (e: "compileAll"): void;
    (e: "restore"): void;
    (e: "create"): void;
    (e: "run"): void;
    (e: "save"): void;
    (e: "close"): void;
}>();
</script>

<template>
    <!-- TSX Profile 顶部工具栏 -->
    <header class="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4">
        <div class="flex min-w-0 items-center gap-3">
            <div class="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--accent-main)] text-xs font-semibold text-[var(--text-inverse)] shadow-sm">TS</div>
            <div class="min-w-0">
                <div class="flex items-center gap-2 text-[13px] font-semibold">
                    <span class="truncate">{{ props.title ?? "TSX Profile 可视化编辑器" }}</span>
                    <span v-if="props.subtitle" class="truncate text-[12px] font-medium text-[var(--text-muted)]">{{ props.subtitle }}</span>
                </div>
            </div>
        </div>

        <FormSelect :model-value="props.selectedTemplate" :options="props.templateOptions" placeholder="选择模板" dropdown-direction="down" class="min-w-0 max-w-[320px] flex-1" @update:model-value="emit('update:selectedTemplate', $event)" />

        <div class="ml-auto flex shrink-0 items-center gap-2">
            <span class="hidden items-center gap-1 text-xs text-[var(--status-success)] md:flex">
                <span class="i-lucide-circle-check h-3.5 w-3.5"></span>
                <span>{{ props.editorStatusText }}</span>
            </span>
            <div class="mx-2 hidden h-4 w-px bg-[var(--border-color)] lg:block"></div>
            <Tooltip text="撤销 Ctrl+Z" placement="bottom">
                <button class="icon-btn" aria-label="撤销" :disabled="!props.canUndo" @click="emit('undo')">
                    <span class="i-lucide-undo-2 h-4 w-4"></span>
                </button>
            </Tooltip>
            <Tooltip text="重做 Ctrl+Shift+Z" placement="bottom">
                <button class="icon-btn" aria-label="重做" :disabled="!props.canRedo" @click="emit('redo')">
                    <span class="i-lucide-redo-2 h-4 w-4"></span>
                </button>
            </Tooltip>
            <Tooltip text="预览" placement="bottom">
                <button class="icon-btn" aria-label="预览" :disabled="props.previewing || !props.sourceText" @click="emit('preview')">
                    <span class="i-lucide-play h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="!props.compileEnabled" :text="props.validateLabel ?? '验证'" placement="bottom">
                <button class="icon-btn" aria-label="验证" :disabled="props.validating || !props.sourceText" @click="emit('validate')">
                    <span class="i-lucide-badge-check h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="props.compileEnabled" text="编译" placement="bottom">
                <button class="icon-btn" aria-label="编译" :disabled="props.compiling || props.compilingAll || props.saving || props.parsingSource || !props.sourceText" @click="emit('compile')">
                    <span class="i-lucide-hammer h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="props.compileAllEnabled" text="编译全部" placement="bottom">
                <button class="icon-btn" aria-label="编译全部" :disabled="props.compilingAll || props.compiling || props.saving" @click="emit('compileAll')">
                    <span class="i-lucide-package-check h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="props.restoreEnabled" text="恢复系统版本" placement="bottom">
                <button class="icon-btn" aria-label="恢复系统版本" :disabled="props.restoring || props.saving || !props.sourceText" @click="emit('restore')">
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="props.createEnabled" text="新建" placement="bottom">
                <button class="icon-btn" aria-label="新建" :disabled="props.saving" @click="emit('create')">
                    <span class="i-lucide-file-plus-2 h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="props.runEnabled" text="创建 Session" placement="bottom">
                <button class="icon-btn" aria-label="创建 Session" :disabled="props.saving || props.issueCount > 0 || props.runDisabled" @click="emit('run')">
                    <span class="i-lucide-message-circle-plus h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip text="保存" placement="bottom">
                <button class="icon-btn primary" aria-label="保存" :disabled="props.saving || props.parsingSource || !props.sourceText || (!props.allowSaveWithIssues && props.issueCount > 0)" @click="emit('save')">
                    <span class="i-lucide-save h-3.5 w-3.5"></span>
                </button>
            </Tooltip>
            <Tooltip v-if="props.closable" text="关闭" placement="bottom">
                <button class="icon-btn" aria-label="关闭" @click="emit('close')">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </Tooltip>
        </div>
    </header>
</template>

<style scoped>
.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 12px;
    height: 32px;
    width: 32px;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.icon-btn.primary {
    border-color: var(--accent-main);
    background: var(--accent-main);
    color: var(--text-inverse);
}

.icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}

.icon-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
</style>
