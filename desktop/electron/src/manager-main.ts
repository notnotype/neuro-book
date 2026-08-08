import {app, BrowserWindow, dialog, ipcMain} from "electron";
import {spawn} from "node:child_process";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {createServer, type Server, type Socket} from "node:net";
import {isAbsolute, join, relative, resolve} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createInterface} from "node:readline";

import {
    DESKTOP_UAC_BROKER_SCHEMA,
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerAction,
    type DesktopUacBrokerEvent,
} from "nbook/shared/desktop-uac-broker";
import {parseDesktopInstallationManifest} from "nbook/shared/desktop-contract";
import type {
    ManagerGuiOperation,
    ManagerGuiProviderInput,
} from "./manager-operation";

type ManagerRunResult = {
    exitCode: number | null;
    signal: string | null;
    installationRoot?: string;
};

type ManagerLaunchReceipt = {
    installationRoot: string;
    installationId: string;
    installationScope: "user" | "machine";
    manifestPath: string;
    manifestSha256: string;
    executablePath: string;
    executableSha256: string;
};

type ManagerCliInvocation = {
    args: string[];
    stdin?: string;
};

type ManagerBinding = {
    installationId: string | null;
    installationRoot: string;
    manifestSha256: string | null;
    deleteData: boolean;
};

let lastObservedInstallationRoot: string | null = null;
let launchReceipt: ManagerLaunchReceipt | null = null;
const UAC_HANDSHAKE_TIMEOUT_MS = 30_000;
const UAC_OPERATION_TIMEOUT_MS = 30 * 60_000;

export async function runManagerGui(): Promise<void> {
    const root = resolve(process.resourcesPath, "..", "..");
    const allowDevelopmentConfig = process.env.NBOOK_DESKTOP_DEVELOPMENT === "1" || process.argv.includes("--headless");
    const managerPath = resolve(allowDevelopmentConfig
        ? process.env.NBOOK_MANAGER_CLI ?? join(root, "manager", "neuro-book.mjs")
        : join(root, "manager", "neuro-book.mjs"));
    const bunPath = resolve(allowDevelopmentConfig
        ? process.env.NBOOK_BUN_EXECUTABLE ?? join(root, "runtime", process.platform === "win32" ? "bun.exe" : "bun")
        : join(root, "runtime", process.platform === "win32" ? "bun.exe" : "bun"));
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
    const managerPageUrl = pathToFileURL(resolve(import.meta.dirname, "manager.html")).href;
    installManagerNavigationGuards(window, managerPageUrl);
    ipcMain.handle("manager:choose-depot", async (event) => {
        assertManagerFrame(event, managerPageUrl);
        const result = await dialog.showOpenDialog(window, {
            title: "选择 NeuroBook Desktop Depot",
            properties: ["openFile"],
            filters: [{name: "NeuroBook Depot", extensions: ["zip", "json"]}],
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
    });
    ipcMain.handle("manager:state-root", (event) => {
        assertManagerFrame(event, managerPageUrl);
        return join(localAppData, "NeuroBook", "data");
    });
    ipcMain.handle("manager:run", async (_event, input: ManagerGuiOperation) => {
        assertManagerFrame(_event, managerPageUrl);
        const operation = validateManagerOperation(input);
        if (operation.kind === "install") launchReceipt = null;
        const binding = await managerBindingForOperation(operation);
        const invocation = managerInvocation(operation, binding);
        const result = process.platform === "win32" && machineScopedAction(operation, binding)
            ? await runManagerCliElevated(bunPath, managerPath, invocation, binding, window)
            : await runManagerCli(bunPath, managerPath, invocation, window);
        if (result.installationRoot) lastObservedInstallationRoot = result.installationRoot;
        if (operation.kind === "install" && result.exitCode === 0 && result.installationRoot) {
            launchReceipt = await createLaunchReceipt(result.installationRoot);
        }
        return result;
    });
    ipcMain.handle("manager:launch-installed", async (event) => {
        assertManagerFrame(event, managerPageUrl);
        if (!launchReceipt) throw new Error("尚未得到可验证的安装完成回执。");
        const verified = await createLaunchReceipt(launchReceipt.installationRoot);
        if (verified.manifestSha256 !== launchReceipt.manifestSha256
            || verified.executableSha256 !== launchReceipt.executableSha256
            || verified.installationId !== launchReceipt.installationId
            || verified.installationScope !== launchReceipt.installationScope) {
            launchReceipt = null;
            throw new Error("安装完成回执与当前 Installation Manifest 不一致，请重新执行安装或修复。");
        }
        spawn(verified.executablePath, [], {
            cwd: verified.installationRoot,
            detached: true,
            stdio: "ignore",
            windowsHide: false,
        }).unref();
    });
    ipcMain.on("manager:quit", (event) => {
        assertManagerFrame(event, managerPageUrl);
        window.close();
    });
    await window.loadURL(managerPageUrl);
    window.show();
    window.focus();
}

async function runManagerCli(
    bunPath: string,
    managerPath: string,
    input: ManagerCliInvocation,
    window: BrowserWindow,
): Promise<ManagerRunResult> {
    const child = spawn(bunPath, ["--no-install", managerPath, ...input.args], {
        cwd: resolve(managerPath, "..", ".."),
        env: managerChildEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    if (input.stdin !== undefined) {
        child.stdin.write(Buffer.from(input.stdin, "utf8"));
        child.stdin.end();
    } else {
        child.stdin.end();
    }
    let installationRoot: string | undefined;
    const emit = (value: unknown): void => {
        if (isManagerComplete(value) && value.installationRoot) {
            installationRoot = resolve(value.installationRoot);
        }
        if (!window.isDestroyed()) window.webContents.send("manager:event", value);
    };
    const stdoutDrain = child.stdout
        ? consumeManagerOutput(child.stdout, "stdout", emit)
        : Promise.resolve();
    const stderrDrain = child.stderr
        ? consumeManagerOutput(child.stderr, "stderr", emit)
        : Promise.resolve();
    const result = await new Promise<ManagerRunResult>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("exit", (exitCode, signal) => resolvePromise({exitCode, signal}));
    });
    await Promise.all([stdoutDrain, stderrDrain]);
    return {...result, ...(installationRoot ? {installationRoot} : {})};
}

async function consumeManagerOutput(
    stream: NodeJS.ReadableStream,
    streamName: "stdout" | "stderr",
    emit: (value: unknown) => void,
): Promise<void> {
    const reader = createInterface({input: stream, crlfDelay: Infinity});
    try {
        for await (const line of reader) {
            if (!line.trim()) continue;
            if (streamName === "stdout") {
                try {
                    const value = JSON.parse(line) as Record<string, unknown>;
                    emit(value);
                    continue;
                } catch {
                    // Plain stdout is still forwarded as bounded diagnostic text.
                }
            }
            emit({kind: "log", stream: streamName, message: line.slice(0, 16 * 1024)});
        }
    } finally {
        reader.close();
    }
}

/** 通过一次性 named pipes 把 machine-scope CLI 提升到 UAC，并保持 GUI 的事件合同。 */
async function runManagerCliElevated(
    bunPath: string,
    managerPath: string,
    input: ManagerCliInvocation,
    binding: ManagerBinding,
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
            ...binding,
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
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId,
            action,
            args: input.args,
            secretBytes,
            installationId: binding.installationId,
            installationRoot: binding.installationRoot,
            manifestSha256: binding.manifestSha256,
            deleteData: binding.deleteData,
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
        installationId: string | null;
        installationRoot: string;
        manifestSha256: string | null;
        deleteData: boolean;
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
        "--installation-root",
        options.installationRoot,
        ...(options.installationId ? ["--installation-id", options.installationId] : []),
        ...(options.manifestSha256 ? ["--manifest-sha256", options.manifestSha256] : []),
        ...(options.deleteData ? ["--delete-data"] : []),
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
        env: managerChildEnvironment(),
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
        let installationRoot: string | undefined;
        const finish = (result: ManagerRunResult): void => {
            if (settled) return;
            settled = true;
            reader.close();
            control.destroy();
            resolve({...result, ...(installationRoot ? {installationRoot} : {})});
        };
        reader.on("line", (line) => {
            try {
                const parsed = parseDesktopUacBrokerLine(line);
                if (parsed.type !== "event" || parsed.operationId !== operationId) {
                    throw new Error("UAC Broker event operation 不匹配。");
                }
                handleElevatedEvent(parsed, window, finish, (root) => {
                    installationRoot = root;
                });
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
    setInstallationRoot: (root: string) => void,
): void {
    if (parsed.event.kind === "json") {
        emitManagerEvent(window, parsed.event.value);
        if (isManagerComplete(parsed.event.value) && parsed.event.value.installationRoot) {
            setInstallationRoot(resolve(parsed.event.value.installationRoot));
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

function managerChildEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_PATH: undefined,
        AUTH_ADMIN_PASSWORD: undefined,
    };
    for (const key of Object.keys(environment)) {
        if (key.startsWith("NBOOK_DESKTOP_DEV_")) delete environment[key];
    }
    return environment;
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

function machineScopedAction(input: ManagerGuiOperation, binding: ManagerBinding): boolean {
    if (input.kind === "install") return input.scope === "machine";
    if (input.kind !== "repair" && input.kind !== "uninstall") return false;
    const machineRoot = resolve(
        process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"),
        "NeuroBook",
    );
    return sameWindowsPath(binding.installationRoot, machineRoot);
}

function brokerActionForInput(input: ManagerCliInvocation): DesktopUacBrokerAction {
    const desktopIndex = input.args.indexOf("desktop");
    const uninstallIndex = input.args.indexOf("uninstall");
    if (desktopIndex >= 0 && input.args[desktopIndex + 1] === "install") return "desktop-install";
    if (desktopIndex >= 0 && input.args[desktopIndex + 1] === "repair") return "desktop-repair";
    if (uninstallIndex >= 0) return "uninstall";
    throw new Error(`Manager GUI 操作不支持 UAC 提升：${input.args.join(" ")}`);
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

function installManagerNavigationGuards(window: BrowserWindow, managerPageUrl: string): void {
    window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window.webContents.on("will-navigate", (event, targetUrl) => {
        if (targetUrl !== managerPageUrl) event.preventDefault();
    });
}

function assertManagerFrame(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
    managerPageUrl: string,
): void {
    if (event.senderFrame?.url !== managerPageUrl) {
        throw new Error("Manager GUI IPC 拒绝非本地向导页面请求。");
    }
}

function validateManagerOperation(input: ManagerGuiOperation): ManagerGuiOperation {
    if (!input || typeof input !== "object" || typeof input.kind !== "string") {
        throw new Error("Manager GUI 操作无效。");
    }
    const value = input as ManagerGuiOperation;
    switch (value.kind) {
        case "install":
            if ((value.scope !== "user" && value.scope !== "machine")
                || (value.channel !== "stable" && value.channel !== "canary")
                || (value.runtimeProvider !== "managed" && value.runtimeProvider !== "system")
                || (value.toolProvider !== "managed" && value.toolProvider !== "system")
                || (value.source.kind !== "path" && value.source.kind !== "https-manifest")
                || typeof value.source.value !== "string"
                || value.source.value.length === 0
                || value.source.value.includes("\0")) {
                throw new Error("Manager GUI 安装参数无效。");
            }
            if (value.source.kind === "https-manifest" && !value.source.value.startsWith("https://")) {
                throw new Error("在线 Desktop manifest 必须使用 HTTPS。");
            }
            if (value.adminPassword !== undefined
                && Buffer.byteLength(value.adminPassword, "utf8") > DESKTOP_UAC_MAX_SECRET_BYTES) {
                throw new Error("管理员密码超过 4096 bytes。");
            }
            if (value.enableAuth && !value.adminPassword) {
                throw new Error("启用 auth 时必须提供管理员密码。");
            }
            return value;
        case "configure-provider":
        case "test-provider":
            validateProviderInput(value.provider);
            return value;
        case "status":
        case "doctor":
        case "repair":
            return value;
        case "uninstall":
            if (typeof value.deleteData !== "boolean") throw new Error("卸载 deleteData 参数无效。");
            return value;
        default:
            throw new Error("Manager GUI 操作不受支持。");
    }
}

function validateProviderInput(provider: ManagerGuiProviderInput): void {
    if (!provider || typeof provider !== "object"
        || typeof provider.name !== "string"
        || typeof provider.baseURL !== "string"
        || typeof provider.api !== "string"
        || typeof provider.apiKey !== "string"
        || typeof provider.model !== "string"
        || provider.apiKey.includes("\0")
        || Buffer.byteLength(provider.apiKey, "utf8") > 16 * 1024) {
        throw new Error("Manager GUI Provider 参数无效。");
    }
}

function managerInvocation(operation: ManagerGuiOperation, binding: ManagerBinding): ManagerCliInvocation {
    switch (operation.kind) {
        case "install": {
            const args = [
                "desktop", "install",
                operation.source.kind === "https-manifest"
                    ? "--distribution-manifest-url"
                    : operation.source.value.toLowerCase().endsWith(".json")
                        ? "--distribution-manifest"
                        : "--archive",
                operation.source.value,
                "--scope", operation.scope,
                "--channel", operation.channel,
                "--runtime-provider", operation.runtimeProvider,
                "--tool-provider", operation.toolProvider,
                "--envelope", "electron",
                "--yes", "--json",
            ];
            if (operation.addCliToPath) args.push("--add-cli-to-path");
            if (operation.enableAuth) args.push("--enable-auth", "--password-stdin");
            return {
                args,
                ...(operation.adminPassword !== undefined ? {stdin: operation.adminPassword} : {}),
            };
        }
        case "status":
            return {args: ["status", "--json"]};
        case "doctor":
            return {args: ["doctor", "--json"]};
        case "repair":
            return {args: ["--root", binding.installationRoot, "desktop", "repair", "--json"]};
        case "uninstall":
            return {
                args: ["--root", binding.installationRoot, "uninstall", "--yes", "--json", ...(operation.deleteData ? ["--delete-data"] : [])],
            };
        case "configure-provider":
            return {
                args: ["desktop", "configure-provider", "--stdin-json", "--json"],
                stdin: JSON.stringify(operation.provider),
            };
        case "test-provider":
            return {
                args: ["desktop", "test-provider", "--stdin-json", "--json"],
                stdin: JSON.stringify(operation.provider),
            };
    }
}

async function managerBindingForOperation(operation: ManagerGuiOperation): Promise<ManagerBinding> {
    if (operation.kind === "install") {
        return {
            installationId: null,
            installationRoot: defaultInstallationRoot(operation.scope),
            manifestSha256: null,
            deleteData: false,
        };
    }
    if (operation.kind === "repair" || operation.kind === "uninstall") {
        const candidates = [
            lastObservedInstallationRoot,
            defaultInstallationRoot("machine"),
            defaultInstallationRoot("user"),
        ].filter((value): value is string => Boolean(value));
        const seen = new Set<string>();
        for (const candidate of candidates) {
            const root = resolve(candidate);
            if (seen.has(root.toLowerCase())) continue;
            seen.add(root.toLowerCase());
            if (!existsSync(root)) continue;
            const binding = readInstalledBinding(root, operation.kind === "uninstall" && operation.deleteData);
            if (binding) return binding;
        }
        throw new Error("找不到可验证的 Desktop Installation Manifest，请先执行安装或修复。");
    }
    return {
        installationId: null,
        installationRoot: resolve(process.cwd()),
        manifestSha256: null,
        deleteData: false,
    };
}

async function createLaunchReceipt(rootInput: string): Promise<ManagerLaunchReceipt> {
    const installationRoot = resolve(rootInput);
    const localAppData = process.env.LOCALAPPDATA
        ?? join(process.env.USERPROFILE ?? process.env.HOME ?? homedir(), "AppData", "Local");
    const manifestPath = join(localAppData, "NeuroBook", "desktop", "desktop-installation.json");
    if (!existsSync(manifestPath)) throw new Error("安装完成回执缺少 Desktop Installation Manifest。");
    const manifestText = readFileSync(manifestPath, "utf8");
    const manifest = parseDesktopInstallationManifest(JSON.parse(manifestText) as unknown);
    const expectedRoot = defaultInstallationRoot(manifest.installationScope);
    if (!sameWindowsPath(installationRoot, expectedRoot)) {
        throw new Error("安装完成回执的 Installation Root 与 manifest scope 不一致。");
    }
    if (manifest.envelope !== "electron") {
        throw new Error("安装完成回执不是 Electron Installation Manifest。");
    }
    const component = manifest.components.find((item) => item.id === "electron-envelope");
    if (!component || !isSafeRelativePath(component.path)) {
        throw new Error("安装完成回执缺少安全的 Electron Envelope component。");
    }
    const executablePath = resolve(installationRoot, ...component.path.split(/[\\/]/u));
    const relativeExecutable = relative(installationRoot, executablePath);
    if (!relativeExecutable
        || relativeExecutable.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
        || isAbsolute(relativeExecutable)
        || !existsSync(executablePath)) {
        throw new Error("安装完成回执中的 Electron Envelope 不存在或越出 Installation Root。");
    }
    const executableSha256 = `sha256:${createHash("sha256").update(readFileSync(executablePath)).digest("hex")}`;
    if (executableSha256 !== component.sha256) {
        throw new Error("安装完成回执中的 Electron Envelope checksum 不匹配。");
    }
    return {
        installationRoot,
        installationId: manifest.installationId,
        installationScope: manifest.installationScope,
        manifestPath: resolve(manifestPath),
        manifestSha256: `sha256:${createHash("sha256").update(manifestText, "utf8").digest("hex")}`,
        executablePath,
        executableSha256,
    };
}

function isSafeRelativePath(path: string): boolean {
    return path.length > 0
        && !isAbsolutePath(path)
        && !path.includes("\0")
        && path.split(/[\\/]/u).every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isAbsolutePath(path: string): boolean {
    return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path);
}

function readInstalledBinding(root: string, deleteData: boolean): ManagerBinding | null {
    const localAppData = process.env.LOCALAPPDATA
        ?? join(process.env.USERPROFILE ?? process.env.HOME ?? homedir(), "AppData", "Local");
    const manifestPath = join(localAppData, "NeuroBook", "desktop", "desktop-installation.json");
    if (!existsSync(manifestPath)) return null;
    try {
        const text = readFileSync(manifestPath, "utf8");
        const manifest = parseDesktopInstallationManifest(JSON.parse(text) as unknown);
        const expectedRoot = defaultInstallationRoot(manifest.installationScope);
        if (!sameWindowsPath(root, expectedRoot)) return null;
        return {
            installationId: manifest.installationId,
            installationRoot: resolve(root),
            manifestSha256: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
            deleteData,
        };
    } catch {
        return null;
    }
}

function defaultInstallationRoot(scope: "user" | "machine"): string {
    if (scope === "machine") {
        return resolve(process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"), "NeuroBook");
    }
    return resolve(
        process.env.LOCALAPPDATA
            ?? join(process.env.USERPROFILE ?? process.env.HOME ?? homedir(), "AppData", "Local"),
        "Programs",
        "NeuroBook",
    );
}

function isManagerComplete(value: unknown): value is {kind: "complete"; installationRoot?: string} {
    if (typeof value !== "object" || value === null) return false;
    const record = value as {kind?: unknown; installationRoot?: unknown};
    return record.kind === "complete"
        && (record.installationRoot === undefined || typeof record.installationRoot === "string");
}
