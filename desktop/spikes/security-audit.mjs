import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname);
const electronMain = await readFile(resolve(root, "electron", "src", "main.ts"), "utf8");
const electronPreload = await readFile(resolve(root, "electron", "src", "preload.ts"), "utf8");
const tauriConfig = JSON.parse(await readFile(resolve(root, "tauri", "tauri.conf.json"), "utf8"));
const tauriCapability = JSON.parse(await readFile(resolve(root, "tauri", "capabilities", "default.json"), "utf8"));

const checks = {
    electronNodeIntegrationDisabled: electronMain.includes("nodeIntegration: false"),
    electronContextIsolationEnabled: electronMain.includes("contextIsolation: true"),
    electronSandboxEnabled: electronMain.includes("sandbox: true"),
    electronNavigationGuard: electronMain.includes("setWindowOpenHandler") && electronMain.includes("will-navigate"),
    preloadUsesContextBridge: electronPreload.includes("contextBridge.exposeInMainWorld"),
    preloadDoesNotExposeNode: !electronPreload.includes("require(") && !electronPreload.includes("process.") ,
    tauriUsesLoopbackCsp: typeof tauriConfig.app?.security?.csp === "string"
        && tauriConfig.app.security.csp.includes("http://127.0.0.1:*"),
    tauriHasNoShellOrFsCapability: tauriCapability.permissions.every((permission) =>
        !String(permission).includes("shell") && !String(permission).includes("fs")),
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({kind: "t140-security-audit", checks}, null, 4));
if (failed.length > 0) throw new Error(`Desktop security audit failed: ${failed.join(",")}`);
