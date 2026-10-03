# Round 65 - Workbench Object Value 行编辑器

## 目标

提升主 IDE Workbench Mutation Builder 对 `object` 属性的可用性。此前 `object` 属性会退回普通文本输入，用户需要手写 JSON；这对开放 object（例如 `memory.师门` 一类键值）很不友好。本轮先增加轻量 key/value 行编辑器，减少手写对象 JSON 的成本。

## 计划

1. 审计 `WorldEngineMutationEditor.vue` 的 schema-aware value mode。
2. 增加 `object` value mode。
3. 为 object value 增加 key/value 行编辑、添加字段、删除字段和 JSON 预览。
4. 写入 mutation 时从行编辑器生成对象 JSON，并在 value 解析失败时给出明确错误。
5. 更新契约测试与任务文档。
6. 运行相关测试和类型检查。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - `BuilderValueMode` 增加 `object`。
  - `resolveBuilderValueMode` 对 schema attr `kind === "object"` 返回 object 模式。
  - 新增 `objectBuilderRows`，每行包含 `key` 和 `value`。
  - 新增 `addObjectBuilderRow` / `removeObjectBuilderRow`。
  - 新增 `syncObjectRowsToBuilderValue`，把行编辑器内容同步成对象 JSON 字符串。
  - 新增 `parseObjectBuilderRows`，写入 mutation 时逐行解析 value；key 为空的行会被忽略，value 支持 JSON 字面量或普通字符串。
  - 新增 `syncObjectRowsFromBuilderValue`，让 schema shortcut / attr 切换后的默认 `{}` 能恢复到行编辑器。
  - Mutation Builder UI 增加 `Object Value` 面板，支持添加字段、删除字段和 JSON 预览。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加 `builderValueMode === 'object'`、`objectBuilderRows`、`addObjectBuilderRow`、`syncObjectRowsToBuilderValue`、`Object Value` 断言。

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
- 本轮是开放 object 的轻量 key/value 行编辑，不是完整 schema fields 子表单。
- 当前 `WorldSchemaProjectionDto` / `WorldPreviewSchemaAttr` 投影还没有 fields 明细；固定 fields 子表单需要后续先补 schema 投影。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- 仅影响主 IDE Workbench 的 Mutation Builder 前端输入体验。
- API、数据库、Agent 工具、Preview 行为未变。

## 后续

- 后续如需完整 object 子表单，需要先让 schema projection 暴露 object fields / itemType 明细。
- 用户确认后做主 IDE Workbench 浏览器实跑，重点检查 object value 行编辑器与 attr path 输入是否真的降低写入成本。
