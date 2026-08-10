import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Desktop storage contract", () => {
    it("在创建单实例锁前固定用户级 identity、sessionData 和 logs", async () => {
        const source = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        const preload = await readFile(resolve("desktop/electron/src/preload.ts"), "utf8");
        const startup = await readFile(resolve("desktop/electron/src/startup.html"), "utf8");
        const installedRoot = await readFile(resolve("desktop/shared/src/installed-root.ts"), "utf8");
        expect(source.indexOf('app.setPath("userData", desktopIdentityRoot())')).toBeGreaterThan(-1);
        expect(source.indexOf('app.setPath("sessionData", join(config.desktopRoot, "webview"))')).toBeGreaterThan(-1);
        expect(source.indexOf('app.setPath("logs", join(config.stateRoot, "logs"))')).toBeGreaterThan(-1);
        expect(source.indexOf('app.setPath("userData", desktopIdentityRoot())')).toBeLessThan(source.indexOf("app.requestSingleInstanceLock("));
        expect(source).toContain('window?.webContents.send("neurobook:second-instance"');
        expect(source).toContain("parseDesktopLaunchRequest(additionalData)");
        expect(source).toContain("process.defaultApp ? 2 : 1");
        expect(source).toContain("flushDesktopLaunchRequests");
        expect(preload).toContain("onLaunchRequest:");
        expect(preload).toContain('ipcRenderer.on("neurobook:second-instance"');
        expect(preload).toContain("pendingLaunchRequests");
        expect(source).toContain('window-state.json');
        expect(source).toContain('screen.getAllDisplays()');
        expect(source).toContain('nativeImage.createFromPath');
        expect(source).toContain('kind: "electron-tray-installed"');
        expect(source).toContain('if (window?.isMinimized()) window.restore()');
        expect(source).toContain('kind: "electron-window-state"');
        expect(source).toContain('正在修复 Product 回执');
        expect(startup).toContain('data-action="open-logs"');
        expect(startup).toContain('打开日志');
        expect(source).toContain('desktopSettings.closeBehavior === "ask" && desktopSettings.trayEnabled');
        expect(source).toContain('requireInstalledManifest(portableRoot, runtimeRoots.desktop)');
        expect(source).toContain("manifest.providers.managerRuntime");
        expect(source).toContain("Desktop Local 的 Manager Runtime 必须由安装包托管");
        expect(source).not.toContain("resolveApplicationRuntime(");
        expect(installedRoot).toContain("Installed Desktop 缺少 desktop-installation.json");
    });

    it("将 Tauri WebView2 数据目录放在 Desktop Local Root 下", async () => {
        const source = await readFile(resolve("desktop/tauri/src/main.rs"), "utf8");
        expect(source).toContain('.data_directory(state_for_setup.desktop_root.join("webview"))');
        expect(source).toContain("safe_locator_path");
        expect(source).toContain("validate_remote_origin");
        expect(source).toContain("neurobook:second-instance");
        expect(source).toContain("window-state.json");
        expect(source).toContain("settings.close_behavior == \"ask\" && settings.tray_enabled");
        expect(source).toContain("TerminateJobObject");
        expect(source).toContain("KILL_ON_JOB_CLOSE");
        expect(source).not.toContain('Command::new("taskkill")');
    });
});
