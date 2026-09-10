import {describe, expect, it} from "vitest";
import {
    MODEL_ROLE_CATALOG,
    buildRolesSection,
    createRolesSettingsDraft,
    resolveEffectiveRole,
    resolveRoleModelKey,
} from "./roles-settings-draft";

describe("模型角色草稿", () => {
    it("初始草稿每个角色都未配置", () => {
        const draft = createRolesSettingsDraft();
        expect(Object.keys(draft.roles)).toHaveLength(MODEL_ROLE_CATALOG.length);
        expect(Object.values(draft.roles).every((value) => value === null)).toBe(true);
    });

    it("未配置时沿回落链取，narrative 走 writer 再走 main", () => {
        const draft = createRolesSettingsDraft();
        expect(resolveEffectiveRole(draft, "narrative")).toBeNull();

        draft.roles.main = "openai/gpt-5.1";
        expect(resolveEffectiveRole(draft, "narrative")).toBe("main");
        expect(resolveRoleModelKey(draft, "narrative")).toBe("openai/gpt-5.1");

        draft.roles.writer = "openai/o4-mini";
        expect(resolveEffectiveRole(draft, "narrative")).toBe("writer");
        expect(resolveRoleModelKey(draft, "narrative")).toBe("openai/o4-mini");
    });

    it("不能回落的角色不借用别人", () => {
        const draft = createRolesSettingsDraft();
        draft.roles.main = "openai/gpt-5.1";
        // vision 的 fallback 是 null：主模型支持不支持视觉是另一回事，这里不替它猜
        expect(resolveEffectiveRole(draft, "vision")).toBeNull();
        expect(resolveRoleModelKey(draft, "vision")).toBeNull();
    });

    it("自己绑了就不看回落", () => {
        const draft = createRolesSettingsDraft();
        draft.roles.main = "openai/gpt-5.1";
        draft.roles.narrative = "openai/o4-mini";
        expect(resolveEffectiveRole(draft, "narrative")).toBe("narrative");
        expect(resolveRoleModelKey(draft, "narrative")).toBe("openai/o4-mini");
    });

    it("写回体只保留有绑定的角色，并按目录顺序", () => {
        const draft = createRolesSettingsDraft();
        draft.roles.deep = "openai/o4-mini";
        draft.roles.tiny = "openai/gpt-5.1";
        expect(buildRolesSection(draft)).toEqual({
            roles: [
                {role: "tiny", modelKey: "openai/gpt-5.1"},
                {role: "deep", modelKey: "openai/o4-mini"},
            ],
        });
    });
});
