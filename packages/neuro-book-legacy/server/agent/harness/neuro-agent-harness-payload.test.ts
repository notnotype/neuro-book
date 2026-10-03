import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {createStoredUserMessage} from "nbook/server/agent/messages/message-utils";
import type {JsonValue, Message as RuntimeMessage} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";

describe("NeuroAgentHarness invocation payload", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = testHostPath("agent-harness-payload-test", randomUUID());
        faux = createFauxModels();
        await writeFauxProviderConfig(root, faux);
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            profiles: new AgentProfileCatalog(
                resolve(root, "profiles-system"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, root),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(root),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("createAgent 按 InitialSchema 校验 initial", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.initial-required",
                name: "Initial Required",
            },
            initialSchema: Type.Object({
                topic: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);

        await expect(harness.createAgent({
            profileKey: "test.initial-required",
            initial: {},
        })).rejects.toThrow("initial 校验失败：/topic：缺少必填字段");
    }, 20_000);

    it("public createAgent 拒绝 system-only profile", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.system-only",
                name: "System Only",
            },
            capabilities: {creation: "system_only"},
            initialSchema: Type.Object({sourceSessionId: Type.Number()}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);

        await expect(harness.createAgent({
            profileKey: "test.system-only",
            initial: {sourceSessionId: 1},
        })).rejects.toThrow("仅供系统内部创建");
    });

    it("prompt 可以只传 payload，并按 PayloadSchema 校验后进入 ctx.invocation.payload", async () => {
        let observedMessage: string | undefined;
        let observedPayload: JsonValue | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.payload-aware",
                name: "Payload Aware",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare(ctx) {
                observedMessage = ctx.invocation?.message;
                observedPayload = ctx.invocation?.payload;
                return {
                    systemPrompt: `payload=${ctx.invocation?.payload?.plotId}; message=${ctx.invocation?.message}`,
                    appendingMessages: [createStoredUserMessage(`prepared payload=${ctx.invocation?.payload?.plotId}; message=${ctx.invocation?.message}`)],
                };
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({
            profileKey: "test.payload-aware",
            initial: {},
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            payload: {plotId: "plot-1"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(result.status).toBe("completed");
        expect(observedMessage).toBeUndefined();
        expect(observedPayload).toEqual({plotId: "plot-1"});
        expect(visibleText(context.messages)).toContain("prepared payload=plot-1");
        expect(visibleText(context.messages)).toContain("message=undefined");
        expect(visibleText(context.messages)).toContain("<payload>");
        expect(visibleText(context.messages)).toContain("\"plotId\": \"plot-1\"");
    }, 20_000);

    it("message + payload 时 ctx.invocation.message 保留原始自然语言", async () => {
        let observedMessage: string | undefined;
        let observedPayload: JsonValue | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.message-payload",
                name: "Message Payload",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare(ctx) {
                observedMessage = ctx.invocation?.message;
                observedPayload = ctx.invocation?.payload;
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({
            profileKey: "test.message-payload",
            initial: {},
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "请继续"},
            payload: {plotId: "plot-1"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedMessage).toBe("请继续");
        expect(observedPayload).toEqual({plotId: "plot-1"});
        expect(visibleText(context.messages)).toContain("请继续");
        expect(visibleText(context.messages)).toContain("<payload>");
        expect(visibleText(context.messages)).toContain("\"plotId\": \"plot-1\"");
    }, 20_000);

    it("没有 PayloadSchema 的 profile 收到 payload 时返回明确错误", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-payload",
                name: "No Payload",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.no-payload",
            initial: {},
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            payload: {plotId: "plot-1"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("PayloadSchema");
    }, 20_000);

    it("payload 校验失败和 continue 携带 payload 都会拒绝", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.payload-contract",
                name: "Payload Contract",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.payload-contract",
            initial: {},
        });

        const invalidPayload = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            payload: {plotId: 1},
        });
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            payload: {plotId: "plot-1"},
        })).rejects.toThrow("continue 模式不能提供 message 或 input");

        expect(invalidPayload.status).toBe("error");
        expect(invalidPayload.error).toContain("payload 校验失败：/plotId：must be string");
    }, 20_000);

    it("running followup 入队前会校验 payload，失败时不污染队列", async () => {
        const blockedTool = registerBlockedTool(harness, "payload_followup_gate");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.followup-queued-payload",
                name: "Followup Queued Payload",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys(["payload_followup_gate"]),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("payload_followup_gate", {}, {id: "followup-payload-gate"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.followup-queued-payload",
            initial: {},
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        try {
            await waitForActiveInvocation(harness, created.sessionId);
            await expect(harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                payload: {plotId: 1},
            })).rejects.toThrow("payload 校验失败");
            expect((await harness.getSessionRecovery(created.sessionId)).followUpQueue.items).toEqual([]);
        } finally {
            blockedTool.release();
            await running.catch(() => undefined);
        }
    }, 20_000);

    it("running steer 入队前会校验 payload，失败时不污染队列", async () => {
        const blockedTool = registerBlockedTool(harness, "payload_steer_gate");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.steer-queued-payload",
                name: "Steer Queued Payload",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys(["payload_steer_gate"]),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("payload_steer_gate", {}, {id: "steer-payload-gate"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.steer-queued-payload",
            initial: {},
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        try {
            await waitForActiveInvocation(harness, created.sessionId);
            await expect(harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                payload: {plotId: 1},
            })).rejects.toThrow("payload 校验失败");
            expect((await harness.getSessionRecovery(created.sessionId)).steerQueue).toEqual({items: [], omittedItems: 0});
        } finally {
            blockedTool.release();
            await running.catch(() => undefined);
        }
    }, 20_000);
});

/** 注册一个只有测试主动放行后才完成的工具，保证 invocation 稳定停在 running。 */
function registerBlockedTool(harness: NeuroAgentHarness, key: string): {release(): void} {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    harness.tools.register({
        key,
        name: key,
        label: "Payload Gate",
        description: "Keeps the invocation running while payload admission is tested.",
        parameters: Type.Object({}),
        async execute() {
            await gate;
            return {content: [{type: "text", text: "released"}], details: {}};
        },
    });
    return {release};
}

/** 等待 invocation 完成 admission；轮询有硬截止，失败不会留下后台运行。 */
async function waitForActiveInvocation(harness: NeuroAgentHarness, sessionId: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        if ((await harness.getSessionRecovery(sessionId)).activeInvocation) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("等待 active invocation 超时");
}

function visibleText(messages: StoredAgentMessage[]): string {
    return messages.map((message) => storedMessageText(message)).join("\n");
}
