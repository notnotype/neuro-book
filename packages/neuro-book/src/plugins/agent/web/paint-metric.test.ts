/**
 * 首屏指标（docs/specs/agent/conversation.md 输出 56）：起点与画出、有归属才记、隐藏过不记、换了起点作废、超过阈值另写警告。
 * 宿主换成照 `SessionHost.painting` 合同写的替身：真实宿主怎样换这两个对象由 `session-host.test.ts` 覆盖，这里只测计时与条件。
 */
import {describe, expect, test} from "bun:test";
import {computed, shallowRef} from "vue";

import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import {PAINT_SLOW_MS, watchPaint} from "./paint-metric";
import type {PaintRecord} from "./paint-metric";
import type {PaintStart} from "./session-host";

function setup(options: {owner?: SessionOwner | null; visible?: boolean} = {}) {
    const painting = shallowRef<PaintStart | null>(null);
    const owner = shallowRef<SessionOwner | null | undefined>(options.owner === undefined ? {plugin: "nbook.bots", id: "lyra"} : options.owner);
    const messages = shallowRef<readonly unknown[]>([]);
    let now = 1_000;
    let visible = options.visible ?? true;
    const hiddenListeners = new Set<() => void>();
    const frames: Array<() => void> = [];
    const records: Array<{level: "info" | "warning"; record: PaintRecord}> = [];
    const stop = watchPaint({
        host: {painting, owner: computed(() => owner.value), ctx: computed(() => ({messages: messages.value}))},
        position: "desk",
        now: () => now,
        afterPaint: () => new Promise<void>((resolve) => frames.push(resolve)),
        page: {visible: () => visible, onHidden: (listener) => {
            hiddenListeners.add(listener);
            return () => hiddenListeners.delete(listener);
        }},
        record: (level, record) => void records.push({level, record}),
    });
    /** 画完下一帧（`afterPaint` 完成）之后。 */
    const paint = async () => {
        for (const resolve of frames.splice(0)) resolve();
        await Promise.resolve();
        await Promise.resolve();
    };
    return {
        painting, owner, messages, records, stop, paint,
        start: (sessionId = "bot-lyra", reattach = false) => {
            painting.value = {sessionId, startedAt: now, reattach, loaded: null};
        },
        loaded: (events: number) => {
            painting.value = {...painting.value!, loaded: {events}};
        },
        advance: (ms: number) => {
            now += ms;
        },
        hide: () => {
            visible = false;
            for (const listener of hiddenListeners) listener();
        },
        show: () => {
            visible = true;
        },
    };
}

describe("watchPaint", () => {
    test("有归属的会话：从开始打开到画出下一帧记一条 info，带位置、事件数与画出的消息条数；画出之前不记", async () => {
        const s = setup();
        s.start("bot-lyra", true);
        s.advance(300);
        s.messages.value = [1, 2, 3];
        s.loaded(42);
        expect(s.records).toEqual([]);
        s.advance(20);
        await s.paint();
        expect(s.records).toEqual([{level: "info", record: {sessionId: "bot-lyra", owner: "nbook.bots", position: "desk", reattach: true, events: 42, messages: 3, ms: 320}}]);
        s.stop();
    });

    test(`超过 ${String(PAINT_SLOW_MS)} 毫秒另写一条警告`, async () => {
        const s = setup();
        s.start();
        s.advance(PAINT_SLOW_MS + 1);
        s.loaded(1);
        await s.paint();
        expect(s.records.map((item) => item.level)).toEqual(["info", "warning"]);
        s.stop();
    });

    test("没有归属的会话、期间隐藏过、开始时就隐藏着、画出之前换了起点：都不记", async () => {
        const plain = setup({owner: null});
        plain.start();
        plain.loaded(1);
        await plain.paint();
        expect(plain.records).toEqual([]);

        const hidden = setup();
        hidden.start();
        hidden.hide();
        hidden.show();
        hidden.loaded(1);
        await hidden.paint();
        expect(hidden.records).toEqual([]);

        const background = setup({visible: false});
        background.start();
        background.show();
        background.loaded(1);
        await background.paint();
        expect(background.records).toEqual([]);

        const replaced = setup();
        replaced.start("bot-lyra");
        replaced.loaded(1);
        replaced.start("bot-vega");
        await replaced.paint();
        expect(replaced.records).toEqual([]);
        for (const s of [plain, hidden, background, replaced]) s.stop();
    });

    test("停止后不再记", async () => {
        const s = setup();
        s.stop();
        s.start();
        s.loaded(1);
        await s.paint();
        expect(s.records).toEqual([]);
    });
});
