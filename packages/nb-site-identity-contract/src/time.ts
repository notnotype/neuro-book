/**
 * 时间与条款版本的写法。账号模块的响应与请求里的时间都是 `IsoTimestamp`；页面按浏览器的时区显示。
 */

import {Type} from "typebox";

/**
 * 到毫秒的 UTC 时间，与 `Date.prototype.toISOString()` 的输出同形（`2026-11-25T08:30:00.000Z`）。
 * 不收不带毫秒、带时区偏移的写法：同一个时刻只有一种写法，前端与合同测试可以直接比字符串。
 */
export const IsoTimestamp = Type.String({pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"});

/**
 * 条款版本：形如 `2026-11-20` 的日期，服务条款与隐私政策共用一个（`site.accounts` 的配置
 * `NB_SITE_IDENTITY_TERMS_VERSION`）。请求里的写法不对是 `validation_failed`；写法对、却不是当前版本是
 * `consent_required`（输出 3、10）。日期是否真实存在只在服务端的配置里查，请求只比是不是当前版本。
 */
export const TermsVersion = Type.String({pattern: "^\\d{4}-\\d{2}-\\d{2}$"});
