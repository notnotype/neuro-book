import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const settingsDialogPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeSettingsDialog.vue", import.meta.url));
const profileNavPath = fileURLToPath(new URL("../components/novel-ide/settings/AgentProfileNavList.vue", import.meta.url));
const modelPanelPath = fileURLToPath(new URL("../components/novel-ide/settings/NovelIdeModelSettingsPanel.vue", import.meta.url));

describe("Novel IDE Settings responsive contract", () => {
    it("窄屏使用横向导航和上下布局，桌面保留侧栏", async () => {
        const source = (await readFile(settingsDialogPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain("flex-col gap-4 md:flex-row md:gap-6");
        expect(source).toContain("w-full min-w-0 flex-col pb-2 md:w-[220px] md:shrink-0");
        expect(source).toContain("gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0");
        expect(source).toContain("hidden truncate text-[10px] text-[var(--text-muted)] md:block");
        expect(source).toContain("mt-auto hidden pt-4 md:block");
    });

    it("配置中心使用统一 full 预设，不重新把 Dialog 拉到 90vh", async () => {
        const source = (await readFile(settingsDialogPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain('size="full"');
        expect(source).not.toContain('height="90vh"');
        expect(source).not.toContain('width="min(1440px, calc(100vw - 48px))"');
    });

    it("Profile 导航不复制 Dialog 的旧视口高度预算", async () => {
        const source = (await readFile(profileNavPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).not.toContain("90vh");
        expect(source).toContain("overflow-y-auto");
    });

    it("模型设置双栏的 sticky 定位只作用于 xl 桌面断点", async () => {
        const source = (await readFile(modelPanelPath, "utf8")).replace(/\r\n/g, "\n");

        expect(source).toContain("xl:sticky xl:top-4");
        expect(source).toContain("xl:items-start");
        expect(source).not.toContain("sticky top-4");
        expect(source).not.toContain("flex h-fit flex-col");
    });
});
