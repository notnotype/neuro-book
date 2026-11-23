/**
 * nb-layout 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方没开 `resolveJsonModule` 时，从包源码
 * 导入 JSON 会让它们的类型检查失败。有翻译引擎的宿主按命名空间 `nb-layout`、源语言 `NB_LAYOUT_SOURCE_LOCALE` 把这份目录登记
 * 进自己的引擎，再把翻译函数交给 `LAYOUT_TEXT_KEY`；只有一种语言的宿主用 `./text` 的 `layoutCatalogTranslate` 注入；没有注入时
 * 组件用这里的源语言目录。仓库的目录检查只查 JSON 目录，这两份的键与占位符由 `../vue/text.dom.test.ts` 核对。
 */

import enUS from "./en-US";
import zhCN from "./zh-CN";

/** @experimental */
export const NB_LAYOUT_NAMESPACE = "nb-layout";

/**
 * 源语言，也是没有注入时组件的语言：发到 npm 的库缺省用英文。宿主登记目录时用它，不写死。
 * @experimental
 */
export const NB_LAYOUT_SOURCE_LOCALE = "en-US";

/** @experimental */
export const NB_LAYOUT_CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;
