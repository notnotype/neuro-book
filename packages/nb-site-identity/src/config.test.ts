/**
 * 账号模块的配置（`site.accounts` 输入一节的“配置”；问题词见 `site.operations` 的失败与恢复一节）。
 */

import {describe, expect, it} from "bun:test";

import {parseIdentityConfig} from "./config";

/** 特征明显的取值：在问题里搜它们，确认没有泄漏。 */
const SECRET = "SECRET-VALUE-4b1d-0123456789abcdef0123456789";

const REQUIRED = {NB_SITE_SESSION_SECRET: SECRET, NB_SITE_IDENTITY_TERMS_VERSION: "2026-11-20"};

function problemsOf(env: Record<string, string | undefined>): unknown[] {
    const result = parseIdentityConfig(env);
    if (result.ok) throw new Error("expected configuration problems");
    return [...result.problems];
}

describe("parseIdentityConfig", () => {
    it("只给两个必填项时其余取缺省值：注册开放、会话 30 天、哈希并发 2、排队 64", () => {
        expect(parseIdentityConfig(REQUIRED)).toEqual({
            ok: true,
            config: {sessionSecret: SECRET, termsVersion: "2026-11-20", registrationOpen: true, sessionDays: 30, hashConcurrency: 2, hashQueue: 64},
        });
        // 空串与没设一样。
        const empty = {...REQUIRED, NB_SITE_IDENTITY_REGISTRATION_OPEN: "", NB_SITE_IDENTITY_SESSION_DAYS: "", NB_SITE_IDENTITY_HASH_CONCURRENCY: "", NB_SITE_IDENTITY_HASH_QUEUE: ""};
        expect(parseIdentityConfig(empty)).toEqual(parseIdentityConfig(REQUIRED));
    });

    it("每一项的边界值都收", () => {
        const result = parseIdentityConfig({
            ...REQUIRED,
            NB_SITE_IDENTITY_TERMS_VERSION: "2024-02-29",
            NB_SITE_IDENTITY_REGISTRATION_OPEN: "false",
            NB_SITE_IDENTITY_SESSION_DAYS: "2",
            NB_SITE_IDENTITY_HASH_CONCURRENCY: "16",
            NB_SITE_IDENTITY_HASH_QUEUE: "0",
        });
        expect(result).toMatchObject({ok: true, config: {termsVersion: "2024-02-29", registrationOpen: false, sessionDays: 2, hashConcurrency: 16, hashQueue: 0}});
        expect(parseIdentityConfig({...REQUIRED, NB_SITE_IDENTITY_SESSION_DAYS: "365", NB_SITE_IDENTITY_HASH_CONCURRENCY: "1", NB_SITE_IDENTITY_HASH_QUEUE: "10000", NB_SITE_IDENTITY_REGISTRATION_OPEN: "true"})).toMatchObject({
            ok: true,
            config: {sessionDays: 365, hashConcurrency: 1, hashQueue: 10_000, registrationOpen: true},
        });
    });

    it("两个必填项没给或给了空串都报 missing，一起报", () => {
        expect(problemsOf({})).toEqual([
            {name: "NB_SITE_SESSION_SECRET", problem: "missing"},
            {name: "NB_SITE_IDENTITY_TERMS_VERSION", problem: "missing"},
        ]);
        expect(problemsOf({NB_SITE_SESSION_SECRET: "", NB_SITE_IDENTITY_TERMS_VERSION: ""})).toEqual(problemsOf({}));
    });

    it.each([
        ["NB_SITE_SESSION_SECRET", "密".repeat(31), "too_short"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "2026-02-29", "bad_format"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "2026-13-01", "bad_format"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "2026-04-31", "bad_format"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "2026-11-00", "bad_format"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "2026-1-20", "bad_format"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "2026-11-20T00:00:00Z", "bad_format"],
        ["NB_SITE_IDENTITY_TERMS_VERSION", "1900-02-29", "bad_format"],
        ["NB_SITE_IDENTITY_REGISTRATION_OPEN", "TRUE", "bad_format"],
        ["NB_SITE_IDENTITY_REGISTRATION_OPEN", "1", "bad_format"],
        ["NB_SITE_IDENTITY_SESSION_DAYS", "1", "out_of_range"],
        ["NB_SITE_IDENTITY_SESSION_DAYS", "366", "out_of_range"],
        ["NB_SITE_IDENTITY_SESSION_DAYS", "30.0", "not_integer"],
        ["NB_SITE_IDENTITY_HASH_CONCURRENCY", "0", "out_of_range"],
        ["NB_SITE_IDENTITY_HASH_CONCURRENCY", "17", "out_of_range"],
        ["NB_SITE_IDENTITY_HASH_CONCURRENCY", "two", "not_integer"],
        ["NB_SITE_IDENTITY_HASH_QUEUE", "-1", "out_of_range"],
        ["NB_SITE_IDENTITY_HASH_QUEUE", "10001", "out_of_range"],
        ["NB_SITE_IDENTITY_HASH_QUEUE", "1e3", "not_integer"],
    ])("%s=%s 报 %s", (name, value, problem) => {
        expect(problemsOf({...REQUIRED, [name]: value})).toEqual([{name, problem}]);
    });

    it("2000-02-29 是真实的日期", () => {
        expect(parseIdentityConfig({...REQUIRED, NB_SITE_IDENTITY_TERMS_VERSION: "2000-02-29"}).ok).toBe(true);
    });

    it("进程环境里有以 BETTER_AUTH_ 开头的变量：每个报 not_allowed，按名字排序，不含取值；空串与没设一样", () => {
        const problems = problemsOf({...REQUIRED, BETTER_AUTH_TELEMETRY: "true", BETTER_AUTH_SECRETS: `1:${SECRET}`, BETTER_AUTH_URL: ""});
        expect(problems).toEqual([
            {name: "BETTER_AUTH_SECRETS", problem: "not_allowed"},
            {name: "BETTER_AUTH_TELEMETRY", problem: "not_allowed"},
        ]);
        expect(JSON.stringify(problems)).not.toContain(SECRET);
        // 只认这个前缀：别的库、名字里只是含有它的变量不算。
        expect(parseIdentityConfig({...REQUIRED, NOT_BETTER_AUTH_SECRET: "x", better_auth_secret: "x"}).ok).toBe(true);
    });

    it("问题收齐了一起报，只有变量名与问题词，不含取值", () => {
        const problems = problemsOf({
            NB_SITE_SESSION_SECRET: "SECRET-VALUE",
            NB_SITE_IDENTITY_TERMS_VERSION: "SECRET-VALUE",
            NB_SITE_IDENTITY_REGISTRATION_OPEN: "SECRET-VALUE",
            NB_SITE_IDENTITY_SESSION_DAYS: "SECRET-VALUE",
            NB_SITE_IDENTITY_HASH_CONCURRENCY: "SECRET-VALUE",
            NB_SITE_IDENTITY_HASH_QUEUE: "SECRET-VALUE",
        });
        expect(problems).toHaveLength(6);
        expect(JSON.stringify(problems)).not.toContain("SECRET-VALUE");
    });
});
