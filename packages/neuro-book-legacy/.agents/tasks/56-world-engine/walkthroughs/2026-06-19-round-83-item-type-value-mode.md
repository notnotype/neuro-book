# Round 83: list / collection itemType value 推导

## 背景

继续审查 Mutation Builder 的 schema-aware value 控件时，发现 list / collection 的元素类型在 schema 规范里是真正写在 `itemType` 上：

- `events: { kind: list, itemType: text }`
- `inventory: { kind: collection, itemType: ref(item) }`

当前 schema 投影为了前端兼容，会把 `itemType` 也投影到 `type`，所以多数场景能正常工作。但前端工具函数和 Workbench 组件如果只看 `type`，会和规范真相源产生隐性耦合：一旦局部 attr 只带 `itemType`，默认值、ref 下拉、value mode 都可能退化。

## 变更

- 更新 `world-engine-preview.ts`：
  - 新增 `previewAttrValueType(attr)`，统一读取一次 mutation value 实际要填写的值类型。
  - list / collection 优先返回 `itemType ?? type`。
  - 其他属性返回 `type ?? itemType`，保留现有投影兼容。
  - `defaultValueForPreviewAttr()` 改为使用该函数，支持 list / collection 的 ref、int、bool、enum 等元素类型默认值。
- 更新 `WorldEngineMutationEditor.vue`：
  - `refOptionsForAttr()` 改为通过 `previewAttrValueType()` 判断 ref 目标类型。
  - `resolveBuilderValueMode()` 改为通过 `previewAttrValueType()` 判断 ref / number / boolean value mode。
- 更新 `world-engine-preview.test.ts`：
  - 增加 itemType-only 的 list ref、list int、collection ref 默认值覆盖。
  - 增加 `previewAttrValueType()` 行为断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件、16 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮不改变后端 schema、API、mutation JSON 结构、slice 保存或 re-settle 语义。
- 前端仍兼容投影里带 `type` 的旧路径，但对规范真相源 `itemType` 更稳。
- 这不是完整 list / collection 编辑器，只是 value type 推导闭环。
- 主 IDE Workbench 仍未做浏览器真实验收；按照项目规则，需要用户确认后再执行。

## 后续

- 可继续补 list / collection 更直观的专用输入，或进入主 IDE Workbench 浏览器实测。
- 浏览器实测建议覆盖真实 Project 的 itemType-only schema、collection ref、list ref / number、写入与编辑旧 slice、显式 re-settle。
