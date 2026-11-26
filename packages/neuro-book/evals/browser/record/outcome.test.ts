import {describe, expect, test} from "bun:test";

import {classifyOutcome, isCounted} from "./outcome";
import type {OutcomeFacts} from "./outcome";
import type {GatewayCallRecord} from "./schema";

/** 第 n 次调用（按开始时刻排先后）。 */
function call(upstream: GatewayCallRecord["upstream"], n = 0): GatewayCallRecord {
    return {model: "m", reasoningEffort: "medium", maxTokens: null, tools: 3, images: 0, messages: 2, stream: false, upstream, usage: null, startedAt: n, endedAt: n + 1};
}

const base: OutcomeFacts = {startupError: null, siteError: null, harnessError: null, executor: {status: "completed", error: null}, executorKilledAtBackstop: false, chromeExit: null, gatewayCalls: [call(200)], budgetExceeded: false};

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
        ["执行中评测自己出错", {harnessError: "spawn failed", executor: null}, "harness-error", "spawn failed"],
        ["Chrome 被信号结束", {chromeExit: {exitCode: null, signal: "SIGSEGV"}, executor: null}, "harness-error", "chrome killed by SIGSEGV"],
        ["Chrome 以 0 退出且执行者没交付", {chromeExit: {exitCode: 0, signal: null}, executor: {status: "error", error: "x"}}, "executor-error", "browser-lost"],
        ["Chrome 以 0 退出但执行者交付了", {chromeExit: {exitCode: 0, signal: null}}, "completed", null],
        ["预算用完", {budgetExceeded: true, executor: {status: "error", error: "429"}}, "budget-exceeded", null],
        ["最后一次是上游 502、执行者出错", {gatewayCalls: [call(200, 1), call(502, 2)], executor: {status: "error", error: "x"}}, "infra-error", "last upstream call failed: 502"],
        ["最后一次上游中途断开、执行者超时", {gatewayCalls: [call("reset")], executor: {status: "timeout", error: null}}, "infra-error", "last upstream call failed: reset"],
        ["最后一次连不上", {gatewayCalls: [call("connect-error")], executor: {status: "error", error: "x"}}, "infra-error", "last upstream call failed: connect-error"],
        ["上游额度用完（403）", {gatewayCalls: [call(403)], executor: {status: "error", error: "x"}}, "infra-error", "last upstream call failed: 403"],
        ["中转的单条消息超限（413）", {gatewayCalls: [call(200, 1), call(413, 2)], executor: {status: "error", error: "x"}}, "infra-error", "last upstream call failed: 413"],
        ["上游限流（429）", {gatewayCalls: [call(429)], executor: {status: "error", error: "x"}}, "infra-error", "last upstream call failed: 429"],
        ["上游 400 是执行者造的请求不对", {gatewayCalls: [call(400)], executor: {status: "error", error: "x"}}, "executor-error", "x"],
        ["上游 524 但执行者重试后交付", {gatewayCalls: [call(524, 1), call(200, 2)]}, "completed", null],
        ["中途 502 被重试过去，后来自己走到步数上限：照常计分", {gatewayCalls: [call(502, 1), call(200, 2)], executor: {status: "max_steps", error: null}}, "max-steps", null],
        ["最后一次按开始时刻算，不按记下的先后", {gatewayCalls: [call(502, 5), call(200, 1)], executor: {status: "error", error: "x"}}, "infra-error", "last upstream call failed: 502"],
        ["执行者自己断开了最后一次请求（到点）", {gatewayCalls: [call(200, 1), call("client-abort", 2)], executor: {status: "timeout", error: null}}, "timeout", null],
        ["收尾时取消的在途请求", {gatewayCalls: [call(200, 1), call("cancelled", 2)], executor: null, executorKilledAtBackstop: true}, "timeout", "killed at backstop"],
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
