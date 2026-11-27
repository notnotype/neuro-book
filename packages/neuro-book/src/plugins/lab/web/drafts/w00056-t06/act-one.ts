/**
 * 第一幕的导演（w00056 t06 第 7 轮）：第一幕不用滚动，落地以后自己从第一拍演到最后一拍（开发者定：访客愿意就停在这里慢慢看）；
 * 访客点章节跳到那一拍、按暂停停下、动了工作台演示就让开。导演只管“桌上此刻是哪一拍的终态、接下来演哪一拍”，进度怎么画归页面。
 *
 * 状态三样：
 * - `at`：工作台此刻停在哪一拍的终态（-1 是首屏的样子）；
 * - `touched`、`partial`：工作台对不上 `at` 那一份（访客动过手；演或摆到一半被打断）；
 * - `ends`：每一拍的终态快照，演完或摆好一拍就记下（总是从 -1 起连续的一段）。
 *
 * 指令：
 * - `play(beat)`：从这一拍的开头演起（先摆到上一拍的终态：记过的按快照一步摆过去，没记过的一拍一拍快速摆上），
 *   演完停 `gap` 那么久，接着演下一拍，直到最后一拍；
 * - `pause()`：停下。正在演的那一拍断在半截，下次从这一拍的开头再演（先摆回）；
 * - `touch()`：访客动了工作台。同 `pause()`，另外记下“对不上”，下次演之前从访客摆的样子走回去；
 * - `resume()`：接着演。上一拍演完了就演下一拍，断在半截就从那一拍的开头再演。
 * 同一时间只有一段在走：新指令先打断正在走的那段，等它收拾完（`tidy`），再按最新的指令走；中间排着的只留最后一个。
 * 少动效时“演”换成“摆”（`animate`），拍与拍之间停多久由页面给（`gap`）。
 */
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
    /** 停在第 `beat` 拍的终态。`how`：演完的还是摆好的。 */
    rest(beat: number, how: "played" | "settled"): void;
}

export interface ActOneTimers {
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

/**
 * 导演走到哪了：`play`、`settle`（快速摆上，跳拍时路过的拍与少动效时）、`restore`（摆回记下的终态）在动手之前发，
 * `rest` 在这一拍停住时发；`paused` 是停下了（暂停、访客动手），`interrupted` 是换了指令、正在走的那段被打断。
 */
export type ActOnePhase =
    | {readonly kind: "play" | "settle" | "restore" | "rest"; readonly beat: number}
    | {readonly kind: "paused" | "interrupted"};

/** 写给探针读的一行：`play 2`、`rest 0`、`paused`。 */
export function phaseText(phase: ActOnePhase): string {
    return "beat" in phase ? `${phase.kind} ${String(phase.beat)}` : phase.kind;
}

export interface ActOneOptions {
    /** 一共几拍（含最后交给访客的那一段）：演到最后一拍就停。 */
    readonly beats: number;
    /** 演还是只摆：少动效时只摆。 */
    readonly animate: () => boolean;
    /** 第 `beat` 拍停住以后，隔多久演下一拍。 */
    readonly gap: (beat: number, animate: boolean) => number;
    readonly onPhase?: (phase: ActOnePhase) => void;
    readonly report?: (error: unknown) => void;
    readonly timers?: ActOneTimers;
}

export interface ActOne<S> {
    /** 首屏的样子（-1 拍的终态）有了才开始；之前收到的指令排着。 */
    prime(initial: S): void;
    /** 从第 `beat` 拍的开头演起，演完接着往下演。 */
    play(beat: number): void;
    /** 接着演：上一拍演完了就演下一拍，断在半截就从那一拍的开头再演。已经演完最后一拍时什么都不做。 */
    resume(): void;
    /** 停下：打断正在演的、取消排着的下一拍。 */
    pause(): void;
    /** 访客动了工作台：同 `pause`，并记下“对不上”。 */
    touch(): void;
    /** 桌上停在哪一拍的终态；最后一拍演完了没有（演完以后访客动过手也算演完）。 */
    state(): {readonly at: number; readonly finished: boolean};
    dispose(): void;
}

/** 一个指令。每下一个都是新的对象：同一拍再按一次“从这里演”就再演一遍。 */
interface Intent {
    readonly beat: number;
}

const browserTimers: ActOneTimers = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createActOne<S>(stage: ActOneStage<S>, options: ActOneOptions): ActOne<S> {
    const timers = options.timers ?? browserTimers;
    const emit = (phase: ActOnePhase): void => options.onPhase?.(phase);
    const lastBeat = options.beats - 1;

    const ends = new Map<number, S>();
    /** 记过终态的最后一拍；没有首屏的样子时是 -2。 */
    let last = -2;
    let at = -1;
    let touched = false;
    let partial = false;
    let wanted: Intent | null = null;
    /** 上一次开始走的指令。 */
    let driven: Intent | null = null;
    /** 上一次走完（没被打断）的指令。 */
    let completed: Intent | null = null;
    /** `play`、`resume` 之后为真，`pause`、`touch` 之后为假：正在走的那段被打断时，据此分清是停下了还是换了指令。 */
    let playing = false;
    let running: {readonly intent: Intent; readonly controller: AbortController} | null = null;
    let queue: Promise<void> = Promise.resolve();
    /** 拍与拍之间的停顿。 */
    let gapTimer: unknown = null;
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
            emit({kind: "restore", beat: base});
            await stage.restore(state, signal);
            check(signal);
            at = base;
            touched = false;
            partial = false;
        }
        while (at < beat) {
            const next = at + 1;
            emit({kind: "settle", beat: next});
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
        const {beat} = intent;
        await reach(beat - 1, signal);
        const animate = options.animate();
        emit({kind: animate ? "play" : "settle", beat});
        partial = true;
        await (animate ? stage.play(beat, signal) : stage.settle(beat, signal));
        check(signal);
        const state = await stage.capture();
        check(signal);
        at = beat;
        partial = false;
        record(beat, state);
        completed = intent;
        emit({kind: "rest", beat});
        stage.rest(beat, animate ? "played" : "settled");
        // 连播：停一会儿再演下一拍。这段停顿里来了别的指令（暂停、动手、跳拍）时，`issue` 与 `stop` 先把它取消。
        if (beat < lastBeat) {
            gapTimer = timers.set(() => {
                gapTimer = null;
                issue({beat: beat + 1});
            }, options.gap(beat, animate));
        }
    }

    async function step(): Promise<void> {
        const intent = wanted;
        if (disposed || last < -1 || intent === null || intent === driven) return;
        driven = intent;
        const controller = new AbortController();
        running = {intent, controller};
        try {
            await drive(intent, controller.signal);
        } catch (error) {
            if (error instanceof Interrupted || controller.signal.aborted) emit({kind: playing ? "interrupted" : "paused"});
            else options.report?.(error);
        } finally {
            if (running?.controller === controller) running = null;
            stage.tidy();
        }
    }

    function cancelGap(): void {
        if (gapTimer !== null) timers.clear(gapTimer);
        gapTimer = null;
    }

    function issue(intent: Intent): void {
        cancelGap();
        wanted = intent;
        // 正在走的不是最新的指令：打断它；排进队里的那一步会读最新的指令。
        if (running !== null && running.intent !== intent) running.controller.abort();
        queue = queue.then(step, step);
    }

    /** 停下。正在走的那段被打断时，由它自己在收拾完以后发 `paused`；没有在走的就在这里发。 */
    function stop(): void {
        playing = false;
        cancelGap();
        if (running === null) emit({kind: "paused"});
        else running.controller.abort();
    }

    function nextBeat(): number {
        if (wanted === null) return 0;
        return completed === wanted ? wanted.beat + 1 : wanted.beat;
    }

    return {
        prime(initial) {
            if (last >= -1) return;
            record(-1, initial);
            queue = queue.then(step, step);
        },
        play(beat) {
            playing = true;
            issue({beat: Math.max(0, Math.min(lastBeat, beat))});
        },
        resume() {
            const beat = nextBeat();
            if (beat > lastBeat) return;
            playing = true;
            issue({beat});
        },
        pause: stop,
        touch() {
            touched = true;
            stop();
        },
        // 演完：最后一次的指令就是最后一拍，而且走完了（之后访客动手也还算演完：交给访客那一段本来就是让访客动的）。
        state: () => ({at, finished: completed !== null && completed === wanted && completed.beat === lastBeat}),
        dispose() {
            disposed = true;
            playing = false;
            cancelGap();
            running?.controller.abort();
        },
    };
}
