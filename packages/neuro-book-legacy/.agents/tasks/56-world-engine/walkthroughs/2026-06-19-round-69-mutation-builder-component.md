# Round 69: Mutation Builder 组件拆分

## 背景

第六十八轮之后，`WorldEngineMutationEditor.vue` 已承载 slice 保存、dirty guard、schema shortcuts、Mutation Builder、object value / fixed fields 表单等多类职责，文件体量约 556 行。后续如果继续补批量 mutation、模板化 mutation 或嵌套 object fields，继续堆在父编辑器里会降低可维护性。

本轮目标是做一轮结构性整理：不改变写入 / 编辑 slice 的行为，只把 Mutation Builder 的 UI 拆成独立组件。

## 变更

- 新增 `app/components/novel-ide/world-engine/WorldEngineMutationBuilder.vue`：
  - 承载 Mutation Builder 表单 UI。
  - 保留 subject / attr / op / value 输入。
  - 保留 number / boolean / enum / ref / object / text 的 schema-aware value 控件。
  - 保留开放 object key/value 行编辑器。
  - 保留固定 object fields 子表单和“启用字段”保护。
- 更新 `WorldEngineMutationEditor.vue`：
  - 引入 `WorldEngineMutationBuilder`。
  - 父组件继续掌握 slice 表单、保存、dirty guard、schema shortcuts、mutation JSON 生成与校验。
  - 新增 `updateBuilderField` 与 `updateObjectBuilderRow`，作为子组件事件到原有 watcher / JSON 同步链路的桥。
  - 父组件体量从约 556 行降到约 516 行。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加 `WorldEngineMutationBuilder.vue` 读取。
  - 把 Builder UI 文案和事件契约断言迁移到新组件。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮是结构拆分，不改变后端 API、slice 写入语义或 re-settle 语义。
- Builder 的状态仍由父组件持有，因此现有 watcher、schema default 推导、object JSON 同步逻辑没有被重新设计。
- 未做浏览器验证；按照项目约束，主 IDE Workbench 的浏览器实测需要用户确认后再执行。

## 后续

- 若继续增强 Builder，下一步可以把 Builder 状态和 helper 逻辑也逐步内聚到子组件，或按功能拆出 object value editor。
- 主 IDE Workbench 仍建议做一次用户视角浏览器实测：新建 Project、创建 subject、写入 slice、编辑旧 slice、触发 re-settle、查询 selected slice 状态。
