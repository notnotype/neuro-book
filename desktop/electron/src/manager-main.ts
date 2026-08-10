import {app, BrowserWindow, dialog, ipcMain, shell} from "electron";
import {spawn} from "node:child_process";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {createServer, type Server, type Socket} from "node:net";
import {join, resolve} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createInterface} from "node:readline";
import * as physicalFileSystem from "original-fs";
import {spawnOwnedProcess} from "@notnotype/owned-process";

import {
    DESKTOP_UAC_BROKER_SCHEMA,
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerAction,
    type DesktopUacBrokerEvent,
} from "nbook/shared/desktop-uac-broker";
import {parseDesktopInstallationManifest} from "nbook/shared/desktop-contract";
import {materializeMachineManagerScript} from "nbook/desktop/shared/src/manager-runtime";
import {
    parseDesktopDelegatedUninstallReceipt,
    waitForWindowsUninstallHostResult,
    type DesktopDelegatedUninstallReceipt,
} from "nbook/desktop/shared/src/windows-uninstall-result";
import type {
    ManagerCliInvocation,
    ManagerGuiLocalSourceKind,
    ManagerGuiOperation,
    ManagerGuiProviderTestResult,
    ManagerOperationBinding,
    ManagerRunResult,
} from "./manager-operation";
import {
    createSensitiveOutputGuard,
    managerInvocation,
    validateManagerOperation,
} from "./manager-operation";
import type {SensitiveOutputGuard} from "./manager-operation";
import {
    createManagerLaunchReceipt as createLaunchReceipt,
    sameManagerLaunchReceipt as sameLaunchReceipt,
    type ManagerLaunchReceipt,
} from "./manager-launch-receipt";

type ManagerBinding = ManagerOperationBinding;

let lastObservedInstallationRoot: string | null = null;
let launchReceipt: ManagerLaunchReceipt | null = null;
const UAC_HANDSHAKE_TIMEOUT_MS = 30_000;
const UAC_OPERATION_TIMEOUT_MS = 30 * 60_000;
/** Electron 的 patched fs 会把 app.asar 映射为虚拟目录；receipt 必须检查磁盘上的真实 archive。 */
const createPhysicalLaunchReceipt = async (installationRoot: string): Promise<ManagerLaunchReceipt> => {
    return await createLaunchReceipt(installationRoot, process.env, physicalFileSystem);
};

export async function runManagerGui(): Promise<void> {
    const root = resolve(process.resourcesPath, "..", "..");
    const allowDevelopmentConfig = process.env.NBOOK_DESKTOP_DEVELOPMENT === "1" || process.argv.includes("--headless");
    const sourceManagerPath = resolve(allowDevelopmentConfig
        ? process.env.NBOOK_MANAGER_CLI ?? join(root, "manager", "neuro-book.mjs")
        : join(root, "manager", "neuro-book.mjs"));
    const bunPath = resolve(allowDevelopmentConfig
        ? process.env.NBOOK_BUN_EXECUTABLE ?? join(root, "runtime", process.platform === "win32" ? "bun.exe" : "bun")
        : join(root, "runtime", process.platform === "win32" ? "bun.exe" : "bun"));
    if (!existsSync(sourceManagerPath) || !existsSync(bunPath)) {
        throw new Error("NeuroBook Manager GUI 找不到随包携带的 Manager CLI 或 Bun Runtime。");
    }
    const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const managerPath = await materializeMachineManagerScript(
        sourceManagerPath,
        resolve(localAppData, "NeuroBook", "cache"),
    );
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
    ipcMain.handle("manager:choose-depot", async (event, sourceKind: ManagerGuiLocalSourceKind) => {
        assertManagerFrame(event, window, managerPageUrl);
        if (!["portable-archive", "aggregate-depot", "distribution-manifest"].includes(sourceKind)) {
            throw new Error("Manager GUI 本地安装来源类型无效。");
        }
        const result = await dialog.showOpenDialog(window, {
            title: "选择 NeuroBook Desktop Depot",
            properties: ["openFile"],
            filters: sourceKind === "distribution-manifest"
                ? [{name: "NeuroBook Distribution Manifest", extensions: ["json"]}]
                : [{name: "NeuroBook Desktop Archive", extensions: ["zip"]}],
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
    });
    ipcMain.handle("manager:state-root", (event) => {
        assertManagerFrame(event, window, managerPageUrl);
        return join(localAppData, "NeuroBook", "data");
    });
    ipcMain.handle("manager:open-logs", async (event) => {
        assertManagerFrame(event, window, managerPageUrl);
        const logsRoot = join(localAppData, "NeuroBook", "data", "logs");
        return await shell.openPath(logsRoot);
    });
    ipcMain.handle("manager:run", async (_event, input: ManagerGuiOperation) => {
        assertManagerFrame(_event, window, managerPageUrl);
        const operation = validateManagerOperation(input);
        if (operation.kind === "install") launchReceipt = null;
        const binding = await managerBindingForOperation(operation);
        const invocation = managerInvocation(operation, binding);
        const result = process.platform === "win32" && machineScopedAction(operation, binding)
            ? await runManagerCliElevated(bunPath, managerPath, invocation, binding, window)
            : await runManagerCli(bunPath, managerPath, invocation, operation, binding, window);
        if (result.installationRoot) lastObservedInstallationRoot = result.installationRoot;
        if (operation.kind === "install" && result.exitCode === 0 && result.installationRoot) {
            launchReceipt = await createPhysicalLaunchReceipt(result.installationRoot);
        }
        return result;
    });
    ipcMain.handle("manager:launch-installed", async (event) => {
        assertManagerFrame(event, window, managerPageUrl);
        if (!launchReceipt) throw new Error("尚未得到可验证的安装完成回执。");
        const verified = await createPhysicalLaunchReceipt(launchReceipt.installationRoot);
        if (verified.manifestSha256 !== launchReceipt.manifestSha256
            || verified.executableSha256 !== launchReceipt.executableSha256
            || verified.applicationSha256 !== launchReceipt.applicationSha256
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
        assertManagerFrame(event, window, managerPageUrl);
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
    operation: ManagerGuiOperation,
    binding: ManagerBinding,
    window: BrowserWindow,
): Promise<ManagerRunResult> {
    const lease = spawnOwnedProcess({
        command: bunPath,
        args: ["--no-install", managerPath, ...input.args],
        cwd: resolve(managerPath, "..", ".."),
        env: managerChildEnvironment(),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
        graceMs: 1_000,
        hardKillWaitMs: 5_000,
    });
    const stdin = lease.stdin;
    if (!stdin) throw new Error("Manager GUI 无法打开 Manager CLI stdin。");
    if (input.stdin !== undefined) {
        stdin.write(Buffer.from(input.stdin, "utf8"));
        stdin.end();
    } else {
        stdin.end();
    }
    let installationRoot: string | undefined;
    let providerTest: ManagerGuiProviderTestResult | undefined;
    const observed = {uninstallReceipt: null as DesktopDelegatedUninstallReceipt | null};
    const outputGuard = createSensitiveOutputGuard(input.sensitiveValues ?? []);
    const emit = (value: unknown): void => {
        if (isManagerComplete(value) && value.installationRoot) {
            installationRoot = resolve(value.installationRoot);
        }
        const parsedProviderTest = parseProviderTestEvent(value);
        if (parsedProviderTest) providerTest = parsedProviderTest;
        const uninstallReceipt = parseDesktopDelegatedUninstallReceipt(value);
        if (uninstallReceipt) {
            if (observed.uninstallReceipt) throw new Error("Manager CLI 返回重复的 uninstall 完成回执。");
            observed.uninstallReceipt = uninstallReceipt;
        }
        if (!window.isDestroyed()) window.webContents.send("manager:event", value);
    };
    const stdoutDrain = lease.stdout
        ? consumeManagerOutput(lease.stdout, "stdout", emit, outputGuard)
        : Promise.resolve();
    const stderrDrain = lease.stderr
        ? consumeManagerOutput(lease.stderr, "stderr", emit, outputGuard)
        : Promise.resolve();
    const drains = [stdoutDrain, stderrDrain];
    try {
        const completion = await Promise.race([
            lease.completion,
            ...drains.map((drain) => drain.then(
                () => new Promise<never>(() => undefined),
                (error: unknown) => Promise.reject(error),
            )),
        ]);
        await Promise.all(drains);
        if (operation.kind === "uninstall" && completion.exitCode === 0 && completion.signal === null) {
            const receipt = observed.uninstallReceipt;
            if (!receipt) throw new Error("Manager CLI uninstall 缺少最终回执。");
            if (receipt.status === "scheduled") {
                await waitForWindowsUninstallHostResult(receipt.resultPath, binding.installationRoot);
            }
        }
        return {
            exitCode: completion.exitCode,
            signal: completion.signal,
            ...(installationRoot ? {installationRoot} : {}),
            ...(providerTest ? {providerTest} : {}),
        };
    } catch (error) {
        await lease.terminate("manager-output-failure").catch(() => undefined);
        await lease.completion.catch(() => undefined);
        await Promise.allSettled(drains);
        throw error;
    }
}

async function consumeManagerOutput(
    stream: NodeJS.ReadableStream,
    streamName: "stdout" | "stderr",
    emit: (value: unknown) => void,
    outputGuard: SensitiveOutputGuard | null,
): Promise<void> {
    const reader = createInterface({input: stream, crlfDelay: Infinity});
    try {
        for await (const line of reader) {
            if (!line.trim()) continue;
            outputGuard?.check(`${line}\n`);
            if (streamName === "stdout") {
                let value: Record<string, unknown> | null = null;
                try {
                    value = JSON.parse(line) as Record<string, unknown>;
                } catch {
                    // Plain stdout is still forwarded as bounded diagnostic text.
                }
                if (value !== null) {
                    // Parsed protocol events must fail closed. Validation or duplicate
                    // receipt errors are not downgraded to ordinary log lines.
                    emit(value);
                    continue;
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
    window: BrowserWindow,
    managerPageUrl: string,
): void {
    if (event.sender !== window.webContents
        || event.senderFrame !== window.webContents.mainFrame
        || event.senderFrame.url !== managerPageUrl) {
        throw new Error("Manager GUI IPC 拒绝非本地向导页面请求。");
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
    if (operation.kind === "test-provider") {
        return {
            installationId: null,
            installationRoot: resolve(process.cwd()),
            manifestSha256: null,
            deleteData: false,
        };
    }
    if (operation.kind === "configure-provider" && launchReceipt) {
        const verified = await createPhysicalLaunchReceipt(launchReceipt.installationRoot);
        if (!sameLaunchReceipt(verified, launchReceipt)) {
            launchReceipt = null;
            throw new Error("Provider 配置前的安装回执复核失败，请重新执行安装或修复。");
        }
        launchReceipt = verified;
        return {
            installationId: verified.installationId,
            installationRoot: verified.installationRoot,
            manifestSha256: verified.manifestSha256,
            deleteData: false,
        };
    }
    if (operation.kind === "status"
        || operation.kind === "doctor"
        || operation.kind === "repair"
        || operation.kind === "configure-provider"
        || operation.kind === "uninstall") {
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

function parseProviderTestEvent(value: unknown): ManagerGuiProviderTestResult | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (record.kind !== "provider-test"
        || typeof record.ok !== "boolean"
        || (record.status !== null && typeof record.status !== "number")
        || (record.warning !== null && typeof record.warning !== "string")
        || typeof record.discoverySupported !== "boolean"
        || (record.models !== null
            && (!Array.isArray(record.models)
                || record.models.some((model) => typeof model !== "string")))) {
        return null;
    }
    return {
        ok: record.ok,
        status: record.status as number | null,
        warning: record.warning as string | null,
        discoverySupported: record.discoverySupported,
        models: record.models as string[] | null,
    };
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
