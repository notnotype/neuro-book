/**
 * 第一幕的导演（w00056 t06 第 6 轮）：滚动只决定停在哪一拍，动画只负责从上一拍的终态走到这一拍的终态。
 *
 * 开发者第 5 轮说演示动画跟着滚动容易出 bug：旧做法把“演到哪了”和“滚到哪了”揉在一起，换拍时要猜工作台此刻是什么样子。
 * 这里把状态收成三样，换拍只看它们：
 * - `at`：工作台此刻停在哪一拍的终态（-1 是首屏的样子）；
 * - `touched`、`partial`：工作台对不上 `at` 那一份（访客动过手；演或摆到一半被打断）；
 * - `ends`：每一拍的终态快照，演完或摆好一拍就记下（总是从 -1 起连续的一段）。
 *
 * 跟着滚动走（`follow`）的规则：
 * 1. 目标停稳 `settleMs` 才算数：快速滚过的拍不演，也不打断正在演的。
 * 2. 目标正好是下一拍、工作台对得上：演这一拍，演完记下终态。
 * 3. 目标在后面（往回滚）：摆回目标拍的终态，不重演。
 * 4. 目标在前面隔着几拍：先摆到目标的上一拍（记过的按快照一步摆过去，没记过的一拍一拍快速摆上、每拍记下），再演目标拍。
 * 5. 对不上时先摆回（恢复动画由舞台做）再按上面走。访客动手本身不触发摆回：等下一次换拍，或访客按“接着看”“摆回去”。
 *
 * 同一时间只有一段在走：新目标来了先打断正在走的那段，等它收拾完（`tidy`），再按最新的目标走；中间排着的目标只留最后一个。
 * 少动效时第 2、4 条的“演”换成“摆”。
 */

/** 打断：演示用的等待与补间在 signal 中止时 reject 它（`motion.ts`），这里同样用它表示“这一段不走了”。 */
import {Interrupted} from "./motion";

export interface ActOneStage<S> {
    /** 演第 `beat` 拍：桌上已经是上一拍的终态。被打断时 reject（`Interrupted`）。 */
    play(beat: number, signal: AbortSignal): Promise<void>;
    /** 不演，把第 `beat` 拍的结果直接摆上：桌上已经是上一拍的终态。 */
    settle(beat: number, signal: AbortSignal): Promise<void>;
    /** 记下此刻的样子。 */
    capture(): Promise<S>;
    /** 摆回记下的样子，带恢复动画（从此刻的样子走回去）。 */
    restore(state: S, signal: AbortSignal): Promise<void>;
    /** 一段走完或被打断后收拾演示的装饰（指针、光圈、没松开的拖动）；这一拍停住时该有的东西由 `rest` 摆。 */
    tidy(): void;
    /** 停在第 `beat` 拍（-1 是首屏）。`how`：演完的、摆好的、往回摆的。 */
    rest(beat: number, how: "played" | "settled" | "restored"): void;
}

export interface ActOneTimers {
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

export interface ActOneOptions {
    /** 目标停稳多久才算数，缺省 220ms。 */
    readonly settleMs?: number;
    /** 演还是只摆：少动效时只摆。 */
    readonly animate: () => boolean;
    /** 走的过程（给探针读）：`play 2`、`restore 1`、`settle 0`、`rest 3`、`interrupted`。 */
    readonly onPhase?: (phase: string) => void;
    readonly report?: (error: unknown) => void;
    readonly timers?: ActOneTimers;
}

export interface ActOne<S> {
    /** 首屏的样子（-1 拍的终态）有了才开始；之前收到的目标排着。 */
    prime(initial: S): void;
    /** 滚动给的目标拍。 */
    follow(beat: number): void;
    /** 访客动了工作台：正在走的那段打断，记下“对不上”；返回是否打断了什么。 */
    touch(): boolean;
    /** “接着看”：从这一拍的开头再演一遍。 */
    replay(): void;
    /** “摆回去”：摆到这一拍的终态。 */
    settleHere(): void;
    /** 此刻的目标拍。 */
    target(): number;
    dispose(): void;
}

/** 一个目标。跟着滚动的按值比（同一拍不重走）；访客按的按钮每按一次是新的（`press` 递增），再按一次“接着看”就再演一遍。 */
interface Intent {
    readonly beat: number;
    readonly mode: "follow" | "replay" | "rest";
    readonly press: number;
}

const same = (a: Intent | null, b: Intent): boolean => a !== null && a.beat === b.beat && a.mode === b.mode && a.press === b.press;

const browserTimers: ActOneTimers = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createActOne<S>(stage: ActOneStage<S>, options: ActOneOptions): ActOne<S> {
    const settleMs = options.settleMs ?? 220;
    const timers = options.timers ?? browserTimers;
    const phase = (text: string): void => options.onPhase?.(text);

    const ends = new Map<number, S>();
    /** 记过终态的最后一拍；没有首屏的样子时是 -2。 */
    let last = -2;
    let at = -1;
    let touched = false;
    let partial = false;
    let wanted: Intent = {beat: -1, mode: "follow", press: 0};
    /** 上一次开始走的目标。 */
    let driven: Intent | null = null;
    let presses = 0;
    let running: {readonly intent: Intent; readonly controller: AbortController} | null = null;
    let queue: Promise<void> = Promise.resolve();
    let timer: unknown = null;
    let disposed = false;

    const outOfStep = (): boolean => touched || partial;

    function check(signal: AbortSignal): void {
        if (signal.aborted) throw new Interrupted();
    }

    function record(beat: number, state: S): void {
        ends.set(beat, state);
        last = Math.max(last, beat);
    }

    /** 让桌上正好是第 `beat` 拍的终态。 */
    async function reach(beat: number, signal: AbortSignal): Promise<void> {
        if (!outOfStep() && at === beat) return;
        const base = Math.min(beat, last);
        if (outOfStep() || at !== base) {
            const state = ends.get(base);
            if (state === undefined) throw new Error(`第 ${String(base)} 拍没有记下终态`);
            phase(`restore ${String(base)}`);
            await stage.restore(state, signal);
            check(signal);
            at = base;
            touched = false;
            partial = false;
        }
        while (at < beat) {
            const next = at + 1;
            phase(`settle ${String(next)}`);
            partial = true;
            await stage.settle(next, signal);
            check(signal);
            const state = await stage.capture();
            check(signal);
            at = next;
            partial = false;
            record(next, state);
        }
    }

    async function drive(intent: Intent, signal: AbortSignal): Promise<void> {
        const {beat, mode} = intent;
        // 往回、原地、“摆回去”：摆到这一拍的终态就停。
        if (beat < 0 || mode === "rest" || (mode === "follow" && beat <= at)) {
            const how = beat < at || outOfStep() ? "restored" : "settled";
            await reach(beat, signal);
            phase(`rest ${String(beat)}`);
            stage.rest(beat, how);
            return;
        }
        // 往前（或“接着看”）：先到上一拍的终态，再演或摆这一拍。
        await reach(beat - 1, signal);
        const animate = options.animate();
        phase(`${animate ? "play" : "settle"} ${String(beat)}`);
        partial = true;
        await (animate ? stage.play(beat, signal) : stage.settle(beat, signal));
        check(signal);
        const state = await stage.capture();
        check(signal);
        at = beat;
        partial = false;
        record(beat, state);
        phase(`rest ${String(beat)}`);
        stage.rest(beat, animate ? "played" : "settled");
    }

    async function step(): Promise<void> {
        const intent = wanted;
        if (disposed || last < -1 || same(driven, intent)) return;
        driven = intent;
        const controller = new AbortController();
        running = {intent, controller};
        try {
            await drive(intent, controller.signal);
        } catch (error) {
            if (error instanceof Interrupted || controller.signal.aborted) phase("interrupted");
            else options.report?.(error);
        } finally {
            if (running?.controller === controller) running = null;
            stage.tidy();
        }
    }

    function kick(): void {
        // 正在走的不是最新的目标：打断它；排进队里的那一步会读最新的目标。
        if (running !== null && !same(running.intent, wanted)) running.controller.abort();
        queue = queue.then(step, step);
    }

    function aim(intent: Intent, delay: number): void {
        wanted = intent;
        if (timer !== null) timers.clear(timer);
        timer = timers.set(() => {
            timer = null;
            kick();
        }, delay);
    }

    return {
        prime(initial) {
            if (last >= -1) return;
            record(-1, initial);
            kick();
        },
        follow(beat) {
            if (beat === wanted.beat && wanted.mode === "follow") return;
            aim({beat, mode: "follow", press: 0}, settleMs);
        },
        touch() {
            touched = true;
            if (running === null) return false;
            running.controller.abort();
            return true;
        },
        replay() {
            presses += 1;
            aim({beat: wanted.beat, mode: "replay", press: presses}, 0);
        },
        settleHere() {
            presses += 1;
            aim({beat: wanted.beat, mode: "rest", press: presses}, 0);
        },
        target: () => wanted.beat,
        dispose() {
            disposed = true;
            if (timer !== null) timers.clear(timer);
            running?.controller.abort();
        },
    };
}
