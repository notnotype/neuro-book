import {describe, expect, it} from "bun:test";

import {HTTP_DRAIN_LIMIT_MS, HttpAdmission, HttpAdmissionRejected} from "./admission";
import type {DrainClock} from "./admission";

/** 只在测试显式触发时到期的排空时钟。 */
function manualClock(): DrainClock & {expire(): void; scheduled: number[]} {
    let task: (() => void) | null = null;
    const scheduled: number[] = [];
    return {
        scheduled,
        schedule(next, milliseconds) {
            task = next;
            scheduled.push(milliseconds);
            return () => {
                task = null;
            };
        },
        expire() {
            task?.();
        },
    };
}

async function rejection(promise: Promise<unknown>): Promise<HttpAdmissionRejected> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof HttpAdmissionRejected) return error;
        throw error;
    }
    throw new Error("期望准入被拒绝");
}

describe("HTTP 准入", () => {
    it("就绪前到达的请求等待就绪后才放行", async () => {
        const admission = new HttpAdmission();
        let admitted = false;
        const pending = admission.admit().then((ticket) => {
            admitted = true;
            return ticket;
        });
        await Promise.resolve();
        expect(admitted).toBe(false);
        expect(admission.active).toBe(1);
        admission.ready();
        (await pending).release();
        expect(admission.active).toBe(0);
    });

    it("启动失败时等待中与之后的请求都以 startup-failed 拒绝，且不留在途计数", async () => {
        const admission = new HttpAdmission();
        const waiting = rejection(admission.admit());
        const failure = new Error("必需插件失败");
        admission.failed(failure);
        const first = await waiting;
        expect(first.code).toBe("startup-failed");
        expect(first.cause).toBe(failure);
        expect((await rejection(admission.admit())).code).toBe("startup-failed");
        expect(admission.active).toBe(0);
    });

    it("排空期间新请求以 stopping 拒绝；重复 release 只计一次；全部在途结束才结算", async () => {
        const admission = new HttpAdmission();
        admission.ready();
        const first = await admission.admit();
        const second = await admission.admit();
        let drained = false;
        const draining = admission.drain().then(() => {
            drained = true;
        });
        expect((await rejection(admission.admit())).code).toBe("stopping");
        first.release();
        first.release();
        await Promise.resolve();
        expect(drained).toBe(false);
        second.release();
        await draining;
        expect(drained).toBe(true);
        expect(admission.drain()).toBe(admission.drain());
    });

    it("就绪前等待的请求在排空开始时以 stopping 拒绝", async () => {
        const admission = new HttpAdmission();
        const waiting = rejection(admission.admit());
        await admission.drain();
        expect((await waiting).code).toBe("stopping");
    });

    it("事件流移出等待：排空开始即关闭，不等它结束", async () => {
        const admission = new HttpAdmission();
        admission.ready();
        const ticket = await admission.admit();
        let closed = false;
        ticket.stream(() => {
            closed = true;
        });
        expect(admission.active).toBe(0);
        await admission.drain();
        expect(closed).toBe(true);
        expect(() => ticket.stream(() => undefined)).toThrow();
    });

    it("排空开始后才登记的事件流立即关闭", async () => {
        const admission = new HttpAdmission();
        admission.ready();
        const ticket = await admission.admit();
        const draining = admission.drain();
        let closed = false;
        ticket.stream(() => {
            closed = true;
        });
        await draining;
        expect(closed).toBe(true);
    });

    it("在途请求超过上限时排空以未完成拒绝，事件流关闭失败也计入", async () => {
        const clock = manualClock();
        const admission = new HttpAdmission({clock});
        admission.ready();
        await admission.admit();
        const streamTicket = await admission.admit();
        const closeFailure = new Error("事件流关闭失败");
        streamTicket.stream(() => {
            throw closeFailure;
        });
        const draining = admission.drain();
        clock.expire();
        let failure: unknown;
        try {
            await draining;
        } catch (error) {
            failure = error;
        }
        expect(clock.scheduled).toEqual([HTTP_DRAIN_LIMIT_MS]);
        expect(failure).toBeInstanceOf(AggregateError);
        const messages = (failure as AggregateError).errors.map((error: unknown) => (error as Error).message);
        expect(messages).toContain(closeFailure.message);
        expect(messages).toContain(`HTTP 排空超过 ${String(HTTP_DRAIN_LIMIT_MS)}ms`);
    });
});
