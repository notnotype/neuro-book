import {describe, test, expect} from "vitest";
import {toPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentPendingApprovalDto} from "nbook/shared/dto/agent-session.dto";
import type {AgentUserInputFormDto} from "nbook/shared/dto/agent-public-event.dto";
import {projectPublicToolArgs} from "nbook/server/agent/events/public-tool-projection";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";

describe("agent-message Low-Code Form 集成", () => {
    test("非 request_user_input 工具存在 pending.formSpec 时，生成 Low-Code Form session", () => {
        const form: AgentUserInputFormDto = {
            defaults: {},
            fields: [
                {
                    path: "answer_0",
                    component: "textarea",
                    label: "姓名",
                    required: true,
                    options: [],
                },
            ],
        };

        const pending: AgentPendingApprovalDto = {
            toolCallId: assertPublicToolCallId("call_form_spec"),
            toolName: "custom_form_tool",
            args: projectPublicToolArgs("custom_form_tool", {
                reason: "需要表单输入",
            }),
            formSpec: {
                form,
                prompt: "请填写",
                layout: "dialog",
            },
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_form_spec",
            status: "pending",
            questions: [],
            form,
            formToolCallId: "call_form_spec",
        });
    });

    test("request_user_input 即使存在 pending.formSpec 也生成普通问题 session", () => {
        const form: AgentUserInputFormDto = {
            defaults: {},
            fields: [
                {
                    path: "answer_0",
                    component: "textarea",
                    label: "姓名",
                    required: true,
                    options: [],
                },
            ],
        };

        const pending: AgentPendingApprovalDto = {
            toolCallId: assertPublicToolCallId("call_request_user_input"),
            toolName: "request_user_input",
            args: projectPublicToolArgs("request_user_input", {
                questions: [
                    {
                        question: "请问您的姓名？",
                        options: [],
                    },
                ],
            }),
            formSpec: {
                form,
                prompt: "请填写",
                layout: "dialog",
            },
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_request_user_input",
            status: "pending",
            questions: [{
                toolNodeId: "call_request_user_input",
                questionIndex: 0,
                toolCallId: "call_request_user_input",
                toolName: "request_user_input",
                kind: "question",
                question: "请问您的姓名？",
                options: [],
            }],
        });
        expect(session?.form).toBeUndefined();
        expect(session?.formToolCallId).toBeUndefined();
    });

    test("当 args 包含 form 时，生成 Low-Code Form session", () => {
        const form: AgentUserInputFormDto = {
            defaults: {},
            fields: [
                {
                    path: "name",
                    component: "text",
                    label: "姓名",
                    required: true,
                    options: [],
                },
                {
                    path: "age",
                    component: "number",
                    label: "年龄",
                    required: false,
                    min: 0,
                    max: 150,
                    options: [],
                },
            ],
        };

        const pending: AgentPendingApprovalDto = {
            toolCallId: assertPublicToolCallId("call_123"),
            toolName: "custom_tool",
            args: projectPublicToolArgs("custom_tool", {form}),
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_123",
            status: "pending",
            questions: [],
            form,
            formToolCallId: "call_123",
        });
    });

    test("request_user_input 没有 formSpec 时生成普通问题 session", () => {
        const pending: AgentPendingApprovalDto = {
            toolCallId: assertPublicToolCallId("call_456"),
            toolName: "request_user_input",
            args: projectPublicToolArgs("request_user_input", {
                questions: [
                    {
                        question: "请问您的姓名？",
                        options: [],
                    },
                ],
            }),
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session).toMatchObject({
            assistantMessageId: "call_456",
            status: "pending",
            questions: [{
                toolNodeId: "call_456",
                questionIndex: 0,
                toolCallId: "call_456",
                toolName: "request_user_input",
                kind: "question",
                question: "请问您的姓名？",
                options: [],
            }],
        });
        expect(session?.form).toBeUndefined();
    });

    test("当 args.form 结构不完整时，回退到 tool_approval 模式", () => {
        const pending: AgentPendingApprovalDto = {
            toolCallId: assertPublicToolCallId("call_789"),
            toolName: "some_tool",
            args: projectPublicToolArgs("some_tool", {
                form: {fields: "invalid"},
            }),
        };

        const session = toPendingUserInputSession(pending, []);

        expect(session?.questions).toHaveLength(1);
        expect(session?.questions[0]?.kind).toBe("tool_approval");
        expect(session?.form).toBeUndefined();
    });
});
