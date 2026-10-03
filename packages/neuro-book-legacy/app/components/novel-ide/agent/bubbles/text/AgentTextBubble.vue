<script setup lang="ts">
import type {ChatNode, AgentMessage, AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentSystemBubble from "./AgentSystemBubble.vue";
import AgentUserBubble from "./AgentUserBubble.vue";
import AgentAssistantBubble from "./AgentAssistantBubble.vue";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {CostDisplayOptions} from "nbook/app/utils/cost-format";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";

const props = withDefaults(defineProps<{
    node: Extract<ChatNode, { kind: "text" }>;
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
    costDisplayOptions?: CostDisplayOptions;
    costExchangeRateSuffix?: string;
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
    costDisplayOptions: () => ({ currency: "USD", exchangeRate: 1 }),
    costExchangeRateSuffix: "",
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
</script>

<template>
    <div class="agent-text-bubble-dispatcher min-w-0 w-full">
        <!-- 1. 系统消息 -->
        <AgentSystemBubble
            v-if="props.node.message.type === 'system'"
            :message="props.node.message"
            :action-disabled="props.actionDisabled"
            :run-action-disabled="props.runActionDisabled"
            :branch-switcher="props.branchSwitcher"
            :open-reference="props.openReference"
            @cycle-branch="emit('cycle-branch', $event)"
        />

        <!-- 2. 用户消息 -->
        <AgentUserBubble
            v-else-if="props.node.message.type === 'user'"
            :message="props.node.message"
            :session-id="props.sessionId"
            :editing-message-id="props.editingMessageId"
            :editing-content="props.editingContent"
            :action-disabled="props.actionDisabled"
            :run-action-disabled="props.runActionDisabled"
            :saving-edit="props.savingEdit"
            :session-attachments="props.sessionAttachments"
            :can-register-attachments="props.canRegisterAttachments"
            :can-insert-attachments="props.canInsertAttachments"
            :project-root="props.projectRoot"
            :model-supports-images="props.modelSupportsImages"
            :attachment-insert-request="props.attachmentInsertRequest"
            :branch-switcher="props.branchSwitcher"
            :menu-refresh-key="props.menuRefreshKey"
            :resolve-menu="props.resolveMenu"
            :on-skill-trigger-start="props.onSkillTriggerStart"
            :open-reference="props.openReference"
            @copy="emit('copy', $event)"
            @start-edit="emit('start-edit', $event)"
            @cancel-edit="emit('cancel-edit', $event)"
            @save-edit="emit('save-edit', $event)"
            @retry="emit('retry', $event)"
            @branch-from-here="emit('branch-from-here', $event)"
            @cycle-branch="emit('cycle-branch', $event)"
            @attachment-registered="emit('attachment-registered', $event)"
            @resend-unknown="emit('resend-unknown', $event)"
            @dismiss-unknown="emit('dismiss-unknown', $event)"
        />

        <!-- 3. AI 助手回复消息 -->
        <AgentAssistantBubble
            v-else-if="props.node.message.type === 'ai'"
            :message="props.node.message"
            :session-id="props.sessionId"
            :action-disabled="props.actionDisabled"
            :run-action-disabled="props.runActionDisabled"
            :branch-switcher="props.branchSwitcher"
            :open-reference="props.openReference"
            :cost-display-options="props.costDisplayOptions"
            :cost-exchange-rate-suffix="props.costExchangeRateSuffix"
            @copy="emit('copy', $event)"
            @retry="emit('retry', $event)"
            @branch-from-here="emit('branch-from-here', $event)"
            @cycle-branch="emit('cycle-branch', $event)"
        />
    </div>
</template>
