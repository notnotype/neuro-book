<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import ProfilePromptMessageList from "nbook/app/components/profile-template-editor/ProfilePromptMessageList.vue";
import type {
    PreviewVariableGroup,
    PreviewVariableItem,
    SelectOption,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {
    ProfileTemplateIssueDto,
    ProfileTemplatePreviewMessageDto,
} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    modelValue: boolean;
    previewUpdatedAt: string;
    previewing: boolean;
    hasRoot: boolean;
    previewMessages: ProfileTemplatePreviewMessageDto[];
    issues: ProfileTemplateIssueDto[];
    selectedTemplateFileName: string;
    selectedThreadId: string;
    threadOptions: SelectOption[];
    loadingThreads: boolean;
    variableSearch: string;
    filteredRuntimeVariableGroups: PreviewVariableGroup[];
    theme: IdeTheme;
    isVariableGroupCollapsed: (group: string) => boolean;
    formatVariableSchema: (item: PreviewVariableItem) => string;
    formatVariableValue: (value: unknown) => string;
    shouldShowVariableValue: (item: PreviewVariableItem) => boolean;
    issueDetail: (issue: ProfileTemplateIssueDto) => string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "update:selectedThreadId", value: string): void;
    (e: "update:variableSearch", value: string): void;
    (e: "refresh-preview"): void;
    (e: "toggle-variable-group", group: string): void;
}>();
</script>

<template>
    <!-- Prompt 预览调试弹窗：变量输入与消息列表 -->
    <Dialog
        :model-value="props.modelValue"
        title="Prompt 预览调试"
        width="min(1380px, calc(100vw - 48px))"
        height="min(860px, calc(100vh - 48px))"
        overlay-type="opaque"
        body-class="!gap-0 !overflow-hidden"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header-extra>
            <div class="flex shrink-0 items-center gap-2">
                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                    {{ props.previewUpdatedAt ? `更新于 ${props.previewUpdatedAt}` : "尚未生成" }}
                </span>
                <button class="small-btn" :disabled="props.previewing || !props.hasRoot" @click="emit('refresh-preview')">
                    <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="props.previewing ? 'animate-spin' : ''"></span>
                    <span>刷新</span>
                </button>
            </div>
        </template>

        <div class="preview-dialog-content">
            <aside class="preview-variable-pane">
                <div class="preview-summary-grid">
                    <div class="preview-summary-card">
                        <div class="preview-summary-label">消息</div>
                        <div class="preview-summary-value">{{ props.previewMessages.length }}</div>
                    </div>
                    <div class="preview-summary-card">
                        <div class="preview-summary-label">问题</div>
                        <div class="preview-summary-value">{{ props.issues.length }}</div>
                    </div>
                </div>

                <section class="preview-section">
                    <div class="preview-section-title">
                        <span class="i-lucide-file-code-2 h-3.5 w-3.5"></span>
                        <span>{{ props.selectedTemplateFileName }}</span>
                    </div>
                    <div class="text-[11px] leading-5 text-[var(--text-muted)]">预览会编译当前源码，展示 ProfileTurnPlan 分区，不会保存文件。</div>
                </section>

                <section class="preview-section">
                    <div class="preview-section-title">
                        <span class="i-lucide-message-circle h-3.5 w-3.5"></span>
                        <span>线程上下文</span>
                    </div>
                    <FormSelect
                        :model-value="props.selectedThreadId"
                        :options="props.threadOptions"
                        :placeholder="props.loadingThreads ? '加载线程中...' : '选择 leader 线程'"
                        dropdown-direction="down"
                        @update:model-value="emit('update:selectedThreadId', $event)"
                    />
                    <div class="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">变量当前值来自所选线程 scope；切换线程后会重新生成预览。</div>
                </section>

                <section class="preview-section">
                    <div class="preview-section-title">
                        <span class="i-lucide-braces h-3.5 w-3.5"></span>
                        <span>变量</span>
                    </div>
                    <FormInput :model-value="props.variableSearch" placeholder="搜索变量、路径或当前值" @update:model-value="emit('update:variableSearch', $event)" />
                    <div class="preview-variable-list custom-scrollbar">
                        <section v-for="group in props.filteredRuntimeVariableGroups" :key="`dialog-variable-${group.group}`" class="variable-group-section">
                            <button class="variable-group-header" @click="emit('toggle-variable-group', group.group)">
                                <span :class="props.isVariableGroupCollapsed(group.group) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                                <span>{{ group.group }}</span>
                                <span class="ml-auto text-[10px] text-[var(--text-muted)]">{{ group.items.length }}</span>
                            </button>
                            <div v-if="!props.isVariableGroupCollapsed(group.group)" class="mt-2 space-y-2">
                                <div v-for="item in group.items" :key="item.path" class="preview-variable-card">
                                    <div class="flex min-w-0 items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                                                <span class="text-[11px] font-semibold text-[var(--text-main)]">{{ item.label }}</span>
                                                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ props.formatVariableSchema(item) }}</span>
                                                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ item.source }}</span>
                                            </div>
                                            <code class="mt-1 block text-[10px] text-[var(--text-muted)]">{{ item.path }}</code>
                                            <div v-if="item.description" class="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{{ item.description }}</div>
                                        </div>
                                        <span v-if="item.editable" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">只读预览</span>
                                    </div>
                                    <pre v-if="props.shouldShowVariableValue(item)" class="preview-variable-value">{{ props.formatVariableValue(item.currentValue) }}</pre>
                                </div>
                            </div>
                        </section>
                    </div>
                </section>

                <section v-if="props.issues.length > 0" class="preview-section">
                    <div class="preview-section-title">
                        <span class="i-lucide-triangle-alert h-3.5 w-3.5"></span>
                        <span>问题</span>
                    </div>
                    <div class="space-y-2">
                        <div v-for="issue in props.issues" :key="`dialog-${issue.message}-${issue.nodeId ?? issue.path ?? ''}`" class="rounded-md border px-3 py-2 text-xs" :class="issue.severity === 'error' ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                            <div class="font-semibold">{{ issue.message }}</div>
                            <div v-if="props.issueDetail(issue)" class="mt-1 leading-5 opacity-80">{{ props.issueDetail(issue) }}</div>
                        </div>
                    </div>
                </section>
            </aside>

            <section class="preview-message-pane">
                <div class="preview-section-title">
                    <span class="i-lucide-messages-square h-3.5 w-3.5"></span>
                    <span>Prompt 消息</span>
                    <span class="ml-auto text-[11px] font-medium text-[var(--text-muted)]">{{ props.previewMessages.length }} 条</span>
                </div>
                <ProfilePromptMessageList :messages="props.previewMessages" :loading="props.previewing" :theme="props.theme" />
            </section>
        </div>
    </Dialog>
</template>

<style scoped>
.small-btn {
    display: inline-flex;
    height: 28px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 0 10px;
    color: var(--text-secondary);
    font-size: 12px;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.small-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}

.small-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.preview-dialog-content {
    display: grid;
    height: 100%;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
    gap: 12px;
    overflow: hidden;
}

.preview-variable-pane,
.preview-message-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-panel) 94%, var(--bg-input));
}

.preview-variable-pane,
.preview-message-pane {
    overflow: hidden;
    padding: 10px;
}

.preview-summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
}

.preview-summary-card {
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 8px 10px;
}

.preview-summary-label {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
}

.preview-summary-value {
    margin-top: 3px;
    overflow: hidden;
    color: var(--text-main);
    font-size: 20px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.preview-section {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    padding: 10px;
}

.preview-section + .preview-section {
    margin-top: 10px;
}

.preview-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
}

.preview-variable-pane .preview-section:nth-of-type(3) {
    flex: 1;
}

.preview-variable-list {
    min-height: 0;
    overflow: auto;
    padding-right: 2px;
    margin-top: 8px;
}

.preview-variable-card {
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: color-mix(in srgb, var(--bg-panel) 82%, var(--bg-input));
    padding: 8px;
}

.preview-variable-value {
    margin-top: 8px;
    max-height: 110px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.55;
}

.variable-chip {
    display: inline-flex;
    max-width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 30%, var(--border-color));
    border-radius: 5px;
    background: var(--accent-bg);
    padding: 3px 7px;
    color: var(--accent-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
}

.variable-chip:hover {
    border-color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-bg) 65%, var(--bg-hover));
}

.variable-group-section {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    padding: 8px;
}

.variable-group-header {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
    text-align: left;
}
</style>
