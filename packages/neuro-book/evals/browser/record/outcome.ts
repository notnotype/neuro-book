/**
 * 一次运行的结局：由调度器收齐的事实一处算出（实施计划“运行记录”里的结局表）。
 * 计不计分只看结局：`infra-error`、`harness-error` 不计分、重跑，其余照判分。
 */

import type {GatewayCallRecord, OutcomeKind, RunOutcome} from "./schema";

/** browser-use 1.0.6 的 `result.status`（`agent/views.py`）：到时限或步数上限的那次强制交付仍是 `completed`，`success` 为 false。 */
export type ExecutorStatus = "completed" | "timeout" | "max_steps" | "error";

export interface OutcomeFacts {
    /** 执行者启动之前（起假站、起 Chrome、登记假密钥）出的错；没出错为 null。 */
    readonly startupError: string | null;
    /** 执行中假站自己出的错（处理请求时抛出）；没有为 null。 */
    readonly siteError: string | null;
    /** 执行者起来之后评测自己出的错（起执行者的子进程失败、读写运行目录失败之类）；没有为 null。 */
    readonly harnessError: string | null;
    /** 执行者交回的结果；没交回（进程出错退出、被兜底结束）为 null。 */
    readonly executor: {readonly status: ExecutorStatus; readonly error: string | null} | null;
    /** 执行者被调度器在“时限 + 宽限”时兜底结束。 */
    readonly executorKilledAtBackstop: boolean;
    /**
     * Chrome 在执行中自己退出了（不是调度器终止的）：退出码 0 是执行者或页面关了它；被信号结束（崩溃、被 OOM 杀掉）是评测部件出错。
     * 信号由 `chrome.ts` 从 bwrap 的 128+n 退出码还原出来。
     */
    readonly chromeExit: {readonly exitCode: number | null; readonly signal: string | null} | null;
    readonly gatewayCalls: readonly GatewayCallRecord[];
    /** 网关为这次运行回过“预算用完”。 */
    readonly budgetExceeded: boolean;
}

const COUNTED: ReadonlySet<OutcomeKind> = new Set(["completed", "timeout", "max-steps", "executor-error", "budget-exceeded"]);

/** 这种结局计不计分。 */
export function isCounted(kind: OutcomeKind): boolean {
    return COUNTED.has(kind);
}

/**
 * 上游拒收的状态码：密钥失效（401）、额度用完（402、403）、中转下架了模型（404）、请求超时（408）、单条消息超限（413）、限流（429）。
 * 都是评测用的上游出了问题，不是执行者的表现。400 不在里面：请求体是执行者造的。
 */
const UPSTREAM_REFUSALS: ReadonlySet<number> = new Set([401, 402, 403, 404, 408, 413, 429]);

/** 一次网关调用是不是上游失败：连不上、超时、中途断开，5xx（含 Cloudflare 的 52x），或上游拒收。执行者自己断开、收尾时取消的不算。 */
export function isUpstreamFailure(call: GatewayCallRecord): boolean {
    if (typeof call.upstream === "number") return call.upstream >= 500 || UPSTREAM_REFUSALS.has(call.upstream);
    return call.upstream === "connect-error" || call.upstream === "timeout" || call.upstream === "reset";
}

/** 这一回最后发出的那次调用（按开始时刻）。 */
function lastCall(calls: readonly GatewayCallRecord[]): GatewayCallRecord | undefined {
    return calls.reduce<GatewayCallRecord | undefined>((last, call) => (last === undefined || call.startedAt >= last.startedAt ? call : last), undefined);
}

/**
 * 按结局表定结局。先后有讲究：评测自己的部件出错在前（它们让执行者的结果不可信）；
 * 上游失败只在执行者没正常交付、而且这一回最后一次调用就是上游失败时才算：中途失败过、被执行者自己重试过去了的，
 * 照常计分。只要碰到过上游失败就重跑，等于挑着把失败的回重跑一遍，把均分往上推，偏差还随一边的请求数变。
 */
export function classifyOutcome(facts: OutcomeFacts): RunOutcome {
    const outcome = (kind: OutcomeKind, phase: RunOutcome["phase"], detail: string | null): RunOutcome => ({kind, phase, detail});
    if (facts.startupError !== null) return outcome("harness-error", "startup", facts.startupError);
    if (facts.harnessError !== null) return outcome("harness-error", "execution", facts.harnessError);
    if (facts.siteError !== null) return outcome("harness-error", "execution", `site: ${facts.siteError}`);
    if (facts.chromeExit !== null && facts.chromeExit.signal !== null) return outcome("harness-error", "execution", `chrome killed by ${facts.chromeExit.signal}`);
    if (facts.budgetExceeded) return outcome("budget-exceeded", "execution", null);
    const delivered = facts.executor?.status === "completed";
    const last = lastCall(facts.gatewayCalls);
    if (!delivered && last !== undefined && isUpstreamFailure(last)) return outcome("infra-error", "execution", `last upstream call failed: ${last.upstream}`);
    if (!delivered && facts.chromeExit !== null) return outcome("executor-error", "execution", "browser-lost");
    if (facts.executor === null) {
        return facts.executorKilledAtBackstop ? outcome("timeout", "execution", "killed at backstop") : outcome("executor-error", "execution", "no executor result");
    }
    switch (facts.executor.status) {
        case "completed":
            return outcome("completed", "execution", null);
        case "timeout":
            return outcome("timeout", "execution", null);
        case "max_steps":
            return outcome("max-steps", "execution", null);
        case "error":
            return outcome("executor-error", "execution", facts.executor.error);
    }
}
