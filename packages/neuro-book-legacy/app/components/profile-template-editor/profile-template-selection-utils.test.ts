import {describe, expect, it} from "vitest";
import {resolveRefreshedTemplateSelection} from "nbook/app/components/profile-template-editor/profile-template-selection-utils";
import type {ProfileTemplateSummaryDto} from "nbook/shared/dto/profile-template.dto";

describe("profile template selection", () => {
    it("刷新用户 profile 列表时保留当前选中项", () => {
        const selected = resolveRefreshedTemplateSelection({
            mode: "user-profile",
            templates: userProfileTemplates(),
            currentTemplate: "builtin/leader.default.profile.tsx",
            preferredTemplate: "builtin/leader.assets.profile.tsx",
        });

        expect(selected).toBe("builtin/leader.default.profile.tsx");
    });

    it("当前选中项不存在时才回退到 preferredTemplate", () => {
        const selected = resolveRefreshedTemplateSelection({
            mode: "user-profile",
            templates: userProfileTemplates(),
            currentTemplate: "builtin/deleted.profile.tsx",
            preferredTemplate: "builtin/leader.assets.profile.tsx",
        });

        expect(selected).toBe("builtin/leader.assets.profile.tsx");
    });

    it("没有当前项和 preferredTemplate 时回退到 leader.default", () => {
        const selected = resolveRefreshedTemplateSelection({
            mode: "user-profile",
            templates: userProfileTemplates(),
            currentTemplate: "",
            preferredTemplate: "missing.profile.tsx",
        });

        expect(selected).toBe("builtin/leader.default.profile.tsx");
    });
});

/**
 * 构造 user-assets profile 下拉列表。
 */
function userProfileTemplates(): ProfileTemplateSummaryDto[] {
    return [
        {
            name: "leader.assets",
            fileName: "builtin/leader.assets.profile.tsx",
            profileKey: "leader.assets",
        },
        {
            name: "leader.default",
            fileName: "builtin/leader.default.profile.tsx",
            profileKey: "leader.default",
        },
    ];
}
