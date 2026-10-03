import type {
    FailedTurnOutcome,
    RunFrame,
    RunLoopResult,
    RuntimeTurn,
    SuccessfulTurnOutcome,
    TurnIngestResult,
} from "nbook/server/agent/harness/run-kernel-types";
import {applyFailedTurn, applySuccessfulTurn} from "nbook/server/agent/harness/run-frame-state";
import {applyFailedTurnOutcome, createFailedRunLoopResult} from "nbook/server/agent/harness/turn-failure";

export type FailedTurnTransactionResult = {
    kind: "failed";
    result: RunLoopResult;
};

export type SuccessfulTurnTransactionResult =
    | {
        kind: "waiting";
        result: RunLoopResult;
    }
    | {
        kind: "completed";
        turn: RuntimeTurn;
    };

export type TurnTransactionResult = FailedTurnTransactionResult | SuccessfulTurnTransactionResult;

/**
 * 把已完成 ingest 的 successful turn 应用到 RunFrame，并返回下一步事务结果。
 */
export function applySuccessfulTurnTransaction(frame: RunFrame, outcome: SuccessfulTurnOutcome, ingest: TurnIngestResult): SuccessfulTurnTransactionResult {
    applySuccessfulTurn(frame, outcome.turn, ingest);
    if (outcome.kind === "waiting") {
        return {
            kind: "waiting",
            result: {
                status: "waiting",
                finalAssistant: frame.finalAssistant,
                usage: frame.usage,
                reportResult: frame.reportResult,
                waiting: outcome.waiting,
            },
        };
    }
    return {
        kind: "completed",
        turn: outcome.turn,
    };
}

/**
 * 把已完成可选 partial ingest 的 failed turn 应用到 RunFrame，并返回 failed run result。
 */
export function applyFailedTurnTransaction(frame: RunFrame, outcome: FailedTurnOutcome, ingest?: TurnIngestResult): FailedTurnTransactionResult {
    applyFailedTurn(frame, applyFailedTurnOutcome(outcome, ingest));
    return {
        kind: "failed",
        result: createFailedRunLoopResult(frame, outcome),
    };
}
