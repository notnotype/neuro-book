/**
 * 统计模块对外的 HTTP 合同（ADR 0059 决策 2、4）。前端、合同测试与统计模块都只经这里认识统计的接口；
 * 本包只许依赖 TypeBox（`nb-site-server/src/architecture.test.ts` 检查），换语言重写统计模块时它照样留着。
 *
 * 两部分：写入口的路径、上限、响应与失败码（`./ingest`）；收集清单的各个版本与三种上报的 schema（`./manifest`）。
 * 站点地址上的路径前缀在 `./path-constants`；浏览器只要它时从 `./constants` 入口取，不带 schema（见 `constants.ts`）。
 */

export * from "./path-constants";
export * from "./ingest";
export * from "./manifest";
