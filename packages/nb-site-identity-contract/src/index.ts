/**
 * 账号模块对外的 HTTP 合同（ADR 0059 决策 2、4）。前端、合同测试与账号模块都只经这里认识账号的接口；
 * 本包只许依赖 TypeBox（`nb-site-server/src/architecture.test.ts` 检查），换语言重写账号模块时它照样留着。
 *
 * 几部分：失败码与错误体（`./errors`）、字段规则（`./fields`）、时间写法（`./time`）、路径（`./paths`）、
 * 账号自己的接口（`./account`）、管理接口（`./admin`）、社交登录与关联（`./social`）、对外 OAuth 服务（`./oauth`）。
 * 浏览器只要常量与类型时从 `./constants` 导入（不带 TypeBox 的运行时，见那里的文件头）；本入口另有全部 schema。
 * 行为合同是 docs/specs/site/accounts.md、admin.md 与 oauth-provider.md，两处不一致时以 Spec 为准。
 */

export * from "./account";
export * from "./admin";
export * from "./errors";
export * from "./fields";
export * from "./oauth";
export * from "./paths";
export * from "./social";
export * from "./time";
