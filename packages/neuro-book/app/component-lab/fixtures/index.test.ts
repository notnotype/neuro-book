import {describe, expect, it} from "vitest";
import {findLabFixture} from "./index";

describe("AgentProfileSettingsView Lab 场景", () => {
    it("保留既有状态场景并登记 DialogWindow 内嵌场景", () => {
        const fixture = findLabFixture("AgentProfileSettingsView");

        expect(fixture).not.toBeNull();
        expect(fixture?.scenes.map((scene) => scene.id)).toEqual([
            "global",
            "project",
            "dialog-window",
            "statuses",
            "custom-settings",
            "empty",
        ]);
    });
});

describe("FrontendSettingsView Lab 场景", () => {
    it("登记两轴选择器的两种场景", () => {
        const fixture = findLabFixture("FrontendSettingsView");

        expect(fixture).not.toBeNull();
        expect(fixture?.scenes.map((scene) => scene.id)).toEqual(["default", "disabled"]);
    });
});

describe("ProjectPicker 及子组件 Lab 场景", () => {
    it("完整登记 ProjectPickerView 及全部 7 个子组件", async () => {
        const expectedComponents = [
            "ProjectPickerView",
            "ProjectPickerHeader",
            "ProjectPickerEmptyState",
            "ProjectCard",
            "ProjectCreateCoverPreview",
            "ProjectCreateForm",
            "ProjectCreateDialog",
            "ProjectCoverDialog",
        ];

        for (const name of expectedComponents) {
            const fixture = findLabFixture(name);
            expect(fixture, `Fixture for ${name} should be registered`).not.toBeNull();
            expect(fixture?.scenes.length).toBeGreaterThan(0);
            expect(typeof fixture?.load).toBe("function");
        }
    });

    it("ProjectCreateForm 包含拟真与恢复场景", () => {
        const fixture = findLabFixture("ProjectCreateForm");
        expect(fixture?.scenes.map((s) => s.id)).toEqual([
            "default",
            "filled",
            "creating",
            "recovery-error",
            "phone",
        ]);
    });
});

