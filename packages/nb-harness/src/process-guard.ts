/**
 * 让宿主保住自己的进程级处理（OMP 上游 issue can1357/oh-my-pi#17674 修好前的临时做法）。
 *
 * OMP 的 `@oh-my-pi/pi-utils` 一被求值（导入 `pi-ai`、`pi-catalog` 等几乎任何 OMP 包都会带上它），就在主线程装上 SIGINT、
 * SIGTERM、SIGHUP、`uncaughtException`、`unhandledRejection` 的处理：跑完它登记的清理就以 130、143、129 或致命错误硬退出，
 * 抢在宿主自己的有序停止之前。本模块不静态导入任何 OMP 模块：先记下这几个事件上已有的监听，再动态导入 `pi-utils`，把这次
 * 求值新挂上的监听摘掉，交回一个让宿主在自己停止时跑 OMP 清理的函数。`exit` 上的监听留着（它只是不等结果地跑一遍清理）。
 *
 * 前提与失效条件：
 * - 要在进程里第一次求值 `pi-utils` 之前调用（宿主入口的前几条导入里）；之后再调，什么都摘不到，返回的 `detached` 为空。
 * - 依赖 OMP“求值时在 `process` 上注册”这个行为；OMP 改成别的时机注册，这里就摘不到，宿主的进程测试会失败（不会静默）。
 * - 上游有了关闭开关后换成开关，删掉本模块。
 */

const EVENTS = ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException", "unhandledRejection"] as const;

export type OmpProcessEvent = (typeof EVENTS)[number];

export interface OmpProcessGuard {
    /** 摘掉的监听所在的事件（每个事件摘掉几个）；空表示 `pi-utils` 在调用之前已经求值过。 */
    readonly detached: Readonly<Partial<Record<OmpProcessEvent, number>>>;
    /** 跑一遍 OMP 用 `postmortem.register` 登记的清理（OMP 自己最多等 10 秒）；宿主有序停止结算之后、退出之前调用。 */
    cleanup(): Promise<void>;
}

export async function takeOverOmpProcessHandlers(): Promise<OmpProcessGuard> {
    const before = new Map(EVENTS.map((event) => [event, new Set(process.listeners(event))]));
    const {postmortem} = await import("@oh-my-pi/pi-utils");
    const detached: Partial<Record<OmpProcessEvent, number>> = {};
    for (const event of EVENTS) {
        const known = before.get(event)!;
        for (const listener of process.listeners(event)) {
            if (known.has(listener)) continue;
            process.off(event, listener as (...args: unknown[]) => void);
            detached[event] = (detached[event] ?? 0) + 1;
        }
    }
    return {detached, cleanup: () => postmortem.cleanup()};
}
