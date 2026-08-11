import {spawn, type ChildProcess} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {lstat} from "node:fs/promises";
import {createServer, type Server, type Socket} from "node:net";
import {dirname, resolve} from "node:path";
import {createInterface} from "node:readline";

import {
    DESKTOP_UAC_BROKER_SCHEMA,
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerAction,
    type DesktopUacBrokerEvent,
} from "nbook/shared/desktop-uac-broker";

export type DesktopUacClientBinding = {
    installationId: string | null;
    installationRoot: string;
    manifestSha256: string | null;
    deleteData: boolean;
};

export type DesktopUacClientInvocation = {
    action: DesktopUacBrokerAction;
    args: string[];
    stdin?: string;
};

export type DesktopUacClientResult = {
    exitCode: number | null;
    signal: string | null;
    installationRoot?: string;
};

export type DesktopUacClientEvent = DesktopUacBrokerEvent["event"];

type DesktopUacClientOptions = {
    bunPath: string;
    managerPath: string;
    invocation: DesktopUacClientInvocation;
    binding: DesktopUacClientBinding;
    onEvent?: (event: DesktopUacClientEvent) => void;
    environment?: NodeJS.ProcessEnv;
    handshakeTimeoutMs?: number;
    operationTimeoutMs?: number;
};

export class DesktopUacClientError extends Error {
    readonly code: "uac-cancelled" | "uac-broker-failure";
    readonly brokerCode?: string;

    constructor(
        code: DesktopUacClientError["code"],
        message: string,
        options?: ErrorOptions & {brokerCode?: string},
    ) {
        super(message, options);
        this.name = "DesktopUacClientError";
        this.code = code;
        this.brokerCode = options?.brokerCode;
    }
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30 * 60_000;
const ELEVATED_WRAPPER_EXIT_TIMEOUT_MS = 5_000;

/**
 * 建立一次性非提升端 UAC 会话。
 *
 * Electron Manager GUI 与 Programs and Features launcher 都必须经过这个
 * client；真正的安装、修复和卸载仍由 elevated Manager Broker 委派给 CLI。
 */
export async function runDesktopUacClient(options: DesktopUacClientOptions): Promise<DesktopUacClientResult> {
    if (process.platform !== "win32") throw new Error("Desktop UAC Client 只支持 Windows。");
    await assertRegularUacInput(options.bunPath, "Bun Runtime");
    await assertRegularUacInput(options.managerPath, "Manager CLI");
    const {invocation, binding} = options;
    const secretBytes = invocation.stdin === undefined ? 0 : Buffer.byteLength(invocation.stdin, "utf8");
    if (secretBytes > DESKTOP_UAC_MAX_SECRET_BYTES) throw new Error("管理员密码超过 4096 bytes。");
    if (invocation.args.includes("--password-stdin") && secretBytes === 0) {
        throw new Error("machine-scope --password-stdin 缺少密码。");
    }
    if (!invocation.args.includes("--password-stdin") && secretBytes > 0) {
        throw new Error("machine-scope secret 只能用于 --password-stdin。");
    }

    const operationId = randomUUID();
    const nonce = randomBytes(32).toString("hex");
    const controlPipe = `\\\\.\\pipe\\neurobook-manager-${randomUUID()}`;
    const secretPipe = secretBytes > 0 ? `\\\\.\\pipe\\neurobook-manager-secret-${randomUUID()}` : null;
    const controlServer = createServer();
    const secretServer = secretPipe ? createServer() : null;
    let elevated: ChildProcess | null = null;
    let controlSocket: Socket | null = null;
    let secretSocket: Socket | null = null;
    const closeServers = (): void => {
        closeServer(controlServer);
        if (secretServer) closeServer(secretServer);
    };

    try {
        await listenPipe(controlServer, controlPipe);
        if (secretServer && secretPipe) await listenPipe(secretServer, secretPipe);
        const controlSocketPromise = acceptOneSocket(controlServer);
        const secretSocketPromise = secretServer ? acceptOneSocket(secretServer) : null;
        // UAC 可能在进入 secret await 之前被取消；预先附加 rejection
        // observer，最终 await 仍会得到原始拒绝，但不会产生未处理 Promise。
        void secretSocketPromise?.catch(() => undefined);
        elevated = launchElevatedBroker(options.bunPath, options.managerPath, {
            controlPipe,
            secretPipe,
            nonce,
            operationId,
            action: invocation.action,
            ...binding,
        }, options.environment);
        controlSocket = await withTimeout(
            awaitElevatedControlSocket(controlSocketPromise, elevated),
            options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
            "UAC",
        );
        closeServer(controlServer);
        const hello = parseDesktopUacBrokerLine(await readOneLine(controlSocket));
        if (hello.type !== "hello" || hello.operationId !== operationId || hello.nonce !== nonce) {
            throw new Error("UAC Broker handshake 身份不匹配。");
        }
        controlSocket.write(encodeDesktopUacBrokerLine({
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId,
            action: invocation.action,
            args: invocation.args,
            secretBytes,
            installationId: binding.installationId,
            installationRoot: binding.installationRoot,
            manifestSha256: binding.manifestSha256,
            deleteData: binding.deleteData,
        }));
        if (secretSocketPromise && invocation.stdin !== undefined) {
            secretSocket = await withTimeout(
                secretSocketPromise,
                options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
                "UAC secret",
            );
            await validateSecretPipeHello(secretSocket, operationId, nonce);
            if (secretServer) closeServer(secretServer);
            secretSocket.end(Buffer.from(invocation.stdin, "utf8"));
        } else if (secretServer) {
            closeServer(secretServer);
        }
        const result = await withTimeout(
            receiveElevatedEvents(controlSocket, operationId, options.onEvent),
            options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
            "machine-scope 操作",
        );
        try {
            await withTimeout(
                waitForChildExit(elevated),
                ELEVATED_WRAPPER_EXIT_TIMEOUT_MS,
                "UAC launcher exit",
            );
        } catch (error) {
            await terminateWrapper(elevated);
            throw error;
        }
        return result;
    } catch (error) {
        controlSocket?.destroy();
        secretSocket?.destroy();
        if (elevated) await terminateWrapper(elevated);
        const message = error instanceof Error ? error.message : String(error);
        if (isUacCancellationMessage(message)) {
            throw new DesktopUacClientError(
                "uac-cancelled",
                "UAC 未批准或提升进程未连接，操作未执行。",
                {cause: error},
            );
        }
        if (error instanceof DesktopUacClientError) throw error;
        throw new DesktopUacClientError("uac-broker-failure", message, {cause: error});
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
    environment: NodeJS.ProcessEnv | undefined,
): ChildProcess {
    const brokerArgs = [
        "--no-install",
        resolve(managerPath),
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
    const command = `Start-Process -FilePath ${powerShellLiteral(resolve(bunPath))} -WorkingDirectory ${powerShellLiteral(dirname(resolve(managerPath)))} -Verb RunAs -ArgumentList ${powerShellLiteral(argumentList)} -Wait`;
    const child = spawn("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
    ], {
        env: desktopUacClientEnvironment(environment),
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
    });
    child.stderr?.on("data", () => undefined);
    return child;
}

function receiveElevatedEvents(
    control: Socket,
    operationId: string,
    onEvent: DesktopUacClientOptions["onEvent"],
): Promise<DesktopUacClientResult> {
    return new Promise<DesktopUacClientResult>((resolvePromise, rejectPromise) => {
        const reader = createInterface({input: control, crlfDelay: Infinity});
        let settled = false;
        let installationRoot: string | undefined;
        const finish = (result: DesktopUacClientResult): void => {
            if (settled) return;
            settled = true;
            reader.close();
            control.destroy();
            resolvePromise({...result, ...(installationRoot ? {installationRoot} : {})});
        };
        const fail = (error: unknown): void => {
            if (settled) return;
            settled = true;
            reader.close();
            control.destroy();
            rejectPromise(error);
        };
        reader.on("line", (line) => {
            try {
                const parsed = parseDesktopUacBrokerLine(line);
                if (parsed.type !== "event" || parsed.operationId !== operationId) {
                    throw new Error("UAC Broker event operation 不匹配。");
                }
                onEvent?.(parsed.event);
                if (parsed.event.kind === "json") {
                    const root = parsed.event.value.installationRoot;
                    if (parsed.event.value.kind === "complete" && typeof root === "string" && root) {
                        installationRoot = resolve(root);
                    }
                    return;
                }
                if (parsed.event.kind === "log") return;
                if (parsed.event.kind === "failure") {
                    fail(new DesktopUacClientError(
                        "uac-broker-failure",
                        parsed.event.message,
                        {brokerCode: parsed.event.code},
                    ));
                    return;
                }
                finish({exitCode: parsed.event.exitCode, signal: parsed.event.signal});
            } catch (error) {
                fail(error);
            }
        });
        control.once("error", fail);
        control.once("close", () => {
            if (!settled) finish({exitCode: null, signal: "uac-disconnected"});
        });
    });
}

function desktopUacClientEnvironment(input: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {
        ...(input ?? process.env),
        NODE_PATH: undefined,
        AUTH_ADMIN_PASSWORD: undefined,
        NBOOK_MANAGER_ELEVATED: undefined,
    };
    for (const key of Object.keys(environment)) {
        if (key.startsWith("NBOOK_DESKTOP_DEV_")) delete environment[key];
    }
    return environment;
}

function listenPipe(server: Server, path: string): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
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

function acceptOneSocket(server: Server): Promise<Socket> {
    return new Promise<Socket>((resolvePromise, rejectPromise) => {
        let accepted = false;
        const onClose = (): void => {
            if (!accepted) rejectPromise(new Error("UAC pipe 在连接前关闭。"));
        };
        const onError = (error: Error): void => {
            if (!accepted) rejectPromise(error);
        };
        server.once("close", onClose);
        server.once("error", onError);
        server.on("connection", (socket) => {
            if (accepted) {
                socket.destroy();
                return;
            }
            accepted = true;
            server.removeListener("close", onClose);
            server.removeListener("error", onError);
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

function waitForChildExit(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolvePromise) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolvePromise();
            return;
        }
        child.once("exit", () => resolvePromise());
        child.once("error", () => resolvePromise());
    });
}

async function terminateWrapper(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await withTimeout(
        waitForChildExit(child),
        ELEVATED_WRAPPER_EXIT_TIMEOUT_MS,
        "UAC launcher termination",
    ).catch(() => undefined);
}

async function assertRegularUacInput(path: string, label: string): Promise<void> {
    const resolvedPath = resolve(path);
    const info = await lstat(resolvedPath).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) {
        throw new Error(`Desktop UAC Client ${label} 必须是普通文件：${resolvedPath}`);
    }
}

function awaitElevatedControlSocket(socketPromise: Promise<Socket>, elevated: ChildProcess): Promise<Socket> {
    if (elevated.exitCode !== null || elevated.signalCode !== null) {
        throw new Error(`UAC 提升进程未连接：exitCode=${elevated.exitCode ?? "null"}, signal=${elevated.signalCode ?? "null"}`);
    }
    return Promise.race([
        socketPromise,
        new Promise<Socket>((_resolve, reject) => {
            const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
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

function closeServer(server: Server): void {
    if (server.listening) server.close();
}

function powerShellLiteral(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

/** Start-Process 会把 ArgumentList 重新拼成 Windows command line。 */
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} 超时：${timeoutMs}ms`)), timeoutMs);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function isUacCancellationMessage(message: string): boolean {
    return message.includes("UAC 超时")
        || message.includes("UAC 提升进程未连接");
}
