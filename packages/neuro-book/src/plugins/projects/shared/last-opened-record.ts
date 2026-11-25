/**
 * 上次的作品（docs/specs/runtime/projects.md 的“最近打开”）：user 分区、同一用户的全部客户端共用一份，只存作品 id。
 * 服务端的 `opened` 写它，`resume` 路由读它。它是可以丢的提示：坏记录由写入方条件 reset，不需要迁移。
 */

import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";

export const LAST_OPENED_RECORD = defineRecord({key: "projects.last-opened", scope: "user", locality: "shared", version: 1, schema: Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false})});
