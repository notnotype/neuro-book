import {spawn} from "node:child_process";

import {POSIX_SUPERVISOR_SOURCE} from "#owned-process/posix-supervisor-source";
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
    | {kind: "error"; stage: string; message: string};

type PosixAdapterOptions = {
    /** 仅供包内监督协议故障回归覆盖，公共 spawnOwnedProcess 不暴露。 */
    supervisorSource?: string;
};

/** POSIX Adapter 通过监督进程持有独立 process group，并在宿主 IPC 断开时收口。 */
export function spawnPosixOwnedProcess(spec: OwnedProcessSpec, options: PosixAdapterOptions = {}): OwnedProcessLease {
    const graceMs = validWindow(spec.graceMs, 500, "graceMs");
    const hardKillWaitMs = validWindow(spec.hardKillWaitMs, 3_000, "hardKillWaitMs");
    const supervisor = spawn(process.execPath, ["-e", options.supervisorSource ?? POSIX_SUPERVISOR_SOURCE], {
        cwd: spec.cwd,
        // 监督器必须使用宿主环境；目标 env 只通过 IPC 传递。
        env: process.env,
        stdio: [spec.stdin === "inherit" ? 0 : spec.stdin === "pipe" ? "pipe" : "ignore", spec.stdout ?? "pipe", spec.stderr ?? "pipe", "ipc"],
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
        `无法启动POSIX自有进程监督器：${error.message}`,
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
        if (signal) {
            settle({exitCode: code, signal, terminationReason: "cancel"});
            return;
        }
        rejectOnce(new OwnedProcessError(
            `POSIX监督进程未报告目标终态：code=${code ?? "null"} signal=${signal ?? "null"}`,
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
        stdout: spec.stdout ?? "pipe",
        stderr: spec.stderr ?? "pipe",
        graceMs,
        hardKillWaitMs,
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
            armWatchdog(`POSIX自有进程终止未在窗口内完成：reason=${reason}`, graceMs + hardKillWaitMs + 250);
            sendControl({kind: "terminate", reason});
            return terminationPromise;
        },
    };

    /** 严格校验监督器回传的状态。 */
    function parseSupervisorMessage(value: unknown): SupervisorMessage {
        if (!value || typeof value !== "object" || !("kind" in value)) {
            throw new OwnedProcessError("POSIX监督状态缺少kind。", {stage: "protocol"});
        }
        const candidate = value as {
            kind?: unknown;
            rootPid?: unknown;
            exitCode?: unknown;
            signal?: unknown;
            reason?: unknown;
            stage?: unknown;
            message?: unknown;
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
            && typeof candidate.message === "string") {
            return {kind: "error", stage: candidate.stage, message: candidate.message};
        }
        throw new OwnedProcessError(`POSIX监督状态字段无效：kind=${String(candidate.kind)}`, {stage: "protocol"});
    }

    /** 监督控制消息走独立 IPC，不占用目标 stdio。 */
    function sendControl(message: object): void {
        try {
            if (!supervisor.connected) throw new Error("监督IPC已经断开。");
            supervisor.send(message, (error) => {
                if (!error || settled) return;
                beginFailure(new OwnedProcessError("无法写入POSIX监督控制消息。", {
                    stage: "control-ipc",
                    cause: error,
                }));
            });
        } catch (error) {
            beginFailure(new OwnedProcessError("无法写入POSIX监督控制消息。", {stage: "control-ipc", cause: error}));
        }
    }

    /** 目标终态和结构化错误最终都等待 supervisor close。 */
    function handleSupervisorMessage(message: SupervisorMessage): void {
        if (message.kind === "error") {
            terminalError = terminalError ?? new OwnedProcessError(message.message, {stage: message.stage});
            armWatchdog("POSIX监督进程报告错误后未在窗口内退出。", hardKillWaitMs + 250);
            return;
        }
        if (message.kind === "complete" || message.kind === "terminated") {
            terminalMessage = message;
            armWatchdog("POSIX监督进程报告终态后未在窗口内退出。", hardKillWaitMs + 250);
        }
    }

    /** 父侧协议或 IPC 失败时断开监督器，由 supervisor 以 host-disconnect 收口。 */
    function beginFailure(error: unknown): void {
        if (settled) return;
        terminalError = terminalError ?? error;
        armWatchdog("POSIX监督进程失败后未在窗口内退出。", graceMs + hardKillWaitMs + 250);
        if (supervisor.connected) supervisor.disconnect();
    }

    function armWatchdog(message: string, waitMs: number): void {
        if (watchdog || settled) return;
        watchdog = setTimeout(() => rejectOnce(new OwnedProcessError(message, {
            stage: "hard-kill-wait",
            cause: terminalError,
        })), waitMs);
    }

    function settle(value: OwnedProcessCompletion): void {
        if (settled) return;
        settled = true;
        cleanup();
        resolveCompletion(value);
    }

    function rejectOnce(error: unknown): void {
        if (settled) return;
        settled = true;
        cleanup();
        rejectCompletion(error);
    }

    function cleanup(): void {
        if (watchdog) clearTimeout(watchdog);
        supervisor.removeAllListeners("message");
        if (supervisor.connected) supervisor.disconnect();
    }
}

function isTerminationReason(value: unknown): value is OwnedProcessTerminationReason {
    return value === "timeout"
        || value === "abort"
        || value === "cancel"
        || value === "shutdown"
        || value === "startup-failure"
        || value === "host-disconnect";
}

function validWindow(value: number | undefined, fallback: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${field}必须是非负有限数。`);
    return resolved;
}
