import {describe, expect, it} from "vitest";
import {
    createProfileRuntimeSettingsDraft,
    parseProfileRuntimeSettingsDraft,
    resolveProfileRuntimeInheritance,
} from "nbook/app/components/novel-ide/settings/profile-runtime-settings";
import type {ProfileRuntimeSettingsDto} from "nbook/shared/dto/config.dto";

const harness: ProfileRuntimeSettingsDto = {
    summarizer: {enabled: false, profileKey: "summarizer", trigger: "afterInvocation", interval: {kind: "sourceInvocation", value: 16}, maxDialogueContentTokens: 80_000},
    compaction: {enabled: true, trigger: {kind: "autoReserve"}, reserveTokens: 25_600, keepRecent: {kind: "tokens", value: 24_000}},
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
});
