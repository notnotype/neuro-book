/**
 * 账号模块的失败码与错误体（docs/specs/site/accounts.md 的失败表与输出 22、23；docs/specs/site/admin.md 的失败表；
 * docs/specs/site/oauth-provider.md 的“自家接口与站点错误页的码”）。码只追加、不改已有码的含义（三份 Spec 的“边界与兼容”）。
 * 对外 OAuth 自家接口的码与账号的码共用一套错误体；标准端点（授权、令牌、用户信息、撤销）的错误按 OAuth 的规定，不在这里。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {IDENTITY_FAILURE_CODES} from "./failure-codes";
import {literalUnion, strictObject} from "./schema";

export * from "./failure-codes";

/**
 * 不带 `fields` 的码：`IDENTITY_FAILURE_CODES` 的第一个是 `validation_failed`，其余都是。用解构取出元组而不是 `filter`：
 * `literalUnion` 要元组才推得出 `ErrorBody` 的静态类型。
 */
const [, ...CODES_WITHOUT_FIELDS] = IDENTITY_FAILURE_CODES;

/**
 * 失败的响应体（`site.accounts` 输出 22）：只有 `error.code`；`validation_failed` 另带 `fields`，是不合规则的字段名，
 * 也就是请求体或查询串里的键名（请求体太大、不是 JSON 或不是对象时为空数组），别的码不带它。
 * 各层都拒收多余的键：合同测试用它核对响应里没有给人看的文字、堆栈与内部路径。
 */
export const ErrorBody = Type.Union([
    strictObject({error: strictObject({code: Type.Literal("validation_failed"), fields: Type.Array(Type.String())})}),
    strictObject({error: strictObject({code: literalUnion(CODES_WITHOUT_FIELDS)})}),
]);

export type ErrorBody = Static<typeof ErrorBody>;
