import {contextBridge, ipcRenderer} from "electron";

type DesktopStatus = {
    port: number;
    contract: string;
    imageRoot: string;
} | null;

/** 暴露最小只读 Desktop 状态；不向页面暴露 Node、fs 或任意命令执行。 */
contextBridge.exposeInMainWorld("neuroBookDesktop", {
    status: async (): Promise<DesktopStatus> => await ipcRenderer.invoke("t140:status") as DesktopStatus,
});
