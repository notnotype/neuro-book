export type WindowsSupervisorFault = "invalid-terminate-handle";

/**
 * 生成Windows监督进程源码。fault只供包内Windows回归使用，不进入Owned Process公共Interface。
 */
export function buildWindowsSupervisorSource(fault?: WindowsSupervisorFault): string {
    const invalidTerminateHandle = fault === "invalid-terminate-handle";
    return String.raw`
import {spawn} from "node:child_process";
import {dlopen, FFIType, ptr} from "bun:ffi";

const INVALID_TERMINATE_HANDLE = ${invalidTerminateHandle};
const status = (value) => {
    try {
        process.send?.(value);
    } catch {
        // 非终态状态允许丢失；终态统一由reportThen执行有界发送。
    }
};

/** 在IPC确认或100ms备用窗口后执行最终句柄动作，避免状态消息与Job关闭竞态。 */
function reportThen(value, action) {
    let completed = false;
    const finish = () => {
        if (completed) return;
        completed = true;
        clearTimeout(fallback);
        action();
    };
    const fallback = setTimeout(finish, 100);
    if (!process.connected || !process.send) {
        finish();
        return;
    }
    try {
        process.send(value, () => finish());
    } catch {
        finish();
    }
}

/** 报告初始化失败后退出；此时不存在受管目标。 */
function fail(stage, message, osError) {
    reportThen({kind: "error", stage, message, ...(osError === undefined ? {} : {osError})}, () => {
        process.disconnect?.();
        setImmediate(() => process.exit(1));
    });
}

/** 报告终态后关闭唯一Job handle；KILL_ON_JOB_CLOSE负责收口剩余后代。 */
function closeJobAfterReport(job, kernel32, value, exitCode) {
    reportThen(value, () => {
        kernel32.symbols.CloseHandle(job);
        process.disconnect?.();
        setImmediate(() => process.exit(exitCode));
    });
}

if (process.arch !== "x64") {
    fail("platform", "Windows Job Object FFI当前只支持x64 ABI");
} else {
    const kernel32 = dlopen("kernel32.dll", {
        CreateJobObjectW: {args: [FFIType.pointer, FFIType.pointer], returns: FFIType.pointer},
        GetCurrentProcess: {args: [], returns: FFIType.pointer},
        AssignProcessToJobObject: {args: [FFIType.pointer, FFIType.pointer], returns: FFIType.bool},
        SetInformationJobObject: {args: [FFIType.pointer, FFIType.u32, FFIType.pointer, FFIType.u32], returns: FFIType.bool},
        TerminateJobObject: {args: [FFIType.pointer, FFIType.u32], returns: FFIType.bool},
        CloseHandle: {args: [FFIType.pointer], returns: FFIType.bool},
        GetLastError: {args: [], returns: FFIType.u32},
    });
    const job = kernel32.symbols.CreateJobObjectW(null, null);
    if (!job) {
        fail("create-job", "CreateJobObjectW失败", kernel32.symbols.GetLastError());
    } else if (!kernel32.symbols.AssignProcessToJobObject(job, kernel32.symbols.GetCurrentProcess())) {
        const osError = kernel32.symbols.GetLastError();
        closeJobAfterReport(job, kernel32, {kind: "error", stage: "assign-supervisor", message: "AssignProcessToJobObject失败", osError}, 1);
    } else {
        const limits = Buffer.alloc(144);
        limits.writeUInt32LE(0x00002000, 16);
        if (!kernel32.symbols.SetInformationJobObject(job, 9, ptr(limits), limits.byteLength)) {
            const osError = kernel32.symbols.GetLastError();
            closeJobAfterReport(job, kernel32, {kind: "error", stage: "configure-job", message: "SetInformationJobObject失败", osError}, 1);
        } else {
            run(job, kernel32);
        }
    }
}

function run(job, kernel32) {
    let child;
    let payload;
    let terminationReason;
    let hardTimer;
    let normalCleanupTimer;
    let finished = false;

    process.on("message", (message) => {
        if (!payload) {
            start(message);
            return;
        }
        if (message.kind === "terminate") terminate(message.reason);
    });
    process.on("disconnect", () => {
        if (!finished) hardTerminate("host-disconnect");
    });

    function start(message) {
        if (message.kind !== "start") {
            finishError("protocol", "监督协议首条消息必须是start");
            return;
        }
        payload = message;
        try {
            child = spawn(payload.command, payload.args, {
                cwd: payload.cwd,
                env: payload.env,
                // Product stdout/stderr 是 Supervisor 协议的边界；ignore 必须显式传给目标。
                // pipe/inherit 都继承 Supervisor 自己的 fd，由 Adapter 负责连接到宿主。
                stdio: [payload.stdin === "pipe" ? "pipe" : 0, outputStdio(payload.stdout), outputStdio(payload.stderr)],
                windowsHide: payload.windowsHide,
            });
            if (payload.stdin === "pipe") {
                process.stdin.on("data", (chunk) => child.stdin?.write(chunk));
                process.stdin.on("end", () => child.stdin?.end());
            }
        } catch (error) {
            finishError("target-spawn", String(error));
            return;
        }
        child.once("spawn", () => status({kind: "ready", rootPid: child.pid}));
        child.once("error", (error) => finishError("target-spawn", error.message));
        child.once("exit", (exitCode, signal) => {
            // root退出后仍可能有后台后代持有stdio；给输出短暂收口窗口，随后关闭Job清理逃逸后代。
            normalCleanupTimer = setTimeout(() => finish({
                kind: terminationReason ? "terminated" : "complete",
                exitCode,
                signal,
                ...(terminationReason ? {reason: terminationReason} : {}),
            }), payload.graceMs);
        });
        child.once("close", (exitCode, signal) => finish({
            kind: terminationReason ? "terminated" : "complete",
            exitCode,
            signal,
            ...(terminationReason ? {reason: terminationReason} : {}),
        }));
    }

    function outputStdio(value) {
        return value === "ignore" ? "ignore" : "inherit";
    }

    function terminate(reason) {
        if (finished || terminationReason) return;
        terminationReason = reason;
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        if (!INVALID_TERMINATE_HANDLE) child.kill("SIGTERM");
        hardTimer = setTimeout(() => hardTerminate(reason), payload.graceMs);
    }

    function hardTerminate(reason) {
        if (finished) return;
        terminationReason = terminationReason ?? reason;
        clearLifecycleTimers();
        const terminateHandle = INVALID_TERMINATE_HANDLE ? null : job;
        if (kernel32.symbols.TerminateJobObject(terminateHandle, 137)) {
            // supervisor自身属于Job；成功后由内核结束整个Job，父侧通过close和已固定reason提交终态。
            finished = true;
            return;
        }
        finishError("terminate-job", "TerminateJobObject失败", kernel32.symbols.GetLastError());
    }

    function finish(value) {
        if (finished) return;
        finished = true;
        clearLifecycleTimers();
        closeJobAfterReport(job, kernel32, value, 0);
    }

    function finishError(stage, message, osError) {
        if (finished) return;
        finished = true;
        clearLifecycleTimers();
        closeJobAfterReport(job, kernel32, {
            kind: "error",
            stage,
            message,
            ...(osError === undefined ? {} : {osError}),
        }, 1);
    }

    function clearLifecycleTimers() {
        if (hardTimer) clearTimeout(hardTimer);
        if (normalCleanupTimer) clearTimeout(normalCleanupTimer);
    }
}
`;
}

/** Windows监督进程默认生产源码。 */
export const WINDOWS_SUPERVISOR_SOURCE = buildWindowsSupervisorSource();
