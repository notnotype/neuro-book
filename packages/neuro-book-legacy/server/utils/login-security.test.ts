import {beforeEach, describe, expect, it} from "vitest";
import {assertLoginAttemptAllowed, clearLoginFailures, loginRateLimitedMessage, recordLoginFailure, resetLoginSecurityState} from "nbook/server/utils/login-security";

describe("login security", () => {
    beforeEach(() => {
        resetLoginSecurityState();
        const globals = globalThis as typeof globalThis & {
            createError?: unknown;
        };
        globals.createError = ((input: {statusCode?: number; message?: string}) => {
            const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
            error.statusCode = input.statusCode;
            return error;
        }) as never;
    });

    it("连续失败后会阻断同 IP 登录尝试", () => {
        const now = Date.UTC(2026, 4, 17, 12, 0, 0);

        for (let index = 0; index < 8; index += 1) {
            assertLoginAttemptAllowed("127.0.0.1", "admin", now + index);
            recordLoginFailure("127.0.0.1", "admin", now + index);
        }

        expect(() => assertLoginAttemptAllowed("127.0.0.1", "admin", now + 8)).toThrow(loginRateLimitedMessage);
    });

    it("登录成功后会清理对应失败计数", () => {
        const now = Date.UTC(2026, 4, 17, 12, 0, 0);
        recordLoginFailure("127.0.0.1", "admin", now);
        clearLoginFailures("127.0.0.1", "admin");

        expect(() => assertLoginAttemptAllowed("127.0.0.1", "admin", now + 1)).not.toThrow();
    });
});
