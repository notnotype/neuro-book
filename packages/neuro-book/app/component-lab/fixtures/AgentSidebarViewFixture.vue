<script setup lang="ts">
import {computed, ref, watch} from "vue";
import AgentSidebarView from "nbook/app/components/novel-ide/agent/AgentSidebarView.vue";
import type {AgentSidebarViewProps} from "nbook/app/components/novel-ide/agent/AgentSidebarView.types";
import {SIDEBAR_FIXTURE_SCENARIOS, type AgentSidebarFixtureSceneData} from "./agent-sidebar-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";
import type {AgentSessionAttachmentItemDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const viewRef = ref<InstanceType<typeof AgentSidebarView> | null>(null);

const scenarioData = computed<AgentSidebarFixtureSceneData>(() => {
    if (props.data && typeof props.data === "object") {
        return props.data as AgentSidebarFixtureSceneData;
    }
    return (SIDEBAR_FIXTURE_SCENARIOS[props.scene] ?? SIDEBAR_FIXTURE_SCENARIOS.conversation)!;
});

// 本地受控状态（支持 Lab 内交互与数据修改）
const inputText = ref("");
const messages = ref<AgentMessage[]>([]);
const attachmentPanelOpen = ref(false);
const linkedAgentPanelOpen = ref(false);
const systemPromptPanelOpen = ref(false);
const sessionDialogOpen = ref(false);
const sessionTreeDialogOpen = ref(false);
const contextInspectorOpen = ref(false);
const workspaceExpanded = ref(false);
const sessionModelPopoverOpen = ref(false);

watch(() => props.scene, () => {
    const s = scenarioData.value;
    inputText.value = s.inputText ?? "";
    messages.value = [...(s.messages ?? [])];
    attachmentPanelOpen.value = Boolean(s.attachmentPanelOpen);
    linkedAgentPanelOpen.value = Boolean(s.linkedAgentPanelOpen);
    systemPromptPanelOpen.value = Boolean(s.systemPromptPanelOpen);
    sessionDialogOpen.value = Boolean(s.sessionDialogOpen);
    sessionTreeDialogOpen.value = Boolean(s.sessionTreeDialogOpen);
    contextInspectorOpen.value = Boolean(s.contextInspectorOpen);
    workspaceExpanded.value = (s.workspaceGroups?.length ?? 0) > 0;
}, {immediate: true});

const viewProps = computed<AgentSidebarViewProps>(() => {
    const s = scenarioData.value;
    return {
        layout: "workbench",
        // Lab 页没有 .novel-ide-theme 宿主，视图内窗口就地渲染。
        teleportTarget: false,
        pendingSessions: s.pendingSessions ?? [],
        attachmentPanelOpen: attachmentPanelOpen.value,
        linkedAgentPanelOpen: linkedAgentPanelOpen.value,
        systemPromptPanelOpen: systemPromptPanelOpen.value,
        sessionDialogOpen: sessionDialogOpen.value,
        sessionTreeDialogOpen: sessionTreeDialogOpen.value,
        contextInspectorOpen: contextInspectorOpen.value,

        header: {
            drawerIconClass: "i-lucide-bot",
            activeSessionTitle: s.activeSessionTitle,
            activeDrawerTitle: s.activeDrawerTitle,
            activeSessionSummaryText: s.activeSessionSummaryText,
            activeSessionId: s.activeSessionId,
            canChooseCreateProfile: true,
            createProfileDropdownItems: [
                {label: "通用写作助手", value: "writer.default", iconClass: "i-lucide-feather"},
                {label: "大纲与结构设计", value: "plot.planner", iconClass: "i-lucide-git-commit"},
            ],
            sessionAttachmentUniqueTotal: s.attachments?.length ?? 0,
            linkedAgentCount: s.linkedAgents?.length ?? 0,
            canMutateHistory: true,
            loadingSession: false,
        },

        flow: {
            messages: messages.value,
            sessionId: s.activeSessionId,
            mode: "main",
            recentSessions: s.sessions ?? [],
            canRegisterAttachments: true,
            canInsertAttachments: true,
            sessionAttachments: s.attachments ?? [],
            projectRoot: "workspace/projects/novel",
        },

        composer: {
            inputText: inputText.value,
            pendingResolutionDraft: {targetMode: "normal", answers: {}, forms: {}, planConfirmed: false},
            submittingUserInput: false,
            canResolveUserInput: true,
            canAbort: Boolean(s.canAbort),
            pendingSubmissionIssue: null,
            running: Boolean(s.running),
            availability: s.availabilityStatus === "ready"
                ? {status: "ready", readonly: false, canStop: false}
                : s.availabilityStatus === "empty"
                    ? {status: "empty", readonly: true, canStop: false}
                    : s.availabilityStatus === "profile-unavailable"
                        ? {status: "profile-unavailable", message: s.availabilityMessage || "Profile 不可用", readonly: true, canStop: false}
                        : {status: "ready", readonly: false, canStop: false},
            canRegisterAttachments: true,
            canInsertAttachments: true,
            loadingSession: false,
            sessionModelSaving: false,
            sessionModelPopoverOpen: sessionModelPopoverOpen.value,
            sessionModelSelectionValue: "deepseek-chat",
            sessionThinkingResolvedLabel: "中等",
            sessionModelDraft: {modelKey: "deepseek-chat", reasoningEffort: "medium"},
            selectableModels: [
                {
                    key: "deepseek/deepseek-chat",
                    label: "DeepSeek V3",
                    providerId: "deepseek",
                    modelId: "deepseek-chat",
                    input: ["text", "image"],
                    contextWindowTokens: 64000,
                },
                {
                    key: "deepseek/deepseek-reasoner",
                    label: "DeepSeek R1",
                    providerId: "deepseek",
                    modelId: "deepseek-reasoner",
                    input: ["text"],
                    contextWindowTokens: 64000,
                },
            ],
            agentMode: "normal",
            canContinueWithoutInput: true,
            contextUsageExactLabel: "1,590 / 64,000 tokens",
            contextUsageCompactLabel: "1.6k",
            contextPercentCompactLabel: "2%",
            cumulativeUsageExactLabel: "1.6k tokens",
            cumulativeInputCompactLabel: "1.2k",
            cumulativeOutputCompactLabel: "350",
            cumulativeCacheCompactLabel: "800",
            cumulativeCacheWriteCompactLabel: "0",
            cumulativeCacheHitRateLabel: "50%",
            cumulativeCostCompactLabel: "$0.002",
            connectionStatusLabel: "就绪",
            runPhaseLabel: "空闲",
            connectionNeedsAction: false,
            queuedMessages: s.queuedMessages ?? [],
            menuRefreshKey: 0,
            projectRoot: "workspace/projects/novel",
            sessionId: s.activeSessionId,
            sessionAttachments: s.attachments ?? [],
            modelSupportsImages: true,
            resolveMenu: () => ({title: "命令", prefix: "/", sections: []}),
        },

        attachments: {
            items: s.attachments ?? [],
            total: s.attachments?.length ?? 0,
            hasMore: false,
            loading: false,
            search: "",
            insertDisabled: false,
        },

        linkedAgents: {
            sessionId: s.activeSessionId,
            ownedAgents: s.linkedAgents ?? [],
            linkedByAgents: [],
            loading: false,
        },

        systemPrompt: {
            value: s.systemPrompt ?? "你是一位专业的小说写作助手与结构设计专家。请保持文风凝练、情感细腻、逻辑严谨。",
            loading: false,
        },

        workspaceChanges: {
            projectRoot: "workspace/projects/novel",
            groups: s.workspaceGroups ?? [],
            loading: false,
            error: null,
            expanded: workspaceExpanded.value,
            selectedPath: null,
            busyPath: null,
            acceptingAll: false,
            diffStateFor: () => ({status: "idle", loading: false, error: null, result: null}),
        },

        workflowPending: {
            runs: s.workflowPendingRuns ?? [],
            feedError: undefined,
        },

        sessions: {
            sessions: s.sessions ?? [],
            total: s.sessions?.length ?? 0,
            hasMore: false,
            nextOffset: null,
            activeSessionId: s.activeSessionId,
            loading: false,
            running: Boolean(s.running),
            actionId: null,
            createProfileOptions: [
                {profileKey: "writer.default", label: "通用写作助手", iconClass: "i-lucide-feather"},
            ],
            canChooseCreateProfile: true,
        },

        sessionTree: {
            tree: s.sessionTree ?? [],
            activeLeafId: null,
            running: Boolean(s.running),
            canActivate: true,
        },

        contextInspector: {
            sessionId: s.activeSessionId,
            inspection: s.contextInspection ?? null,
            loading: false,
            error: "",
            selectedTraceId: "req-1",
        },
    };
});
</script>

<template>
    <AgentSidebarView
        ref="viewRef"
        class="h-full w-full"
        data-lab-subject
        v-bind="viewProps"
        @update:attachment-panel-open="attachmentPanelOpen = $event"
        @update:linked-agent-panel-open="linkedAgentPanelOpen = $event"
        @update:system-prompt-panel-open="systemPromptPanelOpen = $event"
        @update:session-dialog-open="sessionDialogOpen = $event"
        @update:session-tree-dialog-open="sessionTreeDialogOpen = $event"
        @update:context-inspector-open="contextInspectorOpen = $event"
        @header-create-session="emitLabEvent('header-create-session', $event)"
        @close="emitLabEvent('close')"
        @flow-copy="emitLabEvent('flow-copy', $event)"
        @flow-copy-tool="emitLabEvent('flow-copy-tool', $event)"
        @flow-start-edit="emitLabEvent('flow-start-edit', $event)"
        @flow-cancel-edit="emitLabEvent('flow-cancel-edit', $event)"
        @flow-save-edit="emitLabEvent('flow-save-edit', $event)"
        @flow-retry="emitLabEvent('flow-retry', $event)"
        @flow-branch-from-here="emitLabEvent('flow-branch-from-here', $event)"
        @flow-cycle-branch="emitLabEvent('flow-cycle-branch', $event)"
        @flow-load-previous="emitLabEvent('flow-load-previous')"
        @flow-resend-unknown="emitLabEvent('resend-unknown', $event)"
        @flow-dismiss-unknown="emitLabEvent('dismiss-unknown', $event)"
        @attachment-search="emitLabEvent('attachment-search', $event)"
        @attachment-load-more="emitLabEvent('attachment-load-more')"
        @attachment-insert="emitLabEvent('attachment-insert', $event)"
        @linked-agent-select="emitLabEvent('linked-agent-select', $event)"
        @linked-agent-refresh="emitLabEvent('linked-agent-refresh')"
        @system-prompt-load="emitLabEvent('system-prompt-load')"
        @system-prompt-refresh="emitLabEvent('system-prompt-refresh')"
        @workspace-update-expanded="workspaceExpanded = $event"
        @workspace-select-group="emitLabEvent('workspace-select-group', $event)"
        @workspace-accept-group="emitLabEvent('workspace-accept-group', $event)"
        @workspace-accept-all="emitLabEvent('workspace-accept-all')"
        @workspace-refresh="emitLabEvent('workspace-refresh')"
        @workspace-open-full="emitLabEvent('workspace-open-full')"
        @workspace-open-file="emitLabEvent('workspace-open-file', $event)"
        @workflow-update-answer="emitLabEvent('workflow-update-answer', $event)"
        @workflow-submit-run="emitLabEvent('workflow-submit-run', $event)"
        @workflow-observe="emitLabEvent('workflow-observe', $event)"
        @workflow-unobserve="emitLabEvent('workflow-unobserve', $event)"
        @workflow-cancel-job="emitLabEvent('workflow-cancel-job', $event)"
        @composer-update-input-text="inputText = $event"
        @composer-toggle-session-model-popover="sessionModelPopoverOpen = !sessionModelPopoverOpen"
        @composer-update-session-model-popover-open="sessionModelPopoverOpen = $event"
        @composer-send="emitLabEvent('composer-send', inputText)"
        @composer-stop="emitLabEvent('composer-stop')"
        @composer-steer="emitLabEvent('composer-steer', inputText)"
        @composer-followup="emitLabEvent('composer-followup', inputText)"
        @composer-availability-action="emitLabEvent('composer-availability-action', $event)"
        @session-select="emitLabEvent('session-select', $event)"
        @session-create="emitLabEvent('session-create', $event)"
        @session-archive="emitLabEvent('session-archive', $event)"
        @session-restore="emitLabEvent('session-restore', $event)"
        @session-rename="emitLabEvent('session-rename', $event)"
        @session-refresh="emitLabEvent('session-refresh', $event)"
        @session-load-more="emitLabEvent('session-load-more', $event)"
        @tree-select="emitLabEvent('tree-select', $event)"
        @tree-copy-id="emitLabEvent('tree-copy-id', $event)"
        @context-select-trace="emitLabEvent('context-select-trace', $event)"
        @context-refresh="emitLabEvent('context-refresh')"
        @empty-select-starter="inputText = $event; emitLabEvent('empty-select-starter', $event)"
        @empty-create-session="emitLabEvent('header-create-session')"
        @empty-open-sessions="sessionDialogOpen = true; emitLabEvent('open-sessions')"
    />
</template>
