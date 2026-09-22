import {describe, expect, it} from "vitest";
import {
    countProfileRuntimeOverrides,
    createProfileRuntimeSettingsDraft,
    parseProfileRuntimeSettingsDraft,
    resolveAgentProfileRuntimeBaseline,
    resolveAgentRuntimeDefaultsBaseline,
    resolveProfileRuntimeInheritance,
} from "./profile-runtime-settings";
import type {ProfileRuntimeSettingsDto} from "nbook/shared/dto/config.dto";

const harness: ProfileRuntimeSettingsDto = {
    summarizer: {enabled: false, profileKey: "summarizer", trigger: "afterInvocation", interval: {kind: "sourceInvocation", value: 16}, maxDialogueContentTokens: 80_000},
    compaction: {enabled: true, trigger: {kind: "autoReserve"}, reserveTokens: 25_600, keepRecent: {kind: "tokens", value: 24_000}, prompt: "prompt", summaryPrefix: "prefix"},
    fileChangeNotice: {diffMaxChars: 512},
};

describe("profile runtime settings editor", () => {
    it("空白表示继承，非法非空值产生字段错误", () => {
        const draft = createProfileRuntimeSettingsDraft(undefined);
        draft.fileChangeDiffMaxChars = "9000";
        draft.compactionTriggerKind = "percent";
        draft.compactionTriggerValue = "2";
        draft.compactionKeepRecentKind = "tokens";
        draft.compactionKeepRecentValue = "1.5";

        const result = parseProfileRuntimeSettingsDraft(draft);
        expect(result.patch.fileChangeNotice).toBeUndefined();
        expect(result.patch.compaction?.trigger).toBeUndefined();
        expect(result.errors).toMatchObject({
            fileChangeDiffMaxChars: "diffRange",
            compactionTriggerValue: "percentRange",
            compactionKeepRecentValue: "integer",
        });
    });

    it("接受 diff 边界和完整判别联合，不截断整数", () => {
        const draft = createProfileRuntimeSettingsDraft(undefined);
        draft.fileChangeDiffMaxChars = "0";
        draft.compactionTriggerKind = "tokens";
        draft.compactionTriggerValue = "40000";
        draft.compactionKeepRecentKind = "percent";
        draft.compactionKeepRecentValue = "0.25";

        const result = parseProfileRuntimeSettingsDraft(draft);
        expect(result.errors).toEqual({});
        expect(result.patch).toMatchObject({
            fileChangeNotice: {diffMaxChars: 0},
            compaction: {
                trigger: {kind: "tokens", value: 40_000},
                keepRecent: {kind: "percent", value: 0.25},
            },
        });
    });

    it("按层记录字段来源，判别联合整体切换来源", () => {
        const result = resolveProfileRuntimeInheritance(harness, [
            {source: "profileDefault", patch: {summarizer: {enabled: true}, compaction: {trigger: {kind: "percent", value: 0.8}}}},
            {source: "globalDefault", patch: {summarizer: {profileKey: "global"}}},
            {source: "projectDefault", patch: {compaction: {trigger: {kind: "tokens", value: 40_000}}}},
        ]);

        expect(result.settings.summarizer).toMatchObject({enabled: true, profileKey: "global"});
        expect(result.sources.summarizerEnabled).toBe("profileDefault");
        expect(result.sources.summarizerProfileKey).toBe("globalDefault");
        expect(result.settings.compaction.trigger).toEqual({kind: "tokens", value: 40_000});
        expect(result.sources.compactionTriggerKind).toBe("projectDefault");
        expect(result.sources.compactionTriggerValue).toBe("projectDefault");
    });

    it("覆盖计数只统计真正写进配置的字段", () => {
        expect(countProfileRuntimeOverrides(createProfileRuntimeSettingsDraft(undefined))).toBe(0);

        const draft = createProfileRuntimeSettingsDraft(undefined);
        // kind + value 成对写入同一个 interval 字段，只能算 1 项
        draft.summarizerIntervalKind = "sourceInvocation";
        draft.summarizerIntervalValue = "8";
        draft.summarizerEnabled = true;
        draft.fileChangeDiffMaxChars = "256";
        expect(countProfileRuntimeOverrides(draft)).toBe(3);

        // 越界值不会进 patch，也不计入覆盖数
        draft.fileChangeDiffMaxChars = "99999";
        expect(countProfileRuntimeOverrides(draft)).toBe(2);
    });
});

describe("Agent Profile runtime baseline layers", () => {
    it("defaults baseline uses harness globally and saved global patch in project scope", () => {
        const globalResult = resolveAgentRuntimeDefaultsBaseline(harness, "global", {summarizer: {profileKey: "saved-global"}});
        const projectResult = resolveAgentRuntimeDefaultsBaseline(harness, "project", {summarizer: {profileKey: "saved-global"}});

        expect(globalResult.settings.summarizer.profileKey).toBe("summarizer");
        expect(globalResult.sources.summarizerProfileKey).toBe("harness");
        expect(projectResult.settings.summarizer.profileKey).toBe("saved-global");
        expect(projectResult.sources.summarizerProfileKey).toBe("globalDefault");
    });

    it("global scope uses profileDefaults when no current defaults draft overrides it", () => {
        const result = resolveAgentProfileRuntimeBaseline(harness, "global", {
            profileDefaults: {summarizer: {profileKey: "profile-default"}},
            globalDefaultsPatch: {summarizer: {profileKey: "saved-global"}},
            globalProfilePatch: {summarizer: {enabled: true}},
            defaultsDraftPatch: {},
        });

        expect(result.settings.summarizer.profileKey).toBe("profile-default");
        expect(result.sources.summarizerProfileKey).toBe("profileDefault");
        expect(result.settings.summarizer.enabled).toBe(false);
        expect(result.sources.summarizerEnabled).toBe("harness");
    });

    it("global scope uses the current defaults draft as globalDefault, without the current Profile draft", () => {
        const result = resolveAgentProfileRuntimeBaseline(harness, "global", {
            profileDefaults: {summarizer: {profileKey: "profile-default"}},
            globalDefaultsPatch: {summarizer: {profileKey: "saved-global"}},
            globalProfilePatch: {summarizer: {enabled: true}},
            defaultsDraftPatch: {summarizer: {profileKey: "draft-global"}},
        });

        expect(result.settings.summarizer.profileKey).toBe("draft-global");
        expect(result.sources.summarizerProfileKey).toBe("globalDefault");
        expect(result.settings.summarizer.enabled).toBe(false);
        expect(result.sources.summarizerEnabled).toBe("harness");
    });
    it("project scope falls back to the saved global baseline after clearing project defaults", () => {
        const result = resolveAgentProfileRuntimeBaseline(harness, "project", {
            profileDefaults: {summarizer: {profileKey: "profile-default"}},
            globalDefaultsPatch: {summarizer: {profileKey: "saved-global"}},
            globalProfilePatch: {summarizer: {enabled: false}},
            defaultsDraftPatch: {},
        });

        expect(result.settings.summarizer.profileKey).toBe("saved-global");
        expect(result.sources.summarizerProfileKey).toBe("globalDefault");
    });

    it("project scope resolves harness, saved global, global Profile, then current project defaults", () => {
        const result = resolveAgentProfileRuntimeBaseline(harness, "project", {
            profileDefaults: {summarizer: {profileKey: "profile-default"}},
            globalDefaultsPatch: {summarizer: {profileKey: "saved-global", enabled: true}},
            globalProfilePatch: {summarizer: {enabled: false}},
            defaultsDraftPatch: {summarizer: {profileKey: "draft-project"}},
        });

        expect(result.settings.summarizer.profileKey).toBe("draft-project");
        expect(result.sources.summarizerProfileKey).toBe("projectDefault");
        expect(result.settings.summarizer.enabled).toBe(false);
        expect(result.sources.summarizerEnabled).toBe("globalProfile");
    });
});
