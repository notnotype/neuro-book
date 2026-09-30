// 主线程卡死看门狗原型（worker 侧）。只读共享内存，不依赖主线程事件循环。
import {parentPort, workerData} from "node:worker_threads";
import {closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync} from "node:fs";
import {randomUUID} from "node:crypto";

const {
    ints: intsBuffer, times: timesBuffer, slotCount, slotInts, headerInts,
    thresholdMs, checkMs, pauseGapMs, reportPath, exitMethod, exitCode = 76, leaseLockPath, processStartedAt,
} = workerData;
const ints = new Int32Array(intsBuffer);
const times = new Float64Array(timesBuffer);
const strings = new Map();
const kinds = ["activate", "deactivate", "command", "export", "contribution", "channel-call", "channel-subscribe", "event"];

let lastBeat = Atomics.load(ints, 0);
let lastChange = performance.now();
let lastTick = lastChange;
let fired = false;
const stats = {checks: 0, wouldFire: 0, maxStallMs: 0, stallHistogram: {"<1s": 0, "1-2s": 0, "2-5s": 0, "5-10s": 0, ">=10s": 0}, pauses: 0, maxTickGapMs: 0};

parentPort.on("message", (message) => {
    if (message.type === "intern") strings.set(message.ref, message.value);
    else if (message.type === "stats") parentPort.postMessage(stats);
});

setInterval(check, checkMs);

function check() {
    const now = performance.now();
    const tickGap = now - lastTick;
    stats.maxTickGapMs = Math.max(stats.maxTickGapMs, Math.round(tickGap));
    lastTick = now;
    stats.checks++;
    if (tickGap > pauseGapMs) {
        // worker 自己也停了：整个进程被暂停（SIGSTOP、调试器、系统睡眠）或 CPU 严重饥饿，不能算主线程卡死
        stats.pauses++;
        lastChange = now;
        return;
    }
    const beat = Atomics.load(ints, 0);
    if (beat !== lastBeat) {
        if (exitMethod === "none") fired = false;
        recordStall(now - lastChange);
        lastBeat = beat;
        lastChange = now;
        return;
    }
    const stalledMs = now - lastChange;
    stats.maxStallMs = Math.max(stats.maxStallMs, Math.round(stalledMs));
    if (!fired && stalledMs >= thresholdMs) {
        fired = true;
        stats.wouldFire++;
        // exitMethod=none 只用于误报测量：记录但不结束进程，心跳恢复后重新布防
        if (exitMethod === "none") return;
        fire(stalledMs);
    }
}

function recordStall(ms) {
    const h = stats.stallHistogram;
    if (ms < 1000) h["<1s"]++;
    else if (ms < 2000) h["1-2s"]++;
    else if (ms < 5000) h["2-5s"]++;
    else if (ms < 10000) h["5-10s"]++;
    else h[">=10s"]++;
}

function readInflight(detectedAtMs) {
    const syncOwner = Atomics.load(ints, 2) - 1;
    const lastBeatAt = times[0];
    const calls = [];
    for (let slot = 0; slot < slotCount; slot++) {
        const base = headerInts + slot * slotInts;
        if (Atomics.load(ints, base) !== 1) continue;
        const startedAt = times[1 + slot];
        const [pluginId, pluginVersion] = splitPlugin(strings.get(ints[base + 1]) ?? "unknown@?");
        calls.push({
            pluginId,
            pluginVersion,
            generation: ints[base + 5],
            kind: kinds[ints[base + 2] - 1] ?? "unknown",
            target: strings.get(ints[base + 3]) ?? "unknown",
            callSeq: ints[base + 4],
            startedAt: new Date(startedAt).toISOString(),
            elapsedMs: Math.round(detectedAtMs - startedAt),
            // 卡死开始于最近一次心跳之后；在此之后才开始的调用最可能是卡住主线程的那一个
            startedAfterLastHeartbeat: startedAt >= lastBeatAt,
            holdsMainThread: slot === syncOwner,
        });
    }
    calls.sort((a, b) => b.elapsedMs - a.elapsedMs);
    return {calls, syncOwner};
}

function splitPlugin(value) {
    const at = value.lastIndexOf("@");
    return at > 0 ? [value.slice(0, at), value.slice(at + 1)] : [value, "?"];
}

function fire(stalledMs) {
    const detectedAtMs = Date.now();
    const {calls} = readInflight(detectedAtMs);
    const direct = calls.find((c) => c.holdsMainThread);
    const recent = [...new Set(calls.filter((c) => c.startedAfterLastHeartbeat).map((c) => c.pluginId))];
    const all = [...new Set(calls.map((c) => c.pluginId))];
    const report = {
        schema: "nbook.main-thread-hang-report/v1",
        reportId: randomUUID(),
        pid: process.pid,
        runtime: process.versions.bun ? "bun" : "node",
        runtimeVersion: process.versions.bun ?? process.versions.node,
        platform: process.platform,
        arch: process.arch,
        processStartedAt,
        detectedAt: new Date(detectedAtMs).toISOString(),
        lastHeartbeatAt: new Date(times[0]).toISOString(),
        stalledMs: Math.round(stalledMs),
        thresholdMs,
        hostPhase: strings.get(Atomics.load(ints, 1)) ?? null,
        suspects: direct
            ? {confidence: "direct", pluginIds: [direct.pluginId]}
            : recent.length
                ? {confidence: "candidate", pluginIds: recent}
                : {confidence: all.length ? "weak" : "unknown", pluginIds: all},
        inflight: calls,
        inflightOverflow: Atomics.load(ints, 3),
        rssBytes: process.memoryUsage.rss(),
        action: {exitMethod, exitCode: exitMethod === "ffi-exit" ? exitCode : null, leaseLockReleased: false},
    };
    if (leaseLockPath) {
        try {
            rmSync(leaseLockPath, {recursive: true, force: true});
            report.action.leaseLockReleased = true;
        } catch (error) {
            report.action.leaseLockError = String(error);
        }
    }
    writeReportDurably(report);
    terminateProcess();
}

function writeReportDurably(report) {
    const tmp = `${reportPath}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w");
    writeSync(fd, `${JSON.stringify(report, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, reportPath);
}

// 退出手段在 worker 启动时就准备好：卡死发生时不再加载模块
const ffi = process.versions.bun && exitMethod === "ffi-exit" ? await import("bun:ffi") : null;
const exitSyscall = ffi
    ? process.platform === "win32"
        ? (() => {
            // 未实测：Windows 上的等价做法是 kernel32 TerminateProcess(GetCurrentProcess(), code)。
            // Bun FFI 文档要求 HANDLE 用 u64 表示（伪句柄 -1 不是有效地址）。
            const k = ffi.dlopen("kernel32.dll", {
                GetCurrentProcess: {args: [], returns: ffi.FFIType.u64},
                TerminateProcess: {args: [ffi.FFIType.u64, ffi.FFIType.u32], returns: ffi.FFIType.bool},
            });
            return (code) => k.symbols.TerminateProcess(k.symbols.GetCurrentProcess(), code);
        })()
        : (() => {
            const libc = ffi.dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", {
                _exit: {args: [ffi.FFIType.i32], returns: ffi.FFIType.void},
            });
            return (code) => libc.symbols._exit(code);
        })()
    : null;

function terminateProcess() {
    if (exitMethod === "sigkill") process.kill(process.pid, "SIGKILL");
    // worker 里的 process.exit 只结束 worker；只有系统调用级退出能带专用退出码结束整个进程
    else if (exitMethod === "ffi-exit") exitSyscall(exitCode);
}
