# Round 80: Object Value Editor 组件拆分

## 背景

第七十九轮之后，`WorldEngineMutationBuilder.vue` 已经把顶部 mutation 列表控制条和底部动作按钮拆成子组件。继续审查时，Builder 里剩下的最大复杂块是 object value / fixed fields 输入区：

- 开放 object 的 key/value 行编辑；
- 固定 object fields 的启用 checkbox；
- 字段值按 number / boolean / enum / ref / text 渲染；
- 生成后的 object JSON 预览。

这块后续很可能继续扩展嵌套 object、list/collection 控件，因此本轮先把它拆成明确组件边界。

## 变更

- 新增 `WorldEngineObjectValueEditor.vue`：
  - 接收 `builderValue`、`objectBuilderRows`、`objectHasFixedFields`。
  - 接收 `objectFieldValueMode`、`objectFieldEnumOptions`、`objectFieldRefOptions` 来保持 schema-aware 字段控件。
  - 负责开放 object 的新增 / 删除字段按钮、固定 fields 的启用 checkbox、字段值输入和 JSON 预览。
  - 向上发出 `update-object-row`、`add-object-row`、`remove-object-row`。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 引入 `WorldEngineObjectValueEditor`。
  - 删除内联 object value / fixed fields 模板。
  - 显式转发 `update-object-row(index, patch)`，保持父编辑器事件契约不变。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加新组件读取与契约断言。
  - 将 Object Value / Object Fields、启用字段、字段 value mode 等断言迁移到新组件。

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

- 本轮是纯组件拆分，不改变 mutation 结构、slice 保存、editSlice 或 re-settle 语义。
- `WorldEngineMutationBuilder.vue` 从 139 行降到 117 行；新增 `WorldEngineObjectValueEditor.vue` 约 63 行。
- Object value / fixed fields 已有独立扩展点，后续做嵌套 object 或 collection 控件时不需要继续加厚 Builder 主组件。
- 主 IDE Workbench 仍未做浏览器真实验收；按照项目规则，需要用户确认后再执行。

## 后续

- 下一步产品能力可考虑：嵌套 object 字段控件、list/collection value 控件、或主 IDE Workbench 浏览器实测。
- 浏览器实测建议覆盖真实 Project 的创建 subject、写入多 mutation slice、编辑旧 slice、移动 / 删除 mutation、保存和显式 re-settle。
