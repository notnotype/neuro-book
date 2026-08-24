import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {readFile, readdir, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {PiTraceRecord} from "nbook/server/agent/observability/pi-request-recorder";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";

/** 轮询等待某 session 目录至少出现 minCount 条 trace 文件（record 是 fire-and-forget）。 */
async function waitForTrace(root: string, sessionId: number, minCount = 1): Promise<PiTraceRecord[]> {
    const dir = join(root, ".nbook", "agent", "traces", String(sessionId));
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const files = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
        if (files.length >= minCount) {
            return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as PiTraceRecord));
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return [];
}

describe("harness → pi trace 集成", () => {
    let root: string;
    let faux: FauxModelsFixture;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = testHostPath("harness-trace-test", randomUUID());
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

    it("一次 prompt turn 经默认开启的 trace 落一条 kind=turn 记录", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "trace.plain", name: "Trace Plain"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {systemPrompt: "you are a test assistant"};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({profileKey: "trace.plain", initial: {}});

        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "hello"}});
        expect(result.status).toBe("completed");

        const records = await waitForTrace(root, created.sessionId);
        expect(records.length).toBeGreaterThanOrEqual(1);
        const record = records[0]!;
        expect(record.correlation.kind).toBe("turn");
        expect(record.correlation.sessionId).toBe(created.sessionId);
        expect(record.correlation.invocationId).toBe(result.invocationId);
        expect(record.request.model).toBe(faux.getModel().id);
        expect(record.request.context).toBeDefined();
        expect(record.response.usage).toBeDefined();
        expect(record.status).toBe("ok");
        // 白名单：记录里绝不含密钥字段。
        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain("apiKey");
    }, 40_000);

});
