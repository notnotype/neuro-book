# Round 66 - Schema Fields / ItemType 投影

## 目标

第六十五轮补了开放 object 的 key/value 行编辑器，但固定 object fields 子表单还缺一块基础：前端拿不到 `fields` 明细。本轮扩展 `getWorldSchema` 投影，把后端已规范化的 `itemType` 与递归 `fields` 暴露给 Agent / Preview / Workbench。

## 计划

1. 审计 schema loader、`WorldSchemaProjection` 与前端 `WorldPreviewSchemaAttr`。
2. 扩展后端 schema projection attr 类型，递归携带 `fields`，并在存在时携带 `itemType`。
3. 保留既有扁平 attr 列表，避免破坏 Schema Shortcuts。
4. 更新前端 `resolvePreviewAttrPath`：固定 fields 优先，开放 object key 继续用 `itemType` / 旧 `type` fallback。
5. 补后端 facade 测试和前端 util 测试。
6. 运行相关测试和类型检查。

## 实现

- 更新 `server/world-engine/types.ts`：
  - 新增递归 `WorldSchemaProjectionAttr`。
  - `WorldSchemaProjection.subjectTypes[].attrs` 改为 `WorldSchemaProjectionAttr[]`。
- 更新 `server/world-engine/schema-loader.ts`：
  - `flattenAttrs()` 返回 `WorldSchemaProjectionAttr[]`。
  - 新增 `projectAttrSchema()`，投影 `itemType` 与递归 `fields`。
  - 继续输出 `equipment.weapon` 这类扁平 attr，保持既有下拉和快捷按钮行为。
- 更新 `app/utils/world-engine-preview.ts`：
  - `WorldPreviewSchemaAttr` 增加 `itemType` 与递归 `fields`。
  - `resolvePreviewAttrPath()` 现在会优先沿 `fields` 解析固定 object 子字段；没有 fields 命中时，再按 `itemType` / 旧 `type` 解析开放 object key。
- 更新测试：
  - `server/world-engine/world-engine.facade.test.ts` 覆盖 `getWorldSchema` 返回 enum、default、itemType 与 object fields。
  - `app/utils/world-engine-preview.test.ts` 覆盖固定 fields 与开放 itemType path 解析。

## 验证

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：3 个文件、48 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 实际结果与计划出入

- 实际实现符合计划。
- 本轮扩展 schema projection 合同，但尚未实现固定 fields 的专用 UI 子表单。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- `getWorldSchema` 响应会在存在时新增 `itemType` / `fields` 字段。
- 前端 schema attr 类型与 attr path 解析能力增强。
- API、数据库、Agent 工具名称、slice 写入行为不变。

## 后续

- 下一步可在 Mutation Builder 的 object value 编辑器中读取 `builderAttr.fields`，为固定 fields 渲染字段行，并复用现有 number / boolean / enum / ref 控件逻辑。
- 用户确认后仍需做主 IDE Workbench 浏览器实跑和体验审查。
