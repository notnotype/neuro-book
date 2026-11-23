/**
 * 子代理运行与任务中心之间的那一段（docs/specs/agent/subagents.md 输出 6、7，jobs.md）：一个 `agent` 任务跟着子会话的一次运行，
 * 把子会话交给调用方的同步提问报成任务的 `question`，运行收口时报终态；结果文字等到交回时才从子会话的日志读。
 *
 * 跟踪不依赖有没有人在前台等：后台任务也要在提问、收口时让 `wait` 返回。跟踪期间持着子会话的订阅与 `waitRun`，子会话不会被空闲关闭；
 * 收口后放掉。插件停止时句柄表把子会话按 `interrupted` 关掉，`waitRun` 照常完成。
 */

import type {Issuer, LogEvent, SessionApi, ToolResult} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

import type {Job, JobCenter, JobQuestion} from "../jobs/center";
import {isLive} from "../jobs/center";
import {clip, isModeSwitch, lineOf, pendingOf, questionText, resultOf, STATUS_OF_REASON, type PendingItem} from "./result";

/** 把过长结果的全文存进父会话的 `artifacts/`，交回地址。 */
export type SaveFull = (text: string) => Promise<{readonly address: string} | {readonly problem: string}>;

export interface ChildRunsOptions {
    readonly table: SessionTable;
    readonly jobs: JobCenter;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

/** 交给调用方的同步提问：会话头 `questions: "caller"`、不是异步的、也不是只能由用户答的模式切换。 */
const forCaller = (item: PendingItem, questions: "caller" | "user"): boolean => questions === "caller" && item.kind === "question" && !item.async && !isModeSwitch(item);

/** 子会话里交给调用方、还没答的异步提问；随结果交回（输出 7、15）。 */
export async function asyncQuestionsOf(view: SessionApi): Promise<{readonly id: string; readonly text: string}[]> {
    const [snapshot, path] = await Promise.all([view.snapshot(), view.path()]);
    if (snapshot.header.questions !== "caller") return [];
    return pendingOf(path).filter((item) => item.kind === "question" && item.async && !isModeSwitch(item)).map((item) => ({id: item.id, text: questionText(item.request)}));
}

export class ChildRuns {
    /** 每个任务交回结果的办法：要用登记它的那次工具调用的 `artifacts/`。 */
    readonly #reports = new WeakMap<Job, () => Promise<ToolResult>>();

    constructor(private readonly options: ChildRunsOptions) {}

    /**
     * 任务开始跟着 `child` 的 `runId`。`ownRun`：这次运行是调用方自己开的（输出 16 的连带中止只认它）。之后 `kill` 停这次运行；
     * 子会话缓冲区里的话留着（`keepQueue`），停的人是父会话，或经远程停时的用户（jobs.md 输出 4、11）。
     */
    start(job: Job, child: string, runId: string, ownRun: boolean, save: SaveFull): void {
        const issuer: Issuer = {kind: "session", id: job.owner};
        const view = this.options.table.view(child, issuer);
        job.ownRun = ownRun;
        const report = () => this.#result(job, view, runId, save);
        this.#reports.set(job, report);
        this.options.jobs.start(job, {
            // 只停这个任务跟着的那次运行：用户在子会话里刚开的下一轮不受影响（runtime.md 输出 120）。
            kill: async (_reason, byUser) => {
                const stopper = byUser === true ? this.options.table.view(child) : view;
                const aborted = await stopper.abort({commandId: crypto.randomUUID(), keepQueue: true, runId});
                if (!aborted.ok) this.options.report("subagent-kill-failed", `could not abort the run of sub-agent session ${child}: ${aborted.code}`, {session: child, code: aborted.code});
                else if (!aborted.value.aborted) return "already-ended";
                return undefined;
            },
            result: async () => (await report()).text,
            saveFull: save,
        }, {sessionId: child, runId});
        void this.#follow(job, child, issuer, view, runId);
    }

    /** 收口了的任务交给模型的结果；还没收口时按它此刻的状态写。 */
    report(job: Job): Promise<ToolResult> {
        const report = this.#reports.get(job);
        if (report === undefined) throw new Error(`job ${job.id} is not a sub-agent job`);
        return report();
    }

    async #follow(job: Job, child: string, issuer: Issuer, view: SessionApi, runId: string): Promise<void> {
        const jobs = this.options.jobs;
        // 先订阅再读路径：读的期间写下的事项从帧里来，按 id 合并；应答过的记下来，路径里读到的旧事项不会盖回去。
        const asked = new Map<string, JobQuestion>();
        const answered = new Set<string>();
        let questions: "caller" | "user" | null = null;
        const update = () => {
            if (questions === null || !isLive(job.state)) return;
            const first = [...asked.values()].find((item) => !answered.has(item.id)) ?? null;
            if (first?.id !== job.question?.id) jobs.question(job, first);
        };
        const take = (event: LogEvent) => {
            if (event.type === "interactionRequested") {
                const item = event.data as unknown as PendingItem;
                if (questions !== null && forCaller(item, questions)) asked.set(item.id, {id: item.id, text: questionText(item.request)});
            } else if (event.type === "interactionResolved") answered.add((event.data as {id: string}).id);
        };
        let release: (() => void) | null = null;
        try {
            questions = (await view.snapshot()).header.questions;
            const subscribed = await this.options.table.subscribeOpened(child, issuer, (frame) => {
                if (frame.type !== "log") return;
                take(frame.event);
                update();
            });
            if (subscribed.ok) release = subscribed.release;
            for (const event of await view.path()) take(event);
            update();
            const run = await view.waitRun(runId);
            const line = lineOf(run);
            jobs.end(job, STATUS_OF_REASON[run.reason], {reason: run.reason, ...(line === undefined ? {} : {line})});
        } catch (error) {
            // 子会话打不开，或插件正在停止：照实记成中断，等它的调用与 `wait` 都能收口。
            this.options.report("subagent-follow-failed", `could not follow the run ${runId} of sub-agent session ${child}`, {session: child, message: error instanceof Error ? error.message : String(error)});
            jobs.end(job, "interrupted", {reason: "interrupted"});
        } finally {
            release?.();
        }
    }

    async #result(job: Job, view: SessionApi, runId: string, save: SaveFull): Promise<ToolResult> {
        const child = view.id;
        const base = {sessionId: child, jobId: job.id, runId, invocation: job.invocation};
        let parts: Parameters<typeof resultOf>[0];
        try {
            const asyncQuestions = await asyncQuestionsOf(view);
            if (isLive(job.state)) {
                parts = job.state === "question" && job.question !== undefined
                    ? {...base, status: "question", question: job.question, asyncQuestions}
                    : {...base, status: "running", asyncQuestions, note: "用 wait 等这个任务，jobs 看状态，kill 停掉"};
            } else {
                const run = await view.runResult({runId});
                parts = {...base, status: job.state as "completed" | "failed" | "aborted" | "interrupted", run, asyncQuestions};
            }
        } catch (error) {
            // 子会话读不了（被删、损坏）：交回任务记下的终态，不让 `wait` 失败。
            parts = {...base, status: isLive(job.state) ? "running" : job.state as "completed", note: `子会话读不了（${error instanceof Error ? error.message : String(error)}）`};
        }
        const result = resultOf(parts);
        // 子代理出错不算这次工具调用失败：工具照常交回，状态在文字与 `details` 里。
        return {text: await clip(result.text, save), details: result.details};
    }
}
