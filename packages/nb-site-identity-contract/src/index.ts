/**
 * 账号模块对外的 HTTP 合同（ADR 0059 决策 2、4）。前端、合同测试与账号模块都只经这里认识账号的接口；
 * 本包只许依赖 TypeBox（`nb-site-server/src/architecture.test.ts` 检查），换语言重写账号模块时它照样留着。
 *
 * 几部分：失败码与错误体（`./errors`）、字段规则（`./fields`）、时间写法（`./time`）、路径（`./paths`）、
 * 账号自己的接口（`./account`）、管理接口（`./admin`）、社交登录与关联（`./social`）、对外 OAuth 服务（`./oauth`）。
 * 行为合同是 docs/specs/site/accounts.md、admin.md 与 oauth-provider.md，两处不一致时以 Spec 为准。
 */

/** 账号模块的全部接口挂在这个前缀下；改它等于改对外合同。 */
export const IDENTITY_API_PREFIX = "/api/identity/v1";

export * from "./account";
export * from "./admin";
export * from "./errors";
export * from "./fields";
export * from "./oauth";
export * from "./paths";
export * from "./social";
export * from "./time";
