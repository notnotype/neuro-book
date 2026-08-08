import {contextBridge, ipcRenderer} from "electron";

import type {ManagerGuiOperation} from "./manager-operation";

type ManagerRunResult = {
    exitCode: number | null;
    signal: string | null;
    installationRoot?: string;
};

const bridge = {
    chooseDepot: async (): Promise<string | null> => await ipcRenderer.invoke("manager:choose-depot"),
    stateRoot: async (): Promise<string> => await ipcRenderer.invoke("manager:state-root"),
    run: async (operation: ManagerGuiOperation): Promise<ManagerRunResult> => await ipcRenderer.invoke("manager:run", operation),
    launchInstalled: async (): Promise<void> => await ipcRenderer.invoke("manager:launch-installed"),
    onEvent: (listener: (event: unknown) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(value);
        ipcRenderer.on("manager:event", handler);
        return () => ipcRenderer.removeListener("manager:event", handler);
    },
    quit: (): void => ipcRenderer.send("manager:quit"),
};

contextBridge.exposeInMainWorld("neuroBookManager", bridge);
