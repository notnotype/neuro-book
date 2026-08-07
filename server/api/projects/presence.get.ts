import {createEventStream} from "h3";
import {requireProjectRefQuery} from "nbook/server/api/projects/project-control-plane";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {acquireUserPresence} from "nbook/server/workspace-files/project-session";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";
import {
    bindProductShutdownSignal,
    readProductShutdownSignal,
    type ProductHttpShutdownEvent,
} from "nbook/server/runtime/shutdown/product-http-lifecycle";

/** 心跳间隔：保持 SSE 连接活性，避免代理层按空闲断连；也让断连能在下个心跳被发现。 */
const PRESENCE_HEARTBEAT_MS = 30_000;

/** presence SSE 事件载荷：presence_ready 建连即推且携带 projectRoot；heartbeat 周期推送不携带。 */
type PresenceStreamPayload =
    | {type: "presence_ready"; projectRoot: string}
    | {type: "heartbeat"};

/**
 * 用户在场 SSE（Task 94）：连接建立即 acquireUserPresence 计数 +1，断开即 release 计数 -1。
 * 项目未 open 时返回 409 + data.code="PROJECT_NOT_OPEN"，前端应先调 POST /api/projects/open。
 */
export default defineEventHandler(async (event) => {
    const ref = await withProjectHttpError(() => requireProjectRefQuery(event));
    const release = await withProjectHttpError(() => acquireUserPresence(ref));

    const eventStream = createEventStream(event);
    let streamClosed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let unbindProductShutdown = () => undefined;

    // 统一清理：onClosed 回调与 push 断连判定都会走这里；release 本身幂等，双触发安全。
    const cleanup = () => {
        if (streamClosed) return;
        streamClosed = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        release();
        unbindProductShutdown();
    };

    /**
     * push 一帧 presence 事件。语义：流已关闭则静默丢弃；push 命中 closed-stream 错误
     * （客户端断开附近）转 cleanup 释放在场；其余错误上抛。
     */
    const pushPresenceEvent = async (payload: PresenceStreamPayload): Promise<void> => {
        if (streamClosed) {
            return;
        }
        try {
            await eventStream.push({
                event: "presence",
                data: JSON.stringify(payload),
            });
        } catch (error) {
            if (isClosingEventStreamError(error)) {
                cleanup();
                return;
            }
            throw error;
        }
    };

    eventStream.onClosed(() => {
        cleanup();
        eventStream.close();
    });
    unbindProductShutdown = bindProductShutdownSignal(
        readProductShutdownSignal(event as unknown as ProductHttpShutdownEvent),
        () => {
            cleanup();
            void eventStream.close().catch(() => undefined);
        },
    );

    // H3 的 push 会等待 TransformStream reader 消费；必须先启动 send，否则首帧会因背压永久等待。
    const sending = eventStream.send();
    void (async () => {
        try {
            await pushPresenceEvent({type: "presence_ready", projectRoot: ref.projectRoot});
            if (streamClosed) return;
            // 30s 心跳：push 遇断连错误走 cleanup；其余瞬时错误吞掉，连接真正断开最终由 onClosed 兜底释放。
            heartbeatTimer = setInterval(() => {
                void pushPresenceEvent({type: "heartbeat"}).catch(() => undefined);
            }, PRESENCE_HEARTBEAT_MS);
            if (streamClosed) {
                // onClosed 可能在定时器建立前已触发，此处立即回收定时器。
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        } catch {
            cleanup();
            await eventStream.close().catch(() => undefined);
        }
    })();

    return sending;
});
