# Round 41 - listSlices.limit service 层校验

## 背景

本轮审查 timeline 查询的内部调用边界。HTTP API 的 `slices?limit=...` 已经要求正整数，但 facade/service 直接调用 `listSlices({ limit })` 时没有最后防线。

如果内部传入 `limit: 0`、负数或小数，会直接进入 repository 的 Prisma `take` / 排序逻辑，行为不直观，也和 HTTP 契约不一致。

## 本轮计划

1. service 层与 HTTP query 契约保持一致。
2. `listSlices.limit` 只接受正整数。
3. 增加 facade 回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `listSlices()` 查询 repository 前调用 `assertPositiveInteger(query.limit, "limit")`。
  - `limit === undefined` 表示不限制条数。
  - 提供时必须是正整数。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`listSlices 在 service 层拒绝非法 limit`。
  - 覆盖 0、负数、小数。
- 更新文档：
  - `README.md` 记录第四十一轮进展。
  - `sqlite-and-api.md` 补充 `listSlices.limit` 正整数契约。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 31 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 50 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复 `listSlices.limit` 内部边界，没有改变 HTTP / Agent / Preview API 形态。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 timeline range 参数，例如 `from > to` 是否应明确报错，避免查询结果为空但原因不明显。
- 浏览器验证仍待用户确认后执行。
