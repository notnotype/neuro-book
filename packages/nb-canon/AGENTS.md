# nb-canon 包入口

本包位于 `packages/nb-canon`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-canon` 是作者视角的世界引擎内核：条目、剧情变更、核对点、未决问题、正文建议与修订的模型与计算，渲染与带值写法，以及世界服务的语义。行为合同见 [`docs/specs/canon/`](../../docs/specs/canon/)；取舍见 [ADR 0037](../../docs/adr/0037-world-engine-story-change-log.md)、[ADR 0038](../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)、[ADR 0039](../../docs/adr/0039-world-engine-segmented-revision-log.md)。

## 边界

- Owner：w00039（小说创作插件）。公开合同是主入口 `.`（前后端共用）与 `./node`（只在 Bun 里用：分段日志存储、归纳缓存文件，以及编排它们的世界服务 `WorldService`）。
- 主入口不引用 `node:*` 与 `bun:*`，由 `tests/architecture.test.ts` 守住；文件、锁、时钟、摘要、小模型都由宿主经接口注入。
- 运行时依赖只有 TypeBox、MDX 解析链（micromark 及其扩展、acorn）。不依赖 `@notnotype/neuro-book` 与别的应用包。
- 计算是确定的：同一份世界、同一章序、同一组登记的 Component 类型，结果逐字相同；计算不调用模型、不读时钟。

## 测试

- 用 `bun test`；测试放 `tests/`，测试名引用 Spec 编号（例如 `canon.model 输出 7`）。
- 增量引擎的结果必须与整本重算一致：改动引擎后跑 `tests/differential.test.ts`。
- 临时目录用 `@notnotype/neuro-book-test-support/tmp` 的 `createTestTmpRoot`。

## 完成门禁

`bun test` 与 `bun run typecheck` 在本包目录通过。
