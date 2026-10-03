# Round 82: 嵌套 object JSON 提交前校验

## 背景

第八十一轮把固定 object fields 中的嵌套 object 字段升级成 JSON textarea。继续审查时发现，这个输入区虽然能引导用户写 JSON，但 `parseObjectBuilderRows()` 仍只校验“是不是 JSON 值”，没有校验“是不是 object”。

这会导致用户填入 `[]`、`"text"`、`123` 这类合法 JSON 值时，前端 Builder 可以构造 mutation，随后才由后端 schema 校验拒绝。反馈太晚，也不够贴近字段。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - `parseObjectBuilderRows()` 在 `objectFieldValueMode(key) === "json"` 时，要求解析结果必须是非数组 object。
  - 非 object 时返回 `object value.<key> 必须是 JSON object`，由现有 Builder 提交流程展示错误。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加提交前 JSON object 校验文案的契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、16 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮不改变后端 schema、mutation JSON 结构、slice 保存、editSlice 或 re-settle 语义。
- 嵌套 object 字段的非法 JSON 形状会在 Builder 提交前被拦下，错误定位到具体 object field。
- 仍未实现递归 object 表单；这是提交前护栏，不是完整字段编辑器。
- 主 IDE Workbench 仍未做浏览器真实验收；按照项目规则，需要用户确认后再执行。

## 后续

- 可继续补递归 object fields、list/collection value 控件，或转入主 IDE Workbench 浏览器实测。
- 浏览器实测建议覆盖真实 Project 的创建 subject、写入多 mutation slice、编辑旧 slice、移动 / 删除 mutation、保存和显式 re-settle。
