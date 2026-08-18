export type PosixSupervisorFault = "signal" | "probe" | "probe-permission";

/** 生成 POSIX 监督进程源码；fault 只供包内故障回归使用。 */
export function buildPosixSupervisorSource(fault?: PosixSupervisorFault): string {
    return String.raw`
const {spawn} = require("node:child_process");

const SIGNAL_FAULT = ${fault === "signal"};
const PROBE_FAULT = ${fault === "probe"};
let probePermissionPending = ${fault === "probe-permission"};
let child;
let payload;
let terminationReason;
let closeResult;
let cleanupStarted = false;
let finished = false;
let hardTimer;
let pollTimer;
let waitTimer;

process.on("message", (message) => {
    if (!payload) {
        start(message);
        return;
    }
    if (message?.kind === "terminate") terminate(message.reason);
});
process.on("disconnect", () => {
    if (!finished) terminate("host-disconnect");
});
process.on("SIGINT", () => {
    if (payload && !finished) terminate("cancel");
});
process.on("SIGTERM", () => {
    if (payload && !finished) terminate("cancel");
});

/** 目标以独立 process group 启动，监督器只转发 stdio 与终态。 */
function start(message) {
    if (!message || message.kind !== "start" || typeof message.command !== "string") {
        finishError("protocol", "POSIX监督协议首条消息必须是start");
        return;
    }
    payload = message;
    try {
        child = spawn(payload.command, Array.isArray(payload.args) ? payload.args : [], {
            cwd: payload.cwd,
            env: payload.env,
            detached: true,
            // Product stdout/stderr 是 Supervisor 协议的边界；ignore 必须显式传给目标。
            // pipe/inherit 都继承 Supervisor 自己的 fd，由 Adapter 负责连接到宿主。
            stdio: [payload.stdin === "pipe" ? "pipe" : 0, outputStdio(payload.stdout), outputStdio(payload.stderr)],
        });
        if (payload.stdin === "pipe") {
            process.stdin.on("data", (chunk) => child.stdin?.write(chunk));
            process.stdin.on("end", () => child.stdin?.end());
        }
    } catch (error) {
        finishError("spawn", error instanceof Error ? error.message : String(error));
        return;
    }
    child.once("spawn", () => status({kind: "ready", rootPid: child.pid}));
    child.once("error", (error) => finishError("spawn", error.message));
    child.once("exit", () => beginCleanup());
    child.once("close", (exitCode, signal) => {
        closeResult = {exitCode, signal};
        beginCleanup();
        settleIfClosed();
    });
}

function outputStdio(value) {
    return value === "ignore" ? "ignore" : "inherit";
}

/** 主动终止与宿主断连共用同一进程组收口。 */
function terminate(reason) {
    if (finished) return;
    terminationReason = terminationReason ?? reason;
    if (!child) {
        finish({kind: "terminated", exitCode: null, signal: null, reason: terminationReason}, 0);
        return;
    }
    beginCleanup();
}

/** TERM 后升级 KILL，并持续证明整个 process group 已消失。 */
function beginCleanup() {
    if (cleanupStarted || finished || !child) return;
    cleanupStarted = true;
    try {
        signalGroup(child.pid, "SIGTERM");
    } catch (error) {
        finishError("process-group-signal", error instanceof Error ? error.message : String(error));
        return;
    }
    hardTimer = setTimeout(() => {
        try {
            signalGroup(child.pid, "SIGKILL");
        } catch (error) {
            finishError("process-group-signal", error instanceof Error ? error.message : String(error));
        }
    }, payload.graceMs);
    pollTimer = setInterval(settleIfClosed, 25);
    waitTimer = setTimeout(() => finishError(
        "hard-kill-wait",
        "强制终止后仍未确认POSIX进程组收口",
    ), payload.graceMs + payload.hardKillWaitMs);
}

/** 只有根进程 close 且整个 process group 消失后才报告终态。 */
function settleIfClosed() {
    if (finished || !closeResult) return;
    try {
        if (groupExists(child?.pid)) return;
    } catch (error) {
        finishError("process-group-probe", error instanceof Error ? error.message : String(error));
        return;
    }
    finish(terminationReason
        ? {kind: "terminated", ...closeResult, reason: terminationReason}
        : {kind: "complete", ...closeResult}, 0);
}

/** 报告错误后退出；目标若已建立，宿主 Operation 必须 fail closed。 */
function finishError(stage, message) {
    finish({kind: "error", stage, message}, 1);
}

/** 有界发送终态，然后关闭 IPC 和监督进程。 */
function finish(value, exitCode) {
    if (finished) return;
    finished = true;
    clearTimers();
    let reported = false;
    const exit = () => {
        if (reported) return;
        reported = true;
        process.disconnect?.();
        setImmediate(() => process.exit(exitCode));
    };
    const fallback = setTimeout(exit, 100);
    try {
        if (!process.connected || !process.send) {
            clearTimeout(fallback);
            exit();
            return;
        }
        process.send(value, () => {
            clearTimeout(fallback);
            exit();
        });
    } catch {
        clearTimeout(fallback);
        exit();
    }
}

/** 非终态消息允许在宿主已退出时丢失。 */
function status(value) {
    try {
        process.send?.(value);
    } catch {
        // 宿主断连会进入统一 cleanup。
    }
}

function clearTimers() {
    if (hardTimer) clearTimeout(hardTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (waitTimer) clearTimeout(waitTimer);
}

function groupExists(pid) {
    if (!pid) return false;
    try {
        if (PROBE_FAULT) throw Object.assign(new Error("unexpected probe failure"), {code: "EIO"});
        if (probePermissionPending) {
            probePermissionPending = false;
            throw Object.assign(new Error("operation not permitted"), {code: "EPERM"});
        }
        process.kill(-pid, 0);
        return true;
    } catch (error) {
        if (error?.code === "ESRCH") return false;
        // kill(2) 的 EPERM 仍证明目标进程组存在；继续等待，不能提前提交终态。
        if (error?.code === "EPERM") return true;
        throw error;
    }
}

function signalGroup(pid, signal) {
    if (!pid) return;
    if (SIGNAL_FAULT && signal === "SIGTERM") {
        throw Object.assign(new Error("operation not permitted"), {code: "EPERM"});
    }
    try {
        process.kill(-pid, signal);
    } catch (error) {
        if (error?.code !== "ESRCH") throw error;
    }
}
`;
}

export const POSIX_SUPERVISOR_SOURCE = buildPosixSupervisorSource();
