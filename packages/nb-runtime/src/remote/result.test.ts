/**
 * `orThrow`：只取值（runtime/plugin-channel.md 输出第 1 条、验收 20）。
 */

import {describe, expect, it} from "bun:test";

import {orThrow, RemoteCallError} from "./remote";
import type {RemoteFailure, RemoteResult} from "./remote";

function thrown(result: RemoteResult<unknown, string>): RemoteCallError {
    try {
        orThrow(result);
    } catch (error) {
        if (error instanceof RemoteCallError) return error;
        throw error;
    }
    throw new Error("orThrow 没有抛出");
}

describe("Spec runtime/plugin-channel 验收 20：只取值", () => {
    it("成功给值，值本身是 null 也照样返回", () => {
        expect(orThrow({ok: true, value: 3})).toBe(3);
        expect(orThrow({ok: true, value: null})).toBeNull();
    });

    it("路由层失败、带原因的 unknown-outcome、业务失败都抛 RemoteCallError，failure 就是原结果", () => {
        const failures: ReadonlyArray<RemoteFailure<string>> = [
            {ok: false, code: "unavailable", detail: "本实例没有提供 sample/read"},
            {ok: false, code: "unknown-outcome", cause: "disconnected"},
            {ok: false, code: "conflict", detail: {revision: 7}},
        ];
        for (const failure of failures) {
            const error = thrown(failure);
            expect(error.failure).toBe(failure);
            expect(error.code).toBe(failure.code);
            expect(error.name).toBe("RemoteCallError");
        }
        expect(thrown(failures[0]!).message).toBe("远程调用失败 unavailable：本实例没有提供 sample/read");
        expect(thrown(failures[1]!).message).toBe("远程调用失败 unknown-outcome（disconnected）");
        // 失败结果放在 failure 里，不占用标准的 Error.cause。
        expect(thrown(failures[1]!).cause).toBeUndefined();
    });
});
