import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {
    fauxAssistantMessage,
    fauxText,
    fauxToolCall,
    type AssistantMessageEvent,
    type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {createFauxModels, fauxProviderConfig, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import type {TSchema} from "typebox";
import {Value} from "typebox/value";
import type {AgentMessage, Usage} from "nbook/server/agent/messages/types";
import type {Message as RuntimeMessage} from "nbook/server/agent/messages/types";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {ResolvedPiModel} from "nbook/server/agent/harness/pi-model-metadata";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile as defineRuntimeAgentProfile, normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {builtin, defineProfileTool, pluginTool, toolset} from "nbook/server/agent/profiles/profile-tools";
import {defineLowCodeForm} from "nbook/server/low-code-form";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import type {AgentCatalogSnapshot, AgentProfile, AgentProfileDefinition} from "nbook/server/agent/profiles/types";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {StoredAgentMessage, StoredToolResultMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {encodeFollowUpQueue} from "nbook/server/agent/messages/stored-message-codec";
import {HistorySet, Message, ModelContext, ProfilePrompt, Reminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";
import type {PublishedAgentSessionEvent} from "nbook/server/agent/events/session-event-hub";
import {AGENT_FOLLOW_UP_QUEUE_STATE_KEY, AGENT_MODE_STATE_KEY, AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX, AGENT_TASKS_STATE_KEY, SESSION_SUMMARIZER_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {defineSessionVariable} from "nbook/server/agent/variables/registry";
import {compileVariableDefinitions, resolveVariableDefinitionArtifactPathContext} from "nbook/server/agent/variables/definition-artifact";
import type {VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {closeAllProjects, openProject, projectOccupancy, ProjectNotOpenError, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {projectModuleToken, replaceProjectModulesForTest, type ProjectModule, type ProjectModuleHandle} from "nbook/server/workspace-files/project-module";
import {withWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";
import managedSummarizerProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/summarizer.profile";
import {createRasterTestFixtures} from "nbook/server/agent/test-utils/raster-fixtures";

const managedSummarizerProfile = normalizeAgentProfile(managedSummarizerProfileDefinition);

let pngBytes: Buffer;

beforeAll(async () => {
    ({png: pngBytes} = await createRasterTestFixtures());
});

type LegacyTestProfile<
    TInitialSchema extends TSchema = TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = Omit<AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, undefined, TSummarizerKey, TTools>, "tools" | "toolKeys"> & {
    tools?: ProfileTools;
    allowedToolKeys?: readonly string[];
    mainRunAllowedToolKeys?: readonly string[];
    toolKeys?: readonly string[];
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
        toolKeys,
        ...rest
    } = profile;
    const migratedAllowedToolKeys = [...allowedToolKeys ?? []];
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(migratedAllowedToolKeys),
        toolKeys: toolKeys ?? mainRunAllowedToolKeys,
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

/** 构造 provider iterator / result 各自拒绝的最小 stream，锁定 Harness 错误收口边界。 */
function brokenProviderStream(kind: "iterator" | "result"): AssistantMessageEventStream {
    if (kind === "iterator") {
        return {
            [Symbol.asyncIterator]: () => ({
                next: async (): Promise<IteratorResult<AssistantMessageEvent>> => {
                    throw new Error("provider iterator exploded");
                },
            }),
            result: async () => {
                throw new Error("provider iterator exploded");
            },
        } as unknown as AssistantMessageEventStream;
    }
    return {
        [Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<AssistantMessageEvent>> => ({done: true, value: undefined}),
        }),
        result: async () => {
            throw new Error("provider stream.result exploded");
        },
    } as unknown as AssistantMessageEventStream;
}

/** 使用正常 faux model 元数据，仅替换 runtime stream，保持 Harness 真实解析链。 */
function installBrokenProviderStream(faux: FauxModelsFixture, kind: "iterator" | "result"): () => void {
    const original = faux.runtime.streamSimple;
    faux.runtime.streamSimple = () => brokenProviderStream(kind);
    return () => {
        faux.runtime.streamSimple = original;
    };
}

function visibleMessageText(messages: Array<AgentMessage | StoredAgentMessage>): string {
    return messages.map((message) => storedMessageText(message)).join("\n");
}

class BrokenProfileCatalog extends AgentProfileCatalog {
    constructor(systemRoot: string, _userRoot: string, private readonly issueMessage = "源码错误") {
        super(systemRoot, undefined, undefined, undefined, (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, systemRoot), {install: "workspace/.nbook/agent/profiles"});
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
                    source: "project",
                    builtin: false,
                    loadStatus: "source_error",
                    hasSettingsForm: false,
                    canResetHome: false,
                    creationMode: "public",
                    issue: {
                        code: "source_error",
                        message: this.issueMessage,
                        profileKey: "test.unloadable",
                        source: "project",
                    },
                },
            ],
            issues: snapshot.issues,
        };
    }
}
const testArtifactCompilerRoot = resolve(import.meta.dirname, "../../..");

function createTestProfileCatalog(systemRoot: string, compilerRoot = testArtifactCompilerRoot): AgentProfileCatalog {
    return new AgentProfileCatalog(
        systemRoot,
        undefined,
        undefined,
        undefined,
        (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, compilerRoot),
        {install: "workspace/.nbook/agent/profiles"},
    );
}

function createTestHarness(options: ConstructorParameters<typeof NeuroAgentHarness>[0]): NeuroAgentHarness {
    const definitionArtifactPathContextProvider = options.definitionArtifactPathContextProvider
        ?? createVariableDefinitionArtifactPathContextResolver(testArtifactCompilerRoot);
    return new NeuroAgentHarness({
        ...options,
        definitionArtifactPathContextProvider,
    });
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
        root = await mkdtemp(join(tmpdir(), "nbook-agent-harness-"));
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
        harness = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await harness.dispose();
        try {
            await closeAllProjects();
        } finally {
            resetProjectSessionsForTest();
        }
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

    it("adhoc outputSchema 会让 report_result.data 在模型 schema 与执行层都必填", async () => {
        const outputSchema = {
            type: "object",
            properties: {answer: {type: "string"}},
            required: ["answer"],
            additionalProperties: false,
        };
        let observedParameters: (TSchema & {properties?: Record<string, TSchema>; required?: string[]}) | undefined;
        faux.setResponses([
            (context) => {
                observedParameters = context.tools?.find((tool) => tool.name === "report_result")?.parameters as typeof observedParameters;
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {result: "missing data"}, {id: "adhoc-missing-data"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "ok", data: {answer: "structured"}}, {id: "adhoc-valid-data"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "adhoc",
            initial: {
                systemPrompt: "只返回结构化答案。",
                outputSchema,
            },
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "回答问题"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult).toEqual({result: "ok", data: {answer: "structured"}});
        expect(observedParameters?.required).toEqual(expect.arrayContaining(["result", "data"]));
        expect(observedParameters?.properties?.data).toEqual(outputSchema);
        const reportResults = context.messages.filter((message): message is StoredToolResultMessage => {
            return message.role === "toolResult" && message.toolName === "report_result";
        });
        expect(reportResults).toHaveLength(2);
        expect(reportResults.map((message) => message.isError)).toEqual([true, false]);
        expect(storedMessageText(reportResults[0]!)).toContain("report_result.data 必填");
        expect(visibleMessageText(context.messages)).toContain("report_result.data 必填");
    }, 20_000);

    it("adhoc 显式空 outputSchema 仍要求 data，空对象可以通过校验", async () => {
        const outputSchema = {
            type: "object",
            properties: {},
            additionalProperties: false,
        };
        let observedParameters: (TSchema & {properties?: Record<string, TSchema>; required?: string[]}) | undefined;
        faux.setResponses([
            (context) => {
                observedParameters = context.tools?.find((tool) => tool.name === "report_result")?.parameters as typeof observedParameters;
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {result: "missing data"}, {id: "adhoc-empty-missing-data"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {result: "ok", data: {}}, {id: "adhoc-empty-valid-data"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "adhoc",
            initial: {
                systemPrompt: "返回空结构化对象。",
                outputSchema,
            },
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "返回结果"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult).toEqual({result: "ok", data: {}});
        expect(observedParameters?.required).toEqual(expect.arrayContaining(["result", "data"]));
        expect(observedParameters?.properties?.data).toEqual(outputSchema);
        const reportResults = context.messages.filter((message): message is StoredToolResultMessage => {
            return message.role === "toolResult" && message.toolName === "report_result";
        });
        expect(reportResults).toHaveLength(2);
        expect(reportResults.map((message) => message.isError)).toEqual([true, false]);
        expect(storedMessageText(reportResults[0]!)).toContain("report_result.data 必填");
        expect(visibleMessageText(context.messages)).toContain("report_result.data 必填");
    }, 20_000);

    it("adhoc 未声明 outputSchema 时仍允许只返回 result", async () => {
        let observedParameters: (TSchema & {properties?: Record<string, TSchema>; required?: string[]}) | undefined;
        faux.setResponses([
            (context) => {
                observedParameters = context.tools?.find((tool) => tool.name === "report_result")?.parameters as typeof observedParameters;
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {result: "text-only"}, {id: "adhoc-text-only"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "adhoc",
            initial: {
                systemPrompt: "只返回文本结论。",
            },
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "返回结论"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult).toEqual({result: "text-only"});
        expect(observedParameters?.required).toEqual(["result"]);
        expect(observedParameters?.properties).not.toHaveProperty("data");
        const reportResult = context.messages.find((message): message is StoredToolResultMessage => {
            return message.role === "toolResult" && message.toolName === "report_result";
        });
        expect(reportResult?.isError).toBe(false);
    }, 20_000);

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

    it.each(["iterator", "result"] as const)("provider %s rejection 释放 admission 并只写一个 error lifecycle", async (kind) => {
        await harness.dispose();
        const restoreProvider = installBrokenProviderStream(faux, kind);
        harness = createTestHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.provider-rejection", name: "Provider Rejection"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.provider-rejection",
            initial: {},
        });

        const failed = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: `provider ${kind} failure`},
        });
        expect(failed.status).toBe("error");
        expect(failed.error).toContain(kind === "iterator" ? "provider iterator exploded" : "provider stream.result exploded");

        const failedSnapshot = await harness.repo.readSession(created.sessionId);
        const errorLifecycles = failedSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "error");
        expect(errorLifecycles).toHaveLength(1);

        restoreProvider();
        faux.setResponses([fauxAssistantMessage("recovered")]);
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "retry after provider failure"},
        })).resolves.toMatchObject({status: "completed"});
        const recoveredSnapshot = await harness.repo.readSession(created.sessionId);
        expect(recoveredSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "error")).toHaveLength(1);
        expect(recoveredSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(1);
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
        });

        const result = await harness.getSessionQuery(created.sessionId, {view: "systemPrompt"});

        // 断 config 里的 cinematic（不是 schema 默认 plain），证明 settings 被真正解析注入。
        expect(result.kind === "systemPrompt" ? result.systemPrompt : "").toContain("tone=cinematic");
    });

    it("managed Project 未 open 时 snapshot 不初始化 Project Profile Home", async () => {
        const profileKey = "test.snapshot-home";
        const slug = `snapshot-home-${randomUUID()}`;
        const projectRoot = slug;
        const projectDirectory = join(harness.workspaceRoot, projectRoot);
        const projectHomeMetadataPath = join(projectDirectory, "agents", profileKey, "home.json");
        await mkdir(projectDirectory, {recursive: true});
        await writeFile(join(projectDirectory, "project.yaml"), "kind: novel\ntitle: Snapshot Home\nsummary: ''\n", "utf8");
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
            const created = await harness.repo.createSession({
                profileKey,
                initial: {},
                currentProjectRoot: slug,
            });
            const sessionId = created.metadata.sessionId;

            await expect(harness.getSessionRecovery(sessionId)).resolves.toMatchObject({kind: "recovery"});
            await expect(harness.getSessionQuery(sessionId, {view: "systemPrompt"})).rejects.toBeInstanceOf(ProjectNotOpenError);
            await expect(readFile(projectHomeMetadataPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});

            await openProject(projectWorkspaceRef(projectRoot), {kind: "job", source: "test"}, harness.workspaceRoot);
            const result = await harness.getSessionQuery(sessionId, {view: "systemPrompt"});

            expect(result.kind === "systemPrompt" ? result.systemPrompt : "").toContain("# Snapshot Home");
            await expect(readFile(projectHomeMetadataPath, "utf8")).resolves.toContain(profileKey);
        } finally {
            await closeProjectForTest(projectRoot).catch(() => undefined);
            await rm(projectRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        }
    });

    it("dangling Session 可读取，invocation 返回稳定错误，清除 Current Project 后恢复执行", async () => {
        const projectRoot = `missing-${randomUUID()}`;
        const created = await harness.repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: projectRoot,
        });

        await expect(harness.listSessions({scope: "all"})).resolves.toContainEqual(expect.objectContaining({
            sessionId: created.metadata.sessionId,
            currentProjectRoot: projectRoot,
        }));
        await expect(harness.getSessionRecovery(created.metadata.sessionId)).resolves.toMatchObject({
            summary: {
                sessionId: created.metadata.sessionId,
                currentProjectRoot: projectRoot,
            },
        });
        await expect(harness.invokeAgent({
            sessionId: created.metadata.sessionId,
            mode: "prompt",
            message: {text: "continue"},
        })).rejects.toMatchObject({
            name: "SessionCurrentProjectError",
            code: "current_project_missing",
            projectRoot,
        });

        const rebound = await harness.updateCurrentProject(created.metadata.sessionId, null);
        expect(rebound.currentProjectRoot).toBeUndefined();
        expect((await harness.repo.readSession(created.metadata.sessionId)).metadata).not.toHaveProperty("migrationReview");
        faux.setResponses([fauxAssistantMessage(fauxText("continued"))]);
        await expect(harness.invokeAgent({
            sessionId: created.metadata.sessionId,
            mode: "prompt",
            message: {text: "continue after clearing"},
        })).resolves.toMatchObject({status: "completed"});
    });

    it("migration review Session 可读取，未打开但存在的 Project 可重绑并恢复执行", async () => {
        const staleProjectRoot = `ambiguous-${randomUUID()}`;
        const targetProjectRoot = `rebound-${randomUUID()}`;
        const created = await harness.repo.createSession({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: staleProjectRoot,
        });
        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.metadata.sessionId)}.jsonl`);
        const source = await readFile(sessionPath, "utf8");
        const migrationReview = `"migrationReview":{"status":"required","reason":"current_project_unresolved"}`;
        await writeFile(sessionPath, source.replace(`"currentProjectRoot":"${staleProjectRoot}"`, migrationReview), "utf8");

        await expect(harness.listSessions({scope: "all"})).resolves.toContainEqual(expect.objectContaining({
            sessionId: created.metadata.sessionId,
            migrationReview: {status: "required", reason: "current_project_unresolved"},
        }));
        await expect(harness.getSessionRecovery(created.metadata.sessionId)).resolves.toMatchObject({
            summary: {
                sessionId: created.metadata.sessionId,
                migrationReview: {status: "required", reason: "current_project_unresolved"},
            },
        });
        await expect(harness.invokeAgent({
            sessionId: created.metadata.sessionId,
            mode: "prompt",
            message: {text: "continue"},
        })).rejects.toMatchObject({
            name: "SessionCurrentProjectError",
            code: "migration_review_required",
            projectRoot: undefined,
        });
        await expect(harness.listSessions({scope: "all", recovery: "required"})).resolves.toContainEqual(
            expect.objectContaining({sessionId: created.metadata.sessionId}),
        );

        const targetDirectory = join(root, targetProjectRoot);
        await mkdir(targetDirectory, {recursive: true});
        await writeFile(join(targetDirectory, "project.yaml"), "kind: novel\ntitle: Rebound\nsummary: ''\n", "utf8");
        expect(projectOccupancy(projectWorkspaceRef(targetProjectRoot))).toBeNull();

        await expect(harness.updateCurrentProject(created.metadata.sessionId, targetProjectRoot)).resolves.toMatchObject({
            currentProjectRoot: targetProjectRoot,
        });
        const rebound = await harness.repo.readSession(created.metadata.sessionId);
        expect(rebound.metadata.currentProjectRoot).toBe(targetProjectRoot);
        expect(rebound.metadata).not.toHaveProperty("migrationReview");
        expect(projectOccupancy(projectWorkspaceRef(targetProjectRoot))).toBeNull();

        faux.setResponses([fauxAssistantMessage(fauxText("continued"))]);
        await expect(harness.invokeAgent({
            sessionId: created.metadata.sessionId,
            mode: "prompt",
            message: {text: "continue after rebinding"},
        })).resolves.toMatchObject({status: "completed"});
    });

    it("Current Project 重绑拒绝不存在的 Project 且不修改 Session metadata", async () => {
        const missingProjectRoot = `missing-rebind-${randomUUID()}`;
        const created = await harness.repo.createSession({
            profileKey: "leader.default",
            initial: {},
        });

        await expect(harness.updateCurrentProject(created.metadata.sessionId, missingProjectRoot)).rejects.toMatchObject({
            name: "ProjectLifecycleError",
            code: "PROJECT_NOT_FOUND",
        });
        await expect(harness.repo.readSession(created.metadata.sessionId)).resolves.toMatchObject({
            metadata: expect.not.objectContaining({currentProjectRoot: missingProjectRoot}),
        });
    });

    it("Current Project 重绑检查与写入原子阻止并发 invocation admission", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const rebindReadStarted = createDeferred();
        const releaseRebindRead = createDeferred();
        const providerStarted = createDeferred();
        const releaseProvider = createDeferred();
        let providerHasStarted = false;
        const originalReadSession = harness.repo.readSession.bind(harness.repo);
        let blockNextRead = true;
        vi.spyOn(harness.repo, "readSession").mockImplementation(async (sessionId) => {
            if (sessionId === created.sessionId && blockNextRead) {
                blockNextRead = false;
                rebindReadStarted.resolve();
                await releaseRebindRead.promise;
            }
            return originalReadSession(sessionId);
        });
        faux.setResponses([
            async () => {
                providerHasStarted = true;
                providerStarted.resolve();
                await releaseProvider.promise;
                return fauxAssistantMessage(fauxText("done"));
            },
        ]);

        const rebinding = harness.updateCurrentProject(created.sessionId, null);
        await rebindReadStarted.promise;
        const invoking = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run after rebind"},
        });
        try {
            await Promise.resolve();
            await Promise.resolve();
            expect(providerHasStarted).toBe(false);

            releaseRebindRead.resolve();
            await rebinding;
            await providerStarted.promise;
            releaseProvider.resolve();
            await expect(invoking).resolves.toMatchObject({status: "completed"});
        } finally {
            releaseRebindRead.resolve();
            releaseProvider.resolve();
            await Promise.allSettled([rebinding, invoking]);
        }
    });

    it("session recovery 通过 summary 暴露累计 usage，并保留 context usage", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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

    it("新建 Project Session 只持久化 Current Project root", async () => {
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

        const created = await harness.repo.createSession({
            profileKey: "test.workspace-container",
            initial: {},
            currentProjectRoot: "novel-7",
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.metadata.sessionId));

        expect(context.currentProjectRoot).toBe("novel-7");
    });

    it("/new 创建的新 Session 继承 Current Project root", async () => {
        const projectRoot = join(root, "novel-7");
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Novel 7\nsummary: ''\n", "utf8");
        await openProject(projectWorkspaceRef("novel-7"), {kind: "job", source: "test"}, harness.workspaceRoot);
        try {
            const created = await harness.createAgent({
                profileKey: "leader.default",
                initial: {},
                currentProjectRoot: "novel-7",
            });

            const result = await harness.runCommand(created.sessionId, {command: "new"});
            const context = harness.repo.reduce(await harness.repo.readSession(result.sessionId));

            expect(result.kind).toBe("created_session");
            expect(context.currentProjectRoot).toBe("novel-7");
        } finally {
            await closeProjectForTest("novel-7").catch(() => undefined);
        }
    });

    it("轻控制 command 返回 live state，mode no-op 不追加 entry", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "page-missing-system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const reloadedSnapshot = await restored.getSessionRecovery(created.sessionId);
        const reloadedSessions = await restored.listSessions({});
        const waitingSessions = await restored.listSessions({status: "waiting"});
        const waitingPage = await restored.listSessionPage({status: "waiting", limit: 10});
        const idleSessions = await restored.listSessions({status: "idle"});
        await expect(restored.updateCurrentProject(created.sessionId, null)).rejects.toMatchObject({
            code: "current_project_rebind_forbidden",
        });
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
            title: "Alpha",
        });
        const second = await harness.createAgent({
            profileKey: "leader.paged",
            initial: {},
            title: "Beta Needle",
        });
        await harness.createAgent({
            profileKey: "leader.paged",
            initial: {},
            title: "Gamma",
        });

        const firstPage = await harness.listSessionPage({profileGroup: "leader", status: "active", limit: 2});
        const secondPage = await harness.listSessionPage({profileGroup: "leader", status: "active", limit: 2, offset: firstPage.nextOffset});
        const searchPage = await harness.listSessionPage({profileGroup: "leader", status: "active", search: "needle", limit: 10});

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

    it("listSessionPage 对 recovery=required 先筛选再分页", async () => {
        const reviewIds: number[] = [];
        for (const projectRoot of ["ambiguous-one", "ambiguous-two", "ambiguous-three"]) {
            const session = await harness.repo.createSession({
                profileKey: "leader.default",
                initial: {},
                currentProjectRoot: projectRoot,
                title: projectRoot,
            });
            reviewIds.push(session.metadata.sessionId);
            const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
            const source = await readFile(sessionPath, "utf8");
            await writeFile(
                sessionPath,
                source.replace(
                    `"currentProjectRoot":"${projectRoot}"`,
                    '"migrationReview":{"status":"required","reason":"current_project_unresolved"}',
                ),
                "utf8",
            );
        }
        await harness.repo.createSession({
            profileKey: "leader.default",
            initial: {},
            title: "does not need recovery",
        });

        const firstPage = await harness.listSessionPage({scope: "all", recovery: "required", limit: 2});
        const secondPage = await harness.listSessionPage({
            scope: "all",
            recovery: "required",
            limit: 2,
            offset: firstPage.nextOffset,
        });

        expect(firstPage).toMatchObject({total: 3, offset: 0, limit: 2, hasMore: true, nextOffset: 2});
        expect(secondPage).toMatchObject({total: 3, offset: 2, limit: 2, hasMore: false});
        expect([...firstPage.items, ...secondPage.items].map((item) => item.sessionId).sort((left, right) => left - right))
            .toEqual(reviewIds.sort((left, right) => left - right));
        expect([...firstPage.items, ...secondPage.items]).toEqual(expect.arrayContaining([
            expect.objectContaining({
                migrationReview: {status: "required", reason: "current_project_unresolved"},
            }),
        ]));
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
        });
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "deleted-system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const page = await restored.listSessionPage({limit: 10});

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
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "deleted-system-profiles"), root),
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

        const completed = results.filter((result) => result.status === "fulfilled" && result.value.status === "completed");
        const notAccepted = results.filter((result) => result.status === "fulfilled" && result.value.status === "error");
        const snapshot = await restored.repo.readSession(created.sessionId);
        const context = restored.repo.reduce(snapshot);
        const resolutionMessages = context.messages.filter((message) => message.role === "toolResult" && messageText(message as never).includes("Alice"));
        const resumedLifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.invocationId === waiting.invocationId && entry.status === "resumed");

        expect(completed).toHaveLength(1);
        expect(notAccepted).toHaveLength(1);
        expect(notAccepted[0]).toMatchObject({
            value: {
                acceptance: {state: "none"},
                error: "当前 Session 状态不允许执行该操作。",
            },
        });
        expect(completed[0]).toMatchObject({value: {invocationId: waiting.invocationId}});
        expect(resolutionMessages).toHaveLength(1);
        expect(resumedLifecycles).toHaveLength(1);
    }, 120_000);

    it("pending approval 没有可靠 waiting lifecycle 时返回未接受", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-unrecoverable",
                name: "Approval Unrecoverable",
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
                    questions: [{question: "继续？"}],
                }, {id: "ask-unrecoverable"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-unrecoverable",
            initial: {},
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
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "restored-system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const rejected = await restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-unrecoverable",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });
        expect(rejected).toMatchObject({
            status: "error",
            acceptance: {state: "none"},
            error: "当前 Session 状态不允许执行该操作。",
        });
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
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = createTestHarness({
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

    it("后端恢复 waiting 后 abort 和 resolution 并发只产生一份 resolution 与 aborted 终态", async () => {
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
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = createTestHarness({
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

        const snapshot = await restored.repo.readSession(created.sessionId);
        const context = restored.repo.reduce(snapshot);
        const resolutionMessages = context.messages.filter((message) => {
            return message.role === "toolResult" && message.toolCallId === "ask-abort-resolution-race";
        });
        const terminalStatuses = snapshot.entries.flatMap((entry) => {
            return entry.type === "invocation_lifecycle"
                && entry.invocationId === waiting.invocationId
                && (entry.status === "resumed" || entry.status === "aborted")
                ? [entry.status]
                : [];
        });

        expect(results[0]).toMatchObject({status: "fulfilled", value: {status: "aborted"}});
        expect(results[1]).toMatchObject({status: "fulfilled", value: {status: "error"}});
        expect(resolutionMessages).toHaveLength(1);
        expect(terminalStatuses.filter((status) => status === "resumed").length).toBeLessThanOrEqual(1);
        expect(terminalStatuses.filter((status) => status === "aborted")).toHaveLength(1);
        expect(terminalStatuses.at(-1)).toBe("aborted");
    }, 45_000);

    it("新 harness 对未完成普通 running snapshot 投影为 interrupted", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: "lost-running",
            status: "start",
        });
        const restored = createTestHarness({
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
            ["user"],
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
            "user",
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
            "user",
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
        harness = createTestHarness({
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
        const smallWindowHarness = createTestHarness({
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
        harness = createTestHarness({
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
        harness = createTestHarness({
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
        harness = createTestHarness({
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
        harness = createTestHarness({
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
        harness = createTestHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => defaultModel,
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        harness = createTestHarness({
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

    it("invoke modelKey 只覆盖本次运行，下一次恢复 session 默认模型", async () => {
        const defaultModel = {
            ...faux.getModel(),
            id: "invoke-default-model",
            name: "Invoke Default Model",
            provider: "faux",
            providerConfigId: "faux",
        };
        const overrideModel = {
            ...faux.getModel(),
            id: "invoke-override-model",
            name: "Invoke Override Model",
            provider: "faux",
            providerConfigId: "faux",
        };
        const runtimeModelIds: string[] = [];
        harness = createTestHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (_config, _profileKey, override) => {
                if (override?.modelKey === "faux/invoke-override-model") return overrideModel;
                if (!override?.modelKey || override.modelKey === "faux/invoke-default-model") return defaultModel;
                throw new Error(`模型未启用或不存在：${override.modelKey}`);
            },
            runtimeResolver: (_config, model) => {
                runtimeModelIds.push(model.id);
                return faux.runtime;
            },
            enableSessionSummarizer: false,
        });
        faux.setResponses([
            fauxAssistantMessage("override done"),
            fauxAssistantMessage("default done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });

        const overridden = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "use override"},
            modelKey: "faux/invoke-override-model",
        });

        expect(overridden.status).toBe("completed");
        expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
            providerConfigId: "faux",
            modelId: "invoke-default-model",
        });

        const restored = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "use session default"},
        });

        expect(restored.status).toBe("completed");
        expect(runtimeModelIds).toEqual(["invoke-override-model", "invoke-default-model"]);
        const modelChanges = (await harness.repo.readSession(created.sessionId)).entries.filter((entry) => entry.type === "model_change");
        expect(modelChanges).toHaveLength(1);
        expect(modelChanges[0]).toEqual(expect.objectContaining({
            model: {providerConfigId: "faux", modelId: "invoke-default-model"},
        }));
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
        harness = createTestHarness({
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

        expect((await harness.getSessionRecovery(created.sessionId)).model).toBeNull();

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
        harness = createTestHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => resolvedModel,
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        harness = createTestHarness({
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
        harness = createTestHarness({
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
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedRequestOptions[0]).toEqual(expect.objectContaining({
            maxRetries: 5,
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
        const privateSession = await harness.createAgent({profileKey: "test.private-shadow", initial: {}});
        const globalSession = await harness.createAgent({profileKey: "test.global-shadow", initial: {}});

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

    it("profile 自带审批工具 suspend 后批准会真实执行并以执行结果落库", async () => {
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
                    content: [{type: "text", text: "private approval executed"}],
                    details: {},
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
        const created = await harness.createAgent({
            profileKey: "test.private-approval",
            initial: {},
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
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
        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("approved done");
        // Task 111 契约：批准不是结果，执行才是——approvalRequired 工具在批准后真实执行
        expect(privateApprovalExecuted).toBe(true);
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
                                sessionId: sourceSession.snapshot.metadata.sessionId,
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
        harness = createTestHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        // 使用真实受管 Profile 覆盖 Harness 的最小内存版本，锁定生产发布路径不再跨 session 写回。
        harness.profiles.register(managedSummarizerProfile, false);
        const managedRuntimeHooks = managedSummarizerProfile.runtime?.hooks.flatMap((item) => "kind" in item ? item.hooks : [item]) ?? [];
        expect(managedRuntimeHooks.some((hook) => hook.stage === "settleRun")).toBe(false);
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
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        expect(result.status).toBe("completed");
        await harness.drainBackgroundTasks();
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
        expect((await harness.listSessions({})).map((session) => session.sessionId)).toEqual([created.sessionId]);
        expect((await harness.listSessions({includeSystem: true})).map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
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
        harness = createTestHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(managedSummarizerProfile, false);
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
        harness = createTestHarness({
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
        expect((await harness.listSessions({includeSystem: true})).map((session) => session.sessionId)).toEqual([created.sessionId]);
    });

    it("summarizer sourceInvocation interval 会按 source prompt turn 间隔触发", async () => {
        harness = createTestHarness({
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
        harness = createTestHarness({
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
        harness = createTestHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: true,
        });
        harness.profiles.register(managedSummarizerProfile, false);
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
        const projectRoot = "alpha";
        const projectDirectory = join(workspaceRoot, projectRoot);
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
                await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
                await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({models: fauxProviderConfig(faux).models}), "utf-8");
                await mkdir(join(projectDirectory, ".agent", "plan"), {recursive: true});
                await mkdir(join(projectDirectory, ".nbook"), {recursive: true});
                await writeFile(join(projectDirectory, "project.yaml"), "kind: novel\ntitle: Alpha\nsummary: ''\n", "utf-8");
                await writeFile(join(projectDirectory, ".nbook", "config.json"), "{}", "utf-8");
                await openProject(projectWorkspaceRef(projectRoot), {kind: "job", source: "test"}, harness.workspaceRoot);
                const created = await harness.createAgent({
                    profileKey: "test.plan-mode-preview",
                    initial: {},
                    currentProjectRoot: "alpha",
                });
                await harness.runCommand(created.sessionId, {
                    command: "mode",
                    mode: "plan",
                });
                const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
                const modeState = context.customState[AGENT_MODE_STATE_KEY] as Record<string, unknown>;

                expect(modeState.mode).toBe("plan");
                expect(modeState.workDirectory).toBe(".agent/plan");

                await writeFile(join(projectDirectory, ".agent", "plan", "preview.md"), "# Preview Plan\n\n- one\n", "utf-8");
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
                await closeProjectForTest(projectRoot).catch(() => undefined);
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
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "restart-system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        // 列表路径识别为 waiting（修复前注入写审批在此路径被漏认，会显示 idle）
        const waitingSessions = await restored.listSessions({status: "waiting"});
        const idleSessions = await restored.listSessions({status: "idle"});
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
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            title: "  Custom Child Title  ",
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
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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

    it("create 与 archive 并发时由关系队列串行，账本保留 link 但 effective view 隐藏归档端", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
            detached: false,
        }));
    });

    it("旧数据中 active link 指向 archived target 时所有当前查询都隐藏关系", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        await harness.repo.appendEntry(child.sessionId, {
            type: "session_archived",
            reason: "legacy archive without detach",
        });

        const restored = createTestHarness({
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

    it("子 Session 未显式传 Project 时继承父 Session 的 Current Project", async () => {
        const projectRoot = join(root, "novel-one");
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Novel One\nsummary: ''\n", "utf8");
        await openProject(projectWorkspaceRef("novel-one"), {kind: "job", source: "test"}, harness.workspaceRoot);
        try {
            const parent = await harness.createAgent({
                profileKey: "leader.default",
                initial: {},
                currentProjectRoot: "novel-one",
            });
            const child = await harness.createAgent({
                profileKey: "leader.default",
                initial: {},
                parentSessionId: parent.sessionId,
            });

            const childSnapshot = await harness.getSessionRecovery(child.sessionId);

            expect(childSnapshot.summary.currentProjectRoot).toBe("novel-one");
            expect(childSnapshot.linkedByAgents).toEqual([
                expect.objectContaining({
                    sessionId: parent.sessionId,
                    currentProjectRoot: "novel-one",
                }),
            ]);
        } finally {
            await closeProjectForTest("novel-one").catch(() => undefined);
        }
    });

    it("getSessionRelations 返回与 snapshot 一致的轻量关联关系", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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

    it("关联 Session 文件缺失时保留主 Session，并分别统计 owned 与 owner 方向", async () => {
        const parentWithMissingChild = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const missingChild = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parentWithMissingChild.sessionId,
        });
        await harness.getSessionRelations(parentWithMissingChild.sessionId);
        await rm(join(root, ".nbook", "agent", "sessions", `${String(missingChild.sessionId)}.jsonl`));

        await expect(harness.getSessionRelations(parentWithMissingChild.sessionId)).resolves.toEqual({
            sessionId: parentWithMissingChild.sessionId,
            linkedAgents: [],
            linkedByAgents: [],
            unavailableLinkedAgents: 1,
        });
        await expect(harness.getSessionRecovery(parentWithMissingChild.sessionId)).resolves.toMatchObject({
            summary: expect.objectContaining({sessionId: parentWithMissingChild.sessionId}),
            linkedAgents: [],
            linkedByAgents: [],
            unavailableLinkedAgents: 1,
        });

        const missingOwner = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const childWithMissingOwner = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: missingOwner.sessionId,
        });
        await harness.getSessionRelations(childWithMissingOwner.sessionId);
        await rm(join(root, ".nbook", "agent", "sessions", `${String(missingOwner.sessionId)}.jsonl`));

        await expect(harness.getSessionRelations(childWithMissingOwner.sessionId)).resolves.toEqual({
            sessionId: childWithMissingOwner.sessionId,
            linkedAgents: [],
            linkedByAgents: [],
            unavailableLinkedAgents: 1,
        });
        await expect(harness.getSessionRecovery(childWithMissingOwner.sessionId)).resolves.toMatchObject({
            summary: expect.objectContaining({sessionId: childWithMissingOwner.sessionId}),
            linkedAgents: [],
            linkedByAgents: [],
            unavailableLinkedAgents: 1,
        });
    });

    it("主 Session 自身缺失时 recovery 仍返回 SESSION_NOT_FOUND", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        await rm(join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`));

        await expect(harness.getSessionRecovery(created.sessionId)).rejects.toMatchObject({
            name: "AgentSessionNotFoundError",
            code: "SESSION_NOT_FOUND",
            sessionId: created.sessionId,
        });
    });

    it("relation index rebuild 期间创建 child 不会丢失 pending link", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const blocker = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        const blocker = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        });
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);

        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, child.sessionId);

        await harness.detachAgent(child.sessionId, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, parent.sessionId);
        await expectRelationsMatchSessionLedger(harness, child.sessionId);

        const restored = createTestHarness({
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
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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

    it("反向绑定扫描不受 Current Project 重绑差异影响", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        await harness.repo.appendEntry(parent.sessionId, {
            type: "current_project_change",
            projectRoot: "novel-one",
        });

        const childSnapshot = await harness.getSessionRecovery(child.sessionId);

        expect(childSnapshot.summary.currentProjectRoot).toBeUndefined();
        expect(childSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                currentProjectRoot: "novel-one",
            }),
        ]);
    });

    it("detachAgent 会通知被解绑 session 拉完整 snapshot", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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

    it("create_agent 子 Session 首次运行使用父 Session Current Project 的默认模型", async () => {
        const projectRoot = join(root, "child-workspace").replaceAll("\\", "/");
        const childProvider = fauxProviderConfig(faux, {providerConfigId: "project-provider", modelId: "project-model"});
        await mkdir(join(projectRoot, ".nbook"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Child Workspace\nsummary: ''\n", "utf8");
        await writeFile(join(projectRoot, ".nbook", "config.json"), JSON.stringify({
            models: childProvider.models,
        }, null, 4), "utf8");

        const observedDefaultModelKeys: Array<string | null> = [];
        harness = createTestHarness({
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
        await openProject(projectWorkspaceRef("child-workspace"), {kind: "job", source: "test"}, harness.workspaceRoot);
        try {
            const parent = await harness.createAgent({
                profileKey: "leader.default",
                initial: {},
                currentProjectRoot: "child-workspace",
            });
            const child = await harness.createAgent({
                profileKey: "leader.default",
                initial: {},
                parentSessionId: parent.sessionId,
            });

            await harness.invokeAgent({
                sessionId: child.sessionId,
                mode: "prompt",
                message: {text: "use default"},
            });

            expect(observedDefaultModelKeys).toContain("project-provider/project-model");
        } finally {
            await closeProjectForTest("child-workspace").catch(() => undefined);
        }
    });

    it("Session Current Project 拒绝绝对外部路径", async () => {
        const externalProjectRoot = resolve(root, "outside", "external-project").replaceAll("\\", "/");
        await expect(harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            currentProjectRoot: externalProjectRoot,
        })).rejects.toThrow();
    });

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
        });
        const child = await harness.createAgent({
            profileKey: "test.invoke-child",
            initial: {},
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
                sessionId: child.sessionId,
                finalMessage: "child done",
                data: {
                    answer: "structured child data",
                },
            }),
        }));
        expect(storedMessageText(toolResult!)).toBe("child done");
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

    it("session snapshot 暴露 linked agents 与 pending approval，Waiting 状态拒绝新消息入队", async () => {
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
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        const registered = await harness.uploadSessionAttachment(parent.sessionId, {
            bytes: pngBytes,
            mimeType: "image/png",
            name: "queued.png",
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
                text: `queued${serializeAgentImageMarkdown("queued.png", registered.target)}`,
            },
            title: "Queued Follow-up Title",
        });
        const steered = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "steer",
            message: {text: "adjust"},
        });
        const backgroundRejected = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "background must not queue"},
            queueIfBusy: false,
        });

        const snapshot = await harness.getSessionRecovery(parent.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(queued).toMatchObject({status: "error", acceptance: {state: "not_accepted"}});
        expect(steered).toMatchObject({status: "error", acceptance: {state: "not_accepted"}});
        expect(backgroundRejected).toMatchObject({status: "error", acceptance: {state: "not_accepted"}});
        expect(snapshot.pendingUserInputs[0]).toEqual(expect.objectContaining({
            toolCallId: "ask-snapshot",
            toolName: "request_user_input",
            args: expect.objectContaining({kind: "generic"}),
        }));
        expect(snapshot.followUpQueue.items).toEqual([]);
        expect(snapshot.steerQueue).toEqual({
            items: [],
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

    it("system followup 持久化调用方并以 custom_message 写入 durable entry", async () => {
        const toolStarted = createDeferred();
        const releaseTool = createDeferred();
        harness.tools.register({
            key: "system_followup_gate",
            name: "system_followup_gate",
            label: "System Follow-up Gate",
            description: "让系统回流在当前 invocation 忙碌时排队。",
            parameters: Type.Object({}),
            async execute() {
                toolStarted.resolve();
                await releaseTool.promise;
                return {
                    content: [{type: "text", text: "released"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.system-followup",
                name: "System Follow-up",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["system_followup_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("system_followup_gate", {}, {id: "system-followup-gate"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("原始 invocation 完成"),
            fauxAssistantMessage("已处理系统回流"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.system-followup",
            initial: {},
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "开始后台任务"},
        });
        try {
            await toolStarted.promise;
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "<system-reminder>后台 Workflow 完成</system-reminder>"},
                caller: {kind: "system"},
                messageIdentity: "system",
            });
            const queueItemId = queued.queuedItem?.id;
            expect(queued).toMatchObject({
                status: "waiting",
                acceptance: {state: "queued"},
                queuedItem: {kind: "followup"},
            });
            expect(queueItemId).toEqual(expect.any(String));
            const queuedContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(queuedContext.customState[AGENT_FOLLOW_UP_QUEUE_STATE_KEY]).toMatchObject({
                status: "ready",
                items: [{id: queueItemId, caller: {kind: "system"}, messageIdentity: "system"}],
            });

            releaseTool.resolve();
            await running;

            const entries = (await harness.repo.readSession(created.sessionId)).entries;
            expect(entries).toContainEqual(expect.objectContaining({
                type: "custom_message",
                visibleToModel: true,
                sourceQueueItemId: queueItemId,
                message: expect.objectContaining({role: "user"}),
            }));
            expect(entries).not.toContainEqual(expect.objectContaining({
                type: "message",
                sourceQueueItemId: queueItemId,
            }));
        } finally {
            releaseTool.resolve();
            await running.catch(() => undefined);
        }
    });

    it("durable system follow-up 以稳定 deliveryId 在 queue 和 committed entry 双重去重", async () => {
        const toolStarted = createDeferred();
        const releaseTool = createDeferred();
        harness.tools.register({
            key: "durable_system_followup_gate",
            name: "durable_system_followup_gate",
            label: "Durable System Follow-up Gate",
            description: "让 durable system follow-up 在当前 invocation 忙碌时排队。",
            parameters: Type.Object({}),
            async execute() {
                toolStarted.resolve();
                await releaseTool.promise;
                return {
                    content: [{type: "text", text: "released"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.durable-system-followup",
                name: "Durable System Follow-up",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["durable_system_followup_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("durable_system_followup_gate", {}, {id: "durable-system-followup-gate"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("原始 invocation 完成"),
            fauxAssistantMessage("durable system follow-up 已处理"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.durable-system-followup",
            initial: {},
        });
        const delivery = {
            sessionId: created.sessionId,
            text: "<system-reminder>后台 Job 完成</system-reminder>",
            deliveryId: "delivery-job-1",
            clientMessageId: "d0fe20a9-939f-40f0-8263-fd0bf6d5e640",
        };

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "开始后台任务"},
        });
        try {
            await toolStarted.promise;
            await expect(harness.enqueueDurableSystemFollowUp(delivery)).resolves.toMatchObject({
                state: "queued",
                deliveryId: delivery.deliveryId,
            });
            await expect(harness.enqueueDurableSystemFollowUp(delivery)).resolves.toMatchObject({
                state: "queued",
                deliveryId: delivery.deliveryId,
            });
            const queued = harness.repo.reduce(await harness.repo.readSession(created.sessionId))
                .customState[AGENT_FOLLOW_UP_QUEUE_STATE_KEY] as {items: Array<{id: string}>};
            expect(queued.items).toEqual([expect.objectContaining({id: delivery.deliveryId})]);

            releaseTool.resolve();
            await running;
            await harness.drainBackgroundTasks();

            await expect(harness.enqueueDurableSystemFollowUp(delivery)).resolves.toMatchObject({
                state: "persisted",
                deliveryId: delivery.deliveryId,
            });
            const entries = (await harness.repo.readSession(created.sessionId)).entries;
            expect(entries.filter((entry) => entry.type === "custom_message"
                && entry.sourceQueueItemId === delivery.deliveryId)).toHaveLength(1);
        } finally {
            releaseTool.resolve();
            await running.catch(() => undefined);
        }
    });

    it("Harness 重启后自动 drain 已持久化的 ready follow-up queue", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const deliveryId = "delivery-restart-1";
        await harness.repo.appendEntry(created.sessionId, {
            type: "custom",
            key: AGENT_FOLLOW_UP_QUEUE_STATE_KEY,
            value: encodeFollowUpQueue({
                status: "ready",
                items: [{
                    id: deliveryId,
                    clientMessageId: "2f9282c6-6dfc-4394-92fc-60a307d66a65",
                    kind: "followup",
                    message: {
                        content: [{type: "text", text: "<system-reminder>重启后继续回流</system-reminder>"}],
                    },
                    caller: {kind: "system"},
                    messageIdentity: "system",
                    createdAt: 1,
                }],
            }),
        });
        await harness.dispose();
        faux.setResponses([fauxAssistantMessage("重启回流已处理")]);
        harness = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        await harness.drainBackgroundTasks();

        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(snapshot.entries.filter((entry) => entry.type === "custom_message"
            && entry.sourceQueueItemId === deliveryId)).toHaveLength(1);
        expect(harness.repo.reduce(snapshot).customState[AGENT_FOLLOW_UP_QUEUE_STATE_KEY]).toMatchObject({
            status: "ready",
            items: [],
        });
    });

    it("idle system invocation 直接写入 custom_message，不伪装成用户消息", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.system-direct",
                name: "System Direct",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("系统回流已收到")]);
        const created = await harness.createAgent({
            profileKey: "test.system-direct",
            initial: {},
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "<system-reminder>后台 Workflow 完成</system-reminder>"},
            caller: {kind: "system"},
            messageIdentity: "system",
        });
        expect(result.status).toBe("completed");
        const entries = (await harness.repo.readSession(created.sessionId)).entries;
        expect(entries).toContainEqual(expect.objectContaining({
            type: "custom_message",
            visibleToModel: true,
            message: expect.objectContaining({role: "user"}),
        }));
        expect(entries).not.toContainEqual(expect.objectContaining({
            type: "message",
            origin: "prompt",
            message: expect.objectContaining({role: "user"}),
        }));
    });

    it("排队 followup 保留 invocation modelKey 且不修改 session 默认模型", async () => {
        const defaultModel = {
            ...faux.getModel(),
            id: "queued-default-model",
            providerConfigId: "faux",
        };
        const overrideModel = {
            ...faux.getModel(),
            id: "queued-override-model",
            providerConfigId: "faux",
        };
        const runtimeModelIds: string[] = [];
        harness = createTestHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (_config, _profileKey, override) => {
                if (override?.modelKey === "faux/queued-override-model") return overrideModel;
                if (!override?.modelKey || override.modelKey === "faux/queued-default-model") return defaultModel;
                throw new Error(`模型未启用或不存在：${override.modelKey}`);
            },
            runtimeResolver: (_config, model) => {
                runtimeModelIds.push(model.id);
                return faux.runtime;
            },
            enableSessionSummarizer: false,
        });
        const toolStarted = createDeferred();
        const releaseTool = createDeferred();
        harness.tools.register({
            key: "queue_model_gate",
            name: "queue_model_gate",
            label: "Queue Model Gate",
            description: "保持首个 invocation 运行中。",
            parameters: Type.Object({}),
            async execute() {
                toolStarted.resolve();
                await releaseTool.promise;
                return {content: [{type: "text", text: "released"}], details: {}};
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.queued-model", name: "Queued Model"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["queue_model_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall("queue_model_gate", {}, {id: "queue-model-gate"})], {stopReason: "toolUse"}),
            fauxAssistantMessage("first completed"),
            fauxAssistantMessage("followup completed"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.queued-model",
            initial: {},
        });
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });

        try {
            await toolStarted.promise;
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: "run with override"},
                modelKey: "faux/queued-override-model",
            });
            expect(queued.status).toBe("waiting");
            releaseTool.resolve();
            await expect(running).resolves.toMatchObject({status: "completed"});
            expect(runtimeModelIds).toEqual(["queued-default-model", "queued-override-model"]);
            expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).model).toEqual({
                providerConfigId: "faux",
                modelId: "queued-default-model",
            });
        } finally {
            releaseTool.resolve();
            await running.catch(() => undefined);
        }
    });

    it("waiting_user 期间拒绝 steer，resolution 后不会注入未接受正文", async () => {
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
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const rejected = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            clientMessageId: randomUUID(),
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
        expect(rejected).toMatchObject({
            status: "error",
            acceptance: {state: "not_accepted"},
            errorPhase: "prepare",
        });
        expect(continued.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const assistantText = [...context.messages].reverse().find((message) => message.role === "assistant");
        expect(assistantText ? messageText(assistantText as never) : "").not.toContain("adjust while waiting");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        const recovery = await harness.getSessionRecovery(created.sessionId);
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(recovery.steerQueue).toEqual({items: [], omittedItems: 0});
    });

    it("idle session 拒绝显式 steer 和 followUp，避免生成无法消费的队列", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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

    it("waiting abort 的 lifecycle 持久化失败会恢复 waiting 并允许重试", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-waiting-retry",
                name: "Abort Waiting Retry",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage([
            fauxToolCall("request_user_input", {
                questions: [{question: "Retry?"}],
            }, {id: "abort-waiting-retry"}),
        ], {stopReason: "toolUse"})]);
        const created = await harness.createAgent({profileKey: "test.abort-waiting-retry", initial: {}});
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const realAppendEntry = harness.repo.appendEntry.bind(harness.repo);
        const appendEntrySpy = vi.spyOn(harness.repo, "appendEntry").mockImplementationOnce(async (...args: Parameters<JsonlSessionRepository["appendEntry"]>) => {
            const entry = args[1];
            if (entry.type === "invocation_lifecycle" && entry.status === "aborted") {
                throw new Error("waiting lifecycle unavailable");
            }
            return realAppendEntry(...args);
        });
        try {
            await expect(harness.abortInvocation(created.sessionId, {reason: "retry waiting"})).rejects.toThrow("waiting lifecycle unavailable");
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: {invocationId: waiting.invocationId, status: "waiting"},
            });
        } finally {
            appendEntrySpy.mockRestore();
        }
        await expect(harness.abortInvocation(created.sessionId, {reason: "retry waiting succeeds"}))
            .resolves.toEqual({status: "aborted", sessionId: created.sessionId});
        expect((await harness.getSessionRecovery(created.sessionId)).activeInvocation).toBeNull();
    });

    it("waiting abort 的 partial lifecycle append 由写队列补齐 active leaf 且不重复 lifecycle", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-waiting-partial",
                name: "Abort Waiting Partial",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage([
            fauxToolCall("request_user_input", {
                questions: [{question: "Partial?"}],
            }, {id: "abort-waiting-partial"}),
        ], {stopReason: "toolUse"})]);
        const created = await harness.createAgent({profileKey: "test.abort-waiting-partial", initial: {}});
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const eventStartSeq = harness.eventHub.lastSeq(created.sessionId);
        const subscription = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: harness.eventHub.eventEpoch,
            after: eventStartSeq,
        });
        const iterator = subscription[Symbol.asyncIterator]();

        const repositoryInternals = harness.repo as unknown as {
            appendLine(path: string, record: unknown): Promise<void>;
        };
        const realAppendLine = repositoryInternals.appendLine.bind(harness.repo);
        let abortedLifecycleId: string | undefined;
        let failAutoLeaf = true;
        const appendLineSpy = vi.spyOn(repositoryInternals, "appendLine").mockImplementation(async (...args) => {
            const record = args[1] as {
                kind?: string;
                entry?: {
                    type?: string;
                    status?: string;
                    id?: string;
                    leafId?: string | null;
                };
            };
            if (record.kind === "entry" && record.entry?.type === "invocation_lifecycle" && record.entry.status === "aborted") {
                abortedLifecycleId = record.entry.id;
            }
            if (failAutoLeaf
                && abortedLifecycleId
                && record.kind === "entry"
                && record.entry?.type === "leaf"
                && record.entry.leafId === abortedLifecycleId) {
                failAutoLeaf = false;
                throw new Error("waiting auto leaf unavailable");
            }
            return realAppendLine(...args);
        });
        try {
            await expect(harness.abortInvocation(created.sessionId, {reason: "partial waiting"})).rejects.toThrow("waiting auto leaf unavailable");
            await expect(harness.getSessionRecovery(created.sessionId)).resolves.toMatchObject({
                activeInvocation: {invocationId: waiting.invocationId, status: "waiting"},
            });
        } finally {
            appendLineSpy.mockRestore();
        }

        await expect(harness.abortInvocation(created.sessionId, {reason: "partial waiting retry"}))
            .resolves.toEqual({status: "aborted", sessionId: created.sessionId});
        const retryEventCount = harness.eventHub.lastSeq(created.sessionId) - eventStartSeq;
        const retryEvents: AgentSessionEventDto[] = [];
        for (let index = 0; index < retryEventCount; index += 1) {
            retryEvents.push(await nextEventWithin(iterator, `partial retry event ${String(index)}`));
        }
        await iterator.return?.();
        expect(retryEvents.map((event) => event.event.type)).toEqual([
            "invocation_aborted",
            "session_entry",
            "session_state_changed",
            "agent_end",
        ]);
        expect(retryEvents.filter((event) => event.event.type === "session_entry")).toHaveLength(1);
        expect(retryEvents.filter((event) => event.event.type === "session_entry"
            && event.event.entry.type === "tool_result"
            && event.event.entry.toolCallId === "abort-waiting-partial")).toHaveLength(1);
        const snapshot = await harness.repo.readSession(created.sessionId);
        const abortedLifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle"
            && entry.invocationId === waiting.invocationId
            && entry.status === "aborted");
        expect(abortedLifecycles).toHaveLength(1);
        expect(snapshot.leafId).toBe(abortedLifecycles[0]?.id);
        expect(snapshot.entries.filter((entry) => entry.type === "leaf" && entry.leafId === abortedLifecycles[0]?.id)).toHaveLength(1);
    });

    it("取消保留已生成的半截正文，且 lifecycle 不写 provider 原文", async () => {
        // 真实 provider SDK 取消时抛的是英文 "Request was aborted"。以前它被当成错误详情持久化，
        // 同时半截正文整段丢失（实测 40 次取消 0 次保留）。这里锁住修好之后的两条契约（Task 139）。
        faux.setResponses([
            fauxAssistantMessage("写到一半就被停了", {stopReason: "aborted", errorMessage: "Request was aborted"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.drainBackgroundTasks();
        const snapshot = await harness.repo.readSession(created.sessionId);

        // 半截正文以 interrupted 落盘，成为可回溯的分支锚点。
        const assistant = snapshot.entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");
        expect(assistant).toBeDefined();
        expect(assistant).toEqual(expect.objectContaining({status: "interrupted"}));
        expect(JSON.stringify(assistant)).toContain("写到一半就被停了");
        // 错误详情不再挂在 assistant 上：那是 lifecycle 的职责，两处都写会渲染成两个气泡。
        expect(JSON.stringify(assistant)).not.toContain("Request was aborted");

        // lifecycle 只记「这是取消」，不夹带 provider 英文原文。
        const lifecycle = snapshot.entries.find((entry) => entry.type === "invocation_lifecycle" && entry.status === "aborted");
        expect(lifecycle).toBeDefined();
        expect(JSON.stringify(lifecycle)).not.toContain("Request was aborted");
    });

    it("取消的阻塞 invoke 返回 aborted 标记，界面据此不弹错误", async () => {
        // 取消结束的 invocation 依然是 status: "error"（调用方要按异常终止处理），但 error 里是英文技术
        // 文本 "invocation aborted"。前端的兜底通知只认 status，于是每次点停止都会弹一条英文报错。
        // aborted 标记是让「取消」在返回值里有独立身份的唯一手段（Task 139）。
        faux.setResponses([
            // provider 永不返回：这正是宽限期强制收尾（forceAbortInvocation）要兜住的「模型/工具卡住」场景。
            () => new Promise<never>(() => {}),
        ]);
        const created = await harness.createAgent({profileKey: "leader.default", initial: {}});
        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await waitFor(async () => {
            const snapshot = await harness.getSessionRecovery(created.sessionId);
            expect(snapshot.activeInvocation).not.toBeNull();
        });

        await harness.abortInvocation(created.sessionId, {});
        const result = await running;

        expect(result.aborted).toBe(true);
        // 两阶段取消：调用方有界返回时终态可能仍在 write queue 落盘；有界轮询等待
        // durable aborted 出现，且不允许出现 error lifecycle（否则前端多渲染 Run Error 卡片）。
        await waitFor(async () => {
            const snapshot = await harness.repo.readSession(created.sessionId);
            const lifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle");
            expect(lifecycles.map((entry) => entry.type === "invocation_lifecycle" ? entry.status : null)).toEqual(["start", "aborted"]);
        });
    });

    it("abort clearQueue 会清空已持久化的 followUp queue projection", async () => {
        let releaseProvider: (() => void) | undefined;
        const providerGate = new Promise<void>((resolve) => {
            releaseProvider = resolve;
        });
        faux.setResponses([
            async () => {
                await providerGate;
                return fauxAssistantMessage("stopped", {stopReason: "aborted", errorMessage: "user stopped"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        const queued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });

        await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: true});
        await running;
        releaseProvider!();
        await harness.drainBackgroundTasks();
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: createTestProfileCatalog(join(root, "restored-system-profiles"), root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const recovery = await restored.getSessionRecovery(created.sessionId);

        expect(queued.acceptance.state).toBe("queued");
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
        const providerStarted = createDeferred();
        const releaseProvider = createDeferred();
        faux.setResponses([
            async () => {
                providerStarted.resolve();
                await releaseProvider.promise;
                return fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
            const restored = createTestHarness({
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
        } finally {
            releaseProvider.resolve();
            await running.catch(() => undefined);
        }
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
        expect(await harness.listSessions({})).toEqual([]);
        expect(await harness.listSessions({includeArchived: true})).toHaveLength(1);
    });

    it("invocation preflight 后并发 archive 时最终 admission 使用最新状态且不提交用户输入", async () => {
        faux.setResponses([fauxAssistantMessage(fauxText("不应运行"))]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const originalReadSession = harness.repo.readSession.bind(harness.repo);
        const releasePreflight = createDeferred();
        let preflightBlocked = false;
        harness.repo.readSession = async (...args: Parameters<JsonlSessionRepository["readSession"]>): ReturnType<JsonlSessionRepository["readSession"]> => {
            const snapshot = await originalReadSession(...args);
            if (args[0] === created.sessionId && !preflightBlocked) {
                preflightBlocked = true;
                await releasePreflight.promise;
            }
            return snapshot;
        };
        const clientMessageId = randomUUID();
        const invocation = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            clientMessageId,
            message: {text: "stale preflight"},
        });
        await waitFor(() => expect(preflightBlocked).toBe(true));

        await harness.runCommand(created.sessionId, {command: "archive", reason: "race winner"});
        releasePreflight.resolve();
        const result = await invocation;
        const snapshot = await originalReadSession(created.sessionId);

        expect(result).toMatchObject({
            status: "error",
            acceptance: {state: "not_accepted", clientMessageId},
            error: "当前 Session 已归档，只能查看或恢复。",
        });
        expect(snapshot.entries.some((entry) => entry.type === "message" && entry.clientMessageId === clientMessageId)).toBe(false);
        expect(snapshot.entries.some((entry) => entry.type === "invocation_lifecycle" && entry.status === "start")).toBe(false);
    });

    it("Tree 编辑在附件 preadmission 失败时不移动 leaf，成功 prompt 使用目标分支作为 parent", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("edited")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "original"},
        });
        const before = await harness.repo.readSession(created.sessionId);
        const originalUser = before.entries.find((entry) => entry.type === "message" && entry.message.role === "user");
        const originalAssistant = before.entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");
        const forgedTarget = `workspace/.nbook/agent/attachments/sha256/aa/${"b".repeat(62)}`;

        await expect(harness.moveTree(created.sessionId, {
            targetEntryId: originalAssistant!.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "prompt",
                clientMessageId: randomUUID(),
                message: {text: serializeAgentImageMarkdown("forged.png", forgedTarget)},
            },
        })).rejects.toMatchObject({code: "invalid_reference"});
        const afterRejected = await harness.repo.readSession(created.sessionId);
        expect(afterRejected.leafId).toBe(before.leafId);
        expect(afterRejected.entries).toEqual(before.entries);

        const clientMessageId = randomUUID();
        const moved = await harness.moveTree(created.sessionId, {
            targetEntryId: originalAssistant!.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "prompt",
                clientMessageId,
                message: {text: "replacement"},
            },
        });
        expect(moved.invocation?.acceptance).toEqual({
            state: "persisted",
            clientMessageId,
            entryId: expect.any(String),
        });
        const afterSuccess = await harness.repo.readSession(created.sessionId);
        const replacement = afterSuccess.entries.find((entry) => entry.type === "message"
            && entry.message.role === "user"
            && entry.clientMessageId === clientMessageId);
        expect(replacement?.parentId).toBe(originalUser?.id);
        expect(visibleMessageText(harness.repo.reduce(afterSuccess).messages)).toContain("edited");
    });

    it("从用户消息刷新时保留该用户消息，并从其后继续生成", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("retry after user")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        await harness.detachAgent(child.sessionId, parent.sessionId);

        const nextHarness = createTestHarness({
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
        });
        const child = await harness.createAgent({
            profileKey: "test.linked-by",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });

        const childSnapshot = await harness.getSessionRecovery(child.sessionId);
        const restored = createTestHarness({
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

    it("归档隐藏关系但不 detach，恢复后仍 linked 的关系重新显现", async () => {
        const owner = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const archived = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            parentSessionId: owner.sessionId,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
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
            detached: false,
        }));

        await harness.runCommand(archived.sessionId, {command: "restore"});
        await harness.runCommand(archived.sessionId, {command: "restore"});
        expect((await harness.getSessionRelations(owner.sessionId)).linkedAgents).toEqual([
            expect.objectContaining({sessionId: archived.sessionId}),
        ]);
        expect((await harness.getSessionRelations(child.sessionId)).linkedByAgents).toEqual([
            expect.objectContaining({sessionId: archived.sessionId}),
        ]);

        await harness.runCommand(archived.sessionId, {command: "archive", reason: "detach while archived"});
        await harness.runCommand(archived.sessionId, {command: "archive", reason: "duplicate archive"});
        await harness.detachAgent(archived.sessionId, owner.sessionId);
        await harness.runCommand(archived.sessionId, {command: "restore"});
        expect((await harness.getSessionRelations(owner.sessionId)).linkedAgents).toEqual([]);
        expect((await harness.getSessionRelations(child.sessionId)).linkedByAgents).toEqual([
            expect.objectContaining({sessionId: archived.sessionId}),
        ]);
        const lifecycleEntries = (await harness.repo.readSession(archived.sessionId)).entries
            .filter((entry) => entry.type === "session_archived" || entry.type === "session_restored");
        expect(lifecycleEntries.map((entry) => entry.type)).toEqual([
            "session_archived",
            "session_restored",
            "session_archived",
            "session_restored",
        ]);
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
        });
        const child = await harness.createAgent({
            profileKey: "test.deleted-profile",
            initial: {},
            parentSessionId: parent.sessionId,
        });
        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });

        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        const sessions = await restored.listSessions({});
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
        })).rejects.toThrow("状态不允许编辑历史并重新运行");
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

    it("不可运行 profile 的历史 session 标记为 unloadable，Idle abort 仍保持幂等", async () => {
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
        });
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new BrokenProfileCatalog(join(root, "broken-system-profiles"), join(root, "broken-user-profiles")),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });

        const snapshot = await restored.getSessionRecovery(created.sessionId);
        const page = await restored.listSessionPage({limit: 10});
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
        const aborted = await restored.abortInvocation(created.sessionId, {reason: "idle unavailable profile"});
        const afterAbort = await restored.repo.readSession(created.sessionId);
        expect(aborted).toEqual({status: "idle", sessionId: created.sessionId});
        expect(afterAbort.entries.some((entry) => entry.type === "invocation_lifecycle")).toBe(false);
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
        });
        const issueMessage = "加载错误".repeat(30_000);
        const restored = createTestHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new BrokenProfileCatalog(join(root, "large-error-system-profiles"), join(root, "large-error-user-profiles"), issueMessage),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        try {
            const liveState = await restored.getSessionLiveState(created.sessionId);
            const page = await restored.listSessionPage({limit: 10});

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

    it("Project ready发布后close先进入terminal gate时admission fail closed", async () => {
        await closeAllProjects();
        resetProjectSessionsForTest();
        const projectRootName = "admission-close-race";
        const projectRoot = join(root, projectRootName);
        await mkdir(join(projectRoot, ".nbook"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Admission Close Race\nsummary: ''\n", "utf8");
        await writeFile(join(projectRoot, ".nbook", "config.json"), "{}\n", "utf8");

        const openGate = createDeferred();
        const moduleStarted = createDeferred();
        const captureStarted = createDeferred();
        const restoreModules = replaceProjectModulesForTest(gatedProjectModules(openGate.promise, moduleStarted.resolve));
        const captureInvocationProject = harness["captureInvocationProject"].bind(harness);
        harness["captureInvocationProject"] = async (sessionId, currentProjectPath) => {
            captureStarted.resolve();
            return captureInvocationProject(sessionId, currentProjectPath);
        };
        let providerCalls = 0;
        faux.setResponses([
            () => {
                providerCalls += 1;
                return fauxAssistantMessage(fauxText("must not run"));
            },
        ]);
        let opening: Promise<ReadyProjectSessionRef> | null = null;
        let closing: Promise<void> | null = null;

        try {
            const created = await harness.repo.createSession({
                profileKey: "leader.default",
                initial: {},
                currentProjectRoot: "admission-close-race",
            });
            opening = openProject(projectWorkspaceRef(projectRootName), {
                kind: "job",
                source: "admission-close-race",
            }, harness.workspaceRoot);
            await moduleStarted.promise;
            closing = opening.then(() => closeProjectForTest(projectRootName));

            const invoking = harness.invokeAgent({
                sessionId: created.metadata.sessionId,
                mode: "prompt",
                message: {text: "must fail before start"},
            });
            const rejected = expect(invoking).rejects.toBeInstanceOf(ProjectNotOpenError);
            await captureStarted.promise;
            openGate.resolve();

            await rejected;
            await closing;
            const snapshot = await harness.repo.readSession(created.metadata.sessionId);
            const recovery = await harness.getSessionRecovery(created.metadata.sessionId);

            expect(providerCalls).toBe(0);
            expect(recovery.activeInvocation).toBeNull();
            expect(snapshot.entries.some((entry) => entry.type === "invocation_lifecycle")).toBe(false);
        } finally {
            openGate.resolve();
            await opening?.catch(() => undefined);
            await closing?.catch(() => undefined);
            harness["captureInvocationProject"] = captureInvocationProject;
            await closeProjectForTest(projectRootName).catch(() => undefined);
            await closeAllProjects();
            resetProjectSessionsForTest();
            restoreModules();
        }
    }, 20_000);

    it("manual compact持有Project operation，忽略取消的迟到结果不得落盘", async () => {
        await closeAllProjects();
        resetProjectSessionsForTest();
        const projectRootName = "manual-compact-project";
        const projectRoot = join(root, projectRootName);
        await mkdir(join(projectRoot, ".nbook"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Manual Compact\nsummary: ''\n", "utf8");
        await writeFile(join(projectRoot, ".nbook", "config.json"), "{}\n", "utf8");

        const providerStarted = createDeferred();
        const releaseProvider = createDeferred();
        let receivedSignal: AbortSignal | undefined;
        faux.setResponses([
            async (_context, options) => {
                receivedSignal = options?.signal;
                providerStarted.resolve();
                await releaseProvider.promise;
                return fauxAssistantMessage(fauxText("LATE COMPACTION"));
            },
        ]);

        try {
            await openProject(projectWorkspaceRef(projectRootName), {kind: "job", source: "manual-compact-test"}, harness.workspaceRoot);
            const created = await harness.createAgent({
                profileKey: "leader.default",
                initial: {},
                currentProjectRoot: "manual-compact-project",
            });
            await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old context"}));
            const command = await harness.runCommand(created.sessionId, {
                command: "compact",
                instructions: "hold until close",
            });
            if (command.kind !== "live_state" || !command.state.activeInvocation) {
                throw new Error("测试未观察到 manual compact active invocation");
            }
            const invocationId = command.state.activeInvocation.invocationId;
            const capturedProject = harness.projectForInvocation(invocationId);
            if (!capturedProject) {
                throw new Error("测试 manual compact 未捕获 Project");
            }
            await providerStarted.promise;

            let closeSettled = false;
            const closing = closeProjectForTest(projectRootName);
            void closing.then(
                () => {
                    closeSettled = true;
                },
                () => {
                    closeSettled = true;
                },
            );
            await waitFor(() => {
                expect(receivedSignal?.aborted).toBe(true);
            });

            expect(closeSettled).toBe(false);
            expect(projectOccupancy(projectWorkspaceRef(projectRootName))).toBeNull();
            await closing;
            const reopened = await openProject(projectWorkspaceRef(projectRootName), {
                kind: "job",
                source: "manual-compact-late-test",
            }, harness.workspaceRoot);

            releaseProvider.resolve();
            await harness.drainBackgroundTasks();
            const snapshot = await harness.repo.readSession(created.sessionId);
            const lifecycle = snapshot.entries.flatMap((entry) => entry.type === "invocation_lifecycle" && entry.invocationId === invocationId
                ? [entry.status]
                : []);

            expect(receivedSignal).toBeDefined();
            expect(reopened.generation).not.toBe(capturedProject.generation);
            expect(lifecycle).toEqual(["start", "aborted"]);
            expect(snapshot.entries.some((entry) => entry.type === "compaction")).toBe(false);
            expect(() => harness.projectForInvocation(invocationId)).toThrow(`invocation variable state不存在：${invocationId}`);
        } finally {
            releaseProvider.resolve();
            await harness.drainBackgroundTasks().catch(() => undefined);
            await closeProjectForTest(projectRootName).catch(() => undefined);
            await closeAllProjects();
            resetProjectSessionsForTest();
        }
    }, 20_000);

    it("Project invocation持有exact generation到terminal，close abort后才允许reopen", async () => {
        await closeAllProjects();
        resetProjectSessionsForTest();
        const projectRootName = "exact-config";
        const projectRoot = join(root, projectRootName);
        await mkdir(join(projectRoot, ".nbook"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Exact Config\nsummary: ''\n", "utf8");
        await writeFile(join(projectRoot, ".nbook", "config.json"), "{}\n", "utf8");

        let captured: ReadyProjectSessionRef | null = null;
        let markHookStarted: () => void = () => undefined;
        const hookStarted = new Promise<void>((resolve) => {
            markHookStarted = resolve;
        });
        let releaseHook: () => void = () => undefined;
        const hookPause = new Promise<void>((resolve) => {
            releaseHook = resolve;
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.exact-project-config", name: "Exact Project Config"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime<object>({
                hooks: [{
                    name: "pause-after-project-capture",
                    stage: "prepareRun",
                    async run(ctx) {
                        captured = harness.projectForInvocation(ctx.invocationId);
                        if (!captured) {
                            throw new Error("测试 invocation 未捕获 Project");
                        }
                        markHookStarted();
                        await hookPause;
                        return {};
                    },
                }],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage(fauxText("done"))]);

        try {
            await openProject(projectWorkspaceRef(projectRootName), {kind: "job", source: "exact-project-test"}, harness.workspaceRoot);
            const created = await harness.createAgent({
                profileKey: "test.exact-project-config",
                initial: {},
                currentProjectRoot: "exact-config",
            });
            const invoking = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "run"},
            });
            await hookStarted;
            const capturedReady = captured as ReadyProjectSessionRef | null;
            if (!capturedReady) {
                throw new Error("测试未观察到 Project capture");
            }
            let closeSettled = false;
            const closing = closeProjectForTest(projectRootName);
            void closing.then(
                () => {
                    closeSettled = true;
                },
                () => {
                    closeSettled = true;
                },
            );

            await Promise.resolve();
            expect(closeSettled).toBe(false);
            expect(projectOccupancy(projectWorkspaceRef(projectRootName))).toBeNull();

            releaseHook();
            const result = await invoking;
            await closing;
            const reopened = await openProject(projectWorkspaceRef(projectRootName), {kind: "job", source: "exact-config-test"}, harness.workspaceRoot);

            expect(result.status).toBe("error");
            expect(reopened.generation).not.toBe(capturedReady.generation);
            expect(() => harness.projectForInvocation(result.invocationId)).toThrow(`invocation variable state不存在：${result.invocationId}`);
        } finally {
            releaseHook();
            await closeProjectForTest(projectRootName).catch(() => undefined);
            await closeAllProjects();
            resetProjectSessionsForTest();
        }
    }, 20_000);

    it("Project invocation在waiting释放operation，resume同id捕获新generation", async () => {
        await closeAllProjects();
        resetProjectSessionsForTest();
        const projectRootName = "waiting-resume-generation";
        const projectRoot = join(root, projectRootName);
        await mkdir(join(projectRoot, ".nbook"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Waiting Resume\nsummary: ''\n", "utf8");
        await writeFile(join(projectRoot, ".nbook", "config.json"), "{}\n", "utf8");

        const capturedProjects: ReadyProjectSessionRef[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.waiting-resume-project", name: "Waiting Resume Project"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            runtime: defineAgentRuntime<object>({
                hooks: [
                    {
                        name: "persist-waiting-transcript",
                        stage: "ingestTurn",
                        run() {
                            return {transcript: "persist"};
                        },
                    },
                    {
                        name: "capture-running-project-generation",
                        stage: "prepareRun",
                        run(ctx) {
                            const currentProject = harness.projectForInvocation(ctx.invocationId);
                            if (!currentProject) {
                                throw new Error("测试 invocation 未捕获 Project");
                            }
                            capturedProjects.push(currentProject);
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
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "ask-project-resume"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);

        try {
            await openProject(projectWorkspaceRef(projectRootName), {kind: "job", source: "waiting-project-test"}, harness.workspaceRoot);
            const created = await harness.createAgent({
                profileKey: "test.waiting-resume-project",
                initial: {},
                currentProjectRoot: "waiting-resume-generation",
            });
            const waiting = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "wait"},
            });

            expect(
                waiting.status,
                waiting.status === "error" ? `${waiting.errorPhase}: ${waiting.error}` : JSON.stringify(waiting),
            ).toBe("waiting");
            expect(capturedProjects).toHaveLength(1);
            expect(harness.projectForInvocation(waiting.invocationId)).toBeNull();

            await closeProjectForTest(projectRootName);
            const afterClose = await harness.repo.readSession(created.sessionId);
            expect(afterClose.entries).not.toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                invocationId: waiting.invocationId,
                status: "aborted",
            }));
            const reopened = await openProject(projectWorkspaceRef(projectRootName), {
                kind: "job",
                source: "waiting-resume-test",
            }, harness.workspaceRoot);
            const resumed = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution: {
                    kind: "user_input",
                    toolCallId: "ask-project-resume",
                    answers: [{questionIndex: 0, text: "continue"}],
                },
            });
            const finalSnapshot = await harness.repo.readSession(created.sessionId);
            const lifecycle = finalSnapshot.entries.flatMap((entry) => entry.type === "invocation_lifecycle" && entry.invocationId === waiting.invocationId
                ? [entry.status]
                : []);

            expect(resumed.status).toBe("completed");
            expect(resumed.invocationId).toBe(waiting.invocationId);
            expect(capturedProjects).toHaveLength(2);
            expect(capturedProjects[1]?.generation).toBe(reopened.generation);
            expect(capturedProjects[1]?.generation).not.toBe(capturedProjects[0]?.generation);
            expect(lifecycle).toEqual(["start", "waiting", "resumed", "end"]);
            expect(() => harness.projectForInvocation(resumed.invocationId)).toThrow(`invocation variable state不存在：${resumed.invocationId}`);
        } finally {
            await closeProjectForTest(projectRootName).catch(() => undefined);
            await closeAllProjects();
            resetProjectSessionsForTest();
        }
    }, 20_000);

    it("Project invocation固定使用session捕获的ready workspace，client snapshot不能重绑定变量", async () => {
        await closeAllProjects();
        resetProjectSessionsForTest();
        const projectA = join(root, "project-a");
        const projectB = join(root, "project-b");
        const definitionSource = [
            "import {Type, defineProjectVariable} from \"nbook/variable-sdk\";",
            "export const definitions = [defineProjectVariable({",
            "    key: \"scope\",",
            "    schema: Type.String(),",
            "})];",
            "export default definitions;",
            "",
        ].join("\n");
        for (const [projectRoot, value] of [[projectA, "project-a"], [projectB, "project-b"]] as const) {
            const definitionRoot = join(projectRoot, ".nbook", "agent", "variables");
            await mkdir(definitionRoot, {recursive: true});
            await writeFile(join(projectRoot, "project.yaml"), `kind: novel\ntitle: ${value}\nsummary: ''\n`, "utf8");
            await writeFile(join(definitionRoot, "definitions.ts"), definitionSource, "utf8");
            await writeFile(join(projectRoot, ".nbook", "agent", "variables.json"), `${JSON.stringify({
                schemaVersion: 1,
                variables: {scope: value},
            }, null, 2)}\n`, "utf8");
            await compileVariableDefinitions({
                definitionRoot,
                artifactPathContext: await resolveVariableDefinitionArtifactPathContext(
                    definitionRoot,
                    `workspace/${value}/.nbook/agent/variables`,
                    testArtifactCompilerRoot,
                ),
            });
        }
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.project-vars", name: "Project Vars"},
            initialSchema: Type.Object({}),
            allowedToolKeys: ["variable_read"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("variable_read", {namespace: "project", path: "scope"}, {id: "project-var-read"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const projectRoot = "project-a";
        try {
            await openProject(projectWorkspaceRef(projectRoot), {kind: "job", source: "project-vars-test"}, harness.workspaceRoot);
            const created = await harness.createAgent({
                profileKey: "test.project-vars",
                initial: {},
                currentProjectRoot: "project-a",
            });

            const result = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "read project scope"},
                clientState: {studio: {workspace: "workspace/project-b"}},
            });
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            const readResult = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "project-var-read");

            expect(result.status).toBe("completed");
            expect(readResult ? messageText(readResult) : "").toContain('"value": "project-a"');
            expect(readResult ? messageText(readResult) : "").not.toContain('"value": "project-b"');
        } finally {
            await closeProjectForTest(projectRoot).catch(() => undefined);
            await closeAllProjects();
            resetProjectSessionsForTest();
        }
    }, 20_000);

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

/** 构造可控ready门禁的最小required Module集合，用于精确排列open/close admission竞态。 */
function gatedProjectModules(openGate: Promise<void>, moduleStarted: () => void): ProjectModule[] {
    return (["database", "history", "file-index"] as const).map((name): ProjectModule => ({
        token: projectModuleToken<ProjectModuleHandle>(name, "required"),
        start() {
            const ready = name === "file-index" ? openGate : Promise.resolve();
            if (name === "file-index") {
                moduleStarted();
            }
            return {
                ready,
                async close(): Promise<void> {
                    return undefined;
                },
            };
        },
    }));
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
