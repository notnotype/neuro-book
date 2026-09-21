import {markRaw, type Component} from "vue";
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentEditFileBubble from "nbook/app/components/novel-ide/agent/bubbles/tools/AgentEditFileBubble.vue";
import AgentRequestUserInputBubble from "nbook/app/components/novel-ide/agent/bubbles/interactive/AgentRequestUserInputBubble.vue";
import AgentSwitchModeBubble from "nbook/app/components/novel-ide/agent/bubbles/interactive/AgentSwitchModeBubble.vue";
import AgentWriteFileBubble from "nbook/app/components/novel-ide/agent/bubbles/tools/AgentWriteFileBubble.vue";
import AgentApplyPatchBubble from "nbook/app/components/novel-ide/agent/bubbles/tools/AgentApplyPatchBubble.vue";
import AgentTaskBubble from "nbook/app/components/novel-ide/agent/bubbles/tools/AgentTaskBubble.vue";
import AgentWorkflowBubble from "nbook/app/components/novel-ide/agent/bubbles/tools/AgentWorkflowBubble.vue";

/** Tool 节点渲染模式。 */
export type AgentToolRenderMode = "inline" | "block" | "message" | "hidden";

/** 单个 tool 的渲染配置。 */
export type AgentToolRenderConfig = {
    mode: AgentToolRenderMode;
    typeLabel: string;
    collapsedPreview?: string;
    collapsedPreviewKey?: string;
    component?: Component;
};

const DEFAULT_TOOL_RENDER_CONFIG: AgentToolRenderConfig = {
    mode: "inline",
    typeLabel: "Tool Call",
};

const TOOL_RENDER_REGISTRY: Record<string, AgentToolRenderConfig> = {
    request_user_input: {
        mode: "block",
        typeLabel: "Question",
        collapsedPreviewKey: "agent.tool.waitingUserAnswer",
        component: markRaw(AgentRequestUserInputBubble),
    },
    switch_mode: {
        mode: "message",
        typeLabel: "Mode",
        collapsedPreviewKey: "agent.tool.modeSwitchApproval",
        component: markRaw(AgentSwitchModeBubble),
    },
    write: {
        mode: "block",
        typeLabel: "Write",
        collapsedPreviewKey: "agent.tool.writeFile",
        component: markRaw(AgentWriteFileBubble),
    },
    edit: {
        mode: "block",
        typeLabel: "Edit",
        collapsedPreviewKey: "agent.tool.editFile",
        component: markRaw(AgentEditFileBubble),
    },
    apply_patch: {
        mode: "block",
        typeLabel: "Patch",
        collapsedPreviewKey: "agent.tool.applyPatch",
        component: markRaw(AgentApplyPatchBubble),
    },
    run_workflow: {
        mode: "block",
        typeLabel: "Workflow",
        collapsedPreview: "多 Agent workflow 运行详情",
        component: markRaw(AgentWorkflowBubble),
    },
    task_create: {
        mode: "message",
        typeLabel: "Checklist",
        collapsedPreviewKey: "agent.tool.taskList",
        component: markRaw(AgentTaskBubble),
    },
    task_set_status: {
        mode: "message",
        typeLabel: "Checklist",
        collapsedPreviewKey: "agent.tool.taskStatusUpdate",
        component: markRaw(AgentTaskBubble),
    },
};

/**
 * 根据 tool 名字返回前端渲染配置。
 */
export const resolveToolRenderConfig = (toolCall: AgentToolCall): AgentToolRenderConfig => {
    return TOOL_RENDER_REGISTRY[toolCall.name] ?? DEFAULT_TOOL_RENDER_CONFIG;
};

/**
 * 动态注册或覆盖工具气泡渲染配置。
 */
export const registerToolRenderConfig = (toolName: string, config: AgentToolRenderConfig): void => {
    TOOL_RENDER_REGISTRY[toolName] = config;
};
