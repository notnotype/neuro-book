/**
 * 远程服务 `nbook.tasks/tasks` 的实现（docs/specs/workbench/background-tasks.md 输出 9 与“失败与恢复”）：推送整份清单，
 * 每个订阅一个合并器（每 250 毫秒至多一次，即每秒至多 4 次）；订阅一建立就推一次当前清单，窗口拿它当比较的起点。
 * 整份清单超过上限时跳过推送、`list` 得 `too-large`，都记诊断：一次超限的推送会让远程链路断开、重连后又超限。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {fail, ok} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import {PushThrottle} from "nbook/shared/push-throttle";

import type {TaskItem, tasksContract} from "../shared/contracts";
import {LIST_MAX_BYTES} from "./core";
import type {TasksCore, TasksDiagnostic} from "./core";

export const PUSH_INTERVAL_MS = 250;

const utf8 = new TextEncoder();

export function tasksRemote(core: TasksCore, options: {readonly clock: RuntimeClock; readonly report: TasksDiagnostic}): RemoteImplementation<typeof tasksContract> {
    const {clock, report} = options;
    /** 整份清单；超过上限时交回 null 并记诊断。 */
    const bounded = (): TaskItem[] | null => {
        const items = core.list();
        const bytes = utf8.encode(JSON.stringify(items)).length;
        if (bytes <= LIST_MAX_BYTES) return items;
        report("list-too-large", `the task list is ${bytes} bytes, over ${LIST_MAX_BYTES}; it was not sent`, {bytes, tasks: items.length});
        return null;
    };
    return {
        methods: {
            list: () => {
                const items = bounded();
                return items === null ? fail("too-large", {detail: "the task list is too large to send"}) : ok(items);
            },
            detail: ({id}) => {
                const result = core.detail(id);
                return result.ok ? ok(result.value) : fail(result.code, {detail: result.detail});
            },
            cancel: ({id}) => {
                const result = core.cancel(id);
                return result.ok ? ok(null) : fail(result.code, {detail: result.detail});
            },
            retry: ({id}) => {
                const result = core.retry(id);
                return result.ok ? ok(null) : fail(result.code, {detail: result.detail});
            },
            remove: ({id}) => {
                const result = core.remove(id);
                return result.ok ? ok(null) : fail(result.code, {detail: result.detail});
            },
            clearFinished: () => ok({removed: core.clearFinished()}),
        },
        events: {
            changed: {
                subscribe(_filter, sink, context) {
                    if (context.signal.aborted) return;
                    const throttle = new PushThrottle<TaskItem[] | null>({
                        clock,
                        intervalMs: PUSH_INTERVAL_MS,
                        compute: bounded,
                        push: (items) => {
                            if (items !== null) sink.next(items);
                        },
                        failed: (error) => report("push-failed", `computing the task list failed: ${error instanceof Error ? error.message : String(error)}`),
                    });
                    const stop = core.onChanged(() => throttle.trigger());
                    context.signal.addEventListener("abort", () => {
                        throttle.close();
                        stop();
                    }, {once: true});
                    throttle.trigger();
                },
            },
        },
    };
}
