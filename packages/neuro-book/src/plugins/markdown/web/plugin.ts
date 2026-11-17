/**
 * `nbook.markdown` 浏览器入口（docs/specs/workspace/markdown-syntaxes.md）：拥有方言的两个贡献点，接收外来方言的实现，提供服务
 * `markdownKey` 交出用 Markdown 的组件。
 *
 * 组件按需加载：nb-markdown 的组件、语法模块、Markdown 解析器与编辑内核只从这些 `.vue` 组件引用，入口本身不引它们，所以
 * 首屏不含它们；后端的类型检查装配浏览器插件时也不展开它们（`src/types/vue-sfc.d.ts`）。方言目录、图片地址服务、诊断出口与
 * 上次用过的颜色（`colors.ts`）经组件的包装交下去：Markdown 控件直接用，nb-markdown 的组件经 `components/MarkdownHosted.vue`
 * 换成 nbook 的宿主。
 */

import {defineAsyncComponent, defineComponent, h, provide as provideToChildren, ref} from "vue";
import type {Component} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {IMAGE_FOLDER_DEFAULT, imageFolderSetting, imageLocationSetting} from "nbook/plugins/editor/shared/contracts";
import {filesKey, projectFilesContract} from "nbook/plugins/files/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {markdownKey, MARKDOWN_SYNTAXES_POINT, validateSyntaxContribution} from "../shared/contracts";
import type {MarkdownService} from "../shared/contracts";
import {dialectsPoint} from "../shared/plugin";
import {colorsPort, markdownColorsKey, markdownColorsStore, memoryColors} from "./colors";
import type {MarkdownColors} from "./colors";
import {createMarkdownMedia, markdownMediaKey} from "./media";
import type {MarkdownMedia} from "./media";
import {markdownPropertiesOpenKey, memoryPropertiesOpen, propertiesOpenPort, propertiesOpenStore} from "./properties-open";
import type {PropertiesOpen} from "./properties-open";
import {createAssetUrls, markdownAssetsKey} from "./parts/asset-urls";
import type {AssetUrls} from "./parts/asset-urls";
import {forwardExpose} from "./parts/forward-expose";
import {markdownReportKey} from "./parts/report";
import type {MarkdownReport} from "./parts/report";
import {SyntaxCatalog, syntaxCatalogKey} from "./syntax-catalog";

interface Host {
    readonly catalog: SyntaxCatalog;
    readonly assets: AssetUrls;
    readonly report: MarkdownReport;
    readonly colors: MarkdownColors;
    readonly propertiesOpen: PropertiesOpen;
    readonly media: MarkdownMedia;
}

/**
 * 包一层：给组件交方言目录、图片地址服务、诊断出口与上次用过的颜色；属性、事件与插槽原样转给它。组件的代码加载失败（部署换了
 * 版本、网络断了）时记诊断，有 `fallback` 的按它显示（展示器按纯文字显示原文）。
 */
function withHost(host: Host, name: string, load: () => Promise<Component>, fallback?: (attrs: Record<string, unknown>) => ReturnType<typeof h>, props: Record<string, unknown> = {}): Component {
    const failed = ref(false);
    const inner = defineAsyncComponent(() => load().catch((error: unknown) => {
        host.report("markdown.component.load-failed", `${name} 的代码加载失败`, error);
        failed.value = true;
        throw error;
    }));
    return defineComponent({
        name,
        inheritAttrs: false,
        setup: (_props, {attrs, slots, expose}) => {
            provideToChildren(syntaxCatalogKey, host.catalog);
            provideToChildren(markdownAssetsKey, host.assets);
            provideToChildren(markdownReportKey, host.report);
            provideToChildren(markdownColorsKey, host.colors);
            provideToChildren(markdownPropertiesOpenKey, host.propertiesOpen);
            provideToChildren(markdownMediaKey, host.media);
            const exposed = forwardExpose(expose);
            return () => (failed.value && fallback !== undefined ? fallback(attrs) : h(inner, {...attrs, ...props, ref: exposed}, slots));
        },
    });
}

export const markdownBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [dialectsPoint, {id: MARKDOWN_SYNTAXES_POINT, implementation: "required", validate: validateSyntaxContribution}],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: filesKey}, {key: storageKey, required: false}, {key: windowProjectKey, required: false}, {key: settingsKey, required: false}],
        provides: [markdownKey],
        receives: [MARKDOWN_SYNTAXES_POINT],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const catalog = new SyntaxCatalog(context.declarations, (id, code, message, error) => {
                diagnostics.record({level: "warn", event: "markdown.dialect.inactive", message, ...(error === undefined ? {} : {error}), data: {dialect: id, code}, source: {plugin: descriptor.id}});
            });
            const assets = createAssetUrls(context.services.require(filesKey));
            // 在等存储服务之前登记：等的时候入口就可能被停止，之后登记的监听等不到这次 abort。
            context.signal.addEventListener("abort", () => assets.dispose(), {once: true});
            const report: MarkdownReport = (event, message, error) => diagnostics.record({level: "warn", event, message, error, source: {plugin: descriptor.id}});
            const storage = await context.services.resolve(storageKey);
            const colors = storage.status === "resolved" ? colorsPort(markdownColorsStore.create(context, {storage: storage.instance, diagnostics})) : memoryColors();
            // 属性面板的展开状态按作品记（项目分区）：没有绑定作品、或没有存储服务时只在这次运行里记着。
            const project = await context.services.resolve(windowProjectKey);
            const bound = project.status === "resolved" && project.instance.project !== null;
            const propertiesOpen = bound && storage.status === "resolved" ? propertiesOpenPort(propertiesOpenStore.create(context, {storage: storage.instance, diagnostics})) : memoryPropertiesOpen();
            // 插图的存放与列出（`media.ts`）：设置服务没有装时用缺省的存放位置；没有绑定作品时能力在，但上传不可用、列表为空。
            const settings = await context.services.resolve(settingsKey);
            const projectFiles = bound ? context.remote.use(projectFilesContract) : null;
            const media = createMarkdownMedia({
                files: context.services.require(filesKey),
                find: projectFiles === null ? null : (input, options) => projectFiles.find({query: input.query, limit: input.limit, extensions: [...input.extensions]}, options) as never,
                bound,
                settings: settings.status === "resolved"
                    ? {location: () => settings.instance.get(imageLocationSetting), folder: () => settings.instance.get(imageFolderSetting)}
                    : {location: () => "folder", folder: () => IMAGE_FOLDER_DEFAULT},
            });
            const host: Host = {catalog, assets, report, colors, propertiesOpen, media};
            // nb-markdown 的组件都经 `MarkdownHosted.vue` 挂上，拿到 nbook 的宿主（目标分类、文件图标、语言与诊断）。
            const hosted = (component: string, fallback?: (attrs: Record<string, unknown>) => ReturnType<typeof h>): Component =>
                withHost(host, `${component}Host`, async () => (await import("./components/MarkdownHosted.vue")).default, fallback, {component});
            const service: MarkdownService = {
                components: {
                    MarkdownControl: withHost(host, "MarkdownControlHost", async () => (await import("./components/MarkdownControl.vue")).default),
                    MarkdownDisplay: hosted("MarkdownDisplay", (attrs) => h("div", {class: "nb-markdown-display", style: {whiteSpace: "pre-wrap"}}, String(attrs.text ?? ""))),
                    InlineChip: hosted("InlineChip"),
                    MarkdownImage: hosted("MarkdownImage"),
                    PromptEditor: hosted("PromptEditor"),
                    PromptTextView: hosted("PromptTextView"),
                },
            };
            return {services: [provideService(markdownKey, service)], receivers: {[MARKDOWN_SYNTAXES_POINT]: catalog.receiver()}};
        },
    })],
};
