import {describe, expect, it} from "vitest";
import {createAssistantTextMessage, createUserMessage} from "nbook/server/agent/messages/message-utils";
import type {RuntimeTurn, TurnSnapshot} from "nbook/server/agent/harness/run-kernel-types";
import {resolveTurnContinuation, shouldSendReportResultReminder} from "nbook/server/agent/harness/turn-continuation";

describe("turn continuation reducer", () => {
    it("tool continuation 会继续同一个 run", () => {
        const decision = resolveTurnContinuation({
            turn: fakeTurn({shouldContinue: true}),
            steeredMessages: [],
            hasReportResult: false,
            reportResultReminderSent: false,
            reportResultAllowed: false,
        });

        expect(decision).toEqual({
            continue: true,
            reasons: ["tool"],
            steeredMessages: [],
            needsReportResultReminder: false,
        });
    });

    it("steer 会压过 report_result reminder，避免同轮混入提醒", () => {
        const steeredMessages = [createUserMessage({text: "steer"})];

        const decision = resolveTurnContinuation({
            turn: fakeTurn({shouldContinue: false}),
            steeredMessages,
            hasReportResult: false,
            reportResultReminderSent: false,
            reportResultAllowed: true,
        });

        expect(decision.continue).toBe(true);
        expect(decision.reasons).toEqual(["steer"]);
        expect(decision.needsReportResultReminder).toBe(false);
        expect(decision.steeredMessages).toBe(steeredMessages);
    });

    it("缺少必需 report_result 时只触发一次 reminder continuation", () => {
        const input = {
            turn: fakeTurn({shouldContinue: false}),
            steeredMessages: [],
            hasReportResult: false,
            reportResultAllowed: true,
        };

        expect(shouldSendReportResultReminder({
            ...input,
            reportResultReminderSent: false,
        })).toBe(true);
        expect(resolveTurnContinuation({
            ...input,
            reportResultReminderSent: false,
        }).reasons).toEqual(["report_result"]);
        expect(shouldSendReportResultReminder({
            ...input,
            reportResultReminderSent: true,
        })).toBe(false);
    });

    it("已有 report_result 或未开放 report_result 工具时不提醒", () => {
        expect(shouldSendReportResultReminder({
            turn: fakeTurn({shouldContinue: false}),
            steeredMessages: [],
            hasReportResult: true,
            reportResultReminderSent: false,
            reportResultAllowed: true,
        })).toBe(false);
        expect(shouldSendReportResultReminder({
            turn: fakeTurn({shouldContinue: false}),
            steeredMessages: [],
            hasReportResult: false,
            reportResultReminderSent: false,
            reportResultAllowed: false,
        })).toBe(false);
    });
});

function fakeTurn(input: {shouldContinue: boolean}): RuntimeTurn {
    return {
        index: 1,
        snapshot: {} as TurnSnapshot,
        assistant: createAssistantTextMessage({text: "ok"}),
        toolCalls: [],
        toolResults: [],
        shouldContinue: input.shouldContinue,
    };
}
