/**
 * 远程服务 `nbook.tasks/tasks` 版本 2 的实现（docs/specs/workbench/background-tasks.md 输出 9、23 与“失败与恢复”）：两路推送，每个
 * 订阅一个合并器（每 250 毫秒至多一次，即每秒至多 4 次），订阅一建立就推一次，窗口拿它当比较的起点；内容没变的那一份不重推。
 * - `ownChanged`：自己的任务与不分范围的后台工作。超过上限时跳过推送、`own` 得 `too-large`，都记诊断：一次超限的推送会让远程链路
 *   断开、重连后又超限。
 * - `rowsChanged`：按订阅的范围分好组的行；上限由修剪保证（groups.ts），不会超。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {fail, ok} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation, RemoteSink} from "@notnotype/nb-runtime/remote";

import {PushThrottle} from "nbook/shared/push-throttle";

import type {OwnPayload, tasksContract} from "../shared/contracts";
import {LIST_MAX_BYTES} from "./core";
import type {Outcome, TasksCore, TasksDiagnostic} from "./core";

export const PUSH_INTERVAL_MS = 250;

/** 核心的结果原样交给远程调用方：失败码与原因不改写。 */
const answer = <T, Code extends string>(result: Outcome<T, Code>) => (result.ok ? ok(result.value) : fail(result.code, {detail: result.detail}));

export function tasksRemote(core: TasksCore, options: {readonly clock: RuntimeClock; readonly report: TasksDiagnostic}): RemoteImplementation<typeof tasksContract> {
    const {clock, report} = options;
    /** 自己的任务那一份；超过上限时交回 null 并记诊断。 */
    const bounded = (): OwnPayload | null => {
        const payload = core.own();
        const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
        if (bytes <= LIST_MAX_BYTES) return payload;
        report("list-too-large", `the task list is ${bytes} bytes, over ${LIST_MAX_BYTES}; it was not sent`, {bytes, tasks: payload.tasks.length});
        return null;
    };

    /**
     * 一个订阅：合并推送，按 `same` 比上一次推出去的，没变就不推。`compute` 交回 null 时跳过这一次。
     */
    const follow = <T>(sink: RemoteSink<T>, signal: AbortSignal, compute: () => T | null, same: (value: T) => string): void => {
        let last: string | null = null;
        const throttle = new PushThrottle<T | null>({
            clock,
            intervalMs: PUSH_INTERVAL_MS,
            compute,
            push: (value) => {
                if (value === null) return;
                const fingerprint = same(value);
                if (fingerprint === last) return;
                last = fingerprint;
                sink.next(value);
            },
            failed: (error) => report("push-failed", `computing a task push failed: ${error instanceof Error ? error.message : String(error)}`),
        });
        const stop = core.onChanged(() => throttle.trigger());
        signal.addEventListener("abort", () => {
            throttle.close();
            stop();
        }, {once: true});
        throttle.trigger();
    };

    return {
        methods: {
            own: () => {
                const payload = bounded();
                return payload === null ? fail("too-large", {detail: "the task list is too large to send"}) : ok(payload);
            },
            rows: (filter) => ok(core.rows(filter)),
            detail: ({id}) => answer(core.detail(id)),
            cancel: ({id}) => answer(core.cancel(id)),
            retry: ({id}) => answer(core.retry(id)),
            remove: ({id}) => answer(core.remove(id)),
            clearFinished: () => ok({removed: core.clearFinished()}),
            stop: async ({key}) => answer(await core.stop(key)),
        },
        events: {
            ownChanged: {
                subscribe(_filter, sink, context) {
                    if (context.signal.aborted) return;
                    follow(sink, context.signal, bounded, (payload) => JSON.stringify(payload));
                },
            },
            rowsChanged: {
                subscribe(filter, sink, context) {
                    if (context.signal.aborted) return;
                    // 版本号随提供方每读一次就变，内容没变时不该重推：比的是去掉版本号的部分。
                    follow(sink, context.signal, () => core.rows(filter), (payload) => JSON.stringify({...payload, version: 0}));
                },
            },
        },
    };
}
