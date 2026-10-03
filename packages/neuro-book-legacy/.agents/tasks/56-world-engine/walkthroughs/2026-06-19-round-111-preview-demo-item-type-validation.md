# Round 111: 示例世界预检按 itemType 判断值类型

## 背景

继续审查 Preview / Workbench 的 Builder 与 schema 语义对齐时发现，`validatePreviewDemoSchema()` 的示例世界预检仍只看 `attr.type`。

现在 `list` / `collection` 的真实 value 类型已经统一为优先读取 `itemType`。如果某个 Project schema 使用 `collection itemType: text`，但没有兼容性的 `type` 字段，旧预检可能会放行一键示例世界，实际写入 `inventory` 的 `subject://old-sword` 时再被后端拒绝。这个反馈点太晚，不利于用户理解 schema 哪里不对。

## 变更

- 更新 `app/utils/world-engine-preview.ts`：
  - `validatePreviewDemoAttrs()` 改用 `previewAttrValueType(attr)` 判断示例世界依赖的属性值类型。
  - `list` / `collection` 会优先按 `itemType` 校验。
  - 缺少值类型时返回 `当前是 未声明`，让错误原因更明确。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `inventory` 只声明 `itemType: "ref(item)"` 时预检通过。
  - 覆盖 `itemType: "text"` 时预检提前报 `character.inventory 类型需要 ref(item)`。
  - 覆盖未声明 `type/itemType` 时提示 `当前是 未声明`。

## 验证

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts
```

结果：1 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 一键示例世界的 schema 预检现在与 Builder 的 value 类型读取规则一致。
- 错误 schema 会更早在 UI 预检阶段暴露，不再等到真实写入时才失败。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时建议覆盖新建 Project 的默认 schema 与一个故意错误的 `inventory itemType`，确认预检提示对用户足够直观。
