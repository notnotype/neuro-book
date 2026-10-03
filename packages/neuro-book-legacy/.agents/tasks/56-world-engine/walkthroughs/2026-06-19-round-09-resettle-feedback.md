# Round 09 - Resettle Feedback

## Scope

本轮继续做 `/world-engine.preview` 的审查式可用性修复。World Engine 第一版坚持“写过去 / 编辑过去后不自动重结算，调用方显式调用 `resettleTimeline`”，但 preview 之前只把 `needsResettle` 放在 JSON 结果里，用户很容易不知道下一步该做什么。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `formatSubjectList(input)`，将 `affectedSubjects` 稳定格式化为表单可读字符串。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `formatSubjectList()` 会裁剪空白、丢弃空项。
- 更新 `app/pages/world-engine.preview.vue`：
  - 写入 / 编辑 slice 后，如果返回 `needsResettle: true`：
    - 自动填充 `resettleForm.from = sliceForm.time`。
    - 自动填充 `resettleForm.subjectIds = affectedSubjects`。
    - 显示 amber 提示，说明从哪个时间、哪些 subject 开始重结算，以及影响多少后续 mutation。
  - 执行 resettle 成功后清除提示。
  - 切换 Project / 新建 subject 时清理旧提示，避免跨 Project 残留。

## Decisions

- 仍不自动执行 re-settle。原因：第一版设计要求补过去后由调用方显式触发重结算；preview 只把下一步准备好，保持行为透明。
- `from` 使用当前 slice 表单时间，而不是 API 返回的 raw instant；HTTP / UI 边界继续坚持日历字符串。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 通过：1 个测试文件，5 个用例。
- `bun run typecheck`
  - 通过。
- `bunx vitest run server/api/projects/world-engine/[...segments].test.ts server/world-engine/world-engine.facade.test.ts`
  - 通过：2 个测试文件，7 个用例。
- `bunx vitest run server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 通过：2 个测试文件，6 个用例。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；当前页面下一步可以在浏览器里验证：

1. 新建 Project。
2. 创建 subject。
3. 写入两个 slice。
4. 载入较早 slice 并编辑。
5. 确认页面出现 re-settle 提示并自动填充表单。
6. 点击重结算并查询状态。

## Code Review Notes

- 这轮修复让第一版“显式 re-settle”更可操作，而没有破坏“不自动改未来 old”的设计。
- 仍需真实浏览器验证确认提示位置、表单填充和状态刷新体验。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
