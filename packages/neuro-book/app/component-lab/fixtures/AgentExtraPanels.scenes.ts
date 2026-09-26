import type AgentSystemPromptPanel from "../../components/novel-ide/agent/panels/system-prompt/AgentSystemPromptPanel.vue";
import type AgentLinkedAgentPanel from "../../components/novel-ide/agent/panels/linked-agents/AgentLinkedAgentPanel.vue";
import type WorkbenchCommandPalette from "../../components/workbench/WorkbenchCommandPalette.vue";
import type WorkbenchViewInstances from "../../components/workbench/WorkbenchViewInstances.vue";
import type {AgentLinkedSessionDto} from "nbook/shared/dto/agent-session.dto";
import type {LabFixtureDefinition} from "./index";

export const sampleSystemPrompt = `## 角色定义

你是一位专业的小说写作助手，擅长长篇小说创作。你将帮助用户进行：

- **情节构思**：根据用户设定的世界观和角色，推进故事发展
- **文风校准**：保持与用户既有章节一致的叙述风格
- **角色刻画**：确保角色行为与性格设定一致

## 约束

1. 不主动改变已确认的角色设定
2. 每次输出控制在 2000 字以内
3. 涉及敏感话题时主动提醒用户

## 引用

- \`workspace://characters/林渊.md\`
- \`workspace://world/青云宗.md\``;

export const agentSystemPromptPanelScenes = [
    {id: "expanded", label: "展开状态（Markdown 渲染）", input: {props: {value: sampleSystemPrompt, loading: false}, model: {modelValue: true}}},
    {id: "loading", label: "加载中", input: {props: {value: null, loading: true}, model: {modelValue: true}}},
    {id: "error", label: "加载失败", input: {props: {value: null, loading: false, error: "加载 System Prompt 失败：网络请求超时，请检查后端服务连接"}, model: {modelValue: true}}},
    {id: "empty", label: "Prompt 为空", input: {props: {value: "", loading: false}, model: {modelValue: true}}},
] satisfies LabFixtureDefinition<typeof AgentSystemPromptPanel>["scenes"];

export const ownedLinkedAgents = [
    {sessionId: 201, sessionIdentity: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", title: "第一章初稿撰写", profileKey: "writer", status: "running", updatedAt: 1750000000000, archived: false},
    {sessionId: 202, sessionIdentity: "b2c3d4e5-f6a7-8901-bcde-f12345678901", title: "角色资料检索", profileKey: "retrieval", status: "idle", updatedAt: 1749999760000, archived: false},
    {sessionId: 203, sessionIdentity: "c3d4e5f6-a7b8-9012-cdef-123456789012", title: "世界观素材整理", profileKey: "leader.assets", status: "waiting", updatedAt: 1749999880000, archived: false, profileAvailability: "unloadable", profileIssueMessage: "assets profile 需要更新配置文件"},
] satisfies AgentLinkedSessionDto[];

export const linkedByAgents = [
    {sessionId: 100, sessionIdentity: "d4e5f6a7-b8c9-0123-defa-234567890123", title: "主线调度 Session", profileKey: "leader.default", status: "idle", updatedAt: 1749999580000, archived: false},
] satisfies AgentLinkedSessionDto[];

export const agentLinkedAgentPanelScenes = [
    {id: "populated", label: "有关联 Agent", input: {props: {sessionId: 101, ownedAgents: ownedLinkedAgents, linkedByAgents, loading: false}}},
    {id: "empty", label: "无关联 Agent", input: {props: {sessionId: 101, ownedAgents: [], linkedByAgents: [], loading: false}}},
    {id: "loading", label: "加载中", input: {props: {sessionId: 101, ownedAgents: ownedLinkedAgents, linkedByAgents, loading: true}}},
] satisfies LabFixtureDefinition<typeof AgentLinkedAgentPanel>["scenes"];

export const workbenchCommandPaletteScenes = [
    {id: "command-navigation", label: "命令与行号导航"},
    {id: "readonly", label: "只读文档"},
    {id: "commands-unavailable", label: "无活动编辑器"},
] satisfies LabFixtureDefinition<typeof WorkbenchCommandPalette>["scenes"];

const view = {
    id: "lab.instances.demo", titleKey: "lab.instances.demo", icon: "i-lucide-square",
    container: "lab.container.left", layout: "fill", order: 10, weight: 1,
    canToggleVisibility: false, canMoveView: false, factoryKey: "lab.view.instances", stateScope: "user",
} as const;

const instanceEntry = {
    view, title: "实例演示视图", containerId: "lab.container.left", order: 10,
    source: "default", visible: true, visibilityReasons: [], actionable: true, authorityReasons: [],
} as const;

export const workbenchViewInstancesScenes = [
    {id: "default", label: "实例落在左栏（可搬容器、可设不可见）", input: {props: {views: [instanceEntry]}}},
    {id: "moved", label: "搬到面板：同一实例不重挂", input: {props: {views: [instanceEntry]}}},
    {id: "hidden", label: "不可见的视图不渲染实例", input: {props: {views: [{...instanceEntry, visible: false, visibilityReasons: ["Lab 场景把这条视图设为不可见：实例被释放，落点不留空盒"]}]}}},
] satisfies LabFixtureDefinition<typeof WorkbenchViewInstances>["scenes"];
