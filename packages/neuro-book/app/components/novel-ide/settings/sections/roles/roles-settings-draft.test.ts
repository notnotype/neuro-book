import {describe, expect, it} from "vitest";
import {
    addSpecialistRole,
    allRoles,
    buildModelRoleCatalog,
    buildRolesSection,
    createRolesSettingsDraft,
    nextCustomRoleId,
    removeRole,
    roleConfigIssues,
} from "./roles-settings-draft";

/** 测试用的 translator：键原样返回，这样断言可以直接比对键名。 */
const identityTranslate = (key: string): string => key;

describe("roles-settings-draft", () => {
    it("初始草稿：梯度轴固定四档不可删，专精轴五个可删，名字与描述来自 translator", () => {
        const draft = createRolesSettingsDraft(identityTranslate);

        expect(draft.gradient.map((role) => role.id)).toEqual(["tiny", "fast", "main", "deep"]);
        expect(draft.specialist.map((role) => role.id)).toEqual(["summarize", "writer", "narrative", "plan", "vision"]);
        expect(draft.gradient.every((role) => !role.removable)).toBe(true);
        expect(draft.specialist.every((role) => role.removable)).toBe(true);
        expect(draft.gradient[0]!.name).toBe("settings.panels.roles.roleTiny");
        expect(draft.gradient[0]!.description).toBe("settings.panels.roles.purposeTiny");
        expect(draft.gradient[0]!.modelKey).toBeNull();
    });

    it("新增专精角色：id 稳定且不冲突，角色可删；梯度轴的角色删不掉", () => {
        let draft = createRolesSettingsDraft(identityTranslate);
        draft = addSpecialistRole(draft, identityTranslate);

        expect(draft.specialist).toHaveLength(6);
        const added = draft.specialist[5]!;
        expect(added.id).toBe("custom-1");
        expect(added.removable).toBe(true);
        expect(added.modelKey).toBeNull();
        expect(nextCustomRoleId(draft)).toBe("custom-2");

        draft = addSpecialistRole(draft, identityTranslate);
        expect(draft.specialist.map((role) => role.id)).toEqual(["summarize", "writer", "narrative", "plan", "vision", "custom-1", "custom-2"]);

        expect(removeRole(draft, "custom-1").specialist.map((role) => role.id)).not.toContain("custom-1");
        // 删掉 mid 序列里的角色后，新 id 仍然避开已用的键
        expect(nextCustomRoleId(removeRole(draft, "custom-1"))).toBe("custom-1");
        expect(removeRole(draft, "main").gradient).toHaveLength(4);
        expect(removeRole(draft, "unknown").specialist).toHaveLength(7);
    });

    it("配置错误：没绑模型或没写描述都要报出来（没有回落可以顶替）", () => {
        const draft = createRolesSettingsDraft(identityTranslate);
        draft.gradient[0]!.modelKey = "gpt-5.1-mini";

        const issues = roleConfigIssues(draft);
        // 九个角色里，唯一配好的是 tiny：其余八个都缺模型
        expect(issues.filter((issue) => issue.reason === "missing-model").map((issue) => issue.id)).toHaveLength(8);
        expect(issues.some((issue) => issue.reason === "missing-model" && issue.id === "tiny")).toBe(false);

        draft.specialist[0]!.description = "   ";
        draft.specialist[0]!.modelKey = "gpt-5.1-mini";
        expect(roleConfigIssues(draft)).toContainEqual({id: "summarize", reason: "missing-description"});
    });

    it("模型看到的目录只含有绑定且有描述的条目", () => {
        const draft = createRolesSettingsDraft(identityTranslate);
        draft.gradient[2]!.modelKey = "claude-sonnet-4.5";
        draft.gradient[0]!.modelKey = "gpt-5.1-mini";
        draft.gradient[0]!.description = "";

        expect(buildModelRoleCatalog(draft)).toEqual([{
            id: "main",
            name: "settings.panels.roles.roleMain",
            description: "settings.panels.roles.purposeMain",
            modelKey: "claude-sonnet-4.5",
        }]);
    });

    it("写回体带轴与全部角色（含未绑定），因为宿主需要它来报配置错误", () => {
        const draft = createRolesSettingsDraft(identityTranslate);
        draft.specialist[4]!.modelKey = "gpt-5.1";

        const payload = buildRolesSection(draft);
        expect(payload.roles).toHaveLength(9);
        expect(payload.roles[0]).toMatchObject({id: "tiny", axis: "gradient", modelKey: null});
        expect(payload.roles[8]).toMatchObject({id: "vision", axis: "specialist", modelKey: "gpt-5.1"});
    });
});
