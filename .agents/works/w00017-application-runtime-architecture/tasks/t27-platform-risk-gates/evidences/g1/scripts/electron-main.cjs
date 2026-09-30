// G1 Electron 宿主替身：与 desktop/electron 的 BrowserWindow 安全选项一致（无 preload），
// 打开 CDP 端口供 Playwright 接入。窗口显示在隔离的无头 KWin 虚拟输出上（隐藏窗口不跑 rAF，Playwright 点击会超时）。
const {app, BrowserWindow} = require("electron");

app.commandLine.appendSwitch("remote-debugging-port", process.env.G1_CDP_PORT || "9431");
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");

app.whenReady().then(() => {
    const win = new BrowserWindow({
        show: true,
        width: 1280,
        height: 900,
        webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true},
    });
    win.loadURL(process.env.G1_URL || "about:blank");
    console.log(JSON.stringify({kind: "g1-electron-ready", electron: process.versions.electron, chrome: process.versions.chrome}));
});
app.on("window-all-closed", () => app.quit());
