/**
 * 统计模块对外的 HTTP 合同（ADR 0059 决策 2、4）。前端、合同测试与统计模块都只经这里认识统计的接口；
 * 本包只许依赖 TypeBox（`nb-site-server/src/architecture.test.ts` 检查），换语言重写统计模块时它照样留着。
 */

/** 统计模块在站点地址上的接口挂在这个前缀下；改它等于改对外合同。写入口在单独的主机上，不用这个前缀。 */
export const TELEMETRY_API_PREFIX = "/api/telemetry/v1";
