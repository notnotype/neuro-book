/**
 * 包内测试用的库实例与计时器。不含断言。
 *
 * `createTestAuth` 与产品装配（第 3 片的 `auth.ts`）用同样的插件与 id 写法：库导出的表结构只取决于这两样，`schema.test.ts` 拿它
 * 现场导出结构与基准比对。产品装配加的别的选项（会话、钩子、Cookie）不影响表结构。
 */

import {betterAuth} from "better-auth";
import {admin, username} from "better-auth/plugins";

import type {IdentityTimers, LibDatabaseConfig} from "../db/connection";

/** 测试用的密钥：库要求至少 32 个字符；不是任何环境里用的值。 */
const TEST_SECRET = "nb-site-identity-test-secret-0123456789abcdef";

export function createTestAuth(database: LibDatabaseConfig) {
    return betterAuth({
        baseURL: "https://site.test",
        secret: TEST_SECRET,
        database,
        advanced: {database: {generateId: "serial"}},
        emailAndPassword: {enabled: true},
        plugins: [username(), admin()],
        logger: {disabled: true},
        telemetry: {enabled: false},
    });
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
