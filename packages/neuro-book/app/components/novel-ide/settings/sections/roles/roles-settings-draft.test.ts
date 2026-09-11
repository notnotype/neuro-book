import {describe, expect, it} from "vitest";
import {
    addSpecialistRole,
    allRoles,
    buildModelRoleCatalog,
    buildRolesSection,
    createRolesSettingsDraft,
    isEditableRole,
    nextCustomRoleId,
    removeRole,
    roleConfigIssues,
} from "./roles-settings-draft";

/** 测试用的 translator：键原样返回，这样断言可以直接比对键名。 */
const identityTranslate = (key: string): string => key;

describe("roles-settings-draft", () => {
    it("初始草稿：梯度轴四档 + 专精轴五个，全部是内置角色、默认启用、未绑定", () => {
        const draft = createRolesSettingsDraft(identityTranslate);

        expect(draft.gradient.map((role) => role.id)).toEqual(["tiny", "fast", "main", "deep"]);
        expect(draft.specialist.map((role) => role.id)).toEqual(["summarize", "writer", "narrative", "plan", "vision"]);
        expect(allRoles(draft).every((role) => role.builtIn)).toBe(true);
        expect(allRoles(draft).every((role) => role.enabled)).toBe(true);
        expect(allRoles(draft).every((role) => role.modelKey === null)).toBe(true);
        expect(allRoles(draft).every((role) => !isEditableRole(role))).toBe(true);
        expect(draft.gradient[0]!.name).toBe("settings.panels.roles.roleTiny");
        expect(draft.gradient[0]!.description).toBe("settings.panels.roles.purposeTiny");
    });

    it("新增的是用户自建角色：可编辑、可删除、id 稳定不冲突；内置角色删不掉", () => {
        let draft = createRolesSettingsDraft(identityTranslate);
        draft = addSpecialistRole(draft, identityTranslate);

        expect(draft.specialist).toHaveLength(6);
        const added = draft.specialist[5]!;
        expect(added.id).toBe("custom-1");
        expect(added.builtIn).toBe(false);
        expect(isEditableRole(added)).toBe(true);
        expect(added.modelKey).toBeNull();
        expect(nextCustomRoleId(draft)).toBe("custom-2");

        draft = addSpecialistRole(draft, identityTranslate);
        expect(draft.specialist.map((role) => role.id)).toEqual(["summarize", "writer", "narrative", "plan", "vision", "custom-1", "custom-2"]);

        expect(removeRole(draft, "custom-1").specialist.map((role) => role.id)).not.toContain("custom-1");
        // 删掉中间的自建角色后，新 id 仍然避开已用的键
        expect(nextCustomRoleId(removeRole(draft, "custom-1"))).toBe("custom-1");
        // 内置角色（含梯度轴与专精轴种子）删不掉，原样返回
        expect(removeRole(draft, "summarize").specialist).toHaveLength(7);
        expect(removeRole(draft, "main").gradient).toHaveLength(4);
        expect(removeRole(draft, "unknown").specialist).toHaveLength(7);
    });

    it("配置错误只报启用的角色：停用的角色不参与校验", () => {
        const draft = createRolesSettingsDraft(identityTranslate);
        draft.gradient[0]!.modelKey = "gpt-5.1-mini";

        // 九个角色里唯一配好的是 tiny：其余八个都缺模型
        const issues = roleConfigIssues(draft);
        expect(issues.filter((issue) => issue.reason === "missing-model")).toHaveLength(8);
        expect(issues.some((issue) => issue.reason === "missing-model" && issue.id === "tiny")).toBe(false);

        // 停用一个未配置的角色，它不再产生问题
        draft.gradient[1]!.enabled = false;
        expect(roleConfigIssues(draft).some((issue) => issue.id === "fast")).toBe(false);

        draft.specialist[0]!.description = "   ";
        draft.specialist[0]!.modelKey = "gpt-5.1-mini";
        expect(roleConfigIssues(draft)).toContainEqual({id: "summarize", reason: "missing-description"});
    });

    it("模型看到的目录只含启用、已绑定且有描述的条目", () => {
        const draft = createRolesSettingsDraft(identityTranslate);
        draft.gradient[2]!.modelKey = "claude-sonnet-4.5";
        draft.gradient[0]!.modelKey = "gpt-5.1-mini";
        draft.gradient[0]!.description = "";
        draft.gradient[1]!.modelKey = "gpt-5.1-mini";
        draft.gradient[1]!.enabled = false;

        expect(buildModelRoleCatalog(draft)).toEqual([{
            id: "main",
            name: "settings.panels.roles.roleMain",
            description: "settings.panels.roles.purposeMain",
            modelKey: "claude-sonnet-4.5",
        }]);
    });

    it("写回体带轴、启用状态与全部角色（含未绑定），因为宿主需要它来报配置错误", () => {
        const draft = createRolesSettingsDraft(identityTranslate);
        draft.specialist[4]!.modelKey = "gpt-5.1";
        draft.gradient[3]!.enabled = false;

        const payload = buildRolesSection(draft);
        expect(payload.roles).toHaveLength(9);
        expect(payload.roles[0]).toMatchObject({id: "tiny", axis: "gradient", modelKey: null, enabled: true});
        expect(payload.roles[3]).toMatchObject({id: "deep", axis: "gradient", enabled: false});
        expect(payload.roles[8]).toMatchObject({id: "vision", axis: "specialist", modelKey: "gpt-5.1", enabled: true});
    });
});
