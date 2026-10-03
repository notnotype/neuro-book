type UseTypewriterStreamOptions = {
    intervalMs?: number;
    chunkSize?: number;
    onChunk: (chunk: string) => void;
};

/**
 * 通用流式打字机。
 * 仅负责缓冲、定时落字和中断，不关心具体业务状态。
 */
export const useTypewriterStream = (options: UseTypewriterStreamOptions) => {
    const intervalMs = options.intervalMs ?? 24;
    const chunkSize = options.chunkSize ?? 2;
    const typing = ref(false);
    const buffer = ref("");
    const streaming = ref(false);
    let timer: ReturnType<typeof setInterval> | null = null;

    /**
     * 停止当前定时器。
     */
    const stop = (): void => {
        if (!timer) {
            typing.value = false;
            return;
        }

        clearInterval(timer);
        timer = null;
        typing.value = false;
    };

    /**
     * 立即把剩余缓冲区全部提交出去。
     */
    const flush = (): void => {
        if (!buffer.value) {
            if (!streaming.value) {
                stop();
            }
            return;
        }

        const text = buffer.value;
        buffer.value = "";
        options.onChunk(text);

        if (!streaming.value) {
            stop();
        }
    };

    /**
     * 启动定时落字。
     */
    const startTimer = (): void => {
        if (timer) {
            return;
        }

        typing.value = true;
        timer = setInterval(() => {
            if (!buffer.value) {
                if (!streaming.value) {
                    stop();
                }
                return;
            }

            const chunk = buffer.value.slice(0, chunkSize);
            buffer.value = buffer.value.slice(chunkSize);
            options.onChunk(chunk);

            if (!buffer.value && !streaming.value) {
                stop();
            }
        }, intervalMs);
    };

    /**
     * 标记一次新的流式写入开始。
     */
    const start = (): void => {
        streaming.value = true;
        startTimer();
    };

    /**
     * 追加一段流式文本。
     */
    const append = (text: string): void => {
        if (!text) {
            return;
        }

        buffer.value += text;
        startTimer();
    };

    /**
     * 标记流式写入结束。
     */
    const finish = (): void => {
        streaming.value = false;
        if (!buffer.value) {
            stop();
        }
    };

    /**
     * 中断当前流式写入。
     * `flushPending`:
     * - `true` 时先提交剩余缓冲区
     * - `false` 时直接丢弃未落字部分
     */
    const abort = (flushPending = false): void => {
        streaming.value = false;
        if (flushPending) {
            flush();
            return;
        }

        buffer.value = "";
        stop();
    };

    /**
     * 重置内部状态。
     */
    const reset = (): void => {
        streaming.value = false;
        buffer.value = "";
        stop();
    };

    onBeforeUnmount(() => {
        stop();
    });

    return {
        typing,
        buffer,
        streaming,
        start,
        append,
        finish,
        flush,
        abort,
        reset,
    };
};
