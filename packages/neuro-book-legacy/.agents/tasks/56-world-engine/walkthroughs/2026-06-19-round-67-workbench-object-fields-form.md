# Round 67 - Workbench 固定 Object Fields 子表单

## 目标

Round 66 已让 `getWorldSchema` 投影递归 `fields` / `itemType`，本轮把这份结构用于主 IDE Workbench Mutation Builder：当 object attr 有固定 fields 时，直接渲染固定字段子表单，避免用户手填 key，也减少字段名写错。

## 计划

1. 审计现有 object value key/value 行编辑器。
2. 识别 `builderAttr.fields`，区分固定 fields 与开放 object 两种模式。
3. 固定 fields 模式下锁定 key，并按字段 schema 渲染 number / boolean / enum / ref / text 控件。
4. 继续保留开放 object 的自由 key/value、添加字段、删除字段能力。
5. 更新契约测试与任务文档。
6. 运行相关测试和类型检查。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 新增 `objectFieldEntries` 与 `objectHasFixedFields`。
  - 固定 fields 模式下，`syncObjectRowsFromBuilderValue()` 会按 schema fields 生成固定行。
  - 每个固定字段的默认值来自已有对象值；若没有已有值，则使用字段 default 或字段类型默认值。
  - 新增 `objectFieldValueMode()`，按字段 schema 推导 number / boolean / enum / ref / text 控件。
  - 新增 `objectFieldEnumOptions()` 与 `objectFieldRefOptions()`，复用 enum/ref 选择能力。
  - 模板中 `Object Value` 面板会在固定 fields 时显示为 `Object Fields`。
  - 固定 fields 模式隐藏“添加字段”和删除按钮，字段 key 只读；开放 object 模式保持原自由 key/value 行编辑器。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加 `Object Fields`、`objectHasFixedFields`、`objectFieldValueMode`、`objectFieldRefOptions` 断言。

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
- 固定 fields 子表单第一版支持字段级 number / boolean / enum / ref / text 控件；嵌套 object 字段暂按普通 text / JSON 输入处理。
- `WorldEngineMutationEditor.vue` 增至 550 行，仍低于 800 行；如果继续增加 Builder 能力，建议拆出 Mutation Builder 子组件。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- 仅影响主 IDE Workbench 的 Mutation Builder 前端输入体验。
- API、数据库、Agent 工具、Preview 行为未变。

## 后续

- 可继续补批量 / 模板化 mutation。
- 用户确认后做主 IDE Workbench 浏览器实跑，重点验证固定 object fields 子表单是否比手写 JSON 更顺手。
