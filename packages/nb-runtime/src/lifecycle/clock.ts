/**
 * 内核里需要计时的机制（远程调用超时、子实例宽限期）只经这个时钟计时：宿主可以换成自己的实现，
 * 测试注入可手动推进的时钟，不做真实等待。
 */
export interface RuntimeClock {
    now(): number;
    /** 在 `ms` 毫秒后调用一次 `callback`；返回的函数取消尚未触发的调用，重复调用无副作用。 */
    schedule(callback: () => void, ms: number): () => void;
}

export const systemClock: RuntimeClock = {
    now: () => Date.now(),
    schedule(callback, ms) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    },
};
