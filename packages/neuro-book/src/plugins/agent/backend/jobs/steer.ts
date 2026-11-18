/**
 * “本会话来了插话”：前台等子代理与 `wait` 都要在用户插话时结束等待（subagents.md 输出 6、jobs.md 输出 3）。先接上订阅再看缓冲区：
 * 等待开始之前就进了缓冲区的插话（模型还在生成这条回复时用户打的字）也算，内核要等这批工具结算才把它送达。
 * 只认就绪的插话（harness/runtime.md 输出 103）：留着的不会被运行取走；放行出来、仍是插话的算到达（jobs.md 输出 3）。
 */

import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

export interface SteerWatch {
    /** 有插话时完成；永不失败。 */
    readonly arrived: Promise<void>;
    release(): void;
}

/** `failed`：放行之后读快照失败时调用（记诊断）；这次少一次到达判断，等待照常按别的条件结束。 */
export async function watchSteer(table: SessionTable, sessionId: string, failed: (error: unknown) => void): Promise<SteerWatch> {
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
    });
    const readySteer = (buffer: readonly {readonly mode: string; readonly state: string}[]) => buffer.some((item) => item.mode === "steer" && item.state === "ready");
    const subscribed = await table.subscribeOpened(sessionId, {kind: "user"}, (frame) => {
        if (frame.type !== "log") return;
        const data = frame.event.data as {mode?: string; state?: string};
        if (frame.event.type === "inputQueued" && data.mode === "steer" && data.state !== "held") arrive();
        // 放行不带条目的模式：按快照看放行之后有没有就绪的插话。
        else if (frame.event.type === "inputReleased" && data.mode === "keep") {
            void table.view(sessionId).snapshot().then((snapshot) => {
                if (readySteer(snapshot.buffer)) arrive();
            }, failed);
        }
    });
    // 会话打不开：没有插话能来，等待只按别的条件结束。
    if (!subscribed.ok) return {arrived, release: () => undefined};
    try {
        const snapshot = await table.view(sessionId).snapshot();
        if (readySteer(snapshot.buffer)) arrive();
    } catch (error) {
        // 订阅持着会话的引用：读不了快照时先放掉，否则这个会话再也不会空闲关闭。
        subscribed.release();
        throw error;
    }
    return {arrived, release: () => subscribed.release()};
}
