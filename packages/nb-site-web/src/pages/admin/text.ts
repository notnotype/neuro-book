/**
 * 管理面板的文字（B6、B7 审查第 11 条）：目录是本目录下的 `locales/<语言>.json`，命名空间 `nb-site-admin`。访客与普通用户
 * 用不到这些字，放在站点目录里会让每个访客都下载一遍；这里的目录只由管理面板的组件导入，跟着管理面板的块走。
 *
 * 目录在本模块的顶层登记（导入即登记），理由同 `../../text.ts`：组件测试直接挂管理面板的组件，照样要翻得出。路由切到管理面板时，
 * 页面的块先加载完、本模块先登记，标签页标题才按新路由去翻（vue-router 先取完懒加载的组件再改当前路由）。
 */

import {registerDefaultCatalog, useText} from "@notnotype/nb-ui/text-port";
import type {TextParams} from "@notnotype/nb-ui/text";

import zhCN from "./locales/zh-CN.json";
import {ADMIN_TEXT_NAMESPACE, adminRef} from "./text-ref";
import type {AdminTextKey} from "./text-ref";

export {adminRef};
export type {AdminTextKey};

/** 源语言目录。审计动作名“每个都有文案”按它检查（`tests/catalog.test.ts`）。 */
export const ADMIN_SOURCE_CATALOG = zhCN;

registerDefaultCatalog(ADMIN_TEXT_NAMESPACE, {"zh-CN": zhCN});

/** 组件取管理面板的文字；在 `setup` 里调用，用法同 `useSiteText`。 */
export function useAdminText(): (key: AdminTextKey, params?: TextParams) => string {
    const port = useText();
    return (key, params) => port.t(adminRef(key, params));
}
