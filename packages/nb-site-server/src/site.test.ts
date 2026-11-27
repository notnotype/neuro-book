/**
 * `responseFailed`（`site.operations` 输出 8 的 `http.response_failed`）：交给 `Bun.serve` 的 `error` 回调。在真实进程里造不出
 * “`fetch` 返回之后生成响应时出错”而不加测试专用的分支，这里直接调用回调，看它回什么、记什么。
 * “标准输出与标准错误都不出现不是 JSON 的行”靠 `serve.ts` 里 `Bun.serve` 的 `development: false` 与有这个回调，这里测不到。
 */

import {describe, expect, it} from "bun:test";

import {createLogger} from "./log";
import {responseFailed} from "./site";

/** 错误的说明里带着绝对路径与请求内容：这些都不能进日志与响应体。 */
const SECRET_MESSAGE = "EACCES: permission denied, open '/srv/site/web/assets/app-abc123.js' token=s3cr3t";

function collect(): {readonly lines: Readonly<Record<string, unknown>>[]; readonly raw: string[]; readonly handler: (error: Error) => Response} {
    const raw: string[] = [];
    const handler = responseFailed(createLogger((line) => raw.push(line), {}));
    return {
        raw,
        handler,
        get lines() {
            return raw.map((line) => JSON.parse(line) as Readonly<Record<string, unknown>>);
        },
    };
}

describe("responseFailed（输出 8）", () => {
    it("回 500 与 {code: internal}，记一行 http.response_failed：带错误类型与错误码，不带错误的说明", async () => {
        const log = collect();
        const error = Object.assign(new TypeError(SECRET_MESSAGE), {code: "EACCES"});
        const response = log.handler(error);
        expect({status: response.status, type: response.headers.get("Content-Type")?.split(";")[0], body: await response.text()}).toEqual({
            status: 500,
            type: "application/json",
            body: '{"code":"internal"}',
        });
        expect(log.raw).toHaveLength(1);
        expect(log.lines[0]).toMatchObject({level: "error", event: "http.response_failed", errorType: "TypeError", errorCode: "EACCES"});
        expect(log.raw[0]!.includes("/srv/site")).toBe(false);
        expect(log.raw[0]!.includes("s3cr3t")).toBe(false);
    });

    it("错误不带字符串的错误码时不写 errorCode", () => {
        const log = collect();
        log.handler(Object.assign(new Error(SECRET_MESSAGE), {code: 13}));
        log.handler(new RangeError(SECRET_MESSAGE));
        expect(log.lines.map((line) => ({event: line.event, errorType: line.errorType, hasCode: "errorCode" in line}))).toEqual([
            {event: "http.response_failed", errorType: "Error", hasCode: false},
            {event: "http.response_failed", errorType: "RangeError", hasCode: false},
        ]);
    });
});
