const RECONNECT_DELAYS_MS = [300, 800, 1500, 3000, 5000] as const;
const STABLE_CONNECTION_MS = 5000;

export type SseDisconnectBackoff = {
    delayMs: number;
    failedAttempts: number;
    wasStable: boolean;
};

/**
 * SSE 连接失败序列。
 *
 * opened 只记录本次连接的存活起点；短暂打开不会掩盖连续失败。连接稳定存活 5 秒后，
 * 下一次断线才重新从 300ms 开始。领域恢复、游标和 UI 状态由调用方负责。
 */
export class SseReconnectBackoff {
    private failedAttempts = 0;
    private openedAt: number | null = null;

    /** 记录一次有效连接已经打开，不改变失败序列。 */
    opened(): void {
        this.openedAt = Date.now();
    }

    /** 记录断线并返回本次应采用的延迟与稳定性证据。 */
    disconnected(): SseDisconnectBackoff {
        const wasStable = this.openedAt !== null && Date.now() - this.openedAt >= STABLE_CONNECTION_MS;
        if (wasStable) {
            this.failedAttempts = 0;
        }
        this.openedAt = null;
        const delayMs = RECONNECT_DELAYS_MS[Math.min(this.failedAttempts, RECONNECT_DELAYS_MS.length - 1)] ?? 5000;
        this.failedAttempts += 1;
        return {delayMs, failedAttempts: this.failedAttempts, wasStable};
    }

    /** 显式开始新的恢复周期。 */
    reset(): void {
        this.failedAttempts = 0;
        this.openedAt = null;
    }
}
