# Round 81: 固定 object fields 嵌套 object JSON 输入

## 背景

第八十轮已经把 object value / fixed fields 输入区拆成 `WorldEngineObjectValueEditor`。继续调研 schema-aware value 控件时发现：

- 顶层 list / collection 已能借用 `attr.type` 渲染 text / ref 等输入；
- 固定 object fields 中的 number / boolean / enum / ref 也已有专用控件；
- 但固定 object fields 里的嵌套 object 字段会被降级为普通 text 输入，用户容易把 `{...}` 当普通字符串写入。

本轮先补一个低风险能力：嵌套 object 字段显示 JSON textarea，仍沿用现有 `parseLooseJsonValue` 解析，不引入递归表单。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - `BuilderValueMode` 增加 `json`。
  - `objectFieldValueMode()` 在字段 schema 是 object 时返回 `json`，不再降级为 `text`。
- 更新 `WorldEngineObjectValueEditor.vue`：
  - `BuilderValueMode` 增加 `json`。
  - 固定 object field 处新增 JSON textarea，提示“嵌套 object 字段需要填写 JSON 对象”。
  - `inputValue()` 支持 `HTMLTextAreaElement`。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 同步 `BuilderValueMode` 类型。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `json` mode、JSON textarea 提示和 editor 返回 `json` 的契约断言。

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

- 本轮不改变 mutation JSON 结构、后端 schema 校验、slice 保存、editSlice 或 re-settle 语义。
- 嵌套 object 仍需要用户填写合法 JSON；只是 UI 不再把它表现成普通 text 字段。
- 这不是完整递归 object 表单，后续如果嵌套结构使用频繁，再继续做递归 fields 编辑器。
- 主 IDE Workbench 仍未做浏览器真实验收；按照项目规则，需要用户确认后再执行。

## 后续

- 可继续补 collection/list value 的更明确控件，或做递归 object fields。
- 更关键的下一步仍是主 IDE Workbench 浏览器实测：真实 Project、创建 subject、写多 mutation slice、编辑旧 slice、移动 / 删除 mutation、保存和显式 re-settle。
