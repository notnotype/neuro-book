import {describe, expect, it} from "vitest";
import {mergeProfileRuntimePatches, resolveProfileRuntimeSettings} from "nbook/server/agent/profiles/profile-runtime-settings";
import {resolveProfileSummarizer} from "nbook/server/agent/profiles/profile-summarizer";

describe("profile summarizer resolver", () => {
    it("按六层优先级逐字段合并，判别联合由更高层整体替换", () => {
        const configured = mergeProfileRuntimePatches(
            {summarizer: {profileKey: "global-default", interval: {kind: "sourceInvocation", value: 12}}},
            {summarizer: {enabled: true}, compaction: {trigger: {kind: "percent", value: 0.8}}},
            {summarizer: {profileKey: "global-profile"}, compaction: {keepRecent: {kind: "percent", value: 0.25}}},
            {summarizer: {maxDialogueContentTokens: 60_000}, compaction: {trigger: {kind: "tokens", value: 40_000}}},
            {summarizer: {enabled: false}, fileChangeNotice: {diffMaxChars: 0}},
        );
        const effective = resolveProfileRuntimeSettings({
            summarizer: {enabled: true, profileKey: "profile-default"},
            compaction: {reserveTokens: 20_000},
        }, configured);

        expect(effective.summarizer).toMatchObject({
            enabled: false,
            profileKey: "global-profile",
            interval: {kind: "sourceInvocation", value: 12},
            maxDialogueContentTokens: 60_000,
        });
        expect(effective.compaction).toMatchObject({
            reserveTokens: 20_000,
            trigger: {kind: "tokens", value: 40_000},
            keepRecent: {kind: "percent", value: 0.25},
        });
        expect(effective.fileChangeNotice.diffMaxChars).toBe(0);
        expect(configured.compaction?.trigger).toEqual({kind: "tokens", value: 40_000});
    });

    it("系统默认关闭，Profile 出厂默认可以开启并覆盖间隔", () => {
        const plain = resolveProfileRuntimeSettings(undefined, undefined);
        const declared = resolveProfileRuntimeSettings({
            summarizer: {enabled: true, interval: {kind: "sourceInvocation", value: 3}},
        }, undefined);

        expect(resolveProfileSummarizer(plain.summarizer)).toBeNull();
        expect(resolveProfileSummarizer(declared.summarizer)).toMatchObject({
            profileKey: "summarizer",
            input: {interval: {kind: "sourceInvocation", value: 3}},
        });
    });

    it("配置关闭优先，手动 force 仍使用最终策略", () => {
        const settings = resolveProfileRuntimeSettings({
            summarizer: {enabled: true, interval: {kind: "sourceInvocation", value: 3}},
        }, {
            summarizer: {enabled: false, profileKey: "custom-summarizer"},
        });

        expect(resolveProfileSummarizer(settings.summarizer)).toBeNull();
        expect(resolveProfileSummarizer(settings.summarizer, true)).toMatchObject({
            profileKey: "custom-summarizer",
            input: {interval: {kind: "sourceInvocation", value: 3}},
        });
    });
});
