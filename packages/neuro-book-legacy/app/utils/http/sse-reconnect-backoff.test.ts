import {afterEach, describe, expect, it, vi} from "vitest";
import {SseReconnectBackoff} from "nbook/app/utils/http/sse-reconnect-backoff";

describe("SseReconnectBackoff", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("短连接即使已 opened 也严格走完整失败序列", () => {
        vi.useFakeTimers();
        const backoff = new SseReconnectBackoff();

        const delays = [300, 800, 1500, 3000, 5000, 5000].map(() => {
            backoff.opened();
            return backoff.disconnected().delayMs;
        });

        expect(delays).toEqual([300, 800, 1500, 3000, 5000, 5000]);
    });

    it("连接稳定五秒后下一次断线从 300ms 重新开始", () => {
        vi.useFakeTimers();
        const backoff = new SseReconnectBackoff();
        expect(backoff.disconnected().delayMs).toBe(300);
        expect(backoff.disconnected().delayMs).toBe(800);

        backoff.opened();
        vi.advanceTimersByTime(5000);
        expect(backoff.disconnected()).toEqual({delayMs: 300, failedAttempts: 1, wasStable: true});
        expect(backoff.disconnected().delayMs).toBe(800);
    });

    it("reset 显式清除失败序列和打开时间", () => {
        vi.useFakeTimers();
        const backoff = new SseReconnectBackoff();
        backoff.opened();
        vi.advanceTimersByTime(5000);
        backoff.reset();

        expect(backoff.disconnected()).toEqual({delayMs: 300, failedAttempts: 1, wasStable: false});
    });
});
