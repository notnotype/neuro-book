/**
 * nb-layout 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方没开 `resolveJsonModule` 时，从包源码
 * 导入 JSON 会让它们的类型检查失败。注入翻译端口的宿主在引导时按命名空间 `nb-layout`、源语言 `zh-CN` 登记这份目录；没有
 * 宿主注入时，Vue 层用它建缺省端口（`src/vue/text.ts`）。
 */

import enUS from "./en-US";
import zhCN from "./zh-CN";

export const NB_LAYOUT_NAMESPACE = "nb-layout";

/** 源语言；宿主登记目录时用。 */
export const NB_LAYOUT_SOURCE_LOCALE = "zh-CN";

export const NB_LAYOUT_CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;
