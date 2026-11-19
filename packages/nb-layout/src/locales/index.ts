/**
 * nb-layout 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方没开 `resolveJsonModule` 时，从包源码
 * 导入 JSON 会让它们的类型检查失败。宿主按命名空间 `nb-layout`、源语言 `zh-CN` 把这份目录登记进自己的翻译引擎，再把翻译函数
 * 交给 `LAYOUT_TEXT_KEY`；没有注入时，`src/vue/text.ts` 直接读这里的源语言目录。
 */

import enUS from "./en-US";
import zhCN from "./zh-CN";

export const NB_LAYOUT_NAMESPACE = "nb-layout";

/** 源语言；宿主登记目录时用。 */
export const NB_LAYOUT_SOURCE_LOCALE = "zh-CN";

export const NB_LAYOUT_CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;
