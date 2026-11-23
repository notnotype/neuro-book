/**
 * 工具里登记的后台任务（docs/specs/agent/jobs.md 的工具登记任务）：插件贡献的工具在一次调用的 `execute` 里把自己的长任务登记成 Agent 的任务，
 * `wait`、`kill`、`jobs`、回执与远程都照常（为 t24 的 Workflow）。
 *
 * 登记权绑定真实调用：`begin` 只认这一代工具实现里正在执行的调用（`call.invocation`），种类盖成 `<贡献工具的插件>.<名字>`。这一代撤回（插件
 * 停止、贡献撤回）时先封住登记，再对它登记的在跑任务调 `stop`、按 `interrupted` 收口。不进插件 SDK：现在只给内置插件。
 */

import type {ToolContext} from "@notnotype/nb-harness/kernel/contracts";

import {isLive, type Job, type JobCenter} from "./center";

/** 结果文字的上限：回执每段也是这么长（receipt.ts）。 */
const RESULT_MAX_BYTES = 12 * 1024;
const LABEL_MAX_CHARS = 20;
const SUMMARY_MAX_CHARS = 200;
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,39}$/u;

export interface ToolJob {
    readonly id: string;
    /** 进展的最后一行。 */
    progress(line: string): void;
    /** 结束时给出回执的结果文字（按 UTF-8 至多 12 KiB，超出截断并注明），之后不再向插件取任何东西。 */
    end(state: "completed" | "failed" | "aborted", text: string): void;
}

export interface ToolJobs {
    /** 只能在这次调用的 `execute` 结算之前调。`stop` 必给：用户、Agent 停它，或插件撤回时调用；插件停下工作后再 `end`。 */
    begin(call: ToolContext, input: {readonly kind: string; readonly label: string; readonly summary: string; stop(byUser: boolean): void | Promise<void>}): {readonly ok: true; readonly job: ToolJob} | {readonly ok: false; readonly code: "concurrency-limit" | "unavailable" | "invalid"};
}

/** 一代工具实现的登记范围：贡献它的插件、正在执行的调用、撤回。 */
export interface ToolJobScope {
    readonly plugin: string;
    readonly sessionId: string;
    /** 这一代里正在执行的调用的 `invocation`。 */
    readonly live: ReadonlySet<string>;
    revoked(): boolean;
    onRevoke(listener: () => void): void;
}

function clipText(text: string): string {
    const buffer = Buffer.from(text, "utf8");
    if (buffer.length <= RESULT_MAX_BYTES) return text;
    let end = RESULT_MAX_BYTES;
    while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
    return `${buffer.subarray(0, end).toString("utf8")}\n（结果超过 12 KiB，后面的截掉了）`;
}

export function toolJobs(center: JobCenter, scope: ToolJobScope): ToolJobs {
    const mine = new Set<Job>();
    // 撤回：先封住（之后 `begin` 得 unavailable、句柄不起作用），再停掉在跑的、按 interrupted 收口。
    scope.onRevoke(() => {
        for (const job of [...mine]) {
            if (!isLive(job.state)) continue;
            void Promise.resolve(job.driver?.kill("interrupted")).finally(() => center.end(job, "interrupted", {reason: "interrupted"}));
        }
    });
    return {
        begin: (call, input) => {
            if (scope.revoked() || !scope.live.has(call.invocation) || call.sessionId !== scope.sessionId) return {ok: false, code: "unavailable"};
            if (!KIND_PATTERN.test(input.kind) || input.label.trim() === "" || [...input.label].length > LABEL_MAX_CHARS || [...input.summary].length > SUMMARY_MAX_CHARS) return {ok: false, code: "invalid"};
            const reserved = center.reserve(scope.sessionId, `${scope.plugin}.${input.kind}`, call.invocation, input.summary, input.label);
            if (!reserved.ok) return {ok: false, code: reserved.code === "unavailable" ? "unavailable" : "concurrency-limit"};
            const job = reserved.job;
            let text = "";
            mine.add(job);
            center.start(job, {
                kill: async (_reason, byUser) => {
                    await input.stop(byUser === true);
                },
                result: async () => text,
            });
            const sealed = () => scope.revoked() || !isLive(job.state);
            return {ok: true, job: {
                id: job.id,
                progress: (line) => {
                    if (!sealed()) center.progress(job, line.slice(0, 200));
                },
                end: (state, result) => {
                    if (sealed()) return;
                    text = clipText(result);
                    mine.delete(job);
                    center.end(job, state, {reason: state});
                },
            }};
        },
    };
}
