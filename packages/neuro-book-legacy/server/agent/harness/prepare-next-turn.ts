import {randomUUID} from "node:crypto";
import {createStoredUserMessage} from "nbook/server/agent/messages/message-utils";
import type {StoredUserMessage} from "nbook/server/agent/messages/stored-types";
import type {RunFrame, TurnContinuationDecision} from "nbook/server/agent/harness/run-kernel-types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";

export type NextTurnPreparation = {
    shouldContinue: boolean;
    reminderPlan?: SessionWritePlan;
};

/**
 * 把 continuation 判定应用到 RunFrame，并返回需要由 harness 执行的写入计划。
 *
 * 这里只处理确定性的内存变化和 plan 编译；repo 写入、compact、hook 仍由 harness 在安全点执行。
 */
export function applyNextTurnPreparation(frame: RunFrame, decision: TurnContinuationDecision): NextTurnPreparation {
    for (const steeredMessage of decision.steeredMessages) {
        frame.messages.push(steeredMessage);
    }

    const reminderPlan = decision.needsReportResultReminder
        ? appendReportResultReminder(frame)
        : undefined;

    return {
        shouldContinue: decision.continue,
        reminderPlan,
    };
}

/**
 * 缺少必需 report_result 时，在同一个 RunFrame 中注入下一轮 reminder。
 */
function appendReportResultReminder(frame: RunFrame): SessionWritePlan | undefined {
    if (frame.reportResultReminderSent) {
        return undefined;
    }
    const reminder = createReportResultReminder();
    frame.messages.push(reminder);
    frame.reportResultReminderSent = true;

    if (frame.lastTurnIngest?.transcript === "runtime_only") {
        return undefined;
    }

    return {
        target: {sessionId: frame.sessionId},
        cause: "report_result.reminder",
        durability: "savePoint",
        ops: [{
            kind: "append",
            entry: {
                type: "message",
                message: reminder,
                origin: "harness",
                clientMessageId: randomUUID(),
                intent: "normal",
            },
        }],
    };
}

/**
 * 构造 harness 注入的 report_result 提醒消息。
 */
function createReportResultReminder(): StoredUserMessage {
    return createStoredUserMessage("你必须使用 report_result 工具返回最终结果。请不要只回复普通文本。");
}
