/**
 * 第二切片组合 smoke 的子进程入口：在一个真实 Node 进程里用 ServerRuntimeHost 装配三个内置服务插件
 * 与两个受信消费者，以 JSON 行向 stdout 报告事件，等待合作停止（POSIX 信号或 stdin 的 `stop` 行）。
 *
 * 用法：node --import tsx scripts/smoke/runtime-foundation/services-entry.ts --scratch <dir> --phase write|read
 *       [--omit nbook.diagnostics|nbook.platform-files|nbook.sqlite]... [--hold-handle]
 * `--omit` 移除一个必需提供者，验证启动明确失败且无数据副作用（退出码 2）；`--hold-handle` 让宿主在比提供者
 * 更长寿的根作用域上持有一个 watch 句柄，验证停止报告未完成而不是假 closed，释放后显式恢复才 closed。
 * 本进程只写 `--scratch` 下的 logs/data/db 三个位置，不监听端口、不杀进程、不写仓库数据。
 */

import path from "node:path";
import {createInterface} from "node:readline";
import {parseArgs} from "node:util";

import type {StopResult} from "../../../runtime/application/application";
import {createDiagnosticsStore, recordingEmergency} from "../../../runtime/diagnostics/diagnostics";
import {isPlatformFilesError} from "../../../server/features/platform-files/platform-files";
import type {WatchHandle} from "../../../server/features/platform-files/platform-files";
import {ServerRuntimeHost} from "../../../server/runtime/foundation/server-host";

import {NOTES_FILE, SERVICE_PLUGIN_IDS} from "./services-fixture";
import type {ServicePluginId} from "./services-fixture";
import {createServicesManifest} from "./services-manifest";
import type {ServicesBox, ServicesPhase} from "./services-manifest";

function emit(event: string, detail: Record<string, unknown> = {}): void {
    process.stdout.write(`${JSON.stringify({event, ...detail}, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))}\n`);
}

const {values: flags} = parseArgs({
    options: {
        scratch: {type: "string"},
        phase: {type: "string"},
        omit: {type: "string", multiple: true, default: []},
        "hold-handle": {type: "boolean", default: false},
    },
});
const scratch = flags.scratch;
const phase = flags.phase;
if (scratch === undefined || (phase !== "write" && phase !== "read")) {
    throw new Error("用法：services-entry.ts --scratch <dir> --phase write|read [--omit <plugin>]... [--hold-handle]");
}
const omit = new Set<ServicePluginId>();
for (const id of flags.omit) {
    if (!SERVICE_PLUGIN_IDS.includes(id as ServicePluginId)) {
        throw new Error(`未知插件：${id}`);
    }
    omit.add(id as ServicePluginId);
}

const instanceId = `services-${phase}-${process.pid}`;
const store = createDiagnosticsStore({identity: {location: "server", instanceId}});
const box: ServicesBox = {notes: null, audit: null};
const manifest = createServicesManifest({
    phase: phase as ServicesPhase,
    logDirectory: path.join(scratch, "logs"),
    dataRoot: path.join(scratch, "data"),
    databaseDirectory: path.join(scratch, "db"),
    store,
    omit,
    box,
});

const host = new ServerRuntimeHost().start({
    instanceId,
    manifest,
    // 紧急报告先进入诊断缓冲（出口已挂接时同时落盘），再到宿主的最小输出。
    emergency: recordingEmergency(store, (report) => emit("emergency", {report})),
});
const stdin = createInterface({input: process.stdin});
stdin.on("line", (line) => {
    if (line.trim() === "stop") {
        host.requestStop("stdin:stop");
    }
});

const startup = await host.application.startup;
emit("startup", {
    instanceId,
    status: startup.status,
    gates: startup.gates,
    failures: startup.failures,
    admission: host.application.status().admission,
    stop: startup.status === "available" ? null : startup.stop,
    diagnostics: store.status(),
});

if (startup.status === "available") {
    const notes = box.notes;
    if (notes === null) {
        throw new Error("notes 门禁通过但没有产出结果");
    }
    let held: WatchHandle | null = null;
    if (flags["hold-handle"]) {
        held = await notes.files.watch(notes.grant, "notes", {scope: host.application.root, onEvent: () => undefined});
    }
    emit("ready", {
        instanceId,
        notes: {phase: notes.phase, text: notes.text, rows: notes.rows},
        audit: box.audit,
        diagnostics: store.status(),
        query: notes.diagnostics.query({plugin: "notes"}).records.map((record) => record.event),
    });
    const stopSignal = host.application.root.stopSignal;
    if (!stopSignal.aborted) {
        await new Promise<void>((resolve) => stopSignal.addEventListener("abort", () => resolve(), {once: true}));
    }
    const stop = await host.application.stop();
    let probe: string | null = null;
    let recovered: StopResult | null = null;
    if (held !== null) {
        // 关闭未完成期间服务拒绝新操作：没有半可用句柄。
        probe = await notes.files.readText(notes.grant, NOTES_FILE).then(
            () => "completed",
            (error: unknown) => (isPlatformFilesError(error) ? error.code : String(error)),
        );
        await held.close();
        recovered = await host.application.recover();
    }
    const final = recovered ?? stop;
    emit("stopped", {instanceId, stop, probe, recovered, phase: host.application.status().phase, diagnostics: store.status()});
    process.exitCode = final.status === "closed" ? 0 : 3;
} else {
    emit("stopped", {instanceId, stop: startup.stop, phase: host.application.status().phase, diagnostics: store.status()});
    process.exitCode = 2;
}
stdin.close();
process.stdin.pause();
