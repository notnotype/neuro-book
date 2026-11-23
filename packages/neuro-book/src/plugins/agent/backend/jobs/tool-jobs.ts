/**
 * 工具里登记的后台任务（docs/specs/agent/jobs.md 的工具登记任务）：插件贡献的工具在一次调用的 `execute` 里把自己的长任务登记成 Agent 的任务，
 * `wait`、`kill`、`jobs`、回执与远程都照常（为 t24 的 Workflow）。
 *
 * 登记权绑定真实调用：`begin` 只认这一代工具实现里正在执行的调用（`call.invocation`），种类盖成 `<贡献工具的插件>.<名字>`。这一代撤回（插件
 * 停止、贡献撤回）时先封住登记，再对它登记的在跑任务调 `stop`、按 `interrupted` 收口。任何插件的工具都能登记，名额与后台命令、子代理共用。
 */

import type {ToolJob, ToolJobs} from "../../shared/resources";
import {isLive, type Job, type JobCenter} from "./center";

/** 结果文字的上限：回执每段也是这么长（receipt.ts）。 */
const RESULT_MAX_BYTES = 12 * 1024;
const LABEL_MAX_CHARS = 20;
const SUMMARY_MAX_CHARS = 200;
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,39}$/u;

export type {ToolJob, ToolJobs};

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

export function toolJobs(center: JobCenter, scope: ToolJobScope, options: {readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void}): ToolJobs {
    const mine = new Set<Job>();
    // 撤回：先封住（之后 `begin` 得 unavailable、句柄不起作用；插件在 `stop` 里调的 `end` 也不再算），再停掉在跑的、按 interrupted 收口。
    // 插件的 `stop` 抛错只记诊断，照样收口。
    scope.onRevoke(() => {
        for (const job of [...mine]) {
            if (!isLive(job.state)) continue;
            void Promise.resolve()
                .then(() => job.driver?.kill("interrupted"))
                .catch((error: unknown) => options.report("tool-job-stop-failed", `stopping ${job.id} of ${scope.plugin} threw`, {job: job.id, message: error instanceof Error ? error.message : String(error)}))
                .finally(() => center.end(job, "interrupted", {reason: "interrupted"}));
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
                // 用户或 Agent 停它、`nbook.agent` 停止时停它（`interrupted`）：插件停下工作时调 `end`；它没调就照停的原因收口，
                // 任务不会一直算在跑（否则账本里留成在跑，下次启动说成“服务重启时中断”）。
                kill: async (reason, byUser) => {
                    await input.stop(byUser === true);
                    if (isLive(job.state)) {
                        mine.delete(job);
                        const state = reason ?? "aborted";
                        center.end(job, state, {reason: state});
                    }
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
