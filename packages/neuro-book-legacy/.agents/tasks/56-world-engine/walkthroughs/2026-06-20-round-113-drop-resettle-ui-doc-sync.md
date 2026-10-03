# Round 113 - Drop Resettle UI And Sync Docs

## Context

本轮按“World Engine 新路线收敛计划”推进：当前实现不再维护旧值字段，不做后端重结算；写入 / 编辑 / 删除 / 查询通过 `issues` 暴露 E/A 问题。剩余重点是清理前端旧重结算交互、补读时 `dangling-ref`、同步 profile 与稳定文档。

## Changes

- 后端 `WorldEngineService.reduceWithIssues()` 在 reduce 完成后按 subject schema 扫描最终 ref 值，目标 subject 缺失或类型不符时返回 `dangling-ref` E issue，并尽量归属到写入该 attr 的 slice。
- 后端 facade 测试新增“合法 ref 写入后目标 subject 被删除”的旧数据/手工损坏场景，确认 `queryState` 与 `listSlices` 都能读出 `dangling-ref`。
- 主 IDE Workbench 移除旧重结算状态、按钮和请求；写入 / 编辑 / 删除后展示返回的 `issues`，State Query 展示 query issues，Timeline 与 Slice Inspector 展示 slice issue badge / 明细。
- 主 IDE Slice Inspector 增加 trash 删除入口，确认后调用 `DELETE /api/projects/world-engine/slices/:sliceId`。
- 独立 Preview 移除旧重结算表单、提示、结果区和 helper；写入 / 编辑适配 `{sliceId, issues}`，State Query 适配 `{subjects, issues}`，Timeline 增加 slice 删除入口与 issue 展示。
- `world.engine` profile 输出要求改为返回 issues、区分 E/A；mock workbench preview 删除旧修正类推荐 kind。
- `README.md`、`agent-tools.md`、`sqlite-and-api.md`、`schema-design.md`、`worked-example.md`、`PROJECT-STATUS.md` 同步为当前契约：无旧值字段、无后端重结算、`deleteSlice` 回退、E/A issues、项目日历字符串。

## Decisions

- 历史 walkthrough 不批量改写；旧文件名和旧记录保留为历史。
- `deleteSlice` 是物理删除且不可恢复，前端第一版使用 `window.confirm` 做最小二次确认。
- `dangling-ref` 是读时 E issue，主要覆盖旧数据、手工 DB 损坏或未来删除 subject 场景；正常写入仍由 schema ref 校验拦截。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`：通过，4 files / 52 tests。
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 18 tests。
- `bun run typecheck`：通过。
- 关键词核查：旧重结算 / 旧字段搜索只剩历史 walkthrough 链接、用户指定的 round-113 文件名和 `old-sword` 示例文本；`correction` / `bootstrap` 在 active 文档和 World Engine 前端中无命中。
- 浏览器验收未自动执行；需用户明确允许后再跑 Preview 与主 IDE Workbench 真实流程。
