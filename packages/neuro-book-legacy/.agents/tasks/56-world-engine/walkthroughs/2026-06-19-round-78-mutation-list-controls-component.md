# Round 78: Mutation List Controls 组件拆分

## 背景

第七十七轮把 mutation list 的替换 / 删除 / 移动 / 索引夹取抽成纯函数并补了行为测试。随后审查 Builder 组件时，发现 `WorldEngineMutationBuilder.vue` 同时承载：

- schema-aware 表单输入；
- object fields / object rows；
- mutation 列表选择、载入、上移 / 下移；
- 追加 / 替换所选 / 删除所选 / 替换全部。

为了避免 Builder 后续继续变厚，本轮先把顶部“mutation 列表选择与顺序控制”抽成子组件。

## 变更

- 新增 `WorldEngineMutationListControls.vue`：
  - 接收 `selectedSubjectTypeLabel`、`mutationLoadOptions`、`mutationLoadIndex`。
  - 负责渲染 mutation 下拉、载入、上移、下移按钮。
  - 向上发出 `update-mutation-load-index`、`load-mutation`、`move-selected-mutation`。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 引入 `WorldEngineMutationListControls`。
  - 删除内联的顶部 mutation list 控制条。
  - 保留底部“追加 / 替换所选 / 删除所选 / 替换全部”，因为这些动作直接依赖 Builder 当前表单结果。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加新组件读取。
  - 增加 `WorldEngineMutationListControls` 契约断言。
  - 将载入 / 上移 / 下移相关断言迁移到新组件。

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

- 本轮不改变后端 API、slice 保存格式、re-settle 语义或用户可见功能。
- Builder 顶部列表控制条已独立，后续继续扩展 mutation list 操作时有更清楚的落点。
- 浏览器验证仍未执行；按照项目规则，主 IDE Workbench 的真实用户流程实测需要用户确认后再跑。

## 后续

- 如果 Builder 继续增长，可以进一步拆 object value / fixed fields 输入区。
- 主 IDE Workbench 仍需要浏览器实测，覆盖真实 Project 的多 mutation 写入、编辑、移动、删除、保存和 re-settle。
