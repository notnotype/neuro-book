/**
 * 账号模块对外的 HTTP 合同（ADR 0059 决策 2、4）。前端、合同测试与账号模块都只经这里认识账号的接口；
 * 本包只许依赖 TypeBox（`nb-site-server/src/architecture.test.ts` 检查），换语言重写账号模块时它照样留着。
 */

/** 账号模块的全部接口挂在这个前缀下；改它等于改对外合同。 */
export const IDENTITY_API_PREFIX = "/api/identity/v1";
