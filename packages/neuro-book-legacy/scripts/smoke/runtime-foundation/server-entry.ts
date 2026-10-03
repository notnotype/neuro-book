/**
 * 后端 smoke 的子进程入口：在一个真实 Node 进程里用 ServerRuntimeHost 装配受控清单，
 * 以 JSON 行向 stdout 报告事件，等待合作停止（POSIX 信号或 stdin 的 `stop` 行，后者供 Windows
 * 使用），停止结算后自然退出。本进程不监听端口、不杀任何进程、不写仓库数据。
 *
 * 用法：node --import tsx scripts/smoke/runtime-foundation/server-entry.ts [--fail-required] [--fail-optional]
 *       [--hang-release --stop-timeout-ms=<n>]
 * `--hang-release` 让 presence 释放永不结算，配合 `--stop-timeout-ms` 验证宿主有界停止：停止结算为
 * `incomplete(deadline)`，进程以退出码 3 结束，而不是被挂起的释放拖住。
 */

import {createInterface} from "node:readline";
import {parseArgs} from "node:util";

import {ServerRuntimeHost} from "../../../server/runtime/foundation/server-host";
import type {EmergencyReport} from "../../../runtime/application/application";

import {clockKey, createCommandTable, createControlledManifest, presenceKey} from "./controlled-manifest";
import type {Clock, Presence} from "./controlled-manifest";

function emit(event: string, detail: Record<string, unknown> = {}): void {
    process.stdout.write(`${JSON.stringify({event, ...detail})}\n`);
}

const {values: flags} = parseArgs({
    options: {
        "fail-required": {type: "boolean", default: false},
        "fail-optional": {type: "boolean", default: false},
        "hang-release": {type: "boolean", default: false},
        "stop-timeout-ms": {type: "string"},
    },
});
const failRequired = flags["fail-required"];
const failOptional = flags["fail-optional"];
const hangRelease = flags["hang-release"];
const stopTimeoutMs = flags["stop-timeout-ms"] === undefined ? undefined : Number(flags["stop-timeout-ms"]);
const emergencies: EmergencyReport[] = [];
const commands = createCommandTable();
let presenceReleases = 0;
const manifest = createControlledManifest({
    location: "server",
    commands,
    failRequired,
    failOptional,
    clock: {
        id: "process-clock",
        key: clockKey,
        create: (): Clock => ({now: () => Math.round(performance.now())}),
    },
    presence: {
        id: "process-presence",
        key: presenceKey,
        create: (): Presence => ({id: `pid-${process.pid}`}),
        release: () => {
            presenceReleases += 1;
            // 永不结算的释放：只有宿主截止能让停止结算。
            return hangRelease ? new Promise<void>(() => undefined) : undefined;
        },
    },
});

const runtime = new ServerRuntimeHost();
const options = {
    instanceId: `server-${process.pid}`,
    manifest,
    stopTimeoutMs,
    emergency: (report: EmergencyReport) => {
        emergencies.push(report);
        emit("emergency", {report});
    },
};
const host = runtime.start(options);
const again = runtime.start(options);
emit("started", {instanceId: host.application.identity.instanceId, shared: again === host, phase: host.application.root.phase});

// Windows 上外部进程无法合作发送 SIGTERM：stdin 的 `stop` 行是同一停止通道的另一个来源。
const stdin = createInterface({input: process.stdin});
stdin.on("line", (line) => {
    if (line.trim() === "stop") {
        host.requestStop("stdin:stop");
    }
});

const startup = await host.application.startup;
emit("startup", {
    status: startup.status,
    gates: startup.gates,
    failures: startup.failures,
    admission: host.application.status().admission,
    stop: startup.status === "available" ? null : startup.stop,
});

if (startup.status === "available") {
    const admitted = await host.application.admit({label: "greet", run: () => commands.run("greeter.greet", "smoke")});
    const outcome = admitted.status === "accepted" ? await admitted.operation.outcome : null;
    emit("ready", {
        admitted: admitted.status,
        outcome,
        flaky: commands.run("flaky.run", ""),
        catalog: host.application.plugins.catalog().plugins.map((plugin) => ({id: plugin.id, entries: plugin.entries.map((entry) => entry.state.status)})),
    });
    // 等待宿主的合作停止（信号或 stdin），不由本进程自行发起。
    const stopSignal = host.application.root.stopSignal;
    if (!stopSignal.aborted) {
        await new Promise<void>((resolve) => stopSignal.addEventListener("abort", () => resolve(), {once: true}));
    }
    const stop = await host.application.stop();
    const late = await host.application.admit({label: "late", run: () => "late"});
    emit("stopped", {
        stop,
        source: host.stopSource,
        detached: host.detached,
        late: late.status === "rejected" ? late.reason : late.status,
        greetAfterStop: commands.run("greeter.greet", "late"),
        revocations: commands.revocations,
        presenceReleases,
        emergencies: emergencies.length,
    });
    process.exitCode = stop.status === "closed" ? 0 : 3;
} else {
    emit("stopped", {stop: startup.stop, source: host.stopSource, detached: host.detached, presenceReleases, emergencies: emergencies.length});
    process.exitCode = 2;
}
stdin.close();
process.stdin.pause();
