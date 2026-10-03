import {describe, expect, it} from "vitest";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import {createPublicRuntimeProjectionState, projectRuntimeEvent} from "nbook/server/agent/events/public-event-projection";
import {PublicToolIdentityError} from "nbook/shared/agent/public-tool-identity";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";

describe("projectRuntimeEvent", () => {
    it("丢弃 Pi agent_end / turn_end 大字段，由 Run Kernel 生成轻量公开事件", () => {
        const assistant = createAssistantTextMessage({text: "large assistant"});
        const toolResult = createTextToolResult({
            toolCallId: "tool-1",
            toolName: "read",
            text: "large result",
        });

        const agentEnd: AgentEvent = {
            type: "agent_end",
            messages: [assistant, toolResult],
        };
        const turnEnd: AgentEvent = {
            type: "turn_end",
            message: assistant,
            toolResults: [toolResult],
        };

        const state = createPublicRuntimeProjectionState();
        expect(projectRuntimeEvent(state, agentEnd)).toBeNull();
        expect(projectRuntimeEvent(state, turnEnd)).toBeNull();
    });

    it("保留工具执行事件需要的 UI 字段", () => {
        const event: AgentEvent = {
            type: "tool_execution_end",
            toolCallId: "tool-1",
            toolName: "read",
            result: {content: [{type: "text", text: "ok"}]},
            isError: false,
        };

        expect(projectRuntimeEvent(createPublicRuntimeProjectionState(), event)).toEqual({
            type: "tool_execution_end",
            toolCallId: "tool-1",
            toolName: "read",
            result: {
                content: [{
                    type: "text",
                    contentIndex: 0,
                    textPreview: "ok",
                    textBytes: 2,
                    textOmitted: false,
                }],
                omittedContentBlocks: 0,
            },
            isError: false,
        });
    });

    it("10 MiB tool result 只公开有界预览和原始字节数", () => {
        const text = "结果".repeat(5 * 1024 * 1024);
        const projected = projectRuntimeEvent(createPublicRuntimeProjectionState(), {
            type: "tool_execution_end",
            toolCallId: "tool-large-result",
            toolName: "read",
            result: {content: [{type: "text", text}]},
            isError: false,
        });

        expect(projected?.type).toBe("tool_execution_end");
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(50 * 1024);
        if (projected?.type !== "tool_execution_end") return;
        expect(projected.result.content[0]).toMatchObject({textBytes: Buffer.byteLength(text, "utf8"), textOmitted: true});
        expect(JSON.stringify(projected)).not.toContain(text);
    });

    it("tool_execution_update 不重复公开未消费的完整参数", () => {
        const projected = projectRuntimeEvent(createPublicRuntimeProjectionState(), {
            type: "tool_execution_update",
            toolCallId: "write-1",
            toolName: "write",
            args: {path: "a.md", content: "x".repeat(10 * 1024 * 1024)},
            partialResult: {content: [{type: "text", text: "50%"}]},
        });

        expect(projected).toEqual(expect.objectContaining({type: "tool_execution_update", partialResult: expect.any(Object)}));
        expect(projected).not.toHaveProperty("args");
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(128 * 1024);
    });

    it("非法或超长 tool-call ID 在 streaming public event 中 fail closed", () => {
        const message = createAssistantTextMessage({text: ""});
        const hugeId = "tool-id-" + "x".repeat(300_000);
        message.content = [{type: "toolCall", id: hugeId, name: "write", arguments: {path: "a.md", content: "body"}}];
        const toolCall = message.content[0];
        if (toolCall?.type !== "toolCall") {
            throw new Error("expected tool call");
        }
        const state = createPublicRuntimeProjectionState();

        projectRuntimeEvent(state, {type: "message_start", message});
        expect(() => projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_start", contentIndex: 0, partial: message},
        })).toThrow(PublicToolIdentityError);
        expect(() => projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_delta", contentIndex: 0, delta: "body", partial: message},
        })).toThrow(PublicToolIdentityError);
        expect(() => projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_end", contentIndex: 0, toolCall, partial: message},
        })).toThrow(PublicToolIdentityError);
        expect(() => projectRuntimeEvent(createPublicRuntimeProjectionState(), {
            type: "tool_execution_start",
            toolCallId: hugeId,
            toolName: "write",
            args: {path: "a.md", content: "body"},
        })).toThrow(PublicToolIdentityError);
    });

    it("非 request_user_input 工具的用户输入事件会公开 Low-Code formSpec", () => {
        const event = {
            type: "tool_user_input_required" as const,
            toolCallId: "tool-form",
            toolName: "enter_plan_mode",
            args: {reason: "need plan"},
            formSpec: {
                form: {
                    defaults: {approved: true},
                    fields: [{
                        path: "approved",
                        component: "radio" as const,
                        label: "是否批准？",
                        required: false,
                        options: [
                            {value: true, label: "批准"},
                            {value: false, label: "拒绝"},
                        ],
                    }],
                },
                prompt: "请审批",
                layout: "inline" as const,
            },
        };

        expect(projectRuntimeEvent(createPublicRuntimeProjectionState(), event)).toEqual({
            type: "tool.user-input-required",
            toolCallId: "tool-form",
            toolName: "enter_plan_mode",
            args: {
                kind: "generic",
                value: {
                    kind: "object",
                    entries: [{
                        key: "reason",
                        value: {
                            kind: "string",
                            preview: "need plan",
                            bytes: 9,
                            omitted: false,
                        },
                    }],
                    omittedEntries: 0,
                },
            },
            formSpec: {
                form: event.formSpec.form,
                prompt: "请审批",
                layout: "inline",
            },
        });
    });

    it("request_user_input 即使带历史 formSpec 也不会公开 Low-Code formSpec", () => {
        const event = {
            type: "tool_user_input_required" as const,
            toolCallId: "tool-request",
            toolName: "request_user_input",
            args: {questions: [{question: "给一个名字"}]},
            formSpec: {
                form: {
                    defaults: {},
                    fields: [{
                        path: "answer_0",
                        component: "textarea" as const,
                        label: "给一个名字",
                        required: false,
                        options: [],
                    }],
                },
            },
        };

        expect(projectRuntimeEvent(createPublicRuntimeProjectionState(), event)).toEqual({
            type: "tool.user-input-required",
            toolCallId: "tool-request",
            toolName: "request_user_input",
            args: expect.objectContaining({kind: "generic"}),
        });
    });

    it("非法或超大 Low-Code formSpec 不进入公开事件", () => {
        const project = () => projectRuntimeEvent(createPublicRuntimeProjectionState(), {
            type: "tool_user_input_required",
            toolCallId: "tool-form",
            toolName: "custom_form",
            args: {},
            formSpec: {
                form: {
                    defaults: {},
                    fields: [{path: "preset", component: "resource-preset", label: "Preset", required: false, options: [], resource: {contentType: "markdown", options: [], content: {key: "x", content: "x".repeat(10 * 1024 * 1024), contentType: "markdown"}, contents: [], capabilities: {create: false, update: false, rename: false, remove: false}}}],
                },
            },
        });

        expect(project).toThrow("agent_user_input_form_too_large");
    });

    it("message_update 只公开 immutable delta，不保留累计 partial 引用", () => {
        const message = createAssistantTextMessage({text: ""});
        const state = createPublicRuntimeProjectionState();
        const started = projectRuntimeEvent(state, {
            type: "message_start",
            message,
        });
        const content = message.content[0];
        if (content?.type !== "text") {
            throw new Error("expected text content");
        }
        content.text = "第一段";
        const projected = projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {
                type: "text_delta",
                contentIndex: 0,
                delta: "第一段",
                partial: message,
            },
        });
        const beforeMutation = JSON.stringify(projected);
        content.text += "第二段";

        expect(started).toEqual(expect.objectContaining({
            type: "message_start",
            messageId: expect.any(String),
            role: "assistant",
        }));
        expect(projected).toEqual({
            type: "message_update",
            messageId: started?.type === "message_start" ? started.messageId : "",
            update: {
                type: "text_delta",
                contentIndex: 0,
                delta: "第一段",
                deltaBytes: 9,
                deltaOmitted: false,
            },
        });
        expect(JSON.stringify(projected)).toBe(beforeMutation);
        expect(JSON.stringify(projected)).not.toContain("第二段");
    });

    it("write preview 达限后只按字节里程碑发布参数进度", () => {
        const message = createAssistantTextMessage({text: ""});
        message.content = [{
            type: "toolCall",
            id: "write-1",
            name: "write",
            arguments: {path: "manuscript/chapter.md", content: ""},
        }];
        const state = createPublicRuntimeProjectionState();
        projectRuntimeEvent(state, {type: "message_start", message});
        projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_start", contentIndex: 0, partial: message},
        });

        const published: unknown[] = [];
        for (let index = 0; index < 250; index += 1) {
            const toolCall = message.content[0];
            if (toolCall?.type !== "toolCall") {
                throw new Error("expected tool call");
            }
            const args = toolCall.arguments as {path: string; content: string};
            args.content += "x".repeat(512);
            const event = projectRuntimeEvent(state, {
                type: "message_update",
                message,
                assistantMessageEvent: {
                    type: "toolcall_delta",
                    contentIndex: 0,
                    delta: "x".repeat(512),
                    partial: message,
                },
            });
            if (event) published.push(event);
        }

        expect(published.length).toBeLessThan(60);
        expect(Buffer.byteLength(JSON.stringify(published), "utf8")).toBeLessThan(1024 * 1024);
    });

    it("同一 assistant message 的 tool-call accumulator 有数量和 aggregate preview 上限", () => {
        const message = createAssistantTextMessage({text: ""});
        message.content = Array.from({length: 40}, (_, index) => ({
            type: "toolCall" as const,
            id: `write-${String(index)}`,
            name: "write",
            arguments: {path: `file-${String(index)}.md`, content: "seed"},
        }));
        const state = createPublicRuntimeProjectionState();
        projectRuntimeEvent(state, {type: "message_start", message});

        for (let contentIndex = 0; contentIndex < 40; contentIndex += 1) {
            projectRuntimeEvent(state, {
                type: "message_update",
                message,
                assistantMessageEvent: {type: "toolcall_start", contentIndex, partial: message},
            });
        }

        expect(state.toolCalls.size).toBe(32);
        expect(state.toolPreviewBytesRemaining).toBe(0);

        const first = projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_delta", contentIndex: 0, delta: "x", partial: message},
        });
        const fifth = projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_delta", contentIndex: 4, delta: "x", partial: message},
        });

        expect(first?.type).toBe("message_update");
        if (first?.type !== "message_update" || first.update.type !== "toolcall_args" || first.update.args.kind !== "write") return;
        expect(first.update.args.contentPreview).not.toBe("");
        expect(fifth?.type).toBe("message_update");
        if (fifth?.type !== "message_update" || fifth.update.type !== "toolcall_args" || fifth.update.args.kind !== "write") return;
        expect(fifth.update.args.contentPreview).toBe("");
        expect(fifth.update.args.contentOmitted).toBe(true);
    });

    it("重复 toolcall_start 不会再次消耗 aggregate preview budget", () => {
        const message = createAssistantTextMessage({text: ""});
        message.content = [{
            type: "toolCall",
            id: "write-duplicate",
            name: "write",
            arguments: {path: "manuscript/example.md", content: "seed"},
        }];
        const state = createPublicRuntimeProjectionState();
        projectRuntimeEvent(state, {type: "message_start", message});

        const start = {
            type: "message_update" as const,
            message,
            assistantMessageEvent: {type: "toolcall_start" as const, contentIndex: 0, partial: message},
        };
        projectRuntimeEvent(state, start);
        const remaining = state.toolPreviewBytesRemaining;
        projectRuntimeEvent(state, start);

        expect(state.toolCalls.size).toBe(1);
        expect(state.toolPreviewBytesRemaining).toBe(remaining);
    });

    it("10 MiB write 累计 partial 的公开事件总量保持线性有界", () => {
        const message = createAssistantTextMessage({text: ""});
        message.content = [{type: "toolCall", id: "write-large", name: "write", arguments: {path: "manuscript/large.md", content: ""}}];
        const state = createPublicRuntimeProjectionState();
        projectRuntimeEvent(state, {type: "message_start", message});
        projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_start", contentIndex: 0, partial: message},
        });
        const chunk = "x".repeat(40 * 1024);
        const projected: unknown[] = [];
        for (let index = 0; index < 256; index += 1) {
            const toolCall = message.content[0];
            if (toolCall?.type !== "toolCall") throw new Error("expected tool call");
            (toolCall.arguments as {content: string}).content += chunk;
            const event = projectRuntimeEvent(state, {
                type: "message_update",
                message,
                assistantMessageEvent: {type: "toolcall_delta", contentIndex: 0, delta: chunk, partial: message},
            });
            if (event) projected.push(event);
        }

        const toolCall = message.content[0];
        if (toolCall?.type !== "toolCall") throw new Error("expected tool call");
        const ended = projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_end", contentIndex: 0, toolCall, partial: message},
        });

        const serializedBytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
        expect(serializedBytes).toBeLessThan(5 * 1024 * 1024);
        expect(ended?.type).toBe("message_update");
        if (ended?.type !== "message_update" || ended.update.type !== "toolcall_end" || ended.update.args.kind !== "write") return;
        expect(ended.update.args.contentBytes).toBe(10 * 1024 * 1024);
    });

    it.each([
        ["apply_patch", {patch: "*** Begin Patch\n*** End Patch"}],
        ["edit", {path: "manuscript/a.md", edits: [{oldText: "old", newText: "new"}]}],
    ] as const)("10 MiB %s 参数流在预览达限后只按里程碑发布", (toolName, initialArgs) => {
        const message = createAssistantTextMessage({text: ""});
        message.content = [{type: "toolCall", id: `${toolName}-large`, name: toolName, arguments: structuredClone(initialArgs)}];
        const state = createPublicRuntimeProjectionState();
        projectRuntimeEvent(state, {type: "message_start", message});
        projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_start", contentIndex: 0, partial: message},
        });
        const chunk = "x".repeat(1024);
        let published = 0;
        for (let index = 0; index < 10 * 1024; index += 1) {
            const toolCall = message.content[0];
            if (toolCall?.type !== "toolCall") throw new Error("expected tool call");
            if (toolName === "apply_patch") {
                const args = toolCall.arguments as {patch: string};
                args.patch += chunk;
            } else {
                const args = toolCall.arguments as {edits: Array<{oldText: string; newText: string}>};
                args.edits[0]!.oldText += chunk;
                args.edits[0]!.newText += chunk;
            }
            const event = projectRuntimeEvent(state, {
                type: "message_update",
                message,
                assistantMessageEvent: {type: "toolcall_delta", contentIndex: 0, delta: chunk, partial: message},
            });
            if (event) published += 1;
        }
        const toolCall = message.content[0];
        if (toolCall?.type !== "toolCall") throw new Error("expected tool call");
        const ended = projectRuntimeEvent(state, {
            type: "message_update",
            message,
            assistantMessageEvent: {type: "toolcall_end", contentIndex: 0, toolCall, partial: message},
        });

        expect(published).toBeLessThan(40);
        expect(ended?.type).toBe("message_update");
        if (ended?.type !== "message_update" || ended.update.type !== "toolcall_end") return;
        if (ended.update.args.kind === "apply_patch") {
            expect(ended.update.args.patchBytes).toBeGreaterThan(10 * 1024 * 1024);
        } else if (ended.update.args.kind === "edit") {
            expect(ended.update.args.edits[0]?.oldTextBytes).toBe(10 * 1024 * 1024 + 3);
            expect(ended.update.args.edits[0]?.newTextBytes).toBe(10 * 1024 * 1024 + 3);
        } else {
            throw new Error("expected file tool args");
        }
    });
});
