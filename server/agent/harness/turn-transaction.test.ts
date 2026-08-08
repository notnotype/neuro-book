import {describe, expect, it} from "vitest";
import {createAssistantTextMessage, createStoredTextToolResult, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import type {FailedTurnOutcome, RunFrame, RuntimeTurn, TurnSnapshot} from "nbook/server/agent/harness/run-kernel-types";
import {applyFailedTurnTransaction, applySuccessfulTurnTransaction} from "nbook/server/agent/harness/turn-transaction";
import {createPublicRuntimeProjectionState} from "nbook/server/agent/events/public-event-projection";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("turn transaction", () => {
    it("completed outcome 会写回 RunFrame 并返回 completed transaction", () => {
        const frame = fakeFrame();
        const timestamp = 1;
        const assistant = createAssistantTextMessage({text: "done", timestamp});
        const toolResult = createTextToolResult({
            toolCallId: "tool-1",
            toolName: "report_result",
            text: "ok",
            timestamp,
        });
        const turn: RuntimeTurn = {
            index: 1,
            snapshot: {} as TurnSnapshot,
            assistant,
            toolCalls: [],
            toolResults: [{
                stored: createStoredTextToolResult({
                    toolCallId: "tool-1",
                    toolName: "report_result",
                    text: "ok",
                    timestamp,
                }),
                event: toolResult,
            }],
            reportResult: {result: "walkthrough"},
            shouldContinue: false,
        };

        const result = applySuccessfulTurnTransaction(frame, {
            kind: "completed",
            turn,
        }, {transcript: "persist"});

        expect(result).toEqual({
            kind: "completed",
            turn,
        });
        expect(frame.finalAssistant).toBe(assistant);
        expect(frame.usage).toEqual(assistant.usage);
        expect(frame.messages).toEqual([assistant, toolResult]);
        expect(frame.reportResult).toEqual({result: "walkthrough"});
    });

    it("waiting outcome 会写回 RunFrame 并返回 waiting run result", () => {
        const frame = fakeFrame();
        const assistant = createAssistantTextMessage({text: ""});
        const waiting = {
            toolCallId: "ask-1",
            toolName: "request_user_input",
        };
        const turn: RuntimeTurn = {
            index: 1,
            snapshot: {} as TurnSnapshot,
            assistant,
            toolCalls: [],
            toolResults: [],
            waiting,
            shouldContinue: false,
        };

        const result = applySuccessfulTurnTransaction(frame, {
            kind: "waiting",
            turn,
            waiting,
        }, {transcript: "persist"});

        expect(result).toEqual({
            kind: "waiting",
            result: {
                status: "waiting",
                finalAssistant: assistant,
                usage: assistant.usage,
                reportResult: undefined,
                waiting,
            },
        });
        expect(frame.messages).toEqual([assistant]);
    });

    it("failed outcome 会写回 RunFrame 并返回 failed run result", () => {
        const frame = fakeFrame();
        const finalAssistant = createAssistantTextMessage({
            text: "",
            stopReason: "error",
        });
        const outcome: FailedTurnOutcome = {
            kind: "failed",
            phase: "provider",
            errorInfo: {
                message: "provider failed",
                phase: "model",
            },
            finalAssistant,
        };

        const result = applyFailedTurnTransaction(frame, outcome, {transcript: "persist"});

        expect(result).toEqual({
            kind: "failed",
            result: {
                status: "failed",
                finalAssistant,
                usage: finalAssistant.usage,
                errorInfo: outcome.errorInfo,
                terminalStatus: "error",
            },
        });
        expect(frame.messages).toEqual([finalAssistant]);
        expect(frame.lastTurnIngest).toEqual({transcript: "persist"});
    });
});

function fakeFrame(): RunFrame {
    return {
        sessionId: 1,
        workspaceRoot: absoluteFsPath(process.cwd()),
        currentProject: null,
        systemPrompt: "",
        models: {} as RunFrame["models"],
        model: {} as RunFrame["model"],
        sessionContextEnabled: true,
        toolKeys: [],
        profileKey: "test",
        profile: {} as RunFrame["profile"],
        agentMode: "normal",
        thinkingLevel: "off",
        runtimeState: new Map(),
        publicEventProjection: createPublicRuntimeProjectionState(),
        messages: [],
        nextTurnRuntimeMessages: [],
        turnIndex: 1,
        reportResultReminderSent: false,
        reportResultReminderEnabled: false,
        reportResultErrorCount: 0,
        caller: {kind: "user"},
        automaticCompactionDoneForTurn: false,
        pendingWritePlans: [],
    };
}
