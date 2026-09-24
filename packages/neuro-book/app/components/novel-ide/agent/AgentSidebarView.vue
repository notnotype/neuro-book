<script setup lang="ts">
import {ref} from "vue";
import AgentSessionHeader from "./panels/header/AgentSessionHeader.vue";
import AgentSessionAttachmentPanel from "./panels/attachments/AgentSessionAttachmentPanel.vue";
import AgentLinkedAgentPanel from "./panels/linked-agents/AgentLinkedAgentPanel.vue";
import AgentSystemPromptPanel from "./panels/system-prompt/AgentSystemPromptPanel.vue";
import AgentChatFlow from "./flow/AgentChatFlow.vue";
import AgentWorkflowPendingPanel from "./panels/workflow-pending/AgentWorkflowPendingPanel.vue";
import AgentWorkspaceChanges from "./panels/workspace-changes/AgentWorkspaceChanges.vue";
import AgentComposer from "./composer/AgentComposer.vue";
import AgentSessionStatusBar from "./panels/status/AgentSessionStatusBar.vue";
import AgentSessionDialog from "./dialogs/session-list/AgentSessionDialog.vue";
import AgentSessionTreeDialog from "./dialogs/session-tree/AgentSessionTreeDialog.vue";
import AgentContextInspectorDialog from "./context-inspector/AgentContextInspectorDialog.vue";
import type {AgentSidebarViewProps, AgentSidebarViewEmits} from "nbook/app/components/novel-ide/agent/AgentSidebarView.types";

import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";

const props = withDefaults(defineProps<AgentSidebarViewProps>(), {
    layout: "drawer",
    teleportTarget: ".novel-ide-theme",
    referenceTeleportTarget: null,
    composerContextGeneration: 0,
    workflowByToolKey: () => ({}),
    resolveAttachmentUrl: undefined,
});

const emit = defineEmits<AgentSidebarViewEmits>();

const flowRef = ref<InstanceType<typeof AgentChatFlow> | null>(null);
const composerRef = ref<InstanceType<typeof AgentComposer> | null>(null);

function focusComposer(): void {
    composerRef.value?.focus();
}

function scrollToBottom(): void {
    flowRef.value?.scrollToBottom();
}

function insertAttachment(item: AgentSessionAttachmentItemDto): void {
    composerRef.value?.insertAttachment(item);
}

function handleSelectStarter(prompt: string): void {
    emit("empty-select-starter", prompt);
    emit("composer-update-input-text", prompt);
    focusComposer();
}

defineExpose({
    focusComposer,
    scrollToBottom,
    insertAttachment,
});
</script>

<template>
    <section
        class="agent-sidebar-view relative flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-panel)]"
    >
        <!-- 1. Header 顶部导航 -->
        <AgentSessionHeader
            :drawer-icon-class="props.header.drawerIconClass"
            :active-session-title="props.header.activeSessionTitle"
            :active-drawer-title="props.header.activeDrawerTitle"
            :active-session-summary-text="props.header.activeSessionSummaryText"
            :summarizer-status="props.header.summarizerStatus"
            :can-choose-create-profile="props.header.canChooseCreateProfile"
            :create-profile-dropdown-items="props.header.createProfileDropdownItems"
            :loading-session="props.header.loadingSession"
            :active-session-id="props.header.activeSessionId"
            :attachment-panel-open="props.attachmentPanelOpen"
            :session-attachment-unique-total="props.header.sessionAttachmentUniqueTotal"
            :linked-agent-panel-open="props.linkedAgentPanelOpen"
            :linked-agent-count="props.header.linkedAgentCount"
            :can-mutate-history="props.header.canMutateHistory"
            :system-prompt-panel-open="props.systemPromptPanelOpen"
            @create-session="emit('header-create-session', $event)"
            @toggle-attachment-panel="emit('update:attachmentPanelOpen', !props.attachmentPanelOpen)"
            @toggle-linked-agent-panel="emit('update:linkedAgentPanelOpen', !props.linkedAgentPanelOpen)"
            @open-session-tree="emit('update:sessionTreeDialogOpen', true)"
            @toggle-system-prompt="emit('update:systemPromptPanelOpen', !props.systemPromptPanelOpen)"
            @open-session-dialog="emit('update:sessionDialogOpen', true)"
            @close="emit('close')"
        />

        <!-- 2. 下拉面板区（绝对定位或紧凑折叠） -->
        <AgentSessionAttachmentPanel
            v-if="props.attachmentPanelOpen && props.header.activeSessionId"
            :session-id="props.header.activeSessionId"
            :items="props.attachments.items"
            :total="props.attachments.total"
            :has-more="props.attachments.hasMore"
            :loading="props.attachments.loading"
            :search="props.attachments.search"
            :insert-disabled="props.attachments.insertDisabled"
            @update:search="emit('attachment-search', $event)"
            @load-more="emit('attachment-load-more')"
            @insert="emit('attachment-insert', $event)"
            @close="emit('update:attachmentPanelOpen', false)"
        />

        <AgentLinkedAgentPanel
            v-if="props.linkedAgentPanelOpen"
            :session-id="props.header.activeSessionId"
            :owned-agents="props.linkedAgents.ownedAgents"
            :linked-by-agents="props.linkedAgents.linkedByAgents"
            :loading="props.linkedAgents.loading"
            @select="emit('linked-agent-select', $event)"
            @refresh="emit('linked-agent-refresh')"
            @close="emit('update:linkedAgentPanelOpen', false)"
        />

        <AgentSystemPromptPanel
            :model-value="props.systemPromptPanelOpen"
            :value="props.systemPrompt.value"
            :loading="props.systemPrompt.loading"
            :error="props.systemPrompt.error"
            :open-reference="props.systemPrompt.openReference"
            @update:model-value="emit('update:systemPromptPanelOpen', $event)"
            @load="emit('system-prompt-load')"
            @refresh="emit('system-prompt-refresh')"
        />

        <!-- 3. 对话流区域（flex-1，内部滚动） -->
        <AgentChatFlow
            ref="flowRef"
            :messages="props.flow.messages"
            :session-id="props.flow.sessionId"
            :unselected="props.flow.unselected"
            :mode="props.flow.mode"
            :editing-message-id="props.flow.editingMessageId"
            :editing-message-text="props.flow.editingMessageText"
            :message-action-disabled="props.flow.messageActionDisabled"
            :run-action-disabled="props.flow.runActionDisabled"
            :saving-edit="props.flow.savingEdit"
            :session-attachments="props.flow.sessionAttachments"
            :can-register-attachments="props.flow.canRegisterAttachments"
            :can-insert-attachments="props.flow.canInsertAttachments"
            :project-root="props.flow.projectRoot"
            :model-supports-images="props.flow.modelSupportsImages"
            :attachment-insert-request="props.flow.attachmentInsertRequest"
            :branch-switcher-state-by-message-id="props.flow.branchSwitcherStateByMessageId"
            :menu-refresh-key="props.flow.menuRefreshKey"
            :resolve-editor-menu="props.flow.resolveEditorMenu"
            :on-editor-skill-trigger-start="props.flow.onEditorSkillTriggerStart"
            :open-reference="props.flow.openReference"
            :cost-display-options="props.flow.costDisplayOptions"
            :cost-exchange-rate-suffix="props.flow.costExchangeRateSuffix"
            :history-has-previous="props.flow.historyHasPrevious"
            :history-loading="props.flow.historyLoading"
            :history-error="props.flow.historyError"
            :recent-sessions="props.flow.recentSessions || props.sessions.sessions"
            @copy="emit('flow-copy', $event)"
            @copy-tool="emit('flow-copy-tool', $event)"
            @start-edit="emit('flow-start-edit', $event)"
            @cancel-edit="emit('flow-cancel-edit', $event)"
            @save-edit="emit('flow-save-edit', $event)"
            @retry="emit('flow-retry', $event)"
            @branch-from-here="emit('flow-branch-from-here', $event)"
            @cycle-branch="emit('flow-cycle-branch', $event)"
            @load-previous="emit('flow-load-previous')"
            @resend-unknown="emit('flow-resend-unknown', $event)"
            @dismiss-unknown="emit('flow-dismiss-unknown', $event)"
            @attachment-registered="emit('attachment-registered', $event)"
            @empty-select-starter="handleSelectStarter"
            @empty-select-session="emit('session-select', $event)"
            @empty-create-session="emit('header-create-session')"
            @empty-open-sessions="emit('update:sessionDialogOpen', true)"
        />

        <!-- 4. 底部前置面板：Workflow 待处理与工作区变更 -->
        <div class="mx-auto w-full max-w-4xl">
            <AgentWorkflowPendingPanel
                :runs="props.workflowPending.runs"
                :feed-error="props.workflowPending.feedError"
                @update-answer="emit('workflow-update-answer', $event)"
                @submit-run="emit('workflow-submit-run', $event)"
            />

            <div class="px-2">
                <AgentWorkspaceChanges
                    :project-root="props.workspaceChanges.projectRoot"
                    :groups="props.workspaceChanges.groups"
                    :loading="props.workspaceChanges.loading"
                    :error="props.workspaceChanges.error"
                    :expanded="props.workspaceChanges.expanded"
                    :selected-path="props.workspaceChanges.selectedPath"
                    :busy-path="props.workspaceChanges.busyPath"
                    :accepting-all="props.workspaceChanges.acceptingAll"
                    :diff-state-for="props.workspaceChanges.diffStateFor"
                    @update:expanded="emit('workspace-update-expanded', $event)"
                    @select-group="emit('workspace-select-group', $event)"
                    @accept-group="emit('workspace-accept-group', $event)"
                    @accept-all="emit('workspace-accept-all')"
                    @refresh="emit('workspace-refresh')"
                    @open-full="emit('workspace-open-full')"
                    @open-file="emit('workspace-open-file', $event)"
                />
            </div>
        </div>

        <!-- 5. 底部 Composer 输入区与会话状态栏 (在 AgentSidebarView 层限制最大宽度并居中，不污染 Composer 组件自身) -->
        <div class="mt-auto shrink-0 bg-[var(--bg-panel)] pb-1">
            <div class="mx-auto w-full max-w-4xl">
                <AgentComposer
                    :key="props.composerContextGeneration"
                    ref="composerRef"
                    :input-text="props.composer.inputText"
                    :pending-sessions="props.pendingSessions"
                    :pending-resolution-draft="props.composer.pendingResolutionDraft"
                    :submitting-user-input="props.composer.submittingUserInput"
                    :can-resolve-user-input="props.composer.canResolveUserInput"
                    :can-abort="props.composer.canAbort"
                    :pending-submission-issue="props.composer.pendingSubmissionIssue"
                    :running="props.composer.running"
                    :availability="props.composer.availability"
                    :can-register-attachments="props.composer.canRegisterAttachments"
                    :can-insert-attachments="props.composer.canInsertAttachments"
                    :loading-session="props.composer.loadingSession"
                    :session-model-saving="props.composer.sessionModelSaving"
                    :session-model-popover-open="props.composer.sessionModelPopoverOpen"
                    :session-model-selection-value="props.composer.sessionModelSelectionValue"
                    :session-thinking-resolved-label="props.composer.sessionThinkingResolvedLabel"
                    :session-model-draft="props.composer.sessionModelDraft"
                    :selectable-models="props.composer.selectableModels"
                    :agent-mode="props.composer.agentMode"
                    :can-continue-without-input="props.composer.canContinueWithoutInput"
                    :queued-messages="props.composer.queuedMessages"
                    :menu-refresh-key="props.composer.menuRefreshKey"
                    :project-root="props.composer.projectRoot"
                    :session-id="props.composer.sessionId"
                    :session-attachments="props.composer.sessionAttachments"
                    :model-supports-images="props.composer.modelSupportsImages"
                    :resolve-menu="props.composer.resolveMenu"
                    :on-skill-trigger-start="props.composer.onSkillTriggerStart"
                    @update:input-text="emit('composer-update-input-text', $event)"
                    @update:pending-resolution-draft="emit('composer-update-pending-resolution-draft', $event)"
                    @update:session-model-popover-open="emit('composer-update-session-model-popover-open', $event)"
                    @update:session-model-draft="emit('composer-update-session-model-draft', $event)"
                    @update-session-model-selection="emit('composer-update-session-model-selection', $event)"
                    @submit-user-input="emit('composer-submit-user-input')"
                    @cancel-user-input="emit('composer-cancel-user-input')"
                    @resync-user-input="emit('composer-resync-user-input')"
                    @send="emit('composer-send')"
                    @steer="emit('composer-steer')"
                    @followup="emit('composer-followup')"
                    @stop="emit('composer-stop')"
                    @cycle-mode="emit('composer-cycle-mode')"
                    @toggle-session-model-popover="emit('composer-toggle-session-model-popover')"
                    @apply-session-model-settings="emit('composer-apply-session-model-settings')"
                    @reset-session-model-settings="emit('composer-reset-session-model-settings')"
                    @attachment-registered="emit('attachment-registered', $event)"
                    @availability-action="emit('composer-availability-action', $event)"
                />
                <div class="px-2">
                    <AgentSessionStatusBar
                        :context-usage-exact-label="props.statusBar.contextUsageExactLabel"
                        :context-usage-compact-label="props.statusBar.contextUsageCompactLabel"
                        :context-percent-compact-label="props.statusBar.contextPercentCompactLabel"
                        :cumulative-usage-exact-label="props.statusBar.cumulativeUsageExactLabel"
                        :cumulative-input-compact-label="props.statusBar.cumulativeInputCompactLabel"
                        :cumulative-output-compact-label="props.statusBar.cumulativeOutputCompactLabel"
                        :cumulative-cache-compact-label="props.statusBar.cumulativeCacheCompactLabel"
                        :cumulative-cache-write-compact-label="props.statusBar.cumulativeCacheWriteCompactLabel"
                        :cumulative-cache-hit-rate-label="props.statusBar.cumulativeCacheHitRateLabel"
                        :cumulative-cost-compact-label="props.statusBar.cumulativeCostCompactLabel"
                        :connection-status-label="props.statusBar.connectionStatusLabel"
                        :connection-needs-action="props.statusBar.connectionNeedsAction"
                        :running="props.statusBar.running"
                        :run-phase-label="props.statusBar.runPhaseLabel"
                        :agent-mode="props.statusBar.agentMode"
                        @open-context-inspector="emit('update:contextInspectorOpen', true)"
                        @reconnect-events="emit('composer-reconnect-events')"
                        @refresh-history="emit('composer-refresh-history')"
                    />
                </div>
            </div>
        </div>

        <!-- 6. 独立浮层/弹窗 -->
        <AgentSessionDialog
            :model-value="props.sessionDialogOpen"
            :teleport-target="props.teleportTarget"
            :sessions="props.sessions.sessions"
            :total="props.sessions.total"
            :has-more="props.sessions.hasMore"
            :next-offset="props.sessions.nextOffset"
            :active-session-id="props.sessions.activeSessionId"
            :loading="props.sessions.loading"
            :running="props.sessions.running"
            :action-id="props.sessions.actionId"
            :create-profile-options="props.sessions.createProfileOptions"
            :can-choose-create-profile="props.sessions.canChooseCreateProfile"
            @update:model-value="emit('update:sessionDialogOpen', $event)"
            @select="emit('session-select', $event)"
            @create="emit('session-create', $event)"
            @archive="emit('session-archive', $event)"
            @restore="emit('session-restore', $event)"
            @rename="emit('session-rename', $event)"
            @refresh="emit('session-refresh', $event)"
            @load-more="emit('session-load-more', $event)"
        />

        <AgentSessionTreeDialog
            :model-value="props.sessionTreeDialogOpen"
            :teleport-target="props.teleportTarget"
            :tree="props.sessionTree.tree"
            :active-leaf-id="props.sessionTree.activeLeafId"
            :running="props.sessionTree.running"
            :can-activate="props.sessionTree.canActivate"
            @update:model-value="emit('update:sessionTreeDialogOpen', $event)"
            @select="emit('tree-select', $event)"
        />

        <AgentContextInspectorDialog
            :model-value="props.contextInspectorOpen"
            :session-id="props.contextInspector.sessionId"
            :inspection="props.contextInspector.inspection"
            :loading="props.contextInspector.loading"
            :error="props.contextInspector.error"
            :selected-trace-id="props.contextInspector.selectedTraceId"
            :teleport-target="props.teleportTarget"
            @update:model-value="emit('update:contextInspectorOpen', $event)"
            @select-trace="emit('context-select-trace', $event)"
            @refresh="emit('context-refresh')"
        />
    </section>
</template>
