/**
 * 向导与状态栏单独挂的场景（docs/specs/agent/conversation.md 输出 10–15）。放进整个视图的样子见 `view.scenes.ts`。
 */
import {createAgentContext} from "@notnotype/nb-agent-ui";
import type {CompactionView, PendingApprovalView, PendingModeSwitchView, PendingQuestionsView} from "@notnotype/nb-agent-ui";
import type {AgentApprovalWizard, AgentCompactionDetail, AgentModeSwitchWizard, AgentQuestionWizard, AgentStatusBar, AgentWizard, AgentWizardFrame} from "@notnotype/nb-agent-ui/lab";

import type {LabFixtureDefinition} from "../index";

const EMPTY = {collapsed: false, step: 0, approvals: {}, notes: {}, answers: {}};
const approval: PendingApprovalView = {kind: "approval", id: "a", toolCallId: "c-a", tool: "edit", args: {path: "project://正文/第三章.md"}, preview: {state: "ready", files: [{address: "project://正文/第三章.md", kind: "diff", before: "他没有回头。", after: "他回头看了一眼。"}]}};
const shell: PendingApprovalView = {kind: "approval", id: "s", toolCallId: "c-s", tool: "shell", args: {command: "wc -m 正文/第三章.md", timeout: 120}, preview: {state: "ready", files: []}};
const questions: PendingQuestionsView = {kind: "question", id: "q", toolCallId: "c-q", questions: [{question: "这章用什么视角？", options: [{label: "第一人称"}, {label: "第三人称"}]}, {question: "回收哪些伏笔？", multiSelect: true, options: [{label: "钟声"}, {label: "父亲的表"}]}]};

export const agentWizardScenes: LabFixtureDefinition<typeof AgentWizard>["scenes"] = [
    {id: "approval", label: "审批一批", input: {props: {pending: [approval, shell]}}},
    {id: "question", label: "提问", input: {props: {pending: [questions]}}},
    {id: "collapsed", label: "收起", input: {props: {pending: [approval, shell], state: {...EMPTY, collapsed: true}}}},
];

export const agentWizardFrameScenes: LabFixtureDefinition<typeof AgentWizardFrame>["scenes"] = [
    {id: "plain", label: "标题、内容与按钮", input: {props: {icon: "i-lucide-shield-question", title: "修改文件", detail: "project://正文/第三章.md", count: "第 1 / 3 个"}, slots: {default: true, foot: true}}},
];

export const agentApprovalWizardScenes: LabFixtureDefinition<typeof AgentApprovalWizard>["scenes"] = [
    {id: "one", label: "一个", input: {props: {items: [approval]}, model: {state: EMPTY}}},
    {id: "batch", label: "一批", input: {props: {items: [approval, shell]}, model: {state: {...EMPTY, approvals: {a: {decision: "allow"}}, step: 1}}}},
];

export const agentQuestionWizardScenes: LabFixtureDefinition<typeof AgentQuestionWizard>["scenes"] = [
    {id: "first", label: "第 1 题", input: {props: {item: questions}, model: {state: EMPTY}}},
];

const approvalChoice = {
    value: "ask",
    options: [
        {key: "ask", label: "每次询问", description: "除读取外，每次调用都需要批准", icon: "i-lucide-shield-question"},
        {key: "allow-writes", label: "放行写入", description: "修改文件无需批准，运行命令仍需批准", icon: "i-lucide-pencil"},
        {key: "auto", label: "自动判断", description: "执行命令先交审批模型判断，判不了再问你", icon: "i-lucide-bot"},
    ],
};
const exitPlan: PendingModeSwitchView = {kind: "mode-switch", id: "m", toolCallId: "c-m", fromLabel: "计划", toLabel: "普通", plan: "# 改第三章\n\n1. 压缩雨夜的回忆\n2. 把巷口那段前移", approval: approvalChoice};

export const agentModeSwitchWizardScenes: LabFixtureDefinition<typeof AgentModeSwitchWizard>["scenes"] = [
    {id: "exit-plan", label: "退出计划，带计划正文", input: {props: {item: exitPlan}, model: {state: EMPTY}}},
    {id: "no-plan", label: "切换模式，没有计划", input: {props: {item: {kind: "mode-switch", id: "m", toolCallId: "c-m", fromLabel: "普通", toLabel: "讨论", approval: approvalChoice}}, model: {state: EMPTY}}},
];

const compacted: CompactionView = {method: "nbook.agent.summary", tokensBefore: 96_000, tokensAfter: 8_200, model: {name: "deepseek/deepseek-flash", input: 90_000, output: 1_200, cacheRead: 0, cacheWrite: 0, cost: 0.03}, require: ["保留人物关系"], restored: [{kind: "file", target: "project://正文/第三章.md", tokens: 2_100, truncated: false}], omitted: 14, keptTurns: 3};

export const agentCompactionDetailScenes: LabFixtureDefinition<typeof AgentCompactionDetail>["scenes"] = [
    {id: "summary", label: "摘要：调了模型，放回文件", input: {props: {detail: compacted, currency: "USD"}}},
    {id: "shake", label: "清理：没调模型", input: {props: {detail: {...compacted, method: "nbook.agent.shake", model: null, require: [], restored: [], keptTurns: null}, currency: "USD"}}},
];

const usage = {contextTokens: 16_300, contextLimit: 128_000, totalTokens: 162_400, input: 101_200, output: 3_100, cacheRead: 58_100, cacheWrite: 0, cacheHitRate: 0.62, cost: 0.07, currency: "USD" as const};

export const agentStatusBarScenes: LabFixtureDefinition<typeof AgentStatusBar>["scenes"] = [
    {id: "idle", label: "空闲", input: {props: {ctx: createAgentContext({usage})}}},
    {id: "running", label: "运行中", input: {props: {ctx: createAgentContext({usage, now: 72_000, run: {status: "running", phase: "生成中", startedAt: 0}})}}},
    {id: "warned", label: "超过告警线", input: {props: {ctx: createAgentContext({usage: {...usage, cost: 1.02, costState: "warned"}})}}},
];
