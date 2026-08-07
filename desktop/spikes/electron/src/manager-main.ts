import {app, BrowserWindow, dialog, ipcMain} from "electron";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join, resolve} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createInterface} from "node:readline";

type ManagerRunInput = {
    action: "install" | "status" | "doctor" | "repair" | "uninstall" | "configure-provider";
    args: string[];
    stdin?: string;
};

type ManagerRunResult = {
    exitCode: number | null;
    signal: string | null;
};

const ALLOWED_ACTIONS = new Set<ManagerRunInput["action"]>(["install", "status", "doctor", "repair", "uninstall", "configure-provider"]);
let lastInstallationRoot: string | null = null;

export async function runManagerGui(): Promise<void> {
    const root = resolve(process.resourcesPath, "..", "..");
    const managerPath = resolve(process.env.NBOOK_MANAGER_CLI ?? join(root, "manager", "neuro-book.mjs"));
    const bunPath = resolve(process.env.NBOOK_BUN_EXECUTABLE ?? join(root, "runtime", process.platform === "win32" ? "bun.exe" : "bun"));
    if (!existsSync(managerPath) || !existsSync(bunPath)) {
        throw new Error("NeuroBook Manager GUI 找不到随包携带的 Manager CLI 或 Bun Runtime。");
    }
    const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const managerLocalRoot = resolve(localAppData, "NeuroBook", "manager-gui");
    app.setPath("userData", managerLocalRoot);
    app.setPath("sessionData", join(managerLocalRoot, "webview"));
    await app.whenReady();
    if (process.argv.includes("--headless")) {
        console.log(JSON.stringify({kind: "manager-gui-ready", managerPath, bunPath}));
        app.quit();
        return;
    }
    const window = new BrowserWindow({
        width: 760,
        height: 680,
        minWidth: 620,
        minHeight: 560,
        title: "NeuroBook Manager",
        webPreferences: {
            preload: fileURLToPath(new URL("./manager-preload.cjs", import.meta.url)),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });
    const run = (input: ManagerRunInput): Promise<ManagerRunResult> => runManagerCli(bunPath, managerPath, input, window);
    ipcMain.handle("manager:choose-depot", async () => {
        const result = await dialog.showOpenDialog(window, {
            title: "选择 NeuroBook Desktop Depot",
            properties: ["openFile"],
            filters: [{name: "NeuroBook Depot", extensions: ["zip", "json"]}],
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
    });
    ipcMain.handle("manager:run", async (_event, input: ManagerRunInput) => {
        validateRunInput(input);
        return await run(input);
    });
    ipcMain.handle("manager:launch-installed", async () => {
        if (!lastInstallationRoot) throw new Error("尚未得到可启动的 Installation Root。");
        const executable = join(lastInstallationRoot, "desktop", "NeuroBook-Electron.exe");
        if (!existsSync(executable)) throw new Error("安装完成回执中的 Electron Envelope 不存在。");
        spawn(executable, [], {cwd: lastInstallationRoot, detached: true, stdio: "ignore", windowsHide: false}).unref();
    });
    ipcMain.on("manager:quit", () => window.close());
    await window.loadURL(pathToFileURL(resolve(import.meta.dirname, "manager.html")).href);
    window.show();
    window.focus();
}

async function runManagerCli(
    bunPath: string,
    managerPath: string,
    input: ManagerRunInput,
    window: BrowserWindow,
): Promise<ManagerRunResult> {
    const child = spawn(bunPath, ["--no-install", managerPath, ...input.args], {
        cwd: resolve(managerPath, "..", ".."),
        env: {...process.env, NODE_PATH: undefined, AUTH_ADMIN_PASSWORD: undefined},
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    if (input.stdin !== undefined) {
        child.stdin.write(Buffer.from(input.stdin, "utf8"));
        child.stdin.end();
    } else {
        child.stdin.end();
    }
    const emit = (value: unknown): void => {
        if (!window.isDestroyed()) window.webContents.send("manager:event", value);
    };
    const stdout = child.stdout;
    if (stdout) {
        const reader = createInterface({input: stdout, crlfDelay: Infinity});
        void (async () => {
            for await (const line of reader) {
                if (!line.trim()) continue;
                try {
                    const value = JSON.parse(line) as Record<string, unknown>;
                    if (value.kind === "complete" && typeof value.installationRoot === "string") {
                        lastInstallationRoot = resolve(value.installationRoot);
                    }
                    emit(value);
                } catch {
                    emit({kind: "log", stream: "stdout", message: line.slice(0, 16 * 1024)});
                }
            }
        })();
    }
    child.stderr?.on("data", (chunk) => emit({kind: "log", stream: "stderr", message: String(chunk).slice(0, 16 * 1024)}));
    return await new Promise<ManagerRunResult>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("exit", (exitCode, signal) => resolvePromise({exitCode, signal}));
    });
}

function validateRunInput(input: ManagerRunInput): void {
    if (!input || typeof input !== "object" || !ALLOWED_ACTIONS.has(input.action)) throw new Error("Manager GUI action 不受支持。");
    if (!Array.isArray(input.args) || input.args.some((value) => typeof value !== "string" || value.includes("\0"))) {
        throw new Error("Manager GUI CLI 参数非法。");
    }
    if (input.args.some((value) => value === "--password-stdin" && input.action !== "install")) {
        throw new Error("管理员密码只能用于 install，不能通过 Manager GUI 传给其他命令。");
    }
    if (input.stdin !== undefined && typeof input.stdin !== "string") throw new Error("Manager GUI stdin 必须是字符串。");
}
