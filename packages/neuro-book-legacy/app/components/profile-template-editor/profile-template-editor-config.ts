import type {
    ComponentLibraryGroup,
    ComponentLibraryItem,
    SelectOption,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import {DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";

export const componentLibrary: ComponentLibraryItem[] = [
    {type: "System", label: "System", description: "Provider 级系统提示词。只进入 systemPrompt，不写入 session。", iconClass: "i-lucide-terminal-square", group: "sets"},
    {type: "HistorySet", label: "HistorySet", description: "长期记忆集合。适合放会话历史、用户偏好、项目背景等需要进入长期历史的上下文。", iconClass: "i-lucide-archive", group: "sets"},
    {type: "ModelContext", label: "ModelContext", description: "本轮模型上下文集合。普通消息只影响当前模型调用；内部 Reminder 会按 AppendingSet 语义写入 session。", iconClass: "i-lucide-panel-top", group: "sets"},
    {type: "AppendingSet", label: "AppendingSet", description: "本轮可见追加集合。会在 ReAct 前写入 session，是用户层唯一追加通道。", iconClass: "i-lucide-panel-bottom", group: "sets"},
    {type: "Compaction", label: "Compaction", description: "上下文压缩策略。只能放在 ProfilePrompt 顶层，可设置触发阈值、recent 保留和压缩提示词。", iconClass: "i-lucide-archive-restore", group: "sets"},
    {type: "CompactionPrompt", label: "CompactionPrompt", description: "压缩摘要调用使用的 provider systemPrompt。只能放在 Compaction 内。", iconClass: "i-lucide-file-text", group: "sets"},
    {type: "CompactionSummaryPrefix", label: "CompactionSummaryPrefix", description: "摘要写入 session 后注入后续上下文的前缀。只能放在 Compaction 内。", iconClass: "i-lucide-text-quote", group: "sets"},
    {type: "Message", label: "Message", description: "用户消息节点。system role 已禁用，provider 系统提示请使用 System。", iconClass: "i-lucide-message-square", group: "messages"},
    {type: "AIMessage", label: "AIMessage", description: "Assistant 消息节点。用于在预览中表达模型回复，可包含 ToolCall 子节点，适合调试工具调用结构。", iconClass: "i-lucide-sparkles", group: "messages"},
    {type: "ToolCall", label: "ToolCall", description: "工具调用节点。必须放在 AIMessage 内，包含工具名与 JSON 参数，用于预览 assistant tool calls。", iconClass: "i-lucide-wrench", group: "messages"},
    {type: "ToolResult", label: "ToolResult", description: "工具结果消息节点。必须跟随匹配的 ToolCall，用于表达示例工具返回。", iconClass: "i-lucide-check-circle", group: "messages"},
    {type: "Reminder", label: "Reminder", description: "提醒节点。用于注入可恢复的提醒内容，适合周期检查、延迟任务和状态回看。", iconClass: "i-lucide-bell-ring", group: "flow"},
    {type: "Watch", label: "Watch", description: "监听节点。观察指定变量或路径的变化，并在变化时补充上下文说明。", iconClass: "i-lucide-eye", group: "flow"},
    {type: "If", label: "If", description: "条件分支容器。只有 condition 成立时才渲染子节点，适合做模式开关和运行时分支。", iconClass: "i-lucide-git-branch", group: "flow"},
    {type: "SystemReminder", label: "SystemReminder", description: "通用系统提醒片段。自动包裹 <system-reminder>，适合放在 Message 内。", iconClass: "i-lucide-badge-alert", group: "privileged"},
    {type: "LinkedAgentsSummary", label: "LinkedAgentsSummary", description: "已关联 agent 摘要，可嵌入消息或提醒。", iconClass: "i-lucide-git-merge", group: "privileged"},
    {type: "LinkedAgentsReminder", label: "LinkedAgentsReminder", description: "已关联 agent 变化提醒。适合放在 AppendingSet。", iconClass: "i-lucide-network", group: "privileged"},
    {type: "WorkspaceFocusReminder", label: "WorkspaceFocusReminder", description: "文件范围与工作区焦点提醒。说明当前 Project Workspace、相对/绝对路径合同和选中文件。适合放在 AppendingSet。", iconClass: "i-lucide-folder-kanban", group: "privileged"},
    {type: "ModeAvailabilityReminder", label: "ModeAvailabilityReminder", description: "normal 模式下的 switch_mode 可用性提醒。适合放在 AppendingSet。", iconClass: "i-lucide-clipboard-plus", group: "privileged"},
    {type: "TaskReminder", label: "TaskReminder", description: "任务清单提醒。默认读取 agent.tasks 并提示更新 task_set_status。", iconClass: "i-lucide-list-checks", group: "privileged"},
    {type: "ModeReminder", label: "ModeReminder", description: "Agent 模式生命周期提醒。可放入 ModeSlot 插槽覆盖各阶段默认文案。", iconClass: "i-lucide-clipboard-check", group: "privileged"},
    {type: "FileChangeNotice", label: "FileChangeNotice", description: "按当前 session 未见文件变更生成提醒。只能直接放在 AppendingSet；mode 支持 off/minimal/full，单文件 diff 上限由 Profile 通用运行设置控制。", iconClass: "i-lucide-file-diff", group: "privileged"},
    {type: "ModeSlot", label: "ModeSlot", description: "模式文案插槽。kind 取 plan_enter/plan_reentry/plan_steady/discuss_enter/discuss_steady/exit_from_plan/exit_plain，只能放在 ModeReminder 内。", iconClass: "i-lucide-file-text", group: "privileged"},
    {type: "MentionedSkillsReminder", label: "MentionedSkillsReminder", description: "用户输入显式 $skill 时的激活提醒。", iconClass: "i-lucide-at-sign", group: "privileged"},
    {type: "ActivatedSkills", label: "ActivatedSkills", description: "激活技能内容。把本轮启用的 skill 文本注入 prompt，通常由运行时维护。", iconClass: "i-lucide-sparkles", group: "privileged"},
    {type: "AgentCatalog", label: "AgentCatalog", description: "Agent 目录索引。展示可创建/调用的 profile 基础信息，详情用 get_agent_profile 查询。", iconClass: "i-lucide-bot", group: "privileged"},
    {type: "SkillCatalog", label: "SkillCatalog", description: "技能目录节点。展示可用 skill 列表，帮助模型理解当前可调用的工作流能力。", iconClass: "i-lucide-library", group: "privileged"},
    {type: "WorkflowCatalog", label: "WorkflowCatalog", description: "Workflow 目录节点。展示可通过 run_workflow 运行的 workflow 索引与使用纪律。", iconClass: "i-lucide-workflow", group: "privileged"},
    {type: "SqlSchemaSummary", label: "SqlSchemaSummary", description: "SQL schema 摘要节点。注入当前数据库业务表与字段提示，辅助 execute_sql。", iconClass: "i-lucide-database", group: "privileged"},
    {type: "Import", label: "Import", description: "共享文本导入节点。显式加载 AGENTS.md、reference/ 或 docs/ 中的稳定上下文。", iconClass: "i-lucide-file-input", group: "privileged"},
];

export const groupLabels: Record<ComponentLibraryGroup, string> = {
    all: "全部",
    sets: "集合",
    messages: "消息",
    flow: "流程控制",
    privileged: "特权节点",
};

export const inspectorTabs: Array<{value: "source" | "props" | "variables" | "runtime" | "agent"; label: string}> = [
    {value: "source", label: "源码"},
    {value: "props", label: "属性面板"},
    {value: "variables", label: "变量面板"},
    {value: "runtime", label: "运行时变量"},
    {value: "agent", label: "Agent"},
];

export const componentGroupTabs: Array<{value: ComponentLibraryGroup; label: string}> = [
    {value: "all", label: "全部"},
    {value: "messages", label: "消息"},
    {value: "sets", label: "集合"},
    {value: "flow", label: "流程控制"},
    {value: "privileged", label: "工具"},
];

export const roleOptions: SelectOption[] = [
    {value: "user", label: "user"},
];

export const toolStatusOptions: SelectOption[] = [
    {value: "drafting", label: "drafting"},
    {value: "running", label: "running"},
    {value: "success", label: "success"},
    {value: "error", label: "error"},
];

export const sourceOptions: SelectOption[] = [
    {value: "context", label: "context"},
    {value: "input", label: "input"},
];

export const sourceEditorPreferences = {
    ...DEFAULT_MONACO_EDITOR_PREFERENCES,
    fontSize: 12,
    lineHeight: 24,
    minimapEnabled: false,
    wordWrap: false,
};
