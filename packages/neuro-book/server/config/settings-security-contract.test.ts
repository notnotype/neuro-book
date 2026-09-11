import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

describe("SecuritySettingsView boot config contract", () => {
    it("Boot Config 页面展示运行态状态和只读示例，且没有可写入口", async () => {
        const dialogSource = await readFile("app/components/novel-ide/NovelIdeSettingsDialog.vue", "utf-8");
        const viewSource = await readFile("app/components/novel-ide/settings/sections/security/SecuritySettingsView.vue", "utf-8");

        // 宿主只把运行时状态喂给视图；说明、示例与警告都在视图里。
        expect(dialogSource).toContain("useAuthSessionState");
        expect(dialogSource).toContain(":auth-enabled=\"bootAuthEnabled\"");
        expect(viewSource).toContain("settings.security.runtimeStatusDescription");
        expect(viewSource).toContain("settings.security.exampleTitle");
        expect(viewSource).toContain("settings.security.warning");
        expect(viewSource).not.toContain("FormCheckbox");
        expect(viewSource).not.toContain("saveSettings");
    });
});
