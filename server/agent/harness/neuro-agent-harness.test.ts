import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import {createFauxModels, fauxProviderConfig, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {ResolvedPiModel} from "nbook/server/agent/harness/pi-model-metadata";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {builtin, defineProfileTool, pluginTool, toolset} from "nbook/server/agent/profiles/profile-tools";
import {defineLowCodeForm} from "nbook/server/low-code-form";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import type {AgentCatalogSnapshot, AgentProfile, AgentProfileDefinition, SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import simulatorActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {StoredAgentMessage, StoredToolResultMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {HistorySet, Message, ModelContext, ProfilePrompt, Reminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {AgentMessage, JsonValue, Message as RuntimeMessage, Usage} from "nbook/server/agent/messages/types";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";
import type {PublishedAgentSessionEvent} from "nbook/server/agent/events/session-event-hub";
import {AGENT_MODE_STATE_KEY, AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX, AGENT_TASKS_STATE_KEY, SESSION_SUMMARIZER_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {defineSessionVariable} from "nbook/server/agent/variables/registry";
import type {VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {openProject, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {withWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

type LegacyTestSidecar<TInput = JsonValue> = Omit<SidecarProfilePass<TInput, JsonValue>, "toolKeys"> & {
    toolKeys?: readonly string[];
    allowedToolKeys?: readonly string[];
};

type LegacyTestProfile<
    TInitialSchema extends TSchema = TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = Omit<AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, undefined, TSummarizerKey, TTools>, "tools" | "toolKeys" | "sidecars"> & {
    tools?: ProfileTools;
    allowedToolKeys?: readonly string[];
    mainRunAllowedToolKeys?: readonly string[];
    toolKeys?: readonly string[];
    sidecars?: readonly LegacyTestSidecar<Static<TInitialSchema>>[];
};

function defineAgentProfile<
    TInitialSchema extends TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
>(profile: LegacyTestProfile<TInitialSchema, TPayloadSchema, TOutputSchema, TSummarizerKey, TTools>): ReturnType<typeof defineRuntimeAgentProfile> {
    const {
        allowedToolKeys,
        mainRunAllowedToolKeys,
        sidecars,
        toolKeys,
        ...rest
    } = profile;
    const migratedSidecars = sidecars?.map((sidecar) => {
        const {
            allowedToolKeys: sidecarAllowedToolKeys,
            ...sidecarRest
        } = sidecar;
        const legacyToolKeys = sidecarRest.toolKeys ?? sidecarAllowedToolKeys;
        return {
            ...sidecarRest,
            toolKeys: legacyToolKeys?.map((toolKey) => toolKey === "report_result" ? "report_sidecar_result" : toolKey),
        };
    });
    const migratedAllowedToolKeys = [...allowedToolKeys ?? []];
    if (!rest.tools && migratedSidecars?.some((sidecar) => sidecar.toolKeys?.includes("report_sidecar_result")) && !migratedAllowedToolKeys.includes("report_sidecar_result")) {
        migratedAllowedToolKeys.push("report_sidecar_result");
    }
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(migratedAllowedToolKeys),
        toolKeys: toolKeys ?? mainRunAllowedToolKeys,
        // 测试 helper 只做旧字段到新字段的机械迁移，最终运行时校验仍由 defineRuntimeAgentProfile 负责。
        sidecars: migratedSidecars as AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, undefined, TSummarizerKey, TTools>["sidecars"],
    });
}

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
    return {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
        cost: {
            input,
            output,
            cacheRead,
            cacheWrite,
            total: input + output + cacheRead + cacheWrite,
        },
    };
}

function visibleMessageText(messages: Array<AgentMessage | StoredAgentMessage>): string {
    return messages.map((message) => storedMessageText(message)).join("\n");
}

class BrokenProfileCatalog extends AgentProfileCatalog {
    constructor(systemRoot: string, userRoot: string, private readonly issueMessage = "源码错误") {
        super(systemRoot, userRoot);
    }

    override async get(profileKey: string): Promise<AgentProfile> {
        if (profileKey === "test.unloadable") {
            throw new Error(`agent profile test.unloadable 不可运行：${this.issueMessage}`);
        }
        return super.get(profileKey);
    }

    override async snapshot(options: {includeFileIssues?: boolean} = {}): Promise<AgentCatalogSnapshot> {
        const snapshot = await super.snapshot(options);
        return {
            profiles: [
                ...snapshot.profiles,
                {
                    key: "test.unloadable",
                    name: "Broken Profile",
                    source: "user",
                    builtin: false,
                    loadStatus: "source_error",
                    hasSettingsForm: false,
                    canResetHome: false,
                    creationMode: "public",
                    issue: {
                        code: "source_error",
                        message: this.issueMessage,
                        profileKey: "test.unloadable",
                        source: "user",
                    },
                },
            ],
            issues: snapshot.issues,
        };
    }
}

async function waitForSessionText(harness: NeuroAgentHarness, sessionId: number, text: string): Promise<ReturnType<JsonlSessionRepository["reduce"]>> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        if (visibleMessageText(context.messages).includes(text)) {
            return context;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return harness.repo.reduce(await harness.repo.readSession(sessionId));
}

/**
 * 等待下一条 session 事件，避免关系通知类测试拖到全局超时才失败。
 */
function nextEventWithin(iterator: AsyncIterator<PublishedAgentSessionEvent>, label: string, timeoutMs = 200): Promise<AgentSessionEventDto> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`等待 session event 超时：${label}`));
        }, timeoutMs);
        void iterator.next().then((result) => {
            clearTimeout(timer);
            if (result.done) {
                reject(new Error(`session event stream 已结束：${label}`));
                return;
            }
            resolve(result.value.payload);
        }, (error: unknown) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

describe("NeuroAgentHarness", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = resolve(".agent", "agent-harness-test", randomUUID());
        faux = createFauxModels({
            models: [{
                id: `faux-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        const fauxModel = faux.getModel();
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({models: {
            default: `faux/${fauxModel.id}`,
            providers: [{
                id: "faux",
                name: "Faux",
                enabled: true,
                modelApi: fauxModel.api,
                options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                models: [{id: fauxModel.id, name: fauxModel.name, enabled: true, api: fauxModel.api, contextWindowTokens: fauxModel.contextWindow, maxTokens: fauxModel.maxTokens}],
            }],
        }}), "utf8");
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(join(root, "system-profiles"), join(root, "user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await harness.dispose();
        await rm(root, {recursive: true, force: true});
    });

    it("dispose 会关闭 EventHub 订阅并阻止旧实例继续发布", async () => {
        const subscription = harness.subscribeSessionEvents(1);
        expect(subscription.connected.payload.event.type).toBe("connected");

        await harness.dispose();

        expect(subscription.signal.aborted).toBe(true);
        expect(subscription.closeReason).toBe("hub_closed");
        await expect(subscription.next()).resolves.toEqual({done: true, value: undefined});
        expect(() => harness.eventHub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "after-dispose"},
        })).toThrow("event_hub_closed");
    });

    it("宿主 onEvent 修改 DTO 不会污染 EventHub replay", async () => {
        faux.setResponses([fauxAssistantMessage("done")]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: harness.eventHub.eventEpoch,
            after: 0,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            onEvent(event) {
                if (event.type === "message_start") {
                    event.model = "mutated-by-host";
                }
            },
        });

        expect(result.status, result.error ?? result.errorInfo?.message).toBe("completed");
        let messageStart: AgentSessionEventDto | null = null;
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const event = await nextEventWithin(subscription, "message_start replay");
            if (event.kind === "runtime" && event.event.type === "message_start") {
                messageStart = event;
                break;
            }
        }
        subscription.close();

        expect(messageStart?.kind === "runtime" && messageStart.event.type === "message_start"
            ? messageStart.event.model
            : null).toBe(faux.getModel().id);
    });

    it("同一 Session 下一次 invocation 重新映射 Temperature 与实时输出", async () => {
        const configPath = join(root, ".nbook", "config.json");
        const config = JSON.parse(await readFile(configPath, "utf8")) as {models: JsonValue; agent?: JsonValue};
        config.agent = {
            profiles: {
                "leader.default": {
                    model: {temperature: 0.2, realtimeOutput: false},
                },
            },
        };
        await writeFile(configPath, JSON.stringify(config), "utf8");

        let firstTemperature: number | undefined;
        faux.setResponses([(_context, options) => {
            firstTemperature = options?.temperature;
            return fauxAssistantMessage("first response");
        }]);
        const created = await harness.createAgent({profileKey: "leader.default", initial: {}, workspaceRoot: root});
        const firstEvents: string[] = [];
        const first = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "first"},
            onEvent(event) {
                firstEvents.push(event.type);
            },
        });

        expect(first.status).toBe("completed");
        expect(firstTemperature).toBe(0.2);
        expect(firstEvents).not.toContain("message_update");
        expect(firstEvents).toEqual(expect.arrayContaining(["message_start", "message_end"]));

        config.agent = {
            profiles: {
                "leader.default": {
                    model: {temperature: 0.7, realtimeOutput: true},
                },
            },
        };
        await writeFile(configPath, JSON.stringify(config), "utf8");
        let secondTemperature: number | undefined;
        faux.setResponses([(_context, options) => {
            secondTemperature = options?.temperature;
            return fauxAssistantMessage("second response");
        }]);
        const secondEvents: string[] = [];
        const second = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "second"},
            onEvent(event) {
                secondEvents.push(event.type);
            },
        });

        expect(second.status).toBe("completed");
        expect(secondTemperature).toBe(0.7);
        expect(secondEvents).toContain("message_update");
    });

    it("create -> prompt -> report_result 会落地消息和结构化结果", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reporter",
                name: "Reporter",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("done"),
                fauxToolCall("report_result", {
                    result: "ok",
                    data: {
                        paths: ["lorebook/foo/index.md"],
                    },
                }, {id: "report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.reporter",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(result.reportResult).toEqual({
            result: "ok",
            data: {
                paths: ["lorebook/foo/index.md"],
            },
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
    }, 10_000);

    it("大 assistant 正文完整落库但 InvokeAgentResult 只返回有界 finalMessage 预览", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.large-final-message",
                name: "Large Final Message",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const finalMessage = "正文".repeat(350_000);
        faux.setResponses([fauxAssistantMessage(finalMessage)]);
        const created = await harness.createAgent({
            profileKey: "test.large-final-message",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "return large text"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const storedAssistant = context.messages.findLast((message) => message.role === "assistant");

        expect(result.status).toBe("completed");
        expect(storedAssistant ? messageText(storedAssistant) : "").toBe(finalMessage);
        expect(result.finalMessage).not.toBe(finalMessage);
        expect(result.finalMessageBytes).toBe(Buffer.byteLength(finalMessage, "utf8"));
        expect(result.finalMessageOmitted).toBe(true);
        expect(Buffer.byteLength(result.finalMessage ?? "", "utf8")).toBeLessThanOrEqual(64 * 1024);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(96 * 1024);
    }, 10_000);

    it("大 provider error 在 lifecycle 与 InvokeAgentResult 中统一使用有界安全文本", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.large-invocation-error",
                name: "Large Invocation Error",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const errorMessage = "供应商错误".repeat(100_000);
        faux.setResponses([
            fauxAssistantMessage("partial", {stopReason: "error", errorMessage}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.large-invocation-error",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "fail with large error"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const lifecycle = snapshot.entries.findLast((entry) => entry.type === "invocation_lifecycle" && entry.status === "error");

        expect(result.status).toBe("error");
        const lifecycleError = lifecycle?.type === "invocation_lifecycle" ? lifecycle.errorInfo?.message : undefined;
        expect(lifecycleError).not.toBe(errorMessage);
        expect(lifecycleError).toContain("Provider 错误已截断");
        expect(result.error).not.toBe(errorMessage);
        expect(result.error).toBe(lifecycleError);
        expect(result.errorInfo?.message).toBe(result.error);
        expect(Buffer.byteLength(result.error ?? "", "utf8")).toBeLessThan(16 * 1024);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(96 * 1024);
    });

    it("大 invocation payload 校验错误不会撑大 InvokeAgentResult", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.large-payload-error",
                name: "Large Payload Error",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                accepted: Type.Boolean(),
            }, {additionalProperties: false}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const largeField = "字段".repeat(100_000);
        const created = await harness.createAgent({
            profileKey: "test.large-payload-error",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "validate payload"},
            payload: {
                accepted: true,
                [largeField]: true,
            },
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.code).toBe("invalid_payload");
        expect(result.error).not.toContain(largeField);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(96 * 1024);
    });

    it("invokeAgent 接受 title 后写入 session_update projection", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-title",
                name: "Invoke Title",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.invoke-title",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            title: "  Direct Title  ",
        });

        expect(result.status).toBe("completed");
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(snapshot);
        const updates = snapshot.entries.filter((entry) => entry.type === "session_update");
        const titleUpdate = updates.find((entry) => entry.updates.title === "Direct Title");
        expect(context.title).toBe("Direct Title");
        expect(harness.repo.summary(snapshot).title).toBe("Direct Title");
        expect(titleUpdate).toEqual(expect.objectContaining({
            origin: "projection",
            updates: {title: "Direct Title"},
        }));
        expect(snapshot.entries.some((entry) => entry.type === "leaf" && entry.parentId === titleUpdate?.id)).toBe(false);
    });

    it("report_result 校验失败后会继续下一轮让模型修正", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reporter-retry",
                name: "Reporter Retry",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "invalid data",
                    data: {
                        title: {},
                    },
                }, {id: "bad-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "fixed",
                    data: {
                        title: "Fixed",
                    },
                }, {id: "fixed-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.reporter-retry",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(result.reportResult).toEqual({
            result: "fixed",
            data: {
                title: "Fixed",
            },
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
        expect(visibleMessageText(context.messages)).toContain("report_result");
    }, 30_000);

    it("report_result 连续失败 3 次后返回 Runtime Error", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reporter-error-limit",
                name: "Reporter Error Limit",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad-1",
                    data: {title: {}},
                }, {id: "bad-report-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad-2",
                    data: {title: {}},
                }, {id: "bad-report-2"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad-3",
                    data: {title: {}},
                }, {id: "bad-report-3"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.reporter-error-limit",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const reportErrors = context.messages
            .filter((message) => message.role === "toolResult" && messageText(message).includes("report_result"))
            .length;

        expect(result.status).toBe("error");
        expect(result.error).toContain("report_result 连续失败 3 次");
        expect(result.error).toContain("report_result");
        expect(reportErrors).toBe(3);
    }, 30_000);

    it("report_result 的大校验错误不会撑大 InvokeAgentResult", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.large-report-result-error",
                name: "Large Report Result Error",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }, {additionalProperties: false}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        const largeField = "字段".repeat(100_000);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "bad-1", data: {title: {}}}, {id: "large-bad-report-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "bad-2", data: {title: {}}}, {id: "large-bad-report-2"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad-3",
                    data: {
                        title: "present",
                        [largeField]: true,
                    },
                }, {id: "large-bad-report-3"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.large-report-result-error",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("report_result 连续失败 3 次");
        expect(result.error).not.toContain(largeField);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(96 * 1024);
    }, 30_000);

    it("新建 session snapshot 会展示 profile system prompt 且不触发动态提醒", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.snapshot-system",
                name: "Snapshot System",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        System({children: "# Snapshot System\n\n只读展示。"}),
                        ModelContext({
                            children: Reminder({
                                id: "should-not-render",
                                children: Message({children: "DYNAMIC_REMINDER"}),
                            }),
                        }),
                    ],
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.snapshot-system",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.getSessionQuery(created.sessionId, {view: "systemPrompt"});
        const session = await harness.repo.readSession(created.sessionId);

        expect(result).toEqual({
            kind: "systemPrompt",
            sessionId: created.sessionId,
            systemPrompt: "# Snapshot System\n\n只读展示。",
        });
        expect(session.entries.some((entry) => {
            return entry.type === "custom_message" && messageText(entry.message as never) === "DYNAMIC_REMINDER";
        })).toBe(false);
    });

    it("settings-aware profile 的 snapshot 解析并注入 settings 后再渲染 system prompt", async () => {
        // 回归 GET /api/agent/sessions/:id 的 500：snapshotSystemPrompt 之前漏注入 settings，
        // 任何在 context() 里读 ctx.settings 的 profile 都会在快照路径抛 undefined。
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: fauxProviderConfig(faux).models,
            agent: {
                profiles: {
                    "test.snapshot-settings": {
                        settings: {
                            tone: "cinematic",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        const SettingsForm = defineLowCodeForm({
            schema: Type.Object({tone: Type.String()}, {additionalProperties: false}),
            defaults: {tone: "plain"},
            fields: [{
                path: "tone",
                component: "select",
                label: "语气",
                options: [
                    {value: "plain", label: "平实"},
                    {value: "cinematic", label: "电影感"},
                ],
            }],
        });
        harness.profiles.register(defineRuntimeAgentProfile({
            manifest: {
                key: "test.snapshot-settings",
                name: "Snapshot Settings",
            },
            initialSchema: Type.Object({}),
            settingsForm: SettingsForm,
            tools: toolset(),
            context(ctx) {
                // 直接读 ctx.settings：修复前快照路径不注入 settings，这里会抛 500。
                return ProfilePrompt({
                    children: System({children: `# Snapshot Settings\n\ntone=${ctx.settings.tone}`}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.snapshot-settings",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.getSessionQuery(created.sessionId, {view: "systemPrompt"});

        // 断 config 里的 cinematic（不是 schema 默认 plain），证明 settings 被真正解析注入。
        expect(result.kind === "systemPrompt" ? result.systemPrompt : "").toContain("tone=cinematic");
    });

    it("managed Project 未 open 时 snapshot 不初始化 Project Profile Home", async () => {
        const profileKey = "test.snapshot-home";
        const slug = `snapshot-home-${randomUUID()}`;
        const projectPath = `workspace/${slug}`;
        const projectRoot = join(harness.workspaceRoot, slug);
        const projectHomeMetadataPath = join(projectRoot, "agents", profileKey, "home.json");
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Snapshot Home\nsummary: ''\n", "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: profileKey,
                name: "Snapshot Home",
            },
            initialSchema: Type.Object({}),
            tools: toolset(),
            home: defineProfileHome({
                async init(ctx) {
                    await ctx.home.writeText("notes/default.md", "project home");
                },
            }),
            context() {
                return ProfilePrompt({
                    children: System({children: "# Snapshot Home"}),
                });
            },
        }), false);
        try {
            const created = await harness.createAgent({
                profileKey,
                initial: {},
                workspaceRoot: "workspace",
                projectPath,
            });

            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({kind: "recovery"});
            await expect(harness.getSessionQuery(created.sessionId, {view: "systemPrompt"})).rejects.toBeInstanceOf(ProjectNotOpenError);
            await expect(readFile(projectHomeMetadataPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});

            await openProject(harness.workspaceRoot, projectPath, {kind: "job", source: "test"});
            const result = await harness.getSessionQuery(created.sessionId, {view: "systemPrompt"});

            expect(result.kind === "systemPrompt" ? result.systemPrompt : "").toContain("# Snapshot Home");
            await expect(readFile(projectHomeMetadataPath, "utf8")).resolves.toContain(profileKey);
        } finally {
            await closeProjectForTest(projectPath).catch(() => undefined);
            await rm(projectRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        }
    });

    it("session recovery 通过 summary 暴露累计 usage，并保留 context usage", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createAssistantTextMessage({
            text: "first",
            usage: usage(12, 4, 3, 1),
        }));
        await harness.repo.appendMessage(created.sessionId, createAssistantTextMessage({
            text: "second",
            usage: usage(20, 8, 5, 0),
        }));

        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        const liveState = await harness.getSessionLiveState(created.sessionId);

        expect(recovery.summary.usage).toMatchObject({
            input: 32,
            output: 12,
            cacheRead: 8,
            cacheWrite: 1,
            totalTokens: 53,
        });
        expect(recovery.contextUsage).toEqual(expect.objectContaining({
            limitTokens: 128_000,
            estimated: true,
        }));
        expect(typeof recovery.contextUsage?.usedTokens).toBe("number");
        expect(typeof recovery.contextUsage?.percent).toBe("number");
        expect(liveState.contextUsage).toEqual(recovery.contextUsage);
    });

    it("新建Project session持久化逻辑Workspace Root并保留Project Path", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.workspace-container",
                name: "Workspace Container",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);

        await mkdir(join(root, "novel-7"), {recursive: true});
        const created = await harness.createAgent({
            profileKey: "test.workspace-container",
            initial: {},
            workspaceRoot: "workspace/novel-7",
            workspaceKey: "workspace/novel-7",
            projectPath: "workspace/novel-7",
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(context.workspaceRoot).toBe("workspace");
        expect(context.projectPath).toBe("workspace/novel-7");
    });

    it("/new 创建的新 session 保留 Workspace Root 和 projectPath", async () => {
        await mkdir(join(root, "novel-7"), {recursive: true});
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: "workspace/novel-7",
            workspaceKey: "workspace/novel-7",
            projectPath: "workspace/novel-7",
        });

        const result = await harness.runCommand(created.sessionId, {
            command: "new",
        });
        const context = harness.repo.reduce(await harness.repo.readSession(result.sessionId));

        expect(result.kind).toBe("created_session");
        expect(context.workspaceRoot).toBe("workspace");
        expect(context.projectPath).toBe("workspace/novel-7");
    });

    it("轻控制 command 返回 live state，mode no-op 不追加 entry", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const initialEntryCount = (await harness.repo.readSession(created.sessionId)).entries.length;

        const enabled = await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        const afterEnableEntryCount = (await harness.repo.readSession(created.sessionId)).entries.length;
        const enabledAgain = await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        const afterNoopEntryCount = (await harness.repo.readSession(created.sessionId)).entries.length;
        const thinking = await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "low",
        });

        expect(enabled.kind).toBe("live_state");
        if (enabled.kind === "live_state") {
            expect(enabled.state.agentMode).toBe("plan");
            expect(enabled).not.toHaveProperty("snapshot");
        }
        expect(afterEnableEntryCount).toBeGreaterThan(initialEntryCount);
        expect(enabledAgain.kind).toBe("live_state");
        expect(afterNoopEntryCount).toBe(afterEnableEntryCount);
        expect(thinking.kind).toBe("live_state");
        if (thinking.kind === "live_state") {
            expect(thinking.state.thinkingLevel).toBe("low");
        }
    });

    it("command timing sink 会记录热路径分段", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const marks = new Map<string, number>();

        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        }, {
            mark(name, durationMs) {
                marks.set(name, durationMs);
            },
        });

        expect([...marks.keys()]).toEqual(expect.arrayContaining([
            "readSession",
            "reduce",
            "profileRuntime",
            "writePlan",
            "liveState",
            "relations",
            "snapshotSystemPrompt",
            "total",
        ]));
        expect(marks.get("writePlan")).toBeGreaterThan(0);
        expect(marks.get("liveState")).toBeGreaterThan(0);
        expect(marks.get("relations")).toBe(0);
        expect(marks.get("snapshotSystemPrompt")).toBe(0);
    });

    it("command no-op timing 不记录 writePlan，但仍记录 liveState", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        const marks = new Map<string, number>();

        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        }, {
            mark(name, durationMs) {
                marks.set(name, durationMs);
            },
        });

        expect(marks.get("writePlan")).toBe(0);
        expect(marks.get("liveState")).toBeGreaterThan(0);
    });

    it("retry 返回 live state，fork 返回 created session", async () => {
        faux.setResponses([fauxAssistantMessage(fauxText("first"))]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const beforeRetry = await harness.repo.readSession(created.sessionId);
        const assistantEntry = beforeRetry.entries.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
        const originalGetSessionRecovery = harness.getSessionRecovery.bind(harness);
        const timingMarks = new Map<string, number>();
        (harness as {getSessionRecovery: NeuroAgentHarness["getSessionRecovery"]}).getSessionRecovery = async () => {
            throw new Error("retry command 不应另起 public snapshot operation");
        };

        let retry: Awaited<ReturnType<NeuroAgentHarness["runCommand"]>>;
        try {
            retry = await harness.runCommand(created.sessionId, {
                command: "retry",
                entryId: assistantEntry?.id,
            }, {
                mark(name, durationMs) {
                    timingMarks.set(name, durationMs);
                },
            });
        } finally {
            (harness as {getSessionRecovery: NeuroAgentHarness["getSessionRecovery"]}).getSessionRecovery = originalGetSessionRecovery;
        }
        const fork = await harness.runCommand(created.sessionId, {
            command: "fork",
        });

        expect(retry).toEqual(expect.objectContaining({
            kind: "live_state",
            sessionId: created.sessionId,
            state: expect.objectContaining({summary: expect.objectContaining({sessionId: created.sessionId})}),
        }));
        expect(timingMarks.get("writePlan")).toBeGreaterThan(0);
        expect(timingMarks.get("liveState")).toBeGreaterThan(0);
        expect(timingMarks.get("relations")).toBe(0);
        expect(timingMarks.get("snapshotSystemPrompt")).toBe(0);
        expect(fork.kind).toBe("created_session");
        if (fork.kind === "created_session") {
            expect(fork.sessionId).not.toBe(created.sessionId);
            expect(fork.createdSession.sessionId).toBe(fork.sessionId);
        }
    });

    it("approval 工具调用会停在 assistant tool call，resolution 后继续", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-reporter",
                name: "Approval Reporter",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done",
                }, {id: "report-2"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-reporter",
            initial: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });

        expect(waiting.status).toBe("waiting");
        const waitingSnapshot = await harness.getSessionRecovery(created.sessionId);
        expect(waitingSnapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "ask-1",
            toolName: "request_user_input",
            args: expect.objectContaining({kind: "generic"}),
        }));
        expect(waitingSnapshot.pendingUserInputs[0]?.formSpec).toBeUndefined();
        const waitingContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(waitingContext.messages.map((message) => message.role)).toEqual(["user", "assistant"]);

        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-1",
                answers: [{questionIndex: 0, note: "Alice"}],
            },
        });

        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("done");
    });

    it("多个大 pending user inputs 保留全部 resolution 身份且 live state 小于 50 KiB", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.pending-input-live-budget",
                name: "Pending Input Live Budget",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        const toolCallIds = Array.from({length: 4}, (_, index) => `ask-budget-${String(index)}`);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "all resolved"}, {id: "report-budget"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.pending-input-live-budget",
            initial: {},
            workspaceRoot: root,
        });
        const invocationId = "waiting-budget";
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId,
            status: "start",
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "ask all"}));
        await harness.repo.appendMessage(created.sessionId, fauxAssistantMessage(toolCallIds.map((toolCallId, index) => fauxToolCall("request_user_input", {
            questions: [{question: `${String(index)}-${"问题".repeat(6_000)}`}],
        }, {id: toolCallId})), {stopReason: "toolUse"}));
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId,
            status: "waiting",
        });

        const liveState = await harness.getSessionLiveState(created.sessionId);

        expect(liveState.summary.status).toBe("waiting");
        expect(liveState.pendingUserInputs.map((pending) => pending.toolCallId)).toEqual(toolCallIds);
        expect(Buffer.byteLength(JSON.stringify({
            kind: "session",
            event: {type: "session_state_changed", state: liveState},
        }), "utf8")).toBeLessThan(50 * 1024);

        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolutions: toolCallIds.map((toolCallId) => ({
                kind: "user_input" as const,
                toolCallId,
                answers: [{questionIndex: 0, text: "继续"}],
            })),
        });
        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("all resolved");
    });

    it("多个 Low-Code pending forms 只在 recovery 保留完整规格", async () => {
        harness.tools.register({
            key: "large_form_input",
            name: "large_form_input",
            label: "Large Form Input",
            description: "等待结构化用户输入。",
            parameters: Type.Object({index: Type.Number()}),
            userInputRequest: {
                when() {
                    return true;
                },
            },
            async execute() {
                return {content: [{type: "text", text: "ok"}], details: {}};
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.pending-form-live-budget",
                name: "Pending Form Live Budget",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["large_form_input"],
            prepare() {
                return {};
            },
        }), false);
        const toolCallIds = Array.from({length: 3}, (_, index) => `form-budget-${String(index)}`);
        const formSpec = {
            form: {
                defaults: {},
                fields: Array.from({length: 12}, (_, index) => ({
                    path: `field${String(index)}`,
                    component: "text" as const,
                    label: `字段${String(index)}-${"说明".repeat(250)}`,
                    required: true,
                    options: [],
                })),
            },
            layout: "dialog" as const,
            prompt: "请填写全部字段。",
        };
        const created = await harness.createAgent({
            profileKey: "test.pending-form-live-budget",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: "waiting-form-budget",
            status: "start",
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "ask forms"}));
        await harness.repo.appendMessage(created.sessionId, fauxAssistantMessage(toolCallIds.map((toolCallId, index) => fauxToolCall("large_form_input", {
            index,
        }, {id: toolCallId})), {stopReason: "toolUse"}));
        for (const toolCallId of toolCallIds) {
            await harness.repo.appendEntry(created.sessionId, {
                type: "custom",
                key: `${AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX}${toolCallId}`,
                value: {
                    toolCallId,
                    toolName: "large_form_input",
                    formSpec,
                },
            });
        }
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: "waiting-form-budget",
            status: "waiting",
        });

        const recovery = await harness.getSessionRecovery(created.sessionId);
        const liveState = await harness.getSessionLiveState(created.sessionId);

        expect(recovery.pendingUserInputs).toHaveLength(3);
        expect(recovery.pendingUserInputs.every((pending) => pending.formSpec?.form.fields.length === 12)).toBe(true);
        expect(liveState.pendingUserInputs.map((pending) => pending.toolCallId)).toEqual(toolCallIds);
        expect(liveState.pendingUserInputs).toEqual(toolCallIds.map((toolCallId) => expect.objectContaining({
            toolCallId,
            detailsOmitted: true,
        })));
        expect(liveState.pendingUserInputs.every((pending) => pending.formSpec === undefined)).toBe(true);
        expect(Buffer.byteLength(JSON.stringify({
            kind: "session",
            event: {type: "session_state_changed", state: liveState},
        }), "utf8")).toBeLessThan(50 * 1024);
    });

    it("live state 对大 session title 和 summary 做公开预览但不修改 durable truth", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const title = "标题".repeat(20_000);
        const summary = "摘要".repeat(20_000);
        await harness.repo.appendEntry(created.sessionId, {
            type: "session_update",
            updates: {title, summary},
        });

        const liveState = await harness.getSessionLiveState(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(context.title).toBe(title);
        expect(context.summary).toBe(summary);
        expect(liveState.summary.title).not.toBe(title);
        expect(liveState.summary.summary).not.toBe(summary);
        expect(Buffer.byteLength(JSON.stringify({
            kind: "session",
            event: {type: "session_state_changed", state: liveState},
        }), "utf8")).toBeLessThan(50 * 1024);
    });

    it("live state 对大 summarizer error 做公开预览但保留 custom state 真相", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const lastError = "摘要失败".repeat(30_000);
        await harness.repo.appendEntry(created.sessionId, {
            type: "custom",
            key: SESSION_SUMMARIZER_STATE_KEY,
            value: {
                sessionId: created.sessionId,
                running: false,
                dirty: false,
                lastError,
            },
        });

        const liveState = await harness.getSessionLiveState(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect((context.customState[SESSION_SUMMARIZER_STATE_KEY] as {lastError: string}).lastError).toBe(lastError);
        expect(liveState.summarizer?.lastError).not.toBe(lastError);
        expect(Buffer.byteLength(JSON.stringify({
            kind: "session",
            event: {type: "session_state_changed", state: liveState},
        }), "utf8")).toBeLessThan(50 * 1024);
    });

    it("未授权 userInputRequest 工具不会进入 waiting", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.user-input-permission",
                name: "User Input Permission",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "不应展示"}],
                }, {id: "ask-not-allowed"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "permission checked",
                }, {id: "report-permission"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.user-input-permission",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "try unauthorized input"},
        });
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const denied = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "ask-not-allowed");

        expect(result.status).toBe("completed");
        expect(result.reportResult?.result).toBe("permission checked");
        expect(recovery.pendingUserInputs).toHaveLength(0);
        expect(denied && messageText(denied as RuntimeMessage)).toContain("not allowed");
    });

    it("未授权 switch_mode 不会展示审批表单", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-permission",
                name: "Plan Permission",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("switch_mode", {
                    targetMode: "plan",
                    reason: "not allowed",
                }, {id: "enter-not-allowed"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "plan permission checked",
                }, {id: "report-plan-permission"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.plan-permission",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "try unauthorized plan"},
        });
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const denied = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "enter-not-allowed");

        expect(result.status).toBe("completed");
        expect(result.reportResult?.result).toBe("plan permission checked");
        expect(recovery.pendingUserInputs).toHaveLength(0);
        expect(recovery.agentMode).toBe("normal");
        expect(denied && messageText(denied as RuntimeMessage)).toContain("not allowed");
    });

    it("新 harness 能从 session active path 恢复 waiting 并复用 invocationId continue", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-reload",
                name: "Approval Reload",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-reload"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done after reload",
                }, {id: "report-reload"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-reload",
            initial: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(join(root, "page-missing-system-profiles"), join(root, "page-missing-user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const reloadedSnapshot = await restored.getSessionRecovery(created.sessionId);
        const reloadedSessions = await restored.listSessions({workspaceKey: "global"});
        const waitingSessions = await restored.listSessions({workspaceKey: "global", status: "waiting"});
        const waitingPage = await restored.listSessionPage({workspaceKey: "global", status: "waiting", limit: 10});
        const idleSessions = await restored.listSessions({workspaceKey: "global", status: "idle"});
        const continued = await restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-reload",
                answers: [{questionIndex: 0, note: "Alice"}],
            },
        });
        await restored.drainBackgroundTasks();

        expect(waiting.status).toBe("waiting");
        expect(reloadedSnapshot.summary.status).toBe("waiting");
        expect(reloadedSnapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "ask-reload",
            toolName: "request_user_input",
            args: expect.objectContaining({kind: "generic"}),
        }));
        expect(reloadedSnapshot.pendingUserInputs[0]?.formSpec).toBeUndefined();
        expect(reloadedSessions).toContainEqual(expect.objectContaining({
            sessionId: created.sessionId,
            status: "waiting",
        }));
        expect(waitingSessions.map((session) => session.sessionId)).toContain(created.sessionId);
        expect(waitingPage).toEqual(expect.objectContaining({
            total: 1,
            hasMore: false,
            items: [expect.objectContaining({
                sessionId: created.sessionId,
                status: "waiting",
            })],
        }));
        expect(idleSessions.map((session) => session.sessionId)).not.toContain(created.sessionId);
        expect(reloadedSnapshot.activeInvocation).toEqual(expect.objectContaining({
            invocationId: waiting.invocationId,
            status: "waiting",
            mode: "continue",
        }));
        expect(continued.invocationId).toBe(waiting.invocationId);
        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("done after reload");
    }, 120_000);

    it("listSessionPage 返回分页元数据并支持服务端搜索", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "leader.paged",
                name: "Paged Leader",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        await harness.createAgent({
            profileKey: "leader.paged",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "global",
            title: "Alpha",
        });
        const second = await harness.createAgent({
            profileKey: "leader.paged",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "global",
            title: "Beta Needle",
        });
        await harness.createAgent({
            profileKey: "leader.paged",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "global",
            title: "Gamma",
        });

        const firstPage = await harness.listSessionPage({workspaceKey: "global", profileGroup: "leader", status: "active", limit: 2});
        const secondPage = await harness.listSessionPage({workspaceKey: "global", profileGroup: "leader", status: "active", limit: 2, offset: firstPage.nextOffset});
        const searchPage = await harness.listSessionPage({workspaceKey: "global", profileGroup: "leader", status: "active", search: "needle", limit: 10});

        expect(firstPage).toEqual(expect.objectContaining({
            total: 3,
            offset: 0,
            limit: 2,
            hasMore: true,
            nextOffset: 2,
        }));
        expect(firstPage.items).toHaveLength(2);
        expect(secondPage).toEqual(expect.objectContaining({
            total: 3,
            offset: 2,
            limit: 2,
            hasMore: false,
        }));
        expect(secondPage.items).toHaveLength(1);
        expect(searchPage).toEqual(expect.objectContaining({
            total: 1,
            items: [expect.objectContaining({
                sessionId: second.sessionId,
                title: "Beta Needle",
            })],
        }));
    });

    it("listSessionPage 标记缺失 profile 的历史 session", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.page-missing",
                name: "Page Missing",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.page-missing",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(join(root, "deleted-system-profiles"), join(root, "deleted-user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const page = await restored.listSessionPage({workspaceKey: "global", limit: 10});

        expect(page.items).toContainEqual(expect.objectContaining({
            sessionId: created.sessionId,
            profileAvailability: "missing",
            profileIssueMessage: expect.stringContaining("未找到 agent profile"),
        }));
    });

    it("后端恢复 waiting 后并发 resolution 只能有一个 claim 成功", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-concurrent-reload",
                name: "Approval Concurrent Reload",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-concurrent-reload"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done after concurrent reload",
                }, {id: "report-concurrent-reload"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-concurrent-reload",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(join(root, "deleted-system-profiles"), join(root, "deleted-user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const resolution = {
            kind: "user_input" as const,
            toolCallId: "ask-concurrent-reload",
            answers: [{questionIndex: 0, text: "Alice"}],
        };
        const results = await Promise.allSettled([
            restored.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution,
            }),
            restored.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution,
            }),
        ]);
        await restored.drainBackgroundTasks();

        const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<NeuroAgentHarness["invokeAgent"]>>> => result.status === "fulfilled");
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        const snapshot = await restored.repo.readSession(created.sessionId);
        const context = restored.repo.reduce(snapshot);
        const resolutionMessages = context.messages.filter((message) => message.role === "toolResult" && messageText(message as never).includes("Alice"));
        const resumedLifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.invocationId === waiting.invocationId && entry.status === "resumed");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(String(rejected[0]?.reason instanceof Error ? rejected[0].reason.message : rejected[0]?.reason)).toContain("waiting_invocation_not_recoverable");
        expect(fulfilled[0]?.value.invocationId).toBe(waiting.invocationId);
        expect(resolutionMessages).toHaveLength(1);
        expect(resumedLifecycles).toHaveLength(1);
    }, 120_000);

    it("pending approval 没有可靠 waiting lifecycle 时拒绝 resolution", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-unrecoverable",
                name: "Approval Unrecoverable",
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
                    questions: [{question: "继续？"}],
                }, {id: "ask-unrecoverable"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-unrecoverable",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: waiting.invocationId,
            status: "resumed",
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        await expect(restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-unrecoverable",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        })).rejects.toThrow("waiting_invocation_not_recoverable");
        await restored.drainBackgroundTasks();
    }, 120_000);

    it("新 harness 恢复出的 waiting 可以 abort", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-reload-abort",
                name: "Approval Reload Abort",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Wait?"}],
                }, {id: "ask-reload-abort"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-reload-abort",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const aborted = await restored.abortInvocation(created.sessionId, {reason: "stop after reload"});
        const recovery = await restored.getSessionRecovery(created.sessionId);
        const snapshot = await restored.repo.readSession(created.sessionId);
        await restored.drainBackgroundTasks();

        expect(waiting.status).toBe("waiting");
        expect(aborted.status).toBe("aborted");
        expect(recovery.activeInvocation).toBeNull();
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            invocationId: waiting.invocationId,
            status: "aborted",
        }));
    });

    it("后端恢复 waiting 后 abort 和 resolution 并发只能有一个 claim 成功", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-abort-resolution-race",
                name: "Approval Abort Resolution Race",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-abort-resolution-race"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done after abort resolution race",
                }, {id: "report-abort-resolution-race"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-abort-resolution-race",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const results = await Promise.allSettled([
            restored.abortInvocation(created.sessionId, {reason: "stop while answering"}),
            restored.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution: {
                    kind: "user_input",
                    toolCallId: "ask-abort-resolution-race",
                    answers: [{questionIndex: 0, text: "Alice"}],
                },
            }),
        ]);
        await restored.drainBackgroundTasks();

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        const snapshot = await restored.repo.readSession(created.sessionId);
        const context = restored.repo.reduce(snapshot);
        const resolutionMessages = context.messages.filter((message) => {
            return message.role === "toolResult" && message.toolCallId === "ask-abort-resolution-race";
        });
        const terminalLifecycles = snapshot.entries.filter((entry) => {
            return entry.type === "invocation_lifecycle"
                && entry.invocationId === waiting.invocationId
                && (entry.status === "resumed" || entry.status === "aborted");
        });

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(resolutionMessages).toHaveLength(1);
        expect(terminalLifecycles).toHaveLength(1);
    }, 45_000);

    it("新 harness 对未完成普通 running snapshot 投影为 interrupted", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: "lost-running",
            status: "start",
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const snapshot = await restored.getSessionRecovery(created.sessionId);

        expect(snapshot.summary.status).toBe("interrupted");
        expect(snapshot.activeInvocation).toBeNull();
    });

    it("approval 后面的普通 tool call 会被显式跳过并保留 pending approval", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-batch-barrier",
                name: "Approval Batch Barrier",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "继续？"}],
                }, {id: "ask-barrier"}),
                fauxToolCall("report_result", {
                    result: "should wait",
                }, {id: "report-after-approval"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "done after approval",
                }, {id: "report-after-resolution"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-batch-barrier",
            initial: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const streamedToolResults: string[] = [];
        const userInputRequiredEvents: AgentSessionEventDto[] = [];
        const collect = (async () => {
            for await (const published of subscription) {
                const event = published.payload;
                if (event.kind === "runtime" && event.event.type === "tool.user-input-required") {
                    userInputRequiredEvents.push(event);
                }
                if (event.kind === "session" && event.event.type === "session_entry" && event.event.entry.type === "tool_result") {
                    streamedToolResults.push(event.event.entry.result.content
                        .filter((block) => block.type === "text")
                        .map((block) => block.textPreview)
                        .join("\n"));
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    break;
                }
            }
        })();

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        await collect;

        expect(waiting.status).toBe("waiting");
        const waitingContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(waitingContext.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(messageText(waitingContext.messages[2] as never)).toContain("waiting for user input");
        expect(streamedToolResults).toHaveLength(1);
        expect(streamedToolResults[0]).toContain("waiting for user input");
        expect(userInputRequiredEvents).toHaveLength(1);
        expect(userInputRequiredEvents[0]?.event).toEqual(expect.objectContaining({
            type: "tool.user-input-required",
            toolCallId: "ask-barrier",
            toolName: "request_user_input",
            args: expect.objectContaining({kind: "generic"}),
        }));
        expect(JSON.stringify(userInputRequiredEvents[0]?.event)).toContain("继续？");
        expect(userInputRequiredEvents[0]?.event).not.toHaveProperty("formSpec");
        expect(await harness.getSessionRecovery(created.sessionId)).toEqual(expect.objectContaining({
            pendingUserInputs: [expect.objectContaining({
                toolCallId: "ask-barrier",
                toolName: "request_user_input",
            })],
        }));

        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-barrier",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });

        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("done after approval");
    });

    it("拒绝把旧的未闭合普通 tool call 发送给 provider", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.interrupted-tool",
                name: "Interrupted Tool",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage(fauxText("should not run"))]);
        const created = await harness.createAgent({
            profileKey: "test.interrupted-tool",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old prompt"}));
        await harness.repo.appendMessage(created.sessionId, fauxAssistantMessage([
            fauxToolCall("read", {
                path: "novel-7/AGENTS.md",
            }, {id: "stale-read"}),
        ], {stopReason: "toolUse"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "continue"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("未闭合普通 tool call");
        const persisted = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(persisted.messages.some((message) => message.role === "toolResult" && message.toolCallId === "stale-read")).toBe(false);
    });

    it("普通 tool turn 到 turn_end 才成组写入 session", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.turn-commit",
                name: "Turn Commit",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["get_session"],
            prepare() {
                return {};
            },
        }), false);
        const snapshotsByEvent: Array<{event: string; roles: string[]}> = [];
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("get_session", {}, {id: "get-session-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.turn-commit",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            onEvent: async (event) => {
                if (event.type !== "message_end" && event.type !== "turn_end") {
                    return;
                }
                const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
                const eventLabel = event.type === "message_end"
                    ? `${event.type}:${event.stopReason}`
                    : event.type;
                snapshotsByEvent.push({
                    event: eventLabel,
                    roles: context.messages.map((message) => message.role),
                });
            },
        });

        expect(result.status, result.error ?? result.errorInfo?.message).toBe("completed");
        expect(snapshotsByEvent).toEqual([
            {event: "message_end:toolUse", roles: ["user"]},
            {event: "turn_end", roles: ["user", "assistant", "toolResult"]},
            {event: "message_end:stop", roles: ["user", "assistant", "toolResult"]},
            {event: "turn_end", roles: ["user", "assistant", "toolResult", "assistant"]},
        ]);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; message?: {role?: string}}>});
        const turnBatches = records
            .filter((record) => record.kind === "batch")
            .map((record) => record.entries?.filter((entry) => entry.type === "message").map((entry) => entry.message?.role));
        expect(turnBatches).toEqual([
            ["assistant", "toolResult"],
            ["assistant"],
        ]);
    });

    it("tool savePoint writes 会在 transcript 后 flush，不插入 assistant/toolResult 中间", async () => {
        harness.tools.register({
            key: "save_point_state",
            name: "save_point_state",
            label: "Save Point State",
            description: "Writes custom state at turn save point.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "missing context"}],
                    details: {},
                    terminate: true,
                };
            },
            async executeWithContext(context) {
                context.sessionWrites?.savePointCustomState("test.savePointState", "test.tool.savePoint", "queued");
                return {
                    content: [{type: "text", text: "queued"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.tool-save-point",
                name: "Tool Save Point",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["save_point_state"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("save_point_state", {}, {id: "save-point-state-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.tool-save-point",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(snapshot);

        expect(result.status).toBe("completed");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(context.customState["test.tool.savePoint"]).toBe("queued");

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; key?: string; message?: {role?: string}}>});
        const batchEntries = records
            .filter((record) => record.kind === "batch")
            .flatMap((record) => record.entries ?? [])
            .filter((entry) => entry.type !== "leaf");
        expect(batchEntries.map((entry) => entry.type === "message" ? entry.message?.role : entry.key)).toEqual([
            "assistant",
            "toolResult",
            "test.tool.savePoint",
        ]);
    });

    it("task_create 后同 run 继续输出时下一轮 task_set_status 仍能读到任务清单", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.task-savepoint-parent",
                name: "Task SavePoint Parent",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["task_create", "task_set_status", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("task_create", {
                    title: "第一章写作流程",
                    steps: [
                        {id: "design", text: "剧情初步设计", status: "in_progress"},
                        {id: "write", text: "调用 writer", status: "pending"},
                    ],
                }, {id: "task-create-call"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("框架 OK 吗？"),
            fauxAssistantMessage([
                fauxToolCall("task_set_status", {
                    id: "design",
                    status: "completed",
                }, {id: "task-set-call"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "done",
                }, {id: "report-task"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.task-savepoint-parent",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "继续按照流程写第一章"},
        });
        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "可以"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const tasks = context.customState[AGENT_TASKS_STATE_KEY] as {steps?: Array<{id: string; status: string}>};

        expect(result.status).toBe("completed");
        expect(visibleMessageText(context.messages)).not.toContain("当前 session 还没有任务清单");
        expect(tasks.steps).toEqual([
            expect.objectContaining({id: "design", status: "completed"}),
            expect.objectContaining({id: "write", status: "pending"}),
        ]);
    }, 30_000);

    it("parallel 工具会并发执行，但 toolResult 和 savePoint writes 按 tool call 顺序落盘", async () => {
        const releases = new Map<string, () => void>();
        const started: string[] = [];
        harness.tools.register({
            key: "parallel_save_point",
            name: "parallel_save_point",
            label: "Parallel Save Point",
            description: "Parallel test tool.",
            executionMode: "parallel",
            parameters: Type.Object({
                name: Type.String(),
            }),
            async executeWithContext(context, _toolCallId, params: unknown) {
                const input = params as {name: string};
                started.push(input.name);
                await new Promise<void>((resolve) => releases.set(input.name, resolve));
                context.sessionWrites?.savePointCustomState(`test.parallel.${input.name}`, `test.parallel.${input.name}`, input.name);
                return {
                    content: [{type: "text", text: input.name}],
                    details: {},
                    terminate: true,
                };
            },
            async execute() {
                throw new Error("parallel_save_point 需要 context。");
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.parallel-tools",
                name: "Parallel Tools",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["parallel_save_point"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("parallel_save_point", {name: "first"}, {id: "parallel-first"}),
                fauxToolCall("parallel_save_point", {name: "second"}, {id: "parallel-second"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.parallel-tools",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        let result: Awaited<ReturnType<NeuroAgentHarness["invokeAgent"]>>;
        try {
            await waitFor(() => expect(started).toHaveLength(2));
            releases.get("second")?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
            releases.get("first")?.();
            result = await running;
        } catch (error) {
            releases.get("first")?.();
            releases.get("second")?.();
            await running.catch(() => undefined);
            throw error;
        }

        expect(result.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.filter((message) => message.role === "toolResult").map(messageText)).toEqual(["first", "second"]);

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; key?: string; message?: {role?: string}}>});
        const batchEntries = records
            .filter((record) => record.kind === "batch")
            .flatMap((record) => record.entries ?? [])
            .filter((entry) => entry.type !== "leaf");
        expect(batchEntries.map((entry) => entry.type === "message" ? entry.message?.role : entry.key)).toEqual([
            "assistant",
            "toolResult",
            "toolResult",
            "test.parallel.first",
            "test.parallel.second",
        ]);
    });

    it("同一 segment 混入 sequential 工具时整段串行", async () => {
        const started: string[] = [];
        harness.tools.register({
            key: "parallel_marker",
            name: "parallel_marker",
            label: "Parallel Marker",
            description: "Parallel marker.",
            executionMode: "parallel",
            parameters: Type.Object({
                name: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                started.push((params as {name: string}).name);
                return {
                    content: [{type: "text", text: (params as {name: string}).name}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.tools.register({
            key: "sequential_gate",
            name: "sequential_gate",
            label: "Sequential Gate",
            description: "Sequential gate.",
            executionMode: "sequential",
            parameters: Type.Object({}),
            async execute() {
                started.push("gate");
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    content: [{type: "text", text: "gate"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sequential-segment",
                name: "Sequential Segment",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["parallel_marker", "sequential_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("parallel_marker", {name: "first"}, {id: "marker-first"}),
                fauxToolCall("sequential_gate", {}, {id: "gate"}),
                fauxToolCall("parallel_marker", {name: "second"}, {id: "marker-second"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sequential-segment",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(started).toEqual(["first", "gate", "second"]);
    });

    it("harness toolExecution=sequential 会强制 parallel 工具串行执行", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
            toolExecution: "sequential",
        });
        const releases = new Map<string, () => void>();
        const started: string[] = [];
        harness.tools.register({
            key: "parallel_gate",
            name: "parallel_gate",
            label: "Parallel Gate",
            description: "Parallel gate.",
            executionMode: "parallel",
            parameters: Type.Object({
                name: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                const name = (params as {name: string}).name;
                started.push(name);
                await new Promise<void>((resolve) => releases.set(name, resolve));
                return {
                    content: [{type: "text", text: name}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.global-sequential-tools",
                name: "Global Sequential Tools",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["parallel_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("parallel_gate", {name: "first"}, {id: "global-first"}),
                fauxToolCall("parallel_gate", {name: "second"}, {id: "global-second"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.global-sequential-tools",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        try {
            await waitFor(() => expect(started).toEqual(["first"]));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(started).toEqual(["first"]);
            releases.get("first")?.();
            await waitFor(() => expect(started).toEqual(["first", "second"]));
            releases.get("second")?.();
            const result = await running;
            expect(result.status).toBe("completed");
        } catch (error) {
            releases.get("first")?.();
            releases.get("second")?.();
            await running.catch(() => undefined);
            throw error;
        }
    });

    it("自动 compaction 在下一轮 turn 前执行，并影响下一轮 provider context", async () => {
        const providerPrompts: string[] = [];
        harness.tools.register({
            key: "force_continue",
            name: "force_continue",
            label: "Force Continue",
            description: "Forces another turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.compact-before-next-turn",
                name: "Compact Before Next Turn",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["force_continue"],
            runtimeDefaults: {
                compaction: {
                    trigger: {kind: "tokens", value: 1},
                    keepRecent: {kind: "tokens", value: 1},
                },
            },
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Message({children: "HISTORY AFTER AUTO COMPACT"})}),
                    ],
                });
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("force_continue", {}, {id: "force-continue-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage(fauxText("COMPACT SUMMARY")),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.compact-before-next-turn",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "OLD CONTEXT"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("OLD CONTEXT");
        expect(providerPrompts[1]).toContain("COMPACT SUMMARY");
        expect(providerPrompts[1]).toContain("HISTORY AFTER AUTO COMPACT");
        expect(providerPrompts[1]).not.toContain("OLD CONTEXT");
        expect(context.messages[0] && messageText(context.messages[0] as never)).toContain("OLD CONTEXT");
    });

    it("自定义 runtime 有 profile compaction 配置时仍会自动 compaction", async () => {
        const providerPrompts: string[] = [];
        harness.tools.register({
            key: "force_continue_no_compact",
            name: "force_continue_no_compact",
            label: "Force Continue No Compact",
            description: "Forces another turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-compact-runtime",
                name: "No Compact Runtime",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["force_continue_no_compact"],
            runtimeDefaults: {
                compaction: {
                    trigger: {kind: "tokens", value: 1},
                    keepRecent: {kind: "tokens", value: 1},
                },
            },
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            context() {
                return (
                    ProfilePrompt({
                        children: [
                            HistorySet({children: Message({children: "HISTORY AFTER COMPACT"})}),
                        ],
                    })
                );
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("force_continue_no_compact", {}, {id: "force-continue-no-compact-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage(fauxText("CUSTOM RUNTIME SUMMARY")),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done with compact");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-compact-runtime",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "OLD CONTEXT"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(result.status).toBe("completed");
        expect(providerPrompts).toHaveLength(2);
        expect(providerPrompts[1]).toContain("CUSTOM RUNTIME SUMMARY");
        expect(providerPrompts[1]).not.toContain("HISTORY AFTER COMPACT");
        expect(providerPrompts[1]).not.toContain("OLD CONTEXT");
        expect(snapshot.entries.some((entry) => entry.type === "compaction")).toBe(true);
        expect(snapshot.entries.filter((entry) => entry.type === "custom_message" && messageText(entry.message as RuntimeMessage).includes("HISTORY AFTER COMPACT"))).toHaveLength(0);
        expect(faux.getPendingResponseCount()).toBe(0);
    }, 10_000);

    it("显式关闭 compaction 且上下文超出模型窗口时 run 失败", async () => {
        const smallWindowHarness = new NeuroAgentHarness({
            repo: harness.repo,
            modelResolver: () => ({
                ...faux.getModel(),
                contextWindow: 1,
            }),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness = smallWindowHarness;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-compaction-overflow",
                name: "No Compaction Overflow",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {compaction: {enabled: false}},
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.no-compaction-overflow",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "this will exceed the tiny window"},
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("已关闭 Compaction");
        expect(result.errorInfo?.message).toContain("超过模型");
    }, 30_000);

    it("prepareRun sidecar 注入后超出模型窗口时不会进入主 provider", async () => {
        let mainProviderCalls = 0;
        const smallWindowHarness = new NeuroAgentHarness({
            repo: harness.repo,
            modelResolver: () => ({
                ...faux.getModel(),
                contextWindow: 1,
            }),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness = smallWindowHarness;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-overflow",
                name: "Sidecar Overflow",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({}),
                enterPrompt: "检索并整理本轮 actor 可知设定。",
                merge() {
                    return {
                        persistedMessages: [
                            createUserMessage({text: "this persisted sidecar context is too large for the tiny window"}),
                        ],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "loaded",
                    data: {
                        "actor.context-load": {},
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            () => {
                mainProviderCalls += 1;
                return fauxAssistantMessage("main should not run");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-overflow",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("超过模型");
        expect(mainProviderCalls).toBe(0);
        expect(visibleMessageText(context.messages)).toContain("this persisted sidecar context is too large");
    }, 30_000);

    it("prepareRun sidecar 注入超窗后不会继续执行后续 sidecar", async () => {
        let secondSidecarCalls = 0;
        const smallWindowHarness = new NeuroAgentHarness({
            repo: harness.repo,
            modelResolver: () => ({
                ...faux.getModel(),
                contextWindow: 1,
            }),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness = smallWindowHarness;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-overflow-before-next-sidecar",
                name: "Sidecar Overflow Before Next Sidecar",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [
                {
                    name: "actor.context-load",
                    stage: "prepareRun",
                    allowedToolKeys: ["report_result"],
                    sidecarDataSchema: Type.Object({}),
                    enterPrompt: "检索并整理本轮 actor 可知设定。",
                    merge() {
                        return {
                            persistedMessages: [
                                createUserMessage({text: "the first sidecar injects too much context for the tiny window"}),
                            ],
                        };
                    },
                },
                {
                    name: "actor.second-context-load",
                    stage: "prepareRun",
                    allowedToolKeys: ["report_result"],
                    sidecarDataSchema: Type.Object({}),
                    enterPrompt: "第二个 sidecar 不应该执行。",
                    merge() {
                        return {};
                    },
                },
            ],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "loaded",
                    data: {
                        "actor.context-load": {},
                    },
                }, {id: "first-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            () => {
                secondSidecarCalls += 1;
                return fauxAssistantMessage([
                    fauxToolCall("report_sidecar_result", {
                        result: "second",
                        data: {
                            "actor.second-context-load": {},
                        },
                    }, {id: "second-sidecar-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-overflow-before-next-sidecar",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("sidecar actor.context-load 注入后上下文");
        expect(secondSidecarCalls).toBe(0);
    }, 30_000);

    it("profile reasoningEffort 会传给支持 reasoning 的模型", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: fauxProviderConfig(faux).models,
            agent: {
                profiles: {
                    "test.reasoning": {
                        model: {
                            reasoningEffort: "high",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reasoning",
                name: "Reasoning",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        let observedReasoning: unknown;
        faux.setResponses([
            (_context, options) => {
                observedReasoning = (options as {reasoning?: unknown} | undefined)?.reasoning;
                return fauxAssistantMessage(fauxText("done"));
            },
        ]);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => ({
                ...faux.getModel(),
                reasoning: true,
            }),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.reasoning",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedReasoning).toBe("high");
    });

    it("profile settings 会在每次 prepare 读取最新 effective config", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: fauxProviderConfig(faux).models,
            agent: {
                profiles: {
                    "test.settings": {
                        settings: {
                            tone: "cinematic",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        const SettingsSchema = Type.Object({
            tone: Type.String(),
        }, {additionalProperties: false});
        const SettingsForm = defineLowCodeForm({
            schema: SettingsSchema,
            defaults: {
                tone: "plain",
            },
            fields: [{
                path: "tone",
                component: "select",
                label: "语气",
                options: [
                    {value: "plain", label: "平实"},
                    {value: "cinematic", label: "电影感"},
                    {value: "lyrical", label: "抒情"},
                ],
            }],
        });
        const observedTones: string[] = [];
        harness.profiles.register(defineRuntimeAgentProfile({
            manifest: {
                key: "test.settings",
                name: "Settings",
            },
            initialSchema: Type.Object({}),
            settingsForm: SettingsForm,
            tools: toolset(),
            prepare(ctx) {
                observedTones.push(ctx.settings.tone);
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("second")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.settings",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run first"},
        });
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: fauxProviderConfig(faux).models,
            agent: {
                profiles: {
                    "test.settings": {
                        settings: {
                            tone: "lyrical",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run second"},
        });

        expect(observedTones).toEqual(["cinematic", "lyrical"]);
    });

    it("session thinking 覆盖能显式关闭并回到 profile 默认", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: fauxProviderConfig(faux).models,
            agent: {
                profiles: {
                    "test.session-thinking": {
                        model: {
                            reasoningEffort: "high",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.session-thinking",
                name: "Session Thinking",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const observedReasoning: unknown[] = [];
        faux.setResponses([
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("profile default"));
            },
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("off override"));
            },
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("minimal override"));
            },
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("back to profile"));
            },
        ]);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => ({
                ...faux.getModel(),
                reasoning: true,
            }),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.session-thinking",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "profile"},
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "off",
        });
        expect(await harness.getSessionRecovery(created.sessionId)).toMatchObject({
            thinkingLevel: "off",
            effectiveThinkingLevel: "off",
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "off"},
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "minimal",
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "minimal"},
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: null,
        });
        expect(await harness.getSessionRecovery(created.sessionId)).toMatchObject({
            thinkingLevel: null,
            effectiveThinkingLevel: "high",
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "profile again"},
        });

        expect(observedReasoning).toEqual(["high", undefined, "minimal", "high"]);
    });

    it("snapshot 会暴露模型能力裁剪后的 effective thinking", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: fauxProviderConfig(faux).models,
            agent: {
                profiles: {
                    "test.snapshot-thinking": {
                        model: {
                            reasoningEffort: "high",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.snapshot-thinking",
                name: "Snapshot Thinking",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => ({
                ...faux.getModel(),
                reasoning: false,
            }),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.snapshot-thinking",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "xhigh",
        });

        expect(await harness.getSessionRecovery(created.sessionId)).toMatchObject({
            thinkingLevel: "xhigh",
            effectiveThinkingLevel: "off",
        });
    });

    it("snapshot 没有可解析模型时 effective thinking 回落为 off", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-model",
                name: "No Model",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => {
                throw new Error("配置未设置 models.default");
            },
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.no-model",
            initial: {},
            workspaceRoot: root,
        });

        expect(await harness.getSessionRecovery(created.sessionId)).toMatchObject({
            thinkingLevel: null,
            effectiveThinkingLevel: "off",
        });
    });

    it("创建 session 时绑定当前解析出的具体模型", async () => {
        const defaultModel = {
            ...faux.getModel(),
            id: "session-default-model",
            name: "Session Default Model",
            provider: "session-provider",
            providerConfigId: "session-provider",
            baseUrl: "https://private-provider.example/v1",
            headers: {Authorization: "Bearer private-token"},
        };
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => defaultModel,
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const recovery = await harness.getSessionRecovery(created.sessionId);
        const liveState = await harness.getSessionLiveState(created.sessionId);
        expect(recovery.model).toEqual({
            providerConfigId: "session-provider",
            modelId: "session-default-model",
        });
        expect(liveState.model).toEqual(recovery.model);
        expect(JSON.stringify({recovery: recovery.model, live: liveState.model})).not.toContain("private-token");
        expect(JSON.stringify({recovery: recovery.model, live: liveState.model})).not.toContain("private-provider.example");
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "session-provider",
            modelId: "session-default-model",
        });
    });

    it("model command 的 null 会绑定当前 profile/default 解析出的具体模型", async () => {
        const defaultModel = {
            ...faux.getModel(),
            id: "default-command-model",
            name: "Default Command Model",
            provider: "default-provider",
            providerConfigId: "default-provider",
        };
        const explicitModel = {
            ...faux.getModel(),
            id: "explicit-command-model",
            name: "Explicit Command Model",
            provider: "explicit-provider",
            providerConfigId: "explicit-provider",
        };
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (_config, _profileKey, override) => {
                if (!override?.modelKey || override.modelKey === "default-provider/default-command-model") return defaultModel;
                if (override.modelKey === "explicit-provider/explicit-command-model") return explicitModel;
                throw new Error(`模型未启用或不存在：${override.modelKey}`);
            },
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "model",
            modelKey: "explicit-provider/explicit-command-model",
        });
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "explicit-provider",
            modelId: "explicit-command-model",
        });

        await harness.runCommand(created.sessionId, {
            command: "model",
            modelKey: null,
        });

        expect((await harness.getSessionRecovery(created.sessionId)).model).toEqual(expect.objectContaining({
            modelId: "default-command-model",
            providerConfigId: "default-provider",
        }));
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "default-provider",
            modelId: "default-command-model",
        });
    });

    it("已删除的session模型不回退默认模型并只阻断当前session", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "default-provider/default-model",
                providers: [{
                    id: "default-provider",
                    name: "Default Provider",
                    api: null,
                    options: {
                        apiKey: "",
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "default-model",
                        name: "Default Model",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, null, 4), "utf8");
        const defaultModel = {
            ...faux.getModel(),
            id: "default-model",
            name: "Default Model",
            provider: "default-provider",
            providerConfigId: "default-provider",
        };
        const deletedModel = {
            ...faux.getModel(),
            id: "deleted-model",
            name: "Deleted Model",
            provider: "deleted-provider",
            providerConfigId: "deleted-provider",
        };
        let providerDeleted = false;
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (_config, _profileKey, override) => {
                if (override?.modelKey === "deleted-provider/deleted-model") {
                    if (providerDeleted) throw new Error("provider deleted");
                    return deletedModel;
                }
                return defaultModel;
            },
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "model",
            modelKey: "deleted-provider/deleted-model",
        });
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "deleted-provider",
            modelId: "deleted-model",
        });
        providerDeleted = true;

        expect((await harness.getSessionRecovery(created.sessionId)).model).toEqual({
            providerConfigId: "deleted-provider",
            modelId: "deleted-model",
        });

        faux.setResponses([fauxAssistantMessage("done")]);
        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run with invalid model"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("Session模型引用已失效");
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "deleted-provider",
            modelId: "deleted-model",
        });
    });

    it("同一 selection key 在 invocation 刷新 runtime metadata 时不重复写 model_change", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "local/model-a",
                providers: [{
                    id: "local",
                    name: "Local",
                    enabled: true,
                    api: "openai-completions",
                    options: {
                        apiKey: "",
                        baseURL: "http://127.0.0.1:11434/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "model-a",
                        name: "Model A",
                        enabled: true,
                        contextWindowTokens: 128000,
                        maxTokens: 8000,
                    }],
                }],
            },
        }, null, 4), "utf8");
        let resolvedModel: ResolvedPiModel = {
            ...faux.getModel(),
            id: "model-a",
            name: "Model A",
            provider: "registry-a",
            providerConfigId: "local",
            baseUrl: "https://old.example/v1",
            contextWindow: 128000,
            maxTokens: 8000,
        };
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => resolvedModel,
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const initialChanges = (await harness.repo.readSession(created.sessionId)).entries
            .filter((entry) => entry.type === "model_change").length;

        resolvedModel = {
            ...resolvedModel,
            baseUrl: "https://new.example/v1",
            contextWindow: 1048576,
            maxTokens: 131072,
            compat: {maxTokensField: "max_tokens"},
        };
        faux.setResponses([fauxAssistantMessage("first")]);
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "refresh metadata"},
        });

        const refreshedSnapshot = await harness.repo.readSession(created.sessionId);
        expect(refreshedSnapshot.entries.filter((entry) => entry.type === "model_change")).toHaveLength(initialChanges);
        expect(harness.repo.reduce(refreshedSnapshot).model).toEqual({
            providerConfigId: "local",
            modelId: "model-a",
        });
        expect(JSON.stringify(refreshedSnapshot)).not.toContain("https://new.example/v1");

        faux.setResponses([fauxAssistantMessage("second")]);
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "same metadata"},
        });
        expect((await harness.repo.readSession(created.sessionId)).entries
            .filter((entry) => entry.type === "model_change")).toHaveLength(initialChanges);
    });

    it("没有可用默认模型时新 session 保持空模型并在运行时报配置错误", async () => {
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => {
                throw new Error("配置未设置 models.default");
            },
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        expect((await harness.getSessionRecovery(created.sessionId)).model).toBeNull();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run without model"},
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("配置未设置 models.default");
    });

    it("没有可用默认模型时不会把历史 session 模型写成空模型", async () => {
        const deletedModel = {
            ...faux.getModel(),
            id: "deleted-model",
            name: "Deleted Model",
            provider: "deleted-provider",
            providerConfigId: "deleted-provider",
        };
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (_config, _profileKey, override) => {
                if (override?.modelKey) {
                    return deletedModel;
                }
                throw new Error("配置未设置 models.default");
            },
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "model",
            modelKey: "deleted-provider/deleted-model",
        });

        await expect(harness.runCommand(created.sessionId, {
            command: "model",
            modelKey: null,
        })).rejects.toThrow("配置未设置 models.default");
        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run without default"},
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("deleted-provider/deleted-model");
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "deleted-provider",
            modelId: "deleted-model",
        });
        expect((await harness.getSessionRecovery(created.sessionId)).model).toEqual({
            providerConfigId: "deleted-provider",
            modelId: "deleted-model",
        });
    });

    it("profile runtime hook 可以写 session、保存运行态并 patch 每轮 TurnSnapshot", async () => {
        const observedRequestOptions: unknown[] = [];
        const observedToolNames: string[][] = [];
        harness.tools.register({
            key: "runtime_extra",
            name: "runtime_extra",
            label: "Runtime Extra",
            description: "Only available after runtime hook patches toolKeys.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "extra"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-hooks",
                name: "Runtime Hooks",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["runtime_extra"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "tracker",
                        stage: "prepareRun",
                        run(ctx) {
                            return {
                                runtimeState: {
                                    started: ctx.session.messages.length,
                                },
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.prepareRun",
                                    ops: [{
                                        kind: "append",
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.prepareRun",
                                            value: "ok",
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                    {
                        name: "tracker",
                        stage: "prepareTurn",
                        run(ctx) {
                            const state = typeof ctx.runtimeState === "object" && ctx.runtimeState && !Array.isArray(ctx.runtimeState)
                                ? ctx.runtimeState as {started?: number}
                                : {};
                            return {
                                runtimeState: {
                                    preparedTurn: ctx.turnIndex ?? 0,
                                    started: state.started ?? 0,
                                },
                                turnSnapshotPatch: {
                                    toolKeys: ["runtime_extra"],
                                    requestOptions: {
                                        metadata: {
                                            runtimeHookMarker: `turn-${ctx.turnIndex ?? 0}`,
                                        },
                                    },
                                },
                            };
                        },
                    },
                    {
                        name: "tracker",
                        stage: "ingestTurn",
                        run(ctx) {
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.ingestTurn",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.ingestTurn",
                                            value: ctx.runtimeState ?? null,
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context, options) => {
                observedRequestOptions.push(options);
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                return fauxAssistantMessage([
                    fauxToolCall("runtime_extra", {}, {id: "runtime-extra-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage("done", {stopReason: "stop"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-hooks",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedRequestOptions[0]).toEqual(expect.objectContaining({
            metadata: {
                runtimeHookMarker: "turn-1",
            },
        }));
        expect(observedToolNames[0]).toEqual(["runtime_extra"]);
        expect(context.customState["test.runtime.prepareRun"]).toBe("ok");
        expect(context.customState["test.runtime.ingestTurn"]).toEqual({
            preparedTurn: 1,
            started: 0,
        });
    }, 30_000);

    it("prepareTurn toolKeysPatch 不能扩大 profile root tools", async () => {
        harness.tools.register({
            key: "runtime_root_escape",
            name: "runtime_root_escape",
            label: "Runtime Root Escape",
            description: "Registered globally, but not declared in profile root tools.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "escape"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-tool-root-boundary",
                name: "Runtime Tool Root Boundary",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "patch-root-tools",
                        stage: "prepareTurn",
                        run() {
                            return {
                                turnSnapshotPatch: {
                                    toolKeys: ["runtime_root_escape"],
                                },
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("provider should not be called", {stopReason: "stop"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-tool-root-boundary",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("toolKeysPatch 必须是 profile root tools 子集");
        expect(result.errorInfo?.message).toContain("runtime_root_escape");
    }, 30_000);

    it("自定义 runtime 不组合 transcriptPersistence 时不会隐式持久化 assistant transcript", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.custom-runtime-no-default-transcript",
                name: "Custom Runtime No Default Transcript",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "observe",
                        stage: "prepareRun",
                        run() {
                            return {};
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("not persisted"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.custom-runtime-no-default-transcript",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("not persisted");
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
    });

    it("prepareNextTurn hook 会在同一个 run 的下一轮请求前执行", async () => {
        const observedRequestOptions: unknown[] = [];
        const providerPrompts: string[] = [];
        let toolRuns = 0;
        harness.tools.register({
            key: "runtime_continue",
            name: "runtime_continue",
            label: "Runtime Continue",
            description: "Forces one more turn.",
            parameters: Type.Object({}),
            async execute() {
                toolRuns++;
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.prepare-next-turn",
                name: "Prepare Next Turn",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["runtime_continue"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "next",
                        stage: "prepareNextTurn",
                        run(ctx) {
                            return {
                                runtimeMessages: [
                                    createUserMessage({text: "NEXT_TURN_RUNTIME_CONTEXT"}),
                                ],
                                runtimeState: {
                                    preparedAfterTurn: ctx.turnIndex ?? 0,
                                },
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.prepareNextTurn",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.prepareNextTurn",
                                            value: {
                                                turnIndex: ctx.turnIndex ?? 0,
                                                messageCount: ctx.session.messages.length,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                    {
                        name: "next",
                        stage: "prepareTurn",
                        run(ctx) {
                            const state = typeof ctx.runtimeState === "object" && ctx.runtimeState && !Array.isArray(ctx.runtimeState)
                                ? ctx.runtimeState as {preparedAfterTurn?: number}
                                : {};
                            return {
                                turnSnapshotPatch: state.preparedAfterTurn
                                    ? {
                                        requestOptions: {
                                            metadata: {
                                                preparedAfterTurn: state.preparedAfterTurn,
                                            },
                                        },
                                    }
                                    : undefined,
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context, options) => {
                observedRequestOptions.push(options);
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("runtime_continue", {}, {id: "continue-1"}),
                ], {stopReason: "toolUse"});
            },
            (context, options) => {
                observedRequestOptions.push(options);
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.prepare-next-turn",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(toolRuns).toBe(1);
        expect(providerPrompts[0]).not.toContain("NEXT_TURN_RUNTIME_CONTEXT");
        expect(providerPrompts[1]).toContain("NEXT_TURN_RUNTIME_CONTEXT");
        expect(observedRequestOptions[0]).not.toEqual(expect.objectContaining({
            metadata: {
                preparedAfterTurn: 1,
            },
        }));
        expect(observedRequestOptions[1]).toEqual(expect.objectContaining({
            metadata: {
                preparedAfterTurn: 1,
            },
        }));
        expect(context.customState["test.runtime.prepareNextTurn"]).toEqual({
            turnIndex: 1,
            messageCount: 3,
        });
        expect(context.messages
            .map((message) => storedMessageText(message))).not.toContain("NEXT_TURN_RUNTIME_CONTEXT");
    });

    it("同名 runtime hook 的对象 runtimeState 会按 namespace 浅合并", async () => {
        const observedRuntimeStates: unknown[] = [];
        harness.tools.register({
            key: "continue_once",
            name: "continue_once",
            label: "Continue Once",
            description: "Forces one more turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-state-merge",
                name: "Runtime State Merge",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["continue_once"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "state",
                        stage: "prepareRun",
                        run() {
                            return {
                                runtimeState: {
                                    first: true,
                                },
                            };
                        },
                    },
                    {
                        name: "state",
                        stage: "prepareNextTurn",
                        run(ctx) {
                            observedRuntimeStates.push(ctx.runtimeState);
                            return {
                                runtimeState: {
                                    second: true,
                                },
                            };
                        },
                    },
                    {
                        name: "state",
                        stage: "prepareTurn",
                        run(ctx) {
                            observedRuntimeStates.push(ctx.runtimeState);
                            return {};
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("continue_once", {}, {id: "continue-once"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-state-merge",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedRuntimeStates).toEqual([
            {first: true},
            {first: true},
            {first: true, second: true},
        ]);
    });

    it("settleRun hook 可以读取 report_result 并写最终 projection", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.settle-run",
                name: "Settle Run",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "settle",
                        stage: "settleRun",
                        run(ctx) {
                            const data = ctx.runResult?.reportResult?.data as {title?: string} | undefined;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.settleRun",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.settleRun",
                                            value: {
                                                status: ctx.runResult?.status ?? "completed",
                                                title: data?.title ?? null,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "ok",
                    data: {
                        title: "Settled",
                    },
                }, {id: "report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.settle-run",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult?.data).toEqual({
            title: "Settled",
        });
        expect(context.customState["test.runtime.settleRun"]).toEqual({
            status: "completed",
            title: "Settled",
        });
    });

    it("prepareRun sidecar 可以注入主 run runtime context，且旁路 transcript 只落 side branch", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-context-load",
                name: "Sidecar Context Load",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "检索并整理本轮 actor 可知设定。",
                merge(ctx, result) {
                    const sidecarData = result.sidecarData as {context: string};
                    return {
                        runtimeMessages: [
                            createUserMessage({text: `ACTOR_SAFE_CONTEXT:${sidecarData.context}`}),
                            createUserMessage({text: `SIDECAR_CALLER:${ctx.caller.kind}`}),
                        ],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("report_sidecar_result", {
                        result: "loaded",
                        data: {
                            "actor.context-load": {
                                context: "SAFE_LORE",
                            },
                        },
                    }, {id: "sidecar-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxText("main done"),
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-context-load",
            initial: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const publicRuntimeTypes: string[] = [];
        const collector = (async () => {
            for await (const published of subscription) {
                if (published.payload.kind !== "runtime") {
                    continue;
                }
                publicRuntimeTypes.push(published.payload.event.type);
                if (published.payload.event.type === "agent_end") {
                    return;
                }
            }
        })();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        subscription.close();
        await collector;
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarEntry = snapshot.entries.find((entry) => {
            return entry.type === "message" && messageText(entry.message).includes("sidecar: actor.context-load");
        });
        const sidecarReportEntry = snapshot.entries.find((entry) => {
            return entry.type === "message" && messageText(entry.message).includes("loaded");
        });

        expect(result).toEqual(expect.objectContaining({status: "completed"}));
        expect(result.reportResult).toEqual({result: "main"});
        expect(providerPrompts[0]).toContain("sidecar: actor.context-load");
        expect(providerPrompts[1]).toContain("ACTOR_SAFE_CONTEXT:SAFE_LORE");
        expect(providerPrompts[1]).toContain("SIDECAR_CALLER:sidecar");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(visibleMessageText(context.messages)).not.toContain("SAFE_LORE");
        expect(visibleMessageText(context.messages)).not.toContain("loaded");
        expect(sidecarEntry).toEqual(expect.objectContaining({type: "message", origin: "harness"}));
        expect(sidecarReportEntry).toEqual(expect.objectContaining({type: "message", origin: "harness"}));
        expect(publicRuntimeTypes.filter((type) => type.startsWith("sidecar"))).toEqual([]);
    }, 30_000);

    it("prepareRun sidecar 多轮 transcript parent 不会被 savePoint write 覆盖", async () => {
        harness.tools.register({
            key: "sidecar_save_point_state",
            name: "sidecar_save_point_state",
            label: "Sidecar Save Point State",
            description: "Writes custom state from sidecar.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "missing context"}],
                    details: {},
                    terminate: false,
                };
            },
            async executeWithContext(context) {
                context.sessionWrites?.savePointCustomState("test.sidecar.savePointState", "test.sidecar.savePoint", "queued");
                return {
                    content: [{type: "text", text: "queued"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-savepoint-parent",
                name: "Sidecar SavePoint Parent",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "sidecar_save_point_state"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result", "sidecar_save_point_state"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("sidecar_save_point_state", {}, {id: "sidecar-savepoint"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "loaded",
                    data: {
                        "actor.context-load": {
                            context: "ok",
                        },
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-savepoint-parent",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarToolResult = snapshot.entries.find((entry) => {
            return entry.type === "message"
                && entry.message.role === "toolResult"
                && entry.message.toolName === "sidecar_save_point_state";
        });
        const sidecarSavePointEntry = snapshot.entries.find((entry) => {
            return entry.type === "custom" && entry.key === "test.sidecar.savePoint";
        });
        const sidecarReportAssistant = snapshot.entries.find((entry) => {
            return entry.type === "message"
                && entry.message.role === "assistant"
                && entry.message.content.some((block) => block.type === "toolCall" && block.id === "sidecar-report");
        });

        expect(result.status).toBe("completed");
        expect(sidecarToolResult).toEqual(expect.objectContaining({type: "message"}));
        expect(sidecarSavePointEntry).toEqual(expect.objectContaining({type: "custom"}));
        expect(sidecarReportAssistant).toEqual(expect.objectContaining({type: "message"}));
        expect(sidecarReportAssistant?.parentId).toBe(sidecarToolResult?.id);
        expect(sidecarReportAssistant?.parentId).not.toBe(sidecarSavePointEntry?.id);
    }, 30_000);

    it("prepareRun sidecar 可以持久化注入主 run context", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-persisted-context-load",
                name: "Sidecar Persisted Context Load",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "检索并整理本轮 actor 可知设定。",
                merge(_ctx, result) {
                    const sidecarData = result.sidecarData as {context: string};
                    return {
                        persistedMessages: [
                            createUserMessage({text: `PERSISTED_ACTOR_SAFE_CONTEXT:${sidecarData.context}`}),
                        ],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "loaded",
                    data: {
                        "actor.context-load": {
                            context: "SAFE_LORE",
                        },
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxText("main done"),
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-persisted-context-load",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(snapshot);
        const sidecarEntry = snapshot.entries.find((entry) => {
            return entry.type === "message" && messageText(entry.message).includes("PERSISTED_ACTOR_SAFE_CONTEXT:SAFE_LORE");
        });

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("PERSISTED_ACTOR_SAFE_CONTEXT:SAFE_LORE");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "user", "assistant", "toolResult"]);
        expect(visibleMessageText(context.messages)).toContain("PERSISTED_ACTOR_SAFE_CONTEXT:SAFE_LORE");
        expect(sidecarEntry).toEqual(expect.objectContaining({
            type: "message",
            origin: "harness",
        }));
        expect(visibleMessageText(context.messages)).not.toContain("loaded");
    }, 30_000);

    it("prepareRun sidecar 同时支持 runtime-only 和 persisted 注入", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-mixed-context-load",
                name: "Sidecar Mixed Context Load",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({}),
                enterPrompt: "检索并整理本轮 actor 可知设定。",
                merge() {
                    return {
                        persistedMessages: [
                            createUserMessage({text: "PERSISTED_CONTEXT"}),
                        ],
                        runtimeMessages: [
                            createUserMessage({text: "RUNTIME_ONLY_CONTEXT"}),
                        ],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "loaded",
                    data: {
                        "actor.context-load": {},
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("main done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-mixed-context-load",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const mainPrompt = providerPrompts[0];

        expect(result.status).toBe("completed");
        expect(mainPrompt).toBeDefined();
        if (!mainPrompt) {
            throw new Error("缺少 main run prompt。");
        }
        expect(mainPrompt).toContain("PERSISTED_CONTEXT");
        expect(mainPrompt).toContain("RUNTIME_ONLY_CONTEXT");
        expect(mainPrompt.indexOf("PERSISTED_CONTEXT")).toBeLessThan(mainPrompt.indexOf("RUNTIME_ONLY_CONTEXT"));
        expect(visibleMessageText(context.messages)).toContain("PERSISTED_CONTEXT");
        expect(visibleMessageText(context.messages)).not.toContain("RUNTIME_ONLY_CONTEXT");
    }, 30_000);

    it("prepareRun 多个 sidecar 持久化注入时不会冲掉先前 runtime-only 注入", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-runtime-before-persisted-context",
                name: "Sidecar Runtime Before Persisted Context",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [
                {
                    name: "actor.runtime-context-load",
                    stage: "prepareRun",
                    allowedToolKeys: ["report_result"],
                    sidecarDataSchema: Type.Object({}),
                    enterPrompt: "注入本轮 runtime-only 设定。",
                    merge() {
                        return {
                            runtimeMessages: [
                                createUserMessage({text: "FIRST_RUNTIME_ONLY_CONTEXT"}),
                            ],
                        };
                    },
                },
                {
                    name: "actor.persisted-context-load",
                    stage: "prepareRun",
                    allowedToolKeys: ["report_result"],
                    sidecarDataSchema: Type.Object({}),
                    enterPrompt: "注入本轮 persisted 设定。",
                    merge() {
                        return {
                            persistedMessages: [
                                createUserMessage({text: "SECOND_PERSISTED_CONTEXT"}),
                            ],
                        };
                    },
                },
            ],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "runtime loaded",
                    data: {
                        "actor.runtime-context-load": {},
                    },
                }, {id: "runtime-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "persisted loaded",
                    data: {
                        "actor.persisted-context-load": {},
                    },
                }, {id: "persisted-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("main done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-runtime-before-persisted-context",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const mainPrompt = providerPrompts[0];

        expect(result.status).toBe("completed");
        expect(mainPrompt).toBeDefined();
        if (!mainPrompt) {
            throw new Error("缺少 main run prompt。");
        }
        expect(mainPrompt).toContain("FIRST_RUNTIME_ONLY_CONTEXT");
        expect(mainPrompt).toContain("SECOND_PERSISTED_CONTEXT");
        expect(mainPrompt.indexOf("SECOND_PERSISTED_CONTEXT")).toBeLessThan(mainPrompt.indexOf("FIRST_RUNTIME_ONLY_CONTEXT"));
        expect(visibleMessageText(context.messages)).not.toContain("FIRST_RUNTIME_ONLY_CONTEXT");
        expect(visibleMessageText(context.messages)).toContain("SECOND_PERSISTED_CONTEXT");
    }, 30_000);

    it("settleRun sidecar 可以在主 run 后执行并写入 merge writePlans", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-memory-save",
                name: "Sidecar Memory Save",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.memory-save",
                stage: "settleRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    summary: Type.String(),
                }),
                enterPrompt: (ctx) => `保存本轮 actor 记忆。主结果：${ctx.runResult?.reportResult?.result ?? ""}`,
                merge(ctx, result) {
                    return {
                        writePlans: [{
                            target: {sessionId: ctx.sessionId},
                            cause: "test.sidecar.memory-save",
                            ops: [{
                                kind: "append",
                                projection: true,
                                entry: {
                                    type: "custom",
                                    key: "test.sidecar.memory",
                                    value: result.sidecarData,
                                },
                            }],
                        }],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("main done"),
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                expect(visibleMessageText(context.messages)).toContain("主结果：main");
                return fauxAssistantMessage([
                    fauxToolCall("report_sidecar_result", {
                        result: "saved",
                        data: {
                            "actor.memory-save": {
                                summary: "memory saved",
                            },
                        },
                    }, {id: "memory-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-memory-save",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(context.customState["test.sidecar.memory"]).toEqual({
            summary: "memory saved",
        });
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(visibleMessageText(context.messages)).not.toContain("saved");
    }, 30_000);

    it("settleRun sidecar 返回非法 runtimeMessages 时不会先写 persistedMessages", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-invalid-settle-merge",
                name: "Sidecar Invalid Settle Merge",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.memory-save",
                stage: "settleRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({}),
                enterPrompt: "保存本轮 actor 记忆。",
                merge() {
                    return {
                        persistedMessages: [
                            createUserMessage({text: "SHOULD_NOT_BE_WRITTEN"}),
                        ],
                        runtimeMessages: [
                            createUserMessage({text: "INVALID_RUNTIME_MESSAGE"}),
                        ],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            () => fauxAssistantMessage([
                fauxText("main done"),
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
            () => fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "saved",
                    data: {
                        "actor.memory-save": {},
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-invalid-settle-merge",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("runtimeMessages 只能在 prepareRun");
        expect(visibleMessageText(context.messages)).not.toContain("SHOULD_NOT_BE_WRITTEN");
    }, 30_000);

    it("simulator.actor 会通过 context-load 注入 actor-safe 设定，并通过 memory-save 更新 events/memory/mind", async () => {
        const profiles = new AgentProfileCatalog(
            join(root, "missing-system-profiles"),
            join(root, "missing-user-profiles"),
        );
        profiles.register(simulatorActorProfile, false);
        const rpHarness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles,
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const projectSlug = `rp-project-${randomUUID()}`;
        const actorRoot = join(root, projectSlug, "simulation", "subjects", "heroine");
        rpHarness.tools.register({
            key: "subject_rag_search",
            name: "subject_rag_search",
            label: "Search Subject RAG",
            executionMode: "parallel",
            description: "test subject rag search",
            parameters: Type.Object({}),
            async executeWithContext() {
                return {
                    content: [{type: "text", text: "RAG: 她知道这块五彩石被一些传闻称为世界之心。"}],
                    details: {
                        candidates: [{
                            source: "memory",
                            text: "她知道这块五彩石被一些传闻称为世界之心。",
                            topic: "世界之心",
                            rank: 1,
                            sourcePath: "memory.jsonl",
                        }],
                    },
                };
            },
            async execute() {
                throw new Error("test only");
            },
        });
        rpHarness.tools.register({
            key: "subject_event_append",
            name: "subject_event_append",
            label: "Append Subject Events",
            executionMode: "sequential",
            description: "test subject event append",
            parameters: Type.Object({}),
            async executeWithContext() {
                await writeFile(join(actorRoot, "events.jsonl"), [
                    "{\"text\":\"她刚抵达学院区广场。\"}",
                    "{\"text\":\"主角把一块疑似被称为世界之心的五彩石交给了她。\"}",
                    "",
                ].join("\n"), "utf-8");
                return {
                    content: [{type: "text", text: "appended event"}],
                    details: {appended: 1},
                };
            },
            async execute() {
                throw new Error("test only");
            },
        });
        rpHarness.tools.register({
            key: "subject_memory_update",
            name: "subject_memory_update",
            label: "Curate Subject Memory",
            executionMode: "sequential",
            description: "test subject memory update",
            parameters: Type.Object({}),
            async executeWithContext() {
                await writeFile(join(actorRoot, "memory.jsonl"), "{\"topic\":\"世界之心\",\"view\":\"我知道主角把一块疑似被称为世界之心的五彩石交给了我，但我不知道它的隐藏真相。\"}\n", "utf-8");
                return {
                    content: [{type: "text", text: "curated memory"}],
                    details: {status: "updated"},
                };
            },
            async execute() {
                throw new Error("test only");
            },
        });
        await mkdir(actorRoot, {recursive: true});
        await mkdir(join(root, projectSlug, "lorebook", "world"), {recursive: true});
        await writeFile(join(actorRoot, "soul.md"), "我会保持礼貌但警惕，遇到未知物品会先询问来源。\n", "utf-8");
        await writeFile(join(actorRoot, "subject.md"), "保持礼貌但警惕，遇到未知物品会先询问来源。", "utf-8");
        await writeFile(join(actorRoot, "events.jsonl"), "{\"text\":\"她刚抵达学院区广场。\"}\n", "utf-8");
        await writeFile(join(actorRoot, "memory.jsonl"), "{\"topic\":\"世界之心\",\"view\":\"她不知道世界之心的真名。\"}\n", "utf-8");
        await writeFile(join(actorRoot, "mind.md"), "她正在判断主角的用意。\n", "utf-8");
        await writeFile(join(actorRoot, "state.md"), "她位于学院区广场边缘，状态正常。\n", "utf-8");
        await writeFile(join(root, projectSlug, "lorebook", "world", "world-heart.md"), "世界之心公开表现为五彩石，隐藏真相是旧神核心。", "utf-8");
        const providerPrompts: string[] = [];

        faux.setResponses([
            (context) => {
                const promptText = visibleMessageText(context.messages);
                providerPrompts.push(promptText);
                expect(promptText).toContain("sidecar: actor.context-load");
                expect(promptText).toContain("五彩缤纷的石头");
                expect(promptText).toContain("memoryPath");
                expect(promptText).not.toContain("她不知道世界之心的真名");
                return fauxAssistantMessage([
                    fauxToolCall("subject_rag_search", {
                        subjectPath: "simulation/subjects/heroine",
                        query: "五彩缤纷的石头 世界之心",
                        sources: ["events"],
                    }, {id: "context-rag"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                const promptText = visibleMessageText(context.messages);
                providerPrompts.push(promptText);
                expect(promptText).toContain("RAG: 她知道这块五彩石被一些传闻称为世界之心。");
                return fauxAssistantMessage([
                    fauxToolCall("report_sidecar_result", {
                        result: "你知道这块五彩石被一些传闻称为世界之心，但不知道它的隐藏真相。",
                        data: {
                            "actor.context-load": {},
                        },
                    }, {id: "context-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                const promptText = visibleMessageText(context.messages);
                providerPrompts.push(promptText);
                expect(promptText).toContain("<actor-sidecar-context source=\"actor.context-load\">");
                expect(promptText).toContain("被一些传闻称为世界之心");
                expect(promptText).not.toContain("旧神核心隐藏真相");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "actor responded",
                        data: {
                            visible_response: "她垂眸看向掌心的五彩石，指尖微微收紧。",
                            spoken_dialogue: "这是什么？你从哪里得到它的？",
                            inner_response: "她想先确认石头来源，再决定是否交还。",
                        },
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                const promptText = visibleMessageText(context.messages);
                providerPrompts.push(promptText);
                expect(promptText).toContain("sidecar: actor.memory-save");
                expect(promptText).toContain("世界的状态（state.md）由上级裁决");
                return fauxAssistantMessage([
                    fauxToolCall("subject_event_append", {
                        subjectPath: "simulation/subjects/heroine",
                        events: [{
                            text: "主角把一块疑似被称为世界之心的五彩石交给了她。",
                        }],
                    }, {id: "memory-append-event"}),
                    fauxToolCall("subject_memory_update", {
                        subjectPath: "simulation/subjects/heroine",
                        facts: ["主角把一块疑似被称为世界之心的五彩石交给了她。", "她仍不知道隐藏真相。"],
                    }, {id: "subject-memory-update"}),
                    fauxToolCall("edit", {
                        path: "simulation/subjects/heroine/mind.md",
                        edits: [{
                            oldText: "她正在判断主角的用意。\n",
                            newText: "她正在判断主角的用意。\n她开始怀疑主角知道更多内情，但暂时不追问过深。\n",
                        }],
                    }, {id: "memory-edit-mind"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "memory saved",
                    data: {
                        "actor.memory-save": {},
                    },
                }, {id: "memory-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await rpHarness.createAgent({
            profileKey: "simulator.actor",
            initial: {
                subjectPath: "simulation/subjects/heroine",
                kind: "npc",
            },
            workspaceRoot: "workspace",
            projectPath: `workspace/${projectSlug}`,
        });

        const result = await rpHarness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "主角把一块五彩缤纷的石头交到你手里。石头隐约有异常力量感。"},
        });
        const snapshot = await rpHarness.repo.readSession(created.sessionId);
        const context = rpHarness.repo.reduce(snapshot);
        const events = await readFile(join(actorRoot, "events.jsonl"), "utf-8");
        const memory = await readFile(join(actorRoot, "memory.jsonl"), "utf-8");
        const mind = await readFile(join(actorRoot, "mind.md"), "utf-8");
        const state = await readFile(join(actorRoot, "state.md"), "utf-8");
        const visibleText = visibleMessageText(context.messages);
        const sidecarContextEntry = snapshot.entries.find((entry) => {
            return entry.type === "message" && messageText(entry.message).includes("<actor-sidecar-context");
        });
        const sidecarContextEntries = snapshot.entries.filter((entry) => {
            return entry.type === "message" && messageText(entry.message).includes("<actor-sidecar-context source=\"actor.context-load\">");
        });
        const sidecarTranscriptEntries = snapshot.entries.filter((entry) => {
            return entry.type === "message" && messageText(entry.message).includes("sidecar: actor.context-load");
        });

        await rpHarness.dispose();
        await closeProjectForTest(`workspace/${projectSlug}`).catch(() => undefined);
        await rm(join(root, projectSlug), {recursive: true, force: true});
        expect(result.status, result.error ?? result.errorInfo?.message).toBe("completed");
        expect(result.reportResult?.data).toEqual(expect.objectContaining({
            spoken_dialogue: "这是什么？你从哪里得到它的？",
        }));
        expect(providerPrompts).toHaveLength(4);
        expect(events).toContain("疑似被称为世界之心的五彩石");
        expect(memory).toContain("疑似被称为世界之心的五彩石");
        expect(mind).toContain("怀疑主角知道更多内情");
        expect(state).toBe("她位于学院区广场边缘，状态正常。\n");
        expect(context.messages.map((message) => message.role).slice(-2)).toEqual(["assistant", "toolResult"]);
        expect(sidecarContextEntries).toHaveLength(1);
        expect(sidecarContextEntry).toEqual(expect.objectContaining({
            type: "message",
            origin: "harness",
        }));
        expect(sidecarTranscriptEntries).toHaveLength(1);
        expect(visibleText).toContain("<actor-sidecar-context");
        expect(visibleText).not.toContain("loaded actor-safe lore");
        expect(visibleText).not.toContain("memory saved");
        expect(visibleText).not.toContain("旧神核心");
        expect(context.messages.at(-1)?.role).toBe("toolResult");
        expect(messageText(context.messages.at(-1) as RuntimeMessage)).not.toContain("<actor-sidecar-context");
    });

    it("report_sidecar_result.data 不符合 schema 时返回工具错误并允许同 run 修正", async () => {
        let observedSidecarData: {context: string} | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-schema-failure",
                name: "Sidecar Schema Failure",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {context: string};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad",
                    data: {
                        "actor.context-load": {
                            context: 1,
                        },
                    },
                }, {id: "bad-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "fixed",
                    data: {
                        "actor.context-load": {
                            context: "已加载 actor 可知上下文。",
                        },
                    },
                }, {id: "fixed-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-schema-failure",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarErrorText = snapshot.entries
            .filter((entry) => entry.type === "message")
            .map((entry) => messageText(entry.message))
            .join("\n");

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.context).toBe("已加载 actor 可知上下文。");
        expect(sidecarErrorText).toContain("report_sidecar_result.data");
        expect(sidecarErrorText).toContain("/context：must be string");
        expect(sidecarErrorText).not.toMatch(/校验失败：Parse(?:\.|\s|$)/);
    }, 30_000);

    it("report_sidecar_result.data 不是当前 sidecar key 时返回工具错误并允许同 run 修正", async () => {
        let observedSidecarData: {context: string} | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-missing-key",
                name: "Sidecar Missing Key",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {context: string};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad",
                    data: {
                        "actor.other": {
                            context: "错误 key。",
                        },
                    },
                }, {id: "bad-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "fixed",
                    data: {
                        "actor.context-load": {
                            context: "已加载 actor 可知上下文。",
                        },
                    },
                }, {id: "fixed-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-missing-key",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarErrorText = snapshot.entries
            .filter((entry) => entry.type === "message")
            .map((entry) => messageText(entry.message))
            .join("\n");

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.context).toBe("已加载 actor 可知上下文。");
        expect(sidecarErrorText).toContain("只能包含当前 sidecar key \"actor.context-load\"");
    }, 30_000);

    it("report_sidecar_result.data 缺少当前 sidecar key 时返回工具错误并允许同 run 修正", async () => {
        let observedSidecarData: {context: string} | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-missing-discriminator",
                name: "Sidecar Missing Discriminator",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {context: string};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad",
                    data: {
                        wrong: {
                            context: "缺少 sidecar。",
                        },
                    },
                }, {id: "bad-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "fixed",
                    data: {
                        "actor.context-load": {
                            context: "已加载 actor 可知上下文。",
                        },
                    },
                }, {id: "fixed-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-missing-discriminator",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarErrorText = snapshot.entries
            .filter((entry) => entry.type === "message")
            .map((entry) => messageText(entry.message))
            .join("\n");

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.context).toBe("已加载 actor 可知上下文。");
        expect(sidecarErrorText).toContain("只能包含当前 sidecar key \"actor.context-load\"");
    }, 30_000);

    it("report_sidecar_result.data 同时含多个 sidecar key 时返回工具错误并允许同 run 修正", async () => {
        let observedSidecarData: {context: string} | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-extra-data-field",
                name: "Sidecar Extra Data Field",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {context: string};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad",
                    data: {
                        "actor.context-load": {
                            context: "额外字段。",
                        },
                        "actor.other": {
                            context: "多余 key。",
                        },
                    },
                }, {id: "bad-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "fixed",
                    data: {
                        "actor.context-load": {
                            context: "已加载 actor 可知上下文。",
                        },
                    },
                }, {id: "fixed-sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-extra-data-field",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarErrorText = snapshot.entries
            .filter((entry) => entry.type === "message")
            .map((entry) => messageText(entry.message))
            .join("\n");

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.context).toBe("已加载 actor 可知上下文。");
        expect(sidecarErrorText).toContain("只能包含一个 sidecar key");
    }, 30_000);

    it("object report_sidecar_result.data 被模型包成 schema 字符串时返回工具错误并等待直接对象", async () => {
        let observedSidecarData: {changed_files: string[]} | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-schema-string-wrapper",
                name: "Sidecar Schema String Wrapper",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.memory-save",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    changed_files: Type.Array(Type.String()),
                    events_summary: Type.String(),
                    memory_summary: Type.String(),
                    mind_summary: Type.String(),
                    skipped: Type.Array(Type.String()),
                    needs_review: Type.Array(Type.String()),
                }),
                enterPrompt: "保存记忆。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {changed_files: string[]};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "saved",
                    data: JSON.stringify({
                        type: "object",
                        required: ["changed_files", "events_summary", "memory_summary", "mind_summary", "skipped", "needs_review"],
                        properties: {
                            changed_files: ["subject/events.jsonl"],
                            events_summary: "追加经历。",
                            memory_summary: "",
                            mind_summary: "",
                            skipped: [],
                            needs_review: [],
                        },
                    }),
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "saved",
                    data: {
                        "actor.memory-save": {
                            changed_files: ["subject/events-fixed.jsonl"],
                            events_summary: "追加经历。",
                            memory_summary: "",
                            mind_summary: "",
                            skipped: [],
                            needs_review: [],
                        },
                    },
                }, {id: "sidecar-report-fixed"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-schema-string-wrapper",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.changed_files).toEqual(["subject/events-fixed.jsonl"]);
    }, 30_000);

    it("object report_sidecar_result.data 被模型包成字符串时返回工具错误并允许同 run 修正", async () => {
        let observedSidecarData: {changed_files: string[]; memory_summary: string} | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-data-tool-error",
                name: "Sidecar Data Tool Error",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.memory-save",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    changed_files: Type.Array(Type.String()),
                    events_summary: Type.String(),
                    memory_summary: Type.String(),
                    mind_summary: Type.String(),
                    skipped: Type.Array(Type.String()),
                    needs_review: Type.Array(Type.String()),
                }),
                enterPrompt: "保存记忆。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {changed_files: string[]; memory_summary: string};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "saved",
                    data: JSON.stringify({
                        changed_files: ["subject/events.jsonl"],
                        events_summary: "追加经历。",
                        memory_summary: "更新同行者 topic。",
                        mind_summary: "更新心理状态。",
                        skipped: [],
                        needs_review: [],
                    }),
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "saved",
                    data: {
                        "actor.memory-save": {
                            changed_files: ["subject/events.jsonl"],
                            events_summary: "追加经历。",
                            memory_summary: "更新同行者 topic。",
                            mind_summary: "更新心理状态。",
                            skipped: [],
                            needs_review: [],
                        },
                    },
                }, {id: "sidecar-report-fixed"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-data-tool-error",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const sidecarErrorText = snapshot.entries
            .filter((entry) => entry.type === "message")
            .map((entry) => messageText(entry.message))
            .join("\n");

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.changed_files).toEqual(["subject/events.jsonl"]);
        expect(observedSidecarData?.memory_summary).toContain("更新同行者 topic");
        expect(sidecarErrorText).toContain("收到的是字符串");
    }, 30_000);

    it("sidecar report_sidecar_result 连续失败 3 次后保留真实工具错误", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-report-error-limit",
                name: "Sidecar Report Error Limit",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.memory-save",
                stage: "settleRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    changed_files: Type.Array(Type.String()),
                    events_summary: Type.String(),
                    memory_summary: Type.String(),
                    mind_summary: Type.String(),
                    skipped: Type.Array(Type.String()),
                    needs_review: Type.Array(Type.String()),
                }),
                enterPrompt: "保存记忆。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        const stringifiedResult = JSON.stringify({
            changed_files: ["subject/events.jsonl"],
            events_summary: "追加经历。",
            memory_summary: "",
            mind_summary: "",
            skipped: [],
            needs_review: [],
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad-1",
                    data: stringifiedResult,
                }, {id: "sidecar-bad-report-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad-2",
                    data: stringifiedResult,
                }, {id: "sidecar-bad-report-2"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "bad-3",
                    data: stringifiedResult,
                }, {id: "sidecar-bad-report-3"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-report-error-limit",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("sidecar actor.memory-save 执行失败");
        expect(result.error).toContain("report_sidecar_result 连续失败 3 次");
        expect(result.error).toContain("report_sidecar_result.data 校验失败");
        expect(result.error).toContain("收到的是字符串");
        expect(result.error).not.toContain("没有返回 report_sidecar_result.data");
    }, 30_000);

    it("sidecar 错用 report_result 连续失败时按期望结果工具名收口", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-wrong-result-tool-limit",
                name: "Sidecar Wrong Result Tool Limit",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "wrong-1",
                    data: {context: "bad"},
                }, {id: "wrong-report-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "wrong-2",
                    data: {context: "bad"},
                }, {id: "wrong-report-2"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "wrong-3",
                    data: {context: "bad"},
                }, {id: "wrong-report-3"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-wrong-result-tool-limit",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("sidecar actor.context-load 执行失败");
        expect(result.error).toContain("report_sidecar_result 连续失败 3 次");
        expect(result.error).toContain("不能使用 report_result");
    }, 30_000);

    it("sidecar 缺少 report_sidecar_result 时复用现有 reminder 并继续收集结果", async () => {
        let observedSidecarData: {context: string} | undefined;
        const sidecarPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-report-reminder",
                name: "Sidecar Report Reminder",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge(_ctx, result) {
                    observedSidecarData = result.sidecarData as {context: string};
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                sidecarPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("plain sidecar answer");
            },
            (context) => {
                sidecarPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("report_sidecar_result", {
                        result: "loaded",
                        data: {
                            "actor.context-load": {
                                context: "已加载 actor 可知上下文。",
                            },
                        },
                    }, {id: "sidecar-report-after-reminder"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-report-reminder",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedSidecarData?.context).toBe("已加载 actor 可知上下文。");
        expect(sidecarPrompts[1]).toContain("必须使用 report_sidecar_result");
    }, 30_000);

    it("outputFallback sidecar 的 reminder 不要求调用 report_sidecar_result", async () => {
        const reminder = (harness as unknown as {
            sidecarReminder(pass: SidecarProfilePass, context: never, executionToolKeys: readonly string[]): string;
        }).sidecarReminder({
            name: "actor.context-load",
            stage: "prepareRun",
            sidecarDataSchema: Type.String(),
            outputFallback: "final_message_as_result",
            enterPrompt: "加载上下文。",
            merge() {
                return {};
            },
        }, {} as never, []);

        expect(reminder).toContain("当前旁路未开放 report_sidecar_result");
        expect(reminder).not.toContain("完成旁路后优先调用 report_sidecar_result");
        expect(reminder).not.toContain("report_sidecar_result.data 期望结构");
    });

    it("非空 object sidecar reminder 不把 keyed data 示例写成空对象", () => {
        const reminder = (harness as unknown as {
            sidecarReminder(pass: SidecarProfilePass, context: never, executionToolKeys: readonly string[]): string;
        }).sidecarReminder({
            name: "actor.memory-save",
            stage: "settleRun",
            sidecarDataSchema: Type.Object({
                changed_files: Type.Array(Type.String()),
            }),
            enterPrompt: "保存记忆。",
            merge() {
                return {};
            },
        }, {} as never, ["report_sidecar_result"]);

        expect(reminder).toContain("\"actor.memory-save\": <按下方 schema 填写的 JSON object>");
        expect(reminder).toContain("report_sidecar_result.data[\"actor.memory-save\"] 的 schema");
        expect(reminder).not.toContain("\"actor.memory-save\": {}");
    });

    it("profile 自带工具可见并可执行", async () => {
        let observedToolNames: string[] = [];
        let executedText = "";
        const profileEcho = defineProfileTool({
            key: "profile_echo",
            name: "profile_echo",
            label: "Profile Echo",
            description: "Echo text from a profile-private tool.",
            parameters: Type.Object({
                text: Type.String(),
            }),
            async executeWithContext(_context, _toolCallId, params: unknown) {
                const input = Value.Parse(Type.Object({text: Type.String()}), params);
                executedText = input.text;
                return {
                    content: [{type: "text", text: `echo:${input.text}`}],
                    details: input,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.profile-private-tool",
                name: "Profile Private Tool",
            },
            initialSchema: Type.Object({}),
            tools: toolset(
                profileEcho,
                builtin.result.main(),
            ),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolNames = (context.tools ?? []).map((tool) => tool.name);
                return fauxAssistantMessage([
                    fauxToolCall("profile_echo", {
                        text: "hello",
                    }, {id: "profile-echo"}),
                    fauxToolCall("report_result", {
                        result: "done",
                    }, {id: "report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.profile-private-tool",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedToolNames).toEqual(expect.arrayContaining(["profile_echo", "report_result"]));
        expect(executedText).toBe("hello");
    }, 20_000);

    it("profile 自带工具通过 bind 覆盖描述后仍可见并可执行", async () => {
        let observedToolDescription = "";
        let executed = false;
        const bindEcho = defineProfileTool({
            key: "bind_echo",
            name: "bind_echo",
            label: "Bind Echo",
            description: "Original private description.",
            parameters: Type.Object({}),
            async executeWithContext() {
                executed = true;
                return {
                    content: [{type: "text", text: "bind ok"}],
                    details: {ok: true},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.profile-private-tool-bind",
                name: "Profile Private Tool Bind",
            },
            initialSchema: Type.Object({}),
            tools: toolset(
                bindEcho.bind({description: "Profile override description."}),
                builtin.result.main(),
            ),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolDescription = (context.tools ?? []).find((tool) => tool.name === "bind_echo")?.description ?? "";
                return fauxAssistantMessage([
                    fauxToolCall("bind_echo", {}, {id: "bind-echo"}),
                    fauxToolCall("report_result", {
                        result: "done",
                    }, {id: "report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.profile-private-tool-bind",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedToolDescription).toBe("Profile override description.");
        expect(executed).toBe(true);
    }, 20_000);

    it("profile 自带工具同名时只覆盖当前 profile", async () => {
        let globalExecutions = 0;
        let privateExecutions = 0;
        harness.tools.register({
            key: "shadow_tool",
            name: "shadow_tool",
            label: "Shadow Tool",
            description: "Global shadow tool.",
            parameters: Type.Object({}),
            async execute() {
                globalExecutions += 1;
                return {
                    content: [{type: "text", text: "global"}],
                    details: {source: "global"},
                    terminate: true,
                };
            },
        });
        const privateShadowTool = defineProfileTool({
            key: "shadow_tool",
            name: "shadow_tool",
            label: "Private Shadow Tool",
            description: "Profile-private shadow tool.",
            parameters: Type.Object({}),
            async executeWithContext() {
                privateExecutions += 1;
                return {
                    content: [{type: "text", text: "private"}],
                    details: {source: "private"},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.private-shadow", name: "Private Shadow"},
            initialSchema: Type.Object({}),
            tools: toolset(
                privateShadowTool,
            ),
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.global-shadow", name: "Global Shadow"},
            initialSchema: Type.Object({}),
            tools: toolset(
                pluginTool("shadow_tool"),
            ),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("shadow_tool", {}, {id: "private-shadow-call"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("shadow_tool", {}, {id: "global-shadow-call"}),
            ], {stopReason: "toolUse"}),
        ]);
        const privateSession = await harness.createAgent({profileKey: "test.private-shadow", initial: {}, workspaceRoot: root});
        const globalSession = await harness.createAgent({profileKey: "test.global-shadow", initial: {}, workspaceRoot: root});

        await harness.invokeAgent({sessionId: privateSession.sessionId, mode: "prompt", message: {text: "private"}});
        await harness.invokeAgent({sessionId: globalSession.sessionId, mode: "prompt", message: {text: "global"}});

        expect(privateExecutions).toBe(1);
        expect(globalExecutions).toBe(1);
    }, 20_000);

    it("registered 引用缺失工具时 provider 不可见，执行时返回工具错误", async () => {
        let observedToolNames: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.missing-registered-tool",
                name: "Missing Registered Tool",
            },
            initialSchema: Type.Object({}),
            tools: toolset(
                pluginTool("missing_plugin"),
            ),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolNames = (context.tools ?? []).map((tool) => tool.name);
                return fauxAssistantMessage([
                    fauxToolCall("missing_plugin", {}, {id: "missing-plugin"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.missing-registered-tool",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedToolNames).not.toContain("missing_plugin");
        expect(visibleMessageText(context.messages)).toContain("Tool missing_plugin not found");
    }, 20_000);

    it("profile 自带审批工具可以 suspend 并通过 resolution 恢复", async () => {
        let privateApprovalExecuted = false;
        const privateApproval = defineProfileTool({
            key: "private_approval",
            name: "private_approval",
            label: "Private Approval",
            description: "Profile-private approval gate.",
            approvalRequired: true,
            parameters: Type.Object({
                reason: Type.String(),
            }),
            async executeWithContext() {
                privateApprovalExecuted = true;
                return {
                    content: [{type: "text", text: "should not execute"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.private-approval",
                name: "Private Approval",
            },
            initialSchema: Type.Object({}),
            tools: toolset(
                privateApproval,
                builtin.result.main(),
            ),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("private_approval", {
                    reason: "needs confirmation",
                }, {id: "private-approval-call"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "approved done",
                }, {id: "approval-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const owner = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const created = await harness.createAgent({
            profileKey: "test.private-approval",
            initial: {},
            workspaceRoot: root,
            parentSessionId: owner.sessionId,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const waitingSummary = await harness.getAgent(created.sessionId);
        const waitingOwned = await harness.getAgent(undefined, owner.sessionId);
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "tool_approval",
                toolCallId: "private-approval-call",
                approved: true,
                resultText: "Approved private tool.",
            },
        });

        expect(waiting.status).toBe("waiting");
        expect(waitingSummary).toEqual(expect.objectContaining({status: "waiting"}));
        expect(waitingOwned).toEqual([expect.objectContaining({sessionId: created.sessionId, status: "waiting"})]);
        expect(continued.status).toBe("completed");
        await expect(harness.getAgent(created.sessionId)).resolves.toEqual(expect.objectContaining({status: "idle"}));
        await expect(harness.getAgent(undefined, owner.sessionId)).resolves.toEqual([
            expect.objectContaining({sessionId: created.sessionId, status: "idle"}),
        ]);
        expect(continued.reportResult?.result).toBe("approved done");
        expect(privateApprovalExecuted).toBe(false);
    }, 20_000);

    it("工具预授权拒绝发生在 userInputRequest 之前且不会创建 pending", async () => {
        let inputRequirementChecked = false;
        let executed = false;
        const guardedTool = defineProfileTool({
            key: "guarded_user_input",
            name: "guarded_user_input",
            label: "Guarded User Input",
            description: "Authorization must run before a user input request is created.",
            parameters: Type.Object({op: Type.Literal("restricted")}, {additionalProperties: false}),
            authorize() {
                throw new Error("当前 profile 无权执行 restricted");
            },
            userInputRequest: {
                when() {
                    inputRequirementChecked = true;
                    return true;
                },
            },
            async executeWithContext() {
                executed = true;
                return {content: [{type: "text", text: "unexpected"}], details: {}};
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.pre-authorization", name: "Pre Authorization"},
            initialSchema: Type.Object({}),
            tools: toolset(guardedTool, builtin.result.main()),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("guarded_user_input", {op: "restricted"}, {id: "guarded-user-input-call"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "permission handled"}, {id: "guarded-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.pre-authorization",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const state = await harness.getSessionLiveState(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult?.result).toBe("permission handled");
        expect(inputRequirementChecked).toBe(false);
        expect(executed).toBe(false);
        expect(state.pendingUserInputs).toEqual([]);
        expect(state.activeInvocation).toBeNull();
        expect(visibleMessageText(context.messages)).toContain("当前 profile 无权执行 restricted");
    }, 20_000);

    it("sidecar 保持 profile 最大工具 schema 可见，但执行权限使用旁路子集", async () => {
        const observedToolNames: string[][] = [];
        const observedReportSidecarSchemas: unknown[] = [];
        harness.tools.register({
            key: "sidecar_extra",
            name: "sidecar_extra",
            label: "Sidecar Extra",
            description: "Should be visible but not executable in sidecar.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "extra"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-tool-policy",
                name: "Sidecar Tool Policy",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "sidecar_extra"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                observedReportSidecarSchemas.push((context.tools ?? []).find((tool) => tool.name === "report_sidecar_result")?.parameters);
                const promptText = visibleMessageText(context.messages);
                expect(promptText).toContain("allowed tools: report_sidecar_result");
                expect(promptText).toContain("provider-visible tool schema 仍保持 profile 最大工具集合");
                return fauxAssistantMessage([
                    fauxToolCall("report_sidecar_result", {
                        result: "loaded",
                        data: {
                            "actor.context-load": {
                                context: "ok",
                            },
                        },
                    }, {id: "sidecar-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                observedReportSidecarSchemas.push((context.tools ?? []).find((tool) => tool.name === "report_sidecar_result")?.parameters);
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-tool-policy",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedToolNames[0]).toEqual(expect.arrayContaining(["report_result", "sidecar_extra"]));
        expect(observedToolNames[1]).toEqual(expect.arrayContaining(["report_result", "sidecar_extra"]));
        expect(observedReportSidecarSchemas).toHaveLength(2);
        expect(observedReportSidecarSchemas[0]).toEqual(observedReportSidecarSchemas[1]);
    }, 20_000);

    it("主 run 可见 profile 最大工具 schema，但执行权限使用 mainRunAllowedToolKeys", async () => {
        const observedToolNames: string[][] = [];
        let mainForbiddenExecuted = false;
        harness.tools.register({
            key: "main_forbidden_extra",
            name: "main_forbidden_extra",
            label: "Main Forbidden Extra",
            description: "Visible to provider but not executable in main run.",
            parameters: Type.Object({}),
            async execute() {
                mainForbiddenExecuted = true;
                return {
                    content: [{type: "text", text: "extra"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.main-run-tool-policy",
                name: "Main Run Tool Policy",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "main_forbidden_extra"],
            mainRunAllowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                return fauxAssistantMessage([
                    fauxToolCall("main_forbidden_extra", {}, {id: "forbidden-main-extra"}),
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.main-run-tool-policy",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedToolNames[0]).toEqual(expect.arrayContaining(["report_result", "main_forbidden_extra"]));
        expect(mainForbiddenExecuted).toBe(false);
        expect(visibleMessageText(context.messages)).toContain("Tool main_forbidden_extra is not allowed by this profile");
    }, 20_000);

    it("主 run 执行权限同时受 mainRunAllowedToolKeys 和 prepareTurn toolKeysPatch 限制", async () => {
        const observedToolNames: string[][] = [];
        let reportExecuted = false;
        let patchedToolExecuted = false;
        harness.tools.register({
            key: "patched_visible_extra",
            name: "patched_visible_extra",
            label: "Patched Visible Extra",
            description: "Provider-visible root tool outside main run execution subset.",
            parameters: Type.Object({}),
            async execute() {
                patchedToolExecuted = true;
                return {
                    content: [{type: "text", text: "patched"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.tools.register({
            key: "main_report_gate",
            name: "main_report_gate",
            label: "Main Report Gate",
            description: "Allowed by mainRunAllowedToolKeys but removed by prepareTurn execution patch.",
            parameters: Type.Object({}),
            async execute() {
                reportExecuted = true;
                return {
                    content: [{type: "text", text: "main"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.main-run-tool-policy-with-patch",
                name: "Main Run Tool Policy With Patch",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["main_report_gate", "patched_visible_extra"],
            mainRunAllowedToolKeys: ["main_report_gate"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "patch-tools",
                        stage: "prepareTurn",
                        run() {
                            return {
                                turnSnapshotPatch: {
                                    toolKeys: ["patched_visible_extra"],
                                },
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                return fauxAssistantMessage([
                    fauxToolCall("patched_visible_extra", {}, {id: "patched-extra"}),
                    fauxToolCall("main_report_gate", {}, {id: "main-gate"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxText("blocked"),
            ], {stopReason: "stop"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.main-run-tool-policy-with-patch",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedToolNames[0]).toEqual(["main_report_gate", "patched_visible_extra"]);
        expect(reportExecuted).toBe(false);
        expect(patchedToolExecuted).toBe(false);
        expect(visibleMessageText(context.messages)).toContain("Tool patched_visible_extra is not allowed by this profile");
        expect(visibleMessageText(context.messages)).toContain("Tool main_report_gate is not allowed by this profile");
    }, 20_000);

    it("缺失结果 reminder 只在当前执行权限允许结果工具时注入", async () => {
        const observedToolNames: string[][] = [];
        let providerCalls = 0;
        harness.tools.register({
            key: "reminder_patch_extra",
            name: "reminder_patch_extra",
            label: "Reminder Patch Extra",
            description: "Runtime execution patch keeps only this non-result tool.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "extra"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.result-reminder-execution-policy",
                name: "Result Reminder Execution Policy",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "reminder_patch_extra"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "patch-tools",
                        stage: "prepareTurn",
                        run() {
                            return {
                                turnSnapshotPatch: {
                                    toolKeys: ["reminder_patch_extra"],
                                },
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerCalls += 1;
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                return fauxAssistantMessage("plain completion", {stopReason: "stop"});
            },
            () => {
                providerCalls += 1;
                return fauxAssistantMessage("unexpected reminder turn", {stopReason: "stop"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.result-reminder-execution-policy",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            caller: {kind: "agent", sessionId: 999, profileKey: "test.caller"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerCalls).toBe(1);
        expect(observedToolNames[0]).toEqual(["report_result", "reminder_patch_extra"]);
        expect(visibleMessageText(context.messages)).not.toContain("必须使用 report_result");
    }, 20_000);

    it("prepareRun sidecar 不会关闭父 run 的 steer 窗口", async () => {
        let releaseMainTool: (() => void) | undefined;
        const mainToolStarted = new Promise<void>((resolve) => {
            harness.tools.register({
                key: "sidecar_steer_gate",
                name: "sidecar_steer_gate",
                label: "Sidecar Steer Gate",
                description: "等待测试注入 steer。",
                parameters: Type.Object({}),
                async execute() {
                    resolve();
                    await new Promise<void>((done) => {
                        releaseMainTool = done;
                    });
                    return {
                        content: [{type: "text", text: "gate done"}],
                        details: {},
                        terminate: true,
                    };
                },
            });
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-keeps-steerable",
                name: "Sidecar Keeps Steerable",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "sidecar_steer_gate"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_sidecar_result", {
                    result: "loaded",
                    data: {
                        "actor.context-load": {
                            context: "ok",
                        },
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("sidecar_steer_gate", {}, {id: "main-gate"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                expect(visibleMessageText(context.messages)).toContain("after sidecar steer");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-keeps-steerable",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        await mainToolStarted;
        const steered = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "after sidecar steer"},
        });
        releaseMainTool?.();
        const result = await running;
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(steered.status).toBe("waiting");
        expect(result.status).toBe("completed");
        expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
    }, 30_000);

    it("prepareRun hook 可以注入 runtime-only 首轮上下文且不落 session", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.prepare-run-runtime-message",
                name: "Prepare Run Runtime Message",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "context",
                        stage: "prepareRun",
                        run() {
                            return {
                                runtimeMessages: [
                                    createUserMessage({text: "RUNTIME_ONLY_CONTEXT"}),
                                ],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.prepare-run-runtime-message",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("RUNTIME_ONLY_CONTEXT");
        expect(context.messages
            .map((message) => storedMessageText(message))).not.toContain("RUNTIME_ONLY_CONTEXT");
    });

    it("runtime hook 可以通过 session facade 读取 source session 并注入 Agent Dialogue Content", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.source",
                name: "Source",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const source = await harness.createAgent({
            profileKey: "test.source",
            initial: {},
            workspaceRoot: root,
        });
        faux.setResponses([
            fauxAssistantMessage("source answer"),
        ]);
        await harness.invokeAgent({
            sessionId: source.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.session-facade",
                name: "Session Facade",
            },
            initialSchema: Type.Object({
                sourceSessionId: Type.Number(),
            }),
            allowedToolKeys: [],
            runtime: {
                hooks: [
                    {
                        name: "sourceContext",
                        stage: "prepareRun",
                        async run(ctx) {
                            const sourceSession = await ctx.session.read(ctx.initial.sourceSessionId);
                            const content = await ctx.session.agentDialogueContent({
                                snapshot: sourceSession.snapshot,
                                initial: ctx.initial,
                            });
                            return {
                                runtimeMessages: [
                                    createUserMessage({text: `SOURCE_CONTEXT\n${content.text}`}),
                                ],
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.sessionFacade",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.source",
                                            value: {
                                                sourceSessionId: sourceSession.snapshot.metadata.sessionId,
                                                sourceMessageCount: sourceSession.context.messages.length,
                                                entryIds: content.entryIds,
                                            },
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
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("reader done");
            },
        ]);
        const reader = await harness.createAgent({
            profileKey: "test.session-facade",
            initial: {
                sourceSessionId: source.sessionId,
            },
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: reader.sessionId,
            mode: "prompt",
            message: {text: "read source"},
        });
        const readerContext = harness.repo.reduce(await harness.repo.readSession(reader.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("SOURCE_CONTEXT");
        expect(providerPrompts[0]).toContain("source question");
        expect(providerPrompts[0]).toContain("source answer");
        expect(readerContext.customState["test.runtime.source"]).toEqual({
            sourceSessionId: source.sessionId,
            sourceMessageCount: 2,
            entryIds: expect.any(Array),
        });
        expect(readerContext.messages
            .map((message) => storedMessageText(message))).not.toContain("SOURCE_CONTEXT");
    });

    it("ingestTurn hook 可以让本轮 transcript 只保留在 RunFrame，settleRun 仍能读取 report_result", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-only-transcript",
                name: "Runtime Only Transcript",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run(ctx) {
                            return {
                                transcript: "runtime_only",
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.runtimeOnlyTranscript",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.transcript",
                                            value: {
                                                assistantText: messageText(ctx.turn?.assistant ?? createAssistantTextMessage({text: ""})),
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                    {
                        name: "write-report",
                        stage: "settleRun",
                        run(ctx) {
                            const data = ctx.runResult?.reportResult?.data as {title?: string} | undefined;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.runtimeOnlySettle",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.settleTransient",
                                            value: {
                                                title: data?.title ?? null,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("hidden transcript"),
                fauxToolCall("report_result", {
                    result: "ok",
                    data: {
                        title: "Transient Summary",
                    },
                }, {id: "transient-report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-only-transcript",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toContain("hidden transcript");
        expect(result.reportResult?.data).toEqual({
            title: "Transient Summary",
        });
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
        expect(context.customState["test.runtime.transcript"]).toMatchObject({
            assistantText: expect.stringContaining("hidden transcript"),
        });
        expect(context.customState["test.runtime.settleTransient"]).toEqual({
            title: "Transient Summary",
        });
    });

    it("waiting turn 拒绝 runtime_only transcript，避免 resolution 无法恢复", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-only-waiting",
                name: "Runtime Only Waiting",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "runtime_only",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "wait-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-only-waiting",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("error");
        expect(result.error).toContain("waiting turn 必须显式使用 persist transcript");
        expect(result.errorPhase).toBe("ingest");
        expect(result.errorInfo).toEqual(expect.objectContaining({
            phase: "ingest",
        }));
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
    }, 45_000);

    it("runtime_only transcript 下 report_result reminder 只进入 RunFrame 不写 session", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-only-report-reminder",
                name: "Runtime Only Report Reminder",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "runtime_only",
                            };
                        },
                    },
                    {
                        name: "settle",
                        stage: "settleRun",
                        run(ctx) {
                            const data = ctx.runResult?.reportResult?.data as {title?: string} | undefined;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.runtimeOnlyReportReminder",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.reportReminder",
                                            value: {
                                                title: data?.title ?? null,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        const providerPrompts: string[] = [];
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("missing report");
            },
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "ok",
                        data: {
                            title: "Runtime Reminder",
                        },
                    }, {id: "runtime-reminder-report-1"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-only-report-reminder",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            caller: {kind: "agent", sessionId: 999, profileKey: "test.caller"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[1]).toContain("必须使用 report_result");
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("必须使用 report_result"))).toBe(false);
        expect(context.customState["test.runtime.reportReminder"]).toEqual({
            title: "Runtime Reminder",
        });
    }, 30_000);

    it("source profile completed 后会后台运行 summarizer 并写回 active leaf title/summary", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarized-source",
                name: "Summarized Source",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                    maxDialogueContentTokens: 80_000,
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary ok",
                    data: {
                        title: "Source Title",
                        summary: "Source summary.",
                    },
                }, {id: "summarizer-report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarized-source",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        expect(result.status).toBe("completed");
        await waitFor(async () => {
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(context.title).toBe("Source Title");
            expect(context.summary).toBe("Source summary.");
            expect(context.customState["summarizer.state"]).toMatchObject({
                running: false,
                dirty: false,
                profileKey: "summarizer",
                lastDialogueContentTokens: expect.any(Number),
                lastDialogueContentFingerprint: expect.any(String),
                lastRunAt: expect.any(Number),
            });
        });

        const sourceContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const state = sourceContext.customState["summarizer.state"] as {sessionId?: number};
        expect(state.sessionId).toEqual(expect.any(Number));
        const summarizerSnapshot = await harness.repo.readSession(state.sessionId!);
        const summarizerContext = harness.repo.reduce(summarizerSnapshot);
        expect(summarizerSnapshot.metadata).toMatchObject({
            profileKey: "summarizer",
            systemRole: "summarizer",
        });
        expect(summarizerContext.messages).toHaveLength(0);
        expect((await harness.listSessions({workspaceKey: "global"})).map((session) => session.sessionId)).toEqual([created.sessionId]);
        expect((await harness.listSessions({workspaceKey: "global", includeSystem: true})).map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
            created.sessionId,
            state.sessionId,
        ]);
        await waitFor(async () => {
            const settled = await harness.repo.readSession(state.sessionId!);
            expect(settled.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "end",
            }));
        });
    });

    it("summarizer 写回前 source leaf 变化时只标 dirty 不覆盖当前 title/summary", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-stale",
                name: "Summarizer Stale",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-stale",
            initial: {},
            workspaceRoot: root,
        });
        faux.setResponses([
            fauxAssistantMessage("source answer"),
            async () => {
                await harness.repo.moveLeaf(created.sessionId, null);
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "stale summary",
                        data: {
                            title: "Stale Title",
                            summary: "Stale summary.",
                        },
                    }, {id: "summarizer-report-stale"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "fresh summary",
                    data: {
                        title: "Fresh Title",
                        summary: "Fresh summary.",
                    },
                }, {id: "summarizer-report-fresh"}),
            ], {stopReason: "toolUse"}),
        ]);

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        expect(result.status).toBe("completed");
        await waitFor(async () => {
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(context.customState["summarizer.state"]).toMatchObject({
                running: false,
                dirty: false,
            });
            expect(context.title).toBe("Fresh Title");
            expect(context.summary).toBe("Fresh summary.");
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const updates = snapshot.entries.filter((entry) => entry.type === "session_update");
        expect(updates.some((entry) => entry.updates.title === "Stale Title")).toBe(false);
        const state = harness.repo.reduce(snapshot).customState["summarizer.state"] as {sessionId?: number};
        await waitFor(async () => {
            const settled = await harness.repo.readSession(state.sessionId!);
            expect(settled.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(2);
        });
    });

    it("summarizer preflight 超过 Agent Dialogue Content token 上限时只写状态不启动 hidden run", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-too-large",
                name: "Summarizer Too Large",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                    maxDialogueContentTokens: 1,
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer with enough text to exceed token limit"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "must not run",
                    data: {
                        title: "Unexpected",
                        summary: "Unexpected.",
                    },
                }, {id: "summarizer-too-large-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-too-large",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question that exceeds"},
        });
        await harness.drainSessionSummarizer(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(context.title).toBe("Summarizer Too Large");
        expect(context.summary).toBeUndefined();
        expect(context.customState["summarizer.state"]).toMatchObject({
            running: false,
            dirty: false,
            profileKey: "summarizer",
            lastDialogueContentTokens: expect.any(Number),
            lastError: expect.stringContaining("超过 summarizer 上限"),
        });
        expect((await harness.listSessions({workspaceKey: "global", includeSystem: true})).map((session) => session.sessionId)).toEqual([created.sessionId]);
    });

    it("summarizer sourceInvocation interval 会按 source prompt turn 间隔触发", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-interval",
                name: "Summarizer Interval",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 2,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer 1"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary one",
                    data: {
                        title: "Interval One",
                        summary: "First summary.",
                    },
                }, {id: "summarizer-interval-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("source answer 2"),
            fauxAssistantMessage("source answer 3"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary two",
                    data: {
                        title: "Interval Two",
                        summary: "Second summary.",
                    },
                }, {id: "summarizer-interval-2"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-interval",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "one"}});
        await waitFor(async () => {
            expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).title).toBe("Interval One");
        });
        const firstState = harness.repo.reduce(await harness.repo.readSession(created.sessionId)).customState["summarizer.state"] as {sessionId?: number};
        const summarizerSessionId = firstState.sessionId!;
        await waitFor(async () => {
            const summarizerSnapshot = await harness.repo.readSession(summarizerSessionId);
            expect(summarizerSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(1);
        });

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "two"}});
        await harness.drainSessionSummarizer(created.sessionId);
        let summarizerSnapshot = await harness.repo.readSession(summarizerSessionId);
        expect(summarizerSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(1);

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "three"}});
        await waitFor(async () => {
            expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).title).toBe("Interval Two");
        });
        await waitFor(async () => {
            summarizerSnapshot = await harness.repo.readSession(summarizerSessionId);
            expect(summarizerSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(2);
        });
    });

    it("summarizer 运行失败后同一份 Agent Dialogue Content 可以重试", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-retry",
                name: "Summarizer Retry",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer"),
            async () => {
                throw new Error("temporary provider error");
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary retry",
                    data: {
                        title: "Retry Title",
                        summary: "Retry summary.",
                    },
                }, {id: "summarizer-retry-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-retry",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });
        await harness.drainSessionSummarizer(created.sessionId);
        let context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("Summarizer Retry");
        expect(context.customState["summarizer.state"]).toMatchObject({
            running: false,
            dirty: false,
            lastError: expect.stringContaining("temporary provider error"),
        });

        await (harness as unknown as {scheduleSessionSummarizer(sessionId: number): Promise<void>}).scheduleSessionSummarizer(created.sessionId);
        await harness.drainSessionSummarizer(created.sessionId);
        context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("Retry Title");
        expect(context.summary).toBe("Retry summary.");
        expect(context.customState["summarizer.state"]).toMatchObject({
            running: false,
            dirty: false,
            lastDialogueContentFingerprint: expect.any(String),
        });
        expect((context.customState["summarizer.state"] as {lastError?: string}).lastError).toBeUndefined();
    }, 20_000);

    it("rename 命令锁定标题后 summarizer 只更新 summary，summarize 命令解锁并立即重跑", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-rename",
                name: "Summarizer Rename",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer 1"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary 1",
                    data: {
                        title: "Auto Title 1",
                        summary: "Auto summary 1.",
                    },
                }, {id: "summarizer-rename-report-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("source answer 2"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary 2",
                    data: {
                        title: "Auto Title 2",
                        summary: "Auto summary 2.",
                    },
                }, {id: "summarizer-rename-report-2"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary 3",
                    data: {
                        title: "Auto Title 3",
                        summary: "Auto summary 3.",
                    },
                }, {id: "summarizer-rename-report-3"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-rename",
            initial: {},
            workspaceRoot: root,
        });

        // 第一次对话完成后自动生成 title/summary
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question 1"},
        });
        await harness.drainSessionSummarizer(created.sessionId);
        let context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("Auto Title 1");

        // 手动改名：标题所有权归用户
        await harness.runCommand(created.sessionId, {command: "rename", title: "我的标题"});
        context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("我的标题");
        expect(context.customState["session.titleOwner"]).toEqual({owner: "user"});

        // 后续 summarizer 只更新 summary，不覆盖标题
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question 2"},
        });
        await harness.drainSessionSummarizer(created.sessionId);
        context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("我的标题");
        expect(context.summary).toBe("Auto summary 2.");

        // summarize 命令交还标题所有权并强制重跑
        await harness.runCommand(created.sessionId, {command: "summarize"});
        await harness.drainSessionSummarizer(created.sessionId);
        context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.customState["session.titleOwner"]).toEqual({owner: "auto"});
        expect(context.title).toBe("Auto Title 3");
        expect(context.summary).toBe("Auto summary 3.");
    }, 30_000);

    it("summarize 命令允许未声明策略的普通 Profile 使用系统默认 summarizer", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarize-unsupported",
                name: "Summarize Unsupported",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.summarize-unsupported",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {command: "rename", title: "手动标题"});
        faux.setResponses([fauxAssistantMessage([
            fauxToolCall("report_result", {
                result: "summary ok",
                data: {
                    title: "默认摘要标题",
                    summary: "默认摘要内容。",
                },
            }, {id: "summarizer-default-report"}),
        ], {stopReason: "toolUse"})]);

        const result = await harness.runCommand(created.sessionId, {command: "summarize"});
        await harness.drainSessionSummarizer(created.sessionId);

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(result.status).toBe("started");
        expect(context.title).toBe("默认摘要标题");
        expect(context.summary).toBe("默认摘要内容。");
        expect(context.customState["session.titleOwner"]).toEqual({owner: "auto"});
    }, 30_000);

    it("自定义 runtime 不组合 reportResult built-in 时不会自动注入 report_result reminder", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.custom-runtime-no-report-reminder",
                name: "Custom Runtime No Report Reminder",
            },
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "runtime_only",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("missing report"),
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.custom-runtime-no-report-reminder",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult).toBeUndefined();
        expect(faux.getPendingResponseCount()).toBe(1);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("必须使用 report_result"))).toBe(false);
    });

    it("approval resolution 会先写 toolResult，再写 continue prepare 的 appending messages", async () => {
        let prepareCount = 0;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-appending",
                name: "Approval Appending",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                prepareCount++;
                return prepareCount > 1
                    ? {
                        appendingMessages: [createUserMessage({text: "APPENDING_AFTER_RESOLUTION"})],
                    }
                    : {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "继续？"}],
                }, {id: "ask-appending"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "done",
                }, {id: "report-appending"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-appending",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-appending",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(continued.status).toBe("completed");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user", "assistant", "toolResult"]);
        expect(messageText(context.messages[2] as never)).toContain("继续");
        expect(messageText(context.messages[3] as never)).toBe("APPENDING_AFTER_RESOLUTION");
    });

    it("continue resolution 不会发布带旧 pending approval 的启动 snapshot", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-state",
                name: "Approval State",
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
                    questions: [{question: "继续？"}],
                }, {id: "ask-state"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-state",
            initial: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: harness.eventHub.eventEpoch,
            after: harness.eventHub.lastSeq(created.sessionId),
        });
        const pendingAfterContinue: Array<string | null> = [];
        const collect = (async () => {
            for await (const published of subscription) {
                const event = published.payload;
                if (event.kind === "session" && event.event.type === "session_state_changed") {
                    pendingAfterContinue.push(event.event.state.pendingUserInputs[0]?.toolCallId ?? null);
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    break;
                }
            }
        })();

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-state",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });
        await collect;

        expect(pendingAfterContinue).not.toContain("ask-state");
        expect(pendingAfterContinue).toContain(null);
    });

    it("Plan Mode 使用 Project Workspace .agent/plan 并支持 exit preview", async () => {
        const workspaceRoot = root.replaceAll("\\", "/");
        const projectPath = "workspace/alpha";
        const projectRoot = join(workspaceRoot, "alpha");
        await withWorkspaceRuntimeRootContextForTest({workspaceRoot}, async () => {
            try {
                harness.profiles.register(defineAgentProfile({
                    manifest: {
                        key: "test.plan-mode-preview",
                        name: "Plan Mode Preview",
                    },
                    initialSchema: Type.Object({}),
                    allowedToolKeys: ["switch_mode"],
                    prepare() {
                        return {};
                    },
                }), false);
                await mkdir(projectRoot, {recursive: true});
                const created = await harness.createAgent({
                    profileKey: "test.plan-mode-preview",
                    initial: {},
                    workspaceRoot: "workspace",
                    projectPath,
                });
                await harness.runCommand(created.sessionId, {
                    command: "mode",
                    mode: "plan",
                });
                const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
                const modeState = context.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;

                expect(modeState.mode).toBe("plan");
                expect(modeState.workDirectory).toBe(".agent/plan");

                await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
                await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({models: fauxProviderConfig(faux).models}), "utf-8");
                await mkdir(join(projectRoot, ".agent", "plan"), {recursive: true});
                await mkdir(join(projectRoot, ".nbook"), {recursive: true});
                await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Alpha\nsummary: ''\n", "utf-8");
                await writeFile(join(projectRoot, ".nbook", "config.json"), "{}", "utf-8");
                await writeFile(join(projectRoot, ".agent", "plan", "preview.md"), "# Preview Plan\n\n- one\n", "utf-8");
                faux.setResponses([
                    fauxAssistantMessage([
                        fauxToolCall("switch_mode", {
                            targetMode: "normal",
                            reason: "ready",
                            planFilePath: ".agent/plan/preview.md",
                        }, {id: "exit-preview"}),
                    ], {stopReason: "toolUse"}),
                    fauxAssistantMessage(fauxText("approved")),
                ]);

                const invokeResult = await harness.invokeAgent({
                    sessionId: created.sessionId,
                    mode: "prompt",
                    message: {text: "approve plan"},
                });
                expect(invokeResult.status, invokeResult.error ?? invokeResult.errorInfo?.message).toBe("waiting");
                const snapshot = await harness.getSessionRecovery(created.sessionId);

                expect(snapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
                    toolCallId: "exit-preview",
                    toolName: "switch_mode",
                    planFilePath: ".agent/plan/preview.md",
                    planContent: "# Preview Plan\n\n- one\n",
                    planContentBytes: Buffer.byteLength("# Preview Plan\n\n- one\n", "utf8"),
                }));
                const liveState = await harness.getSessionLiveState(created.sessionId);
                expect(liveState.pendingUserInputs[0]).toEqual(expect.objectContaining({
                    toolCallId: "exit-preview",
                    planFilePath: ".agent/plan/preview.md",
                }));
                expect(liveState.pendingUserInputs[0]?.planContent).toBeUndefined();

                await harness.invokeAgent({
                    sessionId: created.sessionId,
                    mode: "continue",
                    resolution: {
                        kind: "user_input",
                        toolCallId: "exit-preview",
                        data: {
                            approved: true,
                        },
                    },
                });
                const resolvedContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            const resolvedSnapshot = await harness.getSessionRecovery(created.sessionId);
                const toolResult = resolvedContext.messages.find((message) => message.role === "toolResult" && message.toolCallId === "exit-preview");
                if (!toolResult || toolResult.role !== "toolResult") {
                    throw new Error("expected switch_mode tool result");
                }

                expect(toolResult.details).toEqual(expect.objectContaining({
                    kind: "user_input",
                    data: {
                        userInput: {
                            approved: true,
                        },
                        approved: true,
                        planFilePath: ".agent/plan/preview.md",
                        planContent: "# Preview Plan\n\n- one\n",
                    },
                }));
                expect(resolvedSnapshot.agentMode).toBe("normal");
                const resolvedModeState = resolvedContext.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;
                expect(resolvedModeState.mode).toBe("normal");
                expect(resolvedModeState.phase).toBe("exit");
                expect(resolvedModeState.fromMode).toBe("plan");
            } finally {
                await closeProjectForTest(projectPath).catch(() => undefined);
            }
        });
    }, 20_000);

    it("手动退出 Plan Mode 后写入 exit phase 并记录 hasExitedPlan", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-mode-manual-exit",
                name: "Plan Mode Manual Exit",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Message({children: "history"})}),
                    ],
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.plan-mode-manual-exit",
            initial: {},
            workspaceRoot: root,
        });

        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "normal",
        });

        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const modeState = context.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;

        expect(recovery.agentMode).toBe("normal");
        expect(modeState.phase).toBe("exit");
        expect(modeState.fromMode).toBe("plan");
        expect(modeState.hasExitedPlan).toBe(true);

        // 再次进入 plan：hasExitedPlan 使 phase 变为 reentry
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        const reentryContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const reentryState = reentryContext.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;

        expect(reentryState.mode).toBe("plan");
        expect(reentryState.phase).toBe("reentry");
    }, 10_000);

    it("switch_mode preview 拒绝 .agent/plan 外的计划路径", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-mode-bad-preview",
                name: "Plan Mode Bad Preview",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["switch_mode"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("switch_mode", {
                    targetMode: "normal",
                    planFilePath: "README.md",
                }, {id: "exit-bad-preview"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("plan path rejected")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.plan-mode-bad-preview",
            initial: {},
            workspaceRoot: root,
        });
        // 先进入 plan，避免 targetMode normal 被 no-op 拦截
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "bad plan"},
        });

        expect(result.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult");
        expect(toolResult ? messageText(toolResult) : "").toContain(".agent/plan");
        expect(result.finalMessage).toBe("plan path rejected");
    });

    it("讨论模式 write 挂起审批，批准后真实执行工具", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.readonly-write-approve",
                name: "Readonly Write Approve",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["write"],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.readonly-write-approve",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "discuss",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("write", {
                    path: "notes/approved.md",
                    content: "APPROVED CONTENT",
                }, {id: "write-approve"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("after write")),
        ]);

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "please write"},
        });
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);

        // 注入的写审批必须在快照 pending 路径可被识别
        expect(waiting.status).toBe("waiting");
        expect(recovery.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "write-approve",
            toolName: "write",
        }));

        const resolved = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "write-approve",
                data: {
                    approved: true,
                },
            },
        });

        // 批准后工具被真实执行：文件落盘，工具结果非错误
        expect(resolved.status).toBe("completed");
        expect(resolved.finalMessage).toBe("after write");
        expect(await readFile(join(root, "notes", "approved.md"), "utf-8")).toBe("APPROVED CONTENT");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "write-approve");
        expect(toolResult && toolResult.role === "toolResult" ? toolResult.isError ?? false : true).toBe(false);
    }, 20_000);

    it("讨论模式 write 被拒绝时不执行并返回引导文本", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.readonly-write-decline",
                name: "Readonly Write Decline",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["write"],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.readonly-write-decline",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "discuss",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("write", {
                    path: "notes/declined.md",
                    content: "SHOULD NOT EXIST",
                }, {id: "write-decline"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("stay readonly")),
        ]);

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "please write"},
        });
        expect(waiting.status).toBe("waiting");

        const resolved = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "write-decline",
                data: {
                    approved: false,
                },
            },
        });

        expect(resolved.status).toBe("completed");
        await expect(readFile(join(root, "notes", "declined.md"), "utf-8")).rejects.toThrow();
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "write-decline");
        expect(toolResult ? messageText(toolResult as RuntimeMessage) : "").toContain("declined this file write in discuss mode");
    }, 20_000);

    it("计划模式写 .agent/plan 下 Markdown 豁免审批，普通路径仍挂起", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-write-exempt",
                name: "Plan Write Exempt",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["write"],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.plan-write-exempt",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("write", {
                    path: ".agent/plan/draft.md",
                    content: "# Plan Draft",
                }, {id: "write-exempt"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("plan file written")),
        ]);

        const exempt = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "write plan file"},
        });

        // plan 目录内 .md 直接执行，不挂审批
        expect(exempt.status).toBe("completed");
        expect(exempt.finalMessage).toBe("plan file written");
        expect(await readFile(join(root, ".agent", "plan", "draft.md"), "utf-8")).toBe("# Plan Draft");
        expect((await harness.getSessionRecovery(created.sessionId)).pendingUserInputs).toHaveLength(0);

        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("write", {
                    path: "notes/outside.md",
                    content: "outside plan dir",
                }, {id: "write-outside"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("unused")),
        ]);
        const outside = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "write outside"},
        });

        expect(outside.status).toBe("waiting");
        expect((await harness.getSessionRecovery(created.sessionId)).pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "write-outside",
            toolName: "write",
        }));
    }, 20_000);

    it("计划模式 apply_patch：Move to 仍在计划目录内豁免，逃逸到目录外挂起", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-moveto",
                name: "Plan MoveTo",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["apply_patch"],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.plan-moveto",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        await mkdir(join(root, ".agent", "plan"), {recursive: true});
        await writeFile(join(root, ".agent", "plan", "a.md"), "old\n", "utf-8");

        // Move to 目标仍在计划目录内：豁免，直接执行（纯重命名）
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("apply_patch", {
                    patch: ["*** Begin Patch", "*** Update File: .agent/plan/a.md", "*** Move to: .agent/plan/b.md", "*** End Patch"].join("\n"),
                }, {id: "move-inside"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("moved inside")),
        ]);
        const inside = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "move inside plan dir"},
        });
        expect(inside.status).toBe("completed");
        expect(inside.finalMessage).toBe("moved inside");
        expect(await readFile(join(root, ".agent", "plan", "b.md"), "utf-8")).toBe("old\n");
        expect((await harness.getSessionRecovery(created.sessionId)).pendingUserInputs).toHaveLength(0);

        // Move to 目标逃逸到计划目录外：不豁免，挂起审批（修复前会被漏拦）
        await writeFile(join(root, ".agent", "plan", "c.md"), "old\n", "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("apply_patch", {
                    patch: ["*** Begin Patch", "*** Update File: .agent/plan/c.md", "*** Move to: notes/escaped.md", "*** End Patch"].join("\n"),
                }, {id: "move-escape"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("unused")),
        ]);
        const escape = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "move out of plan dir"},
        });
        expect(escape.status).toBe("waiting");
        expect((await harness.getSessionRecovery(created.sessionId)).pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "move-escape",
            toolName: "apply_patch",
        }));
    }, 20_000);

    it("重启后（无内存 invocation）注入的写审批仍识别为 waiting 且可解析", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.readonly-write-restart",
                name: "Readonly Write Restart",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["write"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        const created = await harness.createAgent({
            profileKey: "test.readonly-write-restart",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "discuss",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("write", {
                    path: "notes/restart.md",
                    content: "RESTART",
                }, {id: "w-restart"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("after write")),
        ]);
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "write while discussing"},
        });
        expect(waiting.status).toBe("waiting");

        // 模拟服务重启：新 harness 读取同一 JSONL store，activeInvocations 为空，只能走列表恢复路径
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(join(root, "restart-system-profiles"), join(root, "restart-user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        // 列表路径识别为 waiting（修复前注入写审批在此路径被漏认，会显示 idle）
        const waitingSessions = await restored.listSessions({workspaceKey: "global", status: "waiting"});
        const idleSessions = await restored.listSessions({workspaceKey: "global", status: "idle"});
        expect(waitingSessions.map((session) => session.sessionId)).toContain(created.sessionId);
        expect(idleSessions.map((session) => session.sessionId)).not.toContain(created.sessionId);

        // 重启后继续解析写审批：批准后真实执行，文件落盘
        faux.setResponses([
            fauxAssistantMessage(fauxText("resolved after restart")),
        ]);
        const resolved = await restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "w-restart",
                data: {
                    approved: true,
                },
            },
        });
        await restored.drainBackgroundTasks();

        expect(resolved.status).toBe("completed");
        expect(resolved.finalMessage).toBe("resolved after restart");
        expect(await readFile(join(root, "notes", "restart.md"), "utf-8")).toBe("RESTART");
    }, 120_000);

    it("plan → discuss → plan 互切：第二次进入 plan 走 enter 而非 reentry", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-discuss-swap",
                name: "Plan Discuss Swap",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.plan-discuss-swap",
            initial: {},
            workspaceRoot: root,
        });

        await harness.runCommand(created.sessionId, {command: "mode", mode: "plan"});
        await harness.runCommand(created.sessionId, {command: "mode", mode: "discuss"});
        await harness.runCommand(created.sessionId, {command: "mode", mode: "plan"});

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const modeState = context.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;

        // 从未退回 normal，计划草稿仍有效：应是 enter，hasExitedPlan 保持 false
        expect(modeState.mode).toBe("plan");
        expect(modeState.phase).toBe("enter");
        expect(modeState.hasExitedPlan).toBe(false);
    }, 10_000);

    it("plan → discuss → normal 间接退出也算结束计划周期：再进 plan 走 reentry", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-indirect-exit",
                name: "Plan Indirect Exit",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.plan-indirect-exit",
            initial: {},
            workspaceRoot: root,
        });

        await harness.runCommand(created.sessionId, {command: "mode", mode: "plan"});
        await harness.runCommand(created.sessionId, {command: "mode", mode: "discuss"});
        await harness.runCommand(created.sessionId, {command: "mode", mode: "normal"});

        const exitedContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const exitedState = exitedContext.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;
        // 虽然 fromMode=discuss，但本周期途经过 plan：回 normal 即结算 hasExitedPlan
        expect(exitedState.hasExitedPlan).toBe(true);
        expect(exitedState.visitedPlan).toBe(false);

        await harness.runCommand(created.sessionId, {command: "mode", mode: "plan"});
        const reentryContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const reentryState = reentryContext.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;
        expect(reentryState.mode).toBe("plan");
        expect(reentryState.phase).toBe("reentry");
    }, 10_000);

    it("switch_mode 目标与当前模式相同时直接拦截为 no-op", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.switch-mode-noop",
                name: "Switch Mode Noop",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["switch_mode"],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.switch-mode-noop",
            initial: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("switch_mode", {
                    targetMode: "plan",
                    reason: "already here",
                }, {id: "switch-noop"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("noop handled")),
        ]);

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "switch again"},
        });

        // 不产生审批挂起，直接回错误 toolResult 让模型继续
        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("noop handled");
        expect((await harness.getSessionRecovery(created.sessionId)).pendingUserInputs).toHaveLength(0);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "switch-noop");
        expect(toolResult ? messageText(toolResult as RuntimeMessage) : "").toContain("Already in plan mode");
    }, 20_000);

    it("缺少 report_result 时会自动提醒一次并收集第二轮 report", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.must-report",
                name: "Must Report",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage(fauxText("plain answer")),
            fauxAssistantMessage([
                fauxText("retrying"),
                fauxToolCall("report_result", {
                    result: "fixed",
                }, {id: "report-after-reminder"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.must-report",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            caller: {kind: "agent", sessionId: 999, profileKey: "test.caller"},
        });

        expect(result.status).toBe("completed");
        expect(result.reportResult?.result).toBe("fixed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(visibleMessageText(context.messages)).toContain("必须使用 report_result");
    }, 30_000);

    it("用户 caller 直接对话时不触发 report_result reminder", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.user-caller-no-report-reminder",
                name: "User Caller No Report Reminder",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage(fauxText("plain answer")),
            fauxAssistantMessage(fauxText("must not run")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.user-caller-no-report-reminder",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("plain answer");
        expect(result.reportResult).toBeUndefined();
        expect(faux.getPendingResponseCount()).toBe(1);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("必须使用 report_result"))).toBe(false);
    }, 10_000);

    it("未允许 report_result 的 agent 普通结束时不触发缺失 report 提醒", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("plain answer")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("plain answer");
        expect(result.reportResult).toBeUndefined();
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.every((message) => !messageText(message as never).includes("必须使用 report_result"))).toBe(true);
    });

    it("AppendingSet 写入 session 后不会在本轮 provider context 里重复出现", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.appending",
                name: "Appending Test",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {
                    appendingMessages: [createUserMessage({text: "APPENDING"})],
                };
            },
        }));
        faux.setResponses([
            (context) => {
                const texts = context.messages.map((message) => {
                    if (message.role === "user") {
                        return typeof message.content === "string"
                            ? message.content
                            : message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
                    }
                    return message.role;
                });
                return fauxAssistantMessage(fauxText(texts.join("|")));
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.appending",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });

        expect(result.finalMessage).toBe("APPENDING|PROMPT");
    });

    it("repeatEveryTurns 只计算真实 prompt 用户消息", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.prompt-turns",
                name: "Prompt Turns",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare({runtime}) {
                return {
                    appendingMessages: runtime?.promptUserTurnCount === 0
                        ? [createUserMessage({text: "APPENDING_BEFORE_FIRST_PROMPT"})]
                        : [],
                };
            },
        }));
        faux.setResponses([
            (context) => {
                return fauxAssistantMessage(fauxText(`count=${context.messages.filter((message) => message.role === "user").length}`));
            },
            fauxAssistantMessage(fauxText("second")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.prompt-turns",
            initial: {},
            workspaceRoot: root,
        });

        const first = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT_ONE"},
        });
        const second = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
        });
        const entries = (await harness.repo.readSession(created.sessionId)).entries;

        expect(first.finalMessage).toBe("count=2");
        expect(second.status).toBe("completed");
        expect(entries.filter((entry) => entry.type === "message" && entry.origin === "prompt")).toHaveLength(1);
        expect(entries.filter((entry) => entry.type === "custom_message" && messageText(entry.message as never) === "APPENDING_BEFORE_FIRST_PROMPT")).toHaveLength(1);
    });

    it("prepare 能读取尚未写入 session 的本轮 prompt 消息", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.pending-prompt",
                name: "Pending Prompt",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare({runtime}) {
                return {
                    appendingMessages: runtime?.pendingUserMessage
                        ? [createUserMessage({text: `PENDING=${messageText(runtime.pendingUserMessage)}`})]
                        : [],
                };
            },
        }));
        faux.setResponses([
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.pending-prompt",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "$skill run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(context.messages.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
        expect(messageText(context.messages[0] as never)).toBe("PENDING=$skill run");
        expect(messageText(context.messages[1] as never)).toBe("$skill run");
    });

    it("ModelContext 内 Reminder 会按 AppendingSet 语义提前写入并推送 session_entry", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.model-reminder-visible",
                name: "Model Reminder Visible",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {
                    systemPrompt: "SYSTEM",
                    modelContextAppendingMessages: [createUserMessage({text: "MODEL_REMINDER"})],
                    modelContextMessages: [createUserMessage({text: "MODEL_ONLY"})],
                };
            },
        }));
        const entryTexts: string[] = [];
        harness.eventHub.subscribe(1);
        faux.setResponses([
            (context) => {
                return fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|")));
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.model-reminder-visible",
            initial: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const collect = (async () => {
            for await (const published of subscription) {
                const event = published.payload;
                if (event.kind === "session" && event.event.type === "session_entry") {
                    const entry = event.event.entry;
                    if (entry.type === "system") {
                        entryTexts.push(entry.content.preview);
                    }
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    break;
                }
            }
        })();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        await collect;

        expect(result.finalMessage).toBe("MODEL_ONLY|MODEL_REMINDER|PROMPT");
        expect(entryTexts).toContain("MODEL_REMINDER");
    });

    it("自定义 runtime 不组合 sessionContext built-in 时不注入 prepare modelContextMessages", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-session-context-runtime",
                name: "No Session Context Runtime",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    modelContextMessages: [createUserMessage({text: "MODEL_ONLY"})],
                };
            },
        }), false);
        faux.setResponses([
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-session-context-runtime",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("PROMPT");
        expect(context.messages.map((message) => messageText(message as never))).toEqual(["PROMPT", "PROMPT"]);
    });

    it("自定义 runtime 不组合 sessionContext built-in 时不写入 prepare context messages", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-session-context-writes",
                name: "No Session Context Writes",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    historyInitMessages: [createUserMessage({text: "HISTORY_INIT"})],
                    modelContextAppendingMessages: [createUserMessage({text: "MODEL_APPENDING"})],
                    appendingMessages: [createUserMessage({text: "APPENDING"})],
                };
            },
        }), false);
        faux.setResponses([
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-session-context-writes",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("PROMPT");
        expect(context.messages.map((message) => messageText(message as never))).toEqual(["PROMPT", "PROMPT"]);
    });

    it("自定义 runtime 不组合 sessionContext built-in 时 compact 后不重新注入 HistorySet", async () => {
        const providerPrompts: string[] = [];
        harness.tools.register({
            key: "force_continue_without_session_context",
            name: "force_continue_without_session_context",
            label: "Force Continue Without Session Context",
            description: "Forces another turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-session-context-compact",
                name: "No Session Context Compact",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["force_continue_without_session_context"],
            runtimeDefaults: {
                compaction: {
                    trigger: {kind: "tokens", value: 1},
                    keepRecent: {kind: "tokens", value: 1},
                },
            },
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    historyInitMessages: [createUserMessage({text: "HISTORY_INIT"})],
                };
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("force_continue_without_session_context", {}, {id: "force-continue-without-session-context-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage(fauxText("COMPACT SUMMARY")),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-session-context-compact",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "OLD CONTEXT"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(providerPrompts).toHaveLength(2);
        expect(providerPrompts[1]).toContain("COMPACT SUMMARY");
        expect(providerPrompts[1]).not.toContain("HISTORY_INIT");
    });

    it("自定义 runtime 不组合 profilePrompt built-in 时不注入 prepare systemPrompt", async () => {
        const observedSystemPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-profile-prompt-runtime",
                name: "No Profile Prompt Runtime",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    systemPrompt: "PROFILE_SYSTEM_PROMPT",
                };
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedSystemPrompts.push(context.systemPrompt ?? "");
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-profile-prompt-runtime",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const prompt = await harness.getSessionQuery(created.sessionId, {view: "systemPrompt"});

        expect(result.status).toBe("completed");
        expect(observedSystemPrompts).toEqual([""]);
        expect(recovery).not.toHaveProperty("systemPrompt");
        expect(prompt).toEqual({kind: "systemPrompt", sessionId: created.sessionId, systemPrompt: ""});
    });

    it("非内置 hook 不能伪造 builtinBehavior", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.fake-builtin-behavior",
                name: "Fake Builtin Behavior",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "builtin.fake",
                        stage: "prepareRun",
                        run() {
                            return {
                                builtinBehavior: {
                                    profilePrompt: true,
                                },
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.fake-builtin-behavior",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.error ?? "").toContain("runtime hook builtin.fake 不能返回 builtinBehavior");
    });

    it("create_agent 会自动 link 到父 session，get_agent 无参返回当前拥有的 agent", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            title: "  Custom Child Title  ",
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const owned = await harness.getAgent(undefined, parent.sessionId);

        expect(Array.isArray(owned)).toBe(true);
        expect(owned).toEqual([
            expect.objectContaining({
                sessionId: child.sessionId,
                profileKey: "leader.default",
                title: "Custom Child Title",
            }),
        ]);
        expect(child.title).toBe("Custom Child Title");
        expect(harness.repo.reduce(await harness.repo.readSession(child.sessionId)).title).toBe("Custom Child Title");

        await harness.detachAgent(child.sessionId, parent.sessionId);

        expect(await harness.getAgent(undefined, parent.sessionId)).toEqual([]);
    });

    it("detachAgent 准确区分本次解除、重复解除与从未关联", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        await expect(harness.detachAgent(child.sessionId, parent.sessionId)).resolves.toEqual({
            sessionId: child.sessionId,
            status: "detached",
        });
        await expect(harness.detachAgent(child.sessionId, parent.sessionId)).resolves.toEqual({
            sessionId: child.sessionId,
            status: "already_detached",
        });
        await expect(harness.detachAgent(parent.sessionId, child.sessionId)).resolves.toEqual({
            sessionId: parent.sessionId,
            status: "not_linked",
        });
    });

    it("create 与 archive 并发时由关系队列串行，最终不会留下 active link", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const originalReadSession = harness.repo.readSession.bind(harness.repo);
        const releaseParentRead = createDeferred();
        let parentReadBlocked = false;
        harness.repo.readSession = async (...args: Parameters<JsonlSessionRepository["readSession"]>): ReturnType<JsonlSessionRepository["readSession"]> => {
            if (args[0] === parent.sessionId && !parentReadBlocked) {
                parentReadBlocked = true;
                await releaseParentRead.promise;
            }
            return originalReadSession(...args);
        };

        const createPromise = harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        await waitFor(() => expect(parentReadBlocked).toBe(true));
        const archivePromise = harness.runCommand(parent.sessionId, {
            command: "archive",
            reason: "concurrent archive",
        });
        releaseParentRead.resolve();
        const child = await createPromise;
        await archivePromise;

        expect((await harness.getSessionRelations(parent.sessionId)).linkedAgents).toEqual([]);
        expect((await harness.getSessionRelations(child.sessionId)).linkedByAgents).toEqual([]);
        expect(harness.repo.reduce(await originalReadSession(parent.sessionId)).linkedAgents).toContainEqual(expect.objectContaining({
            sessionId: child.sessionId,
            detached: true,
        }));
    });

    it("旧数据中 active link 指向 archived target 时所有当前查询都隐藏关系", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        await harness.repo.appendEntry(child.sessionId, {
            type: "session_archived",
            reason: "legacy archive without detach",
        });

        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        try {
            expect(await restored.getAgent(undefined, parent.sessionId)).toEqual([]);
            expect((await restored.getSession(parent.sessionId)).linkedAgents).toEqual([]);
            expect((await restored.getSessionRelations(parent.sessionId)).linkedAgents).toEqual([]);
            expect(restored.repo.reduce(await restored.repo.readSession(parent.sessionId)).linkedAgents).toContainEqual(expect.objectContaining({
                sessionId: child.sessionId,
                detached: false,
            }));
        } finally {
            await restored.dispose();
        }
    });

    it("子 session 未显式传 workspace 时继承父 session 归属并能看到绑定者", async () => {
        await mkdir(join(root, "novel-one"), {recursive: true});
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: "workspace",
            workspaceKey: "novel-one",
            projectPath: "workspace/novel-one",
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });

        const childSnapshot = await harness.getSessionRecovery(child.sessionId);

        expect(childSnapshot.summary.workspaceKey).toBe("novel-one");
        expect(childSnapshot.summary.projectPath).toBe("workspace/novel-one");
        expect(childSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                workspaceKey: "novel-one",
            }),
        ]);
    });

    it("getSessionRelations 返回与 snapshot 一致的轻量关联关系", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const childSnapshot = await harness.getSessionRecovery(child.sessionId);
        const childRelations = await harness.getSessionRelations(child.sessionId);

        expect(childRelations).toEqual({
            sessionId: child.sessionId,
            linkedAgents: childSnapshot.linkedAgents,
            linkedByAgents: childSnapshot.linkedByAgents,
        });
        expect(childRelations).not.toHaveProperty("messages");
        expect(childRelations.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
            }),
        ]);
    });

    it("relation index rebuild 期间创建 child 不会丢失 pending link", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const blocker = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const originalReadSession = harness.repo.readSession.bind(harness.repo);
        const parentSummary = harness.repo.summary(await originalReadSession(parent.sessionId));
        const blockerSummary = harness.repo.summary(await originalReadSession(blocker.sessionId));
        let rebuildBlocked = false;
        let blockerReadCount = 0;
        const releaseRebuild = createDeferred();
        harness.repo.listSessions = async () => [parentSummary, blockerSummary];
        harness.repo.readSession = async (...args: Parameters<JsonlSessionRepository["readSession"]>): ReturnType<JsonlSessionRepository["readSession"]> => {
            const [sessionId] = args;
            if (sessionId === blocker.sessionId && blockerReadCount === 0) {
                blockerReadCount += 1;
                rebuildBlocked = true;
                await releaseRebuild.promise;
            }
            return originalReadSession(...args);
        };

        const relationsPromise = harness.getSessionRelations(parent.sessionId);
        await waitFor(() => expect(rebuildBlocked).toBe(true));
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        releaseRebuild.resolve();

        const parentRelations = await relationsPromise;
        const childRelations = await harness.getSessionRelations(child.sessionId);

        expect(parentRelations.linkedAgents).toContainEqual(expect.objectContaining({
            sessionId: child.sessionId,
        }));
        expect(childRelations.linkedByAgents).toContainEqual(expect.objectContaining({
            sessionId: parent.sessionId,
        }));
    });

    it("relation index rebuild 期间 detach 会 replay 到新索引", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        const blocker = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const originalReadSession = harness.repo.readSession.bind(harness.repo);
        const parentSummary = harness.repo.summary(await originalReadSession(parent.sessionId));
        const blockerSummary = harness.repo.summary(await originalReadSession(blocker.sessionId));
        const childSummary = harness.repo.summary(await originalReadSession(child.sessionId));
        let rebuildBlocked = false;
        let blockerReadCount = 0;
        const releaseRebuild = createDeferred();
        harness.repo.listSessions = async () => [parentSummary, blockerSummary, childSummary];
        harness.repo.readSession = async (...args: Parameters<JsonlSessionRepository["readSession"]>): ReturnType<JsonlSessionRepository["readSession"]> => {
            const [sessionId] = args;
            if (sessionId === blocker.sessionId && blockerReadCount === 0) {
                blockerReadCount += 1;
                rebuildBlocked = true;
                await releaseRebuild.promise;
            }
            return originalReadSession(...args);
        };

        const relationsPromise = harness.getSessionRelations(child.sessionId);
        await waitFor(() => expect(rebuildBlocked).toBe(true));
        await harness.detachAgent(child.sessionId, parent.sessionId);
        releaseRebuild.resolve();

        const childRelations = await relationsPromise;

        expect(childRelations.linkedByAgents).toEqual([]);
    });

    it("relation index 已加载后的 create/detach/restart 与 session 账本真相一致", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "novel-one",
        });
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);

        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "global",
            parentSessionId: parent.sessionId,
        });
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, child.sessionId);

        await harness.detachAgent(child.sessionId, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, child.sessionId);

        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        try {
            await expectRelationsMatchSessionLedger(restored, parent.sessionId);
            await expectRelationsMatchSessionLedger(restored, child.sessionId);
        } finally {
            await restored.dispose();
        }
    });

    it("moveLeaf、tree empty、retry 不改变 session 级 relation 账本", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        const branchPoint = await harness.repo.appendMessage(parent.sessionId, createAssistantTextMessage({text: "branch point"}));

        await harness.moveTree(parent.sessionId, {position: "empty"});
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, child.sessionId);

        const retry = await harness.runCommand(parent.sessionId, {
            command: "retry",
            entryId: branchPoint.id,
        });

        expect(retry.kind).toBe("live_state");
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, child.sessionId);
    });

    it("反向绑定扫描能兼容旧数据中的 workspaceKey 不一致关系", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "novel-one",
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            workspaceKey: "global",
            parentSessionId: parent.sessionId,
        });

        const childSnapshot = await harness.getSessionRecovery(child.sessionId);

        expect(childSnapshot.summary.workspaceKey).toBe("global");
        expect(childSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                workspaceKey: "novel-one",
            }),
        ]);
    });

    it("detachAgent 会通知被解绑 session 拉完整 snapshot", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        const subscription = harness.subscribeSessionEvents(child.sessionId, {
            eventEpoch: harness.eventHub.eventEpoch,
            after: harness.eventHub.lastSeq(child.sessionId),
        });
        const iterator = subscription[Symbol.asyncIterator]();

        try {
            await harness.detachAgent(child.sessionId, parent.sessionId);
            await expect(nextEventWithin(iterator, "linked agent detach target refresh")).resolves.toEqual(expect.objectContaining({
                sessionId: child.sessionId,
                kind: "session",
                event: expect.objectContaining({
                    type: "session_projection_invalidated",
                    reason: "linked_agent_changed",
                }),
            }));
        } finally {
            await iterator.return?.();
        }
    });

    it("create_agent 子 session 首次运行使用父 session workspaceRoot 的 effective 默认模型", async () => {
        const childWorkspaceRoot = join(root, "child-workspace").replaceAll("\\", "/");
        const childProvider = fauxProviderConfig(faux, {providerConfigId: "project-provider", modelId: "project-model"});
        await mkdir(join(childWorkspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(childWorkspaceRoot, ".nbook", "config.json"), JSON.stringify({
            models: childProvider.models,
        }, null, 4), "utf8");

        const observedDefaultModelKeys: Array<string | null> = [];
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (config, profileKey, override) => {
                expect(profileKey).toBe("leader.default");
                if (!override) observedDefaultModelKeys.push(config.models.defaultModelKey);
                else expect(override.modelKey).toBe("project-provider/project-model");
                return childProvider.model;
            },
            runtimeResolver: () => faux.runtime,
        });
        faux.setResponses([fauxAssistantMessage(fauxText("child done"))]);
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: childWorkspaceRoot,
            projectPath: childWorkspaceRoot,
            workspaceKey: "novel-one",
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: childWorkspaceRoot,
            workspaceKey: "novel-one",
            parentSessionId: parent.sessionId,
        });

        await harness.invokeAgent({
            sessionId: child.sessionId,
            mode: "prompt",
            message: {text: "use default"},
        });

        expect(observedDefaultModelKeys).toContain("project-provider/project-model");
    });

    it("外部 Project Workspace session 首次运行使用绝对 projectPath 的 Project 默认模型", async () => {
        const externalProjectRoot = resolve(root, "outside", "external-project").replaceAll("\\", "/");
        const externalProvider = fauxProviderConfig(faux, {providerConfigId: "external-provider", modelId: "external-model"});
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({models: externalProvider.models}), "utf8");
        await mkdir(join(externalProjectRoot, ".nbook"), {recursive: true});
        await writeFile(join(externalProjectRoot, "project.yaml"), "kind: novel\ntitle: External Project\nsummary: ''\n", "utf8");
        await writeFile(join(externalProjectRoot, ".nbook", "config.json"), JSON.stringify({
            models: {default: "external-provider/external-model"},
        }, null, 4), "utf8");

        const observedDefaultModelKeys: Array<string | null> = [];
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (config, profileKey, override) => {
                expect(profileKey).toBe("leader.default");
                if (!override) observedDefaultModelKeys.push(config.models.defaultModelKey);
                else expect(override.modelKey).toBe("external-provider/external-model");
                return externalProvider.model;
            },
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        faux.setResponses([fauxAssistantMessage("external done")]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: externalProjectRoot,
            workspaceKey: "external-project",
            projectPath: externalProjectRoot,
        });

        try {
            const result = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "use external default"},
            });

            expect(result.status, result.error ?? result.errorInfo?.message).toBe("completed");
            expect(observedDefaultModelKeys).toContain("external-provider/external-model");
        } finally {
            await rm(resolve(root, "outside"), {recursive: true, force: true});
        }
    }, 30_000);

    it("invoke_agent 完成后父 agent 继续进入下一轮 ReAct", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-parent",
                name: "Invoke Parent",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["invoke_agent"],
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-child",
                name: "Invoke Child",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("invoke_agent", {
                    sessionId: 2,
                    mode: "prompt",
                    message: "child work",
                    title: "Child Work Session",
                }, {id: "invoke-child"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "child done",
                    data: {
                        answer: "structured child data",
                    },
                }, {id: "child-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("parent after child")),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.invoke-parent",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "test.invoke-child",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const result = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "delegate"},
        });

        expect(child.sessionId).toBe(2);
        expect(result.finalMessage).toBe("parent after child");
        const context = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        const toolResult = context.messages.find((message): message is StoredToolResultMessage => {
            return message.role === "toolResult" && message.toolName === "invoke_agent";
        });
        expect(toolResult).toEqual(expect.objectContaining({
            role: "toolResult",
            details: expect.objectContaining({
                status: "completed",
                result: expect.objectContaining({
                    message: "child done",
                    data: {
                        answer: "structured child data",
                    },
                }),
            }),
        }));
        expect(JSON.parse(storedMessageText(toolResult!))).toEqual(expect.objectContaining({
            status: "completed",
            result: expect.objectContaining({
                data: {
                    answer: "structured child data",
                },
            }),
        }));
        expect(toolResult?.details).not.toHaveProperty("events");
        expect(context.messages.some((message) => message.role === "toolResult" && Boolean((message.details as {events?: unknown} | undefined)?.events))).toBe(false);
        expect(harness.repo.reduce(await harness.repo.readSession(child.sessionId)).title).toBe("Child Work Session");
    });

    it("invoke_agent 拒绝调用当前 session 自己，避免自递归 active invocation", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-self",
                name: "Invoke Self",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["invoke_agent"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("invoke_agent", {
                    sessionId: 1,
                    mode: "prompt",
                    message: "call myself",
                    title: "Self Title Should Not Apply",
                }, {id: "invoke-self"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("handled self error")),
        ]);
        const session = await harness.createAgent({
            profileKey: "test.invoke-self",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: session.sessionId,
            mode: "prompt",
            message: {text: "delegate"},
        });

        expect(result.finalMessage).toBe("handled self error");
        const context = harness.repo.reduce(await harness.repo.readSession(session.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult");
        expect(toolResult ? messageText(toolResult) : "").toContain("不能调用当前 session 自己");
        expect(context.title).toBe("Invoke Self");
    });

    it("create_agent 工具 schema 要求 initial 是 object，不再引导模型传 JSON string", () => {
        const tool = harness.tools.get("create_agent");
        expect(tool).toBeDefined();
        expect(tool?.description).toContain("not a JSON string");
        expect(tool?.description).not.toContain("JSON-stringified");
        expect(Value.Check(tool!.parameters, {
            profileKey: "writer",
            initial: {
                prompt: "write",
                chapterPaths: ["manuscript/001/"],
            },
        })).toBe(true);
        expect(Value.Check(tool!.parameters, {
            profileKey: "writer",
            initial: "{\"prompt\":\"write\"}",
        })).toBe(false);
        expect(Value.Check(tool!.parameters, {
            profileKey: "writer",
            initial: null,
        })).toBe(false);
    });

    it("create_agent.initial 是字符串时返回工具错误并允许同 run 修正", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.create-agent-parent",
                name: "Create Agent Parent",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["create_agent"],
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.create-agent-child",
                name: "Create Agent Child",
            },
            initialSchema: Type.Object({
                role: Type.String(),
            }),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    initial: "{\"role\":\"draft\"}",
                    title: "Draft Child",
                }, {id: "create-json"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    initial: {
                        role: "draft",
                    },
                    title: "Draft Child",
                }, {id: "create-object"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("created"),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.create-agent-parent",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "create"},
        });

        expect(result.status).toBe("completed");
        const afterStringCorrection = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        const afterStringText = visibleMessageText(afterStringCorrection.messages);
        expect(afterStringText).toContain("Validation failed for tool \"create_agent\"");
        expect(afterStringText).toContain("created agent session");

        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    initial: null,
                }, {id: "create-null"} as never),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("created from null"),
        ]);

        await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "create with null"},
        });
        const afterNull = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        expect(visibleMessageText(afterNull.messages)).toContain("Validation failed for tool \"create_agent\"");

        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    initial: "role=draft",
                }, {id: "create-kv"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("after error"),
        ]);

        await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "bad create"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        expect(visibleMessageText(context.messages)).toContain("Validation failed for tool \"create_agent\"");
    }, 30_000);

    it("get_agent_profile 返回 profile schema 摘要和 tool keys", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.profile-parent",
                name: "Profile Parent",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["get_agent_profile"],
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.profile-detail",
                name: "Profile Detail",
                description: "Detail target.",
            },
            initialSchema: Type.Object({
                prompt: Type.String({description: "Task prompt."}),
            }),
            outputSchema: Type.Object({
                summary: Type.String({description: "Result summary."}),
            }),
            allowedToolKeys: ["read", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("get_agent_profile", {
                    profileKey: "test.profile-detail",
                }, {id: "profile-detail"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("profile read"),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.profile-parent",
            initial: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "read profile"},
        });

        const context = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        const text = visibleMessageText(context.messages);
        expect(text).toContain("test.profile-detail");
        expect(text).toContain("toolKeys");
        expect(text).toContain("Task prompt.");
        expect(text).toContain("outputSchema");
    }, 30_000);

    it("session snapshot 暴露 linked agents、pending approval、plan/model/followUp 状态", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.snapshot-approval",
                name: "Snapshot Approval",
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
                    questions: [{question: "Name?"}],
                }, {id: "ask-snapshot"}),
            ], {stopReason: "toolUse"}),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.snapshot-approval",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const queued = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {
                text: "queued",
                images: [{
                    type: "image",
                    mimeType: "image/png",
                    data: "data:image/png;base64,iVBORw0KGgo=",
                }],
            },
            title: "Queued Follow-up Title",
        });
        const steered = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "steer",
            message: {text: "adjust"},
        });

        const snapshot = await harness.getSessionRecovery(parent.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(queued.status).toBe("waiting");
        expect(steered.status).toBe("waiting");
        expect(snapshot.summary.title).toBe("Queued Follow-up Title");
        expect(steered.queuedItem).toEqual(expect.objectContaining({
            kind: "steer",
            text: expect.objectContaining({preview: "adjust", omitted: false}),
        }));
        expect(snapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "ask-snapshot",
            toolName: "request_user_input",
            args: expect.objectContaining({kind: "generic"}),
        }));
        expect(snapshot.followUpQueue.items).toEqual([
            expect.objectContaining({
                kind: "followup",
                text: expect.objectContaining({preview: "queued", omitted: false}),
                images: [expect.objectContaining({mimeType: "image/png", dataOmitted: true})],
            }),
        ]);
        expect(snapshot.steerQueue).toEqual({
            items: [expect.objectContaining({
                kind: "steer",
                text: expect.objectContaining({preview: "adjust", omitted: false}),
            })],
            omittedItems: 0,
        });
        expect(snapshot.linkedAgents).toEqual([
            expect.objectContaining({
                sessionId: child.sessionId,
            }),
        ]);

        await expect(harness.runCommand(parent.sessionId, {
            command: "model",
            modelKey: null,
        })).rejects.toThrow("active_invocation_exists");
    });

    it("steer 在 safe point 一次性 drain，followUp 等 loop 结束后逐条开启新 loop", async () => {
        const toolStarted = createDeferred();
        const releaseTool = createDeferred();
        harness.tools.register({
            key: "continue_once",
            name: "continue_once",
            label: "Continue Once",
            description: "让当前 loop 继续一次。",
            parameters: Type.Object({}),
            async execute() {
                toolStarted.resolve();
                await releaseTool.promise;
                return {
                    content: [{type: "text", text: "continued"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.steer-loop",
                name: "Steer Loop",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["continue_once"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("continue_once", {}, {id: "continue-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("after steer"),
            fauxAssistantMessage("after followup"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.steer-loop",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        try {
            await toolStarted.promise;
            await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                message: {text: "first steer"},
            });
            await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                message: {text: "second steer"},
            });
            await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: "queued followup"},
            });
            releaseTool.resolve();

            const result = await running;

            expect(result.status).toBe("completed");
            const context = await waitForSessionText(harness, created.sessionId, "queued followup");
            const text = visibleMessageText(context.messages);
            expect(text).toContain("first steer");
            expect(text).toContain("second steer");
            expect(text).toContain("queued followup");
            expect(text.indexOf("first steer")).toBeLessThan(text.indexOf("after steer"));
            expect(text.indexOf("queued followup")).toBeGreaterThan(text.indexOf("after steer"));
            const recovery = await harness.getSessionRecovery(created.sessionId);
            expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
            expect(recovery.followUpQueue.items).toEqual([]);
        } finally {
            releaseTool.resolve();
            await running.catch(() => undefined);
        }
    });

    it("waiting_user 期间入队的 steer 会在 resolution 后下一次模型调用前注入", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.waiting-steer",
                name: "Waiting Steer",
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
                }, {id: "ask-waiting-steer"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                return fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|")));
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.waiting-steer",
            initial: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "adjust while waiting"},
        });
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-waiting-steer",
                answers: [{questionIndex: 0, text: "go"}],
            },
        });

        expect(waiting.status).toBe("waiting");
        expect(continued.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const assistantText = [...context.messages].reverse().find((message) => message.role === "assistant");
        expect(assistantText ? messageText(assistantText as never) : "").toContain("adjust while waiting");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user", "assistant"]);
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
    });

    it("idle session 拒绝显式 steer 和 followUp，避免生成无法消费的队列", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "late"},
        })).rejects.toThrow("active_invocation_required");
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "later"},
        })).rejects.toThrow("active_invocation_required");

        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
        expect(recovery.followUpQueue.items).toEqual([]);
    });

    it("loop 已经越过最后可引导点时拒绝 steer", async () => {
        faux.setResponses([
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        let steerError = "";

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
            async onEvent(event) {
                if (event.type !== "agent_end") {
                    return;
                }
                try {
                    await harness.invokeAgent({
                        sessionId: created.sessionId,
                        mode: "steer",
                        message: {text: "too late"},
                    });
                } catch (error) {
                    steerError = error instanceof Error ? error.message : String(error);
                }
            },
        });

        expect(result.status).toBe("completed");
        expect(steerError).toBe("steer_not_available");
        const snapshot = await harness.getSessionRecovery(created.sessionId);
        expect(snapshot.steerQueue).toEqual({items: [], omittedItems: 0});
    });

    it("waiting 状态 abort 会写 aborted lifecycle 并释放 active invocation", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-queue",
                name: "Abort Queue",
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
                }, {id: "abort-queue"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.abort-queue",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const abortCursor = {
            eventEpoch: harness.eventHub.eventEpoch,
            after: harness.eventHub.lastSeq(created.sessionId),
        };
        const abortReason = "停止原因".repeat(40_000);
        const abortSubscription = harness.subscribeSessionEvents(created.sessionId, abortCursor);
        const abortIterator = abortSubscription[Symbol.asyncIterator]();

        await harness.abortInvocation(created.sessionId, {reason: abortReason});
        let publicAbortReason: string | undefined;
        let fallbackReason: string | undefined;
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const event = await nextEventWithin(abortIterator, "waiting abort public event");
            if (event.kind !== "session") {
                continue;
            }
            if (event.event.type === "snapshot_required") {
                fallbackReason = event.event.reason;
                break;
            }
            if (event.event.type === "invocation_aborted") {
                publicAbortReason = event.event.reason;
                break;
            }
        }
        abortSubscription.close();
        faux.setResponses([fauxAssistantMessage("after abort")]);
        const next = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "after abort prompt"},
        });
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(fallbackReason).toBeUndefined();
        expect(publicAbortReason).toBeDefined();
        expect(publicAbortReason).not.toBe(abortReason);
        expect(Buffer.byteLength(publicAbortReason ?? "", "utf8")).toBeLessThanOrEqual(2 * 1024);
        expect(next.status).toBe("completed");
        expect(recovery.activeInvocation).toBeNull();
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            invocationId: waiting.invocationId,
            status: "aborted",
        }));
    });

    it("abort clearQueue 会清空已持久化的 followUp queue projection", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-persisted-queue",
                name: "Abort Persisted Queue",
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
                }, {id: "abort-persisted-queue"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.abort-persisted-queue",
            initial: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });

        await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: true});
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-persisted-queue",
                name: "Abort Persisted Queue",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        const recovery = await restored.getSessionRecovery(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(recovery.followUpQueue).toEqual({
            status: "ready",
            items: [],
            omittedItems: 0,
        });
    });

    it("模型错误结束时清理已入队但无法再消费的 steer", async () => {
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await waitFor(async () => {
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            expect(snapshot.activeInvocation).not.toBeNull();
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "will be cleared"},
        });
        const result = await running;

        expect(result.status).toBe("error");
        const recovery = await harness.getSessionRecovery(created.sessionId);
        expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
    });

    it("模型错误后暂停 followUp queue，不自动消费", async () => {
        const providerStarted = createDeferred();
        const releaseProvider = createDeferred();
        faux.setResponses([
            async () => {
                providerStarted.resolve();
                await releaseProvider.promise;
                return fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        try {
            await providerStarted.promise;
            await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: "queued followup"},
            });
            releaseProvider.resolve();
            const result = await running;

            expect(result.status).toBe("error");
            const recovery = await harness.getSessionRecovery(created.sessionId);
            expect(recovery.followUpQueue).toEqual({
                status: "paused",
                pausedBy: {
                    invocationId: result.invocationId,
                    reason: "error",
                },
                items: [expect.objectContaining({
                    kind: "followup",
                    text: expect.objectContaining({preview: "queued followup", omitted: false}),
                })],
                omittedItems: 0,
            });
            expect(faux.getPendingResponseCount()).toBe(1);
        } finally {
            releaseProvider.resolve();
            await running.catch(() => undefined);
        }
    });

    it("running 状态 abort 会写 aborted lifecycle 并按 aborted 暂停 followUp queue", async () => {
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("stopped", {stopReason: "aborted", errorMessage: "user stopped"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await waitFor(async () => {
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            expect(snapshot.activeInvocation).not.toBeNull();
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: false});
        const result = await running;
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(result.status).toBe("error");
        expect(recovery.activeInvocation).toBeNull();
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            invocationId: result.invocationId,
            status: "aborted",
        }));
        expect(recovery.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "aborted",
            },
            items: [expect.objectContaining({
                kind: "followup",
                text: expect.objectContaining({preview: "queued followup", omitted: false}),
            })],
            omittedItems: 0,
        });
        expect(faux.getPendingResponseCount()).toBe(1);
    });

    it("followUp queue 状态会作为 projection 持久化并能被新 harness snapshot 恢复", async () => {
        faux.setResponses([
            fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await waitFor(async () => {
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            expect(snapshot.activeInvocation).not.toBeNull();
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        const result = await running;
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const snapshot = await restored.getSessionRecovery(created.sessionId);

        expect(result.status).toBe("error");
        expect(snapshot.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "error",
            },
            items: [expect.objectContaining({
                kind: "followup",
                text: expect.objectContaining({preview: "queued followup", omitted: false}),
            })],
            omittedItems: 0,
        });
    });

    it("模型 partial error 只保存文本并剥离 tool call", async () => {
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("half answer"),
                fauxToolCall("read", {path: "x"}, {id: "partial-tool"}),
            ], {stopReason: "error", errorMessage: "stream dropped"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const assistantEntry = snapshot.entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");

        expect(result.status).toBe("error");
        expect(result.errorInfo).toEqual(expect.objectContaining({
            message: "stream dropped",
            phase: "model",
        }));
        expect(assistantEntry).toEqual(expect.objectContaining({
            type: "message",
            status: "partial",
        }));
        expect(assistantEntry && assistantEntry.type === "message" ? messageText(assistantEntry.message) : "").toBe("half answer");
        expect(assistantEntry && assistantEntry.type === "message" && assistantEntry.message.role === "assistant"
            ? assistantEntry.message.content.some((block) => block.type === "toolCall")
            : true).toBe(false);
    });

    it("safe point drain 期间拒绝新的 steer，避免成功入队后被清理", async () => {
        harness.tools.register({
            key: "finish_once",
            name: "finish_once",
            label: "Finish Once",
            description: "执行后让当前 loop 结束。",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "finished"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.drain-window",
                name: "Drain Window",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["finish_once"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage([
                    fauxToolCall("finish_once", {}, {id: "finish-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage("after steer"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.drain-window",
            initial: {},
            workspaceRoot: root,
        });
        let lateSteerError = "";
        let triedLateSteer = false;

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
            async onEvent(event) {
                if (triedLateSteer || event.type !== "turn_end") {
                    return;
                }
                triedLateSteer = true;
                try {
                    await harness.invokeAgent({
                        sessionId: created.sessionId,
                        mode: "steer",
                        message: {text: "too late during drain"},
                    });
                } catch (error) {
                    lateSteerError = error instanceof Error ? error.message : String(error);
                }
            },
        });
        await waitFor(async () => {
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            expect(snapshot.activeInvocation).not.toBeNull();
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "first steer"},
        });

        const result = await running;

        expect(result.status).toBe("completed");
        expect(lateSteerError).toBe("steer_not_available");
        const snapshot = await harness.getSessionRecovery(created.sessionId);
        expect(snapshot.steerQueue).toEqual({items: [], omittedItems: 0});
        const contextText = visibleMessageText(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).messages);
        expect(contextText).toContain("first steer");
        expect(contextText).not.toContain("too late during drain");
    });

    it("session command 和 tree API 支持 mode、archive、retry、tree+invoke", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("retry")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const beforeRetry = await harness.repo.readSession(created.sessionId);
        const assistantEntry = beforeRetry.entries.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");

        await harness.runCommand(created.sessionId, {
            command: "mode",
            mode: "plan",
        });
        expect((await harness.getSessionRecovery(created.sessionId)).agentMode).toBe("plan");

        const moved = await harness.moveTree(created.sessionId, {
            targetEntryId: assistantEntry!.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "continue",
            },
        });
        expect(moved.status).toBe("invoked");
        expect(moved.invocation?.finalMessage).toBe("retry");

        const archived = await harness.runCommand(created.sessionId, {
            command: "archive",
            reason: "done",
        });
        expect(archived.kind).toBe("live_state");
        expect((await harness.getSessionRecovery(created.sessionId)).summary.archived).toBe(true);
        expect(await harness.listSessions({workspaceKey: "global"})).toEqual([]);
        expect(await harness.listSessions({workspaceKey: "global", includeArchived: true})).toHaveLength(1);
    });

    it("从用户消息刷新时保留该用户消息，并从其后继续生成", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("retry after user")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const beforeRetry = await harness.repo.readSession(created.sessionId);
        const userEntry = beforeRetry.entries.find((entry) => entry.type === "message" && entry.message.role === "user");

        const moved = await harness.moveTree(created.sessionId, {
            targetEntryId: userEntry!.id,
            position: "at",
            next: {
                type: "invoke",
                mode: "continue",
            },
        });
        expect(moved.status).toBe("invoked");

        const afterRetry = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const activeText = afterRetry.messages.map((message) => messageText(message as never));
        expect(activeText).toContain("run");
        expect(activeText.at(-1)).toContain("retry after user");
    });

    it("tree empty 会清空当前 active leaf 但保留旧 entries，并让下一轮从空历史分支开始", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("after clear")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "first user"},
        });
        const beforeClear = await harness.repo.readSession(created.sessionId);

        const cleared = await harness.moveTree(created.sessionId, {
            position: "empty",
        });

        expect(cleared.state.activeLeafId).toBeNull();
        const clearedRecovery = await harness.getSessionRecovery(created.sessionId);
        expect(clearedRecovery.history.entries).toEqual([]);
        expect((await harness.repo.readSession(created.sessionId)).entries.length).toBeGreaterThan(beforeClear.entries.length);
        expect(clearedRecovery.tree.some((node) => node.type === "message" && !node.active)).toBe(true);

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "second user"},
        });
        const afterPrompt = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const llmMessages = afterPrompt.messages.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult");
        expect(llmMessages.map((message) => messageText(message))).toEqual(expect.arrayContaining(["second user", "after clear"]));
        expect(messageText(llmMessages.at(-1) as never)).toBe("after clear");
    });

    it("linked agents 状态来自 session entry，重建 harness 后仍能 reduce", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        await harness.detachAgent(child.sessionId, parent.sessionId);

        const nextHarness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const owned = await nextHarness.getAgent(undefined, parent.sessionId);
        const session = await nextHarness.getSession(parent.sessionId);

        expect(owned).toEqual([]);
        expect(session.linkedAgents).toEqual([]);
    });

    it("session snapshot 返回当前 session 被哪些 agent 绑定", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.linked-by",
                name: "Linked By",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "linked-by-wait"}),
            ], {stopReason: "toolUse"}),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.linked-by",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "test.linked-by",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });

        const childSnapshot = await harness.getSessionRecovery(child.sessionId);
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);
        const restoredChildSnapshot = await restored.getSessionRecovery(child.sessionId);
        expect(waiting.status).toBe("waiting");
        expect(childSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                profileKey: "test.linked-by",
                status: "waiting",
            }),
        ]);
        expect(restoredChildSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                profileKey: "test.linked-by",
                status: "waiting",
            }),
        ]);

        await harness.detachAgent(child.sessionId, parent.sessionId);
        const detachedSnapshot = await harness.getSessionRecovery(child.sessionId);
        expect(detachedSnapshot.linkedByAgents).toEqual([]);
    });

    it("归档 session 会解除全部入站和出站当前关系", async () => {
        const owner = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const archived = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: owner.sessionId,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
            parentSessionId: archived.sessionId,
        });

        await harness.runCommand(archived.sessionId, {
            command: "archive",
            reason: "test archive relation cleanup",
        });

        expect((await harness.getSessionRelations(owner.sessionId)).linkedAgents).toEqual([]);
        expect((await harness.getSessionRelations(child.sessionId)).linkedByAgents).toEqual([]);
        expect((await harness.getSessionRecovery(archived.sessionId)).summary.archived).toBe(true);
        const ownerLedger = harness.repo.reduce(await harness.repo.readSession(owner.sessionId));
        expect(ownerLedger.linkedAgents).toContainEqual(expect.objectContaining({
            sessionId: archived.sessionId,
            detached: true,
        }));
    });

    it("缺失 profile 的历史 session 仍可读取但不能继续运行", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.deleted-profile",
                name: "Deleted Profile",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "deleted-profile-wait"}),
            ], {stopReason: "toolUse"}),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.deleted-profile",
            initial: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "test.deleted-profile",
            initial: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });

        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const sessions = await restored.listSessions({workspaceKey: "global"});
        const parentSnapshot = await restored.getSessionRecovery(parent.sessionId);
        const parentLiveState = await restored.getSessionLiveState(parent.sessionId);
        const childRelations = await restored.getSessionRelations(child.sessionId);
        const beforeTreeInvoke = await restored.repo.readSession(parent.sessionId);
        const targetEntryId = restored.repo.activePath(beforeTreeInvoke)[0]?.id ?? beforeTreeInvoke.leafId;
        if (!targetEntryId) {
            throw new Error("缺少可用于 moveTree 测试的 entryId");
        }

        const continued = await restored.invokeAgent({
            sessionId: parent.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "deleted-profile-wait",
                answers: [{
                    questionIndex: 0,
                    text: "yes",
                }],
            },
        });
        const promptRejected = await restored.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "should reject prompt"},
        });
        const continueRejected = await restored.invokeAgent({
            sessionId: parent.sessionId,
            mode: "continue",
        });
        const steerRejected = await restored.invokeAgent({
            sessionId: parent.sessionId,
            mode: "steer",
            message: {text: "should reject steer"},
        });
        const followupRejected = await restored.invokeAgent({
            sessionId: parent.sessionId,
            mode: "followup",
            message: {text: "should reject followup"},
        });
        await expect(restored.runCommand(parent.sessionId, {command: "new"})).rejects.toThrow("已不存在或不可运行");
        await expect(restored.runCommand(parent.sessionId, {command: "compact"})).rejects.toThrow("已不存在或不可运行");
        await expect(restored.moveTree(parent.sessionId, {
            targetEntryId,
            position: "at",
            next: {
                type: "invoke",
                mode: "continue",
            },
        })).rejects.toThrow("已不存在或不可运行");
        const afterTreeInvoke = await restored.getSessionRecovery(parent.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(sessions).toContainEqual(expect.objectContaining({
            sessionId: parent.sessionId,
            profileKey: "test.deleted-profile",
            profileAvailability: "missing",
            profileIssueMessage: expect.stringContaining("未找到 agent profile"),
        }));
        expect(parentSnapshot.summary).toEqual(expect.objectContaining({
            profileAvailability: "missing",
            profileIssueMessage: expect.stringContaining("未找到 agent profile"),
        }));
        expect(parentSnapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "deleted-profile-wait",
            toolName: "request_user_input",
        }));
        expect(parentLiveState.summary.profileAvailability).toBe("missing");
        expect(parentLiveState.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "deleted-profile-wait",
        }));
        expect(childRelations.linkedByAgents).toContainEqual(expect.objectContaining({
            sessionId: parent.sessionId,
            profileAvailability: "missing",
        }));
        expect(continued).toEqual(expect.objectContaining({
            status: "error",
            error: expect.stringContaining("已不存在或不可运行"),
            errorPhase: "pre_loop",
        }));
        for (const rejected of [promptRejected, continueRejected, steerRejected, followupRejected]) {
            expect(rejected).toEqual(expect.objectContaining({
                status: "error",
                error: expect.stringContaining("已不存在或不可运行"),
                errorPhase: "pre_loop",
            }));
        }
        expect(afterTreeInvoke.activeLeafId).toBe(beforeTreeInvoke.leafId);
    }, 20_000);

    it("不可运行 profile 的历史 session 标记为 unloadable", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.unloadable",
                name: "Unloadable Before Restore",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.unloadable",
            initial: {},
            workspaceRoot: root,
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new BrokenProfileCatalog(join(root, "broken-system-profiles"), join(root, "broken-user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const snapshot = await restored.getSessionRecovery(created.sessionId);
        const page = await restored.listSessionPage({workspaceKey: "global", limit: 10});
        const result = await restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(snapshot.summary).toEqual(expect.objectContaining({
            profileAvailability: "unloadable",
            profileIssueMessage: "源码错误",
        }));
        expect(page.items).toContainEqual(expect.objectContaining({
            sessionId: created.sessionId,
            profileAvailability: "unloadable",
            profileIssueMessage: "源码错误",
        }));
        expect(result).toEqual(expect.objectContaining({
            status: "error",
            error: expect.stringContaining("已不存在或不可运行"),
        }));
    });

    it("profile load error 通过统一 session summary 投影限制公开体积", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.unloadable",
                name: "Unloadable Before Restore",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.unloadable",
            initial: {},
            workspaceRoot: root,
        });
        const issueMessage = "加载错误".repeat(30_000);
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new BrokenProfileCatalog(join(root, "large-error-system-profiles"), join(root, "large-error-user-profiles"), issueMessage),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        try {
            const liveState = await restored.getSessionLiveState(created.sessionId);
            const page = await restored.listSessionPage({workspaceKey: "global", limit: 10});

            expect(liveState.summary.profileIssueMessage).not.toBe(issueMessage);
            expect(page.items[0]?.profileIssueMessage).toBe(liveState.summary.profileIssueMessage);
            expect(Buffer.byteLength(JSON.stringify({
                kind: "session",
                event: {type: "session_state_changed", state: liveState},
            }), "utf8")).toBeLessThan(50 * 1024);
        } finally {
            await restored.dispose();
        }
    });

    it("get_session 默认不返回 tree 和历史消息，显式请求时只返回 active path 最近消息", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "hello session"}));

        const session = await harness.getSession(created.sessionId);

        expect(session.metadata.sessionId).toBe(created.sessionId);
        expect(session.activeLeafId).toEqual(expect.any(String));
        expect("tree" in session).toBe(false);
        expect(session.summary).toBe("hello session");
        expect(session.recentMessages).toBeUndefined();

        await harness.repo.appendMessage(created.sessionId, createAssistantTextMessage({text: "assistant reply"}));
        await harness.repo.appendMessage(created.sessionId, createTextToolResult({
            toolCallId: "read-1",
            toolName: "read",
            text: "tool output",
        }));

        const withMessages = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
            recentMessageLimit: 3,
            tokenBudget: 1200,
        });
        expect(withMessages.recentMessages).toEqual([
            expect.objectContaining({
                role: "user",
                text: "hello session",
            }),
            expect.objectContaining({
                role: "assistant",
                text: "assistant reply",
            }),
            expect.objectContaining({
                role: "toolResult",
                text: "tool output",
            }),
        ]);

        const onlyAssistant = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
            recentMessageRoles: ["assistant"],
            recentMessageLimit: 1,
            tokenBudget: 1200,
        });
        expect(onlyAssistant.recentMessages).toEqual([
            expect.objectContaining({
                role: "assistant",
                text: "assistant reply",
            }),
        ]);
    });

    it("provider error 会作为 invoke error 返回且不触发 report_result reminder", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.report-error",
                name: "Report Error",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([], {
                stopReason: "error",
                errorMessage: "Provider rejected image payload",
            }),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.report-error",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "read image"},
        });

        expect(result).toEqual(expect.objectContaining({
            status: "error",
            error: "Provider rejected image payload",
            errorPhase: "model",
            errorInfo: expect.objectContaining({
                message: "Provider rejected image payload",
                phase: "model",
            }),
        }));
        expect(faux.getPendingResponseCount()).toBe(0);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(context.messages.filter((message) => message.role === "assistant")).toHaveLength(0);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("report_result"))).toBe(false);
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            status: "error",
            errorInfo: expect.objectContaining({
                message: "Provider rejected image payload",
                phase: "model",
            }),
        }));
    });

    it("模型前 harness 错误会写 lifecycle error 且不写 assistant message", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.pre-loop-error",
                name: "Pre Loop Error",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                throw new Error("prepare exploded");
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.pre-loop-error",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(snapshot);

        expect(result).toEqual(expect.objectContaining({
            status: "error",
            error: "prepare exploded",
            errorPhase: "pre_loop",
        }));
        expect(context.messages.filter((message) => message.role === "assistant")).toHaveLength(0);
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            status: "error",
            error: "prepare exploded",
            errorInfo: expect.objectContaining({
                message: "prepare exploded",
                phase: "pre_loop",
            }),
        }));
    });

    it("compact command 使用真实 provider 摘要并且命令不写成普通 user message", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("COMPACTED")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old context"}));

        const result = await harness.runCommand(created.sessionId, {
            command: "compact",
            instructions: "prefer concise",
        });
        await harness.drainBackgroundTasks();
        const dto = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "compaction",
            summary: expect.stringContaining("COMPACTED"),
        }));
        expect(dto.activeInvocation).toBeNull();

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("started");
        expect(result.kind).toBe("live_state");
        expect(context.messages.some((message) => messageText(message as never).includes("COMPACTED"))).toBe(true);
        expect(context.messages.every((message) => !messageText(message as never).includes("/compact"))).toBe(true);
    });

    it("compact command 失败时写 lifecycle errorInfo", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old context"}));

        const result = await harness.runCommand(created.sessionId, {
            command: "compact",
            instructions: "prefer concise",
        });
        await waitFor(async () => {
            const dto = await harness.getSessionRecovery(created.sessionId);
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(snapshot.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "error",
                errorInfo: expect.objectContaining({
                    phase: "compaction",
                }),
            }));
            expect(dto.activeInvocation).toBeNull();
        });

        expect(result.status).toBe("started");
        expect(result.kind).toBe("live_state");
    });

    it("未声明 compaction 的 profile 执行 compact command 会继承默认策略", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.manual-compact-without-policy",
                name: "Manual Compact Without Policy",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.manual-compact-without-policy",
            initial: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old context"}));
        faux.setResponses([fauxAssistantMessage("DEFAULT COMPACTION")]);

        const result = await harness.runCommand(created.sessionId, {
            command: "compact",
        });
        await waitFor(async () => {
            const dto = await harness.getSessionRecovery(created.sessionId);
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(snapshot.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "end",
            }));
            expect(snapshot.entries.some((entry) => entry.type === "compaction")).toBe(true);
            expect(dto.activeInvocation).toBeNull();
        });

        expect(result.status).toBe("started");
        expect(result.kind).toBe("live_state");
    });

    it("profile 内 session variable definition 会进入工具 registry", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.session-vars", name: "Session Vars"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["variable_read", "variable_patch"],
            variableDefinitions: [
                defineSessionVariable({
                    key: "affections",
                    schema: Type.Record(Type.String(), Type.Number()),
                    writableBy: ["agent"],
                }),
            ],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("variable_read", {namespace: "session", path: "affections"}, {id: "vars-read-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("variable_patch", {
                    namespace: "session",
                    path: "affections",
                    patch: [{op: "replace", path: "", value: {alice: 3}}],
                }, {id: "vars-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.session-vars",
            initial: {},
            workspaceRoot: root,
        });
        const events: string[] = [];
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();
        const reader = (async () => {
            for (;;) {
                const next = await iterator.next();
                if (next.done) {
                    return;
                }
                const event = next.value.payload;
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    return;
                }
                if (event.kind === "session") {
                    if (event.event.type === "session_state_changed" && event.event.state.summary.sessionId === created.sessionId) {
                        events.push("variable_patch_state");
                    }
                    if (events.includes("variable_patch_state")) {
                        return;
                    }
                }
            }
        })();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "update vars"},
            block: true,
        });
        await reader;
        await iterator.return?.();
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(result.status).toBe("completed");
        expect(events).toEqual(["variable_patch_state"]);
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "variable_patch",
            namespace: "session",
            path: "affections",
        }));
    });

    it("过大的 client variable patch 在进入 EventHub 前失败且不会丢失为 snapshot_required", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.client-patch-budget", name: "Client Patch Budget"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["variable_read", "variable_patch", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("variable_read", {namespace: "client", path: "ide.large"}, {id: "client-large-read"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("variable_patch", {
                    namespace: "client",
                    path: "ide.large",
                    patch: [{op: "replace", path: "", value: "数据".repeat(15_000)}],
                }, {id: "client-large-patch"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "large patch rejected"}, {id: "client-large-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.client-patch-budget",
            initial: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        let oversizedFallbackSeen = false;
        let patchRequestSeen = false;
        const collector = (async () => {
            for await (const published of subscription) {
                const event = published.payload;
                if (event.kind === "session" && event.event.type === "snapshot_required") {
                    oversizedFallbackSeen = true;
                    await harness.abortInvocation(created.sessionId, {reason: "unexpected oversized client patch fallback"});
                }
                if (event.kind === "session" && event.event.type === "client_variable_patch_requested") {
                    patchRequestSeen = true;
                    await harness.acknowledgeClientVariablePatch(created.sessionId, {
                        ...event.event.request,
                        namespace: "client",
                        appliedValue: "acknowledged",
                    });
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    return;
                }
            }
        })();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "patch large client state"},
            clientState: {ide: {large: ""}},
            block: true,
        });
        subscription.close();
        await collector;
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const patchResult = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "client-large-patch");

        expect(result.error).toBeUndefined();
        expect(result.status).toBe("completed");
        expect(result.reportResult?.result).toBe("large patch rejected");
        expect(oversizedFallbackSeen).toBe(false);
        expect(patchRequestSeen).toBe(false);
        expect(patchResult ? messageText(patchResult) : "").toContain("client_variable_patch_too_large");
    }, 20_000);

    it("非法 client variable patch toolCallId 在pending与EventHub之前fail closed", async () => {
        const requester = harness as unknown as {
            requestClientVariablePatch(sessionId: number, request: VariablePatchRequest): Promise<VariablePatchAck>;
        };
        const baseRequest: VariablePatchRequest = {
            namespace: "client",
            path: "ide.selection",
            operations: [{op: "replace", path: "", value: "next"}],
            invocationId: "invocation-client-identity",
            toolCallId: "valid-call",
        };
        const invalidIds = [
            "   ",
            "a".repeat(513),
            "数".repeat(171),
        ];

        for (const toolCallId of invalidIds) {
            await expect(requester.requestClientVariablePatch(991_001, {...baseRequest, toolCallId}))
                .rejects.toMatchObject({code: "invalid_public_tool_identity"});
            await expect(requester.requestClientVariablePatch(991_001, {...baseRequest, toolCallId}))
                .rejects.toMatchObject({code: "invalid_public_tool_identity"});
        }
        expect(harness.eventHub.metrics(991_001).replayCount).toBe(0);
    });

});

type RelationIdentity = {
    sessionId: number;
    profileKey: string;
};

async function expectRelationsMatchSessionLedger(targetHarness: NeuroAgentHarness, sessionId: number): Promise<void> {
    const snapshot = await targetHarness.getSessionRecovery(sessionId);
    const relations = await targetHarness.getSessionRelations(sessionId);
    const ownerContext = targetHarness.repo.reduce(await targetHarness.repo.readSession(sessionId));

    expect(relations).toEqual({
        sessionId,
        linkedAgents: snapshot.linkedAgents,
        linkedByAgents: snapshot.linkedByAgents,
    });
    expect(sortRelationIdentities(relations.linkedAgents)).toEqual(sortRelationIdentities(ownerContext.linkedAgents.filter((linked) => !linked.detached)));
    expect(sortRelationIdentities(relations.linkedByAgents)).toEqual(await linkedByLedgerIdentities(targetHarness, sessionId));
}

async function linkedByLedgerIdentities(targetHarness: NeuroAgentHarness, sessionId: number): Promise<RelationIdentity[]> {
    const summaries = await targetHarness.repo.listSessions({includeArchived: true, status: "all"});
    const result: RelationIdentity[] = [];
    for (const summary of summaries) {
        if (summary.sessionId === sessionId) {
            continue;
        }
        const ownerSnapshot = await targetHarness.repo.readSession(summary.sessionId);
        const ownerContext = targetHarness.repo.reduce(ownerSnapshot);
        const linked = ownerContext.linkedAgents.find((item) => item.sessionId === sessionId);
        if (!linked || linked.detached || summary.archived) {
            continue;
        }
        result.push({
            sessionId: summary.sessionId,
            profileKey: ownerContext.profileKey,
        });
    }
    return sortRelationIdentities(result);
}

function sortRelationIdentities(items: Iterable<RelationIdentity>): RelationIdentity[] {
    return [...items]
        .map((item) => ({
            sessionId: item.sessionId,
            profileKey: item.profileKey,
        }))
        .sort((left, right) => left.sessionId - right.sessionId);
}

/**
 * 创建测试用 deferred，用于稳定卡住异步 rebuild 窗口。
 */
function createDeferred(): {promise: Promise<void>; resolve: () => void} {
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
        resolve = nextResolve;
    });
    return {promise, resolve};
}

async function waitFor(assertion: () => Promise<void> | void, timeoutMs = 1_000): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error(String(lastError));
}
