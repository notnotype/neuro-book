<script setup lang="ts">
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentPendingResolutionDraft, AgentPendingSubmissionIssue} from "nbook/app/components/novel-ide/agent/agent-pending-resolution";
import AgentComposerInput from "nbook/app/components/novel-ide/agent/AgentComposerInput.vue";
import AgentSessionModelControls from "nbook/app/components/novel-ide/agent/AgentSessionModelControls.vue";
import AgentUserInputPrompt from "nbook/app/components/novel-ide/agent/AgentUserInputPrompt.vue";
import AgentWorkspaceChanges from "nbook/app/components/novel-ide/agent/AgentWorkspaceChanges.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentQueuedMessageDto, AgentMode, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {publicValuePreviewJsonValue} from "nbook/app/components/novel-ide/agent/agent-message";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";
import type {ComposerImageNode} from "nbook/app/components/novel-ide/agent/composer-image-transaction";
import {useComposerImageTransaction} from "nbook/app/components/novel-ide/agent/useComposerImageTransaction";
import type {
    AgentComposerAvailability,
    AgentComposerAvailabilityAction,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";

const props = defineProps<{
    inputText: string;
    pendingSessions: readonly AgentPendingUserInputSession[];
    pendingResolutionDraft: AgentPendingResolutionDraft;
    submittingUserInput: boolean;
    canResolveUserInput: boolean;
    canAbort: boolean;
    pendingSubmissionIssue: AgentPendingSubmissionIssue | null;
    running: boolean;
    availability: AgentComposerAvailability;
    canRegisterAttachments: boolean;
    canInsertAttachments: boolean;
    loadingSession: boolean;
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: EnabledModelOptionDto[];
    agentMode: AgentMode;
    canContinueWithoutInput: boolean;
    contextUsageExactLabel: string;
    contextUsageCompactLabel: string;
    contextPercentCompactLabel: string;
    cumulativeUsageExactLabel: string;
    cumulativeInputCompactLabel: string;
    cumulativeOutputCompactLabel: string;
    cumulativeCacheCompactLabel: string;
    cumulativeCacheWriteCompactLabel: string;
    cumulativeCacheHitRateLabel: string;
    cumulativeCostCompactLabel: string;
    connectionStatusLabel: string;
    runPhaseLabel: string;
    connectionNeedsAction: boolean;
    queuedMessages: AgentQueuedMessageDto[];
    menuRefreshKey: string | number;
    projectRoot: string | null;
    historyInboxRefreshKey: string | number;
    historyInboxActive: boolean;
    sessionId: number | null;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    modelSupportsImages: boolean;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "update:inputText", value: string): void;
    (e: "update:pendingResolutionDraft", value: AgentPendingResolutionDraft): void;
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "submit-user-input"): void;
    (e: "cancel-user-input"): void;
    (e: "resync-user-input"): void;
    /** 打开上下文检查面板（Task 126）；宿主持有开关状态。 */
    (e: "open-context-inspector"): void;
    (e: "send"): void;
    (e: "steer"): void;
    (e: "followup"): void;
    (e: "stop"): void;
    (e: "cycle-mode"): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
    (e: "reconnect-events"): void;
    (e: "refresh-history"): void;
    (e: "open-history-inbox"): void;
    (e: "open-workspace-file", path: string): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
    (e: "availability-action", action: AgentComposerAvailabilityAction): void;
}>();

const inputRef = ref<InstanceType<typeof AgentComposerInput> | null>(null);
const {t} = useI18n();
const imageFileInputRef = ref<HTMLInputElement | null>(null);
const composerExpanded = ref(false);
const composerReadonly = computed(() => props.availability.readonly);
const hasPendingUserInput = computed(() => props.pendingSessions.length > 0);

type ComposerAvailabilityView = {
    icon: string;
    message: string;
    tone: "info" | "warning" | "danger";
    action: AgentComposerAvailabilityAction | null;
    actionIcon: string;
    actionLabel: string;
};

/** 将 availability 映射成持续可见的状态说明与唯一可用操作。 */
const availabilityView = computed<ComposerAvailabilityView | null>(() => {
    switch (props.availability.status) {
        case "ready":
            return null;
        case "restoring":
            return {
                icon: "i-lucide-loader-circle animate-spin",
                message: t("agent.composer.restoring"),
                tone: "info",
                action: null,
                actionIcon: "",
                actionLabel: "",
            };
        case "unselected":
            return {
                icon: "i-lucide-messages-square",
                message: "请选择一个对话后继续。",
                tone: "warning",
                action: "choose-session",
                actionIcon: "i-lucide-list",
                actionLabel: "选择对话",
            };
        case "empty":
            return {
                icon: "i-lucide-message-square-plus",
                message: t("agent.composer.empty"),
                tone: "warning",
                action: "create-session",
                actionIcon: "i-lucide-plus",
                actionLabel: t("agent.composer.createSession"),
            };
        case "archived":
            return {
                icon: "i-lucide-archive",
                message: t("agent.composer.archived"),
                tone: "warning",
                action: props.availability.canRestore ? "restore-session" : null,
                actionIcon: "i-lucide-archive-restore",
                actionLabel: t("agent.composer.restore"),
            };
        case "profile-unavailable":
            return {
                icon: "i-lucide-circle-alert",
                message: props.availability.message || t("agent.composer.profileUnavailable"),
                tone: "danger",
                action: null,
                actionIcon: "",
                actionLabel: "",
            };
        case "waiting-blocked":
            return {
                icon: "i-lucide-octagon-alert",
                message: t("agent.composer.waitingBlocked"),
                tone: "danger",
                action: null,
                actionIcon: "",
                actionLabel: "",
            };
        case "load-error":
            return {
                icon: "i-lucide-cloud-alert",
                message: props.availability.message || t("agent.composer.loadError"),
                tone: "danger",
                action: "retry-session",
                actionIcon: "i-lucide-refresh-cw",
                actionLabel: t("agent.composer.retry"),
            };
        case "blocked":
            return {
                icon: "i-lucide-lock-keyhole",
                message: t("agent.composer.blocked"),
                tone: "warning",
                action: null,
                actionIcon: "",
                actionLabel: "",
            };
    }
});

/** restoring 在输入区原位呈现，其他不可用状态继续使用带操作的状态栏。 */
const availabilityBannerView = computed(() => props.availability.status === "restoring"
    ? null
    : availabilityView.value);
const composerRestoring = computed(() => props.availability.status === "restoring");

const composerShellStyle = computed(() => {
    switch (availabilityBannerView.value?.tone) {
        case "info":
            return {borderColor: "var(--status-info-border)", backgroundColor: "var(--status-info-bg)"};
        case "warning":
            return {borderColor: "var(--status-warning-border)", backgroundColor: "var(--status-warning-bg)"};
        case "danger":
            return {borderColor: "var(--status-danger-border)", backgroundColor: "var(--status-danger-bg)"};
        default:
            return {borderColor: "var(--border-color)", backgroundColor: "var(--bg-input)"};
    }
});

const availabilityTextColor = computed(() => {
    switch (availabilityBannerView.value?.tone) {
        case "info": return "var(--status-info)";
        case "warning": return "var(--status-warning)";
        case "danger": return "var(--status-danger)";
        default: return "var(--text-secondary)";
    }
});
const pendingBlockedMessage = computed(() => props.canResolveUserInput
    ? ""
    : availabilityView.value?.message || t("agent.composer.waitingBlocked"));

const images = useComposerImageTransaction({
    editor: () => inputRef.value,
    sessionId: () => props.sessionId,
    value: () => props.inputText,
    sessionAttachments: () => props.sessionAttachments,
    canRegister: () => props.canRegisterAttachments && !composerReadonly.value && !hasPendingUserInput.value,
    canInsert: () => props.canInsertAttachments && !composerReadonly.value && !hasPendingUserInput.value,
    blockedReason: () => hasPendingUserInput.value
        ? "等待用户回答期间不能上传或插入图片。"
        : availabilityView.value?.message || t("agent.composer.readonly"),
    unsupportedAttachmentMessage: () => t("agent.attachments.imageInsertUnsupported"),
    projectRoot: () => props.projectRoot,
    onAttachmentRegistered: (item) => emit("attachment-registered", item),
});
const composerGeneration = images.generation;
const resolvedImageItems = images.resolvedItems;

/** 各模式在 Composer 上的图标、样式与文案配置。 */
const AGENT_MODE_META: Record<AgentMode, {icon: string; buttonClass: string; badgeVisible: boolean}> = {
    normal: {icon: "i-lucide-pencil-line", buttonClass: "text-[var(--text-muted)] hover:text-[var(--text-main)]", badgeVisible: false},
    discuss: {icon: "i-lucide-messages-square", buttonClass: "text-[var(--status-info,var(--accent-text))] bg-[var(--accent-bg)]", badgeVisible: true},
    plan: {icon: "i-lucide-clipboard-list", buttonClass: "text-[var(--accent-text)] bg-[var(--accent-bg)]", badgeVisible: true},
};

const agentModeMeta = computed(() => AGENT_MODE_META[props.agentMode]);
const agentModeLabel = computed(() => t(`agent.mode.${props.agentMode}`));
const modeButtonTitle = computed(() => t("agent.composer.cycleModeTitle", {mode: agentModeLabel.value}));

const composerPlaceholder = computed(() => {
    if (composerReadonly.value) {
        return props.availability.status === "empty"
            ? t("agent.composer.emptyPlaceholder")
            : availabilityView.value?.message || t("agent.composer.readonly");
    }
    if (props.agentMode === "discuss") {
        return t("agent.composer.discussPlaceholder");
    }
    if (props.agentMode === "plan") {
        return t("agent.composer.planPlaceholder");
    }
    return t("agent.composer.messagePlaceholder");
});

const runInputText = computed(() => props.inputText);
const canStopReadonlyRun = computed(() => composerReadonly.value && props.availability.canStop);
const composerImages = computed(() => images.stableImages.value);
const sessionAttachmentByTarget = computed(() => new Map(
    [...resolvedImageItems.value, ...props.sessionAttachments].map((item) => [item.target, item]),
));
const documentPendingImages = computed(() => images.pendingImages.value);
const pendingImageCount = computed(() => documentPendingImages.value.length);
const imageUsage = images.usage;
const failedPendingImage = images.failed;
const canRegisterImages = images.canRegister;
const composerMenuRefreshKey = computed(() => [
    props.menuRefreshKey,
    images.menuRefreshKey.value,
].join(":"));
const imageCapabilityWarning = computed(() => composerImages.value.length > 0 && !props.modelSupportsImages);

/** 键盘提交和发送按钮必须共享同一份消息提交门禁。 */
const messageSubmitBlocked = computed(() => (
    composerReadonly.value
    || pendingImageCount.value > 0
    || imageUsage.value.unresolvedStable > 0
    || Boolean(images.metadataError.value)
    || Boolean(images.budgetError.value)
));

const sendDisabled = computed(() => {
    if (canStopReadonlyRun.value) {
        return false;
    }
    if (messageSubmitBlocked.value) {
        return true;
    }
    if (props.running) {
        return false;
    }
    return !props.inputText.trim() && !props.canContinueWithoutInput;
});

const sendIconClass = computed(() => {
    if (canStopReadonlyRun.value) {
        return "i-lucide-square";
    }
    if (pendingImageCount.value > 0) {
        return failedPendingImage.value
            ? "i-lucide-image-off"
            : "i-lucide-loader-2 animate-spin";
    }
    if (props.running && !runInputText.value.trim()) {
        return "i-lucide-square";
    }
    if (props.running) {
        return "i-lucide-corner-down-left";
    }
    if (props.canContinueWithoutInput) {
        return "i-lucide-chevrons-right";
    }
    return "i-lucide-send";
});

const sendButtonTitle = computed(() => {
    if (canStopReadonlyRun.value) {
        return t("agent.composer.stop");
    }
    if (pendingImageCount.value > 0) {
        return failedPendingImage.value
            ? "请重试或移除上传失败的图片"
            : "图片上传完成后才能发送";
    }
    if (imageUsage.value.unresolvedStable > 0) {
        return "正在校验 Session 图片附件";
    }
    if (images.metadataError.value) {
        return images.metadataError.value;
    }
    if (images.budgetError.value) {
        return images.budgetError.value;
    }
    if (composerReadonly.value) {
        return availabilityView.value?.message || t("agent.composer.readonly");
    }
    if (props.running && runInputText.value.trim()) {
        return composerExpanded.value ? t("agent.composer.steerQueueExpanded") : t("agent.composer.steerQueue");
    }
    if (props.running) {
        return t("agent.composer.stop");
    }
    if (props.canContinueWithoutInput) {
        return t("agent.composer.continue");
    }
    return t("agent.composer.send");
});

const expandButtonTitle = computed(() => composerExpanded.value ? t("agent.composer.collapseEditor") : t("agent.composer.expandEditor"));
const expandButtonIcon = computed(() => composerExpanded.value ? "i-lucide-minimize-2" : "i-lucide-maximize-2");

const queuedMessageText = (item: AgentQueuedMessageDto): string => {
    const text = item.text?.preview.trim();
    if (text) {
        return text;
    }
    if (item.images.length > 0) {
        return `包含 ${String(item.images.length + item.omittedImages)} 张图片`;
    }
    return item.input === undefined ? "" : JSON.stringify(publicValuePreviewJsonValue(item.input));
};

const queuedMessageIcon = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? "i-lucide-corner-down-left" : "i-lucide-list-plus";

const queuedMessageLabel = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? t("agent.composer.steer") : t("agent.composer.queue");

const resolveComposerMenu = (context: AgentTriggerMenuContext): AgentTriggerMenuState => {
    const state = props.resolveMenu(context);
    if (context.kind === "command") {
        if (!context.hasPlainTextBeforeTrigger) {
            return state;
        }
        const blockedIds = new Set(["command:compact", "command:clear", "command:new"]);
        return {
            ...state,
            sections: state.sections
                .map((section) => ({
                    ...section,
                    items: section.items.filter((item) => !blockedIds.has(item.id)),
                }))
                .filter((section) => section.items.length > 0),
        };
    }
    return images.decorateMenu(context, state);
};

/**
 * 聚焦底部输入框。
 */
const focus = (): void => {
    inputRef.value?.focus();
};

/** 文件选择、粘贴和拖拽统一进入有序 pending 节点队列。 */
function queueImageFiles(payload: {files: File[]; position?: number}): void {
    images.queueFiles(payload);
}

/** 重试失败图片。 */
function retryPendingImage(uploadId: string): void {
    images.retry(uploadId);
}

/** 移除 pending 图片并中止请求。 */
function removePendingImage(uploadId: string): void {
    images.remove(uploadId);
}

function selectImageFiles(): void {
    if (canRegisterImages.value) {
        imageFileInputRef.value?.click();
    }
}

function handleImageFileSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    queueImageFiles({files: Array.from(input.files ?? [])});
    input.value = "";
}

function notifyImageFilesBlocked(): void {
    images.notifyBlocked();
}

/** 附件面板重新插入时只改正文，不创建新的 Session 登记。 */
function insertAttachment(item: AgentSessionAttachmentItemDto): void {
    images.insertAttachment(item);
}

function composerImageUrl(target: string): string | null {
    const item = sessionAttachmentByTarget.value.get(target);
    return item ? agentAttachmentUrl(props.sessionId, item.locator.entryId, item.locator.contentIndex) : null;
}

function removeComposerImage(index: number): void {
    inputRef.value?.removeImageAt(index);
}

/** TipTap 文档变化是 pending 存在性、顺序和发送门禁的唯一输入。 */
function handleImageDocument(nodes: ComposerImageNode[]): void {
    images.applyDocument(nodes);
}

/**
 * 同步输入框内容。
 */
function updateComposerValue(value: string): void {
    emit("update:inputText", value);
}

/**
 * 处理回答备注输入提交。
 */
function submitComposer(payload?: {ctrlKey?: boolean; metaKey?: boolean}): void {
    if (messageSubmitBlocked.value) {
        return;
    }
    if (props.running && runInputText.value.trim()) {
        if (payload?.ctrlKey || payload?.metaKey) {
            emit("followup");
        } else {
            emit("steer");
        }
        return;
    }
    emit("send");
}

/**
 * 处理右下角按钮点击。
 */
function submitButton(event: MouseEvent): void {
    if (canStopReadonlyRun.value) {
        emit("stop");
        return;
    }
    if (messageSubmitBlocked.value) {
        return;
    }
    if (props.running && !runInputText.value.trim()) {
        emit("stop");
        return;
    }
    if (props.running) {
        if (event.ctrlKey || event.metaKey) {
            emit("followup");
        } else {
            emit("steer");
        }
        return;
    }
    emit("send");
}

defineExpose({focus, insertAttachment});
</script>

<template>
    <!-- Agent 底部输入容器 -->
    <div class="relative shrink-0 bg-[var(--bg-panel)] px-2 pb-1">
        <!-- pending 引导/队列 -->
        <div v-if="!hasPendingUserInput && props.queuedMessages.length > 0" class="flex min-w-0 flex-wrap gap-1 px-1 pb-1.5">
            <div
                v-for="item in props.queuedMessages"
                :key="item.id"
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                :title="`${queuedMessageLabel(item)}：${queuedMessageText(item)}`"
            >
                <span :class="queuedMessageIcon(item)" class="h-3 w-3 shrink-0 text-[var(--accent-text)]"></span>
                <span class="shrink-0 font-medium">{{ queuedMessageLabel(item) }}</span>
                <span class="max-w-[18rem] truncate text-[var(--text-muted)]">{{ queuedMessageText(item) }}</span>
            </div>
        </div>

        <AgentWorkspaceChanges :project-root="props.projectRoot" :refresh-key="props.historyInboxRefreshKey" :active="props.historyInboxActive" @open-full="emit('open-history-inbox')" @open-file="emit('open-workspace-file', $event)" />

        <!-- 等待用户输入时由唯一的待处理面板替换普通 Composer。 -->
        <AgentUserInputPrompt
            v-if="hasPendingUserInput"
            :sessions="props.pendingSessions"
            :draft="props.pendingResolutionDraft"
            :submitting="props.submittingUserInput"
            :can-resolve="props.canResolveUserInput"
            :can-abort="props.canAbort"
            :blocked-message="pendingBlockedMessage"
            :submission-issue="props.pendingSubmissionIssue"
            :menu-refresh-key="props.menuRefreshKey"
            :resolve-menu="props.resolveMenu"
            :on-skill-trigger-start="props.onSkillTriggerStart"
            @update:draft="emit('update:pendingResolutionDraft', $event)"
            @submit="emit('submit-user-input')"
            @cancel="emit('cancel-user-input')"
            @resync="emit('resync-user-input')"
        />

        <!-- 消息输入栏 -->
        <div
            v-show="!hasPendingUserInput"
            class="flex flex-col rounded-xl border shadow-sm transition-all"
            :class="composerReadonly ? '' : 'focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]'"
            :style="{...composerShellStyle, '--composer-radius': '0.75rem'}"
        >
            <!-- Composer 可用性：原因与恢复动作必须持续可见，不能只藏在发送按钮 tooltip。 -->
            <div
                v-if="availabilityBannerView"
                class="flex min-w-0 items-center gap-2 border-b px-2.5 py-2 text-[11px]"
                :style="{borderColor: composerShellStyle.borderColor, color: availabilityTextColor}"
                role="status"
                aria-live="polite"
            >
                <span :class="availabilityBannerView.icon" class="h-3.5 w-3.5 shrink-0"></span>
                <span class="min-w-0 flex-1 break-words leading-4">{{ availabilityBannerView.message }}</span>
                <button
                    v-if="availabilityBannerView.action"
                    type="button"
                    class="inline-flex shrink-0 items-center gap-1 rounded border border-current px-2 py-1 font-medium transition-colors hover:bg-[var(--bg-hover)]"
                    @click="emit('availability-action', availabilityBannerView.action)"
                >
                    <span :class="availabilityBannerView.actionIcon" class="h-3 w-3"></span>
                    <span>{{ availabilityBannerView.actionLabel }}</span>
                </button>
            </div>

            <!-- 正文图片派生缩略图：删除只移除对应 Markdown 标记。 -->
            <div v-if="composerImages.length > 0" class="flex min-w-0 gap-1.5 overflow-x-auto border-b border-[var(--border-color)]/50 px-2 py-1.5">
                <div v-for="(image, index) in composerImages" :key="`${image.target}:${String(index)}`" class="group relative h-12 w-16 shrink-0 overflow-hidden rounded border border-[var(--border-color)] bg-[var(--bg-panel)]">
                    <img v-if="composerImageUrl(image.target)" :src="composerImageUrl(image.target) || undefined" :alt="image.label" class="h-full w-full object-cover" />
                    <div v-else class="flex h-full w-full items-center justify-center text-[var(--text-muted)]"><span class="i-lucide-image h-4 w-4"></span></div>
                    <button type="button" class="absolute right-0.5 top-0.5 rounded bg-[var(--bg-panel)]/90 p-0.5 text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--status-danger)] group-hover:opacity-100 disabled:hidden" :disabled="composerReadonly" title="从正文移除图片" @click="removeComposerImage(index)">
                        <span class="i-lucide-x h-3 w-3"></span>
                    </button>
                    <div class="absolute inset-x-0 bottom-0 truncate bg-[var(--bg-panel)]/85 px-1 text-[8px] text-[var(--text-secondary)]" :title="image.label">{{ image.label }}</div>
                </div>
            </div>

            <div v-if="imageCapabilityWarning" class="flex items-center gap-1.5 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[10px] text-[var(--status-warning)]">
                <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0"></span>
                <span>当前模型未声明图片输入能力；仍可发送，后端会使用文本占位。</span>
            </div>

            <div v-if="images.metadataError.value" class="flex items-center gap-1.5 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1 text-[10px] text-[var(--status-danger)]">
                <span class="i-lucide-image-off h-3.5 w-3.5 shrink-0"></span>
                <span class="min-w-0 flex-1 truncate" :title="images.metadataError.value">{{ images.metadataError.value }}</span>
                <button type="button" class="rounded p-1 hover:bg-[var(--bg-hover)]" title="重新校验图片附件" @click="images.retryMetadata">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                </button>
            </div>

            <!-- 恢复提示复用真实输入区的布局高度，避免 ready/restoring 切换时壳体跳动。 -->
            <div class="relative">
                <AgentComposerInput
                    ref="inputRef"
                    borderless
                    :class="composerRestoring ? 'invisible pointer-events-none select-none' : ''"
                    :aria-hidden="composerRestoring ? 'true' : undefined"
                    :generation="composerGeneration"
                    :model-value="props.inputText"
                    :placeholder="composerPlaceholder"
                    :expanded="composerExpanded"
                    :readonly="composerReadonly"
                    :submit-on-modifier-enter="props.running && Boolean(runInputText.trim())"
                    :enable-image-files="canRegisterImages"
                    :menu-refresh-key="composerMenuRefreshKey"
                    :resolve-menu="resolveComposerMenu"
                    :on-skill-trigger-start="props.onSkillTriggerStart"
                    @update:model-value="updateComposerValue"
                    @submit="submitComposer"
                    @cycle-mode="emit('cycle-mode')"
                    @image-files="queueImageFiles"
                    @image-files-blocked="notifyImageFilesBlocked"
                    @image-document="handleImageDocument"
                    @pending-image-retry="retryPendingImage"
                    @pending-image-remove="removePendingImage"
                />
                <div
                    v-if="composerRestoring && availabilityView"
                    class="absolute inset-0 flex items-center gap-2 px-3 text-[13px] text-[var(--text-muted)]"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    <span :class="availabilityView.icon" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                    <span>{{ availabilityView.message }}</span>
                </div>
            </div>

            <div class="flex min-w-0 items-center gap-2 border-t border-[var(--border-color)]/50 px-2 py-2">
                <div class="flex min-w-0 flex-1 items-center gap-2">
                    <AgentSessionModelControls
                        :session-model-selection-value="props.sessionModelSelectionValue"
                        :session-thinking-resolved-label="props.sessionThinkingResolvedLabel"
                        :session-model-draft="props.sessionModelDraft"
                        :selectable-models="props.selectableModels"
                        :session-model-saving="props.sessionModelSaving"
                        :session-model-popover-open="props.sessionModelPopoverOpen"
                        :readonly="composerReadonly"
                        :running="props.running"
                        :loading-session="props.loadingSession"
                        dropdown-direction="up"
                        root-class="min-w-0 max-w-[320px] flex-1"
                        popover-class="w-[360px]"
                        @update:session-model-popover-open="emit('update:sessionModelPopoverOpen', $event)"
                        @update:session-model-draft="emit('update:sessionModelDraft', $event)"
                        @update-session-model-selection="emit('update-session-model-selection', $event)"
                        @toggle-session-model-popover="emit('toggle-session-model-popover')"
                        @apply-session-model-settings="emit('apply-session-model-settings')"
                        @reset-session-model-settings="emit('reset-session-model-settings')"
                    />

                    <input ref="imageFileInputRef" class="hidden" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" @change="handleImageFileSelection" />
                    <button
                        type="button"
                        class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="!canRegisterImages"
                        title="选择图片（可多选，也可拖拽或粘贴）"
                        @click="selectImageFiles"
                    >
                        <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
                    </button>

                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                        :class="composerExpanded ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        :title="expandButtonTitle"
                        @click="composerExpanded = !composerExpanded"
                    >
                        <span :class="expandButtonIcon" class="h-3.5 w-3.5"></span>
                    </button>

                    <!-- 三态模式切换按钮：normal → discuss → plan 循环 -->
                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        :class="agentModeMeta.buttonClass"
                        :disabled="composerReadonly || props.running"
                        :title="modeButtonTitle"
                        @click="emit('cycle-mode')"
                    >
                        <span :class="agentModeMeta.icon" class="h-3.5 w-3.5"></span>
                    </button>
                </div>
                <button
                    class="flex shrink-0 items-center justify-center rounded bg-[var(--accent-bg)] p-1.5 text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="sendDisabled"
                    :title="sendButtonTitle"
                    @click.prevent="submitButton"
                >
                    <span :class="sendIconClass" class="h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <!-- token 与运行状态 -->
        <div class="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[9px] text-[var(--text-muted)]">
            <!-- gauge 芯片：点击打开上下文检查面板（Task 126） -->
            <button :title="props.contextUsageExactLabel" class="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-hover)]" @click="emit('open-context-inspector')">
                <span class="i-lucide-gauge h-3 w-3 shrink-0"></span>
                <span class="truncate font-medium text-[var(--text-secondary)]">{{ props.contextUsageCompactLabel }}</span>
                <span v-if="props.contextPercentCompactLabel" class="rounded-full bg-[var(--accent-bg)] px-1 py-[1px] text-[8px] font-semibold text-[var(--accent-text)]">{{ props.contextPercentCompactLabel }}</span>
            </button>
            <div :title="props.cumulativeUsageExactLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-arrow-down h-3 w-3"></span>
                <span>{{ props.cumulativeInputCompactLabel }}</span>
                <span class="i-lucide-arrow-up h-3 w-3"></span>
                <span>{{ props.cumulativeOutputCompactLabel }}</span>
                <span class="i-lucide-database-zap h-3 w-3"></span>
                <span>{{ props.cumulativeCacheCompactLabel }}</span>
                <template v-if="props.cumulativeCacheHitRateLabel">
                    <span class="i-lucide-percent h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheHitRateLabel }}</span>
                </template>
                <template v-if="props.cumulativeCacheWriteCompactLabel !== '-' && props.cumulativeCacheWriteCompactLabel !== '0'">
                    <span class="i-lucide-hard-drive-upload h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheWriteCompactLabel }}</span>
                </template>
                <template v-if="props.cumulativeCostCompactLabel">
                    <span class="i-lucide-circle-dollar-sign h-3 w-3"></span>
                    <span>{{ props.cumulativeCostCompactLabel }}</span>
                </template>
            </div>
            <div v-if="props.connectionStatusLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-wifi h-3 w-3"></span>
                <span>{{ props.connectionStatusLabel }}</span>
            </div>
            <template v-if="props.connectionNeedsAction">
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.composer.reconnectTitle')" @click="emit('reconnect-events')">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                    <span>{{ t("agent.composer.reconnect") }}</span>
                </button>
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.composer.refreshHistoryTitle')" @click="emit('refresh-history')">
                    <span class="i-lucide-history h-3 w-3"></span>
                    <span>{{ t("agent.composer.refreshHistory") }}</span>
                </button>
            </template>
            <div v-if="props.running" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                <span>{{ props.runPhaseLabel || t("agent.composer.running") }}</span>
            </div>
            <!-- 当前模式徽标：非 normal 模式时展示 -->
            <div v-if="agentModeMeta.badgeVisible" class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] px-1.5 py-0.5 text-[var(--accent-text)]" :title="modeButtonTitle">
                <span :class="agentModeMeta.icon" class="h-3 w-3"></span>
                <span>{{ agentModeLabel }}</span>
            </div>
        </div>
    </div>
</template>
