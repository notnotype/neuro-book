/**
 * 平台档案：通用的第三方插件管理（`src/plugin-platform/`）里凡是“这是哪个应用”的事实都从这里来，这个目录自己不写任何
 * 应用的名字（`architecture.test.ts` 扫描）。应用在 `src/plugin-platform-profile.ts` 给出自己的取值，宿主、构建预设与作者
 * 命令都把它交给这里的函数。
 *
 * 只含常量与纯函数：构建预设在 Node 里导入它，不能连带加载宿主的模块；宿主模块表的模块对象另由应用按运行位置提供。
 */

import type {ManifestFormat} from "@notnotype/nb-runtime/plugin-manifest";

export interface PlatformProfile {
    /** 按平台建好的清单格式：引擎键、保留发布者与 id 规则（`createManifestFormat`）。 */
    readonly format: ManifestFormat;
    /** 写进给人看的说明，例如“插件要求 <产品名> ^1.0.0”。 */
    readonly productName: string;
    /** 第三方插件 `engines.<引擎键>` 的兼容检查以它为准。 */
    readonly productVersion: string;
    /**
     * 插件 API 的兼容起点：从这个版本到 `productVersion` 插件能用的接口没有不兼容的改动，插件的范围与这一段有交集就兼容
     * （`engineAccepts`）。不晚于 `productVersion`；等于它时就是只看当前版本。
     */
    readonly pluginApiSince: string;
    /** 登记表文件的模式标记。已经写进用户的状态根，改了旧文件就读不了。 */
    readonly registrySchema: string;
    /** 安全模式的环境变量：值为 `1` 时本次启动不加载任何第三方插件。 */
    readonly safeModeEnv: string;
    /** 作者 `package.json` 里放构建设置（例如入口定义模块）的字段名。已经写进作者的目录，改了旧目录就读不到。 */
    readonly authorField: string;
    /** 浏览器产物登记工厂用的全局对象名：构建预设写进产物，窗口的装载器在同名对象上收登记。 */
    readonly registryGlobal: string;
    /** 窗口里插件样式表 `<link>` 的 dataset 名，用来认出自己挂上的样式。 */
    readonly styleDataset: string;
    /** 插件文件端点挂在哪个路径前缀下（不以 `/` 结尾），浏览器引导据此拼出文件地址。 */
    readonly filesMount: string;
    /** 构建预设在输出目录里放中间产物的隐藏目录前缀。 */
    readonly buildTempPrefix: string;
    /** 宿主提供、不许打进插件产物的包（Vue 由构建预设自己认）：打进去会出现第二份，例如第二份内核或 SDK。 */
    readonly hostPackages: ReadonlyArray<string>;
    /** 构建时报“未共享”时按包名附上的改法提示。 */
    readonly notSharedHints: ReadonlyArray<{readonly packageName: string; readonly hint: string}>;
    /** 宿主与第三方插件共享的模块名（plugin-code-loading.md 输出 2–5），按运行位置。构建预设把它们留作外部引用。 */
    readonly sharedModules: {readonly browser: ReadonlyArray<string>; readonly server: ReadonlyArray<string>};
}
