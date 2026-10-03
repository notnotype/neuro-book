# Round 85: Preview 组件拆分

## 背景

上一轮给独立 `/world-engine.preview` 的简化 Mutation Builder 增加了 value 类型提示，但也明确留下了一个维护风险：`world-engine.preview.vue` 已超过 800 行。继续在这个文件里堆 UI 会让后续 Preview Builder、Query、re-settle 等调试入口越来越难改。

本轮优先做结构拆分，不改变 API、表单字段、mutation JSON、保存、查询或 re-settle 行为。

## 变更

- 新增 `WorldEnginePreviewProjectPanel.vue`：
  - 承载 Project 创建、示例世界按钮、当前 Project 信息、Schema / calendar 展示与 schema attr 快捷填充按钮。
- 新增 `WorldEnginePreviewActions.vue`：
  - 承载 Create Subject、Write / Edit Slice、Query、Resettle 表单。
  - 父页面继续负责真实 API 调用、错误处理和状态编排。
- 新增 `WorldEnginePreviewMutationBuilder.vue`：
  - 承载独立 Preview 的简化 Builder UI。
  - 保留 subject / attr / op / value 四个输入、value 类型提示、追加 / 替换动作。
- 更新 `world-engine.preview.vue`：
  - 用三个子组件替换原内联模板。
  - 页面行数降到 799 行，回到当前项目的单文件体量约束以内。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 Preview ProjectPanel / Actions / MutationBuilder 的契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、16 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

行数检查：

- `app/pages/world-engine.preview.vue`：799 行。
- `WorldEnginePreviewProjectPanel.vue`：82 行。
- `WorldEnginePreviewActions.vue`：187 行。
- `WorldEnginePreviewMutationBuilder.vue`：71 行。

## 审查结论

- 本轮是纯前端结构拆分，未改后端、API、Agent 工具或世界引擎数据语义。
- Preview 父页面仍持有 API orchestration 和核心状态，子组件只处理表单布局与事件转发。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- 主 IDE Workbench 浏览器实测仍是关键验证：真实 Project、创建 subject、写多 mutation slice、编辑旧 slice、移动 / 删除 mutation、保存和显式 re-settle。
- Preview 之后若继续增强 list / collection 专用输入，应优先放在已拆出的 `WorldEnginePreviewMutationBuilder` 或正式 Workbench Builder 中。
