import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import {Value} from "typebox/value";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {findPendingApprovalCall, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import {AgentResolutionDtoSchema} from "nbook/shared/dto/agent-session.dto";
import type {Message} from "nbook/server/agent/messages/types";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";

describe("approval helpers", () => {
    it("从最后一条未完成 approval tool call 推导等待态", () => {
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [{
            type: "toolCall",
            id: "call-1",
            name: "request_user_input",
            arguments: {
                questions: [{question: "Name?"}],
            },
        }];

        expect(findPendingApprovalCall([assistant], ["request_user_input"])).toEqual({
            toolCallId: "call-1",
            toolName: "request_user_input",
            args: {
                questions: [{question: "Name?"}],
            },
        });

        const completed = createTextToolResult({
            toolCallId: "call-1",
            toolName: "request_user_input",
            text: "1. Alice",
        });

        expect(findPendingApprovalCall([assistant, completed], ["request_user_input"])).toBeNull();
    });

    it("把用户输入 resolution 转成模型可见 toolResult", () => {
        const message = resolutionToToolResult({
            kind: "user_input",
            toolCallId: "call-1",
            answers: [
                {questionIndex: 1, text: "second"},
                {questionIndex: 0, text: "first"},
            ],
        }, {
            toolCallId: "call-1",
            toolName: "request_user_input",
            args: {
                questions: [
                    {question: "First?"},
                    {question: "Second?"},
                ],
            },
        }) as Message;

        expect(message.role).toBe("toolResult");
        expect(messageText(message)).toBe("1. First?\n回答：first\n\n2. Second?\n回答：second");
    });

    it("保留 request_user_input resolution 的结构化详情", () => {
        const resolution = {
            kind: "user_input" as const,
            toolCallId: "call-1",
            answers: [
                {questionIndex: 0, text: "selected"},
            ],
        };

        const message = resolutionToToolResult(resolution, {
            toolCallId: "call-1",
            toolName: "request_user_input",
        }) as Message;

        expect(message.role).toBe("toolResult");
        if (message.role !== "toolResult") {
            throw new Error("expected toolResult");
        }
        expect(message.details).toEqual(resolution);
    });

    it("把 data resolution 转成可恢复 toolResult 且不补默认选项", () => {
        const message = resolutionToToolResult({
            kind: "user_input",
            toolCallId: "call-1",
            data: {
                answer_1: 1,
            },
        }, {
            toolCallId: "call-1",
            toolName: "request_user_input",
            args: {
                questions: [
                    {
                        question: "第一章正文从哪里开始？",
                        options: [
                            {label: "从村口出发写起"},
                            {label: "从遇狼战斗写起"},
                            {label: "从抵达遗迹写起"},
                        ],
                    },
                    {
                        question: "第一章的核心冲突是什么？",
                        options: [
                            {label: "遗迹探索"},
                            {label: "遗迹中的秘密"},
                        ],
                    },
                ],
            },
        }) as Message;

        expect(message.role).toBe("toolResult");
        expect(messageText(message)).toBe("1. 第一章正文从哪里开始？\n回答：\n\n2. 第一章的核心冲突是什么？\n回答：遗迹中的秘密");
        if (message.role !== "toolResult") {
            throw new Error("expected toolResult");
        }
        expect(message.details).toEqual({
            kind: "user_input",
            toolCallId: "call-1",
            data: {
                userInput: {
                    answer_1: 1,
                },
            },
            answers: [
                {questionIndex: 0, text: ""},
                {questionIndex: 1, text: "遗迹中的秘密", selectedOptionIndex: 1},
            ],
        });
    });

    it("tool_approval 同时存在 data 和 answers 时保留结构化 data", () => {
        const message = resolutionToToolResult({
            kind: "tool_approval",
            toolCallId: "call-1",
            approved: true,
            data: {
                planFilePath: ".agent/plan/preview.md",
            },
            answers: [
                {questionIndex: 0, text: "批准", selectedOptionIndex: 0},
            ],
        }, {
            toolCallId: "call-1",
            toolName: "exit_plan_mode",
        }) as Message;

        expect(message.role).toBe("toolResult");
        if (message.role !== "toolResult") {
            throw new Error("expected toolResult");
        }
        expect(message.details).toEqual({
            kind: "tool_approval",
            toolCallId: "call-1",
            approved: true,
            data: {
                planFilePath: ".agent/plan/preview.md",
                userInput: [
                    {questionIndex: 0, text: "批准", selectedOptionIndex: 0},
                ],
            },
            answers: [
                {questionIndex: 0, text: "批准", selectedOptionIndex: 0},
            ],
        });
    });

    it("request_user_input schema 拒绝空问题和已删除字段", () => {
        const schema = requestUserInputSchema();

        expect(Value.Check(schema, {
            questions: [],
        })).toBe(false);
        expect(Value.Check(schema, {
            questions: [{
                question: "Pick",
                options: [{label: "A"}],
                defaultOptionIndex: 0,
            }],
        })).toBe(false);
        expect(Value.Check(schema, {
            questions: [{
                question: "Pick",
                options: [
                    {label: "A", recommended: true},
                ],
            }],
        })).toBe(false);
        expect(Value.Check(schema, {
            questions: [{
                question: "Pick",
                options: [{label: "A"}],
                defaultOptionIndexes: [0],
            }],
        })).toBe(false);
        expect(Value.Check(schema, {
            questions: [{
                question: "Pick",
                options: [{label: "A"}],
                multiSelect: true,
            }],
        })).toBe(false);
        expect(Value.Check(schema, {
            questions: [{
                question: "Pick",
                options: [{label: "A", defaultSelected: true}],
            }],
        })).toBe(false);
    });

    it("request_user_input schema 接受问题、header 和单选 options", () => {
        const schema = requestUserInputSchema();

        expect(Value.Check(schema, {
            questions: [{
                header: "偏好",
                question: "Pick",
                options: [
                    {label: "A", description: "使用 A 路径"},
                    {label: "B"},
                ],
            }],
        })).toBe(true);
    });

    it("user_input resolution DTO 接受 note-only answers", () => {
        expect(AgentResolutionDtoSchema.safeParse({
            kind: "user_input",
            toolCallId: "ask-1",
            answers: [{questionIndex: 0, note: "Alice"}],
        }).success).toBe(true);
    });

    it("用户 resolution 工具集合包含动态用户输入工具", () => {
        const harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(resolve(".agent", "tmp", "approval-test")),
        });

        expect(harness.tools.approvalToolKeys()).not.toContain("request_user_input");
        expect(harness.tools.userResolutionToolKeys()).toContain("request_user_input");
    });
});

function messageText(message: Message): string {
    if (message.role !== "toolResult") {
        return "";
    }
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function requestUserInputSchema() {
    const harness = new NeuroAgentHarness({
        repo: new JsonlSessionRepository(resolve(".agent", "tmp", "approval-test")),
    });
    const tool = harness.tools.get("request_user_input");
    if (!tool) {
        throw new Error("missing request_user_input tool");
    }
    return tool.parameters;
}
