/**
 * 进程中断与终止时的收尾（session.md 输出 16）。宿主登记之后，在回调里对每个打开的会话调用
 * `closeSession(session, {reason: "interrupted"})`，在跑的运行按 `interrupted` 收口再退出。
 *
 * nb-harness 依赖的 OMP（`@oh-my-pi/pi-utils` 的 postmortem）一被导入，就在主线程装上 SIGINT、SIGTERM、SIGHUP 的处理：
 * 先跑登记过的清理回调（同一轮里同时开始，最多等 10 秒），再以 128 加信号号退出进程（130、143、129）。宿主自己
 * `process.on(信号)` 拦不住这次退出，回调里没做完的收尾（例如写下“中断”的记录、停服务前撤销登记）就丢了。要在这些
 * 信号上收尾的宿主经这里登记：回调返回的 Promise 完成后进程才退出。
 */

import {postmortem} from "@oh-my-pi/pi-utils";

/** 登记中断（SIGINT）时的收尾；返回解除登记的函数。正常退出时不调用回调。 */
export function onProcessInterrupt(callback: () => void | Promise<void>): () => void {
    return postmortem.register("nb-harness-interrupt", (reason) => (reason === postmortem.Reason.SIGINT ? callback() : undefined));
}

export type TerminationSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

const SIGNAL_OF: Partial<Record<string, TerminationSignal>> = {
    [postmortem.Reason.SIGINT]: "SIGINT",
    [postmortem.Reason.SIGTERM]: "SIGTERM",
    [postmortem.Reason.SIGHUP]: "SIGHUP",
};

/**
 * 长驻的宿主（例如独立服务）自己决定收到终止信号后怎么停、以什么退出码退出：回调完成后进程以它返回的退出码退出，
 * 不再等 postmortem 用 128 加信号号退出。同一轮清理里别的登记与它同时开始，回调完成时还没完成的会被截断，所以只在
 * 进程里只有这一处要慢慢收尾时用。返回解除登记的函数；正常退出时不调用回调。
 */
export function onProcessTermination(callback: (signal: TerminationSignal) => Promise<number>): () => void {
    return postmortem.register("nb-harness-termination", async (reason) => {
        const signal = SIGNAL_OF[reason];
        if (signal === undefined) return;
        process.exit(await callback(signal));
    });
}
