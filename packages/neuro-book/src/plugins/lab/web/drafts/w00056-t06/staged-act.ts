/**
 * 首页上的一幕怎么连播（w00056 t06 第 13 轮从 `HomepageSanctum.vue` 搬出来，第一幕、第二幕各用一份）：导演、章节条的进度、
 * 停着的原因，以及上台开演、离台停住、跳拍、暂停、接着演、从头再看、访客动手这几样指令。
 *
 * 页面给拍（演、摆、标称时长）与几个钩子（换字幕、摆停住的样子、记下与摆回工作台、收拾演示的装饰、收起指针、窄屏只换字幕）；
 * 这里不碰工作台与字幕本身。导演的语义见 `act-one.ts`。
 */
import {computed, ref, watch} from "vue";
import type {ComputedRef, Ref, WatchSource} from "vue";

import {createActOne, phaseText} from "./act-one";
import type {ActOne, ActOnePhase} from "./act-one";
import type {BeatCopy} from "./copy";
import {timeScale} from "./motion";

export interface StagedBeat {
    /** 章节条上这一段的名字与字幕；交给访客的那一段为 null（不在条上）。 */
    readonly copy: BeatCopy | null;
    /**
     * 从开演到说出结论的标称时长（ms，不含之后留着看的那一会儿）：章节条按它估这一段的进度，卡顿时会慢，估到九成二就停着等结论。
     */
    readonly nominal: number;
    /** 从上一拍的终态演到这一拍的终态。 */
    play(signal: AbortSignal): Promise<void>;
    /** 不演，直接摆上这一拍的结果（快速跳过与少动效时）。 */
    settle(signal: AbortSignal): Promise<void>;
}

export interface StagedActHooks<S> {
    /** 一拍开演或摆上之前：字幕回到这一拍，收起交给访客时的标记。 */
    prepare(beat: number): void;
    /** 停在某一拍的终态（`last`：交给访客的那一拍）。 */
    rest(beat: number, how: "played" | "settled", last: boolean): void;
    capture(): Promise<S>;
    restore(state: S, signal: AbortSignal): Promise<void>;
    /** 一段走完或被打断后收拾演示的装饰。 */
    tidy(): void;
    /** 停下了（暂停、访客动手、离台）或交给了访客：演示指针收起。 */
    idle(): void;
    /** 窄屏的一拍：不演示，只换字幕。 */
    narrow(beat: number, signal: AbortSignal): Promise<void>;
}

export interface StagedActOptions<S> {
    /** 报错时的前缀（“第一幕”）。 */
    readonly name: string;
    readonly beats: readonly StagedBeat[];
    readonly wide: Ref<boolean>;
    readonly reduced: boolean;
    /** 窄屏的一拍估多久（只换字幕的那一套）。 */
    readonly narrowMs: number;
    /** 这一幕在不在台上：第一次上台开演，离台停下，回来接着演。 */
    readonly onStage: WatchSource<boolean>;
    readonly hooks: StagedActHooks<S>;
}

/** 停着的原因：`user` 访客按了暂停，`touch` 访客动了工作台，`away` 这一幕不在台上（回来自己接着演）；null 是在演或还没开演。 */
export type ActHold = "user" | "touch" | "away" | null;

export interface StagedAct<S> {
    readonly director: ActOne<S>;
    /** 章节条上的几段（交给访客那一段不算）。 */
    readonly chapters: readonly string[];
    /** 交给访客那一拍。 */
    readonly last: number;
    readonly started: Ref<boolean>;
    readonly hold: Ref<ActHold>;
    readonly finished: Ref<boolean>;
    /** 字幕上是哪一拍：-1 是还没开演。 */
    readonly current: Ref<number>;
    /** 写给探针读的一行（`play 2`、`rest 0`、`paused`）。 */
    readonly phase: Ref<string>;
    readonly railCurrent: Ref<number>;
    readonly railDone: Ref<number>;
    readonly railProgress: Ref<number>;
    readonly railStatus: ComputedRef<"finished" | "yielded" | "paused" | "playing">;
    /** 这一拍说出了结论：章节条上这一段补满，停钟。 */
    concluded(): void;
    jumpTo(beat: number): void;
    pause(): void;
    resume(): void;
    replay(): void;
    /** 访客自己动了工作台（交给访客那一拍不算）。返回演示让开了没有。 */
    touch(): boolean;
    dispose(): void;
}

/** 估进度的钟走到九成二就停着等结论。 */
const CLOCK_CAP = 0.92;

export function useStagedAct<S>(options: StagedActOptions<S>): StagedAct<S> {
    const {beats, hooks, wide} = options;
    const chapters = beats.flatMap((beat) => (beat.copy === null ? [] : [beat.copy.title]));
    const last = beats.length - 1;

    const current = ref(-1);
    const phase = ref("idle");
    const hold = ref<ActHold>(null);
    const started = ref(false);
    const finished = ref(false);
    const railCurrent = ref(-1);
    const railDone = ref(0);
    const railProgress = ref(0);
    const railStatus = computed(() => (finished.value ? "finished" : hold.value === "touch" ? "yielded" : hold.value === "user" ? "paused" : "playing"));

    let clockFrame = 0;
    function stopClock(): void {
        if (clockFrame !== 0) cancelAnimationFrame(clockFrame);
        clockFrame = 0;
    }
    function startClock(ms: number): void {
        stopClock();
        railProgress.value = 0;
        if (ms <= 0) return;
        const from = performance.now();
        const span = ms * timeScale();
        const tick = (): void => {
            railProgress.value = Math.min(CLOCK_CAP, (performance.now() - from) / span);
            clockFrame = railProgress.value < CLOCK_CAP ? requestAnimationFrame(tick) : 0;
        };
        clockFrame = requestAnimationFrame(tick);
    }

    /** 导演每走一步，章节条跟着换。交给访客那一拍不在条上：到了那一拍，几段都算看过。 */
    function onPhase(event: ActOnePhase): void {
        phase.value = phaseText(event);
        if (!("beat" in event)) {
            stopClock();
            // 停下了（访客按了暂停、动了工作台、离台）：指针收起。换拍打断的那一下（`interrupted`）紧接着演下一拍，指针留着。
            if (event.kind === "paused") hooks.idle();
            return;
        }
        const {kind, beat} = event;
        if (kind === "rest") {
            stopClock();
            railCurrent.value = beat;
            railDone.value = Math.max(railDone.value, Math.min(beat + 1, chapters.length));
            finished.value = beat === last;
            if (finished.value) hooks.idle();
            return;
        }
        finished.value = false;
        if (kind === "restore") {
            // 摆回第 `beat` 拍的终态：后面的段退回没看过，接着演的是下一段。
            startClock(0);
            railCurrent.value = beat + 1;
            railDone.value = beat + 1;
            return;
        }
        // 演或快速摆上这一拍：前面的都看过了，这一段从头起。
        railCurrent.value = beat;
        railDone.value = Math.min(beat, chapters.length);
        startClock(kind === "play" ? (wide.value ? (beats[beat]?.nominal ?? 0) : options.narrowMs) : 0);
    }

    const director = createActOne<S>({
        async play(beat, signal) {
            current.value = beat;
            hooks.prepare(beat);
            if (wide.value) await beats[beat]?.play(signal);
            else await hooks.narrow(beat, signal);
        },
        async settle(beat, signal) {
            current.value = beat;
            hooks.prepare(beat);
            if (wide.value) await beats[beat]?.settle(signal);
        },
        capture: () => hooks.capture(),
        restore: async (state, signal) => {
            if (wide.value) await hooks.restore(state, signal);
        },
        tidy: () => hooks.tidy(),
        rest: (beat, how) => {
            current.value = beat;
            hooks.rest(beat, how, beat === last);
        },
    }, {
        beats: beats.length,
        animate: () => !options.reduced,
        // 演完一拍留 0.7 秒静止再换下一拍（@designer 第 7 轮：没有落点指示，视线全靠布局自己动，换拍前要停一下）；少动效时每一拍是直接摆上的，停久一些看清。
        gap: (_beat, moving) => (moving ? 700 : 3200),
        onPhase,
        report: (error) => console.error(`[homepage] ${options.name}`, error),
    });

    // 第一次上台就开演；离台时停下（访客按了暂停、动过手的不算），回来接着演。从不锁滚动。
    const stopWatch = watch(options.onStage, (shown) => {
        if (shown) {
            if (!started.value) {
                started.value = true;
                director.play(0);
            } else if (hold.value === "away") {
                hold.value = null;
                director.resume();
            }
            return;
        }
        if (started.value && hold.value === null && !finished.value) {
            hold.value = "away";
            director.pause();
        }
    }, {immediate: true});

    return {
        director,
        chapters,
        last,
        started,
        hold,
        finished,
        current,
        phase,
        railCurrent,
        railDone,
        railProgress,
        railStatus,
        concluded() {
            railDone.value = Math.max(railDone.value, Math.min(current.value + 1, chapters.length));
            stopClock();
        },
        jumpTo(beat) {
            hold.value = null;
            director.play(beat);
        },
        pause() {
            hold.value = "user";
            director.pause();
        },
        resume() {
            hold.value = null;
            director.resume();
        },
        replay() {
            hold.value = null;
            director.play(0);
        },
        touch() {
            if (!wide.value || !started.value) return false;
            if (finished.value || current.value === last) return false;
            director.touch();
            hold.value = "touch";
            return true;
        },
        dispose() {
            stopWatch();
            stopClock();
            director.dispose();
        },
    };
}
