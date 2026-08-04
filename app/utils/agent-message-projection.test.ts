import {describe, expect, it} from "vitest";
import {RequestUserInputToolArgsSchema, applyRuntimeEventToMessages, applySessionEntryToMessages, deriveMessagesFromChatEntries, deriveRequestUserInputAnswerViews, hasVisibleInvocationError, messageStatusLabel, toPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import {projectPublicToolArgs} from "nbook/server/agent/events/public-tool-projection";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";

/** message_end 事件必填 usage；这些用例不关心用量，统一给零值。 */
const emptyUsage = () => ({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
});

describe("agent message projection helpers", () => {
    it("request_user_input schema 拒绝默认值、推荐和多选旧字段", () => {
        const invalidArgs = [
            {questions: [{question: "Pick", defaultOptionIndex: 0}]},
            {questions: [{question: "Pick", defaultOptionIndexes: [0]}]},
            {questions: [{question: "Pick", multiSelect: true}]},
            {questions: [{question: "Pick", options: [{label: "A", defaultSelected: true}]}]},
            {questions: [{question: "Pick", options: [{label: "A", recommended: true}]}]},
        ];

        for (const args of invalidArgs) {
            expect(RequestUserInputToolArgsSchema.safeParse(args).success).toBe(false);
        }
    });

    it("request_user_input schema 接受问题、header 和单选 options", () => {
        const parsed = RequestUserInputToolArgsSchema.parse({
            questions: [{
                header: "偏好",
                question: "Pick",
                options: [
                    {label: "A", description: "使用 A 路径"},
                    {label: "B"},
                ],
            }],
        });

        expect(parsed.questions[0]).toEqual({
            header: "偏好",
            question: "Pick",
            options: [
                {label: "A", description: "使用 A 路径"},
                {label: "B"},
            ],
        });
    });

    it("approval pending session 保留批准和拒绝选项", () => {
        const session = toPendingUserInputSession({
            toolCallId: assertPublicToolCallId("plan-1"),
            toolName: "switch_mode",
            args: projectPublicToolArgs("switch_mode", {
                targetMode: "plan",
                reason: "需要先制定计划",
            }),
        }, []);

        expect(session?.questions[0]).toEqual(expect.objectContaining({
            options: [
                expect.objectContaining({label: "批准"}),
                expect.objectContaining({label: "拒绝"}),
            ],
        }));
    });

    it("switch_mode 退出计划 pending session 保留计划文件预览", () => {
        const session = toPendingUserInputSession({
            toolCallId: assertPublicToolCallId("exit-1"),
            toolName: "switch_mode",
            args: projectPublicToolArgs("switch_mode", {
                targetMode: "normal",
                reason: "ready",
                planFilePath: ".agent/plan/preview.md",
            }),
            planFilePath: ".agent/plan/preview.md",
            planContent: "# Preview\n\n- one\n",
        }, []);
        const enterSession = toPendingUserInputSession({
            toolCallId: assertPublicToolCallId("enter-1"),
            toolName: "switch_mode",
            args: projectPublicToolArgs("switch_mode", {
                targetMode: "plan",
                reason: "需要先制定计划",
            }),
        }, []);

        expect(session?.questions[0]).toEqual(expect.objectContaining({
            approvalAction: "switch_mode",
            switchTargetMode: "normal",
            planFilePath: ".agent/plan/preview.md",
            planContent: "# Preview\n\n- one\n",
        }));
        expect(enterSession?.questions[0]?.switchTargetMode).toBe("plan");
        expect(enterSession?.questions[0]?.planFilePath).toBeUndefined();
        expect(enterSession?.questions[0]?.planContent).toBeUndefined();
    });

    it("request_user_input 历史答案展示支持多题", () => {
        const args = RequestUserInputToolArgsSchema.parse({
            questions: [
                {
                    question: "选方案",
                    options: [{label: "A"}, {label: "B"}],
                },
                {
                    question: "补充说明",
                    options: [],
                },
            ],
        });
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [
                {questionIndex: 0, selectedOptionIndex: 1, note: "偏稳"},
                {questionIndex: 1, note: "继续推进"},
            ],
        });

        expect(views).toEqual([
            expect.objectContaining({
                questionIndex: 0,
                question: "选方案",
                selectedLabel: "B",
                note: "偏稳",
                openAnswer: false,
            }),
            expect.objectContaining({
                questionIndex: 1,
                question: "补充说明",
                selectedLabel: "",
                note: "继续推进",
                openAnswer: true,
            }),
        ]);
    });

    it("request_user_input 历史答案展示支持单选加备注", () => {
        const args = RequestUserInputToolArgsSchema.parse({
            questions: [
                {
                    question: "选择标签",
                    options: [{label: "剧情"}, {label: "人物"}, {label: "节奏"}],
                },
            ],
        });
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [
                {questionIndex: 0, selectedOptionIndex: 2, note: "节奏更适合当前章节"},
            ],
        });

        expect(views).toEqual([
            expect.objectContaining({
                questionIndex: 0,
                question: "选择标签",
                selectedLabel: "节奏",
                note: "节奏更适合当前章节",
                openAnswer: false,
            }),
        ]);
    });

    it("request_user_input 历史答案保留 text-only payload", () => {
        const args = RequestUserInputToolArgsSchema.parse({
            questions: [{
                question: "开放问题",
                options: [],
            }],
        });
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [
                {questionIndex: 0, text: "用户直接写下的答案"},
            ],
        });

        expect(views).toEqual([
            expect.objectContaining({
                questionIndex: 0,
                question: "开放问题",
                text: "用户直接写下的答案",
                openAnswer: true,
            }),
        ]);
    });

    it("request_user_input 历史答案保留正文省略状态", () => {
        const args = RequestUserInputToolArgsSchema.parse({questions: [{question: "开放问题", options: []}]});
        const views = deriveRequestUserInputAnswerViews(args, {
            answers: [{questionIndex: 0, text: "预览", textOmitted: true, note: "补充", noteOmitted: true}],
        });

        expect(views).toEqual([expect.objectContaining({text: undefined, note: "补充", omitted: true})]);
    });

    it("session_entry 先插入 system reminder，再按 clientMessageId 替换乐观用户消息", () => {
        const withReminder = applySessionEntryToMessages([{
            id: "system-prompt:1:leader.default",
            type: "system",
            systemDisplayKind: "prompt",
            content: "SYSTEM",
        }, {
            id: "optimistic-user:message-prompt-1",
            type: "user",
            content: "你好",
            status: "done",
            clientMessageId: "message-prompt-1",
        }], {
            id: "reminder-1",
            timestamp: Date.now(),
            type: "system",
            source: "reminder",
            label: "System Reminder",
            content: {preview: "<system-reminder>提醒</system-reminder>", bytes: 44, omitted: false},
        });
        const withPrompt = applySessionEntryToMessages(withReminder, {
            id: "prompt-1",
            clientMessageId: "message-prompt-1",
            timestamp: Date.now(),
            type: "user",
            intent: "normal",
            blocks: [{type: "text", contentIndex: 0, content: {preview: "你好", bytes: 6, omitted: false}}],
            omittedBlocks: 0,
            textSummary: {bytes: 6, omitted: false},
        });

        expect(withPrompt.map((message) => ({
            id: message.id,
            type: message.type,
            content: message.content,
        }))).toEqual([
            {id: "system-prompt:1:leader.default", type: "system", content: "SYSTEM"},
            {id: "reminder-1", type: "system", content: "<system-reminder>提醒</system-reminder>"},
            {id: "prompt-1", type: "user", content: "你好"},
        ]);
    });

    it("assistant 失败但没有正文时展示 errorMessage", () => {
        const messages = applyRuntimeEventToMessages([{
            id: "assistant-error",
            type: "ai",
            content: "",
            status: "streaming",
            invocationId: "inv-error",
            projectionSource: "live",
        }], {
            type: "message_end",
            messageId: "assistant-error",
            stopReason: "error",
            usage: emptyUsage(),
            errorMessage: "Provider rejected image payload",
        }, "inv-error");

        const message = messages.find((item) => item.id === "assistant-error");
        expect(message).toEqual(expect.objectContaining({
            content: "Provider rejected image payload",
            error: "Provider rejected image payload",
            status: "stopped",
        }));
        expect(messageStatusLabel(message!)).toBe("生成失败");
    });

    it("用户取消不展示 provider 英文原文，只标成 interrupted", () => {
        const messages = applyRuntimeEventToMessages([{
            id: "assistant-aborted",
            type: "ai",
            content: "写到一半的正文",
            status: "streaming",
            invocationId: "inv-abort",
            projectionSource: "live",
        }], {
            type: "message_end",
            messageId: "assistant-aborted",
            stopReason: "aborted",
            usage: emptyUsage(),
            // provider SDK 抛的就是这句英文；它绝不能出现在界面上。
            errorMessage: "Request was aborted",
        }, "inv-abort");

        const message = messages.find((item) => item.id === "assistant-aborted");
        expect(message).toEqual(expect.objectContaining({
            content: "写到一半的正文",
            error: undefined,
            status: "interrupted",
        }));
    });

    it("durable invocation error 会展示为 Run Error 系统消息", () => {
        const messages = deriveMessagesFromChatEntries([{
                id: "start-1",
                timestamp: Date.now(),
                type: "invocation_error",
                invocationId: "invoke-1",
                message: {preview: "Provider rejected image payload", bytes: 31, omitted: false},
                phase: "model",
            }]);

        expect(messages).toEqual([
            expect.objectContaining({
                id: "start-1",
                type: "system",
                systemDisplayKind: "error",
                systemLabel: "Run Error",
                content: "Provider rejected image payload",
                invocationId: "invoke-1",
            }),
        ]);
    });

    it("session_entry lifecycle error 能增量展示", () => {
        const messages = applySessionEntryToMessages([], {
            id: "error-1",
            timestamp: Date.now(),
            type: "invocation_error",
            invocationId: "invoke-1",
            message: {preview: "prepare failed", bytes: 14, omitted: false},
            phase: "pre_loop",
        });

        expect(messages).toEqual([
            expect.objectContaining({
                id: "error-1",
                systemDisplayKind: "error",
                content: "prepare failed",
            }),
        ]);
    });

    it("session_entry lifecycle error 不会被其他 invocation 的 assistant error 吞掉", () => {
        const messages = applySessionEntryToMessages([{
            id: "assistant-error",
            type: "ai",
            content: "old error",
            status: "stopped",
            error: "old error",
            invocationId: "invoke-old",
        }], {
            id: "error-1",
            timestamp: Date.now(),
            type: "invocation_error",
            invocationId: "invoke-new",
            message: {preview: "new error", bytes: 9, omitted: false},
            phase: "unknown",
        });

        expect(messages).toEqual([
            expect.objectContaining({id: "assistant-error"}),
            expect.objectContaining({
                id: "error-1",
                systemDisplayKind: "error",
                invocationId: "invoke-new",
                content: "new error",
            }),
        ]);
    });

    it("同一次运行的错误只展示一次：保留正文气泡，错误详情归 Run Error 卡片", () => {
        const timestamp = Date.now();
        const messages = deriveMessagesFromChatEntries([{
                id: "assistant-1",
                timestamp,
                type: "assistant",
                invocationId: "invoke-1",
                content: {preview: "写到一半的正文", bytes: 21, omitted: false},
                thinking: {preview: "", bytes: 0, omitted: false},
                error: {preview: "Provider rejected image payload", bytes: 31, omitted: false},
                status: "error",
                model: "test",
                usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                toolCalls: [],
                omittedToolCalls: 0,
            }, {
                id: "error-1",
                timestamp,
                type: "invocation_error",
                invocationId: "invoke-1",
                message: {preview: "Provider rejected image payload", bytes: 31, omitted: false},
                phase: "model",
            }]);

        // 正文留下，错误红字从 assistant 上清掉，详情只在卡片上出现一次。
        expect(messages.filter((message) => message.type === "ai" && message.error)).toHaveLength(0);
        expect(messages.filter((message) => message.systemDisplayKind === "error")).toHaveLength(1);
        expect(messages.find((message) => message.type === "ai")).toEqual(expect.objectContaining({
            content: "写到一半的正文",
            error: undefined,
        }));
        expect(hasVisibleInvocationError(messages, "invoke-1")).toBe(true);
    });

    it("失败时没有正文的 assistant 整条移除，只留 Run Error 卡片", () => {
        const timestamp = Date.now();
        const messages = deriveMessagesFromChatEntries([{
                id: "assistant-1",
                timestamp,
                type: "assistant",
                invocationId: "invoke-1",
                content: {preview: "", bytes: 0, omitted: false},
                thinking: {preview: "", bytes: 0, omitted: false},
                error: {preview: "Provider rejected image payload", bytes: 31, omitted: false},
                status: "error",
                model: "test",
                usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                toolCalls: [],
                omittedToolCalls: 0,
            }, {
                id: "error-1",
                timestamp,
                type: "invocation_error",
                invocationId: "invoke-1",
                message: {preview: "Provider rejected image payload", bytes: 31, omitted: false},
                phase: "model",
            }]);

        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual(expect.objectContaining({
            id: "error-1",
            systemDisplayKind: "error",
        }));
    });

    it("session_entry toolResult 能增量完成对应工具调用", () => {
        const messages = applySessionEntryToMessages([{
            id: "assistant-1",
            type: "ai",
            content: "",
            status: "done",
            toolCalls: [{
                id: "approval-call",
                assistantMessageId: "assistant-1",
                index: 0,
                name: "request_user_input",
                argsText: "{\"questions\":[{\"question\":\"继续吗？\"}]}",
                status: "streaming",
            }],
        }], {
            id: "tool-result-1",
            timestamp: Date.now(),
            type: "tool_result",
            toolCallId: assertPublicToolCallId("approval-call"),
            toolName: "request_user_input",
            result: {
                content: [{type: "text", contentIndex: 0, textPreview: "用户已选择：继续", textBytes: 24, textOmitted: false}],
                omittedContentBlocks: 0,
            },
            isError: false,
        });

        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            status: "success",
            result: "用户已选择：继续",
        }));
    });

    it("tool_execution_start 展示 JSON 参数", () => {
        const messages = applyRuntimeEventToMessages([{
            id: "assistant-1",
            type: "ai",
            content: "",
            status: "streaming",
            toolCalls: [{
                id: "patch-1",
                assistantMessageId: "assistant-1",
                index: 0,
                name: "apply_patch",
                argsText: "",
                status: "streaming",
            }],
        }], {
            type: "tool_execution_start",
            toolCallId: assertPublicToolCallId("patch-1"),
            toolName: "apply_patch",
            args: {
                kind: "apply_patch",
                patchPreview: "*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch",
                patchBytes: 57,
                patchOmitted: false,
                touchedFiles: ["a.txt"],
                touchedFilesOmitted: false,
            },
        });

        expect(messages[0]?.toolCalls?.[0]?.argsText).toContain("*** Begin Patch");
        expect(messages[0]?.toolCalls?.[0]?.argsJson).toContain("\"patch\"");
    });
});
