/**
 * runtime.diagnostics 的平台中立行为：有界记录与查询、脱敏、早期缓冲补写、降级兜底、收口与恢复，
 * 以及经真实 createApplication 装配的启动门禁失败记录。文件出口见 server/features/runtime-diagnostics。
 */

import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {describe, expect, it, vi} from "vitest";

import {createApplication} from "../application/application";
import type {ApplicationManifest, EmergencyReport} from "../application/application";
import type {PluginDefinition} from "../plugins/plugins";
import {defineServiceKey} from "../services/services";

import {
    DiagnosticsError,
    createDiagnosticsPlugin,
    createDiagnosticsStore,
    diagnosticsKey,
    mechanismObservers,
    recordingEmergency,
} from "./diagnostics";
import type {DiagnosticExporter, DiagnosticRecord, DiagnosticsDegraded, DiagnosticsStore} from "./diagnostics";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const identity = {location: "server", instanceId: "diag-1"} as const;

/** 内存出口：记录写入与关闭次数；可注入写失败与关闭失败。 */
function memoryExporter(options: {failWrite?: boolean; failClose?: () => boolean} = {}) {
    const written: DiagnosticRecord[] = [];
    let closes = 0;
    const exporter: DiagnosticExporter = {
        kind: "memory",
        write: (record) => {
            if (options.failWrite) {
                throw new Error("disk full");
            }
            written.push(record);
        },
        close: async () => {
            closes += 1;
            if (options.failClose?.()) {
                throw new Error("flush failed");
            }
        },
    };
    return {exporter, written, closes: () => closes};
}

async function attached(store: DiagnosticsStore, exporter: DiagnosticExporter, fallback = vi.fn()) {
    await store.attach({outcome: {status: "open", exporter}, fallback});
    return fallback;
}

describe("runtime.diagnostics 模块边界", () => {
    it("实现只导入同目录与 runtime 机制入口，不引用框架、进程、DOM、文件或网络", async () => {
        const sources = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
            for (const specifier of specifiers) {
                expect(specifier, `${name} 导入了 ${specifier}`).toMatch(/^(?:\.\/[^/]+|\.\.\/(?:lifecycle\/lifecycle|services\/services|plugins\/plugins|application\/application))$/u);
            }
            expect(code, `${name} 不得引用 process/window/fetch`).not.toMatch(/\b(?:process|window|document)\.|\bfetch\(/u);
        }
    });
});

describe("记录、查询与预算", () => {
    it("提供者写入位置与实例身份，调用方不能覆盖；按级别与来源过滤；limit 取最近 N 条并报告截断", () => {
        const store = createDiagnosticsStore({identity});
        store.record({level: "debug", event: "a", message: "1", source: {plugin: "p1"}});
        store.record({level: "warn", event: "b", message: "2", source: {plugin: "p2", scopeId: "s"}});
        const forged = store.record({level: "error", event: "b", message: "3", source: {plugin: "p2", instanceId: "evil", location: "browser"} as never});
        expect(forged).toEqual({status: "accepted", sequence: 3});
        const all = store.query();
        expect(all.records.map((record) => record.origin.instanceId)).toEqual(["diag-1", "diag-1", "diag-1"]);
        expect(all.records[2].origin.location).toBe("server");
        expect(all.records[0].origin.scopeId).toBeNull();
        expect(store.query({minLevel: "warn"}).records.map((record) => record.message)).toEqual(["2", "3"]);
        expect(store.query({levels: ["debug", "error"], minLevel: "warn"}).records.map((record) => record.message)).toEqual(["3"]);
        expect(store.query({plugin: "p2", scopeId: "s"}).records.map((record) => record.message)).toEqual(["2"]);
        expect(store.query({event: "b", limit: 1})).toMatchObject({records: [{message: "3"}], truncatedByLimit: true});
        expect(() => store.query({limit: 0})).toThrow(TypeError);
        expect(() => store.query({minLevel: "loud" as never})).toThrow(TypeError);
    });

    it("非法输入被拒绝且不消耗序号，也不抛；恶意 getter 同样按非法处理", () => {
        const store = createDiagnosticsStore({identity});
        expect(store.record({level: "loud" as never, event: "x", message: "m"})).toEqual({status: "rejected", reason: "invalid-input"});
        expect(store.record({level: "info", event: "", message: "m"})).toEqual({status: "rejected", reason: "invalid-input"});
        const hostile = {level: "info", event: "x", message: "m", get source(): never {
            throw new Error("boom");
        }};
        expect(store.record(hostile as never)).toEqual({status: "rejected", reason: "invalid-input"});
        expect(store.record({level: "info", event: "x", message: "ok"})).toEqual({status: "accepted", sequence: 1});
    });

    it("超出记录预算淘汰最旧项并累计淘汰数；消息按预算截断；预算非法在装配期抛错", () => {
        const store = createDiagnosticsStore({identity, budget: {maxRecords: 2, maxMessageChars: 5}});
        for (const message of ["one", "two", "three-long-message"]) {
            store.record({level: "info", event: "e", message});
        }
        const result = store.query();
        expect(result.records.map((record) => record.sequence)).toEqual([2, 3]);
        expect(result.evicted).toBe(1);
        expect(result.records[1].message.startsWith("three")).toBe(true);
        expect(result.records[1].message).not.toContain("long-message");
        expect(store.status()).toMatchObject({budget: {maxRecords: 2, maxMessageChars: 5}, retained: 2, evicted: 1});
        expect(() => createDiagnosticsStore({identity, budget: {maxRecords: 0}})).toThrow(TypeError);
        expect(() => createDiagnosticsStore({identity, budget: {maxRecords: Number.POSITIVE_INFINITY}})).toThrow(TypeError);
    });

    it("脱敏覆盖消息、结构化数据与错误对象：token/password/cookie/恢复码只剩占位符", () => {
        const store = createDiagnosticsStore({identity});
        const recovery = `NBK1-${"a".repeat(43)}-0123abcd`;
        const error = new Error(`auth failed token=abc123secret ${recovery}`);
        store.record({
            level: "error",
            event: "leak",
            message: `password=hunter2 Bearer eyJhbGciOi cookie: sid=zzz`,
            data: {password: "hunter2", nested: {apiKey: "sk-live-abcdefgh"}, note: `recovery ${recovery}`},
            error,
        });
        const text = JSON.stringify(store.query().records[0]);
        for (const secret of ["hunter2", "eyJhbGciOi", "sid=zzz", "sk-live-abcdefgh", "abc123secret", recovery]) {
            expect(text).not.toContain(secret);
        }
        expect(text).toContain("[REDACTED]");
    });
});

describe("出口挂接与降级", () => {
    it("记录能力先于订阅：挂接前的记录按顺序补写到出口，之后记录直接写出", async () => {
        const store = createDiagnosticsStore({identity});
        store.record({level: "info", event: "early", message: "before"});
        const memory = memoryExporter();
        await attached(store, memory.exporter);
        store.record({level: "info", event: "late", message: "after"});
        await store.flush();
        expect(memory.written.map((record) => record.event)).toEqual(["early", "late"]);
        expect(store.status()).toMatchObject({phase: "available", degraded: null, exporter: {kind: "memory", state: "open"}});
        await expect(store.attach({outcome: {status: "open", exporter: memory.exporter}, fallback: vi.fn()})).rejects.toMatchObject({code: "already-attached"});
    });

    it("出口不可用：降级原因可查询，记录仍被接受，只有 error/fatal 走兜底", async () => {
        const store = createDiagnosticsStore({identity});
        const fallback = vi.fn();
        await store.attach({outcome: {status: "degraded", reason: "location-unavailable", detail: "EEXIST"}, fallback});
        expect(store.record({level: "info", event: "i", message: "m"}).status).toBe("accepted");
        expect(store.record({level: "fatal", event: "f", message: "m"}).status).toBe("accepted");
        expect(fallback.mock.calls.map(([record]) => record.event)).toEqual(["f"]);
        expect(store.status()).toMatchObject({phase: "available", degraded: {reason: "location-unavailable", detail: "EEXIST"}});
        expect(store.query().records).toHaveLength(2);
    });

    it("写入失败或出口自报失守：进入降级、不再写出口，记录调用仍成功；兜底抛错不影响结果", async () => {
        const store = createDiagnosticsStore({identity});
        const fallback = vi.fn(() => {
            throw new Error("stderr closed");
        });
        await attached(store, memoryExporter({failWrite: true}).exporter, fallback);
        store.record({level: "info", event: "first", message: "m"});
        await store.flush();
        expect(store.status().degraded?.reason).toBe("exporter-write-failed");
        expect(store.record({level: "error", event: "second", message: "m"}).status).toBe("accepted");
        expect(fallback).toHaveBeenCalledTimes(1);

        const lost = Promise.withResolvers<DiagnosticsDegraded>();
        const other = createDiagnosticsStore({identity: {location: "server", instanceId: "diag-2"}});
        const memory = memoryExporter();
        await other.attach({outcome: {status: "open", exporter: memory.exporter, degraded: lost.promise}, fallback: vi.fn()});
        lost.resolve({reason: "location-compromised", detail: null});
        await Promise.resolve();
        other.record({level: "info", event: "after-loss", message: "m"});
        await other.flush();
        expect(other.status()).toMatchObject({degraded: {reason: "location-compromised"}, exporter: {state: "degraded"}});
        expect(memory.written).toHaveLength(0);
    });
});

describe("停止与恢复", () => {
    it("关闭补写后拒绝新记录；重复关闭共享结果；已关闭不能被新激活复活", async () => {
        const store = createDiagnosticsStore({identity});
        const memory = memoryExporter();
        await attached(store, memory.exporter);
        store.record({level: "info", event: "pending", message: "m"});
        const first = store.shutdown();
        expect(store.record({level: "info", event: "during", message: "m"})).toEqual({status: "rejected", reason: "stopping"});
        expect(store.shutdown()).toBe(first);
        await first;
        expect(memory.written.map((record) => record.event)).toEqual(["pending"]);
        expect(memory.closes()).toBe(1);
        expect(store.status()).toMatchObject({phase: "closed", exporter: {state: "closed"}});
        expect(store.record({level: "fatal", event: "late", message: "m"})).toEqual({status: "rejected", reason: "closed"});
        await store.shutdown();
        expect(memory.closes()).toBe(1);
        await expect(store.attach({outcome: {status: "open", exporter: memory.exporter}, fallback: vi.fn()})).rejects.toBeInstanceOf(DiagnosticsError);
    });

    it("出口关闭失败：留在停止中并报告 close-incomplete；显式再次关闭只重试失败步骤，并发调用不重入", async () => {
        let failClose = true;
        const store = createDiagnosticsStore({identity});
        const memory = memoryExporter({failClose: () => failClose});
        await attached(store, memory.exporter);
        await expect(store.shutdown()).rejects.toMatchObject({code: "close-incomplete"});
        expect(store.status()).toMatchObject({phase: "stopping", degraded: {reason: "exporter-close-failed"}, exporter: {state: "close-failed"}});
        failClose = false;
        const retry = store.shutdown();
        expect(store.shutdown()).toBe(retry);
        await retry;
        expect(memory.closes()).toBe(2);
        expect(store.status().phase).toBe("closed");
    });
});

describe("经 createApplication 装配", () => {
    const blockerKey = defineServiceKey<string>("blocker");

    function manifestWith(store: DiagnosticsStore, exporter: DiagnosticExporter, fallback: (record: DiagnosticRecord) => void, failRequired: boolean): ApplicationManifest {
        return {
            keys: [diagnosticsKey, blockerKey],
            plugins: [createDiagnosticsPlugin({location: "server", store, exporter: async () => ({status: "open", exporter}), fallback})],
            gates: [
                {id: "diagnostics", kind: "activate", entry: {plugin: "nbook.diagnostics", entry: "main"}},
                ...(failRequired ? [{id: "needs-blocker", kind: "resolve" as const, key: blockerKey}] : []),
            ],
            observers: mechanismObservers(store),
        };
    }

    it("消费者经服务键记录与查询；消费者先收口，其清理记录仍写出，之后诊断出口补写并关闭，实例 closed", async () => {
        const store = createDiagnosticsStore({identity});
        const memory = memoryExporter();
        const receipts: string[] = [];
        const consumer: PluginDefinition = {
            id: "consumer",
            entries: [{
                id: "main",
                location: "server",
                dependencies: [{key: diagnosticsKey}],
                activate: (context) => {
                    const diagnostics = context.services.require(diagnosticsKey);
                    diagnostics.record({level: "info", event: "consumer.started", message: "hi", source: {plugin: "consumer"}});
                    receipts.push(`query:${diagnostics.query({plugin: "consumer", event: "consumer.started"}).records.length}`);
                    context.scope.register({kind: "consumer-cleanup", label: "cleanup", value: null, release: () => {
                        receipts.push(`cleanup:${diagnostics.record({level: "info", event: "consumer.cleanup", message: "bye"}).status}`);
                    }});
                    return {};
                },
            }],
        };
        const base = manifestWith(store, memory.exporter, vi.fn(), false);
        const application = createApplication(
            {identity, stopSignal: new AbortController().signal, emergency: recordingEmergency(store, () => undefined)},
            {...base, plugins: [...base.plugins, consumer], gates: [...base.gates, {id: "consumer", kind: "activate", entry: {plugin: "consumer", entry: "main"}}]},
        );
        expect((await application.startup).status).toBe("available");
        expect(receipts).toEqual(["query:1"]);
        expect(store.query({event: "lifecycle.phase-changed"}).records.length).toBeGreaterThan(0);
        expect(store.query({event: "plugins.diagnostic", plugin: "nbook.diagnostics"}).records.length).toBeGreaterThan(0);
        expect(await application.stop()).toEqual({status: "closed"});
        expect(receipts).toEqual(["query:1", "cleanup:accepted"]);
        expect(store.status().phase).toBe("closed");
        expect(memory.closes()).toBe(1);
        expect(memory.written.map((record) => record.event)).toEqual(expect.arrayContaining(["consumer.started", "consumer.cleanup"]));
    });

    it("必需门禁失败：失败在收口前进入诊断记录并写到出口，宿主紧急输出仍收到同一报告", async () => {
        const store = createDiagnosticsStore({identity});
        const memory = memoryExporter();
        const emergencies: EmergencyReport[] = [];
        const application = createApplication(
            {identity, stopSignal: new AbortController().signal, emergency: recordingEmergency(store, (report) => emergencies.push(report))},
            manifestWith(store, memory.exporter, vi.fn(), true),
        );
        const startup = await application.startup;
        expect(startup).toMatchObject({status: "failed", stop: {status: "closed"}});
        expect(emergencies).toHaveLength(1);
        const recorded = store.query({event: "application.startup-emergency"}).records;
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({level: "fatal", message: emergencies[0].reason, origin: {instanceId: "diag-1", stage: "startup"}});
        expect(memory.written.some((record) => record.event === "application.startup-emergency")).toBe(true);
        expect(store.status().phase).toBe("closed");
    });

    it("诊断出口关闭失败让实例停止未完成且不报 closed；显式恢复只重试失败的关闭一次，之后实例 closed", async () => {
        let failClose = true;
        const store = createDiagnosticsStore({identity});
        const memory = memoryExporter({failClose: () => failClose});
        const application = createApplication(
            {identity, stopSignal: new AbortController().signal, emergency: recordingEmergency(store, () => undefined)},
            manifestWith(store, memory.exporter, vi.fn(), false),
        );
        expect((await application.startup).status).toBe("available");
        const stop = await application.stop();
        expect(stop.status).toBe("incomplete");
        expect(application.status().phase).toBe("stopping");
        expect(store.status()).toMatchObject({phase: "stopping", exporter: {state: "close-failed"}});
        expect(store.record({level: "info", event: "late", message: "m"})).toEqual({status: "rejected", reason: "stopping"});
        failClose = false;
        expect(await application.recover()).toEqual({status: "closed"});
        expect(memory.closes()).toBe(2);
        expect(store.status().phase).toBe("closed");
        expect(application.status().phase).toBe("closed");
    });

    it("出口打开失败时诊断降级可用，不阻止启动失败被记录：fatal 走兜底通道", async () => {
        const store = createDiagnosticsStore({identity});
        const fallback = vi.fn();
        const manifest: ApplicationManifest = {
            ...manifestWith(store, memoryExporter().exporter, fallback, true),
            plugins: [createDiagnosticsPlugin({location: "server", store, exporter: async () => {
                throw new Error("EACCES");
            }, fallback})],
        };
        const application = createApplication({identity, stopSignal: new AbortController().signal, emergency: recordingEmergency(store, () => undefined)}, manifest);
        expect((await application.startup).status).toBe("failed");
        expect(fallback.mock.calls.map(([record]) => record.event)).toContain("application.startup-emergency");
    });
});
