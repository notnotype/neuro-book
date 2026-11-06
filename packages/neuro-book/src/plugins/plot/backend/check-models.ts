/**
 * 项目入口这一侧的模型调用（`core/checks/run.ts` 的 `CheckModels`）：经 `nbook.plot/model` 到服务端。把结果分成可重试、立即放弃、撞上输出上限、
 * 取消四类。挂住的流由模型通道自己的首包与空闲超时结束（docs/specs/models/service.md 输出 16），这里不再加总时长上限：慢但一直在出字的回答是正常的。
 */

import {setTimeout as delay} from "node:timers/promises";

import type {RemoteUse} from "@notnotype/nb-runtime/remote";

import type {AskResult, CheckModels} from "../core/checks/run";
import {ZERO_USAGE} from "../shared/checks";
import type {plotModelContract} from "../shared/model";

const AVAILABLE_TIMEOUT_MS = 30 * 1000;

/** 调不到提供方：这个宿主没有模型调用。 */
const NOT_THERE = new Set(["not-provided", "denied", "version-changed", "wrong-caller"]);

/**
 * 重试前至少等这么久。HTTP 层只发一次（docs/specs/models/service.md 输出 16），`run.ts` 也只重试一次，马上再发多半撞上同一个限流。
 * 等待占着并发名额，所以限流时总并发也跟着降下来。
 */
const RETRY_WAIT_MS = 1000;
/** 服务商要求等得比这还久就算失败：等完这一次也只有一次机会，开发者稍后重跑更划算。 */
const RETRY_AFTER_CAP_MS = 60 * 1000;

/** 中止时 reject。 */
export type RetryWaiter = (ms: number, signal: AbortSignal) => Promise<unknown>;

export function remoteCheckModels(use: RemoteUse<typeof plotModelContract>, wait: RetryWaiter = (ms, signal) => delay(ms, undefined, {signal})): CheckModels {
    return {
        available: async (signal) => {
            const result = await use.available({}, {signal, timeout: AVAILABLE_TIMEOUT_MS});
            if (!result.ok) return result.code;
            return result.value.problem;
        },
        ask: async (role, request, signal): Promise<AskResult> => {
            const result = await use.ask({role, system: request.system, user: request.user, answer: request.answer, maxTokens: request.maxTokens}, {signal});
            if (!result.ok) {
                if (result.code === "cancelled") return {ok: false, failure: "cancelled", kind: "cancelled", usage: ZERO_USAGE};
                return {ok: false, failure: NOT_THERE.has(result.code) ? "fatal" : "retryable", kind: result.code, usage: ZERO_USAGE};
            }
            const outcome = result.value;
            switch (outcome.outcome) {
                case "answer":
                    return {ok: true, answer: outcome.answer, usage: outcome.usage};
                case "length":
                    // 已经是模型的上限：再问一次还是同一个请求，白付一次。
                    return {ok: false, failure: outcome.capped ? "fatal" : "length", kind: "length", usage: outcome.usage};
                case "aborted":
                    return {ok: false, failure: "cancelled", kind: "aborted", usage: outcome.usage};
                case "failed": {
                    const waitMs = Math.max(RETRY_WAIT_MS, outcome.retryAfterMs ?? 0);
                    if (!outcome.retryable || waitMs > RETRY_AFTER_CAP_MS) return {ok: false, failure: "fatal", kind: outcome.kind, usage: outcome.usage};
                    try {
                        await wait(waitMs, signal);
                    } catch {
                        // 只有中止会让等待 reject；这次失败的用量照记。
                        return {ok: false, failure: "cancelled", kind: outcome.kind, usage: outcome.usage};
                    }
                    return {ok: false, failure: "retryable", kind: outcome.kind, usage: outcome.usage};
                }
            }
        },
    };
}
