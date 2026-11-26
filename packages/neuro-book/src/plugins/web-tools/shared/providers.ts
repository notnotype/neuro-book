/**
 * 搜索服务的 id 与显示名（docs/specs/web/tools.md 的“术语与参与者”）。设置项与合同都从这里取，所以单放一个文件：`contracts.ts`
 * 再导出它，`settings.ts` 引它，两边不互相引用。以后加服务时在这里加一项（“边界与兼容”：只加不改）。
 */

export const WEB_PROVIDERS = ["deepseek", "tavily"] as const;
export type WebProviderId = (typeof WEB_PROVIDERS)[number];

/** 服务的名字是品牌名，各语言一样，页面与工具的文字直接用这里的；设置项的选项名另按约定键登记在消息目录里（`defineSettings` 的 choices 要求）。 */
export const PROVIDER_LABELS: Readonly<Record<WebProviderId, string>> = {deepseek: "DeepSeek", tavily: "Tavily"};

export const isWebProvider = (value: string): value is WebProviderId => (WEB_PROVIDERS as readonly string[]).includes(value);
