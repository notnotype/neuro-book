/**
 * 站点自己的文字（t10 计划 3.3）：目录是 `locales/<语言>.json`，命名空间 `nb-site`，经 nb-ui 的翻译端口取字，写法照 nb-ui 的
 * `uiRef` 与 `useUiText`。官方站没有宿主的翻译引擎，用 nb-ui 缺省端口里的最小实现；以后换引擎只换根上的端口，组件不动。
 *
 * 目录在本模块的顶层登记（导入即登记），不放在 `main.ts`：组件测试不经 `main.ts` 挂载组件，照样要翻得出站点的键。
 * 管理面板的文字是另一份目录、另一个命名空间（`pages/admin/text.ts`），跟着管理面板的块走，不进入口。
 */

import {registerDefaultCatalog, useText} from "@notnotype/nb-ui/text-port";
import {textRef} from "@notnotype/nb-ui/text";
import type {TextParams, TextRef} from "@notnotype/nb-ui/text";

import zhCN from "./locales/zh-CN.json";

export const SITE_TEXT_NAMESPACE = "nb-site";

/** 源语言目录。错误文案的“有没有这个码”按它判断（`http/failure-text.ts`）。 */
export const SITE_SOURCE_CATALOG = zhCN;

registerDefaultCatalog(SITE_TEXT_NAMESPACE, {"zh-CN": zhCN});

/** i18next 的复数形后缀：目录里写 `<键>_one`、`<键>_other`，引用写 `<键>` 加 `count` 参数。 */
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

type WithoutPlural<Key extends string> = Key extends `${infer Base}_${PluralSuffix}` ? Base : Key;

/**
 * 目录推出的键：嵌套对象展开成点号路径，复数形归到不带后缀的键。与 nb-ui `locales/index.ts` 的同名类型相同，那份不导出。
 * 管理面板的目录（`pages/admin/text-ref.ts`）也用它。
 */
export type CatalogKey<Source, Prefix extends string = ""> = {
    [Key in keyof Source & string]: Source[Key] extends string ? WithoutPlural<`${Prefix}${Key}`> : CatalogKey<Source[Key], `${Prefix}${Key}.`>;
}[keyof Source & string];

/** 站点目录里的键，按源语言（中文）目录核对，写错类型检查不过。 */
export type SiteTextKey = CatalogKey<typeof zhCN>;

/** 站点目录里一条文字的引用。 */
export function siteRef(key: SiteTextKey, params?: TextParams): TextRef {
    return textRef(key, params, SITE_TEXT_NAMESPACE);
}

/**
 * 组件取站点的文字；在 `setup` 里调用。返回的函数每次调用都读端口的当前语言，放进 `computed` 或模板里。
 * 错误文案的键是运行期拼出来的（`errors.<拥有者>.<码>`），经 `failureText` 取成引用后用 `useText().t` 翻译。
 */
export function useSiteText(): (key: SiteTextKey, params?: TextParams) => string {
    const port = useText();
    return (key, params) => port.t(siteRef(key, params));
}
