/**
 * 运行里写日志的公共部分：内核 `ctrl` 事件的草稿，与运行收口之后拒绝迟到写入的错误。
 *
 * 运行一旦决定收口（写 `turnEnded`、`runEnded` 之前），还在跑的模型链、工具链再要写日志都得 `RunStoppedError`：
 * 交给队列之前检查一次，交出去的一定写下（runtime.md 输出 25）。
 */

import type {JsonValue, KernelEvents} from "../api/index.js";
import type {EventDraft} from "../dispatch/core.js";

export const ctrl = (type: keyof KernelEvents, data: object): EventDraft => ({type, kind: "ctrl", scope: "path", data: data as JsonValue});

/**
 * 中止信号的 `reason`：这次中止是进程要退出（宿主登记的中断收口，session.md 输出 16），收口按 `interrupted` 写，
 * 与重开时的恢复一致；其余中止按 `aborted`。
 */
export class ProcessInterrupt extends Error {
    constructor() {
        super("the process is shutting down");
        this.name = "ProcessInterrupt";
    }
}
export const interrupting = (signal: AbortSignal): boolean => signal.reason instanceof ProcessInterrupt;

/** 运行已经收口或被中止，这次写入或执行不再进行。 */
export class RunStoppedError extends Error {
    constructor(what: string) {
        super(`the run has stopped; ${what} is dropped`);
        this.name = "RunStoppedError";
    }
}
