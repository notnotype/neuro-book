import {describe, expect, test} from "bun:test";

import {createActOne, phaseText} from "./act-one";
import type {ActOnePhase, ActOneStage, ActOneTimers} from "./act-one";
import {Interrupted} from "./motion";

/** 手动走的计时器：`advance` 之前什么都不触发。 */
function manualTimers(): ActOneTimers & {advance(ms: number): void} {
    let now = 0;
    let pending: Array<{readonly id: number; readonly at: number; readonly run: () => void}> = [];
    let next = 0;
    return {
        set(run, ms) {
            next += 1;
            pending.push({id: next, at: now + ms, run});
            return next;
        },
        clear(handle) {
            pending = pending.filter((item) => item.id !== handle);
        },
        advance(ms) {
            now += ms;
            const due = pending.filter((item) => item.at <= now);
            pending = pending.filter((item) => item.at > now);
            for (const item of due) item.run();
        },
    };
}

const flush = async (): Promise<void> => {
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
};

/**
 * 记账的舞台：桌上的样子就是一个数（停在哪一拍的终态），`play` 挂起到测试放行或被打断；访客动过手后桌上的样子是 99（对不上任何一拍）。
 */
function fakeStage() {
    let desk = -1;
    const log: string[] = [];
    const plays: Array<{readonly beat: number; finish(): void}> = [];
    const stage: ActOneStage<number> = {
        play(beat, signal) {
            log.push(`play ${String(beat)} from ${String(desk)}`);
            return new Promise((resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Interrupted()), {once: true});
                plays.push({beat, finish: () => {
                    desk = beat;
                    resolve();
                }});
            });
        },
        settle(beat) {
            log.push(`settle ${String(beat)} from ${String(desk)}`);
            desk = beat;
            return Promise.resolve();
        },
        capture: () => Promise.resolve(desk),
        restore(state) {
            log.push(`restore ${String(state)} from ${String(desk)}`);
            desk = state;
            return Promise.resolve();
        },
        tidy: () => undefined,
        rest(beat, how) {
            log.push(`rest ${String(beat)} ${how}`);
        },
    };
    return {stage, log, plays, dirty: () => (desk = 99)};
}

/** 四拍；演完一拍停 700ms（少动效时 3000ms）再演下一拍。 */
async function setup(animate = true) {
    const timers = manualTimers();
    const fake = fakeStage();
    const phases: ActOnePhase[] = [];
    const director = createActOne(fake.stage, {
        beats: 4,
        animate: () => animate,
        gap: (_beat, moving) => (moving ? 700 : 3000),
        onPhase: (phase) => phases.push(phase),
        timers,
    });
    director.prime(-1);
    await flush();
    return {...fake, timers, director, phases: () => phases.map(phaseText)};
}

/** 放行正在演的那一拍。 */
async function finishPlay(plays: ReturnType<typeof fakeStage>["plays"]): Promise<void> {
    plays.at(-1)?.finish();
    await flush();
}

describe("第一幕的导演", () => {
    test("连播：一拍演完停一会儿，从它的终态接着演下一拍，演到最后一拍就停", async () => {
        const {director, timers, log, plays} = await setup();
        director.play(0);
        await flush();
        expect(log).toEqual(["play 0 from -1"]);
        await finishPlay(plays);
        expect(log.at(-1)).toBe("rest 0 played");
        timers.advance(699);
        await flush();
        expect(log.at(-1)).toBe("rest 0 played");
        timers.advance(1);
        await flush();
        expect(log.at(-1)).toBe("play 1 from 0");
        for (let beat = 1; beat < 4; beat += 1) {
            await finishPlay(plays);
            timers.advance(700);
            await flush();
        }
        expect(log.slice(-2)).toEqual(["play 3 from 2", "rest 3 played"]);
        timers.advance(5000);
        await flush();
        expect(log.at(-1)).toBe("rest 3 played");
        expect(director.state()).toEqual({at: 3, finished: true});
    });

    test("指令在首屏的样子交来之前就排着，交来以后才开始", async () => {
        const timers = manualTimers();
        const fake = fakeStage();
        const director = createActOne(fake.stage, {beats: 4, animate: () => true, gap: () => 700, timers});
        director.play(0);
        await flush();
        expect(fake.log).toEqual([]);
        director.prime(-1);
        await flush();
        expect(fake.log).toEqual(["play 0 from -1"]);
    });

    test("点后面的章节：路过的拍一拍一拍快速摆上，只演点中的那一拍", async () => {
        const {director, log, phases} = await setup();
        director.play(2);
        await flush();
        expect(log).toEqual(["settle 0 from -1", "settle 1 from 0", "play 2 from 1"]);
        expect(phases()).toEqual(["settle 0", "settle 1", "play 2"]);
    });

    test("演到一半点前面的章节：打断，按记下的终态一步摆回去，再从那一拍的开头演", async () => {
        const {director, timers, log, plays, phases} = await setup();
        director.play(0);
        await flush();
        await finishPlay(plays);
        timers.advance(700);
        await flush();
        await finishPlay(plays);
        timers.advance(700);
        await flush();
        expect(log.at(-1)).toBe("play 2 from 1");
        director.play(0);
        await flush();
        expect(log.slice(-2)).toEqual(["restore -1 from 1", "play 0 from -1"]);
        expect(phases().slice(-3)).toEqual(["interrupted", "restore -1", "play 0"]);
    });

    test("暂停：演到一半停下不再往下演；接着演从这一拍的开头再演（先摆回上一拍的终态）", async () => {
        const {director, timers, log, plays, phases} = await setup();
        director.play(0);
        await flush();
        await finishPlay(plays);
        timers.advance(700);
        await flush();
        director.pause();
        await flush();
        expect(phases().at(-1)).toBe("paused");
        timers.advance(10_000);
        await flush();
        expect(log.at(-1)).toBe("play 1 from 0");
        director.resume();
        await flush();
        expect(log.slice(-2)).toEqual(["restore 0 from 0", "play 1 from 0"]);
    });

    test("两拍之间暂停：不演下一拍；接着演从下一拍演起", async () => {
        const {director, timers, log, plays, phases} = await setup();
        director.play(0);
        await flush();
        await finishPlay(plays);
        director.pause();
        expect(phases().at(-1)).toBe("paused");
        timers.advance(10_000);
        await flush();
        expect(log.at(-1)).toBe("rest 0 played");
        director.resume();
        await flush();
        expect(log.at(-1)).toBe("play 1 from 0");
    });

    test("访客演到一半动了工作台：演示停下；接着演时从访客摆的样子摆回上一拍的终态，再演这一拍", async () => {
        const {director, timers, log, plays, dirty} = await setup();
        director.play(0);
        await flush();
        await finishPlay(plays);
        timers.advance(700);
        await flush();
        dirty();
        director.touch();
        await flush();
        timers.advance(10_000);
        await flush();
        expect(log.at(-1)).toBe("play 1 from 0");
        director.resume();
        await flush();
        expect(log.slice(-2)).toEqual(["restore 0 from 99", "play 1 from 0"]);
    });

    test("访客在两拍之间动了工作台：接着演时先摆回刚演完那一拍的终态，再演下一拍", async () => {
        const {director, log, plays, dirty} = await setup();
        director.play(0);
        await flush();
        await finishPlay(plays);
        dirty();
        director.touch();
        await flush();
        director.resume();
        await flush();
        expect(log.slice(-2)).toEqual(["restore 0 from 99", "play 1 from 0"]);
    });

    test("演完以后访客动手还算演完，接着演什么都不做；从头再看先摆回首屏的样子", async () => {
        const {director, timers, log, plays, dirty} = await setup();
        director.play(3);
        await flush();
        await finishPlay(plays);
        dirty();
        director.touch();
        await flush();
        expect(director.state().finished).toBe(true);
        director.resume();
        timers.advance(10_000);
        await flush();
        expect(log.at(-1)).toBe("rest 3 played");
        director.play(0);
        await flush();
        expect(log.slice(-2)).toEqual(["restore -1 from 99", "play 0 from -1"]);
        expect(director.state().finished).toBe(false);
    });

    test("少动效：每一拍都只摆，拍与拍之间停得久", async () => {
        const {director, timers, log} = await setup(false);
        director.play(0);
        await flush();
        expect(log).toEqual(["settle 0 from -1", "rest 0 settled"]);
        timers.advance(2999);
        await flush();
        expect(log.at(-1)).toBe("rest 0 settled");
        timers.advance(1);
        await flush();
        expect(log.slice(-2)).toEqual(["settle 1 from 0", "rest 1 settled"]);
    });
});
