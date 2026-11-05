# nb-time 包入口

本包位于 `packages/nb-time`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-time` 是故事时间的计算：历法的校验与编译、模糊词表、时间说法的校验与降成约束、时间约束网络（范围、依据、打架）、查询与按历法格式化。行为合同见 [`docs/specs/canon/time.md`](../../docs/specs/canon/time.md)；取舍见 [ADR 0043](../../docs/adr/0043-world-engine-placement-and-telling-orders.md)。

## 边界

- Owner：w00039（小说创作插件）。公开合同是主入口 `.`，前后端共用；nb-canon 用它给剧情变更算时间，nb-story 用同一个包。
- 没有运行时依赖（连 TypeBox 也没有）：说法与历法的 TypeBox schema 在 nb-canon 的 `core/schema.ts`，这里是同形的 TS 类型。不引用 `node:*` 与 `bun:*`。
- 计算是确定的：同一组事件与说法、同一份历法与词表，结果逐字相同（time 输出 10）；不读时钟。
- 绝对时间是从绝对年份 0 的第一个月第一天零点起的整数个最小单位（tick），只在计算里用，不存。

## 测试

- 用 `bun test`；测试放 `tests/`，测试名引用 Spec 编号（例如 `canon.time 输出 13`）。
- 有外部参照的用参照对拍：公历对 JS 的 `Date`，网络对 Floyd-Warshall。

## 完成门禁

`bun test` 与 `bun run typecheck` 在本包目录通过。
