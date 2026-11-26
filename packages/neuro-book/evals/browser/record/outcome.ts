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
    /** 执行者交回的结果；没交回（进程出错退出、被兜底结束）为 null。 */
    readonly executor: {readonly status: ExecutorStatus; readonly error: string | null} | null;
    /** 执行者被调度器在“时限 + 宽限”时兜底结束。 */
    readonly executorKilledAtBackstop: boolean;
    /** Chrome 在执行中退出了：退出码 0 是执行者或页面关了它；被信号结束且不是调度器发的终止，是 Chrome 自己崩了。 */
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

/** 网关记到的上游失败：连不上、超时、中途断开，或回了 5xx（含 Cloudflare 的 52x）。429 不算：执行者自己会退避重试。 */
export function upstreamFailures(calls: readonly GatewayCallRecord[]): number {
    return calls.filter((call) => typeof call.upstream !== "number" || call.upstream >= 500).length;
}

/**
 * 按结局表定结局。先后有讲究：评测自己的部件出错在前（它们让执行者的结果不可信）；
 * 上游失败只在执行者没正常交付时才算（交付了说明执行者自己的重试兜住了）。
 */
export function classifyOutcome(facts: OutcomeFacts): RunOutcome {
    const outcome = (kind: OutcomeKind, phase: RunOutcome["phase"], detail: string | null): RunOutcome => ({kind, phase, detail});
    if (facts.startupError !== null) return outcome("harness-error", "startup", facts.startupError);
    if (facts.siteError !== null) return outcome("harness-error", "execution", `site: ${facts.siteError}`);
    if (facts.chromeExit !== null && facts.chromeExit.signal !== null) return outcome("harness-error", "execution", `chrome killed by ${facts.chromeExit.signal}`);
    if (facts.budgetExceeded) return outcome("budget-exceeded", "execution", null);
    const delivered = facts.executor?.status === "completed";
    const failures = upstreamFailures(facts.gatewayCalls);
    if (!delivered && failures > 0) return outcome("infra-error", "execution", `${failures} upstream failure(s)`);
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
