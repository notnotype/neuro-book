/**
 * 按需排帧的帧循环（Spec `ui/layout-drag` 的“帧循环”）：有要做的事才排下一帧，没有就停，按住不动时不空转。纯 TS，排帧与时钟由调用方给。
 *
 * 和拖动会话一起用时，叫醒它（`wake`）的指针监听要先于会话在按下时挂的 `pointermove` 监听挂上：同一阶段的监听按挂上的先后跑，
 * 这样帧循环的帧排在会话发布的帧前面，一帧里先判定（读 DOM）再写卡片。挂反了不报错，只是每帧多一次强制的样式重算。
 */

/** @experimental */
export interface FrameLoopOptions {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    /** 跑一帧。`elapsed` 是离上一帧的毫秒数（时间戳回退时是 0）；`start` 之后与停过之后的第一帧是 `nominalMs`。返回真就排下一帧。 */
    frame(now: number, elapsed: number): boolean;
    /** 刚开始、停过之后的第一帧按多长算：真实间隔可能是好几秒，按它算的话缓动一步就到了终点。缺省 1000 / 60。 */
    readonly nominalMs?: number;
}

/** @experimental */
export interface FrameLoop {
    /** 开始：撤掉排着的帧，排第一帧。 */
    start(): void;
    /** 有新输入：开始了、没有排着的帧、不在跑这一帧时排一帧。跑一帧的过程中调不另排，由这一帧的返回值决定。 */
    wake(): void;
    /** 停：撤掉排着的帧；之后 `wake` 不排，直到再 `start`。 */
    stop(): void;
}

/** @experimental */
export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
    const nominalMs = options.nominalMs ?? 1000 / 60;
    let started = false;
    let pending: number | null = null;
    let inFrame = false;
    /** 上一帧的时间戳；null 是刚开始或停过，下一帧按 `nominalMs` 算。 */
    let last: number | null = null;

    function run(now: number): void {
        pending = null;
        if (!started) return;
        const elapsed = last === null ? nominalMs : Math.max(0, now - last);
        last = now;
        inFrame = true;
        let again = false;
        // 帧里抛错照常抛出，循环回到停着：之后的 `wake` 还能排。
        try {
            again = options.frame(now, elapsed);
        } finally {
            inFrame = false;
        }
        // 帧里 `stop` 了不再排；`stop` 之后又 `start` 的，`start` 已经排了一帧。
        if (again && started && pending === null) pending = options.requestFrame(run);
    }

    return {
        start: () => {
            if (pending !== null) options.cancelFrame(pending);
            started = true;
            last = null;
            pending = options.requestFrame(run);
        },
        wake: () => {
            if (!started || inFrame || pending !== null) return;
            last = null;
            pending = options.requestFrame(run);
        },
        stop: () => {
            if (pending !== null) options.cancelFrame(pending);
            pending = null;
            started = false;
        },
    };
}
