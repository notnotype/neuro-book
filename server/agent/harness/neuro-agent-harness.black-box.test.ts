import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createStoredUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {Message as RuntimeMessage} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage, StoredUserMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";
import type {NeuroSessionContext, SessionEntry} from "nbook/server/agent/session/types";
import {normalizeWorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type ObservedRun = {
    result: AgentInvocationResult;
    events: AgentSessionEventDto[];
    snapshot: Awaited<ReturnType<JsonlSessionRepository["readSession"]>>;
    context: NeuroSessionContext;
};

type EventTrace = Array<{
    kind: AgentSessionEventDto["kind"];
    type: string;
    seq: number;
    invocationId?: string;
    entryType?: string;
    toolName?: string;
    status?: string;
}>;

type EventObserver = {
    events: AgentSessionEventDto[];
    stop(): Promise<void>;
};

function defineAgentProfile(profile: any): ReturnType<typeof defineRuntimeAgentProfile> {
    const {
        allowedToolKeys,
        mainRunAllowedToolKeys,
        sidecars,
        toolKeys,
        ...rest
    } = profile;
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(allowedToolKeys ?? []),
        toolKeys: toolKeys ?? mainRunAllowedToolKeys,
        sidecars: sidecars?.map((sidecar: any) => {
            const {
                allowedToolKeys: sidecarAllowedToolKeys,
                ...sidecarRest
            } = sidecar;
            return {
                ...sidecarRest,
                toolKeys: sidecarRest.toolKeys ?? sidecarAllowedToolKeys,
            };
        }),
    });
}

function registerPlainProfile(
    harness: NeuroAgentHarness,
    input: {
        key: string;
        allowedToolKeys?: readonly string[];
    },
): string {
    harness.profiles.register(defineAgentProfile({
        manifest: {
            key: input.key,
            name: input.key,
        },
        initialSchema: Type.Object({}),
        tools: profileToolsFromKeys(input.allowedToolKeys ?? []),
        prepare() {
            return {};
        },
    }), false);
    return input.key;
}

function visibleText(messages: StoredAgentMessage[]): string {
    return messages.map((message) => storedMessageText(message)).join("\n");
}

function eventType(event: AgentSessionEventDto): string {
    return event.event.type;
}

function trace(events: AgentSessionEventDto[]): EventTrace {
    return events.map((event) => {
        const payload = event.event;
        return {
            kind: event.kind,
            type: payload.type,
            seq: event.seq,
            invocationId: event.invocationId,
            entryType: "entry" in payload ? payload.entry.type : undefined,
            toolName: "toolName" in payload ? payload.toolName : undefined,
            status: "status" in payload ? String(payload.status) : undefined,
        };
    });
}

function eventTypes(events: AgentSessionEventDto[]): string[] {
    return events.map(eventType);
}

function sessionRoles(context: NeuroSessionContext): string[] {
    return context.messages.map((message) => message.role);
}

function lifecycleStatuses(snapshot: Awaited<ReturnType<JsonlSessionRepository["readSession"]>>): string[] {
    return snapshot.entries
        .filter((entry): entry is SessionEntry & {type: "invocation_lifecycle"} => entry.type === "invocation_lifecycle")
        .map((entry) => entry.status);
}

function firstIndex(events: AgentSessionEventDto[], type: string, predicate: (event: AgentSessionEventDto) => boolean = () => true): number {
    return events.findIndex((event) => event.event.type === type && predicate(event));
}

function expectOrdered(events: AgentSessionEventDto[], first: string, second: string): void {
    const firstAt = firstIndex(events, first);
    const secondAt = firstIndex(events, second);
    expect({first, firstAt, second, secondAt, trace: trace(events)}).toEqual(expect.objectContaining({
        firstAt: expect.any(Number),
        secondAt: expect.any(Number),
    }));
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(secondAt).toBeGreaterThan(firstAt);
}

async function observeSession(harness: NeuroAgentHarness, sessionId: number): Promise<EventObserver> {
    const subscription = harness.subscribeSessionEvents(sessionId, {
        eventEpoch: harness.eventHub.eventEpoch,
        after: harness.eventHub.lastSeq(sessionId),
    });
    const iterator = subscription[Symbol.asyncIterator]();
    const events: AgentSessionEventDto[] = [];
    const collector = (async () => {
        for (;;) {
            const next = await iterator.next();
            if (next.done) {
                return;
            }
            events.push(next.value.payload);
        }
    })();
    return {
        events,
        async stop() {
            await iterator.return?.();
            await collector;
        },
    };
}

async function runAndObserve(
    harness: NeuroAgentHarness,
    sessionId: number,
    run: () => Promise<AgentInvocationResult>,
): Promise<ObservedRun> {
    const observer = await observeSession(harness, sessionId);
    try {
        const result = await run();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const snapshot = await harness.repo.readSession(sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        return {
            result,
            events: [...observer.events],
            snapshot,
            context,
        };
    } finally {
        await observer.stop();
    }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`等待条件超时：${label}`);
}

describe("NeuroAgentHarness black-box contract", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = resolve(".agent", "agent-harness-black-box-test", randomUUID());
        faux = createFauxModels({
            models: [{
                id: `faux-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        await writeFauxProviderConfig(root, faux);
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(join(root, "profiles-system"), join(root, "profiles-user")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await rm(root, {recursive: true, force: true});
    });

    it("Idle + prompt 会产生 runtime events、session entries 和 completed response", async () => {
        harness.tools.register({
            key: "bb_echo",
            name: "bb_echo",
            label: "BlackBox Echo",
            description: "Echo for black-box tests.",
            parameters: Type.Object({
                text: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                const input = params as {text: string};
                return {
                    content: [{type: "text", text: `echo:${input.text}`}],
                    details: input,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.prompt",
                name: "BlackBox Prompt",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_echo"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("I will call a tool."),
                fauxToolCall("bb_echo", {text: "hello"}, {id: "echo-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("done after tool"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.prompt",
            initial: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));

        expect(observed.result.status).toBe("completed");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        expect(lifecycleStatuses(observed.snapshot)).toEqual(["start", "end"]);
        expect(eventTypes(observed.events)).toEqual(expect.arrayContaining([
            "agent_start",
            "turn_start",
            "message_start",
            "message_update",
            "message_end",
            "tool_execution_start",
            "tool_execution_end",
            "turn_end",
            "agent_end",
            "session_entry",
            "session_state_changed",
        ]));
        expectOrdered(observed.events, "agent_start", "turn_start");
        expectOrdered(observed.events, "tool_execution_start", "tool_execution_end");
        expectOrdered(observed.events, "turn_end", "agent_end");
    // 文件内首个全链路 invocation 用例承担 harness/faux provider 暖机（>5s 默认预算），显式放宽；
    // 超时会让 invocation 悬置并级联炸掉下一个用例的 admission（active_invocation_exists）。
    }, 30000);

    it("Idle + continue 从现有 dialogue tail 继续且不新增 user message", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.continue",
        });
        faux.setResponses([fauxAssistantMessage("continued")]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createStoredUserMessage("existing prompt"));

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
        }));

        expect(observed.result.status).toBe("completed");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant"]);
        expect(visibleText(observed.context.messages)).toContain("existing prompt");
        expect(visibleText(observed.context.messages)).toContain("continued");
    });

    it("durable user attachment 经 session reduce 后仍为 Provider 恢复真实图片", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.attachment-recovery",
        });
        faux.getModel().input = ["text", "image"];
        let recoveredProviderMessages: RuntimeMessage[] = [];
        faux.setResponses([(context) => {
            recoveredProviderMessages = context.messages;
            return fauxAssistantMessage("attachment recovered");
        }]);
        const created = await harness.repo.createSession({
            profileKey,
            initial: {},
            workspaceRoot: normalizeWorkspaceRootRef(root),
        });
        const imageData = Buffer.from(pngBytes).toString("base64");
        const attachment = await harness.attachmentCodec.saveImage({bytes: pngBytes, mimeType: "image/png", name: "memory.png"});
        const storedUser: StoredUserMessage = {
            role: "user",
            content: [{type: "text", text: "remember this image"}, attachment],
            timestamp: Date.now(),
        };
        // SessionEntry 的公开类型尚沿用 Pi Message；Repository invariant 会校验这里实际写入的是 stored message。
        await harness.repo.appendMessage(created.metadata.sessionId, storedUser, undefined, "prompt");

        const durable = await harness.repo.readSession(created.metadata.sessionId);
        const durableUser = harness.repo.activePath(durable).find((entry) => entry.type === "message" && entry.message.role === "user");
        expect(durableUser?.type === "message" && "content" in durableUser.message ? durableUser.message.content : undefined).toEqual([
            {type: "text", text: "remember this image"},
            expect.objectContaining({
                type: "attachment",
                attachment: expect.objectContaining({mimeType: "image/png", bytes: pngBytes.byteLength}),
            }),
        ]);
        expect(messageText(harness.repo.reduce(durable).messages[0]!)).toContain("[attachment omitted: image/png");

        const second = await harness.invokeAgent({
            sessionId: created.metadata.sessionId,
            mode: "continue",
        });

        expect(second.status).toBe("completed");
        const recoveredUser = recoveredProviderMessages.find((message) => message.role === "user");
        expect(recoveredUser && "content" in recoveredUser ? recoveredUser.content : undefined).toEqual([
            {type: "text", text: "remember this image"},
            {type: "image", mimeType: "image/png", data: imageData},
        ]);
        expect(JSON.stringify(recoveredProviderMessages)).not.toContain("[attachment omitted:");
    }, 30000);

    it("Idle + steer/followup 会被 admission 拒绝且不写 session", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.reject",
        });
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });
        const before = await harness.repo.readSession(created.sessionId);

        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "steer"},
        })).rejects.toThrow("active_invocation_required");
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "follow"},
        })).rejects.toThrow("active_invocation_required");

        const after = await harness.repo.readSession(created.sessionId);
        const recovery = await harness.getSessionRecovery(created.sessionId);
        expect(after.entries).toEqual(before.entries);
        expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
        expect(recovery.followUpQueue.items).toEqual([]);
    });

    it("Running + steer 入队后只在 safe point drain 成模型可见消息", async () => {
        let releaseTool = (): void => undefined;
        const toolGate = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "bb_continue",
            name: "bb_continue",
            label: "BlackBox Continue",
            description: "Continues the current run.",
            parameters: Type.Object({}),
            async execute() {
                await toolGate;
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.steer",
                name: "BlackBox Steer",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_continue"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_continue", {}, {id: "continue-1"}),
            ], {stopReason: "toolUse"}),
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.steer",
            initial: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "tool execution start before steer");
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                message: {text: "adjust while running"},
            });
            const beforeDrain = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            releaseTool();

            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

            expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
            expect(visibleText(beforeDrain.messages)).not.toContain("adjust while running");
            expect(result.status).toBe("completed");
            expect(visibleText(context.messages)).toContain("adjust while running");
            expect(snapshot.steerQueue).toEqual({items: [], omittedItems: 0});
            expect(eventTypes(observer.events)).toContain("steer_queued");
        } finally {
            releaseTool();
            await observer.stop();
        }
    });

    it("Running + 图片 followup 入队后按 stored attachment 自动消费", async () => {
        let releaseTool = (): void => undefined;
        const toolGate = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "bb_continue_followup",
            name: "bb_continue_followup",
            label: "BlackBox Followup Continue",
            description: "Continues the current run.",
            parameters: Type.Object({}),
            async execute() {
                await toolGate;
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.followup",
                name: "BlackBox Followup",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_continue_followup"],
            prepare() {
                return {};
            },
        }), false);
        faux.getModel().input = ["text", "image"];
        let followUpProviderMessages: RuntimeMessage[] = [];
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_continue_followup", {}, {id: "continue-followup"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("first run done"),
            (context) => {
                followUpProviderMessages = context.messages;
                return fauxAssistantMessage("followup answered");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.followup",
            initial: {},
            workspaceRoot: root,
        });

        // 锚定 tool_execution_start（与上方 steer 用例同款）：createAgent 已产生事件使 lastSeq>0 恒真，
        // 旧锚点会让 followup 赶在 prompt admission 之前提交而被拒（active_invocation_required 竞态）。
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "tool execution start before followup");
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {
                    text: "queued followup",
                    images: [{
                        type: "image",
                        mimeType: "image/png",
                        data: Buffer.from(pngBytes).toString("base64"),
                    }],
                },
            });
            const beforeDrain = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            releaseTool();
            const result = await running;
            const context = await waitForSessionText(harness, created.sessionId, "queued followup");
            const snapshot = await harness.getSessionRecovery(created.sessionId);

            expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
            expect(visibleText(beforeDrain.messages)).not.toContain("queued followup");
            expect(result.status).toBe("completed");
            expect(visibleText(context.messages)).toContain("queued followup");
            expect(visibleText(context.messages)).toContain("followup answered");
            const durableFollowUp = context.messages.find((message) => message.role === "user"
                && Array.isArray(message.content)
                && message.content.some((block) => block.type === "text" && block.text === "queued followup"));
            expect(durableFollowUp && "content" in durableFollowUp ? durableFollowUp.content : undefined).toEqual([
                {type: "text", text: "queued followup"},
                expect.objectContaining({
                    type: "attachment",
                    attachment: expect.objectContaining({mimeType: "image/png", bytes: pngBytes.byteLength}),
                }),
            ]);
            const providerFollowUp = followUpProviderMessages.find((message) => message.role === "user"
                && Array.isArray(message.content)
                && message.content.some((block) => block.type === "text" && block.text === "queued followup"));
            expect(providerFollowUp && "content" in providerFollowUp ? providerFollowUp.content : undefined).toEqual([
                {type: "text", text: "queued followup"},
                {type: "image", mimeType: "image/png", data: Buffer.from(pngBytes).toString("base64")},
            ]);
            expect(snapshot.followUpQueue.items).toEqual([]);
        } finally {
            releaseTool();
            await observer.stop();
        }
    });

    it("WaitingUser + continue(resolution) 写 resolution toolResult 并复用 invocationId", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.waiting",
                name: "BlackBox Waiting",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "ask-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("resumed done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting",
            initial: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const waitingSnapshot = await harness.getSessionRecovery(created.sessionId);
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-1",
                answers: [{questionIndex: 0, text: "go"}],
            },
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(waiting.status).toBe("waiting");
        expect(waitingSnapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "ask-1",
            toolName: "request_user_input",
        }));
        expect(continued.status).toBe("completed");
        expect(continued.invocationId).toBe(waiting.invocationId);
        expect(lifecycleStatuses(snapshot)).toEqual(["start", "waiting", "resumed", "end"]);
        expect(sessionRoles(context)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    });

    it("WaitingUser 期间 prompt/followup/steer 入队但不写 durable history", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.waiting-queue",
                name: "BlackBox Waiting Queue",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "ask-queue"}),
            ], {stopReason: "toolUse"}),
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
            fauxAssistantMessage("queued prompt answered"),
            fauxAssistantMessage("queued followup answered"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting-queue",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });

        const queuedPrompt = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "queued prompt"},
        });
        const queuedFollowup = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        const queuedSteer = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "queued steer"},
        });
        const beforeResume = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-queue",
                answers: [{questionIndex: 0, text: "go"}],
            },
        });
        const context = await waitForSessionText(harness, created.sessionId, "queued followup");
        const snapshot = await harness.getSessionRecovery(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(queuedPrompt.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
        expect(queuedFollowup.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
        expect(queuedSteer.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
        expect(visibleText(beforeResume.messages)).not.toContain("queued prompt");
        expect(visibleText(beforeResume.messages)).not.toContain("queued followup");
        expect(visibleText(beforeResume.messages)).not.toContain("queued steer");
        expect(continued.status).toBe("completed");
        expect(visibleText(context.messages)).toContain("queued steer");
        expect(visibleText(context.messages)).toContain("queued prompt");
        expect(visibleText(context.messages)).toContain("queued followup");
        expect(snapshot.steerQueue).toEqual({items: [], omittedItems: 0});
        expect(snapshot.followUpQueue.items).toEqual([]);
    });

    it("provider error before stream 保留 user message、不写空 assistant，并写 error lifecycle", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.provider-error",
        });
        faux.setResponses([
            fauxAssistantMessage([], {stopReason: "error", errorMessage: "provider failed"}),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        }));

        expect(observed.result.status).toBe("error");
        expect(observed.result.errorInfo).toEqual(expect.objectContaining({
            message: "provider failed",
            phase: "model",
        }));
        expect(sessionRoles(observed.context)).toEqual(["user"]);
        expect(lifecycleStatuses(observed.snapshot)).toEqual(["start", "error"]);
        expect(eventTypes(observed.events)).toContain("agent_end");
    });

    it("provider partial error 保存文本并剥离未闭合 tool call", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.partial-error",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("half answer"),
                fauxToolCall("read", {path: "x"}, {id: "partial-tool"}),
            ], {stopReason: "error", errorMessage: "stream dropped"}),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        }));
        const assistantEntry = observed.snapshot.entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");

        expect(observed.result.status).toBe("error");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant"]);
        expect(assistantEntry).toEqual(expect.objectContaining({
            type: "message",
            status: "partial",
        }));
        expect(assistantEntry && assistantEntry.type === "message" ? messageText(assistantEntry.message) : "").toBe("half answer");
        expect(assistantEntry && assistantEntry.type === "message" && assistantEntry.message.role === "assistant"
            ? assistantEntry.message.content.some((block) => block.type === "toolCall")
            : true).toBe(false);
    });

    it("recoverable tool error 作为普通 toolResult 提交并允许模型继续", async () => {
        harness.tools.register({
            key: "bb_recoverable_error",
            name: "bb_recoverable_error",
            label: "BlackBox Recoverable Error",
            description: "Returns an error tool result.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "recoverable failed"}],
                    details: {},
                    isError: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.recoverable-tool",
                name: "BlackBox Recoverable Tool",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_recoverable_error"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_recoverable_error", {}, {id: "recoverable-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("handled recoverable error"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.recoverable-tool",
            initial: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));
        const toolResult = observed.context.messages.find((message) => message.role === "toolResult");

        expect(observed.result.status).toBe("completed");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        expect(toolResult).toEqual(expect.objectContaining({
            role: "toolResult",
            isError: false,
        }));
        expect(toolResult ? messageText(toolResult) : "").toBe("recoverable failed");
        expect(visibleText(observed.context.messages)).toContain("handled recoverable error");
    });

    it("fatal tool error 生成 error toolResult 闭合 tool call，并以 error terminal 结束", async () => {
        harness.tools.register({
            key: "bb_fatal",
            name: "bb_fatal",
            label: "BlackBox Fatal",
            description: "Throws.",
            parameters: Type.Object({}),
            async execute() {
                throw new Error("fatal tool failure");
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.fatal-tool",
                name: "BlackBox Fatal Tool",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_fatal"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_fatal", {}, {id: "fatal-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.fatal-tool",
            initial: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));
        const toolResult = observed.context.messages.find((message) => message.role === "toolResult");

        expect(observed.result.status).toBe("error");
        expect(observed.result.errorInfo?.phase).toBe("model");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant", "toolResult"]);
        expect(toolResult).toEqual(expect.objectContaining({
            role: "toolResult",
            isError: true,
        }));
        expect(lifecycleStatuses(observed.snapshot)).toEqual(["start", "error"]);
    });

    it("terminal error 后清理 steer 并暂停 followup queue", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.terminal-error-queue",
        });
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await waitUntil(async () => (await harness.getSessionRecovery(created.sessionId)).activeInvocation !== null, "active invocation before queueing steer");
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "will be cleared"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "will be paused"},
        });
        const result = await running;
        const snapshot = await harness.getSessionRecovery(created.sessionId);

        expect(result.status).toBe("error");
        expect(snapshot.steerQueue).toEqual({items: [], omittedItems: 0});
        expect(snapshot.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "error",
            },
            items: [expect.objectContaining({
                kind: "followup",
                text: expect.objectContaining({preview: "will be paused", omitted: false}),
            })],
            omittedItems: 0,
        });
        expect(faux.getPendingResponseCount()).toBe(1);
    });

    it("WaitingUser + abort 写 abort resolution、aborted lifecycle 并释放 active", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.waiting-abort",
                name: "BlackBox Waiting Abort",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Wait?"}],
                }, {id: "abort-waiting"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting-abort",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const aborted = await harness.abortInvocation(created.sessionId, {reason: "user stop"});
            await new Promise((resolve) => setTimeout(resolve, 0));
            const recovery = await harness.getSessionRecovery(created.sessionId);
            const snapshot = await harness.repo.readSession(created.sessionId);
            const context = harness.repo.reduce(snapshot);
            const abortToolResult = context.messages.find((message) => message.role === "toolResult");

            expect(waiting.status).toBe("waiting");
            expect(aborted).toEqual({
                status: "aborted",
                sessionId: created.sessionId,
            });
            expect(recovery.activeInvocation).toBeNull();
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "waiting", "aborted"]);
            expect(sessionRoles(context)).toEqual(["user", "assistant", "toolResult"]);
            expect(abortToolResult).toEqual(expect.objectContaining({
                role: "toolResult",
                toolCallId: "abort-waiting",
                isError: true,
            }));
            expect(abortToolResult ? messageText(abortToolResult) : "").toContain("Aborted: user stop");
            expect(eventTypes(observer.events)).toEqual(expect.arrayContaining([
                "session_entry",
                "invocation_aborted",
                "session_state_changed",
            ]));
        } finally {
            await observer.stop();
        }
    });

    it("Running + abort 清理 steer，并按 aborted 暂停 followup queue", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.running-abort",
        });
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("stopped", {stopReason: "aborted", errorMessage: "user stopped"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("agent_start"), "agent start before abort queue");
            const queuedSteer = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                message: {text: "will be cleared"},
            });
            const queuedFollowup = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: "will be paused"},
            });
            const aborted = await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: false});
            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            const recovery = await harness.getSessionRecovery(created.sessionId);
            const snapshot = await harness.repo.readSession(created.sessionId);
            const context = harness.repo.reduce(snapshot);

            expect(queuedSteer.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
            expect(queuedFollowup.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
            expect(aborted).toEqual({
                status: "aborted",
                sessionId: created.sessionId,
            });
            expect(result.status).toBe("error");
            expect(recovery.activeInvocation).toBeNull();
            expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
            expect(recovery.followUpQueue).toEqual({
                status: "paused",
                pausedBy: {
                    invocationId: result.invocationId,
                    reason: "aborted",
                },
                items: [expect.objectContaining({
                    kind: "followup",
                    text: expect.objectContaining({preview: "will be paused", omitted: false}),
                })],
                omittedItems: 0,
            });
            expect(visibleText(context.messages)).not.toContain("will be cleared");
            expect(visibleText(context.messages)).not.toContain("will be paused");
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "aborted"]);
            expect(eventTypes(observer.events)).toEqual(expect.arrayContaining([
                "steer_queued",
                "follow_up_queued",
                "invocation_aborted",
                "session_state_changed",
                "agent_end",
            ]));
            expect(faux.getPendingResponseCount()).toBe(1);
        } finally {
            await observer.stop();
        }
    });

    it("停止父 invocation 会递归中止子孙与并行兄弟，但不影响无关 session", async () => {
        const profileKey = registerPlainProfile(harness, {key: "test.blackbox.abort-tree"});
        faux.setResponses([
            ...Array.from({length: 4}, () => async () => {
                await new Promise((resolve) => setTimeout(resolve, 200));
                return fauxAssistantMessage("stopped", {stopReason: "aborted", errorMessage: "tree stopped"});
            }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));
                return fauxAssistantMessage("independent completed");
            },
        ]);
        const parent = await harness.createAgent({profileKey, initial: {}, workspaceRoot: root});
        const firstChild = await harness.createAgent({profileKey, initial: {}, workspaceRoot: root});
        const secondChild = await harness.createAgent({profileKey, initial: {}, workspaceRoot: root});
        const grandchild = await harness.createAgent({profileKey, initial: {}, workspaceRoot: root});
        const independent = await harness.createAgent({profileKey, initial: {}, workspaceRoot: root});
        const parentRun = harness.invokeAgent({sessionId: parent.sessionId, mode: "prompt", message: {text: "parent"}});
        await waitUntil(async () => Boolean((await harness.getSessionRecovery(parent.sessionId)).activeInvocation), "parent active");
        const parentInvocationId = (await harness.getSessionRecovery(parent.sessionId)).activeInvocation!.invocationId;
        const firstChildRun = harness.invokeAgent({
            sessionId: firstChild.sessionId,
            mode: "prompt",
            message: {text: "first child"},
            caller: {kind: "agent", sessionId: parent.sessionId, invocationId: parentInvocationId},
        });
        const secondChildRun = harness.invokeAgent({
            sessionId: secondChild.sessionId,
            mode: "prompt",
            message: {text: "second child"},
            caller: {kind: "agent", sessionId: parent.sessionId, invocationId: parentInvocationId},
        });
        await waitUntil(async () => Boolean((await harness.getSessionRecovery(firstChild.sessionId)).activeInvocation), "first child active");
        const firstChildInvocationId = (await harness.getSessionRecovery(firstChild.sessionId)).activeInvocation!.invocationId;
        const grandchildRun = harness.invokeAgent({
            sessionId: grandchild.sessionId,
            mode: "prompt",
            message: {text: "grandchild"},
            caller: {kind: "agent", sessionId: firstChild.sessionId, invocationId: firstChildInvocationId},
        });
        const independentRun = harness.invokeAgent({sessionId: independent.sessionId, mode: "prompt", message: {text: "independent"}});
        await waitUntil(async () => {
            const recoveries = await Promise.all([firstChild, secondChild, grandchild, independent].map((item) => harness.getSessionRecovery(item.sessionId)));
            return recoveries.every((recovery) => recovery.activeInvocation?.status === "running");
        }, "child tree and independent active");

        const aborting = harness.abortInvocation(parent.sessionId, {reason: "stop complete tree"});
        await waitUntil(async () => {
            const recoveries = await Promise.all([parent, firstChild, secondChild, grandchild].map((item) => harness.getSessionRecovery(item.sessionId)));
            return recoveries.every((recovery) => recovery.activeInvocation?.status === "aborting");
        }, "complete invocation tree aborting");
        expect((await harness.getSessionRecovery(independent.sessionId)).activeInvocation?.status).toBe("running");

        await expect(aborting).resolves.toEqual({status: "aborted", sessionId: parent.sessionId});
        const results = await Promise.all([
            parentRun, firstChildRun, secondChildRun, grandchildRun, independentRun,
        ]);
        expect(results.slice(0, 4).every((result) => result.status === "error")).toBe(true);
        const terminalRecoveries = await Promise.all([parent, firstChild, secondChild, grandchild].map((item) => harness.getSessionRecovery(item.sessionId)));
        expect(terminalRecoveries.every((recovery) => recovery.activeInvocation === null)).toBe(true);
    });

    it("SSE replay 和 snapshot_required 合同可从 Harness event hub 观察", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.sse-replay",
        });
        const created = await harness.createAgent({
            profileKey,
            initial: {},
            workspaceRoot: root,
        });
        const currentEpoch = harness.eventHub.eventEpoch;
        const replayAfter = harness.eventHub.lastSeq(created.sessionId);
        harness.eventHub.pinReplayFrom(created.sessionId, replayAfter + 1);
        harness.eventHub.publish({
            sessionId: created.sessionId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });
        const replay = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: currentEpoch,
            after: replayAfter,
        })[Symbol.asyncIterator]();
        const future = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: currentEpoch,
            after: 426,
        })[Symbol.asyncIterator]();
        const oldEpoch = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: "old-epoch",
            after: 0,
        })[Symbol.asyncIterator]();
        const newEvent = harness.eventHub.publish({
            sessionId: created.sessionId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "new",
            },
        });

        await expect(replay.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    eventEpoch: currentEpoch,
                    seq: replayAfter + 1,
                }),
            }),
        });
        await expect(future.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                payload: expect.objectContaining({
                    eventEpoch: currentEpoch,
                    event: expect.objectContaining({
                        type: "snapshot_required",
                        reason: "event cursor is ahead of server",
                    }),
                }),
            }),
        });
        await expect(oldEpoch.next()).resolves.toEqual({
            done: false,
            value: newEvent,
        });

        await replay.return?.();
        await future.return?.();
        await oldEpoch.return?.();
        harness.eventHub.unpinReplay(created.sessionId);
    }, 15_000);

    it("slow tool 未完成前已经能观察到 tool 参数与 tool_execution_start", async () => {
        let releaseTool = () => {};
        const toolBlocker = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "slow_tool",
            name: "slow_tool",
            label: "Slow Tool",
            description: "Waits until released.",
            parameters: Type.Object({
                text: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                await toolBlocker;
                const input = params as {text: string};
                return {
                    content: [{type: "text", text: `slow:${input.text}`}],
                    details: input,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.slow-tool",
                name: "BlackBox Slow Tool",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["slow_tool"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("slow_tool", {text: "payload"}, {id: "slow-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("slow done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.slow-tool",
            initial: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "run slow"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "slow tool execution start");
            const messageUpdates = observer.events.filter((event) => event.event.type === "message_update");
            const hasToolDelta = messageUpdates.some((event) => {
                return event.event.type === "message_update" && event.event.update.type === "toolcall_args";
            });
            const beforeReleaseTypes = eventTypes(observer.events);

            expect(hasToolDelta).toBe(true);
            expect(beforeReleaseTypes).toContain("tool_execution_start");
            expect(beforeReleaseTypes).not.toContain("tool_execution_end");

            releaseTool();
            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(result.status).toBe("completed");
            expect(eventTypes(observer.events)).toContain("tool_execution_end");
        } finally {
            releaseTool();
            await observer.stop();
        }
    });

    it("运行中 snapshot 使用 transcript replay anchor 恢复未落盘事件", async () => {
        let releaseTool = () => {};
        const toolBlocker = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "slow_replay_tool",
            name: "slow_replay_tool",
            label: "Slow Replay Tool",
            description: "Waits until released.",
            parameters: Type.Object({
                text: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                await toolBlocker;
                const input = params as {text: string};
                return {
                    content: [{type: "text", text: `slow:${input.text}`}],
                    details: input,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.slow-replay",
                name: "BlackBox Slow Replay",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["slow_replay_tool"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("slow_replay_tool", {text: "payload"}, {id: "slow-replay-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("slow replay done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.slow-replay",
            initial: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "run slow replay"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "slow replay tool execution start");

            const runningSnapshot = await harness.getSessionRecovery(created.sessionId);
            const runningLedger = await harness.repo.readSession(created.sessionId);
            expect(runningSnapshot.activeInvocation).not.toBeNull();
            expect(runningSnapshot.eventCursor.after).toBeLessThan(harness.eventHub.lastSeq(created.sessionId));
            expect(runningLedger.entries.some((entry) => entry.type === "message" && entry.message.role === "assistant")).toBe(false);

            const replay = harness.subscribeSessionEvents(created.sessionId, runningSnapshot.eventCursor)[Symbol.asyncIterator]();
            const replayed: AgentSessionEventDto[] = [];
            try {
                await waitUntil(async () => {
                    const next = await replay.next();
                    if (next.done) {
                        return false;
                    }
                    replayed.push(next.value.payload);
                    return eventTypes(replayed).includes("tool_execution_start");
                }, "running refresh replay reaches tool start");
            } finally {
                await replay.return?.();
            }
            expect(eventTypes(replayed)).toContain("message_update");
            expect(eventTypes(replayed)).toContain("tool_execution_start");

            // pin 不能绕过 replay 硬上限；anchor 失效后 snapshot 必须返回安全 latest cursor，
            // 否则前端会在 stale anchor 与 snapshot_required 之间循环。
            for (let index = 0; index < 520; index += 1) {
                harness.eventHub.publish({
                    sessionId: created.sessionId,
                    kind: "session",
                    event: {type: "invocation_aborted", reason: `trim-${String(index)}`},
                });
            }
            const trimmedSnapshot = await harness.getSessionRecovery(created.sessionId);
            expect(trimmedSnapshot.eventCursor.after).toBe(harness.eventHub.lastSeq(created.sessionId));
            const recovered = harness.subscribeSessionEvents(created.sessionId, trimmedSnapshot.eventCursor);
            const recoveryIterator = recovered[Symbol.asyncIterator]();
            const afterTrim = harness.eventHub.publish({
                sessionId: created.sessionId,
                kind: "session",
                event: {type: "invocation_aborted", reason: "after-trim"},
            });
            await expect(recoveryIterator.next()).resolves.toEqual({done: false, value: afterTrim});
            await recoveryIterator.return?.();

            releaseTool();
            const result = await running;
            expect(result.status).toBe("completed");
            const completedSnapshot = await harness.getSessionRecovery(created.sessionId);
            const completedLedger = await harness.repo.readSession(created.sessionId);
            expect(completedSnapshot.eventCursor.after).toBe(harness.eventHub.lastSeq(created.sessionId));
            expect(completedLedger.entries.some((entry) => entry.type === "message" && entry.message.role === "assistant")).toBe(true);
            expect(completedLedger.entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult")).toBe(true);
        } finally {
            releaseTool();
            await observer.stop();
        }
    }, 15_000);
});

async function waitForSessionText(harness: NeuroAgentHarness, sessionId: number, text: string): Promise<NeuroSessionContext> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        if (visibleText(context.messages).includes(text)) {
            return context;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`等待Session文本超时：${text}`);
}
