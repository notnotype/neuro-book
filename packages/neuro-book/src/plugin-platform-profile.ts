/**
 * NeuroBook 的平台档案（docs/specs/runtime/plugin-manifest.md 的平台档案）：内核与通用插件管理（`src/plugin-platform/`）里
 * 凡是“这是哪个应用”的事实都从这里取。只含常量与纯函数，服务端、窗口、构建预设与作者命令都能导入它，不连带加载 SDK 的
 * 实现；宿主模块表的模块对象按运行位置另放（`backend/plugin-host-modules.ts`、`web/host/plugin-modules.ts`）。
 */

import {createManifestFormat} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginPlatform} from "@notnotype/nb-runtime/plugin-manifest";

import type {PlatformProfile} from "./plugin-platform/shared/profile";
import {npmVersions} from "./plugin-platform/shared/versions";
import {SDK_ENTRIES} from "./sdk/entries";
import type {SdkEntry} from "./sdk/entries";
import {PRODUCT_VERSION} from "./shared/product";

export const NEUROBOOK_PLATFORM: PluginPlatform = {engine: "neurobook", reservedPublishers: ["nbook"]};

/** 清单格式：读、生成清单与内置判断只有这一份。 */
export const manifestFormat = createManifestFormat(NEUROBOOK_PLATFORM, npmVersions);

/*
 * 宿主与第三方插件共享的模块（docs/specs/runtime/plugin-code-loading.md 输出 2–5）：插件构建时把它们留作外部引用，运行时
 * 由宿主给出自己的那一份。构建预设与两端的装载器读同一张表，表外的引用在构建时就报“未共享”，不必等到运行时才得到
 * `module-not-shared`。每加一项都是 `engines.neurobook` 兼容范围内的承诺。Vue 与 `@vue/reactivity` 必须共享同一份：两份
 * 响应式系统互相看不见，`computed` 不更新、`watch` 不触发，也不报错。
 */

/**
 * TypeBox 的三个说明符：宿主自己用的就是这三个（`vite.config.ts` 的预构建清单），插件的 schema 拿到的与宿主同一份，不必各带
 * 一份。别的 TypeBox 子路径不共享，构建时报“未共享”。宿主升级 TypeBox 的次版本，所有已装插件拿到的都跟着变，所以它的版本
 * 范围与 Vue 一样写进兼容说明（docs/specs/runtime/plugin-api.md 的“边界与兼容”）。
 */
const TYPEBOX_MODULES = ["typebox", "typebox/value", "typebox/compile"] as const;

export type BrowserSharedModule = "vue" | "@vue/reactivity" | (typeof TYPEBOX_MODULES)[number] | Exclude<SdkEntry, {readonly browser: false}>["specifier"];
export type ServerSharedModule = "@vue/reactivity" | (typeof TYPEBOX_MODULES)[number] | Extract<SdkEntry, {readonly server: true}>["specifier"];

/**
 * 浏览器入口的宿主模块表。nb-ui 的组件经 SDK 的 `components` 子路径共享，不共享 `@notnotype/nb-ui/components`：nb-ui 不发布，
 * 作者只能从 SDK 包拿到组件的构建期实现与类型。
 */
export const BROWSER_SHARED_MODULES: ReadonlyArray<BrowserSharedModule> = ["vue", "@vue/reactivity", ...TYPEBOX_MODULES, ...SDK_ENTRIES.flatMap((entry) => ("browser" in entry && entry.browser === false ? [] : [entry.specifier as BrowserSharedModule]))];

/**
 * 服务端与项目实例入口的宿主模块；Node 与 Bun 的内置模块另外允许。不含 `vue`：后端不加载界面框架，服务端代码要响应式就从
 * `@vue/reactivity` 取（与宿主的插件状态 store 同一份）。SDK 只共享服务端能用的子路径。
 */
export const SERVER_SHARED_MODULES: ReadonlyArray<ServerSharedModule> = ["@vue/reactivity", ...TYPEBOX_MODULES, ...SDK_ENTRIES.flatMap((entry) => (entry.server ? [entry.specifier] : []))];

export const NEUROBOOK_PROFILE: PlatformProfile = {
    format: manifestFormat,
    productName: "NeuroBook",
    productVersion: PRODUCT_VERSION,
    registrySchema: "nbook.plugins/v1",
    safeModeEnv: "NEURO_BOOK_SAFE_MODE",
    authorField: "nbook",
    registryGlobal: "__NBOOK_PLUGIN_REGISTRY__",
    styleDataset: "nbookPluginStyle",
    filesMount: "/api/runtime",
    buildTempPrefix: ".nbook-plugin-build-",
    hostPackages: ["@notnotype/nb-ui", "@notnotype/nb-plugin-sdk", "@notnotype/nb-runtime", "typebox"],
    // nb-ui 不发布，作者项目里本来装不到它；仓库里照着内置插件的写法直接导入时提示改法。
    notSharedHints: [
        {packageName: "@notnotype/nb-ui", hint: "nb-ui 的组件从 @notnotype/nb-plugin-sdk/components 导入"},
        // 只给浏览器的 SDK 子路径只在服务端入口里会报“未共享”：写明原因，免得作者以为是 SDK 漏了导出。
        ...SDK_ENTRIES.filter((entry) => !entry.server).map((entry) => ({packageName: entry.specifier, hint: `${entry.specifier} 只给浏览器入口用（要 Vue）；服务端入口不导入它，两端共用的合同放在 shared/`})),
    ],
    sharedModules: {browser: BROWSER_SHARED_MODULES, server: SERVER_SHARED_MODULES},
};
