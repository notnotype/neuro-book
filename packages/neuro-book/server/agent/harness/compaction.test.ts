import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import type {Context} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {appendCompaction, assertCompactionMadeProgress, COMPACTION_PROMPT, COMPACTION_SUMMARY_PREFIX, compactIfNeeded, resolveCompactionOptions, shouldCompactWithOptions} from "nbook/server/agent/harness/compaction";
import {assertProviderContextWithinWindow, estimateProviderContextTokens, pruneProviderMessagesForWindow} from "nbook/server/agent/harness/context-admission";
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
        root = absoluteFsPath(testHostPath("agent-compaction-test", randomUUID()));
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
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        for (let index = 1; index <= 6; index += 1) {
            await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: `user ${String(index)}`}));
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

    it("AbortSignal透传给摘要Provider，取消后不写compaction entry", async () => {
        let receivedSignal: AbortSignal | undefined;
        let markProviderStarted: () => void = () => undefined;
        const providerStarted = new Promise<void>((resolve) => {
            markProviderStarted = resolve;
        });
        faux.setResponses([
            async (_context, options) => {
                receivedSignal = options?.signal;
                markProviderStarted();
                if (!receivedSignal) {
                    throw new Error("测试未收到 compaction AbortSignal");
                }
                await new Promise<void>((resolve) => {
                    if (receivedSignal?.aborted) {
                        resolve();
                        return;
                    }
                    receivedSignal?.addEventListener("abort", () => resolve(), {once: true});
                });
                return fauxAssistantMessage([], {
                    stopReason: "aborted",
                    errorMessage: "compaction cancelled",
                });
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}));
        const snapshot = await repo.readSession(session.metadata.sessionId);
        const controller = new AbortController();
        let writeCalled = false;

        const compacting = appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model: faux.getModel(),
            signal: controller.signal,
            writeCompactionEntry: async () => {
                writeCalled = true;
            },
            compaction: {
                reserveTokens: 2_000,
                keepRecent: {kind: "tokens", value: 1},
            },
        });
        await providerStarted;
        controller.abort(new Error("project closing"));

        await expect(compacting).rejects.toThrow("project closing");
        expect(receivedSignal).toBe(controller.signal);
        expect(writeCalled).toBe(false);
    });

    it("cut point 不会从 toolResult 半截开始", async () => {
        faux.setResponses([fauxAssistantMessage(fauxText("TOOL SUMMARY"))]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old"}));
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [
            fauxText("call"),
            fauxToolCall("report_result", {result: "ok"}, {id: "tool-1"}),
        ];
        await repo.appendMessage(session.metadata.sessionId, assistant);
        await repo.appendMessage(session.metadata.sessionId, createTextToolResult({
            toolCallId: "tool-1",
            toolName: "report_result",
            text: "ok",
        }));
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
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [fauxToolCall("request_user_input", {questions: []}, {id: "approval-1"})];
        await repo.appendMessage(session.metadata.sessionId, assistant);
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
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}));
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
    it("摘要输入按独立窗口预算裁剪，避免摘要请求自身超窗", async () => {
        let summaryPromptTokens = 0;
        faux.setResponses([
            (context, _options, _state, model) => {
                summaryPromptTokens = estimateProviderContextTokens({
                    systemPrompt: context.systemPrompt,
                    messages: context.messages as never,
                }).tokens;
                if (summaryPromptTokens > model.contextWindow) {
                    return fauxAssistantMessage([], {
                        stopReason: "error",
                        errorMessage: `This model's maximum context length is ${model.contextWindow} tokens. However, you requested ${summaryPromptTokens} tokens.`,
                    });
                }
                return fauxAssistantMessage(fauxText("BOUNDED SUMMARY"));
            },
        ]);
        const model = {
            ...faux.getModel(),
            contextWindow: 2_000,
            maxTokens: 8_000,
        };
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context " + "old ".repeat(2_000)}));
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "recent context"}));
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model,
            compaction: {trigger: {kind: "tokens", value: 1}, keepRecent: {kind: "tokens", value: 1}, reserveTokens: 1_000},
            writeCompactionEntry: createCompactionEntryWriter(repo, session.metadata.sessionId),
        });

        expect(summaryPromptTokens).toBeLessThanOrEqual(model.contextWindow);
        const reduced = repo.reduce(await repo.readSession(session.metadata.sessionId));
        expect(messageText(reduced.messages[0] as never)).toContain("BOUNDED SUMMARY");
    });

    it("摘要输入工具结果超 2000 字符时裁剪并写标记", async () => {
        let summaryPrompt: Context | null = null;
        faux.setResponses([(context) => {
            summaryPrompt = context;
            return fauxAssistantMessage(fauxText("SUMMARY"));
        }]);
        const model = {...faux.getModel(), contextWindow: 8_000, maxTokens: 4_000};
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        const toolCall = createAssistantTextMessage({text: ""});
        toolCall.content = [{type: "toolCall", id: "tc-1", name: "read", arguments: {path: "large.txt"}}];
        await repo.appendMessage(session.metadata.sessionId, toolCall);
        // 3000 字符工具结果，超过 COMPACTION_TOOL_RESULT_MAX_CHARS (2000)
        await repo.appendMessage(session.metadata.sessionId, createTextToolResult({
            toolCallId: "tc-1",
            toolName: "read",
            text: "x".repeat(3_000),
        }));
        // 保留一条更新消息作为 recent 区，使前面的 toolResult 进入摘要 provider 输入。
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "recent context"}));
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model,
            compaction: {trigger: {kind: "tokens", value: 1}, keepRecent: {kind: "tokens", value: 1}, reserveTokens: 1_000},
            writeCompactionEntry: createCompactionEntryWriter(repo, session.metadata.sessionId),
        });

        const reduced = repo.reduce(await repo.readSession(session.metadata.sessionId));
        expect(messageText(reduced.messages[0] as never)).toContain("SUMMARY");
        // marker 位于发送给摘要 provider 的输入，不会自动出现在 provider 的摘要输出中。
        expect(summaryPromptText(summaryPrompt)).toContain("[... tool result truncated for compaction ...]");
    });

    it("摘要最终上下文超窗时在 provider 调用前降级", async () => {
        let providerCalls = 0;
        faux.setResponses([() => {
            providerCalls += 1;
            return fauxAssistantMessage(fauxText("SHOULD NOT RUN"));
        }]);
        const model = {...faux.getModel(), contextWindow: 64, maxTokens: 16};
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}));
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await expect(compactIfNeeded({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model,
            compaction: {
                trigger: {kind: "tokens", value: 1},
                keepRecent: {kind: "tokens", value: 1},
                reserveTokens: 16,
                prompt: "p".repeat(512),
            },
            writeCompactionEntry: createCompactionEntryWriter(repo, session.metadata.sessionId),
        })).resolves.toBe(true);

        const latest = (await repo.readSession(session.metadata.sessionId)).entries
            .filter((entry) => entry.type === "compaction")
            .at(-1);
        expect(providerCalls).toBe(0);
        expect(latest?.type === "compaction" ? latest.details?.summaryStrategy : undefined).toBe("deterministic-fallback");
        expect(latest?.type === "compaction" ? latest.details?.summaryError : undefined).toContain("Provider 请求上下文");
    });

    it("自动压缩摘要 provider 失败时写入有界确定性回退", async () => {
        faux.setResponses([
            fauxAssistantMessage([], {
                stopReason: "error",
                errorMessage: "This model's maximum context length is 2000 tokens. However, you requested 2029 tokens.",
            }),
        ]);
        const model = {...faux.getModel(), contextWindow: 2_000, maxTokens: 8_000};
        const session = await repo.createSession({profileKey: "leader.default", initial: {}});
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context " + "old ".repeat(2_000)}));
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "recent context"}));
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await expect(compactIfNeeded({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            models: faux.runtime,
            model,
            compaction: {trigger: {kind: "tokens", value: 1}, keepRecent: {kind: "tokens", value: 1}, reserveTokens: 1_000},
            writeCompactionEntry: createCompactionEntryWriter(repo, session.metadata.sessionId),
        })).resolves.toBe(true);

        const latest = (await repo.readSession(session.metadata.sessionId)).entries.filter((entry) => entry.type === "compaction").at(-1);
        expect(latest?.type === "compaction" ? latest.details?.summaryStrategy : undefined).toBe("deterministic-fallback");
        expect(latest?.type === "compaction" ? latest.details?.summaryInputTokens : undefined).toBeLessThanOrEqual(model.contextWindow);
    });

    it("provider 门禁只裁剪 toolResult 正文并保留消息配对", () => {
        const toolCall = createAssistantTextMessage({text: ""});
        toolCall.content = [{type: "toolCall", id: "tool-1", name: "read", arguments: {path: "large.md"}}];
        const toolResult = createTextToolResult({toolCallId: "tool-1", toolName: "read", text: "x".repeat(20_000)});
        const result = pruneProviderMessagesForWindow({
            systemPrompt: "system",
            messages: [toolCall, toolResult] as never,
            contextWindow: 1_000,
        });

        expect(result.pruned).toBe(true);
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0]?.role).toBe("assistant");
        expect(result.messages[1]?.role).toBe("toolResult");
        expect(messageText(result.messages[1] as never).length).toBeLessThan(20_000);
        expect(estimateProviderContextTokens({systemPrompt: "system", messages: result.messages as never}).tokens).toBeLessThanOrEqual(1_000);
    });

    it("上一轮 assistant usage 不会掩盖当前 system/tools 固定开销", () => {
        const assistant = createAssistantTextMessage({text: "prior"});
        assistant.usage = {
            input: 10,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 11,
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
        };

        expect(() => assertProviderContextWithinWindow({
            systemPrompt: "x".repeat(800),
            messages: [assistant],
            contextWindow: 100,
            modelId: "dynamic-prefix-model",
        })).toThrow("Provider 请求上下文");
    });

    it("已有 checkpoint 且恢复后仍过触发线时停止重复压缩", () => {
        const options = resolveCompactionOptions({
            trigger: {kind: "tokens", value: 100},
            keepRecent: {kind: "tokens", value: 20},
        }, faux.getModel());

        expect(() => assertCompactionMadeProgress({
            beforeTokens: 160,
            afterTokens: 120,
            contextWindow: faux.getModel().contextWindow,
            options,
            hadPreviousCompaction: true,
        })).toThrow("自动压缩无进展");
        expect(() => assertCompactionMadeProgress({
            beforeTokens: 160,
            afterTokens: 99,
            contextWindow: faux.getModel().contextWindow,
            options,
            hadPreviousCompaction: true,
        })).not.toThrow();
        expect(() => assertCompactionMadeProgress({
            beforeTokens: 160,
            afterTokens: 120,
            contextWindow: faux.getModel().contextWindow,
            options,
            hadPreviousCompaction: false,
        })).not.toThrow();
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

    it("triggerTokens 生效并把自定义 prompt/prefix 写入 summary 调用和 compaction entry", async () => {
        let summaryPrompt: Context | null = null;
        let summaryHeaders: Record<string, string | null> | undefined;
        let summaryMaxRetries: number | undefined;
        faux.setResponses([
            (context, options) => {
                summaryPrompt = context;
                summaryHeaders = options?.headers;
                summaryMaxRetries = options?.maxRetries;
                return fauxAssistantMessage(fauxText("CUSTOM SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}));
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
                prompt: "CUSTOM PROMPT",
                summaryPrefix: "CUSTOM PREFIX",
            },
            writeCompactionEntry,
        });

        const reduced = repo.reduce(await repo.readSession(session.metadata.sessionId));
        expect(compacted).toBe(true);
        const capturedPrompt = summaryPrompt as Context | null;
        expect(capturedPrompt?.systemPrompt).toBe("CUSTOM PROMPT");
        expect(summaryMaxRetries).toBe(5);
        expect(summaryHeaders).toEqual({
            "x-request": "request",
            "x-model": "model",
            "x-shared": "request",
        });
        expect(messageText(reduced.messages[0] as never)).toContain("CUSTOM PREFIX");
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
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            message: createUserMessage({text: "OLD HISTORYSET SHOULD BE CUT " + "old ".repeat(200)}),
            visibleToModel: true,
        });
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old user dialogue"}));
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
        });
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "new user dialogue"}));
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
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            message: createUserMessage({text: "PERSISTED SIDECAR CONTEXT"}),
            clientMessageId: randomUUID(),
            intent: "normal",
            origin: "harness",
        });
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            message: createUserMessage({text: "RUNTIME ONLY SHADOW SHOULD NOT EXIST IN SUMMARY"}),
            visibleToModel: true,
        });
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
        await repo.appendMessage(session.metadata.sessionId, imageMessage as never);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "recent"}));
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
