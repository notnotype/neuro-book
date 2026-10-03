# Round 77: Mutation list 操作纯函数与行为测试

## 背景

第七十到第七十六轮连续补齐了 Workbench Mutation Builder 的多 mutation 编辑能力：选择载入、替换所选、删除所选、上移 / 下移、选择索引同步和提交护栏。但这些列表操作主要写在 Vue 组件事件处理里，测试层更多是入口字符串契约，行为级覆盖偏弱。

本轮把 mutation 列表操作抽成纯函数，并补单测，降低后续继续改 Builder 时误伤列表语义的风险。

## 变更

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `MutationListUpdate` 类型。
  - 新增 `clampMutationIndex(length, index)`。
  - 新增 `replaceMutationAt(mutations, index, mutation)`。
  - 新增 `deleteMutationAt(mutations, index)`。
  - 新增 `moveMutationAt(mutations, index, direction)`。
- 更新 `WorldEngineMutationEditor.vue`：
  - `replaceSelectedBuilderMutation()` 改为调用 `replaceMutationAt()`。
  - `deleteSelectedBuilderMutation()` 改为调用 `deleteMutationAt()`。
  - `moveSelectedBuilderMutation()` 改为调用 `moveMutationAt()`。
  - mutation 选择索引夹取 watcher 改为调用 `clampMutationIndex()`。
- 更新 `world-engine-preview.test.ts`：
  - 新增行为测试，覆盖替换、删除、上移、边界移动、非法索引和索引夹取。

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

- 本轮不改变后端 API、slice 保存格式、re-settle 语义或前端可见 UI。
- 多 mutation 编辑的关键行为从组件事件中抽出，已有单测覆盖，后续重构 Builder 时更稳。
- 浏览器验证仍未执行；按照项目规则，主 IDE Workbench 的真实用户流程实测需要用户确认后再跑。

## 后续

- 如果继续扩展 Builder，可考虑拆出 mutation list controls 子组件，让 `WorldEngineMutationEditor.vue` 继续降复杂度。
- 主 IDE Workbench 仍需要浏览器实测，覆盖真实 Project 的多 mutation 写入、编辑、移动、删除、保存和 re-settle。
