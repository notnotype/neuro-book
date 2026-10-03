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
    it("缺省监听 127.0.0.1:3000、不提供页面，日志在状态根下，相对路径按工作目录解析", () => {
        expect(readServerConfig([], {NBOOK_STATE_ROOT: "state"}, "/work")).toEqual({
            host: "127.0.0.1",
            port: 3000,
            stateRoot: "/work/state",
            logDirectory: "/work/state/logs",
            webRoot: null,
            stopStdin: false,
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
});
