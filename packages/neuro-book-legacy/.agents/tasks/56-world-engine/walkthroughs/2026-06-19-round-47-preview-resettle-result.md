# Round 47 - Preview resettle 结果反馈

## 背景

Round 45 浏览器实跑时，显式 re-settle 成功后 Preview 只显示：

```text
复兴纪元1年 1月1日 00:00:01 · 13 mutations
```

这能证明动作成功，但对调试世界线来说信息偏薄：用户还要自己记住本次重算了哪些 subject。显式 re-settle 是补过去 / 编辑历史切面的关键闭环，结果反馈应该把 `from`、`subjects`、`reSettledMutations` 都直接展示出来。

## 本轮计划

1. 不改 API，只优化 Preview 展示。
2. re-settle 成功后展示结构化摘要。
3. 同时保留 JSON 详情，方便调试。

## 实现

- 更新 `app/pages/world-engine.preview.vue`：
  - 新增 `resettleResultJson` computed，复用既有 `formatPreviewJson`。
  - re-settle 结果区改为展示：
    - `from`
    - `subjects`
    - `mutations`
    - 原始 JSON 详情

## 验证

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 个测试文件通过。
  - 12 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 55 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划只调整 Preview 展示层，没有改动后端 API、Agent 工具或 World Engine 数据模型。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮改动由现有 Preview util 测试、相关集成测试和 typecheck 覆盖。

## 后续

- 下一轮可继续审查 Preview 的编辑体验，例如整块 JSON 编辑是否需要更明确地提示“会替换整个 slice”。
- 正式主 IDE UI 仍需单独设计，Preview 不作为最终产品交互。
