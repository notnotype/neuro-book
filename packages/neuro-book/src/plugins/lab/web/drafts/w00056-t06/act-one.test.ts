import {describe, expect, test} from "bun:test";

import {createActOne} from "./act-one";
import type {ActOneStage, ActOneTimers} from "./act-one";
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
 * 记账的舞台：桌上的样子就是一个数（停在哪一拍的终态），`play` 挂起到测试放行或被打断；`touch` 后桌上的样子是 99（对不上任何一拍）。
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
    return {stage, log, plays, dirty: () => (desk = 99), desk: () => desk};
}

/** 有了首屏的样子就停在首屏（记一条 `rest -1`）；之后的记录从空的起。 */
async function setup(animate = true) {
    const timers = manualTimers();
    const fake = fakeStage();
    const director = createActOne(fake.stage, {settleMs: 220, animate: () => animate, timers});
    director.prime(-1);
    await flush();
    expect(fake.log).toEqual(["rest -1 settled"]);
    fake.log.length = 0;
    return {...fake, timers, director};
}

async function finishPlay(plays: ReturnType<typeof fakeStage>["plays"]): Promise<void> {
    plays.at(-1)?.finish();
    await flush();
}

describe("第一幕的导演", () => {
    test("目标停稳才演：下一拍从上一拍的终态演起，演完停住", async () => {
        const {director, timers, log, plays} = await setup();
        director.follow(0);
        timers.advance(200);
        await flush();
        expect(log).toEqual([]);
        timers.advance(30);
        await flush();
        expect(log).toEqual(["play 0 from -1"]);
        await finishPlay(plays);
        expect(log.at(-1)).toBe("rest 0 played");
    });

    test("快速滚过的拍不演：一拍一拍摆上，只演停住的那一拍", async () => {
        const {director, timers, log} = await setup();
        director.follow(0);
        timers.advance(100);
        director.follow(1);
        timers.advance(100);
        director.follow(2);
        timers.advance(220);
        await flush();
        expect(log).toEqual(["settle 0 from -1", "settle 1 from 0", "play 2 from 1"]);
    });

    test("演到一半往回滚：打断，按记下的终态摆回去，不重演", async () => {
        const {director, timers, log, plays} = await setup();
        director.follow(0);
        timers.advance(220);
        await flush();
        await finishPlay(plays);
        director.follow(1);
        timers.advance(220);
        await flush();
        expect(log.at(-1)).toBe("play 1 from 0");
        director.follow(0);
        timers.advance(220);
        await flush();
        expect(log.slice(-2)).toEqual(["restore 0 from 0", "rest 0 restored"]);
    });

    test("往回滚隔着几拍：一步摆到记过的那一拍", async () => {
        const {director, timers, log, plays} = await setup();
        for (const beat of [0, 1, 2]) {
            director.follow(beat);
            timers.advance(220);
            await flush();
            await finishPlay(plays);
        }
        director.follow(0);
        timers.advance(220);
        await flush();
        expect(log.slice(-2)).toEqual(["restore 0 from 2", "rest 0 restored"]);
    });

    test("访客动过：动手不摆回，换拍时先摆回上一拍的终态再演", async () => {
        const {director, timers, log, plays, dirty} = await setup();
        director.follow(0);
        timers.advance(220);
        await flush();
        await finishPlay(plays);
        dirty();
        expect(director.touch()).toBe(false);
        await flush();
        expect(log.at(-1)).toBe("rest 0 played");
        director.follow(1);
        timers.advance(220);
        await flush();
        expect(log.slice(-2)).toEqual(["restore 0 from 99", "play 1 from 0"]);
    });

    test("演的时候访客按下：打断；“接着看”从这一拍的开头再演，“摆回去”摆到这一拍的终态", async () => {
        const {director, timers, log, plays, dirty} = await setup();
        director.follow(0);
        timers.advance(220);
        await flush();
        dirty();
        expect(director.touch()).toBe(true);
        await flush();
        director.replay();
        timers.advance(0);
        await flush();
        expect(log.slice(-2)).toEqual(["restore -1 from 99", "play 0 from -1"]);
        dirty();
        director.touch();
        await flush();
        director.settleHere();
        timers.advance(0);
        await flush();
        expect(log.slice(-3)).toEqual(["restore -1 from 99", "settle 0 from -1", "rest 0 restored"]);
        expect(plays.length).toBe(2);
    });

    test("少动效：该演的那一拍也只摆", async () => {
        const {director, timers, log} = await setup(false);
        director.follow(1);
        timers.advance(220);
        await flush();
        expect(log).toEqual(["settle 0 from -1", "settle 1 from 0", "rest 1 settled"]);
    });

    test("目标没变：正在演的不打断，演完照常停住", async () => {
        const {director, timers, log, plays} = await setup();
        director.follow(0);
        timers.advance(220);
        await flush();
        director.follow(1);
        timers.advance(100);
        director.follow(0);
        timers.advance(220);
        await flush();
        await finishPlay(plays);
        expect(log).toEqual(["play 0 from -1", "rest 0 played"]);
    });
});
