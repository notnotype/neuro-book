/**
 * 组件取文字（docs/specs/ui/nested-grid.md 输出 143）：有宿主经 `LAYOUT_TEXT_KEY` 注入就用它，没有就用自带的源语言目录。
 * 内部模块，不从任何入口导出；注入键与类型在 `text.ts`（子路径 `./text`）。
 */

import {inject} from "vue";

import {NB_LAYOUT_CATALOGS, NB_LAYOUT_SOURCE_LOCALE} from "../locales";
import {LAYOUT_TEXT_KEY} from "./text";
import type {LayoutTextKey, LayoutTranslate} from "./text";

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/gu;

/** 把点分键展开成目录里的叶子。目录的形状由 `../locales` 定，键与目录的对应由 `LayoutTextKey` 与消息目录检查守着。 */
function lookup(key: LayoutTextKey): string {
    let node: unknown = NB_LAYOUT_CATALOGS[NB_LAYOUT_SOURCE_LOCALE];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === "string" ? node : key;
}

/** 没有宿主时用源语言目录：只代入参数，不处理复数（目录里没有复数键）；缺的参数保留占位，看得出少传了什么。 */
const sourceTranslate: LayoutTranslate = (key, params) => lookup(key).replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params?.[name];
    return value === undefined ? placeholder : String(value);
});

/** 在 `setup` 里调用：有宿主注入就用它，没有就用自带的源语言目录。 */
export function useLayoutText(): LayoutTranslate {
    return inject(LAYOUT_TEXT_KEY, sourceTranslate);
}
