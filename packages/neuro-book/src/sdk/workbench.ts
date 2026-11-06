/**
 * 插件 SDK 的 `/workbench`：内置插件 `nbook.workbench` 的侧栏与面板视图、状态栏条目（docs/specs/workbench/views.md、
 * docs/specs/ui/workbench-shell.md）。工作台只在浏览器里有意义，整个子路径只给浏览器入口用（要 Vue）。
 * 贡献点常量与声明类型从叶子模块取，不经工作台合同的汇总模块：汇总模块连着首页、浮层、菜单这些不对外的部分。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {sceneProvider, statusItem, view} from "./workbench-helpers";
export type {PropsOf, SceneProviderHelper, StatusItemHelper, ViewHelper} from "./workbench-helpers";

// 主题与场景提供者（docs/specs/theme/skins.md）：主题是顶层声明，写进 `plugin.descriptor([…])`；提供者是浏览器入口的贡献。
export {WORKBENCH_THEME_SCENES_POINT, WORKBENCH_THEMES_POINT} from "nbook/plugins/workbench/shared/theme-points";
export type {SceneProviderImplementation, SceneRequest, SceneResult} from "nbook/plugins/workbench/shared/theme-points";
export type {ThemeDeclaration} from "nbook/plugins/workbench/shared/themes";

export {WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/items";
export type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
// 打开视图的内置命令：入口依赖 `/commands` 的 `commandServiceKey` 时可以从代码执行它（`{viewId}`）。
export {OPEN_VIEW_COMMAND, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
export type {ViewDeclaration, ViewLocation} from "nbook/plugins/workbench/shared/views";
export type {ItemImplementation, ViewContext, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
