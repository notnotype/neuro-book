import {app, BrowserWindow, dialog, ipcMain} from "electron";
import {spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {createServer, type Server, type Socket} from "node:net";
import {join, resolve} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createInterface} from "node:readline";

import {
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerAction,
    type DesktopUacBrokerEvent,
} from "nbook/shared/desktop-uac-broker";

type ManagerRunInput = {
    action: "install" | "status" | "doctor" | "repair" | "uninstall" | "configure-provider" | "test-provider";
    args: string[];
    stdin?: string;
};

type ManagerRunResult = {
    exitCode: number | null;
    signal: string | null;
};

const ALLOWED_ACTIONS = new Set<ManagerRunInput["action"]>(["install", "status", "doctor", "repair", "uninstall", "configure-provider", "test-provider"]);
let lastInstallationRoot: string | null = null;
const UAC_HANDSHAKE_TIMEOUT_MS = 30_000;
const UAC_OPERATION_TIMEOUT_MS = 30 * 60_000;

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
    const run = (input: ManagerRunInput): Promise<ManagerRunResult> => {
        return process.platform === "win32" && machineScopedAction(input)
            ? runManagerCliElevated(bunPath, managerPath, input, window)
            : runManagerCli(bunPath, managerPath, input, window);
    };
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

/** 通过一次性 named pipes 把 machine-scope CLI 提升到 UAC，并保持 GUI 的事件合同。 */
async function runManagerCliElevated(
    bunPath: string,
    managerPath: string,
    input: ManagerRunInput,
    window: BrowserWindow,
): Promise<ManagerRunResult> {
    if (process.platform !== "win32") throw new Error("machine-scope Desktop 只支持 Windows UAC。");
    const operationId = randomUUID();
    const nonce = randomBytes(32).toString("hex");
    const action = brokerActionForInput(input);
    const controlPipe = `\\\\.\\pipe\\neurobook-manager-${randomUUID()}`;
    const secretBytes = input.stdin === undefined ? 0 : Buffer.byteLength(input.stdin, "utf8");
    if (secretBytes > DESKTOP_UAC_MAX_SECRET_BYTES) throw new Error("管理员密码超过 4096 bytes。");
    if (input.args.includes("--password-stdin") && secretBytes === 0) {
        throw new Error("machine-scope --password-stdin 缺少密码。");
    }
    if (!input.args.includes("--password-stdin") && secretBytes > 0) {
        throw new Error("machine-scope secret 只能用于 --password-stdin。");
    }
    const secretPipe = secretBytes > 0 ? `\\\\.\\pipe\\neurobook-manager-secret-${randomUUID()}` : null;
    const controlServer = createServer();
    const secretServer = secretPipe ? createServer() : null;
    let elevated: ReturnType<typeof spawn> | null = null;
    let controlSocket: Socket | null = null;
    let secretSocket: Socket | null = null;
    const closeControlServer = (): void => {
        closeServer(controlServer);
    };
    const closeSecretServer = (): void => {
        if (secretServer) closeServer(secretServer);
    };
    const closeServers = (): void => {
        closeControlServer();
        closeSecretServer();
    };
    try {
        await listenPipe(controlServer, controlPipe);
        if (secretServer && secretPipe) await listenPipe(secretServer, secretPipe);
        const controlSocketPromise = acceptOneSocket(controlServer);
        const secretSocketPromise = secretServer ? acceptOneSocket(secretServer) : null;
        elevated = launchElevatedBroker(bunPath, managerPath, {
            controlPipe,
            secretPipe,
            nonce,
            operationId,
            action,
        });
        controlSocket = await withTimeout(
            awaitElevatedControlSocket(controlSocketPromise, elevated),
            UAC_HANDSHAKE_TIMEOUT_MS,
            "UAC",
        );
        closeControlServer();
        const hello = parseDesktopUacBrokerLine(await readOneLine(controlSocket));
        if (hello.type !== "hello" || hello.operationId !== operationId || hello.nonce !== nonce) {
            throw new Error("UAC Broker handshake 身份不匹配。");
        }
        controlSocket.write(encodeDesktopUacBrokerLine({
            schema: "nbook.desktop-uac-broker/v1",
            type: "request",
            operationId,
            action,
            args: input.args,
            secretBytes,
        }));
        if (secretSocketPromise && input.stdin !== undefined) {
            secretSocket = await withTimeout(secretSocketPromise, UAC_HANDSHAKE_TIMEOUT_MS, "UAC secret");
            await validateSecretPipeHello(secretSocket, operationId, nonce);
            closeSecretServer();
            secretSocket.end(Buffer.from(input.stdin, "utf8"));
        } else {
            closeSecretServer();
        }
        const result = await withTimeout(
            receiveElevatedEvents(controlSocket, operationId, window),
            UAC_OPERATION_TIMEOUT_MS,
            "machine-scope 操作",
        );
        await waitForChildExit(elevated).catch(() => undefined);
        return result;
    } catch (error) {
        controlSocket?.destroy();
        secretSocket?.destroy();
        if (elevated && elevated.exitCode === null) elevated.kill();
        closeServers();
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UAC 超时")
            || message.includes("UAC 提升进程未连接")
            || message.includes("pipe 在")) {
            emitManagerEvent(window, {kind: "failure", code: "uac-cancelled", message: "UAC 未批准或提升进程未连接，操作未执行。"});
            return {exitCode: null, signal: "uac-cancelled"};
        }
        emitManagerEvent(window, {kind: "failure", code: "uac-broker-failure", message});
        return {exitCode: 1, signal: null};
    } finally {
        closeServers();
    }
}

function launchElevatedBroker(
    bunPath: string,
    managerPath: string,
    options: {
        controlPipe: string;
        secretPipe: string | null;
        nonce: string;
        operationId: string;
        action: DesktopUacBrokerAction;
    },
): ReturnType<typeof spawn> {
    const brokerArgs = [
        "--no-install",
        managerPath,
        "desktop",
        "broker",
        "--pipe",
        options.controlPipe,
        "--nonce",
        options.nonce,
        "--operation-id",
        options.operationId,
        "--action",
        options.action,
        ...(options.secretPipe ? ["--secret-pipe", options.secretPipe] : []),
    ];
    const argumentList = brokerArgs.map(windowsCommandLineQuote).join(" ");
    const command = `Start-Process -FilePath ${powerShellLiteral(bunPath)} -WorkingDirectory ${powerShellLiteral(resolve(managerPath, "..", ".."))} -Verb RunAs -ArgumentList ${powerShellLiteral(argumentList)} -Wait`;
    const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
    ], {
        env: {...process.env, NODE_PATH: undefined, AUTH_ADMIN_PASSWORD: undefined},
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
    });
    child.stderr?.on("data", () => undefined);
    return child;
}

async function receiveElevatedEvents(
    control: Socket,
    operationId: string,
    window: BrowserWindow,
): Promise<ManagerRunResult> {
    return await new Promise<ManagerRunResult>((resolve, reject) => {
        const reader = createInterface({input: control, crlfDelay: Infinity});
        let settled = false;
        const finish = (result: ManagerRunResult): void => {
            if (settled) return;
            settled = true;
            reader.close();
            control.destroy();
            resolve(result);
        };
        reader.on("line", (line) => {
            try {
                const parsed = parseDesktopUacBrokerLine(line);
                if (parsed.type !== "event" || parsed.operationId !== operationId) {
                    throw new Error("UAC Broker event operation 不匹配。");
                }
                handleElevatedEvent(parsed, window, finish);
            } catch (error) {
                if (!settled) {
                    settled = true;
                    reader.close();
                    control.destroy();
                    reject(error);
                }
            }
        });
        control.once("error", (error) => {
            if (!settled) {
                settled = true;
                reader.close();
                reject(error);
            }
        });
        control.once("close", () => {
            if (!settled) {
                settled = true;
                reader.close();
                resolve({exitCode: null, signal: "uac-disconnected"});
            }
        });
    });
}

function handleElevatedEvent(
    parsed: DesktopUacBrokerEvent,
    window: BrowserWindow,
    finish: (result: ManagerRunResult) => void,
): void {
    if (parsed.event.kind === "json") {
        emitManagerEvent(window, parsed.event.value);
        if (parsed.event.value.kind === "complete"
            && typeof parsed.event.value.installationRoot === "string") {
            lastInstallationRoot = resolve(parsed.event.value.installationRoot);
        }
        return;
    }
    if (parsed.event.kind === "log") {
        emitManagerEvent(window, {
            kind: "log",
            stream: parsed.event.stream,
            message: parsed.event.message,
        });
        return;
    }
    if (parsed.event.kind === "failure") {
        emitManagerEvent(window, {
            kind: "failure",
            code: parsed.event.code,
            message: parsed.event.message,
        });
        finish({exitCode: 1, signal: null});
        return;
    }
    finish({exitCode: parsed.event.exitCode, signal: parsed.event.signal});
}

function emitManagerEvent(window: BrowserWindow, value: unknown): void {
    if (!window.isDestroyed()) window.webContents.send("manager:event", value);
}

async function listenPipe(server: Server, path: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const onError = (error: Error): void => {
            server.removeListener("listening", onListening);
            rejectPromise(error);
        };
        const onListening = (): void => {
            server.removeListener("error", onError);
            resolvePromise();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(path);
    });
}

async function acceptOneSocket(server: Server): Promise<Socket> {
    return await new Promise<Socket>((resolvePromise) => {
        let accepted = false;
        server.on("connection", (socket) => {
            if (accepted) {
                socket.destroy();
                return;
            }
            accepted = true;
            resolvePromise(socket);
        });
    });
}

async function readOneLine(socket: Socket): Promise<string> {
    const reader = createInterface({input: socket, crlfDelay: Infinity});
    try {
        for await (const line of reader) return line;
    } finally {
        reader.close();
    }
    throw new Error("UAC Broker pipe 在 handshake 前关闭。");
}

async function validateSecretPipeHello(socket: Socket, operationId: string, nonce: string): Promise<void> {
    const hello = parseDesktopUacBrokerLine(await readOneLine(socket));
    if (hello.type !== "secret-hello" || hello.operationId !== operationId || hello.nonce !== nonce) {
        throw new Error("UAC Secret pipe handshake 身份不匹配。");
    }
}

function waitForChildExit(child: ReturnType<typeof spawn>): Promise<void> {
    return new Promise<void>((resolvePromise) => {
        if (child.exitCode !== null) {
            resolvePromise();
            return;
        }
        child.once("exit", () => resolvePromise());
        child.once("error", () => resolvePromise());
    });
}

async function awaitElevatedControlSocket(
    socketPromise: Promise<Socket>,
    elevated: ReturnType<typeof spawn>,
): Promise<Socket> {
    if (elevated.exitCode !== null) {
        throw new Error(`UAC 提升进程未连接：exitCode=${elevated.exitCode}`);
    }
    return await Promise.race([
        socketPromise,
        new Promise<Socket>((_resolve, reject) => {
            const onExit = (code: number | null, signal: string | null): void => {
                reject(new Error(`UAC 提升进程未连接：exitCode=${code ?? "null"}, signal=${signal ?? "null"}`));
            };
            const onError = (error: Error): void => reject(new Error(`UAC 提升进程启动失败：${error.message}`));
            elevated.once("exit", onExit);
            elevated.once("error", onError);
            socketPromise.finally(() => {
                elevated.removeListener("exit", onExit);
                elevated.removeListener("error", onError);
            }).catch(() => undefined);
        }),
    ]);
}

function powerShellLiteral(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

/** Start-Process 把 ArgumentList 数组重新拼成一条 Windows 命令行；这里必须保留含空格路径的双引号。 */
function windowsCommandLineQuote(value: string): string {
    if (value.length > 0 && !/[\s"]/u.test(value)) return value;
    let result = '"';
    let backslashes = 0;
    for (const character of value) {
        if (character === "\\") {
            backslashes += 1;
            continue;
        }
        if (character === '"') {
            result += "\\".repeat(backslashes * 2 + 1);
            result += '"';
            backslashes = 0;
            continue;
        }
        result += "\\".repeat(backslashes);
        result += character;
        backslashes = 0;
    }
    result += "\\".repeat(backslashes * 2);
    return `${result}"`;
}

function closeServer(server: Server): void {
    if (!server.listening) return;
    server.close();
}

function machineScopedAction(input: ManagerRunInput): boolean {
    if (input.action === "install") return isMachineInstall(input.args);
    if (input.action !== "repair" && input.action !== "uninstall") return false;
    const machineRoot = resolve(
        process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"),
        "NeuroBook",
    );
    const knownRoot = lastInstallationRoot && sameWindowsPath(lastInstallationRoot, machineRoot);
    return Boolean(knownRoot || existsSync(join(machineRoot, "manifest.json")));
}

function brokerActionForInput(input: ManagerRunInput): DesktopUacBrokerAction {
    if (input.action === "install") return "desktop-install";
    if (input.action === "repair") return "desktop-repair";
    if (input.action === "uninstall") return "uninstall";
    throw new Error(`Manager GUI action 不支持 UAC 提升：${input.action}`);
}

function isMachineInstall(args: string[]): boolean {
    return args.some((value, index) => value === "--scope=machine"
        || (value === "--scope" && args[index + 1] === "machine"));
}

function sameWindowsPath(left: string, right: string): boolean {
    return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} 超时：${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
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
    if (input.action === "install"
        && input.args.includes("--password-stdin")
        && input.stdin !== undefined
        && Buffer.byteLength(input.stdin, "utf8") > DESKTOP_UAC_MAX_SECRET_BYTES) {
        throw new Error("管理员密码超过 4096 bytes。");
    }
}
