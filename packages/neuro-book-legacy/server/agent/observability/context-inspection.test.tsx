/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
/**
 * `getSessionContextInspection` 的端到端装配验证（Task 126 批次 D）。
 *
 * 覆盖纯函数测不到的部分：真实跑一轮后 trace 落盘 → 端点读回 → 分区 / 时间轴 /
 * 事实 / 诊断四块能对上，以及 trace 关闭与无记录两条降级路径。
 */
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {fauxAssistantMessage} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {AgentCatalog, AppendingSet, HistorySet, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";

/** trace 是 fire-and-forget，轮询到端点能看见 turn 记录为止。 */
async function waitForInspection(harness: NeuroAgentHarness, sessionId: number): Promise<AgentContextInspectionDto> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const inspection = await harness.getSessionContextInspection(sessionId);
        if (inspection.state !== "empty") {
            return inspection;
        }
        await new Promise((settle) => setTimeout(settle, 10));
    }
    return harness.getSessionContextInspection(sessionId);
}

describe("getSessionContextInspection", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = testHostPath("context-inspection-test", randomUUID());
        faux = createFauxModels({models: [{id: `faux-${randomUUID()}`, contextWindow: 128_000, maxTokens: 8_000}]});
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
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "inspect.demo", name: "Inspect Demo"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return (
                    <ProfilePrompt>
                        <System>you are a test assistant</System>
                        <HistorySet>
                            <Message><AgentCatalog text="AGENT CATALOG BODY" /></Message>
                        </HistorySet>
                        <AppendingSet>
                            <Message>turn reminder</Message>
                        </AppendingSet>
                    </ProfilePrompt>
                );
            },
        }), false);
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("跑一轮后返回分区、时间轴、事实与诊断", async () => {
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({profileKey: "inspect.demo", initial: {}});
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});

        const inspection = await waitForInspection(harness, created.sessionId);

        expect(inspection.state).toBe("ok");
        expect(inspection.requests).toHaveLength(1);
        expect(inspection.selected?.traceId).toBe(inspection.requests[0]?.id);
        expect(inspection.selected?.segments.map((segment) => segment.kind)).toEqual([
            "system",
            "historySet",
            "appending",
            "currentInput",
        ]);
        // 来源聚合由 aggregateSegmentLabels 统一产出，前端不再自己均摊。
        expect(inspection.selected?.labelBreakdown).toEqual([
            expect.objectContaining({kind: "historySet", label: "AgentCatalog"}),
        ]);
        expect(inspection.facts.contextWindowTokens).toBe(128_000);
        // faux provider 不是 Anthropic 家族，属于自动前缀缓存，不该编一个保留期出来。
        expect(inspection.facts.cacheRetention).toBeNull();
        expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toContain("cacheAutoPrefix");
    }, 40_000);

    it("缺省选最近一次请求，也能按 traceId 切到历史请求", async () => {
        faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
        const created = await harness.createAgent({profileKey: "inspect.demo", initial: {}});
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "again"}});

        const latest = await waitForInspection(harness, created.sessionId);
        expect(latest.requests.length).toBeGreaterThanOrEqual(2);
        // requests 按时间升序，缺省应选最后一条。
        expect(latest.selected?.traceId).toBe(latest.requests.at(-1)?.id);

        const firstId = latest.requests[0]!.id;
        const pinned = await harness.getSessionContextInspection(created.sessionId, firstId);
        expect(pinned.selected?.traceId).toBe(firstId);
    }, 60_000);

    it("非法 traceId 回落到最近一次，而不是报错或返回空", async () => {
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({profileKey: "inspect.demo", initial: {}});
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        await waitForInspection(harness, created.sessionId);

        const inspection = await harness.getSessionContextInspection(created.sessionId, "999999");
        expect(inspection.state).toBe("ok");
        expect(inspection.selected).toBeDefined();
    }, 40_000);

    it("尚未跑过任何一轮时返回 empty，而不是抛错", async () => {
        const created = await harness.createAgent({profileKey: "inspect.demo", initial: {}});
        const inspection = await harness.getSessionContextInspection(created.sessionId);

        expect(inspection.state).toBe("empty");
        expect(inspection.selected).toBeUndefined();
        expect(inspection.diagnostics).toEqual([]);
        // 事实仍要解析出来，否则空态面板连窗口大小都显示不了。
        expect(inspection.facts.contextWindowTokens).toBe(128_000);
    }, 40_000);
});
