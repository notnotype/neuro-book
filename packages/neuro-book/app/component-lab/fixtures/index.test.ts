import {describe, expect, it} from "vitest";
import {labComponents} from "../component-index";
import {findLabFixture, labFixtures} from "./index";

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

describe("Lab 场景覆盖", () => {
    /**
     * 这不是「所有组件都该有场景」的整洁强迫症：组件规范把纯零件与受控零件的状态说明交给
     * fixture 承载，所以一个可挂载却没有场景的组件，等于既没有文档也没有演示。
     * 能力标签阻断的组件（io:/state:shared-write/persist:）不在此列——Lab 不给它们造替代场景。该仓库合同见 `docs/specs/ui/component-lab.md` 的失败与恢复与验收条款。
     */
    it("索引里每个可挂载组件都登记了至少一个场景", () => {
        const missing = labComponents
            .filter((entry) => entry.mountable)
            .filter((entry) => {
                const fixture = findLabFixture(entry.name);
                return fixture === null || fixture.scenes.length === 0 || typeof fixture.load !== "function";
            })
            .map((entry) => entry.name);

        expect(missing, `这些组件可以挂载却没有场景登记：${missing.join("、")}。在 fixtures/index.ts 里为它们登记场景；确实只能在正式界面验证的，按组件规范补阻断标签，而不是留着空档。`).toEqual([]);
    });

    it("登记的每个场景都指向索引里真实存在的可挂载组件", () => {
        const mountable = new Set(labComponents.filter((entry) => entry.mountable).map((entry) => entry.name));
        const dead = labFixtures.filter((fixture) => !mountable.has(fixture.component)).map((fixture) => fixture.component);

        expect(dead, `这些登记指向不存在的组件名或不可挂载的组件：${dead.join("、")}。组件名要与同名组件文档一致，否则 Lab 永远选不中它。`).toEqual([]);
    });
});

