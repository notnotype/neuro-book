/**
 * 属性的图标、显示名与类型的贡献（docs/specs/workbench/markdown-editing.md 输出 59–61、验收场景 31）：真实内核的浏览器实例装着产品的
 * `nbook.markdown` 浏览器定义，测试插件顶层声明贡献；Markdown 控件经 `markdownKey` 交出的组件挂在真实的编辑器区与文档模型上
 * （文件客户端是 Lab 的内存适配器），所以声明经贡献点校验、冲突取舍、翻译端口与注入的 `describe` 都是产品的实现。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {windowTextKey} from "nbook/shared/window-text-key";
import {createHostTextEngine} from "nbook/web/host/text-engine";
import {MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlHandle} from "nbook/plugins/editor/shared/contracts";
import {createEditorArea} from "nbook/plugins/editor/web/area";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {createMemoryFiles} from "nbook/plugins/explorer/web/lab/memory-files";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
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

const FRONTMATTER = "---\n视角: 林雪\n时间:\n字数目标:\n地点: 青石镇\n---\n正文\n";

/** 一个只有顶层声明的测试插件。 */
const contributor = (id: string, declarations: Readonly<Record<string, unknown>>): PluginDefinition => ({id, contributions: Object.entries(declarations).map(([name, declaration]) => ({capability: "markdown.properties", id: `${id}.${name}`, declaration})), entries: []});

async function start(plugins: ReadonlyArray<PluginDefinition>) {
    // 窗口的翻译引擎是产品的实现，像真实的窗口那样作为宿主能力交给插件（`nbook.markdown` 经 `windowTextKey` 取它的端口）：切语言只调它的 `setLocale`。
    const engine = createHostTextEngine({locale: "zh-CN", strict: true});
    const memory = createMemoryFiles({project: [["a.md", FRONTMATTER]], user: []});
    let components: MarkdownComponents | null = null;
    const files: PluginDefinition = {id: "nbook.files", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], provides: [filesKey], activate: () => ({services: [provideService(filesKey, memory.files)]})})]};
    const probe: PluginDefinition = {id: "test.probe", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: markdownKey}], activate: (context) => {
        components = context.services.require(markdownKey).components;
        return {};
    }})]};
    const identity = {location: "browser" as const, instanceId: "properties-contribution"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [{id: "window.text", key: windowTextKey, create: () => engine}], plugins: [diagnostics, files, markdownBrowserPlugin, ...plugins, probe], requiredPlugins: [diagnostics.id, "nbook.markdown", "test.probe"], gates: []},
    );
    cleanups.push(async () => {
        await application.stop();
        memory.dispose();
    });
    await application.startup;
    if (components === null) throw new Error("没有取到 markdownKey");
    const area = createEditorArea({files: memory.files, clock: systemClock, panels: createMemoryEditorPanels(), workspaceKey: "test", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    cleanups.push(() => area.dispose());
    area.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
    const groupId = area.groups.activeGroup.value;
    const binding = await waitUntil("文档读到", () => {
        const found = area.binding(groupId);
        return found?.kind === "text" && area.documentOf(groupId)?.status.value === "ready" ? found : null;
    });
    const port = testTextPort("zh-CN", {"nbook.markdown": markdownCatalogs});
    const wrapper = mount((components as MarkdownComponents).MarkdownControl, {props: {binding, host: area.tabControlSlot(binding.tabId, MARKDOWN_EDITOR), readonly: false, visible: true, label: "a.md", onReady: (ready: EditorControlHandle | null) => area.registerTabHandle(binding.tabId, MARKDOWN_EDITOR, ready)}, attachTo: document.body, global: {provide: provideText(port)}});
    cleanups.push(() => wrapper.unmount());
    // 第一次挂载要等 Vitest 转换编辑器的模块。
    await waitUntil("面板出现", () => (document.querySelector("[data-markdown-properties]") === null ? null : true), {timeoutMs: 20_000});
    const doc = area.documentOf(groupId);
    if (doc === null) throw new Error("没有取到文档");
    return {store, wrapper, application, engine, doc};
}

const panel = (): HTMLElement => document.querySelector("[data-markdown-properties]") as HTMLElement;
const row = (name: string): HTMLElement => panel().querySelector(`[data-property-name="${name}"]`) as HTMLElement;

describe("属性声明的贡献（经真实的插件运行时）", () => {
    it("声明按名字生效：摘要与行里是显示名、图标，空值的行按声明的类型输入；文件字节不变", async () => {
        const {wrapper, engine, doc} = await start([contributor("test.canon", {
            pov: {name: "视角", icon: "i-lucide-eye", label: "叙述视角"},
            when: {name: "时间", kind: "date"},
            words: {name: "字数目标", kind: "number", label: {"zh-CN": "预计字数", "en-US": "Word goal"}},
        })]);
        expect(panel().querySelector("[data-property-summary]")?.textContent).toBe("叙述视角 林雪 · 时间 · 预计字数 · 地点 青石镇");
        await (panel().querySelector("button[aria-expanded]") as HTMLElement).click();
        await waitUntil("展开", () => (row("视角") === null ? null : true));
        expect(row("视角").querySelector(".markdown-properties__type .i-lucide-eye")).not.toBeNull();
        expect(row("视角").querySelector(".markdown-properties__name")?.textContent).toBe("叙述视角");
        expect(row("时间").querySelector('[data-property-kind="date"]')).not.toBeNull();
        expect(row("字数目标").querySelector('[data-property-kind="number"]')).not.toBeNull();
        expect(row("地点").querySelector(".markdown-properties__type .i-lucide-text")).not.toBeNull();
        expect(wrapper.html()).not.toContain("Word goal");
        // 空值的行按声明的类型显示，文件不因此改动（没有改动的输入、文档不脏）。
        expect(doc.text.value).toBe(FRONTMATTER);
        expect(doc.dirty.value).toBe(false);
        // 界面语言经窗口的翻译引擎切换：按语言的显示名跟着变，别的行不动。
        engine.setLocale("en-US");
        await waitUntil("英文显示名", () => (row("字数目标").querySelector(".markdown-properties__name")?.textContent === "Word goal" ? true : null));
        expect(row("视角").querySelector(".markdown-properties__name")?.textContent).toBe("叙述视角");
        engine.setLocale("zh-CN");
        await waitUntil("中文显示名", () => (row("字数目标").querySelector(".markdown-properties__name")?.textContent === "预计字数" ? true : null));
        expect(doc.dirty.value).toBe(false);
    });

    it("同名冲突：id 码元顺序最小的整条生效，被忽略的记一条诊断；不合格的声明被贡献点拒绝、不生效", async () => {
        const {store, application} = await start([
            contributor("test.b", {pov: {name: "视角", label: "视点", icon: "i-lucide-user"}}),
            contributor("test.a", {pov: {name: "视角", label: "叙述视角"}, broken: {name: "时间", kind: "complex"}, empty: {name: "地点"}}),
        ]);
        expect(panel().querySelector("[data-property-summary]")?.textContent).toBe("叙述视角 林雪 · 时间 · 字数目标 · 地点 青石镇");
        const records = store.query({}).records;
        const conflict = records.filter((record) => record.event === "markdown.properties.conflict");
        expect(conflict.map((record) => record.data)).toEqual([{name: "视角", kept: "test.a.pov", ignored: "test.b.pov"}]);
        // 渲染几次也只记一次。
        await (panel().querySelector("button[aria-expanded]") as HTMLElement).click();
        expect(store.query({}).records.filter((record) => record.event === "markdown.properties.conflict")).toHaveLength(1);
        // 不合格的两条（`kind` 不在五种之内、三项都没给）由贡献点按声明形状拒绝（原因可查询，运行时的查询不产生诊断）：时间与地点照旧。
        const validation = (id: string) => application.plugins.contribution("markdown.properties", id)[0]?.validation;
        expect(validation("test.a.broken")).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        expect(validation("test.a.empty")).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        expect(validation("test.a.pov")).toMatchObject({status: "accepted"});
        await waitUntil("展开", () => (row("时间") === null ? null : true));
        expect(row("时间").querySelector('[data-property-kind="text"]')).not.toBeNull();
    });
});
