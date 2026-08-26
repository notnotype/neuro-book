import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {ForcedAbortSessionWritePlan} from "nbook/server/agent/session/write-plan";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins} from "nbook/server/agent/profiles/define-agent-runtime";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createStoredUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {Message as RuntimeMessage} from "nbook/server/agent/messages/types";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {StoredAgentMessage, StoredUserMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";
import type {NeuroSessionContext, SessionEntry} from "nbook/server/agent/session/types";
import {AgentJobCancelledError} from "nbook/server/agent/jobs/agent-job-manager";
import {serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";
import {AGENT_FOLLOW_UP_QUEUE_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createRasterTestFixtures} from "nbook/server/agent/test-utils/raster-fixtures";

let pngBytes: Buffer;

beforeAll(async () => {
    ({png: pngBytes} = await createRasterTestFixtures());
});

type ObservedRun = {
    result: AgentInvocationResult;
    events: AgentSessionEventDto[];
    snapshot: Awaited<ReturnType<JsonlSessionRepository["readSession"]>>;
    context: NeuroSessionContext;
};


type HarnessWriteExecutorAccess = {
    writeExecutor: {
        enqueueForcedAbort(plan: ForcedAbortSessionWritePlan, invocationId: string): {completion: Promise<unknown>};
    };
    forcedAbortWriteAuthorizations: Set<string>;
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
        toolKeys,
        ...rest
    } = profile;
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(allowedToolKeys ?? []),
        toolKeys: toolKeys ?? mainRunAllowedToolKeys,
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

/** 等待已返回 Provider 的 Promise continuation 排空，不绑定真实墙钟时长。 */
async function nextEventLoopTurn(): Promise<void> {
    const turn = Promise.withResolvers<void>();
    setImmediate(turn.resolve);
    await turn.promise;
}

/** 有界取消是真实时序合同：超时即失败，不用猜测性等待掩盖回归。 */
async function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
    ]);
}

describe("NeuroAgentHarness black-box contract", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = testHostPath("agent-harness-black-box-test", randomUUID());
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
            profiles: new AgentProfileCatalog(
                join(root, "profiles-system"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, root),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(root),
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await harness.piTraceRecorder.flush();
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
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));

        expect(observed.result.status).toBe("completed");
        const assistantUsages = observed.context.messages
            .filter((message) => message.role === "assistant")
            .map((message) => message.usage);
        expect(assistantUsages).toHaveLength(2);
        expect(observed.result.usage).toEqual({
            input: assistantUsages.reduce((sum, value) => sum + value.input, 0),
            output: assistantUsages.reduce((sum, value) => sum + value.output, 0),
            cacheRead: assistantUsages.reduce((sum, value) => sum + value.cacheRead, 0),
            cacheWrite: assistantUsages.reduce((sum, value) => sum + value.cacheWrite, 0),
            totalTokens: assistantUsages.reduce((sum, value) => sum + value.totalTokens, 0),
            cost: {
                input: assistantUsages.reduce((sum, value) => sum + value.cost.input, 0),
                output: assistantUsages.reduce((sum, value) => sum + value.cost.output, 0),
                cacheRead: assistantUsages.reduce((sum, value) => sum + value.cost.cacheRead, 0),
                cacheWrite: assistantUsages.reduce((sum, value) => sum + value.cost.cacheWrite, 0),
                total: assistantUsages.reduce((sum, value) => sum + value.cost.total, 0),
            },
        });
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
        });
        const imageData = Buffer.from(pngBytes).toString("base64");
        const attachment = await harness.attachmentCodec.saveImage({bytes: pngBytes, mimeType: "image/png", name: "memory.png"});
        const storedUser: StoredUserMessage = {
            role: "user",
            content: [{type: "text", text: "remember this image"}, attachment],
            timestamp: Date.now(),
        };
        // SessionEntry 的公开类型尚沿用 Pi Message；Repository invariant 会校验这里实际写入的是 stored message。
        await harness.repo.appendMessage(created.metadata.sessionId, storedUser, "prompt");

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
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "tool execution start before steer");
            const steerClientMessageId = randomUUID();
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                clientMessageId: steerClientMessageId,
                message: {text: "adjust while running"},
            });
            const beforeDrain = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            releaseTool();

            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

            expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
            expect(queued.acceptance).toEqual({
                state: "queued",
                clientMessageId: steerClientMessageId,
                queueItemId: queued.queuedItem?.id,
            });
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
        });
        const registered = await harness.uploadSessionAttachment(created.sessionId, {
            bytes: pngBytes,
            mimeType: "image/png",
            name: "queued.png",
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
            const followUpClientMessageId = randomUUID();
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                clientMessageId: followUpClientMessageId,
                message: {
                    text: `queued followup${serializeAgentImageMarkdown("queued.png", registered.target)}`,
                },
            });
            const beforeDrain = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            releaseTool();
            const result = await running;
            const context = await waitForSessionText(harness, created.sessionId, "queued followup");
            const snapshot = await harness.getSessionRecovery(created.sessionId);

            expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
            expect(queued.acceptance).toEqual({
                state: "queued",
                clientMessageId: followUpClientMessageId,
                queueItemId: queued.queuedItem?.id,
            });
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

    it("follow-up drain 重新 admission 失败时保留队首且不写 durable user entry", async () => {
        let releaseTool = (): void => undefined;
        const toolGate = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "bb_followup_admission_gate",
            name: "bb_followup_admission_gate",
            label: "BlackBox Follow-up Admission Gate",
            description: "Keeps the first invocation running while the attachment authority changes.",
            parameters: Type.Object({}),
            async execute() {
                await toolGate;
                return {content: [{type: "text", text: "released"}], details: {}, terminate: true};
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.blackbox.followup-admission", name: "BlackBox Follow-up Admission"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_followup_admission_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall("bb_followup_admission_gate", {}, {id: "admission-gate"})], {stopReason: "toolUse"}),
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.followup-admission",
            initial: {},
        });
        const registered = await harness.uploadSessionAttachment(created.sessionId, {
            bytes: pngBytes,
            mimeType: "image/png",
            name: "queued.png",
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "tool execution start before corrupt follow-up");
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: serializeAgentImageMarkdown("queued.png", registered.target)},
            });
            await harness.repo.appendProjectionEntry(created.sessionId, {
                type: "session_attachment",
                origin: "projection",
                source: "upload",
                attachment: {
                    id: registered.attachment.attachmentId,
                    mimeType: registered.attachment.mimeType,
                    bytes: registered.attachment.bytes + 1,
                },
                name: "conflict.png",
            });
            releaseTool();
            await running;

            const recovery = await harness.getSessionRecovery(created.sessionId);
            const ledger = await harness.repo.readSession(created.sessionId);
            expect(recovery.followUpQueue).toEqual({
                status: "paused",
                pausedBy: expect.objectContaining({
                    itemId: queued.queuedItem?.id,
                    reason: "admission_error",
                }),
                items: [expect.objectContaining({id: queued.queuedItem?.id})],
                omittedItems: 0,
            });
            expect(ledger.entries.some((entry) => entry.type === "message"
                && entry.message.role === "user"
                && entry.sourceQueueItemId === queued.queuedItem?.id)).toBe(false);
            expect(faux.getPendingResponseCount()).toBe(1);
        } finally {
            releaseTool();
            await observer.stop();
        }
    });

    it("follow-up durable user commit 后 ack 失败，恢复时只补 ack 而不重复运行", async () => {
        let releaseTool = (): void => undefined;
        const toolGate = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "bb_followup_ack_gate",
            name: "bb_followup_ack_gate",
            label: "BlackBox Follow-up Ack Gate",
            description: "Keeps the first invocation running until the queue ack failure is installed.",
            parameters: Type.Object({}),
            async execute() {
                await toolGate;
                return {content: [{type: "text", text: "released"}], details: {}};
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.blackbox.followup-ack", name: "BlackBox Follow-up Ack"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["bb_followup_ack_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall("bb_followup_ack_gate", {}, {id: "ack-gate"})], {stopReason: "toolUse"}),
            fauxAssistantMessage("first run done"),
            fauxAssistantMessage("manual recovery run"),
            fauxAssistantMessage("duplicate follow-up must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.followup-ack",
            initial: {},
        });
        const observer = await observeSession(harness, created.sessionId);
        const originalAppendProjection = harness.repo.appendProjectionEntry.bind(harness.repo);
        let injectedAckFailure = false;
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "tool execution start before ack failure");
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: "queued exactly once"},
            });
            harness.repo.appendProjectionEntry = async (...args: Parameters<JsonlSessionRepository["appendProjectionEntry"]>): ReturnType<JsonlSessionRepository["appendProjectionEntry"]> => {
                const input = args[1];
                if (!injectedAckFailure
                    && input.type === "custom"
                    && input.key === AGENT_FOLLOW_UP_QUEUE_STATE_KEY
                    && typeof input.value === "object"
                    && input.value !== null
                    && !Array.isArray(input.value)
                    && input.value.status === "ready"
                    && Array.isArray(input.value.items)
                    && input.value.items.length === 0) {
                    injectedAckFailure = true;
                    throw new Error("injected follow-up ack failure");
                }
                return originalAppendProjection(...args);
            };
            releaseTool();
            await running;
            harness.repo.appendProjectionEntry = originalAppendProjection;

            const afterFailure = await harness.repo.readSession(created.sessionId);
            expect(injectedAckFailure).toBe(true);
            expect(afterFailure.entries.filter((entry) => entry.type === "message"
                && entry.message.role === "user"
                && entry.sourceQueueItemId === queued.queuedItem?.id)).toHaveLength(1);
            expect((await harness.getSessionRecovery(created.sessionId)).followUpQueue.items).toHaveLength(1);

            await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "recover queue"},
            });
            const recovered = await harness.repo.readSession(created.sessionId);
            expect(recovered.entries.filter((entry) => entry.type === "message"
                && entry.message.role === "user"
                && entry.sourceQueueItemId === queued.queuedItem?.id)).toHaveLength(1);
            expect((await harness.getSessionRecovery(created.sessionId)).followUpQueue.items).toEqual([]);
            expect(faux.getPendingResponseCount()).toBe(1);
        } finally {
            harness.repo.appendProjectionEntry = originalAppendProjection;
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

    it("WaitingUser 期间只接受回答，prompt/followup/steer 均不进入队列或 durable history", async () => {
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
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting-queue",
            initial: {},
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });

        const rejectedPrompt = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            clientMessageId: randomUUID(),
            message: {text: "queued prompt"},
        });
        const rejectedFollowup = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            clientMessageId: randomUUID(),
            message: {text: "queued followup"},
        });
        const rejectedSteer = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            clientMessageId: randomUUID(),
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
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const snapshot = await harness.getSessionRecovery(created.sessionId);

        expect(waiting.status).toBe("waiting");
        for (const rejected of [rejectedPrompt, rejectedFollowup, rejectedSteer]) {
            expect(rejected).toMatchObject({
                status: "error",
                acceptance: {state: "not_accepted"},
                errorPhase: "prepare",
            });
        }
        expect(visibleText(beforeResume.messages)).not.toContain("queued prompt");
        expect(visibleText(beforeResume.messages)).not.toContain("queued followup");
        expect(visibleText(beforeResume.messages)).not.toContain("queued steer");
        expect(continued.status).toBe("completed");
        expect(visibleText(context.messages)).not.toContain("queued steer");
        expect(visibleText(context.messages)).not.toContain("queued prompt");
        expect(visibleText(context.messages)).not.toContain("queued followup");
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
        });
        const clientMessageId = randomUUID();

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            clientMessageId,
            message: {text: "start"},
        }));

        expect(observed.result.status).toBe("error");
        expect(observed.result.errorInfo).toEqual(expect.objectContaining({
            message: "provider failed",
            phase: "model",
        }));
        expect(observed.result.acceptance).toEqual({
            state: "persisted",
            clientMessageId,
            entryId: expect.any(String),
        });
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

            expect(observer.events.filter((event) => event.event.type === "invocation_aborted")).toHaveLength(1);
            expect(observer.events.filter((event) => event.event.type === "agent_end" && event.event.status === "aborted")).toHaveLength(1);

            const abortEventTypes = observer.events.map((event) => event.event.type);
            const abortedAt = abortEventTypes.lastIndexOf("invocation_aborted");
            const stateAt = abortEventTypes.lastIndexOf("session_state_changed");
            const terminalAt = observer.events.findIndex((event) => event.event.type === "agent_end" && event.event.status === "aborted");
            const entryAfterAbort = observer.events.findIndex((event, index) => index > abortedAt && event.event.type === "session_entry");
            expect(abortedAt).toBeGreaterThanOrEqual(0);
            expect(stateAt).toBeGreaterThan(abortedAt);
            expect(terminalAt).toBeGreaterThan(stateAt);
            expect(entryAfterAbort).toBeGreaterThan(abortedAt);

        } finally {
            await observer.stop();
        }
    });
    it("Idle 且没有 active invocation 时 abort 保持幂等 idle", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });

        await expect(harness.abortInvocation(created.sessionId, {reason: "nothing to abort"})).resolves.toEqual({
            status: "idle",
            sessionId: created.sessionId,
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(snapshot.entries.some((entry) => entry.type === "invocation_lifecycle")).toBe(false);
    });
    it("Archived 且没有 active invocation 时 abort 返回 409", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });

        await expect(harness.runCommand(created.sessionId, {
            command: "archive",
            reason: "archived before abort",
        })).resolves.toMatchObject({kind: "live_state"});

        await expect(harness.abortInvocation(created.sessionId, {reason: "should be rejected"})).rejects.toMatchObject({
            statusCode: 409,
            code: "session_abort_not_allowed",
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(snapshot.entries.some((entry) => entry.type === "invocation_lifecycle")).toBe(false);
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

    // 取消前必须等到 Faux Provider 实际取走悬挂响应；activeInvocation=running 只表示 admission 完成。
    // 300ms/1s race 是被测的公开取消上界，不用于等待测试状态推进。
    it("Running provider 忽略 AbortSignal 时 cancel 仍有界释放调用方，并隔离迟到结果", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.forced-running-abort",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        const providerReturned = Promise.withResolvers<void>();
        faux.setResponses([
            async () => {
                providerStarted.resolve();
                await providerGate.promise;
                providerReturned.resolve();
                return fauxAssistantMessage("late provider result");
            },
            fauxAssistantMessage("fresh invocation result"),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
        });
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start hanging provider"},
        });
        await providerStarted.promise;
        const oldInvocationId = (await harness.getSessionRecovery(created.sessionId)).activeInvocation!.invocationId;

        // 阻塞旧 invocation 的 forced-aborted 落盘：两阶段取消必须不等待 I/O 就释放调用方，
        // 且新 invocation 的 start 排在旧终态之后。
        const durableGate = Promise.withResolvers<void>();
        const realAppendEntry = harness.repo.appendEntry.bind(harness.repo);
        const appendEntrySpy = vi.spyOn(harness.repo, "appendEntry").mockImplementation(async (...args: Parameters<JsonlSessionRepository["appendEntry"]>) => {
            const entry = args[1];
            if (entry.type === "invocation_lifecycle" && entry.invocationId === oldInvocationId && entry.status === "aborted") {
                await durableGate.promise;
            }
            return realAppendEntry(...args);
        });
        try {
            const aborted = await raceTimeout(
                harness.abortInvocation(created.sessionId, {reason: "force stop"}),
                300,
                "abort API did not settle after cancel",
            );
            const result = await raceTimeout(running, 300, "running invocation did not settle after cancel");
            expect(aborted).toEqual({status: "aborted", sessionId: created.sessionId});
            expect(result).toMatchObject({status: "error", invocationId: expect.any(String), aborted: true});
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({activeInvocation: null});

            let nextSettled = false;
            const next = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start fresh invocation"},
            }).finally(() => {
                nextSettled = true;
            });
            // 固定观察窗证明新 start 被 durable queue 挡住，而不是恰好更慢。
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(nextSettled).toBe(false);

            durableGate.resolve();
            await expect(next).resolves.toMatchObject({status: "completed", finalMessage: "fresh invocation result"});

            providerGate.resolve();
            await providerReturned.promise;
            await nextEventLoopTurn();
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(visibleText(harness.repo.reduce(snapshot).messages)).not.toContain("late provider result");
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "aborted", "start", "end"]);
        } finally {
            providerGate.resolve();
            durableGate.resolve();
            appendEntrySpy.mockRestore();
        }
    }, 30_000);
    it("Running 非合作 forced abort 且 clearQueue=false 时暂停 followup queue", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.forced-running-abort-preserve-followup",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        faux.setResponses([async () => {
            providerStarted.resolve();
            await providerGate.promise;
            return fauxAssistantMessage("late preserved queue result", {stopReason: "aborted", errorMessage: "ignored"});
        }]);
        const created = await harness.createAgent({profileKey, initial: {}});
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "hang"},
        });
        await providerStarted.promise;
        const queued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "preserve me"},
        });
        try {
            await expect(raceTimeout(
                harness.abortInvocation(created.sessionId, {reason: "force preserve", clearQueue: false}),
                300,
                "forced abort did not settle",
            )).resolves.toEqual({status: "aborted", sessionId: created.sessionId});
            expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: null,
                followUpQueue: {
                    status: "paused",
                    pausedBy: {reason: "aborted"},
                    items: [expect.objectContaining({
                        kind: "followup",
                        text: expect.objectContaining({preview: "preserve me", omitted: false}),
                    })],
                },
            });
        } finally {
            providerGate.resolve();
            await running.catch(() => undefined);
        }
        await harness.drainBackgroundTasks();
        expect(lifecycleStatuses(await harness.repo.readSession(created.sessionId))).toEqual(["start", "aborted"]);
    }, 30_000);

    it("running abort 的 followup 持久化失败会回滚 admission 并允许重试", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.abort-followup-persistence-retry",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        faux.setResponses([async () => {
            providerStarted.resolve();
            await providerGate.promise;
            return fauxAssistantMessage("late queue persistence result", {stopReason: "aborted", errorMessage: "ignored"});
        }]);
        const created = await harness.createAgent({profileKey, initial: {}});
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "hang"},
        });
        await providerStarted.promise;
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "retry queue"},
        });
        const realAppendProjectionEntry = harness.repo.appendProjectionEntry.bind(harness.repo);
        const appendProjectionSpy = vi.spyOn(harness.repo, "appendProjectionEntry").mockImplementationOnce(async (...args: Parameters<JsonlSessionRepository["appendProjectionEntry"]>) => {
            const entry = args[1];
            if (entry.type === "custom" && entry.key === AGENT_FOLLOW_UP_QUEUE_STATE_KEY) {
                throw new Error("followup queue persistence unavailable");
            }
            return realAppendProjectionEntry(...args);
        });

        try {
            await expect(harness.abortInvocation(created.sessionId, {reason: "retry queue", clearQueue: false}))
                .rejects.toThrow("followup queue persistence unavailable");
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: {status: "running"},
                followUpQueue: {
                    status: "ready",
                    items: [expect.objectContaining({
                        kind: "followup",
                        text: expect.objectContaining({preview: "retry queue", omitted: false}),
                    })],
                },
            });
            await expect(raceTimeout(
                harness.abortInvocation(created.sessionId, {reason: "retry queue succeeds", clearQueue: false}),
                300,
                "retry abort did not settle",
            )).resolves.toEqual({status: "aborted", sessionId: created.sessionId});
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: null,
                followUpQueue: {
                    status: "paused",
                    pausedBy: {reason: "aborted"},
                },
            });
        } finally {
            appendProjectionSpy.mockRestore();
            providerGate.resolve();
            await running.catch(() => undefined);
        }
    }, 30_000);

    it("Running forced enqueue 同步失败时保留 aborting ownership 并可重试", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.forced-enqueue-failure",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        faux.setResponses([async () => {
            providerStarted.resolve();
            await providerGate.promise;
            return fauxAssistantMessage("late result", {stopReason: "aborted", errorMessage: "ignored"});
        }]);
        const created = await harness.createAgent({profileKey, initial: {}});
        const observer = await observeSession(harness, created.sessionId);
        const running = harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hang"}});
        await providerStarted.promise;
        const oldInvocationId = (await harness.getSessionRecovery(created.sessionId)).activeInvocation!.invocationId;
        const harnessInternals = harness as unknown as HarnessWriteExecutorAccess;
        const writeExecutor = harnessInternals.writeExecutor;
        const enqueue = vi.spyOn(writeExecutor, "enqueueForcedAbort")
            .mockImplementationOnce(() => {
                throw new Error("queue unavailable");
            });

        try {
            await expect(raceTimeout(harness.abortInvocation(created.sessionId, {reason: "retry me"}), 300, "abort did not settle"))
                .rejects.toMatchObject({statusCode: 503, code: "session_abort_durability_unavailable"});
            expect(observer.events.filter((event) => event.event.type === "agent_end")).toHaveLength(0);
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: {invocationId: oldInvocationId},
            });
            await expect(raceTimeout(harness.abortInvocation(created.sessionId, {reason: "retry succeeds"}), 300, "abort retry did not settle"))
                .resolves.toEqual({status: "aborted", sessionId: created.sessionId});
            expect((await harness.getSessionRecovery(created.sessionId)).activeInvocation).toBeNull();
            providerGate.resolve();
            await running;
            await harness.drainBackgroundTasks();
            expect(lifecycleStatuses(await harness.repo.readSession(created.sessionId))).toEqual(["start", "aborted"]);
        } finally {
            enqueue.mockRestore();
            providerGate.resolve();
            await running;
            await observer.stop();
        }
    }, 30_000);

    it("Running forced enqueue 缺少同步授权时 fail closed 并可重试", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.forced-authorization-missing",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        faux.setResponses([async () => {
            providerStarted.resolve();
            await providerGate.promise;
            return fauxAssistantMessage("late authorization result", {stopReason: "aborted", errorMessage: "ignored"});
        }]);
        const created = await harness.createAgent({profileKey, initial: {}});
        const observer = await observeSession(harness, created.sessionId);
        const running = harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hang"}});
        await providerStarted.promise;
        const oldInvocationId = (await harness.getSessionRecovery(created.sessionId)).activeInvocation!.invocationId;
        const harnessInternals = harness as unknown as HarnessWriteExecutorAccess;
        const authorizationAdd = vi.spyOn(harnessInternals.forcedAbortWriteAuthorizations, "add")
            .mockImplementationOnce(() => harnessInternals.forcedAbortWriteAuthorizations);

        try {
            await expect(raceTimeout(harness.abortInvocation(created.sessionId, {reason: "authorization missing"}), 300, "abort did not settle"))
                .rejects.toMatchObject({statusCode: 503, code: "session_abort_durability_unavailable"});
            expect(observer.events.filter((event) => event.event.type === "agent_end")).toHaveLength(0);
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: {invocationId: oldInvocationId},
            });
            expect(lifecycleStatuses(await harness.repo.readSession(created.sessionId))).toEqual(["start"]);

            authorizationAdd.mockRestore();
            await expect(raceTimeout(harness.abortInvocation(created.sessionId, {reason: "authorization restored"}), 300, "abort retry did not settle"))
                .resolves.toEqual({status: "aborted", sessionId: created.sessionId});
            expect((await harness.getSessionRecovery(created.sessionId)).activeInvocation).toBeNull();
            providerGate.resolve();
            await running;
            await harness.drainBackgroundTasks();
            expect(lifecycleStatuses(await harness.repo.readSession(created.sessionId))).toEqual(["start", "aborted"]);
        } finally {
            authorizationAdd.mockRestore();
            providerGate.resolve();
            await running;
            await observer.stop();
        }
    }, 30_000);

    it("并发重复 abort 只发布一次取消事件和终态", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.concurrent-abort",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        faux.setResponses([async () => {
            providerStarted.resolve();
            await providerGate.promise;
            return fauxAssistantMessage("late duplicate abort result");
        }]);
        const created = await harness.createAgent({profileKey, initial: {}});
        const observer = await observeSession(harness, created.sessionId);
        const running = harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hang"}});
        await providerStarted.promise;
        const invocationId = (await harness.getSessionRecovery(created.sessionId)).activeInvocation!.invocationId;

        try {
            const results = await Promise.all([
                raceTimeout(harness.abortInvocation(created.sessionId, {reason: "first"}), 300, "first abort did not settle"),
                raceTimeout(harness.abortInvocation(created.sessionId, {reason: "duplicate"}), 300, "duplicate abort did not settle"),
            ]);
            expect(results.every((result) => result.status === "aborted" || result.status === "idle")).toBe(true);
            providerGate.resolve();
            await running;
            await harness.drainBackgroundTasks();
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle"
                && entry.invocationId === invocationId
                && entry.status === "aborted")).toHaveLength(1);
            expect(observer.events.filter((event) => event.invocationId === invocationId
                && event.event.type === "invocation_aborted")).toHaveLength(1);
            expect(observer.events.filter((event) => event.invocationId === invocationId
                && event.event.type === "agent_end"
                && event.event.status === "aborted")).toHaveLength(1);
        } finally {
            providerGate.resolve();
            await running.catch(() => undefined);
            await observer.stop();
        }
    }, 30_000);

    it("外部 signal 只取消 admission 接收的精确 invocation，不影响同 session 后续调用", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.exact-signal-abort",
        });
        const providerStarted = Promise.withResolvers<void>();
        const providerGate = Promise.withResolvers<void>();
        const providerReturned = Promise.withResolvers<void>();
        faux.setResponses([
            async () => {
                providerStarted.resolve();
                await providerGate.promise;
                providerReturned.resolve();
                return fauxAssistantMessage("late exact-signal result");
            },
            fauxAssistantMessage("new invocation survived"),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
        });
        const controller = new AbortController();
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start signal-owned invocation"},
            signal: controller.signal,
        });
        await providerStarted.promise;

        try {
            controller.abort(new Error("parent invocation cancelled"));
            const cancelled = await Promise.race([
                running,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("signal-owned invocation did not settle")), 1_000)),
            ]);
            expect(cancelled).toMatchObject({status: "error", invocationId: expect.any(String)});

            const next = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start new invocation"},
            });
            expect(next).toMatchObject({status: "completed", finalMessage: "new invocation survived"});

            providerGate.resolve();
            await providerReturned.promise;
            await nextEventLoopTurn();
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(visibleText(harness.repo.reduce(snapshot).messages)).not.toContain("late exact-signal result");
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "aborted", "start", "end"]);
        } finally {
            providerGate.resolve();
        }
    }, 30_000);

    it("Running tool 忽略 AbortSignal 时 cancel 仍有界释放调用方，并隔离迟到结果", async () => {
        let releaseTool: (() => void) | undefined;
        const toolGate = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "hanging_tool",
            name: "hanging_tool",
            label: "Hanging Tool",
            description: "A test tool that deliberately ignores AbortSignal.",
            parameters: Type.Object({}),
            async execute() {
                await toolGate;
                return {
                    content: [{type: "text", text: "late tool result"}],
                    details: null,
                };
            },
        });
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.forced-tool-abort",
            allowedToolKeys: ["hanging_tool"],
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("hanging_tool", {}, {id: "hanging-tool-call"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("fresh invocation after tool cancel"),
        ]);
        const created = await harness.createAgent({
            profileKey,
            initial: {},
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start hanging tool"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "hanging tool execution start");

            const aborted = await raceTimeout(
                harness.abortInvocation(created.sessionId, {reason: "force stop tool"}),
                300,
                "tool cancel API did not settle",
            );
            const result = await raceTimeout(running, 300, "tool invocation did not settle after cancel");
            expect(aborted).toEqual({status: "aborted", sessionId: created.sessionId});
            expect(result).toMatchObject({status: "error", invocationId: expect.any(String)});
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({activeInvocation: null});

            const next = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start fresh invocation"},
            });
            expect(next).toMatchObject({status: "completed", finalMessage: "fresh invocation after tool cancel"});

            releaseTool!();
            await new Promise((resolve) => setTimeout(resolve, 20));
            const snapshot = await harness.repo.readSession(created.sessionId);
            const context = harness.repo.reduce(snapshot);
            expect(visibleText(context.messages)).not.toContain("late tool result");
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "aborted", "start", "end"]);
        } finally {
            releaseTool?.();
            await observer.stop();
        }
    });

    it("settleRun hook 迟到恢复时不能在强制取消后写入 session", async () => {
        let notifySettleStarted: (() => void) | undefined;
        const settleStarted = new Promise<void>((resolve) => {
            notifySettleStarted = resolve;
        });
        let releaseSettle: (() => void) | undefined;
        const settleGate = new Promise<void>((resolve) => {
            releaseSettle = resolve;
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.forced-settle-abort",
                name: "Forced Settle Abort",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            runtime: {
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "test.hangingSettle",
                        stage: "settleRun",
                        async run(ctx: {sessionId: number}) {
                            notifySettleStarted!();
                            await settleGate;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.late-settle",
                                    ops: [{
                                        kind: "append",
                                        entry: {
                                            type: "custom",
                                            key: "test.late-settle",
                                            value: true,
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("provider already completed"),
            fauxAssistantMessage("fresh invocation after settle cancel"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.forced-settle-abort",
            initial: {},
        });
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "hang in settle hook"},
        });
        await settleStarted;

        const aborted = await raceTimeout(
            harness.abortInvocation(created.sessionId, {reason: "cancel hanging settle"}),
            300,
            "settle cancel API did not settle",
        );
        const result = await raceTimeout(running, 300, "settle invocation did not stop after cancel");
        expect(aborted).toEqual({status: "aborted", sessionId: created.sessionId});
        expect(result).toMatchObject({status: "error"});
        await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({activeInvocation: null});

        releaseSettle!();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const afterLateSettle = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(afterLateSettle.customState["test.late-settle"]).toBeUndefined();

        const next = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start fresh invocation"},
        });
        expect(next).toMatchObject({status: "completed", finalMessage: "fresh invocation after settle cancel"});
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(lifecycleStatuses(snapshot)).toEqual(["start", "aborted", "start", "end"]);
    });

    it("dispose 会取消 waiting Job 并在固定期限内完成", async () => {
        const job = harness.jobs.spawn({
            kind: "workflow",
            title: "waiting workflow",
            deliver: "none",
            run: async (context) => {
                context.setWaiting("等待用户输入");
                await new Promise<void>((resolve) => {
                    context.signal.addEventListener("abort", () => resolve(), {once: true});
                });
                throw new AgentJobCancelledError();
            },
        });
        await waitUntil(async () => (await harness.jobs.get(job.job.jobId))?.status === "waiting", "job enters waiting");

        await Promise.race([
            harness.dispose(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("harness dispose did not settle")), 300)),
        ]);

        await expect(harness.jobs.get(job.job.jobId)).resolves.toMatchObject({status: "cancelled"});
    });

    it("SSE replay 和 snapshot_required 合同可从 Harness event hub 观察", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.sse-replay",
        });
        const created = await harness.createAgent({
            profileKey,
            initial: {},
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
