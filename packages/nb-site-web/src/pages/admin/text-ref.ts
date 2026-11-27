/**
 * 管理面板文字的引用（B6、B7 审查第 11 条）：只有键的类型与造引用的函数，不带目录本身。路由表在入口块里，要给管理面板的五页
 * 写标签页标题，从这里取引用；目录（`./locales/zh-CN.json`）由 `./text.ts` 登记，只跟着管理面板的块走。
 *
 * 这里对目录只做类型导入：改成值导入，整份管理面板的文字就跟着路由表进了入口（`tests/build.test.ts` 守着）。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {TextParams, TextRef} from "@notnotype/nb-ui/text";

import type {CatalogKey} from "../../text";
import type adminCatalog from "./locales/zh-CN.json";

export const ADMIN_TEXT_NAMESPACE = "nb-site-admin";

/** 管理面板目录里的键，按源语言（中文）目录核对，写错类型检查不过。键仍以 `admin.` 开头，与站点目录的键分得开。 */
export type AdminTextKey = CatalogKey<typeof adminCatalog>;

/** 管理面板目录里一条文字的引用。翻译要等 `./text.ts` 登记过目录：管理面板的页面都经它取字，块加载时就登记了。 */
export function adminRef(key: AdminTextKey, params?: TextParams): TextRef {
    return textRef(key, params, ADMIN_TEXT_NAMESPACE);
}
