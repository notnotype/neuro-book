import {describe, expect, it} from "vitest";
import {createAssistantTextMessage, createStoredTextToolResult, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import type {RunFrame, RuntimeTurn, TurnSnapshot} from "nbook/server/agent/harness/run-kernel-types";
import {applyFailedTurn, applySuccessfulTurn, consumeNextTurnModelMessages, createRunFrame} from "nbook/server/agent/harness/run-frame-state";
import {createPublicRuntimeProjectionState} from "nbook/server/agent/events/public-event-projection";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRecoveryMaterialTracker} from "nbook/server/agent/harness/recovery-materials";

describe("run frame state", () => {
    it("创建 RunFrame 时会固定默认运行态，并浅拷贝初始 messages", () => {
        const message = createAssistantTextMessage({text: "seed"});
        const messages = [message];
        const runtimeState = new Map();
        const onEvent = () => undefined;

        const frame = createRunFrame({
            invocationId: "invoke-1",
            sessionId: 1,
            workspaceRoot: absoluteFsPath(process.cwd()),
            currentProject: null,
            systemPrompt: "system",
            messages,
            models: {} as RunFrame["models"],
            model: {} as RunFrame["model"],
            apiKey: "key",
            timeoutMs: 1000,
            requestOptions: {temperature: 0},
            sessionContextEnabled: true,
            toolKeys: ["report_result"],
            profileKey: "test",
            profile: {} as RunFrame["profile"],
            agentMode: "normal",
            thinkingLevel: "off",
            runtimeState,
            reportResultReminderEnabled: true,
            caller: {kind: "user"},
            onEvent,
        });

        expect(frame).toMatchObject({
            invocationId: "invoke-1",
            sessionId: 1,
            workspaceRoot: absoluteFsPath(process.cwd()),
            currentProject: null,
            systemPrompt: "system",
            apiKey: "key",
            timeoutMs: 1000,
            requestOptions: {temperature: 0},
            sessionContextEnabled: true,
            toolKeys: ["report_result"],
            profileKey: "test",
            thinkingLevel: "off",
            turnIndex: 0,
            reportResultReminderSent: false,
            reportResultReminderEnabled: true,
            reportResultErrorCount: 0,
            caller: {kind: "user"},
            pendingWritePlans: [],
        });
        expect(frame.messages).toEqual([message]);
        expect(frame.messages).not.toBe(messages);
        expect(frame.runtimeState).toBe(runtimeState);
        expect(frame.onEvent).toBe(onEvent);
    });

    it("创建 RunFrame 时复用 invocation tracker 的恢复材料去重集合", () => {
        const tracker = createRecoveryMaterialTracker();
        tracker.injectedKeys.add("already-injected");
        const frame = createRunFrame({
            invocationId: "invoke-recovery",
            sessionId: 1,
            workspaceRoot: absoluteFsPath(process.cwd()),
            currentProject: null,
            systemPrompt: "system",
            messages: [],
            models: {} as RunFrame["models"],
            model: {} as RunFrame["model"],
            sessionContextEnabled: true,
            toolKeys: [],
            profileKey: "test",
            profile: {} as RunFrame["profile"],
            agentMode: "normal",
            thinkingLevel: "off",
            runtimeState: new Map(),
            reportResultReminderEnabled: false,
            caller: {kind: "user"},
            recoveryMaterials: tracker,
        });

        expect(frame.recoveryMaterialKeys).toBe(tracker.injectedKeys);
        expect(frame.recoveryMaterialKeys?.has("already-injected")).toBe(true);
    });

    it("消费 prepareNextTurn runtime messages 后会清空临时槽，避免后续 turn 重复堆积", () => {
        const frame = fakeFrame();
        const persisted = createAssistantTextMessage({text: "persisted"});
        const runtimeOnly = createAssistantTextMessage({text: "runtime-only"});
        frame.messages.push(persisted);
        frame.nextTurnRuntimeMessages.push(runtimeOnly);

        expect(consumeNextTurnModelMessages(frame)).toEqual([persisted, runtimeOnly]);
        expect(frame.nextTurnRuntimeMessages).toEqual([]);
        expect(consumeNextTurnModelMessages(frame)).toEqual([persisted]);
    });

    it("成功 turn 会写回 assistant、tool results、report_result 和 ingest 状态", () => {
        const frame = fakeFrame();
        frame.automaticCompactionDoneForTurn = true;
        const assistant = createAssistantTextMessage({text: "done"});
        const toolResult = createTextToolResult({
            toolCallId: "tool-1",
            toolName: "report_result",
            text: "ok",
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
                }),
                event: toolResult,
            }],
            reportResult: {
                result: "walkthrough",
            },
            shouldContinue: false,
        };

        applySuccessfulTurn(frame, turn, {transcript: "persist"});

        expect(frame.finalAssistant).toBe(assistant);
        expect(frame.messages).toEqual([assistant, turn.toolResults[0]!.stored]);
        expect(frame.reportResult).toEqual({result: "walkthrough"});
        expect(frame.lastTurnIngest).toEqual({transcript: "persist"});
        expect(frame.automaticCompactionDoneForTurn).toBe(false);
    });

    it("没有新 report_result 时保留已有 report_result", () => {
        const frame = fakeFrame();
        frame.reportResult = {result: "existing"};
        const assistant = createAssistantTextMessage({text: "done"});

        applySuccessfulTurn(frame, {
            index: 1,
            snapshot: {} as TurnSnapshot,
            assistant,
            toolCalls: [],
            toolResults: [],
            shouldContinue: false,
        }, {transcript: "runtime_only"});

        expect(frame.reportResult).toEqual({result: "existing"});
        expect(frame.lastTurnIngest).toEqual({transcript: "runtime_only"});
    });

    it("失败 outcome 会写回 finalAssistant，并可记录 partial ingest 状态", () => {
        const frame = fakeFrame();
        const finalAssistant = createAssistantTextMessage({
            text: "",
            stopReason: "error",
        });
        const turn = {
            finalAssistant,
        };

        applyFailedTurn(frame, {
            ...turn,
            ingest: {transcript: "persist"},
        });

        expect(frame.finalAssistant).toBe(finalAssistant);
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
        recoveryMaterialKeys: new Set(),
        nextTurnRuntimeMessages: [],
        turnIndex: 0,
        reportResultReminderSent: false,
        reportResultReminderEnabled: false,
        reportResultErrorCount: 0,
        caller: {kind: "user"},
        automaticCompactionDoneForTurn: false,
        pendingWritePlans: [],
    };
}
