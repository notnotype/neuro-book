# Round 43 - resettle subjectIds 校验

## 背景

本轮审查显式 re-settle 的内部调用边界。HTTP API 和 Agent 工具已经要求 `subjectIds` 非空，但 service/facade 直接调用 `resettleTimeline({ subjectIds: [] })` 时会返回：

```json
{"subjects": [], "reSettledMutations": 0}
```

这看起来像一次成功的重结算，但实际什么都没有做。对调用方来说，这是非常容易误判的假成功。

## 本轮计划

1. service 层与 HTTP / Agent 边界保持一致。
2. `resettleTimeline.subjectIds` 去重后不能为空。
3. 增加 facade 回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `resettleTimeline()` 对 `subjectIds` 去重后检查长度。
  - 为空时返回 400：`subjectIds 不能为空`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`resettleTimeline 拒绝空 subjectIds，避免静默 no-op`。
- 更新文档：
  - `README.md` 记录第四十三轮进展。
  - `sqlite-and-api.md` 补充 `resettleTimeline.subjectIds` 非空契约。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 33 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 52 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复 `resettleTimeline.subjectIds` 内部边界，没有改动 HTTP / Agent / Preview API 形态。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 `affectedSubjects` 与 re-settle 表单之间的体验，确认 Preview 是否会在无影响 subject 时隐藏或禁用重结算动作。
- 浏览器验证仍待用户确认后执行。
