/** 子代理卡片、后台命令卡片与子代理入口的 Lab 样本（w00032 t14、t36）：各场景的调用、后代进度、任务与收口结果。 */

import type {AgentConversationContext, ToolCallView} from "@notnotype/nb-agent-ui";
import {createAgentContext} from "@notnotype/nb-agent-ui";
import {ref, shallowRef} from "vue";

import type {RunResult} from "@notnotype/nb-harness/kernel/contracts";

import type {ProfileEntry} from "nbook/plugins/agent/shared/contracts";
import type {CommandStatus, JobItem, TreeItem} from "nbook/plugins/agent/shared/subagents";
import type {SubagentStore} from "nbook/plugins/agent/web/subagent-store";

const NOW = 200_000;
const spawn = (extra: Partial<ToolCallView> = {}): ToolCallView => ({id: "c1", name: "agent_spawn", status: "running", args: {profile: "nbook.agent.adhoc", prompt: "查第三章的称谓有没有前后不一致", name: "称谓检查"}, invocation: "inv-1", ...extra});
const child = (extra: Partial<TreeItem> = {}): TreeItem => ({id: "child", parent: "p", callId: "c1", invocation: "inv-1", forked: false, profile: "nbook.agent.adhoc", name: "称谓检查", profileIcon: "i-lucide-book-check", state: "idle", runs: [], ...extra});
const done = (status: string, line: string, text: string): ToolCallView => spawn({status: "success", result: {text, truncated: false, details: {sessionId: "child", runId: "r1", status, line}}});

export type CardSample = {readonly call: ToolCallView; readonly tree: readonly TreeItem[]; readonly jobs?: readonly JobItem[]; readonly idle?: boolean; readonly status?: CommandStatus | null; readonly tail?: string};

export const CARD_SAMPLES: Readonly<Record<string, CardSample>> = {
    running: {call: spawn(), tree: [child({state: "running", runId: "r1", runInvocation: "inv-1", tools: 7, startedAt: NOW - 134_000, step: {tool: "nbook.agent.read", target: "project://正文/第二章 雨夜与药铺的旧账.md"}})]},
    question: {call: spawn(), tree: [child({state: "question", runId: "r1", runInvocation: "inv-1", tools: 2, startedAt: NOW - 30_000, question: {id: "q", text: "第三章里“周叔”和“周伯”是同一个人吗？"}})]},
    waiting: {call: spawn(), tree: [child({state: "waiting", runId: "r1", runInvocation: "inv-1", tools: 4, startedAt: NOW - 61_000, pending: [{id: "p1", kind: "approval", callId: "x", request: {tool: "nbook.agent.write", args: {path: "project://正文/第四章.md"}}}]})]},
    done: {call: done("completed", "找到 4 处称谓前后不一致。", "找到 4 处称谓前后不一致。\n\n1. 第 12 段“周叔”，第 40 段“周伯”。\n2. ……"), tree: [child()], idle: true},
    failed: {call: done("failed", "模型请求超时", "错误：network（timeout）"), tree: [child()], idle: true},
    "dispatch-failed": {call: spawn({status: "error", result: {text: "profile-not-allowed: …", truncated: false, details: {code: "profile-not-allowed"}}}), tree: [], idle: true},
    background: {call: spawn({status: "success", args: {profile: "nbook.agent.adhoc", prompt: "把第三章所有对白里的称谓统一成第一章的叫法，改完列出改了哪几处，一个名字很长的子代理"}, result: {text: "还在跑", truncated: false, details: {sessionId: "child", runId: "r1", status: "running"}}}), tree: [child({name: null, state: "running", runId: "r1", runInvocation: "inv-1", tools: 12, startedAt: NOW - 400_000, step: {tool: "nbook.agent.edit-replace", target: "project://正文/第三章.md"}})]},
    unknown: {call: spawn({status: "success", result: {text: "还在跑", truncated: false, details: {sessionId: "child", runId: "r1", status: "running"}}}), tree: [child()], idle: true},
};

const shell = (extra: Partial<ToolCallView> = {}): ToolCallView => ({id: "s1", name: "shell", status: "success", args: {command: "bun run build:epub -- --book 雨夜", async: true}, invocation: "inv-s", result: {text: "已转到后台", truncated: false, details: {jobId: "job-0000000003a1", output: "sessions://s/home/jobs/job-0000000003a1/output.log"}}, ...extra});
const job = (extra: Partial<JobItem>): JobItem => ({id: "job-0000000003a1", kind: "shell", state: "running", summary: "bun run build:epub", invocation: "inv-s", foreground: false, startedAt: NOW - 134_000, ...extra});
const TAIL = Array.from({length: 14}, (_, index) => `[${String(29 + index)}/96] 排版 第${["三", "四", "五"][index % 3]!}章`).join("\n");

export const COMMAND_SAMPLES: Readonly<Record<string, CardSample>> = {
    running: {call: shell(), tree: [], jobs: [job({lastLine: "[42/96] 排版 第五章 雨夜"})], tail: TAIL},
    done: {call: shell(), tree: [], jobs: [job({state: "completed", endedAt: NOW - 20_000, exitCode: 0, lines: 412})], tail: TAIL},
    failed: {call: shell(), tree: [], jobs: [job({state: "failed", endedAt: NOW - 20_000, exitCode: 2, lines: 18})], tail: "error: 第七章缺封面"},
    restarted: {call: shell(), tree: [], jobs: [], status: {state: "interrupted", exitCode: null, lines: 96, bytes: 4096, truncated: false, timedOut: false, endedAt: NOW}},
};

/** 一个场景的卡片数据：样本里的后代与任务，`now` 停在固定时刻；输出与状态按样本交回。 */
export function sampleStore(sample: CardSample): SubagentStore {
    return {
        data: shallowRef({sessionId: "p", tree: new Map(sample.tree.map((item) => [item.id, item])), jobs: new Map((sample.jobs ?? []).map((item) => [item.id, item]))}),
        now: ref(NOW),
        tail: async () => (sample.tail === undefined ? null : {lines: sample.tail.split("\n"), status: sample.status ?? null}),
        status: async () => sample.status ?? null,
        kill: async () => undefined,
        stopRun: async () => undefined,
        runResult: async () => null,
    };
}

export function sampleContext(sample: CardSample): AgentConversationContext {
    return createAgentContext({run: {status: sample.idle === true ? "idle" : "running"}, now: NOW, messages: [{kind: "assistant", id: "a", timestamp: 1, status: "done", text: "", thinking: "", model: "m", toolCalls: [sample.call], contentOmitted: false}]});
}

/** 场景的输入：卡片的属性（调用与 ctx）；后代与任务另经 `sampleStore` 注入。 */
export function sampleProps(sample: CardSample): {call: ToolCallView; ctx: AgentConversationContext} {
    return {call: sample.call, ctx: sampleContext(sample)};
}

/** 子代理入口与浮层（SubagentsEntry）的样本：等你批准、在跑（带孙代理）、完成、出错。 */
export const ENTRY_NOW = 2_000_000;
export const ENTRY_PROFILES: ProfileEntry[] = [
    {key: "lab.naming", name: "称谓检查", description: "", source: "lab", status: "ok", icon: "i-lucide-spell-check"},
    {key: "lab.research", name: "资料检索", description: "", source: "lab", status: "ok", icon: "i-lucide-search"},
    {key: "lab.typo", name: "错别字", description: "", source: "lab", status: "ok", icon: "i-lucide-book-open-check"},
    {key: "lab.outline", name: "细纲", description: "", source: "lab", status: "ok", icon: "i-lucide-git-merge"},
];
const entryChild = (id: string, parent: string, profile: string, name: string, patch: Partial<TreeItem>): TreeItem => ({
    id, parent, callId: null, invocation: null, forked: false, profile, name, state: "idle", runs: [],
    profileIcon: ENTRY_PROFILES.find((entry) => entry.key === profile)?.icon ?? "i-lucide-bot", ...patch,
});
export const ENTRY_TREE: readonly TreeItem[] = [
    entryChild("a", "p", "lab.naming", "第二至五章的称谓是否前后一致", {state: "waiting", pending: [{id: "p1", kind: "approval", callId: "x", request: {tool: "nbook.agent.write"}}]}),
    entryChild("b", "p", "lab.research", "查 1920 年代上海的电车线路", {state: "running", tools: 7, startedAt: ENTRY_NOW - 134_000, step: {tool: "nbook.agent.read", target: "project://资料/电车.md"}}),
    entryChild("c", "b", "lab.research", "核对电车站名", {state: "running", tools: 3, startedAt: ENTRY_NOW - 41_000}),
    entryChild("d", "p", "lab.typo", "查第五章的错别字", {runs: [{runId: "r1", reason: "completed", endedAt: ENTRY_NOW - 60_000}]}),
    entryChild("e", "p", "lab.outline", "第三幕高潮的细纲", {runs: [{runId: "r1", reason: "error", endedAt: ENTRY_NOW - 10_000}]}),
];
export const ENTRY_RESULTS: Readonly<Record<string, RunResult>> = {
    d: {runId: "r1", reason: "completed", stopReason: "stop", text: "找到 2 处错别字：第 12 段“在”写成了“再”。\n\n……", result: null, error: null, usage: {} as never, entries: {first: 1, last: 9}},
    e: {runId: "r1", reason: "error", stopReason: "error", text: "", result: null, error: {kind: "provider"}, usage: {} as never, entries: {first: 1, last: 3}},
};
