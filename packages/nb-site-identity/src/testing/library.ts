/**
 * 包内测试用的库实例、时钟与计时器。不含断言。
 *
 * `createTestAuth` 直接用产品的装配（`auth.ts` 的 `createIdentityAuth`），不另写一份选项：库导出的表结构取决于插件与 id 写法，
 * `schema.test.ts` 拿它现场导出结构与基准比对。
 */

import {createIdentityAuth} from "../auth";
import type {IdentityConnection, IdentityTimers} from "../db/connection";

/** 测试用的密钥：库要求至少 32 个字符；不是任何环境里用的值。 */
export const TEST_SECRET = "nb-site-identity-test-secret-0123456789abcdef";

/** 测试用的站点地址。 */
export const TEST_SITE_URL = "https://site.test";

/** 测试用的条款版本。 */
export const TEST_TERMS_VERSION = "2026-11-20";

/** 库的日志进 `log`（缺省丢进一个没人看的记录里）；时间取墙钟。 */
export function createTestAuth(conn: IdentityConnection, log = recordingLog()) {
    return createIdentityAuth({conn, siteUrl: TEST_SITE_URL, secret: TEST_SECRET, sessionDays: 30, termsVersion: TEST_TERMS_VERSION, clock: {now: () => Date.now()}, log});
}

/** 手动拨的时钟：从 `start` 起，只在用例调 `advance` 或 `set` 时走。 */
export class ManualClock {
    #now: number;

    constructor(start: number) {
        this.#now = start;
    }

    now(): number {
        return this.#now;
    }

    advance(ms: number): number {
        this.#now += ms;
        return this.#now;
    }

    set(ms: number): void {
        this.#now = ms;
    }
}

/**
 * 手动拨的计时器：时间只在用例调 `advance` 时走，登记的回调按登记时给的延迟到期。用来测等锁上限与 `close` 的时限：用例能核对
 * “差 1 毫秒时还在等、到点时才拒绝”，改了上限的缺省值用例就失败（omp 实现审查第 11 条）。
 */
export class ManualTimers implements IdentityTimers {
    readonly #pending = new Map<number, {readonly due: number; readonly callback: () => void}>();
    #now = 0;
    #next = 0;

    /** 登记着、还没到期也没被清掉的个数。 */
    get pending(): number {
        return this.#pending.size;
    }

    setTimeout(callback: () => void, ms: number): unknown {
        const handle = ++this.#next;
        this.#pending.set(handle, {due: this.#now + ms, callback});
        return handle;
    }

    clearTimeout(handle: unknown): void {
        this.#pending.delete(handle as number);
    }

    /**
     * 往前拨 `ms` 毫秒，触发到期的回调：按到期的先后，同时到期的按登记的先后。触发期间新登记的从拨完之后的时间算起，不在这一次里
     * 触发；被前一个回调清掉的不再触发。
     */
    advance(ms: number): void {
        this.#now += ms;
        const due = [...this.#pending].filter(([, timer]) => timer.due <= this.#now).sort(([leftHandle, left], [rightHandle, right]) => left.due - right.due || leftHandle - rightHandle);
        for (const [handle, timer] of due) {
            if (!this.#pending.delete(handle)) continue;
            timer.callback();
        }
    }
}

/** 记下的日志行，只留事件名与字段。 */
export interface RecordedLog {
    readonly level: "info" | "warn" | "error";
    readonly event: string;
    readonly fields?: Readonly<Record<string, unknown>>;
}

export function recordingLog(): {readonly lines: RecordedLog[]; info: LogFn; warn: LogFn; error: LogFn} {
    const lines: RecordedLog[] = [];
    const at =
        (level: RecordedLog["level"]): LogFn =>
        (event, _message, fields) =>
            lines.push({level, event, ...(fields === undefined ? {} : {fields})});
    return {lines, info: at("info"), warn: at("warn"), error: at("error")};
}

type LogFn = (event: string, message: string, fields?: Readonly<Record<string, unknown>>) => void;
