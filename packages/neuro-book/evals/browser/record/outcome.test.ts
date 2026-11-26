import {describe, expect, test} from "bun:test";

import {classifyOutcome, isCounted} from "./outcome";
import type {OutcomeFacts} from "./outcome";
import type {GatewayCallRecord} from "./schema";

function call(upstream: GatewayCallRecord["upstream"]): GatewayCallRecord {
    return {model: "m", reasoningEffort: "medium", maxTokens: null, tools: 3, images: 0, messages: 2, stream: false, upstream, usage: null, startedAt: 0, endedAt: 1};
}

const base: OutcomeFacts = {startupError: null, siteError: null, executor: {status: "completed", error: null}, executorKilledAtBackstop: false, chromeExit: null, gatewayCalls: [call(200)], budgetExceeded: false};

describe("结局表", () => {
    const cases: ReadonlyArray<readonly [string, Partial<OutcomeFacts>, string, string | null]> = [
        ["正常交付", {}, "completed", null],
        ["强制交付后仍是 completed", {executor: {status: "completed", error: null}}, "completed", null],
        ["browser-use 超时", {executor: {status: "timeout", error: null}}, "timeout", null],
        ["步数上限", {executor: {status: "max_steps", error: null}}, "max-steps", null],
        ["执行者报错", {executor: {status: "error", error: "boom"}}, "executor-error", "boom"],
        ["没交回结果、被兜底结束", {executor: null, executorKilledAtBackstop: true}, "timeout", "killed at backstop"],
        ["没交回结果、自己退出", {executor: null}, "executor-error", "no executor result"],
        ["启动阶段出错", {startupError: "chrome did not start", executor: null}, "harness-error", "chrome did not start"],
        ["假站出错", {siteError: "TypeError"}, "harness-error", "site: TypeError"],
        ["Chrome 被信号结束", {chromeExit: {exitCode: null, signal: "SIGSEGV"}, executor: null}, "harness-error", "chrome killed by SIGSEGV"],
        ["Chrome 以 0 退出且执行者没交付", {chromeExit: {exitCode: 0, signal: null}, executor: {status: "error", error: "x"}}, "executor-error", "browser-lost"],
        ["Chrome 以 0 退出但执行者交付了", {chromeExit: {exitCode: 0, signal: null}}, "completed", null],
        ["预算用完", {budgetExceeded: true, executor: {status: "error", error: "429"}}, "budget-exceeded", null],
        ["上游 502 且执行者出错", {gatewayCalls: [call(200), call(502)], executor: {status: "error", error: "x"}}, "infra-error", "1 upstream failure(s)"],
        ["上游中途断开且超时", {gatewayCalls: [call("reset")], executor: {status: "timeout", error: null}}, "infra-error", "1 upstream failure(s)"],
        ["上游 524 但执行者重试后交付", {gatewayCalls: [call(524), call(200)]}, "completed", null],
        ["上游 429 不算上游失败", {gatewayCalls: [call(429)], executor: {status: "error", error: "x"}}, "executor-error", "x"],
    ];
    for (const [name, facts, kind, detail] of cases) {
        test(name, () => {
            const outcome = classifyOutcome({...base, ...facts});
            expect([outcome.kind, outcome.detail]).toEqual([kind, detail]);
        });
    }

    test("只有评测部件与上游的失败不计分", () => {
        expect(["completed", "timeout", "max-steps", "executor-error", "budget-exceeded", "infra-error", "harness-error"].map((kind) => isCounted(kind as never))).toEqual([true, true, true, true, true, false, false]);
    });
});
