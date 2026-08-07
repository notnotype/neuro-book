import {spawn} from "node:child_process";
import {createConnection, type Socket} from "node:net";
import {dirname, resolve} from "node:path";
import {createInterface} from "node:readline";

import {
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerAction,
    type DesktopUacBrokerEvent,
    type DesktopUacBrokerRequest,
    type DesktopUacBrokerSecretHello,
} from "nbook/shared/desktop-uac-broker";

type BrokerOptions = {
    pipe: string;
    secretPipe?: string;
    nonce: string;
    operationId: string;
    action: DesktopUacBrokerAction;
    managerExecutable: string;
};

type ChildProcess = ReturnType<typeof spawn>;

/**
 * Elevated Manager entrypoint.
 *
 * It accepts exactly one machine Desktop mutation request over a one-shot pipe,
 * then delegates the real work to the normal Manager CLI. The broker itself
 * never parses or persists a password; it only writes bounded bytes to the
 * delegated CLI stdin.
 */
export async function runDesktopUacBroker(options: BrokerOptions): Promise<void> {
    if (process.platform !== "win32") throw new Error("Desktop UAC Broker 只支持 Windows。");
    const control = await connectPipe(options.pipe);
    controlOperationIds.set(control, options.operationId);
    let child: ChildProcess | null = null;
    let completed = false;
    const closeChild = (): void => {
        if (child && child.exitCode === null) child.kill();
    };
    control.once("close", closeChild);
    try {
        send(control, {
            schema: "nbook.desktop-uac-broker/v1",
            type: "hello",
            operationId: options.operationId,
            nonce: options.nonce,
        });

        const request = await readRequest(control, options);
        const secret = request.secretBytes > 0
            ? await readSecret(options.secretPipe, request.secretBytes, options.operationId, options.nonce)
            : undefined;
        try {
            const secretText = secret
                ? new TextDecoder("utf-8", {fatal: true}).decode(secret)
                : undefined;
            const secretGuard = secretText === undefined ? undefined : createSecretLeakGuard(secretText);
            child = spawn(process.execPath, ["--no-install", options.managerExecutable, ...request.args], {
                cwd: resolve(dirname(options.managerExecutable), ".."),
                env: {
                    ...process.env,
                    NODE_PATH: undefined,
                    AUTH_ADMIN_PASSWORD: undefined,
                    NBOOK_MANAGER_ELEVATED: "1",
                },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
            const stdin = child.stdin;
            if (!stdin) throw new Error("Desktop UAC Broker 无法打开 Manager CLI stdin。");
            if (secret) {
                await writeSecretToStdin(stdin, secret);
            } else {
                stdin.end();
            }

            const stdout = child.stdout;
            if (stdout) forwardLines(stdout, control, "stdout", secretGuard);
            const stderr = child.stderr;
            if (stderr) forwardLines(stderr, control, "stderr", secretGuard);

            const [exitCode, signal] = await waitForExit(child);
            send(control, {
                schema: "nbook.desktop-uac-broker/v1",
                type: "event",
                operationId: options.operationId,
                event: {kind: "complete", exitCode, signal},
            });
            completed = true;
        } finally {
            secret?.fill(0);
        }
    } catch (error) {
        if (!completed && !control.destroyed) {
            send(control, {
                schema: "nbook.desktop-uac-broker/v1",
                type: "event",
                operationId: options.operationId,
                event: {
                    kind: "failure",
                    code: "broker-failure",
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
        closeChild();
        throw error;
    } finally {
        control.removeListener("close", closeChild);
        if (!control.destroyed) control.end();
    }
}

async function readRequest(control: Socket, options: BrokerOptions): Promise<DesktopUacBrokerRequest> {
    const line = await readOneLine(control);
    const parsed = parseDesktopUacBrokerLine(line);
    if (parsed.type !== "request") throw new Error("Desktop UAC Broker request 类型不匹配。");
    return validateDesktopUacBrokerRequest(parsed, options.operationId, options.action);
}

export function validateDesktopUacBrokerRequest(
    request: DesktopUacBrokerRequest,
    operationId: string,
    expectedAction: DesktopUacBrokerAction = "desktop-install",
): DesktopUacBrokerRequest {
    if (request.operationId !== operationId || request.action !== expectedAction) {
        throw new Error("Desktop UAC Broker request 身份或 action 不匹配。");
    }
    if (request.action === "desktop-install") {
        if (request.args[0] !== "desktop" || request.args[1] !== "install") {
            throw new Error("Desktop UAC Broker 只允许 desktop install。");
        }
        if (!hasMachineScope(request.args)) {
            throw new Error("Desktop UAC Broker 只允许 machine scope。");
        }
    } else if (request.action === "desktop-repair") {
        if (request.args[0] !== "desktop" || request.args[1] !== "repair") {
            throw new Error("Desktop UAC Broker 只允许 desktop repair。");
        }
    } else if (request.args[0] !== "uninstall") {
        throw new Error("Desktop UAC Broker 只允许 uninstall。");
    }
    const hasPasswordStdin = request.args.includes("--password-stdin");
    if (request.action !== "desktop-install" && (hasPasswordStdin || request.secretBytes > 0)) {
        throw new Error("Desktop UAC Broker repair/uninstall 不得携带密码。");
    }
    if (hasPasswordStdin !== (request.secretBytes > 0)) {
        throw new Error("Desktop UAC Broker password stdin 与 secretBytes 不一致。");
    }
    if (request.secretBytes > DESKTOP_UAC_MAX_SECRET_BYTES) {
        throw new Error("Desktop UAC Broker secret 超过大小上限。");
    }
    return request;
}

async function readSecret(
    secretPipe: string | undefined,
    expectedBytes: number,
    operationId: string,
    nonce: string,
): Promise<Uint8Array> {
    if (!secretPipe) throw new Error("Desktop UAC Broker 缺少 secret pipe。");
    const socket = await connectPipe(secretPipe);
    send(socket, {
        schema: "nbook.desktop-uac-broker/v1",
        type: "secret-hello",
        operationId,
        nonce,
    });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for await (const chunk of socket) {
            const value = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
            total += value.byteLength;
            if (total > expectedBytes) throw new Error("Desktop UAC Broker secret 超过声明长度。");
            chunks.push(value);
        }
        if (total !== expectedBytes) throw new Error("Desktop UAC Broker secret 长度不匹配。");
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return result;
    } finally {
        for (const chunk of chunks) chunk.fill(0);
        socket.destroy();
    }
}

async function writeSecretToStdin(
    stdin: NodeJS.WritableStream,
    secret: Uint8Array,
): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const payload = Buffer.from(secret);
        const onError = (error: Error): void => {
            payload.fill(0);
            rejectPromise(error);
        };
        stdin.once("error", onError);
        try {
            stdin.write(payload, () => {
                payload.fill(0);
                stdin.end(() => {
                    stdin.removeListener("error", onError);
                    resolvePromise();
                });
            });
        } catch (error) {
            payload.fill(0);
            stdin.removeListener("error", onError);
            rejectPromise(error);
        }
    });
}

function forwardLines(
    stream: NodeJS.ReadableStream,
    control: Socket,
    streamName: "stdout" | "stderr",
    secretGuard: SecretLeakGuard | undefined,
): void {
    const reader = createInterface({input: stream, crlfDelay: Infinity});
    void (async () => {
        for await (const line of reader) {
            if (control.destroyed) return;
            const safeLine = line.slice(0, 16 * 1024);
            if (secretGuard !== undefined && safeLine.length > 0) {
                // The CLI contract forbids echoing stdin. Fail closed if a
                // future change accidentally writes the secret to stdout/stderr.
                secretGuard.check(`${safeLine}\n`);
            }
            if (streamName === "stdout") {
                try {
                    const value: unknown = JSON.parse(safeLine);
                    if (isRecord(value)) {
                        send(control, {
                            schema: "nbook.desktop-uac-broker/v1",
                            type: "event",
                            operationId: currentOperationId(control),
                            event: {kind: "json", value},
                        });
                        continue;
                    }
                } catch {
                    // Plain output is forwarded as bounded diagnostic text.
                }
            }
            send(control, {
                schema: "nbook.desktop-uac-broker/v1",
                type: "event",
                operationId: currentOperationId(control),
                event: {kind: "log", stream: streamName, message: safeLine},
            });
        }
    })().catch((error: unknown) => {
        if (!control.destroyed) {
            send(control, {
                schema: "nbook.desktop-uac-broker/v1",
                type: "event",
                operationId: currentOperationId(control),
                event: {
                    kind: "failure",
                    code: "broker-output-failure",
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
    });
}

type SecretLeakGuard = {
    check: (chunk: string) => void;
};

function createSecretLeakGuard(secret: string): SecretLeakGuard {
    let tail = "";
    const keep = Math.max(secret.length - 1, 0);
    return {
        check(chunk: string): void {
            const candidate = tail + chunk;
            if (candidate.includes(secret)) {
                throw new Error("Desktop UAC Broker 检测到未预期的 Secret 输出。");
            }
            tail = candidate.slice(-keep);
        },
    };
}

/**
 * The operation ID is fixed on the control socket by the broker entrypoint.
 * Keeping it in a WeakMap avoids adding it to every stdout callback closure.
 */
const controlOperationIds = new WeakMap<Socket, string>();

function currentOperationId(control: Socket): string {
    const operationId = controlOperationIds.get(control);
    if (!operationId) throw new Error("Desktop UAC Broker control operation 未初始化。");
    return operationId;
}

function send(control: Socket, value: DesktopUacBrokerEvent | {
    schema: "nbook.desktop-uac-broker/v1";
    type: "hello";
    operationId: string;
    nonce: string;
} | DesktopUacBrokerSecretHello): void {
    control.write(encodeDesktopUacBrokerLine(value));
}

async function readOneLine(control: Socket): Promise<string> {
    const reader = createInterface({input: control, crlfDelay: Infinity});
    try {
        for await (const line of reader) return line;
    } finally {
        reader.close();
    }
    throw new Error("Desktop UAC Broker pipe 在 request 前关闭。");
}

async function connectPipe(path: string): Promise<Socket> {
    if (!path.startsWith("\\\\.\\pipe\\")) throw new Error("Desktop UAC Broker pipe 必须是 Windows named pipe。");
    return await new Promise<Socket>((resolve, reject) => {
        const socket = createConnection(path);
        const onError = (error: Error): void => {
            socket.destroy();
            reject(error);
        };
        socket.once("error", onError);
        socket.once("connect", () => {
            socket.removeListener("error", onError);
            resolve(socket);
        });
    });
}

async function waitForExit(child: ChildProcess): Promise<[number | null, string | null]> {
    return await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve([code, signal]));
    });
}

function hasMachineScope(args: string[]): boolean {
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--scope" && args[index + 1] === "machine") return true;
        if (args[index] === "--scope=machine") return true;
    }
    return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
