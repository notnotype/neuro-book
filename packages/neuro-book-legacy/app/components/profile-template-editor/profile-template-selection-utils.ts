import type {ProfileTemplateSummaryDto} from "nbook/shared/dto/profile-template.dto";

type ProfileTemplateMode = "system-template" | "user-profile";

/**
 * 刷新 profile/template 列表后决定应保留的选中项。
 */
export function resolveRefreshedTemplateSelection(input: {
    mode: ProfileTemplateMode;
    templates: ProfileTemplateSummaryDto[];
    currentTemplate: string;
    preferredTemplate: string;
}): string {
    if (templateExists(input.templates, input.mode, input.currentTemplate)) {
        return input.currentTemplate;
    }
    if (templateExists(input.templates, input.mode, input.preferredTemplate)) {
        return input.preferredTemplate;
    }
    if (input.mode === "user-profile") {
        const defaultUserProfile = input.templates.find((item) => item.fileName.includes("leader.default.profile.tsx") || item.fileName.includes("leader-default.profile.tsx"));
        return defaultUserProfile?.fileName ?? input.templates[0]?.fileName ?? "";
    }
    return input.templates[0]?.name ?? "";
}

/**
 * 判断列表中是否存在指定选中值。
 */
function templateExists(templates: ProfileTemplateSummaryDto[], mode: ProfileTemplateMode, value: string): boolean {
    if (!value) {
        return false;
    }
    return templates.some((item) => mode === "user-profile"
        ? item.fileName === value
        : item.name === value);
}
