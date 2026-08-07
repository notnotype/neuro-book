import {contextBridge, ipcRenderer} from "electron";
import type {DesktopAppearance, DesktopBridge, DesktopMenuCommandId, DesktopSettingsPatch, DesktopWindowCommandId} from "nbook/shared/desktop-contract";

/** 暴露最小只读 Desktop 状态；不向页面暴露 Node、fs 或任意命令执行。 */
const bridge: DesktopBridge = {
    schema: "nbook.desktop-bridge/v2",
    status: async () => await ipcRenderer.invoke("t140:status"),
    setAppearance: async (appearance: DesktopAppearance) => await ipcRenderer.invoke("t140:appearance", appearance),
    settings: async () => await ipcRenderer.invoke("t140:settings"),
    updateSettings: async (patch: DesktopSettingsPatch) => await ipcRenderer.invoke("t140:settings:update", patch),
    window: async (command: DesktopWindowCommandId) => { ipcRenderer.send("t140:window", command); },
    menu: async (command: DesktopMenuCommandId) => { ipcRenderer.send("t140:menu", command); },
    onMenuCommand: (listener) => {
        const handler = (_event: Electron.IpcRendererEvent, command: DesktopMenuCommandId): void => listener(command);
        ipcRenderer.on("neurobook:menu", handler);
        return () => ipcRenderer.removeListener("neurobook:menu", handler);
    },
};
contextBridge.exposeInMainWorld("neuroBookDesktop", bridge);
