import {createConnection, type Socket} from "node:net";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname, resolve, win32} from "node:path";
import {createInterface} from "node:readline";

import {
    DESKTOP_UAC_BROKER_SCHEMA,
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerAction,
    type DesktopUacBrokerEvent,
    type DesktopUacBrokerRequest,
    type DesktopUacBrokerSecretHello,
} from "nbook/shared/desktop-uac-broker";
import {parseDesktopInstallationManifest} from "nbook/shared/desktop-contract";
import {spawnOwnedProcess, type OwnedProcessLease} from "@notnotype/owned-process";
import {
    parseDesktopDelegatedUninstallReceipt,
    removeDesktopMachineUninstallLauncher,
    waitForWindowsUninstallHostResult,
    type DesktopDelegatedUninstallReceipt,
} from "nbook/desktop/shared/src/windows-uninstall-result";

type BrokerOptions = {
    pipe: string;
    secretPipe?: string;
    nonce: string;
    operationId: string;
    action: DesktopUacBrokerAction;
    managerExecutable: string;
    installationId: string | null;
    installationRoot: string;
    manifestSha256: string | null;
    deleteData: boolean;
};

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
    let child: OwnedProcessLease | null = null;
    let completed = false;
    const closeChild = (): void => {
        if (child) void child.terminate("host-disconnect").catch(() => undefined);
    };
    control.once("close", closeChild);
    try {
        send(control, {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "hello",
            operationId: options.operationId,
            nonce: options.nonce,
        });

        const request = await readRequest(control, options);
        await verifyBoundInstallation(options);
        const secret = request.secretBytes > 0
            ? await readSecret(options.secretPipe, request.secretBytes, options.operationId, options.nonce)
            : undefined;
        try {
            const secretText = secret
                ? new TextDecoder("utf-8", {fatal: true}).decode(secret)
                : undefined;
            const secretGuard = secretText === undefined ? undefined : createSecretLeakGuard(secretText);
            const observed = {uninstallReceipt: null as DesktopDelegatedUninstallReceipt | null};
            const observeManagerJson = (value: Record<string, unknown>): void => {
                const receipt = parseDesktopDelegatedUninstallReceipt(value);
                if (!receipt) return;
                if (observed.uninstallReceipt) throw new Error("Desktop UAC Broker 收到重复的 uninstall 完成回执。");
                observed.uninstallReceipt = receipt;
            };
            child = spawnOwnedProcess({
                command: process.execPath,
                args: ["--no-install", options.managerExecutable, ...request.args],
                cwd: resolve(dirname(options.managerExecutable), ".."),
                env: {
                    ...process.env,
                    NODE_PATH: undefined,
                    AUTH_ADMIN_PASSWORD: undefined,
                    NBOOK_MANAGER_ELEVATED: "1",
                },
                stdin: "pipe",
                stdout: "pipe",
                stderr: "pipe",
                windowsHide: true,
                graceMs: 1_000,
                hardKillWaitMs: 5_000,
            });
            const stdin = child.stdin;
            if (!stdin) throw new Error("Desktop UAC Broker 无法打开 Manager CLI stdin。");
            if (secret) {
                await writeSecretToStdin(stdin, secret);
            } else {
                stdin.end();
            }

            const drains = [
                child.stdout ? forwardLines(child.stdout, control, "stdout", secretGuard, observeManagerJson) : Promise.resolve(),
                child.stderr ? forwardLines(child.stderr, control, "stderr", secretGuard) : Promise.resolve(),
            ];
            try {
                const [exitCode, signal] = await Promise.race([
                    child.completion.then(({exitCode, signal}) => ({
                        kind: "exit" as const,
                        value: [exitCode, signal] as [number | null, string | null],
                    })),
                    ...drains.map((drain) => drain.then(
                        () => new Promise<never>(() => undefined),
                        (error: unknown) => Promise.reject(error),
                    )),
                ]).then(async (result) => {
                    if (!result || result.kind !== "exit") throw new Error("Desktop UAC Broker 输出处理状态无效。");
                    await Promise.all(drains);
                    return result.value;
                });
                if (request.action === "uninstall" && exitCode === 0 && signal === null) {
                    const receipt = observed.uninstallReceipt;
                    if (!receipt) {
                        throw new Error("Desktop UAC Broker uninstall 缺少最终 CLI 回执。");
                    }
                    if (receipt.status === "scheduled") {
                        await waitForWindowsUninstallHostResult(
                            receipt.resultPath,
                            request.installationRoot,
                        );
                    }
                    await removeDesktopMachineUninstallLauncher(request.installationId);
                }
                send(control, {
                    schema: DESKTOP_UAC_BROKER_SCHEMA,
                    type: "event",
                    operationId: options.operationId,
                    event: {kind: "complete", exitCode, signal},
                });
                completed = true;
            } catch (error) {
                await child.terminate("startup-failure").catch(() => undefined);
                await child.completion.catch(() => undefined);
                await Promise.allSettled(drains);
                if (!control.destroyed) {
                    send(control, {
                        schema: DESKTOP_UAC_BROKER_SCHEMA,
                        type: "event",
                        operationId: options.operationId,
                        event: {
                            kind: "failure",
                            code: "broker-output-failure",
                            message: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                completed = true;
            }
        } finally {
            secret?.fill(0);
        }
    } catch (error) {
        if (!completed && !control.destroyed) {
            send(control, {
                schema: DESKTOP_UAC_BROKER_SCHEMA,
                type: "event",
                operationId: options.operationId,
                event: {
                    kind: "failure",
                    code: "broker-failure",
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
        if (child) await child.terminate("startup-failure").catch(() => undefined);
        throw error;
    } finally {
        control.removeListener("close", closeChild);
        if (!control.destroyed) control.end();
    }
}

async function verifyBoundInstallation(options: BrokerOptions): Promise<void> {
    if (options.manifestSha256 === null) return;
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error("Desktop UAC Broker 缺少 LOCALAPPDATA，不能验证安装身份。");
    const manifestPath = resolve(localAppData, "NeuroBook", "desktop", "desktop-installation.json");
    const text = await readFile(manifestPath, "utf8");
    const digest = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
    if (digest !== options.manifestSha256) throw new Error("Desktop UAC Broker manifest 摘要已变化，请重新执行操作。");
    const manifest = parseDesktopInstallationManifest(JSON.parse(text) as unknown);
    if (manifest.installationId !== options.installationId) {
        throw new Error("Desktop UAC Broker installationId 已变化，请重新执行操作。");
    }
    const expectedRoot = manifest.installationScope === "machine"
        ? resolve(process.env.ProgramFiles ?? resolve(process.env.SystemDrive ?? "C:", "Program Files"), "NeuroBook")
        : resolve(localAppData, "Programs", "NeuroBook");
    if (!samePath(expectedRoot, options.installationRoot)) {
        throw new Error("Desktop UAC Broker Installation Root 与 manifest 不一致。");
    }
}

async function readRequest(control: Socket, options: BrokerOptions): Promise<DesktopUacBrokerRequest> {
    const line = await readOneLine(control);
    const parsed = parseDesktopUacBrokerLine(line);
    if (parsed.type !== "request") throw new Error("Desktop UAC Broker request 类型不匹配。");
    return validateDesktopUacBrokerRequest(parsed, options.operationId, options.action, options);
}

export function validateDesktopUacBrokerRequest(
    request: DesktopUacBrokerRequest,
    operationId: string,
    expectedAction: DesktopUacBrokerAction = "desktop-install",
    expectedBinding?: Pick<BrokerOptions, "installationId" | "installationRoot" | "manifestSha256" | "deleteData">,
): DesktopUacBrokerRequest {
    if (request.operationId !== operationId || request.action !== expectedAction) {
        throw new Error("Desktop UAC Broker request 身份或 action 不匹配。");
    }
    if (expectedBinding !== undefined
        && (request.installationId !== expectedBinding.installationId
            || request.manifestSha256 !== expectedBinding.manifestSha256
            || request.deleteData !== expectedBinding.deleteData
            || !samePath(request.installationRoot, expectedBinding.installationRoot))) {
        throw new Error("Desktop UAC Broker request 安装身份或删除范围不匹配。");
    }
    if (request.action === "desktop-install") {
        if (request.args[0] !== "desktop" || request.args[1] !== "install") {
            throw new Error("Desktop UAC Broker 只允许 desktop install。");
        }
        validateDesktopInstallArguments(request.args);
        if (!sameWindowsPath(request.installationRoot, canonicalMachineInstallationRoot())) {
            throw new Error("Desktop UAC Broker install 只允许 canonical Program Files Installation Root。");
        }
        if (request.installationId !== null || request.manifestSha256 !== null || request.deleteData) {
            throw new Error("Desktop UAC Broker install 不得绑定已有安装或删除数据。");
        }
    } else if (request.action === "desktop-repair") {
        if (!request.args.includes("desktop") || !request.args.includes("repair")) {
            throw new Error("Desktop UAC Broker 只允许 desktop repair。");
        }
        if (request.installationId === null || request.manifestSha256 === null || request.deleteData) {
            throw new Error("Desktop UAC Broker repair 必须绑定已有安装且不能删除数据。");
        }
    } else {
        if (!request.args.includes("uninstall")) throw new Error("Desktop UAC Broker 只允许 uninstall。");
        if (request.installationId === null || request.manifestSha256 === null) {
            throw new Error("Desktop UAC Broker uninstall 必须绑定已有安装。");
        }
    }
    const rootArgument = optionValue(request.args, "--root");
    if (request.action !== "desktop-install") {
        if (rootArgument === undefined) {
            throw new Error("Desktop UAC Broker repair/uninstall 必须显式绑定 --root。");
        }
        if (!samePath(rootArgument, request.installationRoot)) {
            throw new Error("Desktop UAC Broker 命令 root 与绑定 Installation Root 不匹配。");
        }
    }
    if (request.action === "uninstall" && request.deleteData !== request.args.includes("--delete-data")) {
        throw new Error("Desktop UAC Broker deleteData 与卸载参数不匹配。");
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
        schema: DESKTOP_UAC_BROKER_SCHEMA,
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

async function forwardLines(
    stream: NodeJS.ReadableStream,
    control: Socket,
    streamName: "stdout" | "stderr",
    secretGuard: SecretLeakGuard | undefined,
    onJson?: (value: Record<string, unknown>) => void,
): Promise<void> {
    const reader = createInterface({input: stream, crlfDelay: Infinity});
    try {
        for await (const line of reader) {
            if (control.destroyed) return;
            const safeLine = line.slice(0, 16 * 1024);
            if (secretGuard !== undefined && safeLine.length > 0) {
                // The CLI contract forbids echoing stdin. Fail closed if a
                // future change accidentally writes the secret to stdout/stderr.
                secretGuard.check(`${safeLine}\n`);
            }
            if (streamName === "stdout") {
                let value: unknown;
                try {
                    value = JSON.parse(safeLine) as unknown;
                } catch {
                    // Plain output is forwarded as bounded diagnostic text.
                }
                if (isRecord(value)) {
                    onJson?.(value);
                    send(control, {
                        schema: DESKTOP_UAC_BROKER_SCHEMA,
                        type: "event",
                        operationId: currentOperationId(control),
                        event: {kind: "json", value},
                    });
                    continue;
                }
            }
            send(control, {
                schema: DESKTOP_UAC_BROKER_SCHEMA,
                type: "event",
                operationId: currentOperationId(control),
                event: {kind: "log", stream: streamName, message: safeLine},
            });
        }
    } finally {
        reader.close();
    }
}

type SecretLeakGuard = {
    check: (chunk: string) => void;
};

function createSecretLeakGuard(secret: string): SecretLeakGuard {
    const representations = [...new Set([
        secret,
        secret.replace(/\r\n?/gu, "\n"),
        JSON.stringify(secret).slice(1, -1),
        JSON.stringify(secret.replace(/\r\n?/gu, "\n")).slice(1, -1),
    ].filter((value) => value.length > 0))];
    let tail = "";
    const keep = Math.max(...representations.map((value) => value.length - 1), 0);
    return {
        check(chunk: string): void {
            const candidate = tail + chunk;
            if (representations.some((value) => candidate.includes(value))) {
                throw new Error("Desktop UAC Broker 检测到未预期的 Secret 输出。");
            }
            tail = keep > 0 ? candidate.slice(-keep) : "";
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
    schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
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

function validateDesktopInstallArguments(args: string[]): void {
    const valueOptions = new Map<string, readonly string[] | null>([
        ["--archive", null],
        ["--depot", null],
        ["--distribution-manifest", null],
        ["--distribution-manifest-url", null],
        ["--scope", ["machine"]],
        ["--channel", ["stable", "canary"]],
        ["--runtime-provider", ["managed", "system"]],
        ["--git-provider", ["managed", "system"]],
        ["--rg-provider", ["managed", "system"]],
        ["--envelope", ["electron"]],
    ]);
    const switches = new Set([
        "--yes",
        "--json",
        "--add-cli-to-path",
        "--enable-auth",
        "--password-stdin",
    ]);
    const seen = new Map<string, string>();
    const enabled = new Set<string>();
    for (let index = 2; index < args.length; index += 1) {
        const option = args[index]!;
        if (switches.has(option)) {
            if (enabled.has(option)) throw new Error(`Desktop UAC Broker install 参数重复：${option}`);
            enabled.add(option);
            continue;
        }
        if (!valueOptions.has(option)) {
            throw new Error(`Desktop UAC Broker install 包含未允许参数：${option}`);
        }
        if (seen.has(option)) throw new Error(`Desktop UAC Broker install 参数重复：${option}`);
        const value = args[index + 1];
        if (!value || value.startsWith("--") || value.includes("\0")) {
            throw new Error(`Desktop UAC Broker install 参数缺少值：${option}`);
        }
        const allowed = valueOptions.get(option);
        if (allowed && !allowed.includes(value)) {
            throw new Error(`Desktop UAC Broker install 参数值无效：${option}`);
        }
        seen.set(option, value);
        index += 1;
    }
    const sourceOptions = ["--archive", "--depot", "--distribution-manifest", "--distribution-manifest-url"]
        .filter((option) => seen.has(option));
    if (sourceOptions.length !== 1) {
        throw new Error("Desktop UAC Broker install 必须且只能绑定一个本地或 HTTPS 发行来源。");
    }
    for (const required of [
        "--scope",
        "--channel",
        "--runtime-provider",
        "--git-provider",
        "--rg-provider",
        "--envelope",
    ]) {
        if (!seen.has(required)) throw new Error(`Desktop UAC Broker install 缺少参数：${required}`);
    }
    if (!enabled.has("--yes") || !enabled.has("--json")) {
        throw new Error("Desktop UAC Broker install 必须使用非交互 JSON 合同。");
    }
    if (seen.has("--distribution-manifest-url")
        && !seen.get("--distribution-manifest-url")!.startsWith("https://")) {
        throw new Error("Desktop UAC Broker install 在线 manifest 必须使用 HTTPS。");
    }
    if (enabled.has("--enable-auth") !== enabled.has("--password-stdin")) {
        throw new Error("Desktop UAC Broker install auth 与 password stdin 参数不一致。");
    }
}

function canonicalMachineInstallationRoot(): string {
    const programFiles = process.env.ProgramFiles
        ?? `${process.env.SystemDrive ?? "C:"}\\Program Files`;
    return win32.resolve(programFiles, "NeuroBook");
}

function sameWindowsPath(left: string, right: string): boolean {
    return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

function optionValue(args: string[], option: string): string | undefined {
    const index = args.indexOf(option);
    if (index < 0) return undefined;
    return args[index + 1];
}

function samePath(left: string, right: string): boolean {
    const a = resolve(left);
    const b = resolve(right);
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
