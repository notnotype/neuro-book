/**
 * 回环与来源（docs/specs/runtime/server-host.md 验收 11）：监听地址与来源各用自己的写法，`::1` 的监听与 `[::1]` 的来源都认；
 * 非回环与格式不对的值以稳定的码拒绝，消息带上调用方给的说明。
 */

import {describe, expect, it} from "bun:test";

import {assertLoopbackHost, assertLoopbackOrigins, HostConfigError, loopbackOrigins, parseAllowedOrigins} from "./loopback";

const codeOf = (run: () => unknown): string | null => {
    try {
        run();
        return null;
    } catch (error) {
        return error instanceof HostConfigError ? error.code : "not-host-config-error";
    }
};

describe("监听地址", () => {
    it("三种回环写法放行，IPv6 不带方括号；别的地址拒绝，消息带调用方的说明", () => {
        for (const host of ["127.0.0.1", "::1", "localhost"]) expect(codeOf(() => assertLoopbackHost(host, host))).toBeNull();
        for (const host of ["0.0.0.0", "127.0.0.2", "[::1]", "192.168.1.2", ""]) expect(codeOf(() => assertLoopbackHost(host, host))).toBe("non-loopback-host");
        expect(() => assertLoopbackHost("0.0.0.0", "ACME_HOST=0.0.0.0")).toThrow("收到 ACME_HOST=0.0.0.0");
    });
});

describe("页面来源", () => {
    it("回环上的 http 来源规范化后交回，IPv6 带方括号；空值是空列表", () => {
        expect(parseAllowedOrigins(" http://127.0.0.1:3000 , http://[::1]:3000,http://localhost:3000/", "ACME_ORIGINS")).toEqual(["http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost:3000"]);
        expect(parseAllowedOrigins(undefined, "ACME_ORIGINS")).toEqual([]);
        expect(parseAllowedOrigins(" , ", "ACME_ORIGINS")).toEqual([]);
    });

    it("不是 URL、不是 http、不在回环上、带用户名路径查询或片段的都拒绝", () => {
        for (const value of ["not a url", "https://127.0.0.1:3000", "http://evil.example", "http://[::2]:3000", "http://u@127.0.0.1:3000", "http://127.0.0.1:3000/app", "http://127.0.0.1:3000?x=1", "http://127.0.0.1:3000#x"]) {
            expect(codeOf(() => parseAllowedOrigins(value, "ACME_ORIGINS"))).toBe("invalid-origin");
        }
        expect(() => parseAllowedOrigins("http://evil.example", "ACME_ORIGINS")).toThrow("ACME_ORIGINS 只能列回环地址上的 http 来源");
    });

    it("第二道核对：只认规范化的回环来源", () => {
        expect(codeOf(() => assertLoopbackOrigins(["http://127.0.0.1:3000", "http://[::1]:3000"], "origins"))).toBeNull();
        for (const origin of ["http://evil.example", "http://127.0.0.1:3000/", "HTTP://127.0.0.1:3000", "garbage"]) expect(codeOf(() => assertLoopbackOrigins([origin], "origins"))).toBe("invalid-origin");
    });

    it("一个端口在三个回环别名上的来源", () => {
        expect(loopbackOrigins("http://127.0.0.1:4217/")).toEqual(["http://127.0.0.1:4217", "http://localhost:4217", "http://[::1]:4217"]);
        expect(loopbackOrigins("http://localhost/")).toEqual(["http://127.0.0.1", "http://localhost", "http://[::1]"]);
    });
});
