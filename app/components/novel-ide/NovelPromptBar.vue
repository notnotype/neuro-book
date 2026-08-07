<script setup lang="ts">
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import ReferencePlainTextEditor from "nbook/app/components/common/form/ReferencePlainTextEditor.vue";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import AgentSessionModelControls from "nbook/app/components/novel-ide/agent/AgentSessionModelControls.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import {parseSelectionRefChip, type InlineEditReference, type InlineEditTask} from "nbook/app/utils/inline-editor-selection";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

interface InlineTaskOption {
    id: InlineEditTask;
    label: string;
    iconClass: string;
    description: string;
}

interface InlineEditorLiveView {
    thinking: string;
    content: string;
    status: string | null;
    editPreview: string;
    resultText: string;
}

const props = defineProps<{
    modelValue: string;
    loading: boolean;
    running: boolean;
    expanded: boolean;
    task: InlineEditTask;
    references: InlineEditReference[];
    currentPath: string;
    sessionLabel: string;
    sessions: AgentSessionSummaryDto[];
    activeSessionId: number | null;
    sessionLoading: boolean;
    editPreview: string;
    resultText: string;
    liveView: InlineEditorLiveView;
    selectableModels: EnabledModelOptionDto[];
    sessionModelSelectionValue: string | null;
    sessionModelDraft: AgentSessionModelDraft;
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    sessionThinkingResolvedLabel: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:expanded", value: boolean): void;
    (e: "update:task", value: InlineEditTask): void;
    (e: "send"): void;
    (e: "stop"): void;
    (e: "height-change", value: number): void;
    (e: "clear-reference", index: number): void;
    (e: "hover-reference", reference: InlineEditReference | null): void;
    (e: "select-session", sessionId: number): void;
    (e: "create-session"): void;
    (e: "open-session-chat"): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const editorRef = ref<InstanceType<typeof ReferencePlainTextEditor> | null>(null);
const {t} = useI18n();
const inputExpanded = ref(false);
let resizeObserver: ResizeObserver | null = null;

const taskOptions = computed<InlineTaskOption[]>(() => [
    {id: "chat", label: t("ide.inlineAi.taskChat"), iconClass: "i-lucide-message-square-text", description: t("ide.inlineAi.chatDescription")},
    {id: "rewrite", label: t("ide.inlineAi.taskRewrite"), iconClass: "i-lucide-refresh-cw", description: t("ide.inlineAi.rewriteDescription")},
    {id: "polish", label: t("ide.inlineAi.taskPolish"), iconClass: "i-lucide-sparkles", description: t("ide.inlineAi.polishDescription")},
    {id: "expand", label: t("ide.inlineAi.taskExpand"), iconClass: "i-lucide-stretch-horizontal", description: t("ide.inlineAi.expandDescription")},
    {id: "condense", label: t("ide.inlineAi.taskCondense"), iconClass: "i-lucide-shrink", description: t("ide.inlineAi.condenseDescription")},
    {id: "continue_after", label: t("ide.inlineAi.taskContinueAfter"), iconClass: "i-lucide-forward", description: t("ide.inlineAi.continueAfterDescription")},
    {id: "bridge", label: t("ide.inlineAi.taskBridge"), iconClass: "i-lucide-git-compare-arrows", description: t("ide.inlineAi.bridgeDescription")},
]);

const taskDropdownItems = computed<DropdownItem[]>(() => taskOptions.value.map((option) => ({
    label: option.label,
    value: option.id,
    iconClass: option.iconClass,
    active: option.id === props.task,
    rightIconClass: option.id === props.task ? "i-lucide-check" : undefined,
})));

const currentTask = computed(() => taskOptions.value.find((option) => option.id === props.task) ?? taskOptions.value[0]!);
const canSubmit = computed(() => props.running || (!props.loading && (Boolean(props.modelValue.trim()) || props.references.length > 0)));
const inputMinHeight = computed(() => inputExpanded.value ? 220 : 36);
const inputMaxHeight = computed(() => inputExpanded.value ? 420 : 96);
const expandButtonTitle = computed(() => inputExpanded.value ? t("agent.composer.collapseEditor") : t("agent.composer.expandEditor"));
const expandButtonIcon = computed(() => inputExpanded.value ? "i-lucide-minimize-2" : "i-lucide-maximize-2");
const displayEditPreview = computed(() => props.liveView.editPreview || props.editPreview);
const displayResultText = computed(() => props.liveView.resultText || props.resultText);
const hasLivePanel = computed(() => Boolean(props.liveView.thinking || props.liveView.content || displayEditPreview.value || displayResultText.value || props.running));
const livePanelTitle = computed(() => {
    if (props.running) {
        return t("ide.inlineAi.running");
    }
    if (displayResultText.value) {
        return t("ide.inlineAi.result");
    }
    return t("ide.inlineAi.sessionPreview");
});
const sessionDropdownItems = computed<DropdownItem[]>(() => {
    return props.sessions.length > 0
        ? props.sessions.map((session) => ({
            label: sessionTitle(session),
            value: `session:${String(session.sessionId)}`,
            iconClass: session.status === "running" || session.status === "waiting" ? "i-lucide-loader-circle" : "i-lucide-message-square-more",
            active: session.sessionId === props.activeSessionId,
            rightIconClass: session.sessionId === props.activeSessionId ? "i-lucide-check" : undefined,
        }))
        : [{
            label: t("ide.inlineAi.noInlineSession"),
            value: "__empty",
            iconClass: "i-lucide-circle-dashed",
        }];
});

/**
 * 选择 Inline AI 任务。
 */
function selectTask(value: string): void {
    if (taskOptions.value.some((option) => option.id === value)) {
        emit("update:task", value as InlineEditTask);
    }
}

/**
 * 处理 Inline AI session 菜单。
 */
function selectSessionMenu(value: string): void {
    if (!value.startsWith("session:")) {
        return;
    }
    const sessionId = Number(value.slice("session:".length));
    if (Number.isInteger(sessionId) && sessionId > 0) {
        emit("select-session", sessionId);
    }
}

/**
 * 发送当前 PromptBar 的真实高度。
 */
const reportHeight = (): void => {
    emit("height-change", rootRef.value?.offsetHeight ?? 0);
};

/**
 * 切换 PromptBar 展开状态。
 */
const toggleExpanded = (): void => {
    emit("update:expanded", !props.expanded);
};

/**
 * 处理发送或停止。
 */
const submit = (): void => {
    if (props.running) {
        emit("stop");
        return;
    }
    if (props.loading) {
        return;
    }
    if (!canSubmit.value) {
        return;
    }
    emit("send");
};

/**
 * 读取 selection chip 的紧凑展示名。
 */
function referenceLabel(reference: InlineEditReference): string {
    return parseSelectionRefChip(reference.ref)?.label ?? reference.path;
}

/**
 * 返回 session 在 PromptBar 菜单里的展示名。
 */
function sessionTitle(session: AgentSessionSummaryDto): string {
    return session.title || `Inline AI #${String(session.sessionId)}`;
}

watch(() => props.expanded, async (expanded) => {
    await nextTick();
    reportHeight();
    if (expanded) {
        editorRef.value?.focus();
    }
}, {immediate: true});

watch(() => [
    props.modelValue,
    props.references.length,
    props.editPreview,
    props.resultText,
    props.liveView.thinking,
    props.liveView.content,
    props.liveView.editPreview,
    props.liveView.resultText,
    inputExpanded.value,
], async () => {
    await nextTick();
    reportHeight();
});

onMounted(async () => {
    await nextTick();
    reportHeight();

    if (rootRef.value) {
        resizeObserver = new ResizeObserver(() => {
            reportHeight();
        });
        resizeObserver.observe(rootRef.value);
    }
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>

<template>
    <!-- 底部 Inline AI Prompt Bar -->
    <div ref="rootRef" class="ide-prompt-bar z-20 shrink-0 px-4">
        <div v-if="props.expanded" class="relative mx-auto w-full max-w-4xl pb-5 pt-7">
            <button
                class="absolute left-1/2 top-7 flex h-6 w-12 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-full border border-b-0 border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('ide.inlineAi.collapse')"
                @click="toggleExpanded"
            >
                <span class="i-lucide-chevron-down h-3.5 w-3.5"></span>
            </button>

            <div class="w-full overflow-visible rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-2xl shadow-black/10 transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]">
                <!-- Inline AI 当前 Session 展示区 -->
                <div v-if="hasLivePanel" class="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-2 text-xs text-[var(--text-secondary)]">
                    <div class="mb-2 flex items-center justify-between gap-3">
                        <div class="flex min-w-0 items-center gap-2 font-medium text-[var(--text-main)]">
                            <span :class="props.running ? 'i-lucide-loader-circle animate-spin text-[var(--accent-text)]' : 'i-lucide-message-square-text text-[var(--status-success)]'" class="h-3.5 w-3.5 shrink-0"></span>
                            <span class="truncate">{{ livePanelTitle }}</span>
                        </div>
                        <button class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" @click="emit('open-session-chat')">
                            <span class="i-lucide-panel-right-open h-3 w-3"></span>
                            <span>{{ t("ide.inlineAi.openSessionChat") }}</span>
                        </button>
                    </div>
                    <div class="max-h-48 space-y-2 overflow-y-auto pr-1">
                        <div v-if="props.liveView.thinking" class="rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-panel)] px-2.5 py-2">
                            <div class="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase text-[var(--text-muted)]">
                                <span class="i-lucide-brain h-3 w-3"></span>
                                <span>{{ t("ide.inlineAi.thinking") }}</span>
                            </div>
                            <AgentMarkdownContent :content="props.liveView.thinking" :streaming="props.liveView.status === 'streaming'" />
                        </div>
                        <div v-if="props.liveView.content" class="rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-panel)] px-2.5 py-2 text-[var(--text-secondary)]">
                            <AgentMarkdownContent :content="props.liveView.content" :streaming="props.liveView.status === 'streaming'" />
                        </div>
                        <div v-if="displayEditPreview" class="rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-panel)] px-2.5 py-2">
                            <div class="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase text-[var(--text-muted)]">
                                <span class="i-lucide-file-diff h-3 w-3"></span>
                                <span>{{ t("ide.inlineAi.editing") }}</span>
                            </div>
                            <div class="whitespace-pre-wrap leading-5">{{ displayEditPreview }}</div>
                        </div>
                        <div v-if="displayResultText && !displayEditPreview" class="rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-2.5 py-2 text-[var(--text-secondary)]">
                            <div class="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase text-[var(--status-success)]">
                                <span class="i-lucide-check-check h-3 w-3"></span>
                                <span>{{ t("ide.inlineAi.result") }}</span>
                            </div>
                            <div class="whitespace-pre-wrap leading-5">{{ displayResultText }}</div>
                        </div>
                    </div>
                </div>

                <!-- Inline AI 引用区 -->
                <div class="border-b border-[var(--border-color)] px-4 py-1.5">
                    <div class="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="inline-flex h-5 items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                            <span class="i-lucide-quote h-3.5 w-3.5"></span>
                            <span>{{ t("ide.inlineAi.references") }}</span>
                        </span>
                        <span
                            v-for="(reference, index) in props.references"
                            :key="`${reference.ref}:${String(index)}`"
                            class="group inline-flex h-5 max-w-[18rem] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs leading-none text-[var(--text-main)] transition-colors hover:border-[var(--status-danger-border)]"
                            :title="reference.ref"
                            @mouseenter="emit('hover-reference', reference)"
                            @mouseleave="emit('hover-reference', null)"
                        >
                            <span class="i-lucide-text-select h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                            <span class="truncate">{{ referenceLabel(reference) }}</span>
                            <button
                                type="button"
                                class="-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] focus:bg-[var(--status-danger-bg)] focus:text-[var(--status-danger)] focus:outline-none"
                                :title="t('ide.inlineAi.clearReference')"
                                @focus="emit('hover-reference', reference)"
                                @blur="emit('hover-reference', null)"
                                @click.stop="emit('clear-reference', index); emit('hover-reference', null)"
                            >
                                <span class="i-lucide-x h-3 w-3"></span>
                            </button>
                        </span>
                        <span v-if="props.references.length === 0" class="inline-flex h-5 items-center text-xs text-[var(--text-muted)]">
                            {{ t("ide.inlineAi.noReferenceBound") }}
                        </span>
                    </div>
                </div>

                <ReferencePlainTextEditor
                    ref="editorRef"
                    :model-value="props.modelValue"
                    :placeholder="t('ide.inlineAi.promptPlaceholder')"
                    :min-height="inputMinHeight"
                    :max-height="inputMaxHeight"
                    :expanded="inputExpanded"
                    borderless
                    :submit-on-enter="!inputExpanded"
                    enable-quick-triggers
                    @update:model-value="emit('update:modelValue', $event)"
                    @submit="submit"
                />

                <!-- Inline AI 控制区 -->
                <div class="flex items-center justify-between gap-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <Dropdown :items="taskDropdownItems" root-class="relative inline-block" menu-class="left-0 bottom-full mb-1.5 w-40" compact @select="selectTask">
                            <button class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" :title="currentTask.description">
                                <span :class="currentTask.iconClass" class="h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                <span>{{ currentTask.label }}</span>
                                <span class="i-lucide-chevron-up h-3 w-3 text-[var(--text-muted)]"></span>
                            </button>
                        </Dropdown>

                        <Dropdown :items="sessionDropdownItems" root-class="relative inline-block" menu-class="left-0 bottom-full mb-1.5 w-56" compact @select="selectSessionMenu">
                            <button
                                class="inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                type="button"
                                :title="t('ide.inlineAi.selectSession')"
                                data-inline-agent-action="session-menu"
                                :data-inline-agent-session-id="props.activeSessionId ?? undefined"
                            >
                                <span :class="props.sessionLoading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-message-square-more'" class="h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                <span class="truncate">{{ props.sessionLabel }}</span>
                                <span class="i-lucide-chevron-up h-3 w-3 text-[var(--text-muted)]"></span>
                            </button>
                        </Dropdown>

                        <button
                            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            :disabled="props.sessionLoading || props.running"
                            :title="t('ide.inlineAi.createSession')"
                            data-inline-agent-action="create-session"
                            @click="emit('create-session')"
                        >
                            <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        </button>

                        <AgentSessionModelControls
                            :session-model-selection-value="props.sessionModelSelectionValue"
                            :session-thinking-resolved-label="props.sessionThinkingResolvedLabel"
                            :session-model-draft="props.sessionModelDraft"
                            :selectable-models="props.selectableModels"
                            :session-model-saving="props.sessionModelSaving"
                            :session-model-popover-open="props.sessionModelPopoverOpen"
                            :running="props.running"
                            :loading-session="props.sessionLoading || !props.activeSessionId"
                            dropdown-direction="up"
                            root-class="w-[260px] max-w-[40vw]"
                            popover-class="w-[340px]"
                            @update:session-model-popover-open="emit('update:sessionModelPopoverOpen', $event)"
                            @update:session-model-draft="emit('update:sessionModelDraft', $event)"
                            @update-session-model-selection="emit('update-session-model-selection', $event)"
                            @toggle-session-model-popover="emit('toggle-session-model-popover')"
                            @apply-session-model-settings="emit('apply-session-model-settings')"
                            @reset-session-model-settings="emit('reset-session-model-settings')"
                        />

                        <button
                            class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                            :class="inputExpanded ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                            :title="expandButtonTitle"
                            type="button"
                            @click="inputExpanded = !inputExpanded"
                        >
                            <span :class="expandButtonIcon" class="h-3.5 w-3.5"></span>
                        </button>
                    </div>

                    <div class="flex items-center gap-2">
                        <button
                            class="flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                            :class="props.running ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)] hover:opacity-85'"
                            :disabled="!canSubmit"
                            :title="props.running ? t('ide.inlineAi.stop') : t('ide.inlineAi.send')"
                            @click="submit"
                        >
                            <span v-if="props.running" class="i-lucide-square h-3.5 w-3.5"></span>
                            <span v-else class="i-lucide-send h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="flex justify-center">
            <button
                class="flex h-6 w-12 items-center justify-center rounded-t-full border border-b-0 border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('ide.inlineAi.expandBar')"
                data-inline-agent-action="expand-bar"
                @click="toggleExpanded"
            >
                <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
            </button>
        </div>
    </div>
</template>
