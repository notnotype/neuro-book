/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
/**
 * 上下文分区归因的端到端落盘验证（Task 126）。
 *
 * 单独成 .tsx 文件：分区归因必须用真实 Profile DSL 跑通才算数，而 harness-trace.test.ts
 * 是 .ts，装不下 JSX。这里验证的是「DSL 渲染 → 写 promptSource 落盘 → 组装 → trace segments」
 * 整条链路——纯函数单测（trace-segments.test.ts）覆盖不到中间的落盘与读回。
 */
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {readFile, readdir, rm} from "node:fs/promises";
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
import type {PiTraceRecord} from "nbook/server/agent/observability/pi-request-recorder";
import {AgentCatalog, AppendingSet, HistorySet, Message, ProfilePrompt, SkillCatalog, System} from "nbook/server/agent/profiles/profile-dsl";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";

/** 轮询等待 trace 落盘（record 是 fire-and-forget）。 */
async function waitForTrace(root: string, sessionId: number): Promise<PiTraceRecord[]> {
    const dir = join(root, ".nbook", "agent", "traces", String(sessionId));
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const files = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
        if (files.length >= 1) {
            return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8")) as PiTraceRecord));
        }
        await new Promise((settle) => setTimeout(settle, 10));
    }
    return [];
}

describe("上下文分区归因 → trace segments", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = testHostPath("harness-trace-segments-test", randomUUID());
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
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("HistorySet / AppendingSet 按分区与来源名落进 trace segments", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "trace.segments", name: "Trace Segments"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return (
                    <ProfilePrompt>
                        <System>you are a test assistant</System>
                        <HistorySet>
                            <Message><AgentCatalog text="AGENT CATALOG BODY" /></Message>
                            <Message><SkillCatalog text="SKILL CATALOG BODY" /></Message>
                        </HistorySet>
                        <AppendingSet>
                            <Message>plain appending reminder</Message>
                        </AppendingSet>
                    </ProfilePrompt>
                );
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({profileKey: "trace.segments", initial: {}});

        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        expect(result.status).toBe("completed");

        const record = (await waitForTrace(root, created.sessionId))[0]!;
        const segments = record.request.segments ?? [];
        expect(segments.map((segment) => segment.kind)).toEqual([
            "system",
            "historySet",
            "appending",
            "currentInput",
        ]);
        // HistorySet 逐条来源名——面板里「某个 Import 占 6.3%」那一行的数据来源。
        expect(segments.find((segment) => segment.kind === "historySet")?.labels).toEqual([
            ["AgentCatalog"],
            ["SkillCatalog"],
        ]);
        // 匿名 AppendingSet 消息没有具名来源，但仍必须归到 appending 而不是对话历史。
        const appending = segments.find((segment) => segment.kind === "appending");
        expect(appending?.range).toEqual({start: 2, end: 3});
        expect(appending?.labels).toBeUndefined();
        expect(segments.every((segment) => segment.estimatedTokens > 0)).toBe(true);
        // 本 profile 无工具，指纹缺省；有工具时才写入。
        expect(record.request.toolsHash).toBeUndefined();
    }, 40_000);

    it("第二轮从 session 读回时，HistorySet 仍能按落盘的 promptSource 归因", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "trace.segments.second", name: "Trace Segments Second"},
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
        faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
        const created = await harness.createAgent({profileKey: "trace.segments.second", initial: {}});

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "again"}});

        const records = (await waitForTrace(root, created.sessionId)).sort((left, right) => Number(left.id) - Number(right.id));
        const second = records.at(-1)!;
        const segments = second.request.segments ?? [];

        // 关键回归：HistorySet 只在首轮注入，第二轮是从 JSONL 读回来的；
        // 没有落盘的 promptSource，这里会退化成 conversation。
        const historySet = segments.find((segment) => segment.kind === "historySet");
        expect(historySet?.labels).toEqual([["AgentCatalog"]]);
        // 首轮的 AppendingSet 提醒沉淀进历史后仍归 appending，不会被算成对话历史。
        expect(segments.filter((segment) => segment.kind === "appending").length).toBeGreaterThanOrEqual(2);
    }, 60_000);
});
