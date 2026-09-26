import type AgentSidebarView from "../../components/novel-ide/agent/AgentSidebarView.vue";
import type {AgentSidebarViewProps} from "../../components/novel-ide/agent/AgentSidebarView.types";
import type {LabFixtureDefinition} from "./index";
import {SIDEBAR_FIXTURE_SCENARIOS, type AgentSidebarFixtureSceneData} from "./agent-sidebar-fixture-data";

type SidebarInputProps = Omit<AgentSidebarViewProps, "composer" | "flow" | "workspaceChanges" | "referenceTeleportTarget" | "workflowByToolKey" | "resolveAttachmentUrl" | "systemPrompt"> & {
    composer: Omit<AgentSidebarViewProps["composer"], "resolveMenu" | "onSkillTriggerStart">;
    flow: Omit<AgentSidebarViewProps["flow"], "messages" | "resolveEditorMenu" | "onEditorSkillTriggerStart" | "openReference"> & {
        messages: AgentSidebarFixtureSceneData["messages"];
    };
    workspaceChanges: Omit<AgentSidebarViewProps["workspaceChanges"], "diffStateFor">;
    systemPrompt: Omit<AgentSidebarViewProps["systemPrompt"], "openReference">;
};

function availability(s: AgentSidebarFixtureSceneData): AgentSidebarViewProps["composer"]["availability"] {
    switch (s.availabilityStatus) {
        case "ready": return {status: "ready", readonly: false, canStop: false};
        case "restoring": return {status: "restoring", readonly: true, canStop: false};
        case "unselected": return {status: "unselected", readonly: true, canStop: false};
        case "empty": return {status: "empty", readonly: true, canStop: false};
        case "archived": return {status: "archived", readonly: true, canStop: false, canRestore: true};
        case "profile-unavailable": return {status: "profile-unavailable", message: s.availabilityMessage || "Profile 不可用", readonly: true, canStop: false};
        case "waiting-blocked": return {status: "waiting-blocked", readonly: true, canStop: false};
        case "load-error": return {status: "load-error", message: s.availabilityMessage || "恢复对话失败", readonly: true, canStop: false};
        case "blocked": return {status: "blocked", readonly: true, canStop: false};
    }
}

function sidebarProps(s: AgentSidebarFixtureSceneData): SidebarInputProps {
    const running = Boolean(s.running);
    return {
        layout: "workbench", teleportTarget: false,
        pendingSessions: s.pendingSessions ?? [],
        attachmentPanelOpen: Boolean(s.attachmentPanelOpen),
        linkedAgentPanelOpen: Boolean(s.linkedAgentPanelOpen),
        systemPromptPanelOpen: Boolean(s.systemPromptPanelOpen),
        sessionDialogOpen: Boolean(s.sessionDialogOpen),
        sessionTreeDialogOpen: Boolean(s.sessionTreeDialogOpen),
        contextInspectorOpen: Boolean(s.contextInspectorOpen),
        header: {
            drawerIconClass: "i-lucide-bot", activeSessionTitle: s.activeSessionTitle,
            activeDrawerTitle: s.activeDrawerTitle, activeSessionSummaryText: s.activeSessionSummaryText,
            activeSessionId: s.activeSessionId, canChooseCreateProfile: true,
            createProfileDropdownItems: [
                {label: "通用写作助手", value: "writer.default", iconClass: "i-lucide-feather"},
                {label: "大纲与结构设计", value: "plot.planner", iconClass: "i-lucide-git-commit"},
            ],
            sessionAttachmentUniqueTotal: s.attachments?.length ?? 0,
            linkedAgentCount: s.linkedAgents?.length ?? 0,
            canMutateHistory: true, loadingSession: false,
        },
        flow: {
            messages: s.messages, sessionId: s.activeSessionId, mode: "main", recentSessions: s.sessions ?? [],
            canRegisterAttachments: true, canInsertAttachments: true,
            sessionAttachments: s.attachments ?? [], projectRoot: "workspace/projects/novel",
        },
        composer: {
            inputText: s.inputText ?? "",
            pendingResolutionDraft: {answers: {}, forms: {}},
            submittingUserInput: false, canResolveUserInput: true, canAbort: Boolean(s.canAbort || running),
            pendingSubmissionIssue: null, running, availability: availability(s),
            canRegisterAttachments: true, canInsertAttachments: true, loadingSession: false,
            sessionModelSaving: false, sessionModelPopoverOpen: false,
            sessionModelSelectionValue: "deepseek-chat", sessionThinkingResolvedLabel: "中等",
            sessionModelDraft: {modelKey: "deepseek-chat", reasoningEffort: "medium"},
            selectableModels: [
                {key: "deepseek/deepseek-chat", label: "DeepSeek V3", providerId: "deepseek", modelId: "deepseek-chat", input: ["text", "image"], contextWindowTokens: 64000},
                {key: "deepseek/deepseek-reasoner", label: "DeepSeek R1", providerId: "deepseek", modelId: "deepseek-reasoner", input: ["text"], contextWindowTokens: 64000},
            ],
            agentMode: "normal", canContinueWithoutInput: true,
            queuedMessages: s.queuedMessages ?? [], menuRefreshKey: 0, projectRoot: "workspace/projects/novel",
            sessionId: s.activeSessionId, sessionAttachments: s.attachments ?? [], modelSupportsImages: true,
        },
        statusBar: {
            contextUsageExactLabel: "1,590 / 64,000 tokens", contextUsageCompactLabel: "1.6k",
            contextPercentCompactLabel: "2%", cumulativeUsageExactLabel: "1.6k tokens",
            cumulativeInputCompactLabel: "1.2k", cumulativeOutputCompactLabel: "350",
            cumulativeCacheCompactLabel: "800", cumulativeCacheWriteCompactLabel: "0",
            cumulativeCacheHitRateLabel: "50%", cumulativeCostCompactLabel: "$0.002",
            connectionStatusLabel: "就绪", runPhaseLabel: "空闲", connectionNeedsAction: false,
            running, agentMode: "normal",
        },
        attachments: {items: s.attachments ?? [], total: s.attachments?.length ?? 0, hasMore: false, loading: false, search: "", insertDisabled: false},
        linkedAgents: {sessionId: s.activeSessionId, ownedAgents: s.linkedAgents ?? [], linkedByAgents: [], loading: false},
        systemPrompt: {value: s.systemPrompt ?? "你是一位专业的小说写作助手与结构设计专家。请保持文风凝练、情感细腻、逻辑严谨。", loading: false},
        workspaceChanges: {
            projectRoot: "workspace/projects/novel", groups: s.workspaceGroups ?? [], loading: false,
            error: null, expanded: (s.workspaceGroups?.length ?? 0) > 0,
            selectedPath: null, busyPath: null, acceptingAll: false,
        },
        workflowPending: {runs: s.workflowPendingRuns ?? []},
        sessions: {
            sessions: s.sessions ?? [], total: s.sessions?.length ?? 0, hasMore: false,
            nextOffset: null, activeSessionId: s.activeSessionId, loading: false,
            running, actionId: null,
            createProfileOptions: [{profileKey: "writer.default", label: "通用写作助手", iconClass: "i-lucide-feather"}],
            canChooseCreateProfile: true,
        },
        sessionTree: {tree: s.sessionTree ?? [], activeLeafId: null, running, canActivate: true},
        contextInspector: {sessionId: s.activeSessionId, inspection: s.contextInspection ?? null, loading: false, error: "", selectedTraceId: "req-1"},
    };
}

const labels: Record<string, string> = {
    empty: "创作入口（最近会话+推荐词）", conversation: "常规对话与工具",
    streaming: "实时生成流式态", history: "历史追溯与长对话",
    "delivery-unknown": "未知投递重发忽略", images: "图文多模态创作",
    "pending-input": "人机决策待决审批", workflow: "多Agent工作流",
    "workspace-changes": "工作区历史变更", sessions: "多会话列表与管理",
    "context-inspector": "Prompt上下文检查", unavailable: "不可用异常状态",
};

export const agentSidebarViewScenes = Object.entries(SIDEBAR_FIXTURE_SCENARIOS).map(([id, data]) => ({
    id, label: labels[id]!, input: {props: sidebarProps(data)},
})) satisfies LabFixtureDefinition<typeof AgentSidebarView>["scenes"];
