/**
 * 取本包目录里的文字（docs/specs/ui/nested-grid.md 输出 143，docs/specs/ui/i18n.md 输出 8 的例外）。nb-layout 不依赖任何
 * 翻译框架：组件经 `LAYOUT_TEXT_KEY` 注入一个翻译函数，宿主把它接到自己的端口；没有注入时用自带的源语言目录（`en-US`）。
 * 调用的组件要在同名 `.md` 里声明 `state:inject`。
 *
 * 本模块是子路径 `@notnotype/nb-layout/text`：宿主取注入键用，不经 `./vue`，提供文字的代码（应用的引导、测试工具）不该为一个
 * 键读进全部组件与 DOM 代码（同 nb-ui 把 `TEXT_PORT_KEY` 放在 `./text-port`）。所以这里只放注入键、它的类型与按自带目录翻译的
 * `layoutCatalogTranslate`，依赖 `vue` 的类型与目录；组件取文字的 `useLayoutText` 在 `layout-text.ts`，不公开。
 */

import type {InjectionKey} from "vue";

import {NB_LAYOUT_CATALOGS, NB_LAYOUT_SOURCE_LOCALE} from "../locales";

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

/** 自带目录里的语言。 */
export type LayoutCatalogLocale = keyof typeof NB_LAYOUT_CATALOGS;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/gu;

/** 把点分键展开成某种语言目录里的叶子；没有这个键时是 `undefined`。 */
function lookup(locale: LayoutCatalogLocale, key: LayoutTextKey): string | undefined {
    let node: unknown = NB_LAYOUT_CATALOGS[locale];
    for (const part of key.split(".")) {
        if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) return undefined;
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" ? node : undefined;
}

/**
 * 按自带目录里的一种语言翻译：给只有一种语言、没有翻译引擎的宿主，`app.provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN"))`。
 * 返回的函数固定这一种语言，不跟着宿主换语言；要跟着换的宿主把 `LAYOUT_TEXT_KEY` 接到自己的端口。
 *
 * 这种语言里缺的键取源语言，再缺就是键名；参数代入 `{{名字}}`，缺的参数保留占位，看得出少传了什么。目录不用复数与数字格式。
 */
export function layoutCatalogTranslate(locale: LayoutCatalogLocale): LayoutTranslate {
    // 参数类型只收目录里的语言；JS 调用方传了别的（含 `constructor` 这类原型上的名字）时按源语言。
    const own: LayoutCatalogLocale = Object.hasOwn(NB_LAYOUT_CATALOGS, locale) ? locale : NB_LAYOUT_SOURCE_LOCALE;
    return (key, params) => (lookup(own, key) ?? lookup(NB_LAYOUT_SOURCE_LOCALE, key) ?? key).replace(PLACEHOLDER, (placeholder, name: string) => {
        const value = params?.[name];
        return value === undefined ? placeholder : String(value);
    });
}
