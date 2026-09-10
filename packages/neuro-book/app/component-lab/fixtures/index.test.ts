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
            "loading",
            "saving",
            "load-error",
            "save-error",
        ]);
    });
});
