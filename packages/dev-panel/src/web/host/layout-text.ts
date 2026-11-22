/**
 * 网页根上的 nb-layout 文字（docs/specs/ui/i18n.md 输出 8）：这个界面只有中文，而 nb-layout 没有注入时是英文，所以根上注入它自带的
 * 中文目录。网页只有一个根（`main.ts`），在那里调。
 */

import {LAYOUT_TEXT_KEY, layoutCatalogTranslate} from "@notnotype/nb-layout/text";
import type {App} from "vue";

/** 给根注入 nb-layout 的中文文字，返回同一个 `app`，可以接着链式调用。 */
export function installLayoutText<T>(app: App<T>): App<T> {
    return app.provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN"));
}
