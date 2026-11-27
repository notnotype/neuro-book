/**
 * 首页原型的动效小工具：缓动曲线（同一条曲线既给 CSS 也给脚本算点）、可中断的补间与等待。
 * 曲线取 @designer 第 3 轮的建议（t06 的 Task 记录）：落位不回弹，停顿留给“看清楚”。
 */

/** 一条三次贝塞尔缓动：`css` 给样式与 WAAPI，`at` 给脚本按进度取值。 */
export interface Ease {
    readonly css: string;
    at(progress: number): number;
}

/** 牛顿迭代解 x(t) = progress，再取 y(t)；和浏览器的 cubic-bezier 同一条曲线。 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
    const sample = (a1: number, a2: number, t: number): number => ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
    const slope = (a1: number, a2: number, t: number): number => 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
    const solve = (x: number): number => {
        let t = x;
        for (let step = 0; step < 8; step += 1) {
            const error = sample(x1, x2, t) - x;
            const d = slope(x1, x2, t);
            if (Math.abs(error) < 1e-5 || Math.abs(d) < 1e-6) break;
            t -= error / d;
        }
        return Math.min(1, Math.max(0, t));
    };
    return {css: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`, at: (progress) => (progress <= 0 ? 0 : progress >= 1 ? 1 : sample(y1, y2, solve(progress)))};
}

/** 落位：快出慢停，不回弹（缺省用这条）。 */
export const SETTLE = cubicBezier(0.22, 1, 0.36, 1);
/** 书页展平：起得慢、收得稳。 */
export const FLATTEN = cubicBezier(0.32, 0, 0.2, 1);
/** 面板贴上：更利落的收尾。 */
export const SNAP = cubicBezier(0.16, 1, 0.3, 1);
/** 指针拖着走：起步慢、中段快、近落点时放慢，让落点的高亮看得清。 */
export const CARRY = cubicBezier(0.45, 0, 0.2, 1);
/** 金线描边：两头慢，像笔在拐角处收一下。 */
export const DRAW = cubicBezier(0.65, 0, 0.35, 1);

/**
 * 截关键帧用的放慢倍数：探针在页面加载前写 `window.__hpTimeScale`，同时用浏览器的调试协议把 CSS 与 WAAPI 动画放慢同样倍数，
 * 脚本里的等待与补间也照它放慢，三者对得上。平时没有这个值，倍数是 1。
 */
export function timeScale(): number {
    const value = (globalThis as {__hpTimeScale?: unknown}).__hpTimeScale;
    return typeof value === "number" && value > 0 ? value : 1;
}

/** 被打断时抛出：调用方据此区分“演完了”和“被访客或滚动打断了”。 */
export class Interrupted extends Error {
    constructor() {
        super("interrupted");
        this.name = "Interrupted";
    }
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Interrupted());
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, ms * timeScale());
        const abort = (): void => {
            clearTimeout(timer);
            reject(new Interrupted());
        };
        signal.addEventListener("abort", abort, {once: true});
    });
}

/** 等浏览器画过 `count` 帧：主线程忙完一阵（例如重新挂一台工作台）以后，排在帧上的过渡这时才往下走。 */
export function frames(count: number): Promise<void> {
    return new Promise((resolve) => {
        const step = (left: number): void => {
            if (left <= 0) resolve();
            else requestAnimationFrame(() => step(left - 1));
        };
        step(count);
    });
}

/** 按帧推进的补间：每帧给出缓动后的进度；被打断时停在当前帧并抛出 `Interrupted`。 */
export function tween(duration: number, ease: Ease, frame: (progress: number) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Interrupted());
            return;
        }
        const start = performance.now();
        const span = duration * timeScale();
        let handle = 0;
        const abort = (): void => {
            cancelAnimationFrame(handle);
            reject(new Interrupted());
        };
        // 用 performance.now() 而不是帧回调给的时间戳：调试协议放慢动画时，帧时间戳跟着变慢，和 `start` 不在一个钟上。
        const step = (): void => {
            const linear = Math.min(1, (performance.now() - start) / span);
            frame(ease.at(linear));
            if (linear < 1) {
                handle = requestAnimationFrame(step);
                return;
            }
            signal.removeEventListener("abort", abort);
            resolve();
        };
        signal.addEventListener("abort", abort, {once: true});
        handle = requestAnimationFrame(step);
    });
}

export const lerp = (from: number, to: number, progress: number): number => from + (to - from) * progress;

/** 访客要求少动效时：开场直接到终态，演示不走指针。 */
export const prefersReducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
