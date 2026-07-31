import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const statusPanelPath = fileURLToPath(new URL("../components/novel-ide/rp/RpStatusPanel.vue", import.meta.url));
const sidebarPath = fileURLToPath(new URL("../components/novel-ide/rp/RpSidebar.vue", import.meta.url));
const modeSurfacePath = fileURLToPath(new URL("../components/novel-ide/rp/RpModeSurface.vue", import.meta.url));

describe("RP intake confirmation UI contract", () => {
    it("只在持久 reviewing 状态显示绑定版本的确认并开团按钮", async () => {
        const statusPanel = await readFile(statusPanelPath, "utf-8");
        expect(statusPanel).toContain("overview?.intake.phase === 'reviewing'");
        expect(statusPanel).toContain('data-testid="rp-confirm-intake-button"');
        expect(statusPanel).toContain("emit('confirm-intake', overview.intake.version)");
        expect(statusPanel).not.toContain("formToolCallId");
    });

    it("状态页通过玩家 API 确认当前版本，而不是调用 Agent 工具", async () => {
        const sidebar = await readFile(sidebarPath, "utf-8");
        expect(sidebar).toContain('"/api/projects/rp/intake-confirm"');
        expect(sidebar).toContain("body: {version, confirmed: true}");
        expect(sidebar).toContain('emit("intake-confirmed", {version})');
        expect(sidebar).not.toContain("rp_intake op=confirm");
    });

    it("确认后在主持空闲时自动续跑，并在主持已进入初始化时避免重复消息", async () => {
        const modeSurface = await readFile(modeSurfacePath, "utf-8");
        expect(modeSurface).toContain("watch(rpSessionRunning");
        expect(modeSurface).toContain("if (wasRunning && !running)");
        expect(modeSurface).toContain('overview.intake.phase !== "confirmed"');
        expect(modeSurface).toContain("请调用 rp_intake op=get 核对 confirmedVersion");
        expect(modeSurface).toContain('@intake-confirmed="void handleIntakeConfirmed($event)"');
    });
});
