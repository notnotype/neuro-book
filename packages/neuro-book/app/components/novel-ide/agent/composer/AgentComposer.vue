<script setup lang="ts">
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentPendingResolutionDraft, AgentPendingSubmissionIssue} from "nbook/app/components/novel-ide/agent/agent-pending-resolution";
import AgentComposerInput from "./AgentComposerInput.vue";
import AgentSessionModelControls from "../panels/header/AgentSessionModelControls.vue";
import AgentUserInputPrompt from "../bubbles/interactive/AgentUserInputPrompt.vue";
import AgentQueuedMessageList from "./AgentQueuedMessageList.vue";
import AgentComposerAvailabilityBanner from "./AgentComposerAvailabilityBanner.vue";
import AgentComposerImageBar from "./AgentComposerImageBar.vue";
import AgentComposerToolbar from "./AgentComposerToolbar.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentQueuedMessageDto, AgentMode, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";
import type {ComposerImageNode} from "./composer-image-transaction";
import {
    useComposerImageTransaction,
    type ComposerImageTransactionApi,
    type ComposerImageTransactionNotification,
} from "../composables/useComposerImageTransaction";
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
    queuedMessages: AgentQueuedMessageDto[];
    menuRefreshKey: string | number;
    projectRoot: string | null;
    sessionId: number | null;
    sessionAttachments: AgentSessionAttachmentItemDto[];
    modelSupportsImages: boolean;
    imageApi?: ComposerImageTransactionApi;
    imageNotification?: ComposerImageTransactionNotification;
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
    (e: "send"): void;
    (e: "steer"): void;
    (e: "followup"): void;
    (e: "stop"): void;
    (e: "cycle-mode"): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
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
                message: t("agent.composer.unselected"),
                tone: "warning",
                action: "choose-session",
                actionIcon: "i-lucide-list",
                actionLabel: t("agent.composer.chooseSession"),
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

const pendingBlockedMessage = computed(() => props.canResolveUserInput
    ? ""
    : availabilityView.value?.message || t("agent.composer.waitingBlocked"));

const images = useComposerImageTransaction({
    api: props.imageApi,
    notification: props.imageNotification,
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
        <AgentQueuedMessageList
            v-if="!hasPendingUserInput"
            :queued-messages="props.queuedMessages"
        />

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
            <AgentComposerAvailabilityBanner
                :availability="props.availability"
                @action="emit('availability-action', $event)"
            />

            <!-- 正文图片派生缩略图与校验状态 -->
            <AgentComposerImageBar
                :images="composerImages"
                :model-supports-images="props.modelSupportsImages"
                :metadata-error="images.metadataError.value"
                :readonly="composerReadonly"
                :get-image-url="composerImageUrl"
                @remove-image="removeComposerImage"
                @retry-metadata="images.retryMetadata"
            />

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

            <!-- 底部工具条 -->
            <input ref="imageFileInputRef" class="hidden" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" @change="handleImageFileSelection" />
            <AgentComposerToolbar
                :composer-expanded="composerExpanded"
                :composer-readonly="composerReadonly"
                :running="props.running"
                :can-register-images="canRegisterImages"
                :agent-mode="props.agentMode"
                :send-disabled="sendDisabled"
                :send-button-title="sendButtonTitle"
                :send-icon-class="sendIconClass"
                @toggle-expand="composerExpanded = !composerExpanded"
                @cycle-mode="emit('cycle-mode')"
                @select-images="selectImageFiles"
                @submit="submitButton"
            >
                <template #model-controls>
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
                </template>
            </AgentComposerToolbar>
        </div>
    </div>
</template>
