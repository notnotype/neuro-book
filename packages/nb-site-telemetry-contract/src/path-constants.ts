/**
 * 统计模块在站点地址上的路径前缀。单独一个不导入 TypeBox 的文件：`./constants` 入口从这里转出，浏览器只取它时不带 schema
 * （见 `constants.ts` 的文件头）。
 */

/** 统计模块在站点地址上的接口挂在这个前缀下；改它等于改对外合同。写入口在单独的主机上，不用这个前缀。 */
export const TELEMETRY_API_PREFIX = "/api/telemetry/v1";
