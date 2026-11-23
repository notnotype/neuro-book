/**
 * 远程服务 `nbook.tasks/tasks` 版本 2 的实现（docs/specs/workbench/background-tasks.md 输出 9、23 与“失败与恢复”）：两路推送，每个
 * 订阅一个合并器（每 250 毫秒至多一次，即每秒至多 4 次），订阅一建立就推一次，窗口拿它当比较的起点；内容没变的那一份不重推。
 * - `ownChanged`：自己的任务与不分范围的后台工作。超过上限时跳过推送、`own` 得 `too-large`：一次超限的推送会让远程链路断开、
 *   重连后又超限。诊断在进入超限时记一次，超限期间各窗口、各次推送不再重复记。
 * - `rowsChanged`：按订阅的范围分好组的行；上限由 groups.ts 的修剪按估算守住。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {fail, ok} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation, RemoteSink} from "@notnotype/nb-runtime/remote";

import {PushThrottle} from "nbook/shared/push-throttle";

import type {OwnPayload, tasksContract} from "../shared/contracts";
import {LIST_MAX_BYTES} from "./core";
import type {Outcome, TasksCore, TasksDiagnostic} from "./core";

export const PUSH_INTERVAL_MS = 250;

/** 一次重算的结果与比较用的指纹（编码只做一次）。 */
interface Computed<T> {
    readonly payload: T;
    readonly fingerprint: string;
}

/** 核心的结果原样交给远程调用方：失败码与原因不改写。 */
const answer = <T, Code extends string>(result: Outcome<T, Code>) => (result.ok ? ok(result.value) : fail(result.code, {detail: result.detail}));

export function tasksRemote(core: TasksCore, options: {readonly clock: RuntimeClock; readonly report: TasksDiagnostic}): RemoteImplementation<typeof tasksContract> {
    const {clock, report} = options;
    let tooLarge = false;
    /** 自己的任务那一份与它的编码；超过上限时交回 null（进入超限时记一次诊断）。 */
    const bounded = (): Computed<OwnPayload> | null => {
        const payload = core.own();
        const json = JSON.stringify(payload);
        const bytes = Buffer.byteLength(json, "utf8");
        if (bytes <= LIST_MAX_BYTES) {
            tooLarge = false;
            return {payload, fingerprint: json};
        }
        if (!tooLarge) report("list-too-large", `the task list is ${bytes} bytes, over ${LIST_MAX_BYTES}; it is not sent while it stays over`, {bytes, tasks: payload.tasks.length});
        tooLarge = true;
        return null;
    };

    /** 一个订阅：合并推送，按指纹比上一次推出去的，没变就不推。`compute` 交回 null 时跳过这一次。 */
    const follow = <T>(sink: RemoteSink<T>, signal: AbortSignal, compute: () => Computed<T> | null): void => {
        let last: string | null = null;
        const throttle = new PushThrottle<Computed<T> | null>({
            clock,
            intervalMs: PUSH_INTERVAL_MS,
            compute,
            push: (value) => {
                if (value === null || value.fingerprint === last) return;
                last = value.fingerprint;
                sink.next(value.payload);
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
                const computed = bounded();
                return computed === null ? fail("too-large", {detail: "the task list is too large to send"}) : ok(computed.payload);
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
                    follow(sink, context.signal, bounded);
                },
            },
            rowsChanged: {
                subscribe(filter, sink, context) {
                    if (context.signal.aborted) return;
                    // 版本号随提供方每读一次就变，内容没变时不该重推：比的是去掉版本号的部分。
                    follow(sink, context.signal, () => {
                        const payload = core.rows(filter);
                        return {payload, fingerprint: JSON.stringify({...payload, version: 0})};
                    });
                },
            },
        },
    };
}
