import {readSseStream} from "nbook/app/utils/http/read-sse";
import {useComfyUiStore} from "nbook/app/stores/comfy-ui";
import type {ComfyUiJobEventDto} from "nbook/shared/dto/comfyui.dto";

/** 重连退避序列；跑完后停在最后一档循环重试。 */
const RECONNECT_DELAYS_MS = [300, 800, 1500, 3000, 5000];

/**
 * ComfyUI 生图任务 SSE 消费：全局一条流，snapshot + job_update 写入 comfy-ui store。
 * start() 幂等；断线自动退避重连；stop()（或作用域销毁）终止连接。
 */
export function useComfyUiJobEvents(): {start: () => void; stop: () => void} {
    const comfyUiStore = useComfyUiStore();
    let abortController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    /** 代次守卫：stop 后旧连接的回调不再写 store。 */
    let generation = 0;

    const handleEvent = (event: ComfyUiJobEventDto): void => {
        if (event.type === "jobs_snapshot") {
            comfyUiStore.applySnapshot(event.jobs);
        } else if (event.type === "job_update") {
            comfyUiStore.applyJobUpdate(event.job);
        }
    };

    const connect = async (currentGeneration: number): Promise<void> => {
        if (currentGeneration !== generation) {
            return;
        }
        comfyUiStore.sseStatus = attempts === 0 ? "connecting" : comfyUiStore.sseStatus;
        abortController = new AbortController();
        try {
            const response = await fetch("/api/comfyui/jobs/events", {method: "GET", signal: abortController.signal});
            await readSseStream<ComfyUiJobEventDto>(response, (event) => {
                if (currentGeneration !== generation) {
                    return;
                }
                attempts = 0;
                comfyUiStore.sseStatus = "connected";
                handleEvent(event);
            });
        } catch {
            // fallthrough 到重连逻辑。
        }
        if (currentGeneration !== generation) {
            return;
        }
        comfyUiStore.sseStatus = "disconnected";
        const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)] ?? 5000;
        attempts += 1;
        reconnectTimer = setTimeout(() => {
            void connect(currentGeneration);
        }, delay);
    };

    const start = (): void => {
        if (abortController) {
            return;
        }
        generation += 1;
        attempts = 0;
        void connect(generation);
    };

    const stop = (): void => {
        generation += 1;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        abortController?.abort();
        abortController = null;
        comfyUiStore.sseStatus = "idle";
    };

    onScopeDispose(stop);

    return {start, stop};
}
