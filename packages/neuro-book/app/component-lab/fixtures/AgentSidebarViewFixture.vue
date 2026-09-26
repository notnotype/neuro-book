<script setup lang="ts">
import {computed} from "vue";
import AgentSidebarView from "nbook/app/components/novel-ide/agent/AgentSidebarView.vue";
import type {AgentSidebarViewProps} from "nbook/app/components/novel-ide/agent/AgentSidebarView.types";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {AgentMessage} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import {agentSidebarViewScenes} from "./AgentSidebarView.scenes";

const props = defineProps<LabFixtureProps>();

const emitLabEvent = useLabEventSink();

const subject = useLabSubject<typeof AgentSidebarView>(() => props.input, [
    "header-create-session", "close", "flow-copy", "flow-copy-tool", "flow-start-edit", "flow-cancel-edit",
    "flow-save-edit", "flow-retry", "flow-branch-from-here", "flow-cycle-branch", "flow-load-previous",
    "flow-resend-unknown", "flow-dismiss-unknown", "attachment-search", "attachment-load-more",
    "attachment-insert", "linked-agent-select", "linked-agent-refresh", "system-prompt-load",
    "system-prompt-refresh", "workspace-select-group", "workspace-accept-group", "workspace-accept-all",
    "workspace-refresh", "workspace-open-full", "workspace-open-file", "workflow-update-answer",
    "workflow-submit-run", "workflow-observe", "workflow-unobserve", "workflow-cancel-job",
    "composer-send", "composer-stop", "composer-steer", "composer-followup", "composer-availability-action",
    "session-select", "session-create", "session-archive", "session-restore", "session-rename",
    "session-refresh", "session-load-more", "tree-select", "tree-copy-id", "context-select-trace",
    "context-refresh", "empty-select-starter", "empty-create-session", "empty-open-sessions",
]);
const registered = computed(() => subject.bindings.value);

// 控制条直接回写 Lab 的同一份输入，只有回调能力留在 fixture 内存。
const inputText = computed(() => viewProps.value.composer.inputText);
const messages = computed<AgentMessage[]>({
    get: () => registered.value.flow.messages as AgentMessage[],
    set: (next) => subject.write("props", "flow", {...registered.value.flow, messages: next}),
});
const attachmentPanelOpen = computed(() => viewProps.value.attachmentPanelOpen);
const linkedAgentPanelOpen = computed(() => viewProps.value.linkedAgentPanelOpen);
const systemPromptPanelOpen = computed(() => viewProps.value.systemPromptPanelOpen);
const sessionDialogOpen = computed(() => viewProps.value.sessionDialogOpen);
const sessionTreeDialogOpen = computed(() => viewProps.value.sessionTreeDialogOpen);
const contextInspectorOpen = computed(() => viewProps.value.contextInspectorOpen);
const workspaceExpanded = computed(() => viewProps.value.workspaceChanges.expanded);
const sessionModelPopoverOpen = computed(() => viewProps.value.composer.sessionModelPopoverOpen);
const running = computed(() => viewProps.value.composer.running);
const agentMode = computed(() => viewProps.value.composer.agentMode);
const availabilityStatus = computed(() => viewProps.value.composer.availability.status);

const viewProps = computed<AgentSidebarViewProps>(() => {
    const data = registered.value;
    const composer = data.composer as Omit<AgentSidebarViewProps["composer"], "resolveMenu">;
    const workspaceChanges = data.workspaceChanges as Omit<AgentSidebarViewProps["workspaceChanges"], "diffStateFor">;
    return {
        ...data,
        flow: {...data.flow, messages: messages.value},
        composer: {...composer, resolveMenu: () => ({title: "命令", prefix: "/", sections: []})},
        workspaceChanges: {...workspaceChanges, diffStateFor: () => ({status: "idle", loading: false, error: null, result: null})},
    };
});

function toggleRunning(): void {
    const running = !viewProps.value.composer.running;
    subject.write("props", "composer", {...registered.value.composer, running, canAbort: running});
    subject.write("props", "statusBar", {...registered.value.statusBar, running});
}

function cycleAgentMode(): void {
    const modes: AgentMode[] = ["normal", "discuss", "plan"];
    const next = modes[(modes.indexOf(viewProps.value.composer.agentMode) + 1) % modes.length]!;
    subject.write("props", "composer", {...registered.value.composer, agentMode: next});
    subject.write("props", "statusBar", {...registered.value.statusBar, agentMode: next});
}

function cycleAvailability(): void {
    const statuses: AgentSidebarViewProps["composer"]["availability"]["status"][] = ["ready", "restoring", "empty", "archived", "unselected", "profile-unavailable", "load-error"];
    const status = statuses[(statuses.indexOf(availabilityStatus.value) + 1) % statuses.length]!;
    const availability: AgentSidebarViewProps["composer"]["availability"] = status === "ready"
        ? {status, readonly: false, canStop: false}
        : status === "archived" ? {status, readonly: true, canStop: false, canRestore: true}
            : status === "profile-unavailable" ? {status, readonly: true, canStop: false, message: "Profile 不可用"}
                : status === "load-error" ? {status, readonly: true, canStop: false, message: "恢复对话失败"}
                    : {status, readonly: true, canStop: false};
    subject.write("props", "composer", {...registered.value.composer, availability});
}

let nextSimulatedMessageId = 1;
function simulateUserMessage(): void {
    const text = inputText.value.trim() || "请帮我检查这一章的节奏并提出修改建议。";
    const newMsg: AgentMessage = {
        id: `user-${nextSimulatedMessageId++}`,
        type: "user",
        content: text,
        timestamp: "11:01:00",
    };
    messages.value = [...messages.value, newMsg];
    subject.write("props", "composer", {...registered.value.composer, inputText: ""});
    emitLabEvent("fixture-add-user-message", {id: newMsg.id, text});
}

function simulateAssistantMessage(): void {
    const newMsg: AgentMessage = {
        id: `assistant-${nextSimulatedMessageId++}`,
        type: "ai",
        content: "我已通读本章内容。第3节转折略显突兀，建议增加心理独白以铺垫情感冲突。",
        thinking: "正在比对伏笔网络与主线情绪曲线，分析本章第3小节的转折点合理性...",
        status: "done",
        timestamp: "11:01:00",
    };
    messages.value = [...messages.value, newMsg];
    emitLabEvent("fixture-add-assistant-message", {id: newMsg.id});
}

function simulateToolMessage(): void {
    const toolCallId = `call-${nextSimulatedMessageId}`;
    const newMsg: AgentMessage = {
        id: `tool-${nextSimulatedMessageId++}`,
        type: "ai",
        content: "已调用工作区检查工具，完成第3章文件校验。",
        status: "done",
        timestamp: "11:01:00",
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
    messages.value = [...messages.value, newMsg];
    emitLabEvent("fixture-add-tool-message", {id: newMsg.id});
}

function resetMessages(): void {
    if (messages.value.length === 0) {
        const original = agentSidebarViewScenes.find((entry) => entry.id === props.scene)?.input.props.flow.messages ?? [];
        messages.value = structuredClone(original) as AgentMessage[];
    } else {
        messages.value = [];
    }
    emitLabEvent("fixture-reset-messages", {count: messages.value.length});
}
</script>

<template>
    <div class="novel-ide-theme h-full w-full">
        <AgentSidebarView
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
