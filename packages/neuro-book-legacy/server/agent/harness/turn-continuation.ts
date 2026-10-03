import type {StoredUserMessage} from "nbook/server/agent/messages/stored-types";
import type {RuntimeTurn, TurnContinuationDecision, TurnContinuationReason} from "nbook/server/agent/harness/run-kernel-types";

export type ResolveTurnContinuationInput = {
    turn: RuntimeTurn;
    steeredMessages: StoredUserMessage[];
    hasReportResult: boolean;
    reportResultReminderSent: boolean;
    reportResultAllowed: boolean;
};

/**
 * 归并本轮 turn 后是否继续同一个 run。
 *
 * 这里只做纯判定，不 drain queue、不写 reminder、不读 session。
 */
export function resolveTurnContinuation(input: ResolveTurnContinuationInput): TurnContinuationDecision {
    const needsReportResultReminder = shouldSendReportResultReminder(input);
    const reasons: TurnContinuationReason[] = [];
    if (input.turn.shouldContinue) {
        reasons.push("tool");
    }
    if (input.steeredMessages.length > 0) {
        reasons.push("steer");
    }
    if (needsReportResultReminder) {
        reasons.push("report_result");
    }
    return {
        continue: reasons.length > 0,
        reasons,
        steeredMessages: input.steeredMessages,
        needsReportResultReminder,
    };
}

/**
 * 判断缺少 report_result 时是否需要注入一次 harness reminder。
 */
export function shouldSendReportResultReminder(input: ResolveTurnContinuationInput): boolean {
    return !input.hasReportResult
        && !input.reportResultReminderSent
        && input.steeredMessages.length === 0
        && !input.turn.shouldContinue
        && input.reportResultAllowed;
}
