import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import type {Context} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {appendCompaction, COMPACTION_PROMPT, COMPACTION_SUMMARY_PREFIX, compactIfNeeded, resolveCompactionOptions, shouldCompactWithOptions} from "nbook/server/agent/harness/compaction";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {StoredAgentMessage, StoredAttachmentContent} from "nbook/server/agent/messages/stored-types";
import {attachmentMarker} from "nbook/server/agent/messages/stored-message-presentation";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("compaction", () => {
    let root: AbsoluteFsPath;
    let repo: JsonlSessionRepository;
    let faux: FauxModelsFixture;

    beforeEach(() => {
        root = absoluteFsPath(resolve(".agent", "agent-compaction-test", randomUUID()));
        repo = new JsonlSessionRepository(root);
        faux = createFauxModels({
            models: [{
                id: `faux-compact-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("使用 LLM 生成 summary，并在 reduce 后保留 summary + recent messages", async () => {
        let summaryPrompt: Context | null = null;
        faux.setResponses([
            (context) => {
                summaryPrompt = context;
                return fauxAssistantMessage(fauxText("LLM SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        for (let index = 1; index <= 6; index += 1) {
            await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: `user ${String(index)}`}), session.metadata.workspaceKey);
        }
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            instructions: "focus on files",
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecent: {kind: "tokens", value: 1},
            },
        });

        const context = repo.reduce(await repo.readSession(session.metadata.sessionId));

        expect(summaryPromptText(summaryPrompt)).toContain("focus on files");
        expect(messageText(context.messages[0] as never)).toContain(COMPACTION_SUMMARY_PREFIX);
        expect(messageText(context.messages[0] as never)).toContain("LLM SUMMARY");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "user"]);
        expect(messageText(context.messages[1] as never)).toBe("user 6");
    });

    it("cut point 不会从 toolResult 半截开始", async () => {
        faux.setResponses([fauxAssistantMessage(fauxText("TOOL SUMMARY"))]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old"}), session.metadata.workspaceKey);
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [
            fauxText("call"),
            fauxToolCall("report_result", {result: "ok"}, {id: "tool-1"}),
        ];
        await repo.appendMessage(session.metadata.sessionId, assistant, session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createTextToolResult({
            toolCallId: "tool-1",
            toolName: "report_result",
            text: "ok",
        }), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecent: {kind: "tokens", value: 1},
            },
        });

        const context = repo.reduce(await repo.readSession(session.metadata.sessionId));

        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(messageText(context.messages[1] as never)).toContain("[tool:report_result]");
        expect(messageText(context.messages[2] as never)).toBe("ok");
    });

    it("存在未完成 tool call 时拒绝压缩", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [fauxToolCall("request_user_input", {questions: []}, {id: "approval-1"})];
        await repo.appendMessage(session.metadata.sessionId, assistant, session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await expect(appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecent: {kind: "tokens", value: 1},
            },
        })).rejects.toThrow("未完成 tool call");
    });

    it("没有 profile Compaction policy 时不会自动压缩", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        const compacted = await compactIfNeeded({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            writeCompactionEntry,
        });

        expect(compacted).toBe(false);
    });

    it("解析默认 prompt/prefix、百分比触发和 recent 百分比", () => {
        const options = resolveCompactionOptions({
            trigger: {kind: "percent", value: 0.8},
            keepRecent: {kind: "percent", value: 0.25},
        }, faux.getModel());

        expect(options.prompt).toBe(COMPACTION_PROMPT);
        expect(options.summaryPrefix).toBe(COMPACTION_SUMMARY_PREFIX);
        expect(options.keepRecentTokens).toBe(32_000);
        expect(shouldCompactWithOptions(102_400, 128_000, options)).toBe(true);
        expect(shouldCompactWithOptions(102_399, 128_000, options)).toBe(false);
    });

    it("triggerTokens 生效并固定使用 Harness prompt/prefix", async () => {
        let summaryPrompt: Context | null = null;
        let summaryHeaders: Record<string, string | null> | undefined;
        faux.setResponses([
            (context, options) => {
                summaryPrompt = context;
                summaryHeaders = options?.headers;
                return fauxAssistantMessage(fauxText("CUSTOM SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        const compacted = await compactIfNeeded({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: {
                ...faux.getModel(),
                headers: {
                    "x-model": "model",
                    "x-shared": "model",
                },
            },
            requestOptions: {
                headers: {
                    "x-request": "request",
                    "x-shared": "request",
                },
            },
            compaction: {
                trigger: {kind: "tokens", value: 1},
                keepRecent: {kind: "tokens", value: 1},
            },
            writeCompactionEntry,
        });

        const reduced = repo.reduce(await repo.readSession(session.metadata.sessionId));
        expect(compacted).toBe(true);
        const capturedPrompt = summaryPrompt as Context | null;
        expect(capturedPrompt?.systemPrompt).toBe(COMPACTION_PROMPT);
        expect(summaryHeaders).toEqual({
            "x-request": "request",
            "x-model": "model",
            "x-shared": "request",
        });
        expect(messageText(reduced.messages[0] as never)).toContain(COMPACTION_SUMMARY_PREFIX);
    });

    it("visible custom_message 参与 recent cut 预算但不进入 summary 输入", async () => {
        let secondSummaryPrompt: Context | null = null;
        faux.setResponses([
            () => {
                return fauxAssistantMessage(fauxText("FIRST SUMMARY"));
            },
            (context) => {
                secondSummaryPrompt = context;
                return fauxAssistantMessage(fauxText("SECOND SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            message: createUserMessage({text: "OLD HISTORYSET SHOULD BE CUT " + "old ".repeat(200)}),
            visibleToModel: true,
        }, session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old user dialogue"}), session.metadata.workspaceKey);
        const firstSnapshot = await repo.readSession(session.metadata.sessionId);

        await compactIfNeeded({
            repo,
            snapshot: firstSnapshot,
            messages: repo.reduce(firstSnapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            compaction: {
                trigger: {kind: "tokens", value: 1},
                keepRecent: {kind: "tokens", value: 1},
            },
            writeCompactionEntry,
        });

        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            message: createUserMessage({text: "NEW HISTORYSET SHOULD STAY " + "new ".repeat(200)}),
            visibleToModel: true,
        }, session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "new user dialogue"}), session.metadata.workspaceKey);
        const secondSnapshot = await repo.readSession(session.metadata.sessionId);
        await compactIfNeeded({
            repo,
            snapshot: secondSnapshot,
            messages: repo.reduce(secondSnapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            compaction: {
                trigger: {kind: "tokens", value: 1},
                keepRecent: {kind: "tokens", value: 200},
            },
            writeCompactionEntry,
        });

        const snapshot = await repo.readSession(session.metadata.sessionId);
        const reducedText = repo.reduce(snapshot).messages.map((message) => messageText(message as never)).join("\n");
        const latestCompaction = snapshot.entries.filter((entry) => entry.type === "compaction").at(-1);
        expect(reducedText).not.toContain("OLD HISTORYSET SHOULD BE CUT");
        expect(reducedText).toContain("NEW HISTORYSET SHOULD STAY");
        expect(summaryPromptText(secondSummaryPrompt)).not.toContain("OLD HISTORYSET SHOULD BE CUT");
        expect(summaryPromptText(secondSummaryPrompt)).not.toContain("NEW HISTORYSET SHOULD STAY");
        expect(summaryPromptText(secondSummaryPrompt)).toContain("old user dialogue");
        expect(latestCompaction?.type === "compaction" ? latestCompaction.details?.firstKeptEntryType : undefined).toBe("custom_message");
        expect(latestCompaction?.type === "compaction" ? latestCompaction.details?.recentTokens : undefined).toBeGreaterThan(0);
        expect(latestCompaction?.type === "compaction" ? latestCompaction.details?.visibleTokensBefore : undefined)
            .toBe(latestCompaction?.type === "compaction" ? latestCompaction.tokensBefore : undefined);
    });

    it("persisted sidecar message 作为普通 message 进入 summary 输入", async () => {
        let summaryPrompt: Context | null = null;
        faux.setResponses([
            (context) => {
                summaryPrompt = context;
                return fauxAssistantMessage(fauxText("SIDECAR SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            message: createUserMessage({text: "PERSISTED SIDECAR CONTEXT"}),
            origin: "harness",
        }, session.metadata.workspaceKey);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            message: createUserMessage({text: "RUNTIME ONLY SHADOW SHOULD NOT EXIST IN SUMMARY"}),
            visibleToModel: true,
        }, session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecent: {kind: "tokens", value: 1},
            },
        });

        expect(summaryPromptText(summaryPrompt)).toContain("PERSISTED SIDECAR CONTEXT");
        expect(summaryPromptText(summaryPrompt)).not.toContain("RUNTIME ONLY SHADOW SHOULD NOT EXIST IN SUMMARY");
    });

    it("attachment 使用 marker 参与 compaction 与固定 token 预算，不读取 blob", async () => {
        let summaryPrompt: Context | null = null;
        faux.setResponses([(context) => {
            summaryPrompt = context;
            return fauxAssistantMessage(fauxText("ATTACHMENT SUMMARY"));
        }]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const block: StoredAttachmentContent = {
            type: "attachment",
            attachment: {
                id: `sha256:${"b".repeat(64)}`,
                mimeType: "image/png",
                bytes: 7_170_689,
            },
            name: "world-map.png",
        };
        const imageMessage: StoredAgentMessage = {role: "user", content: [block], timestamp: 1};
        await repo.appendMessage(session.metadata.sessionId, imageMessage as never, session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "recent"}), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            writeCompactionEntry: createCompactionEntryWriter(repo, session.metadata.sessionId),
            compaction: {
                reserveTokens: 2_000,
                keepRecent: {kind: "tokens", value: 1},
            },
        });

        const latest = (await repo.readSession(session.metadata.sessionId)).entries
            .filter((entry) => entry.type === "compaction")
            .at(-1);
        expect(summaryPromptText(summaryPrompt)).toContain(attachmentMarker(block));
        expect(latest?.type === "compaction" ? latest.details?.summarizedTokens : undefined).toBe(1_200);
        expect(latest?.type === "compaction" ? latest.tokensBefore : undefined).toBeGreaterThanOrEqual(1_200);
    });
});

function createCompactionEntryWriter(repo: JsonlSessionRepository, sessionId: number): Parameters<typeof appendCompaction>[0]["writeCompactionEntry"] {
    return async (entry) => {
        await repo.appendEntry(sessionId, entry);
    };
}

function summaryPromptText(context: Context | null): string {
    if (!context) {
        return "";
    }
    return context.messages.map((message) => messageText(message as never)).join("\n");
}
