/**
 * 浏览器插件装配：产品清单里有浏览器入口的插件，在这里对应一份定义；只有顶层声明式贡献的插件由宿主按描述生成定义。与 `src/server/plugins.ts` 对称：普通插件的
 * 定义是常量，宿主的东西经宿主能力取得；只有诊断是宿主适配器的工厂（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 清单写了浏览器入口而两张表都没有时，窗口以启动失败结束，不静默少装。
 */

import {createBrowserDiagnosticsPlugin} from "@notnotype/nb-host/web";
import type {DiagnosticsConsole} from "@notnotype/nb-host/web";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {Catalog} from "@notnotype/nb-ui/text";

import {pluginsAt, productPlugins} from "nbook/manifest";
import {STUDY_ICON_NAMES} from "nbook/plugins/theme-study/plugin";
import type {PluginDescriptor} from "nbook/manifest";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {desktopBrowserPlugin} from "nbook/plugins/desktop/web/plugin";
import {editorBrowserPlugin} from "nbook/plugins/editor/web/plugin";
import {editorCatalogs} from "nbook/plugins/editor/web/text";
import {htmlPreviewBrowserPlugin} from "nbook/plugins/html-preview/web/plugin";
import {htmlPreviewCatalogs} from "nbook/plugins/html-preview/web/text";
import {imageViewerBrowserPlugin} from "nbook/plugins/image-viewer/web/plugin";
import {imageViewerCatalogs} from "nbook/plugins/image-viewer/web/text";
import {markdownBrowserPlugin} from "nbook/plugins/markdown/web/plugin";
import {markdownCatalogs} from "nbook/plugins/markdown/web/text";
import {modelsBrowserPlugin} from "nbook/plugins/models/web/plugin";
import {webBrowserPlugin} from "nbook/plugins/web-tools/web/plugin";
import {webCatalogs} from "nbook/plugins/web-tools/web/text";
import {modelsCatalogs} from "nbook/plugins/models/web/text";
import {tasksBrowserPlugin} from "nbook/plugins/tasks/web/plugin";
import {tasksCatalogs} from "nbook/plugins/tasks/web/text";
import {agentBrowserPlugin} from "nbook/plugins/agent/web/plugin";
import {stickersBrowserPlugin} from "nbook/plugins/stickers/web/plugin";
import {botsBrowserPlugin} from "nbook/plugins/bots/web/plugin";
import {stickersCatalogs} from "nbook/plugins/stickers/web/text";
import {agentCatalogs} from "nbook/plugins/agent/web/text";
import {explorerBrowserPlugin} from "nbook/plugins/explorer/web/plugin";
import {canonCatalogs} from "nbook/plugins/canon/web/text";
import {explorerCatalogs} from "nbook/plugins/explorer/web/text";
import {networkBrowserPlugin} from "nbook/plugins/network/web/plugin";
import {networkCatalogs} from "nbook/plugins/network/web/text";
import {filesBrowserPlugin} from "nbook/plugins/files/web/plugin";
import {canonBrowserPlugin} from "nbook/plugins/canon/web/plugin";
import {plotBrowserPlugin} from "nbook/plugins/plot/web/plugin";
import {plotCatalogs} from "nbook/plugins/plot/web/text";
import {pluginsBrowserPlugin} from "nbook/plugins/plugins/web/plugin";
import {pluginsCatalogs} from "nbook/plugins/plugins/web/text";
import {projectsBrowserPlugin} from "nbook/plugins/projects/web/plugin";
import {projectsCatalogs} from "nbook/plugins/projects/web/text";
import {desktopCatalogs} from "nbook/plugins/desktop/web/text";
import {settingsBrowserPlugin} from "nbook/plugins/settings/web/plugin";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {workbenchBrowserPlugin} from "nbook/plugins/workbench/web/plugin";
import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";

export interface BrowserPluginContext {
    /** 本窗口运行实例的诊断存储。 */
    readonly store: DiagnosticsStore;
    readonly console: DiagnosticsConsole;
}

export type BrowserHostPluginFactory = (context: BrowserPluginContext) => PluginDefinition;

/** 浏览器的宿主适配器只有诊断；表的键收窄到它，普通插件进不了这张表。 */
export type BrowserHostPluginId = "runtime.diagnostics";

export function isBrowserHostPlugin(id: string): id is BrowserHostPluginId {
    return id === "runtime.diagnostics";
}

/** 普通插件：只能放定义常量。 */
export const browserPluginDefinitions: Readonly<Record<string, PluginDefinition>> = {
    "nbook.state": statePlugin,
    "nbook.commands": commandsPlugin,
    "nbook.workbench": workbenchBrowserPlugin,
    "nbook.projects": projectsBrowserPlugin,
    "nbook.settings": settingsBrowserPlugin,
    "nbook.plugins": pluginsBrowserPlugin,
    "nbook.storage": storageBrowserPlugin,
    "nbook.files": filesBrowserPlugin,
    "nbook.explorer": explorerBrowserPlugin,
    "nbook.markdown": markdownBrowserPlugin,
    "nbook.editor": editorBrowserPlugin,
    "nbook.image-viewer": imageViewerBrowserPlugin,
    "nbook.html-preview": htmlPreviewBrowserPlugin,
    "nbook.canon": canonBrowserPlugin,
    "nbook.plot": plotBrowserPlugin,
    "nbook.models": modelsBrowserPlugin,
    "nbook.network": networkBrowserPlugin,
    "nbook.web": webBrowserPlugin,
    "nbook.tasks": tasksBrowserPlugin,
    "nbook.agent": agentBrowserPlugin,
    "nbook.stickers": stickersBrowserPlugin,
    "nbook.bots": botsBrowserPlugin,
    "nbook.desktop": desktopBrowserPlugin,
};

/** 宿主适配器：诊断的存储在窗口运行实例建立之前就要能记录（ADR 0026 决策第 5 条）。 */
export const browserHostPlugins: Readonly<Record<BrowserHostPluginId, BrowserHostPluginFactory>> = {
    "runtime.diagnostics": (context) => createBrowserDiagnosticsPlugin({store: context.store, console: context.console}),
};

/** 一个内置插件随前端构建的消息目录：各语言的目录与源语言（docs/specs/ui/i18n.md）。 */
export interface BuiltinCatalogs {
    readonly source: string;
    readonly catalogs: Readonly<Record<string, Catalog>>;
}

/**
 * 内置插件的消息目录，按插件 id：插件在自己的目录模块里静态导入 `locales/<语言>.json`，在这里登一项，随前端构建进包；窗口在
 * 挂载界面前把它们登记进翻译引擎，命名空间是插件 id。只有后端入口的内置插件也登在这里：它们的失败码同样在窗口里显示。第三方
 * 插件的目录不在构建里，经引导的目录索引与目录端点取（docs/specs/runtime/browser-host.md 输出 2）。
 */
export const builtinPluginCatalogs: Readonly<Record<string, BuiltinCatalogs>> = {
    "nbook.agent": agentCatalogs,
    "nbook.canon": canonCatalogs,
    "nbook.plot": plotCatalogs,
    "nbook.desktop": desktopCatalogs,
    "nbook.editor": editorCatalogs,
    "nbook.explorer": explorerCatalogs,
    "nbook.html-preview": htmlPreviewCatalogs,
    "nbook.image-viewer": imageViewerCatalogs,
    "nbook.markdown": markdownCatalogs,
    "nbook.models": modelsCatalogs,
    "nbook.network": networkCatalogs,
    "nbook.web": webCatalogs,
    "nbook.tasks": tasksCatalogs,
    "nbook.plugins": pluginsCatalogs,
    "nbook.projects": projectsCatalogs,
    "nbook.settings": settingsCatalogs,
    "nbook.stickers": stickersCatalogs,
    "nbook.workbench": workbenchCatalogs,
};

/**
 * 内置插件的静态文件，按插件目录内的相对路径（docs/specs/theme/skins.md）。放在浏览器这边，不放进插件描述：描述三个位置都引，import 图片会被
 * 服务端构建打进产物，URL 也和 Vite 的不一样。
 */
export const builtinPluginAssets: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    "nbook.theme-study": {
        "assets/study-day.webp": new URL("../plugins/theme-study/assets/study-day.webp", import.meta.url).href,
        "assets/study-night.webp": new URL("../plugins/theme-study/assets/study-night.webp", import.meta.url).href,
        "assets/study-day-working.webp": new URL("../plugins/theme-study/assets/study-day-working.webp", import.meta.url).href,
        "assets/study-night-working.webp": new URL("../plugins/theme-study/assets/study-night-working.webp", import.meta.url).href,
        // `new URL` 的路径要是字面量模板，Vite 才会把这些文件打进产物；名单与书房声明的图标集是同一份。
        ...Object.fromEntries(STUDY_ICON_NAMES.map((name) => [`assets/icons/${name}.svg`, new URL(`../plugins/theme-study/assets/icons/${name}.svg`, import.meta.url).href])),
    },
};

/** 本外壳构建进去的浏览器插件：清单中有浏览器运行位置的插件，加上只有顶层声明式贡献的插件（只登记它们的声明）。 */
export const builtinBrowserPlugins: ReadonlyArray<PluginDescriptor> = pluginsAt("browser", productPlugins);
