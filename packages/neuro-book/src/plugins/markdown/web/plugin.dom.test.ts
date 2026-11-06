/**
 * `nbook.markdown` 的服务 `markdownKey` 交出的 nb-markdown 组件（真实插件实例，docs/specs/ui/markdown-display.md、ui/prompt-editor.md
 * 的宿主接口）：外面套的几层（`withHost`、`MarkdownHosted`）把外露方法转给里面的组件，对话视图的输入框才能调 PromptEditor 的
 * `focus` 等；不读宿主的图片与小块经属性拿到 nbook 的说明与分类，说明经窗口的翻译端口取（端口登记了 `nbook.markdown` 的目录）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {h, shallowRef} from "vue";
import type {Component} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {markdownKey} from "../shared/contracts";
import type {MarkdownComponents} from "../shared/contracts";
import {markdownBrowserPlugin} from "./plugin";
import {markdownCatalogs} from "./text";

const silent = {error: () => undefined};
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 起一个只有诊断、内存文件与 `nbook.markdown` 的浏览器实例，取服务交出的组件。 */
async function served(): Promise<MarkdownComponents> {
    const memory = createMemoryFiles({project: [], user: []});
    let components: MarkdownComponents | null = null;
    // 服务键按插件 id 归属（`nbook.files/...`），替身用同一个 id。
    const files: PluginDefinition = {id: "nbook.files", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], provides: [filesKey], activate: () => ({services: [provideService(filesKey, memory.files)]})})]};
    const probe: PluginDefinition = {id: "test.probe", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: markdownKey}], activate: (context) => {
        components = context.services.require(markdownKey).components;
        return {};
    }})]};
    const identity = {location: "browser" as const, instanceId: "markdown-served"};
    const diagnostics = createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [diagnostics, files, markdownBrowserPlugin, probe], requiredPlugins: [diagnostics.id, "nbook.markdown", "test.probe"], gates: []},
    );
    cleanups.push(async () => {
        await application.stop();
    });
    await application.startup;
    if (components === null) throw new Error("没有取到 markdownKey");
    return components;
}

/** 挂在窗口里：窗口的翻译端口登记了内置插件的目录。 */
function mountServed(component: Component, props: Record<string, unknown>) {
    const handle = shallowRef<Record<string, unknown> | null>(null);
    const port = testTextPort("zh-CN", {"nbook.markdown": markdownCatalogs});
    const wrapper = mount({render: () => h(component, {ref: handle, ...props})}, {attachTo: document.body, global: {provide: provideText(port)}});
    cleanups.push(() => wrapper.unmount());
    return {wrapper, handle};
}

/** 第一次挂载要等 Vitest 转换编辑器的模块，缺省的 5 秒在机器忙时不够。 */
const FIRST_MOUNT = {timeoutMs: 20_000};

describe("markdownKey 交出的 nb-markdown 组件", () => {
    it("PromptEditor 的外露方法穿过外面几层包装（对话视图的输入框调 focus、insertText、insertFiles）", async () => {
        const {PromptEditor} = await served();
        const {handle} = mountServed(PromptEditor, {draft: {text: "", version: 1}, locale: "zh-CN"});
        await waitUntil("PromptEditor 挂上", () => (typeof handle.value?.focus === "function" ? true : null), FIRST_MOUNT);
        expect(["focus", "insertText", "insertFiles"].map((name) => typeof handle.value?.[name])).toEqual(["function", "function", "function"]);
    });

    it("单独交出的图片写明不在作品里；单独交出的小块按作品文件分类（session://attachments/ 是回形针，作品里的文件是文件图标）", async () => {
        const {MarkdownImage, InlineChip} = await served();
        const image = mountServed(MarkdownImage, {src: "../外面.png", alt: "外面"});
        await waitUntil("图片说明", () => (image.wrapper.text() === "外面（不在作品里，不显示）" ? true : null), FIRST_MOUNT);
        const attachment = mountServed(InlineChip, {kind: "reference", label: "截图", target: "session://attachments/截图.png"});
        const work = mountServed(InlineChip, {kind: "reference", label: "林雪", target: "/设定/林雪.md"});
        await flushPromises();
        await waitUntil("小块", () => (attachment.wrapper.find(".i-lucide-paperclip").exists() && work.wrapper.find("svg[data-file-icon]").exists() ? true : null), FIRST_MOUNT);
        expect(work.wrapper.find("[data-inline-chip]").classes()).toContain("nb-chip--work");
    });
});
