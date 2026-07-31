import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const promptListPath = fileURLToPath(new URL("../../common/low-code-form/LowCodePromptListField.vue", import.meta.url));
const lowCodeFormPath = fileURLToPath(new URL("../../common/low-code-form/LowCodeForm.vue", import.meta.url));
const settingsPanelPath = fileURLToPath(new URL("./NovelIdeAgentProfileModelSettingsPanel.vue", import.meta.url));

describe("Agent Profile 提示词设置 UI 合同", () => {
    it("提示词条目使用可辨识且可访问的启用/禁用双状态按钮", async () => {
        const source = await readFile(promptListPath, "utf8");

        expect(source).toContain(':aria-pressed="entry.enabled"');
        expect(source).toContain("entry.enabled ? '已启用' : '已禁用'");
        expect(source).toContain("updateEntry(entry.id, {enabled: !entry.enabled})");
        expect(source).toContain("标记为“已禁用”的条目不会进入最终提示词");
        expect(source).not.toContain('input type="checkbox"');
    });

    it("预设明确先写入草稿，并提示用户完成页面级持久化", async () => {
        const source = await readFile(lowCodeFormPath, "utf8");

        expect(source).toContain("创建/更新预设草稿");
        expect(source).toContain("仍需点击页面顶部“保存设定”才能持久化");
    });

    it("页面级保存失败同时提供局部错误和全局通知", async () => {
        const source = await readFile(settingsPanelPath, "utf8");

        expect(source).toContain("const notification = useNotification();");
        expect(source).toContain("errorText.value = message;");
        expect(source).toContain("notification.error(message");
    });
});
