import {describe, expect, it} from "vitest";
import type {ConfigAgentProfileSettingsDto, ConfigEditorSnapshotDto} from "nbook/shared/dto/config.dto";
import {
    buildAgentProfileContext,
    buildAgentProfileGlobalPayload,
    buildAgentProfileProjectPayload,
    createAgentProfilePageDraft,
    resolveInheritedDefaultProfileKey,
    shouldPollAgentProfileBuildStatus,
    validateAgentProfileRuntimeDrafts,
    type AgentProfilePageSource,
} from "./agent-profile-page-draft";
import {createProfileRuntimeSettingsDraft} from "./profile-runtime-settings";
import type {AgentProfileSettingsPageDraft} from "./AgentProfileSettingsView.types";

const HARNESS_RUNTIME = {
    summarizer: {
        enabled: true,
        profileKey: "summarizer.default",
        trigger: "afterInvocation" as const,
        interval: {kind: "sourceInvocation" as const, value: 20},
        maxDialogueContentTokens: 4096,
    },
    compaction: {
        enabled: true,
        trigger: {kind: "autoReserve" as const},
        reserveTokens: 16384,
        keepRecent: {kind: "percent" as const, value: 0.25},
        prompt: "请压缩以下对话内容，保留关键事实。",
        summaryPrefix: "[摘要]",
    },
    fileChangeNotice: {diffMaxChars: 2048},
};

/** 只放被测字段，其余从略。 */
function profileMeta(profileKey: string, extra: Record<string, unknown> = {}): ConfigAgentProfileSettingsDto["agentProfiles"][number] {
    return {
        profileKey,
        name: profileKey,
        canResetHome: false,
        loadStatus: "loaded",
        runtime: {},
        issue: null,
        sourcePath: null,
        buildState: {running: false, queued: false, reason: null, updatedAt: null},
        settings: null,
        ...extra,
    } as unknown as ConfigAgentProfileSettingsDto["agentProfiles"][number];
}

function settingsFixture(overrides: Record<string, unknown> = {}): ConfigAgentProfileSettingsDto {
    return {
        enabledModels: [],
        validationIssues: [],
        profileModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off", stream: true},
        harnessRuntimeDefaults: HARNESS_RUNTIME,
        profileRuntimeDefaults: HARNESS_RUNTIME,
        globalRuntimeDefaultsPatch: {},
        projectRuntimeDefaultsPatch: {},
        agentProfiles: [],
        ...overrides,
    } as unknown as ConfigAgentProfileSettingsDto;
}

function snapshotFixture(overrides: Record<string, unknown> = {}): ConfigEditorSnapshotDto {
    return {
        global: {},
        project: null,
        defaultProfileSettings: {},
        ...overrides,
    } as unknown as ConfigEditorSnapshotDto;
}

function sourceFixture(input: {
    scope: "global" | "project";
    snapshot?: Record<string, unknown>;
    settings?: Record<string, unknown>;
}): AgentProfilePageSource {
    return {
        scope: input.scope,
        snapshot: snapshotFixture(input.snapshot),
        settings: settingsFixture(input.settings),
    };
}

describe("agent-profile-page-draft", () => {
    it("Global 默认参数的两条 null 兜底：reasoningEffort → off、stream → true", () => {
        const source = sourceFixture({
            scope: "global",
            settings: {profileModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: null, stream: null}},
        });

        const draft = createAgentProfilePageDraft(source, {workspaceSlot: "novel"});

        expect(draft.modelDefaults.reasoningEffort).toBe("off");
        expect(draft.modelDefaults.stream).toBe(true);
    });

    it("Project 作用域的默认 Profile 取 projectDefaultProfileKey", () => {
        const source = sourceFixture({
            scope: "project",
            snapshot: {defaultProfileSettings: {projectDefaultProfileKey: "fact-reviewer"}},
        });

        expect(createAgentProfilePageDraft(source, {workspaceSlot: "novel"}).defaultProfileKey).toBe("fact-reviewer");
    });

    it("继承默认 Profile：Global 看 workspace 槽位，Project 优先跟随 Global 已保存值", () => {
        const globalSource = sourceFixture({scope: "global"});
        expect(resolveInheritedDefaultProfileKey(globalSource, {workspaceSlot: "novel"})).toBe("leader.default");
        expect(resolveInheritedDefaultProfileKey(globalSource, {workspaceSlot: "userAssets"})).toBe("leader.assets");

        const projectSource = sourceFixture({scope: "project", snapshot: {defaultProfileSettings: {globalDefaultProfileKey: "story-writer"}}});
        expect(resolveInheritedDefaultProfileKey(projectSource, {workspaceSlot: "novel"})).toBe("story-writer");

        const systemFallback = sourceFixture({scope: "project", snapshot: {defaultProfileSettings: {systemDefaultProfileKey: "leader.default"}}});
        expect(resolveInheritedDefaultProfileKey(systemFallback, {workspaceSlot: "novel"})).toBe("leader.default");
    });

    it("Global 写回体保留 agent 段其它字段与另一个 workspace 槽位", () => {
        const source = sourceFixture({
            scope: "global",
            snapshot: {
                global: {
                    agent: {
                        defaultProfileKey: {novel: "story-writer", userAssets: "leader.assets"},
                        visibleModels: [{key: "openai/gpt-5.1"}],
                    },
                },
            },
        });
        const draft = createAgentProfilePageDraft(source, {workspaceSlot: "novel"});

        const payload = buildAgentProfileGlobalPayload(source, {...draft, defaultProfileKey: "fact-reviewer"}, {workspaceSlot: "novel"});

        expect(payload.agent?.defaultProfileKey).toEqual({novel: "fact-reviewer", userAssets: "leader.assets"});
        expect(payload.agent?.visibleModels).toEqual([{key: "openai/gpt-5.1"}]);
    });

    it("Project 写回体只写显式覆盖", () => {
        const source = sourceFixture({scope: "project"});
        const draft = createAgentProfilePageDraft(source, {workspaceSlot: "novel"});

        expect(buildAgentProfileProjectPayload({...draft, defaultProfileKey: "line-editor"}).agent?.defaultProfileKey).toBe("line-editor");
    });

    it("runtime 非法时校验返回错误，按 profile 归位", () => {
        const draft = createEmptyDraftWithProfile("fact-reviewer", (profile) => {
            profile.runtime = createProfileRuntimeSettingsDraft({
                compaction: {keepRecent: {kind: "percent", value: 0.25}},
            });
            profile.runtime.compactionKeepRecentKind = "percent";
            profile.runtime.compactionKeepRecentValue = "2";
        });

        const result = validateAgentProfileRuntimeDrafts(draft);

        expect(result.ok).toBe(false);
        expect(result.profileErrors["fact-reviewer"]?.compactionKeepRecentValue).toBeTruthy();
    });

    it("runtime 全部合法时校验通过", () => {
        const draft = createEmptyDraftWithProfile("fact-reviewer", () => {});

        expect(validateAgentProfileRuntimeDrafts(draft).ok).toBe(true);
    });

    it("有 profile 在编译时才需要轮询", () => {
        const compiling = createEmptyDraftWithProfile("story-writer", (profile) => {
            profile.loadStatus = "compiling";
        });
        expect(shouldPollAgentProfileBuildStatus(compiling)).toBe(true);

        const idle = createEmptyDraftWithProfile("story-writer", () => {});
        expect(shouldPollAgentProfileBuildStatus(idle)).toBe(false);
    });

    it("context 的 runtime 继承基线来自 meta 的各层 patch", () => {
        const source = sourceFixture({
            scope: "project",
            snapshot: {global: {agent: {profiles: {"fact-reviewer": {model: {temperature: 0.2}}}}}},
            settings: {
                agentProfiles: [profileMeta("fact-reviewer", {
                    runtime: {profileDefaults: {summarizer: {enabled: false}}},
                })],
            },
        });

        const context = buildAgentProfileContext(source, {workspaceSlot: "novel", descriptions: {"fact-reviewer": "校对事实。"}});

        expect(context.scope).toBe("project");
        expect(context.globalProfileModels["fact-reviewer"]).toEqual({temperature: 0.2});
        expect(context.descriptions["fact-reviewer"]).toBe("校对事实。");
    });
});

/** 构造一个带单个 profile 的页面草稿，供校验与轮询用例使用。 */
function createEmptyDraftWithProfile(profileKey: string, mutate: (profile: AgentProfileSettingsPageDraft["profiles"][number]) => void): AgentProfileSettingsPageDraft {
    const source = sourceFixture({
        scope: "global",
        settings: {agentProfiles: [profileMeta(profileKey)]},
    });
    const draft = createAgentProfilePageDraft(source, {workspaceSlot: "novel"});
    const profile = draft.profiles[0]!;
    mutate(profile);
    return draft;
}
