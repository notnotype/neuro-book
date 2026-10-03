# Round 98: Slice Draft Form 组件拆分

## 背景

`WorldEngineMutationEditor.vue` 长期贴近 800 行限制。第九十三轮拆过 Header 后，后续又因为 `stateResult` 与 collectionRemove 辅助回到 799 行。继续扩展前需要先把纯表单 UI 拆出去，避免每次小改都踩线。

## 变更

- 新增 `WorldEngineSliceDraftForm.vue`：
  - 承载 slice 的 `time/title/kind/summary` 输入。
  - 承载 mutations JSON textarea、校验提示和提交按钮。
  - 通过 `v-model:*` 事件回传字段更新。
  - 使用默认 slot 放入现有 `WorldEngineMutationBuilder`，保持 Builder 在 metadata 与 JSON textarea 中间。
- 更新 `WorldEngineMutationEditor.vue`：
  - 引入 `WorldEngineSliceDraftForm`。
  - 父组件继续负责 slice 保存、mutation JSON 校验、Builder 事件和状态。
  - 文件体量从 799 行降到 796 行。
- 更新 `world-engine-ide-entry.test.ts`：
  - 纳入 `WorldEngineSliceDraftForm.vue` 读取。
  - 断言父编辑器接入 `WorldEngineSliceDraftForm`。
  - 断言新组件保留 `update:time`、`update:mutations`、校验提示、提交图标和 slot。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮是组件边界拆分，不改变 World Engine API、Project SQLite schema、Agent 工具、mutation 语义或 re-settle 行为。
- 父编辑器仍然偏大，后续再扩展前建议继续拆分 schema shortcut 或 object builder 相关逻辑。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- `world-engine.preview.vue` 仍是 799 行，若独立 Preview 后续再扩展，应优先拆分。
- 主 IDE Workbench 下一步仍建议进入真实浏览器验收。
