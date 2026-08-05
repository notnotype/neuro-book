import {spawn} from "node:child_process";
import type {Readable} from "node:stream";

import {WINDOWS_SUPERVISOR_SOURCE} from "#owned-process/windows-supervisor-source";
import {OwnedProcessError} from "#owned-process/types";
import type {
    OwnedProcessCompletion,
    OwnedProcessLease,
    OwnedProcessSpec,
    OwnedProcessTerminationReason,
} from "#owned-process/types";

type SupervisorMessage =
    | {kind: "ready"; rootPid: number}
    | {kind: "complete"; exitCode: number | null; signal: NodeJS.Signals | null}
    | {kind: "terminated"; exitCode: number | null; signal: NodeJS.Signals | null; reason: OwnedProcessTerminationReason}
    | {kind: "error"; stage: string; message: string; osError?: number};

type WindowsAdapterOptions = {
    /** 仅供包内监督协议与Win32故障回归覆盖，公共spawnOwnedProcess不暴露。 */
    supervisorSource?: string;
};

/** Windows Adapter通过Bun FFI监督进程在目标创建前建立Job Object所有权。 */
export function spawnWindowsOwnedProcess(spec: OwnedProcessSpec, options: WindowsAdapterOptions = {}): OwnedProcessLease {
    const graceMs = validWindow(spec.graceMs, 500, "graceMs");
    const hardKillWaitMs = validWindow(spec.hardKillWaitMs, 3_000, "hardKillWaitMs");
    const supervisorRuntime = process.versions.bun ? process.execPath : "bun";
    const supervisor = spawn(supervisorRuntime, ["-e", options.supervisorSource ?? WINDOWS_SUPERVISOR_SOURCE], {
        // 监督器使用宿主Runtime环境；目标env只通过IPC传递，不能让调用方裁剪PATH后破坏ownership建立。
        env: process.env,
        stdio: [spec.stdin === "inherit" ? 0 : spec.stdin === "pipe" ? "pipe" : "ignore", spec.stdout ?? "pipe", spec.stderr ?? "pipe", "ipc"],
        windowsHide: spec.windowsHide ?? true,
    });
    let settled = false;
    let terminationReason: OwnedProcessTerminationReason | undefined;
    let terminationPromise: Promise<OwnedProcessCompletion> | undefined;
    let watchdog: NodeJS.Timeout | undefined;
    let terminalMessage: Extract<SupervisorMessage, {kind: "complete" | "terminated"}> | undefined;
    let terminalError: unknown;
    let resolveCompletion!: (value: OwnedProcessCompletion) => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<OwnedProcessCompletion>((resolvePromise, rejectPromise) => {
        resolveCompletion = resolvePromise;
        rejectCompletion = rejectPromise;
    });

    supervisor.once("error", (error) => beginFailure(new OwnedProcessError(
        `无法启动Windows自有进程监督器：${error.message}`,
        {stage: "supervisor-spawn", cause: error},
    )));
    supervisor.on("message", (value: unknown) => {
        try {
            handleSupervisorMessage(parseSupervisorMessage(value));
        } catch (error) {
            beginFailure(error);
        }
    });
    supervisor.once("close", (code, signal) => {
        if (settled) return;
        if (terminalError) {
            rejectOnce(terminalError);
            return;
        }
        if (terminalMessage) {
            settle({
                exitCode: terminalMessage.exitCode,
                signal: terminalMessage.signal,
                ...(terminalMessage.kind === "terminated" ? {terminationReason: terminalMessage.reason} : {}),
            });
            return;
        }
        if (terminationReason && (code === 137 || signal !== null)) {
            settle({exitCode: null, signal, terminationReason});
            return;
        }
        rejectOnce(new OwnedProcessError(
            `Windows监督进程未报告目标终态：code=${code ?? "null"} signal=${signal ?? "null"}`,
            {stage: "supervisor-close"},
        ));
    });

    sendControl({
        kind: "start",
        command: spec.command,
        args: spec.args ?? [],
        cwd: spec.cwd,
        env: spec.env,
        stdin: spec.stdin ?? "ignore",
        windowsHide: spec.windowsHide ?? true,
        graceMs,
    });

    return {
        stdin: supervisor.stdin ?? undefined,
        stdout: supervisor.stdout ?? undefined,
        stderr: supervisor.stderr ?? undefined,
        completion,
        terminate(reason) {
            if (terminationPromise) return terminationPromise;
            if (settled) return completion;
            terminationReason = reason;
            terminationPromise = completion;
            armWatchdog(
                `Windows自有进程终止未在窗口内完成：reason=${reason}`,
                graceMs + hardKillWaitMs,
            );
            sendControl({kind: "terminate", reason});
            return terminationPromise;
        },
    };

    /** 校验监督协议，拒绝静默接受未知字段形状。 */
    function parseSupervisorMessage(value: unknown): SupervisorMessage {
        if (!value || typeof value !== "object" || !("kind" in value)) {
            throw new OwnedProcessError("Windows监督状态缺少kind。", {stage: "protocol"});
        }
        const candidate = value as {
            kind?: unknown;
            rootPid?: unknown;
            exitCode?: unknown;
            signal?: unknown;
            reason?: unknown;
            stage?: unknown;
            message?: unknown;
            osError?: unknown;
        };
        if (candidate.kind === "ready" && typeof candidate.rootPid === "number") {
            return {kind: "ready", rootPid: candidate.rootPid};
        }
        if (candidate.kind === "complete"
            && (typeof candidate.exitCode === "number" || candidate.exitCode === null)
            && (typeof candidate.signal === "string" || candidate.signal === null)) {
            return {kind: "complete", exitCode: candidate.exitCode, signal: candidate.signal as NodeJS.Signals | null};
        }
        if (candidate.kind === "terminated"
            && (typeof candidate.exitCode === "number" || candidate.exitCode === null)
            && (typeof candidate.signal === "string" || candidate.signal === null)
            && isTerminationReason(candidate.reason)) {
            return {
                kind: "terminated",
                exitCode: candidate.exitCode,
                signal: candidate.signal as NodeJS.Signals | null,
                reason: candidate.reason,
            };
        }
        if (candidate.kind === "error"
            && typeof candidate.stage === "string"
            && typeof candidate.message === "string"
            && (candidate.osError === undefined || typeof candidate.osError === "number")) {
            return {
                kind: "error",
                stage: candidate.stage,
                message: candidate.message,
                ...(candidate.osError === undefined ? {} : {osError: candidate.osError}),
            };
        }
        throw new OwnedProcessError(`Windows监督状态字段无效：kind=${String(candidate.kind)}`, {stage: "protocol"});
    }

    /** 监督控制消息走独立IPC，不占用目标stdin/stdout/stderr。 */
    function sendControl(message: object): void {
        try {
            if (!supervisor.connected) {
                throw new Error("监督IPC已经断开。");
            }
            supervisor.send(message, (error) => {
                if (!error || settled) return;
                beginFailure(new OwnedProcessError("无法写入Windows监督控制消息。", {
                    stage: "control-ipc",
                    cause: error,
                }));
            });
        } catch (error) {
            beginFailure(new OwnedProcessError("无法写入Windows监督控制消息。", {stage: "control-ipc", cause: error}));
        }
    }

    /** 把监督状态映射为单一completion，最终仍等待监督进程close确认句柄收口。 */
    function handleSupervisorMessage(message: SupervisorMessage): void {
        if (message.kind === "error") {
            terminalError = terminalError ?? new OwnedProcessError(message.message, {
                stage: message.stage,
                osError: message.osError,
            });
            armWatchdog("Windows监督进程报告错误后未在窗口内退出。", hardKillWaitMs);
            return;
        }
        if (message.kind === "complete" || message.kind === "terminated") {
            terminalMessage = message;
            armWatchdog("Windows监督进程报告终态后未在窗口内退出。", hardKillWaitMs);
        }
    }

    /** 父侧协议/IPC失败时请求监督器收口Job，最终错误仍等待close后提交。 */
    function beginFailure(error: unknown): void {
        if (settled) return;
        terminalError = terminalError ?? error;
        armWatchdog("Windows监督进程失败后未在窗口内退出。", graceMs + hardKillWaitMs);
        if (supervisor.connected) supervisor.disconnect();
    }

    /** 同一个lease只保留一个有界completion watchdog。 */
    function armWatchdog(message: string, waitMs: number): void {
        if (watchdog || settled) return;
        watchdog = setTimeout(() => rejectOnce(new OwnedProcessError(message, {
            stage: "hard-kill-wait",
            cause: terminalError,
        })), waitMs);
    }

    /** 成功终态只允许提交一次。 */
    function settle(value: OwnedProcessCompletion): void {
        if (settled) return;
        settled = true;
        cleanup();
        resolveCompletion(value);
    }

    /** 失败终态只允许提交一次，并主动断开监督器以触发KILL_ON_JOB_CLOSE。 */
    function rejectOnce(error: unknown): void {
        if (settled) return;
        settled = true;
        cleanup();
        rejectCompletion(error);
    }

    /** 清理父侧timer与IPC监听；目标stdio由调用方按需继续消费到close。 */
    function cleanup(): void {
        if (watchdog) clearTimeout(watchdog);
        supervisor.removeAllListeners("message");
        if (supervisor.connected) supervisor.disconnect();
    }
}

/** 严格限制监督器可回传的终止原因。 */
function isTerminationReason(value: unknown): value is OwnedProcessTerminationReason {
    return value === "timeout"
        || value === "abort"
        || value === "cancel"
        || value === "shutdown"
        || value === "startup-failure"
        || value === "host-disconnect";
}

/** 拒绝负数和非有限生命周期窗口。 */
function validWindow(value: number | undefined, fallback: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${field}必须是非负有限数。`);
    return resolved;
}
