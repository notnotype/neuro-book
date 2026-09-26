<script setup lang="ts">
import {computed, ref, watch} from "vue";
import AgentSidebarView from "nbook/app/components/novel-ide/agent/AgentSidebarView.vue";
import type {AgentSidebarViewProps} from "nbook/app/components/novel-ide/agent/AgentSidebarView.types";
import {SIDEBAR_FIXTURE_SCENARIOS, type AgentSidebarFixtureSceneData} from "./agent-sidebar-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";
import type {AgentMode, AgentSessionAttachmentItemDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const viewRef = ref<InstanceType<typeof AgentSidebarView> | null>(null);

const scenarioData = computed<AgentSidebarFixtureSceneData>(() => {
    if (props.data && typeof props.data === "object" && "messages" in props.data) {
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
const running = ref(false);
const agentMode = ref<AgentMode>("normal");
const availabilityStatus = ref<AgentSidebarFixtureSceneData["availabilityStatus"]>("ready");
const availabilityMessage = ref("");

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
    running.value = Boolean(s.running);
    agentMode.value = "normal";
    availabilityStatus.value = s.availabilityStatus ?? "ready";
    availabilityMessage.value = s.availabilityMessage ?? "";
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
            canAbort: Boolean(s.canAbort || running.value),
            pendingSubmissionIssue: null,
            running: running.value,
            availability: availabilityStatus.value === "ready"
                ? {status: "ready", readonly: false, canStop: false}
                : availabilityStatus.value === "restoring"
                    ? {status: "restoring", readonly: true, canStop: false}
                    : availabilityStatus.value === "unselected"
                        ? {status: "unselected", readonly: true, canStop: false}
                        : availabilityStatus.value === "empty"
                            ? {status: "empty", readonly: true, canStop: false}
                            : availabilityStatus.value === "archived"
                                ? {status: "archived", readonly: true, canStop: false, canRestore: true}
                                : availabilityStatus.value === "profile-unavailable"
                                    ? {status: "profile-unavailable", message: availabilityMessage.value || "Profile 不可用", readonly: true, canStop: false}
                                    : availabilityStatus.value === "waiting-blocked"
                                        ? {status: "waiting-blocked", readonly: true, canStop: false}
                                        : availabilityStatus.value === "load-error"
                                            ? {status: "load-error", message: availabilityMessage.value || "恢复对话失败", readonly: true, canStop: false, canRetry: true}
                                            : {status: "blocked", readonly: true, canStop: false},
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
            showSpecialistInPicker: true,
            agentMode: agentMode.value,
            canContinueWithoutInput: true,
            queuedMessages: s.queuedMessages ?? [],
            menuRefreshKey: 0,
            projectRoot: "workspace/projects/novel",
            sessionId: s.activeSessionId,
            sessionAttachments: s.attachments ?? [],
            modelSupportsImages: true,
            resolveMenu: () => ({title: "命令", prefix: "/", sections: []}),
        },

        statusBar: {
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
            running: running.value,
            agentMode: agentMode.value,
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
            running: running.value,
            actionId: null,
            createProfileOptions: [
                {profileKey: "writer.default", label: "通用写作助手", iconClass: "i-lucide-feather"},
            ],
            canChooseCreateProfile: true,
        },

        sessionTree: {
            tree: s.sessionTree ?? [],
            activeLeafId: null,
            running: running.value,
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

function toggleRunning(): void {
    running.value = !running.value;
    emitLabEvent("fixture-toggle-running", {running: running.value});
}

function cycleAgentMode(): void {
    const modes: AgentMode[] = ["normal", "discuss", "plan"];
    const idx = modes.indexOf(agentMode.value);
    agentMode.value = modes[(idx + 1) % modes.length]!;
    emitLabEvent("fixture-cycle-mode", {agentMode: agentMode.value});
}

function cycleAvailability(): void {
    const statuses: Array<AgentSidebarFixtureSceneData["availabilityStatus"]> = [
        "ready",
        "restoring",
        "empty",
        "archived",
        "unselected",
        "profile-unavailable",
        "load-error",
    ];
    const idx = statuses.indexOf(availabilityStatus.value);
    availabilityStatus.value = statuses[(idx + 1) % statuses.length]!;
    emitLabEvent("fixture-cycle-availability", {availabilityStatus: availabilityStatus.value});
}

function simulateUserMessage(): void {
    const text = inputText.value.trim() || "请帮我检查这一章的节奏并提出修改建议。";
    const newMsg: AgentMessage = {
        id: `user-${Date.now()}`,
        type: "user",
        content: text,
        timestamp: new Date().toLocaleTimeString("zh-CN", {hour12: false}),
    };
    messages.value.push(newMsg);
    inputText.value = "";
    emitLabEvent("fixture-add-user-message", {id: newMsg.id, text});
}

function simulateAssistantMessage(): void {
    const newMsg: AgentMessage = {
        id: `assistant-${Date.now()}`,
        type: "ai",
        content: "我已通读本章内容。第3节转折略显突兀，建议增加心理独白以铺垫情感冲突。",
        thinking: "正在比对伏笔网络与主线情绪曲线，分析本章第3小节的转折点合理性...",
        status: "done",
        timestamp: new Date().toLocaleTimeString("zh-CN", {hour12: false}),
    };
    messages.value.push(newMsg);
    emitLabEvent("fixture-add-assistant-message", {id: newMsg.id});
}

function simulateToolMessage(): void {
    const toolCallId = `call-${Date.now()}`;
    const newMsg: AgentMessage = {
        id: `tool-${Date.now()}`,
        type: "ai",
        content: "已调用工作区检查工具，完成第3章文件校验。",
        status: "done",
        timestamp: new Date().toLocaleTimeString("zh-CN", {hour12: false}),
        toolCalls: [
            {
                id: toolCallId,
                index: 0,
                name: "workspace_lint",
                argsText: JSON.stringify({path: "chapters/chapter-03.md"}),
                argsJson: JSON.stringify({path: "chapters/chapter-03.md"}),
                result: JSON.stringify({status: "ok", found: true, errors: 0, warnings: 2}),
                status: "success",
            },
        ],
    };
    messages.value.push(newMsg);
    emitLabEvent("fixture-add-tool-message", {id: newMsg.id});
}

function resetMessages(): void {
    const s = scenarioData.value;
    if (messages.value.length === 0) {
        messages.value = [...(s.messages ?? [])];
    } else {
        messages.value = [];
    }
    emitLabEvent("fixture-reset-messages", {count: messages.value.length});
}
</script>

<template>
    <div class="h-full w-full">
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
            @composer-cycle-mode="cycleAgentMode"
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

        <!-- 调试控制条：下放至 Lab 底部抽屉栏 -->
        <LabFixtureControls>
            <div class="flex flex-col gap-2 text-xs select-none p-1">
                <!-- 顶行：标题与状态控制 -->
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] pb-1.5">
                    <span class="font-medium text-[var(--text-secondary)]">AgentSidebarView 交互调试</span>
                    <div class="flex flex-wrap items-center gap-1.5">
                        <!-- 运行态开关 -->
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-2 text-[11px] cursor-pointer transition-colors"
                            :class="running ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="toggleRunning"
                        >
                            {{ running ? "● 运行中 (点击停止)" : "○ 空闲 (点击运行)" }}
                        </button>

                        <!-- 模式切换 -->
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                            @click="cycleAgentMode"
                        >
                            模式: {{ agentMode }}
                        </button>

                        <!-- 可用性切换 -->
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                            @click="cycleAvailability"
                        >
                            可用性: {{ availabilityStatus }}
                        </button>
                    </div>
                </div>

                <!-- 底行：浮层抽屉开关 & 消息模拟 -->
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <!-- 浮层与弹窗开关 -->
                    <div class="flex flex-wrap items-center gap-1">
                        <span class="text-[10px] text-[var(--text-muted)] mr-1">面板:</span>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="attachmentPanelOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="attachmentPanelOpen = !attachmentPanelOpen"
                        >
                            附件 ({{ attachmentPanelOpen ? "开" : "关" }})
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="linkedAgentPanelOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="linkedAgentPanelOpen = !linkedAgentPanelOpen"
                        >
                            关联Agent ({{ linkedAgentPanelOpen ? "开" : "关" }})
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="systemPromptPanelOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="systemPromptPanelOpen = !systemPromptPanelOpen"
                        >
                            Prompt ({{ systemPromptPanelOpen ? "开" : "关" }})
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="workspaceExpanded ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="workspaceExpanded = !workspaceExpanded"
                        >
                            工作区变更 ({{ workspaceExpanded ? "开" : "关" }})
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="sessionModelPopoverOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="sessionModelPopoverOpen = !sessionModelPopoverOpen"
                        >
                            模型参数 ({{ sessionModelPopoverOpen ? "开" : "关" }})
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="sessionDialogOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="sessionDialogOpen = !sessionDialogOpen"
                        >
                            会话列表
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="sessionTreeDialogOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="sessionTreeDialogOpen = !sessionTreeDialogOpen"
                        >
                            分支树
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border px-1.5 text-[11px] cursor-pointer transition-colors"
                            :class="contextInspectorOpen ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--panel-surface)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                            @click="contextInspectorOpen = !contextInspectorOpen"
                        >
                            上下文检查
                        </button>
                    </div>

                    <!-- 消息操作模拟 -->
                    <div class="flex flex-wrap items-center gap-1">
                        <span class="text-[10px] text-[var(--text-muted)] mr-1">消息:</span>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1.5 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                            @click="simulateUserMessage"
                        >
                            +用户消息
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1.5 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                            @click="simulateAssistantMessage"
                        >
                            +助手消息
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1.5 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                            @click="simulateToolMessage"
                        >
                            +工具调用
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1.5 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                            @click="resetMessages"
                        >
                            {{ messages.length > 0 ? "清空消息" : "恢复消息" }}
                        </button>
                    </div>
                </div>
            </div>
        </LabFixtureControls>
    </div>
</template>
