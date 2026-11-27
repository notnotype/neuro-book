/**
 * 对话视图的三个零件单独摆（docs/specs/ui/agent-conversation-view.md 的“顶栏”“消息”“输入框与待处理区”）：顶栏、第一屏与提示卡。
 * 在视图里的样子见 `view.scenes.ts` 的 `no-session`、`child-session`、`welcome-*`、`model-notice-*`。
 */

import type {AgentConversationHead, AgentNoticeCard, AgentWelcome} from "@notnotype/nb-agent-ui/lab";

import type {LabFixtureDefinition} from "../define";
import {conversationContext} from "./data";
import {WELCOME_RECENT, WELCOME_STARTERS} from "./view.scenes";

const HEAD = {targets: null, newSession: true, hasSessions: true, draftProfile: null, pinned: [], overflowItems: [{id: "raw", label: "原始视图"}], closable: false};
const CLOSED = {sessionsOpen: false};

export const agentConversationHeadScenes: LabFixtureDefinition<typeof AgentConversationHead>["scenes"] = [
    {id: "session", label: "有会话：左边新建，中间标题开会话列表，右边更多", input: {props: {...HEAD, ctx: conversationContext()}, model: CLOSED}},
    {id: "closable", label: "放在可关的面板里：右列最后是关闭", input: {props: {...HEAD, newSession: false, hasSessions: false, closable: true, ctx: conversationContext()}, model: CLOSED}},
    {id: "no-session", label: "没选会话：写“新对话”，左右都空", input: {props: {...HEAD, ctx: conversationContext({session: null, messages: []}), draftProfile: {name: "主创", icon: "i-lucide-feather"}}, model: CLOSED}},
    {
        id: "child",
        label: "子会话：左边是返回，中间是子代理的图标与标题",
        input: {props: {...HEAD, ctx: conversationContext({session: {...conversationContext().session!, id: "child", title: "查第三章的称谓是否前后一致", profileName: "核对员", profileIcon: "i-lucide-spell-check", path: [{id: "root", title: "第三章节奏调整"}]}})}, model: CLOSED},
    },
];

export const agentWelcomeScenes: LabFixtureDefinition<typeof AgentWelcome>["scenes"] = [
    {id: "full", label: "最近对话与试试这些", input: {props: {welcome: {title: "NeuroBook 创作工作区", recent: WELCOME_RECENT, total: 12, starters: WELCOME_STARTERS}, now: Date.UTC(2026, 10, 16, 10, 0), canOpenSessions: true}}},
    {id: "starters", label: "第一次用：只有试试这些", input: {props: {welcome: {title: "NeuroBook 创作工作区", recent: [], total: 0, starters: WELCOME_STARTERS}, now: Date.UTC(2026, 10, 16, 10, 0), canOpenSessions: true}}},
    {id: "bare", label: "什么都没有：只写开始一段对话", input: {props: {welcome: {recent: [], total: 0, starters: []}, now: Date.UTC(2026, 10, 16, 10, 0), canOpenSessions: false}}},
];

export const agentNoticeCardScenes: LabFixtureDefinition<typeof AgentNoticeCard>["scenes"] = [
    {id: "role", label: "角色没绑定：去绑定", input: {props: {notice: {status: "profile-unavailable", title: "“写作”角色还没绑定模型", message: "主创用“写作”角色的模型对话。", icon: "i-lucide-link-2-off", actions: [{id: "bind-role", label: "去绑定"}]}}}},
    {id: "key", label: "没有密钥：设置密钥", input: {props: {notice: {status: "profile-unavailable", title: "DeepSeek 还没有设置密钥", message: "“写作”角色绑定的模型要用 DeepSeek 的密钥。", icon: "i-lucide-key-round", actions: [{id: "set-key", label: "设置密钥"}]}}}},
    {id: "provider", label: "一家服务商都没有：添加服务商", input: {props: {notice: {status: "profile-unavailable", title: "还没有可用的模型", message: "先添加一个服务商（DeepSeek、OpenAI、本机的 Ollama 都行），再回来对话。", icon: "i-lucide-plug-zap", actions: [{id: "add-provider", label: "添加服务商"}]}}}},
    {id: "plain", label: "别的原因：只有标题与打开设置", input: {props: {notice: {status: "profile-unavailable", title: "当前会话选择的模型不存在或不可用。", message: "", actions: [{id: "open-settings", label: "打开设置"}]}}}},
];
