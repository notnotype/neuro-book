import {describe, expect, it, vi} from "vitest";

import {EventEmitter} from "node:events";
import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import type {ApplicationManifest} from "../../../runtime/application/application";
import {defineServiceKey} from "../../../runtime/services/services";

import {ServerRuntimeHost} from "./server-host";
import type {SignalSource} from "./server-host";

const clockKey = defineServiceKey<{now(): number}>("clock");

function manifest(input: {readonly release?: () => void | Promise<void>; readonly failRequired?: boolean} = {}): ApplicationManifest {
    return {
        keys: [clockKey],
        capabilities: [{id: "clock", key: clockKey, create: () => ({now: () => 1}), release: input.release}],
        plugins: [],
        gates: [
            {id: "clock", kind: "resolve", key: clockKey},
            ...(input.failRequired ? [{id: "injected", kind: "check", check: () => {
                throw new Error("注入失败");
            }} satisfies ApplicationManifest["gates"][number]] : []),
        ],
    };
}

function fakeProcess(): SignalSource & EventEmitter {
    return new EventEmitter() as SignalSource & EventEmitter;
}

describe("server 适配器边界", () => {
    it("只依赖 runtime.application 入口；不 import Nitro/H3、数据库或产品启动模块", async () => {
        const code = await readFile(join(dirname(fileURLToPath(import.meta.url)), "server-host.ts"), "utf8");
        const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]);
        expect(specifiers).toEqual(["../../../runtime/application/application", "../../../runtime/application/application"]);
        expect(code).not.toMatch(/\bimport\s*\(/u);
    });
});

describe("进程信号翻译", () => {
    it("每个实例挂接一次监听；同一 instanceId 重复启动共享实例且不挂第二份；信号成为停止来源并在结算后移除监听", async () => {
        const proc = fakeProcess();
        const release = vi.fn();
        const runtime = new ServerRuntimeHost();
        const host = runtime.start({instanceId: "srv", manifest: manifest({release}), process: proc, emergency: () => undefined});
        expect(runtime.start({instanceId: "srv", manifest: manifest(), process: proc})).toBe(host);
        expect(proc.listenerCount("SIGTERM")).toBe(1);
        expect(proc.listenerCount("SIGINT")).toBe(1);
        expect((await host.application.startup).status).toBe("available");
        proc.emit("SIGTERM", "SIGTERM");
        expect(host.stopSource).toBe("signal:SIGTERM");
        expect(await host.application.stop()).toEqual({status: "closed"});
        await vi.waitFor(() => expect(host.detached).toBe(true));
        expect(proc.listenerCount("SIGTERM")).toBe(0);
        expect(release).toHaveBeenCalledTimes(1);
        expect(runtime.get("srv")).toBeNull();
        // 释放后到达的信号不再触碰该实例。
        proc.emit("SIGINT", "SIGINT");
        expect(host.stopSource).toBe("signal:SIGTERM");
    });

    it("requestStop 只有第一次生效并记录来源；显式信号列表覆盖缺省", async () => {
        const proc = fakeProcess();
        const runtime = new ServerRuntimeHost();
        const host = runtime.start({instanceId: "srv", manifest: manifest(), process: proc, signals: ["SIGHUP"], emergency: () => undefined});
        expect(proc.listenerCount("SIGTERM")).toBe(0);
        expect(proc.listenerCount("SIGHUP")).toBe(1);
        await host.application.startup;
        host.requestStop("stdin:stop");
        host.requestStop("control:route");
        proc.emit("SIGHUP", "SIGHUP");
        expect(host.stopSource).toBe("stdin:stop");
        expect(await host.application.stop()).toEqual({status: "closed"});
    });

    it("启动失败即结算：紧急输出经宿主通道、监听移除；已关闭实例的 id 退役，再次启动须换新身份", async () => {
        const proc = fakeProcess();
        const emergency = vi.fn();
        const runtime = new ServerRuntimeHost();
        const failed = runtime.start({instanceId: "srv", manifest: manifest({failRequired: true}), process: proc, emergency});
        expect((await failed.application.startup).status).toBe("failed");
        await vi.waitFor(() => expect(failed.detached).toBe(true));
        expect(proc.listenerCount("SIGTERM")).toBe(0);
        expect(emergency).toHaveBeenCalledWith(expect.objectContaining({instanceId: "srv", stage: "startup"}));
        expect(() => runtime.start({instanceId: "srv", manifest: manifest(), process: proc, emergency})).toThrow(TypeError);
        expect(proc.listenerCount("SIGTERM")).toBe(0);
        const fresh = runtime.start({instanceId: "srv-2", manifest: manifest(), process: proc, emergency});
        expect((await fresh.application.startup).status).toBe("available");
        await fresh.application.stop();
    });

    it("stopTimeoutMs 让信号触发的停止有界：释放挂起时结算为 incomplete(deadline) 并移除监听；非法值拒绝创建", async () => {
        const proc = fakeProcess();
        const emergency = vi.fn();
        const hang = Promise.withResolvers<void>();
        const runtime = new ServerRuntimeHost();
        expect(() => runtime.start({instanceId: "bad", manifest: manifest(), process: proc, stopTimeoutMs: 0})).toThrow(TypeError);
        expect(proc.listenerCount("SIGTERM")).toBe(0);
        const host = runtime.start({instanceId: "srv", manifest: manifest({release: () => hang.promise}), process: proc, stopTimeoutMs: 20, emergency});
        await host.application.startup;
        proc.emit("SIGTERM", "SIGTERM");
        expect(await host.application.stopped).toMatchObject({status: "incomplete", reason: "deadline"});
        await vi.waitFor(() => expect(host.detached).toBe(true));
        expect(proc.listenerCount("SIGTERM")).toBe(0);
        expect(emergency).toHaveBeenCalledWith(expect.objectContaining({stage: "stop", reason: "关闭未完成：deadline"}));
        // 未完成的实例仍是同一实例（停止中），保留在表里，直到恢复关闭。
        expect(runtime.get("srv")).toBe(host);
        hang.resolve();
    });
});
