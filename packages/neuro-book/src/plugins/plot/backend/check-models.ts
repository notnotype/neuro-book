/**
 * 项目入口这一侧的模型调用（`core/checks/run.ts` 的 `CheckModels`）：经 `nbook.plot/model` 到服务端。把结果分成可重试、立即放弃、撞上输出上限、
 * 取消四类。每次调用有上限：分支上的模型通道没有传输层超时，一个挂住的流会让这一章一直 `plot-check-busy`。
 */

import type {RemoteUse} from "@notnotype/nb-runtime/remote";

import type {AskResult, CheckModels} from "../core/checks/run";
import {ZERO_USAGE} from "../shared/checks";
import type {plotModelContract} from "../shared/model";

export const ASK_TIMEOUT_MS = 5 * 60 * 1000;

/** 重试有用的错误类别；别的（`auth`、`quota`、`context_overflow`、`local`、解析失败的码）重试没有意义。 */
const RETRYABLE = new Set(["network", "rate_limit", "provider"]);
/** 调不到提供方：这个宿主没有模型调用。 */
const NOT_THERE = new Set(["not-provided", "denied", "version-changed", "wrong-caller"]);

export function remoteCheckModels(use: RemoteUse<typeof plotModelContract>): CheckModels {
    return {
        available: async () => {
            const result = await use.available({});
            if (!result.ok) return result.code;
            return result.value.problem;
        },
        ask: async (role, request, signal): Promise<AskResult> => {
            const result = await use.ask({role, system: request.system, user: request.user, answer: request.answer, maxTokens: request.maxTokens}, {signal, timeout: ASK_TIMEOUT_MS});
            if (!result.ok) {
                if (result.code === "cancelled") return {ok: false, failure: "cancelled", kind: "cancelled", usage: ZERO_USAGE};
                return {ok: false, failure: NOT_THERE.has(result.code) ? "fatal" : "retryable", kind: result.code, usage: ZERO_USAGE};
            }
            const outcome = result.value;
            switch (outcome.outcome) {
                case "answer":
                    return {ok: true, answer: outcome.answer, usage: outcome.usage};
                case "length":
                    return {ok: false, failure: "length", kind: "length", usage: outcome.usage};
                case "aborted":
                    return {ok: false, failure: "cancelled", kind: "aborted", usage: outcome.usage};
                case "failed":
                    return {ok: false, failure: RETRYABLE.has(outcome.kind) ? "retryable" : "fatal", kind: outcome.kind, usage: outcome.usage};
            }
        },
    };
}
