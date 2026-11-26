/**
 * 路径参数的 schema（`site.accounts`、`site.admin` 与 `site.oauth-provider` 输入与前置条件的接口表）。前缀与各接口的路径在
 * `./path-constants`（不导入 TypeBox，前端经 `./constants` 取），这里转出。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {DECIMAL_ID_PATTERN} from "./fields";
import {strictObject} from "./schema";

export * from "./path-constants";

/**
 * 路径里的 `:id`：十进制正整数。不合时回 `validation_failed`、`fields: ["id"]`；合写法、却不存在或不是自己的
 * 回 `not_found`（`site.accounts` 失败表）。
 */
export const IdParams = strictObject({id: Type.String({pattern: DECIMAL_ID_PATTERN})});

export type IdParams = Static<typeof IdParams>;
