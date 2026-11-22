/**
 * 首屏指标（docs/specs/agent/conversation.md 输出 56）：有归属的会话，从宿主开始打开到快照与路径都应用完、视图画出下一帧的耗时。
 *
 * 宿主（`session-host.ts` 的 `painting`）在 `openHere` 开始时换一个新对象，应用完再换一个带 `loaded` 的；这里认第一个对象作起点，
 * 等第二个出现、视图画出下一帧（`afterPaint`）再记。中途换了起点（又开了一次、换了会话）作废。后台页不跑动画帧，量到的是等待切回来
 * 的时间，所以起点与画出时页面都可见、期间没有隐藏过才记。
 *
 * 碰 DOM 的部分（动画帧、页面可见性）由调用方注入：本文件只给 `ConversationHost.vue` 用，不进 `plugin.ts`（后端 tsc 范围没有 DOM）。
 */

import {watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import type {PaintStart} from "./session-host";

/** 超过它另写一条警告，与后端打开耗时的阈值相同（bots/main-conversation.md 输出 6）。 */
export const PAINT_SLOW_MS = 2_000;

export type PaintPosition = "view" | "page" | "desk";

export interface PaintRecord {
    readonly sessionId: string;
    readonly owner: string;
    readonly position: PaintPosition;
    readonly reattach: boolean;
    readonly events: number;
    readonly messages: number;
    readonly ms: number;
}

export interface PaintMetricOptions {
    readonly host: {readonly painting: ShallowRef<PaintStart | null>; readonly owner: ComputedRef<SessionOwner | null | undefined>; readonly ctx: ComputedRef<{readonly messages: readonly unknown[]}>};
    readonly position: PaintPosition;
    readonly now: () => number;
    /** 视图画出下一帧之后完成。 */
    readonly afterPaint: () => Promise<void>;
    readonly page: {visible(): boolean; onHidden(listener: () => void): () => void};
    /** 记诊断：`level` 是 info 时 `agent.conversation-painted`，warning 时 `agent.conversation-paint-slow`。 */
    readonly record: (level: "info" | "warning", record: PaintRecord) => void;
}

/** 开始看；交回停止函数。挂上时已经在读的那次照样跟（起点的可见性按挂上时算）。 */
export function watchPaint(options: PaintMetricOptions): () => void {
    let started: PaintStart | null = null;
    let hidden = false;
    const stopHidden = options.page.onHidden(() => {
        hidden = true;
    });
    const stopWatch = watch(options.host.painting, (paint) => {
        if (paint === null) return;
        if (paint.loaded === null) {
            started = paint;
            hidden = !options.page.visible();
            return;
        }
        const start = started;
        if (start === null || start.sessionId !== paint.sessionId || start.startedAt !== paint.startedAt) return;
        started = null;
        void options.afterPaint().then(() => {
            if (options.host.painting.value !== paint || hidden || !options.page.visible()) return;
            const owner = options.host.owner.value;
            if (owner === null || owner === undefined) return;
            const record: PaintRecord = {
                sessionId: paint.sessionId,
                owner: owner.plugin,
                position: options.position,
                reattach: paint.reattach,
                events: paint.loaded!.events,
                messages: options.host.ctx.value.messages.length,
                ms: options.now() - paint.startedAt,
            };
            options.record("info", record);
            if (record.ms > PAINT_SLOW_MS) options.record("warning", record);
        });
    }, {flush: "sync", immediate: true});
    return () => {
        stopWatch();
        stopHidden();
    };
}
