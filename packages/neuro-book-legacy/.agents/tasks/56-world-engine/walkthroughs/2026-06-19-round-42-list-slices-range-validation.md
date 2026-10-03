# Round 42 - listSlices range 校验

## 背景

本轮审查 timeline range 参数。`listSlices({ from, to })` 旧逻辑会把 `from > to` 直接交给数据库范围条件，结果通常是空列表。

这对 Preview / Agent 来说很容易误导：调用方会以为该时间段没有切面，而不是时间范围写反了。

## 本轮计划

1. 保留现有 `from` / `to` API 形态。
2. service 层明确拒绝 `from > to`。
3. 增加 facade 回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `listSlices()` 查询 repository 前调用 `assertInstantRange(query.from, query.to)`。
  - 当 `from` 和 `to` 都存在且 `from > to` 时返回 400。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`listSlices 拒绝 from 晚于 to 的时间范围`。
- 更新文档：
  - `README.md` 记录第四十二轮进展。
  - `sqlite-and-api.md` 补充 `listSlices` range 契约。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 32 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 51 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复 `listSlices` 时间范围边界，没有改变 HTTP / Agent / Preview API 形态。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查其它 range 类参数，例如 `resettleTimeline.from` 是否需要更明确的范围提示。
- 浏览器验证仍待用户确认后执行。
