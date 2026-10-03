import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import worldEngineProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {createTestRuntimeSession as testSession} from "nbook/server/agent/profiles/test/runtime-session";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";

const worldEngineProfile = normalizeAgentProfile(worldEngineProfileDefinition);

describe("world.engine profile", () => {
    it("catalog 可以加载 world.engine runtime artifact", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            testHostPath("world-engine-workspace", "workspace", "world-engine-project", ".nbook", "agent", "profiles"),
            undefined,
            undefined,
            (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, resolve(import.meta.dirname, "../../..")),
            {
                install: "assets/workspace/.nbook/agent/profiles",
                project: "workspace/world-engine-project/.nbook/agent/profiles",
            },
        );
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("world.engine");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("世界引擎");
        expect(snapshot.profiles.find((item) => item.key === "world.engine")).toEqual(expect.objectContaining({
            key: "world.engine",
            loadStatus: "loaded",
        }));
    }, 60_000);

    it("只暴露 World Engine 维护所需工具，并注入第一版边界", async () => {
        const prepared = await worldEngineProfile.prepare!({
            session: testSession({
                profileKey: "world.engine",
                currentProjectRoot: "world-engine-demo",
                customState: {},
                linkedAgents: [],
                archived: false,
                agentMode: "normal",
            }),
            initial: {},
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });
        const systemPrompt = prepared.systemPrompt ?? "";
        const historyText = (prepared.historyInitMessages ?? []).map((message) => messageText(message as never)).join("\n");
        const modelContextText = (prepared.modelContextMessages ?? []).map((message) => messageText(message as never)).join("\n");

        expect(worldEngineProfile.rootToolKeys).toEqual([
            "read",
            "write",
            "edit",
            "apply_patch",
            "get_agent_profile",
            "get_session",
            "execute_world",
        ]);
        expect(worldEngineProfile.rootToolKeys).not.toContain("subject_rag_search");
        expect(worldEngineProfile.rootToolKeys).not.toContain("get_story_tree");
        expect(worldEngineProfile.rootToolKeys).not.toContain("invoke_agent");
        expect(systemPrompt).toContain("世界引擎验证与维护 agent");
        expect(systemPrompt).toContain("旧 simulation/ workflow 暂不接入");
        expect(systemPrompt).toContain("使用单一核心工具 execute_world");
        expect(systemPrompt).toContain("首次写入某 subject 时会自动创建（不需要单独 create 步骤）");
        expect(systemPrompt).toContain("world.time.parse");
        expect(systemPrompt).toContain("world.slice.editPatches");
        expect(systemPrompt).toContain("公元2020年4月12日 18:00");
        expect(systemPrompt).toContain("severity");
        expect(systemPrompt).toContain("title/message/explanation");
        expect(systemPrompt).toContain("return string");
        expect(systemPrompt).toContain("文本摘要");
        expect(systemPrompt).not.toContain("星辉历");
        expect(systemPrompt).not.toContain("broken-relative / dangling-ref");
        expect(systemPrompt).not.toContain("E/A 判断");
        expect(systemPrompt).not.toContain("world.parseTime");
        expect(systemPrompt).not.toContain("world.editMutations");
        expect(systemPrompt).toContain("物理删除，不可恢复");
        expect(systemPrompt).toContain("issues");
        expect(historyText).toContain("```reference/world-engine/README.md");
        expect(historyText).toContain("```reference/world-engine/workflow.md");
        expect(historyText).toContain("```reference/world-engine/subject-lifecycle.md");
        expect(historyText).toContain("```reference/world-engine/schema-system.md");
        expect(modelContextText).toContain("projectRoot: world-engine-demo");
        expect(modelContextText).toContain("rawInstant: forbidden for Agent tools");
    });
});
