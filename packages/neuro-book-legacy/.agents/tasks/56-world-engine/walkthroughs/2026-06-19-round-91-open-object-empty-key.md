# Round 91: 开放 object 空 key 行保持普通输入

## 背景

第九十轮让开放 object 行编辑器继承根 object 的 `itemType`，例如 `itemType=object` 的开放 key 会显示 JSON textarea。这让已填写 key 的行更符合 schema，但继续审查交互时发现一个小问题：

新增空行时，key 还没填，value 区也会因为根 object 的 `itemType=object` 提前变成 JSON textarea。用户还没决定 key，就先看到大输入框，视觉上有些跳。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - `objectFieldAttr(rowKey)` 在 `rowKey.trim()` 为空时直接返回 `null`。
  - 空 key 行保持普通 value 输入。
  - key 非空后仍继续继承根 object 的 `itemType`，并按 itemType 切换 value 控件和默认值。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加空 key 行不触发 itemType 投影的契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、17 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮是 Workbench Builder 前端交互收紧，不改变 API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- 已填写 key 的开放 object 行仍保留第九十轮的 itemType-aware 控件。
- 空 key 行不再提前显示 JSON textarea，新增字段时界面更稳。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- Workbench Builder 的 object/itemType 输入链路已经比较完整。
- 下一阶段更值得转向真实浏览器验收，或继续补 collectionRemove 的现有值辅助选择。
