import {describe, expect, it, vi} from "vitest";

import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import type {ApplicationManifest} from "../../runtime/application/application";
import {defineServiceKey} from "../../runtime/services/services";

import {BrowserRuntimeHost} from "./browser-host";
import type {PageLifecycleTarget} from "./browser-host";

const clockKey = defineServiceKey<{now(): number}>("clock");
const presenceKey = defineServiceKey<{id: string}>("presence");

/** 共享后端的在场登记替身：登记/释放按实例计数；`closes` 统计有没有人发全局关闭。 */
function backend() {
    const released: string[] = [];
    return {
        released,
        closes: 0,
        manifest(instanceId: string, input: {readonly failRequired?: boolean} = {}): ApplicationManifest {
            return {
                keys: [clockKey, presenceKey],
                capabilities: [
                    {id: "clock", key: clockKey, create: () => ({now: () => 1})},
                    {id: "presence", key: presenceKey, create: () => ({id: instanceId}), release: (presence: {id: string}) => void released.push(presence.id)},
                ],
                plugins: [],
                gates: [
                    {id: "presence", kind: "resolve", key: presenceKey},
                    ...(input.failRequired ? [{id: "injected", kind: "check", check: () => {
                        throw new Error("注入失败 token=should-not-leak");
                    }} satisfies ApplicationManifest["gates"][number]] : []),
                ],
            };
        },
    };
}

class FakePage implements PageLifecycleTarget {
    readonly listeners = new Set<() => void>();
    addEventListener(_type: "pagehide", listener: () => void): void {
        this.listeners.add(listener);
    }
    removeEventListener(_type: "pagehide", listener: () => void): void {
        this.listeners.delete(listener);
    }
    hide(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

describe("browser 适配器边界", () => {
    it("只依赖 runtime.application 入口；不 import 服务端模块、Vue 或 Nuxt", async () => {
        const code = await readFile(join(dirname(fileURLToPath(import.meta.url)), "browser-host.ts"), "utf8");
        const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
        expect(specifiers).toEqual(["../../runtime/application/application", "../../runtime/application/application"]);
        expect(code).not.toMatch(/\bimport\s*\(/u);
        expect(code).not.toMatch(/\b(?:vue|nuxt|#imports|server\/|node:)/u);
    });

    it("没有 window 且未显式传入 page 时拒绝创建，不静默挂到不存在的目标", () => {
        expect(() => new BrowserRuntimeHost().start({instanceId: "w", manifest: backend().manifest("w")})).toThrow(TypeError);
    });
});

describe("同一窗口多实例与销毁", () => {
    it("两个实例按 instanceId 隔离；销毁一个只释放它自己的在场，另一个继续接纳；监听在结算后移除", async () => {
        const page = new FakePage();
        const shared = backend();
        const runtime = new BrowserRuntimeHost();
        const a = runtime.start({instanceId: "win-a", manifest: shared.manifest("win-a"), page, emergency: () => undefined});
        const b = runtime.start({instanceId: "win-b", manifest: shared.manifest("win-b"), page, emergency: () => undefined});
        expect(runtime.start({instanceId: "win-a", manifest: shared.manifest("win-a"), page})).toBe(a);
        expect(a.application).not.toBe(b.application);
        expect(page.listeners.size).toBe(2);
        expect((await a.application.startup).status).toBe("available");
        expect((await b.application.startup).status).toBe("available");

        expect(await a.destroy()).toEqual({status: "closed"});
        expect(a.stopSource).toBe("destroy");
        expect(await a.destroy()).toEqual({status: "closed"});
        await vi.waitFor(() => expect(a.detached).toBe(true));
        expect(page.listeners.size).toBe(1);
        expect(shared.released).toEqual(["win-a"]);
        expect(shared.closes).toBe(0);
        expect(runtime.get("win-a")).toBeNull();
        expect(await a.application.admit({label: "late", run: () => 1})).toEqual({status: "rejected", reason: "closed"});
        expect((await b.application.admit({label: "ok", run: () => 1})).status).toBe("accepted");
        expect(b.detached).toBe(false);
    });

    it("pagehide 只记录 unload 并进入停止，不等待关闭结果；停止后同一事件不再触碰实例", async () => {
        const page = new FakePage();
        const shared = backend();
        const runtime = new BrowserRuntimeHost();
        const host = runtime.start({instanceId: "win", manifest: shared.manifest("win"), page, emergency: () => undefined});
        await host.application.startup;
        page.hide();
        expect(host.stopSource).toBe("unload");
        expect(host.application.status().admission).toBe("closed");
        expect(await host.application.stop()).toEqual({status: "closed"});
        await vi.waitFor(() => expect(host.detached).toBe(true));
        expect(page.listeners.size).toBe(0);
        page.hide();
        expect(host.stopSource).toBe("unload");
    });

    it("启动必需失败：紧急输出经宿主通道且不含注入的敏感串，实例结算后监听移除", async () => {
        const page = new FakePage();
        const emergency = vi.fn();
        const host = new BrowserRuntimeHost().start({instanceId: "win", manifest: backend().manifest("win", {failRequired: true}), page, emergency});
        const startup = await host.application.startup;
        expect(startup.status).toBe("failed");
        await vi.waitFor(() => expect(host.detached).toBe(true));
        expect(page.listeners.size).toBe(0);
        expect(emergency).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(emergency.mock.calls[0])).not.toContain("should-not-leak");
    });

    it("stopTimeoutMs 约束显式销毁：释放挂起时销毁结算为 incomplete(deadline)，监听照常移除", async () => {
        const page = new FakePage();
        const hang = Promise.withResolvers<void>();
        const manifest: ApplicationManifest = {
            keys: [presenceKey],
            capabilities: [{id: "presence", key: presenceKey, create: () => ({id: "win"}), release: () => hang.promise}],
            plugins: [],
            gates: [{id: "presence", kind: "resolve", key: presenceKey}],
        };
        const host = new BrowserRuntimeHost().start({instanceId: "win", manifest, page, stopTimeoutMs: 20, emergency: () => undefined});
        await host.application.startup;
        expect(await host.destroy()).toMatchObject({status: "incomplete", reason: "deadline"});
        await vi.waitFor(() => expect(host.detached).toBe(true));
        expect(page.listeners.size).toBe(0);
        hang.resolve();
    });
});
