import {contextBridge, ipcRenderer} from "electron";
import {
    parseDesktopLaunchRequest,
    type DesktopAppearance,
    type DesktopBridge,
    type DesktopLaunchRequest,
    type DesktopMenuCommandId,
    type DesktopSettingsPatch,
    type DesktopWindowCommandId,
} from "nbook/shared/desktop-contract";
import {DesktopLaunchRequestBuffer} from "nbook/desktop/electron/src/launch-request-buffer";

const pendingLaunchRequests = new DesktopLaunchRequestBuffer();
const launchRequestListeners = new Set<(request: DesktopLaunchRequest) => void>();

ipcRenderer.on("neurobook:second-instance", (_event, value: unknown) => {
    const request = parseDesktopLaunchRequest(value);
    if (launchRequestListeners.size === 0) {
        pendingLaunchRequests.push(request);
        return;
    }
    for (const listener of launchRequestListeners) listener(request);
});

/** 暴露最小只读 Desktop 状态；不向页面暴露 Node、fs 或任意命令执行。 */
const bridge: DesktopBridge = {
    schema: "nbook.desktop-bridge/v2",
    status: async () => await ipcRenderer.invoke("neurobook:desktop:status"),
    setAppearance: async (appearance: DesktopAppearance) => await ipcRenderer.invoke("neurobook:desktop:appearance", appearance),
    settings: async () => await ipcRenderer.invoke("neurobook:desktop:settings"),
    updateSettings: async (patch: DesktopSettingsPatch) => await ipcRenderer.invoke("neurobook:desktop:settings:update", patch),
    window: async (command: DesktopWindowCommandId) => { ipcRenderer.send("neurobook:desktop:window", command); },
    menu: async (command: DesktopMenuCommandId) => { ipcRenderer.send("neurobook:desktop:menu", command); },
    onMenuCommand: (listener) => {
        const handler = (_event: Electron.IpcRendererEvent, command: DesktopMenuCommandId): void => listener(command);
        ipcRenderer.on("neurobook:menu", handler);
        return () => ipcRenderer.removeListener("neurobook:menu", handler);
    },
    onLaunchRequest: (listener) => {
        launchRequestListeners.add(listener);
        for (const request of pendingLaunchRequests.drain()) listener(request);
        return () => launchRequestListeners.delete(listener);
    },
};
contextBridge.exposeInMainWorld("neuroBookDesktop", bridge);

if (window.location.protocol === "file:") {
    const startupBridge = {
        action: (action: string): void => {
            ipcRenderer.send("neurobook:desktop:startup-action", action);
        },
        onStage: (listener: (stage: string) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, stage: string): void => listener(stage);
            ipcRenderer.on("neurobook:startup-stage", handler);
            return () => ipcRenderer.removeListener("neurobook:startup-stage", handler);
        },
        onError: (listener: (message: string) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, message: string): void => listener(message);
            ipcRenderer.on("neurobook:startup-error", handler);
            return () => ipcRenderer.removeListener("neurobook:startup-error", handler);
        },
    };
    contextBridge.exposeInMainWorld("neuroBookStartup", startupBridge);
}
