/**
 * 包内测试用的库实例、时钟与计时器。不含断言。
 *
 * `createTestAuth` 直接用产品的装配（`auth.ts` 的 `createIdentityAuth`），不另写一份选项：库导出的表结构取决于插件与 id 写法，
 * `schema.test.ts` 拿它现场导出结构与基准比对。
 */

import {createIdentityAuth} from "../auth";
import type {IdentityTimers, LibDatabaseConfig} from "../db/connection";

/** 测试用的密钥：库要求至少 32 个字符；不是任何环境里用的值。 */
export const TEST_SECRET = "nb-site-identity-test-secret-0123456789abcdef";

/** 测试用的站点地址。 */
export const TEST_SITE_URL = "https://site.test";

/** 库的日志进 `log`（缺省丢进一个没人看的记录里）；时间取墙钟。 */
export function createTestAuth(database: LibDatabaseConfig, log = recordingLog()) {
    return createIdentityAuth({database, siteUrl: TEST_SITE_URL, secret: TEST_SECRET, sessionDays: 30, clock: {now: () => Date.now()}, log});
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

/** 手动触发的计时器：登记了几个、到点的回调由用例自己 `fireAll`。不按时间走，用来测等锁上限与 `close` 的时限。 */
export class ManualTimers implements IdentityTimers {
    readonly #pending = new Map<number, () => void>();
    #next = 0;

    get pending(): number {
        return this.#pending.size;
    }

    setTimeout(callback: () => void, _ms: number): unknown {
        const handle = ++this.#next;
        this.#pending.set(handle, callback);
        return handle;
    }

    clearTimeout(handle: unknown): void {
        this.#pending.delete(handle as number);
    }

    /** 触发当前登记着的全部回调（触发期间新登记的不触发）。 */
    fireAll(): void {
        const due = [...this.#pending];
        this.#pending.clear();
        for (const [, callback] of due) callback();
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
