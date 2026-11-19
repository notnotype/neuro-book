/**
 * 取本包目录里的文字（docs/specs/ui/nested-grid.md 输出 143，docs/specs/ui/i18n.md 输出 8 的例外）。nb-layout 不依赖任何
 * 翻译框架：组件经 `LAYOUT_TEXT_KEY` 注入一个翻译函数，宿主把它接到自己的端口；没有注入时用自带的源语言目录。调用的组件要在
 * 同名 `.md` 里声明 `state:inject`。
 *
 * 本模块是子路径 `@notnotype/nb-layout/text`：宿主取注入键用，不经 `./vue`，提供文字的代码（应用的引导、测试工具）不该为一个
 * 键读进全部组件与 DOM 代码（同 nb-ui 把 `TEXT_PORT_KEY` 放在 `./text-port`）。所以这里只放注入键与它的类型，只依赖 `vue` 的
 * 类型；组件取文字的 `useLayoutText` 在 `layout-text.ts`，不公开。
 */

import type {InjectionKey} from "vue";

export type LayoutTextKey = "splitter.resizeWidth" | "splitter.resizeHeight" | "splitter.collapsed" | "splitter.pixels" | "floatWindow.resize" | "floatWindow.move"
    | "sortable.handle" | "sortable.hint" | "sortable.placeholder" | "sortable.picked" | "sortable.moved" | "sortable.dropped" | "sortable.cancelled" | "sortable.unchanged";

/** 代入目录里 `{{名字}}` 的参数，同 nb-ui 的文字参数（docs/specs/ui/i18n.md）。 */
export type LayoutTextParams = Readonly<Record<string, string | number>>;

/**
 * 宿主注入的翻译函数。组件在模板或 `computed` 里调用它，所以它每次调用都要读宿主的当前语言，换语言后组件才会更新。键不带
 * 命名空间；宿主转给自己的端口时按命名空间 `nb-layout`（`NB_LAYOUT_NAMESPACE`）查目录。
 */
export type LayoutTranslate = (key: LayoutTextKey, params?: LayoutTextParams) => string;

/** 用 `Symbol.for`：出现两份 nb-layout 模块时（开发构建、打包配置出错），按名字取的键仍是同一个，组件照样拿得到宿主的函数。 */
export const LAYOUT_TEXT_KEY: InjectionKey<LayoutTranslate> = Symbol.for("nb-layout.text") as InjectionKey<LayoutTranslate>;
