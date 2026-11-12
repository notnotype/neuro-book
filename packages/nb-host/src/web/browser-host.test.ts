/**
 * 浏览器环境适配器：真实内核，EventTarget 充当页面事件目标（与浏览器的 pagehide 派发方式相同）。
 */

import {describe, expect, it} from "bun:test";

import type {ApplicationManifest, EmergencyReport} from "@notnotype/nb-runtime/application";
import type {PluginDefinition, PluginPlatform} from "@notnotype/nb-runtime/plugins";

import {BrowserRuntimeHost} from "./browser-host";

const emptyManifest = {plugins: [], requiredPlugins: [], gates: []};
const PLATFORM: PluginPlatform = {engine: "acme", reservedPublishers: ["acme"]};
const ignore = (): void => undefined;

describe("浏览器环境适配器", () => {
    it("同一 instanceId 存活期间共享实例；实例关闭后该 id 退役，不能再启动", async () => {
        const runtime = new BrowserRuntimeHost();
        const page = new EventTarget();
        const first = runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore, platform: PLATFORM});
        expect(runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore, platform: PLATFORM})).toBe(first);
        expect((await first.application.startup).status).toBe("available");
        expect((await first.destroy()).status).toBe("closed");
        expect(first.stopSource).toBe("destroy");
        expect(() => runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore, platform: PLATFORM})).toThrow(TypeError);
    });

    it("pagehide 只请求停止（来源 unload）；停止结算后监听已移除", async () => {
        const runtime = new BrowserRuntimeHost();
        const page = new EventTarget();
        const host = runtime.start({instanceId: "w1", manifest: emptyManifest, page, emergency: ignore, platform: PLATFORM});
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
        const a = runtime.start({instanceId: "a", manifest: emptyManifest, page: pageA, emergency: ignore, platform: PLATFORM});
        const b = runtime.start({instanceId: "b", manifest: emptyManifest, page: pageB, emergency: ignore, platform: PLATFORM});
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
            manifest: {plugins: [failing], requiredPlugins: ["test.fail"], gates: []},
            page: new EventTarget(),
            emergency: (report) => reports.push(report),
            platform: PLATFORM,
        });
        expect((await host.application.startup).status).toBe("failed");
        await host.application.stopped;
        expect(reports.map((report) => report.stage)).toContain("startup");
        expect(host.detached).toBe(true);
    });

    it("清单里带的平台档案覆盖不了 platform 选项：内置插件在发布者名下的贡献照档案放宽", async () => {
        // 贡献点要求贡献 id 以贡献方插件 id 开头；acme 是档案里的保留发布者，acme.files 因此可以贡献 acme.view.open。
        // 清单里另带一份不保留任何发布者的档案，若它生效，这条贡献会被拒。
        const shell: PluginDefinition = {id: "acme.shell", contributionPoints: [{id: "commands", implementation: "none", idPrefix: "plugin"}], entries: []};
        const files: PluginDefinition = {id: "acme.files", contributions: [{capability: "commands", id: "acme.view.open", declaration: {}}], entries: []};
        const manifest: ApplicationManifest = {plugins: [shell, files], requiredPlugins: [], gates: [], platform: {reservedPublishers: []}};
        const host = new BrowserRuntimeHost().start({instanceId: "w1", manifest, page: new EventTarget(), emergency: ignore, platform: PLATFORM});
        expect((await host.application.startup).status).toBe("available");
        expect(host.application.plugins.contribution("commands", "acme.view.open").map((state) => state.validation)).toEqual([{status: "accepted"}]);
        await host.destroy();
    });
});
