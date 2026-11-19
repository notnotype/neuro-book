/** 按需排帧的帧循环（Spec `ui/layout-drag` 的“帧循环”）：帧由测试的排帧器推进，时间戳由测试给。 */

import {describe, expect, it} from "bun:test";

import {createFrameLoop} from "./frame-loop";

/** 和 `requestAnimationFrame` 同一个合同：排上的回调在下一帧各跑一次，撤掉的不跑。 */
function frames() {
    let next = 1;
    const queue = new Map<number, (now: number) => void>();
    return {
        requestFrame: (run: (now: number) => void): number => {
            const id = next++;
            queue.set(id, run);
            return id;
        },
        cancelFrame: (id: number): void => {
            queue.delete(id);
        },
        pending: (): number => queue.size,
        run: (now: number): void => {
            const runs = [...queue.values()];
            queue.clear();
            for (const run of runs) run(now);
        },
    };
}

describe("createFrameLoop", () => {
    it("返回真才排下一帧，返回假就停；之后 `wake` 排一帧", () => {
        const clock = frames();
        let more = true;
        const seen: number[] = [];
        const loop = createFrameLoop({...clock, frame: (now) => {
            seen.push(now);
            return more;
        }});
        loop.start();
        expect(clock.pending()).toBe(1);
        clock.run(100);
        expect(clock.pending()).toBe(1);
        more = false;
        clock.run(116);
        expect(clock.pending()).toBe(0);
        loop.wake();
        expect(clock.pending()).toBe(1);
        clock.run(500);
        expect(seen).toEqual([100, 116, 500]);
    });

    it("`elapsed`：开始与停过之后的第一帧是 `nominalMs`，连着的帧是间隔，时间戳回退时是 0", () => {
        const clock = frames();
        let more = true;
        const elapsed: number[] = [];
        const loop = createFrameLoop({...clock, nominalMs: 10, frame: (_now, dt) => {
            elapsed.push(dt);
            return more;
        }});
        loop.start();
        clock.run(1000);
        clock.run(1016);
        clock.run(1012);
        more = false;
        clock.run(1030);
        loop.wake();
        clock.run(5000);
        expect(elapsed).toEqual([10, 16, 0, 18, 10]);
    });

    it("缺省的 `nominalMs` 是一帧 60Hz", () => {
        const clock = frames();
        const elapsed: number[] = [];
        const loop = createFrameLoop({...clock, frame: (_now, dt) => {
            elapsed.push(dt);
            return false;
        }});
        loop.start();
        clock.run(0);
        expect(elapsed).toEqual([1000 / 60]);
    });

    it("排着帧时、跑一帧的过程中 `wake` 不另排", () => {
        const clock = frames();
        let calls = 0;
        const loop = createFrameLoop({...clock, frame: () => {
            calls += 1;
            loop.wake();
            return calls < 2;
        }});
        loop.start();
        loop.wake();
        expect(clock.pending()).toBe(1);
        clock.run(0);
        expect(clock.pending()).toBe(1);
        clock.run(16);
        expect(clock.pending()).toBe(0);
        expect(calls).toBe(2);
    });

    it("`stop` 撤掉排着的帧，之后 `wake` 不排；没有 `start` 时 `wake` 也不排", () => {
        const clock = frames();
        const loop = createFrameLoop({...clock, frame: () => true});
        loop.wake();
        expect(clock.pending()).toBe(0);
        loop.start();
        loop.stop();
        expect(clock.pending()).toBe(0);
        loop.wake();
        expect(clock.pending()).toBe(0);
    });

    it("帧里 `stop`：返回真也不再排；`stop` 之后又 `start`，只排一帧", () => {
        const clock = frames();
        let mode: "stop" | "restart" = "stop";
        const loop = createFrameLoop({...clock, frame: () => {
            loop.stop();
            if (mode === "restart") loop.start();
            return true;
        }});
        loop.start();
        clock.run(0);
        expect(clock.pending()).toBe(0);
        mode = "restart";
        loop.start();
        clock.run(16);
        expect(clock.pending()).toBe(1);
    });

    it("帧里抛错：异常照常抛出，之后 `wake` 照常排", () => {
        const clock = frames();
        let fail = true;
        const loop = createFrameLoop({...clock, frame: () => {
            if (fail) throw new Error("boom");
            return false;
        }});
        loop.start();
        expect(() => clock.run(0)).toThrow("boom");
        expect(clock.pending()).toBe(0);
        fail = false;
        loop.wake();
        expect(clock.pending()).toBe(1);
    });
});
