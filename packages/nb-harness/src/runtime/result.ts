/**
 * 便捷层（docs/specs/harness/runtime.md 输出 18）：各模块的方法都以 `{ok, value} | {ok: false, code, detail}` 报告业务失败，这是合同；
 * 脚本与教学代码不想每一步判 `ok` 时用 `unwrap`，失败变成带同一个 `code` 与 `detail` 的异常。
 */

import type {Diagnostic} from "../profile/profile";

export class HarnessError extends Error {
    constructor(readonly code: string, readonly detail: string, readonly diagnostics: readonly Diagnostic[] = []) {
        super(`${code}: ${detail}`);
        this.name = "HarnessError";
    }
}

type AnyResult<T> = {ok: true; value: T} | {ok: false; code: string; detail: string; diagnostics?: readonly Diagnostic[]};

export function unwrap<T>(result: AnyResult<T>): T {
    if (result.ok) return result.value;
    throw new HarnessError(result.code, result.detail, result.diagnostics ?? []);
}
