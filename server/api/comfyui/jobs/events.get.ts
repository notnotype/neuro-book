import {createEventStream} from "h3";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";
import {listJobs, subscribeJobEvents} from "nbook/server/comfyui/job-manager";
import type {ComfyUiJobEventDto} from "nbook/shared/dto/comfyui.dto";

/** 心跳间隔：保持 SSE 连接活性，断连也能在下个心跳被发现。 */
const HEARTBEAT_MS = 30_000;

/**
 * ComfyUI 生图任务全局 SSE：建连即推全量 jobs_snapshot，之后按 job 粒度推 job_update。
 * job-manager 是进程内单例、单用户本地应用，一条全局流即可；事件带 projectPath 供前端过滤。
 */
export default defineEventHandler(async (event) => {
    const eventStream = createEventStream(event);
    let streamClosed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
        streamClosed = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        unsubscribe?.();
        unsubscribe = null;
    };

    const pushEvent = async (payload: ComfyUiJobEventDto): Promise<void> => {
        if (streamClosed) {
            return;
        }
        try {
            await eventStream.push({
                event: "comfyui",
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

    unsubscribe = subscribeJobEvents((payload) => {
        void pushEvent(payload).catch(() => undefined);
    });
    // 快照帧在 send() 之后异步推送：send 前 await push 会因响应流尚未接管而挂起（h3 模式即「先 send 后 push」）。
    setImmediate(() => {
        void pushEvent({type: "jobs_snapshot", jobs: listJobs()}).catch(() => undefined);
    });
    heartbeatTimer = setInterval(() => {
        void pushEvent({type: "heartbeat"}).catch(() => undefined);
    }, HEARTBEAT_MS);
    if (streamClosed && heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    return eventStream.send();
});
