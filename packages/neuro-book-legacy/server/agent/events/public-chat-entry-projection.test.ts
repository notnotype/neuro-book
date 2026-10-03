import {describe, expect, it} from "vitest";
import {chatEntryKind, projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import type {SessionEntry} from "nbook/server/agent/session/types";

describe("projectAgentChatEntry", () => {
    it("纯 attachment prompt 仍形成可见 user entry，并保留原 contentIndex", () => {
        const entry = {
            id: "entry-image",
            parentId: null,
            timestamp: 101,
            type: "message",
            origin: "prompt",
            clientMessageId: "client-image",
            intent: "normal",
            message: {
                role: "user",
                content: [{
                    type: "attachment",
                    attachment: {
                        id: `sha256:${"b".repeat(64)}`,
                        mimeType: "image/webp",
                        bytes: 42_000,
                    },
                    name: "参考图.webp",
                }],
                timestamp: 101,
            },
        } as unknown as SessionEntry;

        expect(projectAgentChatEntry(entry)).toEqual({
            id: "entry-image",
            clientMessageId: "client-image",
            timestamp: 101,
            type: "user",
            blocks: [{
                type: "attachment",
                contentIndex: 0,
                attachment: {
                    attachmentId: `sha256:${"b".repeat(64)}`,
                    mimeType: "image/webp",
                    bytes: 42_000,
                    name: "参考图.webp",
                    dataOmitted: true,
                },
            }],
            omittedBlocks: 0,
            textSummary: {bytes: 0, omitted: false},
            intent: "normal",
        });
    });

    it("user text blocks 共用 64 KiB 预算，控制字符转义后完整 event 仍低于硬上限", () => {
        const content = Array.from({length: 40}, (_, index) => index % 2 === 0
            ? {type: "text" as const, text: "\n".repeat(100_000)}
            : {
                type: "attachment" as const,
                attachment: {
                    id: `sha256:${String(index).padStart(64, "a")}`,
                    mimeType: "image/png",
                    bytes: 1024,
                },
                name: `${"图".repeat(2_000)}.png`,
            });
        const entry = {
            id: "entry-large-user",
            parentId: null,
            timestamp: 102,
            type: "message",
            origin: "prompt",
            clientMessageId: "client-large-user",
            intent: "normal",
            message: {role: "user", content, timestamp: 102},
        } as unknown as SessionEntry;

        const projected = projectAgentChatEntry(entry);
        expect(projected?.type).toBe("user");
        if (projected?.type !== "user") return;
        expect(projected.blocks).toHaveLength(32);
        expect(projected.omittedBlocks).toBe(8);
        expect(projected.textSummary).toEqual({
            bytes: 2_000_000,
            omitted: true,
        });
        expect(projected.blocks
            .filter((block) => block.type === "text")
            .reduce((bytes, block) => bytes + Buffer.byteLength(block.content.preview, "utf8"), 0))
            .toBeLessThanOrEqual(64 * 1024);
        expect(Buffer.byteLength(JSON.stringify({
            sessionId: 1,
            kind: "session",
            event: {type: "session_entry", entry: projected},
        }), "utf8")).toBeLessThan(128 * 1024);
        expect(projected).not.toHaveProperty("content");
        expect(projected).not.toHaveProperty("attachments");
    });

    it("assistant entry 的 write tool call 不公开完整正文", () => {
        const content = "正文".repeat(600_000);
        const entry: SessionEntry = {
            id: "entry-assistant",
            parentId: "entry-user",
            timestamp: 100,
            type: "message",
            origin: "ingest",
            message: {
                role: "assistant",
                content: [{
                    type: "text",
                    text: "正在写入",
                }, {
                    type: "toolCall",
                    id: "tool-write",
                    name: "write",
                    arguments: {
                        path: "manuscript/chapter-1.md",
                        content,
                    },
                }],
                api: "openai-responses",
                provider: "openai",
                model: "gpt-5",
                usage: {
                    input: 1,
                    output: 2,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 3,
                    cost: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        total: 0,
                    },
                },
                stopReason: "toolUse",
                timestamp: 100,
            },
        };

        const projected = projectAgentChatEntry(entry, {invocationId: "invoke-1"});

        expect(projected).toEqual(expect.objectContaining({
            type: "assistant",
            id: "entry-assistant",
            invocationId: "invoke-1",
            toolCalls: [expect.objectContaining({
                id: "tool-write",
                name: "write",
                args: expect.objectContaining({
                    kind: "write",
                    path: "manuscript/chapter-1.md",
                    contentBytes: Buffer.byteLength(content, "utf8"),
                    contentOmitted: true,
                }),
            })],
        }));
        expect(JSON.stringify(projected)).not.toContain(content);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(128 * 1024);
    });

    it("assistant 正文、thinking、error 和 tool calls 共用单条 entry 预算", () => {
        const large = "长".repeat(100_000);
        const entry = {
            id: "entry-large",
            parentId: null,
            timestamp: 1,
            type: "message" as const,
            origin: "ingest" as const,
            message: {
                role: "assistant" as const,
                content: [
                    {type: "thinking" as const, thinking: large},
                    {type: "text" as const, text: large},
                    ...Array.from({length: 40}, (_, index) => ({type: "toolCall" as const, id: `call-${String(index)}`, name: "apply_patch", arguments: {patch: large}})),
                ],
                api: "test",
                provider: "test",
                model: "test",
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: "error" as const,
                errorMessage: large,
                timestamp: 1,
            },
        };

        const projected = projectAgentChatEntry(entry, {invocationId: "run-1"});

        expect(projected?.type).toBe("assistant");
        if (projected?.type !== "assistant") return;
        expect(projected.toolCalls).toHaveLength(32);
        expect(projected.omittedToolCalls).toBe(8);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(96 * 1024);
    });

    it("durable tool result 的 toolName 使用与 runtime 相同的有界投影", () => {
        const toolName = "tool-" + "x".repeat(10_000);
        const entry = {
            id: "entry-tool-result",
            parentId: null,
            timestamp: 1,
            type: "message" as const,
            origin: "ingest" as const,
            message: {
                role: "toolResult" as const,
                toolCallId: "call-1",
                toolName,
                content: [{type: "text" as const, text: "ok"}],
                isError: false,
                timestamp: 1,
            },
        } as unknown as SessionEntry;

        const projected = projectAgentChatEntry(entry);

        expect(projected?.type).toBe("tool_result");
        if (projected?.type !== "tool_result") return;
        expect(Buffer.byteLength(projected.toolName, "utf8")).toBeLessThanOrEqual(512);
        expect(projected.toolName).not.toContain(toolName);
    });

    it("durable assistant 与 tool result 遇到非法 toolCallId 时 fail closed", () => {
        const invalidId = "工".repeat(200);
        expect(() => projectAgentChatEntry({
            id: "assistant-invalid-tool-id",
            parentId: null,
            timestamp: 1,
            type: "message",
            origin: "ingest",
            message: {
                role: "assistant",
                content: [{type: "toolCall", id: invalidId, name: "read", arguments: {path: "manuscript/1.md"}}],
                api: "test",
                provider: "test",
                model: "test",
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: "toolUse",
                timestamp: 1,
            },
        })).toThrow("Tool call identity 无效");

        expect(() => projectAgentChatEntry({
            id: "tool-result-invalid-tool-id",
            parentId: null,
            timestamp: 1,
            type: "message",
            origin: "ingest",
            message: {
                role: "toolResult",
                toolCallId: " ",
                toolName: "read",
                content: [{type: "text", text: "ok"}],
                isError: false,
                timestamp: 1,
            },
        })).toThrow("Tool call identity 无效");
    });
});

describe("chatEntryKind", () => {
    const entry = (patch: Record<string, unknown>): SessionEntry => ({
        id: "e",
        parentId: null,
        timestamp: 1,
        ...patch,
    } as unknown as SessionEntry);

    const userMessage = (origin: string | undefined, intent: string | undefined) => entry({
        type: "message",
        ...(origin === undefined ? {} : {origin}),
        ...(intent === undefined ? {} : {intent, clientMessageId: "client-1"}),
        message: {
            role: "user",
            // steer 消息在存储层带 Provider envelope，投影时由 intent 驱动解包。
            content: intent === "steer"
                ? [{type: "text", text: "<user_steer>\nhi\n</user_steer>"}]
                : [{type: "text", text: "hi"}],
            timestamp: 1,
        },
    });

    const lifecycle = (status: string, patch: Record<string, unknown> = {}) => entry({
        type: "invocation_lifecycle",
        invocationId: "inv-1",
        status,
        ...patch,
    });

    /**
     * 每条 case 都必须是结构完整、不会让投影抛错的 entry：
     * 这张表同时用于「kind 判定正确」和「kind 与投影结果一致」两个断言。
     */
    const cases: Array<{name: string; entry: SessionEntry; kind: string | null}> = [
        {name: "prompt user 消息", entry: userMessage("prompt", "normal"), kind: "user"},
        {name: "steer user 消息", entry: userMessage("harness", "steer"), kind: "user"},
        {name: "harness 注入的 user 消息", entry: userMessage("harness", "normal"), kind: null},
        {name: "workflow 注入的 user 消息", entry: userMessage("workflow", "normal"), kind: null},
        {name: "manual 写入的 user 消息", entry: userMessage("manual", "normal"), kind: null},
        {name: "无 origin 的 user 消息", entry: userMessage(undefined, undefined), kind: null},
        {
            name: "assistant 消息",
            entry: entry({
                type: "message",
                origin: "harness",
                message: {
                    role: "assistant",
                    content: [{type: "text", text: "answer"}],
                    model: "m",
                    usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                    timestamp: 1,
                },
            }),
            kind: "assistant",
        },
        {
            name: "toolResult 消息",
            entry: entry({
                type: "message",
                origin: "harness",
                message: {
                    role: "toolResult",
                    toolCallId: "call-1",
                    toolName: "read",
                    content: [{type: "text", text: "ok"}],
                    isError: false,
                    timestamp: 1,
                },
            }),
            kind: "tool_result",
        },
        {
            name: "custom_message",
            entry: entry({type: "custom_message", visibleToModel: true, message: {role: "user", content: [{type: "text", text: "<system-reminder>x</system-reminder>"}], timestamp: 1}}),
            kind: "system",
        },
        {
            name: "compaction",
            entry: entry({type: "compaction", summary: "摘要", firstKeptEntryId: null, tokensBefore: 10}),
            kind: "system",
        },
        {
            name: "branch_summary",
            entry: entry({type: "branch_summary", fromLeafId: "a", toLeafId: "b", summary: "分支摘要"}),
            kind: "system",
        },
        {name: "带 errorInfo 的报错", entry: lifecycle("error", {errorInfo: {message: "boom", phase: "model"}}), kind: "invocation_error"},
        {name: "只有 error 文本的报错", entry: lifecycle("error", {error: "boom"}), kind: "invocation_error"},
        {name: "没有任何错误正文的报错", entry: lifecycle("error", {error: "   "}), kind: null},
        {name: "lifecycle start", entry: lifecycle("start"), kind: null},
        {name: "lifecycle end", entry: lifecycle("end"), kind: null},
        {name: "lifecycle aborted", entry: lifecycle("aborted"), kind: null},
        {name: "model_change", entry: entry({type: "model_change", model: null}), kind: null},
        {name: "custom（agent.link 记账）", entry: entry({type: "custom", key: "agent.link.42", value: {}}), kind: null},
        {name: "session_update", entry: entry({type: "session_update", updates: {title: "t"}}), kind: null},
        {name: "label", entry: entry({type: "label", targetEntryId: "x", label: "l"}), kind: null},
        {name: "leaf", entry: entry({type: "leaf", leafId: null}), kind: null},
    ];

    it.each(cases)("$name 的 chatEntryKind 是 $kind", ({entry: sessionEntry, kind}) => {
        expect(chatEntryKind(sessionEntry)).toBe(kind);
    });

    /**
     * 这是本模块的核心不变量：`chatEntryKind` 是「会不会进 Chat Flow」的唯一判据，
     * `projectAgentChatEntry` 的 null 出口必须与它完全一致。任何一边被改动而另一边没跟上，
     * 这条断言就会红——投影内部剩下的分支缺失路径会直接抛错，而不是安静地少渲染一个气泡。
     */
    it.each(cases)("$name 的 kind 与投影结果一致", ({entry: sessionEntry}) => {
        expect(projectAgentChatEntry(sessionEntry) === null).toBe(chatEntryKind(sessionEntry) === null);
    });

    it("kind 非 null 时投影产出的 type 与 kind 相同", () => {
        for (const item of cases) {
            const kind = chatEntryKind(item.entry);
            if (kind === null) {
                continue;
            }
            expect(projectAgentChatEntry(item.entry)?.type).toBe(kind);
        }
    });
});
