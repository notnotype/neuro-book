/**
 * 任务中心的三个工具（docs/specs/agent/jobs.md）：`wait`、`kill`、`jobs`。只管调用它的会话自己启动的任务。
 */

import type {Clock, JsonValue, ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";
import {failed} from "@notnotype/nb-harness/kit/files";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

import {TOOLS_POINT} from "../../shared/points";
import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";
import {isLive, type Job, type JobCenter, type WaitOutcome} from "./center";
import {watchSteer} from "./steer";

export const WAIT_TOOL = "nbook.agent.wait";
export const KILL_TOOL = "nbook.agent.kill";
export const JOBS_TOOL = "nbook.agent.jobs";

/** `wait` 缺省与至多等的秒数（t14 第 52 条，同 omp 的上限）。 */
export const WAIT_TIMEOUT_SECONDS = 1_800;

export const waitDeclaration: AgentToolDeclaration = {
    description: "等后台任务（后台命令、子代理的运行）：返回最先结束的一个；子代理有提问交给你、或用户插话时提前返回。后台任务结束时回执会自动送来，只在接下来的事要等它时用，不要轮询。",
    parameters: {
        type: "object",
        properties: {
            jobs: {type: "array", items: {type: "string"}, description: "要等的任务 id；不写就等你启动的全部后台任务"},
            timeout: {type: "integer", minimum: 1, maximum: WAIT_TIMEOUT_SECONDS, description: `最多等几秒，缺省 ${String(WAIT_TIMEOUT_SECONDS)}`},
        },
    },
    version: "1",
    concurrency: "shared",
    effect: "read",
};

export const killDeclaration: AgentToolDeclaration = {
    description: "停掉一个你启动的任务。停掉子代理的运行不删除子会话，之后还能用 agent_send 发话。",
    parameters: {type: "object", properties: {job: {type: "string", description: "任务 id"}}, required: ["job"]},
    version: "1",
    concurrency: "exclusive",
    effect: "read",
};

export const jobsDeclaration: AgentToolDeclaration = {
    description: "列出你启动的任务：id、种类、状态、开始时间、一行摘要。",
    parameters: {type: "object", properties: {}},
    version: "1",
    concurrency: "shared",
    effect: "read",
};

/** 给模型的名字就是工具名；界面按 id 显式映射（别的插件的 `x.wait` 不会被当成它）。 */
export const JOB_TOOL_CONTRIBUTIONS: ReadonlyArray<ContributionDeclaration<AgentToolDeclaration>> = [
    {capability: TOOLS_POINT, id: WAIT_TOOL, declaration: {...waitDeclaration, providerName: "wait"}},
    {capability: TOOLS_POINT, id: KILL_TOOL, declaration: {...killDeclaration, providerName: "kill"}},
    {capability: TOOLS_POINT, id: JOBS_TOOL, declaration: {...jobsDeclaration, providerName: "jobs"}},
];

const STATE_TEXT: Readonly<Record<Job["state"], string>> = {
    starting: "正在启动", running: "运行中", question: "在问你", completed: "完成", failed: "失败", aborted: "已停止", interrupted: "已中断",
};

/** `wait` 与 `jobs` 的 `details` 里一项（jobs.md 的“边界与兼容”）：界面按 `runId`、`jobId` 从它取终态。 */
export function jobDetails(job: Job): JsonValue {
    return {
        jobId: job.id,
        kind: job.kind,
        invocation: job.invocation,
        state: job.state,
        ...(job.target === undefined ? {} : {sessionId: job.target.sessionId, runId: job.target.runId}),
        ...(job.outcome?.line === undefined ? {} : {line: job.outcome.line}),
        ...(job.outcome?.exitCode === undefined ? {} : {exitCode: job.outcome.exitCode}),
        ...(job.outcome?.lines === undefined ? {} : {lines: job.outcome.lines}),
    };
}

function jobLine(job: Job, now: number): string {
    const seconds = Math.max(0, Math.round(((job.endedAt ?? now) - job.startedAt) / 1000));
    return `${job.id}（${job.label}：${job.summary}）${STATE_TEXT[job.state]}，${String(seconds)} 秒${job.waiters > 0 ? "，前台在等" : ""}`;
}

async function waitResult(outcome: WaitOutcome, timeoutSeconds: number, now: number): Promise<ToolResult> {
    switch (outcome.kind) {
        case "failed":
            if (outcome.code === "no-jobs") return failed("no-jobs", "没有可等的任务：你启动的任务都已结束，回执都已经交给你了。");
            if (outcome.code === "job-foreground") return failed("job-foreground", `${outcome.job ?? ""} 正被你的另一个调用等着，它会交回结果，不用再等。`);
            return failed("job-unknown", `没有 ${outcome.job ?? ""} 这个任务：不是你启动的、不存在，或结果已经取过。用 jobs 看还有哪些。`);
        case "ready": {
            const {job, others} = outcome;
            // 这件的回执此前经提醒送来过（jobs.md 的回执）：已在对话里的不再给一次；写入结果未知的也不给，免得交两次。
            const head = outcome.inContext === "yes"
                ? `${job.id}（${job.label}：${job.summary}）的回执已经在对话里（作为提醒送来过），不用再取。`
                : outcome.inContext === "maybe"
                    ? `${job.id}（${job.label}：${job.summary}）的回执可能已经在对话里（送出时结果未知），系统会核对，不用再取。`
                    : isLive(job.state) && job.question !== undefined
                        ? `${job.id}（${job.label}：${job.summary}）在问你（提问 ${job.question.id}）：${job.question.text}\n用 agent_answer 回答。`
                        : await job.final ?? `${job.id}：${STATE_TEXT[job.state]}`;
            const rest = others.length === 0 ? "" : `\n\n其余任务：\n${others.map((other) => jobLine(other, now)).join("\n")}`;
            return {text: `${head}${rest}`, details: {jobs: [jobDetails(job), ...others.map(jobDetails)]}};
        }
        case "timeout":
            return {text: `等了 ${String(timeoutSeconds)} 秒还没有结果，任务都还在：\n${outcome.jobs.map((job) => jobLine(job, now)).join("\n")}`, details: {jobs: outcome.jobs.map(jobDetails)}};
        case "interrupted":
            return {text: `用户插话了，先处理用户的话。任务照常在跑：\n${outcome.jobs.map((job) => jobLine(job, now)).join("\n")}`, details: {jobs: outcome.jobs.map(jobDetails)}};
        case "aborted":
            return {text: "等待被中止，任务照常在跑。", details: {jobs: outcome.jobs.map(jobDetails)}};
    }
}

export function jobTools(center: JobCenter, table: SessionTable, clock: Clock, report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void): Readonly<Record<string, AgentToolImplementation>> {
    return {
        [WAIT_TOOL]: {create: () => ({execute: async (args, context) => {
            const timeoutSeconds = typeof args.timeout === "number" ? args.timeout : WAIT_TIMEOUT_SECONDS;
            const ids = Array.isArray(args.jobs) ? args.jobs.filter((id): id is string => typeof id === "string") : undefined;
            const watch = await watchSteer(table, context.sessionId, (error) => report("steer-watch-failed", `reading session ${context.sessionId} after a release threw`, {session: context.sessionId, message: error instanceof Error ? error.message : String(error)}));
            try {
                const outcome = await center.wait(context.sessionId, {...(ids === undefined ? {} : {ids}), timeoutMs: timeoutSeconds * 1000, signal: context.signal, interrupted: watch.arrived});
                return await waitResult(outcome, timeoutSeconds, clock.now());
            } finally {
                watch.release();
            }
        }})},
        [KILL_TOOL]: {create: () => ({execute: async (args, context) => {
            const id = typeof args.job === "string" ? args.job : "";
            const killed = await center.kill(context.sessionId, id);
            if (killed === "job-unknown") return failed("job-unknown", `没有 ${id} 这个任务：不是你启动的、不存在，或结果已经取过。`);
            if (typeof killed === "object") return failed("stop-failed", `没能停下 ${id}（${killed.code}），它可能还在跑：用 jobs 看它的状态，必要时再停。`);
            return {text: killed === "killed" ? `已停止 ${id}。` : `${id} 已经结束了。`, details: {jobId: id, outcome: killed}};
        }})},
        [JOBS_TOOL]: {create: () => ({execute: async (_args, context) => {
            const jobs = center.list(context.sessionId);
            const now = clock.now();
            return {text: jobs.length === 0 ? "没有你启动的任务。" : jobs.map((job) => jobLine(job, now)).join("\n"), details: {jobs: jobs.map(jobDetails)}};
        }})},
    };
}
