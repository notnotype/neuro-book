/**
 * 浏览器环境适配器：真实内核，EventTarget 充当页面事件目标（与浏览器的 pagehide 派发方式相同）。
 */

import {describe, expect, it} from "bun:test";

import type {ApplicationManifest, EmergencyReport} from "@notnotype/nb-runtime/application";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {BrowserRuntimeHost} from "./browser-host";

const emptyManifest: ApplicationManifest = {keys: [], plugins: [], requiredPlugins: [], gates: []};
const ignore = (): void => undefined;

describe("浏览器环境适配器", () => {
    it("同一 instanceId 存活期间共享实例；实例关闭后该 id 退役，不能再启动", async () => {
        const runtime = new BrowserRuntimeHost();
        const page = new EventTarget();
        const first = runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore});
        expect(runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore})).toBe(first);
        expect((await first.application.startup).status).toBe("available");
        expect((await first.destroy()).status).toBe("closed");
        expect(first.stopSource).toBe("destroy");
        expect(() => runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore})).toThrow(TypeError);
    });

    it("pagehide 只请求停止（来源 unload）；停止结算后监听已移除", async () => {
        const runtime = new BrowserRuntimeHost();
        const page = new EventTarget();
        const host = runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore});
        await host.application.startup;
        page.dispatchEvent(new Event("pagehide"));
        expect(host.stopSource).toBe("unload");
        expect((await host.application.stopped).status).toBe("closed");
        expect(host.detached).toBe(true);
    });

    it("同一页面的两个实例互相隔离：卸载只停自己页面上的实例，销毁一个不影响另一个", async () => {
        const runtime = new BrowserRuntimeHost();
        const pageA = new EventTarget();
        const pageB = new EventTarget();
        const a = runtime.start({instanceId: "a", manifest: emptyManifest, page: pageA, emergency: ignore});
        const b = runtime.start({instanceId: "b", manifest: emptyManifest, page: pageB, emergency: ignore});
        await Promise.all([a.application.startup, b.application.startup]);
        pageA.dispatchEvent(new Event("pagehide"));
        await a.application.stopped;
        expect(b.stopSource).toBeNull();
        expect(b.application.status().admission).toBe("open");
        await b.destroy();
    });

    it("必需插件激活失败：不接纳，经宿主的紧急通道报告，停止后监听已移除", async () => {
        const failing: PluginDefinition = {
            id: "test.fail",
            entries: [{id: "browser", location: "browser", activate: () => {
                throw new Error("激活失败");
            }}],
        };
        const reports: EmergencyReport[] = [];
        const host = new BrowserRuntimeHost().start({
            instanceId: "w1",
            manifest: {keys: [], plugins: [failing], requiredPlugins: ["test.fail"], gates: []},
            page: new EventTarget(),
            emergency: (report) => reports.push(report),
        });
        expect((await host.application.startup).status).toBe("failed");
        await host.application.stopped;
        expect(reports.map((report) => report.stage)).toContain("startup");
        expect(host.detached).toBe(true);
    });
});
