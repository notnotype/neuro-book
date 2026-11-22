/**
 * 组件取文字（docs/specs/ui/nested-grid.md 输出 143）：有宿主经 `LAYOUT_TEXT_KEY` 注入就用它，没有就用自带的源语言目录。
 * 内部模块，不从任何入口导出；注入键、类型与按目录翻译的函数在 `text.ts`（子路径 `./text`），目录的键与占位符由
 * `text.dom.test.ts` 核对。
 */

import {inject} from "vue";

import {NB_LAYOUT_SOURCE_LOCALE} from "../locales";
import {LAYOUT_TEXT_KEY, layoutCatalogTranslate} from "./text";
import type {LayoutTranslate} from "./text";

/** 没有宿主时用源语言目录，与宿主用 `layoutCatalogTranslate` 注入同一份实现。 */
const sourceTranslate: LayoutTranslate = layoutCatalogTranslate(NB_LAYOUT_SOURCE_LOCALE);

/** 在 `setup` 里调用：有宿主注入就用它，没有就用自带的源语言目录。 */
export function useLayoutText(): LayoutTranslate {
    return inject(LAYOUT_TEXT_KEY, sourceTranslate);
}
