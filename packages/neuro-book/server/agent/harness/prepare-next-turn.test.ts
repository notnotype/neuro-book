import {describe, expect, it} from "vitest";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {RunFrame, TurnContinuationDecision} from "nbook/server/agent/harness/run-kernel-types";
import {applyNextTurnPreparation} from "nbook/server/agent/harness/prepare-next-turn";
import {createPublicRuntimeProjectionState} from "nbook/server/agent/events/public-event-projection";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("prepare next turn reducer", () => {
    it("会把 steer 消息追加到 RunFrame", () => {
        const frame = fakeFrame();
        const steer = createUserMessage({text: "STEER"});
        const result = applyNextTurnPreparation(frame, fakeDecision({
            continue: true,
            steeredMessages: [steer],
        }));

        expect(result).toEqual({
            shouldContinue: true,
            reminderPlan: undefined,
        });
        expect(frame.messages).toEqual([steer]);
    });

    it("缺少 report_result 时返回持久化 reminder plan 并写入 RunFrame", () => {
        const frame = fakeFrame();
        const result = applyNextTurnPreparation(frame, fakeDecision({
            continue: true,
            needsReportResultReminder: true,
        }));

        expect(result.shouldContinue).toBe(true);
        expect(result.reminderPlan).toMatchObject({
            target: {sessionId: 7},
            cause: "report_result.reminder",
            durability: "savePoint",
        });
        expect(frame.reportResultReminderSent).toBe(true);
        expect(frame.messages).toHaveLength(1);
        expect(messageText(frame.messages[0] as never)).toContain("必须使用 report_result");
    });

    it("runtime_only transcript 下 reminder 只进入 RunFrame 不返回写入计划", () => {
        const frame = fakeFrame();
        frame.lastTurnIngest = {transcript: "runtime_only"};

        const result = applyNextTurnPreparation(frame, fakeDecision({
            continue: true,
            needsReportResultReminder: true,
        }));

        expect(result.reminderPlan).toBeUndefined();
        expect(frame.reportResultReminderSent).toBe(true);
        expect(frame.messages).toHaveLength(1);
    });

    it("已发送过 reminder 时不会重复追加", () => {
        const frame = fakeFrame();
        frame.reportResultReminderSent = true;

        const result = applyNextTurnPreparation(frame, fakeDecision({
            continue: true,
            needsReportResultReminder: true,
        }));

        expect(result.reminderPlan).toBeUndefined();
        expect(frame.messages).toEqual([]);
    });
});

function fakeFrame(): RunFrame {
    return {
        sessionId: 7,
        workspaceRoot: absoluteFsPath(process.cwd()),
        currentProject: null,
        systemPrompt: "",
        models: {} as RunFrame["models"],
        model: {} as RunFrame["model"],
        sessionContextEnabled: true,
        toolKeys: ["report_result"],
        profileKey: "test",
        profile: {} as RunFrame["profile"],
        agentMode: "normal",
        thinkingLevel: "off",
        runtimeState: new Map(),
        publicEventProjection: createPublicRuntimeProjectionState(),
        messages: [],
        recoveryMaterialKeys: new Set(),
        nextTurnRuntimeMessages: [],
        turnIndex: 1,
        reportResultReminderSent: false,
        reportResultReminderEnabled: true,
        reportResultErrorCount: 0,
        caller: {kind: "user"},
        automaticCompactionDoneForTurn: false,
        pendingWritePlans: [],
    };
}

function fakeDecision(input: {
    continue: boolean;
    steeredMessages?: TurnContinuationDecision["steeredMessages"];
    needsReportResultReminder?: boolean;
}): TurnContinuationDecision {
    return {
        continue: input.continue,
        reasons: [],
        steeredMessages: input.steeredMessages ?? [],
        needsReportResultReminder: input.needsReportResultReminder ?? false,
    };
}
