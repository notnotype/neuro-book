<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {AgentMessage, AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMessageActionBar from "../base/AgentMessageActionBar.vue";
import AgentMarkdownContent from "../base/AgentMarkdownContent.vue";
import AgentAttachmentGallery from "../base/AgentAttachmentGallery.vue";
import AgentAttachmentCard from "../base/AgentAttachmentCard.vue";
import AgentHistoryMessageEditor from "./AgentHistoryMessageEditor.vue";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {canEditHistoryMessage} from "nbook/app/components/novel-ide/agent/flow/agent-chat-history-ui";

const SWIPE_MIN_DELTA_X = 48;
const SWIPE_MAX_DELTA_Y = 24;

const props = withDefaults(defineProps<{
    message: AgentMessage;
    sessionId?: number | null;
    editingMessageId?: string | null;
    editingContent?: string;
    actionDisabled?: boolean;
    runActionDisabled?: boolean;
    savingEdit?: boolean;
    sessionAttachments?: AgentSessionAttachmentItemDto[];
    canRegisterAttachments?: boolean;
    canInsertAttachments?: boolean;
    projectRoot?: string | null;
    modelSupportsImages?: boolean;
    attachmentInsertRequest?: {id: number; item: AgentSessionAttachmentItemDto} | null;
    branchSwitcher?: AgentMessageSwitcherState;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    openReference?: (target: string) => void;
}>(), {
    sessionId: null,
    editingMessageId: null,
    editingContent: "",
    actionDisabled: false,
    runActionDisabled: false,
    savingEdit: false,
    sessionAttachments: () => [],
    canRegisterAttachments: false,
    canInsertAttachments: false,
    projectRoot: null,
    modelSupportsImages: false,
    attachmentInsertRequest: null,
});

const emit = defineEmits<{
    (e: "copy", message: AgentMessage): void;
    (e: "start-edit", message: AgentMessage): void;
    (e: "cancel-edit", message: AgentMessage): void;
    (e: "save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "retry", message: AgentMessage): void;
    (e: "branch-from-here", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
    (e: "resend-unknown", message: AgentMessage): void;
    (e: "dismiss-unknown", message: AgentMessage): void;
}>();

const {t} = useI18n();
const editingDraft = ref("");
const swipeStart = ref<{x: number; y: number} | null>(null);

const isSteerMessage = computed(() => props.message.intent === "steer");
const isUnknownDelivery = computed(() => props.message.deliveryState === "unknown");
const canEdit = computed(() => canEditHistoryMessage(props.message));
const isEditing = computed(() => canEdit.value && props.editingMessageId === props.message.id);
const isContentOmitted = computed(() => props.message.contentOmitted === true);

const decodeEditableContent = (content: string): string => {
    let current = content;
    for (let index = 0; index < 3; index += 1) {
        let decoded = current;
        if (import.meta.client) {
            const textarea = document.createElement("textarea");
            textarea.innerHTML = current;
            decoded = textarea.value;
        } else {
            decoded = current
                .replace(/&amp;/g, "&")
                .replace(/&gt;/g, ">")
                .replace(/&lt;/g, "<")
                .replace(/&quot;/g, "\"")
                .replace(/&#039;|&#39;/g, "'");
        }
        if (decoded === current) return decoded;
        current = decoded;
    }
    return current;
};

const syncEditingDraft = (): void => {
    editingDraft.value = decodeEditableContent(props.editingContent || props.message.content);
};

watch(isEditing, (nextValue) => {
    if (nextValue) syncEditingDraft();
}, {immediate: true});

watch(() => props.editingContent, () => {
    if (isEditing.value) syncEditingDraft();
});

const startEdit = (): void => {
    if (!canEdit.value || props.actionDisabled || props.runActionDisabled) return;
    syncEditingDraft();
    emit("start-edit", props.message);
};

const cancelEdit = (): void => {
    syncEditingDraft();
    emit("cancel-edit", props.message);
};

const saveEdit = (): void => {
    const content = decodeEditableContent(editingDraft.value);
    if (!canEdit.value || !content.trim() || props.savingEdit || props.runActionDisabled) return;
    emit("save-edit", {message: props.message, content});
};

const cycleBranch = (direction: -1 | 1): void => {
    if (!props.branchSwitcher || props.actionDisabled) return;
    emit("cycle-branch", {messageId: props.message.id, direction});
};

const startSwipe = (event: PointerEvent): void => {
    if (!props.branchSwitcher || props.actionDisabled || isEditing.value) return;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
    swipeStart.value = {x: event.clientX, y: event.clientY};
};

const endSwipe = (event: PointerEvent): void => {
    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
    }
    if (!swipeStart.value || !props.branchSwitcher || props.actionDisabled || isEditing.value) {
        swipeStart.value = null;
        return;
    }
    const deltaX = event.clientX - swipeStart.value.x;
    const deltaY = event.clientY - swipeStart.value.y;
    swipeStart.value = null;
    if (Math.abs(deltaX) < SWIPE_MIN_DELTA_X || Math.abs(deltaY) > SWIPE_MAX_DELTA_Y) return;
    cycleBranch(deltaX < 0 ? 1 : -1);
};
</script>

<template>
    <div class="agent-user-bubble group flex min-w-0 w-full flex-col items-start select-none">
        <!-- 头部栏 -->
        <div class="mb-1.5 ml-1 flex w-full items-center gap-2">
            <div class="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)]">
                <span
                    :class="isSteerMessage ? 'i-lucide-corner-down-left text-[var(--accent-text)]' : 'i-lucide-user text-[var(--text-muted)]'"
                    class="h-2.5 w-2.5"
                />
            </div>
            <span class="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--text-main)]">
                {{ isSteerMessage ? (t("agent.textBubble.steer") || "Steer") : "You" }}
            </span>
            <span v-if="props.message.timestamp" class="text-[10px] text-[var(--text-muted)]">
                {{ props.message.timestamp }}
            </span>

            <div class="flex-1" />

            <!-- 操作条 -->
            <AgentMessageActionBar
                :can-edit="canEdit"
                :can-retry="!isUnknownDelivery"
                :is-unknown-delivery="isUnknownDelivery"
                :is-content-omitted="isContentOmitted"
                :action-disabled="props.actionDisabled"
                :run-action-disabled="props.runActionDisabled"
                :branch-switcher="props.branchSwitcher"
                @copy="emit('copy', props.message)"
                @start-edit="startEdit"
                @retry="emit('retry', props.message)"
                @branch-from-here="emit('branch-from-here', props.message)"
                @cycle-branch="cycleBranch"
                @resend-unknown="emit('resend-unknown', props.message)"
                @dismiss-unknown="emit('dismiss-unknown', props.message)"
            />
        </div>

        <!-- 正文主体与就地编辑 -->
        <div
            class="min-w-0 w-full touch-pan-y pl-6 select-text"
            @pointerdown="startSwipe"
            @pointerup="endSwipe"
            @pointercancel="swipeStart = null"
        >
            <div
                class="min-w-0 max-w-full rounded-2xl border border-[color-mix(in_srgb,var(--accent-main)_18%,var(--border-color))] bg-[color-mix(in_srgb,var(--accent-main)_5%,var(--bg-subtle))] px-4 py-3 shadow-sm"
                :class="props.message.error ? '!border-[var(--status-danger-border)] !bg-[var(--status-danger-bg)]' : ''"
            >
                <!-- 就地编辑态 -->
                <div v-if="isEditing" class="space-y-3">
                    <AgentHistoryMessageEditor
                        v-model="editingDraft"
                        :session-id="props.sessionId"
                        :session-attachments="props.sessionAttachments"
                        :can-register-attachments="props.canRegisterAttachments"
                        :can-insert-attachments="props.canInsertAttachments"
                        :readonly="Boolean(props.runActionDisabled)"
                        :saving="Boolean(props.savingEdit)"
                        :menu-refresh-key="props.menuRefreshKey"
                        :resolve-menu="props.resolveMenu"
                        :on-skill-trigger-start="props.onSkillTriggerStart"
                        :project-root="props.projectRoot"
                        :model-supports-images="props.modelSupportsImages"
                        :attachment-insert-request="props.attachmentInsertRequest"
                        @cancel="cancelEdit"
                        @save="saveEdit"
                        @attachment-registered="emit('attachment-registered', $event)"
                    />
                </div>

                <!-- 正常展示态 -->
                <div v-else class="min-w-0 text-sm leading-relaxed text-[var(--text-main)]">
                    <template v-if="props.message.contentBlocks?.length">
                        <div
                            v-for="(block, blockIndex) in props.message.contentBlocks"
                            :key="`${block.type}:${block.contentIndex}`"
                            :class="blockIndex > 0 ? 'mt-3' : ''"
                        >
                            <AgentMarkdownContent
                                v-if="block.type === 'text'"
                                :content="block.content.preview"
                                :open-reference="props.openReference"
                            />
                            <AgentAttachmentCard
                                v-else
                                :session-id="props.sessionId"
                                :entry-id="block.locator?.entryId ?? props.message.id"
                                :content-index="block.locator?.contentIndex ?? block.contentIndex"
                                :attachment="block.attachment"
                            />
                        </div>
                    </template>
                    <template v-else>
                        <AgentMarkdownContent
                            v-if="props.message.content"
                            :content="props.message.content"
                            :html="props.message.html"
                            :open-reference="props.openReference"
                        />
                        <AgentAttachmentGallery
                            v-if="props.message.attachments?.length"
                            :attachments="props.message.attachments"
                            :session-id="props.sessionId"
                            :entry-id="props.message.id"
                        />
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>
