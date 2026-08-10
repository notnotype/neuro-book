import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const electronMain = await readFile(resolve(desktopRoot, "electron", "src", "main.ts"), "utf8");
const electronPreload = await readFile(resolve(desktopRoot, "electron", "src", "preload.ts"), "utf8");
const managerMain = await readFile(resolve(desktopRoot, "electron", "src", "manager-main.ts"), "utf8");
const managerPreload = await readFile(resolve(desktopRoot, "electron", "src", "manager-preload.ts"), "utf8");
const managerPage = await readFile(resolve(desktopRoot, "electron", "src", "manager.html"), "utf8");
const startupPage = await readFile(resolve(desktopRoot, "electron", "src", "startup.html"), "utf8");
const tauriConfig = JSON.parse(await readFile(resolve(desktopRoot, "tauri", "tauri.conf.json"), "utf8"));
const tauriCapability = JSON.parse(await readFile(resolve(desktopRoot, "tauri", "capabilities", "default.json"), "utf8"));
const tauriSource = await readFile(resolve(desktopRoot, "tauri", "src", "main.rs"), "utf8");

const checks = {
    electronNodeIntegrationDisabled: electronMain.includes("nodeIntegration: false"),
    electronContextIsolationEnabled: electronMain.includes("contextIsolation: true"),
    electronSandboxEnabled: electronMain.includes("sandbox: true"),
    electronNavigationGuard: electronMain.includes("setWindowOpenHandler") && electronMain.includes("will-navigate"),
    preloadUsesContextBridge: electronPreload.includes("contextBridge.exposeInMainWorld"),
    preloadDoesNotExposeNode: !electronPreload.includes("require(") && !electronPreload.includes("process.") ,
    managerNodeIntegrationDisabled: managerMain.includes("nodeIntegration: false"),
    managerContextIsolationEnabled: managerMain.includes("contextIsolation: true"),
    managerSandboxEnabled: managerMain.includes("sandbox: true"),
    managerNavigationGuard: managerMain.includes("setWindowOpenHandler") && managerMain.includes("will-navigate"),
    managerIpcBindsExactMainFrame: managerMain.includes("event.sender !== window.webContents")
        && managerMain.includes("event.senderFrame !== window.webContents.mainFrame")
        && managerMain.includes("event.senderFrame.url !== managerPageUrl"),
    managerPreloadUsesContextBridge: managerPreload.includes("contextBridge.exposeInMainWorld"),
    managerPreloadDoesNotExposeNode: !managerPreload.includes("require(") && !managerPreload.includes("process."),
    localPagesDenyNetworkByCsp: [managerPage, startupPage].every((page) =>
        page.includes(`Content-Security-Policy" content="default-src 'none'`)),
    tauriUsesLoopbackCsp: typeof tauriConfig.app?.security?.csp === "string"
        && tauriConfig.app.security.csp.includes("http://127.0.0.1:*"),
    tauriHasNoShellOrFsCapability: tauriCapability.permissions.every((permission) =>
        !String(permission).includes("shell") && !String(permission).includes("fs")),
    tauriUsesNarrowCapability: tauriCapability.permissions.includes("core:event:allow-listen")
        && !tauriCapability.permissions.includes("core:event:default")
        && !tauriCapability.permissions.includes("core:window:default"),
    tauriUsesJobObjectFallback: tauriSource.includes("TerminateJobObject")
        && tauriSource.includes("KILL_ON_JOB_CLOSE")
        && !tauriSource.includes('Command::new("taskkill")'),
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({kind: "desktop-security-audit", checks}, null, 4));
if (failed.length > 0) throw new Error(`Desktop security audit failed: ${failed.join(",")}`);
