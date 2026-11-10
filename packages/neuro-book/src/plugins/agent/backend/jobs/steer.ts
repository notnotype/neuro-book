/**
 * “本会话来了插话”：前台等子代理与 `wait` 都要在用户插话时结束等待（subagents.md 输出 6、jobs.md 输出 3）。先接上订阅再看缓冲区：
 * 等待开始之前就进了缓冲区的插话（模型还在生成这条回复时用户打的字）也算，内核要等这批工具结算才把它送达。
 */

import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

export interface SteerWatch {
    /** 有插话时完成；永不失败。 */
    readonly arrived: Promise<void>;
    release(): void;
}

export async function watchSteer(table: SessionTable, sessionId: string): Promise<SteerWatch> {
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
    });
    const subscribed = await table.subscribeOpened(sessionId, {kind: "user"}, (frame) => {
        if (frame.type === "log" && frame.event.type === "inputQueued" && (frame.event.data as {mode?: string}).mode === "steer") arrive();
    });
    // 会话打不开：没有插话能来，等待只按别的条件结束。
    if (!subscribed.ok) return {arrived, release: () => undefined};
    try {
        const snapshot = await table.view(sessionId).snapshot();
        if (snapshot.buffer.some((item) => item.mode === "steer")) arrive();
    } catch (error) {
        // 订阅持着会话的引用：读不了快照时先放掉，否则这个会话再也不会空闲关闭。
        subscribed.release();
        throw error;
    }
    return {arrived, release: () => subscribed.release()};
}
