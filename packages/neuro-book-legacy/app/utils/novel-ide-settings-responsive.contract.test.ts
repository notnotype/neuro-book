import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const settingsDialogPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeSettingsDialog.vue", import.meta.url));
const settingsViewPath = fileURLToPath(new URL("../components/novel-ide/settings/sections/NovelIdeSettingsView.vue", import.meta.url));
const profileNavPath = fileURLToPath(new URL("../components/novel-ide/settings/sections/agent-profile/components/AgentProfileNavList.vue", import.meta.url));
const providerRailPath = fileURLToPath(new URL("../components/novel-ide/settings/sections/providers/components/ModelProviderRail.vue", import.meta.url));

async function read(path: string): Promise<string> {
    return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}

describe("Novel IDE Settings responsive contract", () => {
    it("窄容器退化为单列：外壳靠容器查询在导航与详情之间切换", async () => {
        const shell = await read(settingsViewPath);

        expect(shell).toContain("container-type: inline-size");
        expect(shell).toContain("@container (max-width: 699px)");
        expect(shell).toContain("settings-nav-aside");
        expect(shell).toContain("settings-detail-section");
        expect(shell).toContain("settings-mobile-bar");
    });

    it("宿主是 DialogWindow，尺寸只有一个来源：显式宽高，拖完记得住", async () => {
        const dialog = await read(settingsDialogPath);

        expect(dialog).toContain("<DialogWindow");
        expect(dialog).toContain(':width="settingsWindowSize.width"');
        expect(dialog).toContain(':height="settingsWindowSize.height"');
        expect(dialog).toContain("resizable");
        // 拖拽后的尺寸落到本机偏好，而不是每次回到写死的预设。
        expect(dialog).toContain('nbook.settingsDialog.size');
        expect(dialog).toContain('@update:width="updateSettingsWindowWidth"');
        expect(dialog).toContain('@update:height="updateSettingsWindowHeight"');
        expect(dialog).not.toContain('size="full"');
        expect(dialog).not.toContain('height="90vh"');
        expect(dialog).not.toContain('width="min(1440px, calc(100vw - 48px))"');
    });

    it("Profile 导航不复制 Dialog 的旧视口高度预算", async () => {
        const source = await read(profileNavPath);

        expect(source).not.toContain("90vh");
        expect(source).toContain("overflow-y-auto");
    });

    it("Provider 栏位不回到旧面板的 sticky 双栏写法", async () => {
        const rail = await read(providerRailPath);

        expect(rail).not.toContain("sticky top-4");
        expect(rail).not.toContain("xl:sticky xl:top-4");
        expect(rail).not.toContain("flex h-fit flex-col");
    });
});
