# Round 40 - listLimit service 层校验

## 背景

本轮审查 `queryState.listLimit` 的内部调用边界。HTTP API 和 Agent 工具已经把 `listLimit` 限制在 1..100，但 facade/service 本身没有最后防线。

旧逻辑使用 `query.listLimit ? ... : ...`：

- `listLimit: 0` 会被当成未提供，静默不裁剪。
- `listLimit: -1` 会进入 `slice(-limit)`，产生反直觉裁剪。
- 小数或超过上限也没有统一错误。

这和外部 API 契约不一致，也容易让未来内部调用绕过边界。

## 本轮计划

1. service 层与 HTTP / Agent 保持同一边界。
2. `queryState.listLimit` 只接受 1..100 的整数。
3. 增加 facade 回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `queryState()` 在 reduce 前调用 `assertListLimit()`。
  - `listLimit === undefined` 表示不裁剪。
  - 提供时必须是 1..100 的整数。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`queryState 在 service 层拒绝非法 listLimit`。
  - 覆盖 0、负数、小数、超过上限四种内部调用。
- 更新文档：
  - `README.md` 记录第四十轮进展。
  - `sqlite-and-api.md` 补充 `queryState.listLimit` 的 1..100 契约。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 30 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 49 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复 `listLimit` 内部边界，没有改动 HTTP / Agent / Preview API 形态，只把 service 层补成同样的契约。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 facade/service 还有哪些边界只在 HTTP 或 Agent 层校验，核心层没有兜底。
- 浏览器验证仍待用户确认后执行。
