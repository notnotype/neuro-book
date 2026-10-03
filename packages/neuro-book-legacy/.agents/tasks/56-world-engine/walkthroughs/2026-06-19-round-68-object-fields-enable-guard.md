# Round 68 - 固定 Object Fields 启用字段保护

## 目标

对 Round 67 的固定 object fields 子表单做代码审查。发现一个产品语义风险：固定 fields 表单会为每个字段生成默认值，并直接写入对象 JSON。这样用户只想观察或修改一个字段时，可能误写其他字段，尤其是 ref 字段可能自动填入第一个匹配 subject。

## 计划

1. 审查固定 object fields 子表单的生成逻辑。
2. 给固定 fields 增加“启用字段”开关。
3. 未启用字段只展示默认值，不进入生成的对象 JSON。
4. 已有对象值恢复时，已有 key 自动启用。
5. 更新契约测试与任务文档。
6. 运行相关测试和类型检查。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - `objectBuilderRows` 增加 `enabled` 字段。
  - 固定 fields 模式下每行显示 checkbox，title 为“启用字段”。
  - `parseObjectBuilderRows()` 跳过 `enabled === false` 的字段。
  - `syncObjectRowsFromBuilderValue()` 从已有对象恢复时，只有已有 key 自动启用；新默认字段保持未启用。
  - 未启用字段的 value 控件禁用，仍显示默认值作为提示。
  - 开放 object 模式保持原行为：新增行默认启用，可自由添加 / 删除字段。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加 `row.enabled` 和“启用字段”断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 实际结果与计划出入

- 实际实现符合计划。
- 本轮是代码审查修复，不新增 API 或数据模型能力。
- `WorldEngineMutationEditor.vue` 增至 556 行，仍低于 800 行。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- 仅影响主 IDE Workbench Mutation Builder 的固定 object fields 前端生成语义。
- API、数据库、Agent 工具、Preview 行为未变。

## 后续

- 若继续增强 Mutation Builder，建议先拆出子组件再加批量 / 模板化 mutation。
- 用户确认后做主 IDE Workbench 浏览器实跑，重点检查“启用字段”是否清楚、是否降低误写风险。
