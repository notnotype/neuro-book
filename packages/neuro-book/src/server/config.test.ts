import {describe, expect, it} from "bun:test";

import {readServerConfig, ServerConfigError} from "./config";
import type {ServerConfigErrorCode} from "./config";

function errorCode(read: () => unknown): ServerConfigErrorCode | null {
    try {
        read();
        return null;
    } catch (error) {
        if (error instanceof ServerConfigError) return error.code;
        throw error;
    }
}

describe("后端启动参数", () => {
    it("缺省监听 127.0.0.1:4217、RPC 4218、不提供页面，日志在状态根下，相对路径按工作目录解析", () => {
        expect(readServerConfig([], {NBOOK_STATE_ROOT: "state"}, "/work")).toEqual({
            host: "127.0.0.1",
            port: 4217,
            stateRoot: "/work/state",
            logDirectory: "/work/state/logs",
            webRoot: null,
            stopStdin: false,
            rpcPort: 4218,
            allowedOrigins: [],
            projects: {graceMs: 300_000, startMs: 30_000, stopMs: 20_000},
        });
        expect(readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_WEB_ROOT: "dist/web"}, "/work").webRoot).toBe("/work/dist/web");
        expect(readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_WEB_ROOT: " "}, "/work").webRoot).toBeNull();
        expect(readServerConfig(["--stop-stdin"], {NBOOK_STATE_ROOT: "/data", NBOOK_HOST: "::1", NBOOK_PORT: "0"}, "/work"))
            .toMatchObject({host: "::1", port: 0, stateRoot: "/data", stopStdin: true});
    });

    it("拒绝缺少状态根、非回环地址、非法端口与未知参数", () => {
        expect(errorCode(() => readServerConfig([], {}, "/work"))).toBe("missing-state-root");
        expect(errorCode(() => readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_HOST: "0.0.0.0"}, "/work"))).toBe("non-loopback-host");
        for (const port of ["-1", "65536", "80.5", "http"]) {
            expect(errorCode(() => readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_PORT: port}, "/work"))).toBe("invalid-port");
        }
        expect(errorCode(() => readServerConfig(["--watch"], {NBOOK_STATE_ROOT: "/data"}, "/work"))).toBe("unknown-argument");
    });

    it("RPC 端口可改，0 由系统分配；额外页面来源按 URL 规范化", () => {
        expect(readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_RPC_PORT: "0"}, "/work").rpcPort).toBe(0);
        const config = readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_RPC_PORT: "4100", NBOOK_ALLOWED_ORIGINS: " http://127.0.0.1:3000 , http://LOCALHOST:3000/,http://[::1]:3000"}, "/work");
        expect(config.rpcPort).toBe(4100);
        expect(config.allowedOrigins).toEqual(["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]);
    });

    it("项目子进程的时限可调，必须是计时器能表示的正整数毫秒", () => {
        const config = readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_PROJECT_GRACE_MS: "50", NBOOK_PROJECT_START_MS: "2000", NBOOK_PROJECT_STOP_MS: " 300 "}, "/work");
        expect(config.projects).toEqual({graceMs: 50, startMs: 2000, stopMs: 300});
        for (const [name, value] of [["NBOOK_PROJECT_GRACE_MS", "0"], ["NBOOK_PROJECT_START_MS", "1.5"], ["NBOOK_PROJECT_STOP_MS", "2147483648"], ["NBOOK_PROJECT_GRACE_MS", "5m"]] as const) {
            expect(errorCode(() => readServerConfig([], {NBOOK_STATE_ROOT: "/data", [name]: value}, "/work")), `${name}=${value}`).toBe("invalid-duration");
        }
    });

    it("拒绝非法的 RPC 端口，与回环地址之外、非 http、带路径或不是 URL 的额外来源", () => {
        expect(errorCode(() => readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_RPC_PORT: "70000"}, "/work"))).toBe("invalid-port");
        for (const origin of ["http://example.com", "https://127.0.0.1:3000", "http://127.0.0.1:3000/app", "http://user@127.0.0.1:3000", "127.0.0.1:3000", "http://0.0.0.0:3000"]) {
            expect(errorCode(() => readServerConfig([], {NBOOK_STATE_ROOT: "/data", NBOOK_ALLOWED_ORIGINS: origin}, "/work")), origin).toBe("invalid-origin");
        }
    });
});
