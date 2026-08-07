import {contextBridge, ipcRenderer} from "electron";

type ManagerRunInput = {
    action: "install" | "status" | "doctor" | "repair" | "uninstall" | "configure-provider";
    args: string[];
    stdin?: string;
};

type ManagerRunResult = {
    exitCode: number | null;
    signal: string | null;
};

const bridge = {
    chooseDepot: async (): Promise<string | null> => await ipcRenderer.invoke("manager:choose-depot"),
    run: async (input: ManagerRunInput): Promise<ManagerRunResult> => await ipcRenderer.invoke("manager:run", input),
    launchInstalled: async (): Promise<void> => await ipcRenderer.invoke("manager:launch-installed"),
    onEvent: (listener: (event: unknown) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(value);
        ipcRenderer.on("manager:event", handler);
        return () => ipcRenderer.removeListener("manager:event", handler);
    },
    quit: (): void => ipcRenderer.send("manager:quit"),
};

contextBridge.exposeInMainWorld("neuroBookManager", bridge);
