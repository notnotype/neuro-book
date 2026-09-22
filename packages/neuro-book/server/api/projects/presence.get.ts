import {createEventStream} from "h3";
import {requireProjectReadyQuery} from "nbook/server/api/projects/project-control-plane";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {acquireUserPresence} from "nbook/server/workspace-files/project-session";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";
import type {ProjectPresenceEventDto} from "nbook/shared/dto/project.dto";

/** 心跳间隔：保持 SSE 连接活性，避免代理层按空闲断连；也让断连能在下个心跳被发现。 */
const PRESENCE_HEARTBEAT_MS = 30_000;

/**
 * 用户在场 SSE（Task 94）：连接建立即 acquireUserPresence 计数 +1，断开即 release 计数 -1。
 *
 * 请求必须带上 open 发布的精确 ready 标识；服务端按标识取得该代次的 presence，
 * 因此 open 到 presence 之间发生 close/reopen、同路径新建或换运行期都返回 409 而不是接到新实例。
 * 项目未 open 时返回 409 + data.code="PROJECT_NOT_OPEN"，前端应先调 POST /api/projects/open。
 *
 * 该代次进入终止关闭（close/reopen、root 替换、shutdown）时 presence 租约 abort：连接主动结束，
 * 浏览器据 EOF 撤销 ready，而不是让心跳继续续命一个已经不可消费的代次。
 */
export default defineEventHandler(async (event) => {
    const {ref, publicId} = await withProjectHttpError(() => requireProjectReadyQuery(event));
    const presence = await withProjectHttpError(() => acquireUserPresence(ref, publicId));

    const eventStream = createEventStream(event);
    let streamClosed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    /** 统一清理：onClosed 回调、push 断连判定与 generation 终止都会走这里；release 本身幂等，多触发安全。 */
    const cleanup = () => {
        if (streamClosed) {
            return;
        }
        streamClosed = true;
        presence.signal.removeEventListener("abort", terminate);
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        presence.release();
    };

    /** 精确 generation 已经终止：结束 SSE，让浏览器立刻撤销本代次 ready 并走重连或失败路径。 */
    const terminate = () => {
        cleanup();
        void eventStream.close().catch(() => undefined);
    };

    presence.signal.addEventListener("abort", terminate, {once: true});

    /**
     * push 一帧 presence 事件。语义：流已关闭则静默丢弃；push 命中 closed-stream 错误
     * （客户端断开附近）转 cleanup 释放在场；其余错误上抛。
     */
    const pushPresenceEvent = async (payload: ProjectPresenceEventDto): Promise<void> => {
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

    // H3 的 push 会等待 TransformStream reader 消费；必须先启动 send，否则首帧会因背压永久等待。
    const sending = eventStream.send();
    void (async () => {
        try {
            // 首帧之前该代次就已经终止：不发布一份已经不可消费的 ready。
            if (presence.signal.aborted) {
                terminate();
                return;
            }
            await pushPresenceEvent({type: "presence_ready", projectRoot: ref.projectRoot, publicId});
            if (streamClosed) return;
            // 30s 心跳：push 遇断连错误走 cleanup；其余瞬时错误吞掉，连接真正断开最终由 onClosed 兜底释放。
            heartbeatTimer = setInterval(() => {
                void pushPresenceEvent({type: "heartbeat"}).catch(() => undefined);
            }, PRESENCE_HEARTBEAT_MS);
            if (streamClosed) {
                // onClosed 或 generation 终止可能在定时器建立前已触发，此处立即回收定时器。
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
