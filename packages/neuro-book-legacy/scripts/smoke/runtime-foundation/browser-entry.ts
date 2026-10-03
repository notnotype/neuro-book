/**
 * 浏览器 smoke 的页面入口：由 esbuild 以 `platform: "browser"` 打包后载入临时页面。
 * 在真实浏览器里用 BrowserRuntimeHost 装配受控清单，把可调用的场景函数挂到 `globalThis`
 * 供自动化 tab 经 `page.evaluate` 驱动。不加载任何服务端模块——打包阶段引用 node 内建即失败。
 *
 * 远端在场代理：向 smoke 自己的 HTTP 服务器登记/释放本实例在场（`/presence`），从不请求
 * `/close`；服务器计数，用于证明释放一个窗口不发送共享后端的全局关闭。
 */

import {BrowserRuntimeHost} from "../../../app/runtime/browser-host";
import type {BrowserHost, PageLifecycleTarget} from "../../../app/runtime/browser-host";
import type {EmergencyReport, StartupResult, StopResult} from "../../../runtime/application/application";

import {clockKey, createCommandTable, createControlledManifest, presenceKey} from "./controlled-manifest";
import type {Clock, CommandTable, Presence} from "./controlled-manifest";

interface PageScenario {
    /** `hangRelease` 让在场释放永不结算，配合 `stopTimeoutMs` 验证有界销毁。 */
    start(instanceId: string, options?: {readonly failRequired?: boolean; readonly failOptional?: boolean; readonly hangRelease?: boolean; readonly stopTimeoutMs?: number}): Promise<{
        readonly startup: StartupResult;
        readonly shared: boolean;
        readonly admission: string;
    }>;
    greet(instanceId: string, name: string): Promise<string | null>;
    flaky(instanceId: string): string | null;
    destroy(instanceId: string): Promise<{readonly stop: StopResult; readonly source: string | null; readonly detached: boolean; readonly late: string; readonly greetAfterStop: string | null}>;
    /** 派发 pagehide：只观察停止请求被记录，不等待关闭结果。 */
    unload(instanceId: string): {readonly source: string | null; readonly phase: string};
    emergencies(): ReadonlyArray<EmergencyReport>;
    revocations(instanceId: string): ReadonlyArray<{readonly id: string; readonly reason: string}>;
}

const runtime = new BrowserRuntimeHost();
const tables = new Map<string, CommandTable>();
const emergencies: EmergencyReport[] = [];
const hosts = new Map<string, BrowserHost>();
const pageTarget = globalThis as unknown as PageLifecycleTarget & {dispatchEvent(event: Event): boolean; fetch: typeof fetch};

async function presenceRequest(path: string, id: string): Promise<void> {
    const response = await pageTarget.fetch(`${path}?id=${encodeURIComponent(id)}`, {method: "POST"});
    if (!response.ok) {
        throw new Error(`在场请求失败 ${path}: ${response.status}`);
    }
}

function hostOf(instanceId: string): BrowserHost {
    const host = hosts.get(instanceId);
    if (host === undefined) {
        throw new Error(`实例 ${instanceId} 未启动`);
    }
    return host;
}

const scenario: PageScenario = {
    async start(instanceId, options = {}) {
        const commands = tables.get(instanceId) ?? createCommandTable();
        tables.set(instanceId, commands);
        const manifest = createControlledManifest({
            location: "browser",
            commands,
            failRequired: options.failRequired,
            failOptional: options.failOptional,
            clock: {id: "page-clock", key: clockKey, create: (): Clock => ({now: () => Math.round(performance.now())})},
            presence: {
                id: "remote-presence",
                key: presenceKey,
                create: async (): Promise<Presence> => {
                    await presenceRequest("/presence/register", instanceId);
                    return {id: instanceId};
                },
                release: async (presence) => {
                    if (options.hangRelease) {
                        return new Promise<void>(() => undefined);
                    }
                    await presenceRequest("/presence/release", presence.id);
                },
            },
        });
        const first = hosts.get(instanceId);
        const host = runtime.start({instanceId, manifest, page: pageTarget, stopTimeoutMs: options.stopTimeoutMs, emergency: (report) => emergencies.push(report)});
        hosts.set(instanceId, host);
        const startup = await host.application.startup;
        return {startup, shared: first !== undefined && first === host, admission: host.application.status().admission};
    },
    async greet(instanceId, name) {
        const host = hostOf(instanceId);
        const admitted = await host.application.admit({label: "greet", run: () => tables.get(instanceId)!.run("greeter.greet", name)});
        if (admitted.status !== "accepted") {
            return `rejected:${admitted.reason}`;
        }
        const outcome = await admitted.operation.outcome;
        return outcome.status === "completed" ? outcome.value : `outcome:${outcome.status}`;
    },
    flaky(instanceId) {
        return tables.get(instanceId)?.run("flaky.run", "") ?? null;
    },
    async destroy(instanceId) {
        const host = hostOf(instanceId);
        const stop = await host.destroy();
        const late = await host.application.admit({label: "late", run: () => "late"});
        return {
            stop,
            source: host.stopSource,
            detached: host.detached,
            late: late.status === "rejected" ? late.reason : late.status,
            greetAfterStop: tables.get(instanceId)!.run("greeter.greet", "late"),
        };
    },
    unload(instanceId) {
        const host = hostOf(instanceId);
        pageTarget.dispatchEvent(new Event("pagehide"));
        return {source: host.stopSource, phase: host.application.root.phase};
    },
    emergencies: () => emergencies,
    revocations: (instanceId) => tables.get(instanceId)?.revocations ?? [],
};

(globalThis as unknown as {runtimeFoundation: PageScenario}).runtimeFoundation = scenario;
