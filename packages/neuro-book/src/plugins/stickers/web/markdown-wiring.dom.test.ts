/**
 * 表情目录经 `nbook.markdown` 到展示器（docs/specs/agent/stickers.md 输出 10）：真实内核的浏览器实例里装产品的 `nbook.markdown`，
 * 一个测试插件按 `stickerResolverKey` 交出查表情的服务（形状同 `nbook.stickers` 的浏览器入口，服务端目录另有测试）；从
 * `markdownKey` 取展示器挂上，表情显示成服务给的图。没有这个服务时显示原文。
 */
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {createMemoryFiles} from "nbook/plugins/explorer/web/lab/memory-files";
import {markdownKey} from "nbook/plugins/markdown/shared/contracts";
import type {MarkdownComponents} from "nbook/plugins/markdown/shared/contracts";
import {markdownBrowserPlugin} from "nbook/plugins/markdown/web/plugin";

import {stickerResolverKey} from "../shared/contracts";
import {createStickerDirectory} from "./resolver";

const silent = {error: () => undefined};
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(withStickers: boolean): Promise<MarkdownComponents> {
    const memory = createMemoryFiles({project: [], user: []});
    const directory = createStickerDirectory();
    directory.set([{id: "user.lyra", folder: "lyra", title: "lyra", source: "user", writing: "lyra", stickers: [{name: "开心", width: 64, height: 48, url: "/api/nbook.stickers/image/user.lyra/happy.png?v=1-1"}]}]);
    let components: MarkdownComponents | null = null;
    const files: PluginDefinition = {id: "nbook.files", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], provides: [filesKey], activate: () => ({services: [provideService(filesKey, memory.files)]})})]};
    const stickers: PluginDefinition = {id: "nbook.stickers", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], provides: [stickerResolverKey], activate: () => ({services: [provideService(stickerResolverKey, directory.resolve)]})})]};
    const probe: PluginDefinition = {id: "test.probe", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: markdownKey}], activate: (context) => {
        components = context.services.require(markdownKey).components;
        return {};
    }})]};
    const identity = {location: "browser" as const, instanceId: `stickers-wiring-${String(withStickers)}`};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [diagnostics, files, ...(withStickers ? [stickers] : []), markdownBrowserPlugin, probe], requiredPlugins: [diagnostics.id, "nbook.markdown", "test.probe"], gates: []},
    );
    cleanups.push(async () => {
        await application.stop();
        memory.dispose();
    });
    await application.startup;
    if (components === null) throw new Error("没有取到 markdownKey");
    return components;
}

/** 展示器挂在一个容器里：组件是异步加载的，挂上时它自己的根还不是元素。 */
function display(components: MarkdownComponents, text: string): HTMLElement {
    const container = document.createElement("div");
    document.body.append(container);
    const wrapper = mount(components.MarkdownDisplay, {props: {text, locale: "zh-CN"}, attachTo: container});
    cleanups.push(() => {
        wrapper.unmount();
        container.remove();
    });
    return container;
}

describe("nbook.markdown 交出的展示器", () => {
    it("有表情目录时表情显示成图，认不出的留原文", async () => {
        const root = display(await start(true), "好:lyra/开心:和:lyra/没有:\n");
        const image = await waitUntil("换成图", () => root.querySelector<HTMLImageElement>(".nb-sticker img"));
        expect(image.getAttribute("src")).toBe("/api/nbook.stickers/image/user.lyra/happy.png?v=1-1");
        expect(image.getAttribute("alt")).toBe(":lyra/开心:");
        await waitUntil("认不出的留原文", () => ([...root.querySelectorAll(".nb-sticker")].at(-1)?.classList.contains("is-loading") === false ? true : null));
        expect([...root.querySelectorAll(".nb-sticker")].at(-1)?.textContent).toBe(":lyra/没有:");
    });

    it("没有表情包插件时表情显示原文", async () => {
        const root = display(await start(false), ":lyra/开心:\n");
        const element = await waitUntil("画完", () => root.querySelector<HTMLElement>(".nb-sticker"));
        expect(element.textContent).toBe(":lyra/开心:");
        expect(element.classList.contains("is-loading")).toBe(false);
    });
});
